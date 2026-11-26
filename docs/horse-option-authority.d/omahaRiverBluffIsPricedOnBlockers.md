# omahaRiverBluffIsPricedOnBlockers: Authority For The Live Switch

**Evidence MET: the audited replay bar passes in both audits (20 fixed / 4 newly wrong), the league mirror is positive on all four cards (heads-up PLO4 +4.87 +/- 1.92, 6-max PLO4 +2.14 +/- 0.86), and no exploit probe is a significant loss (the over-folder is exploited: +14.73 / +14.46). Default OFF, not switched on.** This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

Built 2026-11-26 by PLO-OWNER lead-7 lane plo-postflop (session 01TLQer8) for the audit finding that Horse river bets take the pot 61-68% of the time against people while the Horses rarely bluff the river (daily audit 2026-11-25T230000Z Tier B first-to-act nodes: river under-bluff, in and out of position). The option is registered, default off (read `=== true`), switchable live and scopable per game (`horse.omahaGameScope.omahaRiverBluffIsPricedOnBlockers`).

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, heads-up river with nothing to call: the opponent checked to the Horse, or the Horse acts first (`server/src/engine/HorseOmahaRiverOpeningBet.ts`). In the wager_rules node, after omahaRiverCheckedToBetIsMeasured and before the river current-nuts floor: a final CHECK with no value bet becomes the best-priced bluff only when BOTH (math) EV(bet) - EV(check) exceeds the binomial error of his fold rate times d EV / d fold, with his fold share read on his range after the Horse's own cards are removed, AND (blockers) that card-removed fold share is above his fold share without them: the Horse's cards remove more of his continuing hands than of his folding hands (nut blockers). EV(check) = showdown share x pot x (1 - rake) (first to act this is an upper bound, so it never favours a bluff); EV(bet B) = f' x pot x (1 - rake) + (1 - f') x (e_c x (pot + 2B) x (1 - rake) - B); a raise is scored as a call the Horse loses. It changes only a check into a bet, never a raise. Receipt `omaha_river_bluff_priced`.

His range: the measured strength histogram of a heads-up river checker (`HorseOmahaRiverOpeningRangeTables.json`, cell `checkfirst` after his check, `ipstart` when the Horse acts first, each split by whether the turn had a wager), fitted by `scripts/ops/omaha-river-opening-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17-24 (hole cards of showdown entries with mucked = false only; a checker who later folded or mucked counts as a weak hand). Card removal is exact: the strength bins are cut on the board's holdings, and each bin's weight is moved by the share of its holdings the Horse's cards and the known dead cards leave him. He folds the weakest share of his range.

## What Was Measured

All offline (no switch row, no database write); scratch folder `plo-lead7-01TLQer8/plo-postflop/` (BUILD.md, every table). Base = the live switch rows of 2026-11-26 05:45Z.

- League mirror (`/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/grade.mts mirror`: duplicate deals, ON seats against OFF seats, swapped every pair, Hybrid cash Horses, 6,000 pairs = 12,000 hands a card, seed 20261126; every world learns each seat's public river fold record from its own hands and installs it as the lifetime provider, as live): see the table below.
- Exploit probes (`/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/grade.mts probe`: seat 0 scripted, every Horse ON against every Horse OFF on the same deals, heads-up 100 bb, 6,000 deals, seed 20261127): caller (calls every postflop bet, never bets), folder (folds every river bet unless beaten by under 10% of holdings), balanced (defends the river to the minimum defence with its strongest hands), trapper (checks every river, raises the pot with near-nuts, calls the top third).
- Audited real decisions (`/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/lead7-node-replay.ts`, a copy of scripts/audited-node-option-replay.ts that also installs an as-of public river fold record from public answers of Nov 17-26; seeds 1,7,42; memory off; the audits' tier-A postflop nodes placed by `/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/build-job.py`): the verdict-only scorer rows under Replay, and the EV of the arm's action against the off arm's on the audits' own pricing (hand-audit-plo lib/grade.mjs, shown cards only).
- Real heads-up river states (Nov 23-26, 14,576 nodes, public snapshot and the deciding Horse's own cards).
- Speed: 1,271 applicable real spots (531 at 200 bb or deeper), decide with both options on p50 2.35 / p95 3.40 / max 4.78 ms; added by the options p95 1.13 / max 1.88 ms; 0 over 50 ms.
- Flag-off: see the PR (scripts/ops/horse-flag-off-check.sh origin/main HEAD --set full).

| card                       | bb/100 ON - OFF                   |
| -------------------------- | --------------------------------- |
| PLO4 heads-up              | +4.87 +/- 1.92                    |
| PLO5 heads-up              | +4.63 +/- 3.21                    |
| PLO4 6-max                 | +2.14 +/- 0.86                    |
| PLO5 6-max                 | +1.49 +/- 0.83                    |
| probe caller PLO4 / PLO5   | +0.12 +/- 0.19 / +0.04 +/- 0.04   |
| probe folder PLO4 / PLO5   | +14.73 +/- 4.55 / +14.46 +/- 6.75 |
| probe balanced PLO4 / PLO5 | +0.75 +/- 4.08 / +5.32 +/- 6.01   |
| probe trapper PLO4 / PLO5  | -3.38 +/- 4.17 / +2.79 +/- 5.65   |

Audited real decisions, EV on the audits' pricing (shown cards only): daily 2026-11-25 5 changed, 3 fixed / 0 newly wrong, +61.4 bb; 2026-11-20..24 23 changed, 18 fixed / 1 newly wrong, +144.6 bb. (Grades are with v2's checking range, shared with omahaRiverValueBetInPositionIsPriced: his own river bet rate moves it.) With no record (equilibrium prior) it bluffs only on a large blocker gain: on 14,576 real heads-up river states replayed without records it made no bluff. Untouched by construction: every call, fold and raise, every street but the river.

## Prior anchor

- Baseline: with no record, his fold share against a bet B into a pot P is the equilibrium minimum defence, B / (P + B).
- Own record: his lifetime public river fold record (OPPONENT-HUD `x.foldToBet` small and big, through `HorseMind.omahaStrongHandCheckRecordsOf`) moves it by m = (F + k g) / (E + k g): F his folds, E the folds equilibrium expects on the sizes he faced (1/3 small, 1/2 big), k = 75.9 river answers (the measured between-player prior of HorseOmahaStrongHandCheck), g = 0.4. The record dominates as it grows.
- Population weight: the range SHAPE (which hands a checker holds) is the measured pooled table; no pooled fold rate enters.
- No unshown cards: the table is fitted from shown cards only; the decision reads the public state, the Horse's own cards and the known dead cards.

## Replay

- Replay: fixed 3; newlyWrong 2; changed 5; unchanged 864; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm bluff vs off; replayed 869 of 869
- Replay: fixed 17; newlyWrong 2; changed 22; unchanged 2675; unjudged 3; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm bluff vs off; replayed 2697 of 2697
- Note (v2, 2026-11-26 08:20Z: his checking range moved by his own river bet rate; the opponent's public river fold and unopened-wager records as of the decision installed for every arm): arm bluff is this option alone; sets are the PLO hand audits' tier-A postflop nodes placed at their node (scratch /Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-postflop/src/build-job.py); verdict-only.
