# A Lightning Turn Counts Its Commit, And A Brain Evaluation Counts Itself

The Horse opportunity counter (`poker_horse_telemetry_opportunities_total`) is the denominator for the clamp and legalizer counters. Two of its series did not say what their names say, and the activation manifest misreported one authority.

## What Was Wrong

- **Lightning commits were not counted.** The table engine counts `decision_started` when it asks for a decision and `commit_evaluated` when the answer reaches its commit stage. The Lightning host counted the start and nothing else. On the serving engine (08c27924, 2026-11-12 19:05 UTC) Hold'em cash read 37,449 started against 9,652 committed and PLO4 cash 28,269 against 10,423, while every series with no Lightning traffic agreed to a fraction of a percent (PLO5 cash 7,703 and 7,697; Hold'em tournament 31,453 and 31,397 at the earlier read). Fallbacks, abandoned turns and turn timeouts were all zero. The two variants are the two Lightning pools.
- **`decision_evaluated` was never counted.** It was a declared reason and the seed series, so it rendered as zero for every variant and mode. Brain-stage clamps are counted inside the decision worker, including for Lightning early looks, which count no `decision_started`. Those clamps had no denominator.
- **`commit_legalizer_entered` was a declared reason nothing emitted or read.** At a table it is the same boundary as `commit_evaluated`.

- **The activation manifest reported four Hold'em tournament corrective domains as off when they were not.** `/health` showed `nlh-mtt`, `nlh-sng`, `nlh-spin` and `nlh-hu_sng` as admitted with mode off. The manifest compared each domain key (variant and format, `nlh-mtt`) with a key it built from the catalog's mode (`nlh-tournament`), which names no domain, so no tournament domain could ever report candidate. The decision worker's gate compares the real key, so it selects those catalogs whenever the domain's holder is usable. This entry corrects the report; it is not live evidence of how often the corrective path changed a tournament decision. Tournament domains of the other eight variants have no admitted catalog and are off in both places.

## What Changed

- `LightningHandHost` counts `commit_evaluated` at its commit stage, in both doors (the ordinary turn path and the Lightning Fold door), once per answer. An answer the Lightning Fold door refuses goes on to the ordinary path and is still counted once. An early look counted no start and counts no commit, so started minus committed stays what it is at a table: turns that moved on first.
- The decision worker counts `decision_evaluated` once for each telemetry-on brain evaluation (`DECIDE_FAST`). A request refused before the brain runs is not counted. A deep second look replays with telemetry off, counts no clamps and is not counted.
- `commit_legalizer_entered` is removed from the closed reason list.
- The three reasons are defined in one comment above `HORSE_TELEMETRY_OPPORTUNITY_REASONS`.
- `computeHorseUpgradeActivationManifest` builds the Phase 14 comparison key with `correctiveDomainKey`, the function the worker gate uses. The manifest digest changes with the four corrected modes; host and workers compute it from the same image, so the READY comparison is unaffected.

No decision, wager, timing, queue or deadline changes. The Lightning change is one counter increment on a path that already ran; the worker change is one counter increment per evaluation and one small delta entry on a `FAST_RESULT` that already carries deltas when any exist.

## What This Does Not Claim

It does not show that the whole start to commit difference was Lightning; it makes the Lightning commit stage countable so the next serving window can show it. It does not change `decision_started`, and it does not count early looks as starts.

## Regression

- `server/src/lightning/LightningHorseCommitTelemetry.test.ts`, 5 cases through the real host and HandController: a hand played to showdown, a failed lane (liveness answers), early-look folds landing off the turn, the Lightning Fold door refusing every Horse, and an answer the host was never given. Four fail with the host change reverted; the door-refusal case fails (6 counted for 5 turns) with the once-only guard removed.
- `server/src/engine/HorseUpgradeManifestPhase14Mode.test.ts`, 47 cases: every one of the 45 domains reports the mode the worker gate gives a usable holder of its admitted catalog, an admitted tournament domain reports candidate, and a domain with no catalog reports off. Five fail on the previous source.
- `server/src/engine/horseDecision/workerRuntime.test.ts`, one new case: one evaluation for a FAST request, none for a refused request, none for a second look. It fails with the worker change reverted.
