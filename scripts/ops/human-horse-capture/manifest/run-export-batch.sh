#!/bin/bash
# One bounded read-only original export through the deployed reader. ONE attempt: never rerun after a refused or unknown result.
# usage: run-export-batch.sh FULL_SOURCE_SHA BATCH_MJS OUT_JSONL
set -u
sha="$1"; batch="$2"; out="$3"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "refused: sha" >&2; exit 2; }
[ -f "$batch" ] && [ ! -e "$out" ] && [ ! -e "$out.partial" ] || { echo "refused: batch missing or output exists" >&2; exit 2; }
remote="test -f /var/lock/club-arena-engine-up.lock && exec 9</var/lock/club-arena-engine-up.lock && flock -s -n 9 && test \"\$(docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' club-arena-engine)\" = $sha && timeout 40 docker exec -i club-arena-engine node --max-old-space-size=256 --input-type=module -"
umask 077
ssh "${HVH_ENGINE_HOST:-ca-engine}" "$remote" < "$batch" > "$out.partial"; rc=$?
echo "exit=$rc rows=$(wc -l < "$out.partial" | tr -d ' ') bytes=$(wc -c < "$out.partial" | tr -d ' ')"
[ $rc -eq 0 ] && mv "$out.partial" "$out"
exit $rc
