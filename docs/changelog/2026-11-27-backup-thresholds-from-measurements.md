# Backup certification thresholds, measured (2026-11-27)

Lane: release-custody. Documentation only: no value in
`server/standby/standby-engine.sh` changes, because no threshold has the 15
observations its own rule asks for yet. This file records the series, the
rule each threshold will be re-derived by, and what the data already say.

## The three thresholds

| Threshold            | Today                                         | Where                                                 | How it was set                                                            |
| -------------------- | --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| (a) disk floor       | `backup_disk_low` under 12 GiB free           | `BACKUP_DISK_MIN_FREE_GIB`                            | Chosen on 2026-11-26 (O34), not measured                                  |
| (b) image retention  | engine images older than 24 h are removed     | `BACKUP_DISK_KEEP_HOURS`                              | Chosen on 2026-11-26 (O34), not measured                                  |
| (c) soak memory gate | 141 MiB/min (whole soak, each half over 70.5) | `judge_soak_memory_growth`, `SLOPE_LIMIT_MIB_PER_MIN` | Derived from 73 1800 s soaks (two readings each), never from a 900 s soak |

## The series

Every completed `certify` job of `.github/workflows/backup-engine.yml` in a run
created at or after 2026-11-26T21:00Z, read from its job log on 2026-11-27
about 16:40Z. 58 runs were listed; 43 skipped `certify` (yielded, keep-serving
or no turn), 15 completed it. Each row is the certificate line
(`club-arena-standby-certificate/v1`) and its `memoryGrowthCheck`, plus the
reclaim line `disk: removed N engine image(s) older than 24h; free X GiB`.
The reclaim line exists only from O34's first run (row 6) onward. Every judged
soak was 900 s, 56 samples over 887 s, judged on `engine_rss`.

| #   | Run / job                      | SHA            | Judged at (UTC) | Verdict                                            | Slope MiB/min (whole / 1st half / 2nd half) | Container slope | Start -> end MiB | Images removed | Free GiB |
| --- | ------------------------------ | -------------- | --------------- | -------------------------------------------------- | ------------------------------------------- | --------------- | ---------------- | -------------- | -------- |
| 1   | `45901188085` / `140187627642` | `e34a711c41d2` | 11-26 22:37     | pass                                               | 7.18 / 21.36 / 0.53                         | 7.75            | 1119.5 -> 1192.0 | -              | -        |
| 2   | `45918356098` / `140245210989` | `45b110c9d873` | 11-27 01:05     | fail (`rollback_rehearsal_failed_to_396283f68a7f`) | not reached                                 | -               | -                | -              | -        |
| 3   | `45921051609` / `140255142562` | `8a853e382063` | 11-27 02:01     | fail (`tournament_freeze_qualification_failed`)    | 12.41 / 13.53 / 8.86                        | 11.96           | 1116.5 -> 1260.5 | -              | -        |
| 4   | `45923483257` / `140268631553` | `1ec2ff9d4df8` | 11-27 02:47     | fail (`tournament_freeze_qualification_failed`)    | 10.11 / 7.5 / 7.5                           | 9.6             | 1258.5 -> 1373.5 | -              | -        |
| 5   | `45930467830` / `140281995479` | `d88a03fd2e91` | 11-27 03:28     | fail (`tournament_freeze_qualification_failed`)    | 3.71 / 4.6 / 1.72                           | 3.46            | 1287.5 -> 1313.0 | -              | -        |
| 6   | `45938154669` / `140306355263` | `e21eb7d915ed` | 11-27 04:53     | pass                                               | 12.9 / 13.12 / 20.98                        | 13.44           | 1192.0 -> 1334.0 | 366            | 114      |
| 7   | `45940769729` / `140321855345` | `ecebbc212831` | 11-27 05:39     | pass                                               | 7.5 / 10.98 / 4.96                          | 7.34            | 1258.0 -> 1327.0 | 1              | 111      |
| 8   | `45945261826` / `140334329363` | `f2b854319ea9` | 11-27 06:19     | pass                                               | 4.01 / 6.98 / 1.33                          | 3.95            | 1319.5 -> 1331.5 | 2              | 108      |
| 9   | `45957357117` / `140370461166` | `7c301a85a5e4` | 11-27 08:05     | pass                                               | 6.5 / 27.01 / 1.33                          | 6.36            | 995.5 -> 1080.0  | 0              | 104      |
| 10  | `45976636391` / `140430648993` | `4f2a8bcc269e` | 11-27 10:34     | pass                                               | 1.48 / 5.48 / -28.25                        | 1.5             | 1065.0 -> 907.0  | 0              | 103      |
| 11  | `45981526493` / `140456533075` | `84749b1cbc0b` | 11-27 11:22     | pass                                               | 2.68 / 4.45 / 2.52                          | 2.42            | 820.5 -> 842.0   | 1              | 100      |
| 12  | `45987784313` / `140475362537` | `ab1b9678c398` | 11-27 12:03     | pass                                               | 4.81 / 9.64 / 5.53                          | 4.59            | 767.0 -> 823.0   | 0              | 101      |
| 13  | `46005298327` / `140532763475` | `5f9103914361` | 11-27 14:05     | pass                                               | 5.52 / 7.03 / 3.1                           | 12.04           | 847.0 -> 891.5   | 2              | 98       |
| 14  | `46005561284` / `140556530539` | `3aa21caa9f7d` | 11-27 14:53     | pass                                               | 5.09 / 9.22 / -0.71                         | 10.86           | 859.5 -> 889.5   | 4              | 96       |
| 15  | `46006930710` / `140581813520` | `3aa21caa9f7d` | 11-27 15:40     | pass                                               | 6.35 / 13.76 / 0.78                         | 12.71           | 824.5 -> 856.0   | 0              | 93       |

Rows 3 to 5 failed for the full disk (O34), not for their code, and their
memory soaks completed, so they count as healthy-build slopes. Row 2 failed its
rollback rehearsal before the soak and has no slope.

Summary (min / median / p95 / max):

- Judged slope, 14 soaks: 1.48 / 5.93 / 12.58 / 12.90 MiB/min. Passing verdicts only (11): 1.48 / 5.52 / 10.2 / 12.90.
- First-half slope: 4.45 / 9.43 / 23.34 / 27.01. Second-half slope: -28.25 / 2.12 / 13.1 / 20.98.
- Growth over the soak: -158.0 / 50.25 / 142.7 / 144.0 MiB. Engine RSS at start: 767.0 / 1090.75 / 1298.7 / 1319.5 MiB.
- Free space before each certification, 10 readings: 93 / 102 / 112.65 / 114 GiB. Drop between consecutive certifications, 9 pairs: -1 / 3 / 3.6 / 4 GiB (whole-GiB resolution). Images removed after the first reclaim: 0 / 1 / 3.2 / 4.

## The rule, and the decision for each threshold

**Rule for all three: a threshold is re-derived only from its own series once
that series holds at least 15 observations, and the new value is written beside
the measurement in the script.** Today the memory series holds 14 slopes and the
disk series 10 readings (9 differences), so no value changes. The gates are not
loosened.

### (c) Soak memory gate: keep 141 MiB/min

- Rule, for when the series reaches 15 soaks: the limit is
  `min(141, max(5 x the largest observed 900 s slope, 2 x 51))` MiB/min, where
  51 MiB/min is the existing worst case of a healthy build's whole 30-minute
  growth (767 MiB) landing inside one 15-minute soak. Five times the maximum
  keeps a wide margin over every healthy build seen; the 102 floor keeps the
  worst case already measured on 1800 s soaks passing; the `min` means the gate
  never gets looser than today unless a healthy build is refused by it, which no
  row here comes near.
- What the data say now: the largest judged slope is 12.90 MiB/min, so 141 is
  10.9 times the maximum and 11.2 times the p95. No healthy build comes within a
  factor of five. The largest half slope (27.01, a warm-up first half) is 2.6
  times under the half threshold of 70.5, so the "each half" condition is not
  close to biting either. Applying the rule to today's 14 soaks would give
  `max(64.5, 102) = 102` MiB/min, tighter than today, which is why it waits for
  the fifteenth soak rather than being applied to 14.
- Still refuses a real leak: the law's own synthetic leak (300 MiB/min) and any
  slope that would fill the 26 GiB container inside one 180-minute cycle are
  refused at 141 and would be at 102.
- Two side observations, neither a reason to change the gate: (1) the largest
  engine RSS start is now 1319.5 MiB, above the `HEALTHY_START_MAX_MIB` of 1243
  used in the formula; recomputed, `(26624 - 1320) // 180 = 140`, one MiB/min
  tighter. The 1243 came from `docker stats` start readings, the 1319.5 from the
  engine series' first-third median, so they are not the same measurement. (2) In
  rows 13 to 15 the container slope (10.9 to 12.7) is twice the engine RSS slope
  (5.1 to 6.4), where rows 1 to 12 agree within 1 MiB/min. The judge uses the
  engine series, so it does not move the verdict, but if the engine series ever
  goes unreadable the container fallback now reads about 6 MiB/min high. Recorded
  as an open item.

### (a) Disk floor: keep 12 GiB

- Rule, for when the series reaches 15 readings: the floor is at least twice the
  largest free-space drop across one certification, plus the largest transient a
  certification needs during its run, rounded up to the next whole GiB. The
  transient is not measured: free space is logged once, at the start, after the
  reclaim.
- What the data say now: one certification consumes at most 4 GiB net (median
  3, p95 3.6), so 12 GiB is three times the largest observed net consumption.
  From the first reclaim (114 GiB at 04:15Z) free space fell about 21 GiB over
  10.8 hours and 10 certifications, about 2 GiB per hour. Images built after
  04:15Z only start ageing out 24 h later, so at that rate the host settles near
  114 - 24 x 2, about 66 GiB free, more than five times the floor. The floor is
  not near refusing a healthy build and is not loosened.
- To make the next derivation complete, the reclaim line should also record the
  free space after the certification (or the peak during it). Recorded as an open
  item; no logging change in this file.

### (b) Image retention: keep 24 h

- What a certification needs (read from `cmd_certify` and `cmd_run`): the
  candidate image (`$IMAGE_REPO:<candidate>`, always kept by name), and the image
  of the production serving release, which the rollback and forward rehearsal
  run (`run: <serving>` twice in every log, for example `396283f68a7f` in rows 2
  to 7 and `f2b854319ea9` in rows 9 to 15). A container's own image cannot be
  removed (no `-f`). The qualification images are rebuilt every run.
- What the data say: across all 15 runs no rehearsal needed a rebuild of the
  serving image (no `build: <serving sha>` line in any log), so 24 h retention
  kept every image a rehearsal used. The serving release is replaced at every
  seal, and seals come every three hours when cycles ship.
- The gap the value cannot close: if no cycle seals for more than 24 h, the
  serving release's image is removed like any other. That does not withhold a
  certificate: `cmd_build` rebuilds any missing image from the same commit before
  `cmd_run`. It costs a rebuild (the candidate builds take 3 to 25 s with a warm
  cache; `docker builder prune --filter until=24h` may have emptied the cache
  by then), and the rehearsal then runs a rebuilt image of the serving source
  rather than the bytes production holds. Raising the hours would only move that
  edge; the root fix is to keep the serving release's image by name, as the
  candidate is kept. Recorded as an open item for the next standby change.
- Rule, for when the series reaches 15 readings: the retention stays the
  longest of 24 h and twice the longest gap between two seals in the series, so
  that every image a rollback or rehearsal can need is still on disk, and only
  ever shortened if the disk series shows the floor being approached.

## Tests

No test changes: no pinned value moved. Run on this branch, both green:
`tests/the-backup-host-reclaims-its-disk.law.test.ts` (pins
`BACKUP_DISK_MIN_FREE_GIB` 12) and
`tests/a-shorter-soak-judges-memory-growth.law.test.ts` (pins 141 and its
formula).

## Next

Re-run this derivation when 15 judged 900 s soaks and 15 reclaim readings
exist (at today's rate, within the next day), and apply the rules above in one
commit that moves each value, its comment and its law together.
