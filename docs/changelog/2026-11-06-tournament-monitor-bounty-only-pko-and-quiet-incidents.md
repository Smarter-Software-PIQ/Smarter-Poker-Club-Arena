# Tournament monitor 1.2.0: no false alarm on bounty-only PKOs, quiet incidents clear, no absence finding

Date: 2026-11-06. Scope: `ops/tournament-monitor/` and its runbook only. Read-only
monitor; no engine, database or money change.

## 1. A bounty-only PKO is not a zero prize pool defect

The `prize_pool_zero` rule flagged every running event with a place prize pool
of 0. A bounty-only PKO or Mystery Bounty (no guarantee, every chip in the
bounty pool) legitimately runs and finishes that way (#9617, #9620, migration
`bounty_only_pko_ends_with_two_players`). The Midday and Midnight Free Buys
raised a permanent critical as a result (Midday Free Buy b3ae52ef: 20
occurrences, prize pool 0, bounty pool 314, guarantee 0).

`prize_pool_zero_is_a_defect(t)` now excuses only that case: a PKO or Mystery
event with guarantee 0 and a bounty pool above 0. A guaranteed event with a 0
pool, a knockout event with nothing in its bounty pool, and any plain event
with a 0 pool still flag. The cycle now reads `is_pko`, `is_mystery_bounty`
and `bounty_pool`.

## 2. Quiet, unclaimed incident records clear themselves, honestly

47 records sat at `Detected` with no owner, most of them symptoms (lease
missing, short stalls) that stopped hours earlier. The checker now moves an
unclaimed record still at `Detected` to a new terminal stage, `Cleared, no fix
recorded`, once its symptom has been absent for 30 minutes (10 clean cycles).
The stage history records when it was last seen, minutes clean and the engine
release at last sight, and says plainly that no fix is recorded and the root
cause is not established.

It is deliberately not `Closed` and not `Production fix verified`: a symptom
that stops is not a fix (Dan, 2026-11-05: a restart that restores movement
does not close an incident). The handoff lists cleared records separately for
root-cause review, a recurrence reopens the record to `Detected`, and any
record a chat has claimed or advanced is left to its owner. A record whose
finding was pruned from the state file anchors on its `last_seen_utc`.

## 3. The no_claude_session finding is retired

The checker raised `no_claude_session` whenever no chat had read the handoff
for 30 minutes. Keeping a chat reading on a timer needs the Claude scheduler,
which CLAUDE.md 10.85 forbids agents to use, so no agent could legitimately
clear it: it was a permanent false warning. Presence is still reported in
`latest.json` (`claude_session`: last read, last reader, age, unattended) and
in `cycles.jsonl`; it is no longer a finding. An old open finding resolves on
the first 1.2.0 cycle. No scheduled task was created.

## Tests

`python3 -m unittest ops/tournament-monitor/test_tournament_monitor.py`: 27
tests pass (6 prize-pool rule cases, 7 clearing cases, presence reported
without a finding, a stale absence finding resolving).
