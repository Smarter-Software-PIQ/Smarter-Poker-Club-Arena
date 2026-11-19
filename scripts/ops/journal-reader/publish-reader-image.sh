#!/usr/bin/env bash
# PUBLISH ONE READ-ONLY HORSE JOURNAL READER IMAGE PER ENGINE RELEASE (2026-11-19, lane Horse Switch).
#
# Runs ON the engine host as root, fed over SSH by .github/workflows/journal-reader-image.yml after an engine release
# workflow completes (never inside it, so it cannot fail or delay a cutover):
#   ssh root@host 'bash -s -- publish [SHA40]' < publish-reader-image.sh
#
# WHY. Horse decision records live on the host for about 30 hours under a byte cap. Re-reading a record on its own
# build needs that build's code, and retain-engine-images.sh keeps only the sealed, running, leased and five newest
# club-arena-engine tags, so a release's image was usually gone before anyone tagged a reader for it (only 28372c9a,
# 3529e866 and 630a1096 were ever retained, by hand, via human-horse-capture/preserve-host.sh).
#
# WHAT. The reader IS the release's own engine image (same bytes the release built and proved), under a second tag
# hvh-reader:<sha10>. retain-engine-images.sh removes club-arena-engine:<sha> tags only, so the second tag keeps the
# image. The reader is only ever run as its own throwaway container: --network none, --read-only root filesystem,
# the journal mounted :ro, no other mount. This script never inspects beyond, signals, restarts or execs into the
# serving container and never builds, pulls or pushes anything.
#
# Which SHAs: the sealed desired SHA (engine-release-seal.py get desired-sha), the running container's sp.release.sha
# label, and an optional SHA argument (workflow_dispatch backfill), each only if club-arena-engine:<sha> still exists
# with this repository's build-contract and revision labels. Already-published readers are re-proved, not re-tagged.
#
# Proof per reader (outside the hourly :48-:05 break and the 09:30-11:30Z nightly cutover window; exit 75 = deferred,
# the workflow retries): the reader container imports dist/services/horseDecisionJournal/review.js, requires
# readHorseJournalHandRecords and HORSE_JOURNAL_HAND_READER_VERSION, and reads one key that cannot exist (expects
# zero records) from the read-only journal. The tag is applied before the proof (it is metadata only), so a deferral
# never loses the image to retention.
#
# Manifest: $STATE/<sha>.json (sha, imageId, tag, publishedAt, proof). Reader tags with a manifest beyond the newest
# $KEEP and older than $KEEP_DAYS are untagged; tags without a manifest (the hand-retained ones) are never touched.
#
# Exit: 0 published/proved (or nothing to publish), 75 deferred by a window, 1 refused or a proof failed.
set -euo pipefail
MODE=${1:-publish}; ARG_SHA=${2:-}
DOCKER=${JR_DOCKER:-docker}
SEAL=${JR_SEAL:-/usr/local/lib/club-arena/engine-control/engine-release-seal.py}
STATE=${JR_STATE:-/var/lib/club-arena/journal-readers}
JOURNAL=${JR_JOURNAL:-/var/lib/club-arena/horse-decisions}
CONTAINER=${JR_CONTAINER:-club-arena-engine}
KEEP=${JR_KEEP:-30}; KEEP_DAYS=${JR_KEEP_DAYS:-14}
NOW=${JR_NOW:-$(date +%s)}
say(){ printf '[journal-reader] %s\n' "$*" >&2; }
die(){ say "REFUSED: $*"; exit 1; }
[ "$MODE" = publish ] || die "unknown mode $MODE"
[ -z "$ARG_SHA" ] || [[ $ARG_SHA =~ ^[0-9a-f]{40}$ ]] || die 'SHA argument must be 40 lowercase hex'
[[ $KEEP =~ ^[1-9][0-9]*$ && $KEEP_DAYS =~ ^[1-9][0-9]*$ ]] || die 'retention bounds must be positive integers'
[[ $JOURNAL =~ ^/[A-Za-z0-9._/-]+$ && $JOURNAL != *..* ]] || die 'journal path'

window(){ local m hm
  m=$((10#$(date -u -d "@$NOW" +%M))); hm=$((10#$(date -u -d "@$NOW" +%H%M)))
  if [ "$m" -ge 48 ] || [ "$m" -lt 6 ]; then echo 'hourly break window :48-:05'; return 1; fi
  if [ "$hm" -ge 930 ] && [ "$hm" -lt 1130 ]; then echo 'nightly cutover window 09:30-11:30Z'; return 1; fi
  return 0; }
label(){ $DOCKER image inspect -f "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null || true; }

declare -A want=()
d=$(python3 "$SEAL" get desired-sha 2>/dev/null || true); [[ $d =~ ^[0-9a-f]{40}$ ]] && want[$d]=sealed
r=$($DOCKER container inspect -f '{{index .Config.Labels "sp.release.sha"}}' "$CONTAINER" 2>/dev/null || true)
[[ $r =~ ^[0-9a-f]{40}$ ]] && want[$r]=${want[$r]:+${want[$r]}+}running
[ -n "$ARG_SHA" ] && want[$ARG_SHA]=${want[$ARG_SHA]:+${want[$ARG_SHA]}+}requested
[ "${#want[@]}" -gt 0 ] || { say 'no sealed, running or requested SHA is readable: nothing to publish'; echo '{"published":[]}'; exit 0; }

install -d -m 0700 "$STATE"
tagged=()
for sha in "${!want[@]}"; do
  eng="club-arena-engine:$sha"; tag="hvh-reader:${sha:0:10}"
  if ! $DOCKER image inspect "$eng" >/dev/null 2>&1; then
    if $DOCKER image inspect "$tag" >/dev/null 2>&1 && [ "$(label "$tag" org.opencontainers.image.revision)" = "$sha" ]; then tagged+=("$sha"); continue; fi
    say "$sha (${want[$sha]}): engine image already retired and no reader exists; cannot publish"; continue
  fi
  [ "$(label "$eng" org.opencontainers.image.revision)" = "$sha" ] || die "$eng revision label is not $sha"
  [ "$(label "$eng" com.smarterpoker.engine.build-contract)" = clean-server-archive-v1 ] || die "$eng is not a clean-server-archive-v1 build"
  id=$($DOCKER image inspect -f '{{.Id}}' "$eng")
  if $DOCKER image inspect "$tag" >/dev/null 2>&1; then
    [ "$($DOCKER image inspect -f '{{.Id}}' "$tag")" = "$id" ] || die "$tag already names a different image than $eng"
  else
    $DOCKER tag "$eng" "$tag"; say "tagged $tag = $eng ($id)"
  fi
  tagged+=("$sha")
done

if ! why=$(window); then say "proof deferred: $why (tags applied: ${tagged[*]:-none})"; exit 75; fi

out='['
for sha in "${tagged[@]}"; do
  tag="hvh-reader:${sha:0:10}"; id=$($DOCKER image inspect -f '{{.Id}}' "$tag")
  proof=$(timeout 120 nice -n 19 $DOCKER run --rm --network none --read-only --cpus 1 --memory 512m --tmpfs /tmp:size=16m \
    -e HORSE_DECISION_JOURNAL_DIR=/j -e GIT_COMMIT_SHA="$sha" -v "$JOURNAL:/j:ro" --entrypoint node "$tag" --input-type=module -e "
const m = await import('/app/dist/services/horseDecisionJournal/review.js');
if (typeof m.readHorseJournalHandRecords !== 'function' || m.HORSE_JOURNAL_HAND_READER_VERSION == null) { console.log(JSON.stringify({ok:false, why:'reader API absent'})); process.exit(3); }
const r = m.readHorseJournalHandRecords('/j', '0'.repeat(64));
console.log(JSON.stringify({ok: Array.isArray(r) && r.length === 0, readerVersion: m.HORSE_JOURNAL_HAND_READER_VERSION, probeRecords: Array.isArray(r) ? r.length : null}));
" 2>/dev/null | grep '^{' | tail -1) || true
  case "$proof" in *'"ok":true'*) ;; *) die "$tag proof failed: ${proof:-no output}";; esac
  at=$(date -u -d "@$NOW" +%FT%TZ)
  prev=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("publishedAt",""))' "$STATE/$sha.json" 2>/dev/null || true)
  printf '{"sha":"%s","tag":"%s","imageId":"%s","publishedAt":"%s","provedAt":"%s","proof":%s,"why":"%s"}\n' \
    "$sha" "$tag" "$id" "${prev:-$at}" "$at" "$proof" "${want[$sha]:-reader}" > "$STATE/$sha.json.tmp"
  mv -f "$STATE/$sha.json.tmp" "$STATE/$sha.json"
  say "proved $tag $proof"; out+="$(cat "$STATE/$sha.json"),"
done
out="${out%,}]"

# Bounded retention of readers this job published (never a hand-retained reader, never the sealed/running one).
mapfile -t old < <(python3 - "$STATE" "$KEEP" "$KEEP_DAYS" "$NOW" "${!want[@]}" <<'PY'
import json, os, sys, datetime
st, keep, days, now, protect = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), set(sys.argv[5:])
ms = []
for f in os.listdir(st):
    if f.endswith('.json') and len(f) == 45:
        try: ms.append(json.load(open(os.path.join(st, f))))
        except Exception: pass
ms.sort(key=lambda m: m.get('publishedAt', ''), reverse=True)
cut = (datetime.datetime.fromtimestamp(now, datetime.timezone.utc) - datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
for m in ms[keep:]:
    if m['sha'] not in protect and m.get('publishedAt', '9') < cut: print(m['sha'])
PY
)
for sha in "${old[@]}"; do
  $DOCKER image rm "hvh-reader:${sha:0:10}" >/dev/null 2>&1 || true; rm -f "$STATE/$sha.json"; say "retired reader hvh-reader:${sha:0:10}"
done
printf '{"published":%s,"retired":%s}\n' "$out" "$(printf '%s\n' "${old[@]}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"
