# Paced hourly cash-table capacity

Owner direction November 16, 2026, chat `01a1e4f3-19fc-7333-913f-9ee6a9d35bf9`.
Cash games only. This supersedes the earlier unlimited autonomous cash-floor
policy for table count and gradual initial assembly. It changes no tournament
admission, registration, Horse schedule, strategy, blind clock, payout or break.

## Authoritative schedule

America/Chicago, including daylight-saving transitions. The lower number is the
desired operating floor when eligible demand and bankroll permit. The upper
number limits Horse-started capacity. Human-started games can expand beyond it.

| Hour     | Target range |
| -------- | ------------ |
| Midnight | 18-25        |
| 1 AM     | 15-18        |
| 2 AM     | 15-18        |
| 3 AM     | 12-15        |
| 4 AM     | 7-10         |
| 5 AM     | 5-8          |
| 6 AM     | 5-7          |
| 7 AM     | 7-9          |
| 8 AM     | 9-11         |
| 9 AM     | 10-13        |
| 10 AM    | 12-16        |
| 11 AM    | 13-17        |
| Noon     | 15-17        |
| 1 PM     | 15-18        |
| 2 PM     | 15-18        |
| 3 PM     | 15-18        |
| 4 PM     | 15-20        |
| 5 PM     | 18-22        |
| 6 PM     | 22-30        |
| 7 PM     | 25-33        |
| 8 PM     | 30-40        |
| 9 PM     | 30-40        |
| 10 PM    | 30-40        |
| 11 PM    | 25-29        |

## Implementation and acceptance plan

1. Count occupied cash tables from actual live seat rows, including single
   chairs and sit-outs. Empty lobby doors and tournaments consume no cash slot.
   Preserve any table with a human; missing identity is protected too. A human
   anywhere in a shared Lightning pool protects that shared game.
2. Enforce first-Horse entry in the original seat-admission trigger. Existing
   stack/settlement/departure updates keep their original early return.
   Concurrent autonomous starts share one capacity key; a refused transaction
   buys no seat and spends no chips. Human entry and existing game rules remain
   authoritative. A human who sits at an empty table grants that table support
   beyond the hourly cap, never permission for unrelated autonomous games.
3. Persist a 2-4 minute gap between autonomous new games, and separate 2-4 minute
   Horse arrivals while each new game assembles. The fleet reads one advisory
   projection, buys at most its permitted chairs and no longer invokes its old
   simultaneous second-Horse draw for these paced starts. Atomic SQL rechecks
   every purchase. No new timer or repair loop supplies correctness.
4. Choose one newest excess Horse-only table for closure at a time. Keep older
   established games stable. A second game cannot close until its own persisted
   2-4 minute gap has passed. Every active hand and completion presentation
   finishes before the original dealer performs the closure. A falling limit
   and initial excess converge gradually; they never justify interrupting a hand
   or closing the entire excess floor at once.
5. Close through the existing occupancy-bound forced cashout door, in one
   transaction. Preserve wallet/ledger/receipt authority. Any refusal rolls back
   the whole closure. Recheck human occupancy after serialization. Retain the
   original operation id after unknown acknowledgments and join its original
   database transaction before reading or repeating it. Stop the original
   dealer without awaiting its own loop.
6. A Lightning anchor chosen for closure receives no replacement hand after
   its current hand. The original legality reason chain still identifies
   IN_HAND first. Other anchors and human pools continue. The ordinary
   occupancy cashout door still refuses money in an unsettled Lightning hand.
7. A rising hourly limit reopens autonomous admission through the existing
   game controller and fleet. Closed capacity is not marked retired, disabled
   or permanently removed from the game definitions. Newly available games and
   their seats retain the same gradual-start rules. Eligibility, bankroll,
   stake, funding, game-enabled and maintenance safeguards stay in force.
8. Verify all 24 entries, midnight/DST, human starts/arrivals, shared Lightning
   protection, paced additions and removals, concurrent starts, rollback,
   lost-response replay, reopening and tournament exclusion in isolated PG17.
   Test the actual dealer boundary and strict original receipt validation.
   Existing required engine and accounting qualification retain financial-kernel
   coverage. The new native proof is enforced in that accounting route.
9. Protected PR and merge, exact migration installation and readback, exact
   candidate engine qualification on isolated Backup, immutable staging and the
   approved certified engine cutover. Verify the serving SHA and seal, natural
   paced closures with original cashout receipts, no Horse-only replacements,
   continuing human games and tournament advancement. Production probes never
   spend real chips or manufacture a human game for proof.

The migration installs inactive for the predecessor. The successor's verified
cash boundary binds activation to its current elected leader instance. A rollback
to an older leader immediately leaves the policy inactive rather than inheriting
a Lightning drain the older engine cannot complete. A compatible cold restart
re-enters the same source-owned boundary and restores the policy and pacing.

Preparation, source/test revisions, provider operation identities and live
observations belong in the owning external CHECKPOINT.md. A local pass or merge
is not deployment or live acceptance.
