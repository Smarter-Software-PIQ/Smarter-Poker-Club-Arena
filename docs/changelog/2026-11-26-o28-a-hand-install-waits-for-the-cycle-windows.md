# O28: A Hand Install Waits For The Same Windows As The Dispatcher

Date: 2026-11-26 (Chicago). Lane: release custody (engine cutover every three hours).

## Why It Could Break

The merge dispatcher holds an ordinary migration through `[cycle - 150 m, cycle + 10 m)` of every non-04:00 three-hourly cycle (O21, `scripts/ci/merged-migration-dispatch.mjs`). The applier, `scripts/ci/apply-recorded-migration.mjs`, enforced only the nightly 23:45 to 04:15 Chicago freeze (`#11906`). A hand dispatch of Apply Merged Migration at 11:40 Chicago was admitted, 50 minutes before the 13:00 cycle's 12:30 cutoff. Production then held a migration the certifying copy lacked, the soak in flight yielded (O16) and the cycle kept serving. The nightly version of this exact gap cost the 04:00 cutovers of 2026-11-21 and 2026-11-22.

## How It Was Fixed

`releaseFreezeAdmission` in `scripts/ci/release-freeze-admission.mjs` now also asks the dispatcher's own `threeHourlyDeferralWindow`. Inside a cycle hold a hand install is refused before any connection opens, with nothing sent, and the refusal names the cycle and the instant the dispatcher sends held files. The existing exceptions are unchanged: a dry run, the maintenance-window route, the dispatcher's proven job-token send (not enforced), and `release_freeze_override` with at least 20 characters naming an outage.

The cadence comes from `server/src/maintenance/maintenanceSchedulePolicy.json` at the revision the applier runs from. Only an explicit `daily` lifts the cycle hold. A policy that cannot be read holds, because "could not tell" is not "daily".

The applier file itself is unchanged, so its reviewed source bindings stand.

## Why Not A Database Trigger

The database guard from `#11906` cannot tell one repository's DDL from another's. World Hub shares the migration history and its migrations do not stale a Club Arena copy (O23). A trigger covering every cycle would refuse that lane's installs for all but 135 minutes a day and protect nothing here. The applier is the only route by which a Club Arena migration is installed, so the rule lives there.

## What Stops It Returning

`tests/a-hand-install-respects-the-release-freeze.law.test.ts`: the refusal at the first and last held minute of a cycle; minute by minute over a winter day and the spring-forward day the applier admits exactly when the dispatcher's two predicates admit (135 minutes); the three exceptions; `daily` lifts and `unknown` holds; and the real applier process is refused inside a hold and continues in an open window.

## Verification

- Targeted law run: 10 of 10 pass, with `tests/the-release-freeze-refuses-ddl-from-every-repo.law.test.ts` 5 of 5.
- Live proof: pending the first hand dispatch inside a cycle hold. None is expected in normal operation.
