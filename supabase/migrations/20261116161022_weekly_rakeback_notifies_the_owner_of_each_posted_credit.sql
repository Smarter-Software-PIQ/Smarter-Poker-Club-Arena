-- @live-proof: to_regprocedure('public.claim_weekly_rakeback_credit_emails()') IS NOT NULL AND EXISTS(SELECT FROM pg_trigger WHERE tgname='weekly_rakeback_credit_notice' AND tgenabled='O' AND tgrelid='smarter_private.weekly_payout_round_receipts'::regclass)
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE smarter_private.weekly_rakeback_notice_rounds(
 run_id uuid NOT NULL,scope_kind text NOT NULL,scope_id uuid NOT NULL,round_no integer NOT NULL,
 prepared_at timestamptz,PRIMARY KEY(run_id,scope_kind,scope_id,round_no),
 FOREIGN KEY(run_id,scope_kind,scope_id,round_no) REFERENCES smarter_private.weekly_payout_round_receipts
);
CREATE TABLE smarter_private.weekly_rakeback_credit_notices(
 receipt_id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('club','agent','player')),
 user_id uuid NOT NULL,club_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),
 title text NOT NULL,body text NOT NULL,push_id uuid NOT NULL,
 email_status text NOT NULL DEFAULT 'pending' CHECK(email_status IN ('pending','sending','sent','skipped','uncertain','failed')),
 email_claim uuid,email_first_attempt timestamptz,email_next_attempt timestamptz DEFAULT now(),
 email_address text,email_provider_id text,email_reason text,email_sent_at timestamptz
);
REVOKE ALL ON smarter_private.weekly_rakeback_notice_rounds,smarter_private.weekly_rakeback_credit_notices FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.queue_weekly_rakeback_notice_round() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 INSERT INTO smarter_private.weekly_rakeback_notice_rounds(run_id,scope_kind,scope_id,round_no)
 VALUES(NEW.run_id,NEW.scope_kind,NEW.scope_id,NEW.round_no) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.queue_weekly_rakeback_notice_round() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER weekly_rakeback_credit_notice AFTER INSERT ON smarter_private.weekly_payout_round_receipts
 FOR EACH ROW EXECUTE FUNCTION smarter_private.queue_weekly_rakeback_notice_round();
-- Adopt this week's already committed rounds exactly once. The trigger handles future rounds.
INSERT INTO smarter_private.weekly_rakeback_notice_rounds(run_id,scope_kind,scope_id,round_no)
 SELECT r.run_id,r.scope_kind,r.scope_id,r.round_no FROM smarter_private.weekly_payout_round_receipts r
 JOIN public.weekly_accounting_payout_pauses p USING(run_id)
 WHERE p.period_end='2026-11-16T08:00:00Z' ON CONFLICT DO NOTHING;

CREATE FUNCTION smarter_private.weekly_posted_rakeback_credits(
 p_kind text,p_scope uuid,p_round integer,p_receipt jsonb,p_start timestamptz,p_end timestamptz)
RETURNS TABLE(receipt_id uuid,kind text,user_id uuid,club_id uuid,amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 -- A union credit belongs to its club bank; a standalone club uses its round's exact bank entry.
 SELECT l.id,'club',cl.owner_id,cl.id,l.amount
 FROM public.chip_ledger l JOIN public.clubs cl ON cl.id=l.club_id AND cl.id=l.to_entity_id
 WHERE p_round=1 AND l.status='posted' AND l.to_type='club_treasury' AND l.amount>0
 AND l.post_to_balance-l.pre_to_balance=l.amount AND
 ((p_kind='union' AND l.settlement_id=p_receipt->>'settlement_id' AND l.from_entity_id=p_scope
   AND l.from_type='union_wallet' AND l.category='rakeback'
   AND l.idempotency_key='union_close:'||l.settlement_id||':'||cl.id)
 OR(p_kind='club' AND cl.id=p_scope AND l.id=(p_receipt->>'ledger_id')::uuid AND l.amount=(p_receipt->>'amount')::numeric))
 UNION ALL
 -- Own commission excludes pass-through funds, top-ups and owner retention in the club bank.
 SELECT l.id,'agent',s.user_id,s.club_id,(i.breakdown->>'own_commission')::numeric
 FROM public.agent_commission_settlements s
 JOIN public.settlement_invoices i ON i.club_id=s.club_id AND i.created_at>=p_end
 AND i.breakdown->>'ledger_to_type'='agent_wallet'
 JOIN public.chip_ledger l ON l.id=i.source_ledger_id AND l.club_id=s.club_id
 AND l.idempotency_key=s.settlement_ref||':'||s.club_id||':'||
   CASE WHEN i.breakdown->>'ledger_from_type'='club_treasury' THEN 'club'
        ELSE i.breakdown->>'ledger_from_entity_id' END||':'||s.user_id
 AND l.created_at>=p_end
 AND l.created_at<=statement_timestamp() AND l.metadata->>'accounting_scope_id'=p_scope::text
 AND l.metadata->>'accounting_scope_kind'=p_kind AND (l.metadata->>'period_start')::timestamptz=p_start
 AND (l.metadata->>'period_end')::timestamptz=p_end
 WHERE p_round=2 AND s.period_start=p_start AND s.period_end=p_end AND s.paid_at IS NOT NULL
 AND l.to_type='agent_wallet' AND l.status='posted' AND l.category='commission'
 AND (l.to_entity_id=s.user_id OR EXISTS(SELECT FROM public.agents a WHERE a.id=l.to_entity_id AND a.club_id=s.club_id AND a.user_id=s.user_id))
 AND i.status='paid' AND i.chips_transferred AND l.amount=i.net_amount
 AND l.post_to_balance-l.pre_to_balance=l.amount AND l.pre_from_balance-l.post_from_balance=l.amount
 AND (i.breakdown->>'own_commission')::numeric>0 AND (i.breakdown->>'own_commission')::numeric<=l.amount
 UNION ALL
 -- The underlying wallet credit also covers players who play on an agent wallet.
 SELECT w.id,'player',h.user_id,h.club_id,w.amount
 FROM public.rakeback_periods p JOIN public.rakeback_period_payouts h ON h.rakeback_period_id=p.id
 JOIN public.wallet_transactions w ON w.related_entity_id=h.id AND w.user_id=h.user_id AND w.category='rakeback' AND w.type='credit'
 JOIN LATERAL(SELECT c.id,c.club_id,c.player_id,c.coordinator_union_id,c.rakeback_amount FROM public.accounting_rakeback_period_calculations c
   WHERE c.period_id=p.id ORDER BY c.id DESC LIMIT 1) c ON c.player_id=h.user_id AND c.club_id=h.club_id AND c.rakeback_amount=h.payout_amount
 WHERE p_round=3 AND p.period_start=(p_start AT TIME ZONE 'America/Los_Angeles')::date
 AND p.period_end=(p_end AT TIME ZONE 'America/Los_Angeles')::date-1 AND p.status='paid' AND h.status='paid' AND h.paid_at IS NOT NULL
 AND p.club_id=h.club_id AND p.user_id=h.user_id AND coalesce(c.coordinator_union_id,c.club_id)=p_scope
 AND (c.coordinator_union_id IS NOT NULL)=(p_kind='union') AND w.amount>0
 AND ((w.id=h.wallet_transaction_id AND w.amount=h.payout_amount) OR EXISTS(
   SELECT FROM public.accounting_rakeback_wallet_transfers t JOIN public.chip_ledger l ON l.id=t.ledger_id
   WHERE t.payout_id=h.id AND t.calculation_id=c.id AND t.wallet_transaction_id=w.id AND t.amount=w.amount
   AND l.amount=w.amount AND l.status='posted' AND l.post_to_balance-l.pre_to_balance=w.amount))
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_posted_rakeback_credits(text,uuid,integer,jsonb,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.prepare_weekly_rakeback_credit_notices() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE batch record; credit record; notice uuid; headline text; notice_body text;
BEGIN
 FOR batch IN SELECT q.*,r.receipt, (sc.item->>'period_start')::timestamptz starts,(sc.item->>'period_end')::timestamptz ends
 FROM smarter_private.weekly_rakeback_notice_rounds q
 JOIN smarter_private.weekly_payout_round_receipts r USING(run_id,scope_kind,scope_id,round_no)
 JOIN public.weekly_accounting_payout_pauses p USING(run_id) CROSS JOIN LATERAL jsonb_array_elements(p.scope_plan) sc(item)
 WHERE q.prepared_at IS NULL AND sc.item->>'kind'=q.scope_kind AND sc.item->>'id'=q.scope_id::text
 ORDER BY r.paid_at LIMIT 1 FOR UPDATE OF q SKIP LOCKED LOOP
  FOR credit IN SELECT x.*,c.name FROM smarter_private.weekly_posted_rakeback_credits(batch.scope_kind,batch.scope_id,batch.round_no,batch.receipt,batch.starts,batch.ends) x
  JOIN public.clubs c ON c.id=x.club_id JOIN public.profiles pf ON pf.id=x.user_id
  WHERE pf.is_horse IS NOT TRUE AND NOT public.fn_ca_is_cert_account(x.user_id) LOOP
   headline:=CASE credit.kind WHEN 'club' THEN 'Club rakeback credited' WHEN 'agent' THEN 'Agent commission credited' ELSE 'Player rakeback credited' END;
   notice_body:=credit.name||' credited '||to_char(credit.amount,'FM999,999,999,999,990.00')||' chips for the week ending '||
     to_char((batch.ends AT TIME ZONE 'America/Los_Angeles')::date-1,'Mon DD, YYYY')||'.';
   INSERT INTO smarter_private.weekly_rakeback_credit_notices(receipt_id,kind,user_id,club_id,amount,title,body,push_id)
    VALUES(credit.receipt_id,credit.kind,credit.user_id,credit.club_id,credit.amount,headline,notice_body,gen_random_uuid())
    ON CONFLICT DO NOTHING RETURNING push_id INTO notice;
   IF FOUND THEN
    INSERT INTO public.push_outbox(id,recipient_user_id,event,title,body,url,tag,related_entity_id)
    VALUES(notice,credit.user_id,'weekly_rakeback_credit',headline,'Open your club statement to view the credit.','/hub/club-arena/clubs/'||credit.club_id||'/cashier/statements','rakeback:'||credit.receipt_id,credit.receipt_id);
   END IF;
  END LOOP;
  UPDATE smarter_private.weekly_rakeback_notice_rounds SET prepared_at=now()
   WHERE (run_id,scope_kind,scope_id,round_no)=(batch.run_id,batch.scope_kind,batch.scope_id,batch.round_no);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.prepare_weekly_rakeback_credit_notices() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_weekly_rakeback_credit_emails()
RETURNS TABLE(receipt_id uuid,claim uuid,address text,title text,body text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE n record; target text;
BEGIN
 PERFORM smarter_private.prepare_weekly_rakeback_credit_notices();
 FOR n IN SELECT t.* FROM smarter_private.weekly_rakeback_credit_notices t WHERE t.email_status IN ('pending','sending')
 AND t.email_next_attempt<=now() ORDER BY t.email_next_attempt,t.receipt_id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  SELECT u.email INTO target FROM auth.users u JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.notification_preferences f ON f.user_id=u.id
  WHERE u.id=n.user_id AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND nullif(trim(u.email),'') IS NOT NULL
  AND lower(split_part(u.email,'@',2)) !~ '(^|[.])(invalid|test|localhost|example)$'
  AND lower(split_part(u.email,'@',2)) NOT IN ('example.com','example.org','example.net')
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND p.is_horse IS NOT TRUE AND NOT public.fn_ca_is_cert_account(u.id)
  AND f.email_enabled IS DISTINCT FROM false AND f.mute_all IS NOT TRUE
  AND (n.kind<>'club' OR EXISTS(SELECT FROM public.clubs c WHERE c.id=n.club_id AND c.owner_id=u.id));
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
CREATE FUNCTION public.finish_weekly_rakeback_credit_email(p_receipt uuid,p_claim uuid,p_provider_id text,p_failure text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 UPDATE smarter_private.weekly_rakeback_credit_notices SET email_status=CASE WHEN nullif(p_provider_id,'') IS NOT NULL THEN 'sent' ELSE 'sending' END,
 email_provider_id=nullif(p_provider_id,''),email_reason=left(p_failure,100),email_sent_at=CASE WHEN nullif(p_provider_id,'') IS NOT NULL THEN now() END
 WHERE receipt_id=p_receipt AND email_claim=p_claim AND email_status='sending';
 RETURN FOUND;
END $f$;
REVOKE ALL ON FUNCTION public.claim_weekly_rakeback_credit_emails(),public.finish_weekly_rakeback_credit_email(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_weekly_rakeback_credit_emails(),public.finish_weekly_rakeback_credit_email(uuid,uuid,text,text) TO service_role;
COMMIT;
