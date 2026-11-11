-- 20261111031027_the_stats_rollup_leaves_young_hands_to_the_live_projection
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11 03:10:27 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
--
-- THE STATS ROLL-UP LEAVES YOUNG HANDS TO THE LIVE PROJECTION (2026-11-11).
--
-- WHAT WAS WRONG. public.ca_roll_hand_stats_forward() runs from PostgREST at
-- :00, :15, :30 and :45. In one transaction (100 s deadline, up to 12 chunks
-- of 2,000 hands) it inserts ca_hand_player_stat rows for every hand_history
-- row with created_at in [rolled_ceil, now()), ON CONFLICT (user_id, hand_id)
-- DO NOTHING, prunes, and advances ca_hand_player_stat_state.rolled_ceil.
-- Because the window ran right up to now(), it inserted (still uncommitted)
-- rows for hands whose live post-commit projection
-- (fn_ca_process_hand_post_commit_obligations ->
-- fn_project_hand_side_effects_after_post_commit_20260908) had not run yet.
-- That projection inserts the same (user_id, hand_id) keys, so its
-- speculative insert waited on the roll-up's transaction until the roll-up
-- committed, and hit the 8 s statement timeout. The blocked post-commits then
-- held player_stats (user_id, club_id) rows that other tables' post-commits
-- upsert (promo_apply_playthrough), and the engine, which waits for the
-- previous hand's post-commit before dealing, started cash hands late.
--
-- Evidence (production Postgres logs): at 02:00Z on 2026-11-11 roll-up pid
-- 1339213 (xid 2987018802) ran 16.9 s; post-commit pids 1339217, 1339235,
-- 1342408 and 1339201 waited on xid 2987018802 inserting ca_hand_player_stat
-- and were cancelled by statement timeout at 02:00:16.88-16.97, with chained
-- player_stats waits behind them. Over 24 h, ShareLock-on-transaction waits in
-- relation ca_hand_player_stat occur ONLY at minutes 0/15/30/45, in nearly
-- every hour, up to 7.7 s, most never granted.
--
-- WHAT THIS CHANGES. Two lines. (1) The roll-up's upper bound is the earlier of
-- now() - interval '5 minutes' and the start of the oldest other open client
-- transaction in this database, instead of now(). (2) It skips a
-- player-hand that has a fact revision (see CORRECTIONS AND VOIDS). Every other byte of the
-- function is the live body (md5 07f9ad834d98b1944eecbab0439f63fb, read
-- 2026-11-11): the same advisory try-lock, FOR UPDATE on the state row,
-- chunking, ORDER BY, ON CONFLICT DO NOTHING, retention prune, proconfig,
-- owner, grants and SECURITY DEFINER. The preflight refuses any other body
-- or authority; the postflight proves the reverse substitution reproduces the
-- live md5 and that the authority is unchanged.
--
-- WHY NO HAND IS SKIPPED (a guarantee, not an observation). hand_history
-- rows take created_at from the column default now(), which is the inserting
-- transaction's start, the same instant pg_stat_activity reports as
-- xact_start (no writer names created_at: fn_ca_insert_hand_with_awards
-- inserts only the caller's columns and the engine row carries none). A row
-- the roll-up cannot yet see belongs to a transaction still open, whose
-- xact_start is >= the oldest open xact_start >= the bound, so its created_at
-- is never inside a window the roll-up closes; rolled_ceil only ever advances
-- to that bound. The old body (bound = now()) could skip such a row. The
-- 5 minutes only keeps the roll-up off keys the live projection is still
-- writing (a performance margin: projection lag p99.99 39.8 s, max 135 s);
-- correctness does not depend on it.
-- EXACTLY ONCE. ca_hand_player_stat_pkey is UNIQUE (user_id, hand_id) and all
-- three writers (live projection, hand trigger, roll-up) are INSERT ... ON
-- CONFLICT DO NOTHING, so whichever lands first is the only row. Diamond day
-- totals (projection 4b) are added once, by the projection, from whichever
-- row exists; the roll-up never touches them, before or after this change.
-- CORRECTIONS AND VOIDS (by control flow, not by their absence). A revision
-- (ca_append_hand_fact_revision: correction, refund, void) locks the
-- player-hand's ca_hand_facts row, which only ca_project_hand_stats_facts
-- writes, inside the live projection, in the same transaction as that
-- projection's stat rows; so the stat row it corrects already exists. A void
-- deletes that stat row. The roll-up recomputes from hand_history, which a
-- revision does not change, so the predecessor could re-insert a voided
-- player-hand (or, if a stat row were missing, an uncorrected one) whenever
-- it reached that hand after the void. This body skips every player-hand
-- that has a revision (index ca_hand_fact_revisions_hand_user_idx): the
-- revision path alone owns those rows. Second changed line; nothing else.
-- BACKFILLS. No writer names created_at (fn_ca_insert_hand_with_awards
-- inserts only the caller's columns; the engine row carries none). Every
-- hand_history insert is projected per hand, not per time: the AFTER INSERT
-- trigger trg_ca_stats_live_from_hand, or in the atomic commit an
-- unconditional hand_projection_outbox row in the same transaction. So a
-- hand with any created_at gets its stat rows from its own projection; the
-- roll-up is only the reconciler and never removes or overwrites a row.
-- The money repair (ca_repair_hand_player_stat_money) finished 2026-09-04.
-- TWO-PHASE COMMIT is off (max_prepared_transactions = 0), so every open
-- writer is visible in pg_stat_activity. A writer's xact_start is published
-- within StartTransaction, microseconds after its timestamp is taken; the
-- 5-minute term covers that interval. Retries open a new transaction with a
-- new start; rolled_ceil only moves forward (greatest()) under the single-
-- runner try-lock.
--
-- WHY THE INVARIANTS HOLD. rolled_ceil only advances to the end of what the
-- run covered, which is now never past now() - 5 minutes, so a hand younger
-- than that is simply covered by a later run: nothing is skipped. When the
-- stored rolled_ceil is already ahead of the new bound (it was last set by the
-- old body, up to 15 minutes ago), the existing guard returns 0 without
-- touching anything until the bound passes it; those hands were already
-- rolled, and rolled_ceil never moves backwards (greatest()). The roll-up
-- remains the reconciler for any hand whose projection did not land; it
-- simply no longer races a projection that is still in flight. It also stops
-- the latent skip of a hand_history row inserted before the run started but
-- committed after the run read the window (commit trails created_at by at
-- most 8 s, measured below).
--
-- THE MARGIN, MEASURED READ-ONLY 2026-11-11 (hand_atomic_commits joined to
-- hand_history). Live projection completion (post_commit_completed_at)
-- relative to hand_history.created_at over the last 24 h, 197,365 hands:
-- p50 0.42 s, p99 7.3 s, p99.9 17.9 s, p99.99 39.8 s, max 72.4 s, none over
-- 5 minutes. Completion relative to commit by day, 2026-11-08 to 2026-11-11,
-- 1,656,135 hands: max 135.2 s, 92 over 60 s, none over 5 minutes; commit
-- trails created_at by at most 8.0 s. Five minutes is over twice the worst
-- observed lag, and a projection still pending after 10 minutes is already
-- an alert (fn_post_commit_stranded_watchdog). The only cost is that a hand
-- whose projection failed is reconciled up to 20 minutes after it was played
-- instead of up to 15.
--
-- Function body only: no table is locked, no row is read or written, no hot
-- relation is touched, so this is an ordinary install, not a window file.
-- Native proof: scripts/ci/test-stats-rollup-lag.py (PostgreSQL 17).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.ca_roll_hand_stats_forward()');
  v_def text;
  v_old text := $f$  v_now timestamptz := now();
$f$;
  v_new text := $f$  v_now timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
$f$;
  v_old2 text := $f$    FROM public.ca_hand_player_facts(v_ceil, v_end) f
    ORDER BY f.user_id, f.hand_id
$f$;
  v_new2 text := $f$    FROM public.ca_hand_player_facts(v_ceil, v_end) f
    WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = f.hand_id AND r.user_id = f.user_id)
    ORDER BY f.user_id, f.hand_id
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'ca_roll_hand_stats_forward() is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) <> '07f9ad834d98b1944eecbab0439f63fb'
     AND md5(replace(replace(v_def, v_new, v_old), v_new2, v_old2)) <> '07f9ad834d98b1944eecbab0439f63fb' THEN
    RAISE EXCEPTION 'ca_roll_hand_stats_forward is not the pinned text (md5 %)', md5(v_def);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{search_path=public,statement_timeout=4min}') THEN
    RAISE EXCEPTION 'ca_roll_hand_stats_forward authority changed';
  END IF;
END $m$;

CREATE OR REPLACE FUNCTION public.ca_roll_hand_stats_forward()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '4min'
AS $function$
DECLARE
  v_ceil timestamptz;
  v_start timestamptz;
  v_now timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
  v_deadline timestamptz := clock_timestamp() + interval '100 seconds';
  v_last_hand_at timestamptz;
  v_end timestamptz;
  v_hands int;
  v_total int := 0;
  v_over uuid[];
  v_chunk constant int := 2000;
  v_max_chunks constant int := 12;
  v_i int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ca_hand_player_stat_background')) THEN
    RETURN 0;
  END IF;

  SELECT rolled_ceil INTO v_ceil
  FROM public.ca_hand_player_stat_state
  WHERE id
  FOR UPDATE;

  IF v_ceil IS NULL OR v_ceil >= v_now THEN RETURN 0; END IF;
  v_start := v_ceil;

  WHILE v_i < v_max_chunks AND clock_timestamp() < v_deadline AND v_ceil < v_now LOOP
    v_i := v_i + 1;

    SELECT max(created_at) INTO v_last_hand_at
    FROM (
      SELECT created_at
      FROM public.hand_history
      WHERE created_at >= v_ceil AND created_at < v_now
      ORDER BY created_at, id
      LIMIT v_chunk
    ) bounded;

    IF v_last_hand_at IS NULL THEN
      v_ceil := v_now;
      EXIT;
    END IF;

    v_end := least(v_now, v_last_hand_at + interval '1 microsecond');

    SELECT count(*) INTO v_hands
    FROM public.hand_history
    WHERE created_at >= v_ceil AND created_at < v_end;

    INSERT INTO public.ca_hand_player_stat (
      user_id, hand_id, created_at, is_cash, tournament_id, game_variant,
      big_blind, small_blind, n_players, seat_position, my_blind, won_amt, is_winner,
      invested_actions, aggro_cnt, call_cnt, vpip, pfr, folded, three_bet,
      three_bet_opp, faced_three_bet, folded_to_three_bet, cbet_opp, cbet_made,
      showdown, hand_secs, profit)
    SELECT
      f.user_id, f.hand_id, f.created_at, f.is_cash, f.tournament_id, f.game_variant,
      f.big_blind, f.small_blind, f.n_players, f.seat_position, f.my_blind, f.won_amt, f.is_winner,
      f.invested_actions, f.aggro_cnt, f.call_cnt, f.vpip, f.pfr, f.folded, f.three_bet,
      f.three_bet_opp, f.faced_three_bet, f.folded_to_three_bet, f.cbet_opp, f.cbet_made,
      f.showdown, f.hand_secs, f.profit
    FROM public.ca_hand_player_facts(v_ceil, v_end) f
    WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = f.hand_id AND r.user_id = f.user_id)
    ORDER BY f.user_id, f.hand_id
    ON CONFLICT (user_id, hand_id) DO NOTHING;

    v_total := v_total + coalesce(v_hands, 0);
    v_ceil := v_end;
  END LOOP;

  -- Retention (1,000 rows per player), for every player with a row in the
  -- window this run covered, whoever wrote it.
  SELECT array_agg(user_id) INTO v_over
  FROM (
    SELECT user_id
    FROM public.ca_hand_player_stat
    WHERE user_id IN (SELECT DISTINCT user_id FROM public.ca_hand_player_stat
                      WHERE created_at >= v_start AND created_at < v_ceil)
    GROUP BY user_id
    HAVING count(*) > 1000
  ) o;

  IF v_over IS NOT NULL THEN
    DELETE FROM public.ca_hand_player_stat s
    USING (
      SELECT user_id, hand_id,
             row_number() OVER (PARTITION BY user_id, asset ORDER BY created_at DESC) AS rn
      FROM public.ca_hand_player_stat
      WHERE user_id = ANY(v_over)
    ) r
    WHERE r.rn > 1000 AND s.user_id = r.user_id AND s.hand_id = r.hand_id;
  END IF;

  UPDATE public.ca_hand_player_stat_state
  SET rolled_ceil = greatest(coalesce(rolled_ceil, v_ceil), v_ceil), updated_at = now()
  WHERE id;

  RETURN v_total;
END;
$function$;

-- Restated, unchanged: CREATE OR REPLACE keeps the existing grants, and the
-- postflight below proves the ACL is exactly what it was.
REVOKE ALL ON FUNCTION public.ca_roll_hand_stats_forward() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ca_roll_hand_stats_forward() TO service_role;

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.ca_roll_hand_stats_forward()');
  v_def text := pg_get_functiondef(to_regprocedure('public.ca_roll_hand_stats_forward()'));
  v_old text := $f$  v_now timestamptz := now();
$f$;
  v_new text := $f$  v_now timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
$f$;
  v_old2 text := $f$    FROM public.ca_hand_player_facts(v_ceil, v_end) f
    ORDER BY f.user_id, f.hand_id
$f$;
  v_new2 text := $f$    FROM public.ca_hand_player_facts(v_ceil, v_end) f
    WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = f.hand_id AND r.user_id = f.user_id)
    ORDER BY f.user_id, f.hand_id
$f$;
BEGIN
  IF (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1
     OR position(v_old IN v_def) <> 0
     OR (length(v_def) - length(replace(v_def, v_new2, ''))) / length(v_new2) <> 1
     OR position(v_old2 IN v_def) <> 0 THEN
    RAISE EXCEPTION 'ca_roll_hand_stats_forward: the change is not exactly the two new lines';
  END IF;
  IF md5(replace(replace(v_def, v_new, v_old), v_new2, v_old2)) <> '07f9ad834d98b1944eecbab0439f63fb' THEN
    RAISE EXCEPTION 'ca_roll_hand_stats_forward: the reverse substitution does not reproduce the pinned text';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{search_path=public,statement_timeout=4min}') THEN
    RAISE EXCEPTION 'ca_roll_hand_stats_forward authority changed';
  END IF;
END $m$;

COMMIT;
