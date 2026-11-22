-- @live-proof: (to_regprocedure('smarter_private.horse_compact_stats_basis_core(jsonb)') IS NOT NULL AND strpos(pg_get_functiondef('smarter_private.horse_compact_stats_basis(jsonb)'::regprocedure), 'RETURN smarter_private.horse_compact_stats_basis_core(p_stats - ''horse_hole_cards'');')>0 AND to_regprocedure('public.horse_stats_basis_accepted_keys()') IS NOT NULL AND has_function_privilege('service_role','public.horse_stats_basis_accepted_keys()','EXECUTE') AND NOT has_function_privilege('anon','public.horse_stats_basis_accepted_keys()','EXECUTE') AND NOT has_function_privilege('authenticated','public.horse_stats_basis_accepted_keys()','EXECUTE') AND NOT has_function_privilege('anon','smarter_private.horse_compact_stats_basis(jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','smarter_private.horse_compact_stats_basis(jsonb)','EXECUTE'))
-- 20261120025753_the_horse_stats_basis_drops_the_horse_hole_cards_key.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- THE HAND-CONTENT RETENTION BASIS ACCEPTS THE HORSE HOLE CARDS KEY, AND SAYS
-- SO (HORSE DECISIONS lane, independent review B1, 2026-11-19).
--
-- smarter_private.horse_compact_stats_basis (the hand_history retention and
-- compaction path: horse_stats_basis_immutable, capture_horse_stats_basis,
-- compact_horse_cash_play_contents, horse_stats_basis_matches) raises
-- HORSE_STATS_BASIS_INVALID_SHAPE on any top-level stats_facts key it does not
-- know. On 2026-10-25 a new key (horse_rollups) stopped sp_prune_hand_history
-- for eleven days (20261105174453). The engine is about to add one more key,
-- stats_facts.horse_hole_cards (every Horse's own dealt cards, kept for audit
-- by 20261120014240). That migration used to patch this function itself,
-- behind md5 pins of two production bodies, so any other lane touching either
-- body made it refuse, and "the migration lands before the engine" was not
-- guaranteed. This file splits the key acceptance out, with no pin that can
-- refuse, and gives the engine a way to ask before it ever sends the key.
--
-- 1. THE BASIS DROPS THE KEY BEFORE IT LOOKS. The installed function (whatever
--    its body is today) is renamed, once, to
--    smarter_private.horse_compact_stats_basis_core (same OID, same body, same
--    privileges), and horse_compact_stats_basis becomes a thin wrapper: a
--    payload carrying horse_hole_cards must carry an array there (else the
--    same HORSE_STATS_BASIS_INVALID_SHAPE), and the core compacts the payload
--    without it. The compact basis is the content-free reconciliation record,
--    so it never held cards (the core already drops facts[].hole_cards). A
--    payload without the key reaches the core unchanged: the same bytes as
--    before. Nothing in the core is read, matched or rewritten, so a body
--    another lane changed is wrapped as it stands. Re-running this file
--    re-creates the wrapper and renames nothing twice.
--
-- 2. THE ENGINE ASKS FIRST. public.horse_stats_basis_accepted_keys() (service
--    role only) runs the installed basis on a minimal payload carrying each
--    optional top-level key the engine may send, and returns
--    {"contract":1,"accepted":[...]} with the keys that compacted. It tests the
--    function's behaviour, not a version number, so it stays true whatever
--    installs or rolls back later. The engine
--    (server/src/services/HorseStatsBasisContract.ts) attaches
--    horse_hole_cards only when this answer lists it; an older database, an
--    error or no answer leaves the key off.
--
-- NO HORSE DECISION CHANGES; no hot table is locked (two function bodies, a
-- rename in smarter_private, one new function).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $core$
BEGIN
  IF to_regprocedure('smarter_private.horse_compact_stats_basis(jsonb)') IS NULL
     AND to_regprocedure('smarter_private.horse_compact_stats_basis_core(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'HORSE_STATS_BASIS_MISSING' USING ERRCODE = '55000';
  END IF;
  -- Once: the installed body becomes the core. On a re-run the core exists and
  -- horse_compact_stats_basis is this file's own wrapper.
  IF to_regprocedure('smarter_private.horse_compact_stats_basis_core(jsonb)') IS NULL THEN
    ALTER FUNCTION smarter_private.horse_compact_stats_basis(jsonb)
      RENAME TO horse_compact_stats_basis_core;
  END IF;
END
$core$;
REVOKE ALL ON FUNCTION smarter_private.horse_compact_stats_basis_core(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.horse_compact_stats_basis(p_stats jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
BEGIN
  -- horse_hole_cards (20261120025753): every Horse's own dealt cards. Never
  -- part of the compact basis; an entry that is not an array is the same
  -- shape refusal the core gives any malformed key.
  IF jsonb_typeof(p_stats) = 'object' AND p_stats ? 'horse_hole_cards' THEN
    IF jsonb_typeof(p_stats->'horse_hole_cards') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'HORSE_STATS_BASIS_INVALID_SHAPE' USING ERRCODE = '55000';
    END IF;
    RETURN smarter_private.horse_compact_stats_basis_core(p_stats - 'horse_hole_cards');
  END IF;
  RETURN smarter_private.horse_compact_stats_basis_core(p_stats);
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.horse_compact_stats_basis(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: smarter_private.horse_compact_stats_basis
DO $probe$
DECLARE
  base jsonb := jsonb_build_object('version', 2, 'transfers', '[]'::jsonb,
    'facts', jsonb_build_array(jsonb_build_object('user_id', gen_random_uuid(),
      'hole_cards', jsonb_build_array('As', 'Kd'))));
  v jsonb;
BEGIN
  v := smarter_private.horse_compact_stats_basis(base || jsonb_build_object('horse_hole_cards',
    jsonb_build_array(jsonb_build_object('user_id', gen_random_uuid(), 'seat', 1,
      'cards', jsonb_build_array('As', 'Kd')))));
  IF v ? 'horse_hole_cards' OR v::text LIKE '%As%' THEN
    RAISE EXCEPTION 'HORSE_STATS_BASIS_PROBE_KEPT_CARDS' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.horse_compact_stats_basis(base)
       IS DISTINCT FROM smarter_private.horse_compact_stats_basis_core(base) THEN
    RAISE EXCEPTION 'HORSE_STATS_BASIS_PROBE_CHANGED_BYTES' USING ERRCODE = '55000';
  END IF;
  BEGIN
    PERFORM smarter_private.horse_compact_stats_basis(base || '{"horse_hole_cards":{"a":1}}'::jsonb);
    RAISE EXCEPTION 'HORSE_STATS_BASIS_PROBE_ACCEPTED_NON_ARRAY' USING ERRCODE = '55000';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'HORSE_STATS_BASIS_INVALID_SHAPE' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

CREATE OR REPLACE FUNCTION public.horse_stats_basis_accepted_keys()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, smarter_private
AS $function$
DECLARE
  -- Every optional top-level stats_facts key the engine may send, with a
  -- value of its shape (server/src/services/HorseStatsBasisContract.ts pins
  -- the same list: tests/a-stats-key-ships-only-where-the-retention-basis-accepts-it.law.test.ts).
  candidates jsonb := jsonb_build_object(
    'horse_rollups', '{}'::jsonb,
    'horse_hole_cards', '[]'::jsonb);
  base jsonb := jsonb_build_object('version', 2, 'transfers', '[]'::jsonb,
    'facts', jsonb_build_array('{}'::jsonb));
  k text;
  accepted text[] := ARRAY[]::text[];
BEGIN
  -- Service role only by its grants (below); it reads no row and returns key
  -- names only.
  FOR k IN SELECT jsonb_object_keys(candidates) ORDER BY 1 LOOP
    BEGIN
      PERFORM smarter_private.horse_compact_stats_basis(base || jsonb_build_object(k, candidates->k));
      accepted := accepted || k;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- refused by the installed basis: the engine must not send it
    END;
  END LOOP;
  RETURN jsonb_build_object('contract', 1, 'accepted', to_jsonb(accepted));
END
$function$;
REVOKE ALL ON FUNCTION public.horse_stats_basis_accepted_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.horse_stats_basis_accepted_keys() TO service_role;

-- @probe-for: public.horse_stats_basis_accepted_keys
DO $probe$
DECLARE v jsonb;
BEGIN
  v := public.horse_stats_basis_accepted_keys();
  IF (v->>'contract') IS DISTINCT FROM '1'
     OR NOT (v->'accepted') @> '["horse_hole_cards", "horse_rollups"]'::jsonb THEN
    RAISE EXCEPTION 'HORSE_STATS_BASIS_PROBE_ACCEPTED_KEYS (%)', v USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
