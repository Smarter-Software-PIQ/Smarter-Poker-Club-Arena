# 2026-11-07 - An open chair is offered to the waiting list

Found while verifying the 16:31 UTC engine release (horse waiting lines live):
people sat on game waiting lists beside open chairs. 3Putt on NLH 0.10/0.25
Classic since 22:50 the night before with its feeder at 2/9; Rubdznuts on PLO4
0.50/1 Classic with the game at 0/6; Rooster on two lists since 05:05.

Cause: a game-list seat was offered only when somebody cashed out
(atomicCashout -> notifyWaitlistSeatOpen -> fn_offer_open_seat). An already
open chair is never "vacated", so it was never offered.

Fix: `20261107163937` adds one step to `fn_cash_cluster_tick`, before OPEN:
while the game has a waiting row, each live table's open unreserved chairs are
offered through `fn_offer_open_seat` (60 s hold, FIFO, nonblocking, refuses
full and tournament tables, expires lapsed holds). A horse at the head answers
through claimOfferedSeats like a person. Each call is a subtransaction, so a
refused offer never fails the tick. Pinned by
`tests/an-open-chair-is-offered-to-the-list.law.test.ts`.
