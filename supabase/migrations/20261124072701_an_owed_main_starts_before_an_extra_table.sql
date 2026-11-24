-- 20261124072701_an_owed_main_starts_before_an_extra_table.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- AN OWED MAIN STARTS BEFORE AN EXTRA TABLE (2026-11-24)
--
-- WHAT WAS WRONG (production, read-only, 2026-11-24 06:30Z)
--
-- Short Deck, Pineapple, FLO8 and PLO8 cash (and NLH .05/.10, .10/.25, .50/1,
-- PLO4 .50/1 and 1/2, PLO6 1/2 and most FLH stakes) dealt no hand from their
-- normal nightly close on 2026-11-23 (08:43-08:49Z) onwards. Every one of them
-- is a plan game (horseUnionCashPlan.json, window "always"), enabled, with an
-- empty Main 1 waiting. The hourly cap (25) was full: ten games held 33-41
-- tables between them, four tables each for the deepest.
--
-- Since #11773 (owner ruling 2026-11-22, "a full game always has a waiting
-- list, or one chair open") every full game carries Horse waiters. The cluster
-- tick (fn_cash_cluster_tick_uncapped, every 5 s) opens a feeder for such a
-- game whenever fn_cash_hourly_feeder_admissible(game) sees census + opening
-- feeders < cap. That question had no notion of a plan game with no table, and
-- the tick asks it every five seconds while the Horse fleet walks every thirty,
-- so every slot that freed became a waiting-list feeder, then Main 2 or 3, and
-- never came back. The 2026-11-18 rule "a plan game with no table starts before
-- another game's extra table" (#11346, HorseVarietyFirst) lived only in the
-- fleet, and only in a cycle whose cap already admitted an owed start, so at a
-- full cap it never acted.
--
-- THE CHANGE
--
-- fn_cash_hourly_feeder_admissible keeps every question it asked and adds one:
-- an extra table opens only if, after it, every owed start still fits under
-- the cap:
--
--     census + empty opening feeders + owed starts < table_cap
--
-- An OWED START is a game the Horse fleet's newest heartbeat (at most 90 s old,
-- VARIETY_HOLD_FRESH_MS) lists in detail.variety_owed_games, that is not this
-- game, is enabled, and still has no occupied table. The fleet lists exactly
-- the games HorseVarietyFirst holds extra tables for in that cycle: a plan or
-- seeded Lightning game with no occupied table, a table Horses may start now
-- (schedule window, switches, legality) and not resting after a start it could
-- not make; a withheld cycle lists none. So the database and the fleet hold on
-- one list, and a fleet that has stopped publishing holds nothing (no owed
-- start can be made without it). With no owed start the question is exactly
-- the one before this file (the #11773 waiting-list feeder still opens).
--
-- Unchanged: the waiting list itself (#11773), the cap and its hourly ranges,
-- the floor clock, a person on the line (never gated), every other tick branch.
-- Only the extra table waits; the game it belongs to keeps playing and keeps
-- its list.
--
-- Install order: safe either way. Before the engine of the same pull request
-- serves, no heartbeat carries variety_owed_games, so the count is zero and the
-- function answers exactly as now.
--
-- Proof: scripts/ci/test-an-owed-main-starts-before-an-extra-table-postgres.py
-- (red on the installed body, green after this file).
-- Laws: tests/an-owed-main-starts-before-an-extra-table.law.test.ts,
--       server/src/services/aPlanGameWithNoTableStartsFirst.test.ts.
-- Changelog: docs/changelog/2026-11-24-an-owed-main-starts-before-an-extra-table.md.
--
-- Rows written by this file: none. Function only; no hot-table lock.
--
-- @live-proof: (position('AN OWED MAIN STARTS BEFORE AN EXTRA TABLE' in pg_get_functiondef('public.fn_cash_hourly_feeder_admissible(uuid)'::regprocedure)) > 0 AND position('variety_owed_games' in pg_get_functiondef('public.fn_cash_hourly_feeder_admissible(uuid)'::regprocedure)) > 0)
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The installed body is 20261121174545's, byte for byte. Any drift aborts.
DO $preimage$
BEGIN
  IF to_regprocedure('public.fn_cash_hourly_feeder_admissible(uuid)') IS NULL
     OR md5(pg_get_functiondef('public.fn_cash_hourly_feeder_admissible(uuid)'::regprocedure))
        IS DISTINCT FROM 'a7f507e81cdf5e6005ae94405481a8e6' THEN
    RAISE EXCEPTION 'owed_main_preimage_changed:public.fn_cash_hourly_feeder_admissible(uuid) (md5 %)',
      md5(pg_get_functiondef(to_regprocedure('public.fn_cash_hourly_feeder_admissible(uuid)')))
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.ca_horse_fleet_heartbeat') IS NULL
     OR (SELECT count(*) FROM pg_attribute
          WHERE attrelid = 'public.ca_horse_fleet_heartbeat'::regclass AND NOT attisdropped
            AND ((attname = 'beat_at' AND atttypid = 'timestamptz'::regtype)
              OR (attname = 'detail' AND atttypid = 'jsonb'::regtype))) <> 2 THEN
    RAISE EXCEPTION 'owed_main_preimage_changed:ca_horse_fleet_heartbeat(beat_at timestamptz, detail jsonb)'
      USING ERRCODE = '55000';
  END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_feeder_admissible(p_game uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $f$
  -- THE SAME QUESTION AS THE ADMISSION (fn_cash_hourly_table_admissions, the
  -- f.table_id IS NULL branch), plus empty active 'opening' cash feeders so
  -- concurrent cluster ticks cannot open more feeders than remaining hourly
  -- cap slots. A person on the line is never gated by the hourly policy.
  --
  -- AN OWED MAIN STARTS BEFORE AN EXTRA TABLE (20261124072701). Every game
  -- that calls this already holds a table; its feeder is an EXTRA table. It
  -- opens only if every owed start still fits under the cap after it: a game
  -- the fleet's newest heartbeat (90 s at most) lists as owed a start
  -- (HorseVarietyFirst), other than this one, enabled, and still with no
  -- occupied table. No fresh heartbeat, no owed start: the question is the
  -- one it was before.
  WITH beat AS (
    SELECT h.detail -> 'variety_owed_games' AS owed
      FROM public.ca_horse_fleet_heartbeat h
     WHERE h.beat_at > clock_timestamp() - interval '90 seconds'
     ORDER BY h.beat_at DESC
     LIMIT 1
  ),
  owed AS (
    SELECT count(*) AS n
      FROM public.cash_games cg
     WHERE cg.id <> p_game
       AND coalesce(cg.enabled, false)
       AND cg.id::text IN (
         SELECT jsonb_array_elements_text(b.owed) FROM beat b WHERE jsonb_typeof(b.owed) = 'array')
       AND NOT EXISTS (
         SELECT 1 FROM public.tables tb
           JOIN public.table_seats ts ON ts.table_id = tb.id AND ts.left_at IS NULL
          WHERE tb.cluster_id = cg.id
            AND coalesce(tb.is_deleted, false) = false
            AND coalesce(tb.lifecycle, '') <> 'closed')
  )
  SELECT NOT public.fn_cash_hourly_table_enabled()
      OR (
        (
          (SELECT count(*) FROM public.fn_cash_hourly_table_capacity_census())
          + (SELECT count(*) FROM public.tables tb
              WHERE tb.cluster_id IS NOT NULL
                AND tb.role = 'feeder'
                AND tb.lifecycle = 'opening'
                AND tb.status IN ('waiting', 'running', 'active')
                AND coalesce(tb.is_deleted, false) = false
                AND tb.tournament_id IS NULL
                AND NOT coalesce(tb.is_spins, false)
                AND NOT EXISTS (
                  SELECT 1 FROM public.table_seats ts
                   WHERE ts.table_id = tb.id AND ts.left_at IS NULL
                ))
          + (SELECT o.n FROM owed o)
        ) < (SELECT r.table_cap FROM public.fn_cash_hourly_table_range() r)
        AND NOT EXISTS (SELECT 1 FROM public.cash_hourly_table_pacing p
                         WHERE p.scope = 'floor' AND p.next_open_at > clock_timestamp())
      )
      OR EXISTS (SELECT 1 FROM public.cash_game_waitlist w
                   JOIN public.profiles pr ON pr.id = w.user_id
                  WHERE w.game_id = p_game AND w.status IN ('waiting', 'notified')
                    AND NOT coalesce(pr.is_horse, false));
$f$;

REVOKE ALL ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) TO service_role;

DO $verify$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = 'public.fn_cash_hourly_feeder_admissible(uuid)'::regprocedure
          AND p.prosecdef
          AND p.provolatile = 's'
          AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
          AND pg_get_userbyid(p.proowner) = 'postgres'
          AND position('AN OWED MAIN STARTS BEFORE AN EXTRA TABLE' IN pg_get_functiondef(p.oid)) > 0)
     OR has_function_privilege('anon', 'public.fn_cash_hourly_feeder_admissible(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_cash_hourly_feeder_admissible(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_cash_hourly_feeder_admissible(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_cash_hourly_feeder_admissible did not install with its marker, definer, search_path, owner and grants';
  END IF;
END $verify$;

-- @probe-for: public.fn_cash_hourly_feeder_admissible
DO $probe$
BEGIN
  PERFORM public.fn_cash_hourly_feeder_admissible(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
