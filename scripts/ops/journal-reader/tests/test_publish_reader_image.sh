#!/usr/bin/env bash
# Hermetic test of publish-reader-image.sh with a fake docker and a fake release seal. No host, network or real docker.
# usage: bash scripts/ops/journal-reader/tests/test_publish_reader_image.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd); SUT=$HERE/publish-reader-image.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0; pass=0
ok(){ pass=$((pass+1)); echo "ok   $*"; }
no(){ fail=$((fail+1)); echo "FAIL $*"; }
SHA=1111111111111111111111111111111111111111; SHB=2222222222222222222222222222222222222222
cat > "$T/docker" <<'D'
#!/usr/bin/env bash
# fake docker: images in $FD/img/<ref with / and : as _> = "id|revision|contract"; every call appended to $FD/calls
printf '%s\n' "$(printf '%s' "$*" | tr '\n' ' ')" >> "$FD/calls"; f(){ echo "$FD/img/$(echo "$1" | tr ':/' '__')"; }
case "$1 $2" in
  "image inspect") shift 2; fmt=; [ "$1" = -f ] && { fmt=$2; shift 2; }; p=$(f "$1"); [ -e "$p" ] || exit 1
    IFS='|' read -r id rev con < "$p"
    case "$fmt" in *.Id*) echo "$id";; *revision*) echo "$rev";; *build-contract*) echo "$con";; *) echo '[{}]';; esac;;
  "container inspect") cat "$FD/running" 2>/dev/null || exit 1;;
  "image rm") p=$(f "$3"); rm -f "$p";;
  tag*) cp "$(f "$2")" "$(f "$3")";;
  run*) cat "$FD/proof";;
  *) echo "unexpected docker $*" >&2; exit 9;;
esac
D
cat > "$T/seal.py" <<'P'
import os, sys
v = os.environ.get('FAKE_DESIRED', '')
if not v: sys.exit(1)
print(v)
P
chmod +x "$T/docker"
# GNU date/timeout (CI is Ubuntu; on macOS use coreutils' gdate/gtimeout when present)
mkdir -p "$T/bin"; date -u -d @0 +%s >/dev/null 2>&1 || { command -v gdate >/dev/null && ln -s "$(command -v gdate)" "$T/bin/date"; }
command -v timeout >/dev/null || { command -v gtimeout >/dev/null && ln -s "$(command -v gtimeout)" "$T/bin/timeout"; }
export PATH="$T/bin:$PATH"
reset(){ rm -rf "$T/fd" "$T/state"; mkdir -p "$T/fd/img"; : > "$T/fd/calls"; echo '{"ok":true,"readerVersion":2,"probeRecords":0}' > "$T/fd/proof"; }
img(){ echo "$2|$3|${4:-clean-server-archive-v1}" > "$T/fd/img/$(echo "$1" | tr ':/' '__')"; }
NOON=$(date -u -d '2026-11-19T14:20:00Z' +%s)
run(){ FD="$T/fd" JR_DOCKER="$T/docker" JR_SEAL="$T/seal.py" JR_STATE="$T/state" JR_JOURNAL=/var/lib/club-arena/horse-decisions JR_NOW=${NOWX:-$NOON} \
  FAKE_DESIRED=${DES-$SHA} bash "$SUT" publish "$@" > "$T/out" 2> "$T/err"; echo $?; }
has(){ grep -q -- "$2" "$1"; }

# 1 publish: sealed engine image -> reader tag, proof, manifest
reset; img club-arena-engine:$SHA sha256:aaa $SHA; echo "" > "$T/fd/running"
rc=$(run); [ "$rc" = 0 ] && [ -e "$T/fd/img/hvh-reader_1111111111" ] && has "$T/out" "\"sha\":\"$SHA\"" && [ -e "$T/state/$SHA.json" ] \
  && ok "publishes hvh-reader:<sha10> for the sealed release" || no "publish rc=$rc $(cat "$T/err")"
grep '^run' "$T/fd/calls" > "$T/runs"
has "$T/runs" '--network none' && has "$T/runs" '--read-only' && has "$T/runs" '/var/lib/club-arena/horse-decisions:/j:ro' && [ "$(grep -o -- ' -v ' "$T/runs" | wc -l | tr -d ' ')" = 1 ] \
  && ok "reader runs with no network, read-only rootfs and only the journal mounted :ro" || no "run args: $(cat "$T/runs")"
bad=$(grep -v -E '^(image inspect |container inspect -f \{\{index \.Config\.Labels "sp\.release\.sha"\}\} club-arena-engine$|tag club-arena-engine:[0-9a-f]{40} hvh-reader:[0-9a-f]{10}$|run --rm --network none --read-only |image rm hvh-reader:)' "$T/fd/calls")
[ -z "$bad" ] && ok "only inspects, tags engine->reader, runs the read-only reader (never restarts, execs, pulls, builds or removes an engine image)" || no "unexpected docker calls: $bad"
p1=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["publishedAt"])' "$T/state/$SHA.json")

# 2 idempotent: second run re-proves, does not re-tag, keeps publishedAt
: > "$T/fd/calls"; rc=$(NOWX=$((NOON+3600)) run)
[ "$rc" = 0 ] && ! grep -q '^tag' "$T/fd/calls" && [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["publishedAt"])' "$T/state/$SHA.json")" = "$p1" ] \
  && ok "a second run re-proves without re-tagging and keeps publishedAt" || no "idempotent rc=$rc"

# 3 wrong revision label is refused
reset; img club-arena-engine:$SHA sha256:aaa $SHB; rc=$(run); [ "$rc" = 1 ] && ! [ -e "$T/fd/img/hvh-reader_1111111111" ] && ok "refuses an engine image whose revision label is another SHA" || no "revision rc=$rc"
# 4 foreign build contract is refused
reset; img club-arena-engine:$SHA sha256:aaa $SHA other-contract; rc=$(run); [ "$rc" = 1 ] && ok "refuses an image without the clean-server-archive-v1 contract" || no "contract rc=$rc"
# 5 existing reader tag naming another image is refused
reset; img club-arena-engine:$SHA sha256:aaa $SHA; img hvh-reader:1111111111 sha256:bbb $SHA; rc=$(run); [ "$rc" = 1 ] && has "$T/err" 'different image' && ok "refuses a reader tag that names a different image" || no "conflict rc=$rc"
# 6 hourly break: tag applied, proof deferred with 75
reset; img club-arena-engine:$SHA sha256:aaa $SHA; rc=$(NOWX=$(date -u -d '2026-11-19T14:50:00Z' +%s) run)
[ "$rc" = 75 ] && [ -e "$T/fd/img/hvh-reader_1111111111" ] && ! grep -q '^run' "$T/fd/calls" && ok "in the :48-:05 break it tags (retention-safe) and defers the proof (75)" || no "break rc=$rc"
# 7 nightly cutover window
reset; img club-arena-engine:$SHA sha256:aaa $SHA; rc=$(NOWX=$(date -u -d '2026-11-19T10:15:00Z' +%s) run)
[ "$rc" = 75 ] && ! grep -q '^run' "$T/fd/calls" && ok "in the 09:30-11:30Z cutover window it defers the proof (75)" || no "nightly rc=$rc"
# 8 proof failure fails the job and writes no manifest
reset; img club-arena-engine:$SHA sha256:aaa $SHA; echo '{"ok":false,"why":"reader API absent"}' > "$T/fd/proof"; rc=$(run)
[ "$rc" = 1 ] && ! [ -e "$T/state/$SHA.json" ] && ok "a reader that cannot read the journal fails and is not recorded" || no "proof rc=$rc"
# 9 engine image retired but reader kept: re-proved from the reader
reset; img hvh-reader:1111111111 sha256:aaa $SHA; rc=$(run); [ "$rc" = 0 ] && has "$T/out" "\"sha\":\"$SHA\"" && ok "re-proves a reader whose engine tag was already retired" || no "retired rc=$rc"
# 10 running container differs from seal (rollback): both published
reset; img club-arena-engine:$SHA sha256:aaa $SHA; img club-arena-engine:$SHB sha256:ccc $SHB; echo "$SHB" > "$T/fd/running"; rc=$(run)
[ "$rc" = 0 ] && [ -e "$T/fd/img/hvh-reader_1111111111" ] && [ -e "$T/fd/img/hvh-reader_2222222222" ] && ok "publishes both the sealed and the running release" || no "both rc=$rc"
# 11 bad argument
reset; rc=$(run 'abc;rm'); [ "$rc" = 1 ] && ok "refuses a malformed SHA argument" || no "arg rc=$rc"
# 12 nothing readable: no-op success
reset; rc=$(DES='' run); [ "$rc" = 0 ] && has "$T/out" '"published":\[\]' && ok "with no sealed/running SHA it publishes nothing and succeeds" || no "empty rc=$rc"
# 13 retention: keeps newest KEEP manifests, never a hand-retained tag or the protected SHA
reset; img club-arena-engine:$SHA sha256:aaa $SHA; img hvh-reader:28372c9a17 sha256:legacy 28372c9a1750934d1c39839bc551b050da6f4b8d; mkdir -p "$T/state"
for i in $(seq 1 5); do s=$(printf 'a%d%038d' $i 0); img hvh-reader:${s:0:10} sha256:o$i $s
  printf '{"sha":"%s","publishedAt":"2026-10-0%dT00:00:00Z"}\n' "$s" "$i" > "$T/state/$s.json"; done
rc=$(JR_KEEP=3 run); left=$(find "$T/fd/img" -name 'hvh-reader_a*' | wc -l | tr -d ' ')
[ "$rc" = 0 ] && [ "$left" = 2 ] && [ -e "$T/fd/img/hvh-reader_28372c9a17" ] && [ -e "$T/fd/img/hvh-reader_1111111111" ] && has "$T/out" '"a100000000000000000000000000000000000000"' && ! has "$T/out" '"a5000000' \
  && ok "retires only this job's readers beyond the newest KEEP and older than KEEP_DAYS" || no "retention rc=$rc left=$left $(cat "$T/out")"
echo "passed $pass failed $fail"; [ "$fail" = 0 ]
