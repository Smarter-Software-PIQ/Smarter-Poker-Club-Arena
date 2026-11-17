-- Multiple pending rebuys can be refunded in a single original cash transaction.
-- Original ledger rows have no individual refund ID. Prove the entire equal-amount
-- group before assigning each original ledger its identical club/user attribution.
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND position('balanced original refund group' in pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure))>0 AND position('balanced original refund group' in pg_get_functiondef('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $install$
DECLARE
 owners regprocedure[]:=ARRAY[
 'public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure,
 'smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure,
 'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure,
 'smarter_private.original_inventory_proof_sources_match()'::regprocedure];
 original text[]:=ARRAY['b630a717dc1fc2edc177a896404c282d','62faca4275f45085d03795b04a3f561a','276a23e5aaa880abab19217a33a8f69d','a37ad1912ecb20d2a5cc59e89540cbb3'];
 prior jsonb[]; patched text; old text; new_hashes text[]; i integer; j integer;
 old_keys text:=$old$  SELECT DISTINCT q.transaction_id,(q.l->>'table_id')::uuid table_id,
   (q.l->>'club_id')::uuid club_id,(q.l->>'to_entity_id')::uuid user_id,(q.l->>'amount')::numeric amount
  FROM originals q
  WHERE q.tournament_id IS NULL AND q.l->>'from_type'='table_stack'
   AND q.l->>'to_type'='player_wallet' AND q.l->>'category'='player_funding'$old$;
 new_keys text:=$new$  SELECT q.transaction_id,(q.l->>'table_id')::uuid table_id,
   (q.l->>'club_id')::uuid club_id,(q.l->>'to_entity_id')::uuid user_id,(q.l->>'amount')::numeric amount,
   count(*) legs, min((q.l->>'created_at')::timestamptz) refund_time,
   bool_and((q.ledger_id::text=q.l->>'id' AND q.l->>'status'='posted'
    AND q.l->>'from_entity_id'=q.l->>'table_id' AND q.game_scope->>'asset'='chips'
    AND q.game_scope->'unit_scale'='2'::jsonb) IS TRUE)
   AND count(DISTINCT q.ledger_id)=count(*) AND count((q.l->>'created_at')::timestamptz)=count(*)
   AND min((q.l->>'created_at')::timestamptz)=max((q.l->>'created_at')::timestamptz) posted_group
  FROM originals q
  WHERE q.tournament_id IS NULL AND q.l->>'from_type'='table_stack'
   AND q.l->>'to_type'='player_wallet' AND q.l->>'category'='player_funding'
  GROUP BY 1,2,3,4,5$new$;
 old_group text:=$old$  GROUP BY k.transaction_id,k.table_id,k.club_id,k.user_id,k.amount
 ), bbj_wallet_matches$old$;
 new_group text:=$new$  GROUP BY k.transaction_id,k.table_id,k.club_id,k.user_id,k.amount,k.legs,k.refund_time,k.posted_group
  -- One balanced original refund group. Each indistinguishable output belongs
  -- to the same club and wallet. Never reuse a receipt to explain an extra leg.
  HAVING count(*)=k.legs AND (k.legs=1 OR (k.posted_group
   AND count(DISTINCT a.pending_addon_id)=k.legs AND count(DISTINCT a.funding_receipt_id)=k.legs
   AND count(DISTINCT o.source_ledger_id)=k.legs
   AND bool_and((o.asset='chips' AND o.unit_scale=2 AND o.funding_union_id=p_union_id
     AND o.amount=a.applied+a.refunded AND a.applied>=0 AND o.amount=o.balance_before-o.balance_after
     AND EXISTS (SELECT FROM public.chip_ledger d WHERE d.id=o.source_ledger_id
       AND d.status='posted' AND d.category IN ('rebuy','addon') AND d.amount=o.amount
       AND d.club_id=k.club_id AND d.table_id=k.table_id AND d.from_type='player_wallet'
       AND d.from_entity_id=k.user_id AND d.to_type='table_stack' AND d.to_entity_id=k.table_id)) IS TRUE)
   AND (SELECT count(*) FROM public.chip_transactions c WHERE c.club_id=k.club_id AND c.table_id=k.table_id
     AND c.to_user_id=k.user_id AND c.amount=k.amount AND c.created_at=k.refund_time
     AND c.transaction_type='addon_refund' AND c.is_reversed IS FALSE AND c.clawed_back IS FALSE)=k.legs))
 ), bbj_wallet_matches$new$;
BEGIN
 FOR i IN 1..4 LOOP
  IF md5(pg_get_functiondef(owners[i]))<>original[i] THEN RAISE EXCEPTION 'original_refund_group_preimage_changed: %',owners[i]; END IF;
  prior[i]:=(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=owners[i]);
 END LOOP;
 FOR i IN 1..4 LOOP
  old:=pg_get_functiondef(owners[i]); patched:=old;
  IF i<=2 THEN
   IF strpos(old,old_keys)=0 OR strpos(old,old_group)=0 OR strpos(old,'k.amount,count(*) refunds,')=0 THEN
    RAISE EXCEPTION 'original_refund_group_anchors_changed: %',owners[i];
   END IF;
   patched:=replace(replace(replace(old,old_keys,new_keys),old_group,new_group),'k.amount,count(*) refunds,','k.amount,1::bigint refunds,');
  ELSE
   FOR j IN 1..(CASE WHEN i=3 THEN 1 ELSE 3 END) LOOP
    IF (length(patched)-length(replace(patched,original[j],'')))/32<>1 THEN
     RAISE EXCEPTION 'original_refund_group_pin_changed: % %',owners[i],owners[j];
    END IF;
    patched:=replace(patched,original[j],new_hashes[j]);
   END LOOP;
  END IF;
  EXECUTE patched;
  IF pg_get_functiondef(owners[i])<>patched OR prior[i] IS DISTINCT FROM (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=owners[i]) THEN
   RAISE EXCEPTION 'original_refund_group_postimage_changed: %',owners[i];
  END IF;
  new_hashes[i]:=md5(patched);
 END LOOP;
 IF EXISTS(SELECT FROM pg_proc p CROSS JOIN unnest(original) h WHERE strpos(p.prosrc,h)>0) THEN
  RAISE EXCEPTION 'original_refund_group_left_stale_source_pin';
 END IF;
END $install$;
COMMIT;
