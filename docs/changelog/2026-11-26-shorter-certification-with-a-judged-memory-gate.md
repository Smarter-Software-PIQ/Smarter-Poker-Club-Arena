# Shorter Certification With A Judged Memory Gate (2026-11-26)

## Why

The owner asked for a certification short enough that two attempts fit comfortably inside one three-hour cutover cycle. One certify job took a median 53.7 minutes (25 most recent certified runs: 36.4 to 56.4 minutes), 30 of them the soak. The lane had recorded that the soak floor may drop only after memory growth is a judged gate: the certificate carried `memoryStart` and `memoryEnd` and a comment saying "bounded memory growth", but nothing judged either number. The second half of the soak was the only thing that could notice a fast leak, and only by the container being killed at its 26 GiB limit.

## What Was Measured

Source: the certify job logs of every `backup-engine.yml` run that printed a certificate, 2026-11-20 20:51 to 2026-11-25 23:09 Chicago (2026-11-21 02:51Z to 2026-11-26 05:09Z). 75 certificates were read; 73 carry both memory readings (two failed in the swap rehearsal before the soak). All soaked 1800 s. 58 passed; the 15 failures were all hand-gap verdicts.

| `docker stats` reading, n = 73 | Min    | Median | P95    | Max    |
| ------------------------------ | ------ | ------ | ------ | ------ |
| Start (MiB)                    | 608.5  | 969.6  | 1157.3 | 1243.1 |
| End (MiB)                      | 711.3  | 1144.8 | 1397.6 | 1689.6 |
| Growth over 30 minutes (MiB)   | -271.7 | 194.7  | 525.2  | 767.1  |
| Growth per minute (MiB)        | -9.1   | 6.5    | 17.5   | 25.6   |

The 58 passing certificates alone: growth median 175.8, p95 564.1, max 767.1 MiB; per minute median 5.9, p95 18.8, max 25.6.

The engine publishes its own process memory in `/health` (`memory.rssMb`, `heapUsedMb` and others, `server/src/observability/processMemory.ts`). Production on 2026-11-25 23:32 Chicago: 11,034 MiB RSS after 22.5 hours of uptime, about 8 MiB per minute averaged over the day.

## The Gate

`judge_soak_memory_growth` in `server/standby/standby-engine.sh`:

- Every pass of the soak loop (about 15 s, about 53 passes in 900 s) appends one sample: the engine's `/health` `memory.rssMb` and the container's `docker stats` reading. The judge uses the engine series when it has enough samples, otherwise the container series.
- Sizes parse as bare MiB or with any of B, KiB, MiB, GiB, TiB, kB, MB, GB, TB.
- The slope is the median of all pairwise slopes (Theil-Sen). A build is refused (`memory_growth_exceeded`) only when the slope over the whole soak is above 141 MiB per minute AND the slope of each half is above 70.5. One spike, an end-of-soak burst, a garbage-collection sawtooth and a one-time step all pass.
- Fewer than 8 readable samples, or samples covering under half the soak, is `memory_growth_unreadable`. It withholds the certificate, as every other unreadable check in this script does, and it is never reported as a pass. With about 53 reads per soak from two independent sources it takes about 46 failed reads of both to get there, so a transient read failure does not cost a cycle.
- The certificate gains `memoryGrowthCheck`: status, source, attempts, samples, span, start and end medians, growth, the three slopes, the limit, the projection, the rules, a summary of both sources and the sample series itself, so the limit can be re-derived from real 900 s soaks.

### The Threshold Arithmetic

- Container limit: `--memory 26g` = 26,624 MiB.
- Largest healthy start measured: 1,243 MiB. Headroom 25,381 MiB.
- Horizon: 180 minutes, one cutover cycle, the soonest a replacement build can seal.
- Limit = 25,381 / 180 = 141 MiB per minute: growth that, sustained, reaches the container limit before the next cycle could replace the build.
- Against the healthy distribution: 5.5 times the largest 30-minute slope (25.6), 8 times the p95 (17.5), and 2.7 times the worst case in which a healthy build's entire 30-minute growth (767 MiB) lands inside the 15-minute soak (51 MiB per minute).
- Against the old soak: unjudged, it noticed only a leak that filled the container in 30 minutes, about 854 MiB per minute. The new gate is 6 times stricter.

Why not a tighter limit or a longer horizon: the first half hour is warm-up. The largest healthy slope projected linearly over 24 hours is 36 GiB, which production disproves (11 GiB after 22.5 hours). A soak cannot tell a slow leak from warm-up; slow growth stays the job of the serving engine's memory governor (`/health.memoryGovernor`) and of the next sealed release.

## The Soak Is 900 Seconds

- The hand-gap judge grades at most the first 15 minutes of the soak (`soak_window_min` is capped at 15), so 900 s keeps that sample identical.
- The second 15 minutes used to buy three things. A longer watch for a crash, a restart, lost liveness, a fatal log line or a lifecycle fatal event: those are still watched for the whole soak, and production's own alerts cover the hours after. A longer chance for hands to be dealt: `peakHandsInWindow` is a window reading and was nonzero in every certificate. The implicit out-of-memory kill: now replaced by the judged gate above.
- The number agrees on three surfaces, pinned together: `standby-engine certify $SHA 900` in `backup-engine.yml`, the `soak` default in `cmd_certify` and the command dispatcher, and `SOAK_SECONDS = 900` in `scripts/ci/select-daily-engine.py`.
- The selector (`soak_is_sufficient`): a certificate that carries `memoryGrowthCheck` must show status `pass` and a soak of at least 900 s. A certificate without the key was made by the earlier script and stays selectable only with that script's full 1800 s soak. So every certificate made before this change is still selectable, and a 900 s certificate without a passing check is refused.

## The Timetable

Measured on the 25 most recent certified runs: refresh job median 14.2 minutes (it includes waiting for the host), certify job median 53.7 minutes, max 56.4. Removing 900 s projects certify to a median 38.7 minutes, max 41.4. The memory samples add no time: the loop is bounded by the clock.

- One attempt, refresh plus certify: 67.9 minutes before, about 52.9 projected.
- Between the end of a cycle's break (start + 5 minutes) and the next cycle's cutoff (start + 150 minutes) there are 145 minutes. Two attempts used 136 of them and left 9; they now use about 106 and leave about 39.

## What Stops It Regressing

`tests/a-shorter-soak-judges-memory-growth.law.test.ts` (registered in `docs/laws.d/`): the three surfaces agree on 900; the certify loop samples both sources and records both reasons; the limit is recomputed from the container limit the script runs with; the judge passes all 73 real certificates (embedded) with their growth squeezed into the soak and into five minutes, fails a steady 300 MiB per minute leak and one just above the limit, passes one just below, an end spike, a burst, a sawtooth and a step, parses every unit, falls back to the container series, judges through scattered read failures and reports unreadable distinctly; the selector cases above. `tests/operations/daily-engine-selection.test.py` covers the selector through the real certificate reader.

## Not Verified Live

- No certification has run with this script. The first real `certify` with the new judge is the live proof and is pending: confirm `memoryGrowthCheck.status` is `pass`, `source` is `engine_rss`, `samples` is near 53, and the certify job is near 39 minutes.
- The 73 measurements are two `docker stats` readings per 1800 s soak. The shape of growth inside a soak, and how `/health` `memory.rssMb` compares with `docker stats` on the Backup host, were not measured; the limit carries a 2.7 times margin over the worst-case shape for that reason. Re-derive it from the `series` of the first twenty 900 s certificates.
- The wiring inside `cmd_certify` is pinned by source assertions and the judge by execution; `cmd_certify` itself needs Docker and the Backup copy and was not executed.
- The yield threshold (75 minutes to the cutoff), the host lease (150 minutes) and the "about 65 minutes" booking lead in `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` were left at their 1800 s values. They are ceilings and stay correct, only conservative; tighten them after the new duration is measured.
