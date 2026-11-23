#!/usr/bin/env bash
# Native proof for migrations 20261123024428 and 20261123024433 (cash locks
# take one order). Runs on a THROWAWAY local PostgreSQL cluster it
# creates and removes; it never connects to any other database.
#
# It installs the LIVE bodies of the functions that deadlocked, byte for byte
# (each is read from a file in this repository and its md5 is checked against
# the md5 production reported for it on 2026-11-23), over stub tables and stub
# helpers. Pause hooks in the stubs (a credit, a reporting upsert, a funding
# read, a session-row update) hold each side at the point production's log
# shows it waiting, so every interleaving is forced, not hoped for. Then:
#
#   before  the four production deadlocks reproduce: Postgres answers
#           "deadlock detected" for each pair.
#   after   the two migrations (their probes removed: they need production
#           rows) are applied and the same pairs both commit, with the money
#           each side should move.
#   swap    the buy-in alone is put back to its live body: a horse buyer then
#           deadlocks with the new cash-out, which is why the buy-in moves too.
#
# Usage: bash scripts/dev/prove-cash-locks-take-one-order.sh
#   (as root it runs the server as the postgres user; PG_BIN to override)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
AS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; AS=(runuser -u postgres --); fi
trap '"${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"${AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p 5547 -c deadlock_timeout=1s" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p 5547 -U postgres -d postgres)

# ---------------------------------------------------------------- stub schema
"${PSQL[@]}" <<'SQL'
CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION proof_pause(p text) RETURNS void LANGUAGE sql
  AS $$SELECT pg_sleep(coalesce(nullif(current_setting('proof.' || p, true), ''), '0')::float8)$$;

CREATE TABLE profiles(id uuid PRIMARY KEY, is_horse boolean, is_vip boolean, vip_expires_at timestamptz);
CREATE TABLE clubs(id uuid PRIMARY KEY, asset text DEFAULT 'chips', union_id uuid, owner_id uuid,
  hit_run_enabled boolean DEFAULT true, hit_run_hands integer DEFAULT 10);
CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, tournament_id uuid, union_id uuid,
  is_private boolean DEFAULT true, current_players integer DEFAULT 0, status text DEFAULT 'running',
  min_buy_in numeric, max_buy_in numeric, max_players integer DEFAULT 9, is_vip_only boolean,
  is_template boolean, big_blind numeric DEFAULT 2, last_human_seen_at timestamptz);
CREATE TABLE table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid,
  seat_number integer, stack numeric, joined_at timestamptz DEFAULT now(), left_at timestamptz,
  leave_pending boolean DEFAULT false, occupancy_id uuid DEFAULT gen_random_uuid(), club_id uuid,
  status text, auto_rebuy boolean, is_sitting_out boolean DEFAULT false);
CREATE UNIQUE INDEX ON table_seats(table_id, seat_number) WHERE left_at IS NULL;
CREATE TABLE club_members(user_id uuid, club_id uuid, chip_balance numeric, role text DEFAULT 'member',
  updated_at timestamptz, PRIMARY KEY(user_id, club_id));
CREATE TABLE club_table_daily(club_id uuid, table_id uuid, stat_date date, buyins numeric, cashouts numeric,
  PRIMARY KEY(club_id, table_id, stat_date));
CREATE TABLE wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, wallet_type text,
  type text, amount numeric, category text, description text, table_id uuid, balance_after numeric);
CREATE TABLE proof_credit_keys(key text PRIMARY KEY);
CREATE TABLE seat_cashout_receipts(occupancy_id uuid PRIMARY KEY, user_id uuid, table_id uuid, seat_id uuid,
  seat_number integer, receipt jsonb);
CREATE TABLE seat_departure_requests(occupancy_id uuid, user_id uuid, table_id uuid, seat_number integer, leave_mode text);
CREATE TABLE seat_admin_departure_authorizations(occupancy_id uuid, user_id uuid, table_id uuid, seat_number integer);
CREATE TABLE tournaments(id uuid PRIMARY KEY);
CREATE TABLE table_pending_addons(id uuid PRIMARY KEY, table_id uuid, user_id uuid, amount numeric,
  created_at timestamptz DEFAULT now(), resolved_at timestamptz, applied_to_stack numeric, refunded numeric);
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, table_id uuid, post_commit_payload jsonb,
  post_commit_completed_at timestamptz);
CREATE TABLE smarter_private.cash_seat_occupancy_history(seat_id uuid, user_id uuid, joined_at timestamptz,
  table_id uuid, occupancy_id uuid, club_id uuid, seat_number integer, stack_at_end numeric,
  ended_at timestamptz, end_kind text, UNIQUE(seat_id, user_id, joined_at));
CREATE TABLE engine_table_leases(table_id uuid PRIMARY KEY, instance_id text, lease_generation uuid,
  protocol_version integer, heartbeat_at timestamptz);
CREATE TABLE cash_hand_participant_manifests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid,
  hand_number bigint, lease_instance_id text, lease_generation uuid, request jsonb, game_scope jsonb,
  participants jsonb, issues jsonb, funding_provenance_complete boolean, UNIQUE(table_id, hand_number));
CREATE TABLE smarter_private.cash_hand_chair_clubs(table_id uuid, hand_number bigint, user_id uuid,
  seat_id uuid, occupancy_id uuid, seat_joined_at timestamptz, club_id uuid);
CREATE TABLE cash_participant_funding_receipts(id uuid PRIMARY KEY, funding_club_id uuid, funding_union_id uuid,
  asset text, pending_addon_id uuid, occupancy_id uuid);
CREATE TABLE cash_funding_application_receipts(funding_receipt_id uuid, pending_addon_id uuid, applied numeric,
  applied_occupancy_id uuid);
CREATE TABLE financial_alerts(id bigserial, severity text, source text, message text, context jsonb,
  resolved boolean DEFAULT false);
CREATE TABLE blacklists(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, club_id uuid, union_id uuid, expires_at timestamptz);
CREATE TABLE table_waitlist(table_id uuid, user_id uuid, status text, hold_expires_at timestamptz, notified_at timestamptz);
CREATE TABLE cash_cluster_feeder_starts(main_table_id uuid, held integer);
CREATE TABLE cash_seat_moves(to_table_id uuid, state text, swap_move_id uuid, player_id uuid);
CREATE TABLE transaction_idempotency_keys(key uuid PRIMARY KEY, user_id uuid, action text, amount numeric);
CREATE TABLE cash_player_session(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, scope_type text,
  scope_id uuid, table_id uuid, cluster_id uuid, closed_at timestamptz, baseline numeric, bb numeric,
  stay_remaining_ms bigint DEFAULT 0, stay_running boolean DEFAULT false, stay_last_tick_at timestamptz,
  stay_clock_ms bigint DEFAULT 0, hr_hands_required integer DEFAULT 0, hr_hands_played integer DEFAULT 0,
  hr_reference_stack numeric, hr_doubles integer DEFAULT 0, hr_completed boolean DEFAULT false,
  hr_last_hand_ref text, hr_started_at timestamptz, hr_engine_ack boolean DEFAULT false,
  hr_big_win_hand_ref text, hr_big_win_at timestamptz, hr_big_win_required integer DEFAULT 0,
  hr_big_win_played integer DEFAULT 0, hr_big_win_net numeric, hr_big_win_bb numeric,
  big_pot_hand_ref text, hands_since_big_pot integer, start_basis numeric, hr_blind_off boolean DEFAULT false);
CREATE TABLE lightning_pool_session(id uuid PRIMARY KEY, cash_player_session_id uuid, exited_at timestamptz);
CREATE TABLE hand_history(id uuid PRIMARY KEY, big_blind numeric);

-- The credit: one ledger key once, the member row, and the journal row whose
-- reporting trigger upserts the table's shared daily row. Then the pause.
CREATE FUNCTION public.atomic_credit_wallet_and_log(p_user_id uuid, p_amount numeric, p_category text,
  p_description text, p_table_id uuid, p_a uuid, p_b uuid, p_key text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE v_bal numeric;
BEGIN
  INSERT INTO proof_credit_keys VALUES (p_key) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE club_members SET chip_balance = chip_balance + p_amount WHERE user_id = p_user_id RETURNING chip_balance INTO v_bal;
  INSERT INTO wallet_transactions(user_id, wallet_type, type, amount, category, description, table_id, balance_after)
  VALUES (p_user_id, 'PLAYER', 'credit', p_amount, p_category, p_description, p_table_id, v_bal);
  PERFORM proof_pause('pause_after_credit');
  RETURN v_bal;
END $$;
CREATE FUNCTION proof_reporting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.table_id IS NOT NULL AND NEW.category IN ('buyin','cashout','addon','rebuy','refund') THEN
    INSERT INTO club_table_daily AS d(club_id, table_id, stat_date, buyins, cashouts)
    SELECT t.club_id, NEW.table_id, current_date,
           CASE WHEN NEW.type = 'debit' THEN NEW.amount ELSE 0 END,
           CASE WHEN NEW.type = 'credit' THEN NEW.amount ELSE 0 END
      FROM tables t WHERE t.id = NEW.table_id
    ON CONFLICT (club_id, table_id, stat_date) DO UPDATE
      SET buyins = d.buyins + EXCLUDED.buyins, cashouts = d.cashouts + EXCLUDED.cashouts;
    PERFORM proof_pause('pause_after_report');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER ca_reporting_wallet_insert AFTER INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION proof_reporting();
CREATE FUNCTION proof_session_pause() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM proof_pause('pause_session'); RETURN NEW; END $$;
CREATE TRIGGER proof_session_pause BEFORE UPDATE ON cash_player_session FOR EACH ROW EXECUTE FUNCTION proof_session_pause();

CREATE FUNCTION public.fn_cash_session_close(uuid, uuid, numeric, text) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_session_open(uuid, uuid, numeric) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_session_add_baseline(uuid, uuid, numeric) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_record_funding_application(uuid, numeric, numeric, uuid) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_leave_check(uuid, uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"allowed":true}'::jsonb$$;
CREATE FUNCTION public.fn_cash_rejoin_floor(uuid, uuid) RETURNS numeric LANGUAGE sql AS 'SELECT NULL::numeric';
CREATE FUNCTION public.fn_nit_career_check(uuid, uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":true}'::jsonb$$;
CREATE FUNCTION public.fn_cash_main_chair_is_the_lists(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.fn_seat_club_for_user(p_user uuid, p_table uuid, p_club uuid) RETURNS uuid LANGUAGE sql
  AS 'SELECT coalesce(p_club, (SELECT club_id FROM club_members WHERE user_id = p_user LIMIT 1))';
CREATE FUNCTION public.fn_ensure_club_wallet(uuid, uuid) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_record_original_funding(text, text, uuid, uuid, uuid, uuid, uuid, numeric, numeric, uuid)
  RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_engine_lease_stale_seconds() RETURNS integer LANGUAGE sql AS 'SELECT 30';
CREATE FUNCTION public.fn_cash_original_funding_lineage(uuid, uuid, uuid, uuid, timestamptz, timestamptz, boolean)
  RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM proof_pause('pause_lineage'); RETURN '{"funding_receipts":[],"issues":[]}'::jsonb; END $$;
CREATE FUNCTION smarter_private.cash_initial_funding_receipt(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.fn_cash_stay_remaining_ms(bigint, boolean, timestamptz) RETURNS integer LANGUAGE sql
  AS 'SELECT coalesce($1, 0)::integer';
CREATE FUNCTION public.fn_cash_hit_run_house_take(uuid, uuid) RETURNS numeric LANGUAGE sql AS 'SELECT 0::numeric';
CREATE FUNCTION public.fn_cash_hand_net(uuid, uuid, text) RETURNS numeric LANGUAGE sql AS 'SELECT NULL::numeric';
CREATE FUNCTION public.fn_cash_hit_run_hands_remaining(integer, integer, boolean, boolean, numeric, numeric)
  RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.fn_cash_big_win_hands_remaining(integer, integer, boolean, numeric)
  RETURNS integer LANGUAGE sql AS 'SELECT 0';
SQL

# --------------------------------------------- live bodies, byte for byte
python3 -I - "$ROOT" >"$WORK/live.sql" <<'PY'
import json, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
def migration(path, fn):
    s = (root / 'supabase/migrations' / path).read_text()
    i = s.index('CREATE OR REPLACE FUNCTION ' + fn + '(')
    m = re.compile(r'AS (\$[A-Za-z_]*\$)').search(s, i)
    b = s.index(m.group(1), m.end())
    return s[i:b + len(m.group(1))] + ';\n'
def fixture(path, sig):
    rows = []
    def walk(o):
        if isinstance(o, dict):
            if o.get('signature') == sig and 'definition' in o:
                rows.append(o['definition'])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(json.loads((root / 'tests/fixtures/promo-profit-movements' / path).read_text()))
    return rows[0].rstrip().rstrip(';') + ';\n'
out = ['SET check_function_bodies = off;\n',
  migration('20261114050737_charles_rule_countdown_resumes_where_it_left_off.sql', 'public.fn_cash_session_evaluate'),
  migration('20261119013426_an_ended_seat_settles_its_pending_addons.sql', 'smarter_private.fn_record_ended_seat_occupancy'),
  migration('20261119005831_a_refused_dealt_manifest_is_named_at_its_source.sql', 'public.fn_cash_capture_hand_manifest'),
  migration('20261119005831_a_refused_dealt_manifest_is_named_at_its_source.sql', 'smarter_private.original_inventory_proof_sources_match'),
  migration('20261112022000_a_table_remembers_its_last_human.sql', 'public.fn_note_human_seat_seen'),
  fixture('money-owners.json', 'atomic_seat_cashout_locked(uuid,uuid,integer,text)'),
  fixture('money-owners.json', 'fn_cashout_seat_occupancy(uuid,uuid,integer,uuid,text)'),
  fixture('money-owners.json', 'resolve_pending_addon(uuid,numeric)'),
  fixture('money-dependencies.json', 'atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)'),
  'RESET check_function_bodies;\n']
sys.stdout.write(''.join(out))
PY
"${PSQL[@]}" -f "$WORK/live.sql"
# The md5 production reported for each body on 2026-11-23 (pg_get_functiondef).
"${PSQL[@]}" <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_cash_session_evaluate(uuid,jsonb)', '66ef93ee3fbec7d475a643e93fb3b9c6'),
    ('smarter_private.fn_record_ended_seat_occupancy()', '117c9107076e4b6a71c43ddd2cd68984'),
    ('public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)', '762527d29ffb4de1b4f6b375c61018f5'),
    ('smarter_private.original_inventory_proof_sources_match()', '3cfbfe6861d9e8be70cdbe7ceac87818'),
    ('public.fn_note_human_seat_seen()', 'e076918bb9c42284b47ac0670e970cf8'),
    ('public.atomic_seat_cashout_locked(uuid,uuid,integer,text)', 'e1b0b9702e75378ecac634c3a879502e'),
    ('public.fn_cashout_seat_occupancy(uuid,uuid,integer,uuid,text)', '2e60c4b66468b51061018a9058e9a395'),
    ('public.resolve_pending_addon(uuid,numeric)', '0abfcda28173f8251b4b3cff0ad52be6'),
    ('public.atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)', '25a657475b66ca0ff51bb3560e77d431')
  ) v(sig, live_md5) LOOP
    IF md5(pg_get_functiondef(r.sig::regprocedure)) <> r.live_md5 THEN
      RAISE EXCEPTION 'local body of % is not the production body', r.sig;
    END IF;
  END LOOP;
END $$;
-- The two seat triggers exactly as production defines them (pg_get_triggerdef).
CREATE TRIGGER zz_note_human_seat_seen AFTER INSERT OR DELETE OR UPDATE OF leave_pending, is_sitting_out
  ON public.table_seats FOR EACH ROW EXECUTE FUNCTION fn_note_human_seat_seen();
CREATE TRIGGER zz_record_ended_seat_occupancy AFTER UPDATE OF user_id, occupancy_id, left_at
  ON public.table_seats FOR EACH ROW
  WHEN (((old.user_id IS NOT NULL) AND ((old.user_id IS DISTINCT FROM new.user_id)
    OR (old.occupancy_id IS DISTINCT FROM new.occupancy_id) OR ((old.left_at IS NULL) AND (new.left_at IS NOT NULL)))))
  EXECUTE FUNCTION smarter_private.fn_record_ended_seat_occupancy();
CREATE TRIGGER zz_record_deleted_seat_occupancy AFTER DELETE ON table_seats
  FOR EACH ROW EXECUTE FUNCTION smarter_private.fn_record_ended_seat_occupancy();

-- One table, two seated players (Y sorts before X), a buyer, a pending add-on
-- of X that an open hand envelope owns, live sessions, and a live lease.
CREATE FUNCTION proof_reset(p_x_is_horse boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE profiles, clubs, tables, table_seats, club_members, club_table_daily, wallet_transactions,
    proof_credit_keys, seat_cashout_receipts, table_pending_addons, hand_atomic_commits,
    smarter_private.cash_seat_occupancy_history, engine_table_leases, cash_hand_participant_manifests,
    smarter_private.cash_hand_chair_clubs, cash_player_session, financial_alerts;
  INSERT INTO clubs(id) VALUES ('00000000-0000-4000-8000-0000000000c1');
  INSERT INTO tables(id, club_id, current_players) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 2);
  INSERT INTO profiles VALUES ('00000000-0000-4000-8000-000000000002', p_x_is_horse),  -- X, leaving
                              ('00000000-0000-4000-8000-000000000001', false),          -- Y, staying
                              ('00000000-0000-4000-8000-000000000003', false),          -- B, buying in
                              ('00000000-0000-4000-8000-000000000004', true);           -- H, a horse buying in
  INSERT INTO club_members(user_id, club_id, chip_balance)
  SELECT p.id, '00000000-0000-4000-8000-0000000000c1', 1000 FROM profiles p;
  INSERT INTO table_seats(id, table_id, user_id, seat_number, stack, club_id) VALUES
    ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002', 1, 100, '00000000-0000-4000-8000-0000000000c1'),
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 2, 100, '00000000-0000-4000-8000-0000000000c1');
  INSERT INTO table_pending_addons(id, table_id, user_id, amount) VALUES
    ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002', 20);
  INSERT INTO hand_atomic_commits VALUES ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1',
    '{"pending_addons":{"ids":["00000000-0000-4000-8000-0000000000d1"]}}', NULL);
  INSERT INTO cash_player_session(player_id, scope_type, scope_id, table_id, baseline)
  SELECT s.user_id, 'table', s.table_id, s.table_id, 100 FROM table_seats s;
  INSERT INTO engine_table_leases VALUES ('00000000-0000-4000-8000-0000000000a1', 'proof', '00000000-0000-4000-8000-0000000000b1', 2, now() + interval '1 hour');
END $$;
-- The next hand's participants exactly as the engine sends them.
CREATE FUNCTION proof_participants() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('user_id', s.user_id, 'seat_id', s.id, 'occupancy_id', s.occupancy_id,
    'seat_joined_at', s.joined_at, 'stack_before', s.stack, 'is_horse', false) ORDER BY s.seat_number)
    FROM table_seats s WHERE s.table_id = '00000000-0000-4000-8000-0000000000a1' AND s.left_at IS NULL $$;
SQL

T=00000000-0000-4000-8000-0000000000a1; X=00000000-0000-4000-8000-000000000002; Y=00000000-0000-4000-8000-000000000001
CASHOUT="SELECT (public.fn_cashout_seat_occupancy('$X','$T',1,(SELECT occupancy_id FROM table_seats WHERE id='00000000-0000-4000-8000-0000000000e2'),NULL))->>'ok'"
MANIFEST="SELECT (public.fn_cash_capture_hand_manifest('$T',1000001,proof_participants(),'proof','00000000-0000-4000-8000-0000000000b1'))->>'version'"
BUYIN_B="SELECT public.atomic_table_buyin_before_maintenance_announcement_gate('00000000-0000-4000-8000-000000000003','$T',3,100,false,'00000000-0000-4000-8000-0000000000c1',NULL)"
BUYIN_H="SELECT public.atomic_table_buyin_before_maintenance_announcement_gate('00000000-0000-4000-8000-000000000004','$T',3,100,false,'00000000-0000-4000-8000-0000000000c1',NULL)"
POSTCOMMIT="SELECT 1 FROM table_pending_addons WHERE id='00000000-0000-4000-8000-0000000000d1' FOR UPDATE; SELECT pg_sleep(2);
  SELECT applied::text FROM public.resolve_pending_addon('00000000-0000-4000-8000-0000000000d1', NULL);
  UPDATE hand_atomic_commits SET post_commit_completed_at = now() WHERE hand_id='00000000-0000-4000-8000-0000000000f1'"
EVAL_ENGINE="SELECT public.fn_cash_session_evaluate('$T', jsonb_build_array(jsonb_build_object('user_id','$X','stack',100,'active',true), jsonb_build_object('user_id','$Y','stack',100,'active',true)))"
EVAL_LIGHTNING="SELECT public.fn_cash_session_evaluate('$T', jsonb_build_array(jsonb_build_object('user_id','$Y','active',true), jsonb_build_object('user_id','$X','active',true)))"

# Two sessions: the first starts, the second $3 seconds later. Prints
# "deadlock" when Postgres refused either, "committed" when both committed.
pair() { # $1 x_is_horse  $2 session-one sql  $3 delay  $4 session-two sql
  "${PSQL[@]}" -c "SELECT proof_reset($1)" >/dev/null
  "${PSQL[@]}" -c "BEGIN; $2; SELECT 'committed'; COMMIT;" >"$WORK/one" 2>&1 &
  local one=$!
  sleep "$3"
  "${PSQL[@]}" -c "BEGIN; $4; SELECT 'committed'; COMMIT;" >"$WORK/two" 2>&1 &
  local two=$!
  wait "$one" || true; wait "$two" || true
  if grep -q 'deadlock detected' "$WORK/one" "$WORK/two"; then echo deadlock
  elif grep -qx committed "$WORK/one" && grep -qx committed "$WORK/two"; then echo committed
  else echo "unexpected: $(tr '\n' ' ' <"$WORK/one") | $(tr '\n' ' ' <"$WORK/two")"; fi
}
money() { "${PSQL[@]}" -c "SELECT string_agg(u || '=' || b, ' ' ORDER BY u) FROM (SELECT right(user_id::text, 1) u, chip_balance::int::text b FROM club_members) m"; }
scenarios() {
  A=$(pair true "SET LOCAL proof.pause_after_credit='2'; $CASHOUT" 0.5 "SET LOCAL proof.pause_lineage='2'; $MANIFEST"); echo "  cash-out vs manifest          : $A ($(money))"
  B=$(pair true "SET LOCAL proof.pause_after_credit='2'; $CASHOUT" 0.5 "$BUYIN_B"); echo "  cash-out vs human buy-in      : $B ($(money))"
  H=$(pair false "SET LOCAL proof.pause_after_report='2'; $BUYIN_H" 0.5 "$CASHOUT"); echo "  horse buy-in vs cash-out      : $H ($(money))"
  C=$(pair true "$POSTCOMMIT" 0.5 "$CASHOUT"); echo "  post-commit add-on vs cash-out: $C ($(money))"
  D=$(pair false "SET LOCAL proof.pause_session='1.5'; $EVAL_ENGINE" 0.3 "SET LOCAL proof.pause_session='1.5'; $EVAL_LIGHTNING"); echo "  engine vs Lightning evaluation: $D"
}

echo "before (the live bodies):"
scenarios
[ "$A" = deadlock ] && [ "$B" = deadlock ] && [ "$C" = deadlock ] && [ "$D" = deadlock ] \
  || { echo 'PROOF FAILED: a production deadlock did not reproduce on the live bodies' >&2; exit 1; }
BEFORE_H="$H"

for f in 20261123024428 20261123024433; do
  python3 -I -c 'import re,sys; s=open(sys.argv[1]).read(); sys.stdout.write(re.sub(r"-- @probe-for:[^\n]*\nDO (\$[a-z_]*\$).*?END \1;\n", "", s, flags=re.S))' \
    "$ROOT"/supabase/migrations/${f}_*.sql | "${PSQL[@]}" >/dev/null
done

echo "after (the two migrations applied):"
scenarios
[ "$A" = committed ] && [ "$B" = committed ] && [ "$H" = committed ] && [ "$C" = committed ] && [ "$D" = committed ] \
  || { echo 'PROOF FAILED: a pair still does not commit after the migrations' >&2; exit 1; }
# Money after the last scenario run (C): X cashed out 100 and was refunded the
# 20 add-on once; the post-commit resolved it as a refund, never applied.
"${PSQL[@]}" -c "SELECT proof_reset(true)" >/dev/null
pair true "$POSTCOMMIT" 0.5 "$CASHOUT" >/dev/null
[ "$("${PSQL[@]}" -c "SELECT chip_balance::int FROM club_members WHERE user_id='$X'")" = 1120 ] \
  && [ "$("${PSQL[@]}" -c "SELECT applied_to_stack::int || '/' || refunded::int FROM table_pending_addons")" = 0/20 ] \
  || { echo 'PROOF FAILED: the add-on or the cash-out did not settle exactly once' >&2; exit 1; }

echo "swap (the buy-in alone back on its live body, the cash-out new):"
"$PG_BIN/psql" -X -q -At -h "$WORK" -p 5547 -U postgres -d postgres \
  -c "SET check_function_bodies = off" -f <(python3 -I -c 'import sys; s=open(sys.argv[1]).read(); i=s.index("CREATE OR REPLACE FUNCTION public.atomic_table_buyin_before"); print(s[i:s.index("RESET check_function_bodies")])' "$WORK/live.sql") >/dev/null
H=$(pair false "SET LOCAL proof.pause_after_report='2'; $BUYIN_H" 0.5 "$CASHOUT"); echo "  horse buy-in vs cash-out      : $H"
[ "$H" = deadlock ] || { echo 'PROOF FAILED: the old buy-in did not deadlock with the new cash-out' >&2; exit 1; }
echo "  (before the migrations the same horse pair answered: $BEFORE_H)"
echo 'PROOF OK'
