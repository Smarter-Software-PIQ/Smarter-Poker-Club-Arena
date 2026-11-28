#!/usr/bin/env bash
# Native regression for scripts/ci/rehearse-window-queue.sh on PostgreSQL 17:
#   1. a queue whose window files depend only on production and on earlier
#      queued files installs, and an installed version is never re-run;
#   2. a window file that calls a function production lacks (the 2026-11-17
#      shape) fails the gate when the pull request adds it, naming the function;
#   3. the same broken file already on main is reported, not charged to an
#      unrelated pull request.
# Usage: PG_BIN=/usr/lib/postgresql/17/bin bash scripts/ci/test-window-queue-rehearsal.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
WORK="${REHEARSAL_WORK:-/var/tmp/pg-window-rehearsal}"
PORT="${REHEARSAL_PORT:-55445}"
EVIDENCE_ROOT="${REHEARSAL_EVIDENCE:-$ROOT/artifacts/window-queue-rehearsal}"
FIX="$ROOT/scripts/ci/fixtures/window-queue-rehearsal"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
rm -rf "$WORK"; mkdir -p "$WORK" "$EVIDENCE_ROOT"; [ "$(id -u)" = 0 ] && chown postgres "$WORK"
as_pg "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth-local=trust >/dev/null
as_pg "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
trap 'as_pg "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true' EXIT
fail() { echo "FAIL: $*" | tee -a "$EVIDENCE_ROOT/result.txt"; exit 1; }
pass() { echo "PASS: $*" | tee -a "$EVIDENCE_ROOT/result.txt"; }
: > "$EVIDENCE_ROOT/result.txt"

# One fresh database per case, restored from the fixture "production".
case_db() {
  local db="$1"; shift
  as_pg "$PG_BIN/createdb" -h "$WORK" -p "$PORT" -U postgres "$db"
  as_pg "$PG_BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 -f "$FIX/schema.sql"
  local dir="$WORK/$db"; mkdir -p "$dir/mig"
  for f in "$@"; do cp "$FIX/$f" "$dir/mig/"; done
  echo 20991231100004 > "$dir/installed.txt"
  : > "$dir/changed.txt"
  echo "$dir"
}
rehearse() {
  local db="$1" dir="$2"
  REHEARSAL_PSQL="$(if [ "$(id -u)" = 0 ]; then echo "runuser -u postgres --"; fi) $PG_BIN/psql -h $WORK -p $PORT -U postgres -d $db" \
    MIG_DIR="$dir/mig" INSTALLED="$dir/installed.txt" CHANGED="$dir/changed.txt" EVIDENCE="$EVIDENCE_ROOT/$db" \
    bash "$ROOT/scripts/ci/rehearse-window-queue.sh"
}
GOOD=(20991231100001_window_rehearsal_creates_a_helper.sql 20991231100002_window_rehearsal_uses_the_queued_helper.sql 20991231100004_window_rehearsal_installed_already.sql)
BAD=20991231100003_window_rehearsal_needs_a_missing_function.sql

# 1
dir="$(case_db good "${GOOD[@]}")"
printf '%s\n' 20991231100002_window_rehearsal_uses_the_queued_helper.sql > "$dir/changed.txt"
rehearse good "$dir" 2> "$EVIDENCE_ROOT/1.log" || fail "a clean queue did not install (see 1.log)"
col="$(as_pg "$PG_BIN/psql" -X -Atq -h "$WORK" -p "$PORT" -U postgres -d good -c "SELECT count(*) FROM information_schema.columns WHERE table_name='window_rehearsal_seats' AND column_name='rehearsed'")"
[ "$col" = 1 ] || fail "the queued helper's dependant did not install"
grep -q '20991231100004' "$EVIDENCE_ROOT/good/plan.json" && fail "an installed version was queued"
pass 'a queue depending on production and on earlier queued files installs; installed versions are not re-run'

# 2
dir="$(case_db bad "${GOOD[@]}" "$BAD")"
printf '%s\n' "supabase/migrations/$BAD" > "$dir/changed.txt"
set +e; rehearse bad "$dir" 2> "$EVIDENCE_ROOT/2.log"; code=$?; set -e
[ "$code" = 1 ] || fail "a pull request adding a window file with a missing dependency exited $code, expected 1"
grep -q "REFUSED\*\* window \`$BAD\` (this pull request)" "$EVIDENCE_ROOT/bad/summary.md" || fail 'the refusal did not name the file'
grep -q 'fn_window_rehearsal_missing_immutable' "$EVIDENCE_ROOT/bad/summary.md" || fail 'the refusal did not name the missing function'
pass 'a pull request adding a window file that calls a function production lacks fails, naming the function'

# 3
dir="$(case_db onmain "${GOOD[@]}" "$BAD")"
printf '%s\n' 20991231100001_window_rehearsal_creates_a_helper.sql > "$dir/changed.txt"
rehearse onmain "$dir" 2> "$EVIDENCE_ROOT/3.log" || fail "a broken file already on main failed an unrelated pull request"
grep -q "REFUSED (already on main)\*\* window \`$BAD\`" "$EVIDENCE_ROOT/onmain/summary.md" || fail 'the broken main file was not reported'
pass 'a broken window file already on main is reported without failing an unrelated pull request'

# 4 — incident 37a45c05 / PR #12325: a broken ordinary migration added by THIS pull request fails
BAD_ORD=20991231100005_ordinary_rehearsal_broken_probe.sql
EXEMPT_ORD=20991231100006_ordinary_rehearsal_schema_only_exempt.sql
dir="$(case_db bad_ord "${GOOD[@]}" "$BAD_ORD")"
printf '%s\n' "supabase/migrations/$BAD_ORD" > "$dir/changed.txt"
set +e; rehearse bad_ord "$dir" 2> "$EVIDENCE_ROOT/4.log"; code=$?; set -e
[ "$code" = 1 ] || fail "a pull request adding a broken ordinary migration exited $code, expected 1"
grep -q "REFUSED\*\* ordinary \`$BAD_ORD\` (this pull request)" "$EVIDENCE_ROOT/bad_ord/summary.md" || fail 'the ordinary refusal did not name the file'
grep -q 'simulated trigger double-ingest' "$EVIDENCE_ROOT/bad_ord/summary.md" || fail 'the ordinary refusal did not include the SQL error'
pass 'a pull request adding a broken ordinary migration fails, naming the file and error'

# 5 — the same broken ordinary file already on main warns and continues for an unrelated PR
dir="$(case_db bad_ord_main "${GOOD[@]}" "$BAD_ORD")"
printf '%s\n' 20991231100001_window_rehearsal_creates_a_helper.sql > "$dir/changed.txt"
rehearse bad_ord_main "$dir" 2> "$EVIDENCE_ROOT/5.log" || fail "a broken ordinary file already on main failed an unrelated pull request"
grep -q "prerequisite \`$BAD_ORD\`: did not install here" "$EVIDENCE_ROOT/bad_ord_main/summary.md" || fail 'the broken main ordinary prerequisite was not reported'
pass 'a broken ordinary migration already on main is reported without failing an unrelated pull request'

# 6 — an ordinary migration explicitly declaring @rehearsal-schema-only-exempt documents its reason and continues
dir="$(case_db exempt_ord "${GOOD[@]}" "$EXEMPT_ORD")"
printf '%s\n' "supabase/migrations/$EXEMPT_ORD" > "$dir/changed.txt"
rehearse exempt_ord "$dir" 2> "$EVIDENCE_ROOT/6.log" || fail "an explicitly @rehearsal-schema-only-exempt ordinary migration failed"
grep -q "ordinary \`$EXEMPT_ORD\` (this pull request, @rehearsal-schema-only-exempt:" "$EVIDENCE_ROOT/exempt_ord/summary.md" || fail 'the exemption reason was not recorded'
pass 'an explicitly @rehearsal-schema-only-exempt ordinary migration documents its reason and continues'
