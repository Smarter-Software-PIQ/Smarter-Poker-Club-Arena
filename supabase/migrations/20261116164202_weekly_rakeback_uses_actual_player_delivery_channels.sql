-- @live-proof: position('Agent Rakeback' in pg_get_functiondef('smarter_private.prepare_weekly_rakeback_credit_notices()'::regprocedure))>0 AND position('weekly_rakeback_email_destination' in pg_get_functiondef('public.claim_weekly_rakeback_credit_emails()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION smarter_private.weekly_rakeback_email_destination(p_user uuid,p_club uuid,p_kind text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT u.email FROM auth.users u JOIN public.profiles p ON p.id=u.id
 LEFT JOIN public.notification_preferences f ON f.user_id=u.id
 WHERE u.id=p_user AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND nullif(trim(u.email),'') IS NOT NULL
 AND (u.banned_until IS NULL OR u.banned_until<=now()) AND NOT public.fn_ca_is_cert_account(u.id)
 AND f.email_enabled IS DISTINCT FROM false AND f.mute_all IS NOT TRUE
 AND (p_kind<>'club' OR EXISTS(SELECT FROM public.clubs c WHERE c.id=p_club AND c.owner_id=u.id))
 -- Verified seed records are still synthetic mailboxes. Device enrollment is independent.
 AND lower(split_part(u.email,'@',2)) !~ '(^|[.])(invalid|test|localhost|example)$'
 AND lower(split_part(u.email,'@',2)) NOT IN ('example.com','example.org','example.net','horses.smarter.poker','hydra.smarter.poker','horse.ai','bot.smarter.poker','hydra.bot')
 AND NOT (p.is_horse IS TRUE AND lower(u.email) LIKE 'horse%@smarter.poker')
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_rakeback_email_destination(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION smarter_private.prepare_weekly_rakeback_credit_notices() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE batch record; credit record; notice uuid; headline text; notice_body text;
BEGIN
 FOR batch IN SELECT q.*,r.receipt, (sc.item->>'period_start')::timestamptz starts,(sc.item->>'period_end')::timestamptz ends
 FROM smarter_private.weekly_rakeback_notice_rounds q
 JOIN smarter_private.weekly_payout_round_receipts r USING(run_id,scope_kind,scope_id,round_no)
 JOIN public.weekly_accounting_payout_pauses p USING(run_id) CROSS JOIN LATERAL jsonb_array_elements(p.scope_plan) sc(item)
 WHERE q.prepared_at IS NULL AND sc.item->>'kind'=q.scope_kind AND sc.item->>'id'=q.scope_id::text
 ORDER BY r.paid_at LIMIT 1 FOR UPDATE OF q SKIP LOCKED LOOP
  FOR credit IN SELECT x.*,c.name,
   EXISTS(SELECT FROM public.push_subscriptions d WHERE d.user_id=x.user_id AND d.is_active) has_device,
   smarter_private.weekly_rakeback_email_destination(x.user_id,x.club_id,x.kind) destination
  FROM smarter_private.weekly_posted_rakeback_credits(batch.scope_kind,batch.scope_id,batch.round_no,batch.receipt,batch.starts,batch.ends) x
  JOIN public.clubs c ON c.id=x.club_id JOIN public.profiles pf ON pf.id=x.user_id
  WHERE NOT public.fn_ca_is_cert_account(x.user_id) LOOP
   headline:=CASE credit.kind WHEN 'club' THEN 'Club Rakeback' WHEN 'agent' THEN 'Agent Rakeback' ELSE 'Player Rakeback' END;
   notice_body:=credit.name||' credited '||to_char(credit.amount,'FM999,999,999,999,990.00')||' chips for the week ending '||
     to_char((batch.ends AT TIME ZONE 'America/Los_Angeles')::date-1,'Mon DD, YYYY')||'.';
   INSERT INTO smarter_private.weekly_rakeback_credit_notices(receipt_id,kind,user_id,club_id,amount,title,body,push_id,email_status,email_reason)
    VALUES(credit.receipt_id,credit.kind,credit.user_id,credit.club_id,credit.amount,headline,notice_body,gen_random_uuid(),
     CASE WHEN credit.destination IS NULL THEN 'skipped' ELSE 'pending' END,
     CASE WHEN credit.destination IS NULL THEN 'no_eligible_verified_destination' END)
    ON CONFLICT DO NOTHING RETURNING push_id INTO notice;
   IF FOUND THEN
    INSERT INTO public.push_outbox(id,recipient_user_id,event,title,body,url,tag,related_entity_id,status,failure_reason)
    VALUES(notice,credit.user_id,'weekly_rakeback_credit',headline,'Open your club statement to view the credit.','/hub/club-arena/clubs/'||credit.club_id||'/cashier/statements','rakeback:'||credit.receipt_id,credit.receipt_id,
     CASE WHEN credit.has_device THEN 'pending' ELSE 'skipped' END,CASE WHEN NOT credit.has_device THEN 'no_subscription' END);
   END IF;
  END LOOP;
  UPDATE smarter_private.weekly_rakeback_notice_rounds SET prepared_at=now()
   WHERE (run_id,scope_kind,scope_id,round_no)=(batch.run_id,batch.scope_kind,batch.scope_id,batch.round_no);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.prepare_weekly_rakeback_credit_notices() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.claim_weekly_rakeback_credit_emails()
RETURNS TABLE(receipt_id uuid,claim uuid,address text,title text,body text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE n record; target text;
BEGIN
 PERFORM smarter_private.prepare_weekly_rakeback_credit_notices();
 FOR n IN SELECT t.* FROM smarter_private.weekly_rakeback_credit_notices t WHERE t.email_status IN ('pending','sending')
 AND t.email_next_attempt<=now() ORDER BY t.email_next_attempt,t.receipt_id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  target:=smarter_private.weekly_rakeback_email_destination(n.user_id,n.club_id,n.kind);
  IF target IS NULL OR (n.email_address IS NOT NULL AND n.email_address<>target) THEN
   UPDATE smarter_private.weekly_rakeback_credit_notices SET email_status='skipped',email_reason='no_eligible_verified_destination' WHERE weekly_rakeback_credit_notices.receipt_id=n.receipt_id;
  ELSIF n.email_first_attempt < now()-interval '23 hours' THEN
   UPDATE smarter_private.weekly_rakeback_credit_notices SET email_status='uncertain',email_reason='provider_idempotency_window_elapsed' WHERE weekly_rakeback_credit_notices.receipt_id=n.receipt_id;
  ELSE
   UPDATE smarter_private.weekly_rakeback_credit_notices t SET email_claim=gen_random_uuid(),email_status='sending',
    email_first_attempt=coalesce(email_first_attempt,now()),email_address=target,email_next_attempt=now()+interval '5 minutes'
   WHERE t.receipt_id=n.receipt_id RETURNING t.receipt_id,t.email_claim,target,t.title,t.body INTO receipt_id,claim,address,title,body;
   RETURN NEXT;
  END IF;
 END LOOP;
END $f$;

REVOKE ALL ON FUNCTION public.claim_weekly_rakeback_credit_emails() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_weekly_rakeback_credit_emails() TO service_role;

-- Revisit already-prepared player rounds to represent every original paid
-- player receipt. The original receipt key preserves all previously queued or sent notices.
UPDATE smarter_private.weekly_rakeback_notice_rounds SET prepared_at=NULL WHERE round_no=3 AND prepared_at IS NOT NULL;
-- Keep a provider's already-submitted payload intact. Unsent recipients use the same notice ID.
UPDATE smarter_private.weekly_rakeback_credit_notices SET title=CASE kind WHEN 'club' THEN 'Club Rakeback' WHEN 'agent' THEN 'Agent Rakeback' ELSE 'Player Rakeback' END
 WHERE email_status='pending' AND email_first_attempt IS NULL;
UPDATE public.push_outbox p SET title=CASE n.kind WHEN 'club' THEN 'Club Rakeback' WHEN 'agent' THEN 'Agent Rakeback' ELSE 'Player Rakeback' END
 FROM smarter_private.weekly_rakeback_credit_notices n WHERE p.id=n.push_id AND p.event='weekly_rakeback_credit' AND p.status='pending';
COMMIT;
