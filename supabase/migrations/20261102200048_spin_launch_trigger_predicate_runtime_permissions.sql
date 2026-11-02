-- 20261102200048_spin_launch_trigger_predicate_runtime_permissions
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 20:00:48 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.

-- Reproduced on production in one self-aborting transaction: the engine's
-- service_role presentation update raised 42501 at the private conversion
-- predicate, before its paid Spin could finish its existing launch receipt.
-- The predicate and money converter remain postgres-only. Their invoker
-- trigger must enter that private branch only as the converter's owner.
-- No role elevation, new grants, money movement or cohort repair is installed.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $boundary$
DECLARE
 source text;
 before_call text := $old$  IF TG_TABLE_NAME='tournaments' AND public.fn_ca_midway_free_buy_conversion_transition(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;$old$;
 after_call text := $new$  -- Only the private postgres-owned converter may ask its private predicate.
  -- An ordinary engine/browser update must reach the unchanged lifecycle guard.
  IF current_user = 'postgres' THEN
    IF TG_TABLE_NAME='tournaments' AND public.fn_ca_midway_free_buy_conversion_transition(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  END IF;$new$;
BEGIN
 SELECT pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure) INTO source;
 IF md5(source) IS DISTINCT FROM 'e39805425a1a20e6b394dfcd61255d93'
    OR length(source)-length(replace(source,before_call,'')) <> length(before_call) THEN
   RAISE EXCEPTION 'Inspected managed lifecycle conversion boundary changed';
 END IF;
 EXECUTE replace(source,before_call,after_call);
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.fn_guard_managed_game_lifecycle()'::regprocedure)
    OR has_function_privilege('service_role','public.fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'Private conversion or invoker lifecycle authority changed';
 END IF;
END $boundary$;
COMMIT;
