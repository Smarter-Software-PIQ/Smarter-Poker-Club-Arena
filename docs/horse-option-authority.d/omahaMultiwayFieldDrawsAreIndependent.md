# omahaMultiwayFieldDrawsAreIndependent: Authority For The Live Switch

Built 2026-11-24 by PLO lead-6 from a sampling defect found while building the facing-bet pricing v2 (build log item 3). Evidence NOT MET: stays OFF. The option is registered, default off (read `=== true`), and has a law test and replay counts only: no graded replay, no league card run and no shadow measurement yet. This file does not authorize switching the option on.

## The Defect

Two samplers price a multiway facing-bet call by drawing one holding for the bettor and one for every other player (a caller of the wager, an earlier all-in, a player still to act) on the same runout and disjoint cards, then counting the Horse's share of the pot:

- `HorseOmahaFlopFacingBetEv.omahaFlopEvCounts` (the flop verdict, option `omahaFlopFacingBetEv`; also reached by `omahaFacingBetValueShareIsMeasured` and `omahaFlopDefenceIsPriced`).
- `HorseOmahaFacingBetEvShownField.omahaShownJoint` (the turn/river joint-field verdict inside `omahaFacingBetEv`, option `omahaFacingBetEvShownField`).

Each region is drawn by an additive walk, and every walk advances by the same golden-ratio step. Walks with one step differ by a constant, so within one decision the field's sampled position is a fixed function of the bettor's: on the turn and river exactly `2x + c` (the field steps twice per bettor value draw), on the flop the lattice `3x - 2y = c` (three field steps per two value steps per runout), and two players of the field sit a fixed distance apart. A player behind is never strong or weak at random against the bettor's sampled strength.

Measured on generated decisions (the law test and two probes kept with the build log, 12-20 decisions per cell): turn/river, the player behind's position given the bettor's quintile differs from his overall distribution by a total variation of 0.45-0.50 (independent: 0.12-0.14, the sampling noise of 160-174 sets), chi-square (16 df) 160-190 on every decision (independent 15-21); the rate he holds the stronger half of his range moves by 0.48-0.50 between bettor quintiles (it is 0 or 1). Flop: dependence at a finer grain, chi-square (81 df) 180-250 against 91-98 independent. Effect on the joint equity against the value region with every player behind continuing, against an independent brute-force reference: turn/river mean error 0.6-2.5 points (independent 0.7-1.5), sign varies hand to hand; flop 0.7-1.5 points against 0.6-1.2.

Live reach on 2026-11-24: `omahaFacingBetEvShownField` has no switch row (off); `omahaFlopFacingBetEv` was on until 07:08:52Z and is off since. So no live path runs either sampler with a field today; the PLO6 samplers (`HorsePlo6FacingBetPricedV2`, `HorsePlo6MultiwayTurnField`, `HorsePlo6RiverDefence`) carry the same walk and are not touched here (PLO6 is out of scope).

## What It Does

PLO4/PLO5 cash (four or five cards, no tournament; never PLO6, hold'em or a tournament). It switches neither verdict on. With it on, wherever one of the two samplers runs with a field, each player of the field draws his position in his range from his own mulberry32 stream (`HorseOmahaFieldDrawStreams`), seeded from the decision's sample seed (a function of the cards, as before) and his role and slot tag (`in:k` for the k-th player already in, `behind:k` for the k-th player still to act). Deterministic per decision. The bettor's walks are unchanged, so every heads-up count is the same number on and off. No hidden card is read, nothing keys on who a player is, and nothing is a threshold.

Receipt: `omaha_multiway_field_draws_independent` (a multiway verdict drew its field this way). Scopable per game (`horse.omahaGameScope.omahaMultiwayFieldDrawsAreIndependent`). Shadow stage: PLO4/PLO5, flop, turn and river.

## What Was Measured

Counts only, on 16,081 real multiway PLO4/PLO5 cash decisions facing a wager (Nov 20 08Z - Nov 24 08Z, 15,609 distinct states; public snapshot and the deciding Horse's own cards only), seed 1, off against on. They show what the option changes, not whether the change wins chips.

- Production rows of 2026-11-24 05:20Z (`omahaFlopFacingBetEv` on): 88 changed, all flop fold/call swaps (PLO4 8 call to fold, 12 fold to call; PLO5 34 and 34); flop fold rates by price move by at most 0.4 points.
- The same rows with `omahaFacingBetEvShownField` on: 188 changed (flop as above; turn PLO4 9 / 14, PLO5 37 / 30; river PLO4 2 / 2, PLO5 3 / 3); turn fold rates by price move by at most 0.7 points.
- Production rows now (`omahaFlopFacingBetEv` off): 0 changed.

Every change is a fold/call swap, balanced in both directions: the defect is per-decision sampling error, not a bias toward folding or calling.

## Tests

- `server/src/engine/HorseOmahaMultiwayFieldDrawsAreIndependent.law.test.ts` (docs/laws.d entry).
- Flag-off check (`scripts/ops/horse-flag-off-check.sh origin/main HEAD`): 0 differences with the option off.

## Activation

Default OFF in source. On live only by an option-switch row whose note cites this file and its sha256, after its evidence passes. Rollback: switch row off.

## Replay

- Replay: NOT RUN (built 2026-11-24; the audited-set scorer was not run; count-only replays on real multiway states are recorded in the PR)
