# shellcheck shell=bash
# HOST-WIDE ADMISSION QUEUE FOR HEAVY LOCAL JOBS (Dan, 2026-11-19 17:26 Chicago).
#
# WHY. On 2026-11-19 dozens of agents on the 28-core Mac Studio each started
# their own pre-push suite, `npm ci` and vitest run at once. The 1-minute load
# sat between 60 and 90, pre-push gates waited fifteen minutes on the load and
# then failed tests on their 45-second timeouts: the content was fine, the
# machine was not. Nothing bounded how many heavy jobs ran together.
#
# WHAT. A FIFO ticket queue shared by every worktree on the machine. A heavy
# job takes a ticket, waits until fewer than SLOTS live tickets are ahead of
# it, runs, and gives the ticket back. The ticket files live on the external
# SSD the owner authorized for agent work (AGENT_SSD_USE_AUTHORIZED in the
# main clone's .env; this file reads the variable NAMES it needs and nothing
# else, it never sources the .env).
#
# WHAT IT NEVER DOES. It never skips, shortens or weakens a check: it only
# decides WHEN a check starts. If the queue itself is broken (no writable
# directory, a counter that cannot be taken), it prints one WARNING and the
# job runs at once, exactly as it did before the queue existed (fail open).
#
#   hq_acquire <label>   take a slot (blocks FIFO); always returns 0
#   hq_release           give the slot back (also safe when nothing is held)
#   hq_dir               print the queue directory (or fail)
#   hq_slots             print the number of concurrent heavy jobs
#
# Environment:
#   CA_HEAVY_QUEUE=off            do not queue (the job still runs every check)
#   CA_HEAVY_QUEUE_DIR=<dir>      queue directory (tests); default is ONE fixed
#                                 folder on the boot disk (see hq_dir)
#   CA_HEAVY_QUEUE_LOAD_CEILING=<n>  a free slot waits while the 1-minute load
#                                 is above n AND another heavy job runs
#                                 (default: the core count; 0 = off)
#   CA_HEAVY_QUEUE_LOAD_FILE=<f>  read the 1-minute load from file f (tests)
#   CA_HEAVY_QUEUE_LEGACY_DIRS=<d...>  old queue folders to read (tests; by
#                                 default the pre-2026-11-20 SSD folders)
#   CA_HEAVY_QUEUE_SLOTS=<n>      concurrent heavy jobs (default: cores / 7, min 2)
#   CA_HEAVY_QUEUE_MAX_WAIT=<s>   longest wait before running anyway (default 2700)
#   CA_HEAVY_QUEUE_POLL=<s>       poll interval (default 2)
#   HQ_HELD_TICKET                set while a slot is held; a nested acquire in a
#                                 child (the pre-push hook under agent-push) is a
#                                 no-op, so one push never takes two slots.
# Bash 3.2 compatible (macOS /bin/bash).

hq_say() { printf '[heavy-queue] %s\n' "$*" >&2; }

# The main clone's .env, found from any worktree through the common git dir;
# from another repository on the Mac (World Hub), the Club Arena main clone's,
# so every repository on the machine waits in the same line.
hq_env_file() {
  local common
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [ -n "$common" ] && [ -f "$common/../.env" ] && grep -q '^SSD1_WORK_SHARED_DIR=' "$common/../.env" 2>/dev/null; then
    printf '%s\n' "$common/../.env"
    return 0
  fi
  if [ -f "${HOME:-}/Documents/club-arena/.env" ]; then
    printf '%s\n' "${HOME}/Documents/club-arena/.env"
    return 0
  fi
  return 1
}

# Value of ONE named variable from that .env (never sourced, never printed whole).
hq_env_value() {
  local file
  file=$(hq_env_file) || return 1
  sed -n "s/^$1=//p" "$file" 2>/dev/null | head -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

hq_dir_writable() {
  [ -n "$1" ] || return 1
  mkdir -p "$1/tickets" 2>/dev/null || return 1
  [ -w "$1" ] && [ -w "$1/tickets" ] || return 1
  local probe
  probe=$(mktemp "$1/.probe.XXXXXX" 2>/dev/null) || return 1
  rm -f "$probe"
}

# The queue directory (Horse SWITCH lane, 2026-11-20): ONE fixed folder on the
# boot disk, whatever drives are attached. The tickets are a few hundred bytes
# each; a queue that follows the SSD splits when a drive drops or returns. On
# 2026-11-20 SSD1 dropped at 5:53 PM Chicago: waiters moved to a queue on SSD2,
# the SSD1 tickets (the math-core gate held #121) were stranded, and once SSD1
# came back new jobs queued there while SSD2's still ran - two queues of four
# slots, so up to eight gates at once on a machine that fails tests at four.
# CA_HEAVY_QUEUE_DIR still overrides it (tests).
HQ_STABLE_DIR="${HOME:-/tmp}/.cache/club-arena-heavy-queue"
hq_dir() {
  if [ -n "${CA_HEAVY_QUEUE_DIR:-}" ]; then
    hq_dir_writable "$CA_HEAVY_QUEUE_DIR" || return 1
    printf '%s\n' "$CA_HEAVY_QUEUE_DIR"
    return 0
  fi
  hq_dir_writable "$HQ_STABLE_DIR" || return 1
  printf '%s\n' "$HQ_STABLE_DIR"
}

# The queue folders the code before 2026-11-20 used (SSD1 shared work area,
# SSD2 work area). A job an older checkout admitted there still loads the
# machine, so its live RUNNING tickets count against the slots here until those
# checkouts are gone. Read only: nothing is written or reaped in them.
hq_legacy_dirs() {
  local base
  if [ -n "${CA_HEAVY_QUEUE_DIR:-}" ] || [ -n "${CA_HEAVY_QUEUE_LEGACY_DIRS+set}" ]; then
    for base in ${CA_HEAVY_QUEUE_LEGACY_DIRS:-}; do printf '%s\n' "$base"; done
    return 0
  fi
  for base in "$(hq_env_value SSD1_WORK_SHARED_DIR)" "$(hq_env_value SSD2_WORK_DIR)"; do
    [ -n "$base" ] && [ -d "$base/heavy-queue/tickets" ] && printf '%s\n' "$base/heavy-queue"
  done
  return 0
}

hq_legacy_running() {
  local d t n=0
  while IFS= read -r d; do
    [ -n "$d" ] && [ "$d" != "${HQ_STABLE_DIR:-}" ] || continue
    for t in "$d"/tickets/*; do
      case "$t" in *.run | *'*') continue ;; esac
      [ -f "$t" ] && [ -f "$t.run" ] && hq_ticket_alive "$t" && n=$((n + 1))
    done
  done <<EOF
$(hq_legacy_dirs)
EOF
  printf '%s\n' "$n"
}

hq_cores() {
  local n
  n=$(sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
  case "$n" in '' | *[!0-9]*) n=4 ;; esac
  printf '%s\n' "$n"
}

# Concurrent heavy jobs. One vitest run spreads over about seven cores of this
# machine (its worker pool plus node and esbuild), so cores / 7: four on the
# 28-core Mac Studio, never fewer than two.
hq_slots() {
  local s=${CA_HEAVY_QUEUE_SLOTS:-}
  case "$s" in '' | *[!0-9]*) s=$(( $(hq_cores) / 7 )) ;; esac
  [ "$s" -ge 1 ] 2>/dev/null || s=1
  if [ -z "${CA_HEAVY_QUEUE_SLOTS:-}" ] && [ "$s" -lt 2 ]; then s=2; fi
  printf '%s\n' "$s"
}

# The 1-minute load average (macOS vm.loadavg, Linux /proc/loadavg); fails when unknown.
hq_load1() {
  local l=
  if [ -n "${CA_HEAVY_QUEUE_LOAD_FILE:-}" ]; then
    l=$(head -n 1 "$CA_HEAVY_QUEUE_LOAD_FILE" 2>/dev/null | tr -d ' ')
  else
    l=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk '{ print $1 }')
    [ -n "$l" ] || l=$(awk '{ print $1 }' /proc/loadavg 2>/dev/null)
  fi
  case "$l" in '' | *[!0-9.]*) return 1 ;; esac
  printf '%s\n' "$l"
}

# Above this 1-minute load a free slot is held while another heavy job runs.
# Default: one runnable process per core. Measured 2026-11-20: four admitted
# gates kept the load at 23-53 on 28 cores and each run failed a different
# 30-second harness timeout; slots alone cannot see the load other work adds.
hq_load_ceiling() {
  local c=${CA_HEAVY_QUEUE_LOAD_CEILING:-}
  case "$c" in '' | *[!0-9]*) c=$(hq_cores) ;; esac
  printf '%s\n' "$c"
}

# True when the ceiling is off, the load is unknown, or the load is at or under it.
hq_load_ok() {
  local c l
  c=$(hq_load_ceiling)
  [ "$c" -gt 0 ] 2>/dev/null || return 0
  l=$(hq_load1) || return 0
  awk -v l="$l" -v c="$c" 'BEGIN { exit !(l + 0 <= c + 0) }'
}

# Run lengths (seconds) of the last finished heavy jobs, for the waiting ETA.
hq_record_run() {
  local t=$1 began q h
  began=$(cat "$t.run" 2>/dev/null)
  case "$began" in '' | *[!0-9]*) return 0 ;; esac
  q=$(dirname "$(dirname "$t")")
  h="$q/history"
  printf '%s\n' "$(( $(date +%s) - began ))" >> "$h" 2>/dev/null || return 0
  if [ "$(wc -l < "$h" 2>/dev/null | tr -d ' ')" -gt 60 ] 2>/dev/null; then
    tail -n 40 "$h" > "$h.$$" 2>/dev/null && mv -f "$h.$$" "$h" 2>/dev/null
  fi
  return 0
}

# Median recorded run length in seconds; fails when none is recorded.
hq_typical_run() {
  [ -s "$1/history" ] || return 1
  sort -n "$1/history" 2>/dev/null | awk '/^[0-9]+$/ { a[n++] = $1 } END { if (n == 0) exit 1; print a[int((n - 1) / 2)] }'
}

# ", about N min (a heavy job typically runs M min)" for place $2 with $3 slots; empty without history.
hq_eta_note() {
  local typ waves
  typ=$(hq_typical_run "$1") || return 0
  waves=$(( ($2 + $3 - 1) / $3 ))
  printf ', about %s min (a heavy job typically runs %s min)' "$(( (typ * waves + 59) / 60 ))" "$(( (typ + 59) / 60 ))"
}

hq_pid_start() {
  ps -o lstart= -p "$1" 2>/dev/null | awk '{ $1 = $1; print }'
}

hq_field() {
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1
}

# Is the ticket's holder still the process that took it? Dead when the pid is
# gone, or when it now belongs to a later process (start time differs). A ps
# that prints nothing for a live pid (a loaded Mac) counts as alive.
hq_ticket_alive() {
  local pid start now
  pid=$(hq_field "$1" pid)
  start=$(hq_field "$1" start)
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || {
    # EPERM (another user's live process) is alive; ESRCH is gone.
    ps -p "$pid" >/dev/null 2>&1 || return 1
  }
  now=$(hq_pid_start "$pid")
  if [ -n "$start" ] && [ -n "$now" ] && [ "$now" != "$start" ]; then return 1; fi
  return 0
}

# Remove a dead ticket (stale-lock recovery) and say whose it was.
hq_reap() {
  local t=$1
  hq_say "recovered a stale slot: ticket $(basename "$t") ($(hq_field "$t" label), pid $(hq_field "$t" pid)) has no live holder."
  rm -f "$t" "$t.run" 2>/dev/null
}

# A short mutex around the ticket counter (mkdir is atomic). A mutex older
# than 30 seconds belongs to a holder that died inside the critical section.
hq_lock() {
  local q=$1 tries=0 age
  while ! mkdir "$q/mutex" 2>/dev/null; do
    if [ -d "$q/mutex" ]; then
      age=$(stat -c %Y "$q/mutex" 2>/dev/null || stat -f %m "$q/mutex" 2>/dev/null)
      case "$age" in '' | *[!0-9]*) age=$(date +%s) ;; esac
      age=$(( $(date +%s) - age ))
      if [ "$age" -gt 30 ]; then
        rmdir "$q/mutex" 2>/dev/null
        continue
      fi
    else
      return 1
    fi
    tries=$((tries + 1))
    [ "$tries" -gt 300 ] && return 1
    sleep 0.1
  done
  return 0
}

hq_unlock() { rmdir "$1/mutex" 2>/dev/null; }

hq_failopen() {
  hq_say "WARNING: the heavy-job queue is unavailable ($1); running now without it, exactly as before the queue existed. No check is skipped."
  HQ_STATE=failopen
  HQ_TICKET=
}

hq_acquire() {
  local label=${1:-heavy job} q seq slots t other ahead running legacy pos waited=0 last_note=-1 max poll began
  HQ_STATE=
  HQ_TICKET=
  if [ "${CA_HEAVY_QUEUE:-on}" = off ]; then
    hq_say "queue off (CA_HEAVY_QUEUE=off): $label runs now; every check still runs."
    HQ_STATE=off
    return 0
  fi
  if [ -n "${HQ_HELD_TICKET:-}" ] && [ -f "$HQ_HELD_TICKET" ] && hq_ticket_alive "$HQ_HELD_TICKET"; then
    HQ_STATE=nested
    return 0
  fi
  q=$(hq_dir) || { hq_failopen "no writable queue directory"; return 0; }
  [ -n "${HQ_DIR_NOTE:-}" ] && hq_say "note: $HQ_DIR_NOTE"
  hq_lock "$q" || { hq_failopen "could not take the counter mutex in $q"; return 0; }
  seq=$(cat "$q/seq" 2>/dev/null)
  case "$seq" in '' | *[!0-9]*) seq=0 ;; esac
  seq=$((10#$seq + 1))
  t=$(printf '%s/tickets/%012d' "$q" "$seq")
  if ! printf '%s\n' "$seq" > "$q/seq.new" 2>/dev/null || ! mv -f "$q/seq.new" "$q/seq" 2>/dev/null ||
    ! {
      printf 'pid=%s\n' "${HQ_OWNER_PID:-$$}"
      printf 'start=%s\n' "$(hq_pid_start "${HQ_OWNER_PID:-$$}")"
      printf 'label=%s\n' "$label"
      printf 'cwd=%s\n' "$PWD"
      printf 'enqueued=%s\n' "$(date +%s)"
    } > "$t" 2>/dev/null; then
    hq_unlock "$q"
    rm -f "$t" 2>/dev/null
    hq_failopen "could not write a ticket in $q"
    return 0
  fi
  hq_unlock "$q"
  HQ_TICKET=$t
  slots=$(hq_slots)
  max=${CA_HEAVY_QUEUE_MAX_WAIT:-2700}
  poll=${CA_HEAVY_QUEUE_POLL:-2}
  case "$max" in '' | *[!0-9]*) max=2700 ;; esac
  began=$(date +%s)
  while :; do
    if [ ! -f "$t" ]; then
      # Another waiter judged this holder dead (a ps that failed under load).
      # Take a fresh ticket rather than run unqueued.
      hq_say "this ticket was reclaimed; taking a new one."
      hq_acquire "$label"
      return 0
    fi
    ahead=0
    running=0
    for other in "$q"/tickets/*; do
      case "$other" in *.run | *'*') continue ;; esac
      [ "$other" = "$t" ] && break
      [ -f "$other" ] || continue
      if hq_ticket_alive "$other"; then
        ahead=$((ahead + 1))
        [ -f "$other.run" ] && running=$((running + 1))
      else
        hq_reap "$other"
      fi
    done
    legacy=$(hq_legacy_running)
    ahead=$((ahead + legacy))
    running=$((running + legacy))
    # A slot is free, and either nothing heavy runs (never a deadlock: the
    # first job always starts) or the machine is under its load ceiling.
    if [ "$ahead" -lt "$slots" ] && { [ "$running" -eq 0 ] || hq_load_ok; }; then
      date +%s > "$t.run" 2>/dev/null
      HQ_STATE=admitted
      HQ_HELD_TICKET=$t
      export HQ_HELD_TICKET
      [ "$waited" -gt 0 ] && hq_say "admitted $label after ${waited}s."
      return 0
    fi
    if [ "$waited" -ge "$max" ]; then
      date +%s > "$t.run" 2>/dev/null
      HQ_STATE=timeout
      HQ_HELD_TICKET=$t
      export HQ_HELD_TICKET
      hq_say "WARNING: waited ${waited}s (CA_HEAVY_QUEUE_MAX_WAIT) for a slot; running $label now. No check is skipped."
      return 0
    fi
    if [ "$last_note" -lt 0 ] || [ $((waited - last_note)) -ge 60 ]; then
      if [ "$ahead" -lt "$slots" ]; then
        hq_say "a slot is free for $label, but the 1-minute load $(hq_load1 2>/dev/null || echo '?') is above the ceiling $(hq_load_ceiling) while $running heavy job(s) run; holding until the load drops or one finishes (CA_HEAVY_QUEUE_LOAD_CEILING)."
      else
        pos=$((ahead - slots + 1))
        hq_say "waiting for a heavy-job slot for $label: $ahead live jobs ahead of it, $slots run at once; place $pos in the waiting line$(hq_eta_note "$q" "$pos" "$slots") (bash scripts/heavy-queue.sh status)."
      fi
      last_note=$waited
    fi
    sleep "$poll" 2>/dev/null || sleep 2
    waited=$(( $(date +%s) - began ))
  done
}

hq_release() {
  case "${HQ_STATE:-}" in
    admitted | timeout)
      if [ -n "${HQ_TICKET:-}" ]; then
        hq_record_run "$HQ_TICKET"
        rm -f "$HQ_TICKET" "$HQ_TICKET.run" 2>/dev/null
      fi
      if [ "${HQ_HELD_TICKET:-}" = "${HQ_TICKET:-}" ]; then unset HQ_HELD_TICKET; fi
      ;;
  esac
  HQ_STATE=
  HQ_TICKET=
  return 0
}
