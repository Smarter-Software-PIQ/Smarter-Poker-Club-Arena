# Row 371597, item 6: catalog-observers waits on a relation the page no longer reads

## Failure

Post-Deploy E2E run 43240776206, job 131261062476 (client 170b25e4b, 2026-11-12):
`[chromium] tests/e2e/routes/catalog-observers.spec.ts:26` fails with
`TimeoutError: page.waitForResponse: Timeout 90000ms exceeded` at
`catalog-observers.spec.ts:39:22`, the wait for the selected event's standings.
The same failure appears in run 43210315096.

## Root cause

#10272 (`cc77b7d9c`, 2026-11-10) moved `readTournamentStandings` from the base table
`tournament_players` to the public view `tournament_players_public`. That fix was correct: the view
keeps closed accounts' placements. `TournamentResultsPage`'s `loadResults` reads standings
through that helper, so clicking a completed event issues
`GET /rest/v1/tournament_players_public?tournament_id=eq.<id>`. The spec still waited for
`/rest/v1/tournament_players`, which the page never requests, so the test waited out its full
90 s budget. The page is correct and the witness is stale.

## Fix

Both standings waits in the spec now name `tournament_players_public` through one constant.
No product code changes.

## Hardening

- **Regression law:** `tests/catalog-observers-wait-on-the-relation-the-page-reads.law.test.ts`.
  Every relation the witness waits on must be the relation its loader reads (`.from('...')`), and the
  standings waits must name the relation `readTournamentStandings` reads.
  - **Pre-fix:** fails with "waits on tournament_players, which no known loader reads".
  - **Post-fix:** passes. `law-registry` passes, 1509 tests.
- **Invariant:** the witness/loader relation contract above. A loader that changes its relation must
  move the witness in the same commit.
- **Detection:** existing Post-Deploy E2E routing to `operational_alert_events`
  (`club-arena.post-deploy-e2e`, `target_task_id` set).
- **CI gate:** Client Unit Tests runs `tests/**/*.law.test.ts` on every PR.

## Local output

Post-fix:
```
 Test Files  2 passed (2)
      Tests  1509 passed (1509)
```
Pre-fix (spec reverted to main):
```
     × every waited relation is read by its loader, and every standings wait names the view 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/catalog-observers-wait-on-the-relation-the-page-reads.law.test.ts > catalog observers wait on the relation the page reads > every waited relation is read by its loader, and every standings wait names the view
AssertionError: tests/e2e/routes/catalog-observers.spec.ts waits on tournament_players, which no known loader reads: expected undefined to be defined
     54|       expect(loaders, `${SPEC} waits on ${relation}, which no known lo…
      Tests  1 failed | 1 passed (2)
```
