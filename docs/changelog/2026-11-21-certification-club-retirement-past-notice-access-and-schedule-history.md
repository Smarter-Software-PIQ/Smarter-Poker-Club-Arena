# Certification clubs retire past their notice-access row and their cancelled schedule boards (2026-11-21)

Cert Residue Sweep run 44846022061 (00:46 UTC) recovered 13 stale certification
identities, then failed on the two leaked Crest Cert fixtures of 2026-11-17.

## Preset Crest Cert 179495002644 (67f8f585): the notice-access foreign key

`fn_ca_retire_certification_club` deleted the club while one
`club_notice_access_events` row still named it (NO ACTION foreign key):
`23503 ... club_notice_access_events_club_id_fkey`. That row is a projection of
who may read the club's notices, written for the owner at creation and
re-published when members are removed, so every certification club created
since the projection started writing is undeletable by this door. It is also
why the 2026-11-17 run's own cleanup failed and the two fixtures leaked.

Fix: migration `20261121005200` deletes the club's projection rows immediately
before `DELETE FROM public.clubs`, after the members. Every proof in the door is
unchanged. Proved in a rolled-back transaction on production: the live door
raised 23503 on 67f8f585; the patched copy returned success and the club was gone.
No hot-table lock (a function body only; an `ON DELETE CASCADE` foreign key
would lock `public.clubs`).

## Crest Cert 1794950026440-vqxq6 (aa090f23): cancelled boards are history

Its welcome schedule spawned a board every day. Three were cancelled with
immutable exact-zero escrow receipts; three are still open with no entries.
The deleting door's schedule preparation reads any escrow row as activity and
refuses `WELCOME_CERTIFICATION_SCHEDULE_FIXTURE_HAS_ACTIVITY` for ever. That is
exactly the case `fn_ca_retire_stale_welcome_fixture_with_history` exists for:
it re-proves no seat, entry or hand and that every cancellation moved nothing,
then retires the club through the owner's retained-record door.

Fix: `retiresThroughHistoryDoor` in `scripts/ci/production-e2e-account.mjs`
now also routes that refusal of a stale fixture (never the run's own template)
to the history door.

The new spawn gate from #11549 stops further boards for leaked fixtures.

Tests: `tests/unit/certificationClubRetirementNoticeAccess.test.ts`,
`tests/unit/staleWelcomeFixtureHistoryDoor.test.ts`.
