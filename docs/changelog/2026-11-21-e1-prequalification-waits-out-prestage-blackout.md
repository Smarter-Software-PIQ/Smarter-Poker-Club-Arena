# Prequalification waits out the prestage host blackout window once (E1)

**2026-11-21.** Eliminates the 20%-of-the-day prequalification image-staging failure window under the three-hourly engine cutover cadence while keeping the host-side prestage guard strictly fail-closed.

## Symptom

Under the 8 three-hourly cycles/day schedule (`01, 04, 07, 10, 13, 16, 19, 22 America/Chicago`), `scripts/ci/prestage-engine-image.sh` closes the host pull door for 35 minutes per cycle (`[start - 1800, start + 300)`), totaling 4h 40m per day (~19.4% of the day). On 2026-11-21, commit `c2d6e45e3bcc` passed 4/4 server test shards in `engine-release-prequalification.yml` run `44954419290`, then failed prequalification solely because `Stage immutable candidate and rollback images` reached the host during the 16:00 Chicago preparation blackout (`production preparation window is closed`), forcing a manual full rerun to rescue the 19:00 Chicago cutover.

## Root cause

`.github/workflows/engine-release-prequalification.yml` (`prestage` job, `Transfer immutable image and prove local rollback` step) built and archived the candidate image and immediately streamed it over SSH to `scripts/ci/prestage-engine-image.sh` without checking whether the target policy's host prestage door was currently closed (or within the final 60 seconds before cutoff where transfer and proof cannot complete).

## Fix

1. **Bounded, single-pass pre-transfer wait in `.github/workflows/engine-release-prequalification.yml`:**
   - Immediately after computing `$hours` from `server/scripts/engine-release-seal.py schedule-policy --repo . --sha "$GITHUB_SHA"` and before invoking SSH, computes `wait_seconds` using the exact same target policy (`(1, 4, 7, 10, 13, 16, 19, 22)` for `three-hourly`, `(4,)` for `daily`) and DST-aware first-occurrence fall-back logic over real epoch hours in `America/Chicago`.
   - If `now` falls inside `[start - 1860, start + 300)` (the closed window `[start - 1800, start + 300)` plus the final 60s lead before cutoff), logs clearly and sleeps ONCE until `start + 305` (strictly bounded `<= 2165` seconds; zero loops, zero retries, zero watchers or crons). Outside closed windows, `wait_seconds` is `0` with zero delay.
   - Raises `prestage` job `timeout-minutes` from `45` to `85` (+40 minutes to safely cover the `<= 36m 5s` single-pass wait plus image build and transfer).
2. **Host-side guard preserved unchanged:**
   - `scripts/ci/prestage-engine-image.sh` is completely unchanged and remains 100% fail-closed on the host if any transfer arrives during `[start - 1800, start + 300)`.
3. **Capacity budget pin updated:**
   - Updated `tests/unit/qualificationJobCapacity.test.ts` to pin `engine-release-prequalification.yml` `prestage: 85`.

## Barrier added

- `tests/the-engine-cuts-over-every-three-hours.law.test.ts`:
  - Verifies `prestage` `timeout-minutes: 85`, valid `bash -n` syntax on the entire `stage` step, wait placement before SSH, single `sleep` with zero `while`/`until` loops, and intact host fail-closed refusal.
  - Executes the extracted workflow `PRESTAGE_WAIT_PY` calculator across three-hourly closed boundaries (`15:28:59` through `16:05:05` Chicago), all eight cycles, open windows, `daily` policy (non-04:00 cycles return `0`), DST fall-back (`2026-11-01`, first `01:00 CDT` closed only, repeated `01:00 CST` returns `0`), DST spring-forward (`2026-03-08`), and invalid `START_HOURS` fail-closed refusal.
  - Cross-checks every non-zero wake instant (`now + wait`) against the unchanged host guard in `scripts/ci/prestage-engine-image.sh` to prove the host refuses during `[start - 1800, start + 300)` and accepts at `start + 305` with a full 600s deadline.
  - Executes the workflow bash wait block with a mocked `sleep` to verify single-pass sleep during blackout and zero sleep when open.
