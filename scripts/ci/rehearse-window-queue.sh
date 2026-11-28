#!/usr/bin/env bash
# Install the daily-maintenance window queue, in the installer's order, into a
# THROWAWAY database that already holds production's schema
# (scripts/ci/window-queue-rehearsal.mjs says which files and in what order).
#
#   REHEARSAL_PSQL       psql argv prefix for the throwaway database (no production URL, ever);
#                        SQL is sent on stdin, so a `docker exec -i ... psql` prefix works
#   REHEARSAL_ADMIN_PSQL optional superuser psql argv prefix (e.g. supabase_admin) for
#                        pg_catalog.pg_class planner-stats seeding; falls back to REHEARSAL_PSQL
#   MIG_DIR              migrations tree: main's files overlaid with the pull request's
#   INSTALLED            file of 14-digit versions production holds (one per line)
#   CHANGED              file of migration names the pull request adds or modifies
#   EVIDENCE             output directory
#
# Ordinary migrations production has not installed go first (their own route
# installs them before 04:00); one that does not install here is reported and
# the queue continues. A window file the pull request adds or modifies that
# does not install fails the gate (exit 1). A window file already on main that
# does not install is reported loudly; it is the 04:00 run's failure already.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${REHEARSAL_PSQL:?}" "${MIG_DIR:?}" "${INSTALLED:?}" "${CHANGED:?}" "${EVIDENCE:?}"
read -r -a PSQL <<<"$REHEARSAL_PSQL"
if [ -n "${REHEARSAL_ADMIN_PSQL:-}" ]; then
  read -r -a ADMIN_PSQL <<<"$REHEARSAL_ADMIN_PSQL"
else
  ADMIN_PSQL=("${PSQL[@]}")
fi
mkdir -p "$EVIDENCE"
SUMMARY="$EVIDENCE/summary.md"
say() { echo "$*" | tee -a "$SUMMARY" >&2; echo "$*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
: > "$SUMMARY"

PLAN="$(node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" plan "$MIG_DIR" "$INSTALLED" "$CHANGED")"
echo "$PLAN" > "$EVIDENCE/plan.json"
mapfile -t ORDINARY < <(jq -r '.ordinary[]' <<<"$PLAN")
mapfile -t WINDOW < <(jq -r '.window[]' <<<"$PLAN")
say "### Window migrations install against production's schema"
say ""
say "- queue: ${#ORDINARY[@]} uninstalled ordinary prerequisite(s), then ${#WINDOW[@]} window file(s) in installer order."

FAIL=0
while IFS=$'\t' read -r name reason changed; do
  [ -n "$name" ] || continue
  say "- **INVALID** \`$name\`: $reason"
  [ "$changed" = true ] && FAIL=1
done < <(jq -r '.invalid[] | [.name, .reason, (.changed|tostring)] | @tsv' <<<"$PLAN")

is_changed() { grep -Fxq -- "$1" <(sed 's#^supabase/migrations/##' "$CHANGED"); }

SEED_READY=0
NEEDS_RESEED=0
seed_row_scale_stats() {
  if node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" seed-stats "$TABLE_STATS" \
      | "${ADMIN_PSQL[@]}" -X -q -v ON_ERROR_STOP=1 > "$EVIDENCE/seed-stats.log" 2>&1; then
    SEED_READY=1
    NEEDS_RESEED=0
    return 0
  else
    SEED_READY=0
    FAIL=1
    say "- **REFUSED** row-scale planner stats could not be seeded ($(grep -m1 -E 'ERROR' "$EVIDENCE/seed-stats.log" | cut -c1-200))"
    return 1
  fi
}

check_file_plans() {
  local f="$1"
  [ -n "${TABLE_STATS:-}" ] && [ -s "$TABLE_STATS" ] && [ "$SEED_READY" = 1 ] || return 0
  if [ "$NEEDS_RESEED" = 1 ]; then
    seed_row_scale_stats || return 0
  fi
  if REHEARSAL_PSQL="$REHEARSAL_PSQL" EVIDENCE="$EVIDENCE" \
      node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" check-plans "$MIG_DIR" "$TABLE_STATS" --file "$f" \
      > "$EVIDENCE/$f.plans.log" 2>&1; then
    cat "$EVIDENCE/$f.plans.log" >> "$EVIDENCE/hot-table-plans.log"
    say "- hot-table query-plan guard \`$f\`: $(tail -1 "$EVIDENCE/$f.plans.log")"
  else
    cat "$EVIDENCE/$f.plans.log" >> "$EVIDENCE/hot-table-plans.log"
    FAIL=1
    say "- **REFUSED** hot-table query-plan guard \`$f\`: $(head -5 "$EVIDENCE/$f.plans.log" | tr '\n' ' ' | cut -c1-400)"
  fi
}

# When production row-scale cardinality metadata was captured, seed planner
# statistics as superuser (fail closed on error) before rehearsing the queue,
# then evaluate each changed migration's hot-table plans right before it
# installs so preceding migrations + same-migration DDL/indexes are visible.
if [ -n "${TABLE_STATS:-}" ] && [ -s "$TABLE_STATS" ]; then
  : > "$EVIDENCE/hot-table-plans.log"
  rm -f "$EVIDENCE/hot-table-plans.json"
  if seed_row_scale_stats; then
    say "- row-scale planner stats seeded from \`$(basename "$TABLE_STATS")\`"
  fi
fi

for f in "${ORDINARY[@]}"; do
  if is_changed "$f"; then
    check_file_plans "$f"
  fi
  if "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 < "$MIG_DIR/$f" > "$EVIDENCE/$f.log" 2>&1; then
    say "- prerequisite \`$f\`: installed"
    NEEDS_RESEED=1
  else
    say "- prerequisite \`$f\`: did not install here ($(grep -m1 -E 'ERROR' "$EVIDENCE/$f.log" | cut -c1-200)); continuing"
  fi
done

for f in "${WINDOW[@]}"; do
  if is_changed "$f"; then
    check_file_plans "$f"
  fi
  if node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" sql "$MIG_DIR" "$f" \
      | "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 > "$EVIDENCE/$f.log" 2>&1; then
    say "- window \`$f\`: INSTALLED"
    NEEDS_RESEED=1
  else
    err="$(grep -m1 -E 'ERROR' "$EVIDENCE/$f.log" | cut -c1-300)"
    if is_changed "$f"; then
      FAIL=1
      say "- **REFUSED** window \`$f\` (this pull request): $err"
    else
      say "- **REFUSED (already on main)** window \`$f\`: $err. The 04:00 window will refuse it too; fix it in its own pull request."
    fi
  fi
done

if [ "$FAIL" = 1 ]; then
  say ""
  say "A window migration this pull request adds or changes does not install against production's schema with the queue ahead of it. At 04:00 it would be refused and stay queued. Fix the file (a missing function or table usually means its dependency is not installed yet: ship that first, or put it earlier in the queue)."
  exit 1
fi
say ""
say "OK: every window migration this pull request adds or changes installs against production's schema, in queue order."
