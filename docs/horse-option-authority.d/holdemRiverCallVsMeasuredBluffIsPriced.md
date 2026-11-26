# holdemRiverCallVsMeasuredBluffIsPriced: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). Evidence NOT MET. NOT READY: it does not win against a measured over-bluffer (ON - OFF -4.1 ± 3.8 bb/100 heads-up), which is its grade. It must stay OFF; this file does not authorize switching it on.

## What It Does

No-limit hold'em cash (table and Lightning), one board, heads-up, the river, facing his bet when the Horse has not wagered on the river. The brain's fold becomes a call only when both of these hold:

- HIS OWN record of called river bets at this size that were SHOWN puts his bluff share above the balanced share s / (1 + 2s) for the size, after shrinking to that balanced share. The record is `horse_exact_profiles.postflop_bets` shownBet, read through `HorseMind.postflopBetsOf`. Air means the shown hand was "high card". A mucked or folded hand is never read.
- The call prices above zero against his bet, read with that bluff share. His line range is the hvc line model, and his river wager's bluff part is set to the measured share.

What it never does:

- With no record, or a record at or under balanced, the decision stands as today.
- It never raises, and never turns a call into a fold.

Receipts: `holdem_river_call_vs_measured_bluff_called`, `_kept_fold`, `_not_above`.

## Prior anchor

- Baseline: the balanced bluff share s / (1 + 2s) for his bet size s (the share that leaves a bluff catcher indifferent). With no record, the share equals the baseline, so no call is ever added.
- Population weight: zero. No population bluff share (people or Horses) is read.
- Own record: his shown air share at the size, as (shown x air + 20 x baseline) / (shown + 20). It dominates as his shown sample grows, and it can move the decision only above the baseline.
- No unshown cards: only hands shown at showdown are classified. No mucked or folded hand is read, and no hole card is read.

## How To Trial It (Live Shadow Stage)

The option is staged as `holdemStage(['nlh_cash', 'nlh_lightning'], ['river'])`.

- To start: `node scripts/ops/horse-option-switch.mjs set holdemRiverCallVsMeasuredBluffIsPriced shadow`.
- To watch: `node scripts/ops/horse-option-shadow-watch.mjs holdemRiverCallVsMeasuredBluffIsPriced --since <ISO>`. The only direction it can take is fold to call.

## Grades (chips), 2026-11-25

How the grades were run:

- Lane harness scripts are in `plo-lead7-01TLQer8/records/src`.
- Production options of 2026-11-25 run in both arms.
- Every sandbox learns the record from its own hands (`HorseMind.setLearnsPostflopBetsInSandbox`).

Probes: heads-up, 100 bb, 15,000 hands per arm, memory on. The script is the production Horse except on the river first to act or checked to, where it bets 2/3 pot with strong hands and bluffs air at rate q. Results are ON - OFF, differenced hand by hand.

| Script                   | Its river bluff share    | ON - OFF                   |
| ------------------------ | ------------------------ | -------------------------- |
| Value-heavy (q = 0)      | 0%                       | 0.0 ± 0.0 (never calls)    |
| Near-balanced (q = 0.25) | 22%                      | 0.0 ± 0.0                  |
| Over-bluffer (q = 0.9)   | 48%                      | **-4.1 ± 3.8** (not a win) |
| Always-caller            | no river bets of its own | +14.8 ± 8.5                |

League mirror (production Horses on every seat), ON - OFF bb/100 per seat:

| Table                  | Result     |
| ---------------------- | ---------- |
| Heads-up, 60,000 hands | -5.4 ± 2.2 |
| 6-max, 20,000 hands    | +0.5 ± 0.4 |

- Heads-up the option fired 4 calls in 60,000 hands (2,104 records were not above balanced).
- So the heads-up difference comes from the memory divergence after those few changed hands, not from the calls' own chips.
- With an unused option the mirror reads exactly 0 ± 0.

Speed (HorseLogic.decide where it applies, the full pricing path forced, 684 river folds facing a bet at 100 bb): ON p50 / p95 / max 0.69 / 1.06 / 5.61 ms, against OFF 0.62 / 0.93 / 4.26 ms. The bar is p95 <= 10 ms and max <= 25 ms.

Law test: `HorseCallsOnHisShownRecord.law.test.ts`. It shows that with no record nothing changes, that against a far-over-bluffing script folds become calls, and that against a bettor who never bluffs it never calls.

## Why It Does Not Win Yet

The record grows only from his called bets that reach showdown. Against the over-bluffer, the Horse calls rarely, so few of its bluffs are shown and the shrunk share stays close to balanced. The few calls it adds are priced against the hvc line range, whose value part may be weaker than this script's value bets (equity 0.8 or more against a random hand). Not tuned.

## Limits

- Heads-up and the river only.
- Cash only.
- The record classifies a board pair or one pair as value. That understates bluffing, which is the safe direction.

## Replay

- Replay: NOT RUN (no audited decision set holds an NLH river fold against an opponent with a shown record; the record is new and holds nothing in production)
