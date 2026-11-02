-- 20261102151428_v31_evaluation_epochs_bind_the_engine_commit.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A sealed V31 dataset is qualified by eight write-once replay/league receipts
-- (paired_replay and league x cash, spin, tourney_ev, tourney_icm). League
-- receipts run the full Horse brain, so the whole decision closure (about 316
-- engine files plus the locked dependencies) decides them, and every receipt
-- binds config_a.evaluation_engine_commit. Until now the receipts were unique
-- per (dataset, kind, family) and had to share ONE engine commit forever. The
-- decision closure changes about eleven times a day and the serving engine
-- advances hourly, while an evaluation can take 350 minutes. So a dataset
-- whose evaluated engine stopped matching the serving engine was stranded
-- permanently: it could never be re-evaluated and never safely promoted.
-- fn_gto_v31_promote_dataset also bound no engine at all, so a cutover between
-- the workflow's checks and the promotion call could activate a dataset on an
-- engine it was never evaluated on.
--
-- Provenance-preserving correction (nothing is ever overwritten):
--
--   public.gto_v31_evaluation_epochs: one row per (dataset, engine commit),
--     numbered 1..n, with opened_at / opened_by / reason. At most one current
--     (not superseded) epoch per dataset. A commit is evaluated at most once
--     per dataset. Rows are never deleted while their dataset exists; the
--     identity columns never change; supersession and promotion are recorded
--     exactly once. Superseding snapshots the dataset's candidate summary so
--     the earlier candidate state stays readable forever.
--   public.gto_v31_release_evaluations: every replay/league receipt now names
--     its epoch and engine commit (composite FK to the epoch, CHECK that the
--     commit equals metrics.candidate_config.evaluation_engine_commit). The
--     uniqueness becomes (dataset, kind, family, engine commit); held-out
--     stays one per dataset. Receipts are immutable (no UPDATE; DELETE only by
--     the existing dataset cascade) and are written only into the dataset's
--     open, unpromoted epoch, so one epoch can never mix commits.
--   fn_gto_v31_open_evaluation_epoch(dataset, commit, opened_by, reason):
--     service role only, serialized on the release-gate lock. Opens epoch 1,
--     returns the current epoch for the same commit, or (with a 20+ character
--     audited reason) supersedes the current epoch for a DIFFERENT, never
--     evaluated commit. A candidate returns to evaluating; its summary is kept
--     on the superseded epoch. Refused after promotion, for a retired/rejected
--     dataset, without a held-out pass, and for any dataset that ever lost a
--     replay/league evaluation (no engine shopping).
--   fn_gto_v31_record_evaluation / fn_gto_v31_mark_candidate /
--   fn_gto_v31_candidate_evaluations_valid: read and write only the open
--     epoch; the receipt commit must equal the epoch commit; epoch n>1 result
--     rows carry the matchup suffix _epoch<n> (fn_gto_v31_evaluation_matchup)
--     because horse_league_results is unique per (run_date, matchup).
--   fn_gto_v31_promote_dataset(dataset, engine_commit, serving_commit): the
--     promotion names the engine commit it promotes for, which must be the
--     open epoch's commit, and requires the eight distinct win/tie receipts of
--     exactly that epoch plus the held-out pass. It records the promoted
--     engine commit and the serving engine commit on the epoch. The old
--     one-argument promotion keeps its signature and grants but refuses.
--   ca_gto_v31_certification_status: adds current_epoch, evaluation_epochs and
--     each receipt's epoch and engine commit (additive; contract v1 kept).
--
-- Not hot tables (clubs/tables/hand_history are untouched), so no daily
-- maintenance install window. gto_v31_release_evaluations holds 2 rows. The
-- epoch FK takes a short SHARE ROW EXCLUSIVE on gto_v31_datasets, which the
-- engine only reads. Every replaced function is guarded by the md5 of its live
-- definition (read 2026-11-02 from production, read-only). CREATE OR REPLACE
-- keeps the existing grants byte-identical; new functions get service_role.
-- Native proof: scripts/ci/test-v31-evaluation-epochs.py (PostgreSQL 17).
--
-- @live-proof: to_regclass('public.gto_v31_evaluation_epochs') IS NOT NULL AND to_regclass('public.gto_v31_release_evaluations_one_per_engine_commit') IS NOT NULL AND to_regprocedure('public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text)') IS NOT NULL AND has_function_privilege('service_role','public.fn_gto_v31_promote_dataset(uuid,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_gto_v31_promote_dataset(uuid,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text)','EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gto_v31_release_evaluations_dataset_id_evaluation_kind_game_key')

BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_gto_v31_record_evaluation(uuid,text,text,bigint)'::regprocedure))
     IS DISTINCT FROM '3b101b069b9f378353790788cccd4828' THEN
    RAISE EXCEPTION 'fn_gto_v31_record_evaluation_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_mark_candidate(uuid)'::regprocedure))
     IS DISTINCT FROM 'c9df8d266f5d95a6ec6b3f31c3b06411' THEN
    RAISE EXCEPTION 'fn_gto_v31_mark_candidate_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_promote_dataset(uuid)'::regprocedure))
     IS DISTINCT FROM '85426bdfee8bbcfe7dd58f8945872d37' THEN
    RAISE EXCEPTION 'fn_gto_v31_promote_dataset_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_candidate_evaluations_valid(uuid,text)'::regprocedure))
     IS DISTINCT FROM '2c0ebbdfdeeec75b84c7287d96a97d56' THEN
    RAISE EXCEPTION 'fn_gto_v31_candidate_evaluations_valid_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.ca_gto_v31_certification_status(uuid)'::regprocedure))
     IS DISTINCT FROM 'f6677026ae245e1f587dc0d3f56485c6' THEN
    RAISE EXCEPTION 'ca_gto_v31_certification_status_preimage_changed';
  END IF;
  IF to_regclass('public.gto_v31_evaluation_epochs') IS NOT NULL
     OR to_regprocedure('public.fn_gto_v31_promote_dataset(uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v31_evaluation_epochs_already_installed';
  END IF;
  -- A promoted dataset's serving engine was never recorded: refuse rather than invent it.
  IF EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
               JOIN public.gto_v31_datasets d ON d.dataset_id=e.dataset_id
              WHERE e.evaluation_kind IN ('paired_replay','league')
                AND d.state IN ('active','retired')) THEN
    RAISE EXCEPTION 'v31_promoted_receipts_without_serving_identity';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
              WHERE e.evaluation_kind IN ('paired_replay','league')
              GROUP BY e.dataset_id
             HAVING count(DISTINCT e.metrics#>>'{candidate_config,evaluation_engine_commit}')<>1
                 OR bool_or(COALESCE(e.metrics#>>'{candidate_config,evaluation_engine_commit}','')!~'^[0-9a-f]{40}$')) THEN
    RAISE EXCEPTION 'v31_existing_receipts_do_not_bind_one_engine_commit';
  END IF;
END
$guard$;

CREATE TABLE public.gto_v31_evaluation_epochs (
  epoch_id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id              uuid        NOT NULL REFERENCES public.gto_v31_datasets(dataset_id) ON DELETE CASCADE,
  epoch_no                integer     NOT NULL CHECK (epoch_no >= 1),
  engine_commit           text        NOT NULL
    CHECK (engine_commit ~ '^[0-9a-f]{40}$' AND engine_commit <> repeat('0',40)),
  opened_at               timestamptz NOT NULL DEFAULT now(),
  opened_by               text        NOT NULL
    CHECK (length(btrim(opened_by)) BETWEEN 1 AND 200 AND opened_by !~ '[[:cntrl:]]'),
  reason                  text        NOT NULL
    CHECK (length(btrim(reason)) BETWEEN 20 AND 2000 AND reason !~ '[[:cntrl:]]'),
  superseded_at           timestamptz,
  superseded_by_epoch_no  integer,
  superseded_candidate    jsonb,
  promoted_at             timestamptz,
  promoted_serving_commit text
    CHECK (promoted_serving_commit IS NULL OR (promoted_serving_commit ~ '^[0-9a-f]{40}$'
           AND promoted_serving_commit <> repeat('0',40))),
  CONSTRAINT gto_v31_evaluation_epochs_number_key UNIQUE (dataset_id, epoch_no),
  CONSTRAINT gto_v31_evaluation_epochs_commit_key UNIQUE (dataset_id, engine_commit),
  CONSTRAINT gto_v31_evaluation_epochs_identity_key UNIQUE (epoch_id, dataset_id, engine_commit),
  CONSTRAINT gto_v31_evaluation_epochs_supersession CHECK (
    (superseded_at IS NULL AND superseded_by_epoch_no IS NULL AND superseded_candidate IS NULL)
    OR (superseded_at IS NOT NULL AND superseded_by_epoch_no = epoch_no + 1
        AND jsonb_typeof(superseded_candidate) = 'object')),
  CONSTRAINT gto_v31_evaluation_epochs_promotion CHECK (
    (promoted_at IS NULL) = (promoted_serving_commit IS NULL)),
  CONSTRAINT gto_v31_evaluation_epochs_closed_once CHECK (superseded_at IS NULL OR promoted_at IS NULL)
);
CREATE UNIQUE INDEX gto_v31_evaluation_epochs_one_current
  ON public.gto_v31_evaluation_epochs (dataset_id) WHERE superseded_at IS NULL;
COMMENT ON TABLE public.gto_v31_evaluation_epochs IS
  'One audited evaluation epoch per (V31 dataset, engine commit). Replay/league receipts bind exactly one epoch; prior epochs and their receipts are permanent provenance.';
ALTER TABLE public.gto_v31_evaluation_epochs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_evaluation_epochs FROM PUBLIC, anon, authenticated, service_role;

-- Existing replay/league receipts (none on 2026-11-02) become epoch 1 of their one commit.
INSERT INTO public.gto_v31_evaluation_epochs (dataset_id, epoch_no, engine_commit, opened_at, opened_by, reason)
SELECT e.dataset_id, 1, min(e.metrics#>>'{candidate_config,evaluation_engine_commit}'), min(e.evaluated_at),
       'migration:v31_evaluation_epochs_bind_the_engine_commit',
       'Backfilled: receipts recorded before evaluation epochs existed'
  FROM public.gto_v31_release_evaluations e
 WHERE e.evaluation_kind IN ('paired_replay','league')
 GROUP BY e.dataset_id;

ALTER TABLE public.gto_v31_release_evaluations
  ADD COLUMN evaluation_epoch_id uuid,
  ADD COLUMN evaluation_engine_commit text;
UPDATE public.gto_v31_release_evaluations e
   SET evaluation_epoch_id = p.epoch_id, evaluation_engine_commit = p.engine_commit
  FROM public.gto_v31_evaluation_epochs p
 WHERE p.dataset_id = e.dataset_id AND e.evaluation_kind IN ('paired_replay','league');
ALTER TABLE public.gto_v31_release_evaluations
  DROP CONSTRAINT gto_v31_release_evaluations_dataset_id_evaluation_kind_game_key,
  ADD CONSTRAINT gto_v31_release_evaluations_epoch_binding CHECK (
    (evaluation_kind = 'heldout' AND evaluation_epoch_id IS NULL AND evaluation_engine_commit IS NULL)
    OR (evaluation_kind IN ('paired_replay','league') AND evaluation_epoch_id IS NOT NULL
        AND evaluation_engine_commit IS NOT NULL
        AND evaluation_engine_commit = metrics#>>'{candidate_config,evaluation_engine_commit}')),
  ADD CONSTRAINT gto_v31_release_evaluations_epoch_fkey
    FOREIGN KEY (evaluation_epoch_id, dataset_id, evaluation_engine_commit)
    REFERENCES public.gto_v31_evaluation_epochs (epoch_id, dataset_id, engine_commit);
CREATE UNIQUE INDEX gto_v31_release_evaluations_one_heldout
  ON public.gto_v31_release_evaluations (dataset_id, evaluation_kind, game_family)
  WHERE evaluation_kind = 'heldout';
CREATE UNIQUE INDEX gto_v31_release_evaluations_one_per_engine_commit
  ON public.gto_v31_release_evaluations (dataset_id, evaluation_kind, game_family, evaluation_engine_commit)
  WHERE evaluation_kind IN ('paired_replay','league');
CREATE INDEX gto_v31_release_evaluations_epoch_idx
  ON public.gto_v31_release_evaluations (evaluation_epoch_id, dataset_id, evaluation_engine_commit);

CREATE FUNCTION public.fn_gto_v31_evaluation_epoch_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets d WHERE d.dataset_id = OLD.dataset_id) THEN
      RAISE EXCEPTION 'an evaluation epoch is permanent provenance';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.epoch_id IS DISTINCT FROM OLD.epoch_id OR NEW.dataset_id IS DISTINCT FROM OLD.dataset_id
     OR NEW.epoch_no IS DISTINCT FROM OLD.epoch_no OR NEW.engine_commit IS DISTINCT FROM OLD.engine_commit
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR (OLD.superseded_at IS NOT NULL AND
         (NEW.superseded_at, NEW.superseded_by_epoch_no, NEW.superseded_candidate)
           IS DISTINCT FROM (OLD.superseded_at, OLD.superseded_by_epoch_no, OLD.superseded_candidate))
     OR (OLD.promoted_at IS NOT NULL AND
         (NEW.promoted_at, NEW.promoted_serving_commit)
           IS DISTINCT FROM (OLD.promoted_at, OLD.promoted_serving_commit)) THEN
    RAISE EXCEPTION 'an evaluation epoch is permanent provenance; only its one supersession or promotion is recorded';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_epoch_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gto_v31_evaluation_epochs_are_provenance
  BEFORE UPDATE OR DELETE ON public.gto_v31_evaluation_epochs
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_evaluation_epoch_guard();

CREATE FUNCTION public.fn_gto_v31_release_evaluation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a release evaluation receipt is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets d WHERE d.dataset_id = OLD.dataset_id) THEN
      RAISE EXCEPTION 'a release evaluation receipt is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.evaluation_kind IN ('paired_replay','league') THEN
    PERFORM 1 FROM public.gto_v31_evaluation_epochs p
      WHERE p.epoch_id = NEW.evaluation_epoch_id AND p.dataset_id = NEW.dataset_id
        AND p.engine_commit = NEW.evaluation_engine_commit
        AND p.superseded_at IS NULL AND p.promoted_at IS NULL
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'replay/league receipts are written only into the open evaluation epoch of their engine commit';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_release_evaluation_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gto_v31_release_evaluations_are_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.gto_v31_release_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_release_evaluation_guard();

CREATE FUNCTION public.fn_gto_v31_evaluation_matchup(p_kind text, p_family text, p_dataset_checksum text, p_epoch_no integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT 'gto_v31_'||p_kind||'_'||p_family||'_'||p_dataset_checksum
         ||CASE WHEN p_epoch_no > 1 THEN '_epoch'||p_epoch_no ELSE '' END
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_matchup(text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_evaluation_matchup(text,text,text,integer) TO service_role;

CREATE FUNCTION public.fn_gto_v31_open_evaluation_epoch(p_dataset_id uuid, p_engine_commit text, p_opened_by text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_current public.gto_v31_evaluation_epochs%ROWTYPE;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
  v_has_current boolean;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF COALESCE(p_engine_commit,'')!~'^[0-9a-f]{40}$' OR p_engine_commit=repeat('0',40) THEN
    RAISE EXCEPTION 'an evaluation epoch binds one full engine commit';
  END IF;
  IF COALESCE(length(btrim(p_opened_by)),0) NOT BETWEEN 1 AND 200 OR p_opened_by ~ '[[:cntrl:]]'
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 2000 OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'an evaluation epoch needs an accountable opener and an audited reason of 20 to 2000 characters';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset does not exist'; END IF;
  -- The same estate lock as mark-candidate and promotion, taken in the same
  -- order (dataset row, then gate): an epoch never changes underneath a
  -- release decision and the two can never deadlock.
  PERFORM pg_advisory_xact_lock(hashtextextended('smarter-poker:gto-v31-release-gate', 0));
  IF v_dataset.state NOT IN ('evaluating','candidate')
     OR EXISTS (SELECT 1 FROM public.gto_v31_evaluation_epochs p
                 WHERE p.dataset_id=p_dataset_id AND p.promoted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'dataset is not awaiting evaluation; a promoted, retired or rejected dataset never reopens evaluation';
  END IF;
  IF v_dataset.quality_status<>'validated'
     OR COALESCE(v_dataset.dataset_checksum,'')!~'^[0-9a-f]{64}$'
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
                     WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
                       AND e.evaluation_kind='heldout' AND e.game_family='all' AND e.verdict='pass') THEN
    RAISE EXCEPTION 'only a sealed, validated dataset with a held-out pass is evaluated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
              WHERE e.dataset_id=p_dataset_id AND e.evaluation_kind IN ('paired_replay','league')
                AND e.verdict='loss') THEN
    RAISE EXCEPTION 'a dataset that lost a release evaluation is never re-evaluated on another engine';
  END IF;
  SELECT * INTO v_current FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND superseded_at IS NULL FOR UPDATE;
  v_has_current:=FOUND;
  IF v_has_current AND v_current.engine_commit=p_engine_commit THEN
    RETURN jsonb_build_object('epoch_id',v_current.epoch_id,'epoch_no',v_current.epoch_no,
      'engine_commit',v_current.engine_commit,'opened',false,'superseded_epoch_no',NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_evaluation_epochs p
              WHERE p.dataset_id=p_dataset_id AND p.engine_commit=p_engine_commit) THEN
    RAISE EXCEPTION 'an engine commit is evaluated at most once per dataset';
  END IF;
  IF v_has_current THEN
    UPDATE public.gto_v31_evaluation_epochs
       SET superseded_at=now(), superseded_by_epoch_no=v_current.epoch_no+1,
           superseded_candidate=jsonb_build_object('state',v_dataset.state,
             'candidate_at',v_dataset.candidate_at,'audited_at',v_dataset.audited_at,
             'paired_replay',v_dataset.paired_replay,'league_gate',v_dataset.league_gate)
     WHERE epoch_id=v_current.epoch_id;
    IF v_dataset.state='candidate' THEN
      UPDATE public.gto_v31_datasets
         SET state='evaluating', paired_replay='{}'::jsonb, league_gate='{}'::jsonb, candidate_at=NULL
       WHERE dataset_id=p_dataset_id;
    END IF;
  ELSIF v_dataset.state<>'evaluating' THEN
    RAISE EXCEPTION 'a candidate without an evaluation epoch cannot be re-evaluated';
  END IF;
  INSERT INTO public.gto_v31_evaluation_epochs (dataset_id, epoch_no, engine_commit, opened_by, reason)
  VALUES (p_dataset_id, COALESCE(v_current.epoch_no,0)+1, p_engine_commit, btrim(p_opened_by), btrim(p_reason))
  RETURNING * INTO v_epoch;
  RETURN jsonb_build_object('epoch_id',v_epoch.epoch_id,'epoch_no',v_epoch.epoch_no,
    'engine_commit',v_epoch.engine_commit,'opened',true,
    'superseded_epoch_no',CASE WHEN v_has_current THEN v_current.epoch_no END);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text) TO service_role;

-- Replaced: receipts are written into, and qualify from, only the open epoch.
CREATE OR REPLACE FUNCTION public.fn_gto_v31_record_evaluation(p_dataset_id uuid, p_evaluation_kind text, p_game_family text, p_source_result_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_result public.horse_league_results%ROWTYPE;
  v_incumbent text;
  v_verdict text;
  v_metrics jsonb;
  v_checksum text;
  v_id uuid;
  v_expected_scenarios text[];
  v_expected_profile text;
  v_actual_scenarios text[];
  v_component_hands bigint;
  v_component_hits bigint;
  v_component_mismatches bigint;
  v_component_duration bigint;
  v_component_bb100 numeric;
  v_component_stderr numeric;
  v_component_roles text[];
  v_result_roles text[];
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF p_evaluation_kind NOT IN ('paired_replay','league')
     OR p_game_family NOT IN ('cash','spin','tourney_ev','tourney_icm') THEN
    RAISE EXCEPTION 'evaluation kind or family is invalid';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='evaluating' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not awaiting evaluation'; END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND superseded_at IS NULL AND promoted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no open evaluation epoch; open one for the evaluated engine commit first'; END IF;
  SELECT COALESCE((SELECT dataset_checksum FROM public.gto_v31_datasets
    WHERE state='active' AND dataset_id<>p_dataset_id LIMIT 1),'legacy_v30') INTO v_incumbent;
  SELECT * INTO v_result FROM public.horse_league_results WHERE id=p_source_result_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'league result does not exist'; END IF;
  v_expected_scenarios:=CASE p_game_family
    WHEN 'cash' THEN ARRAY['cash_ev']::text[]
    WHEN 'spin' THEN ARRAY['chip_ev','spin_ladder']::text[]
    WHEN 'tourney_ev' THEN ARRAY['chip_ev']::text[]
    ELSE ARRAY['satellite','bubble','final_table','in_money','ladder']::text[]
  END;
  v_expected_profile:=CASE p_evaluation_kind
    WHEN 'paired_replay' THEN 'policy_only_duplicate_deals'
    ELSE 'full_brain_duplicate_deal_league'
  END;

  IF jsonb_typeof(v_result.config_a)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_result.config_a))<> (8 + CASE WHEN v_dataset.feature_contract_version IS NULL THEN 0 ELSE 1 END + CASE WHEN v_dataset.policy_export_schema IS NULL THEN 0 ELSE 1 END)
     OR NOT (v_result.config_a ?& ARRAY['evaluation_contract','evaluation_kind',
       'game_family','dataset_checksum','candidate','evaluation_profile','scenarios',
       'evaluation_engine_commit']::text[])
     OR NOT public.fn_gto_v31_feature_request_valid(v_result.config_a)
     OR NOT public.fn_gto_v31_policy_request_valid(v_result.config_a)
     OR v_result.config_a->>'policy_export_schema' IS DISTINCT FROM v_dataset.policy_export_schema
     OR v_result.config_a->>'feature_contract_version' IS DISTINCT FROM v_dataset.feature_contract_version
     OR jsonb_typeof(v_result.config_b)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_result.config_b))<>2
     OR NOT (v_result.config_b ?& ARRAY['incumbent_dataset_checksum','candidate']::text[])
     OR jsonb_typeof(v_result.config_a->'scenarios')<>'array'
     OR v_result.config_a->'scenarios' IS DISTINCT FROM to_jsonb(v_expected_scenarios)
     OR v_result.config_a->>'evaluation_profile'<>v_expected_profile
     OR COALESCE(v_result.config_a->>'evaluation_engine_commit','')!~'^[0-9a-f]{40}$'
     OR v_result.config_a->>'evaluation_engine_commit'=repeat('0',40) THEN
    RAISE EXCEPTION 'evaluation configuration is incomplete or aliases another test profile';
  END IF;
  IF v_result.config_a->>'evaluation_engine_commit' IS DISTINCT FROM v_epoch.engine_commit THEN
    RAISE EXCEPTION 'evaluation engine commit differs from the open evaluation epoch';
  END IF;

  IF jsonb_array_length(v_result.candidate_benchmark_components)<>array_length(v_expected_scenarios,1)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_result.candidate_benchmark_components) component(value)
        WHERE jsonb_typeof(component.value)<>'object'
          OR (SELECT count(*) FROM jsonb_object_keys(component.value))<>10
          OR NOT (component.value ?& ARRAY['scenario','hands','bb100','stderr','duration_ms',
            'illegal_actions','truncated_streets','candidate_policy_hits',
            'candidate_execution_mismatches','candidate_node_roles']::text[])
          OR jsonb_typeof(component.value->'scenario')<>'string'
          OR COALESCE(component.value->>'hands','')!~'^[1-9][0-9]*$'
          OR jsonb_typeof(component.value->'bb100')<>'number'
          OR jsonb_typeof(component.value->'stderr')<>'number'
          OR (component.value->>'stderr')::numeric<0
          OR COALESCE(component.value->>'duration_ms','')!~'^[1-9][0-9]*$'
          OR COALESCE(component.value->>'illegal_actions','')!~'^[0-9]+$'
          OR (component.value->>'illegal_actions')::bigint<>0
          OR COALESCE(component.value->>'truncated_streets','')!~'^[0-9]+$'
          OR (component.value->>'truncated_streets')::bigint<>0
          OR COALESCE(component.value->>'candidate_policy_hits','')!~'^[1-9][0-9]*$'
          OR COALESCE(component.value->>'candidate_execution_mismatches','')!~'^[0-9]+$'
          OR (component.value->>'candidate_execution_mismatches')::bigint<>0
          OR jsonb_typeof(component.value->'candidate_node_roles')<>'array'
          OR jsonb_array_length(component.value->'candidate_node_roles')=0
          OR jsonb_array_length(component.value->'candidate_node_roles')<>(
            SELECT count(DISTINCT role.value)
              FROM jsonb_array_elements_text(component.value->'candidate_node_roles') role(value))
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(component.value->'candidate_node_roles') role(value)
             WHERE role.value NOT IN ('open','cbet','probe','delayed_cbet','barrel',
               'facing_bet','facing_raise','check_raise','bet_raise','all_in'))
     ) THEN
    RAISE EXCEPTION 'benchmark components do not carry exact scenario and decision evidence';
  END IF;

  SELECT array_agg(component.value->>'scenario' ORDER BY component.ordinality),
         sum((component.value->>'hands')::bigint),
         sum((component.value->>'candidate_policy_hits')::bigint),
         sum((component.value->>'candidate_execution_mismatches')::bigint),
         sum((component.value->>'duration_ms')::bigint),
         sum((component.value->>'bb100')::numeric*(component.value->>'hands')::numeric)
           /sum((component.value->>'hands')::numeric),
         sqrt(sum(power((component.value->>'stderr')::numeric*
           (component.value->>'hands')::numeric,2)))
           /sum((component.value->>'hands')::numeric)
    INTO v_actual_scenarios,v_component_hands,v_component_hits,v_component_mismatches,
         v_component_duration,
         v_component_bb100,v_component_stderr
    FROM jsonb_array_elements(v_result.candidate_benchmark_components)
      WITH ORDINALITY component(value,ordinality);
  SELECT array_agg(DISTINCT role.value ORDER BY role.value)
    INTO v_component_roles
    FROM jsonb_array_elements(v_result.candidate_benchmark_components) component(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(component.value->'candidate_node_roles') role(value);
  SELECT array_agg(DISTINCT role.value ORDER BY role.value) INTO v_result_roles
    FROM unnest(v_result.candidate_node_roles) role(value);

  IF v_result.run_date<current_date-2 OR v_result.run_date>current_date
     OR v_result.hands<10000 OR v_result.illegal_actions<>0 OR v_result.truncated_streets<>0
     OR v_result.candidate_policy_hits<=0 OR v_result.candidate_execution_mismatches<>0
     OR COALESCE(array_length(v_result.candidate_node_roles,1),0)<=0
     OR v_actual_scenarios IS DISTINCT FROM v_expected_scenarios
     OR v_component_hands<>v_result.hands
     OR v_component_hits<>v_result.candidate_policy_hits
     OR v_component_mismatches<>v_result.candidate_execution_mismatches
     OR v_component_duration<>v_result.duration_ms
     OR abs(v_component_bb100-v_result.bb100)>0.000001
     OR abs(v_component_stderr-v_result.stderr)>0.000001
     OR v_component_roles IS DISTINCT FROM v_result_roles
     OR COALESCE(array_length(v_result.candidate_node_roles,1),0)<>
        COALESCE(array_length(v_result_roles,1),0)
     OR EXISTS (SELECT 1 FROM unnest(v_result.candidate_node_roles) role(value)
       WHERE role.value NOT IN ('open','cbet','probe','delayed_cbet','barrel',
         'facing_bet','facing_raise','check_raise','bet_raise','all_in'))
     OR v_result.duration_ms<=0 OR v_result.stderr<0
     OR v_result.matchup IS DISTINCT FROM public.fn_gto_v31_evaluation_matchup(
       p_evaluation_kind,p_game_family,v_dataset.dataset_checksum,v_epoch.epoch_no)
     OR v_result.config_a->>'evaluation_contract'<>'gto_v31_candidate.v2'
     OR v_result.config_a->>'evaluation_kind'<>p_evaluation_kind
     OR v_result.config_a->>'game_family'<>p_game_family
     OR v_result.config_a->>'dataset_checksum'<>v_dataset.dataset_checksum
     OR v_result.config_a->>'candidate'<>'v31_certified'
     OR v_result.config_b->>'incumbent_dataset_checksum'<>v_incumbent
     OR v_result.config_b->>'candidate'<>'incumbent' THEN
    RAISE EXCEPTION 'league result is stale, unsafe, or not bound to this candidate and incumbent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_release_evaluations e
     WHERE e.dataset_id=p_dataset_id
       AND e.evaluation_kind IN ('paired_replay','league')
       AND e.evaluation_epoch_id=v_epoch.epoch_id
       AND e.metrics#>>'{candidate_config,evaluation_engine_commit}'
           IS DISTINCT FROM v_result.config_a->>'evaluation_engine_commit'
  ) THEN
    RAISE EXCEPTION 'candidate evaluations were produced by different engine commits';
  END IF;

  v_verdict:=CASE WHEN v_result.bb100>2*v_result.stderr THEN 'win'
                  WHEN v_result.bb100<(-2*v_result.stderr) THEN 'loss' ELSE 'tie' END;
  v_metrics:=jsonb_build_object('source_result_id',v_result.id,'run_date',v_result.run_date,
    'matchup',v_result.matchup,'hands',v_result.hands,'bb100',v_result.bb100,
    'stderr',v_result.stderr,'illegal_actions',v_result.illegal_actions,
    'truncated_streets',v_result.truncated_streets,'duration_ms',v_result.duration_ms,
    'candidate_policy_hits',v_result.candidate_policy_hits,
    'candidate_execution_mismatches',v_result.candidate_execution_mismatches,
    'candidate_node_roles',v_result.candidate_node_roles,
    'benchmark_components',v_result.candidate_benchmark_components,
    'candidate_config',v_result.config_a,'incumbent_config',v_result.config_b);
  v_checksum:=public.fn_gto_v31_json_checksum(jsonb_build_object(
    'dataset_checksum',v_dataset.dataset_checksum,'kind',p_evaluation_kind,
    'family',p_game_family,'verdict',v_verdict,'metrics',v_metrics));
  INSERT INTO public.gto_v31_release_evaluations (
    dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,
    source_result_id,result_checksum,evaluation_epoch_id,evaluation_engine_commit
  ) VALUES (
    p_dataset_id,v_dataset.dataset_checksum,p_evaluation_kind,p_game_family,
    v_verdict,v_metrics,p_source_result_id,v_checksum,v_epoch.epoch_id,v_epoch.engine_commit
  ) ON CONFLICT (dataset_id,evaluation_kind,game_family,evaluation_engine_commit)
    WHERE evaluation_kind IN ('paired_replay','league') DO NOTHING
  RETURNING evaluation_id INTO v_id;
  IF v_id IS NULL THEN
    SELECT evaluation_id INTO v_id FROM public.gto_v31_release_evaluations
     WHERE dataset_id=p_dataset_id AND evaluation_kind=p_evaluation_kind
       AND game_family=p_game_family AND evaluation_epoch_id=v_epoch.epoch_id
       AND result_checksum=v_checksum;
    IF v_id IS NULL THEN RAISE EXCEPTION 'an evaluation receipt already exists with another result'; END IF;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_candidate_evaluations_valid(p_dataset_id uuid, p_dataset_checksum text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_incumbent text;
  v_active_incumbents integer;
  v_receipts integer;
  v_engine_commits integer;
  v_feature_version text; v_policy_schema text;
  v_epoch_id uuid; v_epoch_no integer; v_epoch_commit text;
BEGIN
  -- Mark-candidate and promotion both call this helper before changing state.
  -- The transaction-scoped estate lock survives the function return, so the
  -- incumbent read, receipt validation, and later state transition are one
  -- serialized release operation even for two different candidate rows.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('smarter-poker:gto-v31-release-gate', 0)
  );

  IF p_dataset_id IS NULL
     OR COALESCE(p_dataset_checksum,'')!~'^[0-9a-f]{64}$'
     OR p_dataset_checksum=repeat('0',64) THEN
    RETURN false;
  END IF;

  -- Only the dataset's open evaluation epoch qualifies; earlier epochs stay
  -- readable provenance and never count.
  SELECT p.epoch_id,p.epoch_no,p.engine_commit INTO v_epoch_id,v_epoch_no,v_epoch_commit
    FROM public.gto_v31_evaluation_epochs p
   WHERE p.dataset_id=p_dataset_id AND p.superseded_at IS NULL AND p.promoted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT feature_contract_version,policy_export_schema INTO v_feature_version,v_policy_schema FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id;
  SELECT count(*),max(d.dataset_checksum)
    INTO v_active_incumbents,v_incumbent
    FROM public.gto_v31_datasets d
   WHERE d.state='active' AND d.dataset_id<>p_dataset_id;
  IF v_active_incumbents=0 THEN
    v_incumbent:='legacy_v30';
  ELSIF v_active_incumbents<>1
     OR COALESCE(v_incumbent,'')!~'^[0-9a-f]{64}$'
     OR v_incumbent=repeat('0',64) THEN
    RETURN false;
  END IF;

  SELECT count(*),
         count(DISTINCT e.metrics#>>'{candidate_config,evaluation_engine_commit}')
    INTO v_receipts,v_engine_commits
    FROM public.gto_v31_release_evaluations e
    JOIN public.horse_league_results r ON r.id=e.source_result_id
   WHERE e.dataset_id=p_dataset_id
     AND e.dataset_checksum=p_dataset_checksum
     AND e.evaluation_kind IN ('paired_replay','league')
     AND e.game_family IN ('cash','spin','tourney_ev','tourney_icm')
     AND e.evaluation_epoch_id=v_epoch_id;

  IF v_receipts<>8 OR v_engine_commits<>1 THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    WITH required(evaluation_kind,game_family,evaluation_profile,scenarios) AS (
      VALUES
        ('paired_replay','cash','policy_only_duplicate_deals',ARRAY['cash_ev']::text[]),
        ('paired_replay','spin','policy_only_duplicate_deals',ARRAY['chip_ev','spin_ladder']::text[]),
        ('paired_replay','tourney_ev','policy_only_duplicate_deals',ARRAY['chip_ev']::text[]),
        ('paired_replay','tourney_icm','policy_only_duplicate_deals',ARRAY['satellite','bubble','final_table','in_money','ladder']::text[]),
        ('league','cash','full_brain_duplicate_deal_league',ARRAY['cash_ev']::text[]),
        ('league','spin','full_brain_duplicate_deal_league',ARRAY['chip_ev','spin_ladder']::text[]),
        ('league','tourney_ev','full_brain_duplicate_deal_league',ARRAY['chip_ev']::text[]),
        ('league','tourney_icm','full_brain_duplicate_deal_league',ARRAY['satellite','bubble','final_table','in_money','ladder']::text[])
    )
    SELECT 1
      FROM required q
      LEFT JOIN public.gto_v31_release_evaluations e
        ON e.dataset_id=p_dataset_id
       AND e.dataset_checksum=p_dataset_checksum
       AND e.evaluation_kind=q.evaluation_kind
       AND e.game_family=q.game_family
       AND e.evaluation_epoch_id=v_epoch_id
      LEFT JOIN public.horse_league_results r ON r.id=e.source_result_id
     WHERE e.evaluation_id IS NULL
        OR r.id IS NULL
        OR e.verdict NOT IN ('win','tie')
        OR e.verdict IS DISTINCT FROM CASE
             WHEN r.bb100>2*r.stderr THEN 'win'
             WHEN r.bb100<(-2*r.stderr) THEN 'loss'
             ELSE 'tie'
           END
        OR r.hands<10000
        OR r.illegal_actions<>0
        OR r.truncated_streets<>0
        OR r.candidate_policy_hits<=0
        OR r.candidate_execution_mismatches<>0
        OR r.duration_ms<=0
        OR r.stderr<0
        OR r.matchup IS DISTINCT FROM
           public.fn_gto_v31_evaluation_matchup(q.evaluation_kind,q.game_family,p_dataset_checksum,v_epoch_no)
        OR jsonb_typeof(r.config_a)<>'object'
        OR CASE WHEN jsonb_typeof(r.config_a)='object'
             THEN (SELECT count(*) FROM jsonb_object_keys(r.config_a))
             ELSE -1
           END<> (8 + CASE WHEN v_feature_version IS NULL THEN 0 ELSE 1 END + CASE WHEN v_policy_schema IS NULL THEN 0 ELSE 1 END)
        OR NOT (r.config_a ?& ARRAY['evaluation_contract','evaluation_kind',
          'game_family','dataset_checksum','candidate','evaluation_profile','scenarios',
          'evaluation_engine_commit']::text[])
        OR NOT public.fn_gto_v31_feature_request_valid(r.config_a)
        OR NOT public.fn_gto_v31_policy_request_valid(r.config_a)
        OR r.config_a->>'policy_export_schema' IS DISTINCT FROM v_policy_schema
        OR r.config_a->>'feature_contract_version' IS DISTINCT FROM v_feature_version
        OR r.config_a->>'evaluation_contract'<>'gto_v31_candidate.v2'
        OR r.config_a->>'evaluation_kind'<>q.evaluation_kind
        OR r.config_a->>'game_family'<>q.game_family
        OR r.config_a->>'dataset_checksum'<>p_dataset_checksum
        OR r.config_a->>'candidate'<>'v31_certified'
        OR r.config_a->>'evaluation_profile'<>q.evaluation_profile
        OR r.config_a->'scenarios' IS DISTINCT FROM to_jsonb(q.scenarios)
        OR COALESCE(r.config_a->>'evaluation_engine_commit','')!~'^[0-9a-f]{40}$'
        OR r.config_a->>'evaluation_engine_commit'=repeat('0',40)
        OR r.config_a->>'evaluation_engine_commit' IS DISTINCT FROM v_epoch_commit
        OR e.evaluation_engine_commit IS DISTINCT FROM v_epoch_commit
        OR jsonb_typeof(r.config_b)<>'object'
        OR CASE WHEN jsonb_typeof(r.config_b)='object'
             THEN (SELECT count(*) FROM jsonb_object_keys(r.config_b))
             ELSE -1
           END<>2
        OR NOT (r.config_b ?& ARRAY['incumbent_dataset_checksum','candidate']::text[])
        OR r.config_b->>'incumbent_dataset_checksum'<>v_incumbent
        OR r.config_b->>'candidate'<>'incumbent'
        OR jsonb_typeof(r.candidate_benchmark_components)<>'array'
        OR jsonb_array_length(r.candidate_benchmark_components)<>array_length(q.scenarios,1)
        OR EXISTS (
          SELECT 1
            FROM jsonb_array_elements(r.candidate_benchmark_components) component(value)
           WHERE jsonb_typeof(component.value)<>'object'
              OR component.value->'candidate_execution_mismatches' IS DISTINCT FROM '0'::jsonb
        )
        OR e.metrics IS DISTINCT FROM jsonb_build_object(
          'source_result_id',r.id,'run_date',r.run_date,'matchup',r.matchup,
          'hands',r.hands,'bb100',r.bb100,'stderr',r.stderr,
          'illegal_actions',r.illegal_actions,'truncated_streets',r.truncated_streets,
          'duration_ms',r.duration_ms,'candidate_policy_hits',r.candidate_policy_hits,
          'candidate_execution_mismatches',r.candidate_execution_mismatches,
          'candidate_node_roles',r.candidate_node_roles,
          'benchmark_components',r.candidate_benchmark_components,
          'candidate_config',r.config_a,'incumbent_config',r.config_b)
        OR e.result_checksum IS DISTINCT FROM public.fn_gto_v31_json_checksum(
          jsonb_build_object('dataset_checksum',p_dataset_checksum,
            'kind',q.evaluation_kind,'family',q.game_family,
            'verdict',e.verdict,'metrics',e.metrics))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_mark_candidate(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_paired jsonb;
  v_league jsonb;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='evaluating' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not awaiting evaluation'; END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND superseded_at IS NULL AND promoted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no open evaluation epoch; open one for the evaluated engine commit first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_input_bundles b
      WHERE b.input_bundle_id=v_dataset.input_bundle_id AND b.approval_status='approved'
        AND b.bundle_checksum=v_dataset.input_bundle_checksum)
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
      WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
        AND e.evaluation_kind='heldout' AND e.game_family='all' AND e.verdict='pass')
     OR NOT public.fn_gto_v31_candidate_evaluations_valid(
       p_dataset_id,v_dataset.dataset_checksum)
     OR EXISTS (
       SELECT 1
         FROM unnest(ARRAY['paired_replay','league']) required_kind(value)
         CROSS JOIN unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel',
           'facing_bet','facing_raise','check_raise','bet_raise','all_in']) required_role(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_release_evaluations e
          CROSS JOIN LATERAL jsonb_array_elements_text(e.metrics->'candidate_node_roles') seen(value)
           WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
             AND e.evaluation_kind=required_kind.value AND e.verdict IN ('win','tie')
             AND e.evaluation_epoch_id=v_epoch.epoch_id
             AND seen.value=required_role.value)) THEN
    RAISE EXCEPTION 'candidate is missing approved, execution-bound release evidence';
  END IF;
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_paired FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='paired_replay' AND e.verdict IN ('win','tie')
     AND e.evaluation_epoch_id=v_epoch.epoch_id;
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_league FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='league' AND e.verdict IN ('win','tie')
     AND e.evaluation_epoch_id=v_epoch.epoch_id;
  UPDATE public.gto_v31_datasets SET state='candidate',paired_replay=v_paired,
    league_gate=v_league,candidate_at=now(),audited_at=now()
   WHERE dataset_id=p_dataset_id;
  RETURN v_dataset.dataset_checksum;
END;
$function$;

-- New: promotion binds the evaluated engine commit and records the serving commit.
CREATE FUNCTION public.fn_gto_v31_promote_dataset(p_dataset_id uuid, p_engine_commit text, p_serving_commit text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_expected_checksum text;
  v_expected_source_checksum text;
  v_paired jsonb;
  v_league jsonb;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='candidate' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND (c.feature_contract_version IS DISTINCT FROM v_dataset.feature_contract_version OR c.policy_export_schema IS DISTINCT FROM v_dataset.policy_export_schema)) THEN RAISE EXCEPTION 'cell feature version differs from dataset'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not a candidate'; END IF;
  IF COALESCE(p_engine_commit,'')!~'^[0-9a-f]{40}$' OR p_engine_commit=repeat('0',40)
     OR COALESCE(p_serving_commit,'')!~'^[0-9a-f]{40}$' OR p_serving_commit=repeat('0',40) THEN
    RAISE EXCEPTION 'promotion names the full evaluated engine commit and the full serving engine commit';
  END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND superseded_at IS NULL AND promoted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset has no open evaluation epoch'; END IF;
  IF v_epoch.engine_commit IS DISTINCT FROM p_engine_commit THEN
    RAISE EXCEPTION 'promotion engine commit differs from the evaluated epoch';
  END IF;
  IF public.fn_gto_v31_public215_dataset_models_valid(v_dataset) IS NOT TRUE THEN RAISE EXCEPTION 'numeric model set/source authority/SQL implementation differs from immutable dataset';END IF;
  SELECT encode(digest(v_dataset.dataset_key||':'||v_dataset.pipeline_bundle_checksum||':'||
    v_dataset.manifest_checksum||':'||
    v_dataset.input_bundle_checksum||':'||CASE WHEN v_dataset.feature_contract_version IS NULL THEN '' ELSE v_dataset.feature_contract_version||':' END||CASE WHEN v_dataset.policy_export_schema IS NULL THEN '' ELSE v_dataset.policy_export_schema||':' END||string_agg(cell_key_checksum||':'||
      cell_payload_checksum||':'||lineage_checksum,'' ORDER BY cell_key_checksum),'sha256'),'hex')
    INTO v_expected_checksum FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(string_agg(DISTINCT source_artifact_checksum,'' ORDER BY source_artifact_checksum),'sha256'),'hex')
    INTO v_expected_source_checksum FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_paired FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='paired_replay' AND e.verdict IN ('win','tie')
     AND e.evaluation_epoch_id=v_epoch.epoch_id;
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_league FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='league' AND e.verdict IN ('win','tie')
     AND e.evaluation_epoch_id=v_epoch.epoch_id;
  IF v_dataset.quality_status <> 'validated' OR v_dataset.invalid_rows <> 0
     OR v_dataset.dataset_checksum IS NULL OR v_dataset.source_artifact_checksum IS NULL
     OR v_dataset.dataset_checksum IS DISTINCT FROM v_expected_checksum
     OR v_dataset.source_artifact_checksum IS DISTINCT FROM v_expected_source_checksum
     OR COALESCE((v_dataset.coverage->>'complete')::boolean,false) IS NOT true
     OR COALESCE((v_dataset.heldout_metrics->>'frequency_mae')::numeric,99) > (v_dataset.quality_gates->>'max_frequency_mae')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'sizing_mae')::numeric,99) > (v_dataset.quality_gates->>'max_sizing_mae')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'sizing_observations')::bigint,0)<=0
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cash','spin','tourney_ev','tourney_icm']) family(value)
       WHERE COALESCE((v_dataset.heldout_metrics#>>ARRAY['by_family',family.value,'sizing_observations'])::bigint,0)<=0)
     OR COALESCE((v_dataset.heldout_metrics->>'policy_ev_mae_bb')::numeric,99) > (v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'mean_action_regret_bb')::numeric,99) > (v_dataset.quality_gates->>'max_action_regret_bb')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'regret_coverage')::numeric,-1) < (v_dataset.quality_gates->>'min_regret_coverage')::numeric
     OR v_dataset.paired_replay IS DISTINCT FROM v_paired
     OR v_dataset.league_gate IS DISTINCT FROM v_league
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_input_bundles b
       WHERE b.input_bundle_id=v_dataset.input_bundle_id AND b.approval_status='approved'
         AND b.bundle_checksum=v_dataset.input_bundle_checksum
       AND b.feature_contract_version IS NOT DISTINCT FROM v_dataset.feature_contract_version)
     OR NOT public.fn_gto_v31_candidate_evaluations_valid(
       p_dataset_id,v_dataset.dataset_checksum)
     OR EXISTS (
       SELECT 1
         FROM unnest(ARRAY['paired_replay','league']) required_kind(value)
         CROSS JOIN unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel',
           'facing_bet','facing_raise','check_raise','bet_raise','all_in']) required_role(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_release_evaluations e
          CROSS JOIN LATERAL jsonb_array_elements_text(e.metrics->'candidate_node_roles') seen(value)
           WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
             AND e.evaluation_kind=required_kind.value AND e.verdict IN ('win','tie')
             AND e.evaluation_epoch_id=v_epoch.epoch_id
             AND seen.value=required_role.value))
     OR (SELECT count(*) FROM public.gto_v31_release_evaluations e
       WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
         AND ((e.evaluation_kind='heldout' AND e.game_family='all' AND e.verdict='pass')
           OR (e.evaluation_kind IN ('paired_replay','league') AND e.game_family IN
             ('cash','spin','tourney_ev','tourney_icm') AND e.verdict IN ('win','tie')
             AND e.evaluation_epoch_id=v_epoch.epoch_id)))<>9 THEN
    RAISE EXCEPTION 'candidate does not meet its protected promotion gates';
  END IF;

  UPDATE public.gto_v31_evaluation_epochs
     SET promoted_at=now(), promoted_serving_commit=p_serving_commit
   WHERE epoch_id=v_epoch.epoch_id;
  UPDATE public.gto_v31_datasets SET state='retired', retired_at=now()
   WHERE state='active' AND dataset_id <> p_dataset_id;
  UPDATE public.gto_v31_datasets SET state='active', promoted_at=now()
   WHERE dataset_id=p_dataset_id;
  RETURN v_dataset.dataset_checksum;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_promote_dataset(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_promote_dataset(uuid,text,text) TO service_role;

-- The unbound promotion keeps its signature and grants and refuses.
CREATE OR REPLACE FUNCTION public.fn_gto_v31_promote_dataset(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'promotion must name the evaluated engine commit and the serving engine commit: fn_gto_v31_promote_dataset(dataset, engine_commit, serving_commit)';
END;
$function$;

CREATE OR REPLACE FUNCTION public.ca_gto_v31_certification_status(p_dataset_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_datasets jsonb;
  v_active jsonb;
  v_agreement jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND NOT public.fn_is_horse_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at' DESC),'[]'::jsonb)
    INTO v_datasets
    FROM (
      SELECT jsonb_build_object(
        'dataset_id',d.dataset_id,
        'dataset_key',d.dataset_key,
        'state',d.state,
        'quality_status',d.quality_status,
        'dataset_checksum',d.dataset_checksum,
        'source_artifact_checksum',d.source_artifact_checksum,
        'solver_version',d.solver_version,
        'solver_binary_checksum',d.solver_binary_checksum,
        'pipeline_commit',d.pipeline_commit,
        'pipeline_bundle_checksum',d.pipeline_bundle_checksum,
        'manifest_version',d.manifest_version,
        'manifest_checksum',d.manifest_checksum,
        'input_bundle_checksum',d.input_bundle_checksum,
        'input_approval_status',b.approval_status,
        'machine_ids',d.machine_ids,
        'source_rows',d.source_rows,
        'train_source_rows',d.train_source_rows,
        'holdout_source_rows',d.holdout_source_rows,
        'invalid_rows',d.invalid_rows,
        'ingested_source_artifacts',(SELECT count(*)
          FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=d.dataset_id),
        'ingested_source_nodes',COALESCE((SELECT sum(a.node_count)
          FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=d.dataset_id),0),
        'runtime_cells',(SELECT count(*) FROM public.gto_v31_runtime_cells c
          WHERE c.dataset_id=d.dataset_id),
        'source_receipt_rows',(SELECT count(*) FROM public.gto_v31_cell_source_receipts r
          WHERE r.dataset_id=d.dataset_id),
        'source_max_at',(SELECT max(a.solved_at) FROM public.gto_v31_source_artifacts a
          WHERE a.dataset_id=d.dataset_id),
        'coverage',d.coverage,
        'heldout_metrics',d.heldout_metrics,
        'created_at',d.created_at,
        'sealed_at',d.sealed_at,
        'candidate_at',d.candidate_at,
        'promoted_at',d.promoted_at,
        'current_epoch',(SELECT jsonb_build_object('epoch_id',p.epoch_id,'epoch_no',p.epoch_no,'engine_commit',p.engine_commit,
            'opened_at',p.opened_at,'opened_by',p.opened_by,'reason',p.reason,
            'promoted_at',p.promoted_at,'promoted_serving_commit',p.promoted_serving_commit)
            FROM public.gto_v31_evaluation_epochs p
           WHERE p.dataset_id=d.dataset_id AND p.superseded_at IS NULL),
        'evaluation_epochs',COALESCE((SELECT jsonb_agg(jsonb_build_object('epoch_id',p.epoch_id,'epoch_no',p.epoch_no,'engine_commit',p.engine_commit,
            'opened_at',p.opened_at,'opened_by',p.opened_by,'reason',p.reason,
            'superseded_at',p.superseded_at,'superseded_by_epoch_no',p.superseded_by_epoch_no,
            'superseded_candidate',p.superseded_candidate,'promoted_at',p.promoted_at,
            'promoted_serving_commit',p.promoted_serving_commit) ORDER BY p.epoch_no)
            FROM public.gto_v31_evaluation_epochs p WHERE p.dataset_id=d.dataset_id),'[]'::jsonb),
        'evaluations',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'evaluation_id',e.evaluation_id,
            'kind',e.evaluation_kind,
            'game_family',e.game_family,
            'verdict',e.verdict,
            'metrics',e.metrics,
            'result_checksum',e.result_checksum,
            'evaluated_at',e.evaluated_at,
            'evaluation_epoch_id',e.evaluation_epoch_id,
            'evaluation_engine_commit',e.evaluation_engine_commit
          ) ORDER BY e.evaluation_kind,e.game_family)
            FROM public.gto_v31_release_evaluations e
           WHERE e.dataset_id=d.dataset_id
        ),'[]'::jsonb)
      ) AS item
        FROM public.gto_v31_datasets d
        JOIN public.gto_v31_input_bundles b ON b.input_bundle_id=d.input_bundle_id
       WHERE (p_dataset_id IS NULL OR d.dataset_id=p_dataset_id)
       ORDER BY d.created_at DESC
       LIMIT CASE WHEN p_dataset_id IS NULL THEN 20 ELSE 1 END
    ) recent;

  SELECT item INTO v_active
    FROM jsonb_array_elements(v_datasets) item
   WHERE item->>'state'='active' LIMIT 1;
  SELECT to_jsonb(a) INTO v_agreement
    FROM public.horse_solver_agreement a
   ORDER BY a.run_date DESC,a.created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'contract','smarter-poker.gto-v31-certification-status.v1',
    'generated_at',now(),
    'active_dataset',v_active,
    'datasets',v_datasets,
    'workers',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.machine_id)
      FROM public.solver_worker_liveness w),'[]'::jsonb),
    'compactor',(SELECT to_jsonb(c) FROM public.solver_compact_liveness c WHERE singleton),
    'latest_agreement',v_agreement
  );
END;
$function$;

COMMIT;
