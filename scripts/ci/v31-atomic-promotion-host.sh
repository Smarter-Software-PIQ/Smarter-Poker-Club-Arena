#!/usr/bin/env bash
# One V31 activation on the engine host: promote the evaluated epoch -> bind
# the serving engine commit -> explicit eight-worker load -> fresh eight-worker
# status -> natural readiness. Sent verbatim by scripts/ci/gto-v31-qualification.mjs
# (operation promote); never scheduled.
#
# SAFETY COMES FROM THE DATABASE BINDING, NOT FROM THE ENGINE LOCK. A live
# worker serves the active dataset only when gto_v31_serving_bindings holds an
# open binding for its own engine commit (GtoPostflopV31Loader serving gate).
# So a release, rollback, crash restart or off-cycle recovery that replaces the
# container mid-operation can never serve the dataset on an unproven engine,
# and this operation never takes /var/lock/club-arena-engine-up.lock: release
# transactions (600 s wait), their ExecStopPost recovery (5 s wait) and crash
# recovery (Docker restart policy + sp-autoheal, no lock) never wait on it.
# V31 operations serialize only on their own activation lock.
#
# BOUNDED AND KILLABLE. Every docker step runs under `timeout` against one
# absolute deadline. Each in-container process records its PID; on a timeout
# the host kills it INSIDE the container and proves it gone before anything
# else happens (an unkillable step stops the run, exit 71).
#
# NO MIXED MODEL. A failure after the binding may exist revokes it, then
# clears all eight workers (a reload that the gate turns into the empty store)
# and proves every worker empty. A revoked binding also keeps every later boot
# and six-hourly refresh empty, so workers converge on the empty store even if
# the explicit clear cannot be confirmed (exit 72; re-run).
#
# Arguments: dataset checksum engine_commit serving_commit request_id
#            closure_digest bound_by readiness_request_b64 container_js_b64 readiness_js_b64
#
# Every line it prints is `V31_ATOMIC_STAGE <stage> <json>` or the final
# `V31_ATOMIC_OUTCOME <outcome>`. Exit codes:
#   0  promoted-loaded-ready
#   64 refused-arguments                      (nothing changed)
#   65 refused-serving-identity               (nothing changed)
#   66 promotion-refused                      (nothing changed)
#   67 promotion-outcome-unknown              (never bound; all 8 workers proven empty; re-run)
#   68 rolled-back-empty                      (promoted; binding revoked; all 8 workers proven empty; re-run binds again)
#   69 promoted-loaded-readiness-unproved     (all 8 workers proven on the same dataset; re-run)
#   70 promoted-unbound                       (promoted, never bound; all 8 workers proven empty; re-run)
#   71 in-container-step-not-terminated       (inspect before any new operation; the runner revokes)
#   72 rollback-incomplete                    (empty proof or revocation unconfirmed; the runner revokes; workers converge empty; re-run)
#   73 promotion-outcome-unknown-uncleared    (promotion unknown and workers not proven empty; re-run)
#   75 refused-lock-or-boundary               (nothing changed)
set -uo pipefail
# A dropped SSH session must still reach a recorded outcome; the absolute
# deadlines below bound how long that can take.
trap '' HUP PIPE
LOCK=${V31_ACTIVATION_LOCK:-/var/lock/club-arena-v31-activation.lock}
CONTAINER=club-arena-engine
BUDGET_MINUTES=9
BUDGET_SECONDS=480
# A caller may only SHRINK the budgets (the tests use this for hung steps).
if [[ ${V31_BUDGET_SECONDS:-} =~ ^[0-9]+$ ]] && (( V31_BUDGET_SECONDS < BUDGET_SECONDS )); then
  BUDGET_SECONDS=$V31_BUDGET_SECONDS
fi
READINESS_ATTEMPTS=6
READINESS_PAUSE=${V31_READINESS_PAUSE:-20}
CLEAR_ATTEMPTS=3
locked=0

outcome() {
  printf 'V31_ATOMIC_OUTCOME %s\n' "$1"
  if [ "$locked" -eq 1 ]; then flock -u 9 2>/dev/null; exec 9>&-; fi
  exit "$2"
}
stage() { printf 'V31_ATOMIC_STAGE %s %s\n' "$1" "$2"; }
last_json() { printf '%s\n' "$1" | grep -E '^\{.*\}$' | tail -n 1; }

[ "$#" -eq 10 ] || outcome refused-arguments 64
dataset=$1 checksum=$2 engine=$3 serving=$4 request=$5 digest=$6 bound_by=$7 ready_request=$8 container_js=$9 ready_js=${10}
uuid='^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
[[ $dataset =~ $uuid && $request =~ $uuid ]] || outcome refused-arguments 64
[[ $checksum =~ ^[0-9a-f]{64}$ && $digest =~ ^[0-9a-f]{64}$ && $engine =~ ^[0-9a-f]{40}$ && $serving =~ ^[0-9a-f]{40}$ ]] || outcome refused-arguments 64
[[ $bound_by =~ ^[A-Za-z0-9:._/@-]{1,200}$ ]] || outcome refused-arguments 64
for value in "$ready_request" "$container_js" "$ready_js"; do
  [[ $value =~ ^[A-Za-z0-9+/=]+$ ]] || outcome refused-arguments 64
done

exec 9>>"$LOCK" || outcome refused-lock-missing 75
flock -n 9 || outcome refused-lock-busy 75
locked=1

# Never start where the run could reach an hourly :50-:10 boundary or the
# daily 03:50-04:06 America/Chicago maintenance window.
now=$(date -u +%s) || outcome refused-clock 75
minute=$(( (now / 60) % 60 ))
if (( minute < 10 || minute > 49 - BUDGET_MINUTES )); then outcome refused-maintenance-boundary 75; fi
chicago=$(TZ=America/Chicago date +%H%M) || outcome refused-clock 75
chicago=$((10#$chicago))
if (( chicago >= 350 - BUDGET_MINUTES && chicago <= 406 )); then outcome refused-daily-maintenance 75; fi
# The whole run, revert included, stays inside the window the start refusal
# leaves before the :50 boundary; a revert that cannot fit reports 72 and the
# runner revokes the binding through its own service-role path.
window_end=$(( now - now % 3600 + 49 * 60 + 30 ))
deadline=$(( now + BUDGET_SECONDS ))
(( deadline < window_end )) || deadline=$window_end
remaining() { local t; t=$(date -u +%s) || t=$deadline; echo $(( deadline - t )); }
# bounded <cap-seconds> command...: runs within min(cap, time left before the deadline).
bounded() {
  local cap=$1 left
  shift
  left=$(remaining)
  (( left > 2 )) || return 124
  (( cap < left )) || cap=$left
  timeout --signal=TERM --kill-after=5 "$cap" "$@"
}

identity() {
  bounded 20 docker container inspect -f '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.State.Status}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CONTAINER"
}
before=$(identity) || outcome refused-serving-identity 65
case "$before" in *"|running|$serving") ;; *) outcome refused-serving-identity 65 ;; esac
unchanged() { [ "$(identity 2>/dev/null)" = "$before" ]; }

# Kill an in-container step by its recorded PID and prove it is gone. Bounded on
# its own clock: it runs exactly when the run deadline has been reached.
terminate_step() {
  timeout --signal=TERM --kill-after=2 20 docker exec "$CONTAINER" sh -c \
    'p=$(cat "$0" 2>/dev/null) || exit 0; [ -n "$p" ] || exit 0; kill -KILL "$p" 2>/dev/null; i=0; while kill -0 "$p" 2>/dev/null; do i=$((i+1)); [ "$i" -gt 100 ] && exit 1; sleep 0.1; done; rm -f "$0"' \
    "$1" </dev/null >/dev/null 2>&1
}
step_no=0
# In the container: run the step, record ITS PID (not the shell's), and remove
# the record when the step ends, so no PID file outlives its process.
WRAP='exec 3<&0; "$@" <&3 & p=$!; echo "$p" > "$0"; wait "$p"; rc=$?; rm -f "$0"; exit "$rc"'
# incontainer <cap> <stdin-base64 or ''> <command...>: sets STEP_OUT, returns the step's exit code.
incontainer() {
  local cap=$1 input=$2 pidfile rc
  shift 2
  step_no=$((step_no + 1))
  pidfile="/tmp/v31-activation-$request-$step_no.pid"
  if [ -n "$input" ]; then
    STEP_OUT=$(printf '%s' "$input" | base64 -d | bounded "$cap" docker exec -i "$CONTAINER" sh -c "$WRAP" "$pidfile" "$@")
  else
    STEP_OUT=$(bounded "$cap" docker exec "$CONTAINER" sh -c "$WRAP" "$pidfile" "$@" </dev/null)
  fi
  rc=$?
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    stage terminate "{\"step\":$step_no}"
    terminate_step "$pidfile" || outcome in-container-step-not-terminated 71
  fi
  return "$rc"
}
fresh_uuid() { cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-F' 'a-f'; }

# Prove all eight workers empty: one reload of the active dataset, which the
# serving gate of every unbound worker turns into the empty store.
clear_all() {
  local attempt=1 id code
  while (( attempt <= CLEAR_ATTEMPTS )); do
    id=$(fresh_uuid)
    [[ $id =~ $uuid ]] || return 1
    incontainer 170 '' node dist/scripts/reloadPublic215Stores.js clear "$id" "$dataset" "$checksum"
    code=$?
    stage clear "$(last_json "$STEP_OUT")"
    [ "$code" -eq 0 ] && return 0
    (( $(remaining) > READINESS_PAUSE + 5 )) || return 1
    attempt=$((attempt + 1))
    sleep "$READINESS_PAUSE"
  done
  return 1
}

# Revoke the binding (the database guarantee), then prove all eight workers
# empty, never past the window (the deadline is not extended).
revert() {
  stage revert "{\"why\":\"$1\"}"
  deadline=$window_end
  incontainer 45 "$container_js" node --input-type=module - revoke "$dataset" "$serving" "$bound_by"
  local code=$?
  stage revoke "$(last_json "$STEP_OUT")"
  [ "$code" -eq 0 ] || outcome rollback-incomplete 72
  clear_all && outcome rolled-back-empty 68
  outcome rollback-incomplete 72
}

# Promoted (or possibly promoted) but never bound: the newly active dataset is
# unbound, so a clear empties every worker, including any still holding the
# dataset the promotion retired.
settle_unbound() {
  deadline=$window_end
  clear_all && outcome "$1" "$2"
  outcome "$3" "$4"
}

# 1. Promotion of exactly the evaluated epoch (or proof it already happened).
#    Until step 2 no engine is bound, so every live worker serves the empty store.
incontainer 60 "$container_js" node --input-type=module - promote "$dataset" "$checksum" "$engine" "$serving"
code=$?
stage promote "$(last_json "$STEP_OUT")"
case "$code" in
  0) ;;
  10) outcome promotion-refused 66 ;;
  *) settle_unbound promotion-outcome-unknown 67 promotion-outcome-unknown-uncleared 73 ;;
esac
unchanged || settle_unbound promoted-unbound 70 rollback-incomplete 72

# 2. Bind exactly this serving commit and its proven closure digest.
incontainer 60 "$container_js" node --input-type=module - bind "$dataset" "$engine" "$serving" "$digest" "$bound_by"
code=$?
stage bind "$(last_json "$STEP_OUT")"
case "$code" in
  0) ;;
  10) settle_unbound promoted-unbound 70 rollback-incomplete 72 ;;
  *) revert bind-outcome-unknown ;;
esac
unchanged || revert serving-identity-changed

# 3. One explicit eight-worker load of the active, bound dataset.
incontainer 170 '' node dist/scripts/reloadPublic215Stores.js reload "$request" "$dataset" "$checksum"
code=$?
stage load "$(last_json "$STEP_OUT")"
[ "$code" -eq 0 ] || revert load-incomplete
unchanged || revert serving-identity-changed

# 4. A fresh eight-worker status read of the same request identity.
incontainer 60 '' node dist/scripts/reloadPublic215Stores.js status "$request" "$dataset" "$checksum"
code=$?
stage status "$(last_json "$STEP_OUT")"
[ "$code" -eq 0 ] || revert status-unconfirmed

# 5. Natural readiness: each worker made an accepted decision with the store loaded.
#    All eight workers are proven on the same dataset; readiness only lacks traffic.
attempt=1
while :; do
  incontainer 45 "$ready_js" node --input-type=module - "$ready_request"
  code=$?
  stage readiness "$(last_json "$STEP_OUT")"
  if [ "$code" -ne 2 ] || [ "$attempt" -ge "$READINESS_ATTEMPTS" ]; then break; fi
  if (( $(remaining) <= READINESS_PAUSE + 5 )); then break; fi
  attempt=$((attempt + 1))
  sleep "$READINESS_PAUSE"
done
unchanged || revert serving-identity-changed
[ "$code" -eq 0 ] || outcome promoted-loaded-readiness-unproved 69
outcome promoted-loaded-ready 0
