#!/bin/zsh
# Protected install of ONE merged migration through the apply-merged-migration
# workflow: dry run, then real run; each waits for its own workflow run (matched
# by the job name "Apply <file>"). Avoids :44 to :04 UTC (database DDL break).
R=Smarter-Software-PIQ/Smarter-Poker-Club-Arena
F="$1"; LOG="$2"; O=${0:A:h}
gh_() { env -u GH_TOKEN -u GITHUB_TOKEN gh "$@"; }
wait_window() { while :; do M=$(date -u +%M); M=${M#0}; if [ "$M" -ge 44 ] || [ "$M" -lt 5 ]; then sleep 30; else break; fi; done; }
# A run is matched by its run-name, which exists from the moment it is created.
# Matching the first job's name (before 2026-11-24) missed a run still waiting
# in the per-file concurrency group behind the merge dispatcher's own run for
# the same file: no job yet, so "no run appeared" (exit 3) for a migration that
# installed minutes later (Production Alerts 444704, 20261118233000).
runs() { gh_ run list -R $R --workflow apply-merged-migration.yml --limit 50 --json databaseId,displayTitle,status 2>/dev/null; }
latest_run() { runs | python3 $O/apply-runs.py "$F" latest; }
# Never stack a send behind a run already in flight for this file (the merge
# dispatcher sends every merged migration itself): wait for it to finish first,
# so this driver neither waits on a queued run it cannot see nor displaces a
# pending one. An unreadable listing is not "none in flight".
wait_inflight() { local n i=0; while :; do n=$(runs | python3 $O/apply-runs.py "$F" inflight); [ "$n" = 0 ] && return 0
  i=$((i+1)); [ $i -ge 120 ] && { echo "$(date -u +%FT%TZ) STOP: a run for $F stayed in flight for 60 min" >> "$LOG"; exit 4; }
  [ $i -eq 1 ] && echo "$(date -u +%FT%TZ) waiting for the run already in flight for $F (${n:-unreadable})" >> "$LOG"; sleep 30; done; }
wait_run() { while :; do S=$(gh_ run view -R $R "$1" --json status,conclusion --jq '.status+"/"+(.conclusion//"-")' 2>/dev/null); case "$S" in completed/*) echo "$S"; return;; esac; sleep 25; done; }
for MODE in dry real; do
  wait_window
  wait_inflight
  BEFORE=$(latest_run)
  if [ "$MODE" = dry ]; then P="{\"event_type\":\"apply-merged-migration\",\"client_payload\":{\"migration\":\"$F\",\"dry_run\":true}}"; else P="{\"event_type\":\"apply-merged-migration\",\"client_payload\":{\"migration\":\"$F\"}}"; fi
  echo "$P" | gh_ api repos/$R/dispatches --input - >> "$LOG" 2>&1 && echo "$(date -u +%FT%TZ) dispatched $MODE $F" >> "$LOG"
  RUN=""; for i in 1 2 3 4 5 6 7 8; do sleep 20; RUN=$(latest_run); [ -n "$RUN" ] && [ "$RUN" != "$BEFORE" ] && break; done
  [ -z "$RUN" ] || [ "$RUN" = "$BEFORE" ] && { echo "$(date -u +%FT%TZ) STOP: no $MODE run appeared for $F" >> "$LOG"; exit 3; }
  OUT=$(wait_run "$RUN"); echo "$(date -u +%FT%TZ) $F $MODE run=$RUN $OUT" >> "$LOG"
  case "$OUT" in *success*) ;; *) echo "$(date -u +%FT%TZ) STOP: $F $MODE failed ($OUT)" >> "$LOG"; exit 1;; esac
done
echo "$(date -u +%FT%TZ) INSTALLED $F" >> "$LOG"
