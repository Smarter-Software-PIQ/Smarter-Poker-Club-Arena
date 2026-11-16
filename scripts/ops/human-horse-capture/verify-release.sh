#!/bin/bash
# Read-only verification of a serving engine release against the Horse change inventory. No release action, no capture.
# usage: verify-release.sh [REPO]   (run on a live turn; writes nothing on production; in REPO it runs git fetch origin main, which updates origin/main and FETCH_HEAD)
# Environment (all optional): HVH_HEALTH_URL (default https://engine.smarter.poker/health), HVH_HEALTH_JSON (read health from this file instead,
# for tests), HVH_RELEASE_INVENTORY (default release-inventory.tsv beside this script), HVH_ENGINE_HOST (default ca-engine; "none" skips the
# engine-host Prometheus read). REPO defaults to the owner's canonical clone.
set -u
REPO=${1:-/Users/smarter.poker/Documents/club-arena}; HERE=$(cd "$(dirname "$0")" && pwd); INV=${HVH_RELEASE_INVENTORY:-$HERE/release-inventory.tsv}
if [ -n "${HVH_HEALTH_JSON:-}" ]; then H=$(cat "$HVH_HEALTH_JSON") || { echo "FAIL health file unreadable"; exit 2; }
else H=$(curl -s -m 10 "${HVH_HEALTH_URL:-https://engine.smarter.poker/health}") || { echo "FAIL health unreachable"; exit 2; }; fi
S=$(printf '%s' "$H" | grep -o '"releaseSha":"[0-9a-f]*"' | head -1 | cut -d'"' -f4)
[ -n "$S" ] || { echo "FAIL no releaseSha in health"; exit 2; }
echo "serving releaseSha: $S   read at $(date -u +%FT%TZ)"
git -C "$REPO" fetch -q origin main 2>/dev/null
git -C "$REPO" cat-file -e "$S^{commit}" 2>/dev/null || { echo "UNVERIFIED serving commit not in the local repository after fetch"; exit 3; }
in=0; out=0
while IFS=$'\t' read -r pr c finding kind value; do
  case "$pr" in \#*|"") continue;; esac
  if git -C "$REPO" merge-base --is-ancestor "$c" "$S" 2>/dev/null; then st="IN SERVING"; in=$((in+1)); else st="not serving"; out=$((out+1)); fi
  printf '%-12s #%-6s %s  %-9s %s | value: %s\n' "$st" "$pr" "$c" "$kind" "$finding" "$value"
done < "$INV"
echo "inventory: $in in serving, $out not"
a=0; b=0; git -C "$REPO" merge-base --is-ancestor a68e452fa27e "$S" 2>/dev/null && a=1; git -C "$REPO" merge-base --is-ancestor 782b384b0763 "$S" 2>/dev/null && b=1
[ $b -eq 1 ] && [ $a -eq 0 ] && echo "FAIL dependency: #10612 is serving without #10618" || echo "dependency #10612 requires #10618: ok (10618=$a 10612=$b)"
o=0; git -C "$REPO" merge-base --is-ancestor e8a1f40102e3 "$S" 2>/dev/null && o=1
if [ $o -eq 1 ]; then
  if git -C "$REPO" grep -q "vpipFloorDeepStackOff === true" "$S" -- server/src/engine/HorseLogic.ts 2>/dev/null; then echo "#10628 rule: serving as opt-in (default off): ok"; else echo "WARN #10628 is serving with its rule ON by default (opt-in change #10650 not in this release); not supported by expected value"; fi
fi
echo "manifest: $(printf '%s' "$H" | grep -o '"manifestDigest":"[0-9a-f]*"' | head -1)  workers ready: $(printf '%s' "$H" | grep -o '"byMode":{[^}]*}' | head -1)"
echo "memory-domain series and rule (engine host Prometheus):"
EH=${HVH_ENGINE_HOST:-ca-engine}; [ "$EH" = none ] && echo "  skipped (HVH_ENGINE_HOST=none)" || ssh -o BatchMode=yes -o ConnectTimeout=8 ca-engine "curl -s -G 'http://127.0.0.1:9090/api/v1/query' --data-urlencode 'query=count(poker_hand_memory_domain_logged_total)'; echo; curl -s -G 'http://127.0.0.1:9090/api/v1/query' --data-urlencode 'query=sum(poker_hand_memory_domain_missing_total{mode=\"cash\",reached_showdown=\"true\",reason=~\"absent|invalid\"})'; echo; curl -s -G 'http://127.0.0.1:9090/api/v1/query' --data-urlencode 'query=ALERTS{alertname=\"HandMemoryDomainMissingOnCashShowdown\"}'" 2>/dev/null | cut -c1-260
echo "worker fleet readback (every live decision worker must run the serving revision):"
printf '%s' "$H" | python3 -c '
import json,sys
d=json.load(sys.stdin); S=sys.argv[1]
ws=(d.get("liveHorseDecision") or {}).get("workers") or []
revs=[(w.get("upgradeManifest") or {}).get("sourceRevision") for w in ws]
ok=sum(1 for r in revs if r==S)
print(f"  workers {len(ws)}; on serving revision {ok}; other revisions {sorted(set(r for r in revs if r!=S))}")
m=d.get("horseUpgradeManifest") or {}
print("  manifest version", m.get("version"), "| authorities", {k:(v or {}).get("status") for k,v in (m.get("authorities") or {}).items()})
print("  RESULT", "PASS all workers on the serving revision" if ws and ok==len(ws) else "FAIL worker revision mismatch or no workers")
' "$S"
echo "NOT checked here (separate reads): qualification and seal records, thaw, Pillar 2 and exclusion readback from worker manifests, database aggregates for EXE-002, the observation window."
