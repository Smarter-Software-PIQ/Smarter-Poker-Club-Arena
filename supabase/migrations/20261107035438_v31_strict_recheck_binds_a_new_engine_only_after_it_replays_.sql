-- 20261107035438_v31_strict_recheck_binds_a_new_engine_only_after_it_replays_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY: THE STRICT RE-CHECK (approved 2026-11-06).
--
-- A certified playbook was bound to the exact engine commit it was evaluated
-- on, plus any later engine whose whole decision closure (about 270 files)
-- stayed byte-identical. That closure changes about eleven times a day, so in
-- practice a playbook could only serve the engine it was certified on. R7
-- also showed the surrounding brain decides the result (the same decisions
-- tie with horse memory learning off and lose with it on), so "the files did
-- not change" alone can never re-bind a playbook either.
--
-- Contract v3 datasets (only; v2 rows keep exactly today's rules) are now
-- served by a later engine only when all three hold:
--
--   1. The execution fingerprint is identical: the digest of the playbook's
--      own execution files (scripts/ci/v31-execution-fingerprint.mjs).
--   2. The replay digest is identical: every recorded certified decision
--      replays to the same action, size and probability mix on the new
--      engine (server/src/benchmark/GtoV31ReplayDigest.ts).
--   3. A re-check round on the new engine passes: every certification table
--      of every family the dataset carries, re-run on the new engine, is a
--      win or a tie.
--
-- STRICT: one loss in a re-check round retires the playbook for good. An
-- active dataset becomes 'retired', a candidate becomes 'rejected', every
-- open serving binding is revoked, and no later round can open for it.
--
-- New objects:
--   gto_v31_execution_anchors: per evaluated epoch, the execution digest and
--     the replay corpus (gzip, at most 8 MiB, sha256-addressed) with its
--     checksum and replay digest, recorded by the evaluator at
--     certification. Permanent provenance while the dataset exists.
--   fn_gto_v31_record_execution_anchor: service role; open, unpromoted epoch
--     of an evaluating/candidate v3 dataset; idempotent, never changes.
--   gto_v31_recheck_rounds: one round per (dataset, epoch, new engine);
--     opened only on identical digests; records each family/kind result;
--     closes 'passed', 'retired' (strict loss) or 'abandoned' (no verdict).
--   fn_gto_v31_open_recheck_round / fn_gto_v31_record_recheck_result /
--     fn_gto_v31_abandon_recheck_round / fn_gto_v31_recheck_status /
--     fn_gto_v31_replay_corpus: service role only.
-- Patches (md5 preimage guard, md5 postimage check, anchors exactly once):
--   fn_gto_v31_promote_dataset_epoch (v3 postimage): a v3 promotion needs
--     its epoch's anchor, and a serving engine other than the evaluated one
--     needs a passed round.
--   fn_gto_v31_bind_serving: the same rule at binding time; the binding row
--     records the round and both digests.
--   fn_gto_v31_serving_binding_guard: the three new binding columns are as
--     immutable as the rest of the provenance.
--   fn_gto_v31_evaluation_cells: also serves an ACTIVE dataset's cells to
--     the service-role evaluator, which a re-check of an active playbook
--     replays and re-tests (the live loader is unchanged).
-- gto_v31_serving_bindings gains three nullable columns (12-row table).
-- Native proof: scripts/ci/test-v31-strict-recheck.py (PostgreSQL 17).
--
-- @live-proof: to_regclass('public.gto_v31_execution_anchors') IS NOT NULL AND to_regclass('public.gto_v31_recheck_rounds') IS NOT NULL AND has_function_privilege('service_role','public.fn_gto_v31_open_recheck_round(uuid,text,text,text,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_gto_v31_open_recheck_round(uuid,text,text,text,text,text)','EXECUTE') AND has_function_privilege('service_role','public.fn_gto_v31_record_execution_anchor(uuid,text,text,text,integer,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_gto_v31_replay_corpus(uuid)','EXECUTE') AND NOT has_table_privilege('authenticated','public.gto_v31_execution_anchors','SELECT') AND md5(pg_get_functiondef('public.fn_gto_v31_bind_serving(uuid,text,text,text,text,text)'::regprocedure))='7a11e66ef3569ad97076e224a1f537f6' AND md5(pg_get_functiondef('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)'::regprocedure))='99e715108dc74232c1089b9e5c15c5dc'

BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
  IF to_regprocedure('public.fn_gto_v31_record_evaluation_v3(uuid,text,text,bigint)') IS NULL
     OR to_regclass('public.gto_v31_serving_bindings') IS NULL THEN
    RAISE EXCEPTION 'v31_contract_v3_and_serving_bindings_must_be_installed_first';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)'::regprocedure))
     IS DISTINCT FROM '6f8a2eda90c5d9698a99a41e0abf40d4' THEN
    RAISE EXCEPTION 'fn_gto_v31_promote_dataset_epoch_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_bind_serving(uuid,text,text,text,text,text)'::regprocedure))
     IS DISTINCT FROM 'a98d39889754ed58c511feab8ec3e8d4' THEN
    RAISE EXCEPTION 'fn_gto_v31_bind_serving_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_serving_binding_guard()'::regprocedure))
     IS DISTINCT FROM 'f34cd74f73ddcd8920af1232727499f4' THEN
    RAISE EXCEPTION 'fn_gto_v31_serving_binding_guard_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_evaluation_cells(uuid,integer,integer)'::regprocedure))
     IS DISTINCT FROM 'e18f71f77659e807226fe8a00fdcab03' THEN
    RAISE EXCEPTION 'fn_gto_v31_evaluation_cells_preimage_changed';
  END IF;
  IF to_regclass('public.gto_v31_execution_anchors') IS NOT NULL
     OR to_regclass('public.gto_v31_recheck_rounds') IS NOT NULL THEN
    RAISE EXCEPTION 'v31_strict_recheck_already_installed';
  END IF;
END $guard$;

-- 1. Execution anchors: what the certifying engine proved about itself.
CREATE TABLE public.gto_v31_execution_anchors (
  epoch_id               uuid PRIMARY KEY REFERENCES public.gto_v31_evaluation_epochs(epoch_id) ON DELETE CASCADE,
  dataset_id             uuid NOT NULL REFERENCES public.gto_v31_datasets(dataset_id) ON DELETE CASCADE,
  engine_commit          text NOT NULL CHECK (engine_commit ~ '^[0-9a-f]{40}$' AND engine_commit <> repeat('0',40)),
  execution_digest       text NOT NULL CHECK (execution_digest ~ '^[0-9a-f]{64}$' AND execution_digest <> repeat('0',64)),
  replay_corpus_checksum text NOT NULL CHECK (replay_corpus_checksum ~ '^[0-9a-f]{64}$' AND replay_corpus_checksum <> repeat('0',64)),
  replay_digest          text NOT NULL CHECK (replay_digest ~ '^[0-9a-f]{64}$' AND replay_digest <> repeat('0',64)),
  replay_states          integer NOT NULL CHECK (replay_states BETWEEN 300 AND 6000),
  corpus_gzip            bytea NOT NULL CHECK (octet_length(corpus_gzip) BETWEEN 1 AND 8388608),
  corpus_sha256          text NOT NULL CHECK (corpus_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  recorded_by            text NOT NULL CHECK (length(btrim(recorded_by)) BETWEEN 1 AND 200 AND recorded_by !~ '[[:cntrl:]]'),
  CONSTRAINT gto_v31_execution_anchors_corpus_addressed CHECK (corpus_sha256 = encode(sha256(corpus_gzip),'hex'))
);
CREATE INDEX gto_v31_execution_anchors_dataset_idx ON public.gto_v31_execution_anchors (dataset_id);
REVOKE ALL ON TABLE public.gto_v31_execution_anchors FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.gto_v31_execution_anchors ENABLE ROW LEVEL SECURITY;

-- 2. Re-check rounds: one new engine, one verdict.
CREATE TABLE public.gto_v31_recheck_rounds (
  round_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id       uuid NOT NULL REFERENCES public.gto_v31_datasets(dataset_id) ON DELETE CASCADE,
  epoch_id         uuid NOT NULL REFERENCES public.gto_v31_execution_anchors(epoch_id) ON DELETE CASCADE,
  serving_commit   text NOT NULL CHECK (serving_commit ~ '^[0-9a-f]{40}$' AND serving_commit <> repeat('0',40)),
  execution_digest text NOT NULL CHECK (execution_digest ~ '^[0-9a-f]{64}$'),
  replay_digest    text NOT NULL CHECK (replay_digest ~ '^[0-9a-f]{64}$'),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  opened_by        text NOT NULL CHECK (length(btrim(opened_by)) BETWEEN 1 AND 200 AND opened_by !~ '[[:cntrl:]]'),
  open_reason      text NOT NULL CHECK (length(btrim(open_reason)) BETWEEN 20 AND 2000 AND open_reason !~ '[[:cntrl:]]'),
  results          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(results) = 'array'),
  outcome          text CHECK (outcome IN ('passed','retired','abandoned')),
  closed_at        timestamptz,
  closed_by        text,
  close_reason     text,
  CONSTRAINT gto_v31_recheck_rounds_closure CHECK (
    (outcome IS NULL AND closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL)
    OR (outcome IS NOT NULL AND closed_at IS NOT NULL AND length(btrim(closed_by)) BETWEEN 1 AND 200
        AND closed_by !~ '[[:cntrl:]]' AND length(btrim(close_reason)) BETWEEN 20 AND 2000
        AND close_reason !~ '[[:cntrl:]]'))
);
CREATE UNIQUE INDEX gto_v31_recheck_rounds_one_open
  ON public.gto_v31_recheck_rounds (dataset_id, serving_commit) WHERE outcome IS NULL;
CREATE UNIQUE INDEX gto_v31_recheck_rounds_one_pass
  ON public.gto_v31_recheck_rounds (epoch_id, serving_commit) WHERE outcome = 'passed';
CREATE UNIQUE INDEX gto_v31_recheck_rounds_one_retirement
  ON public.gto_v31_recheck_rounds (dataset_id) WHERE outcome = 'retired';
REVOKE ALL ON TABLE public.gto_v31_recheck_rounds FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.gto_v31_recheck_rounds ENABLE ROW LEVEL SECURITY;

-- 3. Provenance guards.
CREATE FUNCTION public.fn_gto_v31_execution_anchor_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets d WHERE d.dataset_id = OLD.dataset_id) THEN
      RAISE EXCEPTION 'an execution anchor is permanent provenance';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'an execution anchor is permanent provenance';
END;
$function$;
CREATE TRIGGER gto_v31_execution_anchors_are_provenance
  BEFORE UPDATE OR DELETE ON public.gto_v31_execution_anchors
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_execution_anchor_guard();

CREATE FUNCTION public.fn_gto_v31_recheck_round_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets d WHERE d.dataset_id = OLD.dataset_id) THEN
      RAISE EXCEPTION 'a re-check round is permanent provenance';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.outcome IS NOT NULL
     OR (NEW.round_id, NEW.dataset_id, NEW.epoch_id, NEW.serving_commit, NEW.execution_digest,
         NEW.replay_digest, NEW.opened_at, NEW.opened_by, NEW.open_reason)
        IS DISTINCT FROM (OLD.round_id, OLD.dataset_id, OLD.epoch_id, OLD.serving_commit,
         OLD.execution_digest, OLD.replay_digest, OLD.opened_at, OLD.opened_by, OLD.open_reason)
     OR jsonb_array_length(NEW.results) < jsonb_array_length(OLD.results)
     OR (SELECT jsonb_agg(e ORDER BY i) FROM jsonb_array_elements(NEW.results) WITH ORDINALITY x(e,i)
          WHERE i <= jsonb_array_length(OLD.results)) IS DISTINCT FROM
        (CASE WHEN jsonb_array_length(OLD.results) = 0 THEN NULL ELSE OLD.results END) THEN
    RAISE EXCEPTION 'a re-check round only appends results and closes once';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER gto_v31_recheck_rounds_are_provenance
  BEFORE UPDATE OR DELETE ON public.gto_v31_recheck_rounds
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_recheck_round_guard();

-- 4. Bindings record the round and both digests.
ALTER TABLE public.gto_v31_serving_bindings
  ADD COLUMN recheck_round_id uuid REFERENCES public.gto_v31_recheck_rounds(round_id),
  ADD COLUMN execution_digest text CHECK (execution_digest IS NULL OR execution_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN replay_digest text CHECK (replay_digest IS NULL OR replay_digest ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT gto_v31_serving_bindings_digests_together
    CHECK ((execution_digest IS NULL) = (replay_digest IS NULL)
           AND (recheck_round_id IS NULL OR execution_digest IS NOT NULL));

-- 5. Recording the anchor at certification.
CREATE FUNCTION public.fn_gto_v31_record_execution_anchor(p_epoch_id uuid, p_execution_digest text,
  p_replay_corpus_checksum text, p_replay_digest text, p_replay_states integer, p_corpus_gzip_base64 text,
  p_recorded_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_anchor public.gto_v31_execution_anchors%ROWTYPE;
  v_bytes bytea;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF COALESCE(p_execution_digest,'') !~ '^[0-9a-f]{64}$' OR p_execution_digest = repeat('0',64)
     OR COALESCE(p_replay_corpus_checksum,'') !~ '^[0-9a-f]{64}$' OR p_replay_corpus_checksum = repeat('0',64)
     OR COALESCE(p_replay_digest,'') !~ '^[0-9a-f]{64}$' OR p_replay_digest = repeat('0',64)
     OR COALESCE(p_replay_states,0) NOT BETWEEN 300 AND 6000
     OR COALESCE(length(btrim(p_recorded_by)),0) NOT BETWEEN 1 AND 200 OR p_recorded_by ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'an execution anchor names both digests, the corpus checksum, 300 to 6000 replay states and its recorder';
  END IF;
  BEGIN
    v_bytes := decode(COALESCE(p_corpus_gzip_base64,''),'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'the replay corpus is not base64';
  END;
  IF octet_length(v_bytes) NOT BETWEEN 2 AND 8388608 OR substring(v_bytes FROM 1 FOR 2) <> '\x1f8b'::bytea THEN
    RAISE EXCEPTION 'the replay corpus must be gzip, at most 8 MiB';
  END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs WHERE epoch_id=p_epoch_id FOR SHARE;
  IF NOT FOUND OR v_epoch.superseded_at IS NOT NULL OR v_epoch.promoted_at IS NOT NULL THEN
    RAISE EXCEPTION 'an execution anchor is recorded for the open, unpromoted evaluation epoch';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE dataset_id=v_epoch.dataset_id FOR SHARE;
  IF v_dataset.evaluation_contract IS DISTINCT FROM 'gto_v31_candidate.v3'
     OR v_dataset.state NOT IN ('evaluating','candidate') THEN
    RAISE EXCEPTION 'only an evaluating or candidate contract v3 dataset records an execution anchor';
  END IF;
  SELECT * INTO v_anchor FROM public.gto_v31_execution_anchors WHERE epoch_id=p_epoch_id;
  IF FOUND THEN
    IF (v_anchor.execution_digest, v_anchor.replay_corpus_checksum, v_anchor.replay_digest,
        v_anchor.replay_states, v_anchor.corpus_sha256)
       IS DISTINCT FROM (p_execution_digest, p_replay_corpus_checksum, p_replay_digest,
        p_replay_states, encode(sha256(v_bytes),'hex')) THEN
      RAISE EXCEPTION 'this epoch already records another execution anchor';
    END IF;
    RETURN jsonb_build_object('epoch_id',p_epoch_id,'recorded',false);
  END IF;
  INSERT INTO public.gto_v31_execution_anchors (epoch_id, dataset_id, engine_commit, execution_digest,
    replay_corpus_checksum, replay_digest, replay_states, corpus_gzip, corpus_sha256, recorded_by)
  VALUES (p_epoch_id, v_epoch.dataset_id, v_epoch.engine_commit, p_execution_digest, p_replay_corpus_checksum,
    p_replay_digest, p_replay_states, v_bytes, encode(sha256(v_bytes),'hex'), btrim(p_recorded_by));
  RETURN jsonb_build_object('epoch_id',p_epoch_id,'recorded',true);
END;
$function$;

-- The epoch a re-check of this dataset is about: the promoted one for an
-- active dataset, the open unpromoted one for a candidate.
CREATE FUNCTION public.fn_gto_v31_recheck_epoch(p_dataset public.gto_v31_datasets)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.epoch_id FROM public.gto_v31_evaluation_epochs e
   WHERE e.dataset_id = p_dataset.dataset_id
     AND ((p_dataset.state = 'active' AND e.promoted_at IS NOT NULL)
       OR (p_dataset.state = 'candidate' AND e.promoted_at IS NULL AND e.superseded_at IS NULL));
$function$;

-- 6. Opening a round: identical digests or nothing.
CREATE FUNCTION public.fn_gto_v31_open_recheck_round(p_dataset_id uuid, p_serving_commit text,
  p_execution_digest text, p_replay_digest text, p_opened_by text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_anchor public.gto_v31_execution_anchors%ROWTYPE;
  v_round public.gto_v31_recheck_rounds%ROWTYPE;
  v_epoch_id uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF COALESCE(p_serving_commit,'') !~ '^[0-9a-f]{40}$' OR p_serving_commit = repeat('0',40)
     OR COALESCE(p_execution_digest,'') !~ '^[0-9a-f]{64}$' OR COALESCE(p_replay_digest,'') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'a re-check names the full serving commit and both of its digests';
  END IF;
  IF COALESCE(length(btrim(p_opened_by)),0) NOT BETWEEN 1 AND 200 OR p_opened_by ~ '[[:cntrl:]]'
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 2000 OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'a re-check needs an accountable opener and an audited reason of 20 to 2000 characters';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('smarter-poker:gto-v31-release-gate', 0));
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id FOR UPDATE;
  IF NOT FOUND OR v_dataset.evaluation_contract IS DISTINCT FROM 'gto_v31_candidate.v3'
     OR v_dataset.state NOT IN ('candidate','active') THEN
    RAISE EXCEPTION 'only a candidate or active contract v3 dataset is re-checked';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_recheck_rounds WHERE dataset_id=p_dataset_id AND outcome='retired') THEN
    RAISE EXCEPTION 'this playbook lost a re-check and is retired for good';
  END IF;
  v_epoch_id := public.fn_gto_v31_recheck_epoch(v_dataset);
  SELECT * INTO v_anchor FROM public.gto_v31_execution_anchors WHERE epoch_id=v_epoch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the playbook has no execution anchor to re-check against'; END IF;
  IF p_serving_commit = v_anchor.engine_commit THEN
    RAISE EXCEPTION 'the certifying engine itself needs no re-check';
  END IF;
  IF p_execution_digest IS DISTINCT FROM v_anchor.execution_digest THEN
    RAISE EXCEPTION 'execution fingerprint differs from the certified engine: a full new certification is required';
  END IF;
  IF p_replay_digest IS DISTINCT FROM v_anchor.replay_digest THEN
    RAISE EXCEPTION 'replay digest differs from the certified engine: a full new certification is required';
  END IF;
  SELECT * INTO v_round FROM public.gto_v31_recheck_rounds
   WHERE epoch_id=v_epoch_id AND serving_commit=p_serving_commit AND outcome='passed';
  IF FOUND THEN
    RETURN jsonb_build_object('round_id',v_round.round_id,'outcome','passed','opened',false);
  END IF;
  SELECT * INTO v_round FROM public.gto_v31_recheck_rounds
   WHERE dataset_id=p_dataset_id AND serving_commit=p_serving_commit AND outcome IS NULL;
  IF FOUND THEN
    IF v_round.epoch_id IS DISTINCT FROM v_epoch_id THEN
      RAISE EXCEPTION 'an open re-check round belongs to another epoch; abandon it first';
    END IF;
    RETURN jsonb_build_object('round_id',v_round.round_id,'outcome',NULL,'opened',false,
      'results',v_round.results);
  END IF;
  INSERT INTO public.gto_v31_recheck_rounds (dataset_id, epoch_id, serving_commit, execution_digest,
    replay_digest, opened_by, open_reason)
  VALUES (p_dataset_id, v_epoch_id, p_serving_commit, p_execution_digest, p_replay_digest,
    btrim(p_opened_by), btrim(p_reason))
  RETURNING * INTO v_round;
  RETURN jsonb_build_object('round_id',v_round.round_id,'outcome',NULL,'opened',true,'results','[]'::jsonb);
END;
$function$;

-- 7. Recording one family/kind result of a round. Strict: a loss retires.
CREATE FUNCTION public.fn_gto_v31_record_recheck_result(p_round_id uuid, p_evaluation_kind text,
  p_game_family text, p_source_result_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round public.gto_v31_recheck_rounds%ROWTYPE;
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
  v_result public.horse_league_results%ROWTYPE;
  v_incumbent text;
  v_verdict text;
  v_required integer;
  v_results jsonb;
  v_reason text;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF p_evaluation_kind NOT IN ('paired_replay','league')
     OR p_game_family NOT IN ('cash','spin','tourney_ev','tourney_icm') THEN
    RAISE EXCEPTION 'evaluation kind or family is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('smarter-poker:gto-v31-release-gate', 0));
  SELECT * INTO v_round FROM public.gto_v31_recheck_rounds WHERE round_id=p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 're-check round does not exist'; END IF;
  IF v_round.outcome IS NOT NULL THEN
    RETURN jsonb_build_object('round_id',v_round.round_id,'outcome',v_round.outcome,'recorded',false);
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE dataset_id=v_round.dataset_id FOR UPDATE;
  IF v_dataset.state NOT IN ('candidate','active')
     OR public.fn_gto_v31_recheck_epoch(v_dataset) IS DISTINCT FROM v_round.epoch_id THEN
    RAISE EXCEPTION 'the dataset moved on since the round opened; abandon the round';
  END IF;
  IF NOT (p_game_family = ANY(public.fn_gto_v31_v3_families(v_dataset.dataset_id))) THEN
    RAISE EXCEPTION 'the dataset has no cells in family %', p_game_family;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_round.results) r(v)
              WHERE r.v->>'kind' = p_evaluation_kind AND r.v->>'family' = p_game_family) THEN
    RAISE EXCEPTION 'this round already records % / %', p_evaluation_kind, p_game_family;
  END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs WHERE epoch_id=v_round.epoch_id;
  -- The incumbent is the one the certification receipt was measured against.
  SELECT e.metrics#>>'{incumbent_config,incumbent_dataset_checksum}' INTO v_incumbent
    FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=v_dataset.dataset_id AND e.evaluation_epoch_id=v_epoch.epoch_id
     AND e.evaluation_kind=p_evaluation_kind AND e.game_family=p_game_family;
  IF v_incumbent IS NULL THEN RAISE EXCEPTION 'the certification receipt for % / % is missing', p_evaluation_kind, p_game_family; END IF;
  SELECT * INTO v_result FROM public.horse_league_results WHERE id=p_source_result_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'league result does not exist'; END IF;
  -- A re-check run is stored under its own name (results are unique per day
  -- and name); it is validated as exactly the certification's own result.
  IF v_result.matchup IS DISTINCT FROM public.fn_gto_v31_evaluation_matchup(
       p_evaluation_kind,p_game_family,v_dataset.dataset_checksum,v_epoch.epoch_no)
       || '_recheck_' || v_round.serving_commit THEN
    RAISE EXCEPTION 'a re-check result is named for its certification table and the re-checked engine';
  END IF;
  v_result.matchup := public.fn_gto_v31_evaluation_matchup(
    p_evaluation_kind,p_game_family,v_dataset.dataset_checksum,v_epoch.epoch_no);
  IF v_result.run_date<current_date-2 OR v_result.run_date>current_date
     OR NOT public.fn_gto_v31_v3_result_valid(v_dataset,p_evaluation_kind,p_game_family,
              v_result,v_epoch.epoch_no,v_incumbent) THEN
    RAISE EXCEPTION 'league result is stale, unsafe, or not the contract v3 tables, floors, memory-off runs and cells of this playbook';
  END IF;
  IF v_result.config_a->>'evaluation_engine_commit' IS DISTINCT FROM v_round.serving_commit THEN
    RAISE EXCEPTION 'the result was produced by a different engine commit than the round re-checks';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_recheck_rounds r, jsonb_array_elements(r.results) x(v)
              WHERE (x.v->>'source_result_id')::bigint = p_source_result_id)
     OR EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e WHERE e.source_result_id = p_source_result_id) THEN
    RAISE EXCEPTION 'a league result is evidence for one verdict only';
  END IF;

  v_verdict:=CASE WHEN v_result.bb100>2*v_result.stderr THEN 'win'
                  WHEN v_result.bb100<(-2*v_result.stderr) THEN 'loss' ELSE 'tie' END;
  v_results := v_round.results || jsonb_build_array(jsonb_build_object(
    'kind',p_evaluation_kind,'family',p_game_family,'verdict',v_verdict,
    'source_result_id',v_result.id,'hands',v_result.hands,'bb100',v_result.bb100,'stderr',v_result.stderr,
    'candidate_policy_hits',v_result.candidate_policy_hits,'recorded_at',now()));
  v_required := 2*cardinality(public.fn_gto_v31_v3_families(v_dataset.dataset_id));

  IF v_verdict = 'loss' THEN
    v_reason := format('Strict re-check: %s / %s lost on engine %s (%s +/- %s bb/100); the playbook is retired for good',
      p_evaluation_kind, p_game_family, v_round.serving_commit, round(v_result.bb100,3), round(v_result.stderr,3));
    UPDATE public.gto_v31_recheck_rounds
       SET results=v_results, outcome='retired', closed_at=now(), closed_by=v_round.opened_by, close_reason=v_reason
     WHERE round_id=p_round_id;
    UPDATE public.gto_v31_serving_bindings
       SET revoked_at=now(), revoked_by=v_round.opened_by, revoke_reason=v_reason
     WHERE dataset_id=v_dataset.dataset_id AND revoked_at IS NULL;
    IF v_dataset.state = 'active' THEN
      UPDATE public.gto_v31_datasets SET state='retired', retired_at=now() WHERE dataset_id=v_dataset.dataset_id;
    ELSE
      UPDATE public.gto_v31_datasets SET state='rejected' WHERE dataset_id=v_dataset.dataset_id;
    END IF;
    RETURN jsonb_build_object('round_id',p_round_id,'verdict',v_verdict,'outcome','retired','recorded',true);
  END IF;
  IF jsonb_array_length(v_results) = v_required THEN
    UPDATE public.gto_v31_recheck_rounds
       SET results=v_results, outcome='passed', closed_at=now(), closed_by=v_round.opened_by,
           close_reason=format('Strict re-check: all %s certification results win or tie on engine %s',
             v_required, v_round.serving_commit)
     WHERE round_id=p_round_id;
    RETURN jsonb_build_object('round_id',p_round_id,'verdict',v_verdict,'outcome','passed','recorded',true);
  END IF;
  UPDATE public.gto_v31_recheck_rounds SET results=v_results WHERE round_id=p_round_id;
  RETURN jsonb_build_object('round_id',p_round_id,'verdict',v_verdict,'outcome',NULL,'recorded',true,
    'remaining',v_required-jsonb_array_length(v_results));
END;
$function$;

-- 8. A round that cannot finish (evaluator crash, dataset moved on) closes
--    without a verdict. A loss has already closed it, so this cannot erase one.
CREATE FUNCTION public.fn_gto_v31_abandon_recheck_round(p_round_id uuid, p_closed_by text, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF COALESCE(length(btrim(p_closed_by)),0) NOT BETWEEN 1 AND 200 OR p_closed_by ~ '[[:cntrl:]]'
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 2000 OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'abandoning a re-check needs an accountable closer and an audited reason of 20 to 2000 characters';
  END IF;
  UPDATE public.gto_v31_recheck_rounds
     SET outcome='abandoned', closed_at=now(), closed_by=btrim(p_closed_by), close_reason=btrim(p_reason)
   WHERE round_id=p_round_id AND outcome IS NULL
  RETURNING round_id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$function$;

-- 9. What the qualification workflow and the evaluator read.
CREATE FUNCTION public.fn_gto_v31_recheck_status(p_dataset_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_epoch_id uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id;
  IF FOUND THEN v_epoch_id := public.fn_gto_v31_recheck_epoch(v_dataset); END IF;
  RETURN jsonb_build_object(
    'dataset_id',p_dataset_id,
    'state',v_dataset.state,
    'evaluation_contract',v_dataset.evaluation_contract,
    'recheck_epoch_id',v_epoch_id,
    -- What a re-check re-runs: each certification receipt of the epoch, with
    -- the incumbent it was measured against.
    'certification',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',e.evaluation_kind,'family',e.game_family,
        'verdict',e.verdict,'incumbent_dataset_checksum',e.metrics#>>'{incumbent_config,incumbent_dataset_checksum}')
        ORDER BY e.evaluation_kind,e.game_family)
      FROM public.gto_v31_release_evaluations e
     WHERE e.dataset_id=p_dataset_id AND e.evaluation_epoch_id=v_epoch_id
       AND e.evaluation_kind IN ('paired_replay','league')),'[]'::jsonb),
    'anchors',COALESCE((SELECT jsonb_agg(jsonb_build_object('epoch_id',a.epoch_id,'engine_commit',a.engine_commit,
        'execution_digest',a.execution_digest,'replay_corpus_checksum',a.replay_corpus_checksum,
        'replay_digest',a.replay_digest,'replay_states',a.replay_states,'corpus_sha256',a.corpus_sha256,
        'corpus_bytes',octet_length(a.corpus_gzip),'recorded_at',a.recorded_at) ORDER BY a.recorded_at)
      FROM public.gto_v31_execution_anchors a WHERE a.dataset_id=p_dataset_id),'[]'::jsonb),
    'rounds',COALESCE((SELECT jsonb_agg(jsonb_build_object('round_id',r.round_id,'epoch_id',r.epoch_id,
        'serving_commit',r.serving_commit,'execution_digest',r.execution_digest,'replay_digest',r.replay_digest,
        'opened_at',r.opened_at,'outcome',r.outcome,'closed_at',r.closed_at,'close_reason',r.close_reason,
        'results',r.results) ORDER BY r.opened_at)
      FROM public.gto_v31_recheck_rounds r WHERE r.dataset_id=p_dataset_id),'[]'::jsonb));
END;
$function$;

CREATE FUNCTION public.fn_gto_v31_replay_corpus(p_epoch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor public.gto_v31_execution_anchors%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_anchor FROM public.gto_v31_execution_anchors WHERE epoch_id=p_epoch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no execution anchor for this epoch'; END IF;
  RETURN jsonb_build_object('epoch_id',v_anchor.epoch_id,'replay_corpus_checksum',v_anchor.replay_corpus_checksum,
    'replay_digest',v_anchor.replay_digest,'corpus_sha256',v_anchor.corpus_sha256,
    'corpus_gzip_base64',encode(v_anchor.corpus_gzip,'base64'));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_gto_v31_execution_anchor_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_recheck_round_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_recheck_epoch(public.gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
DO $grants$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.fn_gto_v31_record_execution_anchor(uuid,text,text,text,integer,text,text)',
    'public.fn_gto_v31_open_recheck_round(uuid,text,text,text,text,text)',
    'public.fn_gto_v31_record_recheck_result(uuid,text,text,bigint)',
    'public.fn_gto_v31_abandon_recheck_round(uuid,text,text)',
    'public.fn_gto_v31_recheck_status(uuid)',
    'public.fn_gto_v31_replay_corpus(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  END LOOP;
END $grants$;

-- 10. Minimal patches to the live definitions.
CREATE FUNCTION pg_temp.v31_patch(p_fn regprocedure, p_pairs text[], p_post text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i integer;
BEGIN
  FOR i IN 1..array_length(p_pairs,1)/2 LOOP
    IF (length(d)-length(replace(d,p_pairs[2*i-1],'')))/length(p_pairs[2*i-1]) <> 1 THEN
      RAISE EXCEPTION 'v31 strict re-check patch anchor % of % does not occur exactly once',i,p_fn;
    END IF;
    d:=replace(d,p_pairs[2*i-1],p_pairs[2*i]);
  END LOOP;
  EXECUTE d;
  IF md5(pg_get_functiondef(p_fn)) IS DISTINCT FROM p_post THEN
    RAISE EXCEPTION 'v31 strict re-check postimage of % differs: %',p_fn,md5(pg_get_functiondef(p_fn));
  END IF;
END;
$function$;

SELECT pg_temp.v31_patch('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)'::regprocedure, ARRAY[
$a$
  UPDATE public.gto_v31_evaluation_epochs
     SET promoted_at=now(), promoted_serving_commit=p_serving_commit$a$,
$b$
  -- Strict re-check (2026-11-06): a contract v3 playbook carries the anchor
  -- its certifying engine recorded, and is promoted onto a different serving
  -- engine only after that engine passed a re-check round.
  IF v_dataset.evaluation_contract='gto_v31_candidate.v3' THEN
    IF NOT EXISTS (SELECT 1 FROM public.gto_v31_execution_anchors a WHERE a.epoch_id=v_epoch.epoch_id) THEN
      RAISE EXCEPTION 'a contract v3 promotion needs the execution anchor of its evaluated epoch';
    END IF;
    IF p_serving_commit IS DISTINCT FROM v_epoch.engine_commit AND NOT EXISTS (
         SELECT 1 FROM public.gto_v31_recheck_rounds r
          WHERE r.epoch_id=v_epoch.epoch_id AND r.serving_commit=p_serving_commit AND r.outcome='passed') THEN
      RAISE EXCEPTION 'the serving engine has not passed a re-check of this candidate';
    END IF;
  END IF;

  UPDATE public.gto_v31_evaluation_epochs
     SET promoted_at=now(), promoted_serving_commit=p_serving_commit$b$],
'99e715108dc74232c1089b9e5c15c5dc');

SELECT pg_temp.v31_patch('public.fn_gto_v31_bind_serving(uuid,text,text,text,text,text)'::regprocedure, ARRAY[
$a$  v_binding public.gto_v31_serving_bindings%ROWTYPE;
BEGIN$a$,
$b$  v_binding public.gto_v31_serving_bindings%ROWTYPE;
  v_anchor public.gto_v31_execution_anchors%ROWTYPE;
  v_round public.gto_v31_recheck_rounds%ROWTYPE;
BEGIN$b$,
$a$    RAISE EXCEPTION 'the binding names an engine commit other than the promoted epoch';
  END IF;
$a$,
$b$    RAISE EXCEPTION 'the binding names an engine commit other than the promoted epoch';
  END IF;
  -- Strict re-check (2026-11-06): a contract v3 playbook is served only by
  -- its certifying engine or by an engine that passed a re-check round; the
  -- binding records which, with both digests.
  IF v_dataset.evaluation_contract='gto_v31_candidate.v3' THEN
    SELECT * INTO v_anchor FROM public.gto_v31_execution_anchors WHERE epoch_id=v_epoch.epoch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'a contract v3 playbook without an execution anchor is never served'; END IF;
    IF p_serving_commit IS DISTINCT FROM v_epoch.engine_commit THEN
      SELECT * INTO v_round FROM public.gto_v31_recheck_rounds
       WHERE epoch_id=v_epoch.epoch_id AND serving_commit=p_serving_commit AND outcome='passed';
      IF NOT FOUND THEN RAISE EXCEPTION 'the serving engine has not passed a re-check of this playbook'; END IF;
    END IF;
  END IF;
$b$,
$a$  INSERT INTO public.gto_v31_serving_bindings (dataset_id, epoch_id, engine_commit, serving_commit, closure_digest, bound_by, reason)
  VALUES (p_dataset_id, v_epoch.epoch_id, v_epoch.engine_commit, p_serving_commit, p_closure_digest, btrim(p_bound_by), btrim(p_reason))$a$,
$b$  INSERT INTO public.gto_v31_serving_bindings (dataset_id, epoch_id, engine_commit, serving_commit, closure_digest, bound_by, reason,
    recheck_round_id, execution_digest, replay_digest)
  VALUES (p_dataset_id, v_epoch.epoch_id, v_epoch.engine_commit, p_serving_commit, p_closure_digest, btrim(p_bound_by), btrim(p_reason),
    v_round.round_id, v_anchor.execution_digest, v_anchor.replay_digest)$b$],
'7a11e66ef3569ad97076e224a1f537f6');

SELECT pg_temp.v31_patch('public.fn_gto_v31_serving_binding_guard()'::regprocedure, ARRAY[
$a$      NEW.bound_at, NEW.bound_by, NEW.reason)
     IS DISTINCT FROM (OLD.binding_id, OLD.dataset_id, OLD.epoch_id, OLD.engine_commit, OLD.serving_commit,
      OLD.closure_digest, OLD.bound_at, OLD.bound_by, OLD.reason)$a$,
$b$      NEW.bound_at, NEW.bound_by, NEW.reason, NEW.recheck_round_id, NEW.execution_digest, NEW.replay_digest)
     IS DISTINCT FROM (OLD.binding_id, OLD.dataset_id, OLD.epoch_id, OLD.engine_commit, OLD.serving_commit,
      OLD.closure_digest, OLD.bound_at, OLD.bound_by, OLD.reason, OLD.recheck_round_id, OLD.execution_digest,
      OLD.replay_digest)$b$],
'098f3be785c77407e2bd892864d5b67b');

SELECT pg_temp.v31_patch('public.fn_gto_v31_evaluation_cells(uuid,integer,integer)'::regprocedure, ARRAY[
$a$d.state IN ('evaluating','candidate')$a$,
$b$d.state IN ('evaluating','candidate','active')$b$],
'41417b2db70833c68796610c296fb56b');

COMMIT;
