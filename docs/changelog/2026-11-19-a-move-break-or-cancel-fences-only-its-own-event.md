# A move, a break, the entry close, a bounty sweep and a cancel fence only their own event (incident 075013fd, lane E2)

Owner rulings: "a tournament issue must always be isolated and never affect
other tournaments or cash games" (2026-11-17); "I don't want any unintended
delays".

Migration `20261119053909_a_move_break_or_cancel_fences_only_its_own_event.sql`.
It requires `20261119011750` (lane R2) and refuses to install without it.

## What was left after lanes T, R and R2

Each of these took the event's lane T(id) **exclusive**, so every table of the
event stopped while it ran (production, edge log, 24 h to 2026-11-19 06:10 UTC):

| Call                                                                           | Calls in 24 h | What it touches                              |
| ------------------------------------------------------------------------------ | ------------- | -------------------------------------------- |
| `fn_f06_discover_breaks` (the break scan, every engine tick)                   | 21,717        | its own cursor row                           |
| `fn_sweep_pending_tournament_bounties`                                         | 5,638         | obligations, its claimants' rows and wallets |
| `fn_move_tournament_player` (balancing moves and break members)                | 3,658         | one player, two tables                       |
| `fn_close_tournament_entry_window`                                             | 2,455         | the tournaments row (mostly a read)          |
| `fn_collect_bounty_obligation` / `fn_collect_bounty`                           | 1,512         | one obligation, its claimants                |
| break steps: `fn_f06_request_park`, `fn_f06_begin_break`, `fn_f06_close_break` | 1,244         | one source table and its destinations        |

And a single event's cancel (`smarter_private.cancellation_lane` standalone
mode: operator and owner cancel, `atomic_cancel_tournament`, the abort settles)
tried the platform lane G and the hand barrier B **exclusive**: while held,
every table of every event and every cash hand stopped; whenever any hand
anywhere held B, it was refused.

## The fix

| Piece                                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.fn_ca_share_tournament_lane_for_tables(event, player, tables, try)`                             | New. The shared change lane of lane R (R(id) exclusive, G and T(id) **shared**, the transaction-bound marker `smarter_private.tournament_rebuy_lane_held` proves), then, when tables are named, the launch receipt, the event row and the tables' rows in id order: a hand commit's order (event row FOR SHARE, then its table row) and a live chair's launch-proof order (receipt, then event row FOR UPDATE). Re-entrant; under an exclusive authority already holding T(id) or G it takes only the rows; try mode never queues and holds nothing when busy |
| `fn_move_tournament_player`                                                                             | Takes it for its player and its source and destination tables, before any other row                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `f06_lock_break` (amend, close, claim, acknowledge, state), `fn_f06_begin_break`, `fn_f06_request_park` | Take it, then the break's source and destination tables, before `f06_prefix` locks the members' rows                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `smarter_private.f06_prefix`                                                                            | Locks a member's **live** chair, not every chair the member ever left: a left chair is a row of an untouched table whose hands lock all its chairs (the native proof found this: a break step paused an untouched table's F06 share for 1.8 s through a member's old chair)                                                                                                                                                                                                                                                                                   |
| `fn_f06_discover_breaks`                                                                                | The lease fence only: no lane, no tournament row. It never queues a hand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `fn_close_tournament_entry_window`                                                                      | The shared lane, no table rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `fn_sweep_pending_tournament_bounties`                                                                  | Tries the shared lane (never queues), then locks the tables its claimants sit at, in id order, before any roster row                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `fn_collect_bounty`                                                                                     | The shared lane (held already inside a rebuy, bust or sweep), then its claimants' tables before any roster row                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `smarter_private.tournament_bounty_claimant_tables`                                                     | New. The tables the players a pending bounty may pay sit at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `smarter_private.cancellation_lane`                                                                     | A plain event with a bank scope takes **its own finish lane** (G shared, F shared, F(scope) exclusive, T(id) exclusive: the 2026-09-17 wallet order of every finish). A satellite (two events) or an id that is not a plain event keeps the platform try. The held-lane branch accepts the event's own finish lane                                                                                                                                                                                                                                            |
| `smarter_private.cancellation_lane_for_events(ids)`                                                     | New. One id: `cancellation_lane`. Several: the original platform try (G then B exclusive, never queued, 55P03 before any write)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `fn_ca_request_tournament_abort`                                                                        | Goes through `cancellation_lane_for_events(ids)`: G only for a request naming several events                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `fn_ca_settlement_lane_doctrine`                                                                        | Rule 7 `an_event_change_fences_only_its_own_tables`; rule 2's pin on `cancellation_lane` moves to its new body                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Lock order: R(id), then lane T's G, F, B, T(id), then rows: launch receipt,
event row, tables in id order, roster, seats (lanes R and R2's order). Only
holders of R(id) lock more than one table row of an event, and they run one at
a time. A breaking table is parked, so its players are moved off before it
deals again: inherent, as before.

### What still waits, and why

A hand commit reads the event row FOR SHARE before its table row (lane B7's
audit), and every live chair a move creates takes the launch receipt and then
the event row FOR UPDATE (`fn_lock_tournament_launch_proof_parents`, through
`trg_lock_and_validate_tournament_live_seat`). So while a move, a break step,
the entry close or a bounty payout holds the event row, a hand **commit** at
another table waits for it - for that transaction's own duration, exactly as it
does for a rebuy or a bust today. Hand begins, actions, finishes, hole cards,
snapshots and post-commit writes never wait, and nothing waits on T(id) any
more. The lane takes the receipt and the event row before the tables, so the
two orders never cross (the first draft took the tables first; B7's
production-order hand commit in the native proof would deadlock against it).

## Proof

`scripts/ci/test-rebuy-never-pauses-the-tournament.py`, section LANE E2,
PostgreSQL 16 locally (CI 17), exact production pre-images
(`scripts/ci/fixtures/event-scoped-field-lane/preimages.json`, 21 md5s, the
production launch-proof trigger included) on top of lanes T, R, R2 and B7
installed natively, hand commits in production's lock order (B7's `w_commit`). Now wired into
`.github/workflows/tournament-event-lane.yml` (lanes R and R2 had no workflow).
All 269 checks pass:

- **Before:** a balancing move, a park, the break scan, the entry close and a
  bounty sweep each hold T(id) exclusive; a card write, an F06 share and a hand
  commit on untouched tables wait 1.93-2.05 s (the whole hold). One event's
  cancel holds G and B: another event's card write and a cash hand wait 1.96 s.
- **After:** card writes and F06 shares (hand begin, finish, continuation) on
  untouched tables proceed in 0.02-0.05 s while each holds; the move, park,
  begin, close and sweep hold T(id) `ShareLock`, the scan holds nothing (and a
  commit beside it takes 0.05 s); a hand commit elsewhere waits for the event
  row while the probe's holder sleeps (1.95 s, then commits). The cancel holds
  G `ShareLock` only: another event's card write and hand commit and the cash
  hand take 0.02-0.03 s, while its own event's card write waits for it (1.96 s).
- **Races, both orders:** a move against a hand of its source table and of its
  destination table; a break move against its destination table's hand (a hand
  begin at an untouched table does not wait); a park against its own table's hand; a
  sweep against a hand of its knocker's table. Each serialises on the table row.
- A whole table break: park, begin, every member moved with its winning
  receipt, the empty table closed.
- A sweep facing a busy event lane skips at once and holds nothing of it; a
  cancel of several events keeps the platform try and is refused (55P03) while
  any hand runs.
- **Chips conserved** after every step: wallets plus pools, felt against
  bought-in supply against roster, ledger against pools plus heads paid, every
  chair unique, the second event and the cash table unchanged, every moved
  chair emptied; every pending head paid exactly once.
- **Mixed run:** 246 transactions (real moves, sweeps, break scans, entry
  closes, bounty re-entries, production-order hand commits of the event,
  hands of a second event and of cash, card writes): **0 deadlocks**, every
  transaction committed (a move whose chair, picked before its locks as the
  balancer does, was taken first is refused by its own 23505 check and writes
  nothing; 0-1 per run). Hand commit p100 0.22-0.25 s, move p100 0.28-0.31 s
  on the test runner.
- Doctrine rule 7 names an unreviewed caller; the migration refuses without lane
  R2 and refuses to run twice.

Not executed natively, pinned by the law test only: `fn_collect_bounty`'s body
(the harness pays through the lane-shaped collection stub lane R2 uses) and
`fn_ca_request_tournament_abort`.

Law: `tests/a-move-break-or-cancel-fences-only-its-own-event.law.test.ts`.

## Stale pins

`fn_ca_guard_mtt_admission_contract` pins the sweep and the collection in its
activation manifest (a completed, immutable transition);
`smarter_private.original_hand_correction_sources_match()` pins `f06_prefix`
and already answers false on production. Both declared.

## Still open

- A cancellation now waits (bounded by the caller's `lock_timeout`, 100 ms
  after `bulk_closure_admission`) for its own event's hands and for a finish of
  the same bank scope, instead of being refused whenever any hand anywhere held
  B. A refusal is 55P03 `lock_not_available`, not `CANCELLATION_GLOBAL_LANE_BUSY`.
- A hand commit at another table still waits for the event row while a move,
  break step, entry close or bounty payout holds it (its own duration), as it
  does for rebuys and busts. Removing that needs the hand commit to stop
  reading the event row FOR SHARE, or the launch proof to stop taking it FOR
  UPDATE for a chair inside a running event; both are other lanes' code.
