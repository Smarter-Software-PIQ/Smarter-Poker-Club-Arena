# Reliability Controller: Independent Health Signal

The Reliability Controller is a set of Postgres objects
(`smarter_private.reliability_*`) ticked every minute by pg_cron job `reliability-controller-tick`. It reports through the
inbox and the Messenger in the same database, so it cannot be the thing that
says it has stopped. This document describes the path that says so for it:
Prometheus and Alertmanager on the Hetzner engine host, whose critical email
route to admin@smarter.poker does not pass through the controller.

## Path

```
smarter_private.reliability_heartbeat / _notifications / _intake_rejections / _settings
  -> public.fn_reliability_controller_health()        (service_role only)
  -> server/scripts/collect-monitoring-health.sh      (engine host, every 60 s,
                                                       club-arena-money-health.timer)
  -> /var/lib/node-exporter-textfile/club_arena_money_health.prom
  -> node_exporter (scrape job node_engine01, 15 s)
  -> Prometheus rules, group reliability-controller in infra/monitoring/recovery-rules.yml
  -> Alertmanager: codex-inbox, plus email-critical for the critical ones
```

`infra/monitoring/cron-health-server.js` is not part of this path. It reads
systemd timers on cron-01, runs no database query and is not a scrape target
in `prometheus.yml`. Database facts reach Prometheus only through
`collect-monitoring-health.sh`, which calls PostgREST RPCs in schema `public`
with the engine's service key. It cannot read `smarter_private` directly, so
one public function is required.

## The Database Function

`public.fn_reliability_controller_health()` is created by migration
`20261110045731_reliability_controller_health_function_and_seed_corrections`.
It returns one row (`heartbeat_at_unix`, `heartbeat_age_seconds`,
`notifications_queued`, `notifications_failed_24h`, `intake_rejections_24h`,
`mutation_paused`, `notify_mode`), reads only, and is declared the way the
collector's other read (`fn_cron_failing_jobs`) is: `LANGUAGE sql`, `STABLE`,
`SECURITY DEFINER` with a fixed `search_path`, EXECUTE for `service_role`
only.

- The migration requires Stage B (`20261110000020`). Applied ahead of it, it
  raises, names the missing objects and changes nothing.
- A heartbeat that has never ticked stays NULL. The collector treats NULL as
  unreadable and publishes nothing, which the absent rule reports.
- `notifications_queued` counts state `queued` only. `rate_limited` rows are a
  deliberate hold by `max_dm_per_hour` and are left out so a busy hour is not
  reported as a stuck outbox.

The same migration seeds the four alert names below in
`smarter_private.reliability_alert_classes` as `monitoring_self` with
`is_incident` false, and applies the corrections from
`EXTERNAL-PRODUCERS.md`. Native proof:
`scripts/ci/test-reliability-controller-health.py`.

## What Is Measured

| Metric                                               | Meaning                                                                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reliability_controller_heartbeat_age_seconds`       | Seconds since `smarter_private.reliability_tick()` last wrote `smarter_private.reliability_heartbeat`, as the database read it at collection time. |
| `reliability_controller_heartbeat_timestamp_seconds` | Unix time of that heartbeat. Lets Prometheus keep counting when the file stops being refreshed.                                                    |
| `reliability_controller_notifications_queued`        | Notifications in state `queued`.                                                                                                                   |
| `reliability_controller_notifications_failed_24h`    | Notifications created in the last 24 hours that ended `failed` (five refused attempts).                                                            |
| `reliability_controller_intake_rejections_24h`       | Rows in `smarter_private.reliability_intake_rejections` from the last 24 hours.                                                                    |
| `reliability_controller_mutation_paused`             | 1 when `settings.mutation_paused` is true, else 0.                                                                                                 |
| `reliability_controller_notify_mode{mode=...}`       | One series per mode (`observe`, `critical_only`, `all`); 1 on the current mode, 0 on the others.                                                   |
| `reliability_controller_collect_ok`                  | 1 when the collector read the function this run, else 0.                                                                                           |

The collector publishes all of the controller gauges or none of them. A failed
read, a missing function, a NULL heartbeat, a missing column or an unknown
mode drops every series except `reliability_controller_collect_ok`. It never
publishes a zero it did not read.

## Alerts

| Alert                                   | Condition                                                                                                                                                                                                            | Severity |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `ReliabilityControllerStale`            | heartbeat age over 300 s, for 5 m; label `cause` says `controller_not_ticking` (textfile current, database reports the old age) or `health_textfile_frozen` (textfile over 180 s old, last heartbeat over 300 s old) | critical |
| `ReliabilityControllerMetricsAbsent`    | `absent(reliability_controller_heartbeat_age_seconds)` for 15 m                                                                                                                                                      | critical |
| `ReliabilityControllerOutboxStuck`      | queued never zero for 30 m and not lower than 30 m ago, or `failed_24h > 0`, for 5 m                                                                                                                                 | critical |
| `ReliabilityControllerIntakeRejections` | `intake_rejections_24h > 0` for 5 m                                                                                                                                                                                  | warning  |

All four carry `component: reliability-controller`.

### Routing

The first two routes stop only tournament alerts (component `tournament`, or
a name containing tournament, mtt or spin). Since 2026-11-11 (owner decision)
routine warnings send no email: the next route sends every warning without
`page="sms"` to `codex-inbox` and stops, so a warning can never fall through
to the top-level `email-critical` receiver. The route after it sends every
other non-canary alert to `codex-inbox` and continues, and the critical email
route matches on severity alone, so the two critical alerts reach
`codex-inbox` and `email-critical` (repeats hourly) and the two warnings reach
`codex-inbox` only. The `email-warning` receiver remains in the file with no
email configuration and no route, because the monitoring deploy refuses to
remove a receiver name that is live on the box. No inhibit rule targets this
component. `scripts/ci/test-fleet-throughput.sh` and
`infra/monitoring/test-tournament-routes.sh` (run by `deploy.sh` on the box)
assert these receivers with `amtool`.

The `codex-inbox` copy lands in `public.operational_alert_events` and stays
there. The controller's intake opens no incident and queues no notification
for these four names: they are seeded `monitoring_self` with `is_incident`
false. Critical email is the channel outside the controller for the two
critical ones; the two warnings are read in the inbox. Were they incidents, a stopped tick
would queue an escalation it cannot deliver, the growing queue would raise
`ReliabilityControllerOutboxStuck`, and that would queue another. Stage B
already refuses the same loop for its own `ReliabilityDeliveryFailing`
self-signal, and the conditions are still recorded inside the controller by
its self-signals.

Mode and pause state are published but not alerted on. `mutation_paused = 1`
and `notify_mode = observe` are the shipped Stage B settings.

## Limits, Stated Plainly

- **Shared database.** The signal is read from the same database the
  controller runs in. When the database or its REST API cannot be reached, the
  collector fails closed and leaves the previous textfile in place, so the
  gauges do not disappear: they freeze at their last values. The stale rule
  covers this because it also counts from the heartbeat time, so about ten
  minutes after the last tick `ReliabilityControllerStale` fires with
  `cause="health_textfile_frozen"` and is emailed. That cause also covers a
  stopped collector timer: in both, whether the controller is still ticking
  is unknown, and the summary says so instead of claiming it has stopped. The
  textfile's age is `poker_health_collected_timestamp_seconds`, which the
  collector writes into the same atomic file on every successful run. The
  absent rule does not fire in this case.
- **When the absent rule fires.** The first collector read succeeds but the
  controller read does not (function missing or refusing, heartbeat never
  ticked, incomplete answer), or the textfile or node_exporter is gone.
- **Hetzner monitoring down.** Prometheus, Alertmanager, node_exporter and the
  collector all run on the engine host. If that host or its monitoring stack
  is down, nothing evaluates these rules and nothing is sent. No part of this
  signal covers that case.
- **Email delivery.** The email leaves through Resend from Alertmanager. If
  that fails, the existing `CriticalEmailDeliveryFailing` rule is what
  notices, on the same host.
- **A running tick is not a correct tick.** The heartbeat is written even when
  a tick step raised. Step errors are in `smarter_private.reliability_heartbeat.last_result`
  and are raised by the controller's own `ReliabilityTickStepFailing`
  self-signal, not by this path.
- **24 hour windows.** The two warnings stay firing until 24 hours after the
  last failed notification or rejection.

## Deployment Route

Delivery is split into three branches so each part ships as soon as it can
and a rule never runs ahead of the engine that publishes its metric.

**Function, `feat/reliability-controller-health-function`** (migration,
seed, its native test, this document):

1. Stage B (`20261110000020`) is merged and installed first.
2. Migration `20261110045731` installs by the migration route. Like every
   migration it is refused inside the hourly break window (:50 to :03 UTC).

**Collector, `feat/reliability-controller-health-signal`** (the
`collect-monitoring-health.sh` change and its test).
`server/scripts/collect-monitoring-health.sh` is installed on the engine host
by `install-engine-supervisor.sh` as part of an engine release. It is not
shipped by the monitoring workflow. Until the function exists the collector
only reports `reliability_controller_collect_ok 0`.

**Rules, `feat/reliability-controller-health-rules`** (the four rules in
`infra/monitoring/recovery-rules.yml` and their tests). A merge to `main`
touching `infra/monitoring/**` triggers `.github/workflows/deploy-monitoring.yml`,
which copies the stamped payload to the host, runs `deploy.sh`, and reads
Prometheus back with `scripts/ci/check-alert-rules-match.mjs`.

### Precondition For Merging The Rules

Run this in Prometheus (`https://engine.smarter.poker/prometheus`) and merge
the rules branch only when it returns 1:

```promql
count(reliability_controller_heartbeat_age_seconds) == 1 and count(reliability_controller_heartbeat_timestamp_seconds) == 1
```

An empty result means the engine serving the collector is not live yet, or
the function is not installed (`reliability_controller_collect_ok` reads 0 in
that case). Do not merge the rules on an empty result. Why: the read-back in
`deploy-monitoring.yml` fails with RULES AHEAD OF THE ENGINE THAT IS RUNNING
when a rule names a metric the running build does not emit, and
`ReliabilityControllerMetricsAbsent` would email as critical after 15 minutes
and hourly after that for as long as the series is missing. The rules
branch's own pull request checks also need the collector in `main`: check 8 of
`check-monitoring-drift.mjs` requires the collector as the producer.

## Verify After Deploy

In Prometheus (`https://engine.smarter.poker/prometheus`):

```promql
reliability_controller_heartbeat_age_seconds
```

Expect one series with a value under about 120. Then:

```promql
time() - reliability_controller_heartbeat_timestamp_seconds
```

Expect the same order of value, and watch it reset at least once a minute.

```promql
reliability_controller_collect_ok
```

Expect 1.

```promql
count(ALERTS{component="reliability-controller", alertstate="firing"}) or vector(0)
```

Expect 0. The rules are loaded when `/api/v1/rules` lists group
`reliability-controller` with four rules, which the `deploy-monitoring.yml`
read-back already asserts. On the host,
running the installed `collect-monitoring-health.sh` with `DRY_RUN=1` prints
the series without writing the file.

## Regression Protection

Function branch:

- `scripts/ci/test-reliability-controller-health.py` (PostgreSQL 17, workflow
  `reliability-controller-health.yml`) installs the fixture, Stage B and the
  migration and proves the function's row, its grants, the seed as intake
  answers it, the refusal ahead of Stage B and a harmless second install.

Collector branch:

- `tests/collect-monitoring-health-reliability-controller.test.ts` runs the
  real collector against a stand-in `curl`: every gauge is rendered, every
  unreadable answer publishes no controller series and keeps the money gauges,
  and the columns the collector reads are the columns the migration returns.

Rules branch:

- `tests/monitoring/reliability-controller-health.test.yml` (promtool, run by
  `scripts/ci/test-fleet-throughput.sh` in CI, which also asserts the
  receivers with `amtool`) evaluates the four rules, including both Stale
  causes and series that existed and then disappear (one MetricsAbsent page,
  Stale neither pending nor firing).
- `tests/reliability-controller-health-rules.law.test.ts` pins the labels the
  inbox and critical email routes need, the two Stale causes, and that every
  metric the rules name is one the collector writes.
- `scripts/ci/check-monitoring-drift.mjs` check 8 requires a producer for each
  metric name; the collector is that producer, so
  `metrics-without-a-producer.txt` needs no entry.
