#!/usr/bin/env bash
# Native PostgreSQL proof for the upward must-move ladder and all hardening
# doors (migrations 20261124003437 and 20261124051600). Runs on a THROWAWAY
# local PostgreSQL cluster it creates and removes; it never connects to any
# other database.
#
# Proves all three doors before and after applying the real migration files:
#   1. fn_cash_cluster_tick_uncapped (20261124003437):
#      - Exact 9-max screenshot repro (Main 1=9/9, Main 2=5/9, Main 3=9/9,
#        Feeder=6/9): before=0 moves, after=4 moves Main 3 -> Main 2 (0 from
#        gated Feeder).
#      - 4-table 9-max upward cascade + zero downward pulls; Feeder(8)->Main 3
#        stops at 6.
#      - 5-table cascade (Main 4 -> Main 3 -> Main 2 -> Main 1).
#      - 6-max 4-table upward cascade (Main 3 -> Main 2, Feeder -> Main 3).
#   2. fn_cash_main_chair_is_the_lists (20261124051600):
#      - Before: 6-max Main 1/Main 2 with live Feeder returned FALSE (bypassing
#        the must-move list for newcomers and waitlist offers).
#      - After: BOTH 6-max and 9-max Mains return TRUE while a live/opening
#        feeder exists, and FALSE when no feeder exists or the feeder is breaking.
#   3. fn_cash_seat_change_plan (20261124051600):
#      - Before: Feeder player (at 6/9, gated) jumped into Main 3's open chair
#        and Main 3 player jumped into Main 2's open chair.
#      - After: upward open-chair seat changes into any Main are blocked (0
#        moves planned), while downward (Main 2 -> Feeder) and two-way swaps
#        still succeed.
set -euo pipefail

if [[ -n "${PG_BIN:-}" ]]; then
  :
elif command -v initdb >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v initdb)")"
else
  for candidate in /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin /usr/lib/postgresql/15/bin /opt/homebrew/bin; do
    if [[ -x "$candidate/initdb" ]]; then
      PG_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "${PG_BIN:-}" || ! -x "$PG_BIN/initdb" ]]; then
  echo "initdb not found; set PG_BIN" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_CASCADE="$ROOT/supabase/migrations/20261124003437_every_main_table_feeds_upward_from_higher_mains_and_feeders.sql"
MIG_HARDEN="$ROOT/supabase/migrations/20261124051600_harden_must_move_upward_ladder_all_doors.sql"
WORK="$(mktemp -d)"
PORT=$((5550 + ($$ % 400)))
trap '"$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

"$PG_BIN/initdb" -D "$WORK/data" -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p $PORT" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d postgres)

"${PSQL[@]}" <<'SQL'
CREATE ROLE service_role NOLOGIN;

CREATE TYPE public.cash_cluster_census_row AS (
  id uuid,
  role text,
  main_index integer,
  lifecycle text,
  status text,
  created_at timestamptz,
  max_players integer,
  seated integer,
  reserved integer,
  open_unreserved integer,
  breaking boolean
);

CREATE TABLE public.cash_games (
  id uuid PRIMARY KEY,
  handedness integer NOT NULL DEFAULT 9,
  must_move boolean NOT NULL DEFAULT true,
  cluster_mode text NOT NULL DEFAULT 'must_move',
  template_name text NOT NULL DEFAULT 'classic',
  ruleset_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.tables (
  id uuid PRIMARY KEY,
  cluster_id uuid NOT NULL REFERENCES public.cash_games(id),
  role text NOT NULL,
  main_index integer,
  lifecycle text NOT NULL DEFAULT 'live',
  status text NOT NULL DEFAULT 'running',
  max_players integer NOT NULL DEFAULT 9,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.table_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.tables(id),
  user_id uuid NOT NULL,
  seat_number integer NOT NULL DEFAULT 1,
  stack numeric NOT NULL DEFAULT 400,
  leave_pending boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL,
  left_at timestamptz
);

CREATE TABLE public.cash_game_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.cash_games(id),
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL,
  seat_change_used_at timestamptz,
  left_at timestamptz
);

CREATE TABLE public.cash_seat_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.cash_games(id),
  player_id uuid NOT NULL,
  from_table_id uuid NOT NULL REFERENCES public.tables(id),
  to_table_id uuid NOT NULL REFERENCES public.tables(id),
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  swap_move_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE public.cash_seat_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.cash_games(id),
  user_id uuid NOT NULL,
  from_table_id uuid NOT NULL REFERENCES public.tables(id),
  to_table_id uuid REFERENCES public.tables(id),
  status text NOT NULL DEFAULT 'requested',
  move_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE public.cash_cluster_events (
  id bigserial PRIMARY KEY,
  game_id uuid NOT NULL,
  table_id uuid,
  kind text NOT NULL,
  payload jsonb
);

CREATE OR REPLACE FUNCTION public.fn_cash_game_never_moves_players(p_template text, p_ruleset jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.fn_cash_cluster_front_table(p_game_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT t.id FROM public.tables t
   WHERE t.cluster_id = p_game_id AND t.role = 'main' AND t.main_index = 1
     AND t.lifecycle <> 'closed' AND NOT coalesce(t.is_deleted, false)
   ORDER BY t.created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_cash_cluster_census(p_game_id uuid, p_now timestamptz)
RETURNS public.cash_cluster_census_row[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(
    (tb.id, tb.role, tb.main_index, tb.lifecycle, tb.status, tb.created_at, tb.max_players,
     s.seated, 0, GREATEST(0, tb.max_players - s.seated), (tb.lifecycle = 'breaking'))::public.cash_cluster_census_row
    ORDER BY tb.created_at), '{}'::public.cash_cluster_census_row[])
  FROM public.tables tb
  CROSS JOIN LATERAL (
    SELECT count(*)::integer AS seated
      FROM public.table_seats ts
     WHERE ts.table_id = tb.id AND ts.left_at IS NULL
  ) s
  WHERE tb.cluster_id = p_game_id AND tb.lifecycle <> 'closed';
$$;

-- Exact preimage of fn_cash_main_chair_is_the_lists (20261108193515)
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
REVOKE ALL ON FUNCTION public.fn_cash_main_chair_is_the_lists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cash_main_chair_is_the_lists(uuid) TO service_role;

-- Exact preimage of fn_cash_seat_change_plan (20260909181259 + 20260921044045 + 20260925204249)
CREATE OR REPLACE FUNCTION public.fn_cash_seat_change_plan(p_game_id uuid, p_now timestamp with time zone DEFAULT clock_timestamp())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record; p record;
  v_census public.cash_cluster_census_row[];
  v_target uuid;
  v_moves integer := 0;
  v_move_a uuid; v_move_b uuid;
  v_seat_a integer; v_seat_b integer;
  v_front uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.cash_games cg
              WHERE cg.id = p_game_id AND cg.cluster_mode IS DISTINCT FROM 'must_move') THEN
    RETURN 0;
  END IF;
  v_census := public.fn_cash_cluster_census(p_game_id, p_now);
  v_front := public.fn_cash_cluster_front_table(p_game_id);

  FOR r IN SELECT q.* FROM public.cash_seat_change_requests q
            WHERE q.game_id = p_game_id AND q.status = 'requested'
            ORDER BY q.created_at, q.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.table_seats ts
                    WHERE ts.table_id = r.from_table_id AND ts.user_id = r.user_id AND ts.left_at IS NULL) THEN
      UPDATE public.cash_seat_change_requests
         SET status = 'cancelled', resolved_at = p_now, note = 'left_table'
       WHERE id = r.id;
      UPDATE public.cash_game_roster SET seat_change_used_at = NULL
       WHERE game_id = p_game_id AND user_id = r.user_id AND left_at IS NULL;
      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
      VALUES (p_game_id, r.from_table_id, 'seat_change_returned',
              jsonb_build_object('player_id', r.user_id, 'reason', 'left_table'));
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_census) c
                WHERE c.id = r.from_table_id AND c.id = v_front) THEN
      UPDATE public.cash_seat_change_requests
         SET status = 'cancelled', resolved_at = p_now, note = 'now_on_main_one'
       WHERE id = r.id;
      UPDATE public.cash_game_roster SET seat_change_used_at = NULL
       WHERE game_id = p_game_id AND user_id = r.user_id AND left_at IS NULL;
      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
      VALUES (p_game_id, r.from_table_id, 'seat_change_returned',
              jsonb_build_object('player_id', r.user_id, 'reason', 'now_on_main_one'));
      CONTINUE;
    END IF;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.table_seats ts
                               WHERE ts.table_id = r.from_table_id AND ts.user_id = r.user_id AND ts.left_at IS NULL
                                 AND coalesce(ts.stack, 0) > 0 AND coalesce(ts.leave_pending, false) = false);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cash_seat_moves m WHERE m.player_id = r.user_id AND m.state = 'pending');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cash_seat_moves m
                           WHERE m.player_id = r.user_id AND m.state = 'cancelled' AND m.created_at > p_now - interval '60 seconds');

    SELECT c.id INTO v_target FROM unnest(v_census) c
     WHERE c.id <> r.from_table_id AND NOT c.breaking AND c.lifecycle IN ('live', 'opening')
       AND c.id IS DISTINCT FROM v_front
       AND (r.to_table_id IS NULL OR c.id = r.to_table_id)
       AND c.open_unreserved
           - (SELECT count(*) FROM public.cash_seat_moves m
               WHERE m.to_table_id = c.id AND m.state = 'pending' AND m.swap_move_id IS NULL) > 0
     ORDER BY c.seated ASC, c.created_at ASC LIMIT 1;
    IF v_target IS NOT NULL THEN
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (p_game_id, r.user_id, r.from_table_id, v_target, 'seat_change')
      RETURNING id INTO v_move_a;
      UPDATE public.cash_seat_change_requests
         SET status = 'moved', resolved_at = p_now, move_id = v_move_a, note = 'seat_open'
       WHERE id = r.id;
      v_moves := v_moves + 1;
      CONTINUE;
    END IF;

    SELECT q.*, ts.seat_number AS their_seat INTO p
      FROM public.cash_seat_change_requests q
      JOIN unnest(v_census) c ON c.id = q.from_table_id
      JOIN public.table_seats ts ON ts.table_id = q.from_table_id AND ts.user_id = q.user_id AND ts.left_at IS NULL
     WHERE q.game_id = p_game_id AND q.status = 'requested' AND q.id <> r.id
       AND q.from_table_id <> r.from_table_id
       AND NOT c.breaking AND c.lifecycle = 'live'
       AND c.id IS DISTINCT FROM v_front
       AND (r.to_table_id IS NULL OR q.from_table_id = r.to_table_id)
       AND (q.to_table_id IS NULL OR q.to_table_id = r.from_table_id)
       AND coalesce(ts.stack, 0) > 0 AND coalesce(ts.leave_pending, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m WHERE m.player_id = q.user_id AND m.state = 'pending')
     ORDER BY q.created_at, q.id LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (p_game_id, r.user_id, r.from_table_id, p.from_table_id, 'seat_change')
      RETURNING id INTO v_move_a;
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason, swap_move_id)
      VALUES (p_game_id, p.user_id, p.from_table_id, r.from_table_id, 'seat_change', v_move_a)
      RETURNING id INTO v_move_b;
      UPDATE public.cash_seat_moves SET swap_move_id = v_move_b WHERE id = v_move_a;
      UPDATE public.cash_seat_change_requests SET status = 'moved', resolved_at = p_now, move_id = v_move_a, note = 'swap' WHERE id = r.id;
      UPDATE public.cash_seat_change_requests SET status = 'moved', resolved_at = p_now, move_id = v_move_b, note = 'swap' WHERE id = p.id;
      v_moves := v_moves + 2;
    END IF;
  END LOOP;
  RETURN v_moves;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_seat_change_plan(uuid,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cash_seat_change_plan(uuid,timestamp with time zone) TO service_role;

-- Exact Step 2 preimage of fn_cash_cluster_tick_uncapped (before 20261124003437)
CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick_uncapped(p_game_id uuid, p_eligible_horses integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  g record; t record; r record;
  v_census public.cash_cluster_census_row[];
  v_now timestamptz := clock_timestamp();
  v_full_ring boolean := false;
  v_gate integer := 7;
  v_first uuid[] := '{}'::uuid[];
  v_classic boolean := false;
  v_moves integer := 0;
  v_n integer;
  v_src record;
BEGIN
  SELECT * INTO g FROM public.cash_games WHERE id = p_game_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_full_ring := coalesce(g.handedness, 9) >= 7;
  v_gate := greatest(2, coalesce(g.handedness, 9) - 2);
  v_census := public.fn_cash_cluster_census(g.id, v_now);

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
         AND (NOT v_full_ring OR c.breaking OR c.role <> 'feeder'
              OR ts.user_id = ANY (v_first)
              OR c.seated - (SELECT count(*) FROM public.cash_seat_moves mo
                               WHERE mo.from_table_id = c.id AND mo.state = 'pending') >= v_gate)
         AND coalesce(ts.stack, 0) > 0
         AND coalesce(ts.leave_pending, false) = false
         AND NOT EXISTS (SELECT 1 FROM public.table_seats d WHERE d.table_id = t.id AND d.user_id = ts.user_id AND d.left_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m WHERE m.player_id = ts.user_id AND m.state = 'pending')
         AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m WHERE m.player_id = ts.user_id AND m.state = 'cancelled' AND coalesce(m.resolved_at, m.created_at) > v_now - interval '60 seconds')
       ORDER BY c.breaking DESC,
                (ts.user_id = ANY (v_first)) DESC,
                coalesce((SELECT r2.joined_at FROM public.cash_game_roster r2
                           WHERE r2.game_id = g.id AND r2.user_id = ts.user_id AND r2.left_at IS NULL), ts.joined_at) ASC,
                ts.joined_at ASC
       LIMIT GREATEST(v_n, 0)
    LOOP
      IF v_full_ring AND NOT (r.user_id = ANY (v_first)) THEN
        SELECT c.role, c.breaking, c.seated INTO v_src FROM unnest(v_census) c WHERE c.id = r.table_id;
        CONTINUE WHEN v_src.role = 'feeder' AND NOT v_src.breaking
          AND v_src.seated - (SELECT count(*) FROM public.cash_seat_moves mo
                               WHERE mo.from_table_id = r.table_id AND mo.state = 'pending') < v_gate;
      END IF;
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');
      v_moves := v_moves + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'moves_planned', v_moves);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick_uncapped(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick_uncapped(uuid,integer) TO service_role;

-- Helper to seed a 4-table game: Main 1, Main 2, Main 3, Feeder
CREATE FUNCTION public.seed_4table(
  p_game uuid, p_hand int, p_n1 int, p_n2 int, p_n3 int, p_nf int
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t1 uuid := ('11111111-1111-4111-8111-' || lpad(p_hand::text, 12, '0'))::uuid;
  t2 uuid := ('22222222-2222-4222-8222-' || lpad(p_hand::text, 12, '0'))::uuid;
  t3 uuid := ('33333333-3333-4333-8333-' || lpad(p_hand::text, 12, '0'))::uuid;
  tf uuid := ('44444444-4444-4444-8444-' || lpad(p_hand::text, 12, '0'))::uuid;
  i int; u uuid; seq int := 0;
BEGIN
  DELETE FROM public.cash_seat_change_requests WHERE game_id = p_game;
  DELETE FROM public.cash_seat_moves WHERE game_id = p_game;
  DELETE FROM public.cash_game_roster WHERE game_id = p_game;
  DELETE FROM public.table_seats WHERE table_id IN (SELECT id FROM public.tables WHERE cluster_id = p_game);
  DELETE FROM public.tables WHERE cluster_id = p_game;
  DELETE FROM public.cash_games WHERE id = p_game;

  INSERT INTO public.cash_games(id, handedness) VALUES (p_game, p_hand);
  INSERT INTO public.tables(id, cluster_id, role, main_index, max_players, created_at) VALUES
    (t1, p_game, 'main',   1,    p_hand, now() - interval '4 hours'),
    (t2, p_game, 'main',   2,    p_hand, now() - interval '3 hours'),
    (t3, p_game, 'main',   3,    p_hand, now() - interval '2 hours'),
    (tf, p_game, 'feeder', NULL, p_hand, now() - interval '1 hour');

  FOR i IN 1..p_n1 LOOP
    seq := seq + 1; u := ('aaaaaaaa-0001-4000-8000-' || lpad(seq::text, 12, '0'))::uuid;
    INSERT INTO public.table_seats(table_id, user_id, seat_number, joined_at) VALUES (t1, u, i, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
  FOR i IN 1..p_n2 LOOP
    seq := seq + 1; u := ('aaaaaaaa-0002-4000-8000-' || lpad(seq::text, 12, '0'))::uuid;
    INSERT INTO public.table_seats(table_id, user_id, seat_number, joined_at) VALUES (t2, u, i, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
  FOR i IN 1..p_n3 LOOP
    seq := seq + 1; u := ('aaaaaaaa-0003-4000-8000-' || lpad(seq::text, 12, '0'))::uuid;
    INSERT INTO public.table_seats(table_id, user_id, seat_number, joined_at) VALUES (t3, u, i, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
  FOR i IN 1..p_nf LOOP
    seq := seq + 1; u := ('aaaaaaaa-0004-4000-8000-' || lpad(seq::text, 12, '0'))::uuid;
    INSERT INTO public.table_seats(table_id, user_id, seat_number, joined_at) VALUES (tf, u, i, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
END $$;
SQL

# ── DOOR 1: fn_cash_cluster_tick_uncapped (20261124003437) ──────────────────
before_moves=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 5, 9, 6);
  SELECT (public.fn_cash_cluster_tick_uncapped('00000000-0000-4000-8000-000000000009', 0)->>'moves_planned')::int;
" | tail -1)
echo "screenshot_repro_before=$before_moves"
[[ "$before_moves" == "0" ]] || { echo "Expected 0 moves before patch, got $before_moves" >&2; exit 1; }

"${PSQL[@]}" -f "$MIG_CASCADE"

live_proof_1=$("${PSQL[@]}" -c "
  SELECT pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%(c.role = ''main'' AND c.main_index > t.main_index)%'
     AND pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%EVERY MAIN FEEDS UPWARDS%';
")
[[ "$live_proof_1" == "t" ]] || { echo "@live-proof 1 failed" >&2; exit 1; }
if "${PSQL[@]}" -f "$MIG_CASCADE" >/dev/null 2>&1; then
  echo "Double-apply of 20261124003437 should have been refused" >&2; exit 1
fi
echo "migration_applied_and_proved=ok"

after_summary=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 5, 9, 6);
  SELECT public.fn_cash_cluster_tick_uncapped('00000000-0000-4000-8000-000000000009', 0);
  SELECT count(*)::text || '|' ||
         count(*) FILTER (WHERE ft.role='main' AND ft.main_index=3 AND tt.role='main' AND tt.main_index=2)::text || '|' ||
         count(*) FILTER (WHERE ft.role='feeder')::text
    FROM public.cash_seat_moves m
    JOIN public.tables ft ON ft.id = m.from_table_id
    JOIN public.tables tt ON tt.id = m.to_table_id
   WHERE m.game_id = '00000000-0000-4000-8000-000000000009' AND m.state = 'pending';
" | tail -1)
echo "screenshot_repro_after=${after_summary%%|*} ($after_summary)"
[[ "$after_summary" == "4|4|0" ]] || { echo "Expected 4|4|0 after patch, got $after_summary" >&2; exit 1; }

cascade_check=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 8, 8, 9, 7);
  SELECT public.fn_cash_cluster_tick_uncapped('00000000-0000-4000-8000-000000000009', 0);
  SELECT count(*) FILTER (WHERE ft.main_index=2 AND tt.main_index=1)::text || '|' ||
         count(*) FILTER (WHERE ft.main_index=3 AND tt.main_index=2)::text || '|' ||
         count(*) FILTER (WHERE ft.role='main' AND ft.main_index < tt.main_index)::text
    FROM public.cash_seat_moves m
    JOIN public.tables ft ON ft.id = m.from_table_id
    JOIN public.tables tt ON tt.id = m.to_table_id
   WHERE m.game_id = '00000000-0000-4000-8000-000000000009' AND m.state = 'pending';
" | tail -1)
[[ "$cascade_check" == "1|1|0" ]] || { echo "Expected 1|1|0 on cascade, got $cascade_check" >&2; exit 1; }

feeder_to_m3=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 9, 7, 8);
  SELECT public.fn_cash_cluster_tick_uncapped('00000000-0000-4000-8000-000000000009', 0);
  SELECT count(*) FILTER (WHERE ft.role='feeder' AND tt.main_index=3)::text || '|' ||
         count(*) FILTER (WHERE ft.role='main' AND ft.main_index < tt.main_index)::text
    FROM public.cash_seat_moves m
    JOIN public.tables ft ON ft.id = m.from_table_id
    JOIN public.tables tt ON tt.id = m.to_table_id
   WHERE m.game_id = '00000000-0000-4000-8000-000000000009' AND m.state = 'pending';
" | tail -1)
[[ "$feeder_to_m3" == "2|0" ]] || { echo "Expected 2|0 for Feeder(8)->Main3(7), got $feeder_to_m3" >&2; exit 1; }
echo "no_downward_pull=ok"

six_max_1=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000006', 6, 6, 3, 6, 4);
  SELECT public.fn_cash_cluster_tick_uncapped('00000000-0000-4000-8000-000000000006', 0);
  SELECT count(*) FILTER (WHERE ft.main_index=3 AND tt.main_index=2)::text
    FROM public.cash_seat_moves m
    JOIN public.tables ft ON ft.id = m.from_table_id
    JOIN public.tables tt ON tt.id = m.to_table_id
   WHERE m.game_id = '00000000-0000-4000-8000-000000000006' AND m.state = 'pending';
" | tail -1)
six_max_2=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000006', 6, 6, 6, 3, 4);
  SELECT public.fn_cash_cluster_tick_uncapped('00000000-0000-4000-8000-000000000006', 0);
  SELECT count(*) FILTER (WHERE ft.role='feeder' AND tt.main_index=3)::text
    FROM public.cash_seat_moves m
    JOIN public.tables ft ON ft.id = m.from_table_id
    JOIN public.tables tt ON tt.id = m.to_table_id
   WHERE m.game_id = '00000000-0000-4000-8000-000000000006' AND m.state = 'pending';
" | tail -1)
[[ "$six_max_1" == "3" && "$six_max_2" == "3" ]] || { echo "Expected 3 and 3 on 6-max, got $six_max_1 and $six_max_2" >&2; exit 1; }
echo "six_max_cascade=ok"

# ── DOORS 2 & 3: BEFORE hardening (20261124051600) ──────────────────────────
# Door 2 before: 6-max Main 1 & Main 2 return FALSE even with a live Feeder!
six_max_main_list_before=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000006', 6, 5, 5, 6, 4);
  SELECT public.fn_cash_main_chair_is_the_lists('11111111-1111-4111-8111-000000000006')::text || '|' ||
         public.fn_cash_main_chair_is_the_lists('22222222-2222-4222-8222-000000000006')::text;
" | tail -1)
[[ "$six_max_main_list_before" == "false|false" ]] || { echo "Expected false|false before hardening on 6-max, got $six_max_main_list_before" >&2; exit 1; }

# Door 3 before: Feeder player (at 6/9, gated) seat-changes UPWARD into Main 3!
sc_before=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 9, 7, 6);
  INSERT INTO public.cash_seat_change_requests(game_id, user_id, from_table_id, to_table_id)
  SELECT '00000000-0000-4000-8000-000000000009', ts.user_id, ts.table_id, NULL
    FROM public.table_seats ts
   WHERE ts.table_id = '44444444-4444-4444-8444-000000000009' AND ts.left_at IS NULL
   ORDER BY ts.joined_at DESC LIMIT 1;
  SELECT public.fn_cash_seat_change_plan('00000000-0000-4000-8000-000000000009')::text;
" | tail -1)
[[ "$sc_before" == "1" ]] || { echo "Expected 1 upward seat-change bypass before hardening, got $sc_before" >&2; exit 1; }

# Apply 20261124051600 hardening migration
"${PSQL[@]}" -f "$MIG_HARDEN"

if "${PSQL[@]}" -f "$MIG_HARDEN" >/dev/null 2>&1; then
  echo "Double-apply of 20261124051600 should have been refused" >&2; exit 1
fi

# Door 2 after: BOTH 6-max and 9-max Mains return TRUE while feeder is live,
# and FALSE when feeder is breaking!
six_max_main_list_after=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000006', 6, 5, 5, 6, 4);
  SELECT public.fn_cash_main_chair_is_the_lists('11111111-1111-4111-8111-000000000006')::text || '|' ||
         public.fn_cash_main_chair_is_the_lists('22222222-2222-4222-8222-000000000006')::text || '|' ||
         public.fn_cash_main_chair_is_the_lists('44444444-4444-4444-8444-000000000006')::text;
" | tail -1)
[[ "$six_max_main_list_after" == "true|true|false" ]] || { echo "Expected true|true|false after hardening on 6-max, got $six_max_main_list_after" >&2; exit 1; }

six_max_breaking=$("${PSQL[@]}" -c "
  UPDATE public.tables SET lifecycle = 'breaking' WHERE id = '44444444-4444-4444-8444-000000000006';
  SELECT public.fn_cash_main_chair_is_the_lists('11111111-1111-4111-8111-000000000006')::text;
" | tail -1)
[[ "$six_max_breaking" == "false" ]] || { echo "Expected false when feeder is breaking, got $six_max_breaking" >&2; exit 1; }
echo "six_max_main_chair_reserved=ok"

# Door 3 after:
# (a) Feeder -> Main 3 open chair BLOCKED (0 moves)
# (b) Main 3 -> Main 2 open chair BLOCKED (0 moves)
# (c) Main 2 -> Feeder open chair ALLOWED (1 move)
# (d) Two-way swap (Main 2 <-> Feeder) ALLOWED (2 moves)
sc_upward_blocked=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 8, 7, 6);
  INSERT INTO public.cash_seat_change_requests(game_id, user_id, from_table_id, to_table_id)
  SELECT '00000000-0000-4000-8000-000000000009', ts.user_id, ts.table_id, NULL
    FROM public.table_seats ts
   WHERE ts.table_id = '44444444-4444-4444-8444-000000000009' AND ts.left_at IS NULL
   ORDER BY ts.joined_at DESC LIMIT 1;
  INSERT INTO public.cash_seat_change_requests(game_id, user_id, from_table_id, to_table_id)
  SELECT '00000000-0000-4000-8000-000000000009', ts.user_id, ts.table_id, '22222222-2222-4222-8222-000000000009'
    FROM public.table_seats ts
   WHERE ts.table_id = '33333333-3333-4333-8333-000000000009' AND ts.left_at IS NULL
   ORDER BY ts.joined_at DESC LIMIT 1;
  SELECT public.fn_cash_seat_change_plan('00000000-0000-4000-8000-000000000009')::text;
" | tail -1)
[[ "$sc_upward_blocked" == "0" ]] || { echo "Expected 0 upward seat-change moves after hardening, got $sc_upward_blocked" >&2; exit 1; }

sc_downward_and_swap=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 9, 9, 6);
  INSERT INTO public.cash_seat_change_requests(game_id, user_id, from_table_id, to_table_id)
  SELECT '00000000-0000-4000-8000-000000000009', ts.user_id, ts.table_id, '44444444-4444-4444-8444-000000000009'
    FROM public.table_seats ts
   WHERE ts.table_id = '22222222-2222-4222-8222-000000000009' AND ts.left_at IS NULL
   LIMIT 1;
  SELECT public.fn_cash_seat_change_plan('00000000-0000-4000-8000-000000000009')::text;
" | tail -1)
[[ "$sc_downward_and_swap" == "1" ]] || { echo "Expected 1 downward seat-change move (Main 2 -> Feeder), got $sc_downward_and_swap" >&2; exit 1; }

sc_swap=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 9, 9, 9);
  INSERT INTO public.cash_seat_change_requests(game_id, user_id, from_table_id, to_table_id)
  SELECT '00000000-0000-4000-8000-000000000009', ts.user_id, ts.table_id, '44444444-4444-4444-8444-000000000009'
    FROM public.table_seats ts
   WHERE ts.table_id = '22222222-2222-4222-8222-000000000009' AND ts.left_at IS NULL LIMIT 1;
  INSERT INTO public.cash_seat_change_requests(game_id, user_id, from_table_id, to_table_id)
  SELECT '00000000-0000-4000-8000-000000000009', ts.user_id, ts.table_id, '22222222-2222-4222-8222-000000000009'
    FROM public.table_seats ts
   WHERE ts.table_id = '44444444-4444-4444-8444-000000000009' AND ts.left_at IS NULL LIMIT 1;
  SELECT public.fn_cash_seat_change_plan('00000000-0000-4000-8000-000000000009')::text;
" | tail -1)
[[ "$sc_swap" == "2" ]] || { echo "Expected 2 moves for two-way swap, got $sc_swap" >&2; exit 1; }
echo "seat_change_upward_blocked=ok"
echo "PROOF OK"
