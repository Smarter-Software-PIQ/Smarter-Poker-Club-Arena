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
      table_id::text||':'||seat_number::text||':'||user_id::text,
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

capture_frozen_seats() { # absolute bounded deadline; result in FROZEN_SEATS
  local snapshot state
  FROZEN_SEATS_REJECTION=null
  while [ "$(date +%s)" -lt "$1" ]; do
    snapshot=$(frozen_seat_snapshot 2>&1) || { record_seat_rejection "$snapshot" snapshot_read_failed; return 1; }
    state=$(frozen_seat_state "$snapshot" '' poll 2>&1) || { record_seat_rejection "$snapshot" "$state"; return 1; }
    if [ "$state" = frozen ]; then FROZEN_SEATS=$snapshot; return 0; fi
    sleep 3
  done
  record_seat_rejection '{}' capture_deadline_expired
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
    sleep 3
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
  local binding id sha running restarts h instance liveness
  binding=$(docker inspect -f '{{.Id}} {{index .Config.Labels "com.smarterpoker.standby.sha"}} {{.State.Running}} {{.RestartCount}}' "$CONTAINER") || return 1
  read -r id sha running restarts <<< "$binding"
  [[ "$id" =~ ^[0-9a-f]{64}$ ]] && [ "$sha" = "$1" ] && [ "$running" = true ] || return 1
  h=$(health) || return 1
  [ "$(printf '%s' "$h" | health_field releaseSha)" = "$1" ] \
    && [ "$(printf '%s' "$h" | health_field version)" = "${1:0:8}" ] || return 1
  [[ "$restarts" =~ ^[0-9]+$ ]] || return 1
  instance=$(printf '%s' "$h" | health_field instanceId) || return 1
  liveness=$(printf '%s' "$h" | health_field liveness) || return 1
  [ -n "$instance" ] && [ "$instance" != null ] || return 1
  [ "$liveness" = ok ] || [ "$liveness" = standby ] || return 1
  python3 - "$id" "$instance" "$restarts" "$1" <<'PY_IDENTITY'
import json, sys
print(json.dumps(dict(containerId=sys.argv[1], instanceId=sys.argv[2], restartCount=int(sys.argv[3]), releaseSha=sys.argv[4])))
PY_IDENTITY
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
    sleep 5
  done
  return 1
}

wait_pretrial_dealing() {
  # The old sequential waits allowed 300 seconds for play plus 900 for maintenance.
  local baseline current sha="$1"
  baseline=$(swap_target_identity "$sha") || return 1
  local start now previous eligible=0 was_playing=0 since h phase hands live db
  start=$(date +%s); previous=$start; since=$((start + 1))
  while :; do
    now=$(date +%s)
    (( now - start < 1200 )) || return 1
    eligible=$((eligible + was_playing * (now - previous)))
    (( eligible < 300 )) || return 1
    previous=$now
    h=$(health) || return 1
    phase=$(printf '%s' "$h" | health_field maintenance.phase) || return 1
    live=$(printf '%s' "$h" | health_field liveness) || return 1
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
        hands=$(printf '%s' "$h" | health_field dealRate.handsInWindow) || return 1
        if [[ "$hands" =~ ^[0-9]+$ ]] && [ "$hands" -gt 0 ]; then
          current=$(swap_target_identity "$sha") || return 1
          [ "$current" = "$baseline" ] || return 1
          now=$(date +%s)
          (( now - start < 1200 && eligible + now - previous < 300 ))
          return
        fi
      fi
    fi
    sleep 5
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
  echo "$line" | tee -a "$STATE_DIR/trials.jsonl"
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

trial_swap() {
  local from="$1" to="$2" t0 frozen_at stop_at live_at thaw_at reasons=""
  valid_sha "$from"; valid_sha "$to"
  cmd_run "$from" || return 1
  wait_live 600 >/dev/null || { trial_verdict swap fail ',"reason":"from_never_live"'; return 1; }
  wait_pretrial_dealing "$from" || { trial_verdict swap fail ',"reason":"from_never_dealt"'; return 1; }
  cmd_build "$to" >/dev/null || { trial_verdict swap fail ',"reason":"to_build_failed"'; return 1; }
  local seats_before count_before post_boot seat_owner target_id adoption_state
  t0=$(date +%s)
  request_break >/dev/null || { trial_verdict swap fail ',"reason":"break_request_refused"'; return 1; }
  capture_frozen_seats "$((t0 + 600))" || { trial_verdict swap fail ",\"reason\":\"frozen_seat_capture_failed\",\"rejectedSeatObservation\":$FROZEN_SEATS_REJECTION"; return 1; }
  seats_before=$FROZEN_SEATS; frozen_at=$(date +%s)
  count_before=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["count"])' "$seats_before") || return 1
  # The cutover: the serving engine stops inside the freeze (graceful SIGTERM,
  # as the release transaction's drain does), the candidate takes the fleet.
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
  wait_dealing 420 || reasons="$reasons,to_did_not_deal_after_thaw"
  frozen_seat_receipt "$seat_owner" "${to:0:8}" || reasons="$reasons,frozen_seat_receipt_failed"
  local v=pass; [ -z "$reasons" ] || v=fail
  trial_verdict swap "$v" ",\"from\":\"$from\",\"to\":\"$to\",\"seats\":$count_before,\"frozenSeatBoundary\":$seats_before,\"lastVerifiedFrozenSnapshot\":$FROZEN_SEATS_LAST,\"rejectedSeatObservation\":${FROZEN_SEATS_REJECTION:-null},\"secondsToFreeze\":$(trial_elapsed "$t0" "${frozen_at:-}"),\"postBootSeatSnapshot\":$post_boot,\"adoptedRuntimeIdentity\":$target_id,\"secondsBootToLive\":$(trial_elapsed "${stop_at:-}" "${live_at:-}"),\"secondsFrozenTotal\":$(trial_elapsed "${frozen_at:-}" "${thaw_at:-}"),\"reasons\":\"${reasons#,}\""
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

cmd_trial() {
  local name="${1:?trial name}"; shift
  assert_isolated
  case "$name" in
    swap)       trial_swap "${1:?from}" "${2:?to}" ;;
    break)      trial_break "${1:?sha}" ;;
    table-kill) trial_table_kill "${1:?sha}" "${2:-3}" ;;
    all)        local rc=0
                trial_swap "${1:?from}" "${2:?to}" || rc=1
                trial_table_kill "$2" 3 || rc=1
                trial_break "$2" || rc=1
                return $rc ;;
    *) die "unknown trial $name" ;;
  esac
}
