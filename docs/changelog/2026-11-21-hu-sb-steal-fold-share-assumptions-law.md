# 2026-11-21: huSmallBlindStealsVsTightBigBlind fold-share estimate assumptions law cases

Fulfills the test-only prerequisite from the exact-head review (Hand Analysis, `0039d2bc`, N5) recorded in `docs/horse-option-authority.d/huSmallBlindStealsVsTightBigBlind.md`.

## What changed

- `server/src/engine/HorseHeadsUpSmallBlindStealsVsTightBigBlind.law.test.ts`: added four deterministic law cases under `fold-share estimate assumptions (exact-head review 0039d2bc, N5)` pinning real engine behavior across `huTightFolderRead`, `huTightBigBlindSteal`, `exploitHandIncrements`, `observeExploitRow`, and `HorseLogic.decide`:
  1. **Posterior mean VPIP**: proves `pFoldLower = 1 - 2 * read.vpip` uses the Beta posterior mean `(popMean * EXPLOIT_PRIOR_STRENGTH + vpip) / (EXPLOIT_PRIOR_STRENGTH + hands)`, neither a 90% credible upper bound (`hands = 30, vpip = 2` clears break-even via the posterior mean and widens all 169 classes even though `betaCdf(1/6, alpha, beta) < 0.90`) nor raw sample VPIP (`hands = 45, vpip = 6` passes raw `6/45` but refuses via the prior-shrunk posterior mean and changes 0 classes).
  2. **Half of counted hands as big blinds**: pins `HU_BIG_BLIND_HAND_SHARE_BOUND === 2`, the absence of seat/blind split counters on `ExploitCounters`, the 2x boundary (`0.16` clears, `0.17` refuses, `0.51` floors at 0), and an 80% SB / 20% BB seat-skewed history where true BB fold rate is 50% (< 66.7% cash break-even) yet the steal fires and opens all 169 classes.
  3. **Walks not separated**: proves a heads-up walk omits the big blind from `exploitHandIncrements`, so in a strictly alternating 50/50 match where 75% of BB hands are walks and BB defends 50% of the remaining opens (true BB fold rate 50% < 66.7%), dropping walks leaves 20% of counted hands as big blinds and the steal fires on all 169 classes.
  4. **Limped pots not separated**: proves a checked big blind in a limped pot emits `hands: 1, vpip: 0` identically to a folded big blind in `exploitHandIncrements`, so in a strictly alternating 50/50 match where every big blind is a checked limp (0% BB fold rate), counted VPIP reads tight and the steal fires on all 169 classes.
- `docs/laws.d/server-src-engine-HorseHeadsUpSmallBlindStealsVsTightBigBlind.md`: updated the law registry summary to include the fold-share estimate assumptions.
- `docs/horse-option-authority.d/huSmallBlindStealsVsTightBigBlind.md`: recorded that the review-limits test-only prerequisite is now satisfied while keeping `Status: built, OFF, Evidence NOT MET`, the owner blind-steal hold (`off` only), and `Replay: NOT RUN` completely unchanged.

## Scope and holds preserved

- No engine runtime behavior, default-off gate, option-switch registry entry, or database switch row changed.
- `huSmallBlindStealsVsTightBigBlind` remains default OFF in source, off-only under the owner blind-steal hold (2026-11-14 21:30 Chicago), and `Evidence NOT MET` pending an owner hold lift by name and scorer-written Replay rows on the corrected replay history (#11556).
