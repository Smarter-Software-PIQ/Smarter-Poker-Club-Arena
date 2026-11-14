# Autoheal asks the engine before restarting it (incident b6151c69)

## What happened
At 00:25:58 CST on 2026-11-14, sp-autoheal restarted club-arena-engine and voided
every hand in flight. The same thing happened at about 00:26 CST on 2026-11-12.
The engine was dealing throughout: event-loop p99 stayed between 21 and 47 ms,
about 1,200 log lines a minute, and host CPU was at most 43% of 16 cores.

## Cause, read from engine-01 (runs 43618070187, 43623140051, 43623146738, 43625413042)
Dockerd logged `Health check for container ... error: timed out starting health check`
8 times between 00:23:13 and 00:25:43 on 11-14, and 5 times between 00:25:00 and
00:26:10 on 11-12. There were none on 11-13. The HEALTHCHECK exec never started, so
the engine's `/health` was never asked. Three such failures mark the container
unhealthy, and autoheal restarts on that status alone.

## Fix
`infra/monitoring/autoheal-gate.sh` replaces the stock autoheal loop. It uses the
same image, label, 15 s interval and 45 s stop timeout. Before restarting an
unhealthy container that publishes the engine port, it reads that container's
`/health` from the host network, with no exec and the HEALTHCHECK's own 15 s budget.

- Alive (`running === true`, `liveness` ok or standby, which is the HEALTHCHECK's
  own expression): no restart. The decline is logged and counted in
  `sp_autoheal_restart_declined_total{reason}`. The reason is `exec_start_failed`
  when Docker's last probe never started, and `probe_failed` otherwise.
- Not alive, malformed, or no answer within 15 s: restarted exactly as before.

Detection of a genuinely dead engine is unchanged, because liveness `dead` still
restarts. `tests/unit/autohealGate.test.ts` runs the real script for both branches.

## Still open
- Why runc/containerd could not start an exec in this container for about 2.5
  minutes, at about 00:23 on two nights. The host was not CPU-, IO- or
  memory-pressured. Blocked processes were 0-1 and forks 2-13 a second. load1
  rose to 13.8 (11-14) and 7.6 (11-12) on 16 cores, with CPU only 22-43% busy.
- Deployment: no workflow deploys `autoheal-compose.yml`. Deploy Monitoring runs
  `deploy.sh`, which covers only the Prometheus stack. The sidecar must be
  recreated on engine-01 with
  `docker compose -f infra/monitoring/autoheal-compose.yml up -d` from the
  monitoring source checkout, via `ssh ca-engine`.
- Do this outside an active engine release. The release transaction stops and
  restarts `sp-autoheal` by its container ID, and recreating the container
  changes that ID.
