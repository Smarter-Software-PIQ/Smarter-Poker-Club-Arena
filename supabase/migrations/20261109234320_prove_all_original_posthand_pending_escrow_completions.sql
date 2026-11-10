-- Original pending escrow belongs to the completed hand event, never poker profit.
-- Prove every original pending participant/receipt, including first occupancy,
-- rebuy, during-hand arrivals and partial/full refunds. Preserve immutable old
-- certificates and all signed financial originals. No money/status replay.
-- The 9.9M-row predecessor table has no table/time range cover; bounded reads
-- timed out. A skinny concurrent cover and private generic-only scalar lookup
-- are prerequisites before this proof enters the original financial event.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)'::regprocedure))='acd3dfc914dca2aff6ab5c1505169ef6' AND md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure))='8b81e8bb218cacb235832285e4fbbb24' AND md5(pg_get_functiondef('smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid)'::regprocedure))='8f4d01a26e41dcb1cbc82c75e2c6a483')
CREATE INDEX CONCURRENTLY IF NOT EXISTS cash_hand_provenance_table_time_cover
 ON public.cash_hand_provenance_receipts(table_id,accepted_at,hand_number);
BEGIN;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog,public;
CREATE TEMP TABLE posthand_temporal_install_before ON COMMIT DROP AS
 SELECT clock_timestamp() AS started,
  md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))AS matcher,
  pg_get_functiondef('smarter_private.original_inventory_basis_generation()'::regprocedure)AS generation_source,
  smarter_private.original_inventory_basis_generation()AS generation;
DO $admission$
DECLARE sig text;old_hash text;p pg_proc;
BEGIN
 IF session_user<>'postgres'OR current_user<>'postgres'OR NULLIF(current_setting('request.jwt.claims',true),'')IS NOT NULL
  OR public.fn_platform_frozen()IS DISTINCT FROM false
  OR smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_OPERATOR_OR_SOURCE_REFUSED';END IF;
 IF to_regprocedure('smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid)')IS NOT NULL THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_ALREADY_INSTALLED';END IF;
 IF NOT EXISTS(SELECT FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE i.indexrelid=to_regclass('public.cash_hand_provenance_table_time_cover')AND i.indrelid='public.cash_hand_provenance_receipts'::regclass
   AND c.relowner='postgres'::regrole AND c.relkind='i'AND c.relpersistence='p'AND c.reloptions IS NULL
   AND i.indisvalid AND i.indisready AND i.indislive AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
   AND pg_get_indexdef(i.indexrelid)='CREATE INDEX cash_hand_provenance_table_time_cover ON public.cash_hand_provenance_receipts USING btree (table_id, accepted_at, hand_number)')THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_EXACT_VALID_COVER_REQUIRED';END IF;
 FOR sig,old_hash IN SELECT *FROM(VALUES
  ('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)','ebe63c0e31d896db9c716d905b267f6a'),
  ('public.fn_ca_process_hand_post_commit_obligations(uuid)','138258e305d8086d08e7786bddad813b'))v(s,h)LOOP
  SELECT *INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF md5(pg_get_functiondef(p.oid))IS DISTINCT FROM old_hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
   OR p.provolatile IS DISTINCT FROM(CASE WHEN sig LIKE '%prove_posthand%'THEN 's'::"char"ELSE 'v'::"char"END)
   OR p.proconfig IS DISTINCT FROM(CASE WHEN sig LIKE '%prove_posthand%'THEN ARRAY['search_path=public, pg_temp','TimeZone=UTC']ELSE ARRAY['search_path=public, extensions, pg_temp']END)
   THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_PREIMAGE_OR_METADATA_CHANGED: %',sig;END IF;
  IF EXISTS(SELECT FROM pg_proc q JOIN pg_namespace n ON n.oid=q.pronamespace WHERE n.nspname IN('public','smarter_private')AND q.prokind='f'AND q.oid<>p.oid AND position(old_hash IN pg_get_functiondef(q.oid))>0)THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_DEPENDENT_PIN_CHANGED: %',sig;END IF;
 END LOOP;
END$admission$;

CREATE FUNCTION smarter_private.original_cash_hand_predecessor(p_table uuid,p_number bigint,p_join timestamptz,p_occupancy uuid)
 RETURNS SETOF public.cash_hand_provenance_receipts
 LANGUAGE sql STABLE
 SET search_path TO 'pg_catalog', 'public'
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
 -- Restrict generic planning to this one scalar lookup; PostgreSQL restores
 -- the caller's planner setting on return and on error. No financial helper
 -- executes inside this scope.
 WITH original_keys AS MATERIALIZED(
  SELECT pr.hand_number FROM public.cash_hand_provenance_receipts pr
   WHERE pr.table_id=p_table AND pr.hand_number<p_number AND pr.accepted_at>=p_join
 ), ordered_keys AS(SELECT k.hand_number FROM original_keys k ORDER BY k.hand_number DESC OFFSET 0)
 SELECT original.* FROM ordered_keys k CROSS JOIN LATERAL(
  SELECT pr.*FROM public.cash_hand_provenance_receipts pr WHERE pr.table_id=p_table AND pr.hand_number=k.hand_number
   AND pr.participants @>jsonb_build_array(jsonb_build_object('occupancy_id',p_occupancy::text))OFFSET 0
 )original ORDER BY k.hand_number DESC LIMIT 1
$function$;
REVOKE ALL ON FUNCTION smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid)FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_union_pnl_prove_posthand_escrow(p_table uuid, p_number bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE o union_pnl_cash_outcomes; p cash_hand_provenance_receipts; m cash_hand_participant_manifests;
 a hand_atomic_commits; prev cash_hand_provenance_receipts; f cash_participant_funding_receipts; app cash_funding_application_receipts;
 cert smarter_private.posthand_escrow_certificates; retained boolean; live boolean; completed_at timestamptz; pending_ids jsonb; result jsonb;
 affected uuid; affected_users uuid[]; expected_issues jsonb; part jsonb; original jsonb; lin jsonb; ref jsonb; owned uuid; refs uuid[]; total numeric:=0;
 v_n bigint; v_refund_ledger uuid;
 before_stack numeric; after_stack numeric; prev_stack numeric; submitted jsonb; proof_people jsonb:='[]'; witness union_pnl_inventory_events;
BEGIN
 SELECT * INTO o FROM union_pnl_cash_outcomes WHERE table_id=p_table AND hand_number=p_number;
 IF NOT FOUND OR o.evidence->>'status' IS DISTINCT FROM 'blocked'
  OR o.evidence->'all_players_included' IS DISTINCT FROM 'true'::jsonb
  OR o.evidence->'game_scope' IS DISTINCT FROM o.game_scope
  OR o.transaction_id IS NULL OR o.recognized_at IS NULL OR NOT isfinite(o.recognized_at)
  OR NOT EXISTS(SELECT 1 FROM union_pnl_transaction_frames fr WHERE fr.transaction_id=o.transaction_id AND fr.observed_at=o.recognized_at) THEN RAISE EXCEPTION 'escrow_refused:blocked_original_population_required';END IF;
 SELECT * INTO STRICT p FROM cash_hand_provenance_receipts WHERE table_id=p_table AND hand_number=p_number;
 SELECT * INTO STRICT m FROM cash_hand_participant_manifests WHERE id=p.manifest_id;
 IF (p.table_id,p.hand_number,p.hand_id,p.payload_hash,p.game_scope) IS DISTINCT FROM (o.table_id,o.hand_number,o.hand_id,o.payload_hash,o.game_scope)
  OR (m.table_id,m.hand_number,m.game_scope) IS DISTINCT FROM (p_table,p_number,o.game_scope)
  OR m.issues IS DISTINCT FROM p.issues OR p.status IS DISTINCT FROM 'uncertified'
  OR p.funding_provenance_complete IS DISTINCT FROM false OR p.all_players_included IS DISTINCT FROM true
  OR p.accepted_at IS NULL OR NOT isfinite(p.accepted_at) OR m.captured_at IS NULL OR NOT isfinite(m.captured_at) OR m.captured_at>o.recognized_at OR o.recognized_at>p.accepted_at
  OR o.game_scope->>'asset' IS DISTINCT FROM 'chips' OR o.game_scope->'unit_scale' IS DISTINCT FROM '2'::jsonb
  OR o.game_scope->'tournament_id' IS DISTINCT FROM 'null'::jsonb
  OR pg_input_is_valid(o.game_scope->>'host_club_id','uuid') IS DISTINCT FROM true
  OR pg_input_is_valid(o.game_scope->>'game_union_id','uuid') IS DISTINCT FROM true
  OR jsonb_typeof(o.game_scope->'is_private') IS DISTINCT FROM 'boolean'
  OR NOT o.game_scope ?& ARRAY['host_club_id','game_union_id','asset','unit_scale','is_private','tournament_id']
  OR p.accepted_request->>'table_id' IS DISTINCT FROM p_table::text OR p.accepted_request->>'hand_number' IS DISTINCT FROM p_number::text
  OR NOT public.fn_cash_signed_retained_request_matches(p_table,p_number,p.payload_hash,p.accepted_request) THEN
  RAISE EXCEPTION 'escrow_refused:original_identity_or_signature_disagrees';END IF;
 SELECT array_agg(DISTINCT(x->>'user_id')::uuid ORDER BY(x->>'user_id')::uuid)INTO affected_users
 FROM jsonb_array_elements(m.issues)x;
 IF cardinality(affected_users)NOT BETWEEN 1 AND 10 OR cardinality(affected_users)IS NULL
  OR jsonb_array_length(m.issues)<>2*cardinality(affected_users)
  OR EXISTS(SELECT 1 FROM unnest(affected_users)u WHERE
   (SELECT count(*)FROM jsonb_array_elements(m.issues)i WHERE i=jsonb_build_object('reason','pending_funding_application_unproven','user_id',u))<>1
   OR(SELECT count(*)FROM jsonb_array_elements(m.issues)i WHERE i->>'reason'='original_cash_move_lineage_unproven'AND i->>'user_id'=u::text
    AND jsonb_typeof(i->'details')='array'AND jsonb_array_length(i->'details')>0
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i->'details')d WHERE d<>'"pending_funding_application_unproven"'::jsonb)
    AND i=jsonb_build_object('reason','original_cash_move_lineage_unproven','user_id',u,'details',i->'details'))<>1)THEN
  RAISE EXCEPTION 'escrow_refused:only_exact_pending_escrow_defects_qualify';END IF;
 affected:=affected_users[1];
 SELECT jsonb_build_array('original_cash_funding_incomplete')||m.issues||COALESCE(jsonb_agg(
  jsonb_build_object('reason','participant_earning_ownership_receipt_invalid','user_id',x->>'user_id')ORDER BY ord),'[]'::jsonb)
 INTO expected_issues FROM jsonb_array_elements(p.participants)WITH ORDINALITY p(x,ord)
 WHERE(x->>'user_id')::uuid=ANY(affected_users);
 IF o.evidence->'issues'IS DISTINCT FROM expected_issues THEN
  RAISE EXCEPTION 'escrow_refused:only_exact_pending_escrow_defects_qualify';END IF;
 SELECT * INTO cert FROM smarter_private.posthand_escrow_certificates WHERE table_id=p_table AND hand_number=p_number;
 retained:=FOUND;
 IF retained AND (cert.hand_id IS DISTINCT FROM o.hand_id
  OR cert.original_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(cert.original::text,'UTF8'),'sha256'),'hex')
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['source_financial_request_sha256','original_accounting_evidence_sha256','qualified_evidence_sha256','original_participant_roster_sha256','immutable_financial_sha256','original_atomic_sha256','compact_atomic_sha256','original_stack_result_sha256','original_stack_request_sha256','postcommit_payload_sha256','postcommit_request_sha256','postcommit_result_sha256']) name WHERE jsonb_typeof(cert.original->name) IS DISTINCT FROM 'string' OR cert.original->>name !~ '^[a-f0-9]{64}$')
  OR cert.original->'version' IS DISTINCT FROM '1'::jsonb
  OR cert.original->>'table_id' IS DISTINCT FROM p_table::text OR cert.original->>'hand_number' IS DISTINCT FROM p_number::text
  OR cert.original->>'hand_id' IS DISTINCT FROM o.hand_id::text OR cert.original->>'manifest_id' IS DISTINCT FROM p.manifest_id::text
  OR (cert.original->>'accepted_at')::timestamptz IS DISTINCT FROM p.accepted_at
  OR cert.original->>'source_financial_request_sha256' IS DISTINCT FROM p.payload_hash
  OR cert.original->>'original_accounting_evidence_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(o.evidence::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'original_participant_roster_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(p.participants::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'immutable_financial_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to((to_jsonb(p)-ARRAY['accepted_request','atomic_receipt','accepted_at'])::text,'UTF8'),'sha256'),'hex')
  OR (encode(extensions.digest(convert_to(p.atomic_receipt::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM cert.original->>'original_atomic_sha256'
   AND encode(extensions.digest(convert_to(p.atomic_receipt::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM cert.original->>'compact_atomic_sha256')
  OR cert.original->>'stack_hand_id' IS DISTINCT FROM p.atomic_receipt#>>'{stack_result,hand_id}'
  OR cert.original->>'original_stack_result_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to((p.atomic_receipt->'stack_result')::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'original_stack_request_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to((p.atomic_receipt#>'{stack_result,request}')::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'postcommit_payload_sha256' IS NULL OR cert.original->>'postcommit_payload_sha256' !~ '^[a-f0-9]{64}$'
  OR cert.original->>'postcommit_request_sha256' IS NULL OR cert.original->>'postcommit_request_sha256' !~ '^[a-f0-9]{64}$'
  OR cert.original->>'postcommit_result_sha256' IS NULL OR cert.original->>'postcommit_result_sha256' !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(cert.original->'pending_ids') IS DISTINCT FROM 'array'
  OR(CASE WHEN cert.original#>>'{proof,resolution_kind}'='original_unplayed_pending_escrow_completed_after_signed_hand' THEN
   jsonb_array_length(cert.original->'pending_ids')<1
    OR(SELECT count(DISTINCT x)FROM jsonb_array_elements_text(cert.original->'pending_ids')x)<>jsonb_array_length(cert.original->'pending_ids')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(cert.original->'pending_ids')x WHERE jsonb_typeof(x)<>'string'OR NOT pg_input_is_valid(x#>>'{}','uuid'))
   ELSE(jsonb_array_length(cert.original->'pending_ids')<>1 AND NOT(jsonb_array_length(cert.original->'pending_ids')=0
    AND cert.original#>>'{proof,resolution_kind}'='original_pending_escrow_returned_to_wallet'))
    OR(jsonb_array_length(cert.original->'pending_ids')>0 AND NOT pg_input_is_valid(cert.original#>>'{pending_ids,0}','uuid'))END)
  OR cert.original->>'committed_at' IS NULL OR cert.original->>'completed_at' IS NULL
  OR NOT isfinite((cert.original->>'committed_at')::timestamptz) OR NOT isfinite((cert.original->>'completed_at')::timestamptz)
  OR (cert.original->>'completed_at')::timestamptz<(cert.original->>'committed_at')::timestamptz) THEN
  RAISE EXCEPTION 'escrow_refused:immutable_original_postcommit_certificate_disagrees';END IF;
 SELECT * INTO a FROM hand_atomic_commits WHERE table_id=p_table AND hand_number=p_number;
 live:=FOUND;
 IF live THEN
 IF a.hand_id IS DISTINCT FROM o.hand_id OR a.payload_hash IS DISTINCT FROM o.payload_hash
  OR a.stack_result IS DISTINCT FROM p.atomic_receipt->'stack_result'
  OR p.atomic_receipt->>'table_id' IS DISTINCT FROM p_table::text OR p.atomic_receipt->>'hand_number' IS DISTINCT FROM p_number::text
  OR a.stack_result->'success' IS DISTINCT FROM 'true'::jsonb OR a.stack_result->'conservation_checked' IS DISTINCT FROM 'true'::jsonb
  OR a.post_commit_completed_at IS NULL OR NOT isfinite(a.post_commit_completed_at) OR a.post_commit_result->'ok' IS DISTINCT FROM 'true'::jsonb
  OR p.stack_claim->>'status' IS DISTINCT FROM 'succeeded' OR p.stack_claim->'result' IS DISTINCT FROM a.stack_result
  OR p.stack_settlement->>'state' IS DISTINCT FROM 'final'
  OR p.stack_claim->>'table_id' IS DISTINCT FROM p_table::text
  OR p.stack_claim->>'hand_id' IS DISTINCT FROM a.stack_result->>'hand_id'
  OR p.stack_settlement->>'hand_id' IS DISTINCT FROM a.stack_result->>'hand_id'
  OR NOT EXISTS(SELECT 1 FROM settlement_idempotency_keys k WHERE k.table_id=p_table AND k.hand_id=(a.stack_result->>'hand_id')::uuid
    AND k.status='succeeded' AND smarter_private.horse_settlement_original_result(k.table_id,k.hand_id,k.result)=a.stack_result)
  OR NOT EXISTS(SELECT 1 FROM ca_settlements c WHERE c.table_id=p_table AND c.hand_id=(a.stack_result->>'hand_id')::uuid
    AND c.state='final' AND c.totals=p.stack_settlement->'totals') THEN RAISE EXCEPTION 'escrow_refused:original_atomic_completion_required';END IF;
 submitted:=a.post_commit_payload-'accepted_hand_facts';
 IF jsonb_typeof(a.post_commit_payload) IS DISTINCT FROM 'object'
  OR a.post_commit_payload->>'version' IS DISTINCT FROM '1'
  OR jsonb_typeof(a.post_commit_payload->'accepted_hand_facts') IS DISTINCT FROM 'object'
  OR jsonb_typeof(a.post_commit_payload#>'{pending_addons,ids}') IS DISTINCT FROM 'array'
  OR encode(extensions.digest(convert_to(a.post_commit_payload::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM a.post_commit_payload_hash
  OR a.post_commit_result->>'hand_id' IS DISTINCT FROM a.hand_id::text
  OR a.post_commit_result->>'hand_number' IS DISTINCT FROM a.hand_number::text
  OR a.committed_at IS NULL OR NOT isfinite(a.committed_at) OR a.post_commit_completed_at<a.committed_at THEN
  RAISE EXCEPTION 'escrow_refused:original_postcommit_seal_disagrees';END IF;
 submitted:=submitted#-'{pending_addons,ids}';
 IF encode(extensions.digest(convert_to(submitted::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM a.post_commit_request_hash THEN
  RAISE EXCEPTION 'escrow_refused:original_postcommit_request_disagrees';END IF;

  completed_at:=a.post_commit_completed_at;pending_ids:=a.post_commit_payload#>'{pending_addons,ids}';
  IF retained AND (cert.original->>'postcommit_payload_sha256' IS DISTINCT FROM a.post_commit_payload_hash
   OR cert.original->>'postcommit_request_sha256' IS DISTINCT FROM a.post_commit_request_hash
   OR cert.original->>'postcommit_result_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(a.post_commit_result::text,'UTF8'),'sha256'),'hex')
   OR (cert.original->>'committed_at')::timestamptz IS DISTINCT FROM a.committed_at
   OR (cert.original->>'completed_at')::timestamptz IS DISTINCT FROM a.post_commit_completed_at
   OR cert.original->'pending_ids' IS DISTINCT FROM pending_ids) THEN
   RAISE EXCEPTION 'escrow_refused:retained_postcommit_certificate_conflicts_with_original_live';END IF;
 ELSE
  IF NOT retained OR p.atomic_receipt->>'table_id' IS DISTINCT FROM p_table::text
   OR p.atomic_receipt->>'hand_number' IS DISTINCT FROM p_number::text
   OR p.atomic_receipt->>'hand_id' IS DISTINCT FROM o.hand_id::text OR p.atomic_receipt->>'payload_hash' IS DISTINCT FROM o.payload_hash
   OR p.atomic_receipt#>'{stack_result,success}' IS DISTINCT FROM 'true'::jsonb
   OR p.atomic_receipt#>'{stack_result,conservation_checked}' IS DISTINCT FROM 'true'::jsonb
   OR p.stack_claim->>'status' IS DISTINCT FROM 'succeeded' OR p.stack_claim->'result' IS DISTINCT FROM p.atomic_receipt->'stack_result'
   OR p.stack_settlement->>'state' IS DISTINCT FROM 'final'
   OR NOT EXISTS(SELECT 1 FROM settlement_idempotency_keys k WHERE k.table_id=p_table AND k.hand_id=(p.atomic_receipt#>>'{stack_result,hand_id}')::uuid
    AND k.status='succeeded' AND smarter_private.horse_settlement_original_result(k.table_id,k.hand_id,k.result)=p.atomic_receipt->'stack_result')
   OR NOT EXISTS(SELECT 1 FROM ca_settlements c WHERE c.table_id=p_table AND c.hand_id=(p.atomic_receipt#>>'{stack_result,hand_id}')::uuid
    AND c.state='final' AND c.totals=p.stack_settlement->'totals') THEN
   RAISE EXCEPTION 'escrow_refused:retained_original_atomic_completion_required';END IF;
  IF EXISTS(SELECT 1 FROM smarter_private.horse_settlement_key_certificates k WHERE k.table_id=p_table AND k.hand_number=p_number
   AND ((k.history_hand_id,k.manifest_id,k.stack_hand_id) IS DISTINCT FROM (o.hand_id,p.manifest_id,(p.atomic_receipt#>>'{stack_result,hand_id}')::uuid)
    OR k.original_result_sha256 IS DISTINCT FROM cert.original->>'original_stack_result_sha256'
    OR k.original_request_sha256 IS DISTINCT FROM cert.original->>'original_stack_request_sha256'
    OR k.accounting_evidence_sha256 IS DISTINCT FROM cert.original->>'qualified_evidence_sha256'
    OR k.settled_at IS DISTINCT FROM (cert.original->>'completed_at')::timestamptz)) THEN
   RAISE EXCEPTION 'escrow_refused:original_retention_key_certificate_disagrees';END IF;
  completed_at:=(cert.original->>'completed_at')::timestamptz;pending_ids:=cert.original->'pending_ids';
 END IF;
 IF jsonb_typeof(p.participants) IS DISTINCT FROM 'array' OR jsonb_array_length(p.participants) NOT BETWEEN 2 AND 10
  OR jsonb_array_length(p.participants)<>jsonb_array_length(m.participants)
  OR jsonb_array_length(p.participants)<>jsonb_array_length(o.evidence->'participants')
  OR jsonb_array_length(p.participants)<>jsonb_array_length(p.accepted_request->'stacks')
  OR (SELECT count(DISTINCT x->>'user_id') FROM jsonb_array_elements(p.participants) x)<>jsonb_array_length(p.participants) THEN
  RAISE EXCEPTION 'escrow_refused:full_original_roster_required';END IF;
 FOR part IN SELECT x FROM jsonb_array_elements(p.participants) x LOOP
  before_stack:=fn_pnl_evidence_cents(part->'stack_before');after_stack:=fn_pnl_evidence_cents(part->'stack_after');
  IF before_stack IS NULL OR after_stack IS NULL OR before_stack<0 OR after_stack<0
   OR jsonb_typeof(part->'is_horse') IS DISTINCT FROM 'boolean' OR part->>'user_id' IS NULL OR part->>'seat_id' IS NULL OR part->>'occupancy_id' IS NULL OR part->>'seat_joined_at' IS NULL THEN
   RAISE EXCEPTION 'escrow_refused:strict_original_stack_and_identity_required';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(m.participants) x WHERE x->>'user_id'=part->>'user_id'
    AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
    AND x->>'seat_joined_at'=part->>'seat_joined_at' AND x->'is_horse'=part->'is_horse' AND x->'stack_before'=part->'stack_before'
    AND x->'funding_lineage'=part->'funding_lineage')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(p.accepted_request->'stacks') x WHERE x->>'user_id'=part->>'user_id'
    AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
    AND x->>'seat_joined_at'=part->>'seat_joined_at' AND fn_pnl_evidence_cents(x->'stack_before')=before_stack
    AND fn_pnl_evidence_cents(x->'stack')=after_stack)<>1
   OR (SELECT count(*) FROM jsonb_array_elements(p.atomic_receipt#>'{stack_result,request,stacks}') x WHERE x->>'user_id'=part->>'user_id'
    AND x->>'seat_id'=part->>'seat_id' AND x->>'seat_joined_at'=part->>'seat_joined_at'
    AND fn_pnl_evidence_cents(x->'stack_before')=before_stack AND fn_pnl_evidence_cents(x->'stack')=after_stack)<>1 THEN
   RAISE EXCEPTION 'escrow_refused:signed_original_player_disagrees';END IF;
  lin:=fn_cash_original_funding_lineage((part->>'user_id')::uuid,p_table,(part->>'seat_id')::uuid,(part->>'occupancy_id')::uuid,
   (part->>'seat_joined_at')::timestamptz,(part#>>'{funding_lineage,observed_at}')::timestamptz,false);
  IF lin->'issues' IS DISTINCT FROM '[]'::jsonb OR (lin-'issues') IS DISTINCT FROM ((part->'funding_lineage')-'issues')
   OR part#>'{funding_lineage,issues}' IS DISTINCT FROM (CASE WHEN(part->>'user_id')::uuid=ANY(affected_users)THEN(SELECT i->'details'FROM jsonb_array_elements(m.issues)i WHERE i->>'reason'='original_cash_move_lineage_unproven'AND i->>'user_id'=part->>'user_id')ELSE '[]'::jsonb END)
   OR jsonb_array_length(lin->'funding_receipts')=0 THEN RAISE EXCEPTION 'escrow_refused:original_lineage_disagrees';END IF;
  owned:=NULL;refs:=ARRAY[]::uuid[];
  FOR ref IN SELECT x FROM jsonb_array_elements(lin->'funding_receipts') x LOOP
   SELECT * INTO STRICT f FROM cash_participant_funding_receipts WHERE id=(ref->>'id')::uuid;
   IF f.id=ANY(refs) OR f.user_id IS DISTINCT FROM (part->>'user_id')::uuid OR f.account_type IS DISTINCT FROM 'player_wallet'
    OR f.account_entity_id IS DISTINCT FROM f.user_id OR f.funding_club_id IS NULL OR (owned IS NOT NULL AND owned<>f.funding_club_id)
    OR f.funding_union_id::text IS DISTINCT FROM o.game_scope->>'game_union_id' OR f.asset IS DISTINCT FROM 'chips' OR f.unit_scale IS DISTINCT FROM 2
    OR f.amount IS NULL OR f.amount<=0 OR f.amount<>round(f.amount,2) OR f.amount::text IN('NaN','Infinity','-Infinity')
    OR f.balance_before-f.balance_after IS DISTINCT FROM f.amount THEN RAISE EXCEPTION 'escrow_refused:original_wallet_owner_or_debit_disagrees';END IF;
   owned:=f.funding_club_id;refs:=array_append(refs,f.id);
  END LOOP;
  IF (SELECT count(*) FROM cash_participant_funding_receipts WHERE id=ANY(refs) AND operation_kind='buyin')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(o.evidence->'participants') x WHERE x->>'user_id'=part->>'user_id'
    AND x->'is_horse'=part->'is_horse' AND fn_pnl_evidence_cents(x->'observed_stack_delta')=after_stack-before_stack
    AND x->>'ownership_scope'='original_chip_funding_club'
    AND (SELECT array_agg(id ORDER BY id) FROM jsonb_array_elements_text(x->'funding_receipt_ids') t(id))=
        (SELECT array_agg(id::text ORDER BY id::text) FROM unnest(refs) t(id))
    AND CASE WHEN(part->>'user_id')::uuid=ANY(affected_users)THEN x->'ownership_certified'='false'::jsonb AND x->'earning_club_id'='null'::jsonb
      ELSE x->'ownership_certified'='true'::jsonb AND x->>'earning_club_id'=owned::text END)<>1 THEN
   RAISE EXCEPTION 'escrow_refused:original_earning_ownership_disagrees';END IF;
  total:=total+after_stack-before_stack;
  proof_people:=proof_people||jsonb_build_array(jsonb_build_object('user_id',part->>'user_id','earning_club_id',owned,'funding_receipt_ids',refs,'poker_delta',after_stack-before_stack));
 END LOOP;
 IF p.signed_external_net IS DISTINCT FROM 0 OR fn_pnl_evidence_cents(p.accepted_request->'inflow') IS DISTINCT FROM 0
  OR p.rake IS NULL OR p.bbj IS NULL OR p.rake<0 OR p.bbj<0 OR total+p.rake+p.bbj IS DISTINCT FROM 0
  OR fn_pnl_evidence_cents(o.evidence->'accepted_rake') IS DISTINCT FROM p.rake
  OR fn_pnl_evidence_cents(o.evidence->'accepted_bbj') IS DISTINCT FROM p.bbj
  OR fn_pnl_evidence_cents(o.evidence->'accepted_external_net') IS DISTINCT FROM p.signed_external_net
  OR fn_pnl_evidence_cents(o.evidence->'observed_delta_total') IS DISTINCT FROM total
  OR fn_pnl_evidence_cents(p.accepted_request->'rake') IS DISTINCT FROM p.rake OR fn_pnl_evidence_cents(p.accepted_request->'bbj') IS DISTINCT FROM p.bbj THEN
  RAISE EXCEPTION 'escrow_refused:original_played_conservation_disagrees';END IF;
 IF(NOT retained AND jsonb_array_length(pending_ids)>0)OR cert.original#>>'{proof,resolution_kind}'='original_unplayed_pending_escrow_completed_after_signed_hand' THEN
  DECLARE pending_id uuid; receipt_proofs jsonb:='[]';refund_proofs jsonb:='[]';seat_proofs jsonb:='[]';
   original_committed_at timestamptz:=CASE WHEN live THEN a.committed_at ELSE(cert.original->>'committed_at')::timestamptz END;
   group_row record;baseline numeric;baseline_at timestamptz;baseline_kind text;baseline_source jsonb;baseline_proofs jsonb:='[]';pre_applications jsonb;pre_applied numeric;
   l chip_ledger;initial cash_participant_funding_receipts;move cash_seat_move_receipts;prior_part jsonb;
   last_stack numeric;next_stack numeric;seat_ids bigint[];refund_ids uuid[];funding_ids uuid[]:=ARRAY[]::uuid[];
   receipt_owner uuid;posted_count bigint;expected_count bigint;flow_original union_pnl_original_flows;
  BEGIN
   IF jsonb_typeof(pending_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(pending_ids)<1
    OR (SELECT count(DISTINCT x)FROM jsonb_array_elements_text(pending_ids)x)<>jsonb_array_length(pending_ids)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(pending_ids)x WHERE jsonb_typeof(x)<>'string' OR NOT pg_input_is_valid(x#>>'{}','uuid'))THEN
    RAISE EXCEPTION 'escrow_refused:exact_completed_pending_set_required';END IF;
   -- Prove the played opening independently of pending escrow. The nearest
   -- signed predecessor is preferred; a genuinely first occupancy uses its
   -- original admission or already-proved seat-move baseline instead.
   FOREACH affected IN ARRAY affected_users LOOP
    SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants)x WHERE x->>'user_id'=affected::text;
    IF (SELECT count(*)FROM cash_participant_funding_receipts fr
     JOIN cash_funding_application_receipts ap ON ap.funding_receipt_id=fr.id
     WHERE fr.id IN(SELECT(x->>'id')::uuid FROM jsonb_array_elements(part->'funding_receipts')x)
      AND fr.pending_addon_id IS NOT NULL AND ap.applied_at>m.captured_at)
     IS DISTINCT FROM jsonb_array_length(part#>'{funding_lineage,issues}')::bigint
     OR EXISTS(SELECT 1 FROM cash_participant_funding_receipts fr
      JOIN cash_funding_application_receipts ap ON ap.funding_receipt_id=fr.id
      WHERE fr.id IN(SELECT(x->>'id')::uuid FROM jsonb_array_elements(part->'funding_receipts')x)
       AND fr.pending_addon_id IS NOT NULL AND ap.applied_at>m.captured_at
       AND NOT pending_ids @>jsonb_build_array(fr.pending_addon_id))THEN
     RAISE EXCEPTION 'escrow_refused:all_frozen_pending_defects_must_be_completed_here';END IF;
    -- The private SQL lookup contains only this exact predecessor query.
    -- Its local generic-plan scope cannot leak to financial helpers below.
    SELECT pr.*INTO prev FROM smarter_private.original_cash_hand_predecessor(p_table,p_number,
     (part->>'seat_joined_at')::timestamptz,(part->>'occupancy_id')::uuid)pr;
    IF FOUND THEN
     SELECT x INTO STRICT prior_part FROM jsonb_array_elements(prev.participants)x
      WHERE x->>'user_id'=affected::text AND x->>'occupancy_id'=part->>'occupancy_id'
       AND x->>'seat_id'=part->>'seat_id'AND x->>'seat_joined_at'=part->>'seat_joined_at';
     baseline:=fn_pnl_evidence_cents(prior_part->'stack_after');baseline_at:=prev.accepted_at;baseline_kind:='signed_original_predecessor';baseline_source:=jsonb_build_object('hand_number',prev.hand_number,'hand_id',prev.hand_id,'payload_hash',prev.payload_hash);
     IF baseline IS NULL OR baseline<0 OR baseline_at>=m.captured_at OR prev.game_scope IS DISTINCT FROM o.game_scope
      OR NOT fn_cash_signed_retained_request_matches(p_table,prev.hand_number,prev.payload_hash,prev.accepted_request)
      OR prev.atomic_receipt->>'hand_id'IS DISTINCT FROM prev.hand_id::text
      OR prev.atomic_receipt->>'payload_hash'IS DISTINCT FROM prev.payload_hash
      OR prev.atomic_receipt#>'{stack_result,success}'IS DISTINCT FROM 'true'::jsonb
      OR prev.atomic_receipt#>'{stack_result,conservation_checked}'IS DISTINCT FROM 'true'::jsonb
      OR NOT EXISTS(SELECT 1 FROM union_pnl_cash_outcomes old WHERE old.table_id=p_table AND old.hand_number=prev.hand_number
       AND old.hand_id=prev.hand_id AND old.payload_hash=prev.payload_hash AND old.game_scope=prev.game_scope AND fn_union_pnl_cash_outcome_accepted(old))
      OR (SELECT count(*)FROM jsonb_array_elements(prev.accepted_request->'stacks')x WHERE x->>'user_id'=affected::text
       AND x->>'seat_id'=part->>'seat_id'AND x->>'occupancy_id'=part->>'occupancy_id'AND x->>'seat_joined_at'=part->>'seat_joined_at'
       AND fn_pnl_evidence_cents(x->'stack')=baseline)<>1
      OR(SELECT count(*)FROM jsonb_array_elements(prev.atomic_receipt#>'{stack_result,request,stacks}')x
       WHERE x->>'user_id'=affected::text AND x->>'seat_id'=part->>'seat_id'AND x->>'seat_joined_at'=part->>'seat_joined_at'
        AND fn_pnl_evidence_cents(x->'stack')=baseline)<>1 THEN
      RAISE EXCEPTION 'escrow_refused:signed_original_predecessor_required';END IF;
    ELSE
     SELECT r.* INTO move FROM cash_seat_move_receipts r WHERE r.destination_occupancy_id=(part->>'occupancy_id')::uuid;
     IF FOUND THEN
      IF jsonb_array_length(part#>'{funding_lineage,moves}')<1
       OR (part#>'{funding_lineage,moves,0}')IS DISTINCT FROM to_jsonb(move)
       OR move.player_id IS DISTINCT FROM affected OR move.to_table_id IS DISTINCT FROM p_table THEN
       RAISE EXCEPTION 'escrow_refused:original_first_move_baseline_required';END IF;
      baseline:=move.amount;baseline_at:=move.created_at;baseline_kind:='original_seat_move';baseline_source:=jsonb_build_object('move_id',move.move_id,'source_occupancy',move.source_occupancy_id,'destination_occupancy',move.destination_occupancy_id);
     ELSE
      SELECT fr.* INTO STRICT initial FROM cash_participant_funding_receipts fr
       WHERE fr.id IN(SELECT(x->>'id')::uuid FROM jsonb_array_elements(part->'funding_receipts')x)AND fr.operation_kind='buyin';
      IF initial.user_id IS DISTINCT FROM affected OR initial.table_id IS DISTINCT FROM p_table
       OR initial.seat_id::text IS DISTINCT FROM part->>'seat_id'OR initial.occupancy_id::text IS DISTINCT FROM part->>'occupancy_id'
       OR initial.seat_joined_at IS DISTINCT FROM(part->>'seat_joined_at')::timestamptz
       OR initial.pending_addon_id IS NOT NULL OR initial.transaction_id IS NULL
       OR NOT EXISTS(SELECT 1 FROM union_pnl_inventory_events e JOIN union_pnl_transaction_frames fr ON fr.transaction_id=e.transaction_id
        WHERE e.source_name='table_seats'AND e.row_id=initial.seat_id AND e.transaction_id=initial.transaction_id
         AND e.operation IN('INSERT','UPDATE')AND e.observed_at=fr.observed_at AND e.observed_at<=m.captured_at
         AND(e.before_row IS NULL OR e.before_row->>'occupancy_id'IS DISTINCT FROM initial.occupancy_id::text OR e.before_row->>'left_at'IS NOT NULL)
         AND e.after_row->>'table_id'=p_table::text AND e.after_row->>'user_id'=affected::text
         AND e.after_row->>'occupancy_id'=initial.occupancy_id::text AND e.after_row->>'club_id'=initial.funding_club_id::text
         AND(e.after_row->>'joined_at')::timestamptz=initial.seat_joined_at AND e.after_row->'left_at'='null'::jsonb
         AND fn_pnl_evidence_cents(e.after_row->'stack')=initial.amount)THEN
       RAISE EXCEPTION 'escrow_refused:original_first_admission_baseline_required';END IF;
      baseline:=initial.amount;baseline_at:=initial.recorded_at;baseline_kind:='original_seat_admission';baseline_source:=jsonb_build_object('funding_receipt',initial.id,'source_ledger',initial.source_ledger_id);
     END IF;
    END IF;
    SELECT COALESCE(sum(ap.applied),0),COALESCE(jsonb_agg(jsonb_build_object('funding_receipt',fr.id,'pending_id',fr.pending_addon_id,'application_transaction',ap.transaction_id::text,'applied',ap.applied,'applied_at',ap.applied_at)ORDER BY fr.id),'[]')INTO pre_applied,pre_applications FROM cash_funding_application_receipts ap
     JOIN cash_participant_funding_receipts fr ON fr.id=ap.funding_receipt_id
     WHERE fr.id IN(SELECT(x->>'id')::uuid FROM jsonb_array_elements(part->'funding_receipts')x)
      AND ap.applied_occupancy_id=(part->>'occupancy_id')::uuid AND ap.applied_at>baseline_at AND ap.applied_at<=m.captured_at;
    IF baseline IS NULL OR baseline<0 OR baseline_at IS NULL OR NOT isfinite(baseline_at)OR baseline_at>m.captured_at
     OR fn_pnl_evidence_cents(part->'stack_before')IS DISTINCT FROM baseline+pre_applied THEN
     RAISE EXCEPTION 'escrow_refused:played_opening_before_escrow_disagrees';END IF;
    baseline_proofs:=baseline_proofs||jsonb_build_array(jsonb_build_object('user_id',affected,'baseline_kind',baseline_kind,'source',baseline_source,'baseline_stack',baseline,'baseline_at',baseline_at,'prehand_applications',pre_applications,'played_stack_before',part->'stack_before'));
   END LOOP;
   -- Every sealed ID is proved, including requests made during this hand
   -- after the manifest. Amounts may split into applied and refunded parts.
   FOR pending_id IN SELECT x::uuid FROM jsonb_array_elements_text(pending_ids)x LOOP
    SELECT * INTO STRICT f FROM cash_participant_funding_receipts WHERE pending_addon_id=pending_id;
    SELECT * INTO STRICT app FROM cash_funding_application_receipts WHERE pending_addon_id=pending_id;
    SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants)x WHERE x->>'user_id'=f.user_id::text;
    SELECT(people->>'earning_club_id')::uuid INTO STRICT receipt_owner FROM jsonb_array_elements(proof_people)people WHERE people->>'user_id'=f.user_id::text;
    IF f.id=ANY(funding_ids)OR f.operation_kind NOT IN('addon','rebuy')OR f.account_type IS DISTINCT FROM 'player_wallet'
     OR f.account_entity_id IS DISTINCT FROM f.user_id OR f.funding_club_id IS DISTINCT FROM receipt_owner
     OR f.funding_union_id::text IS DISTINCT FROM o.game_scope->>'game_union_id'OR f.asset IS DISTINCT FROM 'chips'OR f.unit_scale<>2
     OR f.table_id IS DISTINCT FROM p_table OR f.seat_id::text IS DISTINCT FROM part->>'seat_id'
     OR f.occupancy_id::text IS DISTINCT FROM part->>'occupancy_id'OR f.seat_joined_at IS DISTINCT FROM(part->>'seat_joined_at')::timestamptz
     OR f.amount IS NULL OR f.amount<=0 OR f.amount<>round(f.amount,2)OR f.amount::text IN('NaN','Infinity','-Infinity')
     OR f.balance_before-f.balance_after IS DISTINCT FROM f.amount OR f.recorded_at IS NULL OR NOT isfinite(f.recorded_at)OR f.recorded_at>original_committed_at
     OR app.funding_receipt_id IS DISTINCT FROM f.id OR app.original_occupancy_id IS DISTINCT FROM f.occupancy_id
     OR app.applied IS NULL OR app.refunded IS NULL OR app.applied<0 OR app.refunded<0
     OR app.applied<>round(app.applied,2)OR app.refunded<>round(app.refunded,2)
     OR(app.applied+app.refunded)IS DISTINCT FROM f.amount
     OR(app.applied>0 AND app.applied_occupancy_id IS DISTINCT FROM f.occupancy_id)
     OR(app.applied=0 AND app.applied_occupancy_id IS NOT NULL)
     OR app.applied_at IS NULL OR NOT isfinite(app.applied_at)OR app.applied_at<=p.accepted_at OR app.applied_at>completed_at
     OR app.transaction_id IS NULL OR NOT EXISTS(SELECT 1 FROM union_pnl_transaction_frames fr WHERE fr.transaction_id=app.transaction_id
      AND fr.observed_at>p.accepted_at AND fr.observed_at<=app.applied_at)
     OR(f.recorded_at<=m.captured_at)IS DISTINCT FROM EXISTS(SELECT 1 FROM jsonb_array_elements(part->'funding_receipts')r WHERE r->>'id'=f.id::text)THEN
     RAISE EXCEPTION 'escrow_refused:complete_original_posthand_pending_application_required';END IF;
    SELECT * INTO STRICT l FROM chip_ledger WHERE id=f.source_ledger_id;
    IF l.status IS DISTINCT FROM 'posted'OR l.row_hash IS NULL OR l.club_id IS DISTINCT FROM f.funding_club_id
     OR l.from_type IS DISTINCT FROM f.account_type OR l.from_entity_id IS DISTINCT FROM f.account_entity_id
     OR l.to_type IS DISTINCT FROM 'table_stack'OR l.to_entity_id IS DISTINCT FROM p_table
     OR l.category IS DISTINCT FROM f.operation_kind OR l.amount IS DISTINCT FROM f.amount THEN
     RAISE EXCEPTION 'escrow_refused:original_pending_wallet_debit_required';END IF;
    IF app.refunded>0 AND NOT EXISTS(SELECT 1 FROM wallet_credit_idempotency w WHERE w.key='addon_refund:'||pending_id::text
     AND w.user_id=f.user_id AND w.amount=app.refunded AND w.created_at<=app.applied_at)THEN
     RAISE EXCEPTION 'escrow_refused:original_pending_refund_identity_required';END IF;
    funding_ids:=array_append(funding_ids,f.id);
    receipt_proofs:=receipt_proofs||jsonb_build_array(jsonb_build_object('pending_id',pending_id,'funding_receipt',f.id,
     'user_id',f.user_id,'club_id',f.funding_club_id,'seat_id',f.seat_id,'occupancy_id',f.occupancy_id,'seat_joined_at',f.seat_joined_at,
     'escrow',f.amount,'applied',app.applied,'refunded',app.refunded,'application_transaction',app.transaction_id::text,'applied_at',app.applied_at));
   END LOOP;
   -- Match refund rail multiplicities as a complete set, never invent a
   -- per-receipt association for identical same-transaction refund legs.
   FOR group_row IN SELECT x->>'user_id'usr,x->>'club_id'club,x->>'application_transaction'tx,
    (x->>'refunded')::numeric amount,count(*)n,max((x->>'applied_at')::timestamptz)at
    FROM jsonb_array_elements(receipt_proofs)x WHERE(x->>'refunded')::numeric>0 GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LOOP
    SELECT count(*),array_agg(leg.id ORDER BY leg.id)INTO posted_count,refund_ids FROM chip_ledger leg
     JOIN union_pnl_original_flows original ON original.ledger_id=leg.id
     JOIN union_pnl_transaction_frames fr ON fr.transaction_id=original.transaction_id
     WHERE leg.to_type='player_wallet'AND leg.to_entity_id=group_row.usr::uuid AND leg.from_type='table_stack'AND leg.from_entity_id=p_table
      AND leg.club_id=group_row.club::uuid AND leg.amount=group_row.amount AND leg.category='player_funding'AND leg.status='posted'AND leg.row_hash IS NOT NULL
      AND leg.created_at>=original_committed_at AND leg.created_at<=group_row.at
      AND original.transaction_id::text=group_row.tx
      AND original.ledger_snapshot ?&ARRAY['id','status','row_hash','club_id','from_type','from_entity_id','to_type','to_entity_id','amount','category','created_at']
      AND NOT EXISTS(SELECT 1 FROM jsonb_each(original.ledger_snapshot)x WHERE x.key<>'created_at'
       AND x.value IS DISTINCT FROM to_jsonb(leg)->x.key)
      AND(original.ledger_snapshot->>'created_at')::timestamptz=leg.created_at
      AND original.recognized_at=fr.observed_at AND fr.observed_at>p.accepted_at AND fr.observed_at<=group_row.at;
    IF posted_count IS DISTINCT FROM group_row.n THEN RAISE EXCEPTION 'escrow_refused:exact_original_refund_rail_multiset_required';END IF;
    refund_proofs:=refund_proofs||jsonb_build_array(jsonb_build_object('user_id',group_row.usr,'club_id',group_row.club,
     'application_transaction',group_row.tx,'amount',group_row.amount,'count',group_row.n,'ledger_ids',refund_ids));
   END LOOP;
   FOR group_row IN SELECT x->>'user_id'usr,x->>'club_id'club,x->>'seat_id'seat,x->>'occupancy_id'occ,x->>'seat_joined_at'joined,
    x->>'application_transaction'tx,sum((x->>'applied')::numeric)applied,max((x->>'applied_at')::timestamptz)at
    FROM jsonb_array_elements(receipt_proofs)x GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,3,4,5,6 LOOP
    SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants)x WHERE x->>'user_id'=group_row.usr;
    last_stack:=fn_pnl_evidence_cents(part->'stack_after');seat_ids:=ARRAY[]::bigint[];
    FOR witness IN SELECT e.*FROM union_pnl_inventory_events e WHERE e.source_name='table_seats'AND e.row_id=group_row.seat::uuid
     AND e.transaction_id::text=group_row.tx ORDER BY e.event_id LOOP
     next_stack:=fn_pnl_evidence_cents(witness.after_row->'stack');
     IF witness.operation IS DISTINCT FROM 'UPDATE'OR witness.observed_at IS NULL OR witness.observed_at<=p.accepted_at OR witness.observed_at>group_row.at
      OR NOT EXISTS(SELECT 1 FROM union_pnl_transaction_frames fr WHERE fr.transaction_id=witness.transaction_id AND fr.observed_at=witness.observed_at)
      OR EXISTS(SELECT 1 FROM(VALUES(witness.before_row),(witness.after_row))r(j)WHERE j->>'id'IS DISTINCT FROM group_row.seat
       OR j->>'table_id'IS DISTINCT FROM p_table::text OR j->>'user_id'IS DISTINCT FROM group_row.usr
       OR j->>'club_id'IS DISTINCT FROM group_row.club OR j->>'occupancy_id'IS DISTINCT FROM group_row.occ
       OR(j->>'joined_at')::timestamptz IS DISTINCT FROM group_row.joined::timestamptz OR j->'left_at'IS DISTINCT FROM 'null'::jsonb)
      OR fn_pnl_evidence_cents(witness.before_row->'stack')IS DISTINCT FROM last_stack OR next_stack IS NULL OR next_stack<last_stack THEN
      RAISE EXCEPTION 'escrow_refused:exact_original_posthand_seat_chain_required';END IF;
     last_stack:=next_stack;seat_ids:=array_append(seat_ids,witness.event_id);
    END LOOP;
    IF last_stack-fn_pnl_evidence_cents(part->'stack_after')IS DISTINCT FROM group_row.applied THEN
     RAISE EXCEPTION 'escrow_refused:exact_applied_escrow_felt_conservation_required';END IF;
    seat_proofs:=seat_proofs||jsonb_build_array(jsonb_build_object('user_id',group_row.usr,'application_transaction',group_row.tx,
     'applied',group_row.applied,'event_ids',seat_ids,'played_stack_after',part->'stack_after','posthand_stack',last_stack));
   END LOOP;
   result:=jsonb_build_object('status','proven','resolution_kind','original_unplayed_pending_escrow_completed_after_signed_hand',
    'table_id',p_table,'hand_number',p_number,'hand_id',o.hand_id,'outcome_payload_hash',o.payload_hash,'outcome_evidence_md5',md5(o.evidence::text),
    'opening_baselines',baseline_proofs,'pending_receipts',receipt_proofs,'refund_rails',refund_proofs,'seat_applications',seat_proofs,'participants',proof_people,
    'current_membership_used',false,'current_seats_used',false);
   IF retained AND(cert.original->'proof'IS DISTINCT FROM result OR cert.original->>'qualified_evidence_sha256'IS DISTINCT FROM
    encode(extensions.digest(convert_to(smarter_private.posthand_escrow_project_evidence(o.evidence,result)::text,'UTF8'),'sha256'),'hex'))THEN
    RAISE EXCEPTION 'escrow_refused:immutable_original_posthand_proof_disagrees';END IF;
   RETURN result;
  END;
 END IF;
 SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants) x WHERE x->>'user_id'=affected::text;
 IF part#>'{funding_lineage,moves}' IS DISTINCT FROM '[]'::jsonb THEN
  -- RETURNED PENDING ESCROW 20261101: the pending application was refunded to
  -- the wallet in full and never applied to any stack, and the occupancy had
  -- moved tables, so the applied-after-the-hand escrow below cannot describe
  -- it. The participant loop above has already re-proved the whole funding
  -- lineage (moves included) clean against the ledger today, with the frozen
  -- manifest issue exactly the pending application. Here the single pending
  -- receipt is verified refunded in full, never applied anywhere in this
  -- lineage, with its posted wallet-return ledger row.
  SELECT count(*) INTO v_n FROM jsonb_array_elements(part#>'{funding_lineage,funding_receipts}') x WHERE (x->>'pending_addon_id') IS NOT NULL;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'escrow_refused:single_pending_receipt_required';END IF;
  SELECT r.* INTO STRICT f FROM cash_participant_funding_receipts r
   WHERE r.id=(SELECT (x->>'id')::uuid FROM jsonb_array_elements(part#>'{funding_lineage,funding_receipts}') x WHERE (x->>'pending_addon_id') IS NOT NULL);
  SELECT * INTO STRICT app FROM cash_funding_application_receipts WHERE funding_receipt_id=f.id;
  IF f.operation_kind IS DISTINCT FROM 'addon' OR f.pending_addon_id IS NULL OR f.user_id IS DISTINCT FROM affected
   OR app.pending_addon_id IS DISTINCT FROM f.pending_addon_id OR app.original_occupancy_id IS DISTINCT FROM f.occupancy_id
   OR app.applied IS DISTINCT FROM 0::numeric OR app.refunded IS DISTINCT FROM f.amount OR app.applied_occupancy_id IS NOT NULL
   OR app.transaction_id IS NULL OR app.applied_at IS NULL OR NOT isfinite(app.applied_at)
   OR pending_ids IS DISTINCT FROM '[]'::jsonb
   OR EXISTS(SELECT 1 FROM cash_funding_application_receipts ap JOIN cash_participant_funding_receipts fr2 ON fr2.id=ap.funding_receipt_id
     WHERE ap.applied>0 AND fr2.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(part#>'{funding_lineage,funding_receipts}') x)) THEN
   RAISE EXCEPTION 'escrow_refused:returned_exact_unapplied_escrow_required';END IF;
  SELECT count(*) INTO v_n FROM chip_ledger l WHERE l.status='posted' AND l.from_type='table_stack' AND l.from_entity_id=f.table_id
   AND l.to_type='player_wallet' AND l.to_entity_id=affected AND l.amount=f.amount
   AND l.created_at>=f.recorded_at AND l.created_at<=app.applied_at;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'escrow_refused:posted_wallet_return_ledger_required';END IF;
  SELECT l.id INTO v_refund_ledger FROM chip_ledger l WHERE l.status='posted' AND l.from_type='table_stack' AND l.from_entity_id=f.table_id
   AND l.to_type='player_wallet' AND l.to_entity_id=affected AND l.amount=f.amount
   AND l.created_at>=f.recorded_at AND l.created_at<=app.applied_at;
  result:=jsonb_build_object('status','proven','resolution_kind','original_pending_escrow_returned_to_wallet','table_id',p_table,
   'hand_number',p_number,'hand_id',o.hand_id,'outcome_payload_hash',o.payload_hash,'outcome_evidence_md5',md5(o.evidence::text),
   'pending_funding_receipt',f.id,'pending_addon_id',f.pending_addon_id,'escrow_amount',f.amount,
   'refund_ledger',v_refund_ledger::text,'application_transaction',app.transaction_id::text,
   'played_stack_before',fn_pnl_evidence_cents(part->'stack_before'),'played_stack_after',fn_pnl_evidence_cents(part->'stack_after'),
   'participants',proof_people,'current_membership_used',false,'current_seats_used',false);
 ELSE
 SELECT pr.* INTO STRICT prev FROM cash_hand_provenance_receipts pr CROSS JOIN LATERAL jsonb_array_elements(pr.participants) x
  WHERE pr.table_id=p_table AND pr.hand_number<p_number AND x->>'occupancy_id'=part->>'occupancy_id' ORDER BY pr.hand_number DESC LIMIT 1;
 SELECT fn_pnl_evidence_cents(x->'stack_after') INTO STRICT prev_stack FROM jsonb_array_elements(prev.participants) x
  WHERE x->>'user_id'=affected::text AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
   AND x->>'seat_joined_at'=part->>'seat_joined_at';
 IF prev.accepted_at IS NULL OR NOT isfinite(prev.accepted_at) OR prev.accepted_at>=m.captured_at
  OR prev.game_scope IS DISTINCT FROM o.game_scope OR prev_stack IS DISTINCT FROM fn_pnl_evidence_cents(part->'stack_before')
  OR NOT fn_cash_signed_retained_request_matches(p_table,prev.hand_number,prev.payload_hash,prev.accepted_request)
  OR prev.atomic_receipt->>'hand_id' IS DISTINCT FROM prev.hand_id::text
  OR prev.atomic_receipt->>'payload_hash' IS DISTINCT FROM prev.payload_hash
  OR prev.atomic_receipt->'stack_result'->'success' IS DISTINCT FROM 'true'::jsonb
  OR prev.atomic_receipt->'stack_result'->'conservation_checked' IS DISTINCT FROM 'true'::jsonb
  OR (SELECT count(*) FROM jsonb_array_elements(prev.accepted_request->'stacks') x WHERE x->>'user_id'=affected::text
    AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
    AND x->>'seat_joined_at'=part->>'seat_joined_at' AND fn_pnl_evidence_cents(x->'stack')=prev_stack)<>1
  OR (SELECT count(*) FROM jsonb_array_elements(prev.atomic_receipt#>'{stack_result,request,stacks}') x WHERE x->>'user_id'=affected::text
    AND x->>'seat_id'=part->>'seat_id' AND x->>'seat_joined_at'=part->>'seat_joined_at' AND fn_pnl_evidence_cents(x->'stack')=prev_stack)<>1
  OR NOT EXISTS(SELECT 1 FROM union_pnl_cash_outcomes old WHERE old.table_id=p_table AND old.hand_number=prev.hand_number
    AND old.hand_id=prev.hand_id AND old.payload_hash=prev.payload_hash AND old.game_scope=prev.game_scope AND fn_union_pnl_cash_outcome_accepted(old)) THEN
  RAISE EXCEPTION 'escrow_refused:equal_original_accepted_predecessor_required';END IF;
 SELECT r.* INTO STRICT f FROM cash_participant_funding_receipts r WHERE r.occupancy_id=(part->>'occupancy_id')::uuid
  AND r.recorded_at>prev.accepted_at AND r.recorded_at<=m.captured_at;
 SELECT * INTO STRICT app FROM cash_funding_application_receipts WHERE funding_receipt_id=f.id;
 IF f.operation_kind IS DISTINCT FROM 'addon' OR f.pending_addon_id IS NULL OR f.user_id IS DISTINCT FROM affected
  OR f.table_id IS DISTINCT FROM p_table OR f.seat_id::text IS DISTINCT FROM part->>'seat_id'
  OR f.seat_joined_at IS DISTINCT FROM (part->>'seat_joined_at')::timestamptz
  OR app.pending_addon_id IS DISTINCT FROM f.pending_addon_id OR app.original_occupancy_id IS DISTINCT FROM f.occupancy_id
  OR app.applied_occupancy_id IS DISTINCT FROM f.occupancy_id OR app.applied IS DISTINCT FROM f.amount OR app.refunded IS DISTINCT FROM 0
  OR app.transaction_id IS NULL OR app.applied_at IS NULL OR NOT isfinite(app.applied_at)
  OR app.applied_at<=p.accepted_at OR app.applied_at>completed_at
  OR pending_ids IS DISTINCT FROM jsonb_build_array(f.pending_addon_id)
  OR EXISTS(SELECT 1 FROM cash_funding_application_receipts ap JOIN cash_participant_funding_receipts fr ON fr.id=ap.funding_receipt_id
    WHERE fr.occupancy_id=f.occupancy_id AND ap.applied>0 AND ap.applied_at>prev.accepted_at AND ap.applied_at<=m.captured_at) THEN
  RAISE EXCEPTION 'escrow_refused:unplayed_exact_posthand_application_required';END IF;
 SELECT e.* INTO STRICT witness FROM union_pnl_inventory_events e
  WHERE e.transaction_id=app.transaction_id AND e.source_name='table_seats' AND e.row_id=f.seat_id;
 IF witness.operation IS DISTINCT FROM 'UPDATE' OR witness.before_row->>'occupancy_id' IS DISTINCT FROM f.occupancy_id::text
  OR witness.after_row->>'occupancy_id' IS DISTINCT FROM f.occupancy_id::text
  OR witness.before_row->>'user_id' IS DISTINCT FROM affected::text OR witness.after_row->>'user_id' IS DISTINCT FROM affected::text
  OR witness.before_row->>'id' IS DISTINCT FROM f.seat_id::text OR witness.after_row->>'id' IS DISTINCT FROM f.seat_id::text
  OR witness.before_row->>'club_id' IS DISTINCT FROM f.funding_club_id::text OR witness.after_row->>'club_id' IS DISTINCT FROM f.funding_club_id::text
  OR (witness.before_row->>'joined_at')::timestamptz IS DISTINCT FROM f.seat_joined_at
  OR (witness.after_row->>'joined_at')::timestamptz IS DISTINCT FROM f.seat_joined_at
  OR witness.observed_at IS NULL OR NOT isfinite(witness.observed_at) OR witness.observed_at<=p.accepted_at OR witness.observed_at>app.applied_at
  OR witness.before_row->>'table_id' IS DISTINCT FROM p_table::text OR witness.after_row->>'table_id' IS DISTINCT FROM p_table::text
  OR witness.before_row->'left_at' IS DISTINCT FROM 'null'::jsonb OR witness.after_row->'left_at' IS DISTINCT FROM 'null'::jsonb
  OR fn_pnl_evidence_cents(witness.before_row->'stack') IS DISTINCT FROM fn_pnl_evidence_cents(part->'stack_after')
  OR fn_pnl_evidence_cents(witness.after_row->'stack')-fn_pnl_evidence_cents(witness.before_row->'stack') IS DISTINCT FROM f.amount
  OR NOT EXISTS(SELECT 1 FROM union_pnl_transaction_frames fr WHERE fr.transaction_id=app.transaction_id AND fr.observed_at=witness.observed_at) THEN
  RAISE EXCEPTION 'escrow_refused:original_posthand_felt_conservation_required';END IF;
 result:=jsonb_build_object('status','proven','resolution_kind','original_unplayed_escrow_applied_after_signed_hand','table_id',p_table,
  'hand_number',p_number,'hand_id',o.hand_id,'outcome_payload_hash',o.payload_hash,'outcome_evidence_md5',md5(o.evidence::text),
  'pending_funding_receipt',f.id,'pending_addon_id',f.pending_addon_id,'escrow_amount',f.amount,
  'previous_hand',prev.hand_number,'played_stack_before',fn_pnl_evidence_cents(part->'stack_before'),
  'played_stack_after',fn_pnl_evidence_cents(part->'stack_after'),'posthand_stack',fn_pnl_evidence_cents(witness.after_row->'stack'),
  'application_transaction',app.transaction_id::text,'participants',proof_people,'current_membership_used',false,'current_seats_used',false);
 END IF;
 IF retained AND (cert.original->'proof' IS DISTINCT FROM result
  OR cert.original->>'qualified_evidence_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(smarter_private.posthand_escrow_project_evidence(o.evidence,result)::text,'UTF8'),'sha256'),'hex')) THEN
  RAISE EXCEPTION 'escrow_refused:immutable_original_posthand_proof_disagrees';END IF;
 RETURN result;
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM LIKE 'escrow_refused:%' THEN RETURN jsonb_build_object('status','refused','reason',SQLERRM);END IF;RAISE;
 WHEN no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  RETURN jsonb_build_object('status','refused','reason','missing_duplicate_or_malformed_original');
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ca_process_hand_post_commit_obligations(p_hand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_table_id uuid;
  v_commit public.hand_atomic_commits%ROWTYPE;
  v_payload jsonb;
  v_hash text;
  v_rake jsonb;
  v_bbj jsonb;
  v_pending jsonb;
  v_item jsonb;
  v_rake_result record;
  v_promo_result jsonb;
  v_pool_id uuid;
  v_union_id uuid;
  v_contribution_id uuid;
  v_insurance_id uuid;
  v_addon_result record;
  v_addon public.table_pending_addons%ROWTYPE;
  v_time_bank_count integer := 0;
  v_promo_count integer := 0;
  v_insurance_count integer := 0;
  v_addon_count integer := 0;
  v_result jsonb;
BEGIN
  /* Read only the scope, then take the per-table mutex before the row lock.
     This gives every hand at one table the same lock order. */
  SELECT c.table_id INTO v_table_id
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'hand_id', p_hand_id);
  END IF;

  /* 20261019: this tournament's shared lane first, waiting, before any
     lock (re-entered at once when the caller already holds it). */
  PERFORM smarter_private.f06_wait_table_lane(v_table_id);

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hand-post-commit:' || v_table_id::text, 0)
  );

  SELECT c.* INTO v_commit
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'hand_id', p_hand_id);
  END IF;
  IF v_commit.post_commit_payload IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'legacy_no_obligations',
      'hand_id', p_hand_id
    );
  END IF;
  IF v_commit.post_commit_completed_at IS NOT NULL THEN
    RETURN COALESCE(v_commit.post_commit_result, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'already_completed', true,
      'hand_id', p_hand_id,
      'completed_at', v_commit.post_commit_completed_at
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.hand_atomic_commits earlier
     WHERE earlier.table_id = v_commit.table_id
       AND earlier.hand_number < v_commit.hand_number
       AND earlier.post_commit_payload IS NOT NULL
       AND earlier.post_commit_completed_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'hand_id', p_hand_id
    );
  END IF;

  v_payload := v_commit.post_commit_payload;
  v_hash := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_commit.post_commit_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'post-commit obligation payload hash mismatch for hand %', p_hand_id;
  END IF;

  /* Time banks were stamped inside the accepted-hand transaction while the
     exact lease and seat locks were held. A delayed consumer must never apply
     those older values again after hand N+1, a table break, or a seat move. */
  IF jsonb_typeof(v_payload->'time_banks') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid time-bank audit payload for hand %', p_hand_id;
  END IF;
  v_time_bank_count := jsonb_array_length(v_payload->'time_banks');

  IF EXISTS(SELECT 1 FROM public.tables t JOIN public.clubs c ON c.id=t.club_id
      WHERE t.id=v_table_id AND c.asset='diamonds') AND (
    v_payload->'rake' IS DISTINCT FROM 'null'::jsonb
    OR v_payload->'bbj_contribution' IS DISTINCT FROM 'null'::jsonb
    OR v_payload->'pending_addons' IS DISTINCT FROM 'null'::jsonb
    OR v_payload->'promo_playthrough' IS DISTINCT FROM '[]'::jsonb
    OR v_payload->'insurance' IS DISTINCT FROM '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'diamond_hand_has_chip_obligations';
  END IF;
  v_rake := v_payload->'rake';
  IF v_rake IS NOT NULL AND jsonb_typeof(v_rake) <> 'null' THEN
    IF jsonb_typeof(v_rake) <> 'object'
       OR COALESCE((v_rake->>'amount')::numeric, 0) <= 0
       OR (v_rake->>'club_id') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid rake obligation for hand %', p_hand_id;
    END IF;
    IF v_commit.hand_number > 2147483647 THEN
      RAISE EXCEPTION 'rake hand number exceeds downstream integer contract: %',
        v_commit.hand_number;
    END IF;

    SELECT * INTO v_rake_result
      FROM public.atomic_distribute_rake(
        v_commit.table_id,
        (v_rake->>'club_id')::uuid,
        v_commit.hand_id,
        v_commit.hand_number::integer,
        (v_rake->>'amount')::numeric,
        COALESCE((v_rake->>'bbj')::numeric, 0),
        NULLIF(v_rake->>'pot', '')::numeric,
        NULLIF(v_rake->>'num_players', '')::integer,
        COALESCE(v_rake->'contributions', '{}'::jsonb),
        NULLIF(v_rake->>'tournament_id', '')::uuid,
        COALESCE(v_rake->'returned_uncalled', '{}'::jsonb),
        COALESCE(NULLIF(v_rake->>'method', ''), 'WEIGHTED_CONTRIBUTED')
      );
    IF NOT FOUND OR NOT (
      COALESCE(v_rake_result.applied, false)
      OR COALESCE(v_rake_result.already_processed, false)
      OR v_rake_result.rake_record_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'rake obligation did not produce a receipt for hand %', p_hand_id;
    END IF;
  END IF;

  v_bbj := v_payload->'bbj_contribution';
  IF v_bbj IS NOT NULL AND jsonb_typeof(v_bbj) <> 'null' THEN
    IF jsonb_typeof(v_bbj) <> 'object'
       OR COALESCE((v_bbj->>'amount')::numeric, 0) <= 0
       OR (v_bbj->>'club_id') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid BBJ contribution obligation for hand %', p_hand_id;
    END IF;

    SELECT c.union_id INTO v_union_id
      FROM public.clubs c
     WHERE c.id = (v_bbj->>'club_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BBJ obligation club not found for hand %', p_hand_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'bbj-pool:' || COALESCE(v_union_id::text, 'club:' || (v_bbj->>'club_id')),
      0
    ));
    IF v_union_id IS NULL THEN
      SELECT p.id INTO v_pool_id
        FROM public.bbj_pools p
       WHERE p.club_id = (v_bbj->>'club_id')::uuid
         AND p.status = 'active'
       ORDER BY p.created_at, p.id
       LIMIT 1
       FOR UPDATE;
    ELSE
      SELECT p.id INTO v_pool_id
        FROM public.bbj_pools p
       WHERE p.union_id = v_union_id
         AND p.status = 'active'
       ORDER BY p.created_at, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;

    IF v_pool_id IS NULL THEN
      IF v_union_id IS NULL THEN
        INSERT INTO public.bbj_pools(
          club_id, main_balance, backup_balance, promo_balance, status
        ) VALUES (
          (v_bbj->>'club_id')::uuid, 0, 0, 0, 'active'
        ) RETURNING id INTO v_pool_id;
      ELSE
        INSERT INTO public.bbj_pools(
          union_id, main_balance, backup_balance, promo_balance, status
        ) VALUES (
          v_union_id, 0, 0, 0, 'active'
        ) RETURNING id INTO v_pool_id;
      END IF;
    END IF;

    SELECT r.id INTO v_contribution_id
      FROM public.bbj_record_contribution(
        v_pool_id,
        v_commit.hand_id,
        v_commit.table_id,
        (v_bbj->>'amount')::numeric,
        0, 0, 0,
        COALESCE((v_bbj->>'big_blind')::numeric, 2),
        v_commit.hand_number::integer,
        (v_bbj->>'club_id')::uuid
      ) r;
    IF v_contribution_id IS NULL THEN
      RAISE EXCEPTION 'BBJ contribution produced no receipt for hand %', p_hand_id;
    END IF;
  END IF;

  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(v_payload->'promo_playthrough')
     ORDER BY value->>'user_id'
  LOOP
    IF (v_item->>'club_id') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR (v_item->>'user_id') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE((v_item->>'wagered')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'invalid promo obligation for hand %', p_hand_id;
    END IF;
    v_promo_result := public.promo_apply_playthrough(
      (v_item->>'club_id')::uuid,
      (v_item->>'user_id')::uuid,
      (v_item->>'wagered')::numeric
    );
    IF v_promo_result->>'reason' IN ('engine_only', 'no_wager') THEN
      RAISE EXCEPTION 'promo obligation refused for hand %: %',
        p_hand_id, v_promo_result;
    END IF;
    v_promo_count := v_promo_count + 1;
  END LOOP;

  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(v_payload->'insurance')
     ORDER BY value->>'player_id', value->>'kind'
  LOOP
    IF (v_item->>'club_id') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR (v_item->>'player_id') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid insurance obligation for hand %', p_hand_id;
    END IF;
    SELECT r.id INTO v_insurance_id
      FROM public.record_insurance_transaction(
        v_commit.table_id,
        (v_item->>'club_id')::uuid,
        v_commit.hand_number::integer,
        (v_item->>'player_id')::uuid,
        COALESCE((v_item->>'equity_percent')::numeric, 0),
        COALESCE((v_item->>'premium')::numeric, 0),
        COALESCE((v_item->>'insured_amount')::numeric, 0),
        COALESCE((v_item->>'payout')::numeric, 0),
        COALESCE((v_item->>'player_won')::boolean, false),
        COALESCE(NULLIF(v_item->>'kind', ''), 'insurance')::varchar
      ) r;
    IF v_insurance_id IS NULL THEN
      RAISE EXCEPTION 'insurance obligation produced no receipt for hand %', p_hand_id;
    END IF;
    v_insurance_count := v_insurance_count + 1;
  END LOOP;

  v_pending := v_payload->'pending_addons';
  IF v_pending IS NOT NULL AND jsonb_typeof(v_pending) <> 'null' THEN
    IF jsonb_typeof(v_pending) <> 'object'
       OR COALESCE((v_pending->>'enabled')::boolean, false) IS NOT TRUE
       OR jsonb_typeof(v_pending->'ids') IS DISTINCT FROM 'array'
       /* 20261105: a JSON null max_buy_in is uncapped (fixed-limit tables);
          resolve_pending_addon reads NULL the same way. A non-number or a
          number <= 0 is still refused. */
       OR COALESCE(jsonb_typeof(v_pending->'max_buy_in'), 'missing') NOT IN ('number', 'null')
       OR (jsonb_typeof(v_pending->'max_buy_in') = 'number'
           AND (v_pending->>'max_buy_in')::numeric <= 0) THEN
      RAISE EXCEPTION 'invalid pending-add-on obligation for hand %', p_hand_id;
    END IF;
    FOR v_item IN
      SELECT value
        FROM jsonb_array_elements(v_pending->'ids')
       ORDER BY value #>> '{}'
    LOOP
      IF (v_item #>> '{}') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN
        RAISE EXCEPTION 'pending add-on % is not frozen for table % (hand %)',
          v_item, v_commit.table_id, p_hand_id;
      END IF;
      -- Recovery can encounter an ID also frozen by an earlier accepted
      -- hand. The resolver owns exactly-once delivery and returns its stored
      -- result on replay. A resolved row is evidence, not a failed payment.
      SELECT a.* INTO v_addon
        FROM public.table_pending_addons a
       WHERE a.id = (v_item #>> '{}')::uuid
         AND a.table_id = v_commit.table_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pending add-on % does not belong to table % (hand %)',
          v_item, v_commit.table_id, p_hand_id;
      END IF;
      SELECT * INTO v_addon_result
        FROM public.resolve_pending_addon(
          (v_item #>> '{}')::uuid,
          NULLIF(v_pending->>'max_buy_in', '')::numeric
        );
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pending add-on % produced no receipt for hand %',
          v_item, p_hand_id;
      END IF;
      IF v_addon.amount IS NULL OR v_addon.amount <= 0
         OR v_addon.amount::text IN ('NaN', 'Infinity', '-Infinity')
         OR (v_addon.resolved_at IS NOT NULL AND
             (v_addon.applied_to_stack IS NULL OR v_addon.refunded IS NULL))
         OR v_addon_result.applied IS NULL OR v_addon_result.applied < 0
         OR v_addon_result.applied::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_addon_result.applied <> round(v_addon_result.applied, 2)
         OR v_addon_result.refunded IS NULL OR v_addon_result.refunded < 0
         OR v_addon_result.refunded::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_addon_result.refunded <> round(v_addon_result.refunded, 2)
         OR v_addon_result.applied + v_addon_result.refunded
              IS DISTINCT FROM round(v_addon.amount, 2)
      THEN
        RAISE EXCEPTION 'pending add-on % has an incomplete resolution receipt for hand %',
          v_item, p_hand_id;
      END IF;
      v_addon_count := v_addon_count + 1;
    END LOOP;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'already_completed', false,
    'hand_id', p_hand_id,
    'hand_number', v_commit.hand_number,
    'time_banks', v_time_bank_count,
    'rake', v_rake IS NOT NULL AND jsonb_typeof(v_rake) <> 'null',
    'bbj_contribution', v_bbj IS NOT NULL AND jsonb_typeof(v_bbj) <> 'null',
    'promo_playthrough', v_promo_count,
    'insurance', v_insurance_count,
    'pending_addons', v_addon_count
  );

  UPDATE public.hand_atomic_commits c
     SET post_commit_completed_at = clock_timestamp(),
         post_commit_result = v_result
   WHERE c.hand_id = p_hand_id
     AND c.post_commit_completed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post-commit completion receipt was lost for hand %', p_hand_id;
  END IF;

  -- The original pending-application event owns final accounting admission
  -- too. All applications and the immutable completion receipt above are
  -- visible now; no later repair loop or money replay supplies this proof.
  IF v_addon_count>0 AND EXISTS(SELECT 1 FROM public.union_pnl_cash_outcomes o
    WHERE o.table_id=v_commit.table_id AND o.hand_number=v_commit.hand_number
      AND o.evidence->>'status'='blocked') THEN
    DECLARE escrow_proof jsonb;escrow_original jsonb;
    BEGIN
      IF smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true THEN
        escrow_proof:=jsonb_build_object('status','refused','reason','original_sources_unqualified');
      ELSIF public.fn_platform_frozen() IS DISTINCT FROM false THEN
        escrow_proof:=jsonb_build_object('status','refused','reason','accounting_admission_platform_frozen');
      ELSE
        escrow_proof:=public.fn_union_pnl_prove_posthand_escrow(v_commit.table_id,v_commit.hand_number);
      END IF;
      IF escrow_proof->>'status'='proven' THEN
        escrow_original:=smarter_private.posthand_escrow_original_snapshot(v_commit.table_id,v_commit.hand_number);
        PERFORM public.fn_union_pnl_certify_posthand_escrow(v_commit.table_id,v_commit.hand_number,
          md5((escrow_original->'proof')::text),
          encode(extensions.digest(convert_to(escrow_original::text,'UTF8'),'sha256'),'hex'));
      ELSIF escrow_proof->>'status'='refused' THEN
        -- Accounting qualification cannot hold otherwise valid payments.
        -- This is still the original transaction's unpublished completion
        -- receipt, not a rewrite of any already committed financial record.
        v_result:=v_result||jsonb_build_object('accounting_admission',escrow_proof);
        UPDATE public.hand_atomic_commits c SET post_commit_result=v_result
         WHERE c.hand_id=p_hand_id AND c.post_commit_completed_at IS NOT NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'posthand_escrow_refusal_receipt_lost';END IF;
      ELSE
        RAISE EXCEPTION 'posthand_escrow_original_proof_unknown';
      END IF;
    END;
  END IF;

  RETURN v_result;
END;
$function$;



DO $postimage$
DECLARE sig text;hash text;p pg_proc;
BEGIN
 FOR sig,hash IN SELECT *FROM(VALUES
 ('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)','acd3dfc914dca2aff6ab5c1505169ef6'),
 ('public.fn_ca_process_hand_post_commit_obligations(uuid)','8b81e8bb218cacb235832285e4fbbb24'),
 ('smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid)','8f4d01a26e41dcb1cbc82c75e2c6a483'))v(s,h)LOOP
  SELECT *INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF md5(pg_get_functiondef(p.oid))IS DISTINCT FROM hash OR p.proowner<>'postgres'::regrole THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_POSTIMAGE_CHANGED: %',sig;END IF;
  IF sig LIKE '%original_cash_hand_predecessor%'THEN
   IF p.prosecdef OR p.provolatile<>'s'OR p.proacl IS DISTINCT FROM '{postgres=X/postgres}'::aclitem[]OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','plan_cache_mode=force_generic_plan']THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_LOOKUP_AUTHORITY_CHANGED';END IF;
  ELSE
   IF NOT p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
    OR p.provolatile IS DISTINCT FROM(CASE WHEN sig LIKE '%prove_posthand%'THEN 's'::"char"ELSE 'v'::"char"END)
    OR p.proconfig IS DISTINCT FROM(CASE WHEN sig LIKE '%prove_posthand%'THEN ARRAY['search_path=public, pg_temp','TimeZone=UTC']ELSE ARRAY['search_path=public, extensions, pg_temp']END) THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_OWNER_METADATA_CHANGED';END IF;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM posthand_temporal_install_before b WHERE
   b.matcher=md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))
   AND b.generation_source=pg_get_functiondef('smarter_private.original_inventory_basis_generation()'::regprocedure)
   AND b.generation=smarter_private.original_inventory_basis_generation()
   AND clock_timestamp()-b.started<interval '8 seconds')OR smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true THEN RAISE EXCEPTION 'POSTHAND_TEMPORAL_ORIGINAL_PROOF_GENERATION_CHANGED';END IF;
END$postimage$;
COMMIT;
