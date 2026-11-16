# A Heads-Up Hold'em Postflop Balance Rule, Built Default Off (2026-11-15)

Owner: HV31 solver (FLOP-5 D1). Nothing in this change is switched on. Revised 2026-11-16: the river part was
removed after the solver score (section "Revised").

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
  - Turn checked to hero: one 0.70 pot size at a frequency by tier, otherwise check.
  - The river is not covered: with the option on, a river decision is returned unchanged and draws no random number.
- `responseValidation.ts` admits the two non-wager transitions the rule can make (bet to check on a flop or turn
  checked to hero, fold to call facing the flop check-raise), each only where the rule's own spot test, re-run on the
  request, agrees.
- League card `nlh_hu_postflop_balance` (a: option on, b: today's brain).
- Registry follow-up `20261115211445_horse_option_switch_holdem_heads_up_postflop_balance.sql`, written by
  `gen-horse-option-switch-sql.ts --follow-up`: lists only, one new name, offered off and on.

## Why

Solver measurements of the hold'em Horse in heads-up single-raised pots in position (HV31 FLOP-4 W7 and C1,
development grade): a flop c-bet mix whose size carries strength (bets about 80% of range), over-folding to the flop
check-raise (86.7% against a model 62.8%), and over-betting middle-strength hands on the turn and river after a check.
The frequencies are a calibration by inspection of those profiles, on the same exposed boards the scores below use.

## Revised: The River Part Removed (2026-11-16)

The before and after solver scores of the first version (option off against option on, same brain otherwise; HV31
FLOP-5 D1, development grade, exposed boards, zero-rake 80 bb game, in-position seat, in-tree best response):

- Flop (24 boards): the opponent's best-response gain fell from 50.31% to 8.16% of the pot, better on all 24 boards.
- Turn (48 games, 8 boards): mean gain down 19.9 points of the pot, all 8 boards better.
- River (41 games, 8 boards): mean gain down 13.7 points and all 8 boards better on average, but 11 of the 41 games
  got worse by more than 5 points (worst +17.5). That fails the bank's own rule that no single game may get worse by
  more than 5 points, so the river part (bet the full pot when checked to, by tier) is removed.

The flop c-bet, the flop check-raise defence and the turn rule are unchanged, byte for byte. A river rule is left for a
later redesign scored on fresh river games; it is not re-tuned on these 41 games, which would only fit them. The
check-raise defence has no solver measurement yet (the scored flop tree has no raise after the one large c-bet).

## Default Path

With the option absent or false the module returns the same decision object and draws no random number. The test
through `HorseLogic.decide` pins action, amount and the next random value identical for absent and false on 96 real
table states. With the option on, a checked-to river gives the same action, amount and next random value as the
default path (24 table states), and the module draws no random number there.

## Deliberately Not Changed

- No switch row is written and no evidence file exists: the option is an opt-in arm. Switching it on needs the eight
  rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`, an exact-head review and the row-writing rule (a row only after
  every serving engine carries the name).
- Tournaments, 3-bet pots, multiway pots and out-of-position play are untouched. While the option is on, reads of the
  opponent no longer move the c-bet or the checked-to turn bet in its spots. River play is the brain's own.

## SSD2 Continuation On November 16

The heads-up balance and dormant V31 v3 source ship together with one generated registry follow-up, `20261116140705_horse_option_switch_flop5_heads_up_balance_and_v31_off_only.sql`. It preserves the current protected-main options, including the PLO6 off-only hold. Earlier unpushed follow-ups are superseded in Git history. The heads-up option remains default off, the river rule remains removed, and V31 serving remains off-only. No switch row, dataset registration, promotion or binding is written.

The reference decision-source registry hashes the heads-up module in every policy digest. TypeScript and all six focused brain/V31/digest suites passed (74 tests) on the combined source. The frozen second turn/river score reports IMPROVED from the turn, no frozen regression and no demonstrated river improvement. These are exposed development-bank measurements, not live or held-out qualification. Current main's diagnostic-timing correction to the Omaha identity test is preserved unchanged.

### Request-Bound Worker Receipt

A D1 bet-to-check receipt requires the original player and game state and must match the existing heads-up cash spot predicate. Request-less NLH receipts keep their prior refusal; legitimate live, journal and league callers already supply the request. The actual ON-producer regression fails without this guard and passes with it, together with all101 general receipt tests and the30 D1 tests. This changes validation only, preserving action production and the scored random stream.
