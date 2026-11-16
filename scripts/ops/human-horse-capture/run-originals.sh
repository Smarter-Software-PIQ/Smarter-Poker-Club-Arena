#!/bin/bash
# usage: HVH_SHA=<40hex> HVH_IMAGE=<image> HVH_OPERATOR=<id> run-originals.sh [CAPTURE_DIR] (without CAPTURE_DIR: the script was copied into the capture dir, as before; then set HVH_TOOLKIT to this directory). Originals first, each once: witness rows (all human-facing hands), export batches 1 and 2, then roll-up rows. Observer container on the retained outgoing image.
SHA=${HVH_SHA:?}; IMG=${HVH_IMAGE:?reader image for that source}; set -u; [[ $SHA =~ ^[0-9a-f]{40}$ ]] && [[ $IMG =~ ^hvh-reader:[0-9a-f]{10}$ ]] || { echo "refused: HVH_SHA must be 40 hex and HVH_IMAGE hvh-reader:<10 hex>"; exit 2; }; HERE=$(cd "$(dirname "$0")" && pwd); C=$(cd "${1:-$HERE}" && pwd); umask 077; JDIR=${HVH_JOURNAL_DIR:-/var/lib/club-arena/horse-decisions}
L=${HVH_TOOLKIT:-$HERE}/operator-lock.sh; [ -f "$L" ] || { echo "refused: operator-lock.sh not found (set HVH_TOOLKIT)"; exit 2; }; . "$L"; hvh_operator_lock "$C" || exit $?
obs(){ [ -e "$2" ] || [ -e "$2.partial" ] && { echo "refused: $2 exists"; return 9; }
  ssh -o BatchMode=yes -o ConnectTimeout=10 ca-engine "timeout $3 nice -n 15 docker run --rm -i --network none --read-only --cpus 1 --memory 1g --tmpfs /tmp:size=16m -e HORSE_DECISION_JOURNAL_DIR=/j -e GIT_COMMIT_SHA=$SHA -v $JDIR:/j:ro --entrypoint node $IMG --max-old-space-size=768 --input-type=module -" < "$1" 2> "$2.err" | grep '^{' > "$2.partial"; rc=${PIPESTATUS[0]}
  echo "$(date -u +%FT%TZ) $(basename $2) exit=$rc rows=$(wc -l < "$2.partial" | tr -d ' ') bytes=$(wc -c < "$2.partial" | tr -d ' ')"; [ $rc -eq 0 ] && mv "$2.partial" "$2" && chmod 400 "$2" && shasum -a 256 "$2" | cut -c1-64 > "$2.sha256"; return $rc; }
for b in $C/witness-batch-*.mjs; do n=$(basename $b .mjs | sed 's/witness-batch-//'); obs $b $C/originals-witness-$n.jsonl 1300; done
obs $C/batches/export-batch-1.mjs $C/originals-1.jsonl 120; obs $C/batches/export-batch-2.mjs $C/originals-2.jsonl 120
for b in $C/rollup-batch-*.mjs; do n=$(basename $b .mjs | sed "s/rollup-batch-//"); obs $b $C/rollup-rows-$n.jsonl 1300; done
echo "originals-done $(date -u +%FT%TZ)"
