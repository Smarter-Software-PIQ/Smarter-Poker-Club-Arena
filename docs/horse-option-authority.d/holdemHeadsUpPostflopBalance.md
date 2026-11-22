# holdemHeadsUpPostflopBalance: authority for the live switch

**State: OFF in source (read `=== true`), switchable (`HorseOptionSwitch.ts`), no switch row in production. Do not switch on.** Evidence NOT MET: mechanism, scope, receipts, unit tests, and byte-identical off behavior are recorded, and exposed-board solver scores improved on flop and turn (with the river part removed on 2026-11-16 after `11/41` river games regressed by more than 5 pot points), but the hosted solver-hydrated Tier 1 league evaluation (`44995766274`, `nlh_hu_postflop_balance`) finished unresolved (`-0.27 +/- 0.98 bb/100`, `z = -0.27`, `0/0/0/0`), prior local mirror (`-0.56 bb/100`) and HU human-calibrated (`-1.82 bb/100`) checks were also non-positive, and no replay on real audited decisions has been run.

Source changelog: `docs/changelog/2026-11-15-a-heads-up-holdem-postflop-balance-rule-built-default-off.md`.

## What it does

Source: `server/src/engine/HorseHeadsUpPostflopBalance.ts` (`holdemHeadsUpPostflopBalance`), `server/src/engine/HorseLogic.ts` (`opts.holdemHeadsUpPostflopBalance === true`), `server/src/engine/horseDecision/responseValidation.ts` (request-bound receipt admission for bet-to-check and fold-to-call transitions), `server/src/engine/HorseDataLedger.ts` (flag `holdemHeadsUpPostflopBalance`).

Scope: no-limit hold'em cash, one board, no bomb pot, single-raised pot (one preflop raise), exactly two players left, neither all-in, effective stack at least `20 bb`, hero in position. Tournaments, 3-bet pots, multiway pots, out-of-position play, and river decisions are untouched.

- **Flop c-bet (`flop_cbet`):** hero made the preflop raise and the flop is checked to hero. Replaces a check or bet with a single `0.75`-pot bet size at a frequency by hand tier (`nutted`, `top`, `mid`, `weak`, `draw`, `air`), otherwise check.
- **Flop check-raise defense (`flop_vs_check_raise`):** hero c-bet the flop and faces a check-raise. Turns a fold into a call with middle pair or better or a flush/open-ended straight draw (with less than top pair, only when the call costs at most half of hero's stack).
- **Turn checked to hero (`turn_checked_to`):** replaces a check or bet with a single `0.70`-pot bet size at a frequency by hand tier, otherwise check.
- **River excluded (revised 2026-11-16):** the original full-pot river part was removed after `11` of `41` river games in the HV31 turn/river bank regressed by more than `5` points of the pot (worst `+17.5`). With the option on, a river decision is returned unchanged and draws no random number.

Default OFF in source: read strictly as `opts.holdemHeadsUpPostflopBalance === true`. Absent or `false`, the module returns the original decision object unchanged and draws no random number. Registered switchable (`off` / `on`) in `HorseOptionSwitch.ts` (derived from `HorseDataLedger.ts`; follow-up migration `20261116140705_horse_option_switch_flop5_heads_up_balance_and_v31_off_only.sql`).

## The order it rests on

No owner or lane-lead order to activate `holdemHeadsUpPostflopBalance` is recorded in the repository. It was built in HV31 FLOP-5 D1 (2026-11-15) from development-grade solver exploitability measurements (`FLOP-3 B9/B6`, `FLOP-4 W7/C1`, `FLOP-5 D1`).

## Receipts

- `hu_postflop_balance_flop_cbet` (`HorseDataLedger.ts`): heads-up IP NLH cash flop c-bet replaced by `0.75`-pot size or check at tier frequency.
- `hu_postflop_balance_check_raise_defend` (`HorseDataLedger.ts`): heads-up NLH cash flop fold to check-raise after c-bet converted to call for middle pair+ or FD/OESD.
- `hu_postflop_balance_later_street` (`HorseDataLedger.ts`): heads-up IP NLH cash turn checked-to decision replaced by `0.70`-pot size or check at tier frequency.

## Tests

- `server/src/engine/HorseHeadsUpPostflopBalance.test.ts`: unit tests for spot predicates, tier frequencies, check-raise defense stack cap, and river exclusion, plus `HorseLogic.decide` pins proving action, amount, and next random value are identical for absent vs `false` across `96` real table states and river unchanged across `24` table states.
- `server/src/engine/horseDecision/responseValidation.test.ts`: pins request-bound receipt admission for D1 bet-to-check and fold-to-call transitions.

## Evaluation

### 1. Hosted Solver-Hydrated Tier 1 League (`2026-11-22`, Run `44995766274`)

Measured via `.github/workflows/horse-league-card-hydrated.yml` (`2026-11-22T06:53:47Z` to `07:03:28Z`, engine `6336dcf6c90d3c02b38e5cb803ae264bd0b13e0d`, hydrated solver stores `charts=240`, `postflop=7,747`, `postflopV31=0`, `EQUITY_GOVERNOR=off`; archive `HYDRATED-TIER1-RESULTS-20261122.md`). Card `nlh_hu_postflop_balance` (HU NLH cash mirror, `productionStyles: true`, arm A `{"holdemHeadsUpPostflopBalance":true}` vs arm B `{}`, 3 seeds x 6,000 pairs = 36,000 hands):

| Seed       | Pairs (Hands)       | A - B (bb/100) |   stderr | blockSE (40 blocks) |         z | Verdict               | Divergent pairs |    Wall | Safety (ill/trunc/corr/fb) |
| ---------- | ------------------- | -------------: | -------: | ------------------: | --------: | --------------------- | --------------: | ------: | -------------------------- |
| `20261120` | 6,000 (12,000)      |          +2.51 |     1.70 |                1.55 |     +1.47 | not resolved          |             535 | 181.0 s | 0/0/0/0                    |
| `20261121` | 6,000 (12,000)      |          -0.37 |     1.63 |                1.40 |     -0.23 | not resolved          |             536 | 174.0 s | 0/0/0/0                    |
| `20261122` | 6,000 (12,000)      |          -2.94 |     1.77 |                1.58 |     -1.66 | not resolved          |             577 | 169.9 s | 0/0/0/0                    |
| **Pooled** | **18,000 (36,000)** |      **-0.27** | **0.98** |                 n/a | **-0.27** | **not resolved (NS)** |       **1,648** |     n/a | **0/0/0/0**                |

### 2. Local Unhydrated League & Development Solver Measurements

- Local unhydrated league checks: HU NLH mirror `-0.56 bb/100` and HU NLH human-calibrated `-1.82 bb/100` (non-positive / unresolved).
- Exposed development-bank solver scores (HV31 FLOP-5 D1, zero-rake 80bb IP, in-tree best response; not held-out qualification): flop best-response gain fell from `50.31%` to `8.16%` of pot (`24/24` boards better); turn mean gain down `19.9` pot points (`8/8` boards better); check-raise defense has no solver score in that tree; river part removed after `11/41` games regressed `> 5` pot points.
- Known limit: while enabled, opponent reads no longer adjust c-bet or checked-to turn bets in its spots.

## Evidence rows

- Mechanism, scope, receipts, unit tests, byte-identical off: MET.
- Value (mirror and vs people): NOT MET (hosted solver-hydrated mirror `-0.27 +/- 0.98 bb/100`, `z = -0.27`, NS; local mirror `-0.56 bb/100`; local HU human `-1.82 bb/100`).
- Replay on real audited decisions: NOT RUN (see Replay).
- Owner activation authority: NOT MET (no order recorded).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-22 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)

## Rollback

No production switch row exists (source default OFF). If ever enabled, immediately roll back to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('holdemHeadsUpPostflopBalance', 'off', '<actor>', '<reason>')`), restoring the base brain within ~30s with zero data migration needed.
