# release / window-install skipped on release-control change

Read 2026-11-12 ~09:50Z (PRIMARY, cloud). No `operational_alert_events` row exists: unrouted failure.

| Date  | Reservation run | Detect `cutoff` step | Installer job |
|-------|-----------------|----------------------|---------------|
| 11-10 | 42756607383 | failed 09:30Z: "Release controls changed during reservation; keep serving." | skipped |
| 11-11 | 42959839523 | failed, same message | skipped |
| 11-12 | 43155291080 (head `bb384e808`) | failed 09:30:01Z (controls changed by #10574/#10576) | job 131093400494 skipped |

Run 43176863010 (07:39Z dispatch, `cc07c1ae6`) detect succeeded, but it was not that date's daily
preparation, so the installer was skipped there too.

Not installed in `supabase_migrations.schema_migrations` at 09:47Z: `20261110003726`, `20261110054654`,
`20261110173033`, `20261110214134`, `20261111174148`.

Root cause: `window-migrations.if` required `needs.detect.result == 'success'`, so the engine-authority
refusal in `cutoff` (correct) also skipped the database installer (no engine authority).

Proof: `npx vitest run tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts` -> 20/20 with the
fix; 2 failed with only the workflow change reverted. Neighbouring suites
(`a-backup-copy-is-certified-by-what-it-holds`, `a-window-migration-waits-for-the-daily-break`,
`the-break-clocks-agree`) fail 5 identical cases on unmodified main in this sandbox (shallow history), and
the same 5 with this change.
