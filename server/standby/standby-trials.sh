# Backup Engine trials (owner order 2026-11-06): every simulation needed to
# validate an engine change in real time, run only on the Backup Engine host
# against its isolated database. Sourced by standby-engine.sh; never reaches
# the live engine. Each trial prints one JSON verdict line and returns 0 on
# pass.
#
#   trial swap <from_sha> <to_sha>   the 4 AM cutover rehearsed: <from> serves
#                                    and deals, a real maintenance break
#                                    freezes and parks every table, <from> is
#                                    stopped at the freeze, <to> boots, thaws
#                                    and deals again; every seat must be
#                                    exactly where it was.
#   trial table-kill <sha> [n]       kill n live table engines (fault
#                                    injection, horse-only tables); each must
#                                    recover and keep dealing.
#   trial break <sha>                one full maintenance break on <sha>:
#                                    announce, park, freeze, thaw, deal again.
#   trial all <from_sha> <to_sha>    swap, then table-kill and break on <to>.
#   trial regression-replay <sha>    the day's incidents replayed against the
#                                    candidate's source and the copy (below);
#                                    also run by every certification.

engine_key() { docker exec "$CONTAINER" printenv INTERNAL_API_KEY; }
fault_token() { docker exec "$CONTAINER" printenv FAULT_INJECTION_TOKEN; }
seat_fingerprint() {
  psql_db -Atc "select md5(coalesce(string_agg(table_id::text||':'||seat_number::text||':'||user_id::text, ',' order by table_id, seat_number), '')) from public.table_seats where left_at is null"
}
seat_count() { psql_db -Atc "select count(*) from public.table_seats where left_at is null"; }
frozen() { psql_db -Atc "select coalesce(public.fn_platform_frozen(), false)" 2>/dev/null | grep -qx t; }
# One MVCC statement binds identities to the actual protected window. No locks
# are held across samples: the trial observes the engine's real freeze.
frozen_seat_snapshot() {
  local boundary="${1:-}"; [ -n "$boundary" ] || boundary='{}'
  psql_db -At -v boundary="$boundary" -v candidate="${2:-}" <<'SQL_SEAT_SNAPSHOT'
WITH admitted AS (SELECT :'boundary'::jsonb j),
observation AS MATERIALIZED (SELECT clock_timestamp() started),
state AS MATERIALIZED (SELECT started, public.fn_platform_frozen() frozen FROM observation),
authority AS MATERIALIZED (SELECT state.*, public.fn_active_maintenance_release_boundary() active_release FROM state)
SELECT json_build_object(
    'frozen', authority.frozen, 'observationStartedAt', authority.started, 'observedAt', clock_timestamp(),
    'evidenceKind', CASE WHEN b.id IS NOT NULL THEN 'active' WHEN t.ownership_token IS NOT NULL THEN 'certified_tail' ELSE 'absent' END,
    'activeReleaseAt', authority.active_release,
    'token', COALESCE(b.ownership_token,t.ownership_token),
    'declaredBy', COALESCE(b.declared_by,t.thawed_by),
    'phase', b.phase, 'announcedAt', COALESCE(b.announced_at,t.announced_at), 'reason', b.reason,
    'startedAt', COALESCE(b.break_started_at,t.freeze_started_at),
    'releaseAt', COALESCE(b.break_ends_at,t.release_target_at),
    'tailContractVersion', t.contract_version, 'tailComplete', t.shifted->'complete',
    'tailRequiredSteps', t.shifted ?& ARRAY[
      'sit_out_at','hold_expires_at','addon_period_ends_at','reversible_until',
      'reveal_deadline_at','rebuy_prompt_until','bomb_pot_next_due_at',
      'cash_stay_last_tick_at','cash_rejoin_expires_at','level_started_at',
      'cluster_break_eligible_since','cluster_move_expires_at',
      'reconnect_presence','reconnect_snapshots'],
    'count', s.n, 'fingerprint', s.fingerprint)
FROM (SELECT count(*) n, md5(coalesce(string_agg(
      jsonb_build_array(table_id,seat_number,user_id,stack)::text,
      ',' ORDER BY table_id,seat_number,user_id),'')) fingerprint
      FROM public.table_seats WHERE left_at IS NULL) s
CROSS JOIN admitted CROSS JOIN authority
LEFT JOIN public.engine_maintenance_break b ON b.id=true
LEFT JOIN public.engine_maintenance_thaws t
  ON b.id IS NULL AND t.freeze_started_at=(j->>'startedAt')::timestamptz
 AND (
   (:'candidate'='' AND t.ownership_token=(j->>'token')::uuid)
   OR (:'candidate' ~ '^[0-9a-f]{8}$' AND t.thawed_by=:'candidate'
       AND t.ownership_token<>(j->>'token')::uuid
       AND t.announced_at=(j->>'announcedAt')::timestamptz
       AND t.release_target_at=(j->>'releaseAt')::timestamptz)
 );
SQL_SEAT_SNAPSHOT
}

frozen_seat_state() { # snapshot, original (or empty), frozen|poll|adopt, candidate version
  python3 - "$1" "${2:-}" "${3:-frozen}" "${4:-}" <<'PY_SEATS'
import datetime, json, re, sys, uuid
def require(value, reason):
    if not value: raise ValueError(reason)
def instant(value):
    result = datetime.datetime.fromisoformat(value)
    require(result.tzinfo is not None, 'timestamp_has_no_timezone')
    return result
try:
    current = json.loads(sys.argv[1])
    original = json.loads(sys.argv[2]) if sys.argv[2] else None
    require(type(current['frozen']) is bool, 'freeze_predicate_unknown')
    require(type(current['count']) is int and current['count'] >= 0, 'seat_count_invalid')
    require(re.fullmatch('[0-9a-f]{32}', current['fingerprint']), 'fingerprint_invalid')
    observed = instant(current['observedAt'])
    observation_started = instant(current['observationStartedAt'])
    require(observation_started <= observed, 'observation_clock_reversed')
    if not current['frozen']:
        require(sys.argv[3] == 'poll', 'freeze_unavailable')
        if original:
            require(observed >= instant(original['releaseAt']), 'unfrozen_before_admitted_release')
        print('thawed')
    else:
        uuid.UUID(current['token'])
        tail = current['evidenceKind'] == 'certified_tail'
        if tail:
            require(original is not None and sys.argv[3] in ('poll', 'adopt'), 'tail_without_admitted_owner')
            require(current['tailContractVersion'] == 3 and current['tailComplete'] is True
                    and current['tailRequiredSteps'] is True, 'tail_certificate_incomplete')
            release = instant(original['releaseAt'])
            active_release = current['activeReleaseAt']
            # Both real predicates use clock_timestamp(). A statement can straddle
            # release: true freeze, then no active certificate. Accept only this
            # measured crossing, never a foreign non-null boundary or early clear.
            if active_release is None:
                require(observation_started <= release <= observed, 'release_certificate_unavailable')
            else:
                require(instant(active_release) == release, 'foreign_release_boundary')
        else:
            require(current['evidenceKind'] == 'active' and current['phase'] == 'counting_down', 'active_freeze_row_unavailable')
            require(isinstance(current['reason'], str), 'break_reason_invalid')
        require(isinstance(current['declaredBy'], str), 'declared_owner_invalid')
        instant(current['announcedAt'])
        require(instant(current['releaseAt']) > instant(current['startedAt']), 'invalid_freeze_interval')
        if original:
            require(original['frozen'] is True, 'original_freeze_unproved')
            if sys.argv[3] == 'adopt':
                require(re.fullmatch('[0-9a-f]{8}', sys.argv[4]), 'candidate_version_invalid')
                require(current['declaredBy'] == sys.argv[4], 'candidate_owner_mismatch')
                require(current['token'] != original['token'], 'adoption_did_not_rotate_owner')
            else:
                require(current['token'] == original['token'], 'owner_token_changed')
                require(current['declaredBy'] == original['declaredBy'], 'declared_owner_changed')
            keys = ('announcedAt', 'startedAt', 'releaseAt', 'count', 'fingerprint')
            if not tail: keys += ('phase', 'reason')
            for key in keys:
                require(current[key] == original[key], 'boundary_changed:' + key)
        print('frozen')
except (ValueError, KeyError, TypeError, AssertionError, AttributeError) as error:
    sys.exit('frozen_seat_boundary:' + str(error))

PY_SEATS
}

record_seat_rejection() {
  [ "${FROZEN_SEATS_REJECTION:-null}" = null ] || return 0
  FROZEN_SEATS_REJECTION=$(python3 - "$1" "$2" <<'PY_REJECT'
import json, sys
try: observation = json.loads(sys.argv[1])
except ValueError: observation = {"unreadable": sys.argv[1][:2000]}
print(json.dumps(dict(observation=observation, reason=sys.argv[2][:2000])))
PY_REJECT
  )
}

# THE SEAT BOUNDARY IS TAKEN AFTER THE SERVING ENGINE HAS DRAINED (2026-11-08).
# The freeze refuses player money and seat writes, but the engine's service
# role still settles a hand that was already in the air when it began: that is
# "protect the hand". The release transaction therefore stops the serving
# engine only once its own /health says handsInFlightTotal == 0 and
# maintenance.unparkedTables == 0. This harness used to fix the boundary at
# the first frozen sample instead, so a long horse hand (cash table 55a398dc,
# hand 1000165, dealt 04:23:40, settled 04:26:07 UTC) moved a stack after the
# boundary and failed run 42445553096 with boundary_changed:fingerprint. The
# swap boundary is now the first frozen sample read after the same physical
# drain witness the release transaction demands before it stops an engine.
# Nothing after it is relaxed.
serving_drained() {
  health | python3 -c 'import json,sys
try: h=json.loads(sys.stdin.read() or "{}")
except ValueError: sys.exit(1)
m=h.get("maintenance") if isinstance(h,dict) else None
ok=isinstance(m,dict) and type(h.get("handsInFlightTotal")) is int and h["handsInFlightTotal"]==0 \
   and type(m.get("unparkedTables")) is int and m["unparkedTables"]==0
sys.exit(0 if ok else 1)'
}

capture_frozen_seats() { # absolute bounded deadline [drained]; result in FROZEN_SEATS
  local snapshot state waiting=capture_deadline_expired
  FROZEN_SEATS_REJECTION=null
  while [ "$(date +%s)" -lt "$1" ]; do
    # Drain is read first: a parked engine deals nothing, so the frozen sample
    # that follows cannot be moved by a hand settling behind it.
    if [ "${2:-}" = drained ] && ! serving_drained; then waiting=serving_engine_not_drained; sleep 1; continue; fi
    waiting=capture_deadline_expired
    snapshot=$(frozen_seat_snapshot 2>&1) || { record_seat_rejection "$snapshot" snapshot_read_failed; return 1; }
    state=$(frozen_seat_state "$snapshot" '' poll 2>&1) || { record_seat_rejection "$snapshot" "$state"; return 1; }
    if [ "$state" = frozen ]; then FROZEN_SEATS=$snapshot; return 0; fi
    sleep 1
  done
  record_seat_rejection '{}' "$waiting"
  return 1
}

wait_frozen_seats() { # original, deadline; keep checking until real thaw
  local state current
  FROZEN_SEATS_LAST=$1
  while [ "$(date +%s)" -lt "$2" ]; do
    current=$(frozen_seat_snapshot "$1" 2>&1) || { record_seat_rejection "$current" snapshot_read_failed; return 1; }
    state=$(frozen_seat_state "$current" "$1" poll 2>&1) || { record_seat_rejection "$current" "$state"; return 1; }
    if [ "$state" = thawed ]; then THAW_OBSERVED_AT=$(date +%s); return 0; fi
    FROZEN_SEATS_LAST=$current
    sleep 1
  done
  record_seat_rejection "$FROZEN_SEATS_LAST" thaw_deadline_expired
  return 1
}

frozen_seat_receipt() { # exact v3 release, successful maintenance, no frozen exits
  local result
  result=$(psql_db -At -v boundary="$1" -v version="$2" <<'SQL_SEAT_RECEIPT'
WITH b AS (SELECT :'boundary'::jsonb j)
SELECT EXISTS (
  SELECT 1 FROM b JOIN public.engine_maintenance_thaws t
    ON t.ownership_token=(j->>'token')::uuid
   AND t.freeze_started_at=(j->>'startedAt')::timestamptz
   AND t.release_target_at=(j->>'releaseAt')::timestamptz
   AND t.announced_at=(j->>'announcedAt')::timestamptz
   AND t.contract_version=3 AND t.thawed_by=:'version'
   AND t.shifted->'complete'='true'::jsonb
   AND t.shifted ?& ARRAY[
      'sit_out_at','hold_expires_at','addon_period_ends_at','reversible_until',
      'reveal_deadline_at','rebuy_prompt_until','bomb_pot_next_due_at',
      'cash_stay_last_tick_at','cash_rejoin_expires_at','level_started_at',
      'cluster_break_eligible_since','cluster_move_expires_at',
      'reconnect_presence','reconnect_snapshots']
  JOIN public.engine_maintenance_break_log l
    ON l.break_started_at=t.freeze_started_at
   AND l.break_ended_at>=t.release_target_at AND l.thaw_ok
   AND l.engine_version=:'version'
  WHERE NOT EXISTS (SELECT 1 FROM public.ca_seat_stack_exits e
    WHERE e.occurred_at>=t.freeze_started_at AND e.occurred_at<t.release_target_at)
);
SQL_SEAT_RECEIPT
  ) || return 1
  [ "$result" = t ]
}

# Only the controlled candidate replacement can admit one owner rotation.
# Subsequent observations stay pinned to that admitted successor token.
swap_target_identity() {
  local binding id sha running restarts h
  binding=$(docker inspect -f '{{.Id}} {{index .Config.Labels "com.smarterpoker.standby.sha"}} {{.State.Running}} {{.RestartCount}}' "$CONTAINER") || return 1
  read -r id sha running restarts <<< "$binding"
  [[ "$id" =~ ^[0-9a-f]{64}$ ]] && [ "$sha" = "$1" ] && [ "$running" = true ] || return 1
  [[ "$restarts" =~ ^[0-9]+$ ]] || return 1
  h=$(health) || return 1
  printf '%s' "$h" | python3 -c '
import json, sys
cid, restarts, expected_sha = sys.argv[1], int(sys.argv[2]), sys.argv[3]
try:
    h = json.loads(sys.stdin.read() or "{}")
except ValueError:
    sys.exit(1)
if not isinstance(h, dict):
    sys.exit(1)
if h.get("releaseSha") != expected_sha or h.get("version") != expected_sha[:8]:
    sys.exit(1)
instance = h.get("instanceId")
liveness = h.get("liveness")
if not isinstance(instance, str) or not instance or instance == "null":
    sys.exit(1)
if liveness not in ("ok", "standby"):
    sys.exit(1)
print(json.dumps(dict(containerId=cid, instanceId=instance, restartCount=restarts, releaseSha=expected_sha)))
' "$id" "$restarts" "$1"
}

trial_elapsed() { # Missing observations are unknown, never negative durations.
  if [[ "$1" =~ ^[0-9]+$ && "$2" =~ ^[0-9]+$ ]] && [ "$2" -ge "$1" ]; then
    printf '%s' "$(( $2 - $1 ))"
  else
    printf null
  fi
}

hands_in_window() { health | health_field dealRate.handsInWindow; }
maintenance_field() { health | health_field "maintenance.$1"; }

wait_dealing() {  # wait until the engine reports hands dealt in its window
  local deadline=$(( $(date +%s) + $1 )) n
  while [ "$(date +%s)" -lt "$deadline" ]; do
    n=$(hands_in_window); [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -gt 0 ] && return 0
    sleep 1
  done
  return 1
}

wait_pretrial_dealing() {
  # The old sequential waits allowed 300 seconds for play plus 900 for maintenance.
  local baseline current sha="$1"
  baseline=$(swap_target_identity "$sha") || return 1
  local start now previous eligible=0 was_playing=0 since h parsed phase live db
  start=$(date +%s); previous=$start; since=$((start + 1))
  while :; do
    now=$(date +%s)
    (( now - start < 1200 )) || return 1
    eligible=$((eligible + was_playing * (now - previous)))
    (( eligible < 300 )) || return 1
    previous=$now
    h=$(health) || return 1
    parsed=$(printf '%s' "$h" | python3 -c 'import json,sys
try: d=json.loads(sys.stdin.read() or "{}")
except Exception: d={}
m=d.get("maintenance") if isinstance(d,dict) else None
phase=m.get("phase") if isinstance(m,dict) else None
live=d.get("liveness") if isinstance(d,dict) else None
print((phase or "") + "\t" + (live or ""))') || return 1
    IFS=$'\t' read -r phase live <<< "$parsed"
    case "$live" in ok|standby) ;; *) return 1 ;; esac
    case "$phase" in last_hand|counting_down|pausing|idle) ;; *) return 1 ;; esac
    # A single database snapshot also catches an announcement between health and SQL.
    db=$(psql_db -At -v since="$since" <<'SQL_PRETRIAL'
\set QUIET on
SET statement_timeout='5s';
WITH gate AS MATERIALIZED (SELECT public.fn_platform_frozen() AS frozen)
SELECT CASE
  WHEN frozen IS NULL THEN 'unknown'
  WHEN frozen OR EXISTS (SELECT FROM public.engine_maintenance_break WHERE id)
    THEN 'maintenance'
  WHEN EXISTS (SELECT FROM public.hand_history WHERE created_at > to_timestamp(:'since'::bigint))
    THEN 'hand'
  ELSE 'waiting' END FROM gate;
SQL_PRETRIAL
    ) || return 1
    case "$db" in maintenance|waiting|hand) ;; *) return 1 ;; esac
    if [ "$phase" != idle ] || [ "$db" = maintenance ]; then
      was_playing=0
      since=0
    else
      was_playing=1
      if [ "$since" = 0 ]; then
        # Start a new evidence interval after observing the release.
        since=$((now + 1))
      elif [ "$db" = hand ]; then
        # The original SQL proves a new committed hand after open play began.
        # Older serving engines publish no fleet metric below three tables;
        # that statistical denominator must not invalidate a real hand during
        # the exact predecessor's rollback rehearsal. Keep runtime identity,
        # health, maintenance and both time budgets as independent guards.
        current=$(swap_target_identity "$sha") || return 1
        [ "$current" = "$baseline" ] || return 1
        now=$(date +%s)
        (( now - start < 1200 && eligible + now - previous < 300 ))
        return
      fi
    fi
    sleep 1
  done
}

request_break() {  # a real recovery-window break, requested from inside the container
  docker exec "$CONTAINER" node -e '
    fetch("http://127.0.0.1:8080/internal/maintenance-recovery-window", {method: "POST",
      headers: {authorization: "Bearer " + process.env.INTERNAL_API_KEY, "content-type": "application/json"},
      body: JSON.stringify({announcedAt: Date.now(), cause: "urgent"})})
    .then(async r => { console.log(r.status, (await r.text()).slice(0, 300)); process.exit(r.ok ? 0 : 1); })
    .catch(e => { console.log("error", String(e)); process.exit(1); })'
}

trial_verdict() {  # name verdict json-fields...
  local name="$1" verdict="$2"; shift 2
  local line; line=$(printf '{"trial":"%s","verdict":"%s","at":"%s"%s}' "$name" "$verdict" "$(date -u +%FT%TZ)" "$*")
  echo "$line" | tee -a "$STATE_DIR/trials.jsonl" || return 1
  [ "$verdict" = pass ]
}

trial_break() {
  local sha="$1" t0 frozen_at thaw_at resumed reasons=""
  valid_sha "$sha"
  [ "$(docker inspect -f '{{index .Config.Labels "com.smarterpoker.standby.sha"}}' "$CONTAINER" 2>/dev/null)" = "$sha" ] || cmd_run "$sha" || return 1
  wait_live 600 >/dev/null || { trial_verdict break fail ',"reason":"never_live"'; return 1; }
  wait_pretrial_dealing "$sha" || { trial_verdict break fail ',"reason":"never_dealt_before_break"'; return 1; }
  local seats_before
  t0=$(date +%s)
  request_break >/dev/null || { trial_verdict break fail ',"reason":"break_request_refused"'; return 1; }
  # announcement, last hand, park, freeze
  capture_frozen_seats "$((t0 + 600))" || { trial_verdict break fail ",\"reason\":\"frozen_seat_capture_failed\",\"rejectedSeatObservation\":$FROZEN_SEATS_REJECTION"; return 1; }
  seats_before=$FROZEN_SEATS; frozen_at=$(date +%s)
  local unparked; unparked=$(maintenance_field unparkedTables)
  # thaw
  wait_frozen_seats "$seats_before" "$((t0 + 1200))" && thaw_at=$THAW_OBSERVED_AT \
    || reasons="$reasons,frozen_seat_boundary_failed"
  wait_dealing 300 && resumed=1 || { resumed=0; reasons="$reasons,did_not_deal_after_thaw"; }
  frozen_seat_receipt "$seats_before" "${sha:0:8}" || reasons="$reasons,frozen_seat_receipt_failed"
  local v=pass; [ -z "$reasons" ] || v=fail
  trial_verdict break "$v" ",\"sha\":\"$sha\",\"secondsToFreeze\":$(trial_elapsed "$t0" "${frozen_at:-}"),\"secondsFrozen\":$(trial_elapsed "${frozen_at:-}" "${thaw_at:-}"),\"unparkedAtFreeze\":\"${unparked}\",\"frozenSeatBoundary\":$seats_before,\"lastVerifiedFrozenSnapshot\":$FROZEN_SEATS_LAST,\"rejectedSeatObservation\":${FROZEN_SEATS_REJECTION:-null},\"reasons\":\"${reasons#,}\""
}

# Connection-pool spike & post-swap leak telemetry thresholds (well below
# Supabase's pool ceiling). Overridable via environment for calibration/tests.
SWAP_WARN_DB_CONNECTIONS=${SWAP_WARN_DB_CONNECTIONS:-80}
SWAP_MAX_DB_CONNECTIONS=${SWAP_MAX_DB_CONNECTIONS:-120}
SWAP_MAX_DB_CONNECTION_LEAK=${SWAP_MAX_DB_CONNECTION_LEAK:-25}
SWAP_DB_CONN_SAMPLE_SECONDS=${SWAP_DB_CONN_SAMPLE_SECONDS:-2}

sample_db_connections() {
  psql_db -XqAt <<'SQL_DB_CONNS'
\set QUIET on
SET statement_timeout = '3s';
SELECT json_build_object(
  'total', count(*)::int,
  'active', count(*) FILTER (WHERE state = 'active')::int,
  'idle', count(*) FILTER (WHERE state = 'idle')::int,
  'idleInTx', count(*) FILTER (WHERE state IN ('idle in transaction', 'idle in transaction (aborted)'))::int,
  'waiting', count(*) FILTER (WHERE wait_event_type IS NOT NULL AND state = 'active')::int
)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid();
SQL_DB_CONNS
}

# Evaluates pg_stat_activity connection samples across a certified swap.
# Prints one JSON summary on stdout. Returns 0 on pass/warn, 1 on threshold or
# post-swap leak breach, 2 when no readable sample was captured.
evaluate_swap_db_connections() { # baseline_json samples_file post_json [max_total] [warn_total] [max_leak]
  local baseline="${1:-}" samples_file="${2:-}" post="${3:-}"
  local max_total="${4:-$SWAP_MAX_DB_CONNECTIONS}"
  local warn_total="${5:-$SWAP_WARN_DB_CONNECTIONS}"
  local max_leak="${6:-$SWAP_MAX_DB_CONNECTION_LEAK}"
  python3 - "$baseline" "$samples_file" "$post" "$max_total" "$warn_total" "$max_leak" <<'PY_DB_CONNS'
import json, os, sys

baseline_raw, samples_path, post_raw = sys.argv[1:4]
max_total, warn_total, max_leak = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])

def parse_sample(raw):
    raw = (raw or '').strip()
    if not raw:
        return None
    try:
        obj = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    total = obj.get('total')
    active = obj.get('active', 0)
    if type(total) is not int or total < 0 or type(active) is not int or active < 0:
        return None
    idle = obj.get('idle', 0)
    idle_in_tx = obj.get('idleInTx', 0)
    waiting = obj.get('waiting', 0)
    return {
        'total': total,
        'active': active,
        'idle': idle if type(idle) is int and idle >= 0 else 0,
        'idleInTx': idle_in_tx if type(idle_in_tx) is int and idle_in_tx >= 0 else 0,
        'waiting': waiting if type(waiting) is int and waiting >= 0 else 0,
    }

samples = []
baseline = parse_sample(baseline_raw)
if baseline is not None:
    samples.append(baseline)
if samples_path and os.path.exists(samples_path):
    try:
        with open(samples_path, encoding='utf-8', errors='replace') as handle:
            for line in handle:
                parsed = parse_sample(line)
                if parsed is not None:
                    samples.append(parsed)
    except OSError:
        pass
post = parse_sample(post_raw)
if post is not None:
    samples.append(post)

thresholds = {'warnTotal': warn_total, 'maxTotal': max_total, 'maxLeakDelta': max_leak}
if not samples:
    out = {
        'status': 'unreadable',
        'baselineTotal': None,
        'peakTotal': None,
        'peakActive': None,
        'peakIdleInTx': None,
        'peakWaiting': None,
        'postTotal': None,
        'deltaAfterSwap': None,
        'samples': 0,
        'thresholds': thresholds,
        'warnings': [],
        'breaches': [],
    }
    print(json.dumps(out))
    sys.exit(2)

peak_total = max(s['total'] for s in samples)
peak_active = max(s['active'] for s in samples)
peak_idle_in_tx = max(s['idleInTx'] for s in samples)
peak_waiting = max(s['waiting'] for s in samples)
baseline_total = baseline['total'] if baseline is not None else None
post_total = post['total'] if post is not None else None
delta = (post_total - baseline_total) if (baseline_total is not None and post_total is not None) else None

warnings = []
breaches = []
if peak_total > max_total:
    breaches.append(f'peak_db_connections_exceeded:{peak_total}>{max_total}')
elif peak_total > warn_total:
    warnings.append(f'peak_db_connections_high:{peak_total}>{warn_total}')
if delta is not None and delta > max_leak:
    breaches.append(f'db_connection_leak_after_swap:+{delta}>{max_leak}')

status = 'fail' if breaches else ('warn' if warnings else 'pass')
out = {
    'status': status,
    'baselineTotal': baseline_total,
    'peakTotal': peak_total,
    'peakActive': peak_active,
    'peakIdleInTx': peak_idle_in_tx,
    'peakWaiting': peak_waiting,
    'postTotal': post_total,
    'deltaAfterSwap': delta,
    'samples': len(samples),
    'thresholds': thresholds,
    'warnings': warnings,
    'breaches': breaches,
}
print(json.dumps(out))
if breaches:
    print(f"standby-trials: FAIL swap DB connections: {'; '.join(breaches)} (baseline={baseline_total}, peak={peak_total}, peakActive={peak_active}, post={post_total})", file=sys.stderr)
    sys.exit(1)
if warnings:
    print(f"standby-trials: WARNING swap DB connections: {'; '.join(warnings)} (baseline={baseline_total}, peak={peak_total}, peakActive={peak_active}, post={post_total})", file=sys.stderr)
sys.exit(0)
PY_DB_CONNS
}

start_player_witness() {
  local from=$1 to=$2 row table user seat script=/usr/local/share/club-arena-standby/player-reconnect.mjs
  row=$(psql_db -Atc "select s.table_id,s.user_id,s.seat_number from public.table_seats s join public.profiles p on p.id=s.user_id where p.is_horse and s.left_at is null and exists (select from public.hand_history h where h.table_id=s.table_id and h.created_at > now()-interval '5 minutes') order by s.table_id,s.seat_number limit 1") || return 1
  IFS='|' read -r table user seat <<< "$row"
  [[ "$table" =~ ^[a-f0-9-]{36}$ && "$user" =~ ^[a-f0-9-]{36}$ && "$seat" =~ ^[0-9]+$ ]] || return 1
  # The signer stays inside the current isolated engine. Its client's only
  # credential is the normal player session passed over stdin.
  (
    set -o pipefail
    docker exec -i "$CONTAINER" node --input-type=module - session "$table" "$user" < "$script" |
      docker run --rm -i --name "$witness_name" --network "$NETWORK" --read-only --cap-drop ALL \
        --user "$(id -u):$(id -g)" --mount "type=bind,source=$script,target=/probe.mjs,readonly" \
        --mount "type=bind,source=$witness_dir,target=/proof" --entrypoint node "$IMAGE_REPO:$from" \
        /probe.mjs witness "$table" "$user" "$seat" "$from" "$to"
  ) > "$witness_dir/verdict" &
  witness_pid=$!
  local end=$((SECONDS + 45))
  until [ -f "$witness_dir/connected" ]; do
    kill -0 "$witness_pid" 2>/dev/null && (( SECONDS < end )) || return 1
    sleep 0.2
  done
}

_cleanup_certified_player_swap() {
  local sampler_pid="${_SWAP_CLEANUP_SAMPLER_PID:-}"
  local w_name="${_SWAP_CLEANUP_WITNESS_NAME:-}"
  local w_pid="${witness_pid:-${_SWAP_CLEANUP_WITNESS_PID:-}}"
  local w_dir="${_SWAP_CLEANUP_WITNESS_DIR:-}"
  _SWAP_CLEANUP_SAMPLER_PID=''
  _SWAP_CLEANUP_WITNESS_NAME=''
  _SWAP_CLEANUP_WITNESS_PID=''
  _SWAP_CLEANUP_WITNESS_DIR=''
  if [ -n "$sampler_pid" ]; then
    kill "$sampler_pid" 2>/dev/null || true
    wait "$sampler_pid" 2>/dev/null || true
  fi
  if [ -n "$w_name" ]; then
    docker stop "$w_name" >/dev/null 2>&1 || true
    docker rm -f "$w_name" >/dev/null 2>&1 || true
  fi
  if [ -n "$w_pid" ]; then
    kill "$w_pid" 2>/dev/null || true
    wait "$w_pid" 2>/dev/null || true
  fi
  if [ -n "$w_dir" ]; then
    rm -rf -- "$w_dir"
  fi
}

_run_saved_swap_trap() {
  local spec="$1"
  [ -n "$spec" ] || return 0
  eval "set -- $spec"
  [ -n "${3:-}" ] && eval "$3"
}

certified_player_swap() {
  local witness_dir witness_name witness_pid='' conn_sampler_pid='' result=1
  local baseline_conn='' post_conn='' conn_rc=0
  local prev_trap_exit prev_trap_int prev_trap_term
  SWAP_PEAK_DB_CONNECTIONS=null
  prev_trap_exit=$(trap -p EXIT)
  prev_trap_int=$(trap -p INT)
  prev_trap_term=$(trap -p TERM)
  _SWAP_PREV_TRAP_EXIT="$prev_trap_exit"
  _SWAP_CLEANUP_SAMPLER_PID=''
  _SWAP_CLEANUP_WITNESS_NAME=''
  _SWAP_CLEANUP_WITNESS_PID=''
  _SWAP_CLEANUP_WITNESS_DIR=''
  trap '_cleanup_certified_player_swap; _run_saved_swap_trap "${_SWAP_PREV_TRAP_EXIT:-}"' EXIT
  trap '_cleanup_certified_player_swap; eval "${_SWAP_PREV_TRAP_EXIT:-trap - EXIT}"; trap - INT; exit 130' INT
  trap '_cleanup_certified_player_swap; eval "${_SWAP_PREV_TRAP_EXIT:-trap - EXIT}"; trap - TERM; exit 143' TERM
  witness_dir=$(mktemp -d "$STATE_DIR/player-proof.XXXXXXXX") || {
    eval "${prev_trap_exit:-trap - EXIT}"
    eval "${prev_trap_int:-trap - INT}"
    eval "${prev_trap_term:-trap - TERM}"
    return 1
  }
  witness_name="standby-${witness_dir##*/}"
  _SWAP_CLEANUP_WITNESS_DIR="$witness_dir"
  _SWAP_CLEANUP_WITNESS_NAME="$witness_name"
  baseline_conn=$(sample_db_connections 2>/dev/null || true)
  : > "$witness_dir/db-conns.jsonl"
  (
    sleep_pid=''
    trap '[ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null || true; exit 0' TERM INT
    while :; do
      sample_db_connections >> "$witness_dir/db-conns.jsonl" 2>/dev/null || true
      sleep "${SWAP_DB_CONN_SAMPLE_SECONDS:-2}" &
      sleep_pid=$!
      wait "$sleep_pid" 2>/dev/null || true
      sleep_pid=''
    done
  ) </dev/null >/dev/null 2>&1 &
  conn_sampler_pid=$!
  _SWAP_CLEANUP_SAMPLER_PID="$conn_sampler_pid"
  if trial_swap "$1" "$2" && wait "$witness_pid"; then
    cat "$witness_dir/verdict" >&2
    result=0
  fi
  if [ -n "$conn_sampler_pid" ]; then
    _SWAP_CLEANUP_SAMPLER_PID=''
    kill "$conn_sampler_pid" 2>/dev/null || true
    wait "$conn_sampler_pid" 2>/dev/null || true
  fi
  if [ -n "$witness_pid" ]; then
    _SWAP_CLEANUP_WITNESS_NAME=''
    _SWAP_CLEANUP_WITNESS_PID=''
    docker rm -f "$witness_name" >/dev/null 2>&1 || true
    wait "$witness_pid" 2>/dev/null || true
  else
    _SWAP_CLEANUP_WITNESS_NAME=''
  fi
  post_conn=$(sample_db_connections 2>/dev/null || true)
  SWAP_PEAK_DB_CONNECTIONS=$(evaluate_swap_db_connections "$baseline_conn" "$witness_dir/db-conns.jsonl" "$post_conn") || conn_rc=$?
  if [ "$conn_rc" -eq 1 ]; then
    result=1
  fi
  _SWAP_CLEANUP_WITNESS_DIR=''
  rm -rf -- "$witness_dir"
  eval "${prev_trap_exit:-trap - EXIT}"
  eval "${prev_trap_int:-trap - INT}"
  eval "${prev_trap_term:-trap - TERM}"
  return "$result"
}

trial_swap() {
  local from="$1" to="$2" t0 frozen_at stop_at live_at thaw_at reasons=""
  local pretrial_t0 pretrial_end build_t0 build_end witness_t0 witness_end post_deal_t0 post_deal_end
  valid_sha "$from"; valid_sha "$to"
  # Skip a redundant stop+reboot only when the copy is valid, the exact $from
  # image is present (needed by start_player_witness), and $CONTAINER is already
  # running $from cleanly (not paused, not restarting, 0 restarts, not unhealthy).
  # Matches trial_break and trial_table_kill without bypassing preconditions.
  local reuse_state=""
  reuse_state=$(docker inspect -f '{{index .Config.Labels "com.smarterpoker.standby.sha"}} {{.State.Running}} {{.State.Paused}} {{.State.Restarting}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || true)
  if { [ "$reuse_state" = "$from true false false 0 healthy" ] || [ "$reuse_state" = "$from true false false 0 none" ]; } \
     && assert_valid_copy >/dev/null 2>&1 \
     && docker image inspect "${IMAGE_REPO:-club-arena-engine-standby}:$from" >/dev/null 2>&1; then
    :
  else
    cmd_run "$from" || return 1
  fi
  wait_live 600 >/dev/null || { trial_verdict swap fail ',"reason":"from_never_live"'; return 1; }
  pretrial_t0=$(date +%s)
  wait_pretrial_dealing "$from" || { trial_verdict swap fail ',"reason":"from_never_dealt"'; return 1; }
  pretrial_end=$(date +%s)
  build_t0=$(date +%s)
  cmd_build "$to" >/dev/null || { trial_verdict swap fail ',"reason":"to_build_failed"'; return 1; }
  build_end=$(date +%s)
  witness_t0=$(date +%s)
  if [ -n "${witness_dir:-}" ]; then
    start_player_witness "$from" "$to" || { trial_verdict swap fail ',"reason":"player_session_unavailable"'; return 1; }
  fi
  witness_end=$(date +%s)
  local seats_before count_before post_boot seat_owner target_id adoption_state
  t0=$(date +%s)
  request_break >/dev/null || { trial_verdict swap fail ',"reason":"break_request_refused"'; return 1; }
  capture_frozen_seats "$((t0 + 600))" drained || { trial_verdict swap fail ",\"reason\":\"frozen_seat_capture_failed\",\"rejectedSeatObservation\":$FROZEN_SEATS_REJECTION"; return 1; }
  seats_before=$FROZEN_SEATS; frozen_at=$(date +%s)
  count_before=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["count"])' "$seats_before") || return 1
  # The cutover: the serving engine stops inside the freeze (graceful SIGTERM,
  # as the release transaction's drain does), the candidate takes the fleet.
  local swap_started=$(date +%s)
  docker stop -t 60 "$CONTAINER" >/dev/null 2>&1 || { trial_verdict swap fail ',"reason":"from_stop_failed"'; return 1; }
  stop_at=$(date +%s)
  cmd_run "$to" || return 1
  wait_live 600 >/dev/null && live_at=$(date +%s) || reasons="$reasons,to_never_live"
  [ "$(health | health_field releaseSha)" = "$to" ] || reasons="$reasons,to_not_serving"
  # The real maintenance CAS rotates ownership on adoption. Admit exactly one
  # transfer to this verified candidate, with unchanged semantics and seats.
  seat_owner=$seats_before; post_boot=null; target_id=null
  if target_id=$(swap_target_identity "$to") \
    && post_boot=$(frozen_seat_snapshot "$seats_before" "${to:0:8}") \
    && adoption_state=$(frozen_seat_state "$post_boot" "$seats_before" adopt "${to:0:8}" 2>&1) \
    && [ "$(swap_target_identity "$to")" = "$target_id" ]; then
    SWAP_ADOPTION_SECONDS=$(( $(date +%s) - swap_started ))
    seat_owner=$post_boot
  else
    [ "${adoption_state:-}" != frozen ] || adoption_state=candidate_identity_changed
    record_seat_rejection "$post_boot" "${adoption_state:-candidate_identity_unproved}"
    reasons="$reasons,frozen_seat_adoption_unproved"
  fi
  target_id=${target_id:-null}
  # Preserve JSON evidence even on a failed comparison; malformed reads are null.
  post_boot=$(python3 -c 'import json,sys
try: print(json.dumps(json.loads(sys.argv[1])))
except ValueError: print("null")' "$post_boot") || return 1
  wait_frozen_seats "$seat_owner" "$((t0 + 1800))" && thaw_at=$THAW_OBSERVED_AT \
    || reasons="$reasons,frozen_seat_boundary_failed"
  # Start a fresh database observation after thaw. The health window alone
  # can still contain hands from before the swap.
  post_deal_t0=$(date +%s)
  wait_pretrial_dealing "$to" || reasons="$reasons,to_did_not_deal_after_thaw"
  post_deal_end=$(date +%s)
  frozen_seat_receipt "$seat_owner" "${to:0:8}" || reasons="$reasons,frozen_seat_receipt_failed"
  local v=pass; [ -z "$reasons" ] || v=fail
  trial_verdict swap "$v" ",\"from\":\"$from\",\"to\":\"$to\",\"seats\":$count_before,\"frozenSeatBoundary\":$seats_before,\"lastVerifiedFrozenSnapshot\":$FROZEN_SEATS_LAST,\"rejectedSeatObservation\":${FROZEN_SEATS_REJECTION:-null},\"secondsPretrial\":$(trial_elapsed "$pretrial_t0" "${pretrial_end:-}"),\"secondsBuildTo\":$(trial_elapsed "$build_t0" "${build_end:-}"),\"secondsWitnessStart\":$(trial_elapsed "$witness_t0" "${witness_end:-}"),\"secondsToFreeze\":$(trial_elapsed "$t0" "${frozen_at:-}"),\"postBootSeatSnapshot\":$post_boot,\"adoptedRuntimeIdentity\":$target_id,\"secondsBootToLive\":$(trial_elapsed "${stop_at:-}" "${live_at:-}"),\"secondsFrozenTotal\":$(trial_elapsed "${frozen_at:-}" "${thaw_at:-}"),\"secondsPostThawDeal\":$(trial_elapsed "$post_deal_t0" "${post_deal_end:-}"),\"reasons\":\"${reasons#,}\""
}

trial_table_kill() {
  local sha="$1" n="${2:-3}" reasons="" killed=0 tok restarts_before
  valid_sha "$sha"
  [ "$(docker inspect -f '{{index .Config.Labels "com.smarterpoker.standby.sha"}}' "$CONTAINER" 2>/dev/null)" = "$sha" ] || cmd_run "$sha" || return 1
  wait_live 600 >/dev/null || { trial_verdict table-kill fail ',"reason":"never_live"'; return 1; }
  wait_pretrial_dealing "$sha" || { trial_verdict table-kill fail ',"reason":"never_dealt"'; return 1; }
  restarts_before=$(docker inspect -f '{{.RestartCount}}' "$CONTAINER") || return 1
  tok=$(fault_token)
  local seats_before; seats_before=$(seat_fingerprint)
  # Only an actively dealing horse-only table accepts a kill; try tables until n are down.
  for t in $(psql_db -Atc "select table_id from public.table_seats where left_at is null group by 1 order by random()"); do
    [ "$killed" -ge "$n" ] && break
    docker exec "$CONTAINER" node -e '
      fetch("http://127.0.0.1:8080/admin/inject-fault", {method: "POST",
        headers: {"x-fault-token": process.env.FAULT_INJECTION_TOKEN, "content-type": "application/json"},
        body: JSON.stringify({tableId: process.argv[1], fault: "kill_engine"})})
      .then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' "$t" && killed=$((killed+1))
  done
  [ "$killed" -eq "$n" ] || reasons="$reasons,fault_injection_refused"
  sleep 90
  wait_dealing 300 || reasons="$reasons,fleet_stopped_dealing"
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = true ] || reasons="$reasons,engine_process_died"
  [ "$(docker inspect -f '{{.RestartCount}}' "$CONTAINER")" = "$restarts_before" ] || reasons="$reasons,engine_process_restarted"
  [ "$(seat_fingerprint)" = "$seats_before" ] || reasons="$reasons,seats_moved"
  local v=pass; [ -z "$reasons" ] || v=fail
  trial_verdict table-kill "$v" ",\"sha\":\"$sha\",\"killed\":$killed,\"reasons\":\"${reasons#,}\""
}

# ---------------------------------------------------------------------------
# trial regression-replay <sha>: TODAY'S INCIDENTS NEVER COME BACK
# (owner order 2026-11-19 17:26 Chicago). Before the 03:30 selection can take
# a candidate, its Backup certification replays the incidents fixed that day
# against the candidate's own source and the restored copy, which holds
# production's exact installed schema (the selector refuses any other copy):
#
#   spin_reservation_budget  incident eaafbbfb: the engine's free-horse picker
#                            reads fn_horses_at_tournament_reservation_budget,
#                            and that read agrees with the seat door
#                            fn_seat_horse_in_seat_first_game (same promise
#                            predicate, same threshold, same horses on the
#                            copy's data);
#   hand_gap_owed_waits      incidents 1e532243 and 076ff467: the hand-gap
#                            grader leaves out a wait inside a maintenance
#                            break, a tournament break and hand-for-hand, and
#                            still grades an ordinary pair (synthetic hands in
#                            the year 2000, inside a transaction that is
#                            always rolled back, triggers off);
#   cutover_owes_baseline    incident 076ff467: fn_ca_engine_cutover_watch
#                            owes the build merged by the candidate's own
#                            freeze start minus SETTLE, and the 03:00 readiness
#                            check reads the same clock;
#   drill_records_its_run    incident 316ed735: fn_ca_alarm_drill writes its
#                            completed run to ca_detector_runs.
#
# A check is armed once the migration that fixed its incident is installed on
# the copy (that is, in production); before that it says not_armed and passes,
# so an unshipped fix never withholds a certificate. Once armed, a failure is a
# regression and withholds the certificate (cmd_certify records
# regression_replay_failed). Nothing is committed: one transaction, rolled
# back, statement budget 30 s. Native proof:
# scripts/ci/test-backup-regression-replay.py.
# ---------------------------------------------------------------------------
regression_replay_clock() { # sha -> "<freeze start minutes from midnight> <settle minutes>"
  python3 - "$1" "${REPO_DIR:-/opt/club-arena}" <<'PY_REPLAY_CLOCK'
import re, subprocess, sys
sha, repo = sys.argv[1:3]
def show(path):
    return subprocess.run(['git', '-C', repo, 'show', f'{sha}:{path}'], capture_output=True, text=True, check=True).stdout
d = re.search(r'RELEASE_SCHEMA_FREEZE_CHICAGO\s*=\s*\{\s*from:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', show('scripts/ci/merged-migration-dispatch.mjs'))
s = re.search(r'SETTLE\s*=\s*timedelta\(minutes=(\d+)\)', show('scripts/ci/backup-freeze-baseline.py'))
if not (d and s):
    sys.exit('release clock not found in the candidate')
m = int(d[1]) * 60 + int(d[2])
print(m - 24 * 60 if m >= 12 * 60 else m, int(s[1]))
PY_REPLAY_CLOCK
}

regression_replay_picker() { # sha: the candidate's free-horse picker excludes horses at the budget
  # Read each file whole, then search it. standby-engine.sh runs under
  # `set -Eeuo pipefail`: piping git show into grep -q let grep exit at the
  # first match, git show died of SIGPIPE, and pipefail turned a found
  # pattern into a failure (Backup 44680630430, 2026-11-20 05:27 UTC,
  # picker_ignores_reservation_budget on a candidate that has the fix).
  local repo="${REPO_DIR:-/opt/club-arena}" budget recurring
  budget=$(git -C "$repo" show "$1:server/src/services/horseReservationBudget.ts" 2>/dev/null) || return 1
  recurring=$(git -C "$repo" show "$1:server/src/services/TournamentRecurringService.ts" 2>/dev/null) || return 1
  [[ "$budget" == *"HORSE_RESERVATION_BUDGET_RPC = 'fn_horses_at_tournament_reservation_budget'"* ]] || return 1
  [[ "$recurring" == *'this.horseReservationBudget.atBudget()'* ]] || return 1
}

regression_replay_sql() { # freeze_offset settle -> one JSON array of check verdicts; never commits
  psql_db -XqAt -v freeze_offset="$1" -v settle="$2" <<'SQL_REGRESSION_REPLAY'
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL session_replication_role = replica;
SELECT set_config('replay.freeze_offset', :'freeze_offset', true), set_config('replay.settle', :'settle', true) \g /dev/null
CREATE TEMP TABLE replay_verdict (check_name text PRIMARY KEY, verdict text NOT NULL, detail text) ON COMMIT DROP;
-- The restored Backup copy carries no supabase_migrations schema (Backup
-- certify 44673040919, 2026-11-20 04:15 UTC: "relation
-- supabase_migrations.schema_migrations does not exist"). A version is
-- installed only where that history exists and names it; anywhere else the
-- check reads not installed (not_armed), never an error.
CREATE FUNCTION pg_temp.replay_installed(p_version text) RETURNS boolean LANGUAGE plpgsql AS $replay_installed$
DECLARE v boolean;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)' INTO v USING p_version;
  RETURN v;
END
$replay_installed$;
DO $replay$
DECLARE
  c_freeze integer := current_setting('replay.freeze_offset')::integer;
  c_settle integer := current_setting('replay.settle')::integer;
  v_door text; v_read text; v_def text; v_ready text; v_thr_door integer; v_thr_read integer;
  v_budget uuid[]; v_mirror uuid[]; v_got integer; v_off integer;
  v_cash integer; v_tour integer; v_maint integer; v_notes text := '';
  v_t uuid := gen_random_uuid(); v_u uuid := gen_random_uuid(); v_v uuid := gen_random_uuid();
  v_h4h boolean;
BEGIN
  -- spin_reservation_budget ------------------------------------------------
  IF NOT pg_temp.replay_installed('20261119181143') THEN
    INSERT INTO replay_verdict VALUES ('spin_reservation_budget', 'not_armed', '20261119181143 is not installed');
  ELSE
    BEGIN
      v_door := regexp_replace(pg_get_functiondef('public.fn_seat_horse_in_seat_first_game(uuid,uuid)'::regprocedure), '\s+', '', 'g');
      v_read := regexp_replace(pg_get_functiondef('public.fn_horses_at_tournament_reservation_budget()'::regprocedure), '\s+', '', 'g');
      v_thr_door := substring(v_door FROM '\)>=([0-9]+)THENRETURNjsonb_build_object\(''ok'',false,''reason'',''horse_tournament_reservation_budget''\)')::integer;
      v_thr_read := substring(v_read FROM 'HAVINGcount\(DISTINCTpromise\.tournament_id\)>=([0-9]+)')::integer;
      IF v_thr_door IS NULL OR v_thr_read IS NULL THEN
        INSERT INTO replay_verdict VALUES ('spin_reservation_budget', 'fail', format('reservation budget predicate not found (door %s, read %s)', v_thr_door, v_thr_read));
      ELSIF v_thr_door <> v_thr_read THEN
        INSERT INTO replay_verdict VALUES ('spin_reservation_budget', 'fail', format('the seat door refuses at %s promises but the picker read excludes at %s', v_thr_door, v_thr_read));
      ELSIF strpos(v_door, 'promise.statusIN(''registered'',''playing'')') = 0 OR strpos(v_read, 'promise.statusIN(''registered'',''playing'')') = 0
         OR strpos(v_door, 'NOTIN(''COMPLETING'',''COMPLETED'',''CANCELLED'')') = 0 OR strpos(v_read, 'NOTIN(''COMPLETING'',''COMPLETED'',''CANCELLED'')') = 0 THEN
        INSERT INTO replay_verdict VALUES ('spin_reservation_budget', 'fail', 'the seat door and the picker read no longer count the same promises');
      ELSE
        v_budget := public.fn_horses_at_tournament_reservation_budget();
        SELECT COALESCE(array_agg(x ORDER BY x), '{}'::uuid[]) INTO v_mirror FROM (
          SELECT promise.user_id AS x
            FROM public.tournament_players promise
            JOIN public.tournaments promised ON promised.id = promise.tournament_id
            JOIN public.profiles h ON h.id = promise.user_id AND h.is_horse IS TRUE
           WHERE promise.status IN ('registered','playing')
             AND upper(COALESCE(promised.status,'')) NOT IN ('COMPLETING','COMPLETED','CANCELLED')
           GROUP BY promise.user_id
          HAVING count(DISTINCT promise.tournament_id) >= v_thr_door) m;
        IF v_budget IS DISTINCT FROM v_mirror THEN
          INSERT INTO replay_verdict VALUES ('spin_reservation_budget', 'fail',
            format('on the copy the picker read names %s horse(s) and the door refuses %s', cardinality(v_budget), cardinality(v_mirror)));
        ELSE
          INSERT INTO replay_verdict VALUES ('spin_reservation_budget', 'pass',
            format('%s horse(s) at the budget; door and picker read agree at >= %s promises', cardinality(v_budget), v_thr_door));
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO replay_verdict VALUES ('spin_reservation_budget', 'fail', 'error: ' || SQLERRM);
    END;
  END IF;

  -- hand_gap_owed_waits ----------------------------------------------------
  IF to_regprocedure('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)') IS NULL THEN
    INSERT INTO replay_verdict VALUES ('hand_gap_owed_waits', 'not_armed', 'the grader is not installed');
  ELSE
    BEGIN
      v_h4h := to_regclass('public.ca_tournament_hand_for_hand') IS NOT NULL
               AND pg_temp.replay_installed('20261119211558');
      -- Night 1 (2000-01-01): an ordinary cash pair and an ordinary tournament
      -- pair are graded; a tournament-break pair and a hand-for-hand pair are not.
      INSERT INTO public.hand_history (table_id, tournament_id, started_at, ended_at, created_at, actions, players, pots, showdown)
      SELECT tb, tr, '2000-01-01 00:00:00+00'::timestamptz + s, '2000-01-01 00:00:00+00'::timestamptz + e,
             '2000-01-01 00:00:00+00'::timestamptz + c, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
        FROM (VALUES (gen_random_uuid(), NULL::uuid), (gen_random_uuid(), v_v), (gen_random_uuid(), v_t), (gen_random_uuid(), v_u)) AS g(tb, tr)
        CROSS JOIN (VALUES (interval '-30 seconds', interval '0 seconds', interval '1 second'),
                           (interval '20 seconds', interval '50 seconds', interval '51 seconds')) AS h(s, e, c);
      BEGIN
        INSERT INTO public.tournaments (id, name, buy_in_amount, buy_in_fee, start_time, ban_chat, status, break_started_at, break_ends_at)
        VALUES (v_t, 'regression replay', 0, 0, '2000-01-01 00:00:00+00', false, 'RUNNING',
                '2000-01-01 00:00:05+00', '2000-01-01 00:00:15+00');
      EXCEPTION WHEN OTHERS THEN
        v_t := NULL;
        v_notes := v_notes || '; tournament break not exercised: ' || SQLERRM;
      END;
      IF v_h4h THEN
        EXECUTE 'INSERT INTO public.ca_tournament_hand_for_hand (tournament_id, started_at, ended_at) VALUES ($1, $2, $3)'
          USING v_u, '2000-01-01 00:00:02+00'::timestamptz, '2000-01-01 00:00:18+00'::timestamptz;
      END IF;
      SELECT COALESCE(sum(hands) FILTER (WHERE kind = 'cash'), 0), COALESCE(sum(hands) FILTER (WHERE kind = 'tournament'), 0)
        INTO v_cash, v_tour FROM public.fn_ca_hand_gap_unintended_delay('2000-01-01 00:10:00+00', 15);
      -- Night 2 (2000-01-02): an ordinary pair inside a maintenance break.
      INSERT INTO public.hand_history (table_id, tournament_id, started_at, ended_at, created_at, actions, players, pots, showdown)
      VALUES (v_v, NULL, '2000-01-01 23:59:30+00', '2000-01-02 00:00:00+00', '2000-01-02 00:00:01+00', '[]', '[]', '[]', '[]'),
             (v_v, NULL, '2000-01-02 00:00:20+00', '2000-01-02 00:00:50+00', '2000-01-02 00:00:51+00', '[]', '[]', '[]', '[]');
      INSERT INTO public.engine_maintenance_break_log (break_started_at, break_ended_at, unparked_at_countdown, peak_unparked, tables_resumed)
      VALUES ('2000-01-02 00:00:05+00', '2000-01-02 00:00:15+00', 0, 0, 0);
      SELECT COALESCE(sum(hands), 0) INTO v_maint FROM public.fn_ca_hand_gap_unintended_delay('2000-01-02 00:10:00+00', 15);
      -- The ordinary tournament pair (no break, no hand-for-hand) is graded;
      -- the tournament-break pair only when its synthetic event could be written.
      v_got := 1 + CASE WHEN v_t IS NULL THEN 1 ELSE 0 END + CASE WHEN v_h4h THEN 0 ELSE 1 END;
      IF v_cash <> 1 THEN
        INSERT INTO replay_verdict VALUES ('hand_gap_owed_waits', 'fail', format('an ordinary cash pair graded %s times, not once (the replay proves nothing)', v_cash));
      ELSIF v_maint <> 0 THEN
        INSERT INTO replay_verdict VALUES ('hand_gap_owed_waits', 'fail', 'a wait inside a maintenance break was graded as a delay');
      ELSIF v_tour <> v_got THEN
        INSERT INTO replay_verdict VALUES ('hand_gap_owed_waits', 'fail',
          format('%s tournament pair(s) graded, expected %s: a tournament break%s wait was graded as a delay',
                 v_tour, v_got, CASE WHEN v_h4h THEN ' or hand-for-hand' ELSE '' END));
      ELSE
        INSERT INTO replay_verdict VALUES ('hand_gap_owed_waits', 'pass',
          format('maintenance break%s%s left out, ordinary pairs graded%s',
                 CASE WHEN v_t IS NOT NULL THEN ', tournament break' ELSE '' END,
                 CASE WHEN v_h4h THEN ', hand-for-hand' ELSE ' (hand-for-hand not armed: 20261119211558 not installed)' END, v_notes));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO replay_verdict VALUES ('hand_gap_owed_waits', 'fail', 'error: ' || SQLERRM);
    END;
  END IF;

  -- cutover_owes_baseline --------------------------------------------------
  IF NOT pg_temp.replay_installed('20261119182637') THEN
    INSERT INTO replay_verdict VALUES ('cutover_owes_baseline', 'not_armed', '20261119182637 is not installed');
  ELSE
    BEGIN
      v_def := pg_get_functiondef('public.fn_ca_engine_cutover_watch(timestamp with time zone)'::regprocedure);
      -- The 03:00 readiness check (20261119234116), when installed; NULL otherwise.
      v_ready := pg_get_functiondef(to_regprocedure('public.fn_ca_cutover_readiness_watch(timestamp with time zone,boolean)'));
      v_off := substring(v_def FROM 'ca_cutover_owed_build\(v_serving, least\(v_cutoff, \(v_day::timestamp \+ interval ''(-?[0-9]+) minutes''\) AT TIME ZONE c_tz\)\)')::integer;
      IF v_off IS NULL THEN
        INSERT INTO replay_verdict VALUES ('cutover_owes_baseline', 'fail', 'the cutover watch no longer owes the freeze-baseline build');
      ELSIF v_off <> c_freeze - c_settle THEN
        INSERT INTO replay_verdict VALUES ('cutover_owes_baseline', 'fail',
          format('the cutover watch owes the build merged by %s min from midnight; the candidate freezes at %s and settles %s', v_off, c_freeze, c_settle));
      ELSIF v_ready IS NOT NULL
        AND (strpos(v_ready, format('c_freeze_offset constant interval := interval ''%s minutes''', c_freeze)) = 0
          OR strpos(v_ready, format('c_settle constant interval := interval ''%s minutes''', c_settle)) = 0) THEN
        INSERT INTO replay_verdict VALUES ('cutover_owes_baseline', 'fail', 'the 03:00 readiness check reads a different freeze clock than the candidate');
      ELSE
        INSERT INTO replay_verdict VALUES ('cutover_owes_baseline', 'pass',
          format('owes the build merged by %s min from the cutover date''s midnight (freeze %s, settle %s)', v_off, c_freeze, c_settle));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO replay_verdict VALUES ('cutover_owes_baseline', 'fail', 'error: ' || SQLERRM);
    END;
  END IF;

  -- drill_records_its_run --------------------------------------------------
  IF NOT pg_temp.replay_installed('20261119231718') THEN
    INSERT INTO replay_verdict VALUES ('drill_records_its_run', 'not_armed', '20261119231718 is not installed');
  ELSE
    BEGIN
      v_def := pg_get_functiondef('public.fn_ca_alarm_drill()'::regprocedure);
      IF to_regclass('public.ca_detector_runs') IS NULL
         OR strpos(v_def, 'INSERT INTO public.ca_detector_runs (detector, detail)') = 0
         OR strpos(v_def, 'VALUES (''fn_ca_alarm_drill''') = 0
         OR strpos(v_def, 'INSERT INTO public.ca_detector_runs (detector, detail)')
            > strpos(v_def, 'RETURN jsonb_build_object(''pass'', cardinality(v_failing) = 0,') THEN
        INSERT INTO replay_verdict VALUES ('drill_records_its_run', 'fail', 'fn_ca_alarm_drill no longer records its completed run in ca_detector_runs');
      ELSE
        INSERT INTO replay_verdict VALUES ('drill_records_its_run', 'pass', 'fn_ca_alarm_drill records its completed run before it returns');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO replay_verdict VALUES ('drill_records_its_run', 'fail', 'error: ' || SQLERRM);
    END;
  END IF;
END
$replay$;
SELECT json_agg(json_build_object('check', check_name, 'verdict', verdict, 'detail', detail) ORDER BY check_name) FROM replay_verdict;
ROLLBACK;
SQL_REGRESSION_REPLAY
}

trial_regression_replay() {
  local sha="$1" clock checks reasons="" t0
  valid_sha "$sha"
  t0=$(date +%s)
  # The replay runs before cmd_build fetches; read the candidate the same way.
  git -C "${REPO_DIR:-/opt/club-arena}" cat-file -e "$sha^{commit}" 2>/dev/null \
    || git -C "${REPO_DIR:-/opt/club-arena}" fetch -q origin 2>/dev/null || true
  regression_replay_picker "$sha" || reasons="$reasons,picker_ignores_reservation_budget"
  if ! clock=$(regression_replay_clock "$sha" 2>&1); then
    trial_verdict regression-replay fail ",\"sha\":\"$sha\",\"reason\":\"candidate_release_clock_unreadable\""
    return 1
  fi
  # shellcheck disable=SC2086
  if ! checks=$(regression_replay_sql $clock 2>&1); then
    trial_verdict regression-replay fail ",\"sha\":\"$sha\",\"reason\":\"replay_sql_failed\",\"error\":$(printf '%s' "$checks" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()[-500:]))')"
    return 1
  fi
  local failed
  failed=$(python3 -c 'import json,sys
rows = json.loads(sys.argv[1])
assert isinstance(rows, list) and len(rows) == 4, "expected four checks"
print(",".join(r["check"] for r in rows if r["verdict"] not in ("pass", "not_armed")))' "$checks") \
    || { trial_verdict regression-replay fail ",\"sha\":\"$sha\",\"reason\":\"replay_output_unreadable\""; return 1; }
  [ -z "$failed" ] || reasons="$reasons,$failed"
  local v=pass; [ -z "$reasons" ] || v=fail
  trial_verdict regression-replay "$v" ",\"sha\":\"$sha\",\"seconds\":$(( $(date +%s) - t0 )),\"clock\":\"$clock\",\"checks\":$checks,\"reasons\":\"${reasons#,}\""
}

cmd_trial() {
  local name="${1:?trial name}"; shift
  assert_isolated
  case "$name" in
    swap)       trial_swap "${1:?from}" "${2:?to}" ;;
    break)      trial_break "${1:?sha}" ;;
    table-kill) trial_table_kill "${1:?sha}" "${2:-3}" ;;
    regression-replay) trial_regression_replay "${1:?sha}" ;;
    all)        local rc=0
                trial_swap "${1:?from}" "${2:?to}" || rc=1
                trial_table_kill "$2" 3 || rc=1
                trial_break "$2" || rc=1
                return $rc ;;
    *) die "unknown trial $name" ;;
  esac
}
