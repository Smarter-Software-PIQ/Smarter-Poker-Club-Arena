#!/usr/bin/env bash
# Run the pre-merge DDL-guard check (migration-guards-before-merge.mjs) against a
# copy of PRODUCTION'S REAL SCHEMA, for one of the incident's cases
# (ddl-guard-cases.mjs), and assert the outcome production's guards gave it.
#
# Why this exists: the gate itself runs as pull_request_target, so it always
# runs main's workflow and main's scripts with main's capture; a change to the
# gate's own tooling can never be exercised on its own pull request there.
# This runs the branch's tooling instead (pull_request, no secret), on the
# schema archive main's trusted capture job last took read-only
# (window-rehearsal-schema). The parts of the capture that need the
# credential are stood in for: the catalog and pins are read from the restored
# copy (the same function sources), and the event-trigger list and the
# registry rows come from the production snapshot in
# scripts/ci/fixtures/production-ddl-guards (read 2026-11-18).
#
#   SCHEMA_DUMP  production's schema-only archive (from the capture artifact)
#   INSTALLED    production's installed versions (from the same artifact)
#   CASE         a case name from ddl-guard-cases.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${SCHEMA_DUMP:?}" "${INSTALLED:?}" "${CASE:?}"
WORK="${RUNNER_TEMP:-/tmp}/ddl-guard-$CASE"
CONTAINER="ddl-guard-$CASE"
PASSWORD="${REHEARSAL_DB_PASSWORD:-rehearsal-only}"
rm -rf "$WORK"; mkdir -p "$WORK/mig" "$WORK/capture"

REHEARSAL_DB_PASSWORD="$PASSWORD" bash "$ROOT/scripts/ci/restore-schema-for-rehearsal.sh" "$SCHEMA_DUMP" "$CONTAINER"

cp "$ROOT"/supabase/migrations/*.sql "$WORK/mig/"
read -r FILE EXPECT_REFUSED < <(cd "$ROOT" && node scripts/ci/ddl-guard-cases.mjs "$CASE" "$WORK/mig" | tr '\t' ' ')
VERSION="${FILE%%_*}"
echo "supabase/migrations/$FILE" > "$WORK/changed.txt"
# The case is judged as if production had not installed it yet.
grep -vx "$VERSION" "$INSTALLED" > "$WORK/installed.txt" || true

PSQL="docker exec -i $CONTAINER psql -U postgres -d postgres"
for q in catalog-catalog-path:guards-catalog.tsv catalog-public-path:guards-public.tsv pins:guards-hex.tsv pins-public-path:guards-hex-public.tsv; do
  node "$ROOT/scripts/ci/migration-guards-capture.mjs" sql "${q%%:*}" \
    | $PSQL -X -q -A -t -F $'\t' -v ON_ERROR_STOP=1 > "$WORK/capture/${q##*:}"
done
node -e '
  const fs = require("fs");
  const [fx, dir] = process.argv.slice(1);
  const j = JSON.parse(fs.readFileSync(fx, "utf8"));
  fs.writeFileSync(dir + "/guards-event-triggers.tsv", j.production_event_triggers_tsv);
  fs.writeFileSync(dir + "/guards-copy-ca_money_rpc_registry.txt",
    j.registry_at_11266_merge.rows.map(([n, s]) => `${n}\t${s}\t\\N\t2026-11-18 00:00:00+00`).join("\n") + "\n");
  fs.writeFileSync(dir + "/guards-copy-function_body_lineage.txt", "");
' "$ROOT/scripts/ci/fixtures/production-ddl-guards/live-definitions.json" "$WORK/capture"

set +e
REHEARSAL_PSQL="$PSQL" \
REHEARSAL_ADMIN_PSQL="docker exec -i -e PGPASSWORD=$PASSWORD $CONTAINER psql -U supabase_admin -d postgres" \
MIG_DIR="$WORK/mig" INSTALLED="$WORK/installed.txt" CHANGED="$WORK/changed.txt" \
CAPTURE_DIR="$WORK/capture" EVIDENCE="$WORK/evidence" \
  node "$ROOT/scripts/ci/migration-guards-before-merge.mjs" rehearse
status=$?
set -e
summary="$(cat "$WORK/evidence/summary.md")"
if [ -n "$EXPECT_REFUSED" ]; then
  if [ "$status" = 1 ] && grep -qF -- "$EXPECT_REFUSED" <<<"$summary"; then
    echo "OK: $CASE ($FILE) was refused by $EXPECT_REFUSED, as production refused it."
    exit 0
  fi
  echo "::error::$CASE ($FILE) should have been refused by $EXPECT_REFUSED; the check exited $status."
  exit 1
fi
if [ "$status" = 0 ]; then
  echo "OK: $CASE ($FILE) passes production's DDL guards."
  exit 0
fi
echo "::error::$CASE ($FILE) should pass; the check exited $status."
exit 1
