#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
# AUTOHEAL GATE - ask the engine before restarting it (2026-11-14).
#
# Replaces the stock willfarrell/autoheal loop (same image, same label, same
# interval, same stop timeout) with one added question. Docker marks a
# container unhealthy after three failed HEALTHCHECK runs, and a HEALTHCHECK
# run is an exec INSIDE the container. On 2026-11-12 at 00:25 and 2026-11-14 at
# 00:23 to 00:25 Chicago dockerd logged "timed out starting health check"
# five and eight times: the probe exec never STARTED, so the engine's /health
# was never asked. The engine was dealing the whole time (event-loop p99
# under 50 ms, ~1,200 log lines a minute, host CPU at most 43% of 16 cores),
# and autoheal restarted it anyway, voiding every hand in flight
# (incident b6151c69).
#
# So before restarting an unhealthy container that publishes the engine port,
# this asks the engine itself, from the host network, with no exec and the
# same 15 s budget the HEALTHCHECK has:
#
#   alive  (HTTP answer, running === true, liveness ok|standby)
#          -> no restart; the decline is logged and counted.
#   not alive, malformed, or no answer within 15 s
#          -> restart exactly as before.
#
# The verdict is the HEALTHCHECK's own expression, so nothing that made the
# probe fail on a dead engine (liveness 'dead': whole fleet stalled, discovery
# loop dead, barren leader, database confirmed dead) is weakened. The decline
# reason records whether Docker's last probe failed to START ("timed out
# starting health check", an exec-start failure, not a verdict) or ran and
# failed while the engine answered alive a moment later.
#
# AUTOHEAL_GATE_ONCE=1 runs one pass and exits (tests).
# ═══════════════════════════════════════════════════════════════════════════
set -u

SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"
API="${DOCKER_API_BASE:-http://localhost}"
LABEL="${AUTOHEAL_CONTAINER_LABEL:-autoheal}"
INTERVAL="${AUTOHEAL_INTERVAL:-15}"
START_PERIOD="${AUTOHEAL_START_PERIOD:-0}"
STOP_TIMEOUT="${AUTOHEAL_DEFAULT_STOP_TIMEOUT:-10}"
ENGINE_PORT="${AUTOHEAL_ENGINE_CONTAINER_PORT:-8080}"
PROBE_HOST="${AUTOHEAL_ENGINE_PROBE_HOST:-127.0.0.1}"
PROBE_BUDGET="${AUTOHEAL_ENGINE_PROBE_SECONDS:-15}"
TEXTFILE_DIR="${AUTOHEAL_TEXTFILE_DIR:-}"
ONCE="${AUTOHEAL_GATE_ONCE:-0}"

declined_exec_start=0
declined_probe_failed=0
restarted=0

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

docker_get() {
  curl --max-time 15 -sf --unix-socket "$SOCK" "$API$1"
}

write_counters() {
  [ -n "$TEXTFILE_DIR" ] && [ -d "$TEXTFILE_DIR" ] && [ -w "$TEXTFILE_DIR" ] || return 0
  tmp="$TEXTFILE_DIR/.sp_autoheal.prom.$$"
  {
    echo '# HELP sp_autoheal_restart_declined_total Unhealthy-engine restarts declined because the engine answered alive on /health.'
    echo '# TYPE sp_autoheal_restart_declined_total counter'
    echo "sp_autoheal_restart_declined_total{reason=\"exec_start_failed\"} $declined_exec_start"
    echo "sp_autoheal_restart_declined_total{reason=\"probe_failed\"} $declined_probe_failed"
    echo '# HELP sp_autoheal_restarts_total Containers autoheal restarted.'
    echo '# TYPE sp_autoheal_restarts_total counter'
    echo "sp_autoheal_restarts_total $restarted"
  } > "$tmp" && mv -f "$tmp" "$TEXTFILE_DIR/sp_autoheal.prom"
}

# Prints "alive" when the engine on host port $1 answers the HEALTHCHECK's own
# verdict within the budget, otherwise a short reason.
engine_verdict() {
  body="$(curl --max-time "$PROBE_BUDGET" -s "http://$PROBE_HOST:$1/health")" || { echo no_answer; return; }
  printf '%s' "$body" | jq -e '.running == true and (.liveness == "ok" or .liveness == "standby")' >/dev/null 2>&1 \
    && { echo alive; return; }
  liveness="$(printf '%s' "$body" | jq -r '.liveness // "malformed"' 2>/dev/null || echo malformed)"
  echo "not_alive:${liveness:-malformed}"
}

restart() {
  id="$1"; name="$2"; why="$3"
  log "Container $name (${id%"${id#????????????}"}) found to be unhealthy ($why) - Restarting container now with ${STOP_TIMEOUT}s timeout"
  if curl --max-time "$((STOP_TIMEOUT + 30))" -sf -X POST --unix-socket "$SOCK" \
      "$API/containers/$id/restart?t=$STOP_TIMEOUT" >/dev/null; then
    restarted=$((restarted + 1))
  else
    log "Restarting container ${id%"${id#????????????}"} failed"
  fi
}

pass() {
  filters="%7B%22health%22%3A%5B%22unhealthy%22%5D%2C%22label%22%3A%5B%22$LABEL%3Dtrue%22%5D%7D"
  list="$(docker_get "/containers/json?filters=$filters")" || { log "could not list unhealthy containers"; return; }
  for id in $(printf '%s' "$list" | jq -r '.[].Id'); do
    inspect="$(docker_get "/containers/$id/json")" || { log "could not inspect $id"; continue; }
    name="$(printf '%s' "$inspect" | jq -r '.Name // "unknown"')"
    [ "$(printf '%s' "$inspect" | jq -r '.State.Health.Status // ""')" = unhealthy ] || continue
    host_port="$(printf '%s' "$inspect" | jq -r --arg p "$ENGINE_PORT/tcp" '.NetworkSettings.Ports[$p][0].HostPort // empty' 2>/dev/null)"
    if [ -z "$host_port" ]; then
      restart "$id" "$name" "no published engine port to ask"
      continue
    fi
    last_output="$(printf '%s' "$inspect" | jq -r '[.State.Health.Log[]? | .Output] | last // ""')"
    verdict="$(engine_verdict "$host_port")"
    if [ "$verdict" = alive ]; then
      case "$last_output" in
        *"timed out starting health check"*)
          declined_exec_start=$((declined_exec_start + 1))
          reason=exec_start_failed ;;
        *)
          declined_probe_failed=$((declined_probe_failed + 1))
          reason=probe_failed ;;
      esac
      log "Container $name is marked unhealthy but answered alive on /health ($reason) - restart declined"
    else
      restart "$id" "$name" "/health $verdict"
    fi
  done
  write_counters
}

[ "$ONCE" = 1 ] || { log "Monitoring containers for unhealthy status in $START_PERIOD second(s)"; sleep "$START_PERIOD"; }
while :; do
  pass
  [ "$ONCE" = 1 ] && exit 0
  sleep "$INTERVAL"
done
