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

## Acceptance record (to be finalized after cutover)

| Requirement | State | Evidence |
| - | - | - |
| 1/2 lineup full time in plan | MERGED, law-tested | HorseUnionCashPlan.law.test.ts (six 1/2 games, every hour) |
| PLO4 1/2 Classic re-enabled | PASS (installed) | migration 20261111233000 in schema_migrations; readback enabled=true |
| PLO5 1/2 one game per stake | PASS | cash_games_one_per_key; Madness row live |
| Zero game-count restriction (games open) | MERGED, law-tested | 21 games scheduled every hour |
| Triple rate 0.2 -> 0.6 | MERGED, law-tested | HorseCashSchedule.law.test.ts relaunch stage |
| Rake mark measurement-only at 600,000 | PENDING migration 20261112022000 | fn_horse_cash_rake_pace readback after apply |
| Dwell in decision paths | MERGED, law-tested | allowed()/lone-stand tests |
| Dwell survives restart | THIS PR | column + trigger + restart law test |
| Engine serving the relaunch | UNVERIFIED | engine.smarter.poker/health still f7735cca at 02:00Z |
| Live 1/2 board, paced arrivals, no churn/queueing/settlement regressions | UNVERIFIED | post-cutover observation |

Unrelated, preserved with its owner: Club Create Certification failing on main
since before this delivery (heads 657235b0, 79059fcc, 85ec035e, b8d2c60b).
