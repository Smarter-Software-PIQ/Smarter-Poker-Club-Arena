# Lightning empty-game seating, lobby accuracy, start ticker and slow join

Owner report 2026-11-11 (PLO5 1/2 Lightning f67a1436, "LIGHTNING LIVE THIN", 0 players): (a) could not simply sit; (b) lobby stale (Tick 442h Ago: Quiet, Avg Pot 135, Tables 6); (c) a "Lightning can't start" style message at the bottom of the table; (d) instant fake fill within a minute of sitting.
Owner: Claude session_01BNteGahgysPXVoM5dmTTZw. Worktree /Volumes/SmarterWork/agent-work/extreme-capacity/lightning-empty-seat-1794432717, branch claude/lightning-empty-seat-pacing from origin/main 90b905f48018.
Policies read 2026-11-11 from /Users/smarter.poker/Documents (AGENTS.md, AGENT-OPERATING-LAW.md, AGENT-HARDENING-STANDARD.md, policy 2.9) plus repo AGENTS.md, CHECKPOINT-daily-chicago-maintenance.md, CHECKPOINT-random-horse-entry.md, CHECKPOINT-plo-lightning-lifecycle.md.

Root causes (production read-only evidence):

- (d) The paced one-at-a-time Horse admission (20261109141301) is hard-scoped to game c79d8ec2 inside fn_ca_horse_roster_seat_guard. f67a1436 roster: person 15:05:43Z, 35 Horses 15:06:02Z-15:06:33Z.
- (a)(b)(c) Every other Lightning game carries ruleset lightning.always_on=true (creator fn_cash_game_create_impl_20260905 writes it), so an empty game never reverts from Lightning to its feeder (must-move) game: the cash tick stands down without stamping last_tick_at (2026-10-24 05:04Z), six empty anchor tables stay listed, the only door is the pool, and a lone pool player cannot get a hand. Owner rule 2026-11-05: feeder games until enough players.
- (b) TableService.getAveragePot averaged the last 100 hands ever, unwindowed. Staff tick line printed a stalled tick's old actions as current.

Fix: migration 20261111214248 (generic paced helper for every enabled Lightning game except c79d8ec2, guard branch, always_on=false for all Lightning games and creator, heads-up feeder minimum 2 for Lightning games); client lobby day (04:00 Chicago, same boundary as DAILY_WINDOW.windowStart) windows Avg Pot; staff tick line reads Controller Stalled / Lightning Pool Running; LightningStartTicker under the bomb pot line.
Tests: scripts/qualification/lightning-slow-join/native.py (PG17, reproduces the 35-Horse burst before, enforces the slow-join schedule after; wired into scripts/dev/test-lightning-phase6-settlement.sh, CI accounting shard 3); tests/unit/lightningLobbyAccuracy.test.ts.
Status: see PR. Implemented, tested, merged, installed, published and live-verified are recorded separately in the PR body and final report.

## Follow-up 2026-11-12: no busy-pool acceleration (20261112005012)

Owner decision (Dan, 2026-11-11): the approved 70 to 90 second Horse arrival pace holds in every game, including busy Horse-only pools. 20261111214248 divided the spacing by whole Lightning starts (v_population / on_threshold), which in production allowed 4.4 to 10 s spacing in NLH 0.25/0.50 and PLO4 0.25/0.50. Migration 20261112005012 redefines fn_lightning_horse_admit_paced (predecessor md5 55fb815245ccef227f084ac8d0c6a47d) with a fixed 70 to 90 whole-second spacing; heads-up rescue, one-at-a-time locking, rollback-on-refusal and people-never-paced are unchanged. c79d8ec2 (PLO4 1/2) has its own route with no acceleration (70 to 90 s, demand cap 10) and is untouched.
Test: scripts/qualification/lightning-slow-join/native.py seeds an 80-player Horse-only pool; the law (every consecutive Horse gap >= 70 s) fails on the 20261111214248 body (5 s gaps) and passes after 20261112005012 (75 to 90 s).
