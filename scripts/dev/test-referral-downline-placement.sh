#!/usr/bin/env bash
# A referral placement is proved by running it, not by reading it.
#
# WHY THIS EXISTS. The KINGS CLUB referral repair (2026-11-09, migration
# 20261109052000) passed every static gate, an independent review and a
# read-only suite against production while still carrying a defect that would
# have been worse than the bug it fixed: fn_club_placement_is_unchosen returned
# NULL for a row written before that migration, so `NOT
# fn_club_placement_is_unchosen(...)` in fn_agent_attach_player's guard was
# NULL, the IF was never taken, and the refusal that stops one agent taking
# another agent's player silently did nothing.
#
# Nothing that reads SQL could see it. The read-only suite counts rows where
# the function answers TRUE, and NULL is not TRUE, so it passed. Only executing
# the attach path against rows exposed it.
#
# So this harness stands up a throwaway PostgreSQL, reproduces the five
# functions the migration patches with byte-identical anchor text, runs THE
# REAL MIGRATION FILE verbatim, and then asserts behaviour:
#
#   * referral-before-fallback ordering - a clicked agent link places the player
#     under that agent, and only an absence of evidence falls back to the owner
#   * NULL handling - no placement answer is ever NULL
#   * manual-placement preservation - an authorized transfer, and a row written
#     before the migration, are both immovable
#   * repeated execution - the whole migration runs twice and changes no
#     patched function body
#   * concurrent assignment - a live assignment landing between the audit and
#     the settlement is not overwritten, and both per-club locks are held
#
# Production is never touched: everything here happens in $fixture.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
mig="$root/supabase/migrations/20261109052000_the_referral_upline_is_resolved_before_the_owner_fallback.sql"
fix="$root/tests/fixtures/referral-downline"
pgbin=${PG_BIN:-/usr/lib/postgresql/17/bin}
[ -x "$pgbin/initdb" ] || pgbin=/opt/homebrew/opt/postgresql@17/bin
port=${PG_PORT:-55491}
fixture=$(mktemp -d "${TMPDIR:-/tmp}/refdownline.XXXXXX")
started=0
aspg=()
# initdb refuses to run as root; CI runners and the Ops Mac differ here.
if [ "$(id -u)" = 0 ] && id postgres >/dev/null 2>&1; then
  aspg=(runuser -u postgres --)
  chmod 777 "$fixture"
fi
cleanup(){ if [ "$started" = 1 ]; then "${aspg[@]}" "$pgbin/pg_ctl" -D "$fixture/data" -m immediate stop >/dev/null 2>&1 || true; fi; rm -rf "$fixture"; }
trap cleanup EXIT
mkdir "$fixture/socket"; [ "${#aspg[@]}" -gt 0 ] && chmod 777 "$fixture/socket"
"${aspg[@]}" "$pgbin/initdb" -D "$fixture/data" -A trust --no-locale -E UTF8 >/dev/null
"${aspg[@]}" "$pgbin/pg_ctl" -D "$fixture/data" -l "$fixture/server.log" \
  -o "-k $fixture/socket -p $port -h ''" start >/dev/null
started=1
psql(){ "${aspg[@]}" "$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$fixture/socket" -p "$port" -d postgres "$@"; }
val(){ "${aspg[@]}" "$pgbin/psql" -X -A -t -q -h "$fixture/socket" -p "$port" -d postgres -c "$1"; }

# The settlement is pinned to the real KINGS CLUB id; the fixture's club is
# u(100). Rewriting that one literal is the only change made to the migration,
# so the code under test is the file that ships.
python3 - "$mig" "$fixture/migration.sql" <<'PY'
import sys
src, out = sys.argv[1:]
s = open(src).read()
before = s.count("'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'")
if before == 0:
    raise SystemExit('the migration no longer names the KINGS CLUB id; update this harness')
open(out, 'w').write(s.replace("'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'", "lpad('100',32,'0')::uuid"))
PY
cp "$fix"/*.sql "$fixture/"
chmod 644 "$fixture"/*.sql

psql -f "$fixture/schema.sql"
psql -f "$fixture/prepatch-functions.sql"
psql -f "$fixture/scenarios.sql"
echo "[referral-downline] fixture up; installing the migration under test"
psql -f "$fixture/migration.sql"

set +e
psql -f "$fixture/assertions.sql" > "$fixture/assert.out" 2>&1
rc=$?
set -e
sed -e 's/^psql:[^ ]* //' -e '/^$/d' "$fixture/assert.out" | grep -E 'PASS|FAIL|ERROR' || true
if [ "$rc" != 0 ]; then
  echo "[referral-downline] BEHAVIOURAL ASSERTIONS FAILED (psql exit $rc)"
  sed -e 's/^psql:[^ ]* //' "$fixture/assert.out" | tail -20
  exit 1
fi

echo "[referral-downline] repeated execution: the whole migration again"
psql -f "$fixture/migration.sql" > "$fixture/second.out" 2>&1 || {
  echo "[referral-downline] FAIL second run errored"
  sed -e 's/^psql:[^ ]* //' "$fixture/second.out" | tail -10; exit 1; }
drift=$(val "SELECT count(*) FROM before_second_run b
   JOIN pg_proc p ON p.proname=b.proname
   JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public'
  WHERE md5(p.prosrc) <> b.src;")
if [ "$drift" != "0" ]; then
  echo "[referral-downline] FAIL $drift patched function body/bodies changed on the second run"; exit 1
fi
echo "PASS  re-running the migration changed no patched function body"

echo "[referral-downline] the migration's own suite, in isolation"
psql -c "SELECT test, passed, detail FROM public.fn_test_referral_downline_rules();"
bad=$(val "SELECT count(*) FROM public.fn_test_referral_downline_rules() WHERE NOT passed;")
# Measured 2026-11-09: every check passes in this fixture, so the gate is zero.
# It is deliberately strict. If a later fixture change makes a check legitimately
# report outstanding work, raise this with the reason written here - do not widen
# it to make a red run go green.
if [ "$bad" != "0" ]; then
  echo "[referral-downline] FAIL $bad suite check(s) failed in isolation"
  psql -c "SELECT test, detail FROM public.fn_test_referral_downline_rules() WHERE NOT passed;"
  exit 1
fi

echo "[referral-downline] the settlement refuses an unreviewed blast radius"
psql -f "$fixture/blast-radius.sql" >/dev/null 2>&1
python3 - "$fixture/migration.sql" "$fixture/settle.sql" <<'PY'
import sys, re
src, out = sys.argv[1:]
m = re.search(r'DO \$settle\$.*?\$settle\$;', open(src).read(), re.S)
if not m:
    raise SystemExit('the settlement block is gone; update this harness')
open(out, 'w').write(m.group(0) + '\n')
PY
chmod 644 "$fixture/settle.sql"
set +e
psql -f "$fixture/settle.sql" > "$fixture/settle.out" 2>&1
srv=$?
set -e
if [ "$srv" = 0 ] || ! grep -q 'only the 7 reviewed KINGS CLUB mismatches are authorized' "$fixture/settle.out"; then
  echo "[referral-downline] FAIL the settlement did not refuse an unreviewed blast radius"
  sed -e 's/^psql:[^ ]* //' "$fixture/settle.out" | tail -10; exit 1
fi
echo "PASS  the settlement refused to move an unreviewed number of players"

echo "[referral-downline] OK"
