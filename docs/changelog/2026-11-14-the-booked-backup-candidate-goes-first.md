# The booked Backup candidate goes first, and one provider 5xx no longer fails or downgrades a certificate (2026-11-14)

Measured on the November 14 off-cycle engine cutover (window `2026-11-14-owner-offcycle-engine-0506z`).

## Defect A: the release candidate was not prioritised

The Backup host certifies one commit at a time (about 55 minutes). The booked candidate waited about 50 minutes behind an unrelated push run (started 04:16Z, booking merged 04:20Z), and the release owner dispatched a manual run of the booking commit because a later ordinary push would have SUPERSEDED the booking commit's own push run.

Change, in the `plan` job of `.github/workflows/backup-engine.yml`, push runs only: the run fetches `scripts/ci/backup-candidate-priority.py` at its own commit and reads one verdict. The reader only reads (GitHub GETs, public `/health`). A window is live when main's `activation-floor.json` names an owner window, exactly one entry of `windows` carries that id, now is before `min(notAfter, expiresAt)`, and the serving release does not contain the window's `contains` commit (the rules of `scripts/ci/owner-window-ready.py`). A commit is a candidate when its `activation-floor.json` and `owner-maintenance-windows.json` blobs equal main's (the rule of `policy()` in `server/scripts/engine-release-activation-floor.py`); the booking commit is the candidate whose first parent is not one.

- Chosen (option 2): the booking commit's push run is certified exactly. It is not superseded by newer push runs and not retargeted. It still honours ALREADY CERTIFIED and certificate inheritance.
- Chosen (option 1, narrowed): a commit whose controls differ from main's ends as DEFERRED (nothing planned, no status) only when the existing rules did not already retire it. SUPERSEDED and RETARGETED run first and are unchanged, because a retarget hands the host to main's newest server commit, which carries main's controls. DEFERRED therefore covers the case where the retarget read was unreadable.
- Rejected: deferring a predating commit before the retarget (it would leave the host idle when the retarget would have certified the candidate); exempting every candidate from SUPERSEDED (each later ordinary push would then take a full certification and queue the post-seal refresh behind them, the November 7 defect); judging manual, nightly or post-seal runs (they are never skipped).
- Rejected and out of scope (option 3): cancelling a certification in progress. A cancelled soak can leave the Backup host mid-run. So the exact November 14 wait is NOT removed by this change: a run that started before the booking merged still holds the host. The playbook now says to read the Backup queue before merging the booking.
- Unreadable or malformed state is `unknown` and the run behaves exactly as before (CLAUDE.md 10.86).

## Defect B: one transient GitHub 5xx failed a certification and downgraded a certificate

Post-seal Backup run 43565758486: the `certify` job failed after 16 s with `[dispatch-intent] GitHub answered HTTP 502 for actions/runs/43565107242/attempts/1`, and "Publish the verdict" then wrote `backup-engine/certified = failure` "Backup Engine refused: see run" on a commit certified an hour earlier.

- `scripts/ci/dispatch-intent.mjs`: every request is a GET and goes through `fetchWithRetry`: HTTP 500, 502, 503, 504 or a network error is asked again up to three more times (2 s, 5 s, 10 s) inside the same step. Any other answer, every 4xx included, is final at once; a mismatch is decided after the answer and is never retried. This applies to every receiver that runs the script.
- `backup-engine.yml`, both privileged jobs: the fetch of the script itself retries the same way in the step (waits 0, 5, 15, 30 s; an `HTTP 4xx` answer stops at once).
- `backup-engine.yml` "Publish the verdict": a run with no certify result and no policy refusal reached no verdict. It writes `error` ("Backup Engine reached no verdict ..."), never `failure`. If the run had not written its own `pending`, it first reads the newest status: an existing `success` stands and nothing is written; an unreadable read also writes nothing. A genuine refusal (certify result, failed refresh, activation-policy refusal) is still `failure`, as before. Every reader accepts only `success`, so `error` stays fail-closed.

Not changed: the other workflows that fetch `dispatch-intent.mjs` with a single `gh api` call (`post-deploy-e2e.yml`, `apply-merged-migration.yml`, `gto-v31-qualification.yml`, `auto-deploy-hetzner.yml`) still fetch once; they gain only the script's own retry.

## Tests

- `tests/operations/backup-candidate-priority.test.py` (run by the law below): booking, candidate, predates; upcoming, open, expired, consumed; every unreadable read is `unknown`.
- `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`: the plan step under each verdict, the bounded fetch (502 then 200, network error, 404 at once, four attempts), and the verdict step (existing success kept, `error` otherwise, refusals unchanged).
- `tests/unit/dispatchIntent.test.ts`: 502 then 200 succeeds, 4xx fails at once, retries bounded, a mismatch is not retried.
