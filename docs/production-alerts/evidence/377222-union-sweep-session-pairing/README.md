# 377222: union sweep counts a session whole

Read on production `kuklfnapbkmacvwxktbh` on 2026-11-12 between 21:45 and 22:00 UTC. All reads were read-only SELECTs. There was no DDL and nothing was written, except the fleet's own `operational_alert_events.investigation` field.

## Live function
- `md5(pg_get_functiondef('public.fn_union_integrity_sweep(uuid,integer)'))` is `2d206e82cdc6c2459621ace94808eae6`. This equals the `@live-proof` of `20261022062934`.
- Owner `postgres`, `SECURITY DEFINER`, `search_path=public`.
- ACL: `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`.
- No installed function pins this md5. A `prosrc` scan for the hash found 0 functions, so the stale-pin guard has nothing to move.

## Derived postimage
- The `replace()` of anchor A (the `net` head) and anchor B (the `net` tail plus the `rake AS (` opener) was computed on production with a SELECT.
- Each anchor occurs exactly once.
- `md5(postimage)` is `93765162c4d5e216947137b27862446f`.

## Behaviour
The window is that of 377222: `v_from` = 2026-11-11 19:33 UTC. The old and new `net` CTEs were run side by side as SELECTs.

| agent | old net | new net |
|---|---|---|
| 47965354 | 568.39 | 568.39 |
| 7e616640 | 155.38 | 115.38 |
| c9b675bc | -1.63 | -1.63 |
| 6b0f6365 | -15.00 | -15.00 |
| a9299039 | -94.65 | -94.65 |
| b3d6ceef | -136.00 | -136.00 |
| 9ca264f1 | -423.91 | -423.91 |

Only agent `7e616640` changed. Its net drops by exactly the 40.00 buy-in of tournament `12ef2263`.

The new rule was tightened after a first, broader draft, which counted every pre-window row of a session that had an in-window row. That draft moved owner-agent `47965354` to -3431.61. It did so by pulling in about 4,000 of debits from player `69f2cefa`'s open session on table `8aea2cc5`, which has no in-window cashout. Under the final rule, a pre-window debit is admitted only beside an in-window credit of the same session.

## Hardening
1. **Regression test:** `tests/the-union-sweep-counts-a-session-whole.law.test.ts`. It fails on pre-fix `main`, because neither the migration nor its pairing logic exists there, and it passes with the fix. Registered in `docs/laws.d/`.
2. **Invariant:** the sweep's `net` is computed per session in the database function itself.
3. **Detector:** `fn_union_integrity_sweep` still writes `financial_alerts`. Those rows are mirrored into `operational_alert_events` with `payload.target_task_id`, as row 377222 shows. A future window-edge inflation would surface as a new row whose net can be re-paired by hand.
4. **CI gate:** the test lives in `tests/`, which the Client Unit Tests shards run on every pull request.
