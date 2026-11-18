-- Reserved through scripts/new-migration.mjs; incident a544b469-9226-4770-9f77-d5a77e085ea7.
-- Satellite seat cancellation refunds follow the original admitted club.
--
-- The two remaining 200-chip refunds of cancelled tournament f4153d52 were
-- labelled unsupported because their upstream wallet-funded satellite entry
-- belonged to KINGS CLUB while their already won target seat was admitted to
-- The Felt Society. The September 18 atomic award contract deliberately uses
-- the admitted registration club, and both original pool-transfer journals,
-- entitlements and refund tranches agree with that registration. Nothing was
-- refunded to a different club than its target entitlement. The PNL reader's
-- equality to the UPSTREAM entry club disagreed with the award producers and
-- with its existing satellite PRIZE return proof.
--
-- Keep all existing accepted paths. Add the independently proved original
-- admitted-seat lineage only when upstream backing resolves, and require the
-- exact original award, settlement, payout, immutable registration, fully
-- funded pool-transfer journal, entitlement and unique full refund tranche.
-- A replacement ticket, missing/conflicting source or altered split refuses.
-- Update both whole-period and bounded readers, their advancement pin and the
-- complete source guard in this transaction. Its changed generation excludes
-- old problem/clean caches without deleting or rewriting any certificate.
-- No player balance, ledger, receipt, membership or payment is changed.
-- Requires the earlier chained-seat/sub-range source fix from PR10428.
-- Native PG17: old readers reject both affected cases; new readers prove exact
-- admitted owners, preserve a same-club control, and refuse 20 conflicting
-- identity/amount/source/disposition/duplicate faults, with whole-data rollback.
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND position('SATELLITE REFUNDS FOLLOW THE ADMITTED CLUB (01a1c81a)' in pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure))>0 AND position('SATELLITE REFUNDS FOLLOW THE ADMITTED CLUB (01a1c81a)' in pg_get_functiondef('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE satellite_refund_sources_before ON COMMIT DROP AS
 SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) old_md5,
  jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'volatility',provolatile) metadata
 FROM pg_proc p WHERE p.oid IN (
  'public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure,
  'smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure,
  'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure,
  'smarter_private.original_inventory_proof_sources_match()'::regprocedure);
DO $install$
DECLARE
 sig text; d text; changed text; old_hash text; new_hash text; r record;
 anchor constant text := $anchor$     WHEN 'satellite_seat' THEN public.fn_union_pnl_satellite_seat_owner(t.registration_id,NULL)=t.refund_wallet_club_id
$anchor$;
 replacement constant text := $arm$     WHEN 'satellite_seat' THEN
      public.fn_union_pnl_satellite_seat_owner(t.registration_id,NULL)=t.refund_wallet_club_id
      OR (
       -- SATELLITE REFUNDS FOLLOW THE ADMITTED CLUB (01a1c81a).
       -- The upstream entry proves backing, not the club of an already won
       -- target seat. Both atomic award producers have used the admitted
       -- registration's club since 20260918. Prove that original award and
       -- its one full cash refund; never infer ownership from live membership.
       public.fn_union_pnl_satellite_seat_owner(t.registration_id,t.tournament_id) IS NOT NULL
       AND t.charge_category='satellite_seat' AND t.evidence_kind='atomic_satellite_seat'
       AND q.l->>'from_entity_id'=t.tournament_id::text
       AND t.gross=t.refund_prize+t.refund_bounty+t.refund_fee
       AND NOT EXISTS(SELECT 1 FROM public.tournament_tickets replacement WHERE replacement.source_refund_entitlement_id=t.id)
       AND (SELECT count(*) FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=t.id AND tr.credit_ledger_id=q.ledger_id AND tr.transaction_id=q.transaction_id
         AND tr.tournament_id=t.tournament_id AND tr.user_id=t.user_id
         AND tr.source_wallet_club_id=t.refund_wallet_club_id
         AND tr.idempotency_key=q.l->>'idempotency_key' AND tr.amount_paid_before=0 AND tr.amount_paid_now=t.gross
         AND tr.refund_prize=t.refund_prize AND tr.refund_bounty=t.refund_bounty AND tr.refund_fee=t.refund_fee)=1
       AND (SELECT count(*) FROM public.tournament_refund_tranches tr WHERE tr.entitlement_id=t.id)=1
       AND (SELECT count(*) FROM public.tournament_refund_entitlements duplicate WHERE duplicate.source_ledger_id=t.source_ledger_id)=1
       AND (SELECT count(*)
        FROM public.tournament_satellite_awards a
        JOIN public.tournament_satellite_settlements h ON h.tournament_id=a.tournament_id
        JOIN public.tournament_payouts p ON p.id=a.payout_id
        JOIN public.chip_ledger admission ON admission.id=t.source_ledger_id
        CROSS JOIN LATERAL (
         SELECT e.after_row r FROM public.union_pnl_inventory_events e
          WHERE e.source_name='tournament_players' AND e.row_id=t.registration_id
          ORDER BY e.event_id LIMIT 1
        ) reg
        WHERE a.tournament_id=t.source_satellite_id AND a.registration_id=t.registration_id
         AND a.user_id=t.user_id AND a.place=t.source_award_place AND a.delivery_kind='seat'
         AND a.ticket_id IS NULL AND a.payout_source='satellite_seat' AND a.amount=t.gross
         AND h.target_id=t.tournament_id AND h.ticket_cost=t.gross
         AND h.target_buy_in=t.refund_prize+t.refund_bounty AND h.target_fee=t.refund_fee
         AND p.tournament_id=a.tournament_id AND p.user_id=a.user_id AND p.amount=a.amount
         AND p.source=a.payout_source AND p.idempotency_key=a.idempotency_key
         AND (p.position=a.place OR h.receipt_version>=3)
         AND reg.r->>'id'=t.registration_id::text AND reg.r->>'user_id'=t.user_id::text
         AND reg.r->>'tournament_id'=t.tournament_id::text
         AND reg.r->>'source_satellite_id'=t.source_satellite_id::text
         AND reg.r->>'club_id'=t.refund_wallet_club_id::text
         AND admission.status='posted' AND admission.row_hash IS NOT NULL
         AND admission.from_type='prize_liability' AND admission.from_entity_id=t.source_satellite_id
         AND admission.to_type='prize_liability' AND admission.to_entity_id=t.tournament_id
         AND admission.tournament_id=t.source_satellite_id AND admission.club_id=t.refund_wallet_club_id
         AND admission.category='tournament_buyin' AND admission.amount=t.gross
         AND admission.idempotency_key=a.idempotency_key||':pool_transfer'
         AND admission.metadata->>'kind'='satellite_seat_pool_transfer'
         AND admission.metadata->>'satellite_id'=t.source_satellite_id::text
         AND admission.metadata->>'satellite_target_id'=t.tournament_id::text
         AND admission.metadata->>'registration_id'=t.registration_id::text
         AND admission.metadata->>'user_id'=t.user_id::text
         AND (admission.metadata->>'moved')::numeric=t.gross
         AND (admission.metadata->>'unbacked')::numeric=0
         AND (admission.metadata->>'seat_value')::numeric=t.gross
         AND CASE WHEN t.escrow_bucket='satellite_in' THEN
           t.refund_bounty=0 AND admission.metadata->>'entry_split_version' IS DISTINCT FROM '2'
          ELSE t.escrow_bucket='satellite_gross' AND admission.metadata->>'entry_split_version'='2'
           AND (admission.metadata->>'entry_prize')::numeric=t.refund_prize
           AND (admission.metadata->>'entry_bounty')::numeric=t.refund_bounty
           AND (admission.metadata->>'entry_fee')::numeric=t.refund_fee END)=1
      )
$arm$;
BEGIN
 IF md5(pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure))<>'b23655a15587192f137ae4ad57859742'
  OR md5(pg_get_functiondef('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))<>'c4ea982db893a45aade32874bd7cd495'
  OR md5(pg_get_functiondef('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure))<>'64de99e2c340a452610898efb78a0b14'
  OR md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))<>'0c629419ad2243296c0007495807676b'
  OR smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true
  OR position('CHAINED SATELLITE SEATS (20261110235613)' in pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'satellite_refund_admitted_club_preimage_changed' USING ERRCODE='55000';
 END IF;
 FOREACH sig IN ARRAY ARRAY[
  'public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)',
  'smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);
  IF (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 THEN
   RAISE EXCEPTION 'satellite_refund_admitted_club_anchor_not_unique: %',sig;
  END IF;
  changed:=replace(d,anchor,replacement); EXECUTE changed;
  IF pg_get_functiondef(sig::regprocedure)<>changed THEN
   RAISE EXCEPTION 'satellite_refund_admitted_club_postimage: %',sig;
  END IF;
 END LOOP;
 -- The bounded advancement binds the complete original reader.
 old_hash:='b23655a15587192f137ae4ad57859742';
 new_hash:=md5(pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure));
 sig:='public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)';
 d:=pg_get_functiondef(sig::regprocedure);
 IF (length(d)-length(replace(d,old_hash,'')))/length(old_hash)<>1 THEN
  RAISE EXCEPTION 'satellite_refund_advance_pin_not_unique';
 END IF;
 changed:=replace(d,old_hash,new_hash); EXECUTE changed;
 IF pg_get_functiondef(sig::regprocedure)<>changed THEN RAISE EXCEPTION 'satellite_refund_advance_postimage'; END IF;
 -- Preserve the entire source set; move only these three exact body pins.
 sig:='smarter_private.original_inventory_proof_sources_match()';
 d:=pg_get_functiondef(sig::regprocedure);
 FOR r IN SELECT * FROM satellite_refund_sources_before
  WHERE signature<>'smarter_private.original_inventory_proof_sources_match()' LOOP
  old_hash:=r.old_md5;new_hash:=md5(pg_get_functiondef(r.signature::regprocedure));
  IF old_hash=new_hash OR (length(d)-length(replace(d,old_hash,'')))/length(old_hash)<>1 THEN
   RAISE EXCEPTION 'satellite_refund_source_pin_not_unique: %',r.signature;
  END IF;
  d:=replace(d,old_hash,new_hash);
 END LOOP;
 EXECUTE d;
 IF pg_get_functiondef(sig::regprocedure)<>d OR smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'satellite_refund_complete_source_set_mismatch';
 END IF;
 FOR r IN SELECT * FROM satellite_refund_sources_before LOOP
  IF r.metadata IS DISTINCT FROM (SELECT jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'volatility',provolatile) FROM pg_proc WHERE oid=r.signature::regprocedure) THEN
   RAISE EXCEPTION 'satellite_refund_source_metadata_changed: %',r.signature;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p WHERE strpos(p.prosrc,r.old_md5)>0) THEN
   RAISE EXCEPTION 'satellite_refund_left_a_stale_pin: %',r.signature;
  END IF;
 END LOOP;
END $install$;
COMMIT;
