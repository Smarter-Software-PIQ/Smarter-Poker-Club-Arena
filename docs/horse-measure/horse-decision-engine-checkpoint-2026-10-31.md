# Hold'em horses checkpoint - 2026-10-31 02:10 UTC

## Delivered to protected main (verified: squash-merged, re-run green on the merged tree)

| PR | merged SHA | what |
|---|---|---|
| #8807 | a18a2f1781 | Lightning hold for the engine cutover (first version) |
| #8808 | 4240e05d5f | an expired activation floor is no floor (routine daily route) |
| #8819 | 7941066df9 | announced owner keeps its exact floor record past expiry; ends by name, not a KeyError |
| #8818 | 03194e3850 | hold only on a break this run can consume; release when it passes, re-hold next break under a new generation; safe under set -e; stop budget on signalled exit; retried transaction inherits its hold; refused resume gets a new attempt id; lock released before the thaw wait |
| #8810 | 034e2a21bf | Hold'em live measure toolkit + `server/tsconfig.scripts.json` + CI step `TypeScript Check (server scripts)` + law `tests/server-scripts-are-type-checked.law.test.ts` (six qualification manifests and the runner-recovery fingerprint rebound for the ci.yml edit; `scripts/qualification/**` baseline of 36 errors recorded and excluded, nothing else) |

| #8834 | (merged 03:20 UTC) | `tests/operations/lightning-hold-exit-paths.test.py`: the hold's three shell functions driven through every exit path with a fake helper, health and clock; wired into the hold law |
| #8832 | 71a6f3ed3a | `fn_horse_river_one_pair_calls` (migration 20261031024652) - the river one-pair measurement computed in the database, service-only, bounded; SQL/TypeScript parity test in accounting shard 2 (green in CI); CLI asks the function first, Prometheus `--prometheus URL` heap/RSS source per instance; ci.yml pins rebound. **Applied to production 03:38 UTC** via Apply Merged Migration (run 41165219930, success); live answer at 03:41 UTC over 24 h: small 118/39 (33.1%), medium 297/51 (17.2%), large 611/85 (13.9%), 12,197 rows read |

Autopilot duplicates #8815 / #8817 are superseded (could not be closed from this session: PR comment/close writes were refused by the action classifier and the token; noted for the owner).

## The release owner and the next cutover

- Serving engine at 02:07 UTC: **EED `eed06fe5`, instance `1-a474c9ca`**, liveness ok; no engine containing the four Hold'em fixes has served yet. All four (#8692, #8694, #8733, #8705) are on main.
- Active release owner: **#8816** (`fix/lightning-hold-outcome-01a18a0c`, another session on the Smarter-Poker account) - v2 hold journal with a DB-side `resolve_release_hold` resolver (migration), and owner window `2026-10-31-cashier-frozen-recovery-hold-ownership-next-55` (00:20-03:10 UTC, announce :53). It went `dirty` against main when #8818 merged; I published the resolved merge as PR #8829 into their branch (v2 journal kept + `--generation` + transaction wiring); the owner resolved it their own way at 02:04 UTC (head `a5c7cba99`, their journal now carries the generation itself), so #8829 was closed as superseded. Their checks restarted at 02:05 UTC (first head took ~100 min), so the 02:53 announcement inside their window is unlikely; the window closes 03:10 UTC.
- If that window passes: the next admitted cutover is the **routine daily route** - `stage-engine-release.yml` cron 08:30/09:30 UTC (03:30 Chicago) prepares protected main, the receiver reads the expired v2 manifest as no floor (#8808/#8819), the transaction waits for the 03:58 Chicago announcement, holds Lightning at that announcement (daily qualifies with no floor), and the legacy checkpoint over EED runs at 04:00. No competing release was started from here.
- Not yet witnessed live (needs that cutover): that finished LightningHandHost objects are collected after the pause so `retained_lightning_host_census_unproven` clears; that only Clusters this transaction paused resume on every exit path (journal + `already` discipline, unit-tested, not yet exercised against production).

## Baseline measurements on EED (bounded, read-only; the "before")

- Heap/RSS slope, instance `1-a474c9ca`, 8 samples over 51 min (01:14-02:05 UTC): **heap +0.39 GB/h (r2 0.74), RSS +1.70 GB/h**; heap 3,390 -> 3,721 MB, RSS 15.4 -> 16.5 GB (peak 17.1 GB at 01:55). Sampler continues for ~70 more minutes into `/tmp/health-samples.jsonl` in this session only.
- Unfloored 3-bet shares (horse_daily_play, days >= 2026-10-30; all variants, floored tables excluded - 63% of opportunities were on floored tables): cash 496 horses, 538k hands, **3-bet 2.72%** (9,441/346,597), **fold-to-3-bet 61.5%**; tournament 756 horses, 261k hands, 3.63% / 65.1%; heads-up cash 11.5% / 78.6%; all 3.14% / 63.7%.
- River one-pair calls by V62 size class (the toolkit's exact arithmetic, run in-database as a pg_temp function over the last 24 h, 02:35 UTC; 11,262 NLH review rows read, 958 without a full board/hole pair; big-pot subset |net| >= 20bb):

  | size class faced | calls | won | won % |
  |---|---|---|---|
  | small (< 0.4 pot) | 106 | 35 | 33.0% |
  | medium (0.4-0.7) | 301 | 53 | 17.6% |
  | large (>= 0.7 or raised) | 618 | 83 | 13.4% |

  This is the leak V61 shades against: a horse that calls a large river bet with one pair wins 13% of those big pots on EED. Leak-tag proxy agrees in aggregate (`one_pair_river_stackoff` lost/won 402/274 Oct 29, 307/204 Oct 30).
- V61/V62 receipt counts: **0 rows** for `v61_river_one_pair_shade` and `v62_river_bettor_polarity` on Oct 29-31 - expected, EED predates both; V38 river receipts 19,177 call / 31,862 fold (Oct 29), 16,651 / 26,329 (Oct 30). V62 is opt-in (#8781), so 0 V62 fires after the cutover is also expected; V61 is the live witness.

## How to run the measurement after a containing revision serves

    cd server
    npx tsx scripts/holdem-live-measure.ts sample-health --samples /var/tmp/health.jsonl   # every few minutes for an hour+
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/holdem-live-measure.ts report --samples /var/tmp/health.jsonl --since-hours 24 --out /var/tmp/holdem-live-measure

## Daily-route risk seen in this morning's log

The 08:36 UTC Oct 30 daily release (run 41027589279) failed with `fresh scheduled release cannot compete with active runtime owner 41022533688-1`: another session's owner-window release held the runtime at that minute. Tonight's 08:30 UTC preparation has the same exposure if a release is still waiting at the certificate then; #8816's window expires 03:10 UTC and its transaction's certificate deadline is clamped to that, so it will not be. If #8816 merges before 08:30 UTC, its v2 hold journal requires its migration (`resolve_release_hold`) to be installed first - an uninstalled resolver makes every pause UNKNOWN, no hold is placed, and the census refuses the checkpoint again; `apply-merged-migration` refuses DDL in the :50-:03 UTC minute window, so the merge minute matters.

## Exact remaining blockers

1. No engine containing the fixes has served. Blocker: an admitted cutover - either #8816's window (checks must finish and merge before ~02:40 UTC; unlikely) or the daily 04:00 Chicago route (automatic).
2. Live proof of Lightning host collection under the hold and of the census guard admitting the checkpoint - only observable at that cutover; read the host journal of that run (`<run>.lightning-hold*.json`, `.released`) and the transaction log lines `[engine-release-transaction] ... Lightning`.
3. (Closed) The size-class baseline above was taken in-database; the `report` CLI remains the way to take the "after" with heap samples once a containing revision serves.
4. EED heap/RSS keep growing (RSS 17 GB); a crash-restart before 04:00 keeps serving EED and resets the sampler's instance line, not the plan.

## 2026-10-31 06:50 UTC checkpoint (swarm wave)

- V63 (one-pair river shade, knee past a half-pot wager, cap 0.20 at a pot-sized wager) MERGED to main as 7cb5fffc95 (PR #8851). stage-engine-release classified it engine-affecting and dispatched; auto-deploy-hetzner run for 7cb5fffc95 is staged in the break gate for the 04:00 America/Chicago (09:00 UTC) cutover. Serving is still eed06fe5.
- Leak report (read-only analyst): /home/claude/wt/horse-leak-report-2026-10-31.md. Weekly (cash/MTT): turn one-pair calls -308k/-185k; flop bet-raised-call one pair/air -241k/-163k; turn bet-raised-call -179k/-111k; river one-pair bet-raised-call -129k/-47k; turn air/draw calls -62k/-25k.
- Builders in flight (own worktrees/branches): V64 feat/v64-river-raise-discipline (/home/claude/wt/v64), V65 feat/v65-turn-one-pair-call-shade (/home/claude/wt/v65), V66 feat/v66-bet-raised-one-pair (/home/claude/wt/v66).
- After the cutover: confirm /health.releaseSha == 7cb5fffc95..., read Lightning hold/census/resume lines, run fn_horse_river_one_pair_calls 24h and compare with baseline (118/39, 297/51, 611/85); V61/V63 receipts.

## 2026-10-31 09:35 UTC

- On main: V63 7cb5fffc95 (#8851), V64 941a3b5f72 (#8874), V66 97485fe12d (#8875), V65 cc8e09294c (#8885; merge resolved V65+V66 as `eq - shade65 - shade66`, exclusive gates).
- Not serving: engine still eed06fe5. The 04:00 Chicago break ran (last_hand at 08:59 UTC) but no release was admitted: GitHub never fired the 08:30 UTC scheduled preparation, and owner-window run 41177442979 (bd11ad35ca, window expired 08:10 UTC) is still in progress holding the runtime owner slot (release owner's #8878 / withdraw path in progress). Push stages queue routine engine changes for the daily route.
- Next window: Sun Nov 1 04:00 CST = 10:00 UTC (DST ends), prep cron 09:30 UTC. Then measure: fn_horse_river_one_pair_calls 24h vs baseline (118/39, 297/51, 611/85); receipts v61/v63/v64/v65/v66.

## 2026-10-31 13:25 UTC (phase 2)

- V68 3c44fcbcde (#8892): high-card turn calls; implied odds zeroed when stacks cannot pay (>=0.7 pot, <1.5x pot behind), pure air without a real draw shaded like V65. League +0.18/+0.16/+0.07 mirror.
- V67 412bafe0f3 (#8893): river one pair that bet and was raised; new raise range (10% bluff / 75% two pair+ / 22% top pair / 3% weaker) + V63 shade +0.10 (cap 0.25), no 0.42 floor, no jam. League +0.42/+0.16 mirror. Fixture: top pair folds 40/40 to a 3x river raise with no over-bluffer read — WATCH live; halve the 0.10 shade if overshoot.
- All six (V63-V68) on main, staged, queued for Sun Nov 1 04:00 CST (10:00 UTC; prep 09:30 UTC). Blocking owner run 41177442979 ended exit 70 at 10:01 UTC. Serving still eed06fe5.

## 2026-10-31 18:15 UTC (phase 3)

- V69 0562b8d49c (#8902): one-pair implied odds zeroed when stacks cannot pay; V65 draw exemption needs a hole card in the draw (board-only four-flush no longer exempts); V32 turn draw pass-through falls through when no room to be paid (inert in prod: v32FacingDefense is opt-in). League +0.32/+0.01/+0.23 mirror. Main 67bb14a263 staged.
- V63-V69 all on main and staged. Serving eed06fe5. A foreign MTT owner-window run (41211039922, 609e7e5584, contains V63-V68) was in progress past its 15:20 UTC window; not ours.
- Remaining (time-bound, cannot be done today): Sun Nov 1 09:30 UTC prep / 10:00 UTC cutover, then the 24h live re-measure and V67 strength decision.

## 2026-10-31 20:25 UTC — :55 deploy attempt and freeze incident

- Owner order 17:07 UTC: deploy at next :55. Window #8917 (53c5991113) open 17:15-23:15 UTC.
- 18:10 attempt (53c599): #8908 scale gate refused "owned disposable container state unknown" (Docker not-found wording). Fixed #8928 (0db4b3de03).
- 19:53/19:55 attempt (b1f2a037f7, run 41233374402): scale gate qualified (35M objects, 17.2s); native census admitted (34 MB heap need); live census queryObjects timed out at 30.3 s (checkpoint never invoked, inspector not closed). Release stood down, eed06fe5 recovered.
- INCIDENT: platform frozen 19:54:37-20:20:26 (~25 min). Break row stayed counting_down (EED waits in releaseBoundaryOnly; the retired transaction never thawed). Engine restarted 20:08:57 (1-4bc6eeb1), re-adopted, own v3 thaw complete 20:20:17 crediting 1,512 s. My manual thaw call was blocked by the permission check; the user authorized it after, but it had already self-resolved.
- #8918 (census heap rule) closed as superseded by #8908.
- Open blockers before any retry: (1) native census exceeds its 30 s allowance on the live engine; (2) a pre-invocation census refusal leaves the platform frozen until an engine restart.

## 2026-10-31 21:30 UTC
- Freeze root cause (from logs): fn_thaw_platform 500 CLUB_RETIRED from the Lightning pilot retirement guard; fixed in prod 20:19:33 by migration 20261031201656 (#8946, other agent, not yet on main).
- Census cannot fit: QueryObjects ~11-12 ms/MB realistic heap -> ~45 s at 3.85 GB vs 30.3 s allowance. Owner chose: build a checkpoint-free cutover (agent building, branch fix/eed-cutover-without-legacy-census).
- Window closed by #8954 (24e4211d90); doomed runs 41242825182 and 41242937916 cancelled pre-host with owner authorization.
- Live RFI measured (/home/claude/wt/horse-rfi-live-2026-10-31.md); opening-range fix in progress (branch feat/horse-gto-opening-ranges).
- 04:00 daily (10:00 UTC Nov 1) would hit the same census refusal unless the cutover fix lands first.
