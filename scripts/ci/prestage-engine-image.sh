#!/usr/bin/env bash
# Receive a content-addressed staging archive over stdin. This path has no runtime or release action.
set -euo pipefail
sha=$1 image=$2 tree=$3 size=$4
[[ "$size" =~ ^[1-9][0-9]{0,10}$ ]]
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$image" =~ ^sha256:[0-9a-f]{64}$ && "$tree" =~ ^[0-9a-f]{40}$ ]]
deadline="$(python3 - <<'PY'
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
now = datetime.now(ZoneInfo("America/Chicago"))
cutoff = now.replace(hour=3, minute=30, second=0, microsecond=0)
if now >= cutoff:
    if now < now.replace(hour=4, minute=5, second=0, microsecond=0):
        raise SystemExit("production preparation window is closed")
    cutoff += timedelta(days=1)
print(min(int(now.timestamp()) + 600, int(cutoff.timestamp()) - 10))
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
if existing="$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null)"; then
  [[ "$existing" = "$image" ]] || { echo 'candidate tag conflicts with qualified digest' >&2; exit 1; }
fi
root="$(docker info --format '{{.DockerRootDir}}')"
free="$(df -PB1 -- "$root" | awk 'NR == 2 { print $4 }')"
[[ "$free" =~ ^[0-9]+$ ]]
(( free > size * 3 + 4 * 1024 * 1024 * 1024 ))
# A transfer tag keeps the loaded manifest reachable across Docker image stores.
# Its namespace is separate from release tags and its name binds the expected ID.
transfer_ref="club-arena-prestage:${image#sha256:}"
remaining=$((deadline - $(date +%s)))
(( remaining > 0 ))
timeout --kill-after=5s "${remaining}s" docker image load >/dev/null
[[ "$(docker image inspect -f '{{.Id}}' "$transfer_ref")" = "$image" ]]
[[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$sha" ]]
[[ "$(docker image inspect -f '{{index .Config.Labels "com.smarterpoker.engine.source-tree"}}' "$image")" = "$tree" ]]
[[ "$(docker image inspect -f '{{index .Config.Labels "com.smarterpoker.engine.build-contract"}}' "$image")" = clean-server-archive-v1 ]]
[[ "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image")" = "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$before")" ]]
[[ "$(rollback)" = "$before" ]]
(( deadline > $(date +%s) ))
docker tag "$image" "$ref"
[[ "$(docker image inspect -f '{{.Id}}' "$ref")" = "$image" ]]
docker image rm "$transfer_ref" >/dev/null
printf 'image=%s\nrollback=%s\ntree=%s\n' "$image" "$before" "$tree"
