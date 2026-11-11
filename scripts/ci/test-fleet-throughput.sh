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
# missing telemetry, and stay quiet on a ticking controller.
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m --memory 256m --cpus 1 \
  -v "$repo_root:/work:ro" --workdir /work/tests/monitoring \
  --entrypoint /bin/promtool \
  quay.io/prometheus/prometheus@sha256:2659f4c2ebb718e7695cb9b25ffa7d6be64db013daba13e05c875451cf51b0d3 \
  test rules fleet-throughput.test.yml break-does-not-silence-its-own-alarms.test.yml \
    fleet-relative-throughput.test.yml lightning-abandoned-and-engine-memory.test.yml \
    mtt-started-late.test.yml engine-release-owner.test.yml database-replies-lost.test.yml \
    reliability-controller-health.test.yml

# The lost-reply alarms reach the operational inbox (2026-11-05): the shipped
# Alertmanager routes a DatabaseRepliesLost warning to codex-inbox and the
# warning email, and a DatabaseWriteRetriesExhausted critical to codex-inbox
# and the critical email. Pinned official image, no network.
route() {
  docker run --rm --network none --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m --memory 256m --cpus 1 \
    -v "$repo_root:/work:ro" --workdir /work/infra/monitoring \
    --entrypoint /bin/amtool \
    quay.io/prometheus/alertmanager@sha256:e13b6ed5cb929eeaee733479dce55e10eb3bc2e9c4586c705a4e8da41e5eacf5 \
    config routes test --config.file=alertmanager.yml "$@"
}
route --verify.receivers=codex-inbox,email-warning \
  alertname=DatabaseRepliesLost severity=warning component=database
route --verify.receivers=codex-inbox,email-critical \
  alertname=DatabaseWriteRetriesExhausted severity=critical component=database \
  rpc=fn_f06_retain_hand_continuation

# The Reliability Controller's own health alerts must reach email
# (2026-11-09): that route is the signal that does not pass through the
# controller. The inbox receives them as well.
route --verify.receivers=codex-inbox,email-critical \
  alertname=ReliabilityControllerStale severity=critical component=reliability-controller
route --verify.receivers=codex-inbox,email-critical \
  alertname=ReliabilityControllerMetricsAbsent severity=critical component=reliability-controller
route --verify.receivers=codex-inbox,email-warning \
  alertname=ReliabilityControllerOutboxStuck severity=warning component=reliability-controller
route --verify.receivers=codex-inbox,email-warning \
  alertname=ReliabilityControllerIntakeRejections severity=warning component=reliability-controller
