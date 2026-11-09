# V31 qualification checks every test table in minutes before the hours-long run

**In plain English.** Before this change, the playbook qualification run could
spend hours and only then stop because one of its test tables never once used
the new playbook. That happened twice on November 5. Now the job first plays
the opening hands of every test table, using the same engine version and the
same deals the real run will use. This takes a few minutes. If any table never
reaches the playbook, the job stops right there and lists every table that
failed. This quick check only reads from the database. It records no result,
opens no evaluation round and uses up nothing, so the one-time evaluation is
still available for the real run once the playbook is fixed.

## What changed

- `.github/workflows/gto-v31-qualification.yml` (evaluate only): a new
  read-only **plan** step works out which engine commit the epoch will pin,
  without opening the epoch. The runtime is checked out at that commit and
  built as before, then **pre-screened** (step timeout 30 minutes). Only after
  that does the existing **resolve** step open or resume the epoch, and it
  refuses to proceed if the pin moved away from the screened commit
  (`plannedPinHolds`). Recheck is unchanged.
- `scripts/ci/gto-v31-prescreen.mjs`: the decision logic and launcher. Each
  component (every scenario table, and for contract v3 every league
  memory-off twin) uses the evaluator's own seeds (`seedFor`, per-component
  xor). It plays 256 duplicate pairs (512 hands). A component that stays
  silent is played on to 2,048 pairs (4,096 hands) before it is refused, which
  keeps sparse tables like the ICM satellite and bubble from being refused by
  mistake. The step fails (exit 1) and names every component that has fewer
  playbook decisions than the floor (default 1, the evaluator's own `hits > 0`
  rule), or that shows illegal actions, truncated streets or execution
  mismatches. Exit 2 means the screen could not run.
- `scripts/ci/gto-v31-prescreen-worker.mjs`: runs inside the pinned runtime's
  own finite evaluation worker thread, so public-hist215 cells answer exactly
  as in the evaluator. It imports only the harness (scenario builders,
  `runMatchup`, the V31 loader), never `gtoV31Evaluate.ts`.

## Why it cannot spend the evaluation

- The only code that calls `fn_gto_v31_record_evaluation`, inserts into
  `horse_league_results` or calls `fn_gto_v31_mark_candidate` is
  `gtoV31Evaluate.ts`, and the pre-screen never loads it.
- Before any runtime module loads, the worker replaces the thread's `fetch`
  with an allowlist of four STABLE, DML-free RPCs
  (`ca_gto_v31_certification_status`, `fn_gto_v31_evaluation_plan`,
  `fn_gto_v31_evaluation_cells`, `fn_gto_v31_active_cells`). Any other request
  is refused before it leaves the runner, and the screen then fails.
- The worker compares the dataset's whole certification state (state,
  checksum, epochs, evaluations) before and after, and fails if it changed.
- The pre-screen runs before the epoch is opened.

## Closure

The new files are outside the V31 decision closure and the execution
fingerprint: no closure or fingerprint file names them. The decision-closure
and execution digests of this branch equal those of its base (recorded in the PR).

## Evidence

Run locally against dataset 187815b1 (read-only):

- at current main it passed all 18 components in 1.5 minutes;
- at the November 5 epoch-2 pin (8017564a) it refused in 1.1 minutes and named
  6 of 18 components: paired_replay/spin chip_ev and spin_ladder (the
  evaluator's own refusal on that run), league/spin chip_ev and spin_ladder,
  and both tourney_icm satellite tables. Each one had 0 playbook decisions.
