-- @live-proof: position('THIN POOL (20261110)' in pg_get_functiondef('public.fn_lightning_formation_sizes(integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0
-- @live-proof: position('THIN POOL (20261110)' in pg_get_functiondef('public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure)) > 0 AND position('interval ''1.5 seconds'', v_now)' in pg_get_functiondef('public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure)) > 0
-- @live-proof: position('GREATEST(4, LEAST(6' in pg_get_functiondef('public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)'::regprocedure)) > 0
-- @live-proof: position('NOT BETWEEN 4 AND 6' in pg_get_functiondef('public.fn_lightning_instance_begin_dealing(uuid,interval,timestamp with time zone)'::regprocedure)) > 0
-- 20261110214134_lightning_a_thin_pool_deals_four_handed.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against origin/main
-- and every remote branch, so it cannot collide with another agent's work.
--
-- WHAT THIS CHANGES, AND WHY (owner, Dan, 2026-11-10 15:31 Chicago, building
-- the follow-ups he approved, item 4: "form tables sooner when the pool is
-- thin").
--
-- THE RULE AS IT WAS (20261023230001, 20261026131624): six ready players deal
-- at once; exactly five deal after one second counted from the fifth (latest)
-- arrival; fewer than five never deal.
--
-- MEASURED (production, read only, 2026-11-09 15:00Z to 2026-11-10 21:30Z,
-- every player of the hands formed in minutes 0, 15, 30 and 45 of each hour;
-- waited_ms is pool entry to formation). The wait follows the pool's size:
--   hours with 80 to 88 players seen    p50 0.38-0.45 s  p90 1.2-1.5 s  p99 1.9-3.3 s  over 3 s 0.15-1.2%
--   hours with 40 to 54 players seen    p50 0.63-1.09 s  p90 1.6-2.9 s  p99 5.0-10.4 s over 3 s 2.2-8.8%
-- (hours 06-09Z and 14-16Z were the tournament settlement lock storm, fixed by
-- 20261110160345, and are not the pool's doing). Five-handed hands are 0-5% of
-- hands. A player's time in a hand (formation to release, 7,825 player-hands,
-- 17:30Z-21:30Z): p10 2.7 s, p50 3.4 s, p70 7.2 s, p80 13.0 s, p90 28.8 s,
-- p99 68.4 s - so a free player waits on other players' hands, and a thin pool
-- often has four free players waiting for a fifth.
--
-- SIMULATED (that distribution, one Cluster, pass every 250 ms; production's
-- thin hours match the 20-25 rows):
--   pool   rule now: p90 / p99 / over 3 s     four-handed after 1.5 s       four-handed share
--    12       5.30 / 11.40 s / 28.9%          4.40 /  9.20 s / 23.1%             24%
--    16       3.80 /  7.92 s / 21.6%          3.61 /  5.84 s / 18.3%             12%
--    20       3.39 /  5.35 s / 17.1%          3.25 /  4.86 s / 14.1%              9%
--    25       2.93 /  4.04 s /  9.0%          2.81 /  3.87 s /  7.6%              5%
--    40       1.78 /  2.82 s /  0.6%          1.79 /  2.76 s /  0.5%            0.5%
--
-- THE RULE NOW. Six ready deal at once and five after one second, as before.
-- NEW: four ready players deal four-handed when (a) the fourth (latest) of
-- them has waited 1.5 seconds with no fifth, and (b) the Cluster's whole pool
-- (every open-pool player fn_lightning_player_legality lists, free or still in
-- a hand) is at most 24. Never fewer than four. A healthy pool keeps six as
-- the target, so short tables cannot fragment it; a thin one stops leaving
-- four ready players idle. The 1.5 s from the latest arrival also covers the
-- player about to free up: a fifth who arrives inside it makes a five-handed
-- table instead.
--   - fn_lightning_formation_sizes: n % 6 = 4 aged 1.5 s gives a 4 (the pure
--     sizing; it does not know the pool's size).
--   - fn_lightning_match_plan: potential sizes assume every wait served
--     (now - 1.5 s rather than now - 1 s), drop the 4 when the pool is above
--     24, and a selected four-handed group whose latest arrival is inside
--     1.5 s is not formed this pass (the five-handed group's own test,
--     unchanged, keeps its one second). New players are always the big
--     blind first (20261024195059): the hold that keeps a newcomer for the
--     next pass's big blind is decided without the four-handed size, so a
--     four never holds a newcomer out of a five or six (the newcomer posts
--     an entry big blind, 20261025050528, exactly as before), and a pass
--     that holds a newcomer deals no four-handed table.
--   - fn_lightning_form_hand: a direct caller may ask for four, and obeys the
--     same 1.5 s from the latest arrival (WAITING_FOR_FIFTH_PLAYER).
--   - fn_lightning_instance_begin_dealing: a four-player instance deals
--     (4 to 6 dealt, reserved and committed, instead of 5 to 6).
-- Seat positions and blinds already scale to any table from two to nine
-- (fn_lightning_form_hand: btn, sb, bb and co at four), and the position
-- fairness rule (20261110173033) orders the same seats at four as at five
-- and six. lightning_hand.player_count already admits 2 to 9.
-- The engine's model (LightningMatcherModel lightningPassSizes and the group
-- test, LIGHTNING_FOUR_HANDED_WAIT_MS / _POOL_MAX) and the worker's deadline
-- pass (LightningClusterWorker) move in the same pull request; they reach
-- production at the daily 04:00 America/Chicago engine release. Until then
-- the database decides (it forms every hand) and the worker's routine pass
-- interval serves the 1.5 s.
--
-- ORDER WITH 20261110173033 (position fairness, queued for the 03:30 window).
-- The two files edit different text: every anchor below is absent from that
-- file's anchors and replacements, and each of its anchors is absent from
-- these, so either may install first and both find their text exactly once
-- (checked read-only against production's current images before merge, and
-- in the matcher parity harness, which installs that file and then this one).
-- This file takes no table lock (CREATE OR REPLACE of four functions), so it
-- is an ordinary migration, installed on merge.
--
-- Each function is patched in place from its installed image by exact anchor
-- (the house pattern of 20261026131624): every anchor must occur exactly the
-- expected number of times or the transaction aborts, so an unknown edit is
-- never overwritten. CREATE OR REPLACE keeps owners, grants and security.
-- Horses are players (CLAUDE.md 10.5): nothing here reads a horse marker. No
-- money, seat or ledger row is written. Not a repair job.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $thin_pool$
DECLARE
  r record;
  s text;
  n text;
  k integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    (1, 'public.fn_lightning_formation_sizes(integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)',
     $a$ END IF;
 RETURN result;$a$,
     $a$ -- THIN POOL (20261110): four ready players whose latest arrival has
 -- waited 1.5 seconds for a fifth; never fewer than four. Whether the pool is
 -- thin enough is the matcher's test (fn_lightning_match_plan).
 ELSIF n%6=4 AND p_oldest_idle IS NOT NULL AND p_now-p_oldest_idle>=interval '1.5 seconds' THEN
  result:=array_append(result,4);
 END IF;
 RETURN result;$a$),
    (2, 'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)',
     $a$  v_sizes := public.fn_lightning_formation_sizes(cardinality(v_seatable), v_min, v_target, v_max, v_now - interval '1 second', v_now);$a$,
     $a$  v_sizes := public.fn_lightning_formation_sizes(cardinality(v_seatable), v_min, v_target, v_max, v_now - interval '1.5 seconds', v_now);
  -- THIN POOL (20261110): four-handed only while the whole pool is at most 24.
  IF jsonb_array_length(v_rows) > 24 THEN v_sizes := array_remove(v_sizes, 4); END IF;$a$),
    (3, 'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)',
     $a$    v_sizes2 := public.fn_lightning_formation_sizes(cardinality(v_next), v_min, v_target, v_max, v_now - interval '1 second', v_now);$a$,
     $a$    v_sizes2 := public.fn_lightning_formation_sizes(cardinality(v_next), v_min, v_target, v_max, v_now - interval '1.5 seconds', v_now);
    -- THIN POOL (20261110): a hold is decided without the four-handed size.
    -- Holding a newcomer must still leave a five or six, or it is not taken
    -- (the newcomer posts an entry big blind instead), and a pass that holds
    -- a newcomer deals no four-handed table.
    v_sizes2 := array_remove(v_sizes2, 4);$a$),
    (4, 'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)',
     $a$      CONTINUE;
    END IF;
    FOR v_seat_no IN REVERSE v_size .. 3 LOOP$a$,
     $a$      CONTINUE;
    END IF;
    -- THIN POOL (20261110): a four-handed group deals once its latest
    -- arrival has waited 1.5 seconds for a fifth.
    IF v_size = 4 AND (SELECT max((v_info -> m::text ->> 'idle_since')::timestamptz)
                       FROM unnest(v_members) m) > v_now - interval '1.5 seconds' THEN
      CONTINUE;
    END IF;
    FOR v_seat_no IN REVERSE v_size .. 3 LOOP$a$),
    (5, 'public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)',
     $a$  v_target := GREATEST(5, LEAST(6, coalesce(p_target_size, 6)))::smallint;$a$,
     $a$  v_target := GREATEST(4, LEAST(6, coalesce(p_target_size, 6)))::smallint;$a$),
    (6, 'public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)',
     $a$    RETURN jsonb_build_object('ok',false,'formed',false,'reason','WAITING_FOR_SIXTH_PLAYER');
  END IF;$a$,
     $a$    RETURN jsonb_build_object('ok',false,'formed',false,'reason','WAITING_FOR_SIXTH_PLAYER');
  END IF;
  -- THIN POOL (20261110): a direct caller asking for four obeys the matcher's
  -- 1.5 seconds from the latest arrival.
  IF v_n = 4 AND v_target = 4 AND coalesce((
    SELECT max(sl.idle_since) FROM public.lightning_pool_slot sl
     WHERE sl.cluster_id=g.id AND sl.id IN (SELECT (x->>'pool_slot_id')::uuid FROM jsonb_array_elements(v_pool) x) AND sl.closed_at IS NULL
  ), coalesce(p_now,clock_timestamp())) > coalesce(p_now,clock_timestamp()) - interval '1.5 seconds' THEN
    RETURN jsonb_build_object('ok',false,'formed',false,'reason','WAITING_FOR_FIFTH_PLAYER');
  END IF;$a$),
    (7, 'public.fn_lightning_instance_begin_dealing(uuid,interval,timestamp with time zone)',
     $a$IF h.player_count NOT BETWEEN 5 AND 6 OR v_players NOT BETWEEN 5 AND 6
     OR v_committed NOT BETWEEN 5 AND 6 THEN$a$,
     $a$IF h.player_count NOT BETWEEN 4 AND 6 OR v_players NOT BETWEEN 4 AND 6
     OR v_committed NOT BETWEEN 4 AND 6 THEN$a$)
  ) x(ord, sig, old_text, new_text) ORDER BY ord LOOP
    s := pg_get_functiondef(r.sig::regprocedure);
    k := (length(s) - length(replace(s, r.old_text, ''))) / length(r.old_text);
    IF k IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Lightning thin-pool anchor % found % times in %; requalify before installing',
        r.ord, k, r.sig;
    END IF;
    n := replace(s, r.old_text, r.new_text);
    IF n = s THEN
      RAISE EXCEPTION 'Lightning thin-pool anchor % did not change %', r.ord, r.sig;
    END IF;
    EXECUTE n;
  END LOOP;
END
$thin_pool$;

COMMIT;
