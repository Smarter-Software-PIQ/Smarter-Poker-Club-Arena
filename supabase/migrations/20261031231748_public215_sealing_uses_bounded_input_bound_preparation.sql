-- TIER: 3. Bounded public215 qualification, ordinary final seal remains atomic.
-- WHY: Installed eight-function optimization still measured three source nodes
-- at209.973ms and one model at496.325ms. The6955-source/107-model one-request
-- seal cannot fit the existing125s transport boundary. Prior operation rolled
-- back definitively with57014; capture/models/856audits are never repeated.
-- HOW: fresh full per-cell source/model/audit validation and exact NUMERIC
-- sufficient statistics, immutable receipts bound to all inputs and code.
-- Atomic input revisions/locks/censuses prevent stale receipt reuse. Original
-- quality thresholds, coverage, lineage, output checksum, state/evaluation write
-- and frozen66/1121 math remain unchanged. No capture/fit/audit regeneration,
-- gate weakening, timeout extension, scheduler or production seal invocation.
-- Gold revisions affect future writes only; no nine-million-row backfill/FK.
-- Rollback restores the exact prior seal; historical qualification receipts stay.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
CREATE TEMP TABLE v31_preparation_function_preimages ON COMMIT DROP AS
 SELECT p.oid,p.proname,to_jsonb(p)-'prosrc' AS metadata,md5(p.prosrc) body_md5
 FROM pg_proc p WHERE p.oid IN ('public.fn_gto_v31_cell_payload_checksum(jsonb)'::regprocedure,'public.fn_gto_v31_public215_canonical(jsonb)'::regprocedure,'public.fn_gto_v31_public215_model_canonical_fast(jsonb)'::regprocedure,'public.fn_gto_v31_public215_model_valid(jsonb)'::regprocedure,'public.fn_gto_v31_seal_build(uuid)'::regprocedure,'public.fn_gto_v31_source_node_v3_fields_valid(jsonb)'::regprocedure,'public.fn_gto_v31_source_node_v3_valid(jsonb)'::regprocedure,'public.fn_gto_v31_source_node_v4_valid(jsonb)'::regprocedure);
DO $preflight$ BEGIN
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_cell_payload_checksum(jsonb)'::regprocedure)IS DISTINCT FROM '1c6ca7903c209964f2c4cb442036e7de'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_public215_canonical(jsonb)'::regprocedure)IS DISTINCT FROM '9fdfaf295bb19eaff360d5b3cb9a111a'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_public215_model_canonical_fast(jsonb)'::regprocedure)IS DISTINCT FROM '19dc4b1342d33ff48c70a1715f3fe7d0'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_public215_model_valid(jsonb)'::regprocedure)IS DISTINCT FROM '762098f8d28855034cacd38ae2918fcb'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_seal_build(uuid)'::regprocedure)IS DISTINCT FROM 'e74b379a151846969ec4b1071288c80b'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_source_node_v3_fields_valid(jsonb)'::regprocedure)IS DISTINCT FROM '56dad8b4161a1a112d9b72c814efdbfd'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_source_node_v3_valid(jsonb)'::regprocedure)IS DISTINCT FROM '13b7724a355d40bcc1ca9eb5a8888127'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_source_node_v4_valid(jsonb)'::regprocedure)IS DISTINCT FROM '4757f9005ca956a453ce7be1f5e70d25'THEN RAISE EXCEPTION 'V31 installed validation preimage differs';END IF;
 IF to_regclass('public.gto_v31_seal_input_revisions')IS NOT NULL OR to_regclass('public.gto_v31_seal_cell_preparations')IS NOT NULL THEN RAISE EXCEPTION 'bounded preparation owners already exist; inspect installation history';END IF;
END $preflight$;
-- BEGIN PUBLIC215 SEAL REVISION INPUT OWNERS
-- SOURCE DRAFT, not an executable migration by itself. Root owns integration.
-- No FK/backfill of the nine-million-row gold owner. Future DML upserts one
-- metadata row; this also forces RR unseen-row conflicts to serialize safely.
-- Root superseded tracked-only UPDATE after its demonstrated RR visibility gap.
CREATE TABLE public.gto_v31_seal_input_revisions(
 input_kind text NOT NULL CHECK(input_kind IN('gold','bundle','epoch')),
 input_id text NOT NULL,revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 present boolean NOT NULL DEFAULT true,PRIMARY KEY(input_kind,input_id)
);
CREATE TABLE public.gto_v31_seal_cell_preparations(
 dataset_id uuid NOT NULL,cell_key_checksum text NOT NULL,
 qualification_fingerprint text NOT NULL,input_checksum text NOT NULL,
 preparation_offset integer NOT NULL CHECK(preparation_offset BETWEEN 0 AND 106),
 context jsonb NOT NULL,input_binding jsonb NOT NULL,raw_metrics jsonb NOT NULL,
 receipt_checksum text NOT NULL,prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(dataset_id,cell_key_checksum,qualification_fingerprint,input_checksum),
 CHECK(cell_key_checksum~'^[0-9a-f]{64}$' AND cell_key_checksum<>repeat('0',64)),
 CHECK(qualification_fingerprint~'^[0-9a-f]{64}$' AND input_checksum~'^[0-9a-f]{64}$' AND receipt_checksum~'^[0-9a-f]{64}$')
);
ALTER TABLE public.gto_v31_seal_input_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gto_v31_seal_cell_preparations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gto_v31_seal_input_revisions,public.gto_v31_seal_cell_preparations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_gto_v31_seal_revision_changed()RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $fn$
DECLARE kind text;old_id text;new_id text;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' THEN RAISE EXCEPTION 'unexpected seal revision relation';END IF;
 IF TG_OP='TRUNCATE' THEN
  INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id,revision)VALUES('epoch',TG_TABLE_NAME,1)
  ON CONFLICT(input_kind,input_id)DO UPDATE SET revision=gto_v31_seal_input_revisions.revision+1;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='solved_spots_gold' THEN
  kind:='gold';IF TG_OP<>'INSERT' THEN old_id:=OLD.id::text;END IF;IF TG_OP<>'DELETE' THEN new_id:=NEW.id::text;END IF;
 ELSIF TG_TABLE_NAME='gto_v31_input_bundles' THEN
  kind:='bundle';IF TG_OP<>'INSERT' THEN old_id:=OLD.input_bundle_id::text;END IF;IF TG_OP<>'DELETE' THEN new_id:=NEW.input_bundle_id::text;END IF;
 ELSE RAISE EXCEPTION 'unexpected seal revision relation';END IF;
 IF old_id IS NOT NULL AND(old_id IS DISTINCT FROM new_id OR TG_OP='DELETE') THEN
  INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id,revision,present)VALUES(kind,old_id,1,false)
  ON CONFLICT(input_kind,input_id)DO UPDATE SET revision=gto_v31_seal_input_revisions.revision+1,present=false;
 END IF;
 IF new_id IS NOT NULL THEN
  INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id,revision,present)VALUES(kind,new_id,1,true)
  ON CONFLICT(input_kind,input_id)DO UPDATE SET revision=gto_v31_seal_input_revisions.revision+1,present=true;
 END IF;
 RETURN NULL;
END $fn$;
CREATE TRIGGER gto_v31_seal_gold_revision AFTER INSERT OR UPDATE OR DELETE ON public.solved_spots_gold FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_seal_revision_changed();
CREATE TRIGGER gto_v31_seal_bundle_revision AFTER INSERT OR UPDATE OR DELETE ON public.gto_v31_input_bundles FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_seal_revision_changed();
-- Every relevant TRUNCATE invalidates even if an owner later restores IDs.
DO $epochs$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['solved_spots_gold','gto_v31_input_bundles','gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts','gto_v31_public_source_journal','gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_selections','gto_v31_public_physics','gto_v31_public_model_compiled','gto_v31_public_model_audits','gto_v31_public_model_audit_combos']LOOP
  INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id)VALUES('epoch',name);
  EXECUTE format('CREATE TRIGGER gto_v31_seal_truncate_epoch AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_gto_v31_seal_revision_changed()',name);
 END LOOP;
END $epochs$;
CREATE FUNCTION public.fn_gto_v31_seal_dataset_insert_guard()RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $fn$
BEGIN
 PERFORM d.dataset_id FROM public.gto_v31_datasets d WHERE d.dataset_id=NEW.dataset_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'seal input dataset is absent';END IF;RETURN NEW;
END $fn$;
-- These metadata owners have no dataset FK; make concurrent insert visibility
-- obey the same parent lock as actual nondeferrable source/cell FKs.
DO $insert_guards$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['gto_v31_public_source_journal','gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_selections','gto_v31_seal_cell_preparations']LOOP
  EXECUTE format('CREATE TRIGGER gto_v31_seal_dataset_insert_guard BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_seal_dataset_insert_guard()',name);
 END LOOP;
END $insert_guards$;
CREATE FUNCTION public.fn_gto_v31_seal_audit_append_guard()RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $fn$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'completed audit insertion requires read committed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('v31-public-audit:'||NEW.audit_key,0));
 -- Reuse the existing producer mutex before taking the fresh RC existence snapshot.
 -- Existing audit generation inserts combos BEFORE its parent header, atomically.
 -- Its DEFERRABLE FK alone cannot prevent a late concurrent append.
 IF EXISTS(SELECT 1 FROM public.gto_v31_public_model_audits a WHERE a.audit_key=NEW.audit_key) THEN
  RAISE EXCEPTION 'completed public audit combos cannot be appended';
 END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER gto_v31_seal_audit_append_guard BEFORE INSERT ON public.gto_v31_public_model_audit_combos FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_seal_audit_append_guard();
CREATE TRIGGER gto_v31_seal_preparation_immutable BEFORE UPDATE OR DELETE ON public.gto_v31_seal_cell_preparations FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_public215_immutable_physics();
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_revision_changed(),public.fn_gto_v31_seal_dataset_insert_guard(),public.fn_gto_v31_seal_audit_append_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER gto_v31_seal_revisions_no_truncate BEFORE TRUNCATE ON public.gto_v31_seal_input_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.fn_gto_v31_public215_immutable_physics();
-- END PUBLIC215 SEAL REVISION INPUT OWNERS

-- SOURCE-ONLY DRAFT: Root owns locks, binding receipts and final seal.
-- Each original scoring CTE below is byte-identical except its family filter
-- is replaced by the exact selected cell in both original locations.
CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_cell_metric_raw(p_dataset_id uuid,p_cell_id uuid)
RETURNS jsonb LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=public AS $fn$
  WITH scored_nodes AS MATERIALIZED (
    SELECT r.dataset_id,r.cell_id,r.source_row_id,r.source_node,r.split,
           public.fn_gto_v31_assert_source_contract(n.value,
           (SELECT d.policy_export_schema FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id),
           (SELECT d.icm_model_checksum FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id)) AS node
      FROM public.gto_v31_cell_source_receipts r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      JOIN public.solved_spots_gold s ON s.id=r.source_row_id
      CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND c.cell_id=p_cell_id
       AND n.value->>'node'=r.source_node
       AND n.value->>'node_checksum'=r.source_node_checksum
  ), public_states AS MATERIALIZED (
    SELECT r.*,c.public_model->'action_ids'AS public_actions,
           public.fn_gto_v31_public215_required_audit(c,r.node#>>'{node_context,board}')AS audit_key
      FROM scored_nodes r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
  ), holdout AS MATERIALIZED (
    SELECT r.source_row_id,r.source_node,c.cell_id,c.game_family,
           c.action_specs,i,k.hand_key,
           (SELECT jsonb_object_agg(a.action,ap.frequencies[a.ord::integer]ORDER BY a.ord)FROM jsonb_array_elements_text(r.public_actions)WITH ORDINALITY a(action,ord))AS compact_frequencies,
           ap.policy_ev::numeric AS compact_policy,
           (n.value->'policy_evs_bb'->>i)::numeric AS source_policy,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'frequencies') a) AS source_frequencies,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'action_evs_bb') a) AS source_action_evs,
           (n.value->'matchups'->>i)::numeric AS weight
      FROM public_states r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      CROSS JOIN LATERAL (SELECT r.node AS value) n
      CROSS JOIN generate_series(0,1325) i
      CROSS JOIN LATERAL (SELECT i::text AS hand_key OFFSET 0) k
      LEFT JOIN public.gto_v31_public_model_audit_combos ap ON ap.audit_key=r.audit_key AND ap.combo=i
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND c.cell_id=p_cell_id
       AND n.value->>'node'=r.source_node
       AND (n.value->'matchups'->>i)::numeric>0
  ), action_observations AS MATERIALIZED (
    SELECT h.*,a.key AS action_id,a.value->>'family' AS action_family,
           CASE WHEN a.value->>'family' IN ('bet','raise')
                THEN (a.value->>'size_value')::numeric ELSE NULL END AS size_value,
           (h.source_frequencies->>a.key)::numeric AS source_frequency,
           (h.compact_frequencies->>a.key)::numeric AS compact_frequency,
           (h.source_action_evs->>a.key)::numeric AS source_action_ev
      FROM holdout h CROSS JOIN LATERAL jsonb_each(h.action_specs) a
  ), per_combo AS MATERIALIZED (
    SELECT source_row_id,source_node,cell_id,game_family,i,hand_key,weight,
           max(source_policy) AS source_policy_ev,
           max(compact_policy) AS compact_policy_ev,
           sum(source_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS source_size,
           sum(compact_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS compact_size,
           bool_or(size_value IS NOT NULL) AS sizing_eligible,
           max(source_action_ev) AS best_action_ev,
           sum(compact_frequency*source_action_ev) AS compact_mixed_ev,
           bool_and(compact_frequency IS NOT NULL AND source_action_ev IS NOT NULL)
             AS regret_eligible
      FROM action_observations
     GROUP BY source_row_id,source_node,cell_id,game_family,i,hand_key,weight
  )
  SELECT jsonb_build_object(
    'format','public215_cell_metric_raw_v1','dataset_id',p_dataset_id::text,
    'cell_id',p_cell_id::text,'game_family',cell.game_family,
    'sums',jsonb_build_object(
      'frequency_numerator',(SELECT sum(abs(source_frequency-compact_frequency)*weight)::text FROM action_observations),
      'frequency_denominator',(SELECT sum(weight)::text FROM action_observations),
      'sizing_numerator',(SELECT sum(abs(source_size-compact_size)*weight)::text FROM per_combo WHERE sizing_eligible),
      'sizing_denominator',(SELECT sum(weight)::text FROM per_combo WHERE sizing_eligible),
      'policy_numerator',(SELECT sum(abs(source_policy_ev-compact_policy_ev)*weight)::text FROM per_combo),
      'policy_denominator',(SELECT sum(weight)::text FROM per_combo),
      'regret_numerator',(SELECT sum(greatest(0,best_action_ev-compact_mixed_ev)*weight)::text FROM per_combo WHERE regret_eligible),
      'regret_denominator',(SELECT sum(weight)::text FROM per_combo WHERE regret_eligible)),
    'counts',jsonb_build_object(
      'frequency',(SELECT count(*)::text FROM action_observations),
      'sizing',(SELECT count(*)::text FROM per_combo WHERE sizing_eligible),
      'policy',(SELECT count(*)::text FROM per_combo),
      'regret',(SELECT count(*)::text FROM per_combo WHERE regret_eligible),
      'live',(SELECT count(*)::text FROM per_combo),
      'missing',(SELECT count(*)::text FROM holdout WHERE compact_frequencies IS NULL OR compact_policy IS NULL)),
    'holdout_source_ids',COALESCE((SELECT jsonb_agg(id::text ORDER BY id) FROM (SELECT DISTINCT source_row_id id FROM holdout) ids),'[]'::jsonb))
  FROM public.gto_v31_runtime_cells cell
  WHERE cell.dataset_id=p_dataset_id AND cell.cell_id=p_cell_id AND cell.policy_representation='public_hist215_v1';
$fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_cell_metric_raw(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- SOURCE-ONLY: only immutable, origin-bound raw receipts may reach this helper.
-- No division or NULL-to-zero was done when producing each cell's statistics.
CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_metrics_from_raw(p_raw_receipts jsonb,p_game_family text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE v_raw jsonb;v_value jsonb;v_key text;v_dataset text;v_cell_ids text[]:=ARRAY[]::text[];v_source_id text;
 sum_keys constant text[]:=ARRAY['frequency_numerator','frequency_denominator','sizing_numerator','sizing_denominator','policy_numerator','policy_denominator','regret_numerator','regret_denominator'];
 count_keys constant text[]:=ARRAY['frequency','sizing','policy','regret','live','missing'];
BEGIN
 IF jsonb_typeof(p_raw_receipts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'raw metric receipt array required'; END IF;
 FOR v_raw IN SELECT v FROM jsonb_array_elements(p_raw_receipts) v LOOP
  IF jsonb_typeof(v_raw) IS DISTINCT FROM 'object'
   OR v_raw-ARRAY['format','dataset_id','cell_id','game_family','sums','counts','holdout_source_ids']<>'{}'::jsonb
   OR NOT v_raw?&ARRAY['format','dataset_id','cell_id','game_family','sums','counts','holdout_source_ids']
   OR v_raw->'format' IS DISTINCT FROM '"public215_cell_metric_raw_v1"'::jsonb
   OR jsonb_typeof(v_raw->'dataset_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_raw->'cell_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_raw->'game_family') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_raw->'sums') IS DISTINCT FROM 'object'
   OR (v_raw->'sums')-sum_keys<>'{}'::jsonb OR NOT (v_raw->'sums')?&sum_keys
   OR jsonb_typeof(v_raw->'counts') IS DISTINCT FROM 'object'
   OR (v_raw->'counts')-count_keys<>'{}'::jsonb OR NOT (v_raw->'counts')?&count_keys
   OR jsonb_typeof(v_raw->'holdout_source_ids') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'raw metric receipt shape differs'; END IF;
  IF ((v_raw->>'dataset_id')::uuid)::text IS DISTINCT FROM v_raw->>'dataset_id'
   OR ((v_raw->>'cell_id')::uuid)::text IS DISTINCT FROM v_raw->>'cell_id'
   OR (v_dataset IS NOT NULL AND v_dataset IS DISTINCT FROM v_raw->>'dataset_id')
   OR (v_raw->>'cell_id')=ANY(v_cell_ids)
  THEN RAISE EXCEPTION 'raw metric receipt identity differs or repeats'; END IF;
  v_dataset:=v_raw->>'dataset_id';v_cell_ids:=array_append(v_cell_ids,v_raw->>'cell_id');
  FOREACH v_key IN ARRAY sum_keys LOOP
   v_value:=v_raw->'sums'->v_key;
   IF v_value IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(v_value) IS DISTINCT FROM 'string' OR (v_value#>>'{}')!~'^-?[0-9]+(\.[0-9]+)?$')
   THEN RAISE EXCEPTION 'raw metric sum must be exact NUMERIC text or null'; END IF;
  END LOOP;
  FOREACH v_key IN ARRAY count_keys LOOP
   v_value:=v_raw->'counts'->v_key;
   IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' OR (v_value#>>'{}')!~'^(0|[1-9][0-9]*)$'
   THEN RAISE EXCEPTION 'raw metric count must be exact nonnegative integer text'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_raw->'holdout_source_ids') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
   OR (SELECT count(*) FROM jsonb_array_elements(v_raw->'holdout_source_ids'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(v_raw->'holdout_source_ids') x)
  THEN RAISE EXCEPTION 'raw metric source identity set differs'; END IF;
  FOR v_source_id IN SELECT x FROM jsonb_array_elements_text(v_raw->'holdout_source_ids') x LOOP
   IF v_source_id::uuid::text IS DISTINCT FROM v_source_id THEN RAISE EXCEPTION 'raw metric source identity is not canonical'; END IF;
  END LOOP;
 END LOOP;
 RETURN (
  WITH selected AS MATERIALIZED (
   SELECT e.value r FROM jsonb_array_elements(p_raw_receipts) e
    WHERE p_game_family IS NULL OR e.value->>'game_family'=p_game_family
  ), totals AS (
   SELECT sum((r#>>'{sums,frequency_numerator}')::numeric) fn,
          sum((r#>>'{sums,frequency_denominator}')::numeric) fd,
          sum((r#>>'{sums,sizing_numerator}')::numeric) sn,
          sum((r#>>'{sums,sizing_denominator}')::numeric) sd,
          sum((r#>>'{sums,policy_numerator}')::numeric) pn,
          sum((r#>>'{sums,policy_denominator}')::numeric) pd,
          sum((r#>>'{sums,regret_numerator}')::numeric) rn,
          sum((r#>>'{sums,regret_denominator}')::numeric) rd,
          COALESCE(sum((r#>>'{counts,frequency}')::numeric),0) frequency_count,
          COALESCE(sum((r#>>'{counts,sizing}')::numeric),0) sizing_count,
          COALESCE(sum((r#>>'{counts,policy}')::numeric),0) policy_count,
          COALESCE(sum((r#>>'{counts,regret}')::numeric),0) regret_count,
          COALESCE(sum((r#>>'{counts,live}')::numeric),0) live_count,
          COALESCE(sum((r#>>'{counts,missing}')::numeric),0) missing_count
    FROM selected
  )
  SELECT jsonb_build_object(
   'frequency_mae',fn/NULLIF(fd,0),
   'sizing_mae',COALESCE(sn/NULLIF(sd,0),0),
   'policy_ev_mae_bb',pn/NULLIF(pd,0),
   'mean_action_regret_bb',rn/NULLIF(rd,0),
   'regret_coverage',regret_count/NULLIF(policy_count,0),
   'holdout_source_rows',(SELECT count(DISTINCT ids.source_id) FROM selected CROSS JOIN LATERAL jsonb_array_elements_text(r->'holdout_source_ids') ids(source_id)),
   'frequency_observations',frequency_count,
   'sizing_observations',sizing_count,
   'policy_ev_observations',policy_count,
   'regret_observations',regret_count,
   'live_combo_observations',live_count,
   'missing_observations',missing_count
  ) FROM totals
 );
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_metrics_from_raw(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- SOURCE DRAFT. Stable identities/definitions/security only, never catalog OIDs
-- or estimates. Conservative closure includes all V31 owners and shared scalar
-- JSON/texture dependencies; changing one invalidates previous preparations.
CREATE FUNCTION public.fn_gto_v31_seal_qualification_fingerprint()RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog,extensions AS $fn$
 WITH relations AS MATERIALIZED(
 SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 AND c.relname=ANY(ARRAY['gto_v31_datasets','gto_v31_input_bundles','gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts','solved_spots_gold','gto_v31_public_source_journal','gto_v31_public_selections','gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_physics','gto_v31_public_model_compiled','gto_v31_public_model_audits','gto_v31_public_model_audit_combos','gto_v31_seal_input_revisions','gto_v31_seal_cell_preparations'])
 ), definitions AS MATERIALIZED(
 SELECT p.oid,p.proname,n.nspname,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proisstrict,p.proparallel,p.proleakproof,p.proconfig,
 pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) body
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND(position('gto_v31' IN p.proname)>0 OR p.proname IN('fn_gto_texture_class','fn_gto_texture_class_any','fn_training_canonical_jsonb_text_v1'))
 )
 SELECT public.fn_gto_v31_json_checksum(jsonb_build_object('format','public215_preseal_qualification_v1',
 'functions',(SELECT jsonb_agg(jsonb_build_object('identity',nspname||'.'||proname||'('||args||')','definition',body,
 'owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'volatility',provolatile,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'config',proconfig,
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee=0,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor))FROM aclexplode(COALESCE(proacl,acldefault('f',proowner)))a))ORDER BY nspname,proname,args)FROM definitions),
 'relations',(SELECT jsonb_agg(jsonb_build_object('name',r.relname,'owner',pg_get_userbyid(r.relowner),'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))ORDER BY a.attnum)FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee=0,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor))FROM aclexplode(COALESCE(r.relacl,acldefault('r',r.relowner)))a),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred)ORDER BY c.conname)FROM pg_constraint c WHERE c.conrelid=r.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',CASE WHEN t.tgisinternal THEN NULL ELSE t.tgname END,'type',t.tgtype,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,'arguments',encode(t.tgargs,'hex'),'constraint',CASE WHEN t.tgconstraint<>0 THEN pg_get_constraintdef(t.tgconstraint)ELSE NULL END,'definition',CASE WHEN NOT t.tgisinternal THEN pg_get_triggerdef(t.oid)ELSE NULL END)ORDER BY t.tgisinternal,t.tgfoid::regprocedure::text,t.tgtype,CASE WHEN t.tgconstraint<>0 THEN pg_get_constraintdef(t.tgconstraint)ELSE ''END,CASE WHEN NOT t.tgisinternal THEN t.tgname ELSE ''END)FROM pg_trigger t WHERE t.tgrelid=r.oid))ORDER BY r.relname)FROM relations r)))
$fn$;
CREATE FUNCTION public.fn_gto_v31_seal_preparation_guards()RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $fn$
DECLARE r record;fk oid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'bounded sealing requires read committed';END IF;
 FOR r IN SELECT * FROM(VALUES
 ('solved_spots_gold','gto_v31_seal_gold_revision','fn_gto_v31_seal_revision_changed'),('gto_v31_input_bundles','gto_v31_seal_bundle_revision','fn_gto_v31_seal_revision_changed'),
 ('gto_v31_runtime_cells','gto_v31_public215_cell_immutable','fn_gto_v31_public215_cell_immutable'),('gto_v31_model_preparations','gto_v31_model_preparations_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_model_freezes','gto_v31_model_freezes_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_source_journal','gto_v31_public_source_journal_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_public_selections','gto_v31_public_selections_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_model_audits','gto_v31_public_model_audits_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_public_model_audit_combos','gto_v31_public_model_audit_combos_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_physics','gto_v31_public_physics_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_public_model_compiled','gto_v31_public_model_compiled_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_model_audit_combos','gto_v31_seal_audit_append_guard','fn_gto_v31_seal_audit_append_guard'),('gto_v31_seal_cell_preparations','gto_v31_seal_preparation_immutable','fn_gto_v31_public215_immutable_physics'))v(relation,trigger_name,function_name)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=('public.'||r.relation)::regclass AND t.tgname=r.trigger_name AND t.tgenabled IN('O','A') AND t.tgtype=CASE WHEN r.trigger_name IN('gto_v31_seal_gold_revision','gto_v31_seal_bundle_revision')THEN 29 WHEN r.trigger_name='gto_v31_seal_audit_append_guard'THEN 7 ELSE 27 END AND t.tgqual IS NULL AND t.tgattr::text='' AND p.proname=r.function_name AND p.pronamespace='public'::regnamespace)THEN RAISE EXCEPTION 'bounded seal mutation guard missing';END IF;
 END LOOP;
 IF(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_gto_v31_public215_cell_immutable()'::regprocedure)<>'3f134c10be911c591966e47ce71c1857'
 OR(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_gto_v31_public215_immutable_physics()'::regprocedure)<>'3e077e1da2805175f53325ca4487feee' THEN RAISE EXCEPTION 'bounded seal immutable owners changed';END IF;
 FOR r IN SELECT unnest(ARRAY['gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts'])name LOOP
  SELECT c.oid INTO STRICT fk FROM pg_constraint c WHERE c.conrelid=('public.'||r.name)::regclass AND c.confrelid='public.gto_v31_datasets'::regclass AND c.contype='f' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred;
  IF(SELECT count(*)=4 AND bool_and(tgenabled IN('O','A'))FROM pg_trigger WHERE tgconstraint=fk)IS NOT TRUE THEN RAISE EXCEPTION 'bounded seal dataset FK absent';END IF;
 END LOOP;
 FOR r IN SELECT unnest(ARRAY['gto_v31_public_source_journal','gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_selections','gto_v31_seal_cell_preparations'])name LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=('public.'||r.name)::regclass AND t.tgname='gto_v31_seal_dataset_insert_guard' AND t.tgtype=7 AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgfoid='public.fn_gto_v31_seal_dataset_insert_guard()'::regprocedure AND t.tgenabled IN('O','A'))THEN RAISE EXCEPTION 'bounded seal parent insert guard absent';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.gto_v31_seal_input_revisions v WHERE v.input_kind='epoch' AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=('public.'||v.input_id)::regclass AND t.tgname='gto_v31_seal_truncate_epoch' AND t.tgtype=32 AND t.tgqual IS NULL AND t.tgfoid='public.fn_gto_v31_seal_revision_changed()'::regprocedure AND t.tgenabled IN('O','A')))OR(SELECT count(*)FROM public.gto_v31_seal_input_revisions WHERE input_kind='epoch')<>13 THEN RAISE EXCEPTION 'bounded seal truncate guards absent';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.gto_v31_seal_input_revisions'::regclass AND t.tgname='gto_v31_seal_revisions_no_truncate'AND t.tgtype=34 AND t.tgqual IS NULL AND t.tgfoid='public.fn_gto_v31_public215_immutable_physics()'::regprocedure AND t.tgenabled IN('O','A'))THEN RAISE EXCEPTION 'seal revision clocks cannot be reset';END IF;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner)))a WHERE c.oid IN('public.gto_v31_seal_input_revisions'::regclass,'public.gto_v31_seal_cell_preparations'::regclass)AND a.grantee<>c.relowner)THEN RAISE EXCEPTION 'seal receipts must remain owner-only';END IF;
END $fn$;
CREATE FUNCTION public.fn_gto_v31_public215_seal_cell_binding(p_dataset_id uuid,p_cell_key text)RETURNS jsonb
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path=public,pg_catalog,extensions AS $fn$
DECLARE d public.gto_v31_datasets;b public.gto_v31_input_bundles;c public.gto_v31_runtime_cells;p public.gto_v31_model_preparations;f public.gto_v31_model_freezes;
 receipt_rows jsonb;source_versions jsonb;journal_rows jsonb;audit_rows jsonb;bundle_revision bigint;ordinal bigint;
BEGIN
 SELECT * INTO STRICT d FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND state='building'AND policy_representation='public_hist215_v1';
 SELECT * INTO STRICT b FROM public.gto_v31_input_bundles WHERE input_bundle_id=d.input_bundle_id AND bundle_checksum=d.input_bundle_checksum AND approval_status='approved';
 SELECT * INTO STRICT c FROM public.gto_v31_runtime_cells WHERE dataset_id=d.dataset_id AND cell_key_checksum=p_cell_key AND policy_representation='public_hist215_v1';
 SELECT * INTO STRICT p FROM public.gto_v31_model_preparations WHERE dataset_id=d.dataset_id AND cell_key_checksum=c.cell_key_checksum;
 SELECT * INTO STRICT f FROM public.gto_v31_model_freezes WHERE dataset_id=d.dataset_id AND cell_key_checksum=c.cell_key_checksum;
 IF p.context IS DISTINCT FROM c.public_template->'context' OR p.identity->>'model_checksum' IS DISTINCT FROM c.model_checksum OR p.identity->>'template_checksum'IS DISTINCT FROM c.template_checksum OR p.identity->>'training_provenance_checksum'IS DISTINCT FROM c.training_provenance_checksum OR f.model_build_receipt_checksum IS DISTINCT FROM c.model_build_receipt_checksum OR f.public_model_build_receipt IS DISTINCT FROM c.public_model_build_receipt THEN RAISE EXCEPTION 'prepared model differs from frozen model';END IF;
 SELECT count(*)INTO ordinal FROM public.gto_v31_model_preparations z WHERE z.dataset_id=d.dataset_id AND public.fn_gto_v31_public215_canonical(z.context)COLLATE "C"<public.fn_gto_v31_public215_canonical(p.context)COLLATE "C";
 SELECT COALESCE(revision,0)INTO bundle_revision FROM public.gto_v31_seal_input_revisions WHERE input_kind='bundle'AND input_id=b.input_bundle_id::text;bundle_revision:=COALESCE(bundle_revision,0);
 SELECT jsonb_agg(to_jsonb(r)ORDER BY r.source_row_id::text COLLATE "C",r.source_node COLLATE "C")INTO receipt_rows FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id AND r.dataset_id=d.dataset_id;
 SELECT jsonb_agg(jsonb_build_object('artifact',to_jsonb(a),'gold_id',g.id,'gold_revision',COALESCE(v.revision,0),'present',COALESCE(v.present,true),'scenario_hash',g.scenario_hash,'quality_status',g.quality_status,'audited_at',g.audited_at,'source_artifact_checksum',g.source_artifact_checksum,'machine_id',g.machine_id,'solver_version',g.solver_version,'solver_binary_checksum',g.solver_binary_checksum,'pipeline_commit',g.pipeline_commit,'pipeline_bundle_checksum',g.pipeline_bundle_checksum,'manifest_version',g.manifest_version,'manifest_checksum',g.manifest_checksum)ORDER BY a.source_row_id::text COLLATE "C")INTO source_versions
 FROM public.gto_v31_source_artifacts a JOIN public.solved_spots_gold g ON g.id=a.source_row_id LEFT JOIN public.gto_v31_seal_input_revisions v ON v.input_kind='gold'AND v.input_id=g.id::text WHERE a.dataset_id=d.dataset_id AND a.source_row_id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id);
 SELECT jsonb_agg(to_jsonb(j)ORDER BY j.source_row_id::text COLLATE "C",j.source_node COLLATE "C")INTO journal_rows FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=d.dataset_id AND j.context=p.context;
 SELECT jsonb_agg(jsonb_build_object('audit_key',a.audit_key,'physics_key',a.physics_key,'model_checksum',a.model_checksum,'template_checksum',a.template_checksum,'encoding_checksum',a.encoding_checksum,'legal_combos',a.legal_combos,'audit_checksum',a.audit_checksum,'prepared_at',a.prepared_at,'derived_count',(SELECT count(*)FROM public.gto_v31_public_model_audit_combos z WHERE z.audit_key=a.audit_key))ORDER BY a.audit_key COLLATE "C")INTO audit_rows
 FROM public.gto_v31_public_source_journal j JOIN public.gto_v31_public_model_audits a ON a.audit_key=public.fn_gto_v31_public215_required_audit(c,j.board)WHERE j.dataset_id=d.dataset_id AND j.context=p.context AND j.machine_id='M2';
 RETURN jsonb_build_object('dataset',to_jsonb(d),'bundle',jsonb_build_object('input_bundle_id',b.input_bundle_id,'bundle_key',b.bundle_key,'bundle_checksum',b.bundle_checksum,'range_bundle_checksum',b.range_bundle_checksum,'source_combo_order_checksum',b.source_combo_order_checksum,'icm_model_checksum',b.icm_model_checksum,'approval_status',b.approval_status,'approved_by',b.approved_by,'approved_at',b.approved_at,'revoked_by',b.revoked_by,'revoked_at',b.revoked_at,'revocation_reason',b.revocation_reason,'feature_contract_version',b.feature_contract_version,'policy_export_schema',b.policy_export_schema,'policy_representation',b.policy_representation),'bundle_revision',bundle_revision,'epochs',(SELECT jsonb_object_agg(input_id,revision)FROM public.gto_v31_seal_input_revisions WHERE input_kind='epoch'),
 'cell',jsonb_build_object('cell_id',c.cell_id,'cell_key_checksum',c.cell_key_checksum,'context',p.context,'preparation_offset',ordinal,'model_checksum',c.model_checksum,'template_checksum',c.template_checksum,'training_provenance_checksum',c.training_provenance_checksum,'model_build_receipt_checksum',c.model_build_receipt_checksum,'cell_payload_checksum',c.cell_payload_checksum,'lineage_checksum',c.lineage_checksum,'sql_physics_checksum',c.sql_physics_checksum,'source_rows',c.source_rows,'train_source_rows',c.train_source_rows,'holdout_source_rows',c.holdout_source_rows),
 'receipts',receipt_rows,'sources',source_versions,'journal',journal_rows,'audits',audit_rows);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_qualification_fingerprint(),public.fn_gto_v31_seal_preparation_guards(),public.fn_gto_v31_public215_seal_cell_binding(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- SOURCE DRAFT. Every caller holds the dataset parent lock first. Row locks
-- are bounded to this offline dataset; no game/seat/money owner is touched.
CREATE FUNCTION public.fn_gto_v31_public215_lock_seal_inputs(p_dataset_id uuid,p_cell_key text DEFAULT NULL)RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $fn$
DECLARE bundle uuid;
BEGIN
 SELECT input_bundle_id INTO STRICT bundle FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND state='building'AND policy_representation='public_hist215_v1'FOR UPDATE;
 PERFORM b.input_bundle_id FROM public.gto_v31_input_bundles b WHERE b.input_bundle_id=bundle ORDER BY b.input_bundle_id FOR SHARE;
 PERFORM c.cell_id FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key)ORDER BY c.cell_key_checksum COLLATE "C"FOR SHARE;
 PERFORM p.cell_key_checksum FROM public.gto_v31_model_preparations p WHERE p.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR p.cell_key_checksum=p_cell_key)ORDER BY p.cell_key_checksum COLLATE "C"FOR SHARE;
 PERFORM f.cell_key_checksum FROM public.gto_v31_model_freezes f WHERE f.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR f.cell_key_checksum=p_cell_key)ORDER BY f.cell_key_checksum COLLATE "C"FOR SHARE;
 PERFORM s.dataset_id FROM public.gto_v31_public_selections s WHERE s.dataset_id=p_dataset_id FOR SHARE;
 PERFORM r.cell_id FROM public.gto_v31_cell_source_receipts r WHERE r.dataset_id=p_dataset_id AND r.cell_id IN(SELECT c.cell_id FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ORDER BY r.cell_id,r.source_row_id,r.source_node COLLATE "C"FOR SHARE;
 PERFORM a.source_row_id FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=p_dataset_id AND a.source_row_id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ORDER BY a.source_row_id FOR SHARE;
 PERFORM j.source_row_id FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR j.context=(SELECT c.public_template->'context'FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.cell_key_checksum=p_cell_key))ORDER BY j.source_row_id,j.source_node COLLATE "C"FOR SHARE;
 PERFORM g.id FROM public.solved_spots_gold g WHERE g.id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ORDER BY g.id FOR SHARE;
 PERFORM a.audit_key FROM public.gto_v31_public_model_audits a WHERE EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c JOIN public.gto_v31_public_source_journal j ON j.dataset_id=c.dataset_id AND j.context=c.public_template->'context'AND j.machine_id='M2'WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key)AND a.model_checksum=c.model_checksum AND a.template_checksum=c.template_checksum AND a.chronological_board=ARRAY(SELECT substring(j.board FROM n FOR 2)FROM generate_series(1,length(j.board),2)n ORDER BY n))ORDER BY a.audit_key COLLATE "C"FOR SHARE;
 -- Seed only IDs that are already SHARE-locked. Concurrent UPSERT writers
 -- either wait on their gold/bundle row or serialize on this metadata PK.
 INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id)
 SELECT 'gold',g.id::text FROM public.solved_spots_gold g WHERE g.id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ON CONFLICT DO NOTHING;
 INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id)VALUES('bundle',bundle::text)ON CONFLICT DO NOTHING;
 PERFORM v.input_id FROM public.gto_v31_seal_input_revisions v WHERE v.input_kind='epoch'OR(v.input_kind='bundle'AND v.input_id=bundle::text)OR(v.input_kind='gold'AND v.input_id IN(SELECT r.source_row_id::text FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key)))ORDER BY v.input_kind,v.input_id COLLATE "C"FOR SHARE;
END $fn$;
CREATE FUNCTION public.fn_gto_v31_public215_preseal_reply(p_binding jsonb,p_fingerprint text,p_receipt text,p_status text)RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $fn$
 SELECT jsonb_build_object('format','public215_preseal_cell_v1','dataset_id',p_binding#>>'{dataset,dataset_id}','preparation_offset',p_binding#>'{cell,preparation_offset}','cell_key_checksum',p_binding#>>'{cell,cell_key_checksum}','model_checksum',p_binding#>>'{cell,model_checksum}','template_checksum',p_binding#>>'{cell,template_checksum}','training_provenance_checksum',p_binding#>>'{cell,training_provenance_checksum}','model_build_receipt_checksum',p_binding#>>'{cell,model_build_receipt_checksum}','receipt_checksum',p_receipt,'qualification_fingerprint',p_fingerprint,'status',p_status)
$fn$;
CREATE FUNCTION public.fn_gto_v31_seal_cell_preparation_status(p_dataset_id uuid,p_cell_key_checksum text)RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $fn$
DECLARE binding jsonb;fingerprint text;input_sha text;r public.gto_v31_seal_cell_preparations;status text;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role'THEN RAISE EXCEPTION 'service_role required';END IF;
 PERFORM public.fn_gto_v31_seal_preparation_guards();
 binding:=public.fn_gto_v31_public215_seal_cell_binding(p_dataset_id,p_cell_key_checksum);fingerprint:=public.fn_gto_v31_seal_qualification_fingerprint();input_sha:=public.fn_gto_v31_json_checksum(binding);
 SELECT * INTO r FROM public.gto_v31_seal_cell_preparations WHERE dataset_id=p_dataset_id AND cell_key_checksum=p_cell_key_checksum AND qualification_fingerprint=fingerprint AND input_checksum=input_sha;
 status:=CASE WHEN FOUND THEN 'prepared'WHEN EXISTS(SELECT 1 FROM public.gto_v31_seal_cell_preparations WHERE dataset_id=p_dataset_id AND cell_key_checksum=p_cell_key_checksum)THEN 'stale'ELSE 'missing'END;
 -- Reply helper is deliberately non-STRICT because absent receipt is JSON null.
 RETURN jsonb_build_object('format','public215_preseal_cell_v1','dataset_id',p_dataset_id,'preparation_offset',binding#>'{cell,preparation_offset}','cell_key_checksum',p_cell_key_checksum,'model_checksum',binding#>>'{cell,model_checksum}','template_checksum',binding#>>'{cell,template_checksum}','training_provenance_checksum',binding#>>'{cell,training_provenance_checksum}','model_build_receipt_checksum',binding#>>'{cell,model_build_receipt_checksum}','receipt_checksum',r.receipt_checksum,'qualification_fingerprint',fingerprint,'status',status);
END $fn$;
CREATE FUNCTION public.fn_gto_v31_prepare_seal_cell(p_dataset_id uuid,p_cell_key_checksum text)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog,extensions SET statement_timeout='240s' SET lock_timeout='1s'AS $fn$
DECLARE d public.gto_v31_datasets;c public.gto_v31_runtime_cells;b public.gto_v31_input_bundles;g record;node jsonb;binding jsonb;raw jsonb;fingerprint text;after_fingerprint text;input_sha text;receipt text;lineage text;source_n bigint;train_n bigint;holdout_n bigint;approved_cases jsonb;case_item jsonb;board_cards text[];v_physics_key text;v_audit_key text;legal_count integer;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role'THEN RAISE EXCEPTION 'service_role required';END IF;
 IF COALESCE(p_cell_key_checksum,'')!~'^[0-9a-f]{64}$'OR p_cell_key_checksum=repeat('0',64)THEN RAISE EXCEPTION 'canonical seal cell required';END IF;
 PERFORM public.fn_gto_v31_seal_preparation_guards();
 PERFORM public.fn_gto_v31_public215_lock_seal_inputs(p_dataset_id,p_cell_key_checksum);
 SELECT * INTO STRICT d FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id;
 SELECT * INTO STRICT c FROM public.gto_v31_runtime_cells WHERE dataset_id=d.dataset_id AND cell_key_checksum=p_cell_key_checksum;
 SELECT * INTO STRICT b FROM public.gto_v31_input_bundles WHERE input_bundle_id=d.input_bundle_id AND approval_status='approved'AND bundle_checksum=d.input_bundle_checksum;
 IF jsonb_array_length(d.declared_coverage)<>107 OR c.policy_representation IS DISTINCT FROM 'public_hist215_v1'OR c.feature_contract_version IS DISTINCT FROM d.feature_contract_version OR c.policy_export_schema IS DISTINCT FROM d.policy_export_schema
 OR b.range_bundle_checksum IS DISTINCT FROM d.range_bundle_checksum OR b.source_combo_order_checksum IS DISTINCT FROM d.source_combo_order_checksum OR b.icm_model_checksum IS DISTINCT FROM d.icm_model_checksum THEN RAISE EXCEPTION 'approved full public seal contract required';END IF;
 fingerprint:=public.fn_gto_v31_seal_qualification_fingerprint();binding:=public.fn_gto_v31_public215_seal_cell_binding(d.dataset_id,c.cell_key_checksum);input_sha:=public.fn_gto_v31_json_checksum(binding);
 IF EXISTS(SELECT 1 FROM public.gto_v31_seal_cell_preparations WHERE dataset_id=d.dataset_id AND cell_key_checksum=c.cell_key_checksum AND qualification_fingerprint=fingerprint AND input_checksum=input_sha)THEN RAISE EXCEPTION 'seal preparation already exists; inspect status, never retry implicitly';END IF;
 -- Pure full payload validation may call prepare_audit for Linux cases.
 -- Admit only already-complete caches, under locks, so that call is read reuse.
 SELECT value->'cases'INTO STRICT approved_cases FROM jsonb_array_elements(b.bundle_manifest#>'{public215_protocols,runtime_parity_protocol,contexts}')x(value)WHERE value->'context'=c.public_template->'context';
 IF jsonb_typeof(approved_cases)IS DISTINCT FROM 'array'OR jsonb_array_length(approved_cases)NOT BETWEEN 2 AND 32 THEN RAISE EXCEPTION 'approved Linux cases required';END IF;
 legal_count:=CASE c.street WHEN 'flop'THEN 1176 WHEN 'turn'THEN 1128 WHEN 'river'THEN 1081 ELSE 0 END;
 PERFORM z.model_checksum FROM public.gto_v31_public_model_compiled z WHERE z.model_checksum=c.model_checksum AND z.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation()FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'compiled model cache missing; no regeneration during sealing';END IF;
 FOR case_item IN SELECT value FROM jsonb_array_elements(approved_cases)LOOP
  SELECT array_agg(substring(case_item->>'board'FROM k FOR 2)ORDER BY k)INTO board_cards FROM generate_series(1,length(case_item->>'board'),2)k;
  v_physics_key:=public.fn_gto_v31_public215_physics_key(c.public_template,board_cards);
  PERFORM ph.physics_key FROM public.gto_v31_public_physics ph WHERE ph.physics_key=v_physics_key AND ph.implementation_checksum=public.fn_gto_v31_public215_physics_implementation()AND ph.legal_combos=legal_count AND jsonb_array_length(ph.exact_mass_rows)=legal_count FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linux physics cache missing; no regeneration during sealing';END IF;
  v_audit_key:=public.fn_gto_v31_public215_audit_key(c.model_checksum,c.template_checksum,board_cards,v_physics_key);
  PERFORM z.audit_key FROM public.gto_v31_public_model_audits z WHERE z.audit_key=v_audit_key AND z.physics_key=v_physics_key AND z.model_checksum=c.model_checksum AND z.template_checksum=c.template_checksum AND z.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation()AND z.chronological_board=board_cards AND z.legal_combos=legal_count FOR SHARE;
  IF NOT FOUND OR(SELECT count(*)FROM public.gto_v31_public_model_audit_combos z WHERE z.audit_key=v_audit_key)<>legal_count THEN RAISE EXCEPTION 'Linux audit cache missing/incomplete; no regeneration during sealing';END IF;
 END LOOP;
 IF c.cell_key_checksum IS DISTINCT FROM public.fn_gto_v31_cell_key_checksum(to_jsonb(c))OR c.cell_payload_checksum IS DISTINCT FROM public.fn_gto_v31_cell_payload_checksum(to_jsonb(c))OR public.fn_gto_v31_cell_payload_valid(to_jsonb(c))IS NOT TRUE THEN RAISE EXCEPTION 'full current cell payload validation failed';END IF;
 IF public.fn_gto_v31_public215_source_headers_valid(d)IS NOT TRUE OR public.fn_gto_v31_public215_selected_complete(d)IS NOT TRUE OR public.fn_gto_v31_public215_frozen_model_valid(c,d)IS NOT TRUE THEN RAISE EXCEPTION 'current complete source/selection/model authority required';END IF;
 SELECT count(*),count(*)FILTER(WHERE machine_id='M1'AND split='train'),count(*)FILTER(WHERE machine_id='M2'AND split='holdout'),encode(digest(string_agg(source_row_id::text||':'||source_node||':'||source_node_checksum,''ORDER BY source_row_id::text,source_node),'sha256'),'hex')INTO source_n,train_n,holdout_n,lineage FROM public.gto_v31_cell_source_receipts WHERE dataset_id=d.dataset_id AND cell_id=c.cell_id;
 IF source_n<>65 OR train_n<>57 OR holdout_n<>8 OR c.source_rows<>source_n OR c.train_source_rows<>train_n OR c.holdout_source_rows<>holdout_n OR c.lineage_checksum IS DISTINCT FROM lineage THEN RAISE EXCEPTION 'full current source lineage required';END IF;
 IF(SELECT count(*)FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_public_source_journal j ON j.dataset_id=r.dataset_id AND j.source_row_id=r.source_row_id AND j.source_node=r.source_node AND j.node_checksum=r.source_node_checksum AND j.artifact_checksum=r.source_artifact_checksum AND j.machine_id=r.machine_id WHERE r.cell_id=c.cell_id AND j.context=c.public_template->'context')<>65 THEN RAISE EXCEPTION 'current source journal membership differs';END IF;
 FOR g IN SELECT a.source_artifact_checksum AS expected_artifact_checksum,a.node_count,s.*FROM public.gto_v31_source_artifacts a JOIN public.solved_spots_gold s ON s.id=a.source_row_id WHERE a.dataset_id=d.dataset_id AND a.source_row_id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id)ORDER BY a.source_row_id LOOP
  IF g.expected_artifact_checksum IS DISTINCT FROM g.source_artifact_checksum OR g.quality_status IS DISTINCT FROM 'validated'OR g.audited_at IS NULL OR g.source_artifact_checksum IS DISTINCT FROM public.fn_gto_v31_source_artifact_checksum(g.scenario_hash,g.strategy_matrix_v2)THEN RAISE EXCEPTION 'fresh full source artifact validation failed';END IF;
  IF jsonb_array_length(g.strategy_matrix_v2->'nodes')IS DISTINCT FROM g.node_count THEN RAISE EXCEPTION 'source artifact node census differs';END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(g.strategy_matrix_v2->'nodes')LOOP
   PERFORM public.fn_gto_v31_assert_source_contract(node,d.policy_export_schema,d.icm_model_checksum);
  END LOOP;
 END LOOP;
 IF jsonb_array_length(binding->'audits')<>8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(binding->'audits')a WHERE(a->>'derived_count')::bigint<>(a->>'legal_combos')::bigint OR(a->>'legal_combos')::integer<>CASE c.street WHEN 'flop'THEN 1176 WHEN 'turn'THEN 1128 WHEN 'river'THEN 1081 ELSE 0 END OR COALESCE(a->>'audit_checksum','')!~'^[0-9a-f]{64}$'OR a->>'audit_checksum'=repeat('0',64))THEN RAISE EXCEPTION 'all eight complete independent audits required';END IF;
 raw:=public.fn_gto_v31_public215_cell_metric_raw(d.dataset_id,c.cell_id);
 IF raw IS NULL OR raw->>'dataset_id'IS DISTINCT FROM d.dataset_id::text OR raw->>'cell_id'IS DISTINCT FROM c.cell_id::text THEN RAISE EXCEPTION 'exact raw metrics required';END IF;
 after_fingerprint:=public.fn_gto_v31_seal_qualification_fingerprint();
 IF after_fingerprint IS DISTINCT FROM fingerprint OR public.fn_gto_v31_public215_seal_cell_binding(d.dataset_id,c.cell_key_checksum)IS DISTINCT FROM binding THEN RAISE EXCEPTION 'seal preparation inputs/implementation changed';END IF;
 receipt:=public.fn_gto_v31_json_checksum(jsonb_build_object('format','public215_preseal_receipt_v1','qualification_fingerprint',fingerprint,'input_binding',binding,'raw_metrics',raw));
 INSERT INTO public.gto_v31_seal_cell_preparations(dataset_id,cell_key_checksum,qualification_fingerprint,input_checksum,preparation_offset,context,input_binding,raw_metrics,receipt_checksum)VALUES(d.dataset_id,c.cell_key_checksum,fingerprint,input_sha,(binding#>>'{cell,preparation_offset}')::integer,c.public_template->'context',binding,raw,receipt);
 RETURN public.fn_gto_v31_public215_preseal_reply(binding,fingerprint,receipt,'prepared');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_lock_seal_inputs(uuid,text),public.fn_gto_v31_public215_preseal_reply(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_prepare_seal_cell(uuid,text),public.fn_gto_v31_seal_cell_preparation_status(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_prepare_seal_cell(uuid,text),public.fn_gto_v31_seal_cell_preparation_status(uuid,text) TO service_role;

-- SOURCE DRAFT. Called only after the original public coverage guards, while
-- the original dataset FOR UPDATE is held. Original legacy path stays exact.
CREATE FUNCTION public.fn_gto_v31_public215_assert_prepared_seal(p_dataset public.gto_v31_datasets)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog,extensions AS $fn$
DECLARE c public.gto_v31_runtime_cells;r public.gto_v31_seal_cell_preparations;binding jsonb;fingerprint text;raws jsonb:='[]';cells integer:=0;authorities integer;physics text;receipt text;
BEGIN
 PERFORM public.fn_gto_v31_seal_preparation_guards();
 PERFORM public.fn_gto_v31_public215_lock_seal_inputs(p_dataset.dataset_id,NULL);
 fingerprint:=public.fn_gto_v31_seal_qualification_fingerprint();
 IF p_dataset.state<>'building'OR p_dataset.policy_representation<>'public_hist215_v1'OR jsonb_array_length(p_dataset.declared_coverage)<>107 THEN RAISE EXCEPTION 'complete building public seal required';END IF;
 IF public.fn_gto_v31_public215_source_headers_valid(p_dataset)IS NOT TRUE OR public.fn_gto_v31_public215_selected_complete(p_dataset)IS NOT TRUE THEN RAISE EXCEPTION 'current full source/selection authority required';END IF;
 PERFORM public.fn_gto_v31_public215_frozen_map(p_dataset);
 -- Every artifact/node must be covered by a prepared cell, in BOTH directions.
 IF EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=p_dataset.dataset_id AND a.node_count<>(SELECT count(*)FROM public.gto_v31_cell_source_receipts z WHERE z.dataset_id=a.dataset_id AND z.source_row_id=a.source_row_id))
 OR EXISTS(SELECT 1 FROM public.gto_v31_cell_source_receipts z WHERE z.dataset_id=p_dataset.dataset_id AND NOT EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=z.dataset_id AND a.source_row_id=z.source_row_id))
 OR EXISTS(SELECT 1 FROM public.gto_v31_cell_source_receipts z JOIN public.gto_v31_runtime_cells x ON x.cell_id=z.cell_id WHERE z.dataset_id=p_dataset.dataset_id AND(x.dataset_id<>z.dataset_id OR NOT EXISTS(SELECT 1 FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=z.dataset_id AND j.source_row_id=z.source_row_id AND j.source_node=z.source_node AND j.node_checksum=z.source_node_checksum AND j.artifact_checksum=z.source_artifact_checksum AND j.machine_id=z.machine_id AND j.context=x.public_template->'context')))
 OR(SELECT count(*)FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset.dataset_id)<>6955
 OR(SELECT count(*)FROM public.gto_v31_public_source_journal WHERE dataset_id=p_dataset.dataset_id AND machine_id='M1')<>6099
 OR(SELECT count(*)FROM public.gto_v31_public_source_journal WHERE dataset_id=p_dataset.dataset_id AND machine_id='M2')<>856 THEN RAISE EXCEPTION 'prepared source census/membership differs';END IF;
 physics:=public.fn_gto_v31_public215_digest(jsonb_build_object('physics',public.fn_gto_v31_public215_physics_implementation(),'encoding',public.fn_gto_v31_public215_encoding_implementation()));
 -- Retain the original whole-model authority and current implementation checks.
 -- Only the already-attested expensive payload predicate is reused below.
 SELECT count(DISTINCT jsonb_build_object('variant',public_model->'variant','capture',public_training_provenance->'capture_receipt_checksum','recipe',public_training_provenance->'training_recipe_checksum','partition',public_training_provenance->'source_partition_checksum','protocol',public_training_provenance->'runtime_parity_protocol_checksum','encoder',public_training_provenance->'encoder_checksum','physics',public_training_provenance->'physics_checksum','lock',public_training_provenance->'dependency_lock_checksum','parameters',public_training_provenance->'parameters'))INTO authorities FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset.dataset_id;
 IF authorities<>1 OR EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells x WHERE x.dataset_id=p_dataset.dataset_id AND(x.policy_representation IS DISTINCT FROM p_dataset.policy_representation OR x.sql_physics_checksum IS DISTINCT FROM physics))THEN RAISE EXCEPTION 'numeric model authority/implementation differs';END IF;
 FOR c IN SELECT *FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset.dataset_id ORDER BY public.fn_gto_v31_public215_canonical(public_template->'context')COLLATE "C"LOOP
  binding:=public.fn_gto_v31_public215_seal_cell_binding(p_dataset.dataset_id,c.cell_key_checksum);
  SELECT *INTO STRICT r FROM public.gto_v31_seal_cell_preparations WHERE dataset_id=p_dataset.dataset_id AND cell_key_checksum=c.cell_key_checksum AND qualification_fingerprint=fingerprint AND input_checksum=public.fn_gto_v31_json_checksum(binding)FOR SHARE;
  receipt:=public.fn_gto_v31_json_checksum(jsonb_build_object('format','public215_preseal_receipt_v1','qualification_fingerprint',fingerprint,'input_binding',binding,'raw_metrics',r.raw_metrics));
  IF r.input_binding IS DISTINCT FROM binding OR r.receipt_checksum IS DISTINCT FROM receipt OR r.context IS DISTINCT FROM c.public_template->'context'OR r.preparation_offset<>(binding#>>'{cell,preparation_offset}')::integer THEN RAISE EXCEPTION 'prepared seal receipt differs';END IF;
  IF r.raw_metrics->>'dataset_id'IS DISTINCT FROM p_dataset.dataset_id::text OR r.raw_metrics->>'cell_id'IS DISTINCT FROM c.cell_id::text OR r.raw_metrics->>'game_family'IS DISTINCT FROM c.game_family THEN RAISE EXCEPTION 'prepared raw metrics identity differs';END IF;
  raws:=raws||jsonb_build_array(r.raw_metrics);cells:=cells+1;
 END LOOP;
 IF cells<>107 OR cells<>jsonb_array_length(p_dataset.declared_coverage)OR public.fn_gto_v31_seal_qualification_fingerprint()IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'prepared validation census/implementation changed';END IF;
 RETURN raws;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_assert_prepared_seal(public.gto_v31_datasets) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_build_legacy_v31(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_cells bigint;
  v_source bigint;
  v_train bigint;
  v_holdout bigint;
  v_source_nodes bigint;
  v_receipts bigint;
  v_checksum text;
  v_source_checksum text;
  v_coverage jsonb;
  v_metrics jsonb;
  v_metric_checksum text;
  v_frequency_mae numeric;
  v_sizing_mae numeric;
  v_policy_mae numeric;
  v_regret numeric;
  v_regret_coverage numeric;
  v_frequency_observations bigint;
  v_sizing_observations bigint;
  v_policy_observations bigint;
  v_regret_observations bigint;
  v_live_observations bigint;
  v_missing bigint;
  v_pass boolean;
  v_family text;
  v_family_metrics jsonb;
  v_by_family jsonb := '{}'::jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND (c.feature_contract_version IS DISTINCT FROM v_dataset.feature_contract_version OR c.policy_export_schema IS DISTINCT FROM v_dataset.policy_export_schema)) THEN RAISE EXCEPTION 'cell feature version differs from dataset'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF v_dataset.policy_representation='public_hist215_v1' THEN
    PERFORM c.cell_id FROM public.gto_v31_runtime_cells c
      WHERE c.dataset_id=p_dataset_id ORDER BY c.cell_key_checksum FOR SHARE;
  END IF;
  IF public.fn_gto_v31_public215_dataset_models_valid(v_dataset) IS NOT TRUE THEN RAISE EXCEPTION 'numeric model set/source authority/SQL implementation differs from immutable dataset';END IF;
  PERFORM public.fn_gto_v31_assert_source_contract(n.value,v_dataset.policy_export_schema,v_dataset.icm_model_checksum)
    FROM public.gto_v31_source_artifacts a
    JOIN public.solved_spots_gold s ON s.id=a.source_row_id
    CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
   WHERE a.dataset_id=p_dataset_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.gto_v31_input_bundles b
     WHERE b.input_bundle_id=v_dataset.input_bundle_id
       AND b.approval_status='approved' AND b.bundle_checksum=v_dataset.input_bundle_checksum
       AND b.feature_contract_version IS NOT DISTINCT FROM v_dataset.feature_contract_version
       AND b.range_bundle_checksum=v_dataset.range_bundle_checksum
       AND b.source_combo_order_checksum=v_dataset.source_combo_order_checksum
       AND b.icm_model_checksum=v_dataset.icm_model_checksum
  ) THEN RAISE EXCEPTION 'dataset input approval is absent or revoked'; END IF;

  SELECT count(*),COALESCE(sum(source_rows),0),COALESCE(sum(train_source_rows),0),
         COALESCE(sum(holdout_source_rows),0)
    INTO v_cells,v_source,v_train,v_holdout
    FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  IF v_cells=0 OR jsonb_array_length(v_dataset.declared_coverage)<>v_cells
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(v_dataset.declared_coverage))<>v_cells
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_runtime_cells c
        WHERE c.dataset_id=p_dataset_id AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
           WHERE d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket)))
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id
           AND d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket))) THEN
    RAISE EXCEPTION 'runtime cells do not exactly equal declared coverage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='flop')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='turn')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='river')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='cash' AND objective='cash_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='icm')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_ev' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_icm' AND objective='icm')
     OR EXISTS (
       SELECT 1
         FROM (VALUES ('cash','cash_ev'),('spin','chip_ev'),('spin','icm'),
                      ('tourney_ev','chip_ev'),('tourney_icm','icm'))
              required_family(game_family,objective)
         CROSS JOIN unnest(ARRAY['flop','turn','river']) required_street(street)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c
           WHERE c.dataset_id=p_dataset_id
             AND c.game_family=required_family.game_family
             AND c.objective=required_family.objective
             AND c.street=required_street.street))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['limped','srp','3bet','4bet_plus']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.pot_type=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cash_ev','chip_ev','spin_ladder','satellite','bubble','final_table','in_money','ladder']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.utility_context=required.value))
     OR EXISTS (SELECT 1 FROM generate_series(2,10) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.table_size=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise','check_raise','bet_raise','all_in']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.node_role=required.value)) THEN
    RAISE EXCEPTION 'required Phase 4 street, family, utility, table, pot, or response coverage is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
     WHERE c.dataset_id=p_dataset_id
       AND (c.cell_key_checksum<>public.fn_gto_v31_cell_key_checksum(to_jsonb(c))
         OR c.cell_payload_checksum<>public.fn_gto_v31_cell_payload_checksum(to_jsonb(c))
         OR c.source_rows<>c.train_source_rows+c.holdout_source_rows
         OR CASE WHEN v_dataset.policy_representation='public_hist215_v1' THEN false
                 ELSE NOT public.fn_gto_v31_cell_payload_valid(to_jsonb(c)) END)
  ) THEN RAISE EXCEPTION 'a compact cell seal or payload no longer validates'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
    LEFT JOIN LATERAL (
      SELECT count(*) n,count(*) FILTER (WHERE r.split='train') train_n,
             count(*) FILTER (WHERE r.split='holdout') holdout_n,
             encode(digest(string_agg(r.source_row_id::text||':'||r.source_node||':'||
               r.source_node_checksum,'' ORDER BY r.source_row_id::text,r.source_node),'sha256'),'hex') lineage
        FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id
    ) x ON true
     WHERE c.dataset_id=p_dataset_id AND
       (x.n<>c.source_rows OR x.train_n<>c.train_source_rows OR x.holdout_n<>c.holdout_source_rows
        OR x.lineage IS DISTINCT FROM c.lineage_checksum)
  ) THEN RAISE EXCEPTION 'cell source receipts do not reconcile'; END IF;
  SELECT COALESCE(sum(node_count),0) INTO v_source_nodes
    FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT count(*) INTO v_receipts FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id;
  IF v_source_nodes<>v_receipts OR v_source<>v_receipts
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_source_artifacts a
       LEFT JOIN public.solved_spots_gold s ON s.id=a.source_row_id
        WHERE a.dataset_id=p_dataset_id AND (s.id IS NULL OR s.quality_status<>'validated'
          OR s.audited_at IS NULL OR s.source_artifact_checksum<>a.source_artifact_checksum
          OR s.source_artifact_checksum<>public.fn_gto_v31_source_artifact_checksum(s.scenario_hash,s.strategy_matrix_v2)
          OR s.solver_version<>v_dataset.solver_version
          OR s.solver_binary_checksum<>v_dataset.solver_binary_checksum
          OR s.machine_id<>a.machine_id OR s.pipeline_commit<>v_dataset.pipeline_commit
          OR s.pipeline_bundle_checksum<>v_dataset.pipeline_bundle_checksum
          OR s.manifest_version::text<>v_dataset.manifest_version
          OR s.manifest_checksum<>v_dataset.manifest_checksum)) THEN
    RAISE EXCEPTION 'source artifacts are missing, omitted, quarantined, or changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M1')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M2') THEN
    RAISE EXCEPTION 'dataset provenance does not include both solver hosts';
  END IF;

  v_metrics:=public.fn_gto_v31_heldout_metrics(p_dataset_id,NULL);
  v_frequency_mae:=(v_metrics->>'frequency_mae')::numeric;
  v_sizing_mae:=(v_metrics->>'sizing_mae')::numeric;
  v_policy_mae:=(v_metrics->>'policy_ev_mae_bb')::numeric;
  v_regret:=(v_metrics->>'mean_action_regret_bb')::numeric;
  v_regret_coverage:=(v_metrics->>'regret_coverage')::numeric;
  v_frequency_observations:=COALESCE((v_metrics->>'frequency_observations')::bigint,0);
  v_sizing_observations:=COALESCE((v_metrics->>'sizing_observations')::bigint,0);
  v_policy_observations:=COALESCE((v_metrics->>'policy_ev_observations')::bigint,0);
  v_regret_observations:=COALESCE((v_metrics->>'regret_observations')::bigint,0);
  v_live_observations:=COALESCE((v_metrics->>'live_combo_observations')::bigint,0);
  v_missing:=COALESCE((v_metrics->>'missing_observations')::bigint,0);
  IF v_missing<>0 OR v_frequency_observations=0 OR v_sizing_observations=0
     OR v_policy_observations=0
     OR v_regret_observations=0 OR v_live_observations=0
     OR v_frequency_mae IS NULL OR v_sizing_mae IS NULL OR v_policy_mae IS NULL
     OR v_regret IS NULL OR v_regret_coverage IS NULL THEN
    RAISE EXCEPTION 'heldout observations are incomplete or absent';
  END IF;
  v_pass:=v_frequency_mae<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
    AND v_sizing_mae<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
    AND v_policy_mae<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
    AND v_regret<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
    AND v_regret_coverage>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric;

  FOREACH v_family IN ARRAY ARRAY['cash','spin','tourney_ev','tourney_icm'] LOOP
    v_family_metrics:=public.fn_gto_v31_heldout_metrics(p_dataset_id,v_family);
    IF COALESCE((v_family_metrics->>'frequency_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'sizing_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'policy_ev_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'regret_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'missing_observations')::bigint,0)<>0 THEN
      RAISE EXCEPTION 'heldout observations are incomplete for family %',v_family;
    END IF;
    v_family_metrics:=v_family_metrics||jsonb_build_object('validated',
      (v_family_metrics->>'frequency_mae')::numeric<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
      AND (v_family_metrics->>'sizing_mae')::numeric<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
      AND (v_family_metrics->>'policy_ev_mae_bb')::numeric<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
      AND (v_family_metrics->>'mean_action_regret_bb')::numeric<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
      AND (v_family_metrics->>'regret_coverage')::numeric>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric);
    v_pass:=v_pass AND (v_family_metrics->>'validated')::boolean;
    v_by_family:=v_by_family||jsonb_build_object(v_family,v_family_metrics);
  END LOOP;

  v_metrics:=v_metrics||jsonb_build_object('validated',v_pass,'by_family',v_by_family);
  v_metric_checksum:=public.fn_gto_v31_json_checksum(v_metrics);
  v_metrics:=v_metrics||jsonb_build_object('metrics_checksum',v_metric_checksum);

  SELECT jsonb_build_object('cells',count(*),'streets',jsonb_agg(DISTINCT street),
    'families',jsonb_agg(DISTINCT game_family||':'||objective),
    'utility_contexts',jsonb_agg(DISTINCT utility_context),
    'table_sizes',jsonb_agg(DISTINCT table_size),'pot_types',jsonb_agg(DISTINCT pot_type),
    'node_roles',jsonb_agg(DISTINCT node_role),'complete',true)
    INTO v_coverage FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(string_agg(DISTINCT source_artifact_checksum,'' ORDER BY source_artifact_checksum),'sha256'),'hex')
    INTO v_source_checksum FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(v_dataset.dataset_key||':'||v_dataset.pipeline_bundle_checksum||':'||
    v_dataset.manifest_checksum||':'||
    v_dataset.input_bundle_checksum||':'||CASE WHEN v_dataset.feature_contract_version IS NULL THEN '' ELSE v_dataset.feature_contract_version||':' END||CASE WHEN v_dataset.policy_export_schema IS NULL THEN '' ELSE v_dataset.policy_export_schema||':' END||string_agg(cell_key_checksum||':'||
      cell_payload_checksum||':'||lineage_checksum,'' ORDER BY cell_key_checksum),'sha256'),'hex')
    INTO v_checksum FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;

  UPDATE public.gto_v31_datasets SET
    state=CASE WHEN v_pass THEN 'evaluating' ELSE 'rejected' END,
    quality_status=CASE WHEN v_pass THEN 'validated' ELSE 'rejected' END,
    source_rows=v_source,train_source_rows=v_train,holdout_source_rows=v_holdout,
    invalid_rows=0,source_artifact_checksum=v_source_checksum,dataset_checksum=v_checksum,
    coverage=v_coverage,heldout_metrics=v_metrics,sealed_at=now(),audited_at=now()
   WHERE dataset_id=p_dataset_id;
  INSERT INTO public.gto_v31_release_evaluations (
    dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,result_checksum
  ) VALUES (
    p_dataset_id,v_checksum,'heldout','all',CASE WHEN v_pass THEN 'pass' ELSE 'fail' END,
    v_metrics,public.fn_gto_v31_json_checksum(jsonb_build_object(
      'dataset_checksum',v_checksum,'kind','heldout','family','all','metrics',v_metrics))
  );
  RETURN v_checksum;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_seal_prepared(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_cells bigint;
  v_source bigint;
  v_train bigint;
  v_holdout bigint;
  v_source_nodes bigint;
  v_receipts bigint;
  v_checksum text;
  v_source_checksum text;
  v_coverage jsonb;
  v_metrics jsonb;
  v_metric_checksum text;
  v_frequency_mae numeric;
  v_sizing_mae numeric;
  v_policy_mae numeric;
  v_regret numeric;
  v_regret_coverage numeric;
  v_frequency_observations bigint;
  v_sizing_observations bigint;
  v_policy_observations bigint;
  v_regret_observations bigint;
  v_live_observations bigint;
  v_missing bigint;
  v_pass boolean;
  v_family text;
  v_family_metrics jsonb;
  v_by_family jsonb := '{}'::jsonb;
  v_prepared_raw jsonb;v_qualification text;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND (c.feature_contract_version IS DISTINCT FROM v_dataset.feature_contract_version OR c.policy_export_schema IS DISTINCT FROM v_dataset.policy_export_schema)) THEN RAISE EXCEPTION 'cell feature version differs from dataset'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF v_dataset.policy_representation IS DISTINCT FROM 'public_hist215_v1' THEN RAISE EXCEPTION 'prepared seal requires public model';END IF;
  IF v_dataset.policy_representation='public_hist215_v1' THEN
    PERFORM c.cell_id FROM public.gto_v31_runtime_cells c
      WHERE c.dataset_id=p_dataset_id ORDER BY c.cell_key_checksum FOR SHARE;
  END IF;
  -- Full public payload validation is attested after unchanged coverage guards.
  -- Every source was fully validated under row locks in its bound preparation.

  IF NOT EXISTS (
    SELECT 1 FROM public.gto_v31_input_bundles b
     WHERE b.input_bundle_id=v_dataset.input_bundle_id
       AND b.approval_status='approved' AND b.bundle_checksum=v_dataset.input_bundle_checksum
       AND b.feature_contract_version IS NOT DISTINCT FROM v_dataset.feature_contract_version
       AND b.range_bundle_checksum=v_dataset.range_bundle_checksum
       AND b.source_combo_order_checksum=v_dataset.source_combo_order_checksum
       AND b.icm_model_checksum=v_dataset.icm_model_checksum
  ) THEN RAISE EXCEPTION 'dataset input approval is absent or revoked'; END IF;

  SELECT count(*),COALESCE(sum(source_rows),0),COALESCE(sum(train_source_rows),0),
         COALESCE(sum(holdout_source_rows),0)
    INTO v_cells,v_source,v_train,v_holdout
    FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  IF v_cells=0 OR jsonb_array_length(v_dataset.declared_coverage)<>v_cells
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(v_dataset.declared_coverage))<>v_cells
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_runtime_cells c
        WHERE c.dataset_id=p_dataset_id AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
           WHERE d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket)))
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id
           AND d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket))) THEN
    RAISE EXCEPTION 'runtime cells do not exactly equal declared coverage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='flop')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='turn')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='river')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='cash' AND objective='cash_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='icm')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_ev' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_icm' AND objective='icm')
     OR EXISTS (
       SELECT 1
         FROM (VALUES ('cash','cash_ev'),('spin','chip_ev'),('spin','icm'),
                      ('tourney_ev','chip_ev'),('tourney_icm','icm'))
              required_family(game_family,objective)
         CROSS JOIN unnest(ARRAY['flop','turn','river']) required_street(street)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c
           WHERE c.dataset_id=p_dataset_id
             AND c.game_family=required_family.game_family
             AND c.objective=required_family.objective
             AND c.street=required_street.street))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['limped','srp','3bet','4bet_plus']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.pot_type=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cash_ev','chip_ev','spin_ladder','satellite','bubble','final_table','in_money','ladder']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.utility_context=required.value))
     OR EXISTS (SELECT 1 FROM generate_series(2,10) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.table_size=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise','check_raise','bet_raise','all_in']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.node_role=required.value)) THEN
    RAISE EXCEPTION 'required Phase 4 street, family, utility, table, pot, or response coverage is incomplete';
  END IF;
  v_prepared_raw:=public.fn_gto_v31_public215_assert_prepared_seal(v_dataset);
  v_qualification:=public.fn_gto_v31_seal_qualification_fingerprint();
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
     WHERE c.dataset_id=p_dataset_id
       AND (c.cell_key_checksum<>public.fn_gto_v31_cell_key_checksum(to_jsonb(c))
         OR c.cell_payload_checksum<>public.fn_gto_v31_cell_payload_checksum(to_jsonb(c))
         OR c.source_rows<>c.train_source_rows+c.holdout_source_rows
         OR CASE WHEN v_dataset.policy_representation='public_hist215_v1' THEN false
                 ELSE NOT public.fn_gto_v31_cell_payload_valid(to_jsonb(c)) END)
  ) THEN RAISE EXCEPTION 'a compact cell seal or payload no longer validates'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
    LEFT JOIN LATERAL (
      SELECT count(*) n,count(*) FILTER (WHERE r.split='train') train_n,
             count(*) FILTER (WHERE r.split='holdout') holdout_n,
             encode(digest(string_agg(r.source_row_id::text||':'||r.source_node||':'||
               r.source_node_checksum,'' ORDER BY r.source_row_id::text,r.source_node),'sha256'),'hex') lineage
        FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id
    ) x ON true
     WHERE c.dataset_id=p_dataset_id AND
       (x.n<>c.source_rows OR x.train_n<>c.train_source_rows OR x.holdout_n<>c.holdout_source_rows
        OR x.lineage IS DISTINCT FROM c.lineage_checksum)
  ) THEN RAISE EXCEPTION 'cell source receipts do not reconcile'; END IF;
  SELECT COALESCE(sum(node_count),0) INTO v_source_nodes
    FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT count(*) INTO v_receipts FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id;
  IF v_source_nodes<>v_receipts OR v_source<>v_receipts
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_source_artifacts a
       LEFT JOIN public.solved_spots_gold s ON s.id=a.source_row_id
        WHERE a.dataset_id=p_dataset_id AND (s.id IS NULL OR s.quality_status<>'validated'
          OR s.audited_at IS NULL OR s.source_artifact_checksum<>a.source_artifact_checksum
          OR s.solver_version<>v_dataset.solver_version
          OR s.solver_binary_checksum<>v_dataset.solver_binary_checksum
          OR s.machine_id<>a.machine_id OR s.pipeline_commit<>v_dataset.pipeline_commit
          OR s.pipeline_bundle_checksum<>v_dataset.pipeline_bundle_checksum
          OR s.manifest_version::text<>v_dataset.manifest_version
          OR s.manifest_checksum<>v_dataset.manifest_checksum)) THEN
    RAISE EXCEPTION 'source artifacts are missing, omitted, quarantined, or changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M1')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M2') THEN
    RAISE EXCEPTION 'dataset provenance does not include both solver hosts';
  END IF;

  v_metrics:=public.fn_gto_v31_public215_metrics_from_raw(v_prepared_raw,NULL);
  v_frequency_mae:=(v_metrics->>'frequency_mae')::numeric;
  v_sizing_mae:=(v_metrics->>'sizing_mae')::numeric;
  v_policy_mae:=(v_metrics->>'policy_ev_mae_bb')::numeric;
  v_regret:=(v_metrics->>'mean_action_regret_bb')::numeric;
  v_regret_coverage:=(v_metrics->>'regret_coverage')::numeric;
  v_frequency_observations:=COALESCE((v_metrics->>'frequency_observations')::bigint,0);
  v_sizing_observations:=COALESCE((v_metrics->>'sizing_observations')::bigint,0);
  v_policy_observations:=COALESCE((v_metrics->>'policy_ev_observations')::bigint,0);
  v_regret_observations:=COALESCE((v_metrics->>'regret_observations')::bigint,0);
  v_live_observations:=COALESCE((v_metrics->>'live_combo_observations')::bigint,0);
  v_missing:=COALESCE((v_metrics->>'missing_observations')::bigint,0);
  IF v_missing<>0 OR v_frequency_observations=0 OR v_sizing_observations=0
     OR v_policy_observations=0
     OR v_regret_observations=0 OR v_live_observations=0
     OR v_frequency_mae IS NULL OR v_sizing_mae IS NULL OR v_policy_mae IS NULL
     OR v_regret IS NULL OR v_regret_coverage IS NULL THEN
    RAISE EXCEPTION 'heldout observations are incomplete or absent';
  END IF;
  v_pass:=v_frequency_mae<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
    AND v_sizing_mae<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
    AND v_policy_mae<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
    AND v_regret<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
    AND v_regret_coverage>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric;

  FOREACH v_family IN ARRAY ARRAY['cash','spin','tourney_ev','tourney_icm'] LOOP
    v_family_metrics:=public.fn_gto_v31_public215_metrics_from_raw(v_prepared_raw,v_family);
    IF COALESCE((v_family_metrics->>'frequency_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'sizing_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'policy_ev_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'regret_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'missing_observations')::bigint,0)<>0 THEN
      RAISE EXCEPTION 'heldout observations are incomplete for family %',v_family;
    END IF;
    v_family_metrics:=v_family_metrics||jsonb_build_object('validated',
      (v_family_metrics->>'frequency_mae')::numeric<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
      AND (v_family_metrics->>'sizing_mae')::numeric<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
      AND (v_family_metrics->>'policy_ev_mae_bb')::numeric<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
      AND (v_family_metrics->>'mean_action_regret_bb')::numeric<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
      AND (v_family_metrics->>'regret_coverage')::numeric>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric);
    v_pass:=v_pass AND (v_family_metrics->>'validated')::boolean;
    v_by_family:=v_by_family||jsonb_build_object(v_family,v_family_metrics);
  END LOOP;

  v_metrics:=v_metrics||jsonb_build_object('validated',v_pass,'by_family',v_by_family);
  v_metric_checksum:=public.fn_gto_v31_json_checksum(v_metrics);
  v_metrics:=v_metrics||jsonb_build_object('metrics_checksum',v_metric_checksum);

  SELECT jsonb_build_object('cells',count(*),'streets',jsonb_agg(DISTINCT street),
    'families',jsonb_agg(DISTINCT game_family||':'||objective),
    'utility_contexts',jsonb_agg(DISTINCT utility_context),
    'table_sizes',jsonb_agg(DISTINCT table_size),'pot_types',jsonb_agg(DISTINCT pot_type),
    'node_roles',jsonb_agg(DISTINCT node_role),'complete',true)
    INTO v_coverage FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(string_agg(DISTINCT source_artifact_checksum,'' ORDER BY source_artifact_checksum),'sha256'),'hex')
    INTO v_source_checksum FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(v_dataset.dataset_key||':'||v_dataset.pipeline_bundle_checksum||':'||
    v_dataset.manifest_checksum||':'||
    v_dataset.input_bundle_checksum||':'||CASE WHEN v_dataset.feature_contract_version IS NULL THEN '' ELSE v_dataset.feature_contract_version||':' END||CASE WHEN v_dataset.policy_export_schema IS NULL THEN '' ELSE v_dataset.policy_export_schema||':' END||string_agg(cell_key_checksum||':'||
      cell_payload_checksum||':'||lineage_checksum,'' ORDER BY cell_key_checksum),'sha256'),'hex')
    INTO v_checksum FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;

  IF public.fn_gto_v31_seal_qualification_fingerprint()IS DISTINCT FROM v_qualification THEN RAISE EXCEPTION 'seal validation implementation changed';END IF;
  UPDATE public.gto_v31_datasets SET
    state=CASE WHEN v_pass THEN 'evaluating' ELSE 'rejected' END,
    quality_status=CASE WHEN v_pass THEN 'validated' ELSE 'rejected' END,
    source_rows=v_source,train_source_rows=v_train,holdout_source_rows=v_holdout,
    invalid_rows=0,source_artifact_checksum=v_source_checksum,dataset_checksum=v_checksum,
    coverage=v_coverage,heldout_metrics=v_metrics,sealed_at=now(),audited_at=now()
   WHERE dataset_id=p_dataset_id;
  INSERT INTO public.gto_v31_release_evaluations (
    dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,result_checksum
  ) VALUES (
    p_dataset_id,v_checksum,'heldout','all',CASE WHEN v_pass THEN 'pass' ELSE 'fail' END,
    v_metrics,public.fn_gto_v31_json_checksum(jsonb_build_object(
      'dataset_checksum',v_checksum,'kind','heldout','family','all','metrics',v_metrics))
  );
  RETURN v_checksum;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_build(p_dataset_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions
SET statement_timeout='240s' SET lock_timeout='1s' AS $fn$
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role'AND current_user NOT IN('postgres','supabase_admin')THEN RAISE EXCEPTION 'service_role required';END IF;
 IF EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation='public_hist215_v1')THEN
  RETURN public.fn_gto_v31_public215_seal_prepared(p_dataset_id);
 END IF;
 RETURN public.fn_gto_v31_seal_build_legacy_v31(p_dataset_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_build_legacy_v31(uuid),public.fn_gto_v31_public215_seal_prepared(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $postflight$ BEGIN
 IF(SELECT count(*)FROM pg_temp.v31_preparation_function_preimages)<>8 OR EXISTS(SELECT 1 FROM pg_temp.v31_preparation_function_preimages old JOIN pg_proc p ON p.oid=old.oid WHERE(to_jsonb(p)-'prosrc')IS DISTINCT FROM old.metadata OR(p.proname<>'fn_gto_v31_seal_build'AND md5(p.prosrc)IS DISTINCT FROM old.body_md5))THEN RAISE EXCEPTION 'V31 existing function metadata or unchanged body differs';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='9dfbf312c75516bf57141cde206c1aba')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_revision_changed')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_revision_changed';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='6a89f418f0b19fdaed7f94690a347204')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_dataset_insert_guard')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_dataset_insert_guard';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='4a6b37061e6b55cf000ec851d40f5ba1')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_audit_append_guard')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_audit_append_guard';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='0ac0ef020e358571046b282f0c45d3c5')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_public215_cell_metric_raw')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_public215_cell_metric_raw';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='03456db781b41366768ec551c6cb0e3d')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_public215_metrics_from_raw')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_public215_metrics_from_raw';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='f13a0074aef002f37a36cbeb02e87e1f')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_qualification_fingerprint')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_qualification_fingerprint';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='c36ebb5ae4ee4f572933957e6c8d8da9')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_preparation_guards')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_preparation_guards';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='559c3ce723071425902717e079467218')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_public215_seal_cell_binding')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_public215_seal_cell_binding';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='297c74e5eb6ce4fd842a3e22ed0140c8')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_public215_lock_seal_inputs')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_public215_lock_seal_inputs';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='751ec8e1741b4bc99bf2180e895755c5')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_public215_preseal_reply')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_public215_preseal_reply';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='584e556a24cefec726949f0e07e6e91c')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_cell_preparation_status')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_cell_preparation_status';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='2616a32bf395496d9303867f84f25856')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_prepare_seal_cell')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_prepare_seal_cell';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='17ca11953b52e5cd522a680d9b57da7a')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_public215_assert_prepared_seal')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_public215_assert_prepared_seal';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='e74b379a151846969ec4b1071288c80b')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_build_legacy_v31')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_build_legacy_v31';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='86152cd4004ac61a8a58b8536dc8e7fd')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_public215_seal_prepared')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_public215_seal_prepared';END IF;
 IF(SELECT count(*)=1 AND bool_and(md5(prosrc)='ddfc6ffc15731b2522eeab1e895a15a0')FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_gto_v31_seal_build')IS NOT TRUE THEN RAISE EXCEPTION 'V31 preparation source postimage differs: fn_gto_v31_seal_build';END IF;
 PERFORM public.fn_gto_v31_seal_preparation_guards();
 IF public.fn_gto_v31_public215_physics_implementation()IS DISTINCT FROM '66f413bc9179d5b10df7c5a73547931c47a3e90fd7895c4de596c7287e98e733' OR public.fn_gto_v31_public215_encoding_implementation()IS DISTINCT FROM '1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d'THEN RAISE EXCEPTION 'V31 frozen math changed';END IF;
END $postflight$;
-- ROLLBACK: use a NEW protected migration; never replay installed history.
-- Retain both private tables and immutable qualification evidence. No source,
-- model, audit, financial or gameplay row is deleted by this function rollback.
-- BEGIN;
-- SET LOCAL lock_timeout='1s';
-- SET LOCAL statement_timeout='5s';
-- DO $rollback$
-- DECLARE body text;
-- BEGIN
--  IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_seal_build_legacy_v31(uuid)'::regprocedure)IS DISTINCT FROM 'e74b379a151846969ec4b1071288c80b'THEN RAISE EXCEPTION 'prior seal differs';END IF;
--  body:=pg_get_functiondef('public.fn_gto_v31_seal_build_legacy_v31(uuid)'::regprocedure);
--  EXECUTE replace(body,'public.fn_gto_v31_seal_build_legacy_v31(','public.fn_gto_v31_seal_build(');
-- END $rollback$;
-- DROP TRIGGER gto_v31_seal_gold_revision ON public.solved_spots_gold;
-- DROP TRIGGER gto_v31_seal_bundle_revision ON public.gto_v31_input_bundles;
-- DROP TRIGGER gto_v31_seal_audit_append_guard ON public.gto_v31_public_model_audit_combos;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.solved_spots_gold;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_input_bundles;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_runtime_cells;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_cell_source_receipts;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_source_artifacts;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_public_source_journal;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_model_preparations;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_model_freezes;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_public_selections;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_public_physics;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_public_model_compiled;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_public_model_audits;
-- DROP TRIGGER gto_v31_seal_truncate_epoch ON public.gto_v31_public_model_audit_combos;
-- DROP TRIGGER gto_v31_seal_dataset_insert_guard ON public.gto_v31_public_source_journal;
-- DROP TRIGGER gto_v31_seal_dataset_insert_guard ON public.gto_v31_model_preparations;
-- DROP TRIGGER gto_v31_seal_dataset_insert_guard ON public.gto_v31_model_freezes;
-- DROP TRIGGER gto_v31_seal_dataset_insert_guard ON public.gto_v31_public_selections;
-- DROP TRIGGER gto_v31_seal_dataset_insert_guard ON public.gto_v31_seal_cell_preparations;
-- DROP FUNCTION public.fn_gto_v31_public215_seal_prepared(uuid);
-- DROP FUNCTION public.fn_gto_v31_public215_assert_prepared_seal(public.gto_v31_datasets);
-- DROP FUNCTION public.fn_gto_v31_prepare_seal_cell(uuid,text);
-- DROP FUNCTION public.fn_gto_v31_seal_cell_preparation_status(uuid,text);
-- DROP FUNCTION public.fn_gto_v31_public215_preseal_reply(jsonb,text,text,text);
-- DROP FUNCTION public.fn_gto_v31_public215_lock_seal_inputs(uuid,text);
-- DROP FUNCTION public.fn_gto_v31_public215_seal_cell_binding(uuid,text);
-- DROP FUNCTION public.fn_gto_v31_seal_preparation_guards();
-- DROP FUNCTION public.fn_gto_v31_seal_qualification_fingerprint();
-- DROP FUNCTION public.fn_gto_v31_public215_metrics_from_raw(jsonb,text);
-- DROP FUNCTION public.fn_gto_v31_public215_cell_metric_raw(uuid,uuid);
-- DROP FUNCTION public.fn_gto_v31_seal_revision_changed();
-- DROP FUNCTION public.fn_gto_v31_seal_dataset_insert_guard();
-- DROP FUNCTION public.fn_gto_v31_seal_audit_append_guard();
-- DROP FUNCTION public.fn_gto_v31_seal_build_legacy_v31(uuid);
-- COMMIT;
-- @live-proof: (SELECT md5(prosrc)FROM pg_proc WHERE oid='public.fn_gto_v31_seal_build(uuid)'::regprocedure)='ddfc6ffc15731b2522eeab1e895a15a0' AND public.fn_gto_v31_public215_physics_implementation()='66f413bc9179d5b10df7c5a73547931c47a3e90fd7895c4de596c7287e98e733' AND public.fn_gto_v31_public215_encoding_implementation()='1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d' AND NOT has_table_privilege('service_role','public.gto_v31_seal_cell_preparations','INSERT,UPDATE,DELETE')
COMMIT;
