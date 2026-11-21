# Release selection prequalification transparency (H2) and post-booking Backup host yielding (H9)

**2026-11-21.** Two release-gate defects surfaced during the 2026-11-21 engine release windows and are fixed at root in the selection and Backup priority controls.

## H2 (T1): Invisible prequalification deferral in Stage selection

- **Symptom:** When `select-daily-engine.py` deferred candidates for `prequalification unavailable` and ended with `outcome: "keep-serving"`, the Stage `Record the daily release evidence` (`selection`) job exited 0 with no workflow annotation and no failing prequalification run ID, leaving the deferral hidden inside the `daily-selection.json` artifact.
- **Root cause:**
  1. `scripts/ci/read-engine-prequalification.py` already read the latest `engine-release-prequalification.yml` run for `head_sha`, but threw away `run["id"]`, `status`, and `conclusion` when raising `Unqualified`.
  2. `scripts/ci/select-daily-engine.py` discarded `helper.stderr` on exit code 3 instead of preserving the refusal line alongside `reason: "prequalification unavailable"` (complementary to PR #11628's `detail` field).
  3. `.github/workflows/stage-engine-release.yml` (`selection` job, `freeze` step) wrote `sha`/`control`/`send` to `$GITHUB_OUTPUT` without printing or annotating deferred candidates when `outcome == "keep-serving"`.
- **Fix:**
  1. `scripts/ci/read-engine-prequalification.py` appends `(run <id>, status=<status>, conclusion=<conclusion>)` on run-level refusal and `(run <id>)` on post-run refusals using the API payload it already reads.
  2. Builds on PR #11628's `deferredCandidates[].detail` field in `scripts/ci/select-daily-engine.py` so the refusal line (including the failing prequalification run ID) flows into `daily-selection.json`.
  3. `.github/workflows/stage-engine-release.yml` prints the deferred summary and emits `::error title=Engine selection deferred candidate(s) (keep-serving)::` naming each deferred SHA prefix, reason, and refusal detail (including the failing run ID) while keeping exit code 0 so `daily-selection.json` still uploads cleanly.
- **Barrier added:**
  - `tests/operations/engine-prequalification.test.py`: `test_failed_or_incomplete_qualification_refusal_includes_run_id`
  - `tests/operations/daily-engine-selection.test.py`: `test_keep_serving_deferred_prequalification_preserves_refusal_detail_and_run_id`
  - `tests/the-live-engine-only-receives-a-backup-certified-version.law.test.ts`: shell execution tests of `stage-engine-release.yml` `freeze` verifying `::error::` emission on `keep-serving` with deferred candidates (preserving exit 0 and `send=false`) and zero `::error::` noise on `selected` or empty `deferredCandidates`.

## H9 (T7): Post-booking push runs starving the booked owner window on Backup

- **Symptom:** While a booked owner window was live on `main` and its booking commit (`priority=booking`) had not yet earned `backup-engine/certified = success`, subsequent post-booking pushes touching `server/**` received `priority=candidate`, did not yield, and raced onto the single Backup host lease for ~1 hour ahead of the booking commit's `PRIORITY` run, risking its 75-minute turn timeout.
- **Root cause:** `scripts/ci/backup-candidate-priority.py` returned `candidate` for every commit carrying `main`'s release controls after the booking commit without checking whether the booking commit itself was already certified.
- **Fix:**
  1. `scripts/ci/backup-candidate-priority.py` walks the first-parent chain (bounded at 50 commits) from a post-booking commit to locate the booking commit and reads its newest `backup-engine/certified` status via read-only `GET repos/{repo}/commits/{booking}/statuses?per_page=100`.
  2. While the booking commit's newest `backup-engine/certified` status is not `success` (`missing`, `pending`, `error`, or `failure`), the reader returns `priority=booking_pending`. Once the booking commit carries `backup-engine/certified = success` (or the window closes/seals), post-booking pushes proceed as `candidate` (or `none`). Any unreadable or malformed parent/status read fails closed to `priority=unknown` (CLAUDE.md 10.86).
  3. `.github/workflows/backup-engine.yml` handles `booking_pending` in both `plan` (ends immediately as `DEFERRED`, nothing planned, no status written, never retargets onto another post-booking commit) and `refresh`'s `late_priority` guard (releases the host lease and sets `deferred=1` before `certify`).
  4. `docs/ENGINE-RELEASE-RUNBOOK.md` section 3.6 documents `booking_pending`.
- **Barrier added:**
  - `tests/operations/backup-candidate-priority.test.py`: tests proving post-booking pushes return `booking_pending` while the booking commit is uncertified/pending, proceed as `candidate` once certified (and `none` once closed/sealed), and return `unknown` on unreadable/malformed statuses or ancestry.
  - `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`: shell execution tests for `booking_pending` in both `plan` and `late_priority`.
