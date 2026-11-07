# 2026-11-07 - the evening plan says what 04:00 will do

Owner request, 2026-11-07: see, the evening before, exactly what the daily
04:00 America/Chicago engine preparation would select, and why, in one view.
Until now that answer was scattered across the live engine's `/health`, the
`backup-engine/certified` statuses on main's commits, the Backup Engine's run
list and the window-migration queue, and nobody assembled it until the 03:30
run itself did.

## What changed

**`scripts/ops/release-plan.mjs`** is a read-only Node 22 script (no new
dependencies; `pg` is installed `--no-save` by the workflow exactly as the
window installer does) that reads, from the same sources the 04:00 jobs read:

- **Production**: `GET https://engine.smarter.poker/health` -> `releaseSha`,
  `version`, `instanceId`, `maintenance.phase/schedule/readyForRestart`,
  `handsInFlightTotal`, `humansSeatedTotal`, `stalledTableCount`.
- **Owed target**: the main tip (`repos/{o}/{r}/branches/main`), then the
  first-parent walk from the tip reading each commit's newest
  `backup-engine/certified` status (`commits/{sha}/statuses?per_page=100`,
  newest first), the same selection stage-engine-release.yml's "Choose the
  newest Backup Engine certified main commit" step makes. Every commit walked
  is reported with its state (success / failure / pending / missing). The
  walk stops at the first success (the candidate) or at the serving SHA: the
  serving commit is never the candidate, because a cutover to it is no
  cutover.
- **Whether a cutover is owed**: `compare/{serving}...{tip}` (status, commit
  count, whether any `server/**` file differs, with the stage workflow's
  runtime filter also applied), the `server/**` commits in that range with
  their files, and `compare/{serving}...{candidate}` so a certificate on a
  docs commit behind uncertified engine commits is not mistaken for a release.
- **Backup lane**: the newest `backup-engine.yml` runs (status, conclusion,
  event, head SHA), the active ones, and the last successful post-seal
  refresh. The standby's own clone stamp is **UNKNOWN** by construction: it
  lives on the host and in a job log, neither of which the REST API exposes,
  and the report says so instead of inventing a date.
- **Queued window migrations**: every `supabase/migrations` file declaring
  `-- @install-window: daily-maintenance` (SUPERSEDED BY honoured, same parser
  as the installer), each run through `validateWindowMigration` statically, and
  the ones not yet in `supabase_migrations.schema_migrations` when
  `DATABASE_URL` is set (same TLS handling as `install-window-migrations.mjs`,
  `--ssl-root-cert scripts/ci/certificates/supabase-prod-ca-2021.crt`). With
  no `DATABASE_URL` the queue is **UNKNOWN**, never "0 queued".

Four verdicts, three exit codes (CLAUDE.md 10.86):

| verdict        | meaning                                                                                                                                         | exit |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `READY`        | a certified main commit newer than production exists and carries engine changes; every queued window file validates                             | 0    |
| `NOTHING_OWED` | no `server/**` change between the serving SHA and the main tip (or production serves the tip)                                                   | 0    |
| `NOT_READY`    | engine commits since the serving SHA but none newer than it is certified (04:00 keeps the engine), or a queued file would be refused statically | 1    |
| `UNKNOWN`      | a source could not be read: `/health`, a GitHub read (403, rate limit), a served SHA outside main history, no `DATABASE_URL`                    | 3    |

A definitive blocker outranks an unreadable source (NOT_READY wins over
UNKNOWN); an unreadable source is never coerced into READY or NOTHING_OWED.
`--json` prints the whole plan, `--summary` appends the Markdown to
`$GITHUB_STEP_SUMMARY`, `--json-out <path>` writes the JSON for an artifact.
Every reader (fetch, token, pg client, clock) is injectable, so
`tests/unit/releasePlan.test.ts` covers READY, both NOTHING_OWED shapes, three
NOT_READY causes, five UNKNOWN causes, the first-parent walk and the exit
codes without touching a network.

**`.github/workflows/evening-release-plan.yml`** runs it at 20:00
America/Chicago (`7 1 * * *` and `7 2 * * *`, the DST twin pattern
backup-engine.yml uses) and on `workflow_dispatch`, on `main` only, with
`permissions: contents: read, statuses: read, actions: read`, one concurrency
group, the JSON uploaded as an artifact, and a final step that **fails the
job on NOT_READY or UNKNOWN**. That red run is read by
`scripts/ci/check-main-is-green.mjs` in production-integrity-audit.yml
(CLAUDE.md 10.83), which is the reader this workflow names. It never
dispatches, cancels, reruns or writes anything.

**`tests/the-evening-plan-only-reads.law.test.ts`** (registered in
`docs/laws.d/the-evening-plan-only-reads.md`) pins all of that: read-only
permissions, no `gh run` / `gh workflow run` / `/dispatches` / `-X POST` /
`--method POST` / `curl -X POST` in either file, every fetch an explicit GET,
no import or spawn of the applier, installer, deploy or maintenance scripts,
one SELECT as the only SQL, and exit codes 0/0/1/3 with the fail step's
default being 3, not 0.

**`tests/no-workflow-gains-a-new-timer.law.test.ts`** gains the two schedule
entries with the reason beside them: an owner-requested read-only report, not
a release timer (the 10.85 ban is on timers that initiate, advance, retry or
certify a release; this one cannot).

## Why these shapes

- The walk follows `parents[0]` rather than trusting `commits?sha=` order, so
  a merge commit on main cannot pull a side-branch commit into the candidate
  list. Squash merges make the two identical today; the law is about tomorrow.
- A certified commit that changes nothing under `server/**` relative to
  production (a certificate on a docs commit) is reported as NOT_READY when
  newer engine commits are uncertified, because sending it would restart the
  engine on the same tree while the owed change stayed behind.
- The clone stamp is UNKNOWN on purpose. The one place it can be read is the
  standby host; a REST-only report that printed a date would be the detector
  10.86 warns about.

## Verified

`npx vitest run tests/unit/releasePlan.test.ts tests/the-evening-plan-only-reads.law.test.ts tests/law-registry.law.test.ts tests/no-workflow-gains-a-new-timer.law.test.ts tests/the-docs-describe-this-environment.law.test.ts`
green; `npx prettier --check` on every changed file clean. Run from a
container with no GitHub or engine reach and no `DATABASE_URL`, the script
printed UNKNOWN for each of the four sources, validated the 20 live declared window
files on the current tree statically (and skipped the one marked SUPERSEDED BY), and exited 3.

Not done here: the first live run on `main` (this branch is unpushed; the
workflow runs only after merge) and a read of the standby's clone stamp,
which the REST API cannot provide.
