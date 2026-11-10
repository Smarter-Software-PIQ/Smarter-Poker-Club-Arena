#!/usr/bin/env bash
# Native proof: a late seat credit is carried only into a hand that was dealt.
# Installs the 20260928 late-credit migration (the exact production preimage,
# md5 d3f0d6d1...), seeds a dropped prepared number between a blocked hand and
# its occupancy's real next hand, shows the preimage misreads it, applies the
# 20261109 migration, shows the postimage proves the hand into the dealt one,
# and refuses a replay. Never accepts a remote connection.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
case "$("$PGBIN/postgres" --version)" in *' 17.'*) ;; *) echo 'PostgreSQL 17 required' >&2; exit 1 ;; esac
WORK="$(mktemp -d "${TMPDIR:-/tmp}/latedealt.XXXXXX")"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
export LC_ALL=C LANG=C
"$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust --no-locale -E UTF8 >"$WORK/init.log" 2>&1
"$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/pg.log" -o "-k $WORK -p 56437 -h ''" -w start >/dev/null
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p 56437 -U postgres -d postgres)
OLD="$ROOT/tests/fixtures/union-pnl-blocked-resolution"
F="$ROOT/tests/fixtures/late-credit-dealt-next-hand"
MIG="$ROOT/supabase/migrations/20261109132236_a_late_seat_credit_reads_only_a_dealt_next_hand.sql"
"${PSQL[@]}" -f "$OLD/schema.sql" -f "$OLD/captured-preimages.sql" -f "$OLD/seed.sql" -f "$OLD/stage1.sql" \
 -f "$ROOT/supabase/migrations/20260928050509_a_late_seat_credit_is_resolved_from_its_receipts_not_forgive.sql" \
 -c "DO \$\$BEGIN IF md5(pg_get_functiondef('public.fn_union_pnl_prove_late_seat_credit(uuid,bigint)'::regprocedure))<>'d3f0d6d189f378cab4446e2573792721' THEN RAISE EXCEPTION 'fixture preimage is not production';END IF;END\$\$;" \
 -f "$F/orphan.sql" -c "SET ca.phase='before'" -f "$F/check.sql" \
 -f "$MIG" -c "SET ca.phase='after'" -f "$F/check.sql" 2>&1 | sed 's/^psql:[^ ]* //'
if "${PSQL[@]}" -f "$MIG" >"$WORK/replay.log" 2>&1; then echo 'ERROR migration replay unexpectedly passed'; exit 1; fi
grep -q 'is not the pinned text' "$WORK/replay.log"
echo 'PASS exact migration replay refuses'
echo 'PASS PostgreSQL 17 late credit reads only a dealt next hand'
