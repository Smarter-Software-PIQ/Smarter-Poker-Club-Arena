# A break never offers two members one chair (2026-11-27)

## What was wrong

`tournament move destination seat is occupied` (SQLSTATE 23505, `fn_move_tournament_player` line 148) was still logged in pairs about 100 ms apart, in bursts every 4 to 5 s, on engine release f2b854319 (live 07:00:32 UTC), which already contains PR #12156. Counts by 3-hour Chicago bucket on 2026-11-26/27: 56 (6 to 9 PM), 12 (9 PM to midnight), 20 (midnight to 3 AM).

`smarter_private.f06_attempts` names every chair those requests asked for. Break b5685db5 (table 32756123, event 01cee40b):

- a6cd08f3: rev 1 dbc1b125#8 fenced, rev 2 0ec2f753#8 landed 07:22:40.554
- c402b38e: rev 1 edfd7354#9 fenced, rev 2 0ec2f753#8 fenced, rev 3 18a0c315#4 landed 07:22:45.161
- ecd88691: rev 1 edfd7354#2 fenced, rev 2 0ec2f753#8 fenced, rev 3 18a0c315#4 fenced, rev 4 2242b9fc#7 landed 07:22:48.697

Breaks 502decd1 (table 64f30f03: three members to 0c9285f3#1, then two to 0ec2f753#7) and 719cd639 (table 58f82b7f: three to 0c9285f3#8, then two to 4d9986ee#5) show the same shape.

## Root cause

1. `TournamentManager.repairTournamentBreakDestinations` replaces a member whose chair was taken by re-reading the board (`eligibleBreakDestinations`, `loadBalancerTables`) and asking `TableBalancer.breakTable` for the best free chair. The board holds seated players and roster chairs only. A chair promised to another unlanded member of the same break exists only as that member's active attempt, so every member replaced in one pass was offered the same chair. The first landed; each other was refused as occupied and given one chair again next pass.
2. `dispatchTournamentBreakMembers` always sent with `outcomeWasAlreadyUnknown = true`, so `moveTournamentPlayerAtomically` kept its identical resend after a definite refusal (the case PR #12156 left in place for ids that may have been sent before). An id this manager had just minted could not have been sent before, so each refusal was logged twice.

Each break above produced three refusals (six lines): one for the original chair from the begin (filled during the seconds the dispatch takes, or hidden by a stale board, see below) and two for the duplicate amendments. Those nine refusals are exactly the example pairs 07:22:32 to 07:27:33 UTC. The gap-move door re-read (`chairFreeAtTheDoor`, PR #11980) was not their source.

3. A stale board can reach these reads: `countLiveTablesWithPlayers` captures the single-use board prefetch of PR #12180 and never uses it, and a break member landing does not advance `balanceBoardEpoch`, so the next board read within 2 s (a break replacement or a gap move's door read included) could take the board as it was before those members landed.

## The fix

- `server/src/tournament/breakChairReservations.ts`: the chairs a break's other unlanded members hold are reserved on the board a replacement is chosen from, and a chair an earlier unlanded member already holds counts as taken.
- Attempt ids minted by this manager (begin members and amendments) are remembered until sent; the first send of such an id is not an already-unknown outcome, so a refusal is final for that id. Any other id keeps the replay and the receipt-only lookup.
- Hardening, same rule on neighbouring paths: `chairFreeAtTheDoor` (gap moves, post-expansion moves, closed-orphan reseats) waits for the next pass when a complete read leaves out the destination (a pending break holds it) instead of keeping the planned chair; door reads (`moveChairAtTheDoor`, `breakReplacement`, which also serves the break begin) never consume the board prefetch; `countLiveTablesWithPlayers` leaves no prefetch behind.

No migration. Engine change; ships at the next certified cutover after merge.

## Tests

- `server/src/tournament/aBreakNeverOffersTwoMembersOneChair.law.test.ts` (fails on the old code: 7 of 11 cases).
- `TournamentBreakDestinationBudget.test.ts`: the amendment-refresh case pinned the old behavior (the first member took the second member's chair); it now expects seats 3 and 4.

## Verify live after the cutover

```sql
-- No two unlanded attempts of one break hold the same chair.
select a.break_id, a.destination_table_id, a.destination_seat_number, count(*)
from smarter_private.f06_attempts a
join smarter_private.f06_operations o using (break_id)
where o.created_at > '<cutover time>' and a.amendment_payload is not null
group by 1, 2, 3 having count(*) > 1;
```

Postgres logs: `event_message ilike '%destination seat is occupied%'` after the cutover should show no pairs on the same chair within 1 s, and far fewer lines overall.
