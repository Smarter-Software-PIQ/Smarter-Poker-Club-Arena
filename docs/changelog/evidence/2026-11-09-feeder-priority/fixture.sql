-- Local fixture: the objects the feeder-start migration patches, with the
-- production text around every anchor reproduced, so the migration runs
-- unmodified and its patched functions can be exercised.
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public.cash_cluster_census_row AS (
  id uuid, role text, main_index integer, lifecycle text, status text, created_at timestamptz,
  max_players integer, seated integer, reserved integer, open_unreserved integer, breaking boolean);

CREATE TABLE public.cash_games (id uuid PRIMARY KEY, name text, enabled boolean DEFAULT true, must_move boolean DEFAULT true,
  cluster_mode text DEFAULT 'must_move', cluster_epoch int, handedness int, cap_mains int DEFAULT 8,
  allow_second_feeder boolean DEFAULT false, template_name text DEFAULT 'classic', ruleset_snapshot jsonb,
  lightning_enabled boolean DEFAULT false, opening_hold_since timestamptz, opening_hold_rested_until timestamptz,
  last_tick_at timestamptz, last_tick_actions jsonb);
CREATE TABLE public.tables (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid, role text, main_index int,
  lifecycle text, status text DEFAULT 'waiting', max_players int, is_deleted boolean DEFAULT false,
  created_at timestamptz DEFAULT clock_timestamp(), promote_pending boolean DEFAULT false, name text, live_at timestamptz,
  current_players int DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.table_seats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid, seat_number int,
  stack numeric DEFAULT 100, leave_pending boolean DEFAULT false, joined_at timestamptz DEFAULT clock_timestamp(), left_at timestamptz);
CREATE TABLE public.table_waitlist (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid, status text,
  notified_at timestamptz, hold_expires_at timestamptz);
CREATE TABLE public.cash_seat_moves (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid, player_id uuid,
  from_table_id uuid, to_table_id uuid, reason text CHECK (reason IN ('must_move','break','seat_change','balance')),
  state text DEFAULT 'pending', swap_move_id uuid, created_at timestamptz DEFAULT clock_timestamp(), resolved_at timestamptz,
  executed_at timestamptz);
CREATE TABLE public.cash_game_waitlist (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid, user_id uuid, status text,
  created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.cash_game_roster (game_id uuid, user_id uuid, joined_at timestamptz, left_at timestamptz);
CREATE TABLE public.cash_cluster_events (id bigserial, game_id uuid, table_id uuid, kind text, payload jsonb,
  at timestamptz DEFAULT clock_timestamp());

-- production text (2026-11-08)
CREATE OR REPLACE FUNCTION public.fn_cash_cluster_census(p_game_id uuid, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS cash_cluster_census_row[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(array_agg(
           (q.id, q.role, q.main_index, q.lifecycle, q.status, q.created_at, q.max_players,
            q.seated, q.reserved, GREATEST(0, q.max_players - q.seated - q.reserved),
            q.lifecycle = 'breaking')::public.cash_cluster_census_row
           ORDER BY q.created_at), '{}'::public.cash_cluster_census_row[])
    FROM (
      SELECT tb.id, tb.role, tb.main_index, tb.lifecycle, tb.status, tb.created_at,
             coalesce(tb.max_players, 9) AS max_players,
             (SELECT count(*) FROM public.table_seats ts WHERE ts.table_id = tb.id AND ts.left_at IS NULL)::integer AS seated,
             (SELECT count(*) FROM public.table_waitlist w
               WHERE w.table_id = tb.id AND w.status = 'notified' AND w.hold_expires_at > p_now)::integer AS reserved
        FROM public.tables tb
       WHERE tb.cluster_id = p_game_id AND coalesce(tb.is_deleted, false) = false
         AND coalesce(tb.lifecycle, '') <> 'closed'
    ) q;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cash_game_open_seats(p_table_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(0,
           coalesce(t.max_players, 9)
           - (SELECT count(*) FROM public.table_seats ts WHERE ts.table_id = t.id AND ts.left_at IS NULL)
           - (SELECT count(*) FROM public.table_waitlist w
               WHERE w.table_id = t.id AND w.status = 'notified' AND w.hold_expires_at > clock_timestamp())
           - (SELECT count(*) FROM public.cash_seat_moves m
               WHERE m.to_table_id = t.id AND m.state = 'pending' AND m.swap_move_id IS NULL))::integer
    FROM public.tables t WHERE t.id = p_table_id;
$function$;

-- stub of the buy-in gate: the production lines around its anchor
CREATE OR REPLACE FUNCTION public.atomic_table_buyin_before_maintenance_announcement_gate(p_user_id uuid, p_table_id uuid, p_seat_number integer, p_amount numeric, p_x boolean, p_club_id uuid, p_idempotency_key uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_max_players integer; v_seats_taken integer; v_holds integer; v_moves integer;
BEGIN
  SELECT max_players INTO v_max_players FROM public.tables WHERE id = p_table_id;
  IF v_max_players > 0 THEN
    SELECT COUNT(*) INTO v_seats_taken
      FROM table_seats
     WHERE table_id = p_table_id AND left_at IS NULL;
    IF v_seats_taken >= v_max_players THEN
      RAISE EXCEPTION 'TABLE_SIZE: table is full (% of % seats taken)',
        v_seats_taken, v_max_players;
    END IF;

    SELECT COUNT(*) INTO v_holds
      FROM public.table_waitlist w
     WHERE w.table_id = p_table_id
       AND w.status = 'notified'
       AND w.user_id <> p_user_id
       AND COALESCE(w.hold_expires_at, w.notified_at + interval '60 seconds') > now();
    -- THE DOOR HONOURS THE CHAIR THE GAME PROMISED (2026-09-10). A pending
    -- must-move / break / balance / seat-change plan into this table is a
    -- reservation everywhere else.
    SELECT COUNT(*) INTO v_moves
      FROM public.cash_seat_moves m
     WHERE m.to_table_id = p_table_id
       AND m.state = 'pending'
       AND m.swap_move_id IS NULL
       AND m.player_id <> p_user_id;
    IF v_seats_taken + v_holds >= v_max_players THEN
      RAISE EXCEPTION 'SEAT_RESERVED: the open seat is held for the next player on the waiting list';
    END IF;
    IF v_seats_taken + v_holds + v_moves >= v_max_players THEN
      RAISE EXCEPTION 'SEAT_RESERVED: the open seat is held for a player the game is moving here';
    END IF;
  END IF;
  INSERT INTO public.table_seats (table_id, user_id, seat_number, stack) VALUES (p_table_id, p_user_id, p_seat_number, p_amount);
END;
$function$;

CREATE FUNCTION public.fn_cash_game_never_moves_players(t text, r jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_cash_game_second_table_picked(g uuid, at timestamptz) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_cash_cluster_open_table(p_game uuid, p_role text, p_idx int, p_life text, p_x uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.tables (cluster_id, role, main_index, lifecycle, max_players, name)
  SELECT p_game, p_role, p_idx, p_life, g.handedness, g.name || ' ' || p_role FROM public.cash_games g WHERE g.id = p_game
  RETURNING id INTO v;
  RETURN v;
END $$;

-- The tick: production text for the declarations and for every step this
-- migration touches (must-move, the list-offer marker, OPEN, PROMOTE); the
-- untouched steps (reconcile, R3, break, roles, wake) are left out.
CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick(p_game_id uuid, p_eligible_horses integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  g record; t record; r record;
  g_mode record;
  v_front uuid;
  v_census public.cash_cluster_census_row[];
  v_actions jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_seated_total integer := 0;
  v_live_tables integer := 0;
  v_open_unreserved integer := 0;
  v_buyers integer;
  v_waiting integer;
  v_prev_feeder record;
  v_candidate record;
  v_floor integer;
  v_remaining_capacity integer;
  v_remaining_tables integer;
  v_main1 record;
  v_new_state text;
  v_moves integer := 0;
  v_n integer;
  v_idx integer;
  v_shortest uuid;
  v_table_cap integer;
  v_classic boolean := false;
  v_hands integer;
  v_orbit integer;
  v_window interval;
  v_over_cap boolean := false;
  v_people integer := 0;
BEGIN
  SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR UPDATE;
  v_classic := public.fn_cash_game_never_moves_players(g.template_name, g.ruleset_snapshot);
  UPDATE public.cash_game_waitlist w SET status = 'seated'
   WHERE w.game_id = g.id AND w.status IN ('waiting', 'notified')
     AND EXISTS (SELECT 1 FROM public.table_seats ts JOIN public.tables tb ON tb.id = ts.table_id
                  WHERE ts.user_id = w.user_id AND ts.left_at IS NULL AND tb.cluster_id = g.id AND tb.lifecycle <> 'closed');
  v_census := public.fn_cash_cluster_census(g.id, v_now);
  SELECT coalesce(sum(c.seated), 0), count(*) INTO v_seated_total, v_live_tables FROM unnest(v_census) c;

  -- ── 2. MUST-MOVE (1.3 s9.5) ──────────────────────────────────────────────
  -- For every Main with an unreserved open seat, the longest-seated player on
  -- the feeder (or on a breaking table) is planned onto it, one per seat,
  -- one per player. The engine executes at the player's next hand boundary.
  FOR t IN SELECT * FROM unnest(v_census) c
            WHERE NOT v_classic AND c.role = 'main' AND c.lifecycle = 'live' AND c.open_unreserved > 0
            ORDER BY c.main_index
  LOOP
    v_n := t.open_unreserved
         - (SELECT count(*) FROM public.cash_seat_moves m WHERE m.to_table_id = t.id AND m.state = 'pending' AND m.swap_move_id IS NULL);
    FOR r IN
      SELECT ts.user_id, ts.table_id
        FROM public.table_seats ts
        JOIN unnest(v_census) c ON c.id = ts.table_id
       WHERE ts.left_at IS NULL AND ts.user_id IS NOT NULL
         -- A Main 1 seat draws from the WHOLE list (every table but Main 1);
         -- a Main N seat draws from the feeder and any breaking table.
         AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id))
         AND c.id <> t.id
         -- NOT WITH NOTHING, NOT WHILE LEAVING (2026-09-05): a busted seat is
         -- in its rebuy window, a leave_pending seat is on its way out.
         AND coalesce(ts.stack, 0) > 0
         AND coalesce(ts.leave_pending, false) = false
         -- Never onto a table they are already sitting at.
         AND NOT EXISTS (SELECT 1 FROM public.table_seats d WHERE d.table_id = t.id AND d.user_id = ts.user_id AND d.left_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m WHERE m.player_id = ts.user_id AND m.state = 'pending')
         -- BACK-OFF (2026-09-05): a move the engine just refused (cancelled
         -- with a note) is not re-planned every 5 s; the refusal gets a minute.
         AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m WHERE m.player_id = ts.user_id AND m.state = 'cancelled' AND coalesce(m.resolved_at, m.created_at) > v_now - interval '60 seconds')
       -- THE ORDER YOU JOINED THE GAME (Dan 2026-09-05): the roster's
       -- joined_at, which survives every move; the chair's own joined_at
       -- only for a chair that predates the roster.
       ORDER BY c.breaking DESC,
                coalesce((SELECT r2.joined_at FROM public.cash_game_roster r2
                           WHERE r2.game_id = g.id AND r2.user_id = ts.user_id AND r2.left_at IS NULL), ts.joined_at) ASC,
                ts.joined_at ASC
       LIMIT GREATEST(v_n, 0)
    LOOP
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');
      v_moves := v_moves + 1;
      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
      VALUES (g.id, t.id, 'move_planned', jsonb_build_object('player_id', r.user_id, 'from_table_id', r.table_id, 'reason', 'must_move'));
    END LOOP;
  END LOOP;
  IF v_moves > 0 THEN v_actions := v_actions || jsonb_build_object('moves_planned', v_moves); END IF;

  -- AN OPEN CHAIR IS OFFERED TO THE LIST (2026-11-07). (offer step elided in the fixture)

  -- ── 3. OPEN (18.3) ───────────────────────────────────────────────────────
  SELECT coalesce(sum(c.open_unreserved), 0) INTO v_open_unreserved
    FROM unnest(v_census) c WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking;
  SELECT count(*) INTO v_waiting FROM public.cash_game_waitlist w
   WHERE w.game_id = g.id AND w.status IN ('waiting', 'notified');
  v_buyers := v_waiting + GREATEST(coalesce(p_eligible_horses, 0), 0);
  v_table_cap := g.cap_mains + 1;
  IF g.allow_second_feeder THEN v_table_cap := v_table_cap + 1; END IF;
  v_table_cap := greatest(1, floor(v_table_cap *
     CASE WHEN v_now >= '2026-11-02 00:00:00 America/Chicago'::timestamptz
          THEN 0.2 ELSE 0.5 END)::integer);
  IF v_table_cap < 2 AND public.fn_cash_game_second_table_picked(g.id, v_now) THEN
    v_table_cap := 2;
  END IF;

  IF g.enabled AND v_open_unreserved = 0 AND v_live_tables > 0
     AND NOT EXISTS (SELECT 1 FROM unnest(v_census) c WHERE c.lifecycle = 'opening')
     AND v_live_tables < v_table_cap
     -- Two minutes after a feeder was abandoned, not before.
     AND NOT EXISTS (SELECT 1 FROM public.cash_cluster_events e
                      WHERE e.game_id = g.id AND e.kind = 'feeder_abandoned' AND e.at > v_now - interval '2 minutes') THEN
    IF v_buyers >= 2 THEN
      UPDATE public.tables SET promote_pending = true
       WHERE cluster_id = g.id AND role = 'feeder' AND lifecycle = 'live';
      PERFORM public.fn_cash_cluster_open_table(g.id, 'feeder', NULL, 'opening', NULL);
      UPDATE public.cash_games SET opening_hold_since = NULL WHERE id = g.id;
      v_actions := v_actions || jsonb_build_object('feeder', 'opened', 'buyers', v_buyers);
    ELSIF v_buyers = 1 THEN
      IF g.opening_hold_since IS NULL
         AND (g.opening_hold_rested_until IS NULL OR g.opening_hold_rested_until <= v_now) THEN
        UPDATE public.cash_games SET opening_hold_since = v_now WHERE id = g.id;
        v_actions := v_actions || jsonb_build_object('opening_hold', 'started');
      END IF;
    END IF;
  ELSIF g.opening_hold_since IS NOT NULL THEN
    UPDATE public.cash_games SET opening_hold_since = NULL WHERE id = g.id;
  END IF;

  -- ── 4. PROMOTE (18.3) ────────────────────────────────────────────────────
  FOR t IN SELECT * FROM unnest(v_census) c WHERE c.lifecycle = 'opening' AND c.seated >= 2 LOOP
    UPDATE public.tables SET lifecycle = 'live', live_at = v_now WHERE id = t.id;
    v_actions := v_actions || jsonb_build_object('feeder_live', t.id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'game_id', g.id, 'seated_total', v_seated_total,
                            'tables', v_live_tables, 'buyers', v_buyers, 'actions', v_actions);
END;
$function$;
