# A club's rake day counts the hand for the seat's club (2026-11-16)

Owner rule (2026-11-15): a player can play in several clubs; each club's numbers
reflect only the hands played through that club, and nothing is excluded or
moved because a player belongs to several clubs.

Migration: `supabase/migrations/20261116021751_a_club_rake_day_counts_the_hand_for_the_seat_club.sql`.

## The defect, read from rows

`fn_ca_club_rake_daily_compute` (the per-day club rake rollup, run at every
raked cash hand's COMMIT and by the rebuild doors) splits a UNION cash hand by
player and credits each player's part to a club by:

1. the hand's `rake_attributions` witness for that player;
2. the buy-in funding receipt at or before the hand;
3. the `table_seats` row at or before the hand;
4. **the player's first-joined club in the union** (`club_members ... ORDER BY
joined_at ASC`);
5. the table's club.

Step 4 is a membership guess, not where the hand was played.

Every positive contribution already has a witness, so no chip ever reached
step 4. The rows that reach it are players dealt in who put nothing in the pot
(contribution 0, so no rake and no witness). Nearly all are horses (19,610 of
19,621 such rows between 00:00 and 03:00 UTC on 2026-11-14). Horses sit without
a buy-in receipt, and a seat row is removed after it is left, so once the horse
has left the table steps 2 and 3 find nothing and the hand is counted for the
horse's first-joined club. A zero contribution moves no rake, but it adds the
hand to that club's `ca_club_rake_daily.hands`, which is the raked-hands count
on the Club Dashboard revenue tab and Club Financials (rake per hand, average
pot). In a 20-minute sample, 40 of 79 such rows named a club other than the one
the same horse's seat was playing through at that table.

## What changes

Steps 1-3 and 5 are unchanged and keep their order. Step 4 now reads the SAME
SEAT where it survives the seat row's removal:

- **4a, the seat's exit record.** `ca_seat_stack_exits` copies the seat's
  `club_id` when the seat is left (trigger `trg_log_seat_stack_exit`). The
  first exit of this player from this table at or after the hand is the seat
  that was occupied while the hand was dealt (bounded to 7 days).
- **4b, the same sitting.** Otherwise, this player's own `rake_attributions`
  row at this table from an earlier hand of the same sitting (within 1 day, and
  no logged exit of this player from this table in between).
- Only when neither exists does the hand stay with the table's club (step 5).

No membership lookup remains. Both lookups are inside the `coalesce` after
steps 1-3, so rows that carry a witness pay nothing new, and both use existing
indexes (`ca_seat_stack_exits_user_idx`, `idx_rake_attributions_player_id`).
Language, volatility, SECURITY DEFINER, search_path, owner and grants are
unchanged and asserted by the migration.

Why not the table's club alone: on union tables the table's club is Midway
Union, the union house, whose own row shows 0 hands. Sending these hands there
would also credit a club the hand was not played through (15,520 hands on
2026-11-14). With the seat evidence, only 249 hands that day have no seat
evidence at all and stay with the table's club.

## Effect on one full day (2026-11-14, read-only, all 24 hours)

The same calculator was run inline against production with the old and the new
step 4. Rake, bbj and pot are identical to the cent for every club, and equal
to the rows written live at commit:

| Club                      | Hands, current rule | Hands, new rule |  Change | Rake (both) |
| ------------------------- | ------------------: | --------------: | ------: | ----------: |
| KINGS CLUB                |              26,106 |           6,063 | -20,043 |      544.94 |
| Deep Stack Society        |              78,422 |          78,632 |    +210 |   54,379.73 |
| The Felt Society          |              80,837 |          81,377 |    +540 |   73,692.09 |
| Midway Union (table club) |                   0 |             249 |    +249 |        0.00 |

Midway Union bbj 21,717.30 and pot 3,820,825.43 under both rules. For
reference, the live rows written at commit that day show KINGS CLUB 9,571, Deep
Stack Society 78,578 and The Felt Society 81,316 hands: at commit most seats
still exist, so step 3 answers; the first-joined guess bites mainly when a day
is recomputed after the horses have left.

## What is not done

No history is rebuilt. This changes future computations only: the live
per-hand rollup at commit and any later rebuild. Existing `ca_club_rake_daily`
rows stay as written. `fn_ca_club_rake_daily_rebuild_range(date, date,
boolean)` is the supported door if an operator later decides to recompute a
closed day; it was not run. No wallet, ledger, settlement, scheduler or
live-game state is touched.

## Proof

- `scripts/ci/test-club-data-report-db-postgres.py` (native PostgreSQL 17):
  the history scenario now includes a multi-club player (joined SHARK first,
  playing through JAQK) dealt in with a zero contribution and no witness. The
  funding-at-the-hand calculator counts those hands for SHARK; after this
  migration the vacated seat and same-sitting cases count for JAQK, a hand with
  no seat evidence (and an older SHARK sitting that ended) stays with the
  table's club, and rake is unchanged. It also proves a rolled-back or
  browser-role run installs nothing, the authority settings are preserved, and
  a replay is refused by the preimage check.
- `tests/club-data-counts-what-the-club-played.law.test.ts` pins the new order
  and that no `club_members` / `joined_at ASC` lookup is left in the calculator.
