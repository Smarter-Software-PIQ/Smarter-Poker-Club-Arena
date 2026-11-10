# The Charles Rule judges a double before the house's take

Owner report, 2026-11-10 09:46 America/Chicago: "i just fully doubled up, and
it did not add the 10 additional hands before i have to leave (charles rules)".

## What happened

Cash session a47b9e43 (Lightning, table 8122f139) started its hit-and-run
countdown at 15:43:43Z with a reference stack of 114.46. Hand f7f69559
(Lightning hand 58348066) was an all-in the owner won: a 229.67 pot, rake
1.25 and jackpot drop 0.30, paid 228.12. `fn_cash_session_evaluate` tested
`stack >= 2 * reference`, 228.12 against 228.92, and refused the double by
0.80. The rake and drop taken from the pot he won were the whole difference.

## The fix

Migration `20261110155259_charles_rule_doubles_are_judged_before_the_house_take.sql`:

- `fn_cash_hit_run_house_take(hand_id, user_id)` reads the hand's own
  `hand_history` row and returns what the house took from the pots this player
  won: per pot, (gross pot minus paid to every winner) times this player's
  share of that pot's payout.
- `fn_cash_session_evaluate` judges the Charles Rule double on
  `stack + house take >= 2 * reference`. The new reference is still the stack
  actually held. Nothing else in the state machine changes.

Both callers already pass the hand_history id: the classic engine's `v_handId`
(its history step runs before chip continuity) and the Lightning settlement
trigger's `lightning_hand.hand_id` (equal to `hand_history_id` on 5,009 of
5,009 settled hands checked, history always written before `settled_at`).

No tolerance constant and no repair job. Pinned by
`tests/unit/charlesRuleDoubleBeforeHouseTake.pg.test.ts`, which installs the
migration on real PostgreSQL with the production hand's exact pot.

## The owner's session

By diagnosis (15:51Z) it had already played its ten hands and read
`hr_completed = true`. Re-locking a completed session after the fact is not a
correction the rule defines, so the row was left unchanged. No money moved.
