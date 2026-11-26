# omahaFlopRaiseIsPriced: Authority For The Live Switch

**Evidence NOT MET by the build's replay rule: the verdict-only scorer (action kinds only) counts 1 fixed / 4 newly wrong over two audits, because it cannot credit a resized raise and scores a raise turned into a call against the audit's "raise" kind. On the same audited decisions with every opponent's cards as shown, the EV of the action on the audits' own pricing is 18 fixed / 2 newly wrong, +212 bb; the league mirror is positive on all four cards (6-max PLO4 +2.04 +/- 0.91 bb/100) and no exploit probe is a significant loss. Default OFF; ready for shadow.** This file does not authorize switching the option on.

Built 2026-11-26 by PLO-OWNER lead-7 lane plo-postflop (session 01TLQer8) for the audit leak "raise without price, flop" (daily PLO hand audit 2026-11-25T230000Z, HARD #2: out of position heads-up, 4 cases / 97 bb; #13 in position heads-up). In 10 of that audit's 12 flop raise mistakes the Horse raised with the nuts or close to them to about half or two thirds of the pot raise, where the pot raise priced higher; in the other 2 (a flush facing a re-raise) the raise priced below the call or the fold. The option is registered, default off (read `=== true`), switchable live and scopable per game (`horse.omahaGameScope.omahaFlopRaiseIsPriced`).

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, the flop, heads-up, facing a wager, where the rule chain's answer is a RAISE (`server/src/engine/HorseOmahaFlopRaisePriced.ts`; in the wager_rules node after the river opening rules and before the river current-nuts floor and the nut size band). The raise is priced at the legal minimum, the chain's own size, half way to the pot raise and the pot raise, beside the call and the fold, against the bettor's measured flop range (HorseOmahaMeasuredBettorRange: shown strength by line and size, showdown bias corrected, his own shown record shrunk toward it): EV(raise to T) = f P (1 - rake) + (1 - f)(R' e_c (P + A + X)(1 - rake) - A), with f his fold share, the equilibrium minimum defence of the pot he is offered X / (P + A + X), he folds the weakest share of his range and continues with the rest, e_c the Horse's two-card-runout equity against it (a card-seeded pool of the unseen holdings ranked on the flop, per strength bin), R' = 1 when the call leaves no stack behind, else the street's realization; EV(call) = R eq (P + C)(1 - rake) - C. The best replaces the chain's raise only when it beats it by more than the equity estimate's error: a larger or smaller raise, the call, or the fold. It never makes a raise out of a call or a fold, so the owner rules on draws (never raised out of position; in position only combo draws) keep holding. Receipts `omaha_flop_raise_priced_resized`, `_called`, `_folded`.

## What Was Measured

All offline; scratch folder `plo-lead7-01TLQer8/plo-postflop/` (BUILD.md). Base = the live switch rows of 2026-11-26 05:45Z. Harnesses as in omahaRiverValueBetInPositionIsPriced.md; flop probes: seat 0 bets three quarters of the pot on every flop it may, then facing a raise: raise-folder (continues only beaten by under 3% of holdings), raise-caller (always continues), mdf (continues with its strongest half of the minimum defence), re-raiser (jams the strongest 8%, calls to 25%, folds the rest).

| card                           | bb/100 ON - OFF                 |
| ------------------------------ | ------------------------------- |
| PLO4 heads-up                  | +2.19 +/- 2.36                  |
| PLO5 heads-up                  | +3.74 +/- 3.21                  |
| PLO4 6-max                     | +2.04 +/- 0.91                  |
| PLO5 6-max                     | +1.05 +/- 1.10                  |
| probe raise-folder PLO4 / PLO5 | -5.94 +/- 4.50 / -5.06 +/- 6.58 |
| probe raise-caller PLO4 / PLO5 | +1.33 +/- 5.42 / +7.10 +/- 8.00 |
| probe mdf PLO4 / PLO5          | +1.24 +/- 4.61 / -8.12 +/- 8.66 |
| probe re-raiser PLO4 / PLO5    | -2.56 +/- 5.18 / -0.25 +/- 7.93 |

Audited real decisions (EV of the arm's action against the off arm's on hand-audit-plo lib/grade.mjs, shown cards only): daily 2026-11-25 6 changed, 5 fixed / 0 newly wrong, +109.3 bb (6acf112e-type undersized nut raises resized; 5f3efa50's flush raises into a re-raise folded); 2026-11-20..24 19 changed, 13 fixed / 2 newly wrong, +102.6 bb. Speed: 585 applicable real heads-up flop raises (286 at 200 bb or deeper): decide p50 3.3 / p95 4.3 / max 20.5 ms with the option on; added p95 1.8 / max 2.4 ms; 0 over 50 ms. The audits' in-position calls: 0 changed (it reads raises only).

Limits: no per-opponent flop fold-to-raise record exists in the HUD feed, so every opponent folds at the equilibrium prior: against a player who folds to raises far more (the raise-folder probe) it leans negative (not significant). Heads-up only; the multiway flop raise is not priced.

## Prior anchor

- Baseline: with no record, his fold share against a raise is the equilibrium minimum defence of the pot he is offered, X / (P + A + X).
- Own record: his shown flop wagers (HorseOmahaBetRead's per-opponent cells) move the measured range toward his own shown value share; the OPPONENT-HUD feed holds no per-opponent flop fold-to-raise count, so the fold share is the equilibrium prior for every opponent.
- Population weight: the range SHAPE is the measured pooled table (#11939); no pooled fold rate enters.
- No unshown cards: the table is fitted from shown cards only; the decision reads the public state, the Horse's own cards and the known dead cards.

## Replay

- Replay: fixed 1; newlyWrong 1; changed 3; unchanged 866; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm flopraise vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 3; changed 5; unchanged 2692; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm flopraise vs off; replayed 2697 of 2697
- Note (2026-11-26): arm flopraise is this option alone, replayed on a local merge of #11939's head 69f0422c (its measured flop tables); verdict-only; a resized raise is 'unchanged' to this scorer.
