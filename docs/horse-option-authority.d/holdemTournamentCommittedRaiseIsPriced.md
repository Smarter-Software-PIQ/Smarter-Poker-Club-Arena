# holdemTournamentCommittedRaiseIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`), switchable once its switch-list follow-up migration lands (pending: PR #11825's migration merges first). Evidence NOT MET. Nothing is switched on by the change that adds it.

Built 2026-11-24 (plo-lead6-01BNteGX) from the read-only sweep NLH-TOURNAMENT-SWEEP under the owner's order of 2026-11-17 11:49 America/Chicago (no blanket rules; every decision by math, ranges, equity and EV) and the 2026-11-24 order relayed by the coordinator (no random plays: the best play by math every time; any draw must be requested by the model with an explicit frequency, seeded and receipted; v2 draws only the solved equilibrium's own mixed frequencies, seeded from the public spot and the Horse's cards, receipted).

## Scope of this option

a re-raise faced after the Horse's own raise this hand (effective 40 big blinds or less), and any raise that commits the Horse at any depth where the two blind options do not own the spot.

## The defect it answers

L4: a non-all-in 3-bet got 56-62% folds where about 30% equity suffices; a Horse that 3-bet at 25bb+ folded 78% to a non-all-in 4-bet; a raise to 80%+ of the Horse's stack without being all in got 76% folds against 58% for a jam at the same price. Root cause re-read on main (0c78ed79, 2026-11-24): the short-stack node of `HorsePreflop.ts` (push/fold zone: 12bb or less, the red/orange M zones to 22bb, the short-handed 15bb zone on the hand-start depth) answers any faced raise with a jam against a fixed strength bar (0.72; 0.85 against two raises) or a fold; it has no call branch and no price. Measured through `HorseLogic.decide` with the production snapshot: heads-up big blind facing a 2bb open at 8 to 22bb folds 87.9% and jams 12.1% with the same fixed hand set at every depth. Real hand: 8b5a715a (MTT, AJo opener, 23.2bb, folded to a 3-bet to 7.4bb), rebuilt in the law test.

League card (run 2026-11-24, see League below): `mtt6_holdem_tournament_committed_raise_is_priced_22bb` in `server/src/benchmark/HorseLeague.ts`.

## How it decides (v2, 2026-11-24: anchored to the solved equilibrium; all three options share it)

v1 answered with a pure max-EV fold, call or shove priced against the CURRENT Horse pool's measured fold to a re-jam (openers folded 69-79% where 40-45% equity was asked): it overshot to never folding and shoving nearly every hand at 15-25bb (raise-defence grid: heads-up big blind 0% fold / 100% shove at 15-25bb, both blinds 0-1% fold at 15-20bb), a line any opponent who calls correctly beats, and it fed the all-in call price re-jams far wider than the 6-18% it assumes.

- **The solve.** `server/scripts/holdem-tournament-raise-defence-solve/solve.py`: chip-EV CFR+ (1,000 iterations per spot) of the game open / defend (fold, call, 3-bet to 3x, jam) / opener's reply (fold, call, 4-bet to 2.2x, jam) / 3-bettor's reply / calls of every jam, heads-up and three-or-more-handed (opener 1, 2, 3 or 5+ players behind, small- or big-blind defender; the other players a fixed behind-player model whose jam / call shares are the ring solution's own, three fixed-point rounds), depth 6-40bb, open 2 / 2.5bb, dead ante 0 / 1bb (320 spots). A ring opener's open range is fixed at his Nash V2 jam range (25bb at most). A rarely used raise is answered as the best reply to the hands that lose least by it (epsilon-forced, 1% of the reaching combos); a class that reaches a node with under 2% of its combos plays the best response there. Postflop, every call that is not all in is settled at the realisation measured in SELF-PLAY, `realisation.json` (`realisation-selfplay.ts`: league hands, every card the engine's own simulated players', no database read; heads-up winner-take-all, 6-max big-blind-ante MTT and 6-max Sit & Go contexts, 10-60bb, 40,000 hands each, 27,531 heads-up flops; out-of-position share = a + b x all-in equity per stack-to-pot bucket, realised 0.73-1.05 of a 50% hand). The first table was fitted from production hands with both players' starting hands, cards never shown included; it was withdrawn under the owner's ruling (zero unshown hole cards read, live or stored, offline fitting included) and a law (`ARaiseDefenceFitReadsNoUnshownHoleCard`) holds every fit source to it. Tables: `HorseHoldemTournamentRaiseDefenceSolved.data.ts` (versioned `holdem-tournament-raise-defence-solved-v1`), reader `HorseHoldemTournamentRaiseDefenceSolved.ts`.
- **Exploitability.** Each player's best-response gain against the other playing the stored tables: at most 0.0031bb per hand over all 320 spots (law: below 0.05 in every spot).
- **The answer** (`HorseHoldemTournamentRaiseDefenceAnchored.ts`) at the three nodes the tables cover (a blind facing one open; the opener facing a non-all-in 3-bet; the 3-bettor facing a non-all-in 4-bet): with no record of the opponent, no pay jump and no population move, the Horse plays the solved mix of its class at the spot (between grid points the weighted mix of the neighbours), the 3-bet / 4-bet the solution mixes in included. A mixed class is played by one draw from a seed hashed from the public spot and the Horse's own cards (the same state, the same action), recorded with the mix in the receipt (`holdemRaiseDefenceOfLastDecision().anchored`: mix, played, draw, EVs, deltas, weights). No unconditioned random gate: the only draw is the solution's frequency.
- **Moves off the prior.** The opponent's fold to the Horse's jam moves by the measured population rate (`HorseHoldemTournamentRaiseDefencePriors.data.ts`) with trust min(0.25, n / (n + 4000)), halved when the population folds more than Nash (the leak these options fix); his own record (HorseOpponentExploit posterior over the population's: fold to a 3-bet, first-in raise share, 3-bet share) moves his fold and his raise width with weight n / (n + 20) decayed opportunities, so a real sample dominates (law: an over-folder record jams more, a wide caller less, a thin record moves less). The population width is not used (the solved raise range is often a sliver of least-losing hands a width cannot reshape). The pay-jump bubble factor (`payJumpBubbleFactor`, where it returns a value; chip EV with two or fewer left, in a satellite, PKO, mystery bounty or without trusted context) weights losses. Each move is priced twice by the same code (moved model with the live bubble factor; solution's model at chip EV): the mix is tilted by exp(Delta / 0.05bb); an action outside the support plays alone only when it beats the support by more than 0.05bb. No move: exactly the mix.
- **Committing raises** (a raise that leaves the Horse committed, any depth) keep the v1 price, with the raiser's range read from the solved jam range of the same raise (law: the committing raise is answered within 5 points of the jam).
- **The all-in call price agrees.** With any of the three options on, `holdemTournamentAllInCallIsPriced` reads a jam over the open, over a 3-bet or over a 4-bet from the same tables (`solvedJamRange`; a thin hook in `HorseLogic.priceHoldemTournamentPreflopAllInCall`, null with the options off): the range a Horse re-jams is the range a Horse facing it is priced against. The equilibrium re-jam is far wider than the price's own 6-18% (heads-up 12bb: 37% of hands).

## Before / after / solved (raise-defence grid, 18,083 states, every class one combo, production switch snapshot; v2 all three on, self-play realisation)

| spot (combo-weighted over all 169 classes)      | off fold/call/jam/raise % | v1 on              | v2 on              | solved                                |
| ----------------------------------------------- | ------------------------- | ------------------ | ------------------ | ------------------------------------- |
| heads-up big blind vs 2-2.5bb open, <10bb       | 43.5/0.0/56.5/0.0         | 2.1/54.3/43.5/0.0  | 23.2/32.1/44.7/0.0 | 23.4/32.1/44.4/0.0                    |
| same, 10-15bb                                   | 43.3/0.2/56.5/0.0         | 1.3/13.8/84.9/0.0  | 29.1/30.6/39.2/1.1 | 29.5/30.6/38.5/1.4                    |
| same, 15-20bb                                   | 43.3/0.4/56.3/0.0         | 0.0/0.0/100.0/0.0  | 27.5/33.8/38.4/0.4 | 28.2/33.5/38.2/0.2                    |
| same, 20-25bb                                   | 33.6/36.4/26.2/3.8        | 0.0/0.0/100.0/0.0  | 30.0/31.4/37.9/0.7 | 30.4/30.5/38.1/1.0                    |
| small blind vs CO/BTN/SB open, 10-15bb          | 89.2/0.0/10.8/0.0         | 29.2/21.6/49.2/0.0 | 54.1/14.0/31.9/0.0 | 54.1/15.4/30.6/0.0                    |
| same, 15-20bb                                   | 89.7/0.0/10.3/0.0         | 0.9/0.0/99.1/0.0   | 65.3/5.2/29.5/0.0  | 65.7/7.3/27.0/0.0                     |
| big blind, same, 10-15bb                        | 87.5/0.8/11.7/0.0         | 0.0/46.4/53.6/0.0  | 12.4/57.4/30.1/0.1 | 13.1/60.6/26.3/0.0                    |
| big blind, same, 15-20bb                        | 85.8/3.1/11.1/0.0         | 0.0/0.0/100.0/0.0  | 17.0/52.1/30.9/0.0 | 18.2/57.2/24.6/0.0                    |
| button opener vs non-all-in 3-bet, 12bb         | 93.5/0.0/6.5/0.0          | 46.6/47.4/6.0/0.0  | 72.2/9.4/18.4/0.0  | 73.4/9.9/16.7/0.0                     |
| same, 15-25bb                                   | 91.2/4.5/3.3/1.0          | 22.8/12.7/64.5/0.0 | 76.3/10.0/13.0/0.7 | 79.3/10.1/10.1/0.5                    |
| big blind 3-bettor vs non-all-in 4-bet, 25-40bb | 94.5/3.0/2.5/0.0          | 58.1/37.5/4.4/0.0  | 89.4/0.0/10.6/0.0  | 89.4/0.0/10.6/0.0                     |
| re-raise to 85% of the stack (committing)       | 96.4/1.2/2.4/0.0          | 92.2/7.8/0.0/0.0   | 83.0/17.0/0.0/0.0  | (v1 price, solved jam range)          |
| the jam at the same spot (all-in call price)    | 91.3/3.0/5.7/0.0          | 91.3/3.0/5.7/0.0   | 82.9/11.5/5.7/0.0  | (all-in call price, solved jam range) |

Every row is inside 7 points of the solved shares (one draw per class here; the law test compares the played frequencies). The opener and 3-bettor rows are over every class; the law weights them by the solved range. The equilibrium folds a 4-bet more often than a pure bluff's break-even (its 4-bet range holds value); the v1 law that held it under that break-even is replaced by the band.

## League (option on vs off, same seeds 11 and 12, 15,000 duplicate pairs each, hybrid tournament baseline, deal-seeded mood clock; chip EV, the league reports no prize or finish EV)

| card                                                                                                         | bb/100 (A - B) | stderr | z                  |
| ------------------------------------------------------------------------------------------------------------ | -------------- | ------ | ------------------ |
| `hu_holdem_tournament_heads_up_big_blind_defence_is_priced_18bb` (heads-up winner-take-all)                  | +16.15         | 1.73   | 9.3                |
| `mtt6_holdem_tournament_blind_defence_is_priced_17bb` (6-max big-blind-ante MTT)                             | +2.31          | 0.29   | 7.9                |
| `mtt6_holdem_tournament_committed_raise_is_priced_22bb` (6-max big-blind-ante MTT)                           | +2.98          | 0.28   | 10.8               |
| `sng6_holdem_tournament_raise_defence_is_priced_17bb` (6-max Sit & Go, two paid, no ante; all three options) | +0.15          | 0.25   | 0.6 (not resolved) |

The heads-up and blind cards were declared at 12bb and were INERT there (the mirror league's openers jam or fold at 12bb); they were moved to 18 / 17bb, where the Horses min-raise. The Sit & Go card is neutral in chips (six left, two paid: the pay-jump factor is live and a chip count does not price the bubble).

## Exploit probe (heads-up tournament, depths 8-25bb, 2 x 20,000 hands per opponent, the same deals with the options on and off; holdemTournamentAllInCallIsPriced on in both)

| opponent                                                                             | Horse bb/100 off | on    | paired on - off |
| ------------------------------------------------------------------------------------ | ---------------- | ----- | --------------- |
| a Horse in the seat (control)                                                        | -24.2            | -8.7  | +15.4 (SE 1.3)  |
| min-raises any two as the small blind, raise-folds (continues only with the top 15%) | -24.1            | -11.2 | +12.95 (SE 1.4) |
| calls every preflop jam exactly by the solved / Nash call, otherwise a Horse         | -24.1            | -10.7 | +13.4 (SE 1.4)  |

The options win chips back against the min-raiser and do not bleed to the correct caller. The probe seat is a field seat: the Horse's -24 against even a Horse in it is that seat's own asymmetry, the same in both arms. This league Horse already opens nearly every small blind, so the min-raiser gains no more than the control from the off Horse: the probe bounds the bleed better than it measures the farm (the live farm is NLH-TOURNAMENT-SWEEP L1/L2).

## Receipts

`holdem_tournament_raise_defence_{hu_bb,blind_defence,committed_raise}_priced_seen`, `..._fold_seen`, `..._call_seen`, `..._shove_seen`, `..._reraise_seen` (v2: the solution's 3-bet / 4-bet), `..._mixed_seen` (a mixed class drew), `..._moved_seen` (a record, the population or the bubble moved the mix), `..._committed_seen`, `..._changed_seen`, `..._unpriced_seen`, `..._reversal_refused_seen`, `..._blanket_stood_aside_seen` (`HorseDataLedger.ts`).

## Tests

`server/src/engine/AHoldemTournamentRaiseDefenceIsPriced.law.test.ts` (42 cases, with `ARaiseDefenceFitReadsNoUnshownHoleCard.law.test.ts`: 49, `docs/laws.d/server-src-engine-AHoldemTournamentRaiseDefenceIsPriced.md`): bands around the solved shares (heads-up big blind 6-25bb with and without an ante, both blinds 10-15bb, opener vs a 3-bet at 22bb, 3-bettor vs a 4-bet at 25-40bb), exploitability below 0.05bb per hand in every spot, the prior plays the table mix exactly, own-record moves, bubble tightening (bubble factor 1.5 folds more than chip EV at 10, 15, 20bb), the all-in call price reads the jam range the Horse jams, determinism and receipts, off = absent, cash untouched.

## Inertness

`scripts/ops/horse-flag-off-check.sh origin/main HEAD --scratch <tmp>/replay --set full`: 0 differences in 28,000 decisions (base 6c6aaa7707ac, head ef20578ecbe5).

## Rollback

Off (absent or false) is main: no line of the price runs, the all-in call price reads its own widths, nothing is written, nothing fires.
