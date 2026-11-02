# Outage Health Failure Does Not Block Bounded Host Diagnostics

## Defect

During the 2026-11-02 14:34-15:03 UTC production engine outage (`https://engine.smarter.poker/health` returning HTTP 502), `production-integrity-audit.yml` run `41465208615` (`restartIncident=true`) aborted at `public_health_before` before opening SSH or reading container/kernel/journal diagnostics. In `scripts/ci/read-scoped-runtime-errors.py`, both outer dispatch (`main()`) and remote host execution (`--remote`) required `/health` to return HTTP 200 before capturing bounded read-only host diagnostics (`docker inspect club-arena-engine`, `docker events`, `sp-autoheal`, `journalctl -k`, `coredump`, and timestamp-bounded logs).

## Root-Cause Fix

- Updated `scripts/ci/read-scoped-runtime-errors.py` with `healthy_identity(value)`, `unavailable_health(value)`, `host_health()`, and `public_health()`.
- When public (`https://engine.smarter.poker/health`) or loopback (`http://127.0.0.1:8080/health`) `/health` is unreachable or returns a non-200 error during an outage, the failure is recorded as a structured read-only observation (`status: 'unavailable'`, `stage`, `category`, `readOnly: True`) in `publicEngineBefore`, `publicEngineAfter`, `hostEngineBefore`, and `hostEngineAfter` without aborting the SSH session or bounded host diagnostic capture.
- Preserved the existing identity-change guard (`Host engine changed during observation` / `Public engine changed during observation`) whenever both pre- and post-observation health reads return a healthy identity and `restartIncident` is false.
- Added regression coverage in `tests/fixtures/scoped-runtime-errors/native-fixture.py` (`test_public_and_host_health_outage_does_not_block_bounded_host_diagnostics`) and `tests/scopedRuntimeErrors.test.ts`.
