# omahaRiverValueBetInPositionIsPriced: Authority For The Live Switch

**Evidence NOT MET: grades in progress (league mirror, exploit probes, audited real-hand replay). Default OFF, not switched on.** This file does not authorize switching the option on.

Built 2026-11-26 by PLO-OWNER lead-7 lane plo-postflop (session 01TLQer8) for the audit leak "missed value bet, river, in position, heads-up" (HAND-AUDIT-PLO.md: 7 cases / 245 bb in the first audit; daily audit 2026-11-25T230000Z HARD #5). The option is registered, default off (read `=== true`), switchable live and scopable per game (`horse.omahaGameScope.omahaRiverValueBetInPositionIsPriced`).

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, heads-up river, the opponent checked to the Horse (`server/src/engine/HorseOmahaRiverOpeningBet.ts`). In the wager_rules node, after omahaRiverCheckedToBetIsMeasured and before the river current-nuts floor: a final CHECK becomes the best of the engine's bet sizes when (a) that bet is a value bet, the Horse beating more than half of the hands that continue, and (b) EV(bet) - EV(check) exceeds the binomial error of his fold rate times d EV / d fold. EV(check) = showdown share x pot x (1 - rake); EV(bet B) = f' x pot x (1 - rake) + (1 - f') x (e_c x (pot + 2B) x (1 - rake) - B); a raise is scored as a call the Horse loses. It changes only a check into a bet, never a raise. Receipt `omaha_river_value_bet_priced`.

His range: the measured strength histogram of a heads-up river checker (`HorseOmahaRiverOpeningRangeTables.json`, cell `checkfirst`, split by whether the turn had a wager), fitted by `scripts/ops/omaha-river-opening-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17-24 (hole cards of showdown entries with mucked = false only; a checker who later folded or mucked counts as a weak hand). Card removal is exact: the strength bins are cut on the board's holdings, and each bin's weight is moved by the share of its holdings the Horse's cards and the known dead cards leave him. He folds the weakest share of his range.

## Prior anchor

- Baseline (no record): his fold share against a bet B into a pot P is the equilibrium minimum defence, B / (P + B).
- Own record: his lifetime public river fold record (OPPONENT-HUD `x.foldToBet` small and big, through `HorseMind.omahaStrongHandCheckRecordsOf`) moves it by m = (F + k g) / (E + k g): F his folds, E the folds equilibrium expects on the sizes he faced (1/3 small, 1/2 big), k = 75.9 river answers (the measured between-player prior of HorseOmahaStrongHandCheck), g = 0.4. The record dominates as it grows.
- Population weight: the range SHAPE (which hands a checker holds) is the measured pooled table; no pooled fold rate enters.
- No unshown cards: the table is fitted from shown cards only; the decision reads the public state, the Horse's own cards and the known dead cards.

## Replay

- Replay: NOT RUN (grades in progress, 2026-11-26)
