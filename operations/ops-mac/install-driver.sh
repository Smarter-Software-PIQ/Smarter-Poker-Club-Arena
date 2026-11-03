#!/bin/zsh
# Protected install of ONE merged migration through the apply-merged-migration
# workflow: dry run, then real run; each waits for its own workflow run (matched
# by the job name "Apply <file>"). Avoids :44 to :04 UTC (database DDL break).
R=Smarter-Software-PIQ/Smarter-Poker-Club-Arena
F="$1"; LOG="$2"
gh_() { env -u GH_TOKEN -u GITHUB_TOKEN gh "$@"; }
wait_window() { while :; do M=$(date -u +%M); M=${M#0}; if [ "$M" -ge 44 ] || [ "$M" -lt 5 ]; then sleep 30; else break; fi; done; }
latest_run() { for id in $(gh_ run list -R $R --workflow apply-merged-migration.yml --limit 15 --json databaseId --jq '.[].databaseId'); do
  J=$(gh_ run view -R $R "$id" --json jobs --jq '.jobs[0].name' 2>/dev/null); [ "$J" = "Apply $F" ] && { echo "$id"; return; }; done; }
wait_run() { while :; do S=$(gh_ run view -R $R "$1" --json status,conclusion --jq '.status+"/"+(.conclusion//"-")' 2>/dev/null); case "$S" in completed/*) echo "$S"; return;; esac; sleep 25; done; }
for MODE in dry real; do
  wait_window
  BEFORE=$(latest_run)
  if [ "$MODE" = dry ]; then P="{\"event_type\":\"apply-merged-migration\",\"client_payload\":{\"migration\":\"$F\",\"dry_run\":true}}"; else P="{\"event_type\":\"apply-merged-migration\",\"client_payload\":{\"migration\":\"$F\"}}"; fi
  echo "$P" | gh_ api repos/$R/dispatches --input - >> "$LOG" 2>&1 && echo "$(date -u +%FT%TZ) dispatched $MODE $F" >> "$LOG"
  RUN=""; for i in 1 2 3 4 5 6 7 8; do sleep 20; RUN=$(latest_run); [ -n "$RUN" ] && [ "$RUN" != "$BEFORE" ] && break; done
  [ -z "$RUN" ] || [ "$RUN" = "$BEFORE" ] && { echo "$(date -u +%FT%TZ) STOP: no $MODE run appeared for $F" >> "$LOG"; exit 3; }
  OUT=$(wait_run "$RUN"); echo "$(date -u +%FT%TZ) $F $MODE run=$RUN $OUT" >> "$LOG"
  case "$OUT" in *success*) ;; *) echo "$(date -u +%FT%TZ) STOP: $F $MODE failed ($OUT)" >> "$LOG"; exit 1;; esac
done
echo "$(date -u +%FT%TZ) INSTALLED $F" >> "$LOG"
