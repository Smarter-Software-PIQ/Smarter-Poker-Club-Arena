# Refused Calls That Can Never Succeed Are Not Sent (2026-11-26)

Three retry storms against PokerIQ-Production in the 24 hours to 2026-11-26
21:45 UTC, all around certification fixture clubs and retired clubs. Each was
read from the rows and the logs before anything changed.

## 1. `cleanup_reserved_certification_account` refused 160 times

- Signature: `POST /rest/v1/rpc/cleanup_reserved_certification_account` 500,
  Postgres `CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY` (SQLSTATE 55000,
  function line 194), 160 times from 22:32 UTC Nov 25 to 21:38 UTC Nov 26.
- Callers: GitHub and AWS CI runners (UA `node`), never the engine. Two to four
  refusals per run, in two shapes:
  - the stale-account sweep inside every Club Create Certification
    (`cleanupStaleProductionE2EAccounts`) asked the door about the same four
    identities on every run: 819bd2ec, 7ab530c9, d8325c9f and f136f2af, the
    players of the completed heads-up matches of retired fixtures
    `Cert HU 61667112` and `Cert HU 58868468`;
  - the heads-up rematch certificate's own cleanup asked the door about its two
    new players on every run.
- Why it can never succeed: each identity holds a `tournament_players` row of a
  COMPLETED game of a retired club. That row is immutable history and the door
  refuses any identity with a tournament entry. The 2026-11-25 change
  (`participantOfRetiredFixtureHistory`) kept such a player correctly, but only
  AFTER the door had refused, so the refused call was sent on every run for
  ever.
- Fix: `provenPlayerOfRetiredFixtureHistory` runs the same row-by-row proof
  BEFORE the door, in the stale sweep and in the heads-up cleanup. A proven
  player is kept without the call. A proof that fails or cannot be read leaves
  the door to decide, exactly as before; keeping writes nothing.
- Pinned: `tests/unit/productionE2EAccount.test.ts` (the door is asked zero
  times for a proven player, on every run; an unreadable proof still reaches
  the door; the heads-up script proves before it asks).

## 2. `PATCH tournament_schedule_spawns` refused 133 times

- Signature: `PATCH /rest/v1/tournament_schedule_spawns?spawn_key=eq.979a36e8-a3f6-4d18-91f0-ab30a4d6e59c:2026-10-13:01:00&tournament_id=is.null`
  500, `CLUB_RETIRED: gameplay and cashier records are read-only`
  (`fn_guard_retired_club_mutation` line 173), every ten to eleven minutes,
  133 times. One spawn key, nothing else.
- Writer: the engine's orphan spawn claim sweep
  (`server/src/services/orphanSpawnClaims.ts`, `sweepOrphanSpawnClaims`), not
  the spawner and not the INSERT path the 2026-11-25 stand-down covered. The
  claim is a Diamond Arena "Diamond Bounty Hunt 1000" claim from 2026-10-07
  whose back-link was lost; it has exactly one matching (COMPLETED)
  tournament, so the sweep decided "link". The Diamond Arena was retired on
  2026-11-06, and a retired club is read-only, so the guard refused every link.
- No retired club has an active schedule (179 retired-club schedules, all
  inactive), so the spawner itself materializes nothing for retired clubs.
- Fix: the sweep reads each claim's schedule club and sends no write (link or
  release) for a claim whose club is retired, or whose club cannot be read.
  Counted as `readOnly`. Engine code: ships with the next certified cutover.
- Pinned: `server/src/services/aStuckSpawnClaimRepairsItself.law.test.ts`
  (a retired club's claim is never written across six sweeps; nor released;
  an unreadable club sends nothing; a live club still has its link restored).

## 2b. `tournaments_club_id_fkey` 12 times: an expected one-shot race

`fn_create_seat_first_game_atomic` from the engine (Hetzner), 409, 12 times.
The Spin/SNG board read the fixture club as active, and the certification
cleanup deleted that club before the insert. `createSeatFirstGameAtomic`
already holds the owner out for an hour after the first such refusal
(`BOARD_OWNER_GONE_BACKOFF_MS`, 2026-10-02/03), so each deletion costs one
refusal, not a retry. No change.

## 3. `CERT_FIXTURE_BEING_RETIRED` about 90 times: the designed stand-down

The 23505 stand-down from `20261125022315` on the spawn claim INSERT, one per
occurrence per poll while a fixture's retirement holds its club row. Every
sampled schedule appears for at most two consecutive minutes and no longer
exists now: the retirements completed, none is stuck. No change.
