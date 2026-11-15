#!/bin/bash
# Bounded preservation of ONE declared capture window, run as root on the engine host; it copies evidence and exits (not a watcher).
# usage: preserve-window.sh OPERATOR WORK_DIR PRESERVE_DIR FROM_EPOCH END_EPOCH [JOURNAL_DIR]
#   FROM_EPOCH: segment files newer than this are preserved (set it a minute before the window opens); END_EPOCH: the final part ends here
#   (a few minutes past the window end so the last records' segment flush is included; the reader keeps only in-window records).
#   A part already verified by hand is recorded by writing "<its TO epoch> <its part number>" to WORK_DIR/window.state before the start.
#  - one instance: atomic mkdir .window.lock with pid; a live holder makes a second start exit 8
#  - resumable: window.state holds the end of the last VERIFIED part and the part counter; a restart continues from there
#  - a failed or interrupted part does not advance the state: the next pass covers the same range again (new part number); rsync skips files already
#    copied with the same size and mtime, so nothing is copied twice; vanished files (aged out before hashing) are logged as GAP and never retried
#  - disk: below HVH_DISK_FLOOR_KB (default 30 GiB) free on the destination it stops and logs DISK-LOW (the read then reports the gap); host load: if the
#    1-minute load exceeds the CPU count it waits HVH_LOAD_WAIT seconds, at most 3 times, then runs anyway at nice 15 / idle IO; the final part is never skipped
# Tunables for tests: HVH_PART_INTERVAL (3600 s between parts), HVH_RETRY_SLEEP (60 s), HVH_LOAD_WAIT (300 s), HVH_PART_SCRIPT (default WORK_DIR/preserve-part.sh).
set -u; OP=${1:?operator}; W=${2:?work dir}; P=${3:?preserve dir}; START=${4:?from epoch}; END=${5:?end epoch}; J=${6:-/var/lib/club-arena/horse-decisions}
IV=${HVH_PART_INTERVAL:-3600}; RS=${HVH_RETRY_SLEEP:-60}; LW=${HVH_LOAD_WAIT:-300}; PS=${HVH_PART_SCRIPT:-$W/preserve-part.sh}; CAP=${HVH_DISK_FLOOR_KB:-$((30*1024*1024))}
mkdir -p $W; L=$W/window.log; ST=$W/window.state
if mkdir $W/.window.lock 2>/dev/null; then echo $$ > $W/.window.lock/pid; else p=$(cat $W/.window.lock/pid 2>/dev/null); if [ -n "$p" ] && kill -0 $p 2>/dev/null; then echo "refused: running as $p"; exit 8; fi
  echo "$(date -u +%FT%TZ) stale window lock (pid $p) replaced by $$" >> $L; echo $$ > $W/.window.lock/pid; fi
trap 'rm -rf $W/.window.lock' EXIT
[ -e $ST ] || echo "$START 0" > $ST
read FROM n < $ST; echo "$(date -u +%FT%TZ) start pid=$$ from=$FROM lastPart=$n end=$END" >> $L
while :; do
  [ -e $W/STOP ] && { echo "$(date -u +%FT%TZ) STOP file, exiting" >> $L; exit 0; }
  [ $FROM -ge $END ] && { echo "$(date -u +%FT%TZ) DONE: all parts verified to END; exiting" >> $L; touch $W/DONE; exit 0; }
  now=$(date +%s); next=$((FROM+IV)); [ $next -gt $END ] && next=$END
  [ $now -lt $next ] && { sleep $(( next-now < 600 ? next-now : 600 )); continue; }
  mkdir -p $P; free=$(df -Pk $P | awk 'NR==2{print $4}'); [ "${free:-0}" -lt $CAP ] && { echo "$(date -u +%FT%TZ) DISK-LOW free=${free}k; stopping, gap from $FROM" >> $L; exit 3; }
  for i in 1 2 3; do l=$(cut -d' ' -f1 /proc/loadavg); awk -v l=$l -v c=$(nproc) 'BEGIN{exit !(l>c)}' || break; echo "$(date -u +%FT%TZ) load $l > $(nproc), waiting ${LW}s ($i/3)" >> $L; sleep $LW; done
  TO=$(( $(date +%s) < END ? $(date +%s) : END )); n=$((n+1))
  ring=$(cd $J 2>/dev/null && for d in archive archive-shard-*; do [ -d "$d/segments" ] || continue; o=$(find $d/segments -maxdepth 1 -type f -printf "%T@\n" 2>/dev/null | sort -n | head -1); printf "%s=%s " $d ${o%.*}; done)
  echo "$(date -u +%FT%TZ) before part$n from=$FROM to=$TO load=$(cut -d' ' -f1 /proc/loadavg) freeK=$free ringOldest: $ring" >> $L
  nice -n 15 ionice -c3 bash $PS $n $FROM $TO $OP $W $P $J > $W/part$n.out 2>&1; rc=$?
  v=$(grep '^verify' $W/part$n.out); m=$(grep '^manifest' $W/part$n.out); van=$(echo "$m" | sed -n 's/.*vanished=\([0-9]*\).*/\1/p')
  echo "$(date -u +%FT%TZ) part$n rc=$rc $m | $v" >> $L
  if [ $rc -eq 0 ] && echo "$v" | grep -q "failed=0 missing=0" && echo "$v" | grep -q "linksOver1=0"; then
    [ "${van:-0}" != 0 ] && echo "$(date -u +%FT%TZ) GAP part$n: $van files vanished before hashing (aged out); listed in MANIFEST-part$n.tsv" >> $L
    FROM=$TO; echo "$FROM $n" > $ST
  else echo "$(date -u +%FT%TZ) part$n NOT VERIFIED; state stays at $FROM; next pass repeats the range" >> $L; echo "$FROM $n" > $ST; sleep $RS; fi
done
