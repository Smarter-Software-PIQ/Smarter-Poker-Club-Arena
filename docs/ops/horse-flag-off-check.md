# Horse flag-off check

**The question it answers:** does this change alter any Horse decision while the option switches are exactly as
they are in production? A change that ships "dark" (new options default OFF) should give **0 differences**.

It is a tool a lane runs before pushing a Horse change. It is **not** a required check and is not wired into CI.

## Run it

From your own worktree, with your change committed:

```bash
scripts/ops/horse-flag-off-check.sh origin/main HEAD --scratch /Volumes/SmarterWork/agent-work/<your-own-folder>
```

- `<base-ref> <head-ref>`: any two commits. Base is what production decides today; head is your change.
- `--scratch` is required and must be a folder you own on the external SSD. The script refuses the boot drive.
  It makes one new folder inside it, puts two throwaway worktrees and all its files there, and removes the folder
  and both worktrees when it ends (`--keep` leaves them for a closer look).
- It reads nothing from production and writes nothing outside that folder.
- About 1 minute 40 seconds for the quick set on the Ops Mac (2,940 states, 5,880 decisions per build,
  measured 2026-11-23). `--set full` runs about 14,000 states.

Exit code and output:

| Exit | Meaning                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `0 differences`: every decision is the same on both builds (action, amount, full decision JSON, receipts).                                                                            |
| 1    | Differences. They are printed grouped by receipt: which rule fired on one build only, how many decisions, in which games, what the action changed from and to, and one example state. |
| 2    | It could not run, or the two replays cannot be compared. Never a pass.                                                                                                                |

A difference is not automatically a defect. It means: this change is **not** dark. Either that is intended and the
change needs its own grade, or it is a bug. Say which in the PR.

Other options: `--set quick|full`, `--options <file>`, `--variant +option=on` (repeatable), `--memory some|off|all`,
`--json <report.json>` (written outside the scratch folder), `--node-modules <installed server/node_modules>`.

## What it does

1. Makes two worktrees, `base` and `head`.
2. **Captures** decision states on the head build: plays seeded full hands with the repo's own league engine
   (`server/src/benchmark/HorseLeague.ts playHand`, which builds the decision state the way production does) and
   records every `HorseLogic.decide` input. The states are generated once; the same file goes to both builds.
3. **Replays** every state through `HorseLogic.decide` on each build, in a separate process per build, with:
   - the same options: the production switch snapshot kept in the repo, `docs/horse-option-switch-state.json`
     (of the checkout you run the script from), mapped to decide options by **each build's own** switch code
     (`parseOptionSwitchConfig` + `optionSwitchDecisionOpts`, `styleSwitchDecisionOpts` + `styleSwitchBrainOpts`),
     the way the worker does it;
   - the same two seeds per state; before every decision the opponent memory is reset and the three random
     streams (equity sampling, bet size, action time) are seeded;
   - frozen clocks, `EQUITY_GOVERNOR=off`, and Supabase pointed at `supabase.invalid`.
4. **Compares** action and amount, then the full decision JSON, then the receipts.

State set (quick is about 21% of full in every group):

| Group                                  | Full                | What                                                |
| -------------------------------------- | ------------------- | --------------------------------------------------- |
| PLO4 cash: 6-max, heads-up, 3-5 handed | 1,600 / 1,200 / 700 | stacks 40 to 200 bb                                 |
| PLO5 cash: 6-max, heads-up, 3-5 handed | 1,600 / 1,200 / 700 | same                                                |
| PLO6 cash                              | 800                 | 6, 4 and 2 handed                                   |
| PLO4 / PLO5 tournament                 | 800 each            | mid-field with M, final table, heads-up; 8 to 80 bb |
| NLH cash / NLH tournament              | 900 / 600           |                                                     |
| Lightning PLO4 / PLO5 / NLH            | 500 / 500 / 300     | cash hands marked as Lightning pools                |
| Bomb pot PLO4 / PLO5                   | 900 each            | **WEAK**, see below                                 |

Input variations, applied identically on both builds (they depend only on the state and its index): every second
cash state marks one live opponent as a person; every third preflop cash state carries a VPIP floor; **one state in
four carries an opponent history** (below). Two hands in three seat the live hybrid profile, the third the five base
styles.

### Opponent history

With an empty memory, every rule that reads an opponent runs only its "no evidence" path. So one state in four is
replayed after 60 synthetic hands among the state's own seats have been observed by `HorseMind`
(`observe` + `observeHandComplete`), each seat playing a fixed persona (maniac, nit, station, regular). It is the
same history on both builds. On a build too old to have a memory function the history is skipped there and the
comparison says so. `--memory off` turns it off, `--memory all` puts it on every state.

It is synthetic. It makes the evidence path run; it is not any real opponent's record.

## Read the header before you quote a 0

The report prints, for each build: the commit, whether the checkout had uncommitted engine changes, the **Node
version**, and how many decide options it received. It warns when:

- a build does not know an option in the snapshot, or refuses a row (an older build can refuse a state the option
  did not take yet). That row is dropped on that build only and named. The two builds then did **not** run the same
  switches for that option;
- the builds ran on different Node versions;
- opponent history could not be seeded on one build;
- `decide` threw the same error on both builds (those decisions say nothing).

The Ops Mac's default Node is 26; production runs Node 22. The header records which one ran.

## What this does NOT cover

A 0 here is evidence about `HorseLogic.decide` on generated states. It is not proof that production behaves the
same. Not covered:

1. **The worker runtime.** The replay calls `HorseLogic.decide` directly. It does not go through
   `workerRuntime.ts`: the worker's feature-authority flags, the phase 8 and 10 to 14 admissions and the phase 14
   corrective evaluator, the worker-owned tournament ICM flag, deep second-look decisions, response validation and
   acceptance rechecks, shadow re-decisions.
2. **Engine code outside `decide`.** Hand gap, tournament balancing, the HUD provider, settlement, Lightning's own
   code (fast fold, the rolling VPIP floor). A Lightning state here is an ordinary cash state carrying the Lightning
   flag.
3. **Real opponent memory.** The history is synthetic (above). Durable profiles, lifetime HUD rows, style maps
   learned from real hands and plans carried across streets are not loaded.
4. **Real bomb pots and double boards.** The league generator deals single-board hands only, so the bomb-pot
   groups are ordinary postflop states with the bomb-pot flag and, two in three, a second board added; the preflop
   action history is still there. Their result is printed as WEAK.
5. **Runtime settings.** Compiled defaults on both builds; the live `ca_engine_runtime_settings` version is not
   applied.
6. **Games not in the set:** PLO8 / hi-lo, fixed limit, short deck, discard decisions, straddles, All-In-Or-Fold
   tables, run-it-twice, bounty events.
7. **Switch states other than today's.** It answers for the snapshot it was given. Use `--variant` for another set.
8. **Rare spots.** The quick set is about 3,000 states. A rule that fires once in thousands of decisions can be
   missed; the 2026-11-22 run found its one change in 23 of 14,614 states. Use `--set full` for a preflop or
   re-raised-pot change. River spots are the thinnest.
9. **Solver and GTO stores, the native evaluator.** A fresh worktree has no built native evaluator; both builds run
   the same way, and whether a store was loaded is not checked.
10. **One shared `node_modules`.** Both builds run on the installed `server/node_modules` of the checkout the script
    is run from. The script warns when a build's `server/package-lock.json` differs.
11. **Order-dependent receipts.** A few receipts fire once per process (`..._seen` on the first decision that meets a
    feature). Both builds replay the same states in the same order, so they cancel, but one real difference early in
    a group can show a second, receipts-only difference later in it.

Also remember what the selection of inputs can hide. The replay behind #11594 reported 0 changed decisions because
its journal held only hands that reached a flop, so the one decision the change alters (a heads-up preflop fold,
which ends the hand) could not appear in it. A replay proves something only about the decisions it was fed.

## The parts, for a closer look

`scripts/ops/horse-decision-crossbuild-replay.mjs` (run from the repo root; each `<worktree>` needs
`server/node_modules`, a symlink to an installed one is enough):

```bash
# 1. states, generated on one build
node scripts/ops/horse-decision-crossbuild-replay.mjs capture --build <worktree> --out <dir>/states [--set quick|full] [--scale 0.5] [--groups plo5_cash_hu,plo4_cash_hu]
# 2. one replay per build (or per option set)
node scripts/ops/horse-decision-crossbuild-replay.mjs replay --build <head worktree> --states <dir>/states --out <dir>/head
node scripts/ops/horse-decision-crossbuild-replay.mjs replay --build <base worktree> --states <dir>/states --out <dir>/base
# 3. compare
node scripts/ops/horse-decision-crossbuild-replay.mjs diff --head <dir>/head --base <dir>/base --json <dir>/diff.json
# which commit did it? (its own worktree under --scratch, removed afterwards)
node scripts/ops/horse-decision-crossbuild-replay.mjs bisect --good <ref> --bad <ref> --states <dir>/states --scratch <dir on the external SSD>
```

- **Options:** `--options <file>` takes the repo snapshot (`horse-option-switch-state/v1`) or plain rows
  `{"rows": {"<option>": "on"}}`. `--variant +omahaStreetPlan=on` changes one row before each build maps it; the
  replay stops if the build does not turn that row into the asked value. `--variant +raw:someOption=true` sets a
  decide option past the switch registry, for a dark option that has no row.
- **What one option does:** replay the same build twice, once with `--variant`, and `diff` the two. The report notes
  that the option rows differ.
- **Recorded production requests:** put a file `states-journal_<name>.ndjson` (one `{k, group, seed, player, gs,
style, mods}` per line, `group` starting with `journal`) in the states folder. It is replayed as recorded, with no
  input variation.
- **Outputs:** `states/manifest.json` (set id, counts per group and street, generator commit and Node version),
  `<replay>/replay-header.json` (commit, Node version, the options the build received, what it did not know or
  refused, history seeding counts), `<replay>/dec-<group>.ndjson` (one decision per line with its full JSON and
  receipts).
- At most 3 worker processes (`--jobs`), because the Mac is shared.

Code: the comparison, grouping and input variations are in `scripts/ops/horse-decision-crossbuild-replay-lib.mjs`
(tested on fixtures in `tests/unit/horseDecisionCrossbuildReplay.test.ts`); the part that loads a build is
`scripts/ops/horse-decision-crossbuild-replay-engine.mjs` (run end to end on the current build in
`server/src/benchmark/HorseDecisionCrossbuildReplay.test.ts`: a build against itself gives 0 differences, a changed
option shows up).

History: built from the one-off harness of 2026-11-22 (PLO-OWNER lead-5), which compared `bb21dc826731` with
`88b8dac0ebdc` and found one behaviour change under unchanged switches, traced to #11594.
