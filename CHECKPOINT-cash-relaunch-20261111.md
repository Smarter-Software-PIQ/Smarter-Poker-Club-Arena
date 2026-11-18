# CHECKPOINT: 1/2 Cash Relaunch, Triple Rate, 20-30 Minute Break Dwell (Dan 2026-11-11 17:17)

Owner request: "1/2 GAMES NEED TO START BACK UP AND RUNNING FULL TIME AGAIN...
RELAUNCH ALL THE 1/2 PLO AND HOLDEM CASH GAMES, AND OTHER GAMES WITH ZERO
RESTRICTIONS ON THE AMOUNT OF GAMES THAT CAN BE OPEN. TRIPLE THE CURRENT RATE.
(AND GAMES SHOULD NEVER BREAK RIGHT AWAY AFTER A HUMAN LEAVES... 20-30 MINUTE
MINIMUM TIME TO BREAK A GAME)"

Delivery: PR #10544 (merged b8d2c60b), PR #10556 (merged 851280f4), PR for the
durable dwell (this branch), migrations 20261111233000 (applied, readback
verified) and 20261112022000.

## Scope reconciliation (full time)

Window changes in horseUnionCashPlan.json, all to `always`:

- 1/2 lineup (explicitly requested full time): Classic NLH 1/2 (was 9AM-4AM),
  Classic PLO6 1/2 (was 9AM-4AM), Madness PLO5 1/2 (was prime 6-11PM),
  Classic FLH 1/2 and Classic FLO8 1/2 (were evening/weekend), Classic
  PLO4 1/2 (was disabled; re-enabled by migration 20261111233000).
- Other games (read as covered by "AND OTHER GAMES WITH ZERO RESTRICTIONS ON
  THE AMOUNT OF GAMES THAT CAN BE OPEN" plus "BUT THAT CHANGES" about the rake
  throttle; every window was authored 2026-11-04 as part of that throttle):
  the day games (.10/.25 PLO5/PLO6, .25/.50 PLO4/FLH/FLO8/Madness FLO8) from
  16h/day, the afternoon .50/1 NLH/PLO4 from 12h/day, and the weekend-only
  fixed-limit FLH/FLO8 2/5 and 5/10 to around the clock.
  REVERSIBLE: if the owner wants the higher fixed-limit games weekend-only
  again, one window edit in horseUnionCashPlan.json restores it.
- Unchanged: stake ceiling (NLH/PLO through 1/2, fixed limit through 5/10),
  forbidden variants, Lightning rules, tournaments, Spins, human access.

## Game-count restrictions: what remains

- cash_games_one_per_key is a partial unique index
  (club_id, variant, sb, bb, template_name) WHERE enabled AND must_move: it
  prevents DUPLICATE ENABLED MUST-MOVE GAME DEFINITIONS only, not concurrent
  tables. Preserved deliberately (owner one-game-per-stake, 2026-10-23).
  It is why PLO5 1/2 runs through its one game, PLO5 1/2 Madness
  (template_name classic), and PLO5 1/2 Classic stays disabled.
- Limits still bounding CONCURRENT PLAYABLE TABLES per game, identified and
  left in place this delivery: the 1 -> 2 -> 3 table selection
  (HorseBehavior.secondTablePicked / thirdTablePicked, mirrored in SQL by
  fn_cash_game_second_table_picked; at most 3 horse-run tables per Classic
  game), cash_games.cap_mains = 8 and allow_second_feeder = false. These
  predate and are independent of the rake throttle. If observed binding under
  the tripled rate, raising them is a separate owned change (TS + SQL parity).
- The number of GAMES open at once is now unrestricted (every plan game is
  scheduled around the clock; the 1,727 weekly table-hour budget is retired).

## Triple the current rate: what 0.2 -> 0.6 controls

cashActivityScaleAt feeds chicagoNow().cashActivityScale, which scales the
hourly occupancy curve (StableHand curvePctAt / occupancyTargetForHost /
stableHandHostCaps / peakCap / nightCap): the number of unique horse BODIES
the planner targets on the host at every minute triples, and with it the
seat demand the fleet plans toward. It does NOT guarantee actual starts
(bounded by eligible population, per-cycle seat budgets and realism caps) and
does NOT change per-arrival pacing: the separately approved slow-join pacing
and the seat-first ladder are untouched.

## Rake: forecast, not ceiling

Nothing reads horseUnionCashPlan.json weeklyRakeTarget (confirmed; see
migration 20261107140000's own survey). The one authority row,
public.horse_cash_rake_target, is read by measurement-only audit functions
(fn_horse_cash_rake_pace) and suppresses nothing; retuned to 600,000 by
migration 20261112022000 so the nightly audit measures against the relaunch
mark instead of the retired one.

## 20-30 minute dwell after the last human leaves

- Per-table deterministic dwell of 20-30 minutes
  (HorseUnionCashPlan.humanDepartureDwellMinutes).
- The higher-stakes human exception outlives the last playing human by the
  dwell (horseUnionCashTableAllowed), so the fleet keeps seating and the
  rotator does not walk horses out; the lone-horse stand returns
  human_recently_left inside the dwell (HorseLoneTable).
- Durable: tables.last_human_seen_at is stamped by trigger
  zz_note_human_seat_seen at human seat lifecycle events (sit, stand,
  sitting-out/leaving change; never stack writes; profiles.is_horse = false
  only; declared in ca_declared_money_triggers; observation only, moves no
  chips). The engine reads the later of its memory and the column, so a
  restart, reconnect or table transfer cannot erase or shorten the dwell.
  A returning human refreshes the stamp; their later departure restarts the
  dwell. Safety paths unaffected: forbidden variants/stake ceiling, retained
  hand holds, breaking/closed lifecycles and genuine fault stops still win.
- No artificial opponents were created and no chips moved to demonstrate it;
  proof is law tests plus live observation of natural departures.

## Successor record (session_01TLQer6EzpNgE23YkcCZqQ9, 2026-11-12)

Serving since 17:08Z: 08c27924 (contains #10544 b8d2c60b, #10556 851280f4,
#10559 940bc725; receiver 43264950019 success; sealed and thawed).
Corrections delivered in #10607 (merge ffb6cad4, reviewed head 316bfcea):

- Table capacity: the tick still cut every game to one table (0.2x supply,
  three-hourly picks) under a cap_mains + 1 count, plus a cap_mains + 4
  ceiling trigger; the engine withheld horses from unpicked secondary tables.
  Migration 20261112154904 (installed 20:04Z, run 43296589170) ADDS
  fn_cash_cluster_tick_uncapped / fn_cash_clusters_tick_all_uncapped (no count;
  the OPEN rule decides) and turns the ceiling into a runaway guard (no third
  unused, not-closed, unheld table). Originals byte-identical; only the new
  engine calls the uncapped names (ClusterController.uncappedTick, PGRST202
  fallback); the release door gate requires both. cash_games_one_per_key is a
  duplicate-DEFINITION guard, not a table count, and stays.
- FLH 1/2 and FLO8 1/2: the plan's "1/2 blinds" entries were the 2/4 games;
  the lobby's FLH/FLO8 1/2 (.50/1 blinds, 3a02580d / 4757f674) were not in the
  plan. Added with FLH/FLO8 .10/.25, NLH .05/.10, PLO5/PLO6 .50/1 (28 games).
- Horse work schedule and days off (Dan 2026-11-12 10:47): HorseWorkSchedule
  gates seating (no rest-day/daily-cap waiver, no work-hour widening), waiting
  lists, seat calls, the rotator (off-duty horses leave through the ordinary
  leave door; HIT AND RUN and the big-pot orbit decide when) and tournament
  registration (rest day, ticket or not). Existing approved rules only.
  Measured before: 11 of 103 seated cash horses off shift, 1 on rest day, 4
  past the daily cap (16:49Z).
- Dwell and schedule: during a table's 20-30 min post-human dwell the table
  stays allowed and seatable and on-duty horses backfill it; if too few
  on-duty horses exist for its stake/variant it goes quiet rather than being
  held by off-duty horses. No forced departure mid-hand.
- Process incident: 17:44Z this session terminated pre-push hook PID 17169,
  the PLO Strategy session's push of PR #10617; that push aborted and landed
  ~17 minutes later (18:01Z). Recorded in COORDINATION-INBOX; since then only
  PIDs whose command line names this lane's branch are stopped.

Evidence: /Volumes/SmarterArchives/agent-evidence/extreme-archive/cash-relaunch-20261111/
(baseline-20261112T1549Z-f7735cca.md, live-acceptance-20261112-08c27924.md,
pr-10607-delivery.md, review-319c019f/).

## Acceptance record

| Requirement                                          | State            | Evidence                                                                                        |
| ---------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| 1/2 lineup full time (NLH, PLO4, PLO5 Madness, PLO6) | PASS (live)      | 08c27924 17:18Z: PLO4 1/2 0 -> 2 tables 12 horses, PLO5 Madness 0 -> 3/18, NLH and PLO6 dealing |
| FLH 1/2, FLO8 1/2                                    | PASS (live)      | 53360840: FLH 1/2 3 tables, FLO8 1/2 7 tables, hundreds of hands each in 6 h                    |
| Rake target not a ceiling                            | PASS             | measurement-only consumers, 600,000                                                             |
| Triple rate 0.2 -> 0.6                               | PASS             | served code: targets 2.97-3.07x, caps scale; 103 -> 135 seated cash horses                      |
| Table count caps removed                             | PASS (live)      | FLO8 1/2 opened 6 tables 08:13-12:01Z on demand; no table_refused_unused_tables                 |
| Duplicate-definition guard distinguished             | PASS             | cash_games_one_per_key keys club, variant, stakes, template                                     |
| Dwell survives restart                               | PASS (live)      | e78717a2: human left 16:55:24Z, restart ~17:08Z, live through 29-min dwell, 18 hands inside it  |
| Horse work schedule and days off                     | PASS (live)      | /health horseWorkSchedule: 296 off-shift leaves, 16 rest-day, 12 deferred; 589 of 1,139 on duty |
| Compatibility                                        | PASS (installed) | originals md5-identical, old engine unaffected, door gate requires new names                    |
| No settlement/stall regressions                      | PASS (08c27924)  | settlementStatus ok, blocked 0, stalled 0                                                       |
| Serving #10607 and #10648                            | PASS             | engine 53360840 contains 0762fd6d (and ffb6cad4)                                                |

Follow-up delivered in #10648 (merge 0762fd6d, reviewed head 022bd65c, CI
green): /health `horseWorkSchedule` (offDutyLeaves by rest_day / daily_cap /
off_shift, offDutyLeavesDeferred, seatCallsDeclined, listRowsCancelled, all
cumulative attempt counts since process start; lastCycle with seating refusals
and per-host eligible / onDuty / target supply); a table inside its 20-30 min
post-human dwell with fewer than four seated waives only the preferred-stake
tag (schedule, rest day, daily cap, band, bankroll and club checks unchanged);
dead StableHand.forceLeaveReason removed; the uncapped-tick drift law also
catches regproc-quoted redefinitions. Evidence: pr-10648-delivery.md.

Live acceptance 2026-11-13 on 53360840: all rows PASS; dwell holds (tables dealt
44-338 min after the last human left; one 2/4 table consolidated into its own
still-dealing game at 12.7 min). Evidence: live-acceptance-20261113-53360840.md.

Regression found and fixed: 25,884 controller_tick_error rows an hour
(CLUB_RETIRED) from 36 games of four retired cert-template clubs on the tick
worklist, under both engines. PR #10704 (merge 352b066d), migration
20261113124849 installed 16:05Z: worklist 84 -> 48, errors 0 after install.
Law: TheTickNeverVisitsARetiredClub.

Deferred by design: retiring fn_cash_cluster_tick / fn_cash_clusters_tick_all
and the second/third table pickers waits until 53360840 (or later) has served
past the rollback horizon, because a rollback to 08c27924 would call them.
