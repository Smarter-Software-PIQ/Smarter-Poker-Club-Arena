#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
# Evaluate real rules offline with the monitoring stack's pinned Prometheus.
# break-does-not-silence-its-own-alarms.test.yml (2026-09-26) proves the
# alarms about the break are not muted by the break, and that long durations
# measured across breaks can fire at all.
# fleet-relative-throughput.test.yml (2026-10-15) proves the same-hour
# relative-drop alarm fires on the 2026-10-13 stall shape and stays quiet on
# a quiet hour, a short history, a tiny baseline and inside the break.
# database-replies-lost.test.yml (2026-11-05) proves the lost-reply alarms
# stay quiet on background loss, fire within a minute, split warning from
# critical and resolve after ten quiet minutes.
# reliability-controller-health.test.yml (2026-11-09) proves the controller's
# own health alerts fire on an old heartbeat, on a frozen textfile and on
# missing telemetry, and stay quiet on a ticking controller. Since 2026-11-11
# it also proves Stale names its cause (controller_not_ticking or
# health_textfile_frozen) and that series which existed and then disappear
# page once, as MetricsAbsent.
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m --memory 256m --cpus 1 \
  -v "$repo_root:/work:ro" --workdir /work/tests/monitoring \
  --entrypoint /bin/promtool \
  quay.io/prometheus/prometheus@sha256:2659f4c2ebb718e7695cb9b25ffa7d6be64db013daba13e05c875451cf51b0d3 \
  test rules fleet-throughput.test.yml break-does-not-silence-its-own-alarms.test.yml \
    fleet-relative-throughput.test.yml lightning-abandoned-and-engine-memory.test.yml \
    mtt-started-late.test.yml engine-release-owner.test.yml database-replies-lost.test.yml \
    reliability-controller-health.test.yml

# The Spin stall and human-wait rules against synthetic series (2026-11-11,
# incident f1b14fca): below, at and above the ladder envelope, recovery, the
# post-park morning, empty boards, the break and missing gauges. The fixtures
# sit beside the rules they test; scripts/ci/test-spin-alert-rules-with-fixtures.sh
# runs the same file with a checksummed local promtool.
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m --memory 256m --cpus 1 \
  -v "$repo_root:/work:ro" --workdir /work/infra/monitoring \
  --entrypoint /bin/promtool \
  quay.io/prometheus/prometheus@sha256:2659f4c2ebb718e7695cb9b25ffa7d6be64db013daba13e05c875451cf51b0d3 \
  test rules spin-rules.test.yml

# The lost-reply alarms reach the operational inbox (2026-11-05): the shipped
# Alertmanager routes a DatabaseRepliesLost warning to codex-inbox only (no
# warning email since 2026-11-11, owner decision), and a
# DatabaseWriteRetriesExhausted critical to codex-inbox and the critical
# email. Pinned official image, no network.
route() {
  docker run --rm --network none --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m --memory 256m --cpus 1 \
    -v "$repo_root:/work:ro" --workdir /work/infra/monitoring \
    --entrypoint /bin/amtool \
    quay.io/prometheus/alertmanager@sha256:e13b6ed5cb929eeaee733479dce55e10eb3bc2e9c4586c705a4e8da41e5eacf5 \
    config routes test --config.file=alertmanager.yml "$@"
}
route --verify.receivers=codex-inbox \
  alertname=DatabaseRepliesLost severity=warning component=database
route --verify.receivers=codex-inbox,email-critical \
  alertname=DatabaseWriteRetriesExhausted severity=critical component=database \
  rpc=fn_f06_retain_hand_continuation

# The Reliability Controller's own critical health alerts must reach email
# (2026-11-09): that route is the signal that does not pass through the
# controller. The inbox receives every one of them. Its warnings reach the
# inbox only (2026-11-11, owner decision: routine warnings send no email).
route --verify.receivers=codex-inbox,email-critical \
  alertname=ReliabilityControllerStale severity=critical component=reliability-controller
route --verify.receivers=codex-inbox,email-critical \
  alertname=ReliabilityControllerMetricsAbsent severity=critical component=reliability-controller
route --verify.receivers=codex-inbox,email-critical \
  alertname=ReliabilityControllerOutboxStuck severity=critical component=reliability-controller
route --verify.receivers=codex-inbox \
  alertname=ReliabilityControllerIntakeRejections severity=warning component=reliability-controller

# Representative label sets (2026-11-11): a warning cannot fall through to the
# top-level email-critical receiver, info and canary send nothing beyond the
# inbox, and a legacy page=sms label keeps its inbox webhook.
route --verify.receivers=codex-inbox alertname=HostHighCpu component=host severity=warning
route --verify.receivers=codex-inbox,null-receiver alertname=HostInfo component=host severity=info
route --verify.receivers=null-receiver alertname=MonitoringCanary severity=canary
route --verify.receivers=codex-inbox alertname=TournamentNeverStarted component=tournament severity=warning
route --verify.receivers=pager-sms,email-critical \
  alertname=ClusterPassErrors component=cluster severity=critical page=sms
route --verify.receivers=pager-sms alertname=ClusterPassSlow component=cluster severity=warning page=sms
