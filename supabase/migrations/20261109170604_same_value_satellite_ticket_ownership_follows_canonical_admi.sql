-- Same-value satellite tickets keep their immutable issue target, but may enter
-- another eligible matching-value event (owner October29 same_value_entry_v1).
-- The old proof confused provenance with admission, rejecting two original
-- registrations after their correctly sealed40-chip ticket redemptions.
-- Read the original canonical value-ticket issue assertion and the exact atomic
-- admission ledger/entitlement/transaction instead. No financial or history writes.
-- Strict direct seats and unmarked historical target-only tickets stay strict.
-- Source matcher pins both new direct dependencies and naturally advances the
-- existing generation; original retained proof generations are never restamped.
-- @live-proof: md5(pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure))='58b6c79c412a9e3b26104c0b4b6878d6' AND md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))='514b4ccef3c2fb883fcfe1c30d482df0'
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $install$
DECLARE old_reader text;old_matcher text;meta jsonb;
BEGIN
 IF md5(pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '3beddbfe1e3d204d1907b428d9358f08' OR (SELECT proowner FROM pg_proc WHERE oid='public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)<>'postgres'::regrole THEN RAISE EXCEPTION 'satellite_value_ticket_preimage_changed: %','public.fn_union_pnl_satellite_seat_owner(uuid,uuid)';END IF;
 IF md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure)) IS DISTINCT FROM 'bb3f5552448e42e7d55c470d49591049' OR (SELECT proowner FROM pg_proc WHERE oid='smarter_private.original_inventory_proof_sources_match()'::regprocedure)<>'postgres'::regrole THEN RAISE EXCEPTION 'satellite_value_ticket_preimage_changed: %','smarter_private.original_inventory_proof_sources_match()';END IF;
 IF md5(pg_get_functiondef('public.fn_ca_assert_satellite_value_ticket(uuid)'::regprocedure)) IS DISTINCT FROM 'c309132fdcfa88899920a2969a20cee9' OR (SELECT proowner FROM pg_proc WHERE oid='public.fn_ca_assert_satellite_value_ticket(uuid)'::regprocedure)<>'postgres'::regrole THEN RAISE EXCEPTION 'satellite_value_ticket_preimage_changed: %','public.fn_ca_assert_satellite_value_ticket(uuid)';END IF;
 IF md5(pg_get_functiondef('public.fn_poker_diamond_tournament(uuid)'::regprocedure)) IS DISTINCT FROM 'c91028508fecc2d02e9003f2bdc2e38d' OR (SELECT proowner FROM pg_proc WHERE oid='public.fn_poker_diamond_tournament(uuid)'::regprocedure)<>'postgres'::regrole THEN RAISE EXCEPTION 'satellite_value_ticket_preimage_changed: %','public.fn_poker_diamond_tournament(uuid)';END IF;
 IF md5(pg_get_functiondef('public.fn_tournament_entry_split(numeric,numeric,numeric,boolean)'::regprocedure)) IS DISTINCT FROM '89cc73d13fe8fbe6905233c8f9f74848' OR (SELECT proowner FROM pg_proc WHERE oid='public.fn_tournament_entry_split(numeric,numeric,numeric,boolean)'::regprocedure)<>'postgres'::regrole THEN RAISE EXCEPTION 'satellite_value_ticket_preimage_changed: %','public.fn_tournament_entry_split(numeric,numeric,numeric,boolean)';END IF;
 SELECT jsonb_agg(to_jsonb(p)-'prosrc'-'prosqlbody' ORDER BY p.oid) INTO meta FROM pg_proc p WHERE p.oid IN('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure,'smarter_private.original_inventory_proof_sources_match()'::regprocedure);
 old_reader:=pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure);
 old_matcher:=pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure);
 EXECUTE $reader$CREATE OR REPLACE FUNCTION public.fn_union_pnl_satellite_seat_owner(p_registration_id uuid, p_tournament_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH reg AS (
  SELECT e.after_row r FROM public.union_pnl_inventory_events e
  WHERE e.source_name='tournament_players' AND e.row_id=p_registration_id ORDER BY e.event_id LIMIT 1
 ), who AS (
  SELECT (r->>'user_id')::uuid user_id,(r->>'source_satellite_id')::uuid satellite_id,(r->>'registered_at')::timestamptz registered_at,
   (r->>'tournament_id')::uuid target_id,(r->>'club_id')::uuid admission_club_id
  FROM reg WHERE (p_tournament_id IS NULL OR r->>'tournament_id'=p_tournament_id::text)
   AND r->>'source_satellite_id' IS NOT NULL AND r->>'user_id' IS NOT NULL AND r->>'tournament_id' IS NOT NULL
 ), award AS (
  SELECT a.tournament_id,a.user_id FROM who w
  JOIN public.tournament_satellite_awards a ON a.tournament_id=w.satellite_id AND a.user_id=w.user_id
  JOIN public.tournament_satellite_settlements s ON s.tournament_id=a.tournament_id
  WHERE (a.delivery_kind='seat' AND a.registration_id=p_registration_id AND s.target_id=w.target_id)
   OR (a.delivery_kind='ticket' AND a.registration_id IS NULL AND EXISTS(
    SELECT 1 FROM public.tournament_tickets t
    WHERE t.id=a.ticket_id AND t.holder_id=w.user_id AND t.source_satellite_id=w.satellite_id
     AND t.status='redeemed' AND t.redemption_mode='tournament_entry_only' AND t.redeemed_at=w.registered_at
     AND CASE WHEN EXISTS(SELECT 1 FROM public.tournament_payouts p
       WHERE p.tournament_id=t.source_satellite_id AND p.source='satellite_ticket'
        AND p.metadata->>'ticket_id'=t.id::text AND p.metadata->>'ticket_contract'='same_value_entry_v1')
     THEN
      -- Original target remains issuance provenance. A value ticket is consumed
      -- by its one canonical atomic admission into the actual registration.
      public.fn_ca_assert_satellite_value_ticket(t.id)='chips'
      AND t.source_tournament_id=s.target_id
      AND EXISTS(SELECT 1 FROM public.tournaments target
       WHERE target.id=w.target_id AND w.admission_club_id=t.club_id
        AND (target.union_id IS NOT NULL OR target.club_id=t.club_id)
        AND public.fn_poker_diamond_tournament(target.id) IS FALSE
        AND round(COALESCE(target.buy_in_amount,0),2)+round(COALESCE(target.buy_in_fee,0),2)=t.value)
      AND (SELECT count(*) FROM public.tournament_refund_entitlements e
       JOIN public.chip_ledger l ON l.id=e.source_ledger_id
       JOIN public.tournaments target ON target.id=e.tournament_id
       CROSS JOIN LATERAL public.fn_tournament_entry_split(target.buy_in_amount,target.buy_in_fee,target.bounty_amount,
        COALESCE(target.is_bounty,false) OR COALESCE(target.is_pko,false) OR COALESCE(target.is_mystery_bounty,false)) split
       WHERE e.source_ticket_id=t.id AND e.tournament_id=w.target_id AND e.registration_id=p_registration_id
        AND e.user_id=w.user_id AND e.source_satellite_id=w.satellite_id
        AND e.entitlement_kind='tournament_ticket' AND e.charge_category='tournament_ticket'
        AND e.evidence_kind='atomic_tournament_ticket' AND e.escrow_bucket='ticket_gross'
        AND e.refund_wallet_club_id=t.club_id AND e.gross=t.value
        AND e.refund_prize>=0 AND e.refund_bounty>=0 AND e.refund_fee>=0
        AND e.refund_prize=split.prize AND e.refund_bounty=split.bounty AND e.refund_fee=split.rake AND split.charge=t.value
        AND round(e.refund_prize+e.refund_bounty+e.refund_fee,2)=t.value
        AND e.created_at=w.registered_at
        AND l.idempotency_key='ticket:'||t.id::text||':tournament:'||w.target_id::text||':entry'
        AND l.status='posted' AND l.row_hash IS NOT NULL AND l.category='ticket_redeem'
        AND l.from_type='escrow' AND l.from_entity_id=t.id
        AND l.to_type='prize_liability' AND l.to_entity_id=w.target_id
        AND l.tournament_id=w.target_id AND l.club_id=t.club_id AND l.amount=t.value
        AND l.created_at=w.registered_at
        AND l.metadata->>'kind'='tournament_entry_ticket_admission'
        AND l.metadata->>'ticket_id'=t.id::text AND l.metadata->>'user_id'=w.user_id::text
        AND l.metadata->>'registration_id'=p_registration_id::text
        AND l.metadata->>'source_tournament_id'=s.target_id::text
        AND l.metadata->>'source_satellite_id'=w.satellite_id::text
        AND (l.metadata->>'entry_prize')::numeric=e.refund_prize
        AND (l.metadata->>'entry_bounty')::numeric=e.refund_bounty
        AND (l.metadata->>'entry_fee')::numeric=e.refund_fee
        AND (SELECT count(*) FROM public.chip_transactions x
         WHERE x.transaction_type='tournament_ticket_entry' AND x.club_id=t.club_id
          AND x.from_user_id=w.user_id AND x.to_user_id IS NULL AND x.amount=t.value
          AND x.metadata->>'ticket_id'=t.id::text AND x.metadata->>'registration_id'=p_registration_id::text
          AND x.metadata->>'holder_id'=w.user_id::text
          AND x.metadata->>'target_tournament_id'=w.target_id::text
          AND x.metadata->>'entitlement_id'=e.id::text AND x.metadata->>'ledger_id'=l.id::text
          AND x.metadata->>'idempotency_key'=l.idempotency_key
          AND x.metadata->>'wallet_chips_credited'='0')=1)=1
     ELSE s.target_id=w.target_id AND t.source_tournament_id=w.target_id END))
 ), entry AS (
  SELECT count(*) n,count(DISTINCT r.funding_club_id) clubs,min(r.funding_club_id::text)::uuid club,
   count(*) FILTER(WHERE r.operation='entry') entries,
   count(*) FILTER(WHERE r.asset IS DISTINCT FROM 'chips' OR r.amount IS NULL OR r.amount<=0 OR r.funding_club_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM (SELECT row.* FROM public.chip_ledger row WHERE row.id=r.ledger_id OFFSET 0) l WHERE l.status='posted' AND l.from_type='player_wallet' AND l.from_entity_id=r.user_id
     AND l.to_type='prize_liability' AND l.to_entity_id=r.tournament_id AND l.tournament_id=r.tournament_id AND l.amount=r.amount
     AND l.club_id=r.funding_club_id AND l.category IN ('tournament_buyin','rebuy','addon') AND l.row_hash IS NOT NULL)) bad
  FROM award a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
 )
 SELECT CASE WHEN (SELECT count(*) FROM award)=1 AND e.n>0 AND e.entries>=1 AND e.clubs=1 AND e.bad=0 THEN e.club END FROM entry e
$function$
$reader$;
 EXECUTE $matcher$CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT count(*)=68 AND bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND md5(pg_get_functiondef(p.oid)) IS NOT DISTINCT FROM x.body_md5)
 FROM(VALUES ('public.fn_union_pnl_inventory_state(timestamptz,timestamptz)','d77f5ad055ee433875efed7fd53bd25a'),('public.fn_union_pnl_inventory_population(timestamptz,timestamptz)','449f6f13feefe0d7e26e767a3465bc67'),('public.fn_union_pnl_inventory_as_of(timestamptz)','85513ff85d2b37ad04b79f89e125f1aa'),('smarter_private.original_retirement_boundary_proof(jsonb,timestamptz,timestamptz)','56457798f46f7c06a32b0e52915740a0'),('smarter_private.original_paired_seat_restoration_proof(jsonb,jsonb,timestamptz,timestamptz)','ada80c7f667ca7dad36cf223c80c3a6a'),('smarter_private.original_closed_tournament_rails_proof(jsonb,timestamptz)','a9319182a566e9917353765c414a1aa1'),('smarter_private.original_closed_player_proof(jsonb,timestamptz,timestamptz)','a441c3abe887cc4528268e347916d236'),('smarter_private.original_continued_chair_proof(jsonb,timestamptz,timestamptz)','8876018a8370a99f4012696cb264c740'),('smarter_private.original_returned_cash_base_proof(jsonb,timestamptz,timestamptz)','7ed06b6ccded0d6eb2bc3357742e360d'),('smarter_private.original_erased_cash_base_proof(jsonb,timestamptz)','a2d5ac28a5f07929ed99d6e871dddfa2'),('smarter_private.original_inventory_source_ref_md5(jsonb)','81fba77f13564999931e8a7a47cbd609'),('smarter_private.original_inventory_finite_witness(bigint)','0ef0a8a5b9e85633cf4bf8b0cd15c8d7'),('smarter_private.original_inventory_finite_family_proof(text,jsonb,timestamptz,timestamptz)','dd7861e20f4c90567a704cb2625962b8'),('smarter_private.original_erased_cash_base_request(bigint,text)','1467e44cc7f7871b34eff07f7038019d'),('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)','58b6c79c412a9e3b26104c0b4b6878d6'),('public.fn_platform_frozen()','ec683805e052fceeae74789e82dce4cc'),('public.fn_active_maintenance_release_boundary()','05b537b57c9f51a5164e20a1cd0e67e0'),('smarter_private.original_inventory_case_insert_guard()','d9bcabf711efa4c81c0ae7567897b722'),('smarter_private.original_inventory_certificate_insert_guard()','d4956b2b4c0a58bb5dc57b35e3e884ce'),('smarter_private.original_inventory_restoration_immutable()','6c939d278f5fad857bd97437dfaa5f4d'),('smarter_private.certify_original_inventory_restoration(bigint,timestamptz)','f5db14badd4a6b07c0f4b82e2ec5cb1e'),('smarter_private.inventory_restoration_issue_accepted(jsonb,timestamptz)','fdba882b3557f6ffd1cc29129773ff04'),('public.fn_union_pnl_boundary(uuid,timestamptz)','5e4e878524a91518de209bc5e008db36'),('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)','b23655a15587192f137ae4ad57859742'),('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)','b36f9e252823addb55be086a26f3dedf'),('smarter_private.inventory_basis_cache_read(text,boolean,text,uuid,timestamptz,timestamptz)','058d499ade9d0609f83cc07d551b7f35'),('smarter_private.inventory_basis_cache_write(text,text,uuid,timestamptz,timestamptz,jsonb)','2c3f0af276c29f33d09cdb7ecd86df6a'),('smarter_private.original_inventory_basis_generation()','58dc20e1ba380ccb9b9dee8809731d33'),('public.fn_accounting_close_certificate(text,uuid,timestamptz,timestamptz)','7b4a5f4572a45db069b6058899614021'),('public.fn_accounting_close_problem(text,uuid,timestamptz,timestamptz)','9667c8b8c5aa74bf2ad2c57fbfa3991d'),('public.fn_accounting_close_certify(text,uuid,timestamptz,timestamptz,jsonb)','58501728a93f9f4534dbf26d26aba63f'),('public.fn_union_pnl_inventory_as_of_admitted(timestamptz)','d65a33c20fb224c1dc2cc1ecb8168940'),('smarter_private.original_erased_cash_base_expected_hash(bigint)','afe5941dd7c4bbcccbfadc5d65a4f447'),('smarter_private.original_erased_cash_base_discharge_receipt(bigint,text)','f2c22efcfd9231094732ca82edff9101'),('smarter_private.original_erased_cash_base_discharge_evidence_valid(bigint,text,jsonb)','d4bc8b8d57c9037805a735bc1bb2be21'),('smarter_private.original_erased_cash_base_discharge(bigint,text)','9e6fcbf606004b81353a7704b50f072f'),('smarter_private.original_erased_cash_receivables(uuid,timestamptz)','0c53bd1f7fd7d22117af340ee02769d6'),('smarter_private.original_erased_cash_discharge_returns(uuid,timestamptz,timestamptz)','2a41fe7ccedc2947cf3ab84cead2493c'),('smarter_private.original_restoration_cash_returns(uuid,timestamptz,timestamptz)','e7cecf308d34108e12c0006029c1a3fa'),('public.fn_union_week_start(timestamptz)','103f192a228084dad0e4268c36c82c4b'),('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','c4ea982db893a45aade32874bd7cd495'),('public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)','faf875701e49db1cf99b481119e87404'),('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)','4b5bc9cae04ce0f98ce56381b7dd524f'),('smarter_private.original_treasury_witness_immutable()','f6326523741592230d149799b876e886'),('smarter_private.original_treasury_gift_evidence(uuid)','df84a641f40ee44d9db83e979398f9af'),('smarter_private.admit_original_treasury_gift(uuid)','07c857f67488e000ecbaf63e083c1c05'),('smarter_private.original_treasury_return_evidence(uuid)','3f2b8626b018cc5d22d9ebe9e6d3fb72'),('smarter_private.admit_original_treasury_return(uuid)','c51b45b085ac1a26f043711804ff8d00'),('smarter_private.cash_initial_funding_receipt(uuid)','e111dad7c0f5d5e3b74710053835caa4'),('smarter_private.original_treasury_participant_gift(jsonb,uuid,timestamptz)','95b9a25f9a422bb7d8df115f86bc5993'),('smarter_private.original_treasury_cash_outcome_evidence(jsonb)','12c94769bbcd6eb2c3349728cdc8512d'),('public.fn_horse_seat_from_treasury(uuid,uuid,integer,numeric,uuid)','4a7cee2cfecdf7a36446c169f754ccd0'),('public.fn_cash_record_original_funding(text,text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid)','d01404c53405fd1826de26e58b04f4b1'),('public.fn_cash_original_funding_lineage(uuid,uuid,uuid,uuid,timestamptz,timestamptz,boolean)','8269577929892d8634e32dcfac08ff77'),('public.fn_pnl_cash_hand_evidence(uuid,bigint)','43820fe60b759bd93f6838f908122c96'),('public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)','1a5e66c29d3d36e41752589d59daa478'),('public.fn_cash_earning_club(uuid,uuid,uuid,uuid,uuid)','2ba3a2891019b46e06b46b4c642e566a'),('public.fn_ca_cash_seat_club(uuid,uuid)','148f2246fc0ee3ab11cd86456765e419'),('public.fn_union_pnl_week_hand_lines(uuid,timestamptz,timestamptz,boolean)','9dee2921c7b956281be61a3eb9d7df6e'),('smarter_private.weekly_hand_parts_read(uuid,timestamptz,timestamptz,text,boolean)','d427fd27d163ba72a7dc3cd50866163d'),('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)','a7c22cb171d6d6548707c6aa73fada6d'),('public.fn_claim_entry_purchase_receipt(text,text,jsonb)','4a10a4e1cfd2794046a6cb8ad1463de6'),('public.fn_horse_seat_from_treasury_before_maintenance_gate(uuid,uuid,integer,numeric,uuid)','ad64ff6223a433108f4f3625de1be3be'),('smarter_private.original_treasury_seat_money_core(uuid,uuid,integer,numeric,uuid)','d768afe805ed480569b44ef107d15675'),('public.fn_union_pnl_cash_outcome_accepted(public.union_pnl_cash_outcomes)','a7c0b003d24f5ae64cf440ce94d52d93'),('public.fn_ca_assert_satellite_value_ticket(uuid )','c309132fdcfa88899920a2969a20cee9'),('public.fn_poker_diamond_tournament(uuid )','c91028508fecc2d02e9003f2bdc2e38d'),('public.fn_tournament_entry_split(numeric,numeric,numeric,boolean )','89cc73d13fe8fbe6905233c8f9f74848'))x(signature,body_md5) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(x.signature);
$function$
$matcher$;
 IF md5(pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '58b6c79c412a9e3b26104c0b4b6878d6' OR md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure)) IS DISTINCT FROM '514b4ccef3c2fb883fcfe1c30d482df0' THEN RAISE EXCEPTION 'satellite_value_ticket_postimage_changed';END IF;
 IF meta IS DISTINCT FROM(SELECT jsonb_agg(to_jsonb(p)-'prosrc'-'prosqlbody' ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure,'smarter_private.original_inventory_proof_sources_match()'::regprocedure)) THEN RAISE EXCEPTION 'satellite_value_ticket_metadata_changed';END IF;
END $install$;
COMMIT;
