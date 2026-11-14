-- 20261114034527_mystery_bounty_ladder_is_sealed_and_shown_when_the_prize_poo.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-13, verbatim: "ONCE THE PRIZE POOL IS 'FINALIZED' (AFTER THE
-- ADD ON PERIOD) ALL MYSTERY BOUNTY PRIZES SHOULD BE SHOWN... DO NOT WAIT
-- UNTIL PLAYERS ARE ITM TO REVEAL MYSTERY BOUNTY PRIZES."
--
-- The chests were only cut when the mystery phase opened (at the money), so
-- the lobby had nothing to list until then. Now the engine cuts the real
-- ladder from the actual finalized pool as soon as entry closes and seals it
-- here (fn_mystery_bounty_seal). The lobby read (fn_mystery_bounty_inventory)
-- lists the sealed ladder while the stage is still 'pending'. When the phase
-- opens, fn_mystery_bounty_seed puts those exact sealed chests into play if
-- the chest count and pool still match; otherwise it uses the inventory the
-- engine sends at that moment, as before.
--
-- Paying is unchanged: no bounty is paid before the phase opens. The sealed
-- ladder lives in its own table, never in tournament_bounty_chests, and
-- tournaments.mystery_bounty_pool_cents stays untouched until activation, so
-- every terminal guard that requires a pending event to carry no inventory
-- still holds. The table has no foreign key to tournaments (section 2 rule 7).
--
-- @live-proof: (SELECT to_regprocedure('public.fn_mystery_bounty_seal(uuid,integer,jsonb)') IS NOT NULL AND position('tournament_mystery_sealed_ladders' IN pg_get_functiondef('public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure)) > 0 AND position('tournament_mystery_sealed_ladders' IN pg_get_functiondef('public.fn_mystery_bounty_inventory(uuid)'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.tournament_mystery_sealed_ladders (
  tournament_id   uuid PRIMARY KEY,
  players_at_open integer NOT NULL CHECK (players_at_open >= 2),
  chest_count     integer NOT NULL CHECK (chest_count >= 1),
  pool_cents      bigint  NOT NULL CHECK (pool_cents > 0),
  chests          jsonb   NOT NULL,
  sealed_at       timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.tournament_mystery_sealed_ladders ENABLE ROW LEVEL SECURITY;
-- The chest order is the draw order, so no client role reads the table. The
-- lobby reads tier totals through the definer function below.
REVOKE ALL ON TABLE public.tournament_mystery_sealed_ladders FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.tournament_mystery_sealed_ladders TO service_role;

CREATE OR REPLACE FUNCTION public.fn_mystery_bounty_seal(
  p_tournament_id uuid, p_players_at_open integer, p_chests jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t record;
  v_pool_cents bigint;
  v_bounty_cents bigint;
  v_paid_cents bigint;
  v_m numeric; v_r numeric;
  v_sum bigint; v_count int;
  v_unit bigint;
  v_chest_unit bigint;
  v_whole bigint;
  v_norm jsonb;
  v_existing record;
BEGIN
  SELECT id, is_mystery_bounty, prize_pool_finalized, bounty_pool,
         bounty_pool_paid, mystery_bounty_stage,
         mystery_bounty_pool_percent, mystery_bounty_regular_pool_percent
    INTO v_t FROM public.tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); END IF;
  IF NOT COALESCE(v_t.is_mystery_bounty, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_mystery_bounty');
  END IF;
  IF v_t.mystery_bounty_stage <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_activated');
  END IF;
  -- The pool must have stopped moving: the ladder is cut from actual totals.
  IF NOT COALESCE(v_t.prize_pool_finalized, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'entry_still_open');
  END IF;

  -- IDEMPOTENT: the first sealed ladder is the published one.
  SELECT chest_count, pool_cents INTO v_existing
    FROM public.tournament_mystery_sealed_ladders WHERE tournament_id = p_tournament_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_sealed', true,
      'chests', v_existing.chest_count, 'pool_cents', v_existing.pool_cents);
  END IF;

  IF p_chests IS NULL OR jsonb_typeof(p_chests) <> 'array' OR jsonb_array_length(p_chests) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'chests_required');
  END IF;
  IF p_players_at_open IS NULL
     OR jsonb_array_length(p_chests) <> GREATEST(p_players_at_open - 1, 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'chest_count_mismatch',
      'chests', jsonb_array_length(p_chests), 'players_at_open', p_players_at_open);
  END IF;

  -- The same pool arithmetic as fn_mystery_bounty_seed, in the same order.
  v_bounty_cents := round(COALESCE(v_t.bounty_pool, 0) * 100)::bigint;
  v_paid_cents := round(COALESCE(v_t.bounty_pool_paid, 0) * 100)::bigint
                  + public.fn_mystery_bounty_unrecorded_head_cents(p_tournament_id);
  v_m := GREATEST(0, COALESCE(v_t.mystery_bounty_pool_percent, 50));
  v_r := GREATEST(0, COALESCE(v_t.mystery_bounty_regular_pool_percent, 50));
  IF v_m + v_r <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pool_split_misconfigured');
  END IF;
  v_pool_cents := floor(v_bounty_cents * v_m / (v_m + v_r))::bigint;
  IF v_pool_cents > v_bounty_cents - v_paid_cents THEN
    v_pool_cents := GREATEST(0, v_bounty_cents - v_paid_cents);
  END IF;
  v_unit := public.fn_ca_tournament_unit_cents(p_tournament_id);
  v_pool_cents := public.fn_ca_unit_floor_cents(v_pool_cents, v_unit);
  IF v_pool_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_pool');
  END IF;

  SELECT COALESCE(sum((c->>'amount_cents')::bigint), 0) INTO v_sum
    FROM jsonb_array_elements(p_chests) c;
  v_chest_unit := GREATEST(100, v_unit);
  v_whole := (v_pool_cents / v_chest_unit) * v_chest_unit;
  IF v_sum <> v_pool_cents AND v_sum <> v_whole THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inventory_mismatch',
      'inventory_cents', v_sum, 'pool_cents', v_pool_cents);
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_chests) c
              WHERE (c->>'amount_cents')::bigint % v_unit <> 0
                 OR (c->>'amount_cents')::bigint <= 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'chest_not_on_unit', 'unit_cents', v_unit);
  END IF;

  -- Whole chips by largest remainder, exactly as the seed cuts them, so the
  -- ladder shown is the ladder the seed would have produced.
  v_norm := p_chests;
  IF v_whole >= v_chest_unit * jsonb_array_length(p_chests) THEN
    WITH c AS (
      SELECT e, ord, (e->>'amount_cents')::bigint AS amt
        FROM jsonb_array_elements(p_chests) WITH ORDINALITY AS t(e, ord)
    ), s AS (SELECT sum(amt) AS total FROM c),
    f AS (
      SELECT c.e, c.ord,
             (c.amt::numeric * v_whole / NULLIF(s.total, 0)) / v_chest_unit AS exact
        FROM c, s
    ), g AS (
      SELECT e, ord, floor(exact)::bigint AS base, exact - floor(exact) AS frac FROM f
    ), r AS (
      SELECT e, ord, base,
             row_number() OVER (ORDER BY frac DESC, ord) AS rk,
             (v_whole / v_chest_unit) - sum(base) OVER () AS spare
        FROM g
    )
    SELECT jsonb_agg(e || jsonb_build_object('amount_cents',
             (base + CASE WHEN rk <= spare THEN 1 ELSE 0 END) * v_chest_unit) ORDER BY ord)
      INTO v_norm FROM r;
    IF v_norm IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_norm) x
                WHERE (x->>'amount_cents')::bigint < v_chest_unit) THEN
      v_norm := p_chests;
    END IF;
  END IF;

  SELECT sum((x->>'amount_cents')::bigint) INTO v_sum FROM jsonb_array_elements(v_norm) x;

  INSERT INTO public.tournament_mystery_sealed_ladders
    (tournament_id, players_at_open, chest_count, pool_cents, chests)
  VALUES (p_tournament_id, p_players_at_open, jsonb_array_length(v_norm), v_sum, v_norm)
  ON CONFLICT (tournament_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'already_sealed', v_count = 0,
    'pool_cents', v_sum, 'chests', jsonb_array_length(v_norm));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_mystery_bounty_seal(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mystery_bounty_seal(uuid, integer, jsonb) TO service_role;

-- The lobby read: before the phase opens, list the sealed ladder.
CREATE OR REPLACE FUNCTION public.fn_mystery_bounty_inventory(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'pool_cents', CASE WHEN COALESCE(t.mystery_bounty_pool_cents, 0) = 0 AND s.pool_cents IS NOT NULL
                       THEN s.pool_cents
                       ELSE COALESCE(t.mystery_bounty_pool_cents, 0) END,
    'stage', t.mystery_bounty_stage,
    'profile', t.mystery_bounty_profile,
    'activation', t.mystery_bounty_activation,
    'activation_value', t.mystery_bounty_activation_value,
    'activated_players', t.mystery_bounty_activated_players,
    'activated_at', t.mystery_bounty_activated_at,
    'regular_pool_percent', t.mystery_bounty_regular_pool_percent,
    'sealed_at', s.sealed_at,
    'tiers', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.amount_cents DESC)
        FROM (
          SELECT c.tier,
                 c.amount_cents,
                 count(*)::int AS original,
                 count(*) FILTER (WHERE c.status IN ('reserved','revealed','paid'))::int AS awarded,
                 count(*) FILTER (WHERE c.status = 'available')::int AS remaining
            FROM public.tournament_bounty_chests c
           WHERE c.tournament_id = p_tournament_id
           GROUP BY c.tier, c.amount_cents
        ) x
    ), (
      SELECT jsonb_agg(row_to_json(y) ORDER BY y.amount_cents DESC)
        FROM (
          SELECT e->>'tier' AS tier,
                 (e->>'amount_cents')::bigint AS amount_cents,
                 count(*)::int AS original,
                 0 AS awarded,
                 count(*)::int AS remaining
            FROM jsonb_array_elements(s.chests) e
           GROUP BY 1, 2
        ) y
    ), '[]'::jsonb))
  FROM public.tournaments t
  LEFT JOIN public.tournament_mystery_sealed_ladders s
    ON s.tournament_id = t.id AND t.mystery_bounty_stage = 'pending'
 WHERE t.id = p_tournament_id;
$function$;

-- The seed: the ladder shown is the ladder opened.
DO $seed$
DECLARE
  sig constant regprocedure := 'public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure;
  d text;
  a0 constant text := E'  v_norm jsonb;\n';
  a1 constant text := E'  INSERT INTO public.tournament_bounty_chests (tournament_id, seq, tier, amount_cents)\n';
BEGIN
  d := pg_get_functiondef(sig);
  IF position('tournament_mystery_sealed_ladders' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a0, ''))) / length(a0) <> 1
     OR (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN
    RAISE EXCEPTION 'fn_mystery_bounty_seed changed shape; sealed ladder not installed';
  END IF;
  d := replace(d, a0, a0 || E'  v_sealed_chests jsonb;\n');
  d := replace(d, a1,
       E'  -- THE LADDER SHOWN IS THE LADDER OPENED (Dan 2026-11-13). The ladder sealed\n'
    || E'  -- when entry closed goes into play as it was shown, when the chest count\n'
    || E'  -- and the pool are still the ones it was cut for.\n'
    || E'  SELECT s.chests INTO v_sealed_chests\n'
    || E'    FROM public.tournament_mystery_sealed_ladders s\n'
    || E'   WHERE s.tournament_id = p_tournament_id\n'
    || E'     AND s.chest_count = jsonb_array_length(p_chests)\n'
    || E'     AND s.pool_cents = (SELECT sum((x->>''amount_cents'')::bigint)\n'
    || E'                           FROM jsonb_array_elements(v_norm) x);\n'
    || E'  IF v_sealed_chests IS NOT NULL THEN v_norm := v_sealed_chests; END IF;\n\n'
    || a1);
  EXECUTE d;
END
$seed$;

COMMIT;
