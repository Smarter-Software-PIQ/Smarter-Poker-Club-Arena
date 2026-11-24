#!/bin/bash
# Smarter.Poker git maintenance guard (2026-11-07).
#
# WHY: a single stale .git/objects/maintenance.lock (left by a killed run on
# Sept 21/22) made git silently skip every scheduled cleanup for 6.5 weeks;
# the Club Arena checkouts reached 4,287 and 4,835 pack files and git began
# failing with "Too many open files". This guard runs hourly beside git's own
# launchd maintenance and:
#   1. removes a maintenance.lock older than LOCK_MAX_AGE_MIN that no process
#      holds (lsof), and records that as an informational operational alert;
#   2. raises a warning in Production Alerts when a repo still holds more
#      than PACK_LIMIT pack files (maintenance is not keeping up or stopped).
# It never deletes objects, packs, branches or worktrees.
#
# A BACKLOG WARNING RESOLVES WHEN THE REPO IS BACK UNDER THE LIMIT (2026-11-24):
# each warning was keyed per day and nothing ever resolved it (34 firing on
# 2026-11-24). When a repo's pack count is at or under PACK_LIMIT this guard now
# resolves that repo's firing pack-backlog warnings through
# public.fn_resolve_operational_alerts. Tracked in the Club Arena repository at
# operations/ops-mac/git-maintenance-guard.sh; installed to
# ~/Library/Application Support/SmarterPoker/ by atomic copy (new inode, no restart).
#
# Repos: GUARD_REPOS (newline-separated) if set, else every maintenance.repo.
# Alerts: fn_record_operational_alert via the Supabase CLI credential in the
# macOS Keychain (read at run time; nothing is written to disk).
set -u
LOCK_MAX_AGE_MIN="${LOCK_MAX_AGE_MIN:-120}"
PACK_LIMIT="${PACK_LIMIT:-400}"
PROJECT_REF="${PROJECT_REF:-kuklfnapbkmacvwxktbh}"
DRY_ALERTS="${DRY_ALERTS:-0}"
LOG="${GUARD_LOG:-$HOME/Library/Logs/smarter-git-maintenance-guard.log}"
HOST="$(scutil --get LocalHostName 2>/dev/null || hostname)"
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$LOG"; }

record_alert() { # status severity event_key alertname json_payload
  if [ "$DRY_ALERTS" = 1 ]; then log "DRY alert $1/$2 $3 $4 $5"; return 0; fi
  local t; t=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null) || { log "alert skipped: no Supabase CLI credential"; return 1; }
  case "$t" in go-keyring-base64:*) t=$(printf %s "${t#go-keyring-base64:}" | base64 -D);; esac
  local q
  q=$(python3 - "$1" "$2" "$3" "$4" "$5" <<'PY'
import json,sys
s,sev,key,name,payload=sys.argv[1:]
lit=lambda v:"'"+v.replace("'","''")+"'"
sql=("select public.fn_record_operational_alert('mac-studio-git-maintenance',"
     f"{lit(key)},{lit(name)},{lit(s)},{lit(sev)},{lit(payload)}::jsonb) as id")
print(json.dumps({"query":sql}))
PY
)
  local out
  out=$(curl -sS --max-time 20 -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
        -H "Authorization: Bearer $t" -H "Content-Type: application/json" -d "$q" 2>&1)
  log "alert $1/$2 $3 -> $out"
}

resolve_alerts() { # event_key_prefix resolution
  if [ "$DRY_ALERTS" = 1 ]; then log "DRY resolve $1"; return 0; fi
  local t; t=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null) || { log "resolve skipped: no Supabase CLI credential"; return 1; }
  case "$t" in go-keyring-base64:*) t=$(printf %s "${t#go-keyring-base64:}" | base64 -D);; esac
  local q
  q=$(python3 - "$1" "$2" <<'PY'
import json,sys
prefix,note=sys.argv[1:]
lit=lambda v:"'"+v.replace("'","''")+"'"
sql=("select public.fn_resolve_operational_alerts('mac-studio-git-maintenance',"
     f"{lit(prefix)},{lit(note)}) as resolved")
print(json.dumps({"query":sql}))
PY
)
  local out
  out=$(curl -sS --max-time 20 -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
        -H "Authorization: Bearer $t" -H "Content-Type: application/json" -d "$q" 2>&1)
  log "resolve $1 -> $out"
}

repos="${GUARD_REPOS:-$(git config --global --get-all maintenance.repo)}"
day=$(date +%Y-%m-%d)
while IFS= read -r repo; do
  [ -n "$repo" ] && [ -d "$repo/.git/objects" ] || continue
  lock="$repo/.git/objects/maintenance.lock"
  if [ -f "$lock" ]; then
    age_min=$(( ( $(date +%s) - $(stat -f %m "$lock") ) / 60 ))
    if [ "$age_min" -ge "$LOCK_MAX_AGE_MIN" ]; then
      if lsof "$lock" >/dev/null 2>&1; then
        log "$repo: lock ${age_min}m old but held; left"
      else
        rm -f "$lock" && log "$repo: removed stale maintenance.lock (${age_min}m old)"
        record_alert info info "stale-lock:$repo:$day" "Git Maintenance Stale Lock Cleared" \
          "$(printf '{"host":"%s","repo":"%s","lock_age_minutes":%s}' "$HOST" "$repo" "$age_min")"
      fi
    fi
  fi
  packs=$(ls "$repo/.git/objects/pack/"*.pack 2>/dev/null | wc -l | tr -d ' ')
  if [ "$packs" -gt "$PACK_LIMIT" ]; then
    log "$repo: $packs packs exceeds $PACK_LIMIT"
    record_alert firing warning "pack-backlog:$repo:$day" "Git Maintenance Not Keeping Up" \
      "$(printf '{"host":"%s","repo":"%s","pack_files":%s,"limit":%s,"action":"git -C <repo> repack -a -d --keep-unreachable; check .git/objects/maintenance.lock"}' "$HOST" "$repo" "$packs" "$PACK_LIMIT")"
  else
    resolve_alerts "pack-backlog:$repo:" "pack files back at or under $PACK_LIMIT ($packs)"
  fi
done <<< "$repos"
log "guard pass complete"
