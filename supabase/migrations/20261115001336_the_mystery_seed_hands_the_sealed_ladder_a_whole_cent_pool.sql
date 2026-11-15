-- 20261115001336_the_mystery_seed_hands_the_sealed_ladder_a_whole_cent_pool.sql
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261114072509 made fn_mystery_bounty_seed call
--   fn_mystery_sealed_ladder_for_open(uuid, integer, bigint)
-- passing (SELECT sum((x->>'amount_cents')::bigint) ...) as the pool. In
-- Postgres sum(bigint) is numeric, so the call resolves to
-- (uuid, integer, numeric), which does not exist: every mystery activation
-- raised 42883 and rolled back. A mystery bounty event that reached its
-- activation point could never commit its seed, the engine re-tried every
-- sweep, and the tables stopped dealing (2026-11-14: Union Mystery Bounty
-- (PLO5) a5957f99 and Evening Mystery Bounty (PLO5) a88c4be4 went dark,
-- raising fn_ca_tournament_dark_while_running and MttPlayStopped).
--
-- The sum is cast back to bigint. Nothing else in the seed changes.
--
-- @live-proof: (SELECT position('sum((x->>''amount_cents'')::bigint)::bigint FROM jsonb_array_elements(v_norm) x));' IN pg_get_functiondef('public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure)) > 0)

BEGIN;

DO $fix$
DECLARE
  v_def text;
  v_old constant text :=
    '(SELECT sum((x->>''amount_cents'')::bigint) FROM jsonb_array_elements(v_norm) x));';
  v_new constant text :=
    '(SELECT sum((x->>''amount_cents'')::bigint)::bigint FROM jsonb_array_elements(v_norm) x));';
  v_hits int;
BEGIN
  SELECT pg_get_functiondef('public.fn_mystery_bounty_seed(uuid, integer, jsonb)'::regprocedure)
    INTO v_def;
  IF position(v_new IN v_def) > 0 THEN RETURN; END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fn_mystery_bounty_seed: expected exactly one uncast sealed-ladder pool argument, found %', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix$;

COMMIT;
