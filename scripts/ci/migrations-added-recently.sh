#!/usr/bin/env bash
# Print the migration files first added to this checkout's HEAD within the last
# DAYS days (default 14), one supabase/migrations/<file> per line: the git half
# of the evidence window-queue-rehearsal.mjs isPending reads. A file merged late
# with an old version stamp is in this list, however old the stamp.
#
# The checkout is shallow; this deepens it to the window (one bounded fetch of a
# public repository, no credential) and excludes the shallow boundary commits,
# which would otherwise read as adding every file in the tree. If the history
# cannot be fetched it prints nothing and says so on stderr: no evidence, not a
# guess (isPending then falls back to its time bound).
set -uo pipefail
DAYS="${1:-14}"
head=$(git rev-parse HEAD) || { echo "[migrations-added-recently] not a git checkout" >&2; exit 0; }
if ! git fetch --quiet --no-tags --shallow-since="$((DAYS + 1)) days ago" origin "$head" 2>/dev/null; then
  echo "[migrations-added-recently] could not deepen the checkout; no git evidence" >&2
  exit 0
fi
roots=$(git rev-list --max-parents=0 HEAD)
git log --no-renames --diff-filter=A --name-only --format= --since="$DAYS days ago" HEAD --not $roots -- supabase/migrations \
  | grep -E '^supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql$' | sort -u
exit 0
