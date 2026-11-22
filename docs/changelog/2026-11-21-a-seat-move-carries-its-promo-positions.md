# A seat move carries its promo positions (2026-11-21)

Incidents `bb04ee5f` (ServerTableEngine.authoritative_hand_unreachable),
`e542fbd7` (postHandTasks.hand_history_failed) and `887c0008`
(ClubArenaEngineKillStorm) were one chain.

## What happened

- 07:49 UTC: player `e922e29a` bought in to cash table `dbbc148e` (cluster
  `37ac7634`) with 7.35 chips, all promo principal, so
  `ca_promo_principal_custody` held 7.35 at `(table_stack, dbbc148e)`.
- 07:53: the cluster balancer moved the seat to feeder `a5d84d81` with 7.20.
  `fn_cash_seat_move_execute` moved the chips and the Diamond custody, and
  nothing else: the promo principal stayed keyed to `dbbc148e`.
- 07:53-08:16: 37 hands on the feeder. `fn_ca_promo_accept_cash_hand` looked
  for a position at `a5d84d81`, found none and charged no loss to the promo
  while the stack fell to 2.64.
- 08:16: a must-move brought the seat back to `dbbc148e`. Hand #60380607 met
  7.20 of principal against a 2.64 stack and `fn_ca_promo_profit_capture_cash`
  refused it with `original_winnings_sources_exceed_accepted_stack`, thirteen
  identical times. The generation was terminated with the hand retained
  (incidents `bb04ee5f`, `e542fbd7`), and the successor spent the hand's one
  financial claim on the same refusal, so every start after that read
  `successor_financial_claim_spent` and the table was rebuilt about twenty
  times a minute for six hours (incident `887c0008`, 34 kills in the first
  15 minutes, labelled `start_failed:start_seed_hand_count` because the resume
  throws before any later boot phase is stamped).

## Root fix

`20261121143259_a_seat_move_carries_its_promo_positions` adds
`public.fn_ca_promo_follow_seat_move(user, from, to)` and calls it from
`fn_cash_seat_move_execute` for the mover and the swap partner, right after
the Diamond custody follows the seat. Inside the move's own transaction it
takes the cash-out's locks, then moves integrity (with its winnings overlap),
winnings and open-grant principal from the old table to the new one with the
platform's existing movers, and refuses the move
(`promo_position_left_behind_by_seat_move`) if anything is left behind.
Probed on production in a self-aborting transaction: 2.54 principal moved
from `dbbc148e` to `a5d84d81`, conservation constraints held, a player with no
position was a no-op.

Pinned by `tests/a-seat-move-carries-its-promo-positions.law.test.ts`.

## Settlement (active outage, applied directly and recorded byte-exact)

1. `20261121142000_promo_positions_spent_on_feeder_hands_settle_table_dbbc148e`
   spent the 4.56 the feeder hands should have charged (principal never
   exceeds the stack it rides on), FIFO through
   `fn_ca_promo_move_selected_custody`. No chips moved: grant `aaf34f38`
   closed spent, `775cb978` kept 0.51, 2.64 stayed on the felt.
2. `20261121142714_feeder_seat_move_stranded_cash_hand_settles_once` proved
   the stranded hand from its own rows and certified it through
   `certify_original_hand_source_correction` (no payment).
3. `20261121143102_a_feeder_promo_position_correction_may_claim_on_a_cash_table`
   let the claim guard's cash branch admit that one proof.

The engine's own resume then settled hand #60380607 at 14:31:24 UTC with its
original request; the kill storm stopped and the table dealt again.

Note: the headers of (1) and (2) name the root-fix migration by the version
it was expected to get (`...142100`, `...143500`); the reserved version is
`20261121143259`. The files are recorded byte-exact in production history,
so the headers stay as they are.

## Why the claim guard needed a third edit

The resume door, the proof dispatcher and the claim guard each name every
correction cause explicitly, so each stranded-hand settlement needs three
coordinated edits, and missing the third (as happened here for two minutes)
leaves the table looping with `HAND_SOURCE_CORRECTION_LEASE_REFUSED`.
