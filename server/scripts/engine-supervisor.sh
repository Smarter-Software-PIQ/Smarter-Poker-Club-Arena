#!/usr/bin/env bash
#
# engine-supervisor.sh - one-shot restoration of the exact sealed desired
# engine release.
#
# The filename is part of the frozen release-v1 generation contract, but this
# is not a supervisor, timer, watchdog, or background reconciler anymore. It is
# invoked synchronously only by the release transaction or its ExecStopPost
# recovery while that caller owns the engine mutation lock. Docker's
# `--restart always` policy owns crash/daemon/host restart. A manual stop stays
# intentional instead of being silently reversed by a periodic mutation.
#
set -euo pipefail

CONTAINER="${CONTAINER:-club-arena-engine}"
PORT="${PORT:-8080}"
CONTROL_DIR="${ENGINE_CONTROL_DIR:-/usr/local/lib/club-arena/engine-control}"
UP_SCRIPT="${UP_SCRIPT:-$CONTROL_DIR/engine-up.sh}"
RELEASE_SEAL="${ENGINE_RELEASE_SEAL:-$CONTROL_DIR/engine-release-seal.py}"
AUTOHEAL_CONTAINER="${AUTOHEAL_CONTAINER:-sp-autoheal}"
PUBLIC_URL="${ENGINE_URL:-https://engine.smarter.poker}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-15}"
RECOVERY_DEADLINE_EPOCH="${ENGINE_RECOVERY_DEADLINE_EPOCH:-0}"

log() {
  echo "[engine-supervisor] $*"
  logger -t engine-supervisor -- "$*" 2>/dev/null || true
}

die() {
  log "FATAL: $*"
  exit 1
}

# There is deliberately no autonomous mode. Every mutation must belong to the
# already-running release transaction and its absolute recovery deadline.
[ "$#" = 0 ] || die 'this one-shot recovery accepts no positional arguments'
[ "${ENGINE_SUPERVISOR_FORCE_DESIRED:-0}" = 1 ] \
  && [ "${ENGINE_SUPERVISOR_REQUIRE_EXACT_HEALTH:-0}" = 1 ] \
  && [ "${ENGINE_SUPERVISOR_LOCK_HELD:-0}" = 1 ] \
  || die 'one-shot recovery requires force-desired, exact-health, and caller-held-lock authority'
[[ "$RECOVERY_DEADLINE_EPOCH" =~ ^[1-9][0-9]*$ ]] \
  || die 'one-shot recovery requires an absolute deadline'

recovery_remaining() {
  local remaining=$((RECOVERY_DEADLINE_EPOCH - $(date +%s)))
  [ "$remaining" -gt 1 ] || return 1
  printf '%s\n' "$remaining"
}

bounded_recovery_command() {
  local requested="$1" remaining allowed
  shift
  remaining="$(recovery_remaining)" || return 124
  allowed=$((remaining - 1))
  [ "$requested" -le "$allowed" ] || requested="$allowed"
  [ "$requested" -gt 0 ] || return 124
  timeout --signal=TERM --kill-after=1s "${requested}s" "$@"
}

recovery_remaining >/dev/null \
  || die 'one-shot recovery deadline has already expired'
bounded_recovery_command 10 docker info >/dev/null 2>&1 \
  || die 'Docker is unavailable during exact desired recovery'
[ -x "$RELEASE_SEAL" ] \
  || die "release seal controller is missing or not executable: $RELEASE_SEAL"
[ -x "$UP_SCRIPT" ] \
  || die "canonical engine-up script is missing or not executable: $UP_SCRIPT"

DESIRED_SHA="$(bounded_recovery_command 10 "$RELEASE_SEAL" get desired-sha)" \
  || die 'durable desired release SHA is unreadable'
DESIRED_IMAGE_ID="$(bounded_recovery_command 10 "$RELEASE_SEAL" get desired-image-id)" \
  || die 'durable desired image ID is unreadable'
DESIRED_LEGACY_UNLABELLED="$(bounded_recovery_command 10 "$RELEASE_SEAL" get desired-legacy-unlabelled)" \
  || die 'durable legacy-bootstrap state is unreadable'
[[ "$DESIRED_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || die 'durable desired release SHA is invalid'
[[ "$DESIRED_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || die 'durable desired image ID is invalid'
case "$DESIRED_LEGACY_UNLABELLED" in
  true|false) ;;
  *) die 'durable legacy-bootstrap state is invalid' ;;
esac
bounded_recovery_command 10 docker image inspect "$DESIRED_IMAGE_ID" >/dev/null 2>&1 \
  || die "sealed desired image $DESIRED_IMAGE_ID ($DESIRED_SHA) is absent"
DESIRED_IMAGE_SOURCE="$(bounded_recovery_command 10 docker image inspect \
  --format '{{json .Config.Env}}' "$DESIRED_IMAGE_ID" | python3 -c '
import json,re,sys
entries=json.load(sys.stdin)
if not isinstance(entries,list): raise SystemExit(1)
values=[v.split("=",1)[1] for v in entries if isinstance(v,str) and v.startswith("GIT_COMMIT_SHA=")]
if len(values)!=1 or not re.fullmatch(r"[0-9a-f]{40}",values[0]): raise SystemExit(1)
print(values[0])
')" || die 'sealed desired image has no unique full source identity'
[ "$DESIRED_IMAGE_SOURCE" = "$DESIRED_SHA" ] \
  || die 'sealed desired image source differs from its durable seal'

ensure_autoheal_running() {
  local before container_id status
  before="$(bounded_recovery_command 5 docker container inspect -f '{{.Id}} {{.State.Status}}' "$AUTOHEAL_CONTAINER")" || return 1
  container_id="${before%% *}"
  status="${before#* }"
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  [ "$status" = running ] && return 0
  log "$AUTOHEAL_CONTAINER is '$status' during exact desired recovery - starting it"
  bounded_recovery_command 10 docker start "$container_id" >/dev/null 2>&1 \
    || log 'autoheal start response uncertain; checking original container'
  [ "$(bounded_recovery_command 5 docker container inspect -f '{{.Id}} {{.State.Status}}' "$AUTOHEAL_CONTAINER")" = "$container_id running" ]
}

recreate() {
  local budget
  budget="$(recovery_remaining)" || return 1
  log "restoring exact sealed desired release $DESIRED_SHA"
  bounded_recovery_command "$budget" env \
    ENGINE_UP_LOCK_HELD=1 \
    ENGINE_CONTROL_DIR="$CONTROL_DIR" \
    ENGINE_UP_CERTIFIED_RETIREMENT="${CERTIFIED_RETIREMENT_JSON:-}" \
    CONTAINER="$CONTAINER" IMAGE="$DESIRED_IMAGE_ID" PORT="$PORT" \
    "$UP_SCRIPT" \
    || return 1
  ensure_autoheal_running
}

# A completed original-custody checkpoint can retire MaintenanceBreak while
# its process still answers health. Only its durable, incarnation-bound native
# marker permits reconstruction of that otherwise healthy sealed process.
# The earlier one-shot intent alone never proves that custody was retained.
certified_retirement_witness() {
  local run="${ENGINE_CHECKPOINT_RECOVERY_RUN_ID:-}" current expectation
  [ -n "$run" ] || { printf 'none\n'; return; }
  [[ "$run" =~ ^[1-9][0-9]*(-[1-9][0-9]*)?$ ]] || return 1
  expectation="$(bounded_recovery_command 5 python3 - "$run" \
    "${ENGINE_RELEASE_REQUEST_ROOT:-/var/lib/club-arena/engine-release-requests}" \
    "$CONTROL_DIR" <<'CERTIFIED_EXPECTATION'
import datetime, json, os, re, stat, sys
run, root, control = sys.argv[1:]
def sibling_intent_link(path, s):
    # The v1 protocol publishes <run>.request as a hard link of its immutable
    # <run>.intent (launch, unit wrapper and intake all use ln). Exactly that
    # one second name is the request itself, never a foreign alias: same
    # inode, same root-owned private directory, and nlink 2 counts both names.
    head, name = os.path.split(path)
    if os.path.abspath(head) != os.path.abspath(root) or not name.endswith('.request'):
        return False
    dfd = os.open(head, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        d = os.fstat(dfd)
        if not stat.S_ISDIR(d.st_mode) or d.st_uid != 0 or d.st_mode & 0o077:
            return False
        try:
            ifd = os.open(name[:-len('.request')] + '.intent', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dfd)
        except FileNotFoundError:
            return False
        try:
            i = os.fstat(ifd)
        finally:
            os.close(ifd)
    finally:
        os.close(dfd)
    return (stat.S_ISREG(i.st_mode) and i.st_uid == 0 and (i.st_dev, i.st_ino) == (s.st_dev, s.st_ino)
            and i.st_nlink == 2 and s.st_nlink == 2)
def read_private(path, private=True):
    if os.path.realpath(path) != os.path.abspath(path):
        raise ValueError('retirement source path is indirect')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        if (not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_size > 131072 or s.st_mode & (0o077 if private else 0o022)
                or not (s.st_nlink == 1 or (private and sibling_intent_link(path, s)))):
            raise ValueError('retirement source file is unsafe')
        return os.read(fd, 131073).decode()
    finally:
        os.close(fd)
def require(value):
    if not value: raise ValueError('certified retirement binding refused')
def millis(value):
    require(isinstance(value, str))
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None)
    return round(parsed.timestamp() * 1000)
request = read_private(os.path.join(root, run + '.request')).splitlines()
require(len(request) == 6 and request[3] == control and re.fullmatch('[0-9a-f]{40}', request[0])
        and re.fullmatch('[0-9a-f]{40}', request[4])
        and read_private(os.path.join(control, 'control-sha'), False).strip() == request[4])
try:
    intent = json.loads(read_private(os.path.join(root, run + '.legacy-checkpoint-intent')))
except FileNotFoundError:
    print('none'); sys.exit(0)
proof = intent.get('certifiedRecovery')
if proof is None:
    print('none'); sys.exit(0)
profile = {'id': 'eed-240s-certified-release-v1', 'noticeMs': 120000, 'freezeMs': 780000,
           'nativeQueryMs': 240000, 'checkpointMs': 320000, 'postReserveMs': 205000}
require(isinstance(proof, dict) and proof.get('schema') == 'engine-certified-recovery/v1'
        and proof.get('profile') == profile
        and proof.get('policyId') == '2026-11-04-tournament-fourfold-certified-recovery')
p = proof.get('request')
require(isinstance(p, dict) and p.get('runKey') == run and p.get('targetSha') == request[0]
        and p.get('controlSha') == request[4] and p.get('policyId') == proof['policyId']
        and p.get('predecessorSha') == intent.get('source') == 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
        and p.get('instanceId') == intent.get('instance')
        and intent.get('runId') == run and intent.get('controlSha') == request[4]
        and intent.get('nativeCensus', {}).get('candidateSHA') == request[0]
        and re.fullmatch('[0-9a-f]{64}', str(intent.get('container')))
        and re.fullmatch('sha256:[0-9a-f]{64}', str(intent.get('containerImageId')))
        and type(intent.get('hostPid')) is int and intent['hostPid'] > 1
        and re.fullmatch('[1-9][0-9]*-[0-9a-f]{8}', str(intent.get('instance')))
        and re.fullmatch('[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}', str(p.get('ownershipToken'))))
announced, release = millis(p.get('announcedAt')), millis(proof.get('releaseAt'))
require(release == announced + 900000 and millis(intent.get('startedAt')) < announced)
print(json.dumps({'profile': profile['id'], 'runId': run, 'controlSha': request[4],
 'targetSha': request[0], 'sourceSha': intent['source'], 'instanceId': intent['instance'],
 'containerId': intent['container'], 'containerImageId': intent['containerImageId'], 'containerStartedAt': intent['startedAt'],
 'hostPid': intent['hostPid'], 'pid': 1, 'announcedAt': announced,
 'ownershipToken': p['ownershipToken'], 'releaseAt': release}, separators=(',', ':')))
CERTIFIED_EXPECTATION
  )" || return 1
  [ "$expectation" != none ] || { printf 'none\n'; return; }
  if ! current="$(bounded_recovery_command 5 docker container inspect -f \
    '{"containerId":{{json .Id}},"containerImageId":{{json .Image}},"containerStartedAt":{{json .State.StartedAt}},"hostPid":{{json .State.Pid}},"running":{{json .State.Running}}}' "$CONTAINER")"; then
    # An inspect error alone is not absence. A successful exact-name census
    # can establish that ordinary sealed-image recovery must create it anew.
    local named
    named="$(bounded_recovery_command 5 docker container ls -a --no-trunc \
      --filter "name=^/${CONTAINER}$" --format '{{.ID}}')" || return 1
    [ -z "$named" ] || return 1
    printf 'successor\n'; return
  fi
  local disposition
  disposition="$(bounded_recovery_command 5 python3 - "$expectation" "$current" "$DESIRED_SHA" "$DESIRED_IMAGE_ID" <<'CERTIFIED_INCARNATION'
import datetime, json, re, sys
expected, current = map(json.loads, sys.argv[1:3])
if not (isinstance(current, dict) and set(current) == {'containerId','containerImageId','containerStartedAt','hostPid','running'}
    and re.fullmatch('[0-9a-f]{64}', str(current.get('containerId')))
    and re.fullmatch('sha256:[0-9a-f]{64}', str(current.get('containerImageId')))
    and isinstance(current.get('containerStartedAt'), str)
    and datetime.datetime.fromisoformat(current['containerStartedAt'].replace('Z', '+00:00')).tzinfo is not None
    and type(current.get('hostPid')) is int and current['hostPid'] >= 0
    and type(current.get('running')) is bool):
    raise SystemExit('certified current incarnation is unreadable')
if any(current.get(k) != expected[k] for k in ('containerId', 'containerStartedAt', 'hostPid')):
    print('successor')
elif current.get('running') is True and current.get('containerImageId') == expected['containerImageId'] == sys.argv[4] and expected['sourceSha'] == sys.argv[3]:
    print('original')
else:
    raise SystemExit('certified original runtime identity refused')
CERTIFIED_INCARNATION
  )" || return 1
  [ "$disposition" = original ] || { printf 'successor\n'; return; }
  bounded_recovery_command 8 docker exec "$CONTAINER" env -u NODE_OPTIONS -u NODE_PATH node --no-inspect -e '
const fs=require("node:fs"), expected=JSON.parse(process.argv[1]);
const fail=()=>{throw Error("certified retirement native witness refused")};
if(!/^[1-9][0-9]*(-[1-9][0-9]*)?$/.test(expected.runId))fail();
const path="/app/.legacy-certified-retirement-"+expected.runId+".json";
const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
let marker;
try {
 const s=fs.fstatSync(fd);
 if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>16384)fail();
 marker=JSON.parse(fs.readFileSync(fd,"utf8"));
} finally {fs.closeSync(fd)}
const keys=[...Object.keys(expected),"schema","nativeStartTicks","stage","attemptedTables","verifiedTables","finalCensusZero","maintenanceGeneration","resumeToken"].sort();
if(!marker||JSON.stringify(Object.keys(marker).sort())!==JSON.stringify(keys))fail();
for(const [k,v] of Object.entries(expected))if(marker[k]!==v)fail();
if(marker.schema!=="legacy-certified-retirement/v1"||marker.stage!=="custody_complete_stop_entering"||marker.finalCensusZero!==true)fail();
for(const k of ["attemptedTables","verifiedTables","maintenanceGeneration","resumeToken"])
 if(!Number.isSafeInteger(marker[k])||marker[k]<0)fail();
if(marker.attemptedTables!==marker.verifiedTables||!/^[1-9][0-9]*$/.test(marker.nativeStartTicks))fail();
const proc=fs.readFileSync("/proc/1/stat","utf8");
const ticks=proc.slice(proc.lastIndexOf(")")+2).trim().split(/\s+/)[19];
if(ticks!==marker.nativeStartTicks)fail();
process.stdout.write(JSON.stringify({...expected,nativeStartTicks:ticks}));
' "$expectation"
}

recreate_or_die() {
  recreate || die 'exact sealed desired release could not be restored'
}

health_identity() {
  local url="$1" response http_code body instance remaining curl_timeout
  remaining="$(recovery_remaining)" || return 1
  curl_timeout=$((remaining - 1))
  [ "$curl_timeout" -le "$HEALTH_TIMEOUT_SEC" ] || curl_timeout="$HEALTH_TIMEOUT_SEC"
  [ "$curl_timeout" -gt 0 ] || return 1
  # Recovery proves the already-sealed process, not a new candidate. A defect
  # in an optional subsystem can make that exact live source answer 503; the
  # release that fixes it must still be able to replace it, and a failed trial
  # must still be able to restore it. Accept only complete 200/503 responses.
  # New candidates and every publication proof remain strict routing-ready 200.
  response="$(curl -sS --max-time "$curl_timeout" \
    -H 'Cache-Control: no-cache, no-store' --write-out $'\n%{http_code}' \
    "$url" 2>/dev/null)" || return 1
  http_code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  case "$http_code" in
    200|503) ;;
    *) return 1 ;;
  esac
  # A SEALED RELEASE IS PROVED WITH WHAT IT PUBLISHES (2026-09-11).
  #
  # `releaseSha` arrived with server/src/releaseIdentity.ts. The release it
  # shipped in could not deploy, because THIS function was asked to restore
  # the release already running - which predates the field - and refused it.
  # Every engine release from 15:37 UTC onward died at "sealed desired runtime
  # could not be restored before release work" while the engine on the box was
  # healthy, exact and serving. Four merges' worth of engine fixes sat on main
  # with no way onto the floor, and the loop is self-sustaining: the build that
  # would publish the field is the build that cannot ship.
  #
  # So an older sealed release proves itself with `version`, which is the first
  # eight characters of the same commit and is set by the same build. This is
  # not a weaker proof by accident: the container is separately proved to carry
  # the exact image id AND the exact `sp.release.sha` label before this is even
  # called, and the fallback is accepted ONLY when `releaseSha` is absent
  # entirely. A release that publishes the field must still match it exactly,
  # so a mismatched new build can never take the short road.
  #
  # RECOVERY ONLY. Every new-candidate and publication proof - in
  # engine-release-transaction.sh, observe-engine-release.sh and the workflow -
  # keeps the strict form, because a candidate is by definition built from
  # source that has the field.
  instance="$(printf '%s' "$body" | EXPECTED_SHA="$DESIRED_SHA" python3 -c '
import json, os, re, sys
d=json.load(sys.stdin)
instance=d.get("instanceId")
expected=os.environ["EXPECTED_SHA"]
sha=d.get("releaseSha")
identity=(sha==expected) or ("releaseSha" not in d and d.get("version")==expected[:8])
ok=(d.get("running") is True and identity and d.get("liveness")=="ok" and isinstance(instance,str) and re.fullmatch(r"[1-9][0-9]*-[0-9a-f]{8}",instance))
if not ok: raise SystemExit(1)
print(instance)
' 2>/dev/null)" || return 1
  printf '%s\n' "$instance"
}

prove_exact_desired_recovery() {
  local local_instance public_instance state image_id release_label autoheal_label role_label restart_policy
  local poll_remaining poll_pause
  while recovery_remaining >/dev/null; do
    state="$(bounded_recovery_command 5 docker container inspect \
      -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)"
    image_id="$(bounded_recovery_command 5 docker container inspect \
      -f '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
    release_label="$(bounded_recovery_command 5 docker container inspect \
      -f '{{index .Config.Labels "sp.release.sha"}}' "$CONTAINER" 2>/dev/null || true)"
    autoheal_label="$(bounded_recovery_command 5 docker container inspect \
      -f '{{index .Config.Labels "autoheal"}}' "$CONTAINER" 2>/dev/null || true)"
    role_label="$(bounded_recovery_command 5 docker container inspect \
      -f '{{index .Config.Labels "sp.role"}}' "$CONTAINER" 2>/dev/null || true)"
    restart_policy="$(bounded_recovery_command 5 docker container inspect \
      -f '{{.HostConfig.RestartPolicy.Name}}' "$CONTAINER" 2>/dev/null || true)"
    if [ "$state" = running ] \
      && [ "$image_id" = "$DESIRED_IMAGE_ID" ] \
      && { [ "$release_label" = "$DESIRED_SHA" ] \
        || { [ "$DESIRED_LEGACY_UNLABELLED" = true ] && [ -z "$release_label" ]; }; } \
      && [ "$autoheal_label" = true ] \
      && [ "$role_label" = engine ] \
      && [ "$restart_policy" = always ]; then
      local_instance="$(health_identity "http://127.0.0.1:${PORT}/health")" \
        || local_instance=''
      if [ -n "$local_instance" ]; then
        public_instance="$(health_identity "$PUBLIC_URL/health?nocache=$(date +%s%N)")" \
          || public_instance=''
        if [ "$public_instance" = "$local_instance" ]; then
          log "exact desired release $DESIRED_SHA is live and exact locally and publicly as $local_instance"
          return 0
        fi
      fi
    fi
    # THE POLL IS A SLEEP, NOT A RACE AGAINST ITS OWN TIMEOUT (2026-10-19).
    # This was a five-second sleep inside a five-second bounded command, i.e.
    # `timeout 5s sleep 5`. timeout's clock starts before sleep's does, so it
    # fires first and returns 124 every time (measured on engine-01: 3 of 3).
    # The loop therefore gave up after ONE probe: a desired engine that was
    # not healthy at the first look was declared failed five seconds after it
    # started (11:57:07 -> 11:57:12 and 12:57:57 -> 12:58:02 UTC on
    # 2026-10-19), while it went live a second or a minute later. The pause
    # is bounded by the deadline arithmetic itself, so it needs no timeout.
    poll_remaining="$(recovery_remaining)" || break
    poll_pause=$((poll_remaining - 1))
    [ "$poll_pause" -le 5 ] || poll_pause=5
    [ "$poll_pause" -gt 0 ] || break
    sleep "$poll_pause"
  done
  log "FATAL: exact desired release $DESIRED_SHA did not become live and exact locally and publicly before the recovery deadline"
  return 1
}

RUNNING_IMAGE_ID="$(bounded_recovery_command 5 docker container inspect \
  -f '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
RUNNING_STATUS="$(bounded_recovery_command 5 docker container inspect \
  -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)"
RUNNING_RELEASE="$(bounded_recovery_command 5 docker container inspect \
  -f '{{index .Config.Labels "sp.release.sha"}}' "$CONTAINER" 2>/dev/null || true)"
RUNNING_AUTOHEAL_LABEL="$(bounded_recovery_command 5 docker container inspect \
  -f '{{index .Config.Labels "autoheal"}}' "$CONTAINER" 2>/dev/null || true)"
RUNNING_ROLE_LABEL="$(bounded_recovery_command 5 docker container inspect \
  -f '{{index .Config.Labels "sp.role"}}' "$CONTAINER" 2>/dev/null || true)"

CERTIFIED_RETIREMENT_JSON="$(certified_retirement_witness)" \
  || die 'certified original custody or retirement incarnation is unknown; preserving the process'
case "$CERTIFIED_RETIREMENT_JSON" in none|successor) CERTIFIED_RETIREMENT_JSON='' ;; esac

if [ -n "$CERTIFIED_RETIREMENT_JSON" ]; then
  log 'reconstructing the exact original incarnation after its durable certified custody checkpoint'
  recreate_or_die
elif [ "$RUNNING_IMAGE_ID" != "$DESIRED_IMAGE_ID" ] \
  || [ "$RUNNING_AUTOHEAL_LABEL" != true ] \
  || [ "$RUNNING_ROLE_LABEL" != engine ] \
  || { [ "$RUNNING_RELEASE" != "$DESIRED_SHA" ] \
    && { [ "$DESIRED_LEGACY_UNLABELLED" != true ] || [ -n "$RUNNING_RELEASE" ]; }; }; then
  log "force-desired recovery is evicting every unsealed runtime and restoring sealed $DESIRED_SHA"
  recreate_or_die
else
  case "$RUNNING_STATUS" in
    running) ;;
    paused)
      bounded_recovery_command 10 docker unpause "$CONTAINER" >/dev/null \
        || recreate_or_die
      ;;
    created|exited)
      bounded_recovery_command 20 docker start "$CONTAINER" >/dev/null \
        || recreate_or_die
      ;;
    *) recreate_or_die ;;
  esac
fi

RUNNING_RESTART_POLICY="$(bounded_recovery_command 5 docker container inspect \
  -f '{{.HostConfig.RestartPolicy.Name}}' "$CONTAINER" 2>/dev/null || true)"
if [ "$RUNNING_RESTART_POLICY" != always ]; then
  bounded_recovery_command 10 docker update --restart always "$CONTAINER" >/dev/null \
    || die 'could not arm sealed desired restart policy'
fi
ensure_autoheal_running \
  || die "exact desired recovery could not start $AUTOHEAL_CONTAINER"
prove_exact_desired_recovery \
  || exit 1
