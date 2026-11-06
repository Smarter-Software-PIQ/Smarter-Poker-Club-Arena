# Tournament monitor: the completed 24-hour observation report (2026-11-06)

Dan authorized a 24-hour automatic observation of every MTT, Spin, Sit and Go
and satellite on 2026-11-05 at 13:59 CT. It ran from 14:14:56 CT on
2026-11-05 to 14:14:56 CT on 2026-11-06. The monitor then switched its own
timer off, as designed. This file keeps the report it produced on main, so it
outlives the host.

## How the report is made

`ops/tournament-monitor/report_24h.py` reads the monitor's own records:
`state/cycles.jsonl`, `window.json` and `incidents/*.json`. It writes
`reports/observation-<window start>.md` and changes no record, timer or window.
`ops/tournament-monitor/test_report_24h.py` covers three things:

- window bounds;
- gap and coverage counts;
- the ownership audit: a record the quiet-clear rule touched after someone
  claimed it is named.

## Where the evidence lives

- Host: `/opt/tournament-monitor/reports/observation-2026-11-05.md`.
- Archive:
  `/Volumes/SmarterArchives/agent-evidence/tournament-monitor-24h-2026-11-05/`.
  The full state tarball (`state/`, `incidents/`, `window.json`, the monitor
  1.2.0 source, 85 entries) is there with its `SHA256SUMS`.

## What the numbers say

- 486 cycles ran for about 480 expected. There was one gap over 240 s
  (361 s, 20:13 to 20:19 CT on 2026-11-05).
- No cycle checked fewer events than the database listed, and no cycle had a
  source error.
- The window saw three engine releases.
- 29 of the 69 records have an owner. The quiet-clear rule (monitor 1.2.0)
  changed none of them after their claim.
- The two prize_pool_zero records this session owns, `bf16640dd00dce61` and
  `586d695713ce9b58`, were the monitor's own false positive on bounty-only PKO
  Free Buys. They were closed against PR #9724.
- 21 of the 40 "cleared, no fix recorded" records are `lease_missing`. All 21
  were seen once, in the single cycle at 08:01:25 CT, during the 08:00 CT
  engine cutover. They stay listed for root-cause review. The report does not
  call them fixed.
- Five records remain at Detected, all owned by `claude-monitor-triage` or
  `fix/capacity-wake-update-frames-and-siblings`. That includes three for the
  Sunday Deep Stack Satellite 30 (`a2a2c981`), which completed with escrow 0 at
  05:55 UTC after a 25-minute stall on engine `71087373`. Their owners keep
  them.

## The report, as written

# Tournament monitor observation report

- Window: 2026-11-05T14:14:56-06:00 to 2026-11-06T14:14:56-06:00 America/Chicago (24 h), status `complete`, authorized by Dan Bekavac 2026-11-05 13:59 CT.
- Cycles inside the window: 486 of about 480 at 180 s (cycle 1 at 2026-11-05T14:14:56-06:00 to cycle 486 at 2026-11-06T14:12:13-06:00).
- Gaps over 240 s: 1.
  - 2026-11-05T20:13:01-06:00 to 2026-11-05T20:19:02-06:00: 361 s
- Cycles that checked fewer events than the database listed: 0.
- Cycles with a source error: 0.
- Cycle duration: mean 6.3 s, max 30.7 s.
- Events checked per cycle: 0 to 284.
- Engine releases observed:
  - `71087373d6ce7d1354146dbfe3963731c9b00597` from 2026-11-05T14:14:56-06:00 to 2026-11-06T03:59:45-06:00
  - `a6a4dd17083b78ed77149663b8ad9f50de3e7a32` from 2026-11-06T04:02:46-06:00 to 2026-11-06T07:59:33-06:00
  - `92e26a9fbf4b6646b18e43d5a9a79c68a1a15ca4` from 2026-11-06T08:01:20-06:00 to 2026-11-06T14:12:13-06:00
- Incident records: 69. Owned: 29. Records the quiet-clear rule changed after someone claimed them: 0.

| Stage | Symptom | Severity | Records |
|---|---|---|---|
| Cleared, no fix recorded | elimination_pending | warning | 1 |
| Cleared, no fix recorded | engine_memory_over_ceiling | critical | 1 |
| Cleared, no fix recorded | engine_stalled_table | critical | 2 |
| Cleared, no fix recorded | final_table_not_formed | warning | 1 |
| Cleared, no fix recorded | lease_missing | critical | 21 |
| Cleared, no fix recorded | no_hand_progress | critical | 3 |
| Cleared, no fix recorded | recovery_loop | critical | 2 |
| Cleared, no fix recorded | recovery_loop | warning | 2 |
| Cleared, no fix recorded | table_no_hand_progress | warning | 1 |
| Cleared, no fix recorded | tables_unbalanced | warning | 5 |
| Cleared, no fix recorded | tournament_resumes_failing | warning | 1 |
| Closed | elimination_pending | warning | 3 |
| Closed | lease_missing | critical | 1 |
| Closed | missed_cycle | warning | 1 |
| Closed | prize_pool_zero | critical | 4 |
| Closed | seat_collision | critical | 1 |
| Detected | engine_gauge_tournament_tables_failing_admission | warning | 1 |
| Detected | engine_stalled_table | critical | 1 |
| Detected | no_hand_progress | critical | 1 |
| Detected | prize_pool_zero | critical | 1 |
| Detected | recovery_loop | critical | 1 |
| Production fix verified | decided_not_settled | critical | 2 |
| Production fix verified | engine_stalled_table | critical | 1 |
| Production fix verified | no_hand_progress | critical | 1 |
| Production fix verified | recovery_loop | critical | 8 |
| Production fix verified | table_no_hand_progress | warning | 1 |
| Production fix verified | tables_unbalanced | warning | 1 |

## Cleared with no fix recorded (root cause not established): 40

- `05bf1f951e11af3d` critical lease_missing: NLH Heads-Up 50 (2512511b), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `0dce582404c55c9e` critical lease_missing: 100 Chip Spin NLH (5341a3a2), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `0f9af4a0277cccc8` critical lease_missing: PLO4 Heads-Up 1 (e27ed8db), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `22eecee2b5284216` critical lease_missing: PLO4 Heads-Up 50 (b46b5271), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `24250667232635eb` critical recovery_loop: Prime Time Satellite 5 (7cb1a19d), seen 10x, 2026-11-05T16:25:36-06:00 to 2026-11-05T18:42:57-06:00, release `71087373d6ce`
- `3568a64ca3af5b53` critical lease_missing: 20 Chip Spin PLO4 (f7d1cfa4), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `3b7c1f25ad7a0e86` warning tables_unbalanced: Sunday Deep Stack Satellite 30 (a2a2c981), seen 2x, 2026-11-05T23:34:34-06:00 to 2026-11-05T23:37:35-06:00, release `71087373d6ce`
- `403c4e874ec9b6bb` warning tables_unbalanced: Union Late Night Turbo (NLH) (7d210de4), seen 3x, 2026-11-05T23:43:36-06:00 to 2026-11-05T23:49:39-06:00, release `71087373d6ce`
- `405c34e0fbf72343` critical lease_missing: 1 Chip Spin NLH (949718b5), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `42e65d622e30f1a8` critical lease_missing: 1 Chip Spin PLO4 (b5956361), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `4905249d4bde3e72` critical lease_missing: NLH Heads-Up 2 (536c564d), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `4ea5943ba479405f` critical lease_missing: 1 Chip Spin NLH (7f13ecb2), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `54df4f31908a5837` critical engine_memory_over_ceiling: - (), seen 281x, 2026-11-05T14:15:03-06:00 to 2026-11-06T03:59:50-06:00, release `71087373d6ce`
- `54e77580bdd4e174` critical lease_missing: 2 Chip Spin PLO4 (78e4e1fe), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `5830c1c2ae129c0f` critical lease_missing: 2 Chip Spin PLO5 (c005cd15), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `62da25d690046fb6` critical no_hand_progress: TEST Simulated Stale MTT (synthetic, not production) (TEST-sta), seen 2x, 2026-11-05T14:24:05-06:00 to 2026-11-05T18:42:57-06:00, release `71087373d6ce`
- `7a6f91e422b8ffc9` critical lease_missing: PLO4 Heads-Up 5 (1b7d3ae6), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `80cb3b2d16b79612` warning tables_unbalanced: Six-Card Feature (22ca8fa1), seen 2x, 2026-11-05T21:16:26-06:00 to 2026-11-05T21:37:31-06:00, release `71087373d6ce`
- `812977177fc474bf` critical lease_missing: PLO4 Heads-Up 25 (ab8b74ce), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `8597ca7481840ea7` warning tables_unbalanced: Thursday Night PKO (c0b77808), seen 8x, 2026-11-05T22:10:42-06:00 to 2026-11-05T23:10:28-06:00, release `71087373d6ce`
- `861404d892c43b50` critical lease_missing: NLH Heads-Up 25 (a1255f80), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `8f0f029215e6a97a` critical no_hand_progress: Prime Time Satellite 5 (7cb1a19d), seen 15x, 2026-11-05T16:17:55-06:00 to 2026-11-05T18:42:57-06:00, release `71087373d6ce`
- `8f7ad8740617da52` warning recovery_loop: - (), seen 1x, 2026-11-05T20:58:22-06:00 to 2026-11-05T20:58:22-06:00, release `71087373d6ce`
- `939630f64085feec` critical lease_missing: 50 Chip Spin NLH (8fe08c06), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `996ecf4e013631c2` critical lease_missing: 2 Chip Spin PLO5 (a7cbd246), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `a64c578ee0cb8537` warning final_table_not_formed: Sunday Deep Stack Satellite 30 (a2a2c981), seen 2x, 2026-11-05T23:34:34-06:00 to 2026-11-05T23:37:35-06:00, release `71087373d6ce`
- `aa6f66a2caed8481` warning table_no_hand_progress: Union Mystery Bounty (PLO5) (7576aeb1), seen 1x, 2026-11-05T17:11:05-06:00 to 2026-11-05T18:42:57-06:00, release `71087373d6ce`
- `b3dce308ee73b9c8` critical recovery_loop: Prime Time Satellite 5 (7cb1a19d), seen 10x, 2026-11-05T16:25:36-06:00 to 2026-11-05T18:42:57-06:00, release `71087373d6ce`
- `bb6b4678480b61a9` critical lease_missing: NLH Heads-Up 100 (8d19a0f2), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `bc46c73924f373c0` warning tournament_resumes_failing: - (), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `c1f7be71d6d18af5` warning recovery_loop: - (), seen 5x, 2026-11-05T23:55:41-06:00 to 2026-11-06T00:07:46-06:00, release `71087373d6ce`
- `c76406a8e03cb97d` critical lease_missing: 100 Chip Spin PLO4 (5a7427da), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `ce243d0e5ae4f590` critical no_hand_progress: Midnight Free Buy (NLH) (6429087f), seen 52x, 2026-11-05T14:15:03-06:00 to 2026-11-05T18:42:57-06:00, release `71087373d6ce`
- `da55dd681c7e1251` warning tables_unbalanced: Night Owl Special (NLH) (4aaef0ed), seen 2x, 2026-11-05T22:34:48-06:00 to 2026-11-05T22:37:48-06:00, release `71087373d6ce`
- `daad6f2aaf0f1b60` warning elimination_pending: Midnight Free Buy (NLH) (dce71e3f), seen 1x, 2026-11-06T01:35:13-06:00 to 2026-11-06T01:35:13-06:00, release `71087373d6ce`
- `dd690789009ea173` critical engine_stalled_table: Prime Time Satellite 5 (7cb1a19d), seen 2x, 2026-11-05T16:28:36-06:00 to 2026-11-05T18:42:57-06:00, release `71087373d6ce`
- `eaf370cf40e84b20` critical engine_stalled_table: PLO5 Mystery Bounty Satellite 5 (01957d49), seen 1x, 2026-11-06T12:29:47-06:00 to 2026-11-06T12:29:47-06:00, release `92e26a9fbf4b`
- `ed66b89c2643eb6c` critical lease_missing: 50 Chip Spin NLH (6ffbcdd3), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `f3b8474c4aee16d6` critical lease_missing: NLH Heads-Up 25 (90936127), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`
- `f599888d903b3667` critical lease_missing: 5 Chip Spin PLO4 (cbd983e4), seen 1x, 2026-11-06T08:01:25-06:00 to 2026-11-06T08:01:25-06:00, release `92e26a9fbf4b`

## Still Detected when the report was written: 5

- `2ff624a2091d5e45` critical recovery_loop: Sunday Deep Stack Satellite 30 (a2a2c981), seen 40x, 2026-11-05T19:43:27-06:00 to 2026-11-05T23:52:41-06:00, release `71087373d6ce`
- `5619003a7b3c1de0` critical engine_stalled_table: Sunday Deep Stack Satellite 30 (a2a2c981), seen 6x, 2026-11-05T19:43:27-06:00 to 2026-11-05T23:52:41-06:00, release `71087373d6ce`
- `ab5892c3cccc3eed` critical no_hand_progress: Sunday Deep Stack Satellite 30 (a2a2c981), seen 54x, 2026-11-05T19:16:22-06:00 to 2026-11-05T23:52:41-06:00, release `71087373d6ce`
- `ce41d0f5cb61db83` warning engine_gauge_tournament_tables_failing_admission: - (), seen 27x, 2026-11-05T14:27:05-06:00 to 2026-11-05T23:52:41-06:00, release `71087373d6ce`
- `e3b6c2dc745bc711` critical prize_pool_zero: Prime Time Free Buy (NLH) (1d115ff4), seen 54x, 2026-11-05T20:40:15-06:00 to 2026-11-05T23:19:31-06:00, release `71087373d6ce`
