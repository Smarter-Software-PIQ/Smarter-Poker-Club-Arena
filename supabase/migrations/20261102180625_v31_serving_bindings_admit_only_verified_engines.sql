-- 20261102180625_v31_serving_bindings_admit_only_verified_engines.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261102151428 bound a V31 promotion to the evaluated engine commit, but a
-- promoted dataset was then served by whatever engine was running: every live
-- decision worker loads the active dataset at boot and every six hours with no
-- compatibility check. A later release (the decision closure changes about
-- eleven times a day) or a rollback would serve a dataset its brain was never
-- evaluated against, and a failed explicit load could leave workers on
-- different stores.
--
-- public.gto_v31_serving_bindings: the engine commits allowed to serve the
-- active dataset. A binding names the promoted epoch, the serving commit and
-- the decision-closure digest the qualification workflow proved identical to
-- the evaluated commit, with bound_at/bound_by/reason. It can be revoked once
-- (revoked_at/by/reason); a later re-bind is a new row. Rows are permanent
-- provenance while their dataset exists.
--
--   fn_gto_v31_bind_serving(dataset, engine_commit, serving_commit,
--     closure_digest, bound_by, reason): service role; the dataset must be
--     active and promoted from the epoch of exactly engine_commit. Idempotent
--     for the same open binding; a different digest for an open binding is
--     refused. Takes the release gate BEFORE the dataset row (promotion takes
--     the candidate row, the gate, then the active row), so it cannot deadlock
--     with a promotion.
--   fn_gto_v31_revoke_serving(dataset, serving_commit, revoked_by, reason):
--     closes the open binding (idempotent; false when none is open).
--   fn_gto_v31_serving_admission(engine_commit): what a live worker asks
--     before loading: the active dataset (or null) and whether this engine
--     commit holds an open binding for it. The loader serves the empty store
--     when it is not admitted.
--
-- New objects only; no live function is replaced, no hot table is touched.
-- Native proof: scripts/ci/test-v31-serving-bindings.py (PostgreSQL 17).
--
-- @live-proof: to_regclass('public.gto_v31_serving_bindings') IS NOT NULL AND has_function_privilege('service_role','public.fn_gto_v31_serving_admission(text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_gto_v31_serving_admission(text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_gto_v31_serving_admission(text)','EXECUTE') AND has_function_privilege('service_role','public.fn_gto_v31_bind_serving(uuid,text,text,text,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_gto_v31_bind_serving(uuid,text,text,text,text,text)','EXECUTE') AND has_function_privilege('service_role','public.fn_gto_v31_revoke_serving(uuid,text,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_gto_v31_revoke_serving(uuid,text,text,text)','EXECUTE') AND NOT has_table_privilege('authenticated','public.gto_v31_serving_bindings','SELECT')

BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
  IF to_regclass('public.gto_v31_evaluation_epochs') IS NULL
     OR to_regprocedure('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v31_evaluation_epochs_not_installed';
  END IF;
  IF to_regclass('public.gto_v31_serving_bindings') IS NOT NULL
     OR to_regprocedure('public.fn_gto_v31_serving_admission(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v31_serving_bindings_already_installed';
  END IF;
END
$guard$;

CREATE TABLE public.gto_v31_serving_bindings (
  binding_id      uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id      uuid        NOT NULL REFERENCES public.gto_v31_datasets(dataset_id) ON DELETE CASCADE,
  epoch_id        uuid        NOT NULL REFERENCES public.gto_v31_evaluation_epochs(epoch_id) ON DELETE CASCADE,
  engine_commit   text        NOT NULL CHECK (engine_commit ~ '^[0-9a-f]{40}$' AND engine_commit <> repeat('0',40)),
  serving_commit  text        NOT NULL CHECK (serving_commit ~ '^[0-9a-f]{40}$' AND serving_commit <> repeat('0',40)),
  closure_digest  text        NOT NULL CHECK (closure_digest ~ '^[0-9a-f]{64}$' AND closure_digest <> repeat('0',64)),
  bound_at        timestamptz NOT NULL DEFAULT now(),
  bound_by        text        NOT NULL CHECK (length(btrim(bound_by)) BETWEEN 1 AND 200 AND bound_by !~ '[[:cntrl:]]'),
  reason          text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 2000 AND reason !~ '[[:cntrl:]]'),
  revoked_at      timestamptz,
  revoked_by      text,
  revoke_reason   text,
  CONSTRAINT gto_v31_serving_bindings_revocation CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND length(btrim(revoked_by)) BETWEEN 1 AND 200 AND revoked_by !~ '[[:cntrl:]]'
        AND length(btrim(revoke_reason)) BETWEEN 20 AND 2000 AND revoke_reason !~ '[[:cntrl:]]'))
);
CREATE UNIQUE INDEX gto_v31_serving_bindings_one_open
  ON public.gto_v31_serving_bindings (dataset_id, serving_commit) WHERE revoked_at IS NULL;
CREATE INDEX gto_v31_serving_bindings_epoch_idx ON public.gto_v31_serving_bindings (epoch_id);
COMMENT ON TABLE public.gto_v31_serving_bindings IS
  'Engine commits proven decision-closure-identical to the promoted V31 epoch and allowed to serve the active dataset. Live workers serve the empty store without an open binding for their own commit.';
ALTER TABLE public.gto_v31_serving_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_serving_bindings FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_gto_v31_serving_binding_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets d WHERE d.dataset_id = OLD.dataset_id) THEN
      RAISE EXCEPTION 'a serving binding is permanent provenance';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.binding_id, NEW.dataset_id, NEW.epoch_id, NEW.engine_commit, NEW.serving_commit, NEW.closure_digest,
      NEW.bound_at, NEW.bound_by, NEW.reason)
     IS DISTINCT FROM (OLD.binding_id, OLD.dataset_id, OLD.epoch_id, OLD.engine_commit, OLD.serving_commit,
      OLD.closure_digest, OLD.bound_at, OLD.bound_by, OLD.reason)
     OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at, NEW.revoked_by, NEW.revoke_reason)
         IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by, OLD.revoke_reason))
     OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL
         AND (NEW.revoked_by, NEW.revoke_reason) IS DISTINCT FROM (OLD.revoked_by, OLD.revoke_reason)) THEN
    RAISE EXCEPTION 'a serving binding is permanent provenance; only its one revocation is recorded';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_serving_binding_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gto_v31_serving_bindings_are_provenance
  BEFORE UPDATE OR DELETE ON public.gto_v31_serving_bindings
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_serving_binding_guard();

CREATE FUNCTION public.fn_gto_v31_bind_serving(p_dataset_id uuid, p_engine_commit text, p_serving_commit text,
  p_closure_digest text, p_bound_by text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
  v_binding public.gto_v31_serving_bindings%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF COALESCE(p_engine_commit,'')!~'^[0-9a-f]{40}$' OR p_engine_commit=repeat('0',40)
     OR COALESCE(p_serving_commit,'')!~'^[0-9a-f]{40}$' OR p_serving_commit=repeat('0',40)
     OR COALESCE(p_closure_digest,'')!~'^[0-9a-f]{64}$' OR p_closure_digest=repeat('0',64) THEN
    RAISE EXCEPTION 'a serving binding names full evaluated and serving commits and the proven closure digest';
  END IF;
  IF COALESCE(length(btrim(p_bound_by)),0) NOT BETWEEN 1 AND 200 OR p_bound_by ~ '[[:cntrl:]]'
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 2000 OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'a serving binding needs an accountable binder and an audited reason of 20 to 2000 characters';
  END IF;
  -- Gate first, then the active row: promotion holds the candidate row and the
  -- gate before it retires the active row, so this order cannot deadlock.
  PERFORM pg_advisory_xact_lock(hashtextextended('smarter-poker:gto-v31-release-gate', 0));
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'only the active dataset is bound to a serving engine'; END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND promoted_at IS NOT NULL;
  IF NOT FOUND OR v_epoch.engine_commit IS DISTINCT FROM p_engine_commit THEN
    RAISE EXCEPTION 'the binding names an engine commit other than the promoted epoch';
  END IF;
  SELECT * INTO v_binding FROM public.gto_v31_serving_bindings
   WHERE dataset_id=p_dataset_id AND serving_commit=p_serving_commit AND revoked_at IS NULL;
  IF FOUND THEN
    IF v_binding.closure_digest IS DISTINCT FROM p_closure_digest OR v_binding.epoch_id IS DISTINCT FROM v_epoch.epoch_id THEN
      RAISE EXCEPTION 'an open serving binding already records another closure identity';
    END IF;
    RETURN jsonb_build_object('binding_id',v_binding.binding_id,'serving_commit',v_binding.serving_commit,'bound',false);
  END IF;
  INSERT INTO public.gto_v31_serving_bindings (dataset_id, epoch_id, engine_commit, serving_commit, closure_digest, bound_by, reason)
  VALUES (p_dataset_id, v_epoch.epoch_id, v_epoch.engine_commit, p_serving_commit, p_closure_digest, btrim(p_bound_by), btrim(p_reason))
  RETURNING * INTO v_binding;
  RETURN jsonb_build_object('binding_id',v_binding.binding_id,'serving_commit',v_binding.serving_commit,'bound',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_bind_serving(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_bind_serving(uuid,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.fn_gto_v31_revoke_serving(p_dataset_id uuid, p_serving_commit text, p_revoked_by text, p_reason text)
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
  IF COALESCE(length(btrim(p_revoked_by)),0) NOT BETWEEN 1 AND 200 OR p_revoked_by ~ '[[:cntrl:]]'
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 2000 OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'a revocation needs an accountable revoker and an audited reason of 20 to 2000 characters';
  END IF;
  UPDATE public.gto_v31_serving_bindings
     SET revoked_at=now(), revoked_by=btrim(p_revoked_by), revoke_reason=btrim(p_reason)
   WHERE dataset_id=p_dataset_id AND serving_commit=p_serving_commit AND revoked_at IS NULL
  RETURNING binding_id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_revoke_serving(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_revoke_serving(uuid,text,text,text) TO service_role;

CREATE FUNCTION public.fn_gto_v31_serving_admission(p_engine_commit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active public.gto_v31_datasets%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_active FROM public.gto_v31_datasets WHERE state='active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('active',NULL,'admitted',false);
  END IF;
  RETURN jsonb_build_object(
    'active',jsonb_build_object('dataset_id',v_active.dataset_id,'dataset_checksum',v_active.dataset_checksum),
    'admitted',COALESCE(p_engine_commit,'')~'^[0-9a-f]{40}$' AND EXISTS (
      SELECT 1 FROM public.gto_v31_serving_bindings b
        JOIN public.gto_v31_evaluation_epochs p ON p.epoch_id=b.epoch_id AND p.promoted_at IS NOT NULL
       WHERE b.dataset_id=v_active.dataset_id AND b.serving_commit=p_engine_commit AND b.revoked_at IS NULL));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_serving_admission(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_serving_admission(text) TO service_role;

COMMIT;
