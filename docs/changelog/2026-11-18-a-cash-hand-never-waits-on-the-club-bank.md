# A cash hand never waits on the club bank (incident 075013fd, lane H1)

**Date:** 2026-11-18. **Lane:** H1 (cash/promo entries of the hand-path allowlist).

## What the reader said

`public.fn_ca_hand_path_shared_writes()` (#11281) listed 23 allowlisted
shared-row writes on a hand's money path. Lane H1 owned the ones reached
through the cash and promo path.

## Eleven were triggers that cannot fire

The reader followed an `UPDATE OF` trigger whenever the statement's text named
one of its columns anywhere. PostgreSQL fires such a trigger only when one of
its columns is a target of the `SET` list. Read on production:

| Statement on the path                                                                                                                                   | Column only in | Trigger that never fires                                                                                                         | Entries                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `promo_apply_playthrough`: `UPDATE club_members SET promo_wagered, updated_at` (release: `chip_balance, promo_*`) `WHERE club_id = .. AND user_id = ..` | WHERE          | `trg_sync_club_member_count` (OF status, club_id, role), `club_staff_notice_membership` (OF role, status, ..., club_id, user_id) | `fn_apply_club_ladder` write clubs, `fn_sync_club_staff_notice_group`                               |
| `fn_require_live_seat_parent`: `UPDATE tables SET seat_admission_key = CASE WHEN lower(t.status) ...`                                                   | CASE / WHERE   | `trg_on_table_status_change`, `trg_tables_sync_club_counts_upd`, `member_club_standalone_game_guard`                             | `fn_refresh_club_activity_counts`, `fn_sync_club_table_counts`, `guard_member_club_standalone_game` |
| `fn_sync_tournament_current_players`: `UPDATE tournaments SET current_players WHERE .. AND status IN (..)`                                              | WHERE          | the `UPDATE OF status` triggers on tournaments                                                                                   | `fn_ca_fund_overlay_on_lock` x4, `fn_guard_tournament_start_readiness` x2 (lane H2's)               |

Fix: the reader matches trigger columns against the statement's SET targets
(`setTargets` in `scripts/ci/hand-path-shared-writes.mjs`; the multi-column
`SET (a, b) = ...` form keeps the conservative every-word match). Installed by
`20261118160106` (no table lock). Measured on production with the new block:
726 functions on the path (875 before), 12 violations (23 before), nothing new.

## Five are real, and are fixed at the source

The cash hand's own settlement (`fn_ca_settle_hand_stacks_absolute`) credits a
seat that left mid-hand to its member wallet. For a deleted account the
`zzzz_deleted_member_credit` trigger then took the club bank row
(`fn_ca_deleted_wallet_bank_return`, lock_timeout 4 s) inside the hand; for a
split-departed horse record (up to 23 held cash seats on 2026-11-18)
`fn_ca_horse_split_return_late_credit` took it `FOR UPDATE` under a 200 ms
wait, which also queued behind any insert referencing the club. Both bank
writes then fired `trg_union_totals_follow_club_counts`, a statement trigger
on every clubs UPDATE, into the union ladder.

Two migrations:

**`20261118161644`** (installs on merge, no table lock):

1. `fn_ca_deleted_wallet_bank_return_nowait`: the return's money logic, byte
   for byte, bank row NOWAIT. `fn_ca_deleted_wallet_bank_return` keeps its
   signature, 4 s wait and callers, taking the same rows in the same order
   first.
2. Never waits, never strands. Inside a hand (the settlement door's
   late-seat credit, or the post-commit envelope, found by
   `fn_ca_hand_context_table`) a busy bank stores the return in
   `hand_wallet_return_pending` for the table. The chips stay in the
   member's wallet, journaled. `fn_project_hand_side_effects`, the table's
   own continuation, banks it (wired by `20261118191855`, its own migration,
   on top of #11300's postimage: after its up-front try-locks and inside
   the same 1 s deadline) with try-locks through
   `fn_ca_bank_pending_wallet_returns` before any other lock, and ends its
   pass until it is banked, so the outbox row of the hand that stored it
   cannot leave first. `fn_ca_post_commit_lag_watch` (cron 569) pages a
   stored return older than 15 s as critical for its table. Outside a hand
   the caller retries NOWAIT for the time it always waited (4 s deleted,
   200 ms horse). No timer, no sweep.
3. The horse split return's body is `fn_ca_horse_split_return_now`
   (`FOR NO KEY UPDATE NOWAIT` on the bank).

**`20261118161703`** (daily 04:00 window: it replaces triggers on clubs and
profiles):

4. Account deletion gets its own trigger function
   (`fn_ca_deleted_profile_bank_return`, the same code), so the member-credit
   trigger no longer names the blocking return.
5. The union totals trigger becomes a row trigger on `UPDATE OF` the four
   count columns `WHEN` one changed.

Proof (`scripts/ci/test-hand-path-cash-lane.py`, PostgreSQL, production
texts): before, a hand crediting a deleted account under a held bank waited
4.0 s and failed; after part 1 it completes at once with the return stored
for the table, every projection pass while the bank stays held ends without
banking and keeps the hand's outbox row, and the first pass after the bank
frees banks the whole balance; the same for a split-departed horse and for a
credit inside the post-commit envelope.
Uncontended, every balance, bank, receipt and alert is identical before,
after part 1 and after both.

## Allowlist

`20261118161644` removes three entries now (in this change). The last two
(`fn_ca_deleted_wallet_bank_return` row_lock clubs, `fn_apply_union_ladder`
write unions) stay until `20261118161703` installs at 04:00 Chicago; removing
them earlier would turn the live check red for every pull request until then.
Remove them, and refresh
`scripts/ci/fixtures/hand-path-shared-writes/production-2026-11-18-set-list-targets.json`,
in the change after the install. The law test fails on a stale entry against
that fixture.

## Stacking (merge order #11300 -> #11311 -> #11301)

This branch is rebased on #11300 (lane P2, `20261118155509`, the projection
pass never queues) and #11311 (lane H2, `20261118155729`, its SET-target
reader). `20261118191855` pins #11300's postimage `94588bd7...`.
`20261118160106` (this lane's stricter SET-list rule) replaces H2's reader,
because H2's rule still follows a trigger through an unqualified `col =` in a
WHERE clause. The allowlist is the union of both lanes' removals.
