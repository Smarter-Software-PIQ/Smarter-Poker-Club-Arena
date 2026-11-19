-- A refused dealt manifest is named at its source, and the hands the
-- 2026-11-18 alias regression left uncertified carry their reason.
--
-- INCIDENT. 20261118164000 aliased a row source x inside
-- fn_cash_capture_hand_manifest, which already declares x. PL/pgSQL refused
-- every capture as ambiguous from 20:12:48 UTC until 20261118202500 installed
-- (first frozen chair row 21:04:56 UTC). Hands kept dealing and settling, all
-- chips and rake correct, but each was dealt without its original manifest.
-- The function raised, its transaction rolled back, and the refusal reached
-- nobody: 818 refusals in the first 7 minutes, found only by a lane verifying
-- an unrelated install.
--
-- (a) THE REFUSAL IS NAMED WHERE IT HAPPENS. The body is wrapped in an inner
-- block. The function's own refusals of a request (engine authority, invalid
-- request, stale lease, identity reused, invalid participant, tournament
-- table) and transient states the engine retries (classes 40, 53, 57, 08,
-- 55P03, 55006) raise exactly as before. Any other error is a defect in this
-- function: the inner block rolls back the call's partial writes, one critical
-- financial_alerts row is written per distinct (sqlstate, error) while it is
-- unresolved (fn_ca_financial_alert_to_incident raises it on the board), and
-- the call returns {"version":0,"refused":true,...}. The engine already treats
-- any receipt whose version is not 1 as a failed capture
-- (server/src/services/supabase/cashHandProvenance.ts) and deals the hand
-- unlinked, which is what a raise led to before, so no engine change is
-- needed. A defect is no longer retried three times per hand, because no
-- retry can fix it. The alert is resolved by the migration that fixes the
-- cause, as for every financial_alerts source: nothing watches it.
--
-- (b) THE REGRESSION WINDOW CARRIES ITS REASON. A dealt manifest is written
-- once, at the deal, and can never be added afterwards. So the hands this
-- regression cost stay uncertified, and
-- smarter_private.cash_hand_provenance_explained_gaps records why. A hand is
-- labelled only when ALL hold:
--   * its provenance receipt was accepted inside the window and is
--     'uncertified' with exactly ["original_dealt_manifest_missing"];
--   * it is not a Lightning (pooled) hand: those never capture a dealt
--     manifest by design and are certified by fn_lightning_original_pnl_proof
--     (matched both by hand_history_id and by host table and hand number);
--   * its table was capturing manifests in the 30 minutes before the window,
--     so the missing manifest is this regression's and not the long-standing
--     gap on tables that never capture one.
-- The rows are computed at install time. The table is immutable. No reader's
-- certification logic changes, Lightning's included.
--
-- Bodies: from 20261118202500 on main (merged bytes are installed bytes; the
-- applier sends a file verbatim). The new definition was produced by anchored
-- edits on that text, each asserted to match once, and its pin in
-- smarter_private.original_inventory_proof_sources_match() moves with it
-- (cf57bbe03d7c79a003f14915523fd857 -> 762527d29ffb4de1b4f6b375c61018f5, computed as md5 of the pg_get_functiondef
-- text, which reproduced the previous pin exactly).
--
-- @live-proof: md5(pg_get_functiondef('public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)'::regprocedure)) = '762527d29ffb4de1b4f6b375c61018f5' AND smarter_private.original_inventory_proof_sources_match() AND to_regclass('smarter_private.cash_hand_provenance_explained_gaps') IS NOT NULL

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

CREATE TABLE IF NOT EXISTS smarter_private.cash_hand_provenance_explained_gaps (
  table_id        uuid        NOT NULL,
  hand_number     bigint      NOT NULL,
  hand_id         uuid        NOT NULL,
  accepted_at     timestamptz NOT NULL,
  gap             text        NOT NULL,
  cause           text        NOT NULL,
  cause_migration text        NOT NULL,
  fix_migration   text        NOT NULL,
  labelled_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, hand_number)
);
COMMENT ON TABLE smarter_private.cash_hand_provenance_explained_gaps IS
  'Cash hands whose provenance receipt is uncertified for a known, explained platform cause. Immutable. One row per hand; written by the migration that names the cause.';
REVOKE ALL ON smarter_private.cash_hand_provenance_explained_gaps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON smarter_private.cash_hand_provenance_explained_gaps TO service_role;

DROP TRIGGER IF EXISTS cash_hand_provenance_explained_gaps_immutable ON smarter_private.cash_hand_provenance_explained_gaps;
CREATE TRIGGER cash_hand_provenance_explained_gaps_immutable
  BEFORE UPDATE OR DELETE ON smarter_private.cash_hand_provenance_explained_gaps
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_provenance_immutable();
DROP TRIGGER IF EXISTS cash_hand_provenance_explained_gaps_no_truncate ON smarter_private.cash_hand_provenance_explained_gaps;
CREATE TRIGGER cash_hand_provenance_explained_gaps_no_truncate
  BEFORE TRUNCATE ON smarter_private.cash_hand_provenance_explained_gaps
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cash_provenance_immutable();

INSERT INTO smarter_private.cash_hand_provenance_explained_gaps
  (table_id, hand_number, hand_id, accepted_at, gap, cause, cause_migration, fix_migration)
SELECT p.table_id, p.hand_number, p.hand_id, p.accepted_at,
       'original_dealt_manifest_missing',
       'manifest capture refused by migration 20261118164000 (ambiguous alias), fixed by 20261118202500',
       '20261118164000', '20261118202500'
  FROM public.cash_hand_provenance_receipts p
 WHERE p.accepted_at >= timestamptz '2026-11-18 20:12:48+00'
   AND p.accepted_at <  timestamptz '2026-11-18 21:04:57+00'
   AND p.status = 'uncertified'
   AND p.issues = '["original_dealt_manifest_missing"]'::jsonb
   AND NOT EXISTS (SELECT 1 FROM public.lightning_hand lh WHERE lh.hand_history_id = p.hand_id)
   AND NOT EXISTS (SELECT 1 FROM public.lightning_hand lh
                    WHERE lh.host_table_id = p.table_id AND lh.hand_number = p.hand_number)
   AND EXISTS (SELECT 1 FROM public.cash_hand_provenance_receipts q
                WHERE q.table_id = p.table_id
                  AND q.accepted_at >= timestamptz '2026-11-18 19:42:48+00'
                  AND q.accepted_at <  timestamptz '2026-11-18 20:12:48+00'
                  AND q.manifest_id IS NOT NULL)
ON CONFLICT (table_id, hand_number) DO NOTHING;

DO $gap_check$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM smarter_private.cash_hand_provenance_explained_gaps
   WHERE cause_migration = '20261118164000';
  IF n = 0 THEN
    RAISE EXCEPTION 'no hand in the 20261118164000 regression window was labelled; the window or its filters are wrong';
  END IF;
  RAISE NOTICE 'labelled % hands uncertified by the 20261118164000 regression', n;
END $gap_check$;

CREATE OR REPLACE FUNCTION public.fn_cash_capture_hand_manifest(p_table_id uuid, p_hand_number bigint, p_participants jsonb, p_instance_id text, p_lease_generation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t public.tables%ROWTYPE; h public.clubs%ROWTYPE; s public.table_seats%ROWTYPE;
 prior public.cash_hand_participant_manifests%ROWTYPE;
 x jsonb; v_users uuid[]:=ARRAY[]::uuid[]; v_occupancies uuid[]:=ARRAY[]::uuid[];
 v_roster jsonb:='[]'; v_request jsonb; v_scope jsonb; v_issues jsonb:='[]';
 v_lineage jsonb; v_funding jsonb; v_initial integer; v_accounts integer; v_id uuid; v_user uuid;
 v_seat uuid; v_occupancy uuid; v_join timestamptz; v_before numeric; v_complete boolean:=true; v_chairs jsonb:='[]';
 v_state text; v_msg text;
BEGIN
 BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501'; END IF;
 IF p_table_id IS NULL OR p_hand_number IS NULL OR p_hand_number<1000000
 OR jsonb_typeof(p_participants) IS DISTINCT FROM 'array' OR jsonb_array_length(p_participants)<2
 OR jsonb_array_length(p_participants)>10 OR p_instance_id IS NULL OR p_lease_generation IS NULL THEN
  RAISE EXCEPTION 'Invalid original cash manifest' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.engine_table_leases l WHERE l.table_id=p_table_id
  AND l.instance_id=p_instance_id AND l.lease_generation=p_lease_generation AND l.protocol_version=2
  AND l.heartbeat_at>=clock_timestamp()-make_interval(secs=>public.fn_engine_lease_stale_seconds()) FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original cash manifest lease stale' USING ERRCODE='55000'; END IF;
 SELECT jsonb_agg(value ORDER BY value->>'user_id') INTO v_request FROM jsonb_array_elements(p_participants);
 SELECT * INTO prior FROM public.cash_hand_participant_manifests WHERE table_id=p_table_id AND hand_number=p_hand_number;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM v_request OR prior.lease_instance_id IS DISTINCT FROM p_instance_id
   OR prior.lease_generation IS DISTINCT FROM p_lease_generation THEN
   RAISE EXCEPTION 'Original cash manifest identity reused' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('version',1,'manifest_id',prior.id,'funding_provenance_complete',prior.funding_provenance_complete,'issues',prior.issues);
 END IF;
 SELECT * INTO STRICT t FROM public.tables WHERE id=p_table_id FOR SHARE;
 IF t.tournament_id IS NOT NULL THEN RAISE EXCEPTION 'Tournament chips are not cash provenance' USING ERRCODE='22023'; END IF;
 SELECT * INTO h FROM public.clubs WHERE id=t.club_id;
 v_scope:=jsonb_build_object('host_club_id',t.club_id,'game_union_id',CASE WHEN t.is_private THEN NULL ELSE t.union_id END,
  'is_private',t.is_private,'tournament_id',t.tournament_id,'asset',h.asset,'unit_scale',2);
 IF h.id IS NULL OR h.asset IS DISTINCT FROM 'chips' OR t.is_private IS NULL
  OR (NOT t.is_private AND t.union_id IS NULL) THEN
  v_issues:=v_issues||'"game_asset_or_union_scope_unproven"'::jsonb; v_complete:=false; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(v_request) LOOP
  v_user:=(x->>'user_id')::uuid; v_seat:=(x->>'seat_id')::uuid;
  v_occupancy:=(x->>'occupancy_id')::uuid; v_join:=(x->>'seat_joined_at')::timestamptz;
  v_before:=(x->>'stack_before')::numeric;
  IF v_user IS NULL OR v_seat IS NULL OR v_occupancy IS NULL OR v_join IS NULL
   OR NOT isfinite(v_join) OR v_user=ANY(v_users) OR v_occupancy=ANY(v_occupancies)
   OR jsonb_typeof(x->'is_horse') IS DISTINCT FROM 'boolean' OR jsonb_typeof(x->'stack_before') IS DISTINCT FROM 'number'
   OR v_before IS NULL OR v_before<0 OR v_before<>round(v_before,2)
   OR v_before::text IN ('NaN','Infinity','-Infinity') THEN
   RAISE EXCEPTION 'Invalid or duplicate cash participant' USING ERRCODE='22023'; END IF;
  v_users:=array_append(v_users,v_user); v_occupancies:=array_append(v_occupancies,v_occupancy);
  SELECT * INTO s FROM public.table_seats WHERE id=v_seat AND table_id=p_table_id AND user_id=v_user
   AND occupancy_id=v_occupancy AND joined_at=v_join AND left_at IS NULL FOR SHARE;
  IF NOT FOUND OR s.stack IS DISTINCT FROM v_before THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','original_seat_or_starting_stack_unproven','user_id',v_user));
   v_complete:=false;
  END IF;
  -- The chair this player is dealt in, frozen with the hand (20261118).
  IF s.id=v_seat AND s.user_id=v_user AND s.occupancy_id=v_occupancy AND s.joined_at=v_join THEN
   v_chairs:=v_chairs||jsonb_build_array(jsonb_build_object('u',v_user,'s',v_seat,'o',v_occupancy,'j',v_join,'c',s.club_id));
  END IF;
  v_lineage:=public.fn_cash_original_funding_lineage(v_user,p_table_id,v_seat,v_occupancy,v_join,clock_timestamp(),false);
  v_funding:=v_lineage->'funding_receipts';
  SELECT count(*) FILTER(WHERE smarter_private.cash_initial_funding_receipt(f.id) IS TRUE),count(DISTINCT (f.funding_club_id,f.funding_union_id,f.asset))
   INTO v_initial,v_accounts FROM jsonb_array_elements(v_funding) ref
   JOIN public.cash_participant_funding_receipts f ON f.id=(ref->>'id')::uuid;
  IF v_lineage->'issues'<>'[]'::jsonb THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','original_cash_move_lineage_unproven','user_id',v_user,'details',v_lineage->'issues'));
   v_complete:=false;
  END IF;
  IF v_initial<>1 OR v_accounts<>1 THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason',CASE WHEN v_initial<>1 THEN 'original_admission_funding_missing' ELSE 'mixed_funding_account_ownership_unproven' END,'user_id',v_user));
   v_complete:=false;
  END IF;
  IF EXISTS(SELECT 1 FROM public.cash_participant_funding_receipts f
    LEFT JOIN public.cash_funding_application_receipts a ON a.funding_receipt_id=f.id
    WHERE f.id IN(SELECT (ref->>'id')::uuid FROM jsonb_array_elements(v_funding) ref) AND f.pending_addon_id IS NOT NULL
     AND (a.pending_addon_id IS NULL OR (a.applied>0 AND a.applied_occupancy_id IS DISTINCT FROM f.occupancy_id))) THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','pending_funding_application_unproven','user_id',v_user));
   v_complete:=false;
  END IF;
  v_roster:=v_roster||jsonb_build_array(jsonb_build_object('user_id',v_user,'seat_id',v_seat,
   'seat_joined_at',x->>'seat_joined_at','occupancy_id',v_occupancy,'stack_before',v_before,
   'is_horse',(x->>'is_horse')::boolean,'funding_receipts',v_funding,'funding_lineage',v_lineage));
 END LOOP;
 INSERT INTO public.cash_hand_participant_manifests(table_id,hand_number,lease_instance_id,lease_generation,
  request,game_scope,participants,issues,funding_provenance_complete)
 VALUES(p_table_id,p_hand_number,p_instance_id,p_lease_generation,v_request,v_scope,v_roster,v_issues,v_complete)
 RETURNING id INTO v_id;
 INSERT INTO smarter_private.cash_hand_chair_clubs(table_id,hand_number,user_id,seat_id,occupancy_id,seat_joined_at,club_id)
 SELECT p_table_id,p_hand_number,(chair->>'u')::uuid,(chair->>'s')::uuid,(chair->>'o')::uuid,(chair->>'j')::timestamptz,(chair->>'c')::uuid
   FROM jsonb_array_elements(v_chairs) AS chairs(chair)
 ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('version',1,'manifest_id',v_id,'funding_provenance_complete',v_complete,'issues',v_issues);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE, v_msg=MESSAGE_TEXT;
  -- This function's own refusals of a request, and transient states the
  -- engine retries (serialization, lock, timeout, resources, connection),
  -- raise exactly as before.
  IF v_msg IN ('Engine authority required','Invalid original cash manifest',
               'Original cash manifest lease stale','Original cash manifest identity reused',
               'Invalid or duplicate cash participant','Tournament chips are not cash provenance')
     OR left(v_state,2) IN ('40','53','57','08') OR v_state IN ('55P03','55006') THEN
   RAISE;
  END IF;
  -- Anything else is a defect in this function: name it at its source, once
  -- per distinct error while unresolved. The inner block has already rolled
  -- back this call's partial writes; the alert commits with the call.
  PERFORM pg_advisory_xact_lock(hashtext('fn_cash_capture_hand_manifest:refused'));
  IF NOT EXISTS(SELECT 1 FROM public.financial_alerts fa
                 WHERE fa.source='fn_cash_capture_hand_manifest' AND NOT fa.resolved
                   AND fa.context->>'sqlstate'=v_state AND fa.context->>'error'=v_msg) THEN
   INSERT INTO public.financial_alerts(severity,source,message,context)
   VALUES('critical','fn_cash_capture_hand_manifest',
     'The dealt manifest capture refused a cash hand ('||v_state||': '||left(v_msg,300)||'). Cash hands are dealt without their original manifest, so their union P&L provenance is uncertified until the function is fixed in code.',
     jsonb_build_object('sqlstate',v_state,'error',v_msg,'table_id',p_table_id,'hand_number',p_hand_number,'first_seen',clock_timestamp()));
  END IF;
  RETURN jsonb_build_object('version',0,'refused',true,'sqlstate',v_state,'error',v_msg);
 END;
END $function$;
REVOKE ALL ON FUNCTION public.fn_cash_capture_hand_manifest(uuid, bigint, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_capture_hand_manifest(uuid, bigint, jsonb, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT count(*)=69 AND bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND md5(pg_get_functiondef(p.oid)) IS NOT DISTINCT FROM x.body_md5)
 FROM(VALUES ('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)','b171ac61a57a9ce56c46a6529676c604'),('public.fn_union_pnl_inventory_state(timestamptz,timestamptz)','d77f5ad055ee433875efed7fd53bd25a'),('public.fn_union_pnl_inventory_population(timestamptz,timestamptz)','449f6f13feefe0d7e26e767a3465bc67'),('public.fn_union_pnl_inventory_as_of(timestamptz)','85513ff85d2b37ad04b79f89e125f1aa'),('smarter_private.original_retirement_boundary_proof(jsonb,timestamptz,timestamptz)','56457798f46f7c06a32b0e52915740a0'),('smarter_private.original_paired_seat_restoration_proof(jsonb,jsonb,timestamptz,timestamptz)','ada80c7f667ca7dad36cf223c80c3a6a'),('smarter_private.original_closed_tournament_rails_proof(jsonb,timestamptz)','a9319182a566e9917353765c414a1aa1'),('smarter_private.original_closed_player_proof(jsonb,timestamptz,timestamptz)','a441c3abe887cc4528268e347916d236'),('smarter_private.original_continued_chair_proof(jsonb,timestamptz,timestamptz)','8876018a8370a99f4012696cb264c740'),('smarter_private.original_returned_cash_base_proof(jsonb,timestamptz,timestamptz)','7ed06b6ccded0d6eb2bc3357742e360d'),('smarter_private.original_erased_cash_base_proof(jsonb,timestamptz)','a2d5ac28a5f07929ed99d6e871dddfa2'),('smarter_private.original_inventory_source_ref_md5(jsonb)','81fba77f13564999931e8a7a47cbd609'),('smarter_private.original_inventory_finite_witness(bigint)','0ef0a8a5b9e85633cf4bf8b0cd15c8d7'),('smarter_private.original_inventory_finite_family_proof(text,jsonb,timestamptz,timestamptz)','dd7861e20f4c90567a704cb2625962b8'),('smarter_private.original_erased_cash_base_request(bigint,text)','1467e44cc7f7871b34eff07f7038019d'),('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)','be9c6099623bde0cb2da8dba771d5f6a'),('public.fn_platform_frozen()','ec683805e052fceeae74789e82dce4cc'),('public.fn_active_maintenance_release_boundary()','05b537b57c9f51a5164e20a1cd0e67e0'),('smarter_private.original_inventory_case_insert_guard()','d9bcabf711efa4c81c0ae7567897b722'),('smarter_private.original_inventory_certificate_insert_guard()','d4956b2b4c0a58bb5dc57b35e3e884ce'),('smarter_private.original_inventory_restoration_immutable()','6c939d278f5fad857bd97437dfaa5f4d'),('smarter_private.certify_original_inventory_restoration(bigint,timestamptz)','f5db14badd4a6b07c0f4b82e2ec5cb1e'),('smarter_private.inventory_restoration_issue_accepted(jsonb,timestamptz)','fdba882b3557f6ffd1cc29129773ff04'),('public.fn_union_pnl_boundary(uuid,timestamptz)','62c86dc034062e55790618be187d3eb4'),('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)','2076a899ef8457c82c315f170ad1af7c'),('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)','26cb0f6e4912cd3e8980f657bb52d50c'),('smarter_private.inventory_basis_cache_read(text,boolean,text,uuid,timestamptz,timestamptz)','058d499ade9d0609f83cc07d551b7f35'),('smarter_private.inventory_basis_cache_write(text,text,uuid,timestamptz,timestamptz,jsonb)','2c3f0af276c29f33d09cdb7ecd86df6a'),('smarter_private.original_inventory_basis_generation()','58dc20e1ba380ccb9b9dee8809731d33'),('public.fn_accounting_close_certificate(text,uuid,timestamptz,timestamptz)','7b4a5f4572a45db069b6058899614021'),('public.fn_accounting_close_problem(text,uuid,timestamptz,timestamptz)','9667c8b8c5aa74bf2ad2c57fbfa3991d'),('public.fn_accounting_close_certify(text,uuid,timestamptz,timestamptz,jsonb)','58501728a93f9f4534dbf26d26aba63f'),('public.fn_union_pnl_inventory_as_of_admitted(timestamptz)','d65a33c20fb224c1dc2cc1ecb8168940'),('smarter_private.original_erased_cash_base_expected_hash(bigint)','afe5941dd7c4bbcccbfadc5d65a4f447'),('smarter_private.original_erased_cash_base_discharge_receipt(bigint,text)','f2c22efcfd9231094732ca82edff9101'),('smarter_private.original_erased_cash_base_discharge_evidence_valid(bigint,text,jsonb)','d4bc8b8d57c9037805a735bc1bb2be21'),('smarter_private.original_erased_cash_base_discharge(bigint,text)','f104a8a1b56061b7c638eeee04f253a2'),('smarter_private.original_erased_cash_receivables(uuid,timestamptz)','0c53bd1f7fd7d22117af340ee02769d6'),('smarter_private.original_erased_cash_discharge_returns(uuid,timestamptz,timestamptz)','2a41fe7ccedc2947cf3ab84cead2493c'),('smarter_private.original_restoration_cash_returns(uuid,timestamptz,timestamptz)','e7cecf308d34108e12c0006029c1a3fa'),('public.fn_union_week_start(timestamptz)','103f192a228084dad0e4268c36c82c4b'),('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','1d528589d67bd7d20885db648f5b929b'),('public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)','67a6f6b5eb143e96c43f8de870b374f6'),('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)','ba8d54bcf62c86357be6437421d1d45d'),('smarter_private.original_treasury_witness_immutable()','f6326523741592230d149799b876e886'),('smarter_private.original_treasury_gift_evidence(uuid)','df84a641f40ee44d9db83e979398f9af'),('smarter_private.admit_original_treasury_gift(uuid)','07c857f67488e000ecbaf63e083c1c05'),('smarter_private.original_treasury_return_evidence(uuid)','3f2b8626b018cc5d22d9ebe9e6d3fb72'),('smarter_private.admit_original_treasury_return(uuid)','c51b45b085ac1a26f043711804ff8d00'),('smarter_private.cash_initial_funding_receipt(uuid)','e111dad7c0f5d5e3b74710053835caa4'),('smarter_private.original_treasury_participant_gift(jsonb,uuid,timestamptz)','95b9a25f9a422bb7d8df115f86bc5993'),('smarter_private.original_treasury_cash_outcome_evidence(jsonb)','12c94769bbcd6eb2c3349728cdc8512d'),('public.fn_horse_seat_from_treasury(uuid,uuid,integer,numeric,uuid)','4a7cee2cfecdf7a36446c169f754ccd0'),('public.fn_cash_record_original_funding(text,text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid)','6d6075585c4b97d42a33d2759a858c1d'),('public.fn_cash_original_funding_lineage(uuid,uuid,uuid,uuid,timestamptz,timestamptz,boolean)','8269577929892d8634e32dcfac08ff77'),('public.fn_pnl_cash_hand_evidence(uuid,bigint)','43820fe60b759bd93f6838f908122c96'),('public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)','762527d29ffb4de1b4f6b375c61018f5'),('public.fn_cash_earning_club(uuid,uuid,uuid,uuid,uuid)','ed4a2a6db8fe3a14dcd1ec96f23269e3'),('public.fn_ca_cash_seat_club(uuid,uuid)','148f2246fc0ee3ab11cd86456765e419'),('public.fn_union_pnl_week_hand_lines(uuid,timestamptz,timestamptz,boolean)','9dee2921c7b956281be61a3eb9d7df6e'),('smarter_private.weekly_hand_parts_read(uuid,timestamptz,timestamptz,text,boolean)','d427fd27d163ba72a7dc3cd50866163d'),('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)','a101812df22c1dfb379ebc325bd7d6d0'),('public.fn_claim_entry_purchase_receipt(text,text,jsonb)','4a10a4e1cfd2794046a6cb8ad1463de6'),('public.fn_horse_seat_from_treasury_before_maintenance_gate(uuid,uuid,integer,numeric,uuid)','ad64ff6223a433108f4f3625de1be3be'),('smarter_private.original_treasury_seat_money_core(uuid,uuid,integer,numeric,uuid)','d768afe805ed480569b44ef107d15675'),('public.fn_union_pnl_cash_outcome_accepted(public.union_pnl_cash_outcomes)','a7c0b003d24f5ae64cf440ce94d52d93'),('public.fn_ca_assert_satellite_value_ticket(uuid )','c309132fdcfa88899920a2969a20cee9'),('public.fn_poker_diamond_tournament(uuid )','c91028508fecc2d02e9003f2bdc2e38d'),('public.fn_tournament_entry_split(numeric,numeric,numeric,boolean )','89cc73d13fe8fbe6905233c8f9f74848'))x(signature,body_md5) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(x.signature);
$function$;
REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC, anon, authenticated;

COMMIT;
