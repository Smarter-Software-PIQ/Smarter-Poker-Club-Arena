#!/usr/bin/env bash
# Native proof for 20261119141104 (production alerts 258600, 267092).
#
# Loads production's exact preimage of
# public.fn_ca_commit_hand_settlement_before_lease_generation (md5
# b49192e78f472d7a931bcf20de46a702, taken from the retained18 qualification
# fixture) over minimal stubs of everything it touches, then proves:
#   1. BEFORE the migration, a deadlock caught inside the stack settlement is
#      returned as reason 'rolled_back' with no commit hash: the shape the
#      engine never retries (this is the defect; the check fails if it is not
#      reproduced, so the harness cannot pass vacuously);
#   2. the migration file installs unchanged (its own md5 and exactly-once
#      preimage checks run);
#   3. AFTER it, the same deadlock (and a 40001 and a 55P03) answers
#      reason 'atomic_hand_rolled_back' with the original sqlstate and the
#      64-hex commit hash: exactly the predicate handHistory.ts retries;
#   4. a non-transient inner refusal (a conservation violation, 23514) is
#      still returned unchanged as 'rolled_back';
#   5. a clean settlement still commits (hand_atomic_commits row written,
#      success true) and a transient refusal leaves no row behind.
#
# Usage: PG_BIN=/usr/lib/postgresql/17/bin bash scripts/ci/test-a-deadlocked-hand-settlement-is-retried.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="${DEADLOCK_WORK:-/var/tmp/pg-hand-deadlock}"
PORT="${DEADLOCK_PORT:-55471}"
EVIDENCE="${DEADLOCK_EVIDENCE:-$ROOT/artifacts/hand-settlement-deadlock}"
MIGRATION="$ROOT/supabase/migrations/20261119141104_a_deadlocked_hand_settlement_is_the_retryable_rolled_back_en.sql"
SOURCE="$ROOT/scripts/qualification/retained18-correction/fixtures/current-authorities.sql"

as_pg() {
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

rm -rf "$WORK"
mkdir -p "$WORK" "$EVIDENCE"
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
DATA="$WORK/data"
as_pg "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
as_pg "$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
trap 'as_pg "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true' EXIT

PSQL=(as_pg "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres -At)

# The exact production preimage, cut from the retained fixture.
python3 - "$SOURCE" "$WORK/preimage.sql" <<'PY'
import hashlib, sys
s = open(sys.argv[1]).read()
head = 'CREATE OR REPLACE FUNCTION public.fn_ca_commit_hand_settlement_before_lease_generation'
i = s.index(head)
j = s.index('$function$', s.index('$function$', i) + 10) + len('$function$')
d = s[i:j] + '\n'
assert hashlib.md5(d.encode()).hexdigest() == 'b49192e78f472d7a931bcf20de46a702', 'fixture preimage moved'
open(sys.argv[2], 'w').write(d + ';\n')
PY
[ "$(id -u)" = 0 ] && chown postgres "$WORK/preimage.sql"

"${PSQL[@]}" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE TABLE public.tables (id uuid PRIMARY KEY, tournament_id uuid);
CREATE TABLE public.tournaments (id uuid PRIMARY KEY);
CREATE TABLE public.tournament_players (tournament_id uuid, user_id uuid, chips integer,
  table_id uuid, seat_number integer, status text, rebuys integer, rebuy_prompt_until timestamptz, add_on boolean);
CREATE TABLE public.table_seats (id uuid, table_id uuid, user_id uuid, seat_number integer,
  joined_at timestamptz, stack numeric, left_at timestamptz, status text);
CREATE TABLE public.hand_history (id uuid, table_id uuid, hand_number bigint);
CREATE TABLE public.hand_atomic_commits (table_id uuid, hand_number bigint, hand_id uuid,
  payload_hash text, stack_result jsonb, PRIMARY KEY (table_id, hand_number));
CREATE TABLE public.hand_projection_outbox (hand_id uuid, table_id uuid, hand_number bigint);
CREATE TABLE public.tournament_knockout_candidates (id uuid DEFAULT gen_random_uuid(), tournament_id uuid,
  eliminated_user_id uuid, table_id uuid, seat_id uuid, seat_joined_at timestamptz, hand_id uuid,
  hand_number bigint, stack_before numeric, stack_after numeric, rebuy_prompt_until timestamptz,
  UNIQUE (tournament_id, hand_number, eliminated_user_id));
CREATE FUNCTION public.fn_ca_share_settlement_lane_for_table(uuid) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_ca_tournament_rebuy_window(uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
CREATE FUNCTION public.fn_ca_insert_hand_with_awards(p_row jsonb, p_units jsonb) RETURNS uuid
  LANGUAGE plpgsql AS $$DECLARE v uuid := gen_random_uuid(); BEGIN
  INSERT INTO public.hand_history VALUES (v, (p_row->>'table_id')::uuid, (p_row->>'hand_number')::bigint);
  RETURN v; END$$;
CREATE FUNCTION public.fn_cash_accept_hand_provenance(uuid,bigint,uuid,jsonb,numeric,numeric,numeric,text,jsonb)
  RETURNS void LANGUAGE sql AS '';
-- The stack settlement's real failure shape: its own subtransaction catches
-- the error and RETURNS it (fn_ca_settle_hand_stacks_absolute, production).
CREATE FUNCTION public.fn_ca_settle_hand_stacks_absolute(p_table_id uuid, p_hand_number bigint,
  p_stacks jsonb, p_rake numeric, p_bbj numeric, p_ref text, p_inflow numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_mode text := current_setting('proof.inner', true); v_err text;
BEGIN
  BEGIN
    IF v_mode = '40P01' THEN RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01'; END IF;
    IF v_mode = '40001' THEN RAISE EXCEPTION 'could not serialize access' USING ERRCODE = '40001'; END IF;
    IF v_mode = '55P03' THEN RAISE EXCEPTION 'canceling statement due to lock timeout' USING ERRCODE = '55P03'; END IF;
    IF v_mode = '23514' THEN RAISE EXCEPTION 'conservation violation: 5' USING ERRCODE = '23514'; END IF;
    RETURN jsonb_build_object('success', true, 'written', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    RETURN jsonb_build_object('success', false, 'reason', 'rolled_back', 'error', v_err,
                              'sqlstate', SQLSTATE, 'table_id', p_table_id, 'hand_number', p_hand_number);
  END;
END$$;
INSERT INTO public.tables VALUES ('11111111-1111-1111-1111-111111111111', NULL);
SQL

"${PSQL[@]}" -f "$WORK/preimage.sql"
PRE_MD5="$("${PSQL[@]}" -c "SELECT md5(pg_get_functiondef('public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'::regprocedure))")"
[ "$PRE_MD5" = b49192e78f472d7a931bcf20de46a702 ] || { echo "FAIL: loaded preimage md5 $PRE_MD5"; exit 1; }

# pg_temp functions live only for their session, so every probe is one session.
probe() {
  local mode="$1" hand="$2"
  "${PSQL[@]}" <<SQL
CREATE FUNCTION pg_temp.call(p_mode text, p_hand bigint) RETURNS jsonb LANGUAGE plpgsql AS \$\$
BEGIN
  PERFORM set_config('proof.inner', p_mode, false);
  RETURN public.fn_ca_commit_hand_settlement_before_lease_generation(
    '11111111-1111-1111-1111-111111111111', p_hand,
    jsonb_build_array(jsonb_build_object('user_id','22222222-2222-2222-2222-222222222222','stack',10,'stack_before',10)),
    0, 0, 'proof', 0,
    jsonb_build_object('table_id','11111111-1111-1111-1111-111111111111','hand_number',p_hand::text),
    '[]'::jsonb);
END\$\$;
SELECT pg_temp.call('$mode', $hand)::text;
SQL
}

field() { python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get(sys.argv[2]))' "$1" "$2"; }
fail() { echo "FAIL: $*"; exit 1; }

# 1. The defect, reproduced on the preimage.
R="$(probe 40P01 2000001)"; echo "pre 40P01: $R" | tee "$EVIDENCE/pre.txt"
[ "$(field "$R" reason)" = rolled_back ] || fail "preimage did not reproduce the defect: $R"
[ "$(field "$R" commit_hash)" = None ] || fail "preimage already carried a commit hash: $R"

# 2. The migration installs exactly as written.
"${PSQL[@]}" -f "$MIGRATION"
"${PSQL[@]}" -c "SELECT position('HAND_SETTLEMENT_TRANSIENT_INNER_REFUSAL' IN pg_get_functiondef('public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'::regprocedure))>0" | grep -qx t \
  || fail 'live-proof expression is false after install'

# 3. Every transient class answers the retryable envelope.
n=2000010
for code in 40P01 40001 55P03; do
  n=$((n + 1))
  R="$(probe "$code" "$n")"; echo "post $code: $R" | tee -a "$EVIDENCE/post.txt"
  [ "$(field "$R" reason)" = atomic_hand_rolled_back ] || fail "$code not canonical: $R"
  [ "$(field "$R" sqlstate)" = "$code" ] || fail "$code sqlstate lost: $R"
  [ "$(field "$R" atomic_hand_commit)" = False ] || fail "$code atomic flag: $R"
  python3 -c 'import json,re,sys; h=json.loads(sys.argv[1])["commit_hash"]; sys.exit(0 if re.fullmatch("[0-9a-f]{64}",h) else 1)' "$R" \
    || fail "$code commit hash missing: $R"
done

# 4. A non-transient refusal is unchanged.
R="$(probe 23514 2000020)"; echo "post 23514: $R" | tee -a "$EVIDENCE/post.txt"
[ "$(field "$R" reason)" = rolled_back ] || fail "23514 changed shape: $R"
[ "$(field "$R" sqlstate)" = 23514 ] || fail "23514 sqlstate: $R"

# 5. A clean hand still commits; refusals left nothing behind.
R="$(probe ok 2000030)"; echo "post ok: $R" | tee -a "$EVIDENCE/post.txt"
[ "$(field "$R" success)" = True ] && [ "$(field "$R" atomic_hand_commit)" = True ] || fail "clean hand did not commit: $R"
ROWS="$("${PSQL[@]}" -c "SELECT string_agg(hand_number::text, ',' ORDER BY hand_number) FROM public.hand_atomic_commits")"
[ "$ROWS" = 2000030 ] || fail "unexpected atomic commit rows: $ROWS"

echo "PASS: a deadlocked hand settlement answers the retryable rolled-back envelope" | tee "$EVIDENCE/result.txt"
