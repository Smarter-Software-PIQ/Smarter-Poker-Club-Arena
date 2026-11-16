#!/bin/bash
# Tests for operator-lock.sh in a scratch folder (argument). Prints one line per case and FAIL if any case misbehaves.
set -u; L=$(cd "$(dirname "$0")/.." && pwd)/operator-lock.sh; D=${1:?scratch dir}; mkdir -p "$D"; f=0
hold(){ ( HVH_OPERATOR=$1 HVH_STEP=hold; . "$L"; hvh_operator_lock "$2" || exit $?; sleep "$3" ) ; }
try(){ ( HVH_OPERATOR=${1:-} HVH_STEP=try; [ -z "$1" ] && unset HVH_OPERATOR; . "$L"; hvh_operator_lock "$2" >/dev/null || exit $?; exit 0 ); }
c=$D/c1; mkdir -p $c
hold opA $c 4 & HP=$!; sleep 1
[ -f $c/.run.lock/RUN ] && echo "A success path: lock taken, $(cat $c/.run.lock/RUN | cut -c1-60)" || { echo "A FAIL"; f=1; }
try opA $c; r=$?; [ $r = 8 ] && echo "B same operator, overlapping: refused rc=8" || { echo "B FAIL rc=$r"; f=1; }
try opB $c; r=$?; [ $r = 7 ] && echo "D other operator: refused rc=7" || { echo "D FAIL rc=$r"; f=1; }
try "" $c; r=$?; [ $r = 7 ] && echo "E no operator: refused rc=7" || { echo "E FAIL rc=$r"; f=1; }
wait $HP; [ ! -e $c/.run.lock ] && echo "C1 released on exit" || { echo "C1 FAIL"; f=1; }
try opA $c; r=$?; [ $r = 0 ] && [ ! -e $c/.run.lock ] && echo "C2 same operator after release: success rc=0, released again" || { echo "C2 FAIL rc=$r"; f=1; }
c=$D/c2; mkdir -p $c/.operation.lock $c/.run.lock; echo opA > $c/.operation.lock/OPERATOR; echo "pid=999999 host=x step=old operator=opA started=old" > $c/.run.lock/RUN
try opA $c; r=$?; [ $r = 8 ] && [ -e $c/.run.lock ] && echo "F stale lock (dead pid): refused rc=8, not taken over" || { echo "F FAIL rc=$r"; f=1; }
c=$D/c3; mkdir -p $c; for i in $(seq 1 10); do ( hold opA $c 3 >/dev/null 2>&1; echo $? > $D/g$i ) & done; sleep 1.5
n=$(ls -d $c/.run.lock 2>/dev/null | wc -l); wait; ok=$(cat $D/g* | grep -cx 0); no=$(cat $D/g* | grep -cx 8)
[ "$ok" = 1 ] && [ "$no" = 9 ] && echo "G 10 simultaneous same-operator starts: 1 ran, 9 refused rc=8" || { echo "G FAIL ok=$ok refused=$no"; f=1; }
[ $f = 0 ] && echo "ALL PASS" || echo "SOME FAILED"; exit $f
