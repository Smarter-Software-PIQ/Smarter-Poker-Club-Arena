# 2026-11-01: the engine door no longer refuses every build, and an owner window carries it

Dan, 2026-11-01 07:30 America/Chicago: "FIX ANY AND ALL BLOCKERS NOW AND FINISH
THIS UP, PUSH AND PUBLISH EVERYTHING".

## The blocker

Every engine release built from 0d7cd8df4 (#9054) onward failed in
`Prove The Exact Engine Has Every Production Door`:
`fn_ca_cancel_tournament_abort_unsettled_hand() ... does not exist in production`.
That function is defined only by `20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql`,
which declares `@install-window: daily-maintenance`, so it installs only inside a
release break. A build the door refuses never reaches a break, so the migration
could never install and no later build could ever pass the door: a closed loop.
The merged #9012 (V74 Omaha semi-bluff gate, herd-notes boot loader, scoped-store
ledger) and everything else merged since #9054 were stuck behind it.

## The fix

- `scripts/ci/engine-doors.allowlist.json` names the function with its reason.
  The call is fail-closed: `TournamentManagerBase.acknowledgeTournamentAbortBoundary`
  reaches it only for an explicit `equal_share` closure whose stop state names a
  `cancellable_permit_id`, and any error reply (a missing function is
  PGRST202/42883) throws `tournament_abort_hand_disposition_unknown` before any
  acknowledgement. `TournamentAbortOwnership.test.ts` already pins that refusal.
- `server/release/owner-maintenance-windows.json` gains two entries under Dan's
  order, both 14:30-20:25 UTC on 2026-11-01, both containing 4e9c3228:
  - `2026-11-01-v74-door-unblock-and-window-migration`: the floor-bound engine
    window (one activation at a Chicago :53 notice / :55 break; falls back to the
    04:00 Chicago daily break on 2026-11-02 10:00 UTC);
  - `2026-11-01-window-migration-20261101005048`: its companion, naming the two
    queued equal-share window migrations in version order (20261101004247 from
    #9073, whose preimages read equal in production, then 20261101005048) for the
    existing window installer inside the first confirmed freeze.
- `server/release/activation-floor.json` selects the new window.
- `tests/daily-engine-maintenance.law.test.ts` pins both entries, the floor and
  the historical bytes.

## What this does not fix

eed06fe5's replacement deadlock (docs/changelog/2026-11-01-eed06fe5-replacement-deadlock.md)
is unchanged: the drained path stays shut while stopped tournaments hold cards in
the air, and the census path fits only within about 35 minutes of an engine
restart. A pass that does not fit refuses before spending a break. Delivery is
claimed only from a sealed serving identity on https://engine.smarter.poker/health.
