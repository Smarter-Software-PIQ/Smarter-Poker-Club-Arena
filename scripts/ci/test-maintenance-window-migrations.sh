#!/usr/bin/env bash
# Native qualification of the daily-maintenance window route
# (scripts/ci/maintenance-window-migrations.mjs, apply-recorded-migration.mjs
# --maintenance-window, install-window-migrations.mjs) against a real
# PostgreSQL carrying production's break-window guard and freeze predicates.
#
# It runs the REAL applier and the REAL installer, over TLS verified against a
# throwaway CA, and proves:
#   1. the ordinary applier refuses a declared migration as QUEUED, sends nothing;
#   2. the window route refuses while no break is open, sends nothing;
#   3. a lock it cannot take at once rolls the whole install back in ~1 s,
#      with no history row, no override row and no column;
#   4. inside the open window it installs once, the DDL guard records the
#      override reason, and the history row carries the exact file bytes;
#   5. a second run is ALREADY-APPLIED and changes nothing;
#   6. a window too close to the thaw is refused at the opening assertion;
#   7. a transaction over its budget is rolled back by the closing assertion;
#   8. the installer: nothing queued exits 0 at once, a statically invalid file
#      is refused before any wait, a break that never opens is reported and
#      sends nothing, and an open break installs every queued file once;
#  11. the installer waits, read-only, for a quiet moment on a busy table and
#      installs on its one attempt; a table busy past the bound is sent once,
#      refused, and its holder named;
#  12. "-- @locks:" ordering: undeclared files are sent first, declared files
#      follow by version grouped by relation, a file that loses its declared
#      lock is skipped alone naming that relation while the others install,
#      and an unparseable @locks value is refused before any wait;
#  13. inside the confirmed freeze a postgres session idle in transaction on a
#      declared relation is terminated, recorded and the file installs; an
#      active query, an idle superuser session and an undeclared file
#      terminate nothing; without a confirmed freeze nothing is terminated;
#  14. "-- @install-budget-seconds:" (migration-install-budget.mjs, ordinary
#      route): an admitted offline file runs past 12 s and installs; the same
#      file undeclared is killed at exactly the 12 s bound; a declared file
#      that writes a live table statically is refused before sending; one
#      that reaches a live table through dynamic SQL is rolled back by the
#      in-transaction scope check.
#
# Usage: PG_BIN=/usr/lib/postgresql/17/bin bash scripts/ci/test-maintenance-window-migrations.sh
# Needs node with `pg` resolvable from scripts/ci (CI: npm i pg@8 --no-save).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="${WINDOW_WORK:-/var/tmp/pg-window}"
PORT="${WINDOW_PORT:-55444}"
EVIDENCE="${WINDOW_EVIDENCE:-$ROOT/artifacts/maintenance-window-migrations}"
FIXTURES="$ROOT/scripts/ci/fixtures/maintenance-window-migrations"

as_pg() {
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

rm -rf "$WORK"
mkdir -p "$WORK" "$EVIDENCE"
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
DATA="$WORK/data"
TLS="$WORK/tls"
as_pg mkdir -p "$TLS"

# A throwaway CA and a localhost server certificate: the real pg client
# verifies the chain and the host name exactly as it does against Supabase.
as_pg openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=window-fixture-ca' \
  -keyout "$TLS/ca.key" -out "$TLS/ca.crt" >/dev/null 2>&1
as_pg openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' \
  -keyout "$TLS/server.key" -out "$TLS/server.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > "$WORK/san.ext"
as_pg openssl x509 -req -in "$TLS/server.csr" -CA "$TLS/ca.crt" -CAkey "$TLS/ca.key" \
  -CAcreateserial -days 1 -extfile "$WORK/san.ext" -out "$TLS/server.crt" >/dev/null 2>&1
as_pg chmod 600 "$TLS/server.key"
cp "$TLS/ca.crt" "$WORK/ca-public.crt"
chmod 644 "$WORK/ca-public.crt"

as_pg "$PG_BIN/initdb" -D "$DATA" -U supabase_admin --auth-local=trust --auth-host=scram-sha-256 >/dev/null
cat >> "$DATA/postgresql.conf" <<EOF
port = $PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$WORK'
ssl = on
ssl_cert_file = '$TLS/server.crt'
ssl_key_file = '$TLS/server.key'
EOF
as_pg "$PG_BIN/pg_ctl" -D "$DATA" -l "$WORK/postgres.log" -w start >/dev/null
trap 'as_pg "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true' EXIT

SU=("$PG_BIN/psql" -X -q -h "$WORK" -p "$PORT" -U supabase_admin -d postgres -v ON_ERROR_STOP=1)
su_sql() { as_pg "${SU[@]}" -Atc "$1"; }
as_pg "${SU[@]}" -f "$FIXTURES/schema.sql" >/dev/null

export DATABASE_URL="postgres://postgres:window-fixture@localhost:$PORT/postgres"
export PSQL_BIN="$PG_BIN/psql"
CA="$WORK/ca-public.crt"
SERVER_VERSION="$(su_sql 'SHOW server_version_num')"

# The fixture migrations live in a scratch checkout layout: the applier reads
# supabase/migrations relative to its working directory.
CASE="$WORK/case"
mkdir -p "$CASE/supabase/migrations"
cp "$FIXTURES/20991231000001_window_fixture_takes_the_live_tables.sql" "$CASE/supabase/migrations/"
FIRST=20991231000001_window_fixture_takes_the_live_tables.sql

apply() { (cd "$CASE" && node "$ROOT/scripts/ci/apply-recorded-migration.mjs" --ssl-root-cert "$CA" --migration "$@"); }
fail() { echo "FAIL: $*" | tee -a "$EVIDENCE/result.txt"; exit 1; }
pass() { echo "PASS: $*" | tee -a "$EVIDENCE/result.txt"; }
: > "$EVIDENCE/result.txt"
echo "server_version_num=$SERVER_VERSION" | tee -a "$EVIDENCE/result.txt"
counts() {
  su_sql "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations)
          || ' ' || (SELECT count(*) FROM public.ca_break_window_migration_overrides)
          || ' ' || (SELECT count(*) FROM information_schema.columns
                      WHERE table_schema = 'public' AND column_name LIKE 'window_fixture_%')"
}

# 1. The ordinary applier refuses it as queued. Its own clock is moved to
# minute :20 of this hour, so the run does not depend on landing outside the
# :50-:03 refusal that would otherwise answer first.
OUTSIDE_BREAK_MINUTE="$(node -e 'const h=Math.floor(Date.now()/3600000)*3600000; process.stdout.write(String(h+20*60000))')"
set +e
out="$(cd "$CASE" && FAKE_NOW_MS="$OUTSIDE_BREAK_MINUTE" node --import "$FIXTURES/shift-clock.mjs" \
  "$ROOT/scripts/ci/apply-recorded-migration.mjs" --ssl-root-cert "$CA" --migration "$FIRST" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/1-ordinary-applier.log"
[ "$code" = 1 ] || fail "ordinary applier exit $code, expected 1"
grep -q 'It is QUEUED, not lost' <<<"$out" || fail 'ordinary applier did not say QUEUED'
[ "$(counts)" = "0 0 0" ] || fail "ordinary applier changed state: $(counts)"
pass 'the ordinary applier refuses a declared migration as QUEUED and sends nothing'

# 2. The window route refuses while no break is open.
set +e
out="$(apply "$FIRST" --maintenance-window 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/2-window-closed.log"
[ "$code" = 1 ] || fail "closed window exit $code, expected 1"
grep -q 'daily maintenance window is not open' <<<"$out" || fail 'closed window gave no reason'
[ "$(counts)" = "0 0 0" ] || fail "closed window changed state: $(counts)"
pass 'the window route refuses outside an open break and sends nothing'

# 3. A lock that is not free: refused and rolled back at once, never queued.
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
as_pg "${SU[@]}" -c "BEGIN; LOCK TABLE public.hand_history IN ACCESS SHARE MODE; SELECT pg_sleep(20); COMMIT;" \
  >/dev/null 2>&1 &
HOLDER=$!
for _ in $(seq 1 50); do
  held="$(su_sql "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                  WHERE c.relname = 'hand_history' AND l.granted AND l.pid <> pg_backend_pid()")"
  [ "$held" -ge 1 ] && break
  sleep 0.1
done
[ "$held" -ge 1 ] || fail 'could not hold the fixture lock'
t0=$(date +%s%N)
set +e
out="$(apply "$FIRST" --maintenance-window 2>&1)"; code=$?
set -e
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
echo "$out" > "$EVIDENCE/3-lock-unavailable.log"
kill "$HOLDER" 2>/dev/null || true
su_sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(20)%' AND pid <> pg_backend_pid()" >/dev/null
wait "$HOLDER" 2>/dev/null || true
[ "$code" = 1 ] || fail "lock unavailable exit $code, expected 1 (REFUSED)"
grep -q '55P03' <<<"$out" || fail 'lock unavailable did not report lock_not_available (55P03)'
[ "$ms" -lt 6000 ] || fail "lock unavailable took ${ms}ms; it must refuse, not wait"
[ "$(counts)" = "0 0 0" ] || fail "lock unavailable left state: $(counts)"
pass "a lock that is not free rolls the install back in ${ms} ms with nothing left behind"

# 4. Inside the open window it installs, once, with the override recorded.
set +e
out="$(apply "$FIRST" --maintenance-window 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/4-install.log"
[ "$code" = 0 ] || fail "install exit $code: $out"
grep -q '\[apply\] APPLIED' <<<"$out" || fail 'install did not report APPLIED'
[ "$(counts)" = "1 1 1" ] || fail "install state: $(counts)"
reason="$(su_sql "SELECT reason || ' | ' || session_role || ' | ' || coalesce(application_name, '') FROM public.ca_break_window_migration_overrides")"
echo "$reason" > "$EVIDENCE/4-override.txt"
grep -q "daily-maintenance window install of $FIRST" <<<"$reason" || fail "override reason: $reason"
grep -q '| postgres | apply-recorded-migration' <<<"$reason" || fail "override actor: $reason"
same="$(su_sql "SELECT statements[1] = pg_read_file('$CASE/supabase/migrations/$FIRST') FROM supabase_migrations.schema_migrations WHERE version = '20991231000001'")"
[ "$same" = t ] || fail 'history row does not carry the exact file bytes'
pass 'inside the open window it installs once, records the override reason and the exact history'

# 5. A second run is a no-op.
set +e
out="$(apply "$FIRST" --maintenance-window 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/5-second-run.log"
[ "$code" = 0 ] || fail "second run exit $code"
grep -q 'ALREADY-APPLIED' <<<"$out" || fail 'second run was not ALREADY-APPLIED'
[ "$(counts)" = "1 1 1" ] || fail "second run changed state: $(counts)"
pass 'a second run is ALREADY-APPLIED and changes nothing'

# 6 and 7 run the generated transaction directly, as the migrating role.
gen() {
  node --input-type=module -e "
    import { windowTransactionSQL } from '$ROOT/scripts/ci/maintenance-window-migrations.mjs';
    import { readFileSync } from 'node:fs';
    process.stdout.write(windowTransactionSQL(process.argv[1], readFileSync(0, 'utf8')));
  " "$1"
}
run_as_migrator() {
  PGPASSWORD=window-fixture PGSSLMODE=verify-full PGSSLROOTCERT="$CA" PGAPPNAME=apply-recorded-migration \
    "$PG_BIN/psql" -X -q -h localhost -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$1"
}

# 6. Too close to the thaw: the opening assertion refuses.
su_sql 'SELECT public.fixture_open_window(120)' >/dev/null
printf 'BEGIN;\nALTER TABLE public.tables ADD COLUMN window_fixture_late int;\nCOMMIT;\n' \
  | gen 20991231000009_window_fixture_late.sql > "$WORK/late.sql"
set +e
out="$(run_as_migrator "$WORK/late.sql" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/6-too-close-to-thaw.log"
[ "$code" != 0 ] || fail 'a window 120 s from its end admitted an install'
grep -q 'install_window_closed' <<<"$out" || fail "late window reason: $out"
[ "$(counts)" = "1 1 1" ] || fail "late window changed state: $(counts)"
pass 'a window with less than the start reserve left refuses at the opening assertion'

# 7. Over budget: the closing assertion rolls it back.
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
printf 'BEGIN;\nALTER TABLE public.tables ADD COLUMN window_fixture_slow int;\nSELECT pg_sleep(4.6);\nSELECT pg_sleep(4.6);\nCOMMIT;\n' \
  | gen 20991231000008_window_fixture_slow.sql > "$WORK/slow.sql"
set +e
out="$(run_as_migrator "$WORK/slow.sql" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/7-over-budget.log"
[ "$code" != 0 ] || fail 'an install over its budget committed'
grep -Eq 'install_window_budget_exceeded|transaction timeout' <<<"$out" || fail "over budget reason: $out"
[ "$(counts)" = "1 1 1" ] || fail "over budget changed state: $(counts)"
pass 'an install over its budget is rolled back by the closing assertion'

# 8. The installer.
installer() {
  (cd "$1" && FAKE_NOW_MS="$2" node --import "$FIXTURES/shift-clock.mjs" \
     "$ROOT/scripts/ci/install-window-migrations.mjs" --ssl-root-cert "$CA")
}
chicago_four() { # epoch ms of the most recent 04:00 America/Chicago, plus $1 seconds
  node --input-type=module -e "
    const { dailyWindows } = await import('$ROOT/scripts/ci/maintenance-window-migrations.mjs');
    const w = dailyWindows(Date.now()).filter((x) => x.startsAt <= Date.now()).pop();
    process.stdout.write(String(w.startsAt + Number(process.argv[1]) * 1000));
  " "$1"
}
NOW_OPEN="$(chicago_four 5)"
NOW_LATE="$(chicago_four 146)"

# 8a. Everything recorded: exits 0 at once.
set +e
out="$(installer "$CASE" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/8a-nothing-queued.log"
[ "$code" = 0 ] && grep -q 'NOTHING QUEUED' <<<"$out" || fail "nothing-queued run: $code $out"
pass 'the installer exits at once when nothing is queued'

# 8b. A statically invalid queued file is refused before any wait.
BAD="$WORK/bad"
mkdir -p "$BAD/supabase/migrations"
cp "$FIXTURES/20991231000003_window_fixture_waits_too_long.sql" "$BAD/supabase/migrations/"
set +e
out="$(installer "$BAD" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/8b-invalid-before-wait.log"
[ "$code" = 1 ] && grep -q 'REFUSED before waiting' <<<"$out" || fail "invalid file run: $code $out"
pass 'a queued file that breaks the window rules is refused before any wait'

# 8c. The break never opens: reported, nothing sent.
cp "$FIXTURES/20991231000002_window_fixture_second_live_table.sql" "$CASE/supabase/migrations/"
su_sql 'SELECT public.fixture_close_window()' >/dev/null
set +e
out="$(installer "$CASE" "$NOW_LATE" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/8c-never-opened.log"
[ "$code" = 1 ] && grep -q 'BREAK NEVER OPENED' <<<"$out" || fail "never-opened run: $code $out"
[ "$(counts)" = "1 1 1" ] || fail "never-opened run changed state: $(counts)"
pass 'a break that never reaches a confirmed freeze is reported and nothing is sent'

# 8d. An open break: the queued file installs, once.
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
set +e
out="$(installer "$CASE" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/8d-installs.log"
[ "$code" = 0 ] && grep -q 'INSTALLED 1 migration' <<<"$out" || fail "installer run: $code $out"
[ "$(counts)" = "2 2 2" ] || fail "installer state: $(counts)"
set +e
out="$(installer "$CASE" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" >> "$EVIDENCE/8d-installs.log"
[ "$code" = 0 ] && grep -q 'NOTHING QUEUED' <<<"$out" || fail "installer rerun: $code $out"
[ "$(counts)" = "2 2 2" ] || fail "installer rerun changed state: $(counts)"
pass 'the installer installs every queued file once inside the open break, and a rerun is a no-op'

# 9. A later explicit owner exception uses the SAME applier and transaction,
# at the real daytime clock. A scheduled or unowned freeze grants nothing.
OWNER_FILE=20991231000004_window_fixture_owner_exception.sql
sed 's/window_fixture_rake_cap/window_fixture_owner_exception/g' "$FIXTURES/$FIRST" > "$CASE/supabase/migrations/$OWNER_FILE"
mkdir -p "$CASE/server/release"
git -C "$CASE" init -q
# Disposable fixture identity, never the production repository or a person.
git -C "$CASE" -c user.name=WindowFixture -c user.email=window-fixture@example.invalid commit -q --allow-empty -m 'native owner-window fixture'
OWNER_HEAD="$(git -C "$CASE" rev-parse HEAD)"
OWNER_HEAD="$OWNER_HEAD" OWNER_FILE="$OWNER_FILE" OWNER_CASE="$CASE" node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
const at=Date.now();
writeFileSync(process.env.OWNER_CASE+'/server/release/owner-maintenance-windows.json', JSON.stringify({version:1,windows:[{
 id:'native-owner-proof',contains:process.env.OWNER_HEAD,ownerOrder:"Native fixture only: publish now, don't wait",
 notBefore:new Date(at-60000).toISOString(),notAfter:new Date(at+3600000).toISOString(),migrations:[process.env.OWNER_FILE]
}]}));
JS
# An isolated scratch Git identity proves the real ancestry check.
# No protected-main or production state is modified.
owner_apply() { apply "$OWNER_FILE" --maintenance-window --owner-window native-owner-proof; }
su_sql "SELECT public.fixture_open_window(240); UPDATE public.engine_maintenance_break SET break_started_at=clock_timestamp()-interval '1 second', announced_at=clock_timestamp()-interval '2 minutes';" >/dev/null
set +e
out="$(owner_apply 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/9-owner-window.log"
[ "$code" = 1 ] || fail "ordinary scheduled freeze admitted owner exception: $code $out"
[ "$(counts)" = "2 2 2" ] || fail 'refused owner install changed state'
su_sql "UPDATE public.engine_maintenance_break SET reason='Deployment Recovery';" >/dev/null
set +e
out="$(owner_apply 2>&1)"; code=$?
set -e
echo "$out" >> "$EVIDENCE/9-owner-window.log"
[ "$code" = 0 ] || fail "owner window install failed: $code $out"
[ "$(counts)" = "3 3 3" ] || fail "owner install state: $(counts)"
out="$(owner_apply 2>&1)" || fail "owner repeat failed: $out"
[ "$(counts)" = "3 3 3" ] || fail 'owner repeat changed state'
pass 'explicit owner exception refuses a scheduled freeze, installs once in owned recovery, and duplicate is a no-op'

# 10. Two queued files through the unchanged real owner-window installer/applier.
# Each disposable pair gets unique versions/columns; no production SQL is used.
pair_fixture() {
  local tag="$1" first_version="$2" second_version="$3" first_fault="$4" second_fault="$5" second_depends="${6:-yes}"
  local order_check=""
  if [ "$second_depends" = yes ]; then
    order_check="DO \$pair_order\$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='clubs' AND column_name='window_fixture_pair_${tag}_first') THEN
  RAISE EXCEPTION 'second file ran before first committed';
 END IF;
END \$pair_order\$;"
  fi
  PAIR_CASE="$WORK/pair-$tag"
  mkdir -p "$PAIR_CASE/supabase/migrations" "$PAIR_CASE/server/release"
  PAIR_FIRST="${first_version}_window_fixture_pair_${tag}_first.sql"
  PAIR_SECOND="${second_version}_window_fixture_pair_${tag}_second.sql"
  cat > "$PAIR_CASE/supabase/migrations/$PAIR_FIRST" <<SQL
-- @install-window: daily-maintenance
BEGIN;
ALTER TABLE public.clubs ADD COLUMN window_fixture_pair_${tag}_first integer;
$first_fault
COMMIT;
SQL
  cat > "$PAIR_CASE/supabase/migrations/$PAIR_SECOND" <<SQL
-- @install-window: daily-maintenance
BEGIN;
$order_check
ALTER TABLE public.hand_history ADD COLUMN window_fixture_pair_${tag}_second integer;
$second_fault
COMMIT;
SQL
  git -C "$PAIR_CASE" init -q
  git -C "$PAIR_CASE" -c user.name=WindowFixture -c user.email=window-fixture@example.invalid commit -q --allow-empty -m 'isolated two-file owner-window fixture'
  local head
  head="$(git -C "$PAIR_CASE" rev-parse HEAD)"
  PAIR_CASE="$PAIR_CASE" PAIR_HEAD="$head" PAIR_FIRST="$PAIR_FIRST" PAIR_SECOND="$PAIR_SECOND" node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
const at=Date.now();
writeFileSync(process.env.PAIR_CASE+'/server/release/owner-maintenance-windows.json',JSON.stringify({version:1,databaseWindows:[{
 id:'native-pair-proof',contains:process.env.PAIR_HEAD,ownerOrder:'Isolated native two-file installation qualification only',
 notBefore:new Date(at-60000).toISOString(),notAfter:new Date(at+3600000).toISOString(),
 migrations:[process.env.PAIR_FIRST,process.env.PAIR_SECOND]
}]}));
JS
  su_sql "SELECT public.fixture_open_window(240); UPDATE public.engine_maintenance_break SET reason='Deployment Recovery',break_started_at=clock_timestamp()-interval '1 second',announced_at=clock_timestamp()-interval '2 minutes';" >/dev/null
}
pair_install() {
  (cd "$PAIR_CASE" && node "$ROOT/scripts/ci/install-window-migrations.mjs" \
    --owner-window native-pair-proof --ssl-root-cert "$CA")
}
pair_history() {
  su_sql "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('$1','$2')"
}

pair_fixture success 20991231000005 20991231000006 '' ''
out="$(pair_install 2>&1)" || fail "two queued files failed: $out"
echo "$out" > "$EVIDENCE/10-pair-success.log"
grep -q 'INSTALLED 2 migration' <<<"$out" || fail 'both queued files were not installed'
[ "$(pair_history 20991231000005 20991231000006)" = 2 ] || fail 'pair history missing'
[ "$(su_sql "SELECT a.xmin::text::bigint < b.xmin::text::bigint FROM supabase_migrations.schema_migrations a,supabase_migrations.schema_migrations b WHERE a.version='20991231000005' AND b.version='20991231000006'")" = t ] || fail 'pair transactions were out of order'
for file in "$PAIR_FIRST" "$PAIR_SECOND"; do
  [ "$(su_sql "SELECT statements[1]=pg_read_file('$PAIR_CASE/supabase/migrations/$file') FROM supabase_migrations.schema_migrations WHERE version='${file:0:14}'")" = t ] || fail 'pair history differs from exact source'
done
out="$(pair_install 2>&1)" || fail "pair duplicate failed: $out"
grep -q 'NOTHING QUEUED' <<<"$out" || fail 'pair duplicate was not a no-op'
[ "$(pair_history 20991231000005 20991231000006)" = 2 ] || fail 'pair duplicate changed history'
pass 'two queued files commit in order with exact history and duplicate no-op'

# A real PostgreSQL exception exercises REFUSED; class08 deliberately exercises
# the applier's UNKNOWN classification, not a claim of a real network failure.
# Since 2026-11-07 a REFUSED first file is skipped alone and the second file is
# still sent (here it depends on the first, so it is refused too and nothing
# commits); an UNKNOWN first file still stops the run before the second file.
for kind in refused unknown; do
  if [ "$kind" = refused ]; then code_expected=1; state=55000; first=20991231000007; second=20991231000008
  else code_expected=3; state=08006; first=20991231000009; second=20991231000010; fi
  fault="DO \$fault\$ BEGIN RAISE EXCEPTION 'isolated first-file fault' USING ERRCODE='$state'; END \$fault\$;"
  pair_fixture "$kind" "$first" "$second" "$fault" ''
  set +e
  out="$(pair_install 2>&1)"; code=$?
  set -e
  echo "$out" > "$EVIDENCE/10-pair-$kind.log"
  [ "$code" = "$code_expected" ] || fail "first $kind returned $code: $out"
  [ "$(pair_history "$first" "$second")" = 0 ] || fail "first $kind committed history"
  [ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name IN ('window_fixture_pair_${kind}_first','window_fixture_pair_${kind}_second')")" = 0 ] || fail "first $kind left either column"
  [ "$(grep -Fxc "[apply] $PAIR_FIRST" <<<"$out")" = 1 ] || fail "first $kind did not invoke its original file exactly once"
  if [ "$kind" = refused ]; then
    [ "$(grep -Fxc "[apply] $PAIR_SECOND" <<<"$out")" = 1 ] || fail "first refusal did not send the second file exactly once"
    grep -q "SKIPPED \`$PAIR_FIRST\`" <<<"$out" || fail "first refusal was not reported as skipped"
    grep -q "SKIPPED \`$PAIR_SECOND\`" <<<"$out" || fail "dependent second file was not reported as skipped"
    grep -q 'REFUSED 2 of 2 migration' <<<"$out" || fail "run did not name both skipped files: $out"
    pass 'first-file refusal is skipped alone, the dependent second file is sent once and refused, nothing commits'
  else
    ! grep -Fxq "[apply] $PAIR_SECOND" <<<"$out" || fail "first unknown invoked second file"
    pass 'first-file unknown stops before the second file and preserves original outcome'
  fi
done

# A REFUSED first file no longer holds an independent second file: the second
# installs with exact history, the first stays queued, and the run is red
# naming the skipped file (the 2026-11-07 root cause: one lock refusal held
# five unrelated migrations for a day).
fault="DO \$fault\$ BEGIN RAISE EXCEPTION 'isolated first-file refusal' USING ERRCODE='55000'; END \$fault\$;"
pair_fixture skipfwd 20991231000013 20991231000014 "$fault" '' no
set +e
out="$(pair_install 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/10-pair-skipfwd.log"
[ "$code" = 1 ] || fail "skip-forward returned $code: $out"
[ "$(pair_history 20991231000013 20991231000014)" = 1 ] || fail 'skip-forward history is not exactly the second file'
[ "$(su_sql "SELECT version='20991231000014' AND statements[1]=pg_read_file('$PAIR_CASE/supabase/migrations/$PAIR_SECOND') FROM supabase_migrations.schema_migrations WHERE version IN ('20991231000013','20991231000014')")" = t ] || fail 'skip-forward history differs from second source'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name='window_fixture_pair_skipfwd_first'")" = 0 ] || fail 'refused first file committed its column'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name='window_fixture_pair_skipfwd_second'")" = 1 ] || fail 'independent second file was not installed after the first refusal'
[ "$(grep -Fxc "[apply] $PAIR_FIRST" <<<"$out")" = 1 ] || fail 'skip-forward sent the first file other than once'
[ "$(grep -Fxc "[apply] $PAIR_SECOND" <<<"$out")" = 1 ] || fail 'skip-forward sent the second file other than once'
grep -q "SKIPPED \`$PAIR_FIRST\`" <<<"$out" || fail 'skip-forward did not name the skipped file'
grep -q "INSTALLED \`$PAIR_SECOND\`" <<<"$out" || fail 'skip-forward did not report the installed file'
grep -q "REFUSED 1 of 2 migration(s) - skipped (rolled back, still queued for the next daily window): \`$PAIR_FIRST\`; installed 1: \`$PAIR_SECOND\`" <<<"$out" || fail "skip-forward verdict wording: $out"
out="$(pair_install 2>&1)" && fail "skip-forward rerun installed the refused file: $out"
[ "$(pair_history 20991231000013 20991231000014)" = 1 ] || fail 'skip-forward rerun changed history'
grep -q "queued: \`$PAIR_FIRST\`" <<<"$out" || fail 'the refused file is not still queued on the next run'
pass 'a refused file is skipped alone; the independent file behind it installs and the refused one stays queued'

fault="DO \$fault\$ BEGIN RAISE EXCEPTION 'isolated second-file refusal' USING ERRCODE='55000'; END \$fault\$;"
pair_fixture partial 20991231000011 20991231000012 '' "$fault"
set +e
out="$(pair_install 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/10-pair-partial.log"
[ "$code" = 1 ] || fail "second refusal returned $code: $out"
[ "$(pair_history 20991231000011 20991231000012)" = 1 ] || fail 'second refusal lost first committed history'
[ "$(su_sql "SELECT version='20991231000011' AND statements[1]=pg_read_file('$PAIR_CASE/supabase/migrations/$PAIR_FIRST') FROM supabase_migrations.schema_migrations WHERE version IN ('20991231000011','20991231000012')")" = t ] || fail 'partial history differs from first source'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name='window_fixture_pair_partial_first'")" = 1 ] || fail 'first commit was lost'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name='window_fixture_pair_partial_second'")" = 0 ] || fail 'second refusal committed its column'
pass 'second-file refusal preserves the first exact committed transaction'

# 11. The quiet moment (2026-11-07). A reader in the middle of a multi-second
# transaction on the file's table refuses a lock sent at once (case 3). The
# installer reads pg_locks first, waits for the reader to finish, and then
# sends the file once: it installs. A reader that outlasts the bounded wait is
# named, the file is sent once as before and refused, and the holder at the
# refusal is named too. Nothing is ever retried.
QUIET="$WORK/quiet"
mkdir -p "$QUIET/supabase/migrations"
printf -- '-- Fixture: a window migration whose table is busy when the window opens.\n-- @install-window: daily-maintenance\nBEGIN;\nALTER TABLE public.hand_history ADD COLUMN window_fixture_quiet integer;\nCOMMIT;\n' \
  > "$QUIET/supabase/migrations/20991231000015_window_fixture_quiet_moment.sql"
hold_hand_history() { # $1 seconds; returns once the lock is granted
  as_pg "${SU[@]}" -c "BEGIN; LOCK TABLE public.hand_history IN ACCESS SHARE MODE; SELECT pg_sleep($1); COMMIT;" \
    >/dev/null 2>&1 &
  HOLDER=$!
  for _ in $(seq 1 50); do
    held="$(su_sql "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                    WHERE c.relname = 'hand_history' AND l.granted AND l.pid <> pg_backend_pid()")"
    [ "$held" -ge 1 ] && break
    sleep 0.1
  done
  [ "$held" -ge 1 ] || fail 'could not hold the fixture lock'
  sleep 0.4 # older than QUIET_HOLDER_AGE_MS
}
release_holder() {
  kill "$HOLDER" 2>/dev/null || true
  su_sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(%' AND query LIKE '%LOCK TABLE public.hand_history%' AND pid <> pg_backend_pid()" >/dev/null
  wait "$HOLDER" 2>/dev/null || true
}
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
hold_hand_history 3
set +e
out="$(installer "$QUIET" "$NOW_OPEN" 2>&1)"; code=$?
set -e
release_holder
echo "$out" > "$EVIDENCE/11a-quiet-moment.log"
[ "$code" = 0 ] && grep -q 'INSTALLED 1 migration' <<<"$out" || fail "quiet-moment run: $code $out"
grep -q 'quiet moment on public.hand_history (AccessExclusiveLock) after' <<<"$out" || fail "quiet-moment run did not wait: $out"
[ "$(grep -c '^\[apply\] 20991231000015' <<<"$out")" = 1 ] || fail 'quiet-moment file was not sent exactly once'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name = 'window_fixture_quiet'")" = 1 ] \
  || fail 'quiet-moment column missing'
pass 'a busy table is waited for, read-only, and the file installs on its one attempt'

printf -- '-- Fixture: a window migration whose table stays busy past the bounded wait.\n-- @install-window: daily-maintenance\nBEGIN;\nALTER TABLE public.hand_history ADD COLUMN window_fixture_never_quiet integer;\nCOMMIT;\n' \
  > "$QUIET/supabase/migrations/20991231000016_window_fixture_never_quiet.sql"
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
hold_hand_history 60
t0=$(date +%s%N)
set +e
out="$(installer "$QUIET" "$NOW_OPEN" 2>&1)"; code=$?
set -e
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
release_holder
echo "$out" > "$EVIDENCE/11b-never-quiet.log"
[ "$code" = 1 ] || fail "never-quiet run returned $code: $out"
grep -q 'no quiet moment on public.hand_history (AccessExclusiveLock) within 12000 ms' <<<"$out" || fail "never-quiet bound: $out"
grep -q 'Held by: public.hand_history AccessShareLock' <<<"$out" || fail "never-quiet holder not named: $out"
grep -q 'holders of public.hand_history after the refusal: public.hand_history AccessShareLock' <<<"$out" \
  || fail "refusal holder not named: $out"
[ "$(grep -c '^\[apply\] 20991231000016' <<<"$out")" = 1 ] || fail 'never-quiet file was not sent exactly once'
[ "$ms" -lt 30000 ] || fail "never-quiet run took ${ms} ms"
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name = 'window_fixture_never_quiet'")" = 0 ] \
  || fail 'never-quiet column was committed'
pass "a table busy past the bounded wait is sent once, refused, and its holder named (${ms} ms)"

# 12. A window migration names the lock it needs (2026-11-07). Three queued
# files: A declares no "-- @locks:" and carries the NEWEST version, B declares
# public.clubs (held busy past the bounded wait, so its one attempt is
# refused), C declares public.hand_history and is independent. The installer
# sends A first (undeclared files go first), then B and C by version; B is
# SKIPPED alone naming public.clubs, A and C install with exact history, the
# run is red. Then a file whose @locks value cannot be parsed is REFUSED before
# any wait.
LOCKS="$WORK/locks"
mkdir -p "$LOCKS/supabase/migrations"
LOCKS_B=20991231000017_window_fixture_locks_clubs.sql
LOCKS_C=20991231000018_window_fixture_locks_hand_history.sql
LOCKS_A=20991231000019_window_fixture_locks_undeclared.sql
printf -- '-- Fixture: declares the hot relation it locks; that relation stays busy.\n-- @install-window: daily-maintenance\n-- @locks: public.clubs\nBEGIN;\nALTER TABLE public.clubs ADD COLUMN window_fixture_locks_b integer;\nCOMMIT;\n' \
  > "$LOCKS/supabase/migrations/$LOCKS_B"
printf -- '-- Fixture: declares an independent hot relation.\n-- @install-window: daily-maintenance\n-- @locks: public.hand_history\nBEGIN;\nALTER TABLE public.hand_history ADD COLUMN window_fixture_locks_c integer;\nCOMMIT;\n' \
  > "$LOCKS/supabase/migrations/$LOCKS_C"
printf -- '-- Fixture: declares nothing, newest version; sent first all the same.\n-- @install-window: daily-maintenance\nBEGIN;\nALTER TABLE public.tables ADD COLUMN window_fixture_locks_a integer;\nCOMMIT;\n' \
  > "$LOCKS/supabase/migrations/$LOCKS_A"
hold_clubs() { # $1 seconds; returns once the lock is granted
  as_pg "${SU[@]}" -c "BEGIN; LOCK TABLE public.clubs IN ACCESS SHARE MODE; SELECT pg_sleep($1); COMMIT;" \
    >/dev/null 2>&1 &
  HOLDER=$!
  for _ in $(seq 1 50); do
    held="$(su_sql "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                    WHERE c.relname = 'clubs' AND l.granted AND l.pid <> pg_backend_pid()")"
    [ "$held" -ge 1 ] && break
    sleep 0.1
  done
  [ "$held" -ge 1 ] || fail 'could not hold the clubs fixture lock'
  sleep 0.4
}
release_clubs_holder() {
  kill "$HOLDER" 2>/dev/null || true
  su_sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(%' AND query LIKE '%LOCK TABLE public.clubs%' AND pid <> pg_backend_pid()" >/dev/null
  wait "$HOLDER" 2>/dev/null || true
}
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
hold_clubs 60
set +e
out="$(installer "$LOCKS" "$NOW_OPEN" 2>&1)"; code=$?
set -e
release_clubs_holder
echo "$out" > "$EVIDENCE/12-locks-order.log"
[ "$code" = 1 ] || fail "locks-order run returned $code: $out"
grep -q "send order: \`$LOCKS_A\`, \`$LOCKS_B\` (locks public.clubs), \`$LOCKS_C\` (locks public.hand_history)" <<<"$out" \
  || fail "locks-order send order not reported: $out"
line_a="$(grep -n "^\[apply\] $LOCKS_A\$" <<<"$out" | cut -d: -f1)"
line_b="$(grep -n "^\[apply\] $LOCKS_B\$" <<<"$out" | cut -d: -f1)"
line_c="$(grep -n "^\[apply\] $LOCKS_C\$" <<<"$out" | cut -d: -f1)"
[ -n "$line_a" ] && [ -n "$line_b" ] && [ -n "$line_c" ] || fail 'locks-order did not send every file'
[ "$line_a" -lt "$line_b" ] && [ "$line_b" -lt "$line_c" ] || fail "locks-order sent files out of order (A $line_a, B $line_b, C $line_c)"
for file in "$LOCKS_A" "$LOCKS_B" "$LOCKS_C"; do
  [ "$(grep -Fxc "[apply] $file" <<<"$out")" = 1 ] || fail "locks-order sent $file other than once"
done
grep -q "INSTALLED \`$LOCKS_A\`" <<<"$out" || fail 'locks-order did not install the undeclared file'
grep -q "INSTALLED \`$LOCKS_C\`" <<<"$out" || fail 'locks-order did not install the independent declared file'
grep -q "SKIPPED \`$LOCKS_B\`: REFUSED after .* Lost its lock on public.clubs\." <<<"$out" || fail "locks-order skip did not name the lost relation: $out"
grep -q "REFUSED 1 of 3 migration(s) - skipped (rolled back, still queued for the next daily window): \`$LOCKS_B\` (lost public.clubs); installed 2: \`$LOCKS_A\`, \`$LOCKS_C\`" <<<"$out" \
  || fail "locks-order verdict wording: $out"
[ "$(su_sql "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20991231000017','20991231000018','20991231000019')")" = 2 ] \
  || fail 'locks-order history is not exactly A and C'
[ "$(su_sql "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20991231000017'")" = 0 ] \
  || fail 'the refused declared file reached history'
for file in "$LOCKS_A" "$LOCKS_C"; do
  [ "$(su_sql "SELECT statements[1]=pg_read_file('$LOCKS/supabase/migrations/$file') FROM supabase_migrations.schema_migrations WHERE version='${file:0:14}'")" = t ] \
    || fail "locks-order history differs from exact source for $file"
done
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name = 'window_fixture_locks_b'")" = 0 ] \
  || fail 'the refused declared file committed its column'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name IN ('window_fixture_locks_a','window_fixture_locks_c')")" = 2 ] \
  || fail 'A or C column missing'
pass 'undeclared files go first, declared files follow by version, a lost lock is skipped alone and names its relation'

BADLOCKS="$WORK/badlocks"
mkdir -p "$BADLOCKS/supabase/migrations"
printf -- '-- Fixture: an @locks value that is not a relation list.\n-- @install-window: daily-maintenance\n-- @locks: nonsense\nBEGIN;\nALTER TABLE public.clubs ADD COLUMN window_fixture_badlocks integer;\nCOMMIT;\n' \
  > "$BADLOCKS/supabase/migrations/20991231000020_window_fixture_bad_locks.sql"
set +e
out="$(installer "$BADLOCKS" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/12-bad-locks.log"
[ "$code" = 1 ] && grep -q 'REFUSED before waiting' <<<"$out" || fail "bad @locks run: $code $out"
grep -q 'not a comma-separated list of schema-qualified relations' <<<"$out" || fail "bad @locks reason: $out"
! grep -q '^\[apply\] 20991231000020' <<<"$out" || fail 'bad @locks file was sent'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name = 'window_fixture_badlocks'")" = 0 ] \
  || fail 'bad @locks file committed'
pass 'an unparseable @locks line is refused before any wait and nothing is sent'

# 13. An idle session does not cost a window file a day (2026-11-08). Inside
# the confirmed freeze, immediately before a file that declares "-- @locks:",
# a session of the postgres role left IDLE IN TRANSACTION on a declared
# relation is terminated, recorded in ca_window_install_terminations, and the
# file installs on its one attempt. A holder running an active query is never
# terminated (nor an idle superuser session), and the file is refused as
# before. An undeclared file terminates nothing. Without a confirmed freeze
# the statement itself terminates nothing.
IDLE="$WORK/idle"
mkdir -p "$IDLE/supabase/migrations"
migrator_psql() { # $1 application_name; stdin is the session's script
  PGPASSWORD=window-fixture PGSSLMODE=verify-full PGSSLROOTCERT="$CA" PGAPPNAME="$1" \
    "$PG_BIN/psql" -X -q -h localhost -p "$PORT" -U postgres -d postgres
}
session_pid() { # $1 application_name $2 state
  su_sql "SELECT coalesce(max(pid)::text, '') FROM pg_stat_activity WHERE application_name = '$1' AND state = '$2'"
}
await_session() { # $1 application_name $2 state; prints its pid
  local pid=''
  for _ in $(seq 1 50); do
    pid="$(session_pid "$1" "$2")"
    [ -n "$pid" ] && break
    sleep 0.1
  done
  [ -n "$pid" ] || fail "no $2 session named $1"
  echo "$pid"
}
alive() { su_sql "SELECT count(*) FROM pg_stat_activity WHERE pid = $1"; }
idle_holder() { # $1 application_name $2 relation; a postgres-role session left idle in transaction
  ( printf 'BEGIN;\nLOCK TABLE %s IN ACCESS SHARE MODE;\nSELECT 1;\n' "$2"; sleep 121 ) \
    | migrator_psql "$1" >/dev/null 2>&1 &
  await_session "$1" 'idle in transaction'
}
end_fixture_sessions() {
  su_sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'window-fixture-%' OR (query LIKE '%pg_sleep(%' AND query LIKE '%LOCK TABLE public.clubs%' AND pid <> pg_backend_pid())" >/dev/null
  pkill -f 'sleep 121' 2>/dev/null || true
  wait 2>/dev/null || true
}
terminations() { su_sql "SELECT count(*) FROM public.ca_window_install_terminations"; }

# 13a. Idle in transaction on a declared relation: terminated, recorded, installed.
IDLE_A=20991231000021_window_fixture_idle_holder_ended.sql
printf -- '-- Fixture: its declared relation is held by a session left idle in transaction.\n-- @install-window: daily-maintenance\n-- @locks: public.clubs\nBEGIN;\nALTER TABLE public.clubs ADD COLUMN window_fixture_idle_a integer;\nCOMMIT;\n' \
  > "$IDLE/supabase/migrations/$IDLE_A"
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
idle_pid="$(idle_holder window-fixture-idle clubs)"
sleep 2.5 # idle for longer than IDLE_HOLDER_MIN_IDLE_MS
set +e
out="$(installer "$IDLE" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/13a-idle-holder-terminated.log"
idle_alive="$(alive "$idle_pid")"
end_fixture_sessions
[ "$code" = 0 ] && grep -q 'INSTALLED 1 migration' <<<"$out" || fail "idle-holder run: $code $out"
grep -q 'only sessions idle in transaction hold public.clubs (AccessExclusiveLock); not waiting for them' <<<"$out" \
  || fail "idle-holder run waited out the quiet bound: $out"
grep -q "terminated 1 of 1 session(s) idle in transaction on public.clubs before \`$IDLE_A\` (recorded in ca_window_install_terminations): pid $idle_pid postgres window-fixture-idle on public.clubs (AccessShareLock), idle in transaction" <<<"$out" \
  || fail "idle-holder termination not reported: $out"
[ "$(grep -Fxc "[apply] $IDLE_A" <<<"$out")" = 1 ] || fail 'idle-holder file was not sent exactly once'
[ "$idle_alive" = 0 ] || fail 'the idle holder is still connected'
row="$(su_sql "SELECT migration || '|' || pid || '|' || session_role || '|' || application_name || '|' || state || '|' || relation || '|' || lock_mode || '|' || terminated || '|' || (xact_age >= interval '2 seconds') || '|' || (idle_for >= interval '2 seconds') FROM public.ca_window_install_terminations")"
echo "$row" > "$EVIDENCE/13a-termination-record.txt"
[ "$row" = "$IDLE_A|$idle_pid|postgres|window-fixture-idle|idle in transaction|public.clubs|AccessShareLock|true|true|true" ] \
  || fail "termination record: $row"
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name = 'window_fixture_idle_a'")" = 1 ] \
  || fail 'idle-holder file column missing'
pass 'a postgres session idle in transaction on a declared relation is terminated, recorded, and the file installs once'

# 13b. An active query (and an idle superuser session) on the declared
# relation: neither is terminated; the file is sent once and refused.
IDLE_B=20991231000022_window_fixture_active_holder_kept.sql
printf -- '-- Fixture: its declared relation is held by an active query.\n-- @install-window: daily-maintenance\n-- @locks: public.clubs\nBEGIN;\nALTER TABLE public.clubs ADD COLUMN window_fixture_idle_b integer;\nCOMMIT;\n' \
  > "$IDLE/supabase/migrations/$IDLE_B"
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
printf 'BEGIN;\nLOCK TABLE public.clubs IN ACCESS SHARE MODE;\nSELECT pg_sleep(60);\n' \
  | migrator_psql window-fixture-active >/dev/null 2>&1 &
active_pid="$(await_session window-fixture-active active)"
( printf "SET application_name = 'window-fixture-superuser';\nBEGIN;\nLOCK TABLE public.clubs IN ACCESS SHARE MODE;\nSELECT 1;\n"; sleep 121 ) \
  | as_pg "${SU[@]}" >/dev/null 2>&1 &
super_pid="$(await_session window-fixture-superuser 'idle in transaction')"
sleep 2.5
before="$(terminations)"
set +e
out="$(installer "$IDLE" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/13b-active-holder-kept.log"
active_alive="$(alive "$active_pid")"
super_alive="$(alive "$super_pid")"
end_fixture_sessions
[ "$code" = 1 ] || fail "active-holder run returned $code: $out"
[ "$active_alive" = 1 ] || fail 'the active-query holder was terminated'
[ "$super_alive" = 1 ] || fail 'the idle superuser session was terminated'
! grep -q 'session(s) idle in transaction on' <<<"$out" || fail "active-holder run terminated something: $out"
[ "$(terminations)" = "$before" ] || fail 'active-holder run wrote a termination record'
grep -q "SKIPPED \`$IDLE_B\`" <<<"$out" || fail "active-holder file was not refused and skipped: $out"
[ "$(grep -Fxc "[apply] $IDLE_B" <<<"$out")" = 1 ] || fail 'active-holder file was not sent exactly once'
[ "$(su_sql "SELECT count(*) FROM information_schema.columns WHERE column_name = 'window_fixture_idle_b'")" = 0 ] \
  || fail 'active-holder file committed'
rm "$IDLE/supabase/migrations/$IDLE_B"
pass 'an active query and an idle superuser session are never terminated; the file is sent once and refused'

# 13c. A file that declares no "-- @locks:" terminates nothing.
IDLE_C=20991231000023_window_fixture_undeclared_idle_kept.sql
printf -- '-- Fixture: undeclared, its table held by a session idle in transaction.\n-- @install-window: daily-maintenance\nBEGIN;\nALTER TABLE public.clubs ADD COLUMN window_fixture_idle_c integer;\nCOMMIT;\n' \
  > "$IDLE/supabase/migrations/$IDLE_C"
su_sql 'SELECT public.fixture_open_window(240)' >/dev/null
idle_pid="$(idle_holder window-fixture-idle-undeclared clubs)"
sleep 2.5
before="$(terminations)"
set +e
out="$(installer "$IDLE" "$NOW_OPEN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/13c-undeclared-kept.log"
idle_alive="$(alive "$idle_pid")"
end_fixture_sessions
[ "$code" = 1 ] || fail "undeclared run returned $code: $out"
[ "$idle_alive" = 1 ] || fail 'an idle holder was terminated for an undeclared file'
[ "$(terminations)" = "$before" ] || fail 'undeclared run wrote a termination record'
grep -q "SKIPPED \`$IDLE_C\`" <<<"$out" || fail "undeclared file was not refused and skipped: $out"
rm "$IDLE/supabase/migrations/$IDLE_C"
pass 'a file that declares no lock terminates nothing'

# 13d. No confirmed freeze: the statement itself terminates nothing.
su_sql 'SELECT public.fixture_close_window()' >/dev/null
idle_pid="$(idle_holder window-fixture-idle-closed clubs)"
sleep 2.5
before="$(terminations)"
gate="$(cd "$ROOT" && CA="$CA" node --input-type=module -e "
  import pg from 'pg';
  import { readFileSync } from 'node:fs';
  import { IDLE_BLOCKERS_TERMINATE_QUERY } from './scripts/ci/maintenance-window-migrations.mjs';
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { ca: readFileSync(process.env.CA, 'utf8') } });
  await c.connect();
  const { rows } = await c.query(IDLE_BLOCKERS_TERMINATE_QUERY,
    [['public.clubs'], ['AccessExclusiveLock'], 2000, 1000, 'closed-window-fixture.sql']);
  await c.end();
  process.stdout.write(rows[0].open + ' ' + JSON.stringify(rows[0].terminations));
")"
idle_alive="$(alive "$idle_pid")"
end_fixture_sessions
echo "$gate" > "$EVIDENCE/13d-closed-window.txt"
[ "$gate" = 'false []' ] || fail "closed-window statement answered: $gate"
[ "$idle_alive" = 1 ] || fail 'an idle holder was terminated without a confirmed freeze'
[ "$(terminations)" = "$before" ] || fail 'closed-window statement wrote a termination record'
pass 'without a confirmed freeze the termination statement terminates nothing'

# 14. A declared offline install budget, on the ORDINARY route. The database's
# hourly :50-:03 refusal is stubbed out for this section only (it reads the
# real clock, and the ordinary route is not what is under test there), and the
# applier's own clock is moved to minute :20 as in section 1.
su_sql "SELECT public.fixture_close_window();
        CREATE OR REPLACE FUNCTION public.fn_ca_break_window_refuses_migrations(p_at timestamptz)
          RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
        CREATE TABLE public.gto_v31_budget_fixture (id integer PRIMARY KEY);
        ALTER TABLE public.gto_v31_budget_fixture OWNER TO postgres;" >/dev/null
BUDGET="$WORK/budget"
mkdir -p "$BUDGET/supabase/migrations"
budget_file() { # name, header line, body
  printf -- '-- Fixture: install budget case.\n%s\nBEGIN;\nSET LOCAL lock_timeout = '"'"'2s'"'"';\n%s\nCOMMIT;\n' "$2" "$3" \
    > "$BUDGET/supabase/migrations/$1"
}
budget_apply() {
  (cd "$BUDGET" && FAKE_NOW_MS="$OUTSIDE_BREAK_MINUTE" APPLY_DDL_ADMISSION_WAIT_MS=0 \
    node --import "$FIXTURES/shift-clock.mjs" "$ROOT/scripts/ci/apply-recorded-migration.mjs" \
    --ssl-root-cert "$CA" --migration "$1")
}
fixture_rows() { su_sql "SELECT count(*) FROM public.gto_v31_budget_fixture WHERE id = $1"; }
history_has() { su_sql "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${1:0:14}'"; }

B_OK=20991231000030_budget_fixture_offline_declared.sql
budget_file "$B_OK" '-- @install-budget-seconds: 30' \
  'INSERT INTO public.gto_v31_budget_fixture VALUES (1);
SELECT pg_sleep(13.5);'
set +e
started=$(date +%s); out="$(budget_apply "$B_OK" 2>&1)"; code=$?; took=$(( $(date +%s) - started ))
set -e
echo "$out" > "$EVIDENCE/14-declared-offline.log"
[ "$code" = 0 ] || fail "declared offline file exit $code: $out"
grep -q 'declared offline install budget 30 s admitted' <<<"$out" || fail "no admission line: $out"
[ "$took" -ge 13 ] || fail "declared offline install took ${took}s; it never ran past 12 s"
[ "$(fixture_rows 1)" = 1 ] && [ "$(history_has "$B_OK")" = 1 ] || fail 'declared offline file did not commit'
pass "an admitted offline file declaring 30 s runs past the ordinary 12 s (${took}s) and installs"

B_PLAIN=20991231000031_budget_fixture_offline_undeclared.sql
budget_file "$B_PLAIN" '-- (no budget declared)' \
  'INSERT INTO public.gto_v31_budget_fixture VALUES (2);
SELECT pg_sleep(13.5);'
set +e
out="$(budget_apply "$B_PLAIN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/14-undeclared.log"
[ "$code" = 1 ] || fail "undeclared slow file exit $code: $out"
grep -q '25P04' <<<"$out" || fail "undeclared slow file not killed by transaction_timeout: $out"
ms="$(sed -n 's/.*REFUSED after \([0-9]*\)ms.*/\1/p' <<<"$out" | head -1)"
[ -n "$ms" ] && [ "$ms" -ge 11500 ] && [ "$ms" -lt 13000 ] || fail "undeclared bound was ${ms}ms, expected ~12000"
[ "$(fixture_rows 2)" = 0 ] && [ "$(history_has "$B_PLAIN")" = 0 ] || fail 'undeclared slow file committed'
pass "the same offline file undeclared is killed at the ordinary 12 s bound (${ms}ms) and nothing commits"

B_LIVE=20991231000032_budget_fixture_live_static.sql
budget_file "$B_LIVE" '-- @install-budget-seconds: 30' \
  "UPDATE public.clubs SET name = name WHERE id = 1;"
set +e
out="$(budget_apply "$B_LIVE" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/14-live-static.log"
[ "$code" = 1 ] && grep -q 'touches public.clubs, which is not an offline relation' <<<"$out" \
  || fail "declared live file: $code $out"
! grep -q 'applying the migration as ONE transaction' <<<"$out" || fail 'declared live file was sent'
[ "$(history_has "$B_LIVE")" = 0 ] || fail 'declared live file committed'
pass 'a declared file that writes a live table is refused before anything is sent'

B_DYN=20991231000033_budget_fixture_live_dynamic.sql
budget_file "$B_DYN" '-- @install-budget-seconds: 30' \
  "INSERT INTO public.gto_v31_budget_fixture VALUES (3);
DO \$d\$ BEGIN EXECUTE 'UPDATE public.clubs SET name = name WHERE id = 1'; END \$d\$;"
set +e
out="$(budget_apply "$B_DYN" 2>&1)"; code=$?
set -e
echo "$out" > "$EVIDENCE/14-live-dynamic.log"
[ "$code" = 1 ] && grep -q 'install_budget_outside_offline_scope: this install holds public.clubs (RowExclusiveLock)' <<<"$out" \
  || fail "dynamic live write: $code $out"
[ "$(fixture_rows 3)" = 0 ] && [ "$(history_has "$B_DYN")" = 0 ] || fail 'dynamic live write committed'
pass 'a declared file reaching a live table through dynamic SQL is rolled back by the in-transaction scope check'

# 15. The actual starting-stack triggers, including registered service writes.
# Reuse this disposable native cluster; no new runner or production probe.
as_pg "${SU[@]}" -f "$FIXTURES/starting-stack-setup.sql" >/dev/null
as_pg "${SU[@]}" -f "$ROOT/supabase/migrations/20261102005209_an_add_on_pays_the_starting_stack.sql" >/dev/null
as_pg "${SU[@]}" -f "$ROOT/supabase/migrations/20261112013925_a_rebuy_pays_the_starting_stack.sql" >/dev/null
set +e
as_pg "${SU[@]}" -f "$FIXTURES/starting-stack-contract.sql" > "$EVIDENCE/15-starting-stack-before.log" 2>&1
code=$?
set -e
[ "$code" != 0 ] && grep -q 'registered service rebuy mismatch was accepted' "$EVIDENCE/15-starting-stack-before.log" \
  || fail 'starting-stack regression did not reproduce the old registered-write defect'
as_pg "${SU[@]}" -f "$ROOT/supabase/migrations/20261112151009_rebuy_and_addon_stack_invariants_survive_registered_updates.sql" > "$EVIDENCE/15-starting-stack-migration.log" 2>&1
as_pg "${SU[@]}" -f "$FIXTURES/starting-stack-contract.sql" > "$EVIDENCE/15-starting-stack-after.log" 2>&1 \
  || fail 'starting-stack native regression failed after the actual successor migration'
pass 'registered service transitions cannot mismatch rebuy/reentry/addon awards; no-ops and prices survive'

su_sql "SELECT version || ' ' || name FROM supabase_migrations.schema_migrations ORDER BY version" \
  > "$EVIDENCE/history.txt"
su_sql "SELECT id || ' ' || session_role || ' ' || coalesce(application_name, '') || ' ' || first_command || ' :: ' || reason FROM public.ca_break_window_migration_overrides ORDER BY id" \
  > "$EVIDENCE/overrides.txt"
echo 'ALL PASS' | tee -a "$EVIDENCE/result.txt"
