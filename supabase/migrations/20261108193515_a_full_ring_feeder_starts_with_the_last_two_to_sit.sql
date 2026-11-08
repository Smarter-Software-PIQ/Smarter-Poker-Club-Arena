-- 20261108193515_a_full_ring_feeder_starts_with_the_last_two_to_sit.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-08 13:10 CST, verbatim: "PLAYERS WILL JOIN A WAITING LIST. FOR
-- 9 HANDED GAMES, ONCE 4 OR MORE PLAYERS ARE ON THE WAITING LIST, IT WILL
-- REMOVE THE LAST TWO PLAYERS TO SIT IN THE FULL GAME AND MOVE THEM TO THE
-- 'FEEDER GAME'. THEN THE 2ND TABLE STARTS. THOSE 2 PLAYERS ARE 'FIRST TO
-- MOVE' AND WILL MOVE OVER ANYTIME ANOTHER PLAYER FROM THE MAIN GAME, LEAVES OR
-- BUSTS, IF A NEW PLAYER JOINS THE FEEDER GAME, THE MAIN GAME DOESN'T GET A NEW
-- PLAYER UNTIL THE FEEDER GAME HAS 7 PLAYERS. THEN FIRST ON THE LIST MOVES. IF
-- ITS A 6 MAX GAME, 'FEEDER GAME' GAME STARTS HEADS UP."
--
-- Asked the same day, he settled the three open points:
--   * The two chairs the bump empties on Main STAY EMPTY until the feeder has
--     7 players; then the first on the must-move list moves (the two bumped
--     players first). A Main player who leaves or busts out is replaced right
--     away by a bumped player.
--   * 6-max: nobody is moved off Main; two people on the list start the feeder
--     heads up - exactly how it works today. 6-max is UNCHANGED by this file.
--   * 6-max move-up: any open Main seat, first on the list - also unchanged.
--
-- So this file changes FULL-RING games only (handedness 7 to 9; the gate is
-- handedness - 2, which is 7 for nine-handed). Four pieces, one transaction:
--
-- 1. public.cash_cluster_feeder_starts - one row per game while a feeder start
--    is in force: Main 1, the new feeder, how many Main chairs are still HELD
--    (0..2), the two bumped players ("first to move") and their bump moves.
--    No foreign key to a hot table (CLAUDE.md section 2 rule 7); service-only.
--
-- 2. A HELD CHAIR IS A RESERVED CHAIR, EVERYWHERE THE PLATFORM COUNTS ONE.
--    fn_cash_cluster_census adds `held` to Main 1's `reserved`, so must-move,
--    seat changes, the list offer and the break arithmetic all see it as taken.
--    fn_cash_game_open_seats subtracts it, so the Join Game door, the lobby and
--    fn_offer_open_seat never hand it out. atomic_table_buyin's gate counts it
--    with the waitlist holds, so a direct buy-in (a person tapping the empty
--    chair, or a horse) is refused SEAT_RESERVED exactly like any held chair -
--    a refusal only, no money path is touched, and horses treat SEAT_RESERVED
--    as an ordinary race (HorseFleetManager does not report it). The seat move
--    executor checks only physical chairs, so the planned moves below land.
--    And one definition, fn_cash_main_chair_is_the_lists: while a full-ring
--    game has a live or opening feeder, an open chair on any of its Mains
--    belongs to the must-move list. fn_cash_game_open_seats returns 0 for it
--    (so the Join Game door seats a newcomer at the feeder and the list offer
--    never calls a name to a Main) and the buy-in gate refuses it, unless the
--    buyer holds a live offer for that very table. Only must-move fills it.
--
-- 3. fn_cash_cluster_tick, full ring only:
--    a. OPEN: a second table needs FOUR on the game list (people and horses
--       alike, CLAUDE.md 10.5; eligible-but-unqueued horses no longer count for
--       full ring). With Main 1 the only table, the feeder opens and the two
--       players who sat at Main 1 most recently (by arrival at that table - a
--       moved player's arrival is the move, not their original buy-in) get a
--       'balance' move to it ("Balancing The Tables. Moving To The Feeder
--       Table After This Hand."), and their two chairs are HELD. The list then
--       fills the feeder one name at a time through the existing offer step.
--       With a feeder already running, a third table still needs four waiting
--       and opens the ordinary way, with no bump.
--    b. RELEASE: once the feeder has `handedness - 2` players (not counting
--       ones already on their way out), ONE held chair is released per tick,
--       and must-move gives it to the first on the list.
--    c. MUST-MOVE: the two bumped players are FIRST on the list, and they may
--       always take a Main chair that genuinely opens (a leave or a bust-out).
--       Anyone else on the feeder moves up only while the feeder has
--       `handedness - 2` players. A breaking table is never gated.
--    d. A feeder start ends (its held chairs are released) when its Main or its
--       feeder stops being live, when the live feeder is down to one player
--       with nobody waiting or on their way, or when nothing is held and no
--       bumped player is still on the feeder. A bump move that never landed
--       gives its chair back the same tick.
--
-- Nothing else changes: Classic and Lightning rules, breaking, promotion, the
-- second-table pick by Chicago hour, holds, seat changes and every money path.
-- The engine needs no change; this installs on merge.
--
-- @live-proof: (to_regclass('public.cash_cluster_feeder_starts') IS NOT NULL AND position('FULL-RING FEEDER START' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0 AND position('cash_cluster_feeder_starts' in pg_get_functiondef('public.fn_cash_game_open_seats(uuid)'::regprocedure)) > 0 AND to_regprocedure('public.fn_cash_main_chair_is_the_lists(uuid)') IS NOT NULL AND position('cash_cluster_feeder_starts' in pg_get_functiondef('public.fn_cash_cluster_census(uuid,timestamp with time zone)'::regprocedure)) > 0 AND position('cash_cluster_feeder_starts' in pg_get_functiondef('public.atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)'::regprocedure)) > 0)
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- ── 1. The feeder start in force, per game ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_cluster_feeder_starts (
  game_id         uuid PRIMARY KEY,
  main_table_id   uuid NOT NULL UNIQUE,
  feeder_table_id uuid NOT NULL,
  held            integer NOT NULL CHECK (held BETWEEN 0 AND 2),
  first_to_move   uuid[] NOT NULL DEFAULT '{}'::uuid[],
  bump_move_ids   uuid[] NOT NULL DEFAULT '{}'::uuid[],
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cash_cluster_feeder_starts IS
  'Full-ring must-move feeder starts (Dan 2026-11-08): Main 1 chairs held after the last two to sit were moved to a new feeder, and those two first-to-move players. Written only by fn_cash_cluster_tick.';
ALTER TABLE public.cash_cluster_feeder_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_cluster_feeder_starts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cash_cluster_feeder_starts TO service_role;

-- ONE DEFINITION: while a full-ring game has a feeder, an open chair on any of
-- its Mains belongs to the must-move list (Dan 2026-11-08: "IF A NEW PLAYER
-- JOINS THE FEEDER GAME, THE MAIN GAME DOESN'T GET A NEW PLAYER UNTIL THE
-- FEEDER GAME HAS 7 PLAYERS"). A newcomer, a list offer, a horse or a tap on
-- an empty chair goes to the feeder; only fn_cash_cluster_tick's must-move
-- gives a Main a player. A breaking feeder does not count, so a closing table
-- never strands its players.
CREATE OR REPLACE FUNCTION public.fn_cash_main_chair_is_the_lists(p_table_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.tables mt
      JOIN public.cash_games cg ON cg.id = mt.cluster_id
     WHERE mt.id = p_table_id
       AND mt.role = 'main'
       AND coalesce(cg.handedness, 9) >= 7
       AND cg.must_move
       AND cg.cluster_mode = 'must_move'
       AND NOT public.fn_cash_game_never_moves_players(cg.template_name, cg.ruleset_snapshot)
       AND EXISTS (SELECT 1 FROM public.tables ft
                    WHERE ft.cluster_id = mt.cluster_id AND ft.role = 'feeder'
                      AND ft.lifecycle IN ('live', 'opening')
                      AND coalesce(ft.is_deleted, false) = false
                      AND ft.status IN ('waiting', 'running', 'active')));
$fn$;
REVOKE ALL ON FUNCTION public.fn_cash_main_chair_is_the_lists(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_main_chair_is_the_lists(uuid) TO service_role;

-- A patch helper for this transaction only: replace an anchor that must occur
-- exactly once, or refuse the whole migration.
CREATE FUNCTION pg_temp.ca_swap_once(p_src text, p_anchor text, p_new text, p_label text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n integer;
BEGIN
  n := (length(p_src) - length(replace(p_src, p_anchor, ''))) / greatest(length(p_anchor), 1);
  IF n <> 1 THEN
    RAISE EXCEPTION 'feeder_start_anchor_%: found % times', p_label, n USING ERRCODE = '55000';
  END IF;
  RETURN replace(p_src, p_anchor, p_new);
END $f$;

DO $patch$
DECLARE src text; patched text;
BEGIN
  -- ── 2a. The census counts a held chair as reserved ────────────────────────
  src := pg_get_functiondef('public.fn_cash_cluster_census(uuid,timestamp with time zone)'::regprocedure);
  IF position('cash_cluster_feeder_starts' IN src) > 0 THEN
    RAISE EXCEPTION 'census already carries the feeder start' USING ERRCODE = '55000';
  END IF;
  patched := pg_temp.ca_swap_once(src,
    $a$WHERE w.table_id = tb.id AND w.status = 'notified' AND w.hold_expires_at > p_now)::integer AS reserved$a$,
    $b$WHERE w.table_id = tb.id AND w.status = 'notified' AND w.hold_expires_at > p_now)::integer
             -- A FULL-RING FEEDER START HOLDS ITS CHAIRS (Dan 2026-11-08).
             + coalesce((SELECT fs.held FROM public.cash_cluster_feeder_starts fs
                          WHERE fs.main_table_id = tb.id), 0)::integer AS reserved$b$,
    'census_reserved');
  EXECUTE patched;

  -- ── 2b. An open seat is not one the feeder start holds, nor a list chair ─
  src := pg_get_functiondef('public.fn_cash_game_open_seats(uuid)'::regprocedure);
  IF position('cash_cluster_feeder_starts' IN src) > 0 THEN
    RAISE EXCEPTION 'open seats already carry the feeder start' USING ERRCODE = '55000';
  END IF;
  patched := pg_temp.ca_swap_once(src,
    $q$  SELECT GREATEST(0,
$q$,
    $q$  -- FULL-RING FEEDER START (Dan 2026-11-08): a full-ring Main's open chair
  -- belongs to the must-move list while the game has a feeder, and the chairs
  -- a feeder start holds are never open.
  SELECT CASE WHEN public.fn_cash_main_chair_is_the_lists(t.id) THEN 0 ELSE GREATEST(0,
$q$,
    'open_seats_head');
  patched := pg_temp.ca_swap_once(patched,
    $q$WHERE m.to_table_id = t.id AND m.state = 'pending' AND m.swap_move_id IS NULL))::integer
    FROM public.tables t WHERE t.id = p_table_id;$q$,
    $q$WHERE m.to_table_id = t.id AND m.state = 'pending' AND m.swap_move_id IS NULL)
           - coalesce((SELECT fs.held FROM public.cash_cluster_feeder_starts fs
                        WHERE fs.main_table_id = t.id), 0))::integer END
    FROM public.tables t WHERE t.id = p_table_id;$q$,
    'open_seats_tail');
  EXECUTE patched;

  -- ── 2c. The buy-in door honours a held chair ──────────────────────────────
  src := pg_get_functiondef('public.atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)'::regprocedure);
  IF position('cash_cluster_feeder_starts' IN src) > 0 THEN
    RAISE EXCEPTION 'buy-in gate already carries the feeder start' USING ERRCODE = '55000';
  END IF;
  patched := pg_temp.ca_swap_once(src,
    $a$    -- THE DOOR HONOURS THE CHAIR THE GAME PROMISED (2026-09-10).$a$,
    $b$    -- A FULL-RING FEEDER START HOLDS ITS CHAIRS (Dan 2026-11-08): the
    -- chairs the last two players left on Main 1 stay empty until the feeder
    -- has handedness - 2 players. They count as held here, exactly as a
    -- waitlist hold does, so a direct buy-in cannot take one. And while a
    -- full-ring game has a feeder, a Main's open chair belongs to the
    -- must-move list: a newcomer sits at the feeder (a chair the list itself
    -- offered this player, a live hold of theirs, is still theirs).
    v_holds := v_holds + coalesce((SELECT fs.held FROM public.cash_cluster_feeder_starts fs
                                    WHERE fs.main_table_id = p_table_id), 0);
    IF public.fn_cash_main_chair_is_the_lists(p_table_id)
       AND NOT EXISTS (SELECT 1 FROM public.table_waitlist own
                        WHERE own.table_id = p_table_id AND own.user_id = p_user_id
                          AND own.status = 'notified'
                          AND COALESCE(own.hold_expires_at, own.notified_at + interval '60 seconds') > now()) THEN
      RAISE EXCEPTION 'SEAT_RESERVED: this seat goes to the next player on the must-move list'
        USING HINT = 'Tap Join Game to take a seat at the feeder table.';
    END IF;
    -- THE DOOR HONOURS THE CHAIR THE GAME PROMISED (2026-09-10).$b$,
    'buyin_gate');
  EXECUTE patched;

  -- ── 3. The tick ───────────────────────────────────────────────────────────
  src := pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure);
  IF position('FULL-RING FEEDER START' IN src) > 0 THEN
    RAISE EXCEPTION 'cash cluster tick already carries the feeder start' USING ERRCODE = '55000';
  END IF;
  patched := src;

  -- variables
  patched := pg_temp.ca_swap_once(patched,
    E'  v_people integer := 0;\nBEGIN',
    $q$  v_people integer := 0;
  -- FULL-RING FEEDER START (Dan 2026-11-08)
  v_full_ring boolean := false;
  v_gate integer := 7;
  v_fs record;
  v_first uuid[] := '{}'::uuid[];
  v_bump_ids uuid[] := '{}'::uuid[];
  v_bump_players uuid[] := '{}'::uuid[];
  v_move_id uuid;
  v_new_feeder uuid;
  v_feeder_n integer;
  v_src record;
  v_end_reason text;
BEGIN$q$,
    'tick_declare');

  -- a/b/d: the feeder start in force, before must-move reads the board
  patched := pg_temp.ca_swap_once(patched,
    $a$  -- ── 2. MUST-MOVE (1.3 s9.5) ──$a$,
    $b$  -- ── 1b. FULL-RING FEEDER START (Dan 2026-11-08) ─────────────────────────
  -- Nine-handed (any handedness 7 to 9): four on the list bumps the last two to
  -- sit at Main 1 onto a new feeder; their two Main chairs are HELD until the
  -- feeder has handedness - 2 players; the bumped two are first to move and
  -- take any Main chair a leave or bust-out opens. 6-max is unchanged.
  v_full_ring := coalesce(g.handedness, 9) >= 7;
  v_gate := greatest(2, coalesce(g.handedness, 9) - 2);
  SELECT * INTO v_fs FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id;
  IF FOUND THEN
    -- A bump move that never landed gives its chair back.
    IF EXISTS (SELECT 1 FROM public.cash_seat_moves m
                WHERE m.id = ANY (v_fs.bump_move_ids) AND m.state IN ('cancelled', 'expired')) THEN
      UPDATE public.cash_cluster_feeder_starts fs
         SET held = greatest(0, fs.held - (SELECT count(*) FROM public.cash_seat_moves m
                                            WHERE m.id = ANY (fs.bump_move_ids)
                                              AND m.state IN ('cancelled', 'expired'))::integer),
             bump_move_ids = ARRAY(SELECT x FROM unnest(fs.bump_move_ids) x
                                    WHERE NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m
                                                       WHERE m.id = x AND m.state IN ('cancelled', 'expired'))),
             updated_at = v_now
       WHERE fs.game_id = g.id;
      SELECT * INTO v_fs FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id;
    END IF;
    v_end_reason := CASE
      WHEN NOT v_full_ring OR v_classic THEN 'not_full_ring'
      WHEN NOT EXISTS (SELECT 1 FROM unnest(v_census) c
                        WHERE c.id = v_fs.main_table_id AND c.role = 'main' AND c.lifecycle = 'live')
        THEN 'main_not_live'
      WHEN NOT EXISTS (SELECT 1 FROM unnest(v_census) c
                        WHERE c.id = v_fs.feeder_table_id AND c.lifecycle IN ('live', 'opening') AND NOT c.breaking)
        THEN 'feeder_not_live'
      WHEN EXISTS (SELECT 1 FROM unnest(v_census) c
                    WHERE c.id = v_fs.feeder_table_id AND c.lifecycle = 'live' AND c.seated < 2)
           AND NOT EXISTS (SELECT 1 FROM public.cash_game_waitlist w
                            WHERE w.game_id = g.id AND w.status IN ('waiting', 'notified'))
           AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m
                            WHERE m.to_table_id = v_fs.feeder_table_id AND m.state = 'pending')
        THEN 'feeder_down_to_one'
      ELSE NULL END;
    IF v_end_reason IS NULL AND v_fs.held > 0 THEN
      -- RELEASE: the feeder has its handedness - 2 (players already on their
      -- way out are not counted); one held chair goes to the first on the list.
      SELECT c.seated - (SELECT count(*) FROM public.cash_seat_moves m
                          WHERE m.from_table_id = c.id AND m.state = 'pending')::integer
        INTO v_feeder_n
        FROM unnest(v_census) c WHERE c.id = v_fs.feeder_table_id;
      IF coalesce(v_feeder_n, 0) >= v_gate THEN
        UPDATE public.cash_cluster_feeder_starts
           SET held = held - 1, updated_at = v_now
         WHERE game_id = g.id AND held > 0;
        INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
        VALUES (g.id, v_fs.main_table_id, 'feeder_start_chair_released',
                jsonb_build_object('feeder_table_id', v_fs.feeder_table_id, 'feeder_players', v_feeder_n,
                                   'gate', v_gate, 'held_before', v_fs.held));
        v_actions := v_actions || jsonb_build_object('feeder_start_chair_released', v_fs.main_table_id);
        SELECT * INTO v_fs FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id;
      END IF;
    END IF;
    IF v_end_reason IS NULL AND v_fs.held = 0
       AND NOT EXISTS (SELECT 1 FROM public.table_seats ts JOIN unnest(v_census) c ON c.id = ts.table_id
                        WHERE ts.left_at IS NULL AND c.role = 'feeder'
                          AND ts.user_id = ANY (v_fs.first_to_move)) THEN
      v_end_reason := 'complete';
    END IF;
    IF v_end_reason IS NOT NULL THEN
      DELETE FROM public.cash_cluster_feeder_starts WHERE game_id = g.id;
      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
      VALUES (g.id, v_fs.main_table_id, 'feeder_start_ended',
              jsonb_build_object('reason', v_end_reason, 'held', v_fs.held,
                                 'feeder_table_id', v_fs.feeder_table_id));
      v_actions := v_actions || jsonb_build_object('feeder_start_ended', v_end_reason);
    ELSE
      v_first := v_fs.first_to_move;
    END IF;
    -- The held count is part of the census's `reserved`; read it again.
    v_census := public.fn_cash_cluster_census(g.id, v_now);
  END IF;

  -- ── 2. MUST-MOVE (1.3 s9.5) ──$b$,
    'tick_feeder_start');

  -- c: the gate and the first-to-move order in must-move's pick
  patched := pg_temp.ca_swap_once(patched,
    $q$         AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id))
         AND c.id <> t.id
$q$,
    $q$         AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id))
         AND c.id <> t.id
         -- FULL-RING FEEDER START (Dan 2026-11-08): a full-ring feeder gives a
         -- Main a player only while it has handedness - 2 players; the two
         -- bumped players (first to move) and a breaking table are never held back.
         AND (NOT v_full_ring OR c.breaking OR c.role <> 'feeder'
              OR ts.user_id = ANY (v_first)
              OR c.seated - (SELECT count(*) FROM public.cash_seat_moves mo
                               WHERE mo.from_table_id = c.id AND mo.state = 'pending') >= v_gate)
$q$,
    'tick_mustmove_gate');
  patched := pg_temp.ca_swap_once(patched,
    $q$       ORDER BY c.breaking DESC,
                coalesce((SELECT r2.joined_at FROM public.cash_game_roster r2
$q$,
    $q$       ORDER BY c.breaking DESC,
                (ts.user_id = ANY (v_first)) DESC,
                coalesce((SELECT r2.joined_at FROM public.cash_game_roster r2
$q$,
    'tick_mustmove_order');
  -- The same gate again for each pick, now that earlier picks of this tick
  -- are pending moves: one feeder player per chair the gate allows.
  patched := pg_temp.ca_swap_once(patched,
    $q$    LOOP
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');$q$,
    $q$    LOOP
      IF v_full_ring AND NOT (r.user_id = ANY (v_first)) THEN
        SELECT c.role, c.breaking, c.seated INTO v_src FROM unnest(v_census) c WHERE c.id = r.table_id;
        CONTINUE WHEN v_src.role = 'feeder' AND NOT v_src.breaking
          AND v_src.seated - (SELECT count(*) FROM public.cash_seat_moves mo
                               WHERE mo.from_table_id = r.table_id AND mo.state = 'pending') < v_gate;
      END IF;
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');$q$,
    'tick_mustmove_recheck');

  -- a: OPEN for full ring
  patched := pg_temp.ca_swap_once(patched,
    $q$    IF v_buyers >= 2 THEN
      UPDATE public.tables SET promote_pending = true
       WHERE cluster_id = g.id AND role = 'feeder' AND lifecycle = 'live';$q$,
    $b$    IF v_full_ring AND v_waiting < 4 THEN
      -- FULL-RING FEEDER START (Dan 2026-11-08): a nine-handed game opens its
      -- second table for FOUR on the list, not two buyers.
      NULL;
    ELSIF v_full_ring AND NOT v_classic AND v_live_tables = 1
          AND NOT EXISTS (SELECT 1 FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id)
          AND EXISTS (SELECT 1 FROM unnest(v_census) c WHERE c.role = 'main' AND c.lifecycle = 'live') THEN
      -- FULL-RING FEEDER START: the last two to sit at Main 1 open the feeder.
      SELECT c.id INTO v_shortest FROM unnest(v_census) c
       WHERE c.role = 'main' AND c.lifecycle = 'live' ORDER BY c.main_index NULLS LAST, c.created_at LIMIT 1;
      v_new_feeder := public.fn_cash_cluster_open_table(g.id, 'feeder', NULL, 'opening', NULL);
      UPDATE public.cash_games SET opening_hold_since = NULL WHERE id = g.id;
      v_bump_ids := '{}'::uuid[];
      v_bump_players := '{}'::uuid[];
      FOR r IN
        SELECT ts.user_id, ts.table_id
          FROM public.table_seats ts
         WHERE ts.table_id = v_shortest AND ts.left_at IS NULL AND ts.user_id IS NOT NULL
           AND coalesce(ts.stack, 0) > 0
           AND coalesce(ts.leave_pending, false) = false
           AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m WHERE m.player_id = ts.user_id AND m.state = 'pending')
         -- THE LAST TO SIT: arrival at THIS table. A move carries the player's
         -- original joined_at, so a moved-in player's arrival is the move.
         ORDER BY coalesce((SELECT max(m.executed_at) FROM public.cash_seat_moves m
                             WHERE m.player_id = ts.user_id AND m.to_table_id = ts.table_id
                               AND m.state = 'done' AND m.executed_at >= ts.joined_at), ts.joined_at) DESC,
                  ts.seat_number DESC
         LIMIT 2
      LOOP
        INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
        VALUES (g.id, r.user_id, r.table_id, v_new_feeder, 'balance')
        RETURNING id INTO v_move_id;
        v_bump_ids := v_bump_ids || v_move_id;
        v_bump_players := v_bump_players || r.user_id;
        v_moves := v_moves + 1;
        INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
        VALUES (g.id, v_new_feeder, 'move_planned',
                jsonb_build_object('player_id', r.user_id, 'from_table_id', r.table_id,
                                   'reason', 'balance', 'feeder_start', true));
      END LOOP;
      INSERT INTO public.cash_cluster_feeder_starts
        (game_id, main_table_id, feeder_table_id, held, first_to_move, bump_move_ids, started_at, updated_at)
      VALUES (g.id, v_shortest, v_new_feeder, cardinality(v_bump_players), v_bump_players, v_bump_ids, v_now, v_now)
      ON CONFLICT (game_id) DO UPDATE
        SET main_table_id = EXCLUDED.main_table_id, feeder_table_id = EXCLUDED.feeder_table_id,
            held = EXCLUDED.held, first_to_move = EXCLUDED.first_to_move,
            bump_move_ids = EXCLUDED.bump_move_ids, started_at = EXCLUDED.started_at,
            updated_at = EXCLUDED.updated_at;
      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
      VALUES (g.id, v_new_feeder, 'feeder_start',
              jsonb_build_object('main_table_id', v_shortest, 'waiting', v_waiting,
                                 'first_to_move', to_jsonb(v_bump_players), 'held', cardinality(v_bump_players)));
      v_actions := v_actions || jsonb_build_object('feeder', 'opened', 'feeder_start', cardinality(v_bump_players),
                                                   'waiting', v_waiting);
    ELSIF v_buyers >= 2 THEN
      UPDATE public.tables SET promote_pending = true
       WHERE cluster_id = g.id AND role = 'feeder' AND lifecycle = 'live';$b$,
    'tick_open');

  IF position('fn_cash_game_never_moves_players(' IN patched) = 0 THEN
    RAISE EXCEPTION 'cash cluster tick must keep reading the one must-move definition';
  END IF;
  IF position('AN OPEN CHAIR IS OFFERED TO THE LIST' IN patched) = 0 THEN
    RAISE EXCEPTION 'cash cluster tick must keep offering open chairs to the list';
  END IF;
  IF position('fn_cash_game_second_table_picked(g.id, v_now)' IN patched) = 0 THEN
    RAISE EXCEPTION 'cash cluster tick must keep reading the one second-table rule';
  END IF;
  EXECUTE patched;
END $patch$;

REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;

COMMIT;
