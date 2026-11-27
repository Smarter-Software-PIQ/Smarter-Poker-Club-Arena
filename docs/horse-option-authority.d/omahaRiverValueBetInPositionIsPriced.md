# omahaRiverValueBetInPositionIsPriced: Authority For The Live Switch

**Evidence NOT MET (2026-11-26, river range refit on people only): on the people-only range the real-hands river law's fixture bar fails (the option bets 4 of the 57 audited nodes, all the audit's bet, against the required 6; was 6), the scored replay is 3 fixed / 1 newly wrong (was 5 / 1), and the league mirror and probes were not re-run on the new range (the cards below are the pooled range's).** This file does not authorize switching the option on.

Built 2026-11-26 by PLO-OWNER lead-7 lane plo-postflop (session 01TLQer8) for the audit leak "missed value bet, river, in position, heads-up" (HAND-AUDIT-PLO.md: 7 cases / 245 bb in the first audit; daily audit 2026-11-25T230000Z HARD #5). The option is registered, default off (read `=== true`), switchable live and scopable per game (`horse.omahaGameScope.omahaRiverValueBetInPositionIsPriced`).

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, heads-up river, the opponent checked to the Horse (`server/src/engine/HorseOmahaRiverOpeningBet.ts`). In the wager_rules node, after omahaRiverCheckedToBetIsMeasured and before the river current-nuts floor: a final CHECK becomes the best of the engine's bet sizes when (a) that bet is a value bet, the Horse beating more than half of the hands that continue, and (b) EV(bet) - EV(check) exceeds the binomial error of his fold rate times d EV / d fold. EV(check) = showdown share x pot x (1 - rake); EV(bet B) = f' x pot x (1 - rake) + (1 - f') x (e_c x (pot + 2B) x (1 - rake) - B); a raise is scored as a call the Horse loses. It changes only a check into a bet, never a raise. Receipt `omaha_river_value_bet_priced`.

His range: the measured strength histogram of a heads-up river checker (`HorseOmahaRiverOpeningRangeTables.json`, cell `checkfirst`, split by whether the turn had a wager), fitted by `scripts/ops/omaha-river-opening-range-fit.mjs --horses` from PEOPLE's shown hands only in PLO4/PLO5 cash hand_history Nov 19 18:00Z to Nov 26 17:48Z (v3-2026-11-26-people; hole cards of showdown entries with mucked = false only; no Horse hand; a checker who later folded or mucked counts as a weak hand; each game cell shrunk by 30 pseudo-hands to a random holding; see omahaRiverBluffIsPricedOnBlockers.md, River Range On People Only). Card removal is exact: the strength bins are cut on the board's holdings, and each bin's weight is moved by the share of its holdings the Horse's cards and the known dead cards leave him. He folds the weakest share of his range.

## What Was Measured

All offline (no switch row, no database write); scratch folder `plo-lead7-01TLQer8/plo-postflop/` (BUILD.md, every table). Base = the live switch rows of 2026-11-26 05:45Z.

- League mirror (`/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/grade.mts mirror`: duplicate deals, ON seats against OFF seats, swapped every pair, Hybrid cash Horses, 6,000 pairs = 12,000 hands a card, seed 20261126; every world learns each seat's public river fold record from its own hands and installs it as the lifetime provider, as live): see the table below.
- Exploit probes (`/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/grade.mts probe`: seat 0 scripted, every Horse ON against every Horse OFF on the same deals, heads-up 100 bb, 6,000 deals, seed 20261127): caller (calls every postflop bet, never bets), folder (folds every river bet unless beaten by under 10% of holdings), balanced (defends the river to the minimum defence with its strongest hands), trapper (checks every river, raises the pot with near-nuts, calls the top third).
- Audited real decisions (`/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/lead7-node-replay.ts`, a copy of scripts/audited-node-option-replay.ts that also installs an as-of public river fold record from public answers of Nov 17-26; seeds 1,7,42; memory off; the audits' tier-A postflop nodes placed by `/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/build-job.py`): the verdict-only scorer rows under Replay, and the EV of the arm's action against the off arm's on the audits' own pricing (hand-audit-plo lib/grade.mjs, shown cards only).
- Real heads-up river states (Nov 23-26, 14,576 nodes, public snapshot and the deciding Horse's own cards).
- Speed: 1,271 applicable real spots (531 at 200 bb or deeper), decide with both options on p50 2.35 / p95 3.40 / max 4.78 ms; added by the options p95 1.13 / max 1.88 ms; 0 over 50 ms.
- Flag-off: see the PR (scripts/ops/horse-flag-off-check.sh origin/main HEAD --set full).

| card                       | bb/100 ON - OFF                  |
| -------------------------- | -------------------------------- |
| PLO4 heads-up              | +0.98 +/- 1.70                   |
| PLO5 heads-up              | +1.59 +/- 3.07                   |
| PLO4 6-max                 | -0.18 +/- 0.35                   |
| PLO5 6-max                 | -0.90 +/- 0.73                   |
| probe caller PLO4 / PLO5   | +0.44 +/- 0.49 / -0.77 +/- 0.57  |
| probe folder PLO4 / PLO5   | +4.11 +/- 3.76 / +7.51 +/- 6.04  |
| probe balanced PLO4 / PLO5 | -1.04 +/- 3.37 / +10.83 +/- 5.61 |
| probe trapper PLO4 / PLO5  | +0.13 +/- 3.48 / -4.37 +/- 5.48  |

v2 (his checking range moved by his own public river bet rate: with the measured river range of the player out of position before he acts and the measured first-to-act wager rate b, his bets are (pre - (1 - b) check) / b and a player who bets at b' checks (pre - b' bet) / (1 - b'); b' = his lifetime unopened river wager rate over the population's, shrunk by k = 33, times b; no record = the measured checking range). Audited real decisions, EV on the audits' pricing (shown cards only): daily 2026-11-25 4 changed, 1 fixed / 1 newly wrong, +17.6 bb; 2026-11-20..24 2 changed, 1 fixed / 0 newly wrong, +400.5 bb (one 1 bb bet into a 418 bb pot against an all-in-sized stack carries most of it: the audit's fold-equity model). The grades above are v2's; v1 (population checking range for everyone) is superseded. Real heads-up river states (replayed without records, where v2 decides exactly as v1): 352 of 14,576 checks become bets (2.4%; sizes a quarter pot 148, half 66, three quarters 57, pot 67, smaller 14); the opponent showed down in 313: the Horse held the best hand in 221 (71%), tied 15, was behind 77. Untouched by construction: every call, fold and raise, and every street but the river (the audits' in-position heads-up flop/turn/river calls are unchanged: 0 of them changed).

## Prior anchor

- Baseline: with no record, his fold share against a bet B into a pot P is the equilibrium minimum defence, B / (P + B).
- Own record: his lifetime public river fold record (OPPONENT-HUD `x.foldToBet` small and big, through `HorseMind.omahaStrongHandCheckRecordsOf`) moves it by m = (F + k g) / (E + k g): F his folds, E the folds equilibrium expects on the sizes he faced (1/3 small, 1/2 big), k = 75.9 river answers (the measured between-player prior of HorseOmahaStrongHandCheck), g = 0.4. The record dominates as it grows.
- Population weight: the range SHAPE (which hands a checker holds) is the measured PEOPLE-only table (no Horse hand, each game cell shrunk to a random holding); no pooled fold rate enters.
- No unshown cards: the table is fitted from shown cards only; the decision reads the public state, the Horse's own cards and the known dead cards.

## Replay

- Replay: fixed 2; newlyWrong 1; changed 3; unchanged 866; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm VAL vs off; replayed 869 of 869
- Replay: fixed 1; newlyWrong 0; changed 1; unchanged 2696; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm VAL vs off; replayed 2697 of 2697
- Note (2026-11-26, river range refit on people only, v3-2026-11-26-people): arm VAL is this option alone, the opponent's public river fold and unopened-wager records as of the decision installed for every arm (seeds 1,7,42); verdict-only. Before the refit (pooled range, arm value): 3 / 1 and 2 / 0. Real-hands river law: nodes 492c593d and ac3272e1 (both the audit's bet) are now checks; the fixture bar of at least 6 value bets is not loosened and fails at 4.
