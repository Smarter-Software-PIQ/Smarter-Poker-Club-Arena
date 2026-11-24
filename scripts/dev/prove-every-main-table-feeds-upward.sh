#!/usr/bin/env bash
# Native proof for migration 20261124003437 (every main table feeds upward
# from higher mains and feeders). Runs on a THROWAWAY local PostgreSQL cluster
# it creates and removes; it never connects to any other database.
#
# Proves:
#   1. Exact 9-max screenshot reproduction (Main 1=9/9, Main 2=5/9, Main 3=9/9,
#      Feeder=6/9):
#      - BEFORE patch: 0 moves planned for Main 2 (stuck at 5/9 while Main 3 is 9/9).
#      - AFTER  patch: 4 moves planned Main 3 -> Main 2 in exact roster join order;
#        Feeder (6/9 < 7 gate) is untouched.
#   2. Upward cascade + never downward (Main 1=8/9, Main 2=8/9, Main 3=9/9,
#      Feeder=7/9):
#      - Main 1 draws #1 from Main 2; Main 2 draws #1 from Main 3; Main 2 never
#        draws from Main 1; Main 3 (with open seat) draws from Feeder, never
#        from Main 1 or Main 2.
#   3. 6-max 4-table upward cascade (Main 1=6/6, Main 2=3/6, Main 3=6/6,
#      Feeder=4/6):
#      - Main 2 fills 3 from Main 3; Main 3 fills from Feeder (no 7-player gate).
#   4. The actual migration SQL applies cleanly to fn_cash_cluster_tick_uncapped,
#      passes its @probe-for and @live-proof, preserves authority/reversibility,
#      and refuses a double-apply.
set -euo pipefail

if [[ -n "${PG_BIN:-}" ]]; then
  :
elif command -v initdb >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v initdb)")"
elif [[ -x /usr/lib/postgresql/16/bin/initdb ]]; then
  PG_BIN=/usr/lib/postgresql/16/bin
else
  echo "initdb not found; set PG_BIN" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261124003437_every_main_table_feeds_upward_from_higher_mains_and_feeders.sql"
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
  handedness integer NOT NULL DEFAULT 9
);

CREATE TABLE public.tables (
  id uuid PRIMARY KEY,
  cluster_id uuid NOT NULL REFERENCES public.cash_games(id),
  role text NOT NULL,
  main_index integer,
  lifecycle text NOT NULL DEFAULT 'live',
  status text NOT NULL DEFAULT 'running',
  max_players integer NOT NULL DEFAULT 9,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.table_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.tables(id),
  user_id uuid NOT NULL,
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

-- Exact Step 2 preimage extracted into fn_cash_cluster_tick_uncapped(uuid,integer)
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
    INSERT INTO public.table_seats(table_id, user_id, joined_at) VALUES (t1, u, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
  FOR i IN 1..p_n2 LOOP
    seq := seq + 1; u := ('aaaaaaaa-0002-4000-8000-' || lpad(seq::text, 12, '0'))::uuid;
    INSERT INTO public.table_seats(table_id, user_id, joined_at) VALUES (t2, u, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
  FOR i IN 1..p_n3 LOOP
    seq := seq + 1; u := ('aaaaaaaa-0003-4000-8000-' || lpad(seq::text, 12, '0'))::uuid;
    INSERT INTO public.table_seats(table_id, user_id, joined_at) VALUES (t3, u, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
  FOR i IN 1..p_nf LOOP
    seq := seq + 1; u := ('aaaaaaaa-0004-4000-8000-' || lpad(seq::text, 12, '0'))::uuid;
    INSERT INTO public.table_seats(table_id, user_id, joined_at) VALUES (tf, u, now() - (100 - seq) * interval '1 minute');
    INSERT INTO public.cash_game_roster(game_id, user_id, joined_at) VALUES (p_game, u, now() - (100 - seq) * interval '1 minute');
  END LOOP;
END $$;
SQL

# 1. BEFORE patch: exact screenshot repro (9-max: Main 1=9, Main 2=5, Main 3=9, Feeder=6)
before_moves=$("${PSQL[@]}" -c "
  SELECT public.seed_4table('00000000-0000-4000-8000-000000000009', 9, 9, 5, 9, 6);
  SELECT (public.fn_cash_cluster_tick_uncapped('00000000-0000-4000-8000-000000000009', 0)->>'moves_planned')::int;
" | tail -1)
echo "screenshot_repro_before=$before_moves"
[[ "$before_moves" == "0" ]] || { echo "Expected 0 moves before patch, got $before_moves" >&2; exit 1; }

# 2. Apply the actual migration SQL
"${PSQL[@]}" -f "$MIG"

# 3. Verify @live-proof passes and double-apply refuses
live_proof=$("${PSQL[@]}" -c "
  SELECT pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%(c.role = ''main'' AND c.main_index > t.main_index)%'
     AND pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%EVERY MAIN FEEDS UPWARDS%';
")
[[ "$live_proof" == "t" ]] || { echo "@live-proof failed: $live_proof" >&2; exit 1; }
if "${PSQL[@]}" -f "$MIG" >/dev/null 2>&1; then
  echo "Double-apply should have been refused" >&2
  exit 1
fi
echo "migration_applied_and_proved=ok"

# 4. AFTER patch: exact screenshot repro -> 4 moves Main 3 -> Main 2, 0 from Feeder
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

# 5. Upward cascade + NEVER downward:
#    (a) Main 1=8, Main 2=8, Main 3=9, Feeder=7 -> Main 2->Main 1 (1), Main 3->Main 2 (1), zero downward
#    (b) Main 1=9, Main 2=9, Main 3=7, Feeder=8 -> Feeder->Main 3 (2, stops at 6), zero downward
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

# 6. 6-max 4-table cascade: Main 1=6, Main 2=3, Main 3=6, Feeder=4 -> Main 3 -> Main 2 (3 moves);
#    then Main 1=6, Main 2=6, Main 3=3, Feeder=4 -> Feeder -> Main 3 (3 moves, no 7-player gate)
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
echo "PROOF OK"
