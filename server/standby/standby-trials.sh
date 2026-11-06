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

wait_no_break() {  # do not start a trial inside the Backup's own scheduled break
  local deadline=$(( $(date +%s) + 900 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local p; p=$(maintenance_field phase)
    case "$p" in last_hand|counting_down|pausing) sleep 10 ;; *) frozen || return 0; sleep 10 ;; esac
  done
  return 1
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
  [ "$(docker inspect -f '{{index .Config.Labels "com.smarterpoker.standby.sha"}}' "$CONTAINER" 2>/dev/null)" = "$sha" ] || cmd_run "$sha"
  wait_live 600 >/dev/null || { trial_verdict break fail ',"reason":"never_live"'; return 1; }
  wait_dealing 300 || { trial_verdict break fail ',"reason":"never_dealt_before_break"'; return 1; }
  wait_no_break || { trial_verdict break fail ',"reason":"scheduled_break_never_cleared"'; return 1; }
  local seats_before; seats_before=$(seat_fingerprint)
  t0=$(date +%s)
  request_break >/dev/null || reasons="$reasons,break_request_refused"
  # announcement, last hand, park, freeze
  while [ $(( $(date +%s) - t0 )) -lt 600 ]; do frozen && { frozen_at=$(date +%s); break; }; sleep 3; done
  [ -n "${frozen_at:-}" ] || reasons="$reasons,never_froze"
  local unparked; unparked=$(maintenance_field unparkedTables)
  # thaw
  while [ $(( $(date +%s) - t0 )) -lt 1200 ]; do frozen || { thaw_at=$(date +%s); break; }; sleep 3; done
  [ -n "${thaw_at:-}" ] || reasons="$reasons,never_thawed"
  wait_dealing 300 && resumed=1 || { resumed=0; reasons="$reasons,did_not_deal_after_thaw"; }
  [ "$(seat_fingerprint)" = "$seats_before" ] || reasons="$reasons,seats_moved"
  local v=pass; [ -z "$reasons" ] || v=fail
  trial_verdict break "$v" ",\"sha\":\"$sha\",\"secondsToFreeze\":$(( ${frozen_at:-0} - t0 )),\"secondsFrozen\":$(( ${thaw_at:-0} - ${frozen_at:-0} )),\"unparkedAtFreeze\":\"${unparked}\",\"reasons\":\"${reasons#,}\""
}

trial_swap() {
  local from="$1" to="$2" t0 frozen_at stop_at live_at thaw_at reasons=""
  valid_sha "$from"; valid_sha "$to"
  cmd_run "$from"
  wait_live 600 >/dev/null || { trial_verdict swap fail ',"reason":"from_never_live"'; return 1; }
  wait_dealing 300 || { trial_verdict swap fail ',"reason":"from_never_dealt"'; return 1; }
  wait_no_break || { trial_verdict swap fail ',"reason":"scheduled_break_never_cleared"'; return 1; }
  cmd_build "$to" >/dev/null || { trial_verdict swap fail ',"reason":"to_build_failed"'; return 1; }
  local seats_before count_before; seats_before=$(seat_fingerprint); count_before=$(seat_count)
  t0=$(date +%s)
  request_break >/dev/null || reasons="$reasons,break_request_refused"
  while [ $(( $(date +%s) - t0 )) -lt 600 ]; do frozen && { frozen_at=$(date +%s); break; }; sleep 3; done
  [ -n "${frozen_at:-}" ] || reasons="$reasons,never_froze"
  # The cutover: the serving engine stops inside the freeze (graceful SIGTERM,
  # as the release transaction's drain does), the candidate takes the fleet.
  docker stop -t 60 "$CONTAINER" >/dev/null 2>&1; stop_at=$(date +%s)
  cmd_run "$to"
  wait_live 600 >/dev/null && live_at=$(date +%s) || reasons="$reasons,to_never_live"
  [ "$(health | health_field releaseSha)" = "$to" ] || reasons="$reasons,to_not_serving"
  while [ $(( $(date +%s) - t0 )) -lt 1800 ]; do frozen || { thaw_at=$(date +%s); break; }; sleep 3; done
  [ -n "${thaw_at:-}" ] || reasons="$reasons,never_thawed_after_swap"
  wait_dealing 420 || reasons="$reasons,to_did_not_deal_after_thaw"
  [ "$(seat_fingerprint)" = "$seats_before" ] || reasons="$reasons,seats_moved_across_swap"
  local v=pass; [ -z "$reasons" ] || v=fail
  trial_verdict swap "$v" ",\"from\":\"$from\",\"to\":\"$to\",\"seats\":$count_before,\"secondsToFreeze\":$(( ${frozen_at:-0} - t0 )),\"secondsBootToLive\":$(( ${live_at:-0} - ${stop_at:-0} )),\"secondsFrozenTotal\":$(( ${thaw_at:-0} - ${frozen_at:-0} )),\"reasons\":\"${reasons#,}\""
}

trial_table_kill() {
  local sha="$1" n="${2:-3}" reasons="" killed=0 tok
  valid_sha "$sha"
  [ "$(docker inspect -f '{{index .Config.Labels "com.smarterpoker.standby.sha"}}' "$CONTAINER" 2>/dev/null)" = "$sha" ] || cmd_run "$sha"
  wait_live 600 >/dev/null || { trial_verdict table-kill fail ',"reason":"never_live"'; return 1; }
  wait_dealing 300 || { trial_verdict table-kill fail ',"reason":"never_dealt"'; return 1; }
  wait_no_break || { trial_verdict table-kill fail ',"reason":"scheduled_break_never_cleared"'; return 1; }
  tok=$(fault_token)
  local seats_before; seats_before=$(seat_fingerprint)
  for t in $(psql_db -Atc "select table_id from public.table_seats where left_at is null group by 1 order by random() limit $n"); do
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
  [ "$(docker inspect -f '{{.RestartCount}}' "$CONTAINER")" = 0 ] || reasons="$reasons,engine_process_restarted"
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
