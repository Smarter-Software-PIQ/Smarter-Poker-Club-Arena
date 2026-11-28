#!/usr/bin/env bash
# Install the daily-maintenance window queue, in the installer's order, into a
# THROWAWAY database that already holds production's schema
# (scripts/ci/window-queue-rehearsal.mjs says which files and in what order).
#
#   REHEARSAL_PSQL   psql argv prefix for the throwaway database (no production URL, ever);
#                    SQL is sent on stdin, so a `docker exec -i ... psql` prefix works
#   MIG_DIR          migrations tree: main's files overlaid with the pull request's
#   INSTALLED        file of 14-digit versions production holds (one per line)
#   CHANGED          file of migration names the pull request adds or modifies
#   EVIDENCE         output directory
#
# Ordinary migrations production has not installed go first (their own route
# installs them before 04:00). An unchanged ordinary file already on main that
# does not install here is reported and the queue continues. An ordinary OR
# window file THIS pull request adds or modifies that fails against
# production's schema fails the gate (exit 1) — incident 37a45c05 / alert
# 450013 (PR #12325, 2026-11-28): swallowing a changed ordinary migration's
# rehearsal error let a broken probe merge and page MergedMigrationNotInstalled.
# A genuine live-row-only ordinary migration may declare
# `-- @rehearsal-schema-only-exempt: <reason >= 20 chars>`. A window file
# already on main that does not install is reported loudly; it is the 04:00
# run's failure already.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${REHEARSAL_PSQL:?}" "${MIG_DIR:?}" "${INSTALLED:?}" "${CHANGED:?}" "${EVIDENCE:?}"
read -r -a PSQL <<<"$REHEARSAL_PSQL"
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

for f in "${ORDINARY[@]}"; do
  if "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 < "$MIG_DIR/$f" > "$EVIDENCE/$f.log" 2>&1; then
    say "- prerequisite \`$f\`: installed"
  else
    err="$(grep -m1 -E 'ERROR' "$EVIDENCE/$f.log" | cut -c1-300)"
    if is_changed "$f"; then
      exempt_reason="$(node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" schema-only-exempt "$MIG_DIR" "$f" || true)"
      if [ -n "$exempt_reason" ]; then
        say "- ordinary \`$f\` (this pull request, @rehearsal-schema-only-exempt: $exempt_reason): did not install on empty schema ($err); continuing"
      else
        FAIL=1
        say "- **REFUSED** ordinary \`$f\` (this pull request): $err"
      fi
    else
      say "- prerequisite \`$f\`: did not install here ($(printf '%s' "$err" | cut -c1-200)); continuing"
    fi
  fi
done

# When production row-scale cardinality metadata was captured, seed planner
# statistics into the throwaway database and refuse install-time Seq Scans on
# high-cardinality hot tables before installing the queue.
if [ -n "${TABLE_STATS:-}" ] && [ -s "$TABLE_STATS" ]; then
  if node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" seed-stats "$TABLE_STATS" \
      | "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 > "$EVIDENCE/seed-stats.log" 2>&1; then
    say "- row-scale planner stats seeded from \`$(basename "$TABLE_STATS")\`"
  else
    say "- warning: could not seed row-scale stats ($(grep -m1 -E 'ERROR' "$EVIDENCE/seed-stats.log" | cut -c1-200))"
  fi
  if REHEARSAL_PSQL="$REHEARSAL_PSQL" EVIDENCE="$EVIDENCE" \
      node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" check-plans "$MIG_DIR" "$TABLE_STATS" "$CHANGED" \
      > "$EVIDENCE/hot-table-plans.log" 2>&1; then
    say "- hot-table query-plan guard: $(tail -1 "$EVIDENCE/hot-table-plans.log")"
  else
    FAIL=1
    say "- **REFUSED** hot-table query-plan guard: $(head -5 "$EVIDENCE/hot-table-plans.log" | tr '\n' ' ' | cut -c1-400)"
  fi
fi

for f in "${WINDOW[@]}"; do
  if node "$ROOT/scripts/ci/window-queue-rehearsal.mjs" sql "$MIG_DIR" "$f" \
      | "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 > "$EVIDENCE/$f.log" 2>&1; then
    say "- window \`$f\`: INSTALLED"
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
  say "A migration this pull request adds or changes does not install against production's schema with the queue ahead of it. In production it would be refused and leave a merged migration uninstalled. Fix the file (a missing function or table usually means its dependency is not installed yet; a broken DO probe must pass against production's triggers and schema, or for a genuine live-row-only ordinary migration declare \`-- @rehearsal-schema-only-exempt: <reason >= 20 chars>\`)."
  exit 1
fi
say ""
say "OK: every migration this pull request adds or changes installs against production's schema, in queue order."
