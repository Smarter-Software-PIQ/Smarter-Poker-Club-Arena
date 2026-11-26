# The install watch follows the 150 minute three-hourly deferral (2026-11-24, O21 part 1)

## What happened

The engine cuts over every three hours (01, 04, 07, 10, 13, 16, 19, 22 Central).
A candidate build is certified on a copy of production. An ordinary migration
installed after that copy makes the candidate stale, and the cycle keeps
serving. The merge dispatcher held ordinary migrations only inside
`[cycleStart - 90m, cycleStart + 10m)`, but the certifying copy is usually taken
earlier than that. Four installs landed in the gap and each cost a cycle:

| Install (UTC)    | Cycle (Central) | Minutes before the cycle |
| ---------------- | --------------- | ------------------------ |
| 2026-11-22 23:22 | 19:00           | 98                       |
| 2026-11-23 01:47 | 22:00           | 133                      |
| 2026-11-23 02:17 | 22:00           | 103                      |
| 2026-11-24 05:26 | 01:00           | 94                       |

## The fix has two parts, in this order

1. **This change (database).**
   `20261124162837_the_install_watch_follows_the_150_minute_deferral.sql` replaces
   `smarter_private.ca_three_hourly_deferral_clears_at(timestamptz)`: it treats
   `[cycleStart - 150m, cycleStart + 10m)` as held and looks three whole hours
   ahead (`ARRAY[0, 1, 2, 3]`), because the hour containing `cycleStart - 150m`
   starts three hours before the cycle. Nothing else is replaced:
   `ca_merged_migration_install_due_at` and `fn_ca_merged_migration_install_watch`
   read the helper by name.
2. **A later pull request (dispatcher), merged only after part 1 is installed.**
   `THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES` 90 -> 150 in
   `scripts/ci/merged-migration-dispatch.mjs`, with its wait budgets.

## Why the database moves first

The dispatcher's constant takes effect the moment it merges. A migration is an
ordinary file and is itself held by the deferral. In one pull request, the
dispatcher would have held files for 150 minutes while the watch still believed
90, and the watch would have paged every healthy file merged in
`[cycleStart - 150m, cycleStart - 90m)` at merge + 60 minutes, before the
dispatcher was allowed to send it.

The other order cannot page a healthy file. While the helper says 150 and the
dispatcher still says 90, a file merged in `[cycleStart - 150m, cycleStart - 90m)`
is sent at once and the watch gives it until `cycleStart + 70m`. A file that is
really stuck in that hour is paged later than before, by at most 160 minutes.
That lasts only until part 2 merges.

## What the watch says after this change

A page is due 60 minutes after the dispatcher's first admitted send. With the
150 minute deferral every such instant falls inside the next cycle's deferral,
so a page for a stuck ordinary migration now always says not to hand-dispatch
and names the next clear time (for example "19:10 Central"). Outage installs
keep their existing override route.

## The numbers

- Deferral: `[cycleStart - 150m, cycleStart + 10m)`, 160 minutes of every 180.
- Install window: `[cycleStart + 10m, cycleStart + 30m)`, 20 minutes, after the
  07, 10, 13, 16, 19 and 22 cycles (six windows, 120 minutes a day). The 20
  minutes after the 01:00 cycle are inside the nightly freeze (23:45 to 04:15),
  and the 04:00 cycle is covered by the freeze, so the seventh window is 04:15
  to 04:30 Central (the 07:00 deferral opens at 04:30). 135 open minutes a day.
- Longest wait once part 2 is merged: 160 minutes in the daytime (a merge at
  `cycleStart - 150m`); 345 minutes for a merge at 22:30 Central, which runs
  into the freeze and installs at 04:15.
- Look-ahead: `ceil(150 / 60) = 3` whole hours, so offsets 0 to 3.
- A merge at 22:30 Central is released at 01:10, inside the nightly freeze, so
  its hour starts at 04:15 and it is due at 05:15.

## How it is held

- The migration pins the helper it replaces by md5
  (`@replaces-md5`, `7a65f8065a8d83f37521df7dceac61ef`, measured on PostgreSQL 17
  from `20261123000830`), refuses a drifted helper, asserts 24 fixed instants,
  every minute of one Central day and 12 due-at instants, reads its own body
  back and refuses if the helper's grants or owner changed.
- `tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts`:
  the SQL deferral is 150 minutes, is never shorter than the dispatcher's, the
  dispatcher holds 90 or 150 and nothing else, and the look-ahead reaches as
  far as the deferral.
- `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py` installs the
  file twice on PostgreSQL 17, checks grants and the live proof, refuses a
  drifted helper, and proves three cases: a file merged 120 minutes before a
  cycle is quiet at merge + 60 and pages at cycle + 70 minutes; a file merged
  in the install window keeps the plain hour; a 22:30 Central merge pages at
  05:15. With `MIGWATCH_PRE_O21=1` (helper left at 90) the first case fails
  with the false page.

No timer, cron job, watcher or workflow trigger is added.
