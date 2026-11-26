# 2026-11-25: the club leaderboard reads its unfolded tail by index

Dan, 2026-11-25: "Fix all five" (item 3, statement timeouts), follow-up to
`20261125022320`. Migration
`20261125053826_the_leaderboard_reads_its_unfolded_tail_by_index.sql`.

## What production showed

After the fold went live, `fn_club_tournament_stats` answered Deep Stack
Society in about 40 ms, but Midway Union still took about 1.4 s. The reader is
a `LANGUAGE sql` function, so it runs on a generic plan, and its live tail was
one `OR` against the fold boundary sub-select. Under that plan it walked all
836,174 of Midway Union's tournaments and filtered them row by row.

## Change

The tail is read as two index ranges joined by `UNION ALL`: tournaments whose
fold key is NULL (unfinished or private), and those whose fold key is at or
after the boundary, with the boundary kept as a scalar sub-select so it bounds
the second column of `tournaments_leaderboard_club_unfolded`. A fold key is
NULL or a timestamp, so the halves are disjoint and the answer is the old one,
row for row. Nothing else in the function changes: still `SECURITY INVOKER`,
same grants, same columns.

## Verified

- Production, forced generic plan, Midway Union: 1,243 ms before, 40.5 ms after;
  both ranges are index conditions on the unfolded index; same 1,135 rows.
- `scripts/ci/test-slow-reads-stand-down-and-leaderboard-fold.py`: with
  production-shaped statistics, a club with 200,000 finished tournaments reads
  only its 10 unfolded ones; every club's answer equals the one-OR reader's,
  page by page.
- `tests/slow-reads-stand-down-and-leaderboard-fold.law.test.ts` pins two
  ranges and no `OR` in the tail.
