#!/usr/bin/env bash
# Receive a content-addressed staging archive over stdin. This path has no runtime or release action.
set -euo pipefail
# Docker's classic store identifies an image by its config. A containerd
# store may identify that same image by the platform manifest enclosing it.
archive_config() {
  python3 - "$1" "$2" <<'PY_CONFIG'
import hashlib, json, sys, tarfile
with tarfile.open(sys.argv[1], 'r:') as archive:
    rows = json.load(archive.extractfile("manifest.json"))
    if len(rows) != 1 or rows[0].get('RepoTags') != [sys.argv[2]]:
        sys.exit('unexpected image or tag in transfer archive')
    member = archive.getmember(rows[0]['Config'])
    if not member.isfile() or not 0 < member.size <= 16 * 1024 * 1024:
        sys.exit('unexpected configuration in transfer archive')
    data = archive.extractfile(member).read()
    print('sha256:' + hashlib.sha256(data).hexdigest())
PY_CONFIG
}

loaded_image() {
  local ref=$1 expected_config=$2 id
  [[ "$ref" =~ ^club-arena-prestage:[0-9a-f]{64}$ && "$expected_config" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  id=$(docker image inspect -f '{{.Id}}' "$ref") || return 1
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  if [ "$id" != "$expected_config" ]; then
    timeout 5s ctr --namespace moby content get "$id" | python3 -c '
import hashlib, json, sys
data = sys.stdin.buffer.read(1024 * 1024 + 1)
if len(data) > 1024 * 1024 or "sha256:" + hashlib.sha256(data).hexdigest() != sys.argv[1]:
    sys.exit("loaded manifest digest mismatch")
manifest = json.loads(data)
if (manifest.get("schemaVersion") != 2
        or manifest.get("mediaType") not in ("application/vnd.oci.image.manifest.v1+json",
                                             "application/vnd.docker.distribution.manifest.v2+json")
        or manifest.get("config", {}).get("digest") != sys.argv[2]):
    sys.exit("loaded manifest does not bind the qualified configuration")
' "$id" "$expected_config" || return 1
  fi
  printf '%s\n' "$id"
}

case "${1:-}" in
  --archive-config) archive_config "$2" "$3"; exit ;;
  --verify-loaded) loaded_image "$2" "$3"; exit ;;
esac
sha=$1 sender_image=$2 tree=$3 size=$4 config=$5
[[ "$size" =~ ^[1-9][0-9]{0,10}$ ]]
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$sender_image" =~ ^sha256:[0-9a-f]{64}$ && "$config" =~ ^sha256:[0-9a-f]{64}$ && "$tree" =~ ^[0-9a-f]{40}$ ]]
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
root="$(docker info --format '{{.DockerRootDir}}')"
free="$(df -PB1 -- "$root" | awk 'NR == 2 { print $4 }')"
[[ "$free" =~ ^[0-9]+$ ]]
(( free > size * 3 + 4 * 1024 * 1024 * 1024 ))
# A transfer tag keeps the loaded manifest reachable across Docker image stores.
# Its namespace is separate from release tags and its name binds the expected ID.
transfer_ref="club-arena-prestage:${sender_image#sha256:}"
remaining=$((deadline - $(date +%s)))
(( remaining > 0 ))
timeout --kill-after=5s "${remaining}s" docker image load >/dev/null
image="$(loaded_image "$transfer_ref" "$config")"
if existing="$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null)"; then
  [[ "$existing" = "$image" ]] || { echo 'candidate tag conflicts with qualified digest' >&2; exit 1; }
fi
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
