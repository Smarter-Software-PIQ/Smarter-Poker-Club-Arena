# A retired fixture is finished, and a dead rabbit-hunt run is settled from its record

2026-11-08. Follows #9977 (`20261107210316`, installed 00:46 UTC) and the
first Cert Residue Sweep run on it (42431366312, 00:47 UTC), which left
"8 of 10 stale account(s) unrecovered". Every one of the eight was read from
production rows before anything here was written.

## What the sweep found, and what was true

| refusal                                                              | identities | what the rows said                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST_RESET_CERTIFICATION_CLUB_STATE_REFUSED` x5                     | 5          | Crest Cert Template 96bd011b, b3ec63d3, a15f7d9e, 0be5ee41, 79210a6a: `lifecycle_status = 'retired'`, treasury 0, every table closed, every board CANCELLED. Already finished by #9959's history door or by `ui-cert-cleanup`. |
| "Refusing to retire rabbit-hunt certification club ... still active" | 1          | Cert RH 83360371 (8f508869): active, 99,684 chips in the bank, two funded players, 25 hands, its table `Cert RH` open. Run 42411184920 certified every case and then died in cleanup: `CLEANUP FAILED refused while seated`.   |
| `CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY` x2               | 2          | That club's two players: members with 8.05 and 7.95 chips. Custody, correctly refused by the account door.                                                                                                                     |

So there were two causes, not eight.

### 1. The stale sweep asked a door about clubs that were already finished

`retireProductionCreateClubFixtures` only read a fixture as "retained history"
AFTER a door had been asked and had answered one exact refusal
(`RETIREMENT_REFUSAL_CLUB_HAS_HISTORY`, from the deleting door, 2026-10-26).
The five Crest Cert Template fixtures took a different door (the post-reset
welcome door), which refuses a retired club's empty treasury with a different
name, so a finished club was reported as unrecovered on every run.

**Fix.** In a stale sweep, `lifecycle_status = 'retired'` is terminal for every
recognized fixture before any door is asked: the identity is kept as the owner
of record, and the readback still proves the row reads retired and owned by it.
The catch-side special case is gone; a refusal there is a refusal. A live run
(`terminalFixtureOnly`, or the job's own fixture file) still proves its own
clubs through the doors.

### 2. The rabbit-hunt run could not leave its own table, and nothing else could settle its club

`20261107040516` (hit and run, a club setting, installed in the 04:00 window
that morning) makes a cash player in profit owe the club's hand count before
leaving; at a two-seat certification table whose other player has left, those
hands never come, the seat is held and blinded off, and the leave the run sent
was answered `LEAVE_LOCKED needs_confirmation` and ignored. The cleanup then
read a live seat and, correctly, refused to touch anything. The club stayed
active with chips and members, and the stale sweep's rule for an active
'Cert RH' club was "only its own run's cleanup settles it" - a run that no
longer existed.

**Fixes, in `scripts/ci/certify-rabbit-hunt.mjs`.**

- The owner switches hit and run OFF for the certification club through the
  owner's own door (`fn_set_club_hit_run(club, false, 10)`) right after
  creating it, before anyone sits. The club chooses its rule; this club
  chooses none.
- The leave is verified, not sent: after `/leave-occupancy` the run waits up
  to `LEAVE_SETTLES_WITHIN_MS` (60 s) for `table_seats.left_at` to be set for
  both players and records the outcome as a case
  ("both certification players left their seats"), so a seat that will not
  leave is named in the verdict instead of surfacing as a cleanup refusal.
- The cleanup is ONE exported function, `settleRabbitHuntClub`: nobody seated,
  end every open certification VIP grant on a member, return every member
  balance to the club bank (`fn_club_wallet_claim_back`), close the run's
  tables (`fn_execute_managed_game_command`), retire the club with its records
  (`fn_retire_settled_club`); every step reported, nothing thrown past a failed
  step, no account touched. The run's `finally` calls it and then retires its
  three accounts as before.
- `settleStrandedRabbitHuntClub({ clubId, ownerId, isReserved })` rebuilds the
  run's record from the rows - the club row names the owner, `club_members`
  the players, the club's open cash tables named `Cert RH` the run's tables -
  and calls the same settlement as the owner (admin magic-link session, the
  shape the run uses). It refuses, changing nothing, unless the club is an
  ACTIVE 'Cert RH ' club owned by that identity, EVERY member is a reserved
  certification identity, and nobody is seated; it fails if any step fails or
  the club does not read retired afterwards.
- The stale sweep (`production-e2e-account.mjs`) calls it for an active
  'Cert RH' club. The inventory's 162-minute age floor is many times a run, so
  an active club there belongs to a dead run. The players are then ordinary
  zero-balance members of a retired club, which the account door accepts
  since `20261107210316`, and the owner is the owner of record. A live run
  never settles another run's club.
- `cert-residue-sweep.yml` carries the publishable anon key, which the owner
  session needs (the certification workflows already carry it in the clear).

This is the run's own cleanup made restartable from its own record
(CLAUDE.md 10.12), not a repair job: it writes nothing the run would not have
written, through the same doors, as the same owner.

## Pins

- `tests/unit/productionE2EAccount.test.ts`: a retired fixture is kept before
  any door is asked (the 2026-10-26 lobby case no longer reaches a door); an
  active Cert RH club in a stale sweep is settled through the run's cleanup
  and kept as retained history; a settlement that leaves the club active is
  refused by the readback; a refused settlement fails the sweep naming the
  pattern; a live run still refuses to settle a Cert RH club.
- `tests/unit/certifyRabbitHunt.test.ts`: the settlement's doors, in order,
  as the owner, touching no account; a live seat refuses everything before
  any door; a refused retire is not settled; the stranded settlement refuses a
  non-active, foreign-owned or differently named club after one read, refuses
  any member outside the reserved namespace before reading tables or calling
  any door, and names its missing credentials; the run switches hit and run
  off before anyone sits and waits for the seats to leave.

## Settlement of what was left

After this merges, one Cert Residue Sweep run is dispatched by hand. Expected:
the five retired Crest Cert Template owners and the two retired Cert RH
owners kept as owners of record (7), club 8f508869 settled (16.00 back to its
bank, table closed, retired) and its owner kept as owner of record, its two
players retired through the account door. The result is read from the run
and from `fn_ca_stale_certification_accounts`, and recorded in the PR.
