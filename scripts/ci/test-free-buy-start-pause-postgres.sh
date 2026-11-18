#!/usr/bin/env bash
# Native PostgreSQL proof for 20261118163436 (the owner's Free Buy pause switch).
#
# Builds a throwaway cluster, stubs only what the launch door reads around the
# two changed functions (with their exact production preimage bodies, so the
# migration's md5 baseline check runs for real), applies the migration file
# byte for byte, and proves:
#   1. installed ON with Dan's reason, one audit row;
#   2. switch ON: the launch door answers the quiet platform_frozen refusal,
#      defers start_time by 30 minutes, records the deferral, writes no launch
#      receipt, leaves status REGISTERING and every registration untouched
#      (horses and humans alike), and writes no ledger row;
#   3. switch ON: a direct REGISTERING -> RUNNING flip is refused by the
#      admission trigger; a non Free Buy launches normally;
#   4. a Free Buy whose launch receipt already exists is not touched;
#   5. the switch refuses writes that do not come through the owner function,
#      and the audit is append-only;
#   6. switch OFF (owner function, audited): the deferred Free Buy launches
#      through the normal path and nothing else is written to it.
# Usage: bash scripts/ci/test-free-buy-start-pause-postgres.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261118163436_owner_pauses_free_buy_starts_until_the_hand_delay_is_fixed.sql"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d /tmp/fbpause.XXXXXX)"
chmod 777 "$WORK"
PORT="${PGPORT_FB:-55461}"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start -w >/dev/null
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres)

# ---- fixture: the surroundings, stubbed; the two preimages, exact ----------
OLD_REFUSED="$(python3 - "$ROOT" <<'PY'
import sys,re
s=open(sys.argv[1]+'/supabase/migrations/20261030001305_owner_holds_new_tournament_starts_while_running_events_finis.sql').read()
a=s.index('CREATE OR REPLACE FUNCTION public.fn_ca_launch_tournament_start_refused')
b=s.index('REVOKE ALL ON FUNCTION public.fn_ca_launch_tournament_start_refused')
print(s[a:b])
PY
)"
OLD_BEGIN="$(python3 - "$MIG" <<'PY'
import sys
s=open(sys.argv[1]).read()
a=s.index('CREATE OR REPLACE FUNCTION public.fn_begin_tournament_launch_before_lease_generation')
b=s.index('-- 5. No other writer')
f=s[a:b]
# Remove exactly the lines the migration added to the live body.
f=f.replace('  v_free_buy_pause jsonb;\n','',1)
x=f.index('  /* FREE BUY START PAUSE'); y=f.index('  IF public.fn_ca_launch_tournament_start_refused')
print(f[:x]+f[y:])
PY
)"

"${PSQL[@]}" <<SQL
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS \$\$ SELECT nullif(current_setting('test.jwt_role', true), '') \$\$;
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY, name text, status text NOT NULL, free_buy boolean,
  start_time timestamptz, started_at timestamptz, club_id uuid, union_id uuid,
  spin_multiplier numeric DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE public.tournament_players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid, is_horse boolean, status text);
CREATE TABLE public.tournament_launch_receipts (tournament_id uuid PRIMARY KEY, launch_id uuid, started_at timestamptz, launch_player_ids uuid[], completed_at timestamptz, lease_generation uuid);
CREATE TABLE public.chip_ledger (id bigserial PRIMARY KEY, tournament_id uuid, amount numeric);
CREATE TABLE public.wallet_transactions (id bigserial PRIMARY KEY, related_entity_id uuid, amount numeric);
CREATE TABLE public.ca_tournament_start_hold (singleton boolean PRIMARY KEY, blocked boolean NOT NULL);
INSERT INTO public.ca_tournament_start_hold VALUES (true, false);
CREATE FUNCTION public.fn_ca_new_tournament_starts_blocked() RETURNS boolean LANGUAGE sql AS \$\$ SELECT blocked FROM public.ca_tournament_start_hold WHERE singleton \$\$;
CREATE FUNCTION public.fn_ca_launch_tournament_held(uuid, uuid) RETURNS boolean LANGUAGE sql AS \$\$ SELECT false \$\$;
CREATE FUNCTION public.fn_ca_launch_tournament_has_started(p uuid) RETURNS boolean LANGUAGE sql AS \$\$
  SELECT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p AND (t.started_at IS NOT NULL OR t.status <> 'REGISTERING'))
      OR EXISTS (SELECT 1 FROM public.tournament_launch_receipts r WHERE r.tournament_id = p) \$\$;
CREATE FUNCTION public.fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql AS \$\$ SELECT false \$\$;
CREATE FUNCTION public.fn_ca_tournament_recorded_format(uuid) RETURNS text LANGUAGE sql AS \$\$ SELECT 'mtt-v2' \$\$;
-- Production's fn_guard_managed_game_lifecycle: start_time of a registered
-- tournament may only change when auth.role() is service_role (the engine).
CREATE FUNCTION public.fn_guard_managed_game_lifecycle() RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id)
     AND NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    RAISE EXCEPTION 'This tournament cannot be modified after a player has registered' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END \$\$;
CREATE TRIGGER trg_tournaments_managed_lifecycle_guard BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_managed_game_lifecycle();
-- Production's admission trigger (20261030001305), update branch.
CREATE FUNCTION public.fn_ca_launch_tournament_admission_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  IF TG_OP = 'UPDATE' AND ((OLD.started_at IS NULL AND NEW.started_at IS NOT NULL)
     OR (upper(COALESCE(NEW.status,'')) IN ('RUNNING','BREAK','COMPLETING','COMPLETED')
         AND upper(COALESCE(OLD.status,'')) NOT IN ('RUNNING','BREAK','COMPLETING','COMPLETED')))
     AND public.fn_ca_launch_tournament_start_refused(OLD.id) THEN
    RAISE EXCEPTION 'OPERATOR_FLOOR_PARKED: tournament start' USING ERRCODE = '55006';
  END IF;
  RETURN NEW;
END \$\$;
CREATE TRIGGER zzzzzzzz_launch_tournament_admission BEFORE UPDATE OF status, started_at ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_launch_tournament_admission_guard();
SQL
"${PSQL[@]}" -c "$OLD_REFUSED"
"${PSQL[@]}" -c "$OLD_BEGIN"
"${PSQL[@]}" -tA -c "SELECT md5(prosrc) FROM pg_proc WHERE proname IN ('fn_begin_tournament_launch_before_lease_generation','fn_ca_launch_tournament_start_refused') ORDER BY proname" > "$WORK/pre.txt"
printf 'fa0a771ba327e690dd91c26351701a7a\naa80f650f8c76bd214d6955394ec355b\n' | diff - "$WORK/pre.txt" \
  || { echo "FAIL: fixture preimages do not match production md5s"; exit 1; }
echo "ok  fixture preimages match production (fa0a771b..., aa80f650...)"

# Board: FB = registering Free Buy (horses + a human), FBR = Free Buy with a
# launch receipt, PLAIN = ordinary MTT.
"${PSQL[@]}" <<'SQL'
INSERT INTO public.tournaments (id, name, status, free_buy, start_time) VALUES
 ('f0000000-0000-4000-8000-000000000001', 'Midday Free Buy (NLH)', 'REGISTERING', true, now() + interval '5 minutes'),
 ('f0000000-0000-4000-8000-000000000002', 'Afternoon Free Buy (NLH)', 'REGISTERING', true, now() - interval '1 minute'),
 ('e0000000-0000-4000-8000-000000000003', 'Regular MTT', 'REGISTERING', false, now() + interval '5 minutes');
INSERT INTO public.tournament_players (tournament_id, user_id, is_horse, status)
SELECT t, gen_random_uuid(), g % 5 <> 0, 'registered'
  FROM unnest(ARRAY['f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003']::uuid[]) t,
       generate_series(1, 20) g;
INSERT INTO public.tournament_launch_receipts (tournament_id, launch_id, started_at)
VALUES ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 minute');
SQL

# ---- the migration, byte for byte -----------------------------------------
"${PSQL[@]}" -f "$MIG" >/dev/null
echo "ok  migration applied (baseline check passed)"

"${PSQL[@]}" <<'SQL'
DO $$
DECLARE r jsonb; before_players jsonb; before_start timestamptz; s record;
BEGIN
  -- 1. installed ON, audited
  SELECT * INTO s FROM public.ca_free_buy_start_pause WHERE singleton;
  IF NOT s.paused OR s.reason NOT LIKE 'Owner hold (Dan, 2026-11-17 21:30%' THEN RAISE EXCEPTION 'FAIL install state %', to_jsonb(s); END IF;
  IF (SELECT count(*) FROM public.ca_free_buy_start_pause_audit WHERE paused) <> 1 THEN RAISE EXCEPTION 'FAIL install audit'; END IF;
  RAISE NOTICE 'ok  1 installed ON with the owner reason and one audit row';

  -- 2. switch ON: the engine (service_role) asks to launch the Free Buy
  PERFORM set_config('test.jwt_role', 'service_role', false);
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO before_players FROM public.tournament_players p WHERE tournament_id = 'f0000000-0000-4000-8000-000000000001';
  SELECT start_time INTO before_start FROM public.tournaments WHERE id = 'f0000000-0000-4000-8000-000000000001';
  r := public.fn_begin_tournament_launch_before_lease_generation('f0000000-0000-4000-8000-000000000001', gen_random_uuid(), NULL);
  IF r->>'reason' <> 'platform_frozen' OR r->>'cause' <> 'free_buy_owner_pause' OR (r->>'ok')::boolean OR NOT (r->>'deferred')::boolean THEN
    RAISE EXCEPTION 'FAIL paused refusal %', r; END IF;
  IF (SELECT start_time FROM public.tournaments WHERE id = 'f0000000-0000-4000-8000-000000000001') <> before_start + interval '30 minutes' THEN
    RAISE EXCEPTION 'FAIL start not deferred by 30 minutes'; END IF;
  IF (SELECT status FROM public.tournaments WHERE id = 'f0000000-0000-4000-8000-000000000001') <> 'REGISTERING' THEN RAISE EXCEPTION 'FAIL status moved'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_launch_receipts WHERE tournament_id = 'f0000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL receipt written'; END IF;
  IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tournament_players p WHERE tournament_id = 'f0000000-0000-4000-8000-000000000001') IS DISTINCT FROM before_players THEN
    RAISE EXCEPTION 'FAIL registrations changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.chip_ledger) OR EXISTS (SELECT 1 FROM public.wallet_transactions) THEN RAISE EXCEPTION 'FAIL money moved'; END IF;
  IF (SELECT original_start_time FROM public.ca_free_buy_start_deferrals WHERE tournament_id = 'f0000000-0000-4000-8000-000000000001') <> before_start THEN
    RAISE EXCEPTION 'FAIL deferral record'; END IF;
  RAISE NOTICE 'ok  2 switch ON: refused as platform_frozen, start deferred +30m, REGISTERING, 20 registrations (16 horses, 4 humans) unchanged, no receipt, no ledger or wallet row';
  -- asked again: deferred again, counted
  r := public.fn_begin_tournament_launch_before_lease_generation('f0000000-0000-4000-8000-000000000001', gen_random_uuid(), NULL);
  IF (SELECT deferrals FROM public.ca_free_buy_start_deferrals WHERE tournament_id = 'f0000000-0000-4000-8000-000000000001') <> 2 THEN RAISE EXCEPTION 'FAIL second deferral'; END IF;
  RAISE NOTICE 'ok  2b asked again: deferred again (deferrals = 2), start never reached while paused';

  -- 3. no direct flip while paused; a non Free Buy launches normally
  BEGIN
    UPDATE public.tournaments SET status = 'RUNNING', started_at = now() WHERE id = 'f0000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL direct flip allowed';
  EXCEPTION WHEN SQLSTATE '55006' THEN NULL;
  END;
  r := public.fn_begin_tournament_launch_before_lease_generation('e0000000-0000-4000-8000-000000000003', gen_random_uuid(), NULL);
  IF NOT (r->>'ok')::boolean OR NOT (r->>'claimed')::boolean THEN RAISE EXCEPTION 'FAIL regular MTT refused %', r; END IF;
  RAISE NOTICE 'ok  3 switch ON: direct RUNNING flip refused (OPERATOR_FLOOR_PARKED); a regular MTT launches normally';

  -- 4. a Free Buy whose launch already began is recovery work, untouched
  r := public.fn_begin_tournament_launch_before_lease_generation('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', NULL);
  IF NOT (r->>'ok')::boolean OR NOT (r->>'replay')::boolean THEN RAISE EXCEPTION 'FAIL receipt replay blocked %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.ca_free_buy_start_deferrals WHERE tournament_id = 'f0000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'FAIL in-flight launch deferred'; END IF;
  RAISE NOTICE 'ok  4 switch ON: a Free Buy with a launch receipt replays normally and is not deferred';

  -- 5. owner-only switch; append-only audit
  PERFORM set_config('test.jwt_role', '', false);
  BEGIN UPDATE public.ca_free_buy_start_pause SET paused = false; RAISE EXCEPTION 'FAIL direct switch write';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN DELETE FROM public.ca_free_buy_start_pause_audit; RAISE EXCEPTION 'FAIL audit delete';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  IF has_function_privilege('service_role', 'public.fn_ca_owner_set_free_buy_start_pause(boolean,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_owner_set_free_buy_start_pause(boolean,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL non-owner can flip'; END IF;
  RAISE NOTICE 'ok  5 direct switch write refused, audit append-only, no API role may execute the owner function';

  -- 6. switch OFF: deferred Free Buy starts through the normal path
  r := public.fn_ca_owner_set_free_buy_start_pause(false, 'Hand-delay fix verified in the native proof', 'native-proof');
  IF (r->>'previous_paused')::boolean IS NOT TRUE OR (SELECT count(*) FROM public.ca_free_buy_start_pause_audit) <> 2 THEN RAISE EXCEPTION 'FAIL off audit %', r; END IF;
  PERFORM set_config('test.jwt_role', 'service_role', false);
  SELECT start_time INTO before_start FROM public.tournaments WHERE id = 'f0000000-0000-4000-8000-000000000001';
  r := public.fn_begin_tournament_launch_before_lease_generation('f0000000-0000-4000-8000-000000000001', gen_random_uuid(), NULL);
  IF NOT (r->>'ok')::boolean OR NOT (r->>'claimed')::boolean OR jsonb_array_length(r->'launch_player_ids') <> 20 THEN RAISE EXCEPTION 'FAIL off launch %', r; END IF;
  IF (SELECT start_time FROM public.tournaments WHERE id = 'f0000000-0000-4000-8000-000000000001') <> before_start THEN RAISE EXCEPTION 'FAIL off moved start'; END IF;
  UPDATE public.tournaments SET status = 'RUNNING', started_at = now() WHERE id = 'f0000000-0000-4000-8000-000000000001';
  RAISE NOTICE 'ok  6 switch OFF (audited): the deferred Free Buy claims its launch with all 20 entrants and flips RUNNING normally';
END $$;
SQL
echo "PASS free buy start pause native proof"
