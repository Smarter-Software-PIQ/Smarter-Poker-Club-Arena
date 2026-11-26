# omahaRiverBluffIsPricedOnBlockers: Authority For The Live Switch

**Evidence NOT MET: grades in progress (league mirror, exploit probes, audited real-hand replay). Default OFF, not switched on.** This file does not authorize switching the option on.

Built 2026-11-26 by PLO-OWNER lead-7 lane plo-postflop (session 01TLQer8) for the audit finding that Horse river bets take the pot 61-68% of the time against people while the Horses rarely bluff the river (daily audit 2026-11-25T230000Z Tier B first-to-act nodes: river under-bluff, in and out of position). The option is registered, default off (read `=== true`), switchable live and scopable per game (`horse.omahaGameScope.omahaRiverBluffIsPricedOnBlockers`).

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, heads-up river with nothing to call: the opponent checked to the Horse, or the Horse acts first (`server/src/engine/HorseOmahaRiverOpeningBet.ts`). In the wager_rules node, after omahaRiverCheckedToBetIsMeasured and before the river current-nuts floor: a final CHECK with no value bet becomes the best-priced bluff only when BOTH (math) EV(bet) - EV(check) exceeds the binomial error of his fold rate times d EV / d fold, with his fold share read on his range after the Horse's own cards are removed, AND (blockers) that card-removed fold share is above his fold share without them: the Horse's cards remove more of his continuing hands than of his folding hands (nut blockers). EV(check) = showdown share x pot x (1 - rake) (first to act this is an upper bound, so it never favours a bluff); EV(bet B) = f' x pot x (1 - rake) + (1 - f') x (e_c x (pot + 2B) x (1 - rake) - B); a raise is scored as a call the Horse loses. It changes only a check into a bet, never a raise. Receipt `omaha_river_bluff_priced`.

His range: the measured strength histogram of a heads-up river checker (`HorseOmahaRiverOpeningRangeTables.json`, cell `checkfirst` after his check, `ipstart` when the Horse acts first, each split by whether the turn had a wager), fitted by `scripts/ops/omaha-river-opening-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17-24 (hole cards of showdown entries with mucked = false only; a checker who later folded or mucked counts as a weak hand). Card removal is exact: the strength bins are cut on the board's holdings, and each bin's weight is moved by the share of its holdings the Horse's cards and the known dead cards leave him. He folds the weakest share of his range.

## Prior anchor

- Baseline (no record): his fold share against a bet B into a pot P is the equilibrium minimum defence, B / (P + B).
- Own record: his lifetime public river fold record (OPPONENT-HUD `x.foldToBet` small and big, through `HorseMind.omahaStrongHandCheckRecordsOf`) moves it by m = (F + k g) / (E + k g): F his folds, E the folds equilibrium expects on the sizes he faced (1/3 small, 1/2 big), k = 75.9 river answers (the measured between-player prior of HorseOmahaStrongHandCheck), g = 0.4. The record dominates as it grows.
- Population weight: the range SHAPE (which hands a checker holds) is the measured pooled table; no pooled fold rate enters.
- No unshown cards: the table is fitted from shown cards only; the decision reads the public state, the Horse's own cards and the known dead cards.

## Replay

- Replay: NOT RUN (grades in progress, 2026-11-26)
