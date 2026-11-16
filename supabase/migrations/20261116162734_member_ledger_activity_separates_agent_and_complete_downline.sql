-- Ledger Window: individual agent, complete downline and combined activity.
-- @live-proof: (SELECT pg_get_functiondef('public.ca_club_member_detail(uuid,uuid,date,date)'::regprocedure) LIKE '%activity_breakdown%')
-- Read-only reporting. No financial writes, table DDL or engine dependency.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
CREATE OR REPLACE FUNCTION public.ca_member_activity_tx_totals(p_club uuid,p_users uuid[],p_from timestamptz,p_to timestamptz)
RETURNS TABLE(claimed_back numeric,sent_out numeric)
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $function$
 WITH receipts AS MATERIALIZED (
  SELECT DISTINCT ON(ct.id) ct.* FROM unnest(p_users) u(uid) CROSS JOIN LATERAL (
   SELECT t.* FROM public.chip_transactions t WHERE t.club_id=p_club
    AND t.to_user_id=u.uid AND lower(t.transaction_type) ~ '(rakeback|commission)'
    AND (p_from IS NULL OR t.created_at>=p_from) AND (p_to IS NULL OR t.created_at<p_to)
   UNION ALL
   SELECT t.* FROM public.chip_transactions t WHERE t.club_id=p_club
    AND t.from_user_id=u.uid AND lower(t.transaction_type) ~ '(transfer|send|distribut|rakeback|commission)'
    AND (p_from IS NULL OR t.created_at>=p_from) AND (p_to IS NULL OR t.created_at<p_to)
  ) ct
 ), movements AS MATERIALIZED (
  SELECT DISTINCT ON(cl.id) cl.* FROM unnest(p_users) u(uid) CROSS JOIN LATERAL (
   SELECT l.* FROM public.chip_ledger l WHERE l.club_id=p_club AND l.status='posted'
    AND l.to_entity_id=u.uid AND l.to_type IN ('player_wallet','agent_wallet','promo_wallet')
    AND lower(l.category) ~ '(rakeback|commission)'
    AND (p_from IS NULL OR l.created_at>=p_from) AND (p_to IS NULL OR l.created_at<p_to)
   UNION ALL
   SELECT l.* FROM public.chip_ledger l WHERE l.club_id=p_club AND l.status='posted'
    AND l.from_entity_id=u.uid AND l.from_type IN ('player_wallet','agent_wallet','promo_wallet')
    AND lower(l.category) ~ '(transfer|send|distribut|rakeback|commission)'
    AND (p_from IS NULL OR l.created_at>=p_from) AND (p_to IS NULL OR l.created_at<p_to)
  ) cl
  WHERE NOT EXISTS(SELECT 1 FROM public.chip_transactions ct WHERE ct.club_id=cl.club_id
    AND ct.created_at=cl.created_at AND abs(ct.amount)=abs(cl.amount)
    AND (ct.to_user_id=cl.to_entity_id OR ct.from_user_id=cl.from_entity_id)
    AND (ct.from_user_id IS NULL OR ct.from_user_id=cl.from_entity_id OR ct.transaction_type IN ('club_bank_send','horse_treasury_funding','club_promo_send','promo_disbursement','union_member_send','union_promo_send'))
    AND (ct.to_user_id IS NULL OR ct.to_user_id=cl.to_entity_id OR ct.transaction_type IN ('club_bank_claim','admin_removal','club_bank_reversal'))
    AND (ct.metadata->>'source' IS NULL OR ct.metadata->>'source'=cl.from_type)
    AND (ct.metadata->>'destination' IS NULL OR ct.metadata->>'destination'=cl.to_type))
 )
 SELECT coalesce((SELECT sum(abs(r.amount)) FROM receipts r WHERE r.to_user_id=ANY(p_users) AND lower(r.transaction_type)~'(rakeback|commission)'),0)
     + coalesce((SELECT sum(abs(m.amount)) FROM movements m WHERE m.to_entity_id=ANY(p_users) AND m.to_type IN ('player_wallet','agent_wallet','promo_wallet') AND lower(m.category)~'(rakeback|commission)'),0),
   coalesce((SELECT sum(abs(r.amount)) FROM receipts r WHERE r.from_user_id=ANY(p_users) AND lower(r.transaction_type)~'(transfer|send|distribut|rakeback|commission)'),0)
     + coalesce((SELECT sum(abs(m.amount)) FROM movements m WHERE m.from_entity_id=ANY(p_users) AND m.from_type IN ('player_wallet','agent_wallet','promo_wallet') AND lower(m.category)~'(transfer|send|distribut|rakeback|commission)'),0);
$function$;
REVOKE ALL ON FUNCTION public.ca_member_activity_tx_totals(uuid,uuid[],timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ca_member_activity_group(p_club uuid,p_users uuid[],p_from date,p_to date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $function$
 WITH roll AS (
  SELECT coalesce(sum(r.hands) FILTER(WHERE NOT r.is_mtt),0)::bigint hands,
    coalesce(sum(r.hands) FILTER(WHERE r.is_mtt),0)::bigint mtt_hands,
    coalesce(sum(r.net) FILTER(WHERE NOT r.is_mtt),0) net
  FROM unnest(p_users) u(uid) CROSS JOIN LATERAL public.ca_member_record_chicago_facts(p_club,u.uid,p_from,p_to) r
 ), fees AS (
  SELECT coalesce(sum(f.cash_fees),0) cash,coalesce(sum(f.tournament_fees),0) mtt
  FROM public.ca_club_member_chicago_fee_totals(p_club,p_from,p_to,NULL) f WHERE f.user_id=ANY(p_users)
 ), money AS (
  SELECT coalesce(sum(public.ca_club_member_tournament_money(p_club,u.uid,
      p_from::timestamp AT TIME ZONE 'America/Chicago',(p_to+1)::timestamp AT TIME ZONE 'America/Chicago')),0) mtt,
    sum(j.amount) jackpots,count(*) FILTER(WHERE j.amount IS NULL) unknown
  FROM unnest(p_users) u(uid) CROSS JOIN LATERAL (SELECT public.ca_club_member_jackpot_money(p_club,u.uid,
      p_from::timestamp AT TIME ZONE 'America/Chicago',(p_to+1)::timestamp AT TIME ZONE 'America/Chicago') amount) j
 ), tx AS (
  SELECT * FROM public.ca_member_activity_tx_totals(p_club,p_users,
    p_from::timestamp AT TIME ZONE 'America/Chicago',(p_to+1)::timestamp AT TIME ZONE 'America/Chicago')
 )
 SELECT public.ca_jsonb_figure_text(jsonb_build_object('hands',r.hands,'mtt_hands',r.mtt_hands,
   'total_fee',round(f.cash,2),'mtt_fee',round(f.mtt,2),
   'total_winnings',CASE WHEN m.unknown=0 THEN round(r.net+coalesce(m.jackpots,0),2) END,
   'mtt_winnings',round(m.mtt,2),'claimed_back',round(tx.claimed_back,2),'sent_out',round(tx.sent_out,2)),
   ARRAY['total_fee','mtt_fee','total_winnings','mtt_winnings','claimed_back','sent_out'])
 FROM roll r CROSS JOIN fees f CROSS JOIN money m CROSS JOIN tx;
$function$;
REVOKE ALL ON FUNCTION public.ca_member_activity_group(uuid,uuid[],date,date) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE
 body text:=pg_get_functiondef('public.ca_club_member_detail(uuid,uuid,date,date)'::regprocedure);
 anchor constant text:='  RETURN v_out;';
 replacement constant text:=$new$
  -- Personal and complete hierarchy activity share this exact response/range.
  IF v_sensitive AND jsonb_typeof(v_out->'stats')='object' THEN
    v_out:=jsonb_set(v_out,'{stats}',public.ca_jsonb_figure_text((v_out->'stats') ||
      (SELECT jsonb_build_object('claimed_back',round(t.claimed_back,2),'sent_out',round(t.sent_out,2))
       FROM public.ca_member_activity_tx_totals(p_club_id,ARRAY[p_user_id],v_ts_from,v_ts_to) t),
      ARRAY['total_fee','mtt_fee','total_winnings','mtt_winnings','claimed_back','sent_out']));
    IF v_out->'identity'->>'role' IN ('super_agent','agent','sub_agent') THEN
      v_out:=v_out || (WITH RECURSIVE hierarchy(uid) AS (
        SELECT p_user_id
        UNION
        SELECT cm.user_id FROM public.club_members cm JOIN hierarchy h ON cm.agent_id=h.uid
        WHERE cm.club_id=p_club_id AND coalesce(cm.status,'approved') IN ('active','approved')
      ), people AS (
        SELECT array_agg(h.uid) ids FROM hierarchy h LEFT JOIN public.profiles pr ON pr.id=h.uid
        WHERE h.uid<>p_user_id AND pr.status IS DISTINCT FROM 'deleted'
      ), activity AS (
        SELECT public.ca_member_activity_group(p_club_id,coalesce(p.ids,'{}'::uuid[]),p_from,p_to) downline FROM people p
      ), combined AS (
        SELECT jsonb_object_agg(k,CASE WHEN (v_out->'stats'->>k) IS NULL OR (a.downline->>k) IS NULL THEN NULL
          ELSE to_jsonb((v_out->'stats'->>k)::numeric+(a.downline->>k)::numeric) END) stats
        FROM activity a CROSS JOIN unnest(ARRAY['hands','mtt_hands','total_fee','mtt_fee','claimed_back','sent_out','total_winnings','mtt_winnings']) k
      ) SELECT jsonb_build_object('activity_breakdown',jsonb_build_object('downline',a.downline,'combined',
        public.ca_jsonb_figure_text(c.stats,ARRAY['total_fee','mtt_fee','total_winnings','mtt_winnings','claimed_back','sent_out']))) FROM activity a CROSS JOIN combined c);
    END IF;
  END IF;
  RETURN v_out;$new$;
BEGIN
 IF md5(body)<>'7f927eddf28d7d3054fcf24a240a31b0' OR (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
   RAISE EXCEPTION 'Member detail source changed before activity breakdown installation';
 END IF;
 EXECUTE replace(body,anchor,replacement);
END $patch$;
COMMIT;
