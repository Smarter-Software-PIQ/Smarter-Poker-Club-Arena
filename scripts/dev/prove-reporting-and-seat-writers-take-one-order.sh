#!/usr/bin/env bash
# Native proof for migrations 20261123072817 (a reporting write is refused
# with its money) and 20261123072823 (every cash seat writer takes its table
# first). Runs on a THROWAWAY local PostgreSQL cluster it creates and removes;
# it never connects to any other database.
#
# Every function either migration edits is installed from production's own
# text, byte for byte: from the migration that last wrote it, or from
# scripts/dev/fixtures/one-lock-order-live-2026-11-23.json (read from
# production on 2026-11-23), and each md5(pg_get_functiondef) is checked
# against production's. The cash-out, the dealt manifest and the human-chair
# trigger they meet are installed the same way, then brought to production's
# current text by 20261123024433 (md5 checked again). Stub tables and stub
# helpers stand in for everything else; pause hooks in the stubs hold each
# side where production's log shows it waiting, so every interleaving is
# forced, not hoped for.
#
#   before  on the live bodies
#           * a rake bank whose Club Data row is held past the banker's 250ms
#             answers "banked" with its report missing (the swallowed 55P03),
#             for the fact path and for the club_table_daily path;
#           * the Lightning owed-leave return, the system leave, the Lightning
#             rejoin and the Lightning reversion each deadlock with a cash
#             path that holds the table and wants their seat.
#   after   both migrations applied (their probes removed: they need
#           production rows)
#           * the same rake bank answers "busy", writes nothing, and banks the
#             same amount once, with its report, when asked again;
#           * a deterministic reporting defect is still contained (banked);
#           * every pair commits.
#
# Usage: bash scripts/dev/prove-reporting-and-seat-writers-take-one-order.sh
#   (as root it runs the server as the postgres user; PG_BIN to override)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
AS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; AS=(runuser -u postgres --); fi
trap '"${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"${AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p 5546 -c deadlock_timeout=1s" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p 5546 -U postgres -d postgres)

# ---------------------------------------------------------------- stub schema
"${PSQL[@]}" <<'SQL'
CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('proof.uid', true), ''),
  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid$$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION proof_pause(p text) RETURNS void LANGUAGE sql
  AS $$SELECT pg_sleep(coalesce(nullif(current_setting('proof.' || p, true), ''), '0')::float8)$$;

CREATE TABLE profiles(id uuid PRIMARY KEY, is_horse boolean, is_vip boolean, vip_expires_at timestamptz);
CREATE TABLE clubs(id uuid PRIMARY KEY, asset text DEFAULT 'chips', union_id uuid, owner_id uuid,
  hit_run_enabled boolean DEFAULT true, hit_run_hands integer DEFAULT 10);
CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, tournament_id uuid, union_id uuid,
  is_private boolean DEFAULT true, current_players integer DEFAULT 0, status text DEFAULT 'running',
  min_buy_in numeric, max_buy_in numeric, max_players integer DEFAULT 9, is_vip_only boolean,
  is_template boolean, big_blind numeric DEFAULT 2, last_human_seen_at timestamptz, cluster_id uuid,
  dealing_halted_at timestamptz, dealing_halted_reason text, dealing_halt_observed_at timestamptz,
  is_deleted boolean, lifecycle text);
CREATE TABLE table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid,
  seat_number integer, stack numeric, joined_at timestamptz DEFAULT now(), left_at timestamptz,
  leave_pending boolean DEFAULT false, occupancy_id uuid DEFAULT gen_random_uuid(), club_id uuid,
  status text, auto_rebuy boolean, is_sitting_out boolean DEFAULT false);
CREATE UNIQUE INDEX ON table_seats(table_id, seat_number) WHERE left_at IS NULL;
CREATE TABLE club_members(user_id uuid, club_id uuid, chip_balance numeric, role text DEFAULT 'member',
  updated_at timestamptz, PRIMARY KEY(user_id, club_id));
CREATE TABLE club_table_daily(club_id uuid, table_id uuid, stat_date date, buyins numeric, cashouts numeric,
  rake numeric DEFAULT 0, PRIMARY KEY(club_id, table_id, stat_date));
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
  resolved boolean DEFAULT false, resolved_at timestamptz, resolution text);
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
CREATE TABLE hand_history(id uuid PRIMARY KEY, big_blind numeric);

-- Lightning: the cluster, its conversion and its pool, as the four seat
-- writers and the reversion read them.
CREATE TABLE cash_games(id uuid PRIMARY KEY, cluster_mode text, cluster_epoch integer DEFAULT 1,
  enabled boolean DEFAULT true, lightning_enabled boolean DEFAULT false, updated_at timestamptz);
CREATE TABLE cash_cluster_conversion(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid,
  conversion_request_id uuid, to_mode text, status text, epoch_after integer, abort_reason text,
  trigger_population integer, on_threshold integer, off_threshold integer, closed_at timestamptz,
  chips_at_commit numeric);
CREATE TABLE lightning_instance(cluster_id uuid, state text);
CREATE TABLE lightning_pool_session(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cash_player_session_id uuid,
  exited_at timestamptz, cluster_id uuid, entered_at timestamptz DEFAULT now(), exit_reason text, state text,
  ending_stack numeric, updated_at timestamptz, cluster_epoch integer, player_id uuid, anchor_seat_id uuid);
CREATE TABLE lightning_blind_ledger(cluster_id uuid, player_id uuid, owed numeric);
CREATE TABLE lightning_cluster_drain(cluster_id uuid, completed_at timestamptz);
CREATE TABLE cash_cluster_events(id bigserial, game_id uuid, table_id uuid, kind text, payload jsonb,
  cluster_epoch integer, request_id uuid);
CREATE TABLE lightning_pool_slot(cluster_id uuid, opened_at timestamptz, closed_at timestamptz,
  close_reason text, updated_at timestamptz);
CREATE TABLE lightning_reservation(player_id uuid, cluster_id uuid, state text, resolved_at timestamptz, reason text);
CREATE FUNCTION public.fn_cash_cluster_lightning_state(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.fn_cash_cluster_abort_pending_off(uuid, uuid, text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.fn_lightning_pool_stack(uuid) RETURNS numeric LANGUAGE plpgsql AS $$
BEGIN PERFORM proof_pause('pause_pool_stack'); RETURN 0; END $$;
CREATE FUNCTION public.fn_lightning_player_in_hand(uuid, uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN PERFORM proof_pause('pause_in_hand'); RETURN false; END $$;
CREATE FUNCTION public.fn_lightning_player_live_hand(uuid, uuid) RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
CREATE FUNCTION public.fn_cash_game_barred_seconds(uuid, uuid) RETURNS integer LANGUAGE sql AS 'SELECT NULL::integer';
CREATE FUNCTION public.fn_ca_declare_ledger(text, text, uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM proof_pause('pause_declare'); END $$;

-- The rake bank: its stored obligations, the wallets it never waits for, and
-- the distribution, which journals the rake (firing the two rake reporting
-- triggers) before it credits the club bank, in production's order.
CREATE TABLE union_wallets(union_id uuid PRIMARY KEY);
CREATE TABLE club_wallets(club_id uuid PRIMARY KEY, chip_balance numeric);
CREATE TABLE cash_rake_pending(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint, amount numeric,
  rake jsonb, attempts integer DEFAULT 0, last_attempt_at timestamptz, last_error text, terminal_epoch bigint,
  terminal_at timestamptz);
CREATE TABLE rake_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(),
  table_id uuid, club_id uuid, hand_id uuid, rake_amount numeric, tournament_id uuid,
  is_tournament boolean DEFAULT false, player_contributions jsonb, metadata jsonb DEFAULT '{}');
CREATE FUNCTION smarter_private.money_law_epoch() RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
CREATE FUNCTION public.atomic_distribute_rake(p_table uuid, p_club uuid, p_hand uuid, p_hand_number integer,
  p_amount numeric, p_bbj numeric, p_pot numeric, p_num integer, p_contrib jsonb, p_tourn uuid,
  p_returned jsonb, p_method text)
  RETURNS TABLE(applied boolean, already_processed boolean, recovered boolean, rake_record_id uuid,
                spendable_route text, union_id_out uuid) LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO rake_records(table_id, club_id, hand_id, rake_amount, player_contributions)
  VALUES (p_table, p_club, p_hand, p_amount, p_contrib) RETURNING id INTO v_id;
  UPDATE club_wallets SET chip_balance = chip_balance + p_amount WHERE club_id = p_club;
  RETURN QUERY SELECT true, false, false, v_id, 'club'::text, NULL::uuid;
END $$;

-- Club Data: the legacy game row a table's buy-ins and rakes share, the
-- Pacific fact and journal, and the helpers the live bodies call.
CREATE TABLE ca_club_data_game_ct(club_id uuid, game_id uuid, stat_date date, fee numeric DEFAULT 0,
  buyins numeric DEFAULT 0, PRIMARY KEY(club_id, game_id, stat_date));
CREATE FUNCTION public.fn_ca_club_data_fact_put_pre_pacific(p_club uuid, p_day date, p_kind text, p_game uuid,
  p_user uuid, p_fee numeric, p_buyins numeric, p_cashouts numeric, p_winnings numeric, p_at timestamptz)
  RETURNS void LANGUAGE sql AS $$
  INSERT INTO ca_club_data_game_ct AS g(club_id, game_id, stat_date, fee, buyins)
  VALUES (p_club, p_game, p_day, coalesce(p_fee, 0), coalesce(p_buyins, 0))
  ON CONFLICT (club_id, game_id, stat_date) DO UPDATE SET fee = g.fee + EXCLUDED.fee, buyins = g.buyins + EXCLUDED.buyins;
$$;
CREATE FUNCTION public.fn_ca_club_data_hand_put_pre_pacific(uuid, uuid, timestamptz) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_ca_club_data_pacific_day(timestamptz) RETURNS date LANGUAGE sql
  AS $$SELECT ($1 AT TIME ZONE 'America/Los_Angeles')::date$$;
CREATE FUNCTION public.fn_ca_club_data_pacific_own(text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE TABLE ca_club_data_pacific_fact(club_id uuid, utc_day date, stat_date date, kind text, game_id uuid,
  user_id uuid, fee numeric, buyins numeric, cashouts numeric, winnings numeric, last_at timestamptz,
  src integer, legacy_recorded boolean, hands integer,
  UNIQUE(club_id, stat_date, game_id, user_id, utc_day, src, legacy_recorded));
CREATE TABLE ca_club_data_pacific_journal (LIKE ca_club_data_pacific_fact);
CREATE TABLE ca_club_data_pacific_failures(club_id uuid, utc_day date, source text, detail text);
CREATE TABLE ca_club_data_pacific_cash_records(rake_record_id uuid, utc_day date, stat_date date, game_id uuid,
  source_at timestamptz, players uuid[], clubs uuid[]);
CREATE TABLE ca_club_data_pacific_cash_observations(rake_record_id uuid, user_id uuid, utc_day date,
  stat_date date, game_id uuid, source_at timestamptz, src integer, club_id uuid, other uuid, fee numeric,
  legacy_recorded boolean, live boolean);
CREATE TABLE ca_club_data_pacific_hands(club_id uuid, utc_day date, stat_date date, table_id uuid,
  hands integer, src integer, UNIQUE(club_id, stat_date, table_id, utc_day, src));
CREATE TABLE ca_club_data_pacific_hands_journal (LIKE ca_club_data_pacific_hands);
CREATE FUNCTION public.fn_ca_club_data_pacific_cash_parts(uuid)
  RETURNS TABLE(game_id uuid, source_at timestamptz, user_id uuid) LANGUAGE sql
  AS 'SELECT NULL::uuid, NULL::timestamptz, NULL::uuid WHERE false';
CREATE FUNCTION public.fn_ca_club_data_clubs(uuid) RETURNS uuid[] LANGUAGE sql AS 'SELECT ARRAY[$1]';
CREATE FUNCTION public.fn_ca_club_data_fact_live_from() RETURNS timestamptz LANGUAGE sql AS $$SELECT '-infinity'::timestamptz$$;
CREATE FUNCTION public.fn_ca_cash_seat_club(uuid, uuid) RETURNS uuid LANGUAGE sql AS 'SELECT club_id FROM tables WHERE id = $1';
CREATE FUNCTION public.fn_ca_cash_reporting_club(uuid, uuid, uuid) RETURNS uuid LANGUAGE sql AS 'SELECT $2';
CREATE FUNCTION public.fn_ca_launch_accounting_accepts(uuid, timestamptz) RETURNS boolean LANGUAGE sql AS 'SELECT true';
-- The table rollup: the shared club_table_daily row. proof.defect turns it
-- into a deterministic defect (division by zero).
CREATE FUNCTION public.fn_ca_club_table_daily_add_rake(p_table uuid, p_rake numeric, p_at timestamptz, p_contrib jsonb)
  RETURNS void LANGUAGE sql AS $$
  SELECT 1 / CASE WHEN current_setting('proof.defect', true) = 'on' THEN 0 ELSE 1 END;
  INSERT INTO club_table_daily AS d(club_id, table_id, stat_date, buyins, cashouts, rake)
  SELECT t.club_id, p_table, (p_at AT TIME ZONE 'UTC')::date, 0, 0, p_rake FROM tables t WHERE t.id = p_table
  ON CONFLICT (club_id, table_id, stat_date) DO UPDATE SET rake = d.rake + EXCLUDED.rake;
$$;

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
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER ca_reporting_wallet_insert AFTER INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION proof_reporting();

CREATE FUNCTION public.fn_cash_session_close(uuid, uuid, numeric, text) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_session_open(uuid, uuid, numeric) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_session_add_baseline(uuid, uuid, numeric) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_cash_record_funding_application(uuid, numeric, numeric, uuid) RETURNS void LANGUAGE sql AS '';
-- proof.owed makes the leave door report hands still owed (the owed-leave case);
-- proof.pause_leave_check holds the caller there.
CREATE FUNCTION public.fn_cash_leave_check(uuid, uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM proof_pause('pause_leave_check');
  RETURN jsonb_build_object('allowed', coalesce(nullif(current_setting('proof.owed', true), ''), '0') = '0',
                            'hands_remaining', coalesce(nullif(current_setting('proof.owed', true), ''), '0')::integer);
END $$;
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
live = json.loads((root / 'scripts/dev/fixtures/one-lock-order-live-2026-11-23.json').read_text())
out = ['SET check_function_bodies = off;\n',
  # what 20261123024433 edits, at the text it edited (brought current below)
  migration('20261119013426_an_ended_seat_settles_its_pending_addons.sql', 'smarter_private.fn_record_ended_seat_occupancy'),
  migration('20261119005831_a_refused_dealt_manifest_is_named_at_its_source.sql', 'public.fn_cash_capture_hand_manifest'),
  migration('20261119005831_a_refused_dealt_manifest_is_named_at_its_source.sql', 'smarter_private.original_inventory_proof_sources_match'),
  migration('20261112022000_a_table_remembers_its_last_human.sql', 'public.fn_note_human_seat_seen'),
  fixture('money-owners.json', 'atomic_seat_cashout_locked(uuid,uuid,integer,text)'),
  fixture('money-owners.json', 'fn_cashout_seat_occupancy(uuid,uuid,integer,uuid,text)'),
  fixture('money-dependencies.json', 'atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)'),
  # what the two new migrations edit, at production's text
  migration('20261017204111_the_club_data_report_reads_what_the_club_played.sql', 'public.trg_ca_reporting_rake_insert'),
  migration('20261017204111_the_club_data_report_reads_what_the_club_played.sql', 'public.trg_ca_reporting_wallet_insert'),
  migration('20261017160125_club_data_counts_what_the_club_played.sql', 'public.trg_ca_club_data_fact_wallet'),
  migration('20260908214235_seat_expiry_follows_cashout_lock_order.sql', 'public.player_leave_table'),
  migration('20261026212123_lucky_owner_requested_account_balance.sql', 'public.fn_lightning_rejoin_seated')]
out += [f['definition'] + ';\n' for f in live['functions']]
out.append('RESET check_function_bodies;\n')
sys.stdout.write(''.join(out))
PY
"${PSQL[@]}" -f "$WORK/live.sql"

# The md5 production reported for each body on 2026-11-23 (pg_get_functiondef).
check_md5() { # $1 = SQL VALUES rows (signature, md5)
  "${PSQL[@]}" -c "DO \$\$ DECLARE r record; BEGIN
    FOR r IN SELECT * FROM (VALUES $1) v(sig, live_md5) LOOP
      IF md5(pg_get_functiondef(r.sig::regprocedure)) <> r.live_md5 THEN
        RAISE EXCEPTION 'local body of % is not the production body', r.sig;
      END IF;
    END LOOP; END \$\$;"
}
check_md5 "('public.trg_ca_reporting_rake_insert()', '6bf0f89ba4e8e3b2c58ff91cd93ac869'),
  ('public.trg_ca_reporting_wallet_insert()', '95a73948ec5ce91c83060dfc4411bb2d'),
  ('public.trg_ca_club_data_fact_wallet()', 'fc3aecf79531fc9a9fb9f512b8307e6f'),
  ('public.player_leave_table(uuid,uuid)', 'cbab2d426b0ec091b5b09f3e76eec640'),
  ('public.fn_lightning_rejoin_seated(uuid)', '32af76559cdf9367553430b358da380c'),
  ('public.fn_note_human_seat_seen()', 'e076918bb9c42284b47ac0670e970cf8'),
  ('public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)', '762527d29ffb4de1b4f6b375c61018f5')"
python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(", ".join("(%s, %s)" % ("'"'"'"+f["signature"]+"'"'"'", "'"'"'"+f["production_md5"]+"'"'"'") for f in d["functions"]))' \
  "$ROOT/scripts/dev/fixtures/one-lock-order-live-2026-11-23.json" >"$WORK/fixture_md5"
check_md5 "$(cat "$WORK/fixture_md5")"

# Production's triggers on the tables these bodies write (pg_get_triggerdef).
"${PSQL[@]}" <<'SQL'
CREATE TRIGGER zz_note_human_seat_seen AFTER INSERT OR DELETE OR UPDATE OF leave_pending, is_sitting_out
  ON public.table_seats FOR EACH ROW EXECUTE FUNCTION fn_note_human_seat_seen();
CREATE TRIGGER zz_record_ended_seat_occupancy AFTER UPDATE OF user_id, occupancy_id, left_at
  ON public.table_seats FOR EACH ROW
  WHEN (((old.user_id IS NOT NULL) AND ((old.user_id IS DISTINCT FROM new.user_id)
    OR (old.occupancy_id IS DISTINCT FROM new.occupancy_id) OR ((old.left_at IS NULL) AND (new.left_at IS NOT NULL)))))
  EXECUTE FUNCTION smarter_private.fn_record_ended_seat_occupancy();
CREATE TRIGGER zz_record_deleted_seat_occupancy AFTER DELETE ON table_seats
  FOR EACH ROW EXECUTE FUNCTION smarter_private.fn_record_ended_seat_occupancy();
CREATE TRIGGER ca_club_data_fact_rake AFTER INSERT ON public.rake_records FOR EACH ROW EXECUTE FUNCTION trg_ca_club_data_fact_rake();
CREATE TRIGGER ca_reporting_rake_insert AFTER INSERT ON public.rake_records FOR EACH ROW EXECUTE FUNCTION trg_ca_reporting_rake_insert();
SQL

# The cash-out, the buy-in and the seat exit trigger as production runs them
# today: 20261123024433 applied over the text it edited (probes removed).
python3 -I -c 'import re,sys; s=open(sys.argv[1]).read(); sys.stdout.write(re.sub(r"-- @probe-for:[^\n]*\nDO (\$[a-z_]*\$).*?END \1;\n", "", s, flags=re.S))' \
  "$ROOT"/supabase/migrations/20261123024433_*.sql | "${PSQL[@]}" >/dev/null
check_md5 "('public.atomic_seat_cashout_locked(uuid,uuid,integer,text)', '9015556503f3641fc303b8ccf1ef0cc4'),
  ('public.fn_cashout_seat_occupancy(uuid,uuid,integer,uuid,text)', '62dccbe25b6c5ec893014d475d6272e1'),
  ('smarter_private.fn_record_ended_seat_occupancy()', '2ab77217cf77dd04219df65b599843aa'),
  ('public.atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)', '6ce3b241e8c5e90b9022bd96ab36e2d8')"

# ------------------------------------------------------------------ fixtures
C=00000000-0000-4000-8000-0000000000c1; T=00000000-0000-4000-8000-0000000000a1; G=00000000-0000-4000-8000-0000000000b9
X=00000000-0000-4000-8000-000000000002; Y=00000000-0000-4000-8000-000000000001; B=00000000-0000-4000-8000-000000000003
H=00000000-0000-4000-8000-0000000000f9; R=00000000-0000-4000-8000-0000000000aa
"${PSQL[@]}" <<SQL
-- One club and table in a Lightning cluster; X (leaving, a human) at chair 1
-- with a voluntary departure pending, Y at chair 2, both with sessions; a
-- live lease; one stored hand rake of 10 split between X and Y; an empty club
-- bank; and a pending reversion of the cluster with Y in its pool.
CREATE FUNCTION proof_reset(p_mode text) RETURNS void LANGUAGE plpgsql AS \$\$
BEGIN
  TRUNCATE profiles, clubs, tables, table_seats, club_members, club_table_daily, wallet_transactions,
    proof_credit_keys, seat_cashout_receipts, table_pending_addons, hand_atomic_commits, seat_departure_requests,
    smarter_private.cash_seat_occupancy_history, engine_table_leases, cash_hand_participant_manifests,
    smarter_private.cash_hand_chair_clubs, cash_player_session, financial_alerts, cash_games,
    cash_cluster_conversion, lightning_instance, lightning_pool_session, lightning_blind_ledger,
    cash_cluster_events, lightning_pool_slot, lightning_reservation, cash_rake_pending, rake_records,
    club_wallets, ca_club_data_game_ct, ca_club_data_pacific_fact, ca_club_data_pacific_journal,
    ca_club_data_pacific_failures, ca_club_data_pacific_hands, ca_club_data_pacific_hands_journal;
  INSERT INTO clubs(id) VALUES ('$C');
  INSERT INTO cash_games(id, cluster_mode) VALUES ('$G', p_mode);
  INSERT INTO tables(id, club_id, current_players, cluster_id, dealing_halted_at, dealing_halted_reason)
  VALUES ('$T', '$C', 2, '$G', CASE WHEN p_mode = 'pending_off' THEN now() END,
          CASE WHEN p_mode = 'pending_off' THEN 'lightning' END);
  INSERT INTO profiles VALUES ('$X', false), ('$Y', false), ('$B', false);
  INSERT INTO club_members(user_id, club_id, chip_balance) SELECT p.id, '$C', 1000 FROM profiles p;
  INSERT INTO table_seats(id, table_id, user_id, seat_number, stack, club_id, leave_pending) VALUES
    ('00000000-0000-4000-8000-0000000000e2', '$T', '$X', 1, 100, '$C', true),
    ('00000000-0000-4000-8000-0000000000e1', '$T', '$Y', 2, 100, '$C', false);
  INSERT INTO seat_departure_requests SELECT s.occupancy_id, s.user_id, s.table_id, s.seat_number, 'voluntary'
    FROM table_seats s WHERE s.user_id = '$X';
  INSERT INTO cash_player_session(player_id, scope_type, scope_id, table_id, cluster_id, baseline)
  SELECT s.user_id, 'table', s.table_id, s.table_id, '$G', 100 FROM table_seats s;
  INSERT INTO engine_table_leases VALUES ('$T', 'proof', '00000000-0000-4000-8000-0000000000b1', 2, now() + interval '1 hour');
  INSERT INTO cash_rake_pending(hand_id, table_id, hand_number, amount, rake)
  VALUES ('$H', '$T', 7, 10, jsonb_build_object('club_id', '$C', 'amount', 10,
          'contributions', jsonb_build_object('$X', 50, '$Y', 50)));
  INSERT INTO club_wallets VALUES ('$C', 0);
  INSERT INTO cash_cluster_conversion(cluster_id, conversion_request_id, to_mode, status)
  VALUES ('$G', '$R', 'must_move', 'pending');
  INSERT INTO lightning_pool_session(cluster_id, cluster_epoch, player_id, anchor_seat_id, state)
  VALUES ('$G', 1, '$Y', '00000000-0000-4000-8000-0000000000e1', 'open');
END \$\$;
CREATE FUNCTION proof_participants() RETURNS jsonb LANGUAGE sql AS \$\$
  SELECT jsonb_agg(jsonb_build_object('user_id', s.user_id, 'seat_id', s.id, 'occupancy_id', s.occupancy_id,
    'seat_joined_at', s.joined_at, 'stack_before', s.stack, 'is_horse', false) ORDER BY s.seat_number)
    FROM table_seats s WHERE s.table_id = '$T' AND s.left_at IS NULL \$\$;
SQL

OCC="(SELECT occupancy_id FROM table_seats WHERE id='00000000-0000-4000-8000-0000000000e2')"
CASHOUT="SELECT (public.fn_cashout_seat_occupancy('$X','$T',1,$OCC,NULL))->>'ok'"
MANIFEST="SELECT (public.fn_cash_capture_hand_manifest('$T',1000001,proof_participants(),'proof','00000000-0000-4000-8000-0000000000b1'))->>'version'"
OWED="SET LOCAL proof.owed='3'; SET LOCAL proof.pause_leave_check='2'; SELECT public.fn_lightning_owed_leave_returns_to_pool('$X','$T',1,$OCC)->>'returned'"
LEAVE="SET LOCAL proof.pause_declare='2'; SELECT public.player_leave_table('$T','$X')"
REJOIN="SET LOCAL proof.uid='$X'; SET LOCAL proof.pause_in_hand='2'; SELECT public.fn_lightning_rejoin_seated('$G')"
REVERT="SET LOCAL proof.pause_pool_stack='2'; SELECT public.fn_cash_cluster_commit_must_move('$G','$R')->>'reason'"
BANK="SELECT public.fn_ca_bank_pending_cash_rake('$H')->>'status'"
DAY="(now() AT TIME ZONE 'UTC')::date"
HOLD_FACT="SELECT public.fn_ca_club_data_fact_put('$C', $DAY, 'CASH', '$T', '$B', 0, 100, 0, 0, now()); SELECT pg_sleep(2)"
HOLD_DAILY="INSERT INTO club_table_daily AS d VALUES ('$C', '$T', $DAY, 100, 0, 0) ON CONFLICT (club_id, table_id, stat_date) DO UPDATE SET buyins = d.buyins + 100; SELECT pg_sleep(2)"

# Two sessions: the first starts, the second $4 seconds later. Prints
# "deadlock" when Postgres refused either, "committed" when both committed.
pair() { # $1 mode  $2 setup sql  $3 session-one sql  $4 delay  $5 session-two sql
  "${PSQL[@]}" -c "SELECT proof_reset('$1'); $2" >/dev/null
  "${PSQL[@]}" -c "BEGIN; $3; SELECT 'committed'; COMMIT;" >"$WORK/one" 2>&1 &
  local one=$!
  sleep "$4"
  "${PSQL[@]}" -c "BEGIN; $5; SELECT 'committed'; COMMIT;" >"$WORK/two" 2>&1 &
  local two=$!
  wait "$one" || true; wait "$two" || true
  if grep -q 'deadlock detected' "$WORK/one" "$WORK/two"; then echo deadlock
  elif grep -qx committed "$WORK/one" && grep -qx committed "$WORK/two"; then echo committed
  else echo "unexpected: $(tr '\n' ' ' <"$WORK/one") | $(tr '\n' ' ' <"$WORK/two")"; fi
}
q() { "${PSQL[@]}" -c "$1"; }
# A rake bank while a buy-in holds the row it reports into. Prints the bank's
# answer, the club bank, the rake on the report, and the rake still stored.
bank_vs() { # $1 holder sql  $2 report sql
  "${PSQL[@]}" -c "SELECT proof_reset('lightning')" >/dev/null
  "${PSQL[@]}" -c "BEGIN; $1; COMMIT;" >/dev/null 2>&1 &
  local one=$!
  sleep 0.5
  local status; status=$("${PSQL[@]}" -c "$BANK" 2>"$WORK/warn")
  wait "$one" || true
  echo "$status swallowed=$(grep -c 'lock timeout' "$WORK/warn" || true) bank=$(q "SELECT chip_balance::int FROM club_wallets") report=$(q "$2") stored=$(q "SELECT count(*) FROM cash_rake_pending")"
}
FACT_REPORT="SELECT coalesce(sum(fee), 0)::int FROM ca_club_data_game_ct"
DAILY_REPORT="SELECT coalesce(sum(rake), 0)::int FROM club_table_daily"
scenarios() {
  A=$(bank_vs "$HOLD_FACT" "$FACT_REPORT");   echo "  rake bank vs held fact row      : $A"
  D=$(bank_vs "$HOLD_DAILY" "$DAILY_REPORT"); echo "  rake bank vs held daily row     : $D"
  P1=$(pair lightning "" "$OWED" 0.5 "$CASHOUT");                         echo "  owed-leave return vs cash-out   : $P1"
  P2=$(pair lightning "" "$LEAVE" 0.5 "$MANIFEST");                       echo "  system leave vs dealt manifest  : $P2"
  P3=$(pair lightning "UPDATE table_seats SET stack = 0 WHERE user_id = '$X'" "$REJOIN" 0.5 "$MANIFEST")
  echo "  busted rejoin vs dealt manifest : $P3"
  P4=$(pair pending_off "" "$REVERT" 0.5 "$CASHOUT");                     echo "  reversion vs cash-out           : $P4"
}

echo "before (the live bodies):"
scenarios
[ "$A" = "banked swallowed=2 bank=10 report=0 stored=0" ] && [ "$D" = "banked swallowed=1 bank=10 report=0 stored=0" ] \
  || { echo 'PROOF FAILED: the swallowed reporting refusal did not reproduce on the live bodies' >&2; exit 1; }
[ "$P1" = deadlock ] && [ "$P2" = deadlock ] && [ "$P3" = deadlock ] && [ "$P4" = deadlock ] \
  || { echo 'PROOF FAILED: a seat-before-table deadlock did not reproduce on the live bodies' >&2; exit 1; }

# PROOF_KEEP_PROBES=1 applies the files whole, probes included, over the
# stub rows (a check that every probe unwinds cleanly).
for f in 20261123072817 20261123072823; do
  [ "${PROOF_KEEP_PROBES:-}" = 1 ] && { "${PSQL[@]}" -f "$ROOT"/supabase/migrations/${f}_*.sql >/dev/null; continue; }
  python3 -I -c 'import re,sys; s=open(sys.argv[1]).read(); sys.stdout.write(re.sub(r"-- @probe-for:[^\n]*\nDO (\$[a-z_]*\$).*?END \1;\n", "", s, flags=re.S))' \
    "$ROOT"/supabase/migrations/${f}_*.sql | "${PSQL[@]}" >/dev/null
done

echo "after (the two migrations applied):"
scenarios
[ "$A" = "busy swallowed=0 bank=0 report=0 stored=1" ] && [ "$D" = "busy swallowed=0 bank=0 report=0 stored=1" ] \
  || { echo 'PROOF FAILED: a busy reporting row did not refuse its rake bank whole' >&2; exit 1; }
[ "$P1" = committed ] && [ "$P2" = committed ] && [ "$P3" = committed ] && [ "$P4" = committed ] \
  || { echo 'PROOF FAILED: a pair still does not commit after the migrations' >&2; exit 1; }

# The refused bank, asked again once the row is free: the same 10, once, with
# its report on both rows.
"${PSQL[@]}" -c "SELECT proof_reset('lightning')" >/dev/null
"${PSQL[@]}" -c "BEGIN; $HOLD_FACT; COMMIT;" >/dev/null 2>&1 &
sleep 0.5; FIRST=$(q "$BANK"); wait
SECOND=$(q "$BANK"); THIRD=$(q "$BANK")
AGAIN="$FIRST $SECOND $THIRD bank=$(q "SELECT chip_balance::int FROM club_wallets") fact=$(q "$FACT_REPORT") daily=$(q "$DAILY_REPORT") rakes=$(q "SELECT count(*) FROM rake_records")"
echo "  busy, then asked again          : $AGAIN"
[ "$AGAIN" = "busy banked absent bank=10 fact=10 daily=10 rakes=1" ] \
  || { echo 'PROOF FAILED: the refused rake did not bank exactly once with its report' >&2; exit 1; }

# A deterministic reporting defect is still contained: the rake banks.
"${PSQL[@]}" -c "SELECT proof_reset('lightning')" >/dev/null
DEFECT="$("${PSQL[@]}" -c "SET proof.defect = 'on'; $BANK" 2>/dev/null) bank=$(q "SELECT chip_balance::int FROM club_wallets") daily=$(q "$DAILY_REPORT")"
echo "  a reporting defect              : $DEFECT"
[ "$DEFECT" = "banked bank=10 daily=0" ] \
  || { echo 'PROOF FAILED: a deterministic reporting defect refused the rake' >&2; exit 1; }
echo 'PROOF OK'
