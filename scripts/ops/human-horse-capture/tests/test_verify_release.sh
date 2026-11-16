#!/bin/bash
# Tests for verify-release.sh against a local git fixture and fake health JSON (no network, no engine host).
# Usage: test_verify_release.sh [SCRATCH_DIR]. Exits 1 if any case fails.
set -u; V=$(cd "$(dirname "$0")/.." && pwd)/verify-release.sh; D=${1:-$(mktemp -d)}; f=0
ok(){ echo "PASS $1"; }; no(){ echo "FAIL $1"; f=1; }
R=$D/repo; mkdir -p $R; git -C $R init -q; git -C $R config user.email t@t; git -C $R config user.name t
c(){ echo $1 > $R/f; git -C $R add f; git -C $R commit -qm $1; git -C $R rev-parse HEAD; }
A=$(c one); B=$(c two); git -C $R checkout -q -b side $A; X=$(c side); git -C $R checkout -q -
S=$B
printf '# pr\tcommit\tfinding\tkind\tvalue\n101\t%s\tF-1 first\tbehavior\tv1\n102\t%s\tF-2 second\tbehavior\tv2\n103\t%s\tF-3 side\tbehavior\tv3\n' ${A:0:12} ${B:0:12} ${X:0:12} > $D/inv.tsv
health(){ printf '{"releaseSha":"%s","manifestDigest":"abc123","byMode":{"ready":2},"liveHorseDecision":{"workers":[{"upgradeManifest":{"sourceRevision":"%s"}},{"upgradeManifest":{"sourceRevision":"%s"}}]},"horseUpgradeManifest":{"version":"v1","authorities":{"features":{"status":"refused"}}}}' "$1" "$2" "$3" > $D/h.json; }
run(){ HVH_HEALTH_JSON=$D/h.json HVH_RELEASE_INVENTORY=$D/inv.tsv HVH_ENGINE_HOST=none bash $V $R; }
health $S $S $S; o=$(run); rc=$?
echo "$o" | grep -q "inventory: 2 in serving, 1 not" && echo "$o" | grep -q "^IN SERVING.*#101" && echo "$o" | grep -q "^not serving.*#103" \
  && echo "$o" | grep -q "RESULT PASS all workers on the serving revision" && echo "$o" | grep -q "skipped (HVH_ENGINE_HOST=none)" \
  && ok "1 ancestry per inventory row, workers on the serving revision" || no "1 rc=$rc: $o"
health $S $S $X; o=$(run); echo "$o" | grep -q "RESULT FAIL worker revision mismatch" && echo "$o" | grep -q "other revisions \['$X'\]" && ok "2 a worker on another revision is a FAIL" || no "2: $o"
printf '{"liveness":"ok"}' > $D/h.json; run >/dev/null; [ $? = 2 ] && ok "3 health without releaseSha exits 2" || no "3"
health $(printf 'f%.0s' $(seq 40)) $S $S; run >/dev/null; [ $? = 3 ] && ok "4 serving commit unknown to the repository exits 3 (UNVERIFIED)" || no "4"
[ $f = 0 ] && echo "ALL PASS" || echo "SOME FAILED"; [ -z "${1:-}" ] && rm -rf "$D"; exit $f
