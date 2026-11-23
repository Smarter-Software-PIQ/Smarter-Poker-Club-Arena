#!/usr/bin/env bash
# Native proof for migration 20261122222254 (a Sit and Go whose launch has begun
# cannot be unregistered). Runs on a THROWAWAY local PostgreSQL 16 cluster it
# creates and removes; it never connects to any other database.
#
# It installs the recorded text of the three unregistration functions as
# 20261122185915 left them (the chip unregistration core, the receipt reader,
# the Diamond door) over stub tables, asks each start gate about a set of
# events, installs the migration byte for byte, and asks again. "before" is
# production as it stood when this migration was repaired in place: a Sit and
# Go already leaves the clock, but a launch that has BEGUN does not close it. A probe player with no registration
# is used, so "not_registered" means the start gate let the request through
# and "tournament_started" means it refused. No refund path is executed.
#
# Usage (as a non-root user that may run postgres):
#   PG_BIN=/usr/lib/postgresql/16/bin bash scripts/dev/prove-a-begun-sit-and-go-launch-closes-unregistration.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
trap '"$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
export PGHOST="$WORK" PGPORT=5544

python3 - "$ROOT" "$WORK" <<'PY'
import re, sys
root, work = sys.argv[1], sys.argv[2]
M = root + '/supabase/migrations/'
def stmt(file, fn):
    s = open(M + file).read()
    i = s.rindex('CREATE OR REPLACE FUNCTION public.' + fn + '(')
    m = re.search(r'\$[A-Za-z_]*\$', s[i:]); tag = m.group(0)
    j = i + m.start(); k = s.index(tag, j + len(tag)) + len(tag)
    return s[i:k] + ';\n'
stub = '''
SET check_function_bodies=off;
CREATE TABLE public.tournaments(id uuid primary key, format_contract text, max_players int, status text, start_time timestamptz, started_at timestamptz, current_players int default 0, prize_pool numeric default 0, bounty_pool numeric default 0, total_rake numeric default 0, satellite_target_id uuid, tournament_type text, variant text, updated_at timestamptz);
CREATE TABLE public.tournament_players(id uuid primary key default gen_random_uuid(), tournament_id uuid, user_id uuid, status text, is_satellite_qualifier boolean);
CREATE TABLE public.tournament_escrow(tournament_id uuid);
CREATE TABLE public.poker_diamond_tournament_ledger(id bigserial, tournament_id uuid, user_id uuid, kind text, request jsonb, custody_id uuid, amount numeric, prize_part numeric, bounty_part numeric, fee_part numeric, obligation_id uuid, registration_id uuid);
CREATE TABLE public.tournament_launch_receipts(tournament_id uuid primary key, launch_id uuid, started_at timestamptz, completed_at timestamptz);
CREATE TABLE public.hand_history(id bigserial, tournament_id uuid, table_id uuid);
CREATE TABLE public.tables(id uuid primary key, tournament_id uuid);
CREATE TABLE public.tournament_unregistration_receipts(registration_id uuid, request_id uuid, tournament_id uuid, user_id uuid, source_table_id uuid, settled_at timestamptz, scheduled_start_at timestamptz, start_authority text NOT NULL DEFAULT 'scheduled_clock');
ALTER TABLE public.tournament_unregistration_receipts
  ADD CONSTRAINT tournament_unregistration_actual_start_check CHECK (
    ((start_authority = 'scheduled_clock'::text) AND (settled_at < scheduled_start_at))
    OR (start_authority = ANY (ARRAY['spin_actual_start'::text,'heads_up_sng_actual_start'::text,'sng_actual_start'::text,'launch_release'::text,'owner_never_seated_release'::text])));
CREATE TABLE public.diamond_flag(t uuid primary key);
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS text LANGUAGE sql AS $$ SELECT 'unlimited-mtt-v2' $$;
CREATE FUNCTION public.fn_poker_diamond_tournament(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.diamond_flag WHERE t=p) $$;
CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_tournament(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_ca_tournament_recorded_format(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT format_contract FROM public.tournaments WHERE id=p $$;
'''
base = stub
FIRST = '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql'
base += stmt(FIRST, 'fn_ca_unregister_tournament_player_exact')
base += stmt(FIRST, 'fn_ca_tournament_unregistration_receipt')
base += stmt(FIRST, 'fn_poker_diamond_tournament_unregister')
open(work + '/base.sql', 'w').write(base)
PY

cat > "$WORK/cases.sql" <<'SQL'
\pset format unaligned
\pset tuples_only on
INSERT INTO public.tournaments(id,format_contract,max_players,status,start_time,started_at) VALUES
 ('00000000-0000-4000-8000-000000000001','sng-v1',9,'REGISTERING',now()-interval '1 hour',NULL),
 ('00000000-0000-4000-8000-000000000002','sng-v1',9,'REGISTERING',now()-interval '1 hour',NULL),
 ('00000000-0000-4000-8000-000000000003','mtt-v2',NULL,'REGISTERING',now()-interval '1 hour',NULL),
 ('00000000-0000-4000-8000-000000000004','mtt-v2',NULL,'REGISTERING',now()+interval '1 hour',NULL),
 ('00000000-0000-4000-8000-000000000005','sng-v1',2,'REGISTERING',now()-interval '1 hour',NULL),
 ('00000000-0000-4000-8000-000000000006','sng-v1',6,'REGISTERING',now()-interval '1 hour',now()),
 ('00000000-0000-4000-8000-000000000007','sng-v1',6,'RUNNING',now()-interval '1 hour',now()),
 ('00000000-0000-4000-8000-000000000008','sng-v1',6,'REGISTERING',now()-interval '1 hour',NULL),
 ('00000000-0000-4000-8000-000000000009','seat-first-satellite-v1',2,'REGISTERING',now()-interval '1 hour',NULL),
 ('00000000-0000-4000-8000-00000000000a','spin-v1',3,'REGISTERING',now()-interval '1 hour',NULL),
 ('00000000-0000-4000-8000-00000000000b','sng-v1',9,'REGISTERING',now()-interval '1 hour',NULL);
UPDATE public.tournaments SET tournament_type=CASE WHEN format_contract='sng-v1' THEN 'SNG'
  WHEN format_contract='spin-v1' THEN 'SPIN' ELSE 'MTT' END,
  variant=CASE WHEN format_contract='spin-v1' THEN 'spin' ELSE 'nlh' END;
INSERT INTO public.tournament_launch_receipts(tournament_id,launch_id,started_at,completed_at) VALUES
 ('00000000-0000-4000-8000-000000000002',gen_random_uuid(),now(),NULL),
 ('00000000-0000-4000-8000-00000000000b','00000000-0000-4000-8000-0000000000bb',now(),NULL);
INSERT INTO public.tables(id,tournament_id) VALUES ('00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-000000000008');
INSERT INTO public.hand_history(tournament_id,table_id) VALUES (NULL,'00000000-0000-4000-8000-0000000000aa');
SELECT c.label||' => '||(public.fn_ca_unregister_tournament_player_exact(c.id,'00000000-0000-4000-8000-0000000000ff',NULL,NULL,NULL)->>'reason')
 FROM (VALUES
 ('1 sng 9max registering, fill window passed, no launch','00000000-0000-4000-8000-000000000001'::uuid),
 ('2 sng 9max, launch receipt exists (incomplete)','00000000-0000-4000-8000-000000000002'),
 ('3 mtt past its clock','00000000-0000-4000-8000-000000000003'),
 ('4 mtt before its clock','00000000-0000-4000-8000-000000000004'),
 ('5 heads-up sng, window passed','00000000-0000-4000-8000-000000000005'),
 ('6 sng 6max started_at set','00000000-0000-4000-8000-000000000006'),
 ('7 sng 6max RUNNING','00000000-0000-4000-8000-000000000007'),
 ('8 sng 6max with a persisted hand','00000000-0000-4000-8000-000000000008'),
 ('9 seat-first satellite past its clock','00000000-0000-4000-8000-000000000009'),
 ('a spin, window passed','00000000-0000-4000-8000-00000000000a')) c(label,id) ORDER BY 1;
BEGIN;
SELECT set_config('app.ca_launch_release_launch_id','00000000-0000-4000-8000-0000000000bb',true) IS NULL;
SELECT 'b sng 9max released by its own launch => '||(public.fn_ca_unregister_tournament_player_exact('00000000-0000-4000-8000-00000000000b','00000000-0000-4000-8000-0000000000ff',NULL,NULL,NULL)->>'reason');
ROLLBACK;
INSERT INTO public.diamond_flag SELECT id FROM public.tournaments;
SELECT 'diamond '||c.label||' => '||(public.fn_poker_diamond_tournament_unregister(c.id,'00000000-0000-4000-8000-0000000000ff',gen_random_uuid())->>'reason')
 FROM (VALUES
 ('1 sng 9max no launch','00000000-0000-4000-8000-000000000001'::uuid),
 ('2 sng 9max launch receipt','00000000-0000-4000-8000-000000000002'),
 ('3 mtt past clock','00000000-0000-4000-8000-000000000003'),
 ('5 heads-up','00000000-0000-4000-8000-000000000005')) c(label,id) ORDER BY 1;
TRUNCATE public.diamond_flag, public.tournaments, public.tournament_launch_receipts, public.tables, public.hand_history;
SQL

"$PG_BIN/initdb" -D "$WORK/data" -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p 5544" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -d postgres)
"${PSQL[@]}" -f "$WORK/base.sql"
"${PSQL[@]}" -f "$WORK/cases.sql" | grep '=>' > "$WORK/before.txt"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261122222254_a_sit_and_go_whose_launch_has_begun_cannot_be_unregistered.sql"
"${PSQL[@]}" -f "$WORK/cases.sql" | grep '=>' > "$WORK/after.txt"

echo "== before the migration"; cat "$WORK/before.txt"
echo "== after the migration";  cat "$WORK/after.txt"

expect() { grep -qxF "$2" "$WORK/$1.txt" || { echo "PROOF FAILED ($1): expected: $2" >&2; exit 1; }; }
# The gap, reproduced on the bodies 20261122185915 installed: the fill window
# no longer closes a Sit and Go, but a launch that has begun does not either.
expect before '1 sng 9max registering, fill window passed, no launch => not_registered'
expect before '2 sng 9max, launch receipt exists (incomplete) => not_registered'
expect before 'diamond 2 sng 9max launch receipt => not_registered'
# The fix.
expect after '1 sng 9max registering, fill window passed, no launch => not_registered'
expect after '2 sng 9max, launch receipt exists (incomplete) => tournament_started'
expect after '6 sng 6max started_at set => tournament_started'
expect after '7 sng 6max RUNNING => registration_closed'
expect after '8 sng 6max with a persisted hand => tournament_started'
expect after 'b sng 9max released by its own launch => not_registered'
expect after 'diamond 1 sng 9max no launch => not_registered'
expect after 'diamond 2 sng 9max launch receipt => tournament_started'
# Everything else answers exactly as it did.
for line in '3 mtt past its clock => tournament_started' '4 mtt before its clock => not_registered' \
  '5 heads-up sng, window passed => not_registered' '9 seat-first satellite past its clock => tournament_started' \
  'a spin, window passed => not_registered' 'diamond 3 mtt past clock => tournament_started' 'diamond 5 heads-up => not_registered'; do
  expect before "$line"; expect after "$line"
done
"${PSQL[@]}" -At -c "select 1 from pg_constraint where conname='tournament_unregistration_actual_start_check' and convalidated and pg_get_constraintdef(oid) like '%''sng_actual_start''%' and pg_get_constraintdef(oid) like '%owner_never_seated_release%'" | grep -qx 1 \
  || { echo 'PROOF FAILED: the receipt check no longer names sng_actual_start' >&2; exit 1; }
echo 'PROOF OK'
