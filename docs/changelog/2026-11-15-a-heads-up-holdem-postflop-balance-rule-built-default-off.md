# A Heads-Up Hold'em Postflop Balance Rule, Built Default Off (2026-11-15)

Owner: HV31 solver (FLOP-5 D1). Nothing in this change is switched on.

## Shipped (Dormant)

- New option `holdemHeadsUpPostflopBalance` (read only as `=== true`; ledger flag default OFF, three receipts
  `hu_postflop_balance_flop_cbet`, `hu_postflop_balance_check_raise_defend`, `hu_postflop_balance_later_street`).
- `server/src/engine/HorseHeadsUpPostflopBalance.ts`, run as the first call of the `wager_rules` node so every
  later owner rule still judges what it leaves. Spot: no-limit hold'em cash, one board, no bomb pot, one preflop
  raise, exactly two players, neither all in, at least 20 bb, hero in position. Hand tier from hero's two cards and
  the public board only (nutted, top, mid, weak, draw, air).
  - Flop c-bet after a check (hero raised preflop): one 0.75 pot size at a frequency by tier, otherwise check.
  - Facing the flop check-raise after that c-bet: a fold becomes a call with middle pair or better or a strong draw
    (below top pair only when the call costs at most half the stack).
  - Turn and river checked to hero: one size (0.70 pot, full pot) at a frequency by tier, otherwise check.
- `responseValidation.ts` admits the two non-wager transitions the rule can make (bet to check on a street checked to
  hero, fold to call facing the flop check-raise), each only where the rule's own spot test, re-run on the request,
  agrees.
- League card `nlh_hu_postflop_balance` (a: option on, b: today's brain).
- Registry follow-up `20261115211445_horse_option_switch_holdem_heads_up_postflop_balance.sql`, written by
  `gen-horse-option-switch-sql.ts --follow-up`: lists only, one new name, offered off and on.

## Why

Solver measurements of the hold'em Horse in heads-up single-raised pots in position (HV31 FLOP-4 W7 and C1,
development grade): a flop c-bet mix whose size carries strength (bets about 80% of range), over-folding to the flop
check-raise (86.7% against a model 62.8%), and over-betting middle-strength hands on the turn and river after a check.
The frequencies are a calibration by inspection of those profiles; the before and after solver scores are not run.

## Default Path

With the option absent or false the module returns the same decision object and draws no random number. The test
through `HorseLogic.decide` pins action, amount and the next random value identical for absent and false on 96 real
table states.

## Deliberately Not Changed

- No switch row is written and no evidence file exists: the option is an opt-in arm. Switching it on needs the eight
  rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`, an exact-head review and the row-writing rule (a row only after
  every serving engine carries the name).
- Tournaments, 3-bet pots, multiway pots and out-of-position play are untouched. While the option is on, reads of the
  opponent no longer move the c-bet or the checked-to turn and river bet in its spots.
