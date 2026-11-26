# holdemMultiwayFlopSmallBetCallIsPriced: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). Evidence NOT MET. NOT READY: it never fired in any grade (league mirrors 6-max and 9-max, and 3-handed probes against both a value-only and an over-bluffing small flop bettor), so it neither wins nor loses. It must stay OFF; this file does not authorize switching it on.

## What It Does

No-limit hold'em cash (table and Lightning), one board, the flop, multiway (two or more live opponents). It applies when the Horse faces a small first bet (under half the pot) and closes the action, meaning every other live player has already called. The brain's fold becomes a call only when both of these hold:

- THE BETTOR'S OWN record of called flop bets of that size that were SHOWN (`horse_exact_profiles.postflop_bets` shownBet, air = shown "high card") puts his bluff share above balanced, after shrinking to it.
- The call prices above zero. The equity is against his bet read with that share, times the equity against each caller's line range (treated as independent), realized at the out-of-position factor unless the Horse acts last.

With no record the decision stands as today.

Receipts: `holdem_mw_flop_small_bet_called`, `_kept_fold`, `_not_above`.

## Prior anchor

- Baseline: the balanced bluff share s / (1 + 2s) for the bet size. With no record, the share equals the baseline, so no call is ever added.
- Population weight: zero. The audit's population measurement (people bluffed 35-42% of small multiway flop bets) is not read.
- Own record: (shown x air + 20 x baseline) / (shown + 20). It dominates as his shown sample grows.
- No unshown cards: only hands shown at showdown are classified.

## How To Trial It (Live Shadow Stage)

The option is staged as `holdemStage(['nlh_cash', 'nlh_lightning'], ['flop'])`.

- To start: `node scripts/ops/horse-option-switch.mjs set holdemMultiwayFlopSmallBetCallIsPriced shadow`.
- To watch: `node scripts/ops/horse-option-shadow-watch.mjs holdemMultiwayFlopSmallBetCallIsPriced --since <ISO>`.

## Grades (chips), 2026-11-25

League mirror, ON - OFF bb/100 per seat:

| Table               | Result | Receipts                                         |
| ------------------- | ------ | ------------------------------------------------ |
| 6-max, 20,000 hands | 0 ± 0  | 50 not above balanced, 55 kept the fold, 0 calls |
| 9-max, 12,000 hands | 0 ± 0  | 77 not above, 18 kept the fold, 0 calls          |

Probes: 3-handed, 100 bb, 8,000 deals per arm. The script bets 1/3 pot on an unbet flop with strong hands and bluffs air at rate q.

| Script                                           | Result         |
| ------------------------------------------------ | -------------- |
| Value-only (q = 0)                               | identical arms |
| Over-bluffer (q = 0.9, 45% of its flop bets air) | identical arms |

Why it never fires:

- Air flop bets rarely reach showdown, so the shown record of flop bluffs stays thin.
- Where it was above balanced, the call still priced below zero against the bettor and every caller together.

Law test: `HorseCallsOnHisShownRecord.law.test.ts` (no record: nothing changes).

## Limits

- The multiway equity is a product of heads-up equities (an independence approximation).
- It applies only when the Horse closes the action.
- Cash only.

## Replay

- Replay: NOT RUN (the record is new and holds nothing in production; no audited decision has a bettor with a shown flop record)
