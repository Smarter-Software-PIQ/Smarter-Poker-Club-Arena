#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RESUME MIGRATION INSTALLS AFTER AN ENGINE-WINDOW PAUSE (2026-11-15)
#
# Usage:
#   bash scripts/release/resume-migration-installs.sh <pause-start-sha> [--dry-run]
#   Run at :05-:49 UTC (refuses at :48-:04 UTC for the database :50-:03 DDL refusal window).
#
# <pause-start-sha> is the main commit at which installs were paused: the
# booking merge (docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md, step 5).
#
# WHY THIS EXISTS. The playbook pauses migration installs from the booking merge
# to SEALED by switching a workflow off, because a migration installed after the
# Backup copy makes the certificate unusable. Ordinary merges keep landing during
# that pause. A switched-off workflow does not queue what it misses: GitHub drops
# the merge's `closed` event (dispatcher off) or the repository_dispatch
# (applier off). Re-enabling it afterwards installs nothing that merged in
# between. On 2026-11-15 both workflows were switched off at 17:12 UTC for the
# 1806z cutover, the release sealed at 18:28 UTC, and five ordinary migrations
# merged from 17:26 to 18:48 UTC sat uninstalled until migration-install-watch
# paged MergedMigrationNotInstalled (incident c1a85d20, the fourth recurrence).
#
# So resuming is one step, not two: switch BOTH workflows back on, then send
# every ordinary migration added or modified on main since the pause, once
# each, oldest first, through the same Apply Merged Migration door the
# dispatcher uses. The applier re-checks merged bytes, schema_migrations,
# SUPERSEDED marks and the break window for every file and answers
# ALREADY-APPLIED for a version production holds, so a file that was installed
# by hand during the pause costs one no-op run. Window files
# ("-- @install-window: daily-maintenance") are never sent: the 04:00 daily
# window installs them.
#
# This is a one-shot step of the cutover procedure, run by the custodian at
# SEALED (or abandonment). It is not a timer, watcher or retry (CLAUDE.md
# 10.12): it sends each file exactly once and never re-sends a refusal.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${REPO:-Smarter-Software-PIQ/Smarter-Poker-Club-Arena}"
SINCE="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ ! "$SINCE" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "usage: $0 <pause-start-sha> [--dry-run]" >&2
  echo "Run at :05-:49 UTC (refuses at :48-:04 UTC for the database :50-:03 DDL refusal window)." >&2
  exit 2
fi

# Merge-time main, not the local branch.
git fetch -q origin main
MAIN=$(git rev-parse origin/main)
if ! git merge-base --is-ancestor "$SINCE" "$MAIN"; then
  echo "REFUSED: $SINCE is not an ancestor of origin/main ($MAIN). Name the main commit at which installs were paused." >&2
  exit 2
fi

FILE_RE='^supabase/migrations/[0-9]{14}_[A-Za-z0-9_.-]+\.sql$'
WINDOW_RE='^[[:space:]]*--[[:space:]]*@install-window:[[:space:]]*daily-maintenance'

mapfile -t CHANGED < <(git diff --name-only --diff-filter=AM "$SINCE" "$MAIN" -- supabase/migrations \
  | grep -E "$FILE_RE" | sort)

SEND=()
for path in "${CHANGED[@]}"; do
  if git show "$MAIN:$path" | grep -qE "$WINDOW_RE"; then
    echo "QUEUED FOR THE DAILY WINDOW (not sent): ${path#supabase/migrations/}"
    continue
  fi
  SEND+=("${path#supabase/migrations/}")
done

if [[ ${#SEND[@]} -eq 0 ]]; then
  echo "Nothing to send: no ordinary migration was added or modified on main since $SINCE."
fi
for f in "${SEND[@]}"; do echo "TO SEND: $f"; done

if $DRY_RUN; then
  echo "DRY RUN: nothing enabled, nothing sent."
  exit 0
fi

# The applier refuses at :50-:03 UTC. Sending into that refusal would strand the
# file again with nobody owning it, so refuse here and say when to run.
MIN=$((10#$(date -u +%M)))
if (( MIN >= 48 || MIN <= 4 )); then
  echo "REFUSED: minute-of-hour :$(date -u +%M) UTC is inside the database's :50-:03 DDL refusal (with margin). Run again at :05 UTC or later. Nothing was enabled or sent." >&2
  exit 4
fi

gh workflow enable apply-merged-migration.yml -R "$REPO"
gh workflow enable dispatch-merged-migrations.yml -R "$REPO"
for w in apply-merged-migration.yml dispatch-merged-migrations.yml; do
  state=$(gh api "repos/$REPO/actions/workflows/$w" --jq .state)
  if [[ "$state" != "active" ]]; then
    echo "REFUSED: $w reads '$state' after enabling, so a dispatch would be dropped. Nothing was sent." >&2
    exit 3
  fi
  echo "ENABLED: $w"
done

for f in "${SEND[@]}"; do
  gh api --method POST "repos/$REPO/dispatches" \
    -f event_type=apply-merged-migration \
    -f "client_payload[migration]=$f" \
    -F "client_payload[dry_run]=false" >/dev/null
  echo "SENT: $f"
done

echo "Read each run's result: gh run list -R $REPO --workflow apply-merged-migration.yml -L ${#SEND[@]}"
