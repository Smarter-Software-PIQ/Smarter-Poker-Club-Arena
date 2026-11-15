#!/bin/bash
# Tests for host/preserve-part.sh and host/preserve-window.sh on a temporary fake journal (GNU/Linux tools: find -printf, sha256sum, rsync,
# ionice, /proc/loadavg). Usage: test_preserve_window.sh [SCRATCH_DIR]. Prints one line per case; exits 1 if any case fails.
set -u; H=$(cd "$(dirname "$0")/../host" && pwd); D=${1:-$(mktemp -d)}; f=0; OP=opT
[ "$(uname -s)" = Linux ] || { echo "SKIP: needs GNU/Linux (CI runs on ubuntu)"; exit 0; }
ok(){ echo "PASS $1"; }; no(){ echo "FAIL $1"; f=1; }
NOW=$(date +%s)
mk(){ mkdir -p $1/archive-shard-1/segments $1/archive-shard-2/segments $1/archive/segments
  for i in 1 2 3; do printf "a$i" | gzip > $1/archive-shard-1/segments/a$i.ndjson.gz; touch -d @$((NOW-300+i*60)) $1/archive-shard-1/segments/a$i.ndjson.gz; done
  printf "b1" | gzip > $1/archive-shard-2/segments/b1.ndjson.gz; touch -d @$((NOW-100)) $1/archive-shard-2/segments/b1.ndjson.gz
  printf "old" | gzip > $1/archive/segments/old.ndjson.gz; touch -d @$((NOW-9000)) $1/archive/segments/old.ndjson.gz; }
# 1. one real part: only files in (FROM, TO], hashes before copy, verified copies with one link each
J=$D/j1; mk $J; W=$D/w1; P=$D/p1
out=$(bash $H/preserve-part.sh 1 $((NOW-200)) $NOW $OP $W $P $J); rc=$?
c=$(find $P -name '*.ndjson.gz' | wc -l)
[ $rc = 0 ] && echo "$out" | grep -q "manifest rows=3 vanished=0" && echo "$out" | grep -q "verify failed=0 missing=0 expected=3 linksOver1=0" && [ $c = 3 ] \
  && [ ! -e $P/archive/segments/old.ndjson.gz ] && cmp -s $J/archive-shard-2/segments/b1.ndjson.gz $P/archive-shard-2/segments/b1.ndjson.gz \
  && ok "1 part copies exactly the 3 files in range, verified, link count 1" || no "1 part rc=$rc copies=$c: $out"
bash $H/preserve-part.sh 1 $((NOW-200)) $NOW $OP $W $P $J >/dev/null; [ $? = 9 ] && ok "2 same part again refused (9)" || no "2 rerun not refused"
bash $H/preserve-part.sh 2 $((NOW-200)) $NOW other $W $P $J >/dev/null; [ $? = 7 ] && ok "3 other operator refused (7)" || no "3 other operator not refused"
# 4. window with a stub part that fails once: the failed range is repeated, then DONE at END, lock released
W=$D/w4; mkdir -p $W; S=$W/stub.sh
cat > $S <<'S'
#!/bin/bash
W=$5; echo "$1 $2 $3" >> $W/calls
if [ ! -e $W/failed-once ]; then touch $W/failed-once; echo "manifest rows=1 vanished=0"; echo "verify failed=0 missing=1 expected=1 linksOver1=0"; exit 1; fi
echo "manifest rows=1 vanished=0"; echo "verify failed=0 missing=0 expected=1 linksOver1=0"; exit 0
S
S0=$(date +%s); E4=$((S0+6))
HVH_PART_SCRIPT=$S HVH_PART_INTERVAL=2 HVH_RETRY_SLEEP=1 HVH_LOAD_WAIT=1 HVH_DISK_FLOOR_KB=1 timeout 60 bash $H/preserve-window.sh $OP $W $D/p4 $((S0-10)) $E4 $D/j1; rc=$?
first=$(sed -n 1p $W/calls | cut -d' ' -f2); second=$(sed -n 2p $W/calls | cut -d' ' -f2); last=$(tail -1 $W/calls | cut -d' ' -f3)
[ $rc = 0 ] && [ -e $W/DONE ] && [ ! -e $W/.window.lock ] && [ "$first" = "$second" ] && [ "$last" = "$E4" ] && [ "$(cut -d' ' -f1 $W/window.state)" = "$E4" ] \
  && grep -q "NOT VERIFIED" $W/window.log && ok "4 failed part repeated from the same start; DONE at END; lock released" || no "4 rc=$rc first=$first second=$second last=$last end=$E4 $(cat $W/calls | tr '\n' ';')"
# 5. a second instance while one runs is refused (8)
W=$D/w5; mkdir -p $W; S0=$(date +%s)
HVH_PART_SCRIPT=$S HVH_PART_INTERVAL=30 HVH_DISK_FLOOR_KB=1 bash $H/preserve-window.sh $OP $W $D/p5 $S0 $((S0+120)) $D/j1 & bg=$!; sleep 1
bash $H/preserve-window.sh $OP $W $D/p5 $S0 $((S0+120)) $D/j1 >/dev/null; r=$?; touch $W/STOP; kill $bg 2>/dev/null; wait $bg 2>/dev/null
[ $r = 8 ] && ok "5 second instance refused (8)" || no "5 second instance rc=$r"
# 6. real parts across a window: every in-range file preserved once, none twice, verified
J=$D/j6; mk $J; W=$D/w6; P=$D/p6; mkdir -p $W; cp $H/preserve-part.sh $W/preserve-part.sh
S0=$(date +%s); HVH_PART_INTERVAL=1 HVH_RETRY_SLEEP=1 HVH_LOAD_WAIT=1 HVH_DISK_FLOOR_KB=1 timeout 60 bash $H/preserve-window.sh $OP $W $P $((NOW-200)) $((S0+3)) $J; rc=$?
rows=$(cat $P/MANIFEST-part*.tsv | grep -vc '^path'); copies=$(find $P -name '*.ndjson.gz' | wc -l); dup=$(cat $P/MANIFEST-part*.tsv | grep -v '^path' | cut -f1 | sort | uniq -d | wc -l)
[ $rc = 0 ] && [ -e $W/DONE ] && [ $copies = 3 ] && [ $rows = 3 ] && [ $dup = 0 ] && ! grep -q "NOT VERIFIED\|GAP" $W/window.log \
  && ok "6 real parts: 3 files preserved once each across parts, all verified" || no "6 rc=$rc rows=$rows copies=$copies dup=$dup"
# 7. disk floor: stops with DISK-LOW and exit 3, state unchanged
W=$D/w7; mkdir -p $W; S0=$(date +%s)
HVH_PART_SCRIPT=$S HVH_PART_INTERVAL=0 HVH_DISK_FLOOR_KB=999999999999 timeout 20 bash $H/preserve-window.sh $OP $W $D/p7 $((S0-10)) $((S0+5)) $D/j1; rc=$?
[ $rc = 3 ] && grep -q DISK-LOW $W/window.log && [ "$(cut -d' ' -f1 $W/window.state)" = "$((S0-10))" ] && ok "7 disk floor stops with DISK-LOW, state unchanged" || no "7 rc=$rc"
[ $f = 0 ] && echo "ALL PASS" || echo "SOME FAILED"; [ -z "${1:-}" ] && rm -rf "$D"; exit $f
