#!/bin/zsh
setopt nullglob
# Shared install queue for every agent on this Mac. Runs forever under launchd
# (com.smarter-poker.install-queue, KeepAlive), outside any desktop app, so an
# app crash or update cannot kill it. One migration at a time:
#   pending -> (PR merged, required version recorded) -> running -> install
#   (unless already recorded) -> readback + live-proof -> done | failed
# A job left in running/ by an interrupted runner resumes first; an install is
# never replayed once its version is recorded.
R=Smarter-Software-PIQ/Smarter-Poker-Club-Arena
Q=~/.smarter-poker/install-queue; O=~/.smarter-poker/ops; LOG=~/.smarter-poker/logs/install-queue.log
gh_() { env -u GH_TOKEN -u GITHUB_TOKEN gh "$@"; }
say() { echo "$(date -u +%FT%TZ) $*" >> $LOG; }
wait_window() { while :; do M=$(date -u +%M); M=${M#0}; if [ "$M" -ge 48 ] || [ "$M" -lt 5 ]; then sleep 30; else break; fi; done; }
field() { sed -n "s/^$1=//p" "$2" | head -1; }
rec_state() { # prints yes | no | err (database unreachable: never act on an unknown answer)
  local out; out=$(echo "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='$1';" | $O/db.sh -f - 2>/dev/null) || { echo err; return; }
  case "$(echo "$out" | tail -1)" in 1) echo yes;; 0) echo no;; *) echo err;; esac; }
alert() { # $1 event key, $2 alertname, $3 severity, $4 note, $5 pr, $6 file
  echo "SELECT public.fn_record_operational_alert('install-queue', :'k', :'n', 'firing', :'s', jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','host','ops-mac-studio','pr',:'pr','file',:'f','note',:'note'));" \
   | $O/db.sh -v "k=$1" -v "n=$2" -v "s=$3" -v "note=$4" -v "pr=$5" -v "f=$6" -f - >> $LOG 2>&1; }
rotate() { [ -f "$1" ] && [ $(stat -f %z "$1") -gt 5242880 ] && mv -f "$1" "$1.1"; }
finish() { # $1 job path, $2 done|failed, $3 note
  local base=${1:t}; mv "$1" "$Q/$2/$base"; echo "RESULT=$3" >> "$Q/$2/$base"; say "$2 $base: $3"
  [ "$2" = failed ] && alert "failed:$base" InstallQueueJobFailed warning "$3" "$(field PR "$Q/$2/$base")" "$(field FILE "$Q/$2/$base")"; }
run_job() {
  local J="$1" PR F REQ V
  PR=$(field PR "$J"); F=$(field FILE "$J"); REQ=$(field REQUIRE "$J")
  [[ "$PR" =~ '^[0-9]+$' && "$F" =~ '^[0-9]{14}_[a-z0-9_]+\.sql$' && ( -z "$REQ" || "$REQ" =~ '^[0-9]{14}$' ) ]] || { finish "$J" failed "invalid job"; return; }
  V=${F%%_*}
  local S; S=$(gh_ pr view "$PR" -R $R --json state --jq .state 2>/dev/null)
  case "$S" in
    CLOSED) finish "$J" failed "PR closed without merge"; return;;
    MERGED) ;;
    *) return 1;;  # not merged yet: stays pending
  esac
  if [ -n "$REQ" ]; then case "$(rec_state "$REQ")" in yes) ;; *) return 1;; esac; fi
  if [ "${J:h:t}" = pending ]; then mv "$J" "$Q/running/${J:t}"; J="$Q/running/${J:t}"; say "running ${J:t} ($F)"; fi
  local st; st=$(rec_state "$V")
  [ "$st" = err ] && { say "database unreachable checking $F; retrying next pass"; return 1; }
  if [ "$st" = yes ]; then say "$F already recorded; verifying only"; else
    $O/install-driver.sh "$F" "$LOG"; rc=$?
    [ $rc -eq 0 ] || { finish "$J" failed "install rc=$rc (see log)"; return; }
  fi
  gh_ api -H 'Accept: application/vnd.github.raw' "repos/$R/contents/supabase/migrations/$F?ref=main" > "$Q/running/$V.sql" 2>>$LOG || { finish "$J" failed "could not fetch merged file"; return; }
  wait_window  # the readback re-executes definitions: DDL is refused :50 to :03 UTC
  python3 $O/readback.py "$Q/running/$V.sql" > "$Q/running/$V-ROLLBACK.sql"
  local out rb lp; out=$($O/db.sh -f "$Q/running/$V-ROLLBACK.sql" 2>&1); rb=$(echo "$out" | grep '^readback|'); lp=$(echo "$out" | grep '^liveproof|' | cut -d'|' -f2)
  rm -f "$Q/running/$V.sql" "$Q/running/$V-ROLLBACK.sql"
  local n=$(echo "$rb" | cut -d'|' -f2) u=$(echo "$rb" | cut -d'|' -f3)
  if [ -n "$rb" ] && [ "$n" = "$u" ] && [ "$lp" = t ]; then finish "$J" done "installed and verified: $rb liveproof=$lp"
  else finish "$J" failed "verification failed: ${rb:-no readback} liveproof=${lp:-none} $(echo "$out" | grep ERROR | head -1)"; fi
}
# Exactly one runner: a second copy (started by hand, or a duplicate service)
# exits at once while the holder of the lock is alive.
LOCK=$Q/.runner.pid
if [ -f $LOCK ] && kill -0 "$(cat $LOCK 2>/dev/null)" 2>/dev/null && ps -o command= -p "$(cat $LOCK)" | grep -q 'ops/install-queue.sh'; then
  say "another runner (pid $(cat $LOCK)) holds the queue; exiting"; exit 0; fi
echo $$ > $LOCK
say "install queue started (pid $$)"
while :; do
  rotate $LOG
  for J in $(ls $Q/running/*.job 2>/dev/null) $(ls $Q/pending/*.job 2>/dev/null | sort); do
    [ -f "$J" ] && run_job "$J"
  done
  sleep 60
done
