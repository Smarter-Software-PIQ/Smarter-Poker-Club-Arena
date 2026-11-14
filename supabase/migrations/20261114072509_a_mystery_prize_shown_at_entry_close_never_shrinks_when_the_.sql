-- 20261114072509_a_mystery_prize_shown_at_entry_close_never_shrinks_when_the_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261114034527 seals the mystery ladder when entry closes, for the field the
-- phase opens at (Dan 2026-11-13: "ONCE THE PRIZE POOL IS 'FINALIZED' ... ALL
-- MYSTERY BOUNTY PRIZES SHOULD BE SHOWN"). If the field the phase actually
-- opens at is smaller - two players bust on the bubble hand, or entry closed
-- with fewer players left than the threshold - there is one knockout (or more)
-- fewer than sealed chests. Until now the seed then threw the sealed ladder
-- away and used a fresh cut, so the prizes players had been shown could
-- change.
--
-- Now fn_mystery_sealed_ladder_for_open keeps the sealed ladder: it drops the
-- smallest sealed chests that no longer have a knockout to pay them, and
-- spreads their chips evenly, in whole chips, over the chests that remain.
-- Every prize that stays is at least what was shown, the draw order is kept,
-- and the total is still exactly the sealed pool, so every chip of the pool is
-- still paid by knockouts. The seed calls it in place of the exact-match read.
--
-- Nothing is paid or written before activation; this only decides which
-- chests the seed inserts.
--
-- @live-proof: (SELECT to_regprocedure('public.fn_mystery_sealed_ladder_for_open(uuid,integer,bigint)') IS NOT NULL AND position('fn_mystery_sealed_ladder_for_open' IN pg_get_functiondef('public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_mystery_sealed_ladder_for_open(
  p_tournament_id uuid, p_count integer, p_pool_cents bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s record;
  v_drop int;
  v_spare bigint;
  v_unit bigint;
  v_step bigint;
  v_units bigint;
  v_each bigint;
  v_rem bigint;
  v_out jsonb;
  v_sum bigint;
BEGIN
  SELECT chests, chest_count, pool_cents INTO s
    FROM public.tournament_mystery_sealed_ladders
   WHERE tournament_id = p_tournament_id;
  -- No sealed ladder, a different pool, or more knockouts than sealed chests:
  -- the seed keeps the inventory the engine sent.
  IF NOT FOUND OR p_count IS NULL OR p_count < 1 OR p_pool_cents IS NULL
     OR s.pool_cents <> p_pool_cents OR s.chest_count < p_count THEN
    RETURN NULL;
  END IF;
  IF s.chest_count = p_count THEN
    RETURN s.chests;
  END IF;

  v_drop := s.chest_count - p_count;

  -- The chests no longer paid are the smallest ones; on a tie the last drawn.
  WITH e AS (
    SELECT (x->>'amount_cents')::bigint AS amt, ord
      FROM jsonb_array_elements(s.chests) WITH ORDINALITY AS t(x, ord)
  ), r AS (
    SELECT amt, row_number() OVER (ORDER BY amt ASC, ord DESC) AS rk FROM e
  )
  SELECT COALESCE(sum(amt), 0) INTO v_spare FROM r WHERE rk <= v_drop;

  -- Spread in whole chips (whole Diamonds for a Diamond event) when the spare
  -- divides into them, else in the event's money unit.
  v_unit := GREATEST(100, public.fn_ca_tournament_unit_cents(p_tournament_id));
  v_step := CASE WHEN v_spare % v_unit = 0 THEN v_unit
                 ELSE GREATEST(1, public.fn_ca_tournament_unit_cents(p_tournament_id)) END;
  v_units := v_spare / v_step;
  v_each := v_units / p_count;
  v_rem := v_units % p_count;

  WITH e AS (
    SELECT x, ord, (x->>'amount_cents')::bigint AS amt
      FROM jsonb_array_elements(s.chests) WITH ORDINALITY AS t(x, ord)
  ), d AS (
    SELECT x, ord, amt, row_number() OVER (ORDER BY amt ASC, ord DESC) AS drk FROM e
  ), k AS (
    -- The remainder goes to the smallest kept chests first.
    SELECT x, ord, amt, row_number() OVER (ORDER BY amt ASC, ord) AS krk
      FROM d WHERE drk > v_drop
  )
  SELECT jsonb_agg(x || jsonb_build_object('amount_cents',
           amt + (v_each + CASE WHEN krk <= v_rem THEN 1 ELSE 0 END) * v_step) ORDER BY ord)
    INTO v_out FROM k;

  SELECT sum((x->>'amount_cents')::bigint) INTO v_sum FROM jsonb_array_elements(v_out) x;
  -- Exactly the sealed pool, exactly the chests asked for, or nothing.
  IF v_out IS NULL OR jsonb_array_length(v_out) <> p_count
     OR v_sum + (v_spare - v_units * v_step) <> s.pool_cents THEN
    RETURN NULL;
  END IF;
  IF v_spare - v_units * v_step <> 0 THEN
    RETURN NULL;
  END IF;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_mystery_sealed_ladder_for_open(uuid, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mystery_sealed_ladder_for_open(uuid, integer, bigint) TO service_role;

-- The seed asks the function above instead of requiring an exact count.
DO $seed$
DECLARE
  sig constant regprocedure := 'public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure;
  d text;
  b0 constant text := E'  SELECT s.chests INTO v_sealed_chests\n';
  b1 constant text := E'  IF v_sealed_chests IS NOT NULL THEN v_norm := v_sealed_chests; END IF;\n';
  i0 int; i1 int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('fn_mystery_sealed_ladder_for_open' IN d) > 0 THEN RETURN; END IF;
  i0 := position(b0 IN d);
  i1 := position(b1 IN d);
  IF i0 = 0 OR i1 = 0 OR i1 < i0
     OR (length(d) - length(replace(d, b0, ''))) / length(b0) <> 1 THEN
    RAISE EXCEPTION 'fn_mystery_bounty_seed changed shape; sealed ladder reader not installed';
  END IF;
  d := substr(d, 1, i0 - 1)
    || E'  -- A smaller field than sealed keeps the sealed prizes and spreads the\n'
    || E'  -- unpaid chests over them (fn_mystery_sealed_ladder_for_open).\n'
    || E'  v_sealed_chests := public.fn_mystery_sealed_ladder_for_open(\n'
    || E'    p_tournament_id, jsonb_array_length(p_chests),\n'
    || E'    (SELECT sum((x->>''amount_cents'')::bigint) FROM jsonb_array_elements(v_norm) x));\n'
    || substr(d, i1);
  EXECUTE d;
END
$seed$;

COMMIT;
