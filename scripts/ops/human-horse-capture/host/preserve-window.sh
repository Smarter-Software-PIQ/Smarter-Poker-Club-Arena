#!/bin/bash
# Bounded preservation of one declared window (toolkit v3 generic, 2026-11-15, session 01Gw7aDs). Not a watcher: copies evidence in hourly parts and exits at END.
# usage (on ca-engine, via preserve-host.sh): preserve-window.sh OPERATOR RELEASE8
#   $W/FROM and $W/END hold epochs written by preserve-host.sh from ISO times (window.py; round trip logged). END is re-read every loop, so the boundary is applied
#   by `preserve-host.sh close` without restarting: the next pass covers up to END and the job exits DONE.
#  - one instance: atomic mkdir .window.lock with pid; a live holder makes a second start exit 8
#  - resumable: window.state "FROM lastPart"; failed/interrupted part does not advance; rsync never re-copies; vanished files logged as GAP
#  - disk floor 30 GiB on /var/lib/club-arena (stops, DISK-LOW); load back-off at most 3x5 min, then nice 15 / idle IO; final part never skipped
#  - coverage proof per part: ringOldest of every shard is logged BEFORE the part; a shard whose oldest file is newer than FROM is logged as RING-GAP
# Repository port (defaults unchanged): HVH_WORK_DIR, HVH_PRESERVE_DIR, HVH_JOURNAL_DIR (host folders; exported to the part), shards are every archive-shard-* present;
#   test tunables HVH_PART_INTERVAL (3600 s between parts), HVH_RETRY_SLEEP (60 s), HVH_LOAD_WAIT (300 s), HVH_DISK_FLOOR_KB (30 GiB), HVH_PART_SCRIPT (preserve-part.sh beside this file).
set -u; OP=${1:?operator}; R=${2:?release8}; case "$R" in *[!0-9a-z-]*|"") echo "refused: release"; exit 2;; esac
W=${HVH_WORK_DIR:-/root/hvh-work-$R}; L=$W/window.log; ST=$W/window.state; CAP=${HVH_DISK_FLOOR_KB:-$((30*1024*1024))}; D=$(dirname "$0")
J=${HVH_JOURNAL_DIR:-/var/lib/club-arena/horse-decisions}; P=${HVH_PRESERVE_DIR:-/var/lib/club-arena/hvh-preserve-$R}
IV=${HVH_PART_INTERVAL:-3600}; RS=${HVH_RETRY_SLEEP:-60}; LW=${HVH_LOAD_WAIT:-300}; PS=${HVH_PART_SCRIPT:-$D/preserve-part.sh}
export HVH_WORK_DIR=$W HVH_PRESERVE_DIR=$P HVH_JOURNAL_DIR=$J
[ -s $W/FROM ] && [ -s $W/END ] || { echo "refused: FROM/END missing"; exit 2; }
if mkdir $W/.window.lock 2>/dev/null; then echo $$ > $W/.window.lock/pid; else p=$(cat $W/.window.lock/pid 2>/dev/null); if [ -n "$p" ] && kill -0 $p 2>/dev/null; then echo "refused: running as $p"; exit 8; fi
  echo "$(date -u +%FT%TZ) stale window lock (pid $p) replaced by $$" >> $L; echo $$ > $W/.window.lock/pid; fi
trap 'rm -rf $W/.window.lock' EXIT
[ -e $ST ] || echo "$(cat $W/FROM) 0" > $ST
read FROM n < $ST; echo "$(date -u +%FT%TZ) start pid=$$ from=$FROM ($(date -u -d @$FROM +%FT%TZ)) lastPart=$n end=$(cat $W/END) ($(date -u -d @$(cat $W/END) +%FT%TZ))" >> $L
while :; do
  END=$(cat $W/END)
  [ -e $W/STOP ] && { echo "$(date -u +%FT%TZ) STOP file, exiting" >> $L; exit 0; }
  [ $FROM -ge $END ] && { echo "$(date -u +%FT%TZ) DONE: all parts verified to END $(date -u -d @$END +%FT%TZ); exiting" >> $L; touch $W/DONE; exit 0; }
  now=$(date +%s); next=$((FROM+IV)); [ $next -gt $END ] && next=$END
  [ $now -lt $next ] && { s=$(( next-now < 300 ? next-now : 300 )); sleep $s; continue; }
  free=$(df -Pk "$(dirname "$P")" | awk 'NR==2{print $4}'); [ "${free:-0}" -lt $CAP ] && { echo "$(date -u +%FT%TZ) DISK-LOW free=${free}k; stopping, gap from $FROM" >> $L; exit 3; }
  for i in 1 2 3; do l=$(cut -d' ' -f1 /proc/loadavg); awk -v l=$l -v c=$(nproc) 'BEGIN{exit !(l>c)}' || break; echo "$(date -u +%FT%TZ) load $l > $(nproc), waiting ${LW}s ($i/3)" >> $L; sleep $LW; done
  TO=$(( $(date +%s) < END ? $(date +%s) : END )); n=$((n+1))
  ring=""; gap=""; for sd in $J/archive $J/archive-shard-*; do [ -d "$sd/segments" ] || continue; d=${sd##*/}; o=$(find $sd/segments -maxdepth 1 -type f -printf "%T@\n" 2>/dev/null | sort -n | head -1); o=${o%.*}; ring="$ring$d=$o "; [ -n "$o" ] && [ $o -gt $FROM ] && gap="$gap$d "; done
  echo "$(date -u +%FT%TZ) before part$n from=$FROM to=$TO load=$(cut -d' ' -f1 /proc/loadavg) freeK=$free ringOldest: $ring" >> $L
  [ -n "$gap" ] && echo "$(date -u +%FT%TZ) RING-GAP part$n: oldest file newer than FROM in: $gap(records before it may have aged out)" >> $L
  nice -n 15 ionice -c3 bash $PS $n $FROM $TO $OP $R > $W/part$n.out 2>&1; rc=$?
  v=$(grep '^verify' $W/part$n.out); m=$(grep '^manifest' $W/part$n.out); van=$(echo "$m" | sed -n 's/.*vanished=\([0-9]*\).*/\1/p')
  echo "$(date -u +%FT%TZ) part$n rc=$rc $m | $v" >> $L
  if [ $rc -eq 0 ] && echo "$v" | grep -q "failed=0 missing=0" && echo "$v" | grep -q "linksOver1=0"; then
    [ "${van:-0}" != 0 ] && echo "$(date -u +%FT%TZ) GAP part$n: $van files vanished before hashing (aged out); listed in MANIFEST-part$n.tsv" >> $L
    FROM=$TO; echo "$FROM $n" > $ST
  else echo "$(date -u +%FT%TZ) part$n NOT VERIFIED; state stays at $FROM; next pass repeats the range" >> $L; echo "$FROM $n" > $ST; sleep $RS; fi
done
