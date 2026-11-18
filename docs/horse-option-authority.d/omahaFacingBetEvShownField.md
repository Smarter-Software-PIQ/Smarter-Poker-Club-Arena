# omahaFacingBetEvShownField: authority for the live switch

Built 2026-11-18 (WooWoo PLO5 audit, findings F-04 / F-11, redesign candidate C3; plan A/dispositions/REDESIGN-PLAN.md section 1). Evidence NOT MET: the declared development-data evaluation (A/repairs/F-04-11/EVAL-DECLARATION-v3.md, sha256 bb0d4b0c...) FAILED on 2026-11-18 (EVAL-RESULTS-C3.md): overall delta +1.43 bb per spot [+0.46, +2.68] on 396 multiway decisions, but S-08 changes 3 graded-correct turn folds and the per-stratum added-call bar is insufficient (17 / 11 / 11 added calls) and not met with players to act. This file does not authorize switching the option on; it records what the option is and what must pass first.

## What it does

Inside `omahaFacingBetEv` only (PLO4/PLO5 cash, no tournament, one board, high only, no bomb pot), when the Horse faces a wager on the TURN or the RIVER with at least one other player in the hand (a caller of the wager, a player all in earlier, or a player still to act). Heads-up decisions, six-card hands and tournament decisions are untouched (the verdict is the one that serves today, key for key).

1. The field is counted jointly with the bettor in the flop form (`HorseOmahaFlopFacingBetEv`): one holding for the bettor (his value region or his other holdings) and one for every other player, on the same river card and disjoint cards. A player already in is always there; the j players still to act who continue are summed binomially at the measured continue rate, and each continuing player's call goes into the pot. There is no separate per-player factor and no 0.85 cap for a player behind, so a player behind is not charged twice (the C1/C2 defect).
2. The non-final turn call's realization is the measured realfit cell (`realfit-013U37/realization-fit.json`, sha256 0cd708ff5f5e15c6b4180362caef5c0cabfc4e4fab5382f0ddd45cbac889ad13, table "HORSE callers, all bettors", turn x class x position, hierarchically shrunk): two pair+ IP 0.914 (SE 0.047, n 820) / OOP 0.807 (0.047, 857); one pair IP 0.879 (0.058, 387) / OOP 0.867 (0.057, 446); nut/combo draw IP 0.858 (0.058, 226) / OOP 0.911 (0.058, 296). The river and a final call realize 1.
3. EV carries a standard error: sampling of the joint count, the continue rate (binomial on the smallest flop bucket, n 576) and the realization cell's SE (delta method). Outside 2 SE of the margin the sign decides; inside, the call is made with probability Phi((EV - margin)/SE) on a draw keyed by public state only (`omahaPricedPublicSpotKey` + own salt). No threshold is keyed to bet size, hand class or position.

## Declared fallbacks (UNMEASURED; must be replaced before any activation)

- Range share of a caller of the wager and of a continuing player behind: the stated `OMAHA_EV_CALLER_SHARE` (turn 0.45, river 0.35, with main's taper under a quarter pot). The redesign requires the showdown-range table (what turn/river callers actually hold, by pot share, opponent kind, heads-up vs multiway) from the realfit export; not built yet.
- An earlier all-in: stated `OMAHA_EV_ALL_IN_SHARE` 0.5.
- Continue rate of a player still to act: the FLOP curve `omahaFlopEvBehindContinue` (0.792 / 0.607 / 0.407 / 0.303 by pot share, n 8,875); no turn curve is measured yet (about 3,072 turn calls with a person seated are available).
- Hand class for the realization cell: two pair+ under the two-card rule; a two-in-hand flush draw on a two-suited board or eight-plus straight river cards as the draw cell; everything else one pair (realfit's weak-draw and air cells hold 33 and 7 calls).

## Activation

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256, after the declared evaluation passes on its sealed size. Rollback: switch row off.
