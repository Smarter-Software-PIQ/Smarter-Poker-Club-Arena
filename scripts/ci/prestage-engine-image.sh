#!/usr/bin/env bash
# Receive one isolated transport tag and prove its exact image configuration. This path has no runtime or release action.
set -euo pipefail
sha=$1 config=$2 tree=$3 size=$4 transport=$5 hours=$6
# The target's protected policy names its cycle hours (the sender reads it with
# `engine-release-seal.py schedule-policy`, as the receiver gate does): the
# daily route closes 03:30-04:05 only; three-hourly closes every cycle.
[[ "$hours" = 4 || "$hours" = 1,4,7,10,13,16,19,22 ]]
[[ "$transport" =~ ^club-arena-prestage:[1-9][0-9]*-[1-9][0-9]*$ ]]
[[ "$size" =~ ^[1-9][0-9]{0,10}$ ]]
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$config" =~ ^sha256:[0-9a-f]{64}$ && "$tree" =~ ^[0-9a-f]{40}$ ]]
deadline="$(START_HOURS="$hours" python3 - <<'PY'
import os, time
from datetime import datetime
from zoneinfo import ZoneInfo
# Closed from each scheduled cycle's preparation cutoff (start - 30 min) to its
# end (start + 5 min), for the cycles the TARGET's policy names: every
# three-hourly cycle 01/04/07/10/13/16/19/22 Chicago (owner order 2026-11-21),
# or only 03:30-04:05 for the daily 04:00 anchor. Real epoch hours; the
# repeated fall-back hour is one cycle (the first).
zone = ZoneInfo("America/Chicago")
hours = (1, 4, 7, 10, 13, 16, 19, 22) if os.environ["START_HOURS"] != "4" else (4,)
now = int(time.time())
starts = [h for h in ((now // 3600 + k) * 3600 for k in range(-1, 25))
          if datetime.fromtimestamp(h, zone).hour in hours
          and datetime.fromtimestamp(h - 3600, zone).hour != datetime.fromtimestamp(h, zone).hour]
for start in starts:
    if start - 1800 <= now < start + 300:
        raise SystemExit("production preparation window is closed")
cutoff = min(start - 1800 for start in starts if start - 1800 > now)
print(min(now + 600, cutoff - 10))
PY
)"
(( deadline > $(date +%s) ))
exec 9>/var/lock/club-arena-engine-build.lock
wait_seconds=$((deadline - $(date +%s)))
(( wait_seconds > 0 ))
flock -w "$wait_seconds" 9 || { echo 'preparation deadline expired waiting for the image lock' >&2; exit 1; }
(( deadline > $(date +%s) ))
rollback() {
  local desired running
  desired="$(/usr/local/lib/club-arena/engine-control/engine-release-seal.py get desired-image-id)"
  running="$(docker container inspect -f '{{if .State.Running}}{{.Image}}{{end}}' club-arena-engine)"
  [[ "$desired" =~ ^sha256:[0-9a-f]{64}$ && "$running" = "$desired" ]] || return 1
  [[ "$(docker image inspect -f '{{.Id}}' "$desired")" = "$desired" ]] || return 1
  printf '%s\n' "$desired"
}
before="$(rollback)"
ref="club-arena-engine:$sha"
if docker image inspect "$transport" >/dev/null 2>&1; then
  echo 'transport tag already exists' >&2
  exit 1
fi
root="$(docker info --format '{{.DockerRootDir}}')"
free="$(df -PB1 -- "$root" | awk 'NR == 2 { print $4 }')"
[[ "$free" =~ ^[0-9]+$ ]]
(( free > size * 3 + 4 * 1024 * 1024 * 1024 ))
# The unique transport reference was absent under this same host lock.
remove_transport_tag() {
  if docker image inspect "$transport" >/dev/null 2>&1; then
    timeout 15s docker image rm "$transport" >/dev/null
  fi
}
trap remove_transport_tag EXIT
# The sender proved the archive carries only the isolated transport tag.
remaining=$((deadline - $(date +%s)))
(( remaining > 0 ))
timeout --kill-after=5s "${remaining}s" docker image load >/dev/null
image="$(docker image inspect -f '{{.Id}}' "$transport")"
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]
remaining=$((deadline - $(date +%s)))
(( remaining > 0 ))
proof="$(printf '%s' "$PROOF_B64" | base64 -d)"
loaded_config="$(timeout --kill-after=5s "${remaining}s" docker image save "$transport" | python3 -B -c "$proof" "$transport" "$image")"
[[ "$loaded_config" = "$config" ]] || { echo 'transferred image config digest differs' >&2; exit 1; }
if existing="$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null)"; then
  [[ "$existing" = "$image" ]] || { echo 'candidate tag conflicts with qualified native digest' >&2; exit 1; }
fi
[[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$sha" ]]
[[ "$(docker image inspect -f '{{index .Config.Labels "com.smarterpoker.engine.source-tree"}}' "$image")" = "$tree" ]]
[[ "$(docker image inspect -f '{{index .Config.Labels "com.smarterpoker.engine.build-contract"}}' "$image")" = clean-server-archive-v1 ]]
[[ "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image")" = "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$before")" ]]
[[ "$(rollback)" = "$before" ]]
(( deadline > $(date +%s) ))
docker tag "$image" "$ref"
[[ "$(docker image inspect -f '{{.Id}}' "$ref")" = "$image" ]]
remove_transport_tag
trap - EXIT
printf 'image=%s\nrollback=%s\ntree=%s\n' "$image" "$before" "$tree"
