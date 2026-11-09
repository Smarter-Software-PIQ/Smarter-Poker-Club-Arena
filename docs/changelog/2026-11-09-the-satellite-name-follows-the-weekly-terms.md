# 2026-11-09 - A satellite's name follows the weekly terms

Follow-up to `2026-11-08-satellites-are-named-for-the-event-they-feed.md`.

Found live: the first two Midway weekly satellites spawned after the rename
installed were stored with the catalog's old names:

- `7ada69f5` (02:02:09Z) "40 Chip Bounty Freezeout - 0 GTD (NLH) Satellite 5"
- `f7f3b7dd` (02:15:05Z) "Sunday Deep Stack Satellite 30"

Cause: on INSERT, `tournaments_creation_guard` replaces the row with the Midway
weekly catalog's terms (`NEW := jsonb_populate_record(NEW,
fn_ca_midway_weekly_terms(NEW.schedule_id))`), name and short description
included. Triggers of one kind fire in name order, and the copy trigger
`ac_tournament_copy_never_says_zero_guarantee` sorts before the guard, so its
work was overwritten. The 109 rows renamed at install were UPDATEs, which the
guard does not touch, and non-catalog satellites were never affected.

Fix (`20261109023856_the_satellite_name_follows_the_weekly_terms.sql`): the
same copy function also runs on INSERT from
`tournaments_d_copy_follows_the_weekly_terms`, which sorts directly after the
creation guard. The two rows (no registrants) are corrected once through the
edit the lifecycle guard already admits; any other open satellite still not
named for its target is corrected the same way. Probed in a self-aborting
transaction: they become "Satellite Into 40 Chip Bounty Freezeout (NLH)" and
"Satellite Into Sunday 200 Deep Stack".

Spawner dedupe was checked first: no live schedule holds two open events at one
start time, so a renamed event is never re-spawned.

Law: `tests/a-satellite-name-survives-the-weekly-terms.law.test.ts`.
