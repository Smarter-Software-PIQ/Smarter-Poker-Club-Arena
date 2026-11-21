# The hand-delay alert names where the delay comes from (2026-11-20)

## What was wrong

`fn_ca_hand_gap_watch` pages "Unintended Delay Between Hands Tournament
All_In_Showdown Hands Have Been Delayed For 15 Minutes (P95 +1160 Ms Over The
250 Ms Budget ...)". It said THAT the engine waited between hands and never
on WHAT, so every investigation started from zero and re-derived the same
split by hand.

Measured on production 2026-11-20, tournament hands, engine 95dae384:

- `hand_history.cadence.hold_ms` equals the grade's owed hold exactly (p50 and
  p95 difference 0): the grade is right.
- All-in showdowns without a bust: unintended p95 498 ms. With a bust (a
  `players[]` entry left at stack 0): 1,783 ms.
- Engine `/health` `nextHandGap.slowest[].phases`: `announce_seat_moves`
  1.6-2.2 s on the slowest gaps, i.e. post-bust table balancing.

The engine fix is incident 1e532243 (another lane). This change only makes the
watch say where to look.

## What changed (20261121000757, queued)

1. `fn_ca_hand_gap_unintended_delay` gains eight trailing columns per kind x
   shape over the graded hands: `after_bust`, `after_bust_over_budget`,
   `after_bust_unintended_p95_ms`, `after_seat_move`,
   `after_seat_move_over_budget`, `after_seat_move_unintended_p95_ms`,
   `after_bust_and_seat_move_over_budget`, `neither_unintended_p95_ms`.
   - A bust is the `someone_busted` fact the shape rule already reads.
   - A seat move is a `tournament_seat_move_receipts` row for the table (as
     source or destination) with `moved_at` inside the gap. It is the one
     record written on the deal path for every balancing move (490 in an hour,
     all `live_source`), it is indexed by `(tournament_id, moved_at)`, and on
     the slow gaps it is stamped 7.5-11 s after `ended_at`, i.e. inside the
     gap it delayed. Cash seat moves are player-elected and not counted.
   - The return type changes, so the function is dropped and re-created from
     production's own text by five exact anchors (each must match once),
     which keeps the hand-for-hand exclusion of 20261119211558 and every other
     clause byte-for-byte. Grants and comment are restored.
2. `ca_hand_gap_watch_history` keeps the same eight columns (nullable; small
   detector table, no hot-table lock).
3. `fn_ca_hand_gap_watch` records them and, on open, adds the split to the
   alert context and one sentence, `attribution`, for example:
   "Over budget in 15 min: 23 hands; 87% after a bust, 74% after a tournament
   seat move, 70% both. Latest 5 min p95 +1783 ms after a bust, +498 ms after
   neither." A window recorded before the upgrade carries no split and is left
   out of the sums, never counted as zero.
4. The owner page route appends that sentence to the hand_delay page.

Unchanged: shapes, budgets, owed beats, the 3 x 5-minute rule, the 5-hand
minimum, the constant alert message and the kind x shape dedupe, so history
and open incidents stay continuous.

`scripts/sql/hand-gap-unintended-delay.sql` carries the same split.

## What it reports on today's data

The split, read-only over the two open alerts' 15-minute windows (tournament):

| window end (UTC) | shape | over budget | after a bust | after a seat move | both | p95 after bust | p95 neither |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22:55 | all_in_showdown | 58 | 44 (76%) | 11 (19%) | 3 | +1476 ms | +200 ms |
| 23:55 | all_in_showdown | 55 | 42 (76%) | 8 (15%) | 2 | +1786 ms | +230 ms |
| 23:55 | fold | 59 | 0 | 10 (17%) | 0 | n/a | +334 ms |
| 23:55 | showdown_checked_river | 8 | 1 | 2 | 0 | +630 ms | +665 ms |

So three quarters of the over-budget all-in hands follow a bust, while only
about a fifth have a seat-move receipt in the gap: the bust path itself is
slow even when it does not balance a table.

## Proof

- `scripts/ci/test-hand-gap-watch.py` (PostgreSQL 16, workflow
  `hand-gap-watch-proof.yml`) now applies 20261119211558 in production order,
  pins the grader, watch and page route to production's md5 before applying
  20261121000757, and proves the split, the history, the attribution sentence
  (with the pre-upgrade window left out), the unchanged alert identity and the
  page text.
- `tests/the-hand-delay-alert-names-where-the-delay-comes-from.law.test.ts`
  keeps the migration and the script in step.
