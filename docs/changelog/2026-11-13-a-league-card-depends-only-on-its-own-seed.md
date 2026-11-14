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

- `leaguePairHandClock(p, runSeed)`: both passes of duplicate pair `p` are dealt on one timestamp base that depends
  on the run seed and the pair and on nothing else, in `runMatchup` and in the human-field runner. The seed is
  folded in (independent review, HU-LGR-001) because a clock that depended on the pair alone would give pair `p` the
  same persona draws every night and on every card: a fixed sample whose error pooling nights could not shrink. The
  nightly seed carries the date and the card name, so each night and each card is a fresh draw. The seed picks one
  of 4,096 disjoint bands; inside a band no two pairs share a timestamp; values stay under 2^42; a run is limited
  to 65,536 pairs (the longest card deals 24,000). `playHand` takes it as an optional last argument;
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
- ONE-TIME DISCONTINUITY. Every row written by an engine that carries this change is a fresh draw of the persona
  mixes, for every card, first in the worker or not. No row is bit-identical to what the old code would have
  written for the same card and date seed, and none is meant to be. (Before the seed was folded in, a card run
  first was bit-identical for six of eight cards checked and within 0.11 standard errors for the other two; with
  the seed folded in that no longer applies, because pass 1 is dealt on a seed-dependent clock too.) The
  `engine_sha` column separates the rows.
- What does hold from now on: the same card with the same seed gives the same row whatever ran before it or beside
  it, and two identical arms never diverge.
- The estimand is unchanged: seeds, deals and arms are the same, and the persona draws are the same hash of
  (seat, hand clock, spot), now common to both passes of a pair, which is what a duplicate pair is for. Until now
  every card after the first was already re-drawn nightly, by accident, through the run order.
- No SQL consumer compares a row with an earlier row of the same card or seed; all are threshold rules on pooled
  figures, so a borderline verdict can move as with any re-draw.
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

## Follow-ups (not in this PR; each needs its owner)

- The daily audit's list of default-off cards (`fn_audit_league_pooled_findings`, 20261031200450) names
  hu*v16_overlay, v16_hu_overlay_6max, v17_river_probe, shortdeck_v23, v32_facing_defense and plo6_v24_price only.
  No heads-up `hu_bb_defends*\*`or`hu_commit_under_pot` card is on it, so if one pools significant negative the
  audit raises a critical "ablate it" about a flag that is not live. That was already true of the six existing
  heads-up cards; the two reads-off cards add two more. It needs a migration adding these cards to the list
  (heads-up lane).
- A reads-off row keeps reads off for the whole card, which is an upper bound on a first-hands effect and not a
  production condition. It does not justify promoting the flag on its own.
- Four leagues run from scripts still deal on the process counter, so their two passes draw different persona mixes
  and a result depends on what ran earlier in the process: `ExploiterLeague.ts` (also the style-read league, whose
  output feeds the style-read rollout controls), `RiverBluffBaselineLeague.ts`, `RiverValueDefenseLeague.ts` and
  `HorseLeagueSpotConditioned.ts`. Each script is normally one fresh process, so a rerun reproduces. The fix is the
  same one line (pass a pair clock); their owners should be told before that evidence is relied on.
- The block figure belongs in its own columns (above); as a components entry it repeats the row's hands, so a
  reader that sums components would double-count.
- The lanes named in `ADefaultOffFlagHasALeagueCard.law.test.ts` (`UNDEALT_OWNERS`) for the four widened flags and
  v55OmahaRiverTripsFlat are this lane's proposal and need confirming in the shared tracker.

## Tests

- `server/src/benchmark/ALeagueCardDependsOnlyOnItsOwnSeed.law.test.ts` (law): a card gives the same hand clocks
  and the same result alone, after another card, and beside one; identical arms never diverge; another seed deals
  the same card on other clocks.
- `server/src/benchmark/HorseLeagueBlockStderr.test.ts`: the arithmetic, the worker boundary, the stored row.
- `server/src/benchmark/HorseLeagueHumanFieldHeadsUp.test.ts`, `HorseLeagueHumanField.test.ts`: the reads-off cards.
- `server/src/benchmark/ADefaultOffFlagHasALeagueCard.law.test.ts`: the tightened law.
