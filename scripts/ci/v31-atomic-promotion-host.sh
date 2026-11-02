#!/usr/bin/env bash
# One engine-locked V31 activation on the engine host: promote the evaluated
# epoch -> explicit eight-worker load -> fresh eight-worker status -> natural
# readiness, all while holding /var/lock/club-arena-engine-up.lock so no engine
# release can swap the serving image in between. Sent verbatim by
# scripts/ci/gto-v31-qualification.mjs (operation promote); never scheduled.
#
# Arguments: dataset checksum engine_commit serving_commit request_id
#            readiness_request_b64 container_promote_js_b64 readiness_js_b64
#
# Every line it prints is `V31_ATOMIC_STAGE <stage> <json>` or the final
# `V31_ATOMIC_OUTCOME <outcome>`. Exit codes (nothing changed unless noted):
#   0  promoted-loaded-ready
#   64 refused-arguments
#   65 refused-serving-identity      (image is not the verified serving commit)
#   66 promotion-refused             (database gates refused; rolled back)
#   67 promotion-outcome-unknown     (re-run: promotion is never repeated once recorded)
#   68 promoted-load-incomplete      (CHANGED: re-run loads without re-promoting)
#   69 promoted-loaded-readiness-unproved (CHANGED: re-run reloads and re-proves)
#   70 serving-identity-changed      (CHANGED or not: inspect, then re-run)
#   75 refused-lock-or-boundary      (lock busy/missing or a maintenance boundary)
set -uo pipefail
# The operation always completes to a recorded outcome, even if the SSH session drops.
trap '' HUP PIPE
LOCK=${V31_ENGINE_LOCK:-/var/lock/club-arena-engine-up.lock}
CONTAINER=club-arena-engine
BUDGET_MINUTES=9
READINESS_ATTEMPTS=6
READINESS_PAUSE=${V31_READINESS_PAUSE:-20}

outcome() { printf 'V31_ATOMIC_OUTCOME %s\n' "$1"; exit "$2"; }
stage() { printf 'V31_ATOMIC_STAGE %s %s\n' "$1" "$2"; }
last_json() { printf '%s\n' "$1" | grep -E '^\{.*\}$' | tail -n 1; }

[ "$#" -eq 8 ] || outcome refused-arguments 64
dataset=$1 checksum=$2 engine=$3 serving=$4 request=$5 ready_request=$6 promote_js=$7 ready_js=$8
uuid='^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
[[ $dataset =~ $uuid && $request =~ $uuid ]] || outcome refused-arguments 64
[[ $checksum =~ ^[0-9a-f]{64}$ && $engine =~ ^[0-9a-f]{40}$ && $serving =~ ^[0-9a-f]{40}$ ]] || outcome refused-arguments 64
for value in "$ready_request" "$promote_js" "$ready_js"; do
  [[ $value =~ ^[A-Za-z0-9+/=]+$ ]] || outcome refused-arguments 64
done

test -f "$LOCK" || outcome refused-lock-missing 75
exec 9>"$LOCK"
flock -n 9 || outcome refused-lock-busy 75

# Never start where the run could reach an hourly :50-:10 boundary or the
# daily 03:50-04:06 America/Chicago maintenance window.
now=$(date -u +%s) || outcome refused-clock 75
minute=$(( (now / 60) % 60 ))
if (( minute < 10 || minute > 49 - BUDGET_MINUTES )); then outcome refused-maintenance-boundary 75; fi
chicago=$(TZ=America/Chicago date +%H%M) || outcome refused-clock 75
chicago=$((10#$chicago))
if (( chicago >= 350 - BUDGET_MINUTES && chicago <= 406 )); then outcome refused-daily-maintenance 75; fi

identity() {
  docker container inspect -f '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.State.Status}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CONTAINER"
}
before=$(identity) || outcome refused-serving-identity 65
case "$before" in *"|running|$serving") ;; *) outcome refused-serving-identity 65 ;; esac
unchanged() { [ "$(identity 2>/dev/null)" = "$before" ]; }

# 1. Promotion of exactly the evaluated epoch (or proof it already happened).
promotion=$(printf '%s' "$promote_js" | base64 -d | docker exec -i "$CONTAINER" node --input-type=module - "$dataset" "$checksum" "$engine" "$serving")
code=$?
stage promote "$(last_json "$promotion")"
unchanged || outcome serving-identity-changed 70
case "$code" in
  0) ;;
  10) outcome promotion-refused 66 ;;
  *) outcome promotion-outcome-unknown 67 ;;
esac

# 2. One explicit eight-worker load of the now-active dataset.
load=$(docker exec "$CONTAINER" node dist/scripts/reloadPublic215Stores.js reload "$request" "$dataset" "$checksum")
code=$?
stage load "$(last_json "$load")"
unchanged || outcome serving-identity-changed 70
[ "$code" -eq 0 ] || outcome promoted-load-incomplete 68

# 3. A fresh eight-worker status read of the same request identity.
status=$(docker exec "$CONTAINER" node dist/scripts/reloadPublic215Stores.js status "$request" "$dataset" "$checksum")
code=$?
stage status "$(last_json "$status")"
[ "$code" -eq 0 ] || outcome promoted-loaded-readiness-unproved 69

# 4. Natural readiness: each worker made an accepted decision with the store loaded.
attempt=1
while :; do
  ready=$(printf '%s' "$ready_js" | base64 -d | docker exec -i "$CONTAINER" node --input-type=module - "$ready_request")
  code=$?
  stage readiness "$(last_json "$ready")"
  if [ "$code" -ne 2 ] || [ "$attempt" -ge "$READINESS_ATTEMPTS" ]; then break; fi
  attempt=$((attempt + 1))
  sleep "$READINESS_PAUSE"
done
unchanged || outcome serving-identity-changed 70
[ "$code" -eq 0 ] || outcome promoted-loaded-readiness-unproved 69
outcome promoted-loaded-ready 0
