-- Reserved through the maintained allocator. Original Oct26-Nov2 Lightning
-- link proofs retained Union-session ownership even though the Nov1 canonical
-- proof correctly follows the player's original funding occupancy. This reader
-- overlays ONLY that proven ownership, never changing original proof/delta/rake,
-- ledger, payout or balance bytes. Original receipt-time union attribution
-- avoids rewriting history from current membership. Ambiguous funding retains
-- the original Nov1 session fallback, so unresolved accounting still refuses.
-- Exact qualified reader/dependent hashes advance the original generation;
-- derived books requalify naturally, without retagging old financial witnesses.
-- @live-proof: md5(pg_get_functiondef('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)'::regprocedure))='b171ac61a57a9ce56c46a6529676c604' AND md5(pg_get_functiondef('fn_union_pnl_linked_cash_outcomes(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))='21241121f4e4fe29a7becb1ff692d722' AND md5(pg_get_functiondef('smarter_private.weekly_hand_parts_witness(uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure))='a101812df22c1dfb379ebc325bd7d6d0' AND md5(pg_get_functiondef('fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))='80f29ec1270de41106ee6302153a7cfe' AND md5(pg_get_functiondef('fn_accounting_union_earned_plan_advance(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))='911c6c96b4dfe66bff7bdcfb00eb94d2' AND md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))='866cccb1eb119003fb3fd21bb517a3f3' AND smarter_private.original_inventory_proof_sources_match()
BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='1s';SET LOCAL search_path=pg_catalog,public,smarter_private;
DO $pre$DECLARE p pg_proc%ROWTYPE;g text;BEGIN IF current_user<>'postgres'OR session_user<>'postgres'OR NULLIF(current_setting('request.jwt.claims',true),'')IS NOT NULL OR public.fn_platform_frozen()IS DISTINCT FROM false THEN RAISE EXCEPTION 'LIGHTNING_OWNER_OPERATOR_OR_FREEZE_REFUSED';END IF;IF md5(pg_get_functiondef('fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))IS DISTINCT FROM 'b36f9e252823addb55be086a26f3dedf'THEN RAISE EXCEPTION 'LIGHTNING_OWNER_PREIMAGE_CHANGED:%','fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)';END IF;IF md5(pg_get_functiondef('fn_union_pnl_linked_cash_outcomes(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))IS DISTINCT FROM '798e8c95a26ad587da13151675f47fd1'THEN RAISE EXCEPTION 'LIGHTNING_OWNER_PREIMAGE_CHANGED:%','fn_union_pnl_linked_cash_outcomes(uuid,timestamp with time zone,timestamp with time zone)';END IF;IF md5(pg_get_functiondef('fn_accounting_union_earned_plan_advance(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))IS DISTINCT FROM '4b5bc9cae04ce0f98ce56381b7dd524f'THEN RAISE EXCEPTION 'LIGHTNING_OWNER_PREIMAGE_CHANGED:%','fn_accounting_union_earned_plan_advance(uuid,timestamp with time zone,timestamp with time zone)';END IF;IF md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))IS DISTINCT FROM '514b4ccef3c2fb883fcfe1c30d482df0'THEN RAISE EXCEPTION 'LIGHTNING_OWNER_PREIMAGE_CHANGED:%','smarter_private.original_inventory_proof_sources_match()';END IF;IF md5(pg_get_functiondef('smarter_private.weekly_hand_parts_witness(uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure))IS DISTINCT FROM 'a7c22cb171d6d6548707c6aa73fada6d'THEN RAISE EXCEPTION 'LIGHTNING_OWNER_PREIMAGE_CHANGED:%','smarter_private.weekly_hand_parts_witness(uuid,timestamp with time zone,timestamp with time zone,boolean)';END IF;g:=smarter_private.original_inventory_basis_generation();IF smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true OR g IS NULL OR g='original-inventory-245:unqualified'THEN RAISE EXCEPTION 'LIGHTNING_OWNER_ORIGINAL_SOURCES_REQUIRED';END IF;PERFORM set_config('app.original_lightning_owner_pre_generation',g,true);IF to_regprocedure('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)')IS NOT NULL THEN RAISE EXCEPTION 'LIGHTNING_OWNER_HELPER_ALREADY_EXISTS';END IF;END$pre$;
CREATE OR REPLACE FUNCTION smarter_private.original_lightning_funding_owner_evidence(p_table uuid,p_number bigint,p_scope jsonb,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO pg_catalog,public,smarter_private SET TimeZone TO 'UTC' SET enable_nestloop TO 'on'
AS $function$
DECLARE started timestamptz; lightning_id uuid; person jsonb; custody record;
 occupancy uuid; funding uuid; funding_count bigint; original_union boolean;
 result_people jsonb:='[]'::jsonb; game_union uuid;
BEGIN
 game_union:=(p_scope->>'game_union_id')::uuid;
 -- Already-correct owners and other original custody shapes retain exact bytes.
 IF game_union IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(p_evidence->'participants')q
  WHERE q->>'ownership_scope'='original_lightning_pool_session'AND q->>'earning_club_id'=game_union::text)
 THEN RETURN p_evidence;END IF;
 SELECT h.hand_id,hh.started_at INTO STRICT lightning_id,started
 FROM public.lightning_hand h JOIN public.hand_history hh ON hh.id=h.hand_history_id
 WHERE h.host_table_id=p_table AND h.hand_number=p_number AND hh.table_id=p_table AND hh.hand_number=p_number
  AND hh.id::text=p_evidence->>'hand_id';
 IF started IS NULL OR NOT isfinite(started) OR p_evidence->>'table_id'IS DISTINCT FROM p_table::text
  OR p_evidence->>'hand_number'IS DISTINCT FROM p_number::text OR p_evidence->'game_scope'IS DISTINCT FROM p_scope
  OR p_evidence->>'status'IS DISTINCT FROM 'ready'OR p_evidence->'basis_certified'IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'original_lightning_funding_owner_identity_changed';END IF;
 FOR person IN SELECT value FROM jsonb_array_elements(p_evidence->'participants')LOOP
  IF person->>'ownership_scope'='original_lightning_pool_session'AND person->>'earning_club_id'=game_union::text THEN
   SELECT hp.net_result,cs.id cash_session,cs.club_id,cs.table_id,cs.opened_at,cs.closed_at,ps.anchor_seat_id,
    ps.entered_at,ps.exited_at,sl.opened_at slot_opened,sl.closed_at slot_closed
   INTO STRICT custody FROM public.lightning_hand_player hp
   JOIN public.lightning_pool_slot sl ON sl.id=hp.pool_slot_id AND sl.player_id=hp.player_id
    AND sl.id=(person->>'pool_slot_id')::uuid
   JOIN public.lightning_pool_session ps ON ps.id=sl.pool_session_id AND ps.player_id=hp.player_id
    AND ps.id=(person->>'pool_session_id')::uuid AND ps.cluster_id=sl.cluster_id AND ps.cluster_epoch=sl.cluster_epoch
   JOIN public.cash_player_session cs ON cs.id=ps.cash_player_session_id AND cs.player_id=hp.player_id
   WHERE hp.hand_id=lightning_id AND hp.player_id=(person->>'user_id')::uuid
    AND hp.cluster_id=sl.cluster_id AND hp.cluster_epoch=sl.cluster_epoch;
   IF person->'original_funding_session_ids'IS DISTINCT FROM jsonb_build_array(custody.cash_session)
    OR person->'ownership_certified'IS DISTINCT FROM 'true'::jsonb OR custody.club_id IS DISTINCT FROM game_union
    OR (person->>'observed_stack_delta')::numeric IS DISTINCT FROM custody.net_result
    OR custody.opened_at IS NULL OR NOT isfinite(custody.opened_at)OR custody.opened_at>started
    OR(custody.closed_at IS NOT NULL AND(NOT isfinite(custody.closed_at)OR custody.closed_at<=started))
    OR custody.entered_at IS NULL OR NOT isfinite(custody.entered_at)OR custody.entered_at>started
    OR(custody.exited_at IS NOT NULL AND(NOT isfinite(custody.exited_at)OR custody.exited_at<=started))
    OR custody.slot_opened IS NULL OR NOT isfinite(custody.slot_opened)OR custody.slot_opened>started
    OR(custody.slot_closed IS NOT NULL AND(NOT isfinite(custody.slot_closed)OR custody.slot_closed<=started))
   THEN RAISE EXCEPTION 'original_lightning_funding_owner_custody_changed';END IF;
   occupancy:=NULL;funding:=NULL;funding_count:=NULL;
   -- Same original Nov1 anchor-first rule, then the carried-stack fallback.
   SELECT r.occupancy_id INTO occupancy FROM public.cash_participant_funding_receipts r
   WHERE r.table_id=custody.table_id AND r.account_entity_id=(person->>'user_id')::uuid
    AND r.operation_kind='buyin'AND r.user_id=(person->>'user_id')::uuid
    AND r.seat_id=custody.anchor_seat_id AND r.recorded_at<=started
   ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1;
   IF occupancy IS NULL THEN
    SELECT r.occupancy_id INTO occupancy FROM public.cash_participant_funding_receipts r
    WHERE r.user_id=(person->>'user_id')::uuid AND r.account_entity_id=(person->>'user_id')::uuid
     AND r.operation_kind='buyin'AND r.recorded_at<=started
    ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1;
   END IF;
   IF occupancy IS NOT NULL THEN
    SELECT count(DISTINCT r.funding_club_id),min(r.funding_club_id::text)::uuid,
     bool_and(r.funding_union_id IS NOT DISTINCT FROM game_union AND r.asset IS NOT DISTINCT FROM 'chips'AND r.user_id IS NOT DISTINCT FROM (person->>'user_id')::uuid)
    INTO funding_count,funding,original_union FROM public.cash_participant_funding_receipts r
    WHERE r.occupancy_id=occupancy AND r.recorded_at<=started AND r.funding_club_id IS NOT NULL;
    -- Receipt-time union attribution is immutable; current membership cannot
    -- rewrite a closed week's original funding ownership.
    IF funding_count=1 AND funding IS DISTINCT FROM custody.club_id AND original_union IS TRUE THEN
     person:=jsonb_set(person,'{earning_club_id}',to_jsonb(funding));
    END IF;
   END IF;
  END IF;
  result_people:=result_people||jsonb_build_array(person);
 END LOOP;
 RETURN jsonb_set(p_evidence,'{participants}',result_people);
END $function$;
REVOKE ALL ON FUNCTION smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.fn_union_pnl_linked_cash_outcomes(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(table_id uuid, hand_number bigint, game_scope jsonb, evidence jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET enable_nestloop TO 'off'
AS $function$ BEGIN IF md5(pg_get_functiondef('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)'::regprocedure))IS DISTINCT FROM 'b171ac61a57a9ce56c46a6529676c604'THEN RAISE EXCEPTION 'original_lightning_funding_owner_reader_changed';END IF; PERFORM 1 FROM public.union_pnl_cash_outcome_link_resolutions LIMIT 0; IF NOT EXISTS(SELECT FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.union_pnl_cash_outcome_link_resolutions'::regclass AND c.conname='union_pnl_cash_outcome_link_resolutions_check' AND c.contype='c' AND c.convalidated AND pg_catalog.pg_get_constraintdef(c.oid)='CHECK ((proof_md5 = md5((proof)::text)))') OR (SELECT count(*)FROM pg_catalog.pg_attribute WHERE attrelid='public.union_pnl_cash_outcome_link_resolutions'::regclass AND attname IN('proof','proof_md5')AND attnotnull AND NOT attisdropped)<>2 THEN RAISE EXCEPTION 'linked_proof_contract_changed';END IF; RETURN QUERY EXECUTE $query$
 SELECT r.table_id,r.hand_number,r.game_scope,CASE WHEN r.roster_source='lightning_pool' THEN smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,r.evidence) ELSE r.evidence END
 FROM public.union_pnl_cash_outcome_link_resolutions r
 JOIN public.union_pnl_cash_outcomes o ON o.table_id=r.table_id AND o.hand_number=r.hand_number
 WHERE r.game_scope->>'game_union_id'=$1::text AND o.recognized_at>=$2 AND o.recognized_at<$3
  AND r.hand_id=o.hand_id AND r.outcome_payload_hash=o.payload_hash AND r.outcome_evidence_md5=md5(o.evidence::text)
  
$query$ USING p_union_id,p_start,p_end;END $function$
;

CREATE OR REPLACE FUNCTION smarter_private.weekly_hand_parts_witness(p_union uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_projected boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE n bigint;
BEGIN
 IF current_setting('session_replication_role') IS DISTINCT FROM 'origin'
 OR smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true THEN RAISE EXCEPTION 'weekly_hand_parts_original_sources_unqualified';END IF;
 SELECT count(*) INTO n FROM (VALUES ('public.fn_union_pnl_projection_ready(text)','5f643c03d3595c20354d753087988476'),('public.fn_union_pnl_week_hand_lines(uuid,timestamp with time zone,timestamp with time zone,boolean)','9dee2921c7b956281be61a3eb9d7df6e'),('public.fn_accounting_close_windows(timestamp with time zone,timestamp with time zone)','349f940293dfe6175faae2787840ede1'),('public.fn_union_pnl_posthand_escrow_participants(union_pnl_cash_outcomes)','2db7263f8d42e2e0e5a45b42b7198e4d'),('public.fn_union_pnl_posthand_escrow_touch(union_pnl_cash_outcome_touches)','e51decda42bbe46dd90aaf1bd3119023'),('public.fn_accounting_close_proof_lifetime()','80e026be0041fd1bdb04114c87ec368c'),('public.fn_union_pnl_linked_cash_outcomes(uuid,timestamptz,timestamptz)','21241121f4e4fe29a7becb1ff692d722'),('public.fn_union_pnl_inventory_immutable()','307d83a1ee3d912bade24c48144aa801'),('smarter_private.posthand_escrow_certificate_immutable()','14b1ddb37d4e3e83a9a42a34438e4b6e'))x(signature,hash) JOIN pg_proc p ON p.oid=to_regprocedure(x.signature)
 WHERE p.proowner='postgres'::regrole AND md5(pg_get_functiondef(p.oid))=x.hash;
 IF n IS DISTINCT FROM 9::bigint THEN RAISE EXCEPTION 'weekly_hand_parts_original_owners_changed';END IF;
 SELECT count(*) INTO n FROM(VALUES ('public.union_pnl_cash_outcomes','original_pnl_immutable',58,'public.fn_union_pnl_inventory_immutable()'),('public.union_pnl_cash_outcome_touches','original_pnl_immutable',58,'public.fn_union_pnl_inventory_immutable()'),('public.union_pnl_cash_outcome_link_resolutions','original_pnl_immutable',58,'public.fn_union_pnl_inventory_immutable()'),('smarter_private.posthand_escrow_certificates','posthand_escrow_certificate_immutable',31,'smarter_private.posthand_escrow_certificate_immutable()'),('smarter_private.posthand_escrow_certificates','posthand_escrow_certificate_no_truncate',34,'smarter_private.posthand_escrow_certificate_immutable()'))x(rel,name,kind,fn) JOIN pg_trigger t ON t.tgrelid=to_regclass(x.rel) AND t.tgname=x.name
 WHERE NOT t.tgisinternal AND t.tgenabled IN('O','A') AND t.tgtype=x.kind AND t.tgfoid=to_regprocedure(x.fn) AND t.tgqual IS NULL AND t.tgnargs=0;
 IF n IS DISTINCT FROM 5::bigint THEN RAISE EXCEPTION 'weekly_hand_parts_append_only_contract_changed';END IF;
 IF p_projected IS DISTINCT FROM public.fn_union_pnl_projection_ready('cash_outcome_touches') THEN RAISE EXCEPTION 'weekly_hand_parts_projection_changed';END IF;
 RETURN jsonb_build_object('ordinary_count',CASE WHEN p_projected THEN
 (SELECT count(*) FROM public.union_pnl_cash_outcome_touches h WHERE h.game_union_id=p_union::text AND h.recognized_at>=p_start AND h.recognized_at<p_end)
 ELSE (SELECT count(*) FROM public.union_pnl_cash_outcomes h WHERE h.game_scope->>'game_union_id'=p_union::text AND h.recognized_at>=p_start AND h.recognized_at<p_end) END,
 -- Link ownership comes from the immutable resolution, while recognition comes
 -- from the original outcome, exactly as the original linked reader requires.
 'links',(SELECT count(*) FROM public.union_pnl_cash_outcome_link_resolutions r
 JOIN public.union_pnl_cash_outcomes o ON o.table_id=r.table_id AND o.hand_number=r.hand_number
 WHERE r.game_scope->>'game_union_id'=p_union::text AND o.recognized_at>=p_start AND o.recognized_at<p_end),
 -- Only certificates consulted by the ordinary reader can change this window.
 -- Linked outcomes carry their original resolved evidence and do not read these.
 'escrow_certificates',CASE WHEN p_projected THEN
 (SELECT count(*) FROM public.union_pnl_cash_outcome_touches h
 JOIN smarter_private.posthand_escrow_certificates c ON c.table_id=h.table_id AND c.hand_number=h.hand_number
 WHERE h.game_union_id=p_union::text AND h.recognized_at>=p_start AND h.recognized_at<p_end)
 ELSE(SELECT count(*) FROM public.union_pnl_cash_outcomes h
 JOIN smarter_private.posthand_escrow_certificates c ON c.table_id=h.table_id AND c.hand_number=h.hand_number
 WHERE h.game_scope->>'game_union_id'=p_union::text AND h.recognized_at>=p_start AND h.recognized_at<p_end)END);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_union_pnl_evidence_report(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_open jsonb; v_close jsonb; v_issues jsonb:='[]'; v_clubs jsonb; v_eco jsonb; v_terms jsonb;
 v_fence timestamptz; v_bad bigint; v_hands bigint; v_resolved bigint:=0; v_rows bigint; v_cash_reconciled boolean; v_terms_value jsonb; v_cash_rake numeric; v_accepted_rake numeric;
 v_memo_key text; v_memo jsonb; v_report jsonb; v_flows jsonb; v_open_resolved uuid[];
 v_inv boolean; v_cash boolean; v_credit boolean;
 v_cert jsonb; v_generation text;v_hand_parts jsonb;
 v_l_value jsonb;v_l_key jsonb;v_l_witness jsonb;v_l_counts jsonb;
 v_l_valid boolean;v_l_name text;v_l_number numeric;
 v_hand_projected boolean;v_l_snapshot jsonb;v_l_entry jsonb;v_l_complete boolean;
 v_l_checked_at timestamptz;v_l_rows numeric;v_l_bad numeric;v_l_resolved numeric;v_l_unknown numeric;
BEGIN
 IF p_union_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
  OR p_start<>public.fn_union_week_start(p_start) OR p_end<>public.fn_union_week_start(p_start+interval '8 days')
  OR p_end>clock_timestamp() THEN RAISE EXCEPTION 'invalid_closed_pnl_evidence_period' USING ERRCODE='22023'; END IF;
 SELECT captured_at INTO v_fence FROM public.union_pnl_weekly_capture WHERE singleton;
 IF v_fence IS NULL OR p_start<=v_fence THEN
  RETURN jsonb_build_object('report_version',1,'status','blocked','basis_certified',false,'payment_authorized',false,
   'issues',jsonb_build_array('week_precedes_complete_original_capture'),'capture_started_at',v_fence,'all_players_included',false);
 END IF;
 IF p_union_id='fade0000-0000-0000-0000-000000000001'::uuid AND p_end>='2026-10-12 07:00:00Z'::timestamptz THEN
  v_generation:=COALESCE(smarter_private.original_inventory_basis_generation(),'original-inventory-245:unqualified');
 END IF;
 -- UNION P&L EVIDENCE MEMO (20260928): one weekly close reaches this report
 -- through preparation (close quality), the cascade (qualified clubs, ECO,
 -- player P&L) and the invoices. Inside a union close attempt
 -- (app.accounting_close_memo='on', set only by fn_weekly_accounting_attempt_begin)
 -- the first complete report of this (union, week) is kept for the rest of
 -- the attempt; attempt_begin and attempt_end clear it and a rolled-back
 -- subtransaction forgets it with its settings. Everywhere else the report is
 -- proved on every call, exactly as before.
 IF current_setting('app.accounting_close_memo',true)='on' THEN
  v_memo_key:=CASE WHEN v_generation='original-inventory-245:unqualified' THEN NULL ELSE COALESCE(v_generation||'|','')||p_union_id::text||'|'||p_start::text||'|'||p_end::text END;
  v_memo:=NULLIF(current_setting('app.union_pnl_evidence_memo',true),'')::jsonb;
  IF v_memo ? v_memo_key THEN RETURN v_memo->v_memo_key; END IF;
 END IF;
 -- UNION P&L NARROW READS (20260929044303): the week's registration events,
 -- hands and tournament credits are read through their narrow projections
 -- (union_pnl_inventory_touches, union_pnl_cash_outcome_touches,
 -- union_pnl_credit_touches), each written by its source row's own insert,
 -- once the throttled backfill has proved it complete; until then through
 -- the original wide rows, statement for statement as before.
 v_inv:=public.fn_union_pnl_projection_ready('inventory_touches');
 v_cash:=public.fn_union_pnl_projection_ready('cash_outcome_touches');
 v_credit:=public.fn_union_pnl_projection_ready('credit_touches');
 -- Both readers wait for the original book's in-flight transactions; this
 -- function is VOLATILE so every subsequent query sees their committed facts.
 -- CHUNKED CLOSE CERTIFICATES (20261003): inside a chunked union close attempt
 -- each expensive read below that found nothing wrong is kept, once proved,
 -- in accounting_close_certificates for the rest of that close of this
 -- closed week (fn_accounting_close_certificate / fn_accounting_close_certify;
 -- both do nothing anywhere else). An attempt whose time budget is spent
 -- after a step it had to prove returns 'warming' - not ready, nothing
 -- certified for payment - and the next attempt continues from the kept
 -- steps. A step that found a problem is kept for ONE HOUR (20261012), as
 -- '<kind>_problem' (fn_accounting_close_problem): it is never certified and
 -- never pays, its issues are reported exactly as before, and an attempt
 -- re-proves it once that hour has passed. Re-proving every problem step on
 -- every attempt is what held job 272's transactions for 3 to 5 minutes.
 v_open:=COALESCE(smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_boundary',p_union_id,p_start,p_start),
  smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_boundary',p_union_id,p_start,p_start));
 IF v_open IS NULL THEN
  v_open:=public.fn_union_pnl_boundary(p_union_id,p_start);
  IF v_open->>'status'='ready' THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_boundary',p_union_id,p_start,p_start,v_open);
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_boundary_problem',p_union_id,p_start,p_start,v_open); END IF;
 END IF;
 IF public.fn_accounting_close_warm_stop() THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 -- THE WINDOWS GO FIRST (20261012): the plan's two-hour windows (seconds each)
 -- are proved before the steps below, so an attempt that would otherwise
 -- spend its budget re-reading the boundaries and flows proves windows
 -- instead. Outside a chunked close the advance is NULL and nothing changes.
 IF public.fn_accounting_union_earned_plan_advance(p_union_id,p_start,p_end) IS FALSE THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 v_close:=COALESCE(smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_boundary',p_union_id,p_end,p_end),
  smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_boundary',p_union_id,p_end,p_end));
 IF v_close IS NULL THEN
  v_close:=public.fn_union_pnl_boundary(p_union_id,p_end);
  IF v_close->>'status'='ready' THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_boundary',p_union_id,p_end,p_end,v_close);
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_boundary_problem',p_union_id,p_end,p_end,v_close); END IF;
 END IF;
 IF public.fn_accounting_close_warm_stop() THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 IF v_open->>'status' IS DISTINCT FROM 'ready' THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','opening_basis_incomplete','evidence',v_open)); END IF;
 IF v_close->>'status' IS DISTINCT FROM 'ready' THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','closing_basis_incomplete','evidence',v_close)); END IF;
 -- The registrations the opening boundary carried through a valid opening
 -- resolution (union_pnl_opening_registration_resolutions): each one's
 -- original entry is proved from the posted chip ledger, not a funding receipt.
 v_open_resolved:=ARRAY(SELECT (x->>'source_id')::uuid FROM jsonb_array_elements(COALESCE(v_open->'holdings','[]')) x
  WHERE x->>'kind'='deferred_tournament_result' AND x->>'basis'='opening_registration_resolution');
 -- A blocked outcome counts as accepted only through an immutable resolution
 -- receipt re-proved from primary receipts and bound to this exact outcome
 -- (hand, payload hash, evidence). The outcome row itself is never changed.
 -- Only a hand outside the ready/certified/all-players/same-scope shape can
 -- be refused or resolved: those hands (the predicate of
 -- union_pnl_cash_outcomes_unaccepted), found through the projection's shape
 -- flag and re-checked against their rows, never the whole week's evidence.
 SELECT count(*) FILTER(WHERE NOT public.fn_union_pnl_cash_outcome_accepted(o)),
  count(*) FILTER(WHERE (o.evidence->>'status' IS DISTINCT FROM 'ready' OR o.evidence->'basis_certified' IS DISTINCT FROM 'true'::jsonb)
   AND public.fn_union_pnl_cash_outcome_accepted(o))
 INTO v_bad,v_resolved FROM public.fn_union_pnl_week_shaped_hands(p_union_id,p_start,p_end,v_cash) o;
 -- A hand whose provenance link the engine never recorded (its outcome has no
 -- game scope) counts only through its immutable link resolution
 -- (union_pnl_cash_outcome_link_resolutions), in the Union its re-proved scope
 -- names, and is accepted only when its re-proved evidence is certified.

 -- LINKED WINDOW ASSEMBLY: one source snapshot for ALL canonical windows,
 -- stored proofs and STABLE trusted witnesses; subsequent loop reads JSON only.
 v_l_snapshot:=NULL;v_l_complete:=false;v_l_bad:=0;v_l_resolved:=0;v_l_rows:=0;v_l_unknown:=0;
 IF current_setting('app.weekly_accounting_chunked',true)='on'
 AND current_setting('app.accounting_close_memo',true)='on'
 AND v_generation IS NOT NULL AND v_generation<>'original-inventory-245:unqualified'THEN
  WITH canonical AS MATERIALIZED(SELECT * FROM public.fn_accounting_close_windows(p_start,p_end)),
  proofs AS MATERIALIZED(SELECT p.* FROM public.accounting_close_partials p
   WHERE p.kind='pnl_linked_window'AND p.union_id=p_union_id AND p.period_start=p_start AND p.period_end=p_end),
  witnesses AS MATERIALIZED(SELECT w.window_start,w.window_end,
   smarter_private.weekly_hand_parts_witness(p_union_id,w.window_start,w.window_end,v_cash)witness FROM canonical w)
  SELECT jsonb_build_object('expected',(SELECT count(*)FROM canonical),'actual',(SELECT count(*)FROM proofs),
   'entries',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key',jsonb_build_object('union_id',p_union_id::text,'period_start_epoch',extract(epoch FROM p_start),'period_end_epoch',extract(epoch FROM p_end),'window_start_epoch',extract(epoch FROM w.window_start),'window_end_epoch',extract(epoch FROM w.window_end)),
    'window_start',w.window_start,'window_end',w.window_end,'proof',to_jsonb(p),'witness',w.witness,
    'bounds_match',p.window_start=w.window_start AND p.window_end=w.window_end,
    'finite_time',isfinite(p.computed_at),
    'unused_null',p.cash_ids IS NULL AND p.cash_md5 IS NULL AND p.fee_ids IS NULL AND p.fee_md5 IS NULL)
    ORDER BY w.window_start,w.window_end),'[]'::jsonb)FROM witnesses w LEFT JOIN proofs p ON p.window_start=w.window_start))
  INTO v_l_snapshot;
  v_l_checked_at:=clock_timestamp();v_hand_projected:=v_cash;
  IF(v_l_snapshot->>'expected')::bigint>0
   AND v_l_snapshot->'expected'=v_l_snapshot->'actual'
   AND jsonb_array_length(v_l_snapshot->'entries')=(v_l_snapshot->>'expected')::bigint THEN
   v_l_complete:=true;
   FOR v_l_entry IN SELECT value FROM jsonb_array_elements(v_l_snapshot->'entries')LOOP
    IF v_l_entry->'bounds_match'IS DISTINCT FROM'true'::jsonb
     OR v_l_entry->'finite_time'IS DISTINCT FROM'true'::jsonb
     OR v_l_entry->'unused_null'IS DISTINCT FROM'true'::jsonb THEN v_l_complete:=false;EXIT;END IF;
    IF(v_l_entry#>>'{proof,computed_at}')::timestamptz<p_end
     OR(v_l_entry#>>'{proof,computed_at}')::timestamptz<=v_l_checked_at-public.fn_accounting_close_proof_lifetime()
     OR(v_l_entry#>>'{proof,computed_at}')::timestamptz>v_l_checked_at THEN v_l_complete:=false;EXIT;END IF;
    v_l_value:=v_l_entry#>'{proof,value}';v_l_key:=v_l_entry->'key';v_l_witness:=v_l_entry->'witness';

 v_l_valid:=false;
 IF jsonb_typeof(v_l_value)='object'
 AND v_l_value->>'contract'='canonical-linked-validation-v1'
 AND v_l_value->>'generation'=v_generation
 AND v_l_value->'projected'=to_jsonb(v_hand_projected)
 AND v_l_value->>'reader_md5'='21241121f4e4fe29a7becb1ff692d722'
 AND v_l_value->>'witness_md5'='a101812df22c1dfb379ebc325bd7d6d0'
 AND v_l_value->'input_key'=v_l_key
 AND v_l_value->'witness'=v_l_witness
 AND v_l_value->>'proof_md5'=md5((v_l_value-'proof_md5')::text)
 AND jsonb_typeof(v_l_value->'counts')='object' THEN
  v_l_counts:=v_l_value->'counts';v_l_valid:=true;
  IF(SELECT array_agg(key ORDER BY key)FROM jsonb_object_keys(v_l_counts)key)
    IS DISTINCT FROM ARRAY['bad','resolved','rows','unknown']THEN v_l_valid:=false;END IF;
  IF v_l_valid THEN
   FOREACH v_l_name IN ARRAY ARRAY['rows','bad','resolved','unknown']LOOP
    IF jsonb_typeof(v_l_counts->v_l_name)IS DISTINCT FROM'number'
     OR(v_l_counts->>v_l_name)!~'^[0-9]{1,19}$'THEN v_l_valid:=false;EXIT;END IF;
    v_l_number:=(v_l_counts->>v_l_name)::numeric;
    IF v_l_number>9223372036854775807 THEN v_l_valid:=false;EXIT;END IF;
   END LOOP;
  END IF;
  IF v_l_valid THEN
   IF (v_l_counts->>'rows')::numeric IS DISTINCT FROM
    (v_l_counts->>'bad')::numeric+(v_l_counts->>'resolved')::numeric+(v_l_counts->>'unknown')::numeric THEN v_l_valid:=false;END IF;
  END IF;
 END IF;

    IF NOT v_l_valid THEN v_l_complete:=false;EXIT;END IF;
    v_l_rows:=v_l_rows+(v_l_counts->>'rows')::numeric;v_l_bad:=v_l_bad+(v_l_counts->>'bad')::numeric;
    v_l_resolved:=v_l_resolved+(v_l_counts->>'resolved')::numeric;v_l_unknown:=v_l_unknown+(v_l_counts->>'unknown')::numeric;
   END LOOP;
   IF greatest(v_l_rows,v_l_bad,v_l_resolved,v_l_unknown)>9223372036854775807 THEN v_l_complete:=false;END IF;
  END IF;
 END IF;
 IF v_l_complete AND(v_l_unknown=0 OR v_l_bad>0)THEN
  -- A complete known-bad proof is used: preserve the blocked report, even if
  -- other rows have unknown readiness. Unknown-only uses original 3VL below.
  v_bad:=v_bad+v_l_bad::bigint;v_resolved:=v_resolved+v_l_resolved::bigint;
 ELSE
 SELECT v_bad+count(*) FILTER(WHERE NOT (k.evidence->>'status'='ready' AND k.evidence->'basis_certified'='true'::jsonb
   AND k.evidence->'all_players_included'='true'::jsonb)),
  v_resolved+count(*) FILTER(WHERE k.evidence->>'status'='ready' AND k.evidence->'basis_certified'='true'::jsonb
   AND k.evidence->'all_players_included'='true'::jsonb)
 INTO v_bad,v_resolved FROM public.fn_union_pnl_linked_cash_outcomes(p_union_id,p_start,p_end) k;
 END IF;
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','accepted_cash_basis_incomplete','count',v_bad)); END IF;
 -- A missing original game scope cannot silently disappear from every Union.
 SELECT count(*) INTO v_bad FROM public.union_pnl_cash_outcomes WHERE recognized_at>=p_start AND recognized_at<p_end
  AND NOT game_scope ?& ARRAY['game_union_id','host_club_id','tournament_id','is_private','asset','unit_scale']
  AND NOT EXISTS(SELECT 1 FROM public.fn_union_pnl_cash_outcome_link(union_pnl_cash_outcomes));
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','accepted_cash_original_scope_missing','count',v_bad)); END IF;
 SELECT count(*) INTO v_bad FROM public.union_pnl_original_flows WHERE recognized_at>=p_start AND recognized_at<p_end
  AND NOT game_scope ?& ARRAY['game_union_id','host_club_id','tournament_id','is_private','asset','unit_scale'];
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','original_money_flow_scope_missing','count',v_bad)); END IF;
 SELECT count(*) INTO v_bad FROM public.cash_participant_funding_receipts WHERE recorded_at>=v_fence AND recorded_at<p_end AND transaction_id IS NULL;
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array('post_capture_funding_transaction_identity_missing'); END IF;
 SELECT count(*) INTO v_bad FROM public.cash_funding_application_receipts WHERE applied_at>=v_fence AND applied_at<p_end AND transaction_id IS NULL;
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array('post_capture_application_transaction_identity_missing'); END IF;
 SELECT count(*) INTO v_bad FROM public.cash_hand_provenance_receipts WHERE accepted_at>=v_fence AND accepted_at<p_end AND transaction_id IS NULL;
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array('post_capture_hand_transaction_identity_missing'); END IF;
 -- The flow proof is read once; the P&L below reuses these exact rows.
 v_cert:=COALESCE(smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_flows',p_union_id,p_start,p_end),
  smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_flows',p_union_id,p_start,p_end));
 IF v_cert IS NOT NULL THEN
  v_bad:=(v_cert->>'bad')::bigint; v_flows:=v_cert->'flows';
 ELSE
 SELECT count(*) FILTER(WHERE NOT f.valid),COALESCE(jsonb_agg(to_jsonb(f)),'[]') INTO v_bad,v_flows
  FROM public.fn_union_pnl_original_flow_evidence(p_union_id,p_start,p_end) f;
  IF v_bad=0 THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_flows',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad,'flows',v_flows));
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_flows_problem',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad,'flows',v_flows)); END IF;
 END IF;
 IF public.fn_accounting_close_warm_stop() THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','original_money_flow_basis_incomplete','count',v_bad)); END IF;
 -- Every touched tournament registration must have its original chip entry,
 -- including zero-rake players. Historical/current membership is never used.
 -- The week's registration events, each touched tournament's Union proved
 -- once through its own events (t.row_id::text equality kept; the uuid
 -- equality only lets the index find the same rows and is never attempted on
 -- a non-canonical id). The frame test is unchanged; i.observed_at repeats it
 -- because fn_union_pnl_inventory_observe, the only writer of framed events,
 -- stamps each event with its frame's observed_at (both tables immutable), so
 -- the same rows are reached through union_pnl_inventory_events_players_observed.
 -- Both reads (fn_union_pnl_touched_registrations, fn_union_pnl_tournament_in_union)
 -- come from union_pnl_inventory_touches once it is complete: the same keys,
 -- the frame's observed_at copied at capture, without the wide rows.
 v_cert:=COALESCE(smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_touched',p_union_id,p_start,p_end),
  smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_touched',p_union_id,p_start,p_end));
 IF v_cert IS NOT NULL THEN
  v_bad:=(v_cert->>'bad')::bigint;
 ELSE
 WITH touched AS MATERIALIZED (
  SELECT w.registration_id row_id,w.touched_tournament_id tournament_id
  FROM public.fn_union_pnl_touched_registrations(p_start,p_end,v_inv) w
 ), distinct_tournaments AS MATERIALIZED (
  SELECT DISTINCT tournament_id FROM touched
 ), union_tournaments AS MATERIALIZED (
  SELECT d.tournament_id FROM distinct_tournaments d
  WHERE (CASE WHEN v_inv THEN EXISTS(SELECT 1 FROM public.union_pnl_inventory_touches t WHERE t.source_name='tournaments'
   AND t.row_id=CASE WHEN d.tournament_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN d.tournament_id::uuid END
   AND t.row_id::text=d.tournament_id
   AND t.union_id=p_union_id::text) ELSE EXISTS(SELECT 1 FROM public.union_pnl_inventory_events t WHERE t.source_name='tournaments'
  AND t.row_id=CASE WHEN d.tournament_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN d.tournament_id::uuid END
  AND t.row_id::text=d.tournament_id
  AND COALESCE(t.after_row,t.before_row)->>'union_id'=p_union_id::text) END)
 ), union_touched AS MATERIALIZED (
  SELECT i.row_id FROM touched i WHERE i.tournament_id IN (SELECT tournament_id FROM union_tournaments)
 ), entries AS MATERIALIZED (
  -- the two receipt tests, read once per touched registration (column for
  -- column: a whole-row argument would detoast every receipt's snapshots)
  SELECT r.registration_id,
   bool_or(r.asset='chips' AND public.fn_union_pnl_tournament_entry_club_of(r.asset,r.amount,r.funding_club_id,r.ledger_id,r.entitlement_id,r.registration_snapshot) IS NOT NULL) has_entry,
   bool_or(r.asset<>'chips' OR public.fn_union_pnl_tournament_entry_club_of(r.asset,r.amount,r.funding_club_id,r.ledger_id,r.entitlement_id,r.registration_snapshot) IS NULL) has_other
  FROM public.tournament_participant_funding_receipts r
  WHERE r.registration_id IN (SELECT row_id FROM union_touched)
  GROUP BY r.registration_id
 ), unresolved_registrations AS MATERIALIZED (
  SELECT DISTINCT i.row_id FROM union_touched i LEFT JOIN entries e ON e.registration_id=i.row_id
  WHERE NOT COALESCE(e.has_entry,false) AND i.row_id<>ALL(v_open_resolved)
 ), satellite_owners AS MATERIALIZED (
  SELECT i.row_id,public.fn_union_pnl_satellite_seat_owner(i.row_id,NULL) owner
  FROM unresolved_registrations i
 ) SELECT count(*) INTO v_bad FROM union_touched i LEFT JOIN entries e ON e.registration_id=i.row_id
 LEFT JOIN satellite_owners o ON o.row_id=i.row_id
 WHERE (NOT COALESCE(e.has_entry,false) AND i.row_id<>ALL(v_open_resolved)
   AND o.owner IS NULL)
  OR COALESCE(e.has_other,false);
  IF v_bad=0 THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad));
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched_problem',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad)); END IF;
 END IF;
 IF public.fn_accounting_close_warm_stop() THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','tournament_original_population_or_instrument_incomplete','count',v_bad)); END IF;
 -- An award must return to the original funding club; a changed credited
 -- wallet does not prove a new earning ownership agreement.
 -- The week's credits of this Union (its tournament snapshot's Union, its
 -- frame in the week) come from union_pnl_credit_touches once complete. The
 -- two whole-row resolutions (a whole-row value detoasts every snapshot of
 -- the credit) are asked only of a credit the entry test did not settle: the
 -- same conjunction, in an order the planner may not change.
 SELECT count(*) INTO v_bad FROM public.fn_union_pnl_week_union_credits(p_union_id,p_start,p_end,v_credit) w
 JOIN public.tournament_accounting_credit_receipts c ON c.id=w.credit_id
 WHERE CASE WHEN (cardinality(c.entry_receipt_ids)=0 OR EXISTS(SELECT 1 FROM unnest(c.entry_receipt_ids) original_id(receipt_id)
   LEFT JOIN public.tournament_participant_funding_receipts r ON r.id=original_id.receipt_id
   WHERE r.id IS NULL OR r.asset<>'chips' OR public.fn_union_pnl_tournament_entry_club_of(r.asset,r.amount,r.funding_club_id,r.ledger_id,r.entitlement_id,r.registration_snapshot) IS DISTINCT FROM c.credited_club_id OR r.user_id IS DISTINCT FROM c.user_id))
  THEN NOT public.fn_union_pnl_award_owner_resolved(c,p_union_id,p_start,v_open_resolved)
   AND NOT public.fn_union_pnl_award_satellite_owner(c) ELSE false END;
 IF v_bad>0 THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','tournament_award_original_earning_owner_incomplete','count',v_bad)); END IF;
 v_eco:=public.fn_union_eco_terms_evidence(p_union_id,p_start,p_end);
 IF v_eco->>'status' IS DISTINCT FROM 'ready' THEN v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','eco_commercial_basis_incomplete','evidence',v_eco)); END IF;
 SELECT count(DISTINCT x->'terms') INTO v_bad FROM jsonb_array_elements(COALESCE(v_eco->'segments','[]')) x;
 IF v_bad<>1 THEN v_issues:=v_issues||jsonb_build_array('eco_intraweek_changed_terms_require_original_allocation'); END IF;
 v_terms_value:=v_eco#>'{segments,0,terms}';
 -- Validate every original bank/source leg even when the week has no rows.
 -- CHUNKED CLOSE WINDOWS (20261003): inside a chunked close the plan's
 -- two-hour windows are proved first, a few per attempt; until all are, the
 -- attempt stops warming (fn_accounting_union_earned_plan_advance is NULL,
 -- and this test passes, everywhere else).
 -- (THE WINDOWS GO FIRST, 20261012: the plan's windows are proved above,
 -- right after the opening boundary, before any step that can be re-proved.)
 PERFORM public.fn_accounting_union_earned_plan(p_union_id,p_start,p_end);
 IF public.fn_accounting_close_warm_stop() THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 IF md5(pg_get_functiondef('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)'::regprocedure)) IS DISTINCT FROM 'a101812df22c1dfb379ebc325bd7d6d0'
 OR md5(pg_get_functiondef('smarter_private.weekly_hand_parts_reduce(uuid,timestamptz,timestamptz,boolean)'::regprocedure)) IS DISTINCT FROM '97fc255997a2faeac593b5b1f5420d4c'
 OR md5(pg_get_functiondef('smarter_private.weekly_hand_parts_read(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure)) IS DISTINCT FROM 'd427fd27d163ba72a7dc3cd50866163d'
 THEN RAISE EXCEPTION 'weekly_hand_parts_owner_changed';END IF;
 IF (SELECT count(*) FROM pg_proc WHERE oid IN('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)'::regprocedure,'smarter_private.weekly_hand_parts_reduce(uuid,timestamptz,timestamptz,boolean)'::regprocedure,'smarter_private.weekly_hand_parts_read(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure)
  AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='s' AND proacl::text='{postgres=X/postgres}' AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private']) IS DISTINCT FROM 3::bigint THEN RAISE EXCEPTION 'weekly_hand_parts_owner_authority_changed';END IF;
 v_hand_parts:=smarter_private.weekly_hand_parts_read(p_union_id,p_start,p_end,v_generation,v_cash);
 v_cert:=COALESCE(smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_clubs',p_union_id,p_start,p_end),
  smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_clubs',p_union_id,p_start,p_end));
 IF v_cert IS NOT NULL THEN
  v_clubs:=v_cert->'clubs'; v_cash_reconciled:=(v_cert->>'cash_reconciled')::boolean; v_rows:=(v_cert->>'rows')::bigint;
  v_cash_rake:=(v_cert->>'cash_rake')::numeric; v_hands:=(v_cert->>'hands')::bigint; v_accepted_rake:=(v_cert->>'accepted_rake')::numeric;
 ELSE
 WITH flows AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(v_flows)
  AS f(ledger_id uuid,club_id uuid,user_id uuid,buyins numeric,cashouts numeric,kind text,valid boolean)),
 -- One read of the week's hands: each (club, player) delta total, and (kind 0)
 -- the hand count and accepted rake that used to cost two more reads.
 outcome_pass AS MATERIALIZED (
 SELECT kind,club_id,user_id,delta,hands,rake FROM jsonb_to_recordset(v_hand_parts)x(kind integer,club_id uuid,user_id uuid,delta numeric,hands bigint,rake numeric)
 UNION ALL SELECT original.* FROM LATERAL(

  SELECT x.kind,x.club_id,x.user_id,sum(x.delta) delta,count(*) hands,sum(x.rake) rake
  FROM (SELECT h.hand_accepted_rake accepted_rake,h.hand_participants participants
   FROM public.fn_union_pnl_week_hand_lines(p_union_id,p_start,p_end,v_cash) h
   -- with this Union's linked hands, through their link resolutions
   UNION ALL SELECT k.evidence->>'accepted_rake',k.evidence->'participants' FROM public.fn_union_pnl_linked_cash_outcomes(p_union_id,p_start,p_end) k) o CROSS JOIN LATERAL (
   SELECT 0 kind,NULL::uuid club_id,NULL::uuid user_id,NULL::numeric delta,o.accepted_rake::numeric rake
   UNION ALL
   SELECT 1,(p->>'earning_club_id')::uuid,(p->>'user_id')::uuid,(p->>'observed_stack_delta')::numeric,NULL::numeric
   FROM jsonb_array_elements(COALESCE(o.participants,'[]')) p) x
  GROUP BY x.kind,x.club_id,x.user_id

 )original WHERE v_hand_parts IS NULL
 ), hand_players AS (SELECT club_id,user_id,delta FROM outcome_pass WHERE kind=1
  -- JACKPOT SHARES ON THE FELT (20260929): a Bad Beat Jackpot share credited
  -- to a seat after its hand committed is that player's cash result too.
  UNION ALL SELECT a.club_id,a.user_id,a.amount FROM public.fn_union_pnl_week_bbj_stack_awards(p_union_id,p_start,p_end) a), opening AS (SELECT (x->>'club_id')::uuid club_id,sum((x->>'amount')::numeric) amount,
   sum((x->>'amount')::numeric) FILTER(WHERE x->>'kind'<>'deferred_tournament_result') cash
   FROM jsonb_array_elements(COALESCE(v_open->'holdings','[]')) x GROUP BY 1),
 closing AS (SELECT (x->>'club_id')::uuid club_id,sum((x->>'amount')::numeric) amount,
   sum((x->>'amount')::numeric) FILTER(WHERE x->>'kind'<>'deferred_tournament_result') cash
   FROM jsonb_array_elements(COALESCE(v_close->'holdings','[]')) x GROUP BY 1),
 -- The canonical payout basis excludes retained Union-house rake. Gross
 -- original rake still belongs in the all-player P&L and bank reconciliation.
 rake AS MATERIALIZED (
  SELECT s.club_id,sum(s.rake_credit) generated,COALESCE(k.earned,0) earned,
   sum(s.rake_credit) FILTER(WHERE s.source_type='cash_rake_accrual') cash_rake,
   sum(s.rake_credit) FILTER(WHERE s.source_type='tournament_fee_accrual') tournament_rake
  FROM public.accounting_payable_earning_sources s
  LEFT JOIN (SELECT club_id,sum(payout) earned FROM public.fn_union_club_rake_basis(p_union_id,p_start,p_end) GROUP BY club_id) k ON k.club_id=s.club_id
  WHERE s.union_id=p_union_id AND s.earned_at>=p_start AND s.earned_at<p_end GROUP BY s.club_id,k.earned
 ),
 roster AS (
  SELECT DISTINCT (COALESCE(after_row,before_row)->>'club_id')::uuid club_id FROM public.union_pnl_inventory_events
   WHERE source_name='union_clubs' AND COALESCE(after_row,before_row)->>'union_id'=p_union_id::text AND observed_at<p_end
    AND (observed_at>=p_start OR row_id::text IN(SELECT x#>>'{row,id}' FROM jsonb_array_elements(COALESCE(v_open#>'{inventory,population,union_clubs}','[]')) x))
  UNION SELECT club_id FROM rake UNION SELECT club_id FROM flows UNION SELECT club_id FROM hand_players UNION SELECT club_id FROM opening UNION SELECT club_id FROM closing
 ), movement AS (SELECT club_id,sum(buyins) buyins,sum(cashouts) cashouts,
  sum(cashouts-buyins) FILTER(WHERE kind IN('cash_funding','cash_return','cash_late_settlement')) cash_flow,
  sum(buyins) FILTER(WHERE kind='cash_funding') cash_buyins,sum(cashouts) FILTER(WHERE kind='cash_return') cash_cashouts FROM flows GROUP BY club_id),
 hands AS (SELECT club_id,sum(delta) delta FROM hand_players GROUP BY club_id),
 people AS (SELECT club_id,count(DISTINCT user_id)::int players FROM(SELECT club_id,user_id FROM flows UNION SELECT club_id,user_id FROM hand_players
  UNION SELECT (x->>'club_id')::uuid,(x->>'user_id')::uuid FROM jsonb_array_elements(COALESCE(v_open->'holdings','[]')||COALESCE(v_close->'holdings','[]')) x) q GROUP BY club_id),
 club_rows AS (
  SELECT r.club_id,COALESCE(m.buyins,0) buyins,COALESCE(m.cashouts,0) cashouts,COALESCE(m.cash_buyins,0) cash_buyins,COALESCE(m.cash_cashouts,0) cash_cashouts,
   COALESCE(m.cashouts,0)-COALESCE(m.buyins,0) realized_net,COALESCE(o.amount,0) seated_start,COALESCE(c.amount,0) seated_end,
   COALESCE(o.cash,0) seated_start_cash,COALESCE(c.cash,0) seated_end_cash,
   COALESCE(c.amount,0)-COALESCE(o.amount,0) stack_delta,COALESCE(h.delta,0) cash_player_pnl,
   COALESCE(m.cashouts,0)-COALESCE(m.buyins,0)+COALESCE(c.amount,0)-COALESCE(o.amount,0)-COALESCE(h.delta,0) tournament_player_pnl,
   COALESCE(m.cash_flow,0)+COALESCE(c.cash,0)-COALESCE(o.cash,0)=COALESCE(h.delta,0) cash_reconciled,
   COALESCE(p.players,0) players,COALESCE(k.generated,0) rake_paid,COALESCE(k.earned,0) rake_earned,COALESCE(k.cash_rake,0) cash_rake,COALESCE(k.tournament_rake,0) tournament_rake,
   COALESCE(m.cashouts,0)-COALESCE(m.buyins,0)+COALESCE(c.amount,0)-COALESCE(o.amount,0)+COALESCE(k.generated,0) net
  FROM roster r LEFT JOIN movement m USING(club_id) LEFT JOIN opening o USING(club_id) LEFT JOIN closing c USING(club_id)
  LEFT JOIN hands h USING(club_id) LEFT JOIN people p USING(club_id) LEFT JOIN rake k USING(club_id)
  WHERE r.club_id IS NOT NULL
 ), player_results AS (
  SELECT club_id,user_id,sum(delta) delta FROM (
   SELECT club_id,user_id,cashouts-buyins delta FROM flows
   UNION ALL SELECT (x->>'club_id')::uuid,(x->>'user_id')::uuid,(x->>'amount')::numeric FROM jsonb_array_elements(COALESCE(v_close->'holdings','[]')) x
   UNION ALL SELECT (x->>'club_id')::uuid,(x->>'user_id')::uuid,-(x->>'amount')::numeric FROM jsonb_array_elements(COALESCE(v_open->'holdings','[]')) x
  ) amounts GROUP BY club_id,user_id
 ), wins AS(SELECT club_id,sum(greatest(delta,0)) winnings,sum(greatest(-delta,0)) losses FROM player_results GROUP BY club_id), complete AS (
  SELECT q.*,COALESCE(w.winnings,0) winnings,COALESCE(w.losses,0) losses,
   CASE v_terms_value->>'eco_base_mode'
    WHEN 'club_cash_profit' THEN rake_earned-cash_player_pnl
    WHEN 'net_invoice_position' THEN realized_net+stack_delta+rake_paid+rake_earned
    WHEN 'winnings_plus_rake' THEN realized_net+stack_delta+rake_paid
    WHEN 'winnings_only' THEN realized_net+stack_delta END eco_base
  FROM club_rows q LEFT JOIN wins w USING(club_id)
 ) SELECT COALESCE(jsonb_agg(to_jsonb(q)||jsonb_build_object('eco_amount',CASE WHEN v_terms_value->'eco_enabled'='true'::jsonb
  THEN round(-(v_terms_value->>'eco_rate')::numeric*eco_base,2) ELSE 0 END) ORDER BY club_id),'[]'),
  COALESCE(bool_and(cash_reconciled),true),count(*),COALESCE(sum(cash_rake),0),
  COALESCE((SELECT h.hands FROM outcome_pass h WHERE h.kind=0),0),(SELECT COALESCE(sum(h.rake),0) FROM outcome_pass h WHERE h.kind=0)
  INTO v_clubs,v_cash_reconciled,v_rows,v_cash_rake,v_hands,v_accepted_rake FROM complete q;
  IF v_hand_parts IS NOT NULL AND smarter_private.weekly_hand_parts_read(p_union_id,p_start,p_end,v_generation,v_cash) IS DISTINCT FROM v_hand_parts THEN
   RAISE EXCEPTION 'weekly_hand_parts_sources_changed_during_report';END IF;
  IF v_cash_reconciled AND (v_accepted_rake IS NOT DISTINCT FROM v_cash_rake OR v_accepted_rake-public.fn_union_pnl_week_rake_straddle(p_union_id,p_start,p_end) IS NOT DISTINCT FROM v_cash_rake) THEN
   PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_clubs',p_union_id,p_start,p_end,jsonb_build_object('clubs',v_clubs,
    'cash_reconciled',v_cash_reconciled,'rows',v_rows,'cash_rake',v_cash_rake,'hands',v_hands,'accepted_rake',v_accepted_rake));
  ELSE
   PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_clubs_problem',p_union_id,p_start,p_end,jsonb_build_object('clubs',v_clubs,
    'cash_reconciled',v_cash_reconciled,'rows',v_rows,'cash_rake',v_cash_rake,'hands',v_hands,'accepted_rake',v_accepted_rake));
  END IF;
 END IF;
 IF v_accepted_rake IS DISTINCT FROM v_cash_rake AND v_accepted_rake-public.fn_union_pnl_week_rake_straddle(p_union_id,p_start,p_end) IS DISTINCT FROM v_cash_rake THEN v_issues:=v_issues||jsonb_build_array('accepted_cash_rake_does_not_match_original_earning_and_bank_basis'); END IF;
 IF NOT v_cash_reconciled THEN v_issues:=v_issues||jsonb_build_array('accepted_cash_deltas_do_not_reconcile_original_flows_and_boundaries'); END IF;
 v_report:=jsonb_build_object('report_version',1,'status',CASE WHEN v_issues='[]'::jsonb THEN 'ready' ELSE 'blocked' END,
  'basis_certified',v_issues='[]'::jsonb,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,
  'issues',v_issues,'clubs',v_clubs,'opening_basis',v_open,'closing_basis',v_close,'eco_commercial_terms_evidence',v_eco,
  'accepted_cash_hands',v_hands,'accepted_cash_hands_resolved',v_resolved,'club_count',v_rows,'current_seats_used',false,'current_membership_used',false,
  'all_players_included',v_issues='[]'::jsonb,'tournament_basis','original_realized_settlement_deferred_while_open');
 IF v_memo_key IS NOT NULL THEN
  PERFORM set_config('app.union_pnl_evidence_memo',(COALESCE(NULLIF(current_setting('app.union_pnl_evidence_memo',true),'')::jsonb,'{}')
   ||jsonb_build_object(v_memo_key,v_report))::text,true);
 END IF;
 RETURN v_report;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_accounting_union_earned_plan_advance(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE w record; r record; began timestamptz; proved boolean:=false;

 v_l_value jsonb;v_l_key jsonb;v_l_witness jsonb;v_l_counts jsonb;
 v_l_valid boolean;v_l_name text;v_l_number numeric;
 v_l_cached record;
 stop_at timestamptz; v_generation text; v_bad bigint; v_flows jsonb; v_windows bigint; v_fresh bigint;v_hand_projected boolean;v_hand_witness jsonb;v_hand_groups jsonb;
BEGIN
 IF COALESCE(current_setting('app.weekly_accounting_chunked',true),'')<>'on'
  OR current_setting('app.accounting_close_memo',true) IS DISTINCT FROM 'on'
  OR NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'') IS NULL
  OR p_union_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_start>=p_end
  OR p_end>clock_timestamp() THEN
  RETURN NULL;
 END IF;
 began:=NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'')::timestamptz
  -COALESCE(NULLIF(current_setting('app.weekly_accounting_scope_budget',true),''),'8 minutes')::interval;
 -- THE STATEMENT'S OWN CLOCK (20261015b): an attempt can begin late in its
 -- tick (job 272 visits other scopes first in the same 240 s statement), so a
 -- proving loop also stops a minute before the statement itself would be
 -- cancelled, not only 120 s after the attempt began.
 stop_at:=began+interval '120 seconds';
 IF current_setting('statement_timeout') NOT IN ('0','0ms') THEN
  stop_at:=LEAST(stop_at,statement_timestamp()+current_setting('statement_timeout')::interval-interval '60 seconds');
 END IF;
 IF public.fn_accounting_close_certificate('earned_plan',p_union_id,p_start,p_end) IS NULL THEN
 DELETE FROM public.accounting_close_partials WHERE computed_at<clock_timestamp()-interval '8 days';
 FOR w IN SELECT * FROM public.fn_accounting_close_windows(p_start,p_end) ORDER BY 1 LOOP
  CONTINUE WHEN EXISTS(SELECT 1 FROM public.accounting_close_partials p WHERE p.kind='earned_plan_window' AND p.union_id=p_union_id
   AND p.period_start=p_start AND p.period_end=p_end AND p.window_start=w.window_start AND p.window_end=w.window_end
   AND p.computed_at>=p_end AND p.computed_at>clock_timestamp()-public.fn_accounting_close_proof_lifetime());
  IF proved AND clock_timestamp()>stop_at THEN RETURN false; END IF;
  SELECT * INTO r FROM public.fn_accounting_union_earned_plan_window(p_union_id,w.window_start,w.window_end);
  IF NOT FOUND THEN
   -- v3 over the same window refuses exactly what it refuses in the week.
   PERFORM public.fn_accounting_union_earned_plan_v3(p_union_id,w.window_start,w.window_end);
   RAISE EXCEPTION 'union_earned_plan_window_unproved' USING ERRCODE='55000',
    DETAIL=jsonb_build_object('union_id',p_union_id,'period_start',p_start,'period_end',p_end,'window_start',w.window_start,'window_end',w.window_end)::text;
  END IF;
  INSERT INTO public.accounting_close_partials(kind,union_id,period_start,period_end,window_start,window_end,value,cash_ids,cash_md5,fee_ids,fee_md5,computed_at)
  VALUES('earned_plan_window',p_union_id,p_start,p_end,w.window_start,w.window_end,r.value,r.cash_ids,r.cash_md5,r.fee_ids,r.fee_md5,clock_timestamp())
  ON CONFLICT(kind,union_id,period_start,period_end,window_start) DO UPDATE SET window_end=EXCLUDED.window_end,value=EXCLUDED.value,
   cash_ids=EXCLUDED.cash_ids,cash_md5=EXCLUDED.cash_md5,fee_ids=EXCLUDED.fee_ids,fee_md5=EXCLUDED.fee_md5,computed_at=EXCLUDED.computed_at;
  proved:=true;
 END LOOP;
 -- PROVING WINDOWS IS A WHOLE ATTEMPT (20261015): an attempt that proved a
 -- window ends here, even when it proved the last one, so the closing boundary
 -- and every later step start the next attempt with the whole budget.
 IF proved THEN RETURN false; END IF;
 END IF;
 -- THE WEEK'S ORIGINAL FLOWS ARE PROVED TWO HOURS AT A TIME (20261015b).
 -- fn_union_pnl_evidence_report proves the week's original money flows in one
 -- statement (814,510 flows for the 2026-10-05 week: 162 s alone, 2 GB of
 -- temporary files), which cannot fit an attempt of job 272's 240 s statement
 -- once the attempt's preparation and the tick's other scopes have run, so
 -- every attempt that reached it was cancelled and rolled back. The same proof
 -- is made here one plan window at a time (each flow is proved from its own
 -- row and the week's bounds, so the windows partition the week exactly), kept
 -- as partials like the earned-plan windows, and assembled into the very
 -- certificate the report reads, in an attempt of its own. Only while the
 -- report and the week proof are the reviewed definitions, the window proof is
 -- derived from; otherwise the report proves the week itself, as before.
 IF p_union_id='fade0000-0000-0000-0000-000000000001'::uuid AND p_end>='2026-10-12 07:00Z'::timestamptz THEN
  v_generation:=COALESCE(smarter_private.original_inventory_basis_generation(),'original-inventory-245:unqualified');
 END IF;
 IF v_generation IS NOT DISTINCT FROM 'original-inventory-245:unqualified'
  OR md5(pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))<>'b23655a15587192f137ae4ad57859742'
  OR md5(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))<>'80f29ec1270de41106ee6302153a7cfe'
 THEN RETURN true;END IF;
 IF smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_flows',p_union_id,p_start,p_end) IS NOT NULL
 OR smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_flows',p_union_id,p_start,p_end) IS NOT NULL THEN
 -- Original hand proof progresses only after original flow proof, in its own attempt.
 IF md5(pg_get_functiondef('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)'::regprocedure)) IS DISTINCT FROM 'a101812df22c1dfb379ebc325bd7d6d0'
 OR md5(pg_get_functiondef('smarter_private.weekly_hand_parts_reduce(uuid,timestamptz,timestamptz,boolean)'::regprocedure)) IS DISTINCT FROM '97fc255997a2faeac593b5b1f5420d4c'
 OR md5(pg_get_functiondef('smarter_private.weekly_hand_parts_read(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure)) IS DISTINCT FROM 'd427fd27d163ba72a7dc3cd50866163d'
 THEN RAISE EXCEPTION 'weekly_hand_parts_owner_changed';END IF;
 IF (SELECT count(*) FROM pg_proc WHERE oid IN('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)'::regprocedure,'smarter_private.weekly_hand_parts_reduce(uuid,timestamptz,timestamptz,boolean)'::regprocedure,'smarter_private.weekly_hand_parts_read(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure)
  AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='s' AND proacl::text='{postgres=X/postgres}' AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private']) IS DISTINCT FROM 3::bigint THEN RAISE EXCEPTION 'weekly_hand_parts_owner_authority_changed';END IF;
 v_hand_projected:=public.fn_union_pnl_projection_ready('cash_outcome_touches');
 -- ORIGINAL CANONICAL LINKED WINDOWS. New proof kind; no existing hand JSON ABI
 -- changes. An attempt that proves any linked unit ends warming before later work.
 IF v_generation IS NOT NULL AND v_generation<>'original-inventory-245:unqualified'THEN
  FOR w IN SELECT * FROM public.fn_accounting_close_windows(p_start,p_end)ORDER BY 1 LOOP
   v_l_witness:=smarter_private.weekly_hand_parts_witness(p_union_id,w.window_start,w.window_end,v_hand_projected);
   v_l_key:=jsonb_build_object('union_id',p_union_id::text,'period_start_epoch',extract(epoch FROM p_start),'period_end_epoch',extract(epoch FROM p_end),'window_start_epoch',extract(epoch FROM w.window_start),'window_end_epoch',extract(epoch FROM w.window_end));v_l_valid:=false;
   SELECT p.*INTO v_l_cached FROM public.accounting_close_partials p WHERE p.kind='pnl_linked_window'
    AND p.union_id=p_union_id AND p.period_start=p_start AND p.period_end=p_end AND p.window_start=w.window_start;
   IF FOUND AND v_l_cached.window_end=w.window_end AND isfinite(v_l_cached.computed_at)
    AND v_l_cached.computed_at>=p_end AND v_l_cached.computed_at>clock_timestamp()-public.fn_accounting_close_proof_lifetime()
    AND v_l_cached.computed_at<=clock_timestamp()AND v_l_cached.cash_ids IS NULL AND v_l_cached.cash_md5 IS NULL
    AND v_l_cached.fee_ids IS NULL AND v_l_cached.fee_md5 IS NULL THEN
    v_l_value:=v_l_cached.value;

 v_l_valid:=false;
 IF jsonb_typeof(v_l_value)='object'
 AND v_l_value->>'contract'='canonical-linked-validation-v1'
 AND v_l_value->>'generation'=v_generation
 AND v_l_value->'projected'=to_jsonb(v_hand_projected)
 AND v_l_value->>'reader_md5'='21241121f4e4fe29a7becb1ff692d722'
 AND v_l_value->>'witness_md5'='a101812df22c1dfb379ebc325bd7d6d0'
 AND v_l_value->'input_key'=v_l_key
 AND v_l_value->'witness'=v_l_witness
 AND v_l_value->>'proof_md5'=md5((v_l_value-'proof_md5')::text)
 AND jsonb_typeof(v_l_value->'counts')='object' THEN
  v_l_counts:=v_l_value->'counts';v_l_valid:=true;
  IF(SELECT array_agg(key ORDER BY key)FROM jsonb_object_keys(v_l_counts)key)
    IS DISTINCT FROM ARRAY['bad','resolved','rows','unknown']THEN v_l_valid:=false;END IF;
  IF v_l_valid THEN
   FOREACH v_l_name IN ARRAY ARRAY['rows','bad','resolved','unknown']LOOP
    IF jsonb_typeof(v_l_counts->v_l_name)IS DISTINCT FROM'number'
     OR(v_l_counts->>v_l_name)!~'^[0-9]{1,19}$'THEN v_l_valid:=false;EXIT;END IF;
    v_l_number:=(v_l_counts->>v_l_name)::numeric;
    IF v_l_number>9223372036854775807 THEN v_l_valid:=false;EXIT;END IF;
   END LOOP;
  END IF;
  IF v_l_valid THEN
   IF (v_l_counts->>'rows')::numeric IS DISTINCT FROM
    (v_l_counts->>'bad')::numeric+(v_l_counts->>'resolved')::numeric+(v_l_counts->>'unknown')::numeric THEN v_l_valid:=false;END IF;
  END IF;
 END IF;

   END IF;
   CONTINUE WHEN v_l_valid;
   IF proved AND clock_timestamp()>stop_at THEN RETURN false;END IF;
   -- The canonical reader is a filtered subset of this admitted raw linked
   -- innerjoin bag. An exact zero witness therefore proves an empty result.
   IF (v_l_witness->>'links')::bigint=0 THEN
    v_l_counts:=jsonb_build_object('rows',0,'bad',0,'resolved',0,'unknown',0);
   ELSE
   SELECT jsonb_build_object('rows',count(*),
    'bad',count(*)FILTER(WHERE NOT(k.evidence->>'status'='ready'AND k.evidence->'basis_certified'='true'::jsonb AND k.evidence->'all_players_included'='true'::jsonb)),
    'resolved',count(*)FILTER(WHERE k.evidence->>'status'='ready'AND k.evidence->'basis_certified'='true'::jsonb AND k.evidence->'all_players_included'='true'::jsonb),
    'unknown',count(*)FILTER(WHERE(k.evidence->>'status'='ready'AND k.evidence->'basis_certified'='true'::jsonb AND k.evidence->'all_players_included'='true'::jsonb)IS NULL))
   INTO v_l_counts FROM public.fn_union_pnl_linked_cash_outcomes(p_union_id,w.window_start,w.window_end)k;
   END IF;
   IF v_l_witness IS DISTINCT FROM smarter_private.weekly_hand_parts_witness(p_union_id,w.window_start,w.window_end,v_hand_projected)
    THEN RAISE EXCEPTION 'weekly_linked_parts_sources_changed_during_window';END IF;
   v_l_value:=jsonb_build_object('contract','canonical-linked-validation-v1','generation',v_generation,
    'projected',v_hand_projected,'reader_md5','21241121f4e4fe29a7becb1ff692d722',
    'witness_md5','a101812df22c1dfb379ebc325bd7d6d0','input_key',v_l_key,'witness',v_l_witness,'counts',v_l_counts);
   v_l_value:=v_l_value||jsonb_build_object('proof_md5',md5(v_l_value::text));
   INSERT INTO public.accounting_close_partials AS current_proof(kind,union_id,period_start,period_end,window_start,window_end,value,computed_at)
   VALUES('pnl_linked_window',p_union_id,p_start,p_end,w.window_start,w.window_end,v_l_value,clock_timestamp())
   ON CONFLICT(kind,union_id,period_start,period_end,window_start)DO UPDATE SET
    window_end=EXCLUDED.window_end,value=EXCLUDED.value,cash_ids=NULL,cash_md5=NULL,fee_ids=NULL,fee_md5=NULL,computed_at=EXCLUDED.computed_at
   WHERE current_proof.window_end IS DISTINCT FROM EXCLUDED.window_end OR current_proof.value IS DISTINCT FROM EXCLUDED.value
    OR current_proof.cash_ids IS NOT NULL OR current_proof.cash_md5 IS NOT NULL OR current_proof.fee_ids IS NOT NULL OR current_proof.fee_md5 IS NOT NULL
    OR NOT isfinite(current_proof.computed_at)OR current_proof.computed_at<p_end
    OR current_proof.computed_at<=clock_timestamp()-public.fn_accounting_close_proof_lifetime()OR current_proof.computed_at>clock_timestamp();
   -- Revalidate after the upsert while its row lock is held: a stale worker
   -- must roll back rather than overwrite a newer committed window proof.
   IF v_l_witness IS DISTINCT FROM smarter_private.weekly_hand_parts_witness(p_union_id,w.window_start,w.window_end,v_hand_projected)
    THEN RAISE EXCEPTION 'weekly_linked_parts_sources_changed_during_write';END IF;
   proved:=true;
   -- Batch sound empty units within the original stop budget. At most one
   -- nonempty canonical reader call is allowed in any original attempt.
   IF (v_l_witness->>'links')::bigint>0 THEN RETURN false;END IF;
  END LOOP;
  IF proved THEN RETURN false;END IF;
 END IF;

 IF EXISTS(SELECT FROM public.accounting_close_partials p WHERE p.kind='pnl_hands_window' AND p.union_id=p_union_id AND p.period_start=p_start AND p.period_end=p_end
 AND NOT EXISTS(SELECT FROM public.fn_accounting_close_windows(p_start,p_end)cw WHERE cw.window_start=p.window_start)) THEN RAISE EXCEPTION 'weekly_hand_parts_noncanonical_window';END IF;
 FOR w IN SELECT * FROM public.fn_accounting_close_windows(p_start,p_end) ORDER BY 1 LOOP
  v_hand_witness:=smarter_private.weekly_hand_parts_witness(p_union_id,w.window_start,w.window_end,v_hand_projected);
  CONTINUE WHEN EXISTS(SELECT FROM public.accounting_close_partials p WHERE p.kind='pnl_hands_window' AND p.union_id=p_union_id AND p.period_start=p_start AND p.period_end=p_end AND p.window_start=w.window_start AND p.window_end=w.window_end
   AND p.computed_at>=p_end AND p.computed_at>clock_timestamp()-public.fn_accounting_close_proof_lifetime()
   AND p.computed_at<=clock_timestamp() AND jsonb_typeof(p.value->'groups')='array' AND p.value->>'groups_md5'=md5((p.value->'groups')::text)
   AND p.value->>'generation' IS NOT DISTINCT FROM v_generation AND p.value->'projected' IS NOT DISTINCT FROM to_jsonb(v_hand_projected)
   AND p.value->>'contract' IS NOT DISTINCT FROM '9dee2921c7b956281be61a3eb9d7df6e' AND p.value->'witness' IS NOT DISTINCT FROM v_hand_witness);
  IF proved AND clock_timestamp()>stop_at THEN RETURN false;END IF;
  DELETE FROM public.accounting_close_certificates WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end AND kind IN('pnl_clubs','pnl_clubs_problem');
  v_hand_groups:=smarter_private.weekly_hand_parts_reduce(p_union_id,w.window_start,w.window_end,v_hand_projected);
  IF v_hand_witness IS DISTINCT FROM smarter_private.weekly_hand_parts_witness(p_union_id,w.window_start,w.window_end,v_hand_projected) THEN RAISE EXCEPTION 'weekly_hand_parts_sources_changed_during_window';END IF;
  INSERT INTO public.accounting_close_partials(kind,union_id,period_start,period_end,window_start,window_end,value,computed_at)
  VALUES('pnl_hands_window',p_union_id,p_start,p_end,w.window_start,w.window_end,jsonb_build_object('generation',v_generation,'projected',v_hand_projected,'contract','9dee2921c7b956281be61a3eb9d7df6e','witness',v_hand_witness,'groups',v_hand_groups,'groups_md5',md5(v_hand_groups::text)),clock_timestamp())
  ON CONFLICT(kind,union_id,period_start,period_end,window_start) DO UPDATE SET window_end=EXCLUDED.window_end,value=EXCLUDED.value,cash_ids=NULL,cash_md5=NULL,fee_ids=NULL,fee_md5=NULL,computed_at=EXCLUDED.computed_at;
  proved:=true;
 END LOOP;
 IF proved THEN RETURN false;END IF;
 IF smarter_private.weekly_hand_parts_read(p_union_id,p_start,p_end,v_generation,v_hand_projected) IS NULL THEN RETURN false;END IF;
 RETURN true;
 END IF;
 FOR w IN SELECT * FROM public.fn_accounting_close_windows(p_start,p_end) ORDER BY 1 LOOP
  -- A window that found a problem is re-proved after an hour, as the report
  -- re-proves a week whose flows found one.
  CONTINUE WHEN EXISTS(SELECT 1 FROM public.accounting_close_partials p WHERE p.kind='pnl_flows_window' AND p.union_id=p_union_id
   AND p.period_start=p_start AND p.period_end=p_end AND p.window_start=w.window_start AND p.window_end=w.window_end
   AND p.computed_at>=p_end AND p.computed_at>clock_timestamp()-public.fn_accounting_close_proof_lifetime()
   AND (p.value->>'bad'='0' OR p.computed_at>clock_timestamp()-interval '1 hour')
   AND p.value->>'generation' IS NOT DISTINCT FROM v_generation);
  IF proved AND clock_timestamp()>stop_at THEN RETURN false; END IF;
  SELECT count(*) FILTER(WHERE NOT f.valid),COALESCE(jsonb_agg(to_jsonb(f)),'[]') INTO v_bad,v_flows
   FROM smarter_private.union_pnl_original_flow_evidence_window(p_union_id,p_start,p_end,w.window_start,w.window_end) f;
  INSERT INTO public.accounting_close_partials(kind,union_id,period_start,period_end,window_start,window_end,value,computed_at)
  VALUES('pnl_flows_window',p_union_id,p_start,p_end,w.window_start,w.window_end,
   jsonb_build_object('generation',v_generation,'bad',v_bad,'flows',v_flows),clock_timestamp())
  ON CONFLICT(kind,union_id,period_start,period_end,window_start) DO UPDATE SET window_end=EXCLUDED.window_end,value=EXCLUDED.value,
   cash_ids=NULL,cash_md5=NULL,fee_ids=NULL,fee_md5=NULL,computed_at=EXCLUDED.computed_at;
  proved:=true;
 END LOOP;
 IF proved THEN RETURN false; END IF;
 -- Every window is fresh: the week's flows are its windows' flows and the two
 -- whole-week return families, the same rows the week proof returns.
 SELECT count(*),count(p.window_start) INTO v_windows,v_fresh
  FROM public.fn_accounting_close_windows(p_start,p_end) cw
  LEFT JOIN public.accounting_close_partials p ON p.kind='pnl_flows_window' AND p.union_id=p_union_id
   AND p.period_start=p_start AND p.period_end=p_end AND p.window_start=cw.window_start AND p.window_end=cw.window_end
   AND p.computed_at>=p_end AND p.computed_at>clock_timestamp()-public.fn_accounting_close_proof_lifetime()
   AND (p.value->>'bad'='0' OR p.computed_at>clock_timestamp()-interval '1 hour')
   AND p.value->>'generation' IS NOT DISTINCT FROM v_generation;
 IF v_windows=0 OR v_fresh<>v_windows THEN RETURN false; END IF;
 WITH parts AS MATERIALIZED (
  SELECT p.value FROM public.fn_accounting_close_windows(p_start,p_end) cw
  JOIN public.accounting_close_partials p ON p.kind='pnl_flows_window' AND p.union_id=p_union_id
   AND p.period_start=p_start AND p.period_end=p_end AND p.window_start=cw.window_start AND p.window_end=cw.window_end
 ), tails AS MATERIALIZED (
  SELECT t.* FROM smarter_private.original_restoration_cash_returns(p_union_id,p_start,p_end) t(ledger_id,club_id,user_id,buyins,cashouts,kind,valid)
  UNION ALL
  SELECT t.* FROM smarter_private.original_erased_cash_discharge_returns(p_union_id,p_start,p_end) t(ledger_id,club_id,user_id,buyins,cashouts,kind,valid)
 ) SELECT COALESCE((SELECT sum((value->>'bad')::bigint) FROM parts),0)+(SELECT count(*) FILTER(WHERE NOT valid) FROM tails),
  COALESCE((SELECT jsonb_agg(x.flow) FROM (SELECT e.flow FROM parts CROSS JOIN LATERAL jsonb_array_elements(parts.value->'flows') e(flow)
   UNION ALL SELECT to_jsonb(t) FROM tails t) x),'[]')
 INTO v_bad,v_flows;
 IF v_bad=0 THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_flows',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad,'flows',v_flows));
 ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_flows_problem',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad,'flows',v_flows)); END IF;
 -- Assembling the certificate is the attempt's step; the report reads it next.
 RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT count(*)=69 AND bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND md5(pg_get_functiondef(p.oid)) IS NOT DISTINCT FROM x.body_md5)
 FROM(VALUES ('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)','b171ac61a57a9ce56c46a6529676c604'),('public.fn_union_pnl_inventory_state(timestamptz,timestamptz)','d77f5ad055ee433875efed7fd53bd25a'),('public.fn_union_pnl_inventory_population(timestamptz,timestamptz)','449f6f13feefe0d7e26e767a3465bc67'),('public.fn_union_pnl_inventory_as_of(timestamptz)','85513ff85d2b37ad04b79f89e125f1aa'),('smarter_private.original_retirement_boundary_proof(jsonb,timestamptz,timestamptz)','56457798f46f7c06a32b0e52915740a0'),('smarter_private.original_paired_seat_restoration_proof(jsonb,jsonb,timestamptz,timestamptz)','ada80c7f667ca7dad36cf223c80c3a6a'),('smarter_private.original_closed_tournament_rails_proof(jsonb,timestamptz)','a9319182a566e9917353765c414a1aa1'),('smarter_private.original_closed_player_proof(jsonb,timestamptz,timestamptz)','a441c3abe887cc4528268e347916d236'),('smarter_private.original_continued_chair_proof(jsonb,timestamptz,timestamptz)','8876018a8370a99f4012696cb264c740'),('smarter_private.original_returned_cash_base_proof(jsonb,timestamptz,timestamptz)','7ed06b6ccded0d6eb2bc3357742e360d'),('smarter_private.original_erased_cash_base_proof(jsonb,timestamptz)','a2d5ac28a5f07929ed99d6e871dddfa2'),('smarter_private.original_inventory_source_ref_md5(jsonb)','81fba77f13564999931e8a7a47cbd609'),('smarter_private.original_inventory_finite_witness(bigint)','0ef0a8a5b9e85633cf4bf8b0cd15c8d7'),('smarter_private.original_inventory_finite_family_proof(text,jsonb,timestamptz,timestamptz)','dd7861e20f4c90567a704cb2625962b8'),('smarter_private.original_erased_cash_base_request(bigint,text)','1467e44cc7f7871b34eff07f7038019d'),('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)','58b6c79c412a9e3b26104c0b4b6878d6'),('public.fn_platform_frozen()','ec683805e052fceeae74789e82dce4cc'),('public.fn_active_maintenance_release_boundary()','05b537b57c9f51a5164e20a1cd0e67e0'),('smarter_private.original_inventory_case_insert_guard()','d9bcabf711efa4c81c0ae7567897b722'),('smarter_private.original_inventory_certificate_insert_guard()','d4956b2b4c0a58bb5dc57b35e3e884ce'),('smarter_private.original_inventory_restoration_immutable()','6c939d278f5fad857bd97437dfaa5f4d'),('smarter_private.certify_original_inventory_restoration(bigint,timestamptz)','f5db14badd4a6b07c0f4b82e2ec5cb1e'),('smarter_private.inventory_restoration_issue_accepted(jsonb,timestamptz)','fdba882b3557f6ffd1cc29129773ff04'),('public.fn_union_pnl_boundary(uuid,timestamptz)','5e4e878524a91518de209bc5e008db36'),('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)','b23655a15587192f137ae4ad57859742'),('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)','80f29ec1270de41106ee6302153a7cfe'),('smarter_private.inventory_basis_cache_read(text,boolean,text,uuid,timestamptz,timestamptz)','058d499ade9d0609f83cc07d551b7f35'),('smarter_private.inventory_basis_cache_write(text,text,uuid,timestamptz,timestamptz,jsonb)','2c3f0af276c29f33d09cdb7ecd86df6a'),('smarter_private.original_inventory_basis_generation()','58dc20e1ba380ccb9b9dee8809731d33'),('public.fn_accounting_close_certificate(text,uuid,timestamptz,timestamptz)','7b4a5f4572a45db069b6058899614021'),('public.fn_accounting_close_problem(text,uuid,timestamptz,timestamptz)','9667c8b8c5aa74bf2ad2c57fbfa3991d'),('public.fn_accounting_close_certify(text,uuid,timestamptz,timestamptz,jsonb)','58501728a93f9f4534dbf26d26aba63f'),('public.fn_union_pnl_inventory_as_of_admitted(timestamptz)','d65a33c20fb224c1dc2cc1ecb8168940'),('smarter_private.original_erased_cash_base_expected_hash(bigint)','afe5941dd7c4bbcccbfadc5d65a4f447'),('smarter_private.original_erased_cash_base_discharge_receipt(bigint,text)','f2c22efcfd9231094732ca82edff9101'),('smarter_private.original_erased_cash_base_discharge_evidence_valid(bigint,text,jsonb)','d4bc8b8d57c9037805a735bc1bb2be21'),('smarter_private.original_erased_cash_base_discharge(bigint,text)','9e6fcbf606004b81353a7704b50f072f'),('smarter_private.original_erased_cash_receivables(uuid,timestamptz)','0c53bd1f7fd7d22117af340ee02769d6'),('smarter_private.original_erased_cash_discharge_returns(uuid,timestamptz,timestamptz)','2a41fe7ccedc2947cf3ab84cead2493c'),('smarter_private.original_restoration_cash_returns(uuid,timestamptz,timestamptz)','e7cecf308d34108e12c0006029c1a3fa'),('public.fn_union_week_start(timestamptz)','103f192a228084dad0e4268c36c82c4b'),('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','c4ea982db893a45aade32874bd7cd495'),('public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)','faf875701e49db1cf99b481119e87404'),('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)','911c6c96b4dfe66bff7bdcfb00eb94d2'),('smarter_private.original_treasury_witness_immutable()','f6326523741592230d149799b876e886'),('smarter_private.original_treasury_gift_evidence(uuid)','df84a641f40ee44d9db83e979398f9af'),('smarter_private.admit_original_treasury_gift(uuid)','07c857f67488e000ecbaf63e083c1c05'),('smarter_private.original_treasury_return_evidence(uuid)','3f2b8626b018cc5d22d9ebe9e6d3fb72'),('smarter_private.admit_original_treasury_return(uuid)','c51b45b085ac1a26f043711804ff8d00'),('smarter_private.cash_initial_funding_receipt(uuid)','e111dad7c0f5d5e3b74710053835caa4'),('smarter_private.original_treasury_participant_gift(jsonb,uuid,timestamptz)','95b9a25f9a422bb7d8df115f86bc5993'),('smarter_private.original_treasury_cash_outcome_evidence(jsonb)','12c94769bbcd6eb2c3349728cdc8512d'),('public.fn_horse_seat_from_treasury(uuid,uuid,integer,numeric,uuid)','4a7cee2cfecdf7a36446c169f754ccd0'),('public.fn_cash_record_original_funding(text,text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid)','d01404c53405fd1826de26e58b04f4b1'),('public.fn_cash_original_funding_lineage(uuid,uuid,uuid,uuid,timestamptz,timestamptz,boolean)','8269577929892d8634e32dcfac08ff77'),('public.fn_pnl_cash_hand_evidence(uuid,bigint)','43820fe60b759bd93f6838f908122c96'),('public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)','1a5e66c29d3d36e41752589d59daa478'),('public.fn_cash_earning_club(uuid,uuid,uuid,uuid,uuid)','2ba3a2891019b46e06b46b4c642e566a'),('public.fn_ca_cash_seat_club(uuid,uuid)','148f2246fc0ee3ab11cd86456765e419'),('public.fn_union_pnl_week_hand_lines(uuid,timestamptz,timestamptz,boolean)','9dee2921c7b956281be61a3eb9d7df6e'),('smarter_private.weekly_hand_parts_read(uuid,timestamptz,timestamptz,text,boolean)','d427fd27d163ba72a7dc3cd50866163d'),('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)','a101812df22c1dfb379ebc325bd7d6d0'),('public.fn_claim_entry_purchase_receipt(text,text,jsonb)','4a10a4e1cfd2794046a6cb8ad1463de6'),('public.fn_horse_seat_from_treasury_before_maintenance_gate(uuid,uuid,integer,numeric,uuid)','ad64ff6223a433108f4f3625de1be3be'),('smarter_private.original_treasury_seat_money_core(uuid,uuid,integer,numeric,uuid)','d768afe805ed480569b44ef107d15675'),('public.fn_union_pnl_cash_outcome_accepted(public.union_pnl_cash_outcomes)','a7c0b003d24f5ae64cf440ce94d52d93'),('public.fn_ca_assert_satellite_value_ticket(uuid )','c309132fdcfa88899920a2969a20cee9'),('public.fn_poker_diamond_tournament(uuid )','c91028508fecc2d02e9003f2bdc2e38d'),('public.fn_tournament_entry_split(numeric,numeric,numeric,boolean )','89cc73d13fe8fbe6905233c8f9f74848'))x(signature,body_md5) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(x.signature);
$function$
;
DO $post$BEGIN IF NOT(md5(pg_get_functiondef('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)'::regprocedure))='b171ac61a57a9ce56c46a6529676c604' AND md5(pg_get_functiondef('fn_union_pnl_linked_cash_outcomes(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))='21241121f4e4fe29a7becb1ff692d722' AND md5(pg_get_functiondef('smarter_private.weekly_hand_parts_witness(uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure))='a101812df22c1dfb379ebc325bd7d6d0' AND md5(pg_get_functiondef('fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))='80f29ec1270de41106ee6302153a7cfe' AND md5(pg_get_functiondef('fn_accounting_union_earned_plan_advance(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure))='911c6c96b4dfe66bff7bdcfb00eb94d2' AND md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))='866cccb1eb119003fb3fd21bb517a3f3')OR smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true OR smarter_private.original_inventory_basis_generation()IS NULL OR smarter_private.original_inventory_basis_generation()IS NOT DISTINCT FROM current_setting('app.original_lightning_owner_pre_generation',true)THEN RAISE EXCEPTION 'LIGHTNING_OWNER_POSTIMAGE_CHANGED';END IF;END$post$;
DO $metadata$BEGIN IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure AND proowner='postgres'::regrole AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]AND provolatile='v'AND prosecdef=true)THEN RAISE EXCEPTION 'LIGHTNING_OWNER_AUTHORITY_CHANGED';END IF;END$metadata$;
DO $metadata$BEGIN IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='fn_union_pnl_linked_cash_outcomes(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure AND proowner='postgres'::regrole AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp','enable_nestloop=off']::text[]AND provolatile='s'AND prosecdef=false)THEN RAISE EXCEPTION 'LIGHTNING_OWNER_AUTHORITY_CHANGED';END IF;END$metadata$;
DO $metadata$BEGIN IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='fn_accounting_union_earned_plan_advance(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure AND proowner='postgres'::regrole AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[]AND provolatile='v'AND prosecdef=false)THEN RAISE EXCEPTION 'LIGHTNING_OWNER_AUTHORITY_CHANGED';END IF;END$metadata$;
DO $metadata$BEGIN IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='smarter_private.original_inventory_proof_sources_match()'::regprocedure AND proowner='postgres'::regrole AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]AND provolatile='s'AND prosecdef=false)THEN RAISE EXCEPTION 'LIGHTNING_OWNER_AUTHORITY_CHANGED';END IF;END$metadata$;
DO $metadata$BEGIN IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='smarter_private.weekly_hand_parts_witness(uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure AND proowner='postgres'::regrole AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public, smarter_private']::text[]AND provolatile='s'AND prosecdef=false)THEN RAISE EXCEPTION 'LIGHTNING_OWNER_AUTHORITY_CHANGED';END IF;END$metadata$;
DO $helper_metadata$BEGIN IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)'::regprocedure AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres}'AND NOT prosecdef AND provolatile='s'AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private','TimeZone=UTC','enable_nestloop=on'])THEN RAISE EXCEPTION 'LIGHTNING_OWNER_HELPER_AUTHORITY_CHANGED';END IF;END$helper_metadata$;
COMMIT;
