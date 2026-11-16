#!/bin/bash
# Tests for host/preserve-part.sh and host/preserve-window.sh (toolkit v3 interface: OPERATOR RELEASE8, FROM/END files, END re-read) on a temporary fake
# journal (GNU/Linux tools: find -printf, sha256sum, rsync, ionice, /proc/loadavg). Host folders come from HVH_WORK_DIR / HVH_PRESERVE_DIR / HVH_JOURNAL_DIR.
# Usage: test_preserve_window.sh [SCRATCH_DIR]. Prints one line per case; exits 1 if any case fails.
set -u; [ "$(uname -s)" = Linux ] || { echo "SKIP: needs GNU/Linux (CI runs on ubuntu)"; exit 0; }   # before any scratch is created
H=$(cd "$(dirname "$0")/../host" && pwd); D=${1:-$(mktemp -d)}; f=0; OP=opT
ok(){ echo "PASS $1"; }; no(){ echo "FAIL $1"; f=1; }
NOW=$(date +%s)
mk(){ mkdir -p $1/archive-shard-1/segments $1/archive-shard-2/segments $1/archive/segments
  for i in 1 2 3; do printf "a$i" | gzip > $1/archive-shard-1/segments/a$i.ndjson.gz; touch -d @$((NOW-300+i*60)) $1/archive-shard-1/segments/a$i.ndjson.gz; done
  printf "b1" | gzip > $1/archive-shard-2/segments/b1.ndjson.gz; touch -d @$((NOW-100)) $1/archive-shard-2/segments/b1.ndjson.gz
  printf "old" | gzip > $1/archive/segments/old.ndjson.gz; touch -d @$((NOW-9000)) $1/archive/segments/old.ndjson.gz; }
win(){ mkdir -p $1; echo $2 > $1/FROM; echo $3 > $1/END; }   # what preserve-host.sh start writes (epochs from window.py)
part(){ HVH_WORK_DIR=$W HVH_PRESERVE_DIR=$P HVH_JOURNAL_DIR=$J bash $H/preserve-part.sh "$@"; }
# 1. one real part: only files in (FROM, TO], hashes before copy, verified copies with one link each
J=$D/j1; mk $J; W=$D/w1; P=$D/p1
out=$(part 1 $((NOW-200)) $NOW $OP t1); rc=$?
c=$(find $P -name '*.ndjson.gz' | wc -l)
[ $rc = 0 ] && echo "$out" | grep -q "manifest rows=3 vanished=0" && echo "$out" | grep -q "verify failed=0 missing=0 expected=3 linksOver1=0" && [ $c = 3 ] \
  && [ ! -e $P/archive/segments/old.ndjson.gz ] && cmp -s $J/archive-shard-2/segments/b1.ndjson.gz $P/archive-shard-2/segments/b1.ndjson.gz \
  && ok "1 part copies exactly the 3 files in range, verified, link count 1" || no "1 part rc=$rc copies=$c: $out"
part 1 $((NOW-200)) $NOW $OP t1 >/dev/null; [ $? = 9 ] && ok "2 same part again refused (9)" || no "2 rerun not refused"
part 2 $((NOW-200)) $NOW other t1 >/dev/null; [ $? = 7 ] && ok "3 other operator refused (7)" || no "3 other operator not refused"
# 4. window with a stub part that fails once: the failed range is repeated, then DONE at END, lock released
S=$D/stub.sh
cat > $S <<'S'
#!/bin/bash
W=$HVH_WORK_DIR; echo "$1 $2 $3" >> $W/calls
if [ ! -e $W/failed-once ]; then touch $W/failed-once; echo "manifest rows=1 vanished=0"; echo "verify failed=0 missing=1 expected=1 linksOver1=0"; exit 1; fi
echo "manifest rows=1 vanished=0"; echo "verify failed=0 missing=0 expected=1 linksOver1=0"; exit 0
S
W=$D/w4; S0=$(date +%s); E4=$((S0+6)); win $W $((S0-10)) $E4
HVH_WORK_DIR=$W HVH_PRESERVE_DIR=$D/p4 HVH_JOURNAL_DIR=$D/j1 HVH_PART_SCRIPT=$S HVH_PART_INTERVAL=2 HVH_RETRY_SLEEP=1 HVH_LOAD_WAIT=1 HVH_DISK_FLOOR_KB=1 timeout 60 bash $H/preserve-window.sh $OP t4; rc=$?
first=$(sed -n 1p $W/calls | cut -d' ' -f2); second=$(sed -n 2p $W/calls | cut -d' ' -f2); last=$(tail -1 $W/calls | cut -d' ' -f3)
[ $rc = 0 ] && [ -e $W/DONE ] && [ ! -e $W/.window.lock ] && [ "$first" = "$second" ] && [ "$last" = "$E4" ] && [ "$(cut -d' ' -f1 $W/window.state)" = "$E4" ] \
  && grep -q "NOT VERIFIED" $W/window.log && ok "4 failed part repeated from the same start; DONE at END; lock released" || no "4 rc=$rc first=$first second=$second last=$last end=$E4 $(cat $W/calls | tr '\n' ';')"
# 5. a second instance while one runs is refused (8)
W=$D/w5; S0=$(date +%s); win $W $S0 $((S0+120))
HVH_WORK_DIR=$W HVH_PRESERVE_DIR=$D/p5 HVH_JOURNAL_DIR=$D/j1 HVH_PART_SCRIPT=$S HVH_PART_INTERVAL=30 HVH_DISK_FLOOR_KB=1 bash $H/preserve-window.sh $OP t5 & bg=$!; sleep 1
HVH_WORK_DIR=$W bash $H/preserve-window.sh $OP t5 >/dev/null; r=$?; touch $W/STOP; kill $bg 2>/dev/null; wait $bg 2>/dev/null
[ $r = 8 ] && ok "5 second instance refused (8)" || no "5 second instance rc=$r"
# 6. real parts across a window: every in-range file preserved once, none twice, verified; the ring proof names the one shard whose oldest file is newer than FROM
J=$D/j6; mk $J; W=$D/w6; P=$D/p6; S0=$(date +%s); win $W $((NOW-200)) $((S0+3))
HVH_WORK_DIR=$W HVH_PRESERVE_DIR=$P HVH_JOURNAL_DIR=$J HVH_PART_INTERVAL=1 HVH_RETRY_SLEEP=1 HVH_LOAD_WAIT=1 HVH_DISK_FLOOR_KB=1 timeout 60 bash $H/preserve-window.sh $OP t6; rc=$?
rows=$(cat $P/MANIFEST-part*.tsv | grep -vc '^path'); copies=$(find $P -name '*.ndjson.gz' | wc -l); dup=$(cat $P/MANIFEST-part*.tsv | grep -v '^path' | cut -f1 | sort | uniq -d | wc -l)
rg=$(grep -c "RING-GAP" $W/window.log)
[ $rc = 0 ] && [ -e $W/DONE ] && [ $copies = 3 ] && [ $rows = 3 ] && [ $dup = 0 ] && ! grep -q "NOT VERIFIED\| GAP part" $W/window.log \
  && [ "$rg" = 1 ] && grep -q "RING-GAP part1: oldest file newer than FROM in: archive-shard-2 (" $W/window.log \
  && ok "6 real parts: 3 files preserved once each across parts, all verified; RING-GAP names archive-shard-2 only" || no "6 rc=$rc rows=$rows copies=$copies dup=$dup ringGap=$rg"
# 7. disk floor: stops with DISK-LOW and exit 3, state unchanged
W=$D/w7; S0=$(date +%s); win $W $((S0-10)) $((S0+5))
HVH_WORK_DIR=$W HVH_PRESERVE_DIR=$D/p7 HVH_JOURNAL_DIR=$D/j1 HVH_PART_SCRIPT=$S HVH_PART_INTERVAL=0 HVH_DISK_FLOOR_KB=999999999999 timeout 20 bash $H/preserve-window.sh $OP t7; rc=$?
[ $rc = 3 ] && grep -q DISK-LOW $W/window.log && [ "$(cut -d' ' -f1 $W/window.state)" = "$((S0-10))" ] && ok "7 disk floor stops with DISK-LOW, state unchanged" || no "7 rc=$rc"
# 8. close without restart: END is rewritten while the job runs (what preserve-host.sh close does); the same job finishes at the new END and exits DONE
W=$D/w8; S0=$(date +%s); win $W $((S0-10)) $((S0+120)); touch $W/failed-once
HVH_WORK_DIR=$W HVH_PRESERVE_DIR=$D/p8 HVH_JOURNAL_DIR=$D/j1 HVH_PART_SCRIPT=$S HVH_PART_INTERVAL=1 HVH_RETRY_SLEEP=1 HVH_LOAD_WAIT=1 HVH_DISK_FLOOR_KB=1 timeout 40 bash $H/preserve-window.sh $OP t8 & bg=$!; sleep 2
NE=$(( $(date +%s) + 2 )); echo $NE > $W/END.new && mv $W/END.new $W/END; wait $bg; rc=$?
last=$(tail -1 $W/calls | cut -d' ' -f3)
[ $rc = 0 ] && [ -e $W/DONE ] && [ "$last" = "$NE" ] && [ "$(cut -d' ' -f1 $W/window.state)" = "$NE" ] && grep -q "DONE: all parts verified to END $(date -u -d @$NE +%FT%TZ)" $W/window.log \
  && ok "8 END rewritten while running: same job ends at the new END, DONE" || no "8 rc=$rc last=$last newEnd=$NE"
# 9. refusals before anything starts: FROM/END missing (2), bad release (2) for the window and the part
mkdir -p $D/w9; HVH_WORK_DIR=$D/w9 bash $H/preserve-window.sh $OP t9 >/dev/null; r1=$?
HVH_WORK_DIR=$D/w9 bash $H/preserve-window.sh $OP 'T9/x' >/dev/null; r2=$?; W=$D/w9; P=$D/p9; J=$D/j1; part 1 $((NOW-200)) $NOW $OP 'T9;x' >/dev/null; r3=$?
[ $r1 = 2 ] && [ $r2 = 2 ] && [ $r3 = 2 ] && [ ! -e $D/w9/window.log ] && [ ! -e $D/p9 ] && ok "9 FROM/END missing and bad release refused (2), nothing written" || no "9 r1=$r1 r2=$r2 r3=$r3"
[ $f = 0 ] && echo "ALL PASS" || echo "SOME FAILED"; [ -z "${1:-}" ] && rm -rf "$D"; exit $f
