#!/usr/bin/env bash
#
# collect-monitoring-health.sh - emits the money, settlement and cron gauges
# that fifteen alert rules were already written against.
#
# On 2026-09-04 three incidents produced fifteen rules across alert-rules.yml
# and slo-rules.yml: settlement failure rate, the money-alert backlog, the
# undeclared-trigger register, and pg_cron/Open Claw liveness. Every one of
# them was written as `metric > threshold`. None of the metrics had a producer.
# An absent metric compared against a threshold yields an empty vector in
# PromQL, which is indistinguishable from healthy: the rules loaded, showed
# green, and could not fire. They stayed that way for seven days while four of
# the conditions they describe were true.
#
# This script is that producer. It runs OUTSIDE the engine container on
# purpose. The engine's own /metrics would be the shorter path, but a collector
# that dies with the process it watches cannot report on it, and every gauge
# here describes database state that matters whether or not the engine is up.
# It also keeps this work off the authoritative event loop, which is single
# threaded and already the scarcest resource on the box.
#
# Output is a node_exporter textfile, the same mechanism verify-recovery-stack.sh
# already uses. Writes are atomic (write to $OUT.$$, then mv).
#
# FAIL CLOSED: on any error this exits non-zero and LEAVES THE OLD FILE ALONE.
# The file's embedded collection timestamp then ages, the *_stale_seconds
# recording rules climb, and CronMetricsBlind / MoneyHealthBlind /
# SettlementMetricsBlind fire. A collector that cannot read the database must
# never publish a zero: a zero here is an all-clear it has not earned.
#
# Credentials are read from the engine's existing environment file. This script
# does not create, rotate, or embed any credential.
#
# Usage:  collect-monitoring-health.sh        # write the textfile, or fail
#         DRY_RUN=1 collect-monitoring-health.sh   # print, write nothing

set -uo pipefail

ENV_FILE="${ENGINE_ENV_FILE:-/opt/club-arena/server/.env}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/node-exporter-textfile}"
OUT="${OUT:-$TEXTFILE_DIR/club_arena_money_health.prom}"
TIMEOUT_SEC="${TIMEOUT_SEC:-25}"
SETTLEMENT_WINDOW_MINUTES="${SETTLEMENT_WINDOW_MINUTES:-5}"

die() { printf 'collect-monitoring-health: %s\n' "$1" >&2; exit 1; }

[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE (set ENGINE_ENV_FILE)"

# Read only the two keys needed, without sourcing the file: the engine env
# carries values with characters that a `source` would execute.
read_key() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" \
    | tail -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/[[:space:]]*$//'
}

SUPABASE_URL="$(read_key SUPABASE_URL)"
SERVICE_KEY="$(read_key SUPABASE_SERVICE_ROLE_KEY)"
[ -n "$SUPABASE_URL" ] || die "SUPABASE_URL is not set in $ENV_FILE"
[ -n "$SERVICE_KEY" ] || die "SUPABASE_SERVICE_ROLE_KEY is not set in $ENV_FILE"
SUPABASE_URL="${SUPABASE_URL%/}"

BODY=$(curl -sS --max-time "$TIMEOUT_SEC" \
  -X POST "$SUPABASE_URL/rest/v1/rpc/fn_monitoring_health_snapshot" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d "{\"p_window_minutes\": $SETTLEMENT_WINDOW_MINUTES}" 2>&1) \
  || die "RPC call failed: $BODY"

RENDERED=$(COLLECTED_AT="$(date +%s)" python3 - "$BODY" <<'PY'
import json, os, sys

raw = sys.argv[1]
try:
    payload = json.loads(raw)
except Exception as exc:
    sys.stderr.write(f"response was not JSON: {exc}: {raw[:300]}\n")
    sys.exit(1)

if isinstance(payload, dict) and payload.get("message"):
    sys.stderr.write(f"PostgREST error: {payload.get('message')}\n")
    sys.exit(1)
if isinstance(payload, list):
    if not payload:
        sys.stderr.write("snapshot returned no rows\n")
        sys.exit(1)
    row = payload[0]
elif isinstance(payload, dict):
    row = payload
else:
    sys.stderr.write(f"unexpected snapshot shape: {type(payload).__name__}\n")
    sys.exit(1)

# name -> (column, help, prometheus type)
GAUGES = [
    ("poker_settlement_failure_rate", "settlement_failure_rate",
     "Share of terminal settlements in the window that ended failed (0 to 1)."),
    ("poker_settlement_window_hands", "settlement_window_hands",
     "Settlements that reached final in the window."),
    ("poker_settlement_stuck", "settlement_stuck",
     "Settlements in the window that are neither final nor failed."),
    ("poker_money_undeclared_triggers", "money_undeclared_triggers",
     "Live triggers on money or seat tables with no row in ca_declared_money_triggers."),
    ("poker_financial_alerts_unresolved", "financial_alerts_unresolved",
     "Unresolved rows in financial_alerts."),
    ("poker_financial_alerts_stale_critical", "financial_alerts_stale_critical",
     "Unresolved critical financial alerts older than 24 hours."),
    ("poker_financial_alerts_distinct_conditions", "financial_alerts_distinct_conditions",
     "Distinct sources among unresolved financial alerts."),
    ("poker_cron_pg_runs", "cron_pg_runs",
     "pg_cron job runs started in the last hour."),
    ("poker_cron_pg_failures", "cron_pg_failures",
     "pg_cron job runs in the last hour that did not succeed."),
    ("poker_cron_openclaw_stale", "cron_openclaw_stale",
     "Open Claw jobs past their own staleness threshold."),
    ("poker_cron_openclaw_worst_silence_minutes", "cron_openclaw_worst_silence_minutes",
     "Minutes since the last success of the most silent STALE Open Claw job."),
    ("poker_cron_jobs_skipping_all_work", "cron_jobs_skipping_all_work",
     "Jobs whose latest logged success skipped all their work and which have done none in 24h."),
]

lines = []
missing = []
for metric, column, help_text in GAUGES:
    if column not in row or row[column] is None:
        # failure_rate is NULL when nothing settled at all; that is a real
        # reading, not a gap, and 0 failures out of 0 is a 0 rate.
        if column == "settlement_failure_rate":
            value = 0.0
        else:
            missing.append(column)
            continue
    else:
        value = row[column]
    try:
        value = float(value)
    except (TypeError, ValueError):
        missing.append(column)
        continue
    lines.append(f"# HELP {metric} {help_text}")
    lines.append(f"# TYPE {metric} gauge")
    lines.append(f"{metric} {value:g}")

if missing:
    sys.stderr.write("snapshot is missing column(s): " + ", ".join(missing) + "\n")
    sys.exit(1)

collected = int(os.environ["COLLECTED_AT"])
lines.append("# HELP poker_health_collected_timestamp_seconds Unix time of the last successful money, settlement and cron health collection.")
lines.append("# TYPE poker_health_collected_timestamp_seconds gauge")
lines.append(f"poker_health_collected_timestamp_seconds {collected}")
print("\n".join(lines))
PY
) || die "could not render the snapshot"

# ── Client error gauges (2026-10-03) ─────────────────────────────────────
# What players' browsers report through public.fn_report_client_errors, read
# back as three gauges for the ClientErrorSpike alert. This half is NOT fail
# closed, on purpose: the money, settlement and cron gauges above must never be
# withheld because the client-error read failed, so a failure here only drops
# these series and sets poker_client_error_collect_ok to 0.
CLIENT_BODY=$(curl -sS --max-time "$TIMEOUT_SEC" \
  -X POST "$SUPABASE_URL/rest/v1/rpc/fn_client_error_health" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{}' 2>&1) || CLIENT_BODY=''
CLIENT_RENDERED=$(python3 - "$CLIENT_BODY" <<'PY'
import json, sys

GAUGES = [
    ("poker_client_errors_10m", "client_errors_10m",
     "Client errors reported by players' browsers in the last 10 minutes (occurrences, automated sessions excluded)."),
    ("poker_client_error_users_10m", "client_error_users_10m",
     "Distinct players who reported any client error in the last 10 minutes."),
    ("poker_client_error_top_code_users_10m", "client_error_top_code_users_10m",
     "Distinct players who hit the single most widespread client error code in the last 10 minutes."),
]

lines = []
collected = 1
try:
    payload = json.loads(sys.argv[1])
    row = payload[0] if isinstance(payload, list) else payload
    for metric, column, help_text in GAUGES:
        value = float(row[column])
        lines += [f"# HELP {metric} {help_text}", f"# TYPE {metric} gauge", f"{metric} {value:g}"]
except Exception as exc:
    sys.stderr.write(f"collect-monitoring-health: client error gauges skipped: {exc}\n")
    lines = []
    collected = 0
# A FREEZE REFUSAL IS COUNTED BY NAME (2026-11-07, migration 20261107210000).
# Real players refused by the maintenance freeze, read for the info alert
# PlayersRefusedDuringFreeze. Optional on purpose: a database that predates the
# migration has no such columns, and that must never drop the three gauges
# above, so these two are rendered only when both columns are present.
FREEZE_GAUGES = [
    ("poker_client_freeze_refusals_10m", "freeze_refusals_10m",
     "Entries refused by the maintenance freeze in real players' browsers in the last 10 minutes (occurrences; automated sessions and horses excluded)."),
    ("poker_client_freeze_refusal_users_10m", "freeze_refusal_users_10m",
     "Distinct real players refused by the maintenance freeze in the last 10 minutes."),
]
if collected:
    try:
        freeze_lines = []
        for metric, column, help_text in FREEZE_GAUGES:
            value = float(row[column])
            freeze_lines += [f"# HELP {metric} {help_text}", f"# TYPE {metric} gauge", f"{metric} {value:g}"]
        lines += freeze_lines
    except Exception as exc:
        sys.stderr.write(f"collect-monitoring-health: freeze refusal gauges skipped: {exc}\n")
lines += [
    "# HELP poker_client_error_collect_ok 1 when the client error gauges were read this run, else 0.",
    "# TYPE poker_client_error_collect_ok gauge",
    f"poker_client_error_collect_ok {collected}",
]
print("\n".join(lines))
PY
) || CLIENT_RENDERED='poker_client_error_collect_ok 0'
RENDERED="$RENDERED
$CLIENT_RENDERED"

# ── Repeatedly failing pg_cron jobs (2026-11-07) ─────────────────────────
# pg_cron job 117 failed every run for hours while the fleet gauge above only
# said "N failures in the last hour". public.fn_cron_failing_jobs() names each
# job failing repeatedly (>= 3 failed runs in a row for >= 10 minutes, or 18
# of its last 20 runs over >= 10 minutes); this renders one labelled series
# per job so PgCronJobFailingRepeatedly can say which. NOT fail closed, like
# the client error half: a database without the function (it predates
# migration 20261108020000) or a failed read drops these series and sets
# poker_cron_failing_collect_ok to 0, never the gauges above.
CRON_FAILING_BODY=$(curl -sS --max-time "$TIMEOUT_SEC" \
  -X POST "$SUPABASE_URL/rest/v1/rpc/fn_cron_failing_jobs" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{}' 2>&1) || CRON_FAILING_BODY=''
CRON_FAILING_RENDERED=$(python3 - "$CRON_FAILING_BODY" <<'PY'
import json, re, sys

def label(value):
    text = re.sub(r"[\x00-\x1f]", " ", str(value))[:120]
    return text.replace("\\", "\\\\").replace('"', '\\"')

lines = []
ok = 1
try:
    rows = json.loads(sys.argv[1])
    if not isinstance(rows, list):
        raise ValueError(f"expected a list, got {type(rows).__name__}")
    series = []
    for row in rows:
        name = label(row["jobname"])
        guard = "true" if row.get("is_guard") else "false"
        streak = float(row.get("failed_in_a_row") or 0)
        failed_of_20 = float(row.get("failed_of_last_20") or 0)
        series.append(f'poker_cron_job_failing_streak{{jobname="{name}",guard="{guard}"}} {streak:g}')
        series.append(f'poker_cron_job_failing_of_last_20{{jobname="{name}",guard="{guard}"}} {failed_of_20:g}')
    lines += [
        "# HELP poker_cron_jobs_failing_repeatedly pg_cron jobs failing repeatedly (fn_cron_failing_jobs).",
        "# TYPE poker_cron_jobs_failing_repeatedly gauge",
        f"poker_cron_jobs_failing_repeatedly {len(rows)}",
        "# HELP poker_cron_job_failing_streak Consecutive failed runs of a pg_cron job that is failing repeatedly; one series per failing job.",
        "# TYPE poker_cron_job_failing_streak gauge",
    ] + [s for s in series if s.startswith("poker_cron_job_failing_streak")] + [
        "# HELP poker_cron_job_failing_of_last_20 Failed runs among the last 20 of a pg_cron job that is failing repeatedly.",
        "# TYPE poker_cron_job_failing_of_last_20 gauge",
    ] + [s for s in series if s.startswith("poker_cron_job_failing_of_last_20")]
except Exception as exc:
    sys.stderr.write(f"collect-monitoring-health: cron failing-job gauges skipped: {exc}\n")
    lines = []
    ok = 0
lines += [
    "# HELP poker_cron_failing_collect_ok 1 when fn_cron_failing_jobs was read this run, else 0.",
    "# TYPE poker_cron_failing_collect_ok gauge",
    f"poker_cron_failing_collect_ok {ok}",
]
print("\n".join(lines))
PY
) || CRON_FAILING_RENDERED='poker_cron_failing_collect_ok 0'
RENDERED="$RENDERED
$CRON_FAILING_RENDERED"

# ── Reliability Controller health (2026-11-09) ───────────────────────────
# The Reliability Controller (smarter_private.reliability_*, pg_cron job
# reliability-controller-tick) lives in the same database as the inbox and the
# Messenger it reports through, so it cannot be the thing that says it has
# stopped. public.fn_reliability_controller_health() is read here and published
# for the ReliabilityController* rules in infra/monitoring/recovery-rules.yml,
# whose email route does not pass through the controller.
#
# NOT fail closed, like the two halves above, and all or nothing: a database
# without the function, a failed read, a heartbeat that has never ticked or an
# answer missing any column drops every reliability_controller_* series except
# _collect_ok, and ReliabilityControllerMetricsAbsent turns that absence into
# an email. Nothing here publishes a zero it did not read.
#
# The heartbeat is published twice on purpose. _age_seconds is the database's
# own reading at collection time. _timestamp_seconds lets Prometheus keep
# counting when this script stops refreshing the file (the fail-closed half
# above leaves the old file in place when the database cannot be reached), so
# a frozen file cannot hold the age at its last healthy value.
RELIABILITY_BODY=$(curl -sS --max-time "$TIMEOUT_SEC" \
  -X POST "$SUPABASE_URL/rest/v1/rpc/fn_reliability_controller_health" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{}' 2>&1) || RELIABILITY_BODY=''
RELIABILITY_RENDERED=$(python3 - "$RELIABILITY_BODY" <<'PY'
import json, math, sys

NOTIFY_MODES = ("observe", "critical_only", "all")
# metric, column, help
GAUGES = [
    ("reliability_controller_heartbeat_age_seconds", "heartbeat_age_seconds",
     "Seconds since smarter_private.reliability_tick last wrote its heartbeat, read by the database at collection time."),
    ("reliability_controller_heartbeat_timestamp_seconds", "heartbeat_at_unix",
     "Unix time of the last smarter_private.reliability_tick heartbeat."),
    ("reliability_controller_notifications_queued", "notifications_queued",
     "Reliability Controller notifications in state queued (not yet delivered to the Messenger)."),
    ("reliability_controller_notifications_failed_24h", "notifications_failed_24h",
     "Reliability Controller notifications created in the last 24 hours that ended in state failed."),
    ("reliability_controller_intake_rejections_24h", "intake_rejections_24h",
     "Rows written to smarter_private.reliability_intake_rejections in the last 24 hours."),
]

lines = []
ok = 1
try:
    payload = json.loads(sys.argv[1])
    if isinstance(payload, list):
        if len(payload) != 1:
            raise ValueError(f"expected one row, got {len(payload)}")
        row = payload[0]
    else:
        row = payload
    if not isinstance(row, dict) or "heartbeat_age_seconds" not in row:
        raise ValueError(f"not a health row: {str(payload)[:200]}")
    rendered = []
    for metric, column, help_text in GAUGES:
        if row.get(column) is None:
            raise ValueError(f"{column} is missing or null")
        value = float(row[column])
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"{column} is not a non-negative number: {row[column]!r}")
        rendered += [f"# HELP {metric} {help_text}", f"# TYPE {metric} gauge", f"{metric} {value:.10g}"]
    paused = row.get("mutation_paused")
    if not isinstance(paused, bool):
        raise ValueError(f"mutation_paused is not a boolean: {paused!r}")
    mode = row.get("notify_mode")
    if mode not in NOTIFY_MODES:
        raise ValueError(f"notify_mode is not a known mode: {mode!r}")
    rendered += [
        "# HELP reliability_controller_mutation_paused 1 when smarter_private.reliability_settings.mutation_paused is true, else 0.",
        "# TYPE reliability_controller_mutation_paused gauge",
        f"reliability_controller_mutation_paused {1 if paused else 0}",
        "# HELP reliability_controller_notify_mode 1 on the series whose mode label is smarter_private.reliability_settings.notify_mode, 0 on the others.",
        "# TYPE reliability_controller_notify_mode gauge",
    ] + [f'reliability_controller_notify_mode{{mode="{m}"}} {1 if m == mode else 0}' for m in NOTIFY_MODES]
    lines = rendered
except Exception as exc:
    sys.stderr.write(f"collect-monitoring-health: reliability controller gauges skipped: {exc}\n")
    lines = []
    ok = 0
lines += [
    "# HELP reliability_controller_collect_ok 1 when fn_reliability_controller_health was read this run, else 0.",
    "# TYPE reliability_controller_collect_ok gauge",
    f"reliability_controller_collect_ok {ok}",
]
print("\n".join(lines))
PY
) || RELIABILITY_RENDERED='reliability_controller_collect_ok 0'
RENDERED="$RENDERED
$RELIABILITY_RENDERED"

# ── Engine release owner gauges (2026-11-06) ─────────────────────────────
# On 2026-11-05 release transaction 42099609162-1 sat as the runtime owner for
# 2 h 36 m, systemd restarted it 222 times, and five newer releases refused to
# compete with it. Nothing on /metrics could see it: the owner is a host
# systemd unit, not engine state. These gauges name every release unit that
# is not inactive, how long it has held that state and how often systemd has
# restarted it, so EngineReleaseOwnerStale and EngineReleaseOwnerLooping can
# name the run. Like the client error half this is NOT fail closed: a host
# without systemctl drops these series and sets the _collect_ok gauge to 0.
RELEASE_RENDERED=$(RELEASE_UNIT_GLOB="${RELEASE_UNIT_GLOB:-club-arena-engine-release-v1@*.service}" \
  python3 - <<'PY'
import os, re, subprocess, sys, time

def show(unit):
    out = subprocess.run(
        ["systemctl", "show", unit, "--property=ActiveState,SubState,NRestarts,StateChangeTimestampMonotonic"],
        capture_output=True, text=True, timeout=10, check=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)

lines = []
ok = 1
try:
    listing = subprocess.run(
        ["systemctl", "list-units", "--all", "--plain", "--no-legend", "--no-pager",
         os.environ["RELEASE_UNIT_GLOB"]],
        capture_output=True, text=True, timeout=10, check=True).stdout
    units = [line.split()[0] for line in listing.splitlines() if line.strip()]
    counts = {"active": 0, "activating": 0, "auto-restart": 0, "failed": 0}
    owners = []
    # CLOCK_MONOTONIC in microseconds is the clock systemd stamps
    # StateChangeTimestampMonotonic with.
    now_us = int(time.clock_gettime(time.CLOCK_MONOTONIC) * 1_000_000)
    for unit in units:
        match = re.fullmatch(r"club-arena-engine-release-v1@([0-9]+-[0-9]+)\.service", unit)
        if not match:
            continue
        props = show(unit)
        state, sub = props.get("ActiveState", ""), props.get("SubState", "")
        bucket = "auto-restart" if sub == "auto-restart" else state
        if bucket in counts:
            counts[bucket] += 1
        if bucket in ("active", "activating", "auto-restart"):
            changed = int(props.get("StateChangeTimestampMonotonic") or 0)
            age = max(0, (now_us - changed) // 1_000_000) if changed else 0
            owners.append((match.group(1), bucket, age, int(props.get("NRestarts") or 0)))
    lines += ["# HELP club_arena_engine_release_units Engine release transaction units by state.",
              "# TYPE club_arena_engine_release_units gauge"]
    for bucket, value in counts.items():
        lines.append(f'club_arena_engine_release_units{{state="{bucket}"}} {value}')
    lines += ["# HELP club_arena_engine_release_owner_age_seconds Seconds a non-inactive release unit has held its current state.",
              "# TYPE club_arena_engine_release_owner_age_seconds gauge"]
    for run, bucket, age, _ in owners:
        lines.append(f'club_arena_engine_release_owner_age_seconds{{run="{run}",state="{bucket}"}} {age}')
    lines += ["# HELP club_arena_engine_release_owner_restarts Times systemd restarted a non-inactive release unit.",
              "# TYPE club_arena_engine_release_owner_restarts gauge"]
    for run, bucket, _, restarts in owners:
        lines.append(f'club_arena_engine_release_owner_restarts{{run="{run}",state="{bucket}"}} {restarts}')
except Exception as exc:
    sys.stderr.write(f"collect-monitoring-health: release owner gauges skipped: {exc}\n")
    lines = []
    ok = 0
lines += ["# HELP club_arena_engine_release_collect_ok 1 when the release owner gauges were read this run, else 0.",
          "# TYPE club_arena_engine_release_collect_ok gauge",
          f"club_arena_engine_release_collect_ok {ok}"]
print("\n".join(lines))
PY
) || RELEASE_RENDERED='club_arena_engine_release_collect_ok 0'
RENDERED="$RENDERED
$RELEASE_RENDERED"

# The relative cash baseline must not compare different installed admission
# contracts. An owner-approved pace change is not a loss of dealing capacity.
# This catalog-only RPC follows the installed function, including a body change
# at the same migration version. Failure is unknown, never fingerprint zero.
CASH_POLICY_BODY=$(curl -sS --max-time "$TIMEOUT_SEC" \
  -X POST "$SUPABASE_URL/rest/v1/rpc/fn_lightning_admission_policy" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' -d '{}' 2>&1) || CASH_POLICY_BODY=''
CASH_POLICY_RENDERED=$(python3 - "$CASH_POLICY_BODY" <<'PY'
import json, sys
lines = []
ok = 0
try:
    rows = json.loads(sys.argv[1])
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError('policy row is unavailable')
    fingerprint = rows[0].get('fingerprint')
    if type(fingerprint) is not int or not 0 <= fingerprint < 2**52:
        raise ValueError('policy fingerprint is unavailable')
    lines = ['# HELP poker_lightning_admission_policy_fingerprint Exact 52-bit installed admission-definition cohort; not a numeric capacity.',
             '# TYPE poker_lightning_admission_policy_fingerprint gauge',
             f'poker_lightning_admission_policy_fingerprint {fingerprint:d}']
    ok = 1
except Exception as exc:
    sys.stderr.write(f'collect-monitoring-health: cash admission policy unavailable: {exc}\n')
lines += ['# HELP poker_lightning_admission_policy_collect_ok 1 when the installed admission contract was read this run, else 0.',
          '# TYPE poker_lightning_admission_policy_collect_ok gauge',
          f'poker_lightning_admission_policy_collect_ok {ok}']
print('\n'.join(lines))
PY
) || CASH_POLICY_RENDERED='poker_lightning_admission_policy_collect_ok 0'
RENDERED="$RENDERED
$CASH_POLICY_RENDERED"

if [ -n "${DRY_RUN:-}" ]; then
  printf '%s\n' "$RENDERED"
  exit 0
fi

mkdir -p "$TEXTFILE_DIR" || die "cannot create $TEXTFILE_DIR"
TMP="$OUT.$$"
printf '%s\n' "$RENDERED" > "$TMP" || { rm -f "$TMP"; die "cannot write $TMP"; }
mv -f "$TMP" "$OUT" || { rm -f "$TMP"; die "cannot move $TMP to $OUT"; }
