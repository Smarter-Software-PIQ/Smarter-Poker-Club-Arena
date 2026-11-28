# spin-ladder-rung-overshoot: recurrence on 2026-11-24 (read-only)

Read by the Production Alerts PRIMARY lane at 19:45-19:50Z on 2026-11-24, from
`tournaments`, `table_seats`, `chip_ledger`, `v_spin_unfilled_waits` and
`operational_alert_events`. No row was written apart from the fleet's own
alert-store rows.

## The alert

- `operational_alert_events` 448694 (`SpinFleetProducingNothing`, critical,
  firing 19:17:27Z): "A seated Spin board has waited 8734s without dealing".
- 448697 (resolved 19:38:27Z): the same board, now at 9935 s.
- On arrival the alert-quality rule marked both rows `informational`
  (`resolved_twin_arrived`). A resolved twin is not a root-cause repair, so this
  lane linked them to the open incident.

## The board

`3b4c6299-ab1a-4297-b36a-891c980c8ff2`, "5 Chip Deep Stack Spin NLH":

| time (UTC) | event |
|---|---|
| 16:50:35 | first entry (5.00 buy-in) |
| 17:09:45 | second entry (5.00 buy-in) |
| 17:49:52 | the rung closed (`start_time`), with the board 2 of 3 |
| 19:36:23 | the board was CANCELLED with no third seat filled; both entries were refunded 5.00 each |

The board was not filled for 106 minutes after its rung closed. In the same
hours Spins started 5 to 7 an hour, each within 5 s of its own rung. The pool
was not empty. It went to fresher boards, which is the shape #11389 diagnosed
on 2026-11-19 (2db5ea97, 1951 s late).

While this was being read (19:49Z), the oldest waiting board `935e11b9` ("3 Chip
Spin PLO4", 2 of 3, seated since 17:37:42Z) was already 1277 s past its rung,
with ten fresher boards behind it inside their rungs.

## Money

Every entry was refunded through the idempotent
`tourney:<id>:refund-entitlement:<registration>` keys: 16:59:52Z, and twice at
19:36:23Z. Nothing is owed.

## Why the fix was not live

#11389 was opened as a draft on 2026-11-19 and was never marked ready. By
2026-11-24 it no longer applied to main: `GameServer.ts` and
`seatFirstLadder.ts` had moved (`clampSpinRungWaitMs` and
`spinTwoOfThreeDeferMs` were added). This PR ports the same change onto current
main. The ten-minute backoff, `Math.min(12_000 * 2 ** Math.min(misses, 6), 10 * 60_000)`,
was still in `topUpPartialSeatFirst` at main `9de9bc2db`.
