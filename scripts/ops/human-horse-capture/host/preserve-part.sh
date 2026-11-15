#!/bin/bash
# Preservation part N of a declared capture window, run as root on the engine host. Manifest of journal segment files with mtime in (FROM, TO]
# with sha256 taken BEFORE copying, byte copies (rsync, never links, 40 MB/s, idle IO, oldest first), then sha256 verify of every copy and link
# count 1 (the journal readers require private, single-link segment files). Read-only on the journal. One operator: the lock in WORK_DIR.
# usage: preserve-part.sh PART FROM_EPOCH TO_EPOCH OPERATOR WORK_DIR PRESERVE_DIR [JOURNAL_DIR]
# Exit: 0 done (read the verify line), 7 another operator holds WORK_DIR, 9 this part's manifest already exists.
set -u; PART=${1:?part}; FROM=${2:?epoch}; TO=${3:?epoch}; OP=${4:?operator}; W=${5:?work dir}; P=${6:?preserve dir}; J=${7:-/var/lib/club-arena/horse-decisions}; umask 077
mkdir -p $W $P; chmod 700 $W $P
{ mkdir $W/.operation.lock 2>/dev/null && echo $OP > $W/.operation.lock/OPERATOR; } || grep -qx "$OP" $W/.operation.lock/OPERATOR || { echo "refused: operator"; exit 7; }
M=$P/MANIFEST-part$PART.tsv; [ -e $M ] || [ -e $M.partial ] && { echo "refused: part$PART exists"; exit 9; }
echo "part$PART start $(date -u +%FT%TZ) from=$FROM to=$TO"
printf "path\tinode\tlinks\tbytes\tmtime_epoch\tsha256\n" > $M.partial
cd $J
for d in archive archive-shard-*; do [ -d "$d/segments" ] || continue
  find $d/segments -maxdepth 1 -type f -name "*.ndjson.gz" -printf "%p\t%i\t%n\t%s\t%T@\n" 2>/dev/null | awk -F'\t' -v a=$FROM -v b=$TO '$5>a && $5<=b' | sort -t$'\t' -k5,5n > $W/p$PART-stat-$d.tsv
  cut -f1 $W/p$PART-stat-$d.tsv | tr "\n" "\0" | xargs -0 -r -n 1000 sha256sum 2>>$W/p$PART-hash-errors.txt > $W/p$PART-sha-$d.txt
  awk 'NR==FNR{s[$2]=$1;next}{print $0"\t"(($1 in s)?s[$1]:"VANISHED")}' $W/p$PART-sha-$d.txt $W/p$PART-stat-$d.tsv >> $M.partial
  echo "$d files=$(wc -l < $W/p$PART-stat-$d.tsv) oldestInJournal=$(find $d/segments -maxdepth 1 -type f -printf '%T@\n' 2>/dev/null | sort -n | head -1)"
done
mv $M.partial $M; sha256sum $M > $M.sha256; chmod 400 $M $M.sha256
echo "manifest rows=$(($(wc -l < $M)-1)) vanished=$(grep -c VANISHED $M) bytes=$(tail -n +2 $M | awk -F'\t' '{s+=$4} END{print s+0}') $(date -u +%FT%TZ) $(cut -c1-64 $M.sha256)"
tail -n +2 $M | grep -v VANISHED | cut -f1 > $W/p$PART-copy-list.txt
rsync -a --files-from=$W/p$PART-copy-list.txt --bwlimit=40000 --ignore-missing-args --no-links $J/ $P/ 2> $W/p$PART-copy-errors.txt; echo "rsync exit=$? $(date -u +%FT%TZ)"
tail -n +2 $M | grep -v VANISHED | awk -F'\t' '{print $6"  "$1}' > $W/p$PART-expect.sha
cd $P && sha256sum -c --quiet $W/p$PART-expect.sha > $W/p$PART-verify.txt 2>&1
echo "verify failed=$(grep -c FAILED $W/p$PART-verify.txt) missing=$(grep -c 'No such file' $W/p$PART-verify.txt) expected=$(wc -l < $W/p$PART-expect.sha) linksOver1=$(find $P -name '*.ndjson.gz' -links +1 | wc -l) $(date -u +%FT%TZ)"
echo "part$PART done"
