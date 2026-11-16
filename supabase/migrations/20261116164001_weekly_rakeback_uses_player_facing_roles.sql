-- @live-proof: position('Player and horse rakeback' in pg_get_functiondef('smarter_private.weekly_payout_owner_milestones(timestamptz,timestamptz,uuid)'::regprocedure))=0 AND position('active Midway players' in pg_get_functiondef('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
-- Limit replacements to the three generated payment messages and the promo
-- report. No free-form chat, display name, invoice, ledger or financial total changes.
DO $patch$
DECLARE r record; source text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('smarter_private.weekly_payout_owner_milestones(timestamptz,timestamptz,uuid)'::regprocedure,ARRAY[
 ['Weekly Rakeback: Clubs Paid','Club Rakeback Paid'],['Weekly Rakeback: Agents Paid','Agent Rakeback Paid'],['Weekly Rakeback: Players Paid','Player Rakeback Paid'],
 ['Agent commissions are paid next.','Agent Rakeback is paid next.'],['Agent commissions for ','Agent Rakeback for '],[' are paid: ',' is paid: '],
 ['Player rakeback is paid next.','Player Rakeback is paid next.'],['Player and horse rakeback for ','Player Rakeback for '],
 [$$r.payees,'Payee','Payees'$$,$$r.payees,'Player','Players'$$],[$$r.payees,'payee','payees'$$,$$r.payees,'player','players'$$]
 ]),('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure,ARRAY[
 ['Midway Weekly Horse Promo Paid','Player Rakeback Paid (Weekly Promo)'],[' active Midway horses (',' active Midway players (']
 ])) v(fn,replacements)
 LOOP
  source:=pg_get_functiondef(r.fn);
  FOR j IN 1..array_length(r.replacements,1) LOOP
   IF position(r.replacements[j][1] in source)=0 THEN RAISE EXCEPTION 'Weekly rakeback display wording changed in %',r.fn; END IF;
   source:=replace(source,r.replacements[j][1],r.replacements[j][2]);
  END LOOP;
  EXECUTE source;
 END LOOP;
END $patch$;

-- Refresh saved display from the signed event's original figures and system
-- milestone. An UPDATE does not fire the insertion-only push mirror.
WITH current_wording AS MATERIALIZED (
 SELECT u.period_end,u.recipient_id,u.union_id,u.milestone,u.title old_title,u.message old_message,
 CASE u.milestone WHEN 'clubs_paid' THEN 'Club Rakeback Paid' WHEN 'agents_paid' THEN 'Agent Rakeback Paid' ELSE 'Player Rakeback Paid' END ||
  substr(u.title,position(' (' in u.title)) as title,
 CASE u.milestone
  WHEN 'clubs_paid' THEN regexp_replace(u.message,'Agent commissions are paid next[.]$','Agent Rakeback is paid next.')
  WHEN 'agents_paid' THEN regexp_replace(replace(replace(u.message,' are paid: ',' is paid: '),'Player rakeback is paid next.','Player Rakeback is paid next.'),'^Agent commissions for ','Agent Rakeback for ')
  WHEN 'players_paid' THEN regexp_replace(regexp_replace(u.message,'^Player and horse rakeback for ','Player Rakeback for '),' (payee)(s?),',' player\2,')
 END AS message
 FROM smarter_private.weekly_payout_owner_updates u
 WHERE u.milestone IN ('clubs_paid','agents_paid','players_paid') AND u.title LIKE 'Weekly Rakeback: % Paid (%'
), updated AS (
 UPDATE public.notifications n SET title=CASE WHEN src.milestone='players_paid' THEN regexp_replace(src.title,' Payee(s?),',' Player\1,') ELSE src.title END,message=src.message
 FROM current_wording src WHERE n.user_id=src.recipient_id AND n.type='system' AND n.data->>'source'='weekly-payout-owner-update'
 AND n.data->>'union_id'=src.union_id::text AND (n.data->>'period_end')::timestamptz=src.period_end
 AND n.data->>'milestone'=src.milestone AND n.title=src.old_title AND n.message=src.old_message
 RETURNING n.id,n.title,n.message
)
UPDATE public.push_outbox p SET title=u.title,body=u.message FROM updated u
 WHERE p.related_entity_id=u.id AND p.event='system' AND p.status='pending';
WITH updated AS (
 UPDATE public.notifications n SET title='Player Rakeback Paid (Weekly Promo)',message=replace(replace(n.message,' active Midway horses (',' active Midway players ('),' horses that played raked cash or tournament hands (',' eligible players (')
 WHERE n.type='weekly_horse_promo_report' AND n.title='Midway Weekly Horse Promo Paid'
 RETURNING n.id,n.title,n.message
)
UPDATE public.push_outbox p SET title=u.title,body=u.message FROM updated u
 WHERE p.related_entity_id=u.id AND p.event='weekly_horse_promo_report' AND p.status='pending';
COMMIT;
