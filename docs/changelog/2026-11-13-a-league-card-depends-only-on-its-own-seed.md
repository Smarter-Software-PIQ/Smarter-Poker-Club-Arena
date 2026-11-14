# The league: a card's result depends only on its own seed; a reads-off heads-up card; a block standard error; the flag-card law checks the arm

Date: 2026-11-13. Lane: heads-up (HU-EVAL-003, 004, 006, 010, 014). Status: measurement only; no Horse flag default
changes, no schema change, no migration.

## Why

The nightly league decides whether a default-off Horse flag is promoted. The heads-up evaluation found five things
wrong with the instrument itself:

1. HU-EVAL-004. The same card and seed gave a different answer when another matchup had run first in the same
   process. Reproduced on main 1c009e34: the 80bb heads-up mirror, 3,000 pairs, seed 20261112, read -4.86 bb/100
   run first and -8.10 run second. The nightly worker runs the whole card in one process, in an order that changes
   every night, so a stored row was not a function of (card, date seed, engine).
2. HU-EVAL-003. Two identical arms diverged: against the limp persona, 2 of 6,000 pairs (pair 803 of seed 20261112
   folded the turn in one pass and called it in the other). A card whose flag never acts could be stored as measured.
3. HU-EVAL-006. The stored standard error treats duplicate pairs as independent.
4. HU-EVAL-010. The law that every default-off flag has a league card accepted an arm that only set the flag false,
   matched one spelling of the ledger note, and kept its exemption list as an editable literal.
5. HU-EVAL-014. No card measured huBbDefendsToPrice where the Horse has no read on its opponent, which is where the
   exploratory runs found its whole effect.

## Cause of 1 and 2 (one cause)

The brain keys per-hand draws on the timestamp of the hand's first action: the persona indifference band
(HorseEvEngine, through `evIndifference().handKey`) and V48 chart adherence (`followsSolver`). `playHand` took that
timestamp from a process-wide counter (`nextHandTsBase`), one slot per call. So the hands of a card run second were
dealt on other timestamps than the same card run first, and the two passes of one duplicate pair never shared a
timestamp, so identical arms drew different persona mixes. Resetting the counter per matchup made the second run
equal the first; giving both passes one timestamp made 6,000 identical-arm pairs diverge 0 times. No other leaked
state was found: the HorseEval caches are keyed and seeded by their own key, and HorseMind state lives in the
per-pass sandboxes.

## What changed

- `leaguePairHandClock(p)`: both passes of duplicate pair `p` are dealt on one timestamp base that depends on the
  pair alone, in `runMatchup` and in the human-field runner. `playHand` takes it as an optional last argument;
  absent, it uses the process counter as before, so every direct caller (ExploiterLeague, RiverBluffBaselineLeague,
  RiverValueDefenseLeague, HorseLeagueSpotConditioned) is unchanged. Each pass already plays in its own HorseMind
  sandbox, so the passes sharing a hand key share no plan, outlook or seen-action state.
- `blockStandardError` and `LeagueResult.blockStderr` / `stderrBlocks`: the standard error from up to 40 contiguous
  blocks of pairs, beside `stderr`. The nightly row stores it as one more entry in
  `candidate_benchmark_components` (scenario `paired_difference_block_stderr`). The worker boundary accepts and
  validates the two optional keys.
- Two cards, appended to the end of the card: `human_hu_bb_defends_vs_minraise_40bb_reads_off` (12,000 pairs,
  against `hu_minraise_every_button_v1`) and `hu_bb_defends_to_price_40bb_reads_off` (6,000 pairs, horse against
  horse). Both are the existing 40bb cards with `memoryLearning: 'off'`. Their stored config carries
  `memoryLearning`, so a row says its reads were off.
- `ADefaultOffFlagHasALeagueCard.law.test.ts`: a flag counts as dealt only when a card switches it on in exactly one
  arm and the other arm leaves it unset or false; "default-off" and "default OFF" are both read; the exemption
  lists are held inside a hash-pinned snapshot (`server/src/benchmark/fixtures/default-off-flags-undealt.snapshot.json`)
  and can only shrink. The fifteen listed flags are unchanged.

## What this changes for nightly rows

- Seeds, deals, arms, pair counts and names of every existing card are unchanged. `stderr` keeps its per-pair
  meaning; the pooled verdict, the daily audit and the tuner read the same column with the same definition.
- A card that is NOT the first matchup the worker runs is now dealt on the timestamps it would have had running
  first. Its row will differ from what the old code would have written that night. This is the fix: until now those
  rows depended on which cards ran before them.
- A card that IS first: pass 1 of every pair is bit-identical to before. Pass 2 now shares pass 1's timestamp, so
  the rare hands where a persona draw decided the action can settle differently. Each run first in a fresh
  process, seed 20261112, before and after: bit-identical for `hu_commit_under_pot`,
  `human_hu_bb_defends_to_price`, `v11_leak_fixes`, `human_v7_preflop` and `human_hu_v7_preflop_vs_limper_40bb`
  (1,500 pairs each) and `human_hu_bb_defends_vs_minraise_40bb` (3,000 pairs). The two heads-up Hybrid mirrors
  moved: `hu_bb_defends_to_price` at 3,000 pairs from -4.86 to -4.71 (standard error 6.96, 727 to 726 divergent
  pairs) and `hu_bb_defends_to_price_40bb` at 1,500 pairs from 0.08 to -0.77 (standard error 7.50, 526 to 524).
  A first run cannot stay bit-identical there: identical arms diverged in first runs, so making them agree changes
  pass 2. The estimand is unchanged: the draws are the same hash, now common to both passes, which is what a
  duplicate pair is for.
- Rows written before and after this change are comparable as measurements of the same quantity. A pooled figure
  that mixes them is not affected in definition.
- `candidate_benchmark_components` of a nightly row gains one entry when the run has at least 50 pairs. No SQL
  reads that column for nightly cards (the V31 gates read it only for evaluation rows they record themselves).
- The card is two matchups longer: about one 12,000-pair human-field card and one 6,000-pair heads-up mirror of
  worker time per rotation. Nightly cost is bounded by the run windows as before.

## What the block standard error does and does not show

On the evaluation's own per-pair data (12,500 pairs each) the block figure is 0.88 to 1.06 times the per-pair one,
and the lag correlation of the per-pair differences is about zero. So neighbouring pairs inside one run are not
measurably correlated, and the block figure will usually sit close to the stored one. The 10% (up to 60% on the
80bb mirror) shortfall the evaluation measured is between runs: seed to seed, the answers spread more than either
figure allows. Part of that spread was defect 1 itself for any card that was not first. What remains cannot be
estimated inside one run. It needs the pooled verdict to use the night-to-night spread, which is a change to the SQL
pooling function and is proposed, not made, here:

- Follow-up migration (proposal): in `fn_league_pooled` (20261106052532) multiply the pooled standard
  error by `sqrt(greatest(1, chi2 / (runs - 1)))`, where `chi2 = sum(((b - pooled) / s)^2)` over the pooled rows
  (the Birge ratio), and do the same in the tuner rule (20261019154819) and the audit's significant-negative test
  (20261107130545). No column is needed. If the block figure should become a column of its own, add
  `block_stderr numeric` and `stderr_blocks integer` (nullable) to `horse_league_results` and have the runner write
  `r.blockStderr` / `r.stderrBlocks` there instead of the components entry.

## Not changed

- No Horse flag default. huBbDefendsToPrice stays default OFF; the new cards only measure.
- No existing card's arms, seed derivation, pair count, depth, persona or name.
- No migration, no schema, no SQL function.
- Other league runners that call `playHand` themselves still use the process counter.
- The four flags the widened law now sees (barrelContinuationOutlook, smallPotNearNutRiverValue,
  multiwayRiverBluffCheckRaise, v53PloTourneyIcm) are listed for their owners, not given cards.

## Tests

- `server/src/benchmark/ALeagueCardDependsOnlyOnItsOwnSeed.law.test.ts` (law): a card gives the same hand clocks
  and the same result alone, after another card, and beside one; identical arms never diverge.
- `server/src/benchmark/HorseLeagueBlockStderr.test.ts`: the arithmetic, the worker boundary, the stored row.
- `server/src/benchmark/HorseLeagueHumanFieldHeadsUp.test.ts`, `HorseLeagueHumanField.test.ts`: the reads-off cards.
- `server/src/benchmark/ADefaultOffFlagHasALeagueCard.law.test.ts`: the tightened law.
