# 2026-11-21: Eliminate Backup 75-minute lease-wait starvation and redundant certifications (E3)

## Symptom

On 2026-11-21 under the 3-hourly cutover cadence, Backup run `44957494061` (`2f2026bc1ef7`) and 6 earlier push runs timed out with `Backup Engine reached no verdict: this run never held the Backup host turn` after waiting 75 minutes (`4500` s) behind an active schema refresh + 55-minute certification (`44954419323`). Meanwhile, waiting push runs whose commits had already been superseded by newer pushes continued competing for the single standby host lease, and waiting push runs whose identical-source ancestor finished certifying while they waited proceeded to run a redundant 55-minute soak.

## Root cause

1. `backup-engine.yml`'s `refresh` job capped lease acquisition at `4500` s (75 min) with `timeout-minutes: 120` and a `7200` s (120 min) host lease TTL, leaving insufficient margin when an active run performed a schema refresh (~15-25 min) followed by a ~55-min certification.
2. Supersession was checked only once in `plan` (at push arrival). A push run that passed `plan` while the Backup host was busy never re-checked for newer push runs while waiting in `turn` or after acquiring the lease in `late_priority`.
3. Certificate inheritance (`scripts/ci/engine-source-identity.sh` + `backup_projection` in `scripts/ci/read-engine-prequalification.py`) ran only in `plan`, before the active ancestor certification completed. Once the ancestor finished and released the host lease, the waiting descendant ran a full duplicate certification.

## Fix

Hard-coded permanent source fixes in `.github/workflows/backup-engine.yml`:

1. **Raised lease-wait and timeout envelopes safely:**
   - Raised `turn` lease-wait deadline from `4500` s (75 min) to `7200` s (120 min).
   - Raised `refresh` job `timeout-minutes` from `120` to `180` (covering 120 min wait + 60 min refresh/restore headroom).
   - Raised standby host lease TTL (`expiresAt`) from `7200` s (120 min) to `9000` s (150 min), safely above refresh + `certify` (`timeout-minutes: 75`), while preserving immediate stale-lease reclamation whenever `holder_status == completed`.
2. **Late supersession before and after lease acquisition:**
   - `plan` exports `priority` and `inherit_eligible` outputs alongside `freeze_baseline`.
   - Inside `turn` (while the host is busy), non-`booking`, non-`freeze_baseline` `push` runs check for newer push runs (`id > $RUN_ID and head_sha != "$SHA"`), confirm via `scripts/ci/backup-candidate-priority.py` that the commit is not `booking`, and yield cleanly as `SUPERSEDED` (`superseded=1`, `refresh.outputs.deferred == '1'`) without ever holding the lease or writing an `error`/`failure` status.
   - Inside `late_priority` (after lease acquisition and copy, before `certify`), non-`booking`, non-`freeze_baseline` `push` runs also yield cleanly as `SUPERSEDED` if a newer push run arrived, releasing the host lease and skipping `certify` without writing an `error`/`failure` status.
   - `booking`, `freeze_baseline`, `workflow_dispatch`, `schedule`, and `repository_dispatch` runs are never superseded; unreadable GitHub answers proceed unchanged (CLAUDE.md 10.86).
3. **Late certificate inheritance immediately after lease acquisition (`late_inherit`):**
   - Added `scripts/ci/engine-source-identity.sh` and `scripts/ci/read-engine-prequalification.py` to `refresh`'s sparse checkout.
   - Immediately after acquiring the lease and checking out, eligible non-`freeze_baseline` `push` runs check whether `$SHA` itself gained `backup-engine/certified = success` while waiting, or whether a first-parent ancestor within 60 commits with identical `engine-source-identity` and identical `backup_projection` now carries `success`.
   - When inherited (or already certified), `late_inherit` writes the inherited `success` status (if not already certified), immediately releases the standby host lease via fail-closed SSH, outputs `inherited=1` (causing `refresh.outputs.deferred == '1'`), and skips `due`, schema export/restore, `late_priority`, and `certify`.
   - Any unreadable identity/inputs, qualification-input boundary, or `failure`/`error`/unreadable identical ancestor stops inheritance and certifies in full (CLAUDE.md 10.86).

## Verification

- Updated and expanded `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts` covering raised lease-wait/refresh/TTL bounds, `turn` late supersession (including `booking`, `freeze_baseline`, non-push, and unreadable API immunity), `late_priority` late supersession, and `late_inherit` (identical ancestor inheritance with lease release, already-certified lease release, qualification boundary, failure/unreadable stop, and failed status-write fallback).
- Updated `docs/ENGINE-RELEASE-RUNBOOK.md` section 3.6.
- Verified `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`, `tests/operations/backup-candidate-priority.test.py`, `tests/the-runbook-names-what-it-cites.law.test.ts`, `tests/a-sparse-checkout-holds-what-its-scripts-load.law.test.ts`, `tests/a-freeze-baseline-is-certified-once.law.test.ts`, `tests/the-four-am-build-is-certified-against-the-frozen-copy.law.test.ts`, `tests/a-backup-copy-is-certified-by-what-it-holds.law.test.ts`, `tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts`, `tests/engine-release-pipeline-hardening.law.test.ts`, `tests/a-migration-install-waits-out-a-backup-export.law.test.ts`, and `tests/no-workflow-gains-a-new-timer.law.test.ts`.
