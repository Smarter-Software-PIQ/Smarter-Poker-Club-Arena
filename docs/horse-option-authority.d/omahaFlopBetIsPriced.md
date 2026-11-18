# omahaFlopBetIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Build: sites-013U37 (plo-handoff-review-01a1cbbd/sites-013U37/DESIGN.md, PASS-BAR.md). Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash flop, heads-up, nothing to call: the bet of a bare big pair (an overpair, or queens or better with one higher card on the flop; no flush draw; fewer than eight straight outs) by the player with the betting lead, in either position, is priced beside the check. It stands when it is priced at least at the check, else it is checked. Out of position it replaces the check of `omahaBareOverpairOopFlopCheck`; in position (where no rule acted) the same hand is priced too: the owner fixture txHiARhC (hand 59833576, A♦A♥K♦J♦4♥ bet 252 into 315 in position at 361.6 behind on 8♠6♣9♠ and was check-raised by a flopped straight), with the owner's "THIS NEEDS TO GO FOR KK AS WELL AS QQ". Multiway and unpriceable spots keep the rule decision (`_unpriced_kept`).

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning, not fixed limit (`omahaPricedInScope`). It acts where the rule it replaces acts (the flop branch of `omahaOopCheckRules`, reached when that family is on); with the option unset or false every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaFlopBetIsPriced docs/horse-option-authority.d/omahaFlopBetIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaBareOverpairOopFlopCheck` (HorseOmahaOopChecks.omahaBareOverpairOopFlopSpot, HorseLogic omahaOopCheckRules): out of position with the lead, a bare big pair's flop bet becomes a check by hand class. Its continuation facing the flop bet after the check (`omahaBareOverpairFlopFacingBetRule`) is NOT replaced here: a flop call or fold belongs to the flop facing-bet verdict (flopev2); it is registered as open site S1b.

## The priced comparison

`omahaPricedSitesFlopBetEv` (HorseOmahaPricedSites.ts), heads-up, chips of the pot now. He folds the weakest share of his holdings given by his fold to a bet: the priced read (`omahaPricedReadOfUser`); with no read, `omahaPricedSitesFlopNoReadFold`: the documented 0.42 unless `omahaPricedPriorsByOpponentKind` is on, then his kind's measured flop fold to a bet (`omahaPricedKindPrior(kind).foldToBet.flop`). He raises with the strongest 0.15 (measured on persons: people raise Horse flop bets 10-21%, blockbet-013U37; no Horse measurement, so used for every kind) to the pot or all in, and calls with the band between; facing his raise the Horse takes the better of the call and the fold. The Horse's equity against each band is the flop facing-bet sampler's (`omahaFlopEvCounts(...).top(share)`, his holdings drawn from the cards the Horse does not hold). Checking realizes the equity against his whole range. Realization with chips behind has ONE owner, the flop facing-bet verdict's fitted table: `omahaPricedSitesFlopRealization` = `HorseOmahaFlopFacingBetEv.omahaFlopFittedRealization(1, 'pair', inPosition, later)` (the measured flop one-pair cell by position, shrunk by its sample; model factor 1; later streets counted by what is left to bet); an all-in call realizes 1. The site's own fitted constant (0.6131 / 0.645 x 0.884) is deleted.

The fixture's verdict as logged BEFORE the batch moved the realization to omahaFlopFittedRealization (HorseOmahaPricedSites.test.ts; the test asserts the mechanism, not these figures): AA bet 37.1 vs check 51.0 at his fold 0.42 (check), 60.7 vs 51.0 at 0.50 (bet); KK 22.8 vs 45.1 at 0.42, 50.6 vs 45.1 at 0.50; QQ 49.9 vs 63.0 at 0.42, 76.9 vs 63.0 at 0.50. The answer turns on his measured flop fold rate: no size or class line decides.

## Receipts

omaha_priced_site_flop_bet_kept, \_checked, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaPricedSites.test.ts (the fixture and its KK/QQ forms: priced, deterministic, the bet worth more as his fold share rises, the check unmoved; off and out of scope null; whole decisions legal), HorseOmahaNoBlanketRule.law.test.ts (site S1 reached with the options off; with every priced option on its legacy receipt fires only beside `_unpriced_kept`; the continuation pinned as open site S1b).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Replay on audited real decisions (PASS-BAR section 1): FAIL (audit2 no read: 21 changed, 0 fixed, 3 newly wrong, judge -65.9 bb; winner read: 11 and 13 changed, 1 fixed, 0 newly wrong, +25.9 bb on 2 judged). Archive plo-handoff-review-01a1cbbd/sites-013U37/REPLAY-20261118.md.
- League (PASS-BAR section 2): NOT RUN (sequenced after the opponent-kind prior fix).
- Overall: NOT MET. Do not switch on.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

**OFF-ONLY** (ploFailed in HorseOptionSwitch.ts): the replay on audited real decisions FAILED its bar (sites-013U37/REPLAY-20261118.md: pooled 1 fixed, 3 newly wrong; audit2 no read 21 changed, judge -65.9 bb). Do not switch on.

Changes in the batch (reviews R3 of sites 27852aafb40):

- N1: the bare big pair's flop bet is reached with this option on even when no categorical flop rule is on (in position or with omahaBareOverpairOopFlopCheck off): `omahaOopCheckRules` no longer returns early for it.
- N2: the flop one-pair realization has ONE owner, the flop facing-bet verdict's fitted table (`HorseOmahaFlopFacingBetEv.omahaFlopFittedRealization`, class 'pair', by position, shrunk by its sample; flopev2); this sampler has no runout model, so the model factor is 1 and the measured cell carries it, with later streets counted by what is left to bet. The constant OMAHA_PRICED_SITES_FLOP_REALIZATION (0.6131 / 0.645 x 0.884) is deleted.
- The no-read fold prior follows `omahaPricedPriorsByOpponentKind` (lead ruling): on, his kind's measured flop fold to a bet (`omahaPricedKindPrior(kind).foldToBet.flop`); off, the documented 0.42 this site was built and replayed with (`omahaPricedSitesFlopNoReadFold`, test in HorseOmahaPricedSites.test.ts).
- N3: OMAHA_PRICED_SITES_FLOP_RAISE_SHARE (0.15) is measured on PERSONS raising Horse flop bets; no Horse measurement of a raise of a flop bet exists, so the same share is used for every opponent kind (a stated limit).
- N4: the FAIL replay above ran on the old sampler and the 0.42 prior, before N2 and the kind prior.
- N5: evCheck values the check at the Horse's realized equity and ignores a bet by him after the check-back (stated limit).

League cards (HorseLeague.ts, declared, not run): plo4_omaha_flop_bet_is_priced and plo5_omaha_flop_bet_is_priced: the live options of 2026-11-16 in both arms, arm A adds omahaFlopBetIsPriced.
