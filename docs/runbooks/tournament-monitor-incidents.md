# Tournament Monitor Incident Records

How a Claude chat session picks up, carries and closes a tournament incident
found by the read-only monitor on the engine host. Written 2026-11-05.

## Why this exists

`ops/tournament-monitor/` (merged in #9565) is a read-only checker installed at
`/opt/tournament-monitor` on the engine host. systemd runs one cycle every
180 s. It detects and records; it never repairs, restarts, notifies or writes
to the database.

Autonomous repair depends on a Claude chat session being alive. The platform
refuses an unattended dedicated session, the owner switches accounts, and the
Claude scheduler is forbidden for anything that matters (CLAUDE.md 10.85). So
the work of carrying a finding from detection to a verified root-cause fix has
to survive the end of whichever chat started it.

The incident record is that survivor. One JSON file per distinct finding
fingerprint, on the host, updated by the checker and advanced by chats. **The
record is the source of truth across chats.** A chat that picks up the lane
reads the handoff first, claims the record, and advances it as the work lands.
Nothing in a chat transcript counts if it is not in the record.

The record is a record keeper, not a fix. A finding is closed by fixing its
cause at the root, settling any damage through the platform's own idempotent
path, pinning the cause with a test and hardening the similar paths (CLAUDE.md
10.11 and 10.12). Opening a record, or watching it, is never the resolution.

## Where things live on the host

```
/opt/tournament-monitor/tournament_monitor.py        the checker and its CLI
/opt/tournament-monitor/state/latest.json            last cycle (findings, coverage, incidents summary, claude_session)
/opt/tournament-monitor/state/findings_state.json    the checker's own open/resolved view of every finding
/opt/tournament-monitor/state/claude_heartbeat       touched when a chat reads the handoff
/opt/tournament-monitor/incidents/<fingerprint>.json one incident record per distinct finding
```

Engine host: `root@5.161.252.33` (engine-01, the host the `club-arena-engine`
container runs on; `178.156.160.206` is the TURN server, not the engine),
reached from the Ops Mac only as `ssh ca-engine` - the fail-closed alias in
`~/.ssh/config` (one pinned key, BatchMode, no prompts). A failed login there
costs the Mac a 24 h fail2ban ban; if `ssh ca-engine` is refused, stop and
report it, never retry. All commands below are read-only against
production except for the record and heartbeat files themselves.

## Claiming the handoff

Every chat that takes this lane starts with these three commands, in this order.

```bash
ssh ca-engine 'cd /opt/tournament-monitor && python3 tournament_monitor.py handoff --by "<chat id or your name>"'
```

That prints a compact plain-text handoff: the observation window, the last
cycle's coverage and timestamp, every open incident with its stage, owner, age,
links and last note, and the exact commands to claim and advance one. Reading
it also touches `state/claude_heartbeat` with your `--by`. That touch is what
tells the checker an operator is present; see "The absence finding" below.

Then claim the record you are taking (one chat, one record at a time is fine;
claim each one you touch):

```bash
ssh ca-engine 'cd /opt/tournament-monitor && python3 tournament_monitor.py incident <fingerprint> --stage Investigating --by "<chat id>" --note "<what you are looking at and where>"'
```

Read the full record whenever you need the details (the finding text, the
tournament id, the first release SHA it was seen on, the whole stage history):

```bash
ssh ca-engine 'cat /opt/tournament-monitor/incidents/<fingerprint>.json'
ssh ca-engine 'cd /opt/tournament-monitor && python3 tournament_monitor.py incidents --open'
```

Re-read the handoff whenever you come back to the lane after doing other work.
The heartbeat is only as fresh as your last read.

## The stages

Stages move forward only. Every advance needs `--by` and `--note`; the note is
what the next chat will read, so say what was done and how it was verified,
not that it was done.

| Stage | It means |
| --- | --- |
| `Detected` | The checker opened the record. No chat has looked yet. |
| `Investigating` | A chat has claimed it and is reading rows and logs to name the cause. |
| `Fix implemented` | The line that produced the wrong outcome is changed on a branch, with a test that pins it. Note the root cause. |
| `Pushed/merged` | The PR is merged to protected main. Pass `--pr N` and any `--migration VERSION`. |
| `Deployed` | The release carrying the fix is live on the host. Pass `--release SHA`. |
| `Production fix verified` | Proof from production, not from the branch: the symptom cannot reproduce and any damage is settled through the platform's idempotent path. Say what you read. |
| `Phase 2 hardening` | Law test and guards on the similar paths written and merged. |
| `Hardening deployed and verified` | The hardening is live and proven. |
| `Closed` | Everything above is done and the note says how it was verified. Only this command closes a record. |

`Reopened` is a transition, not a stage: it returns the record to `Detected`,
increments `times_reopened` and appends a `Reopened` entry to `stage_history`.
Use it yourself when a symptom you thought fixed comes back under a different
fingerprint and you want the old record to carry it; the checker uses it
automatically when the same fingerprint reappears.

The CLI refuses a move backwards, an unknown stage, an empty `--by` or
`--note`, and a fingerprint that is not a record. Skipping forward is allowed
when the note explains it (for example a fix that needed no migration).

```bash
# advance with links
python3 tournament_monitor.py incident <fp> --stage "Fix implemented" --by "<chat>" --note "<cause and change>" --pr 9700
python3 tournament_monitor.py incident <fp> --stage Pushed/merged --by "<chat>" --note "merged" --pr 9700 --migration 20261105210000
python3 tournament_monitor.py incident <fp> --stage Deployed --by "<chat>" --note "sealed release on host" --release <sha>
python3 tournament_monitor.py incident <fp> --stage Closed --by "<chat>" --note "<how production and hardening were verified>"
# reopen
python3 tournament_monitor.py incident <fp> --stage Reopened --by "<chat>" --note "<why>"
```

The owner is set to `--by` the first time a record is claimed and stays with
that chat unless `--owner` is passed explicitly. A later chat may advance a
record it does not own; the stage history records who did what.

## What the checker does to a record, and what it never does

Each cycle the checker:

- opens a record (stage `Detected`, owner `null`) the first time it sees a
  fingerprint in `findings_state.json`;
- bumps `last_seen_utc`, `times_seen`, `severity`, `finding` and `details`
  every cycle the finding is observed;
- sets `resolved_at` when the finding resolves in its own view (the symptom
  stopped being observed). **The stage does not change.** A symptom
  disappearing is not a fix, and the record stays open at whatever stage it
  had reached until a chat closes it with a verified note;
- reopens a record (stage back to `Detected`, `Reopened` history entry,
  `resolved_at` cleared) when the same fingerprint is observed again after
  `resolved_at` was set or after `Closed`.

- moves an **unclaimed** record still at `Detected` to `Cleared, no fix
  recorded` once its symptom has been absent for 30 minutes (10 clean cycles),
  appending the evidence to `stage_history`: when it was last seen, minutes
  clean, and the engine release at last sight. This is not `Closed` and is not
  a fix: it says the symptom stopped and the root cause is not established. The
  handoff lists cleared records separately for root-cause review, and a
  recurrence reopens the record to `Detected` like any other. A claimed record
  (any owner, or any stage past `Detected`) is never cleared by the checker.

The checker never deletes a record and never sets `Closed`. Test findings
(from `test-input.json`) get records tagged `"test": true` and are not counted
as production incidents.

## Operator presence (reported, not a finding)

`state/latest.json` carries a `claude_session` block with the age of
`state/claude_heartbeat` in seconds and minutes, the last reader, and
`unattended: true/false`. `cycles.jsonl` lines carry `open_incidents`,
`unclaimed_incidents` and `claude_heartbeat_age_s` alongside every existing
field (nothing was renamed).

Until 1.2.0 the checker also raised a warning finding, `no_claude_session`,
whenever no chat had read the handoff for 30 minutes. It was retired on
2026-11-06: keeping a chat reading on a timer needs the Claude scheduler, which
CLAUDE.md 10.85 forbids agents to use, so the finding could never be cleared
legitimately and sat open permanently as a false warning. The presence data is
still in `latest.json`; the reader is the next chat that runs `handoff`, and
this runbook is how that chat knows to look. Old `no_claude_session` findings in
the state file resolve on the first 1.2.0 cycle and never got incident records.

## Installing or updating on the host

From a checkout of main, copy these four files into `/opt/tournament-monitor`
and let the timer pick the new code up on its next cycle (the unit is oneshot,
so no restart is needed):

```
ops/tournament-monitor/tournament_monitor.py
ops/tournament-monitor/tournament-monitor.service
ops/tournament-monitor/tournament-monitor.timer
ops/tournament-monitor/README
```

The `incidents/` directory is created on first use. Existing state files are
read as before; a monitor upgraded in place opens records for every finding
already in `findings_state.json` on its next cycle.

Tests, from the repo root, with Python's unittest and no other dependency:

```bash
python3 -m unittest ops/tournament-monitor/test_tournament_monitor.py
```
