# Keep the cash-statistics fixture inside its real rolling window

Required accounting job 125022892392 failed at 2026-11-02T00:03:19Z because
the fixture's fixed October 3 hand had aged outside the actual 30-day UTC
window beginning October 4. The aggregate correctly returned one fewer exact
hand and three-bet opportunity/action; its existing assertions require the
original three exact hands and two opportunities/actions.

Only the isolated fixture clock changes. Capture `now()` once in a session
setting and use that unchanged JSON-text timestamp for all v2/v1 payloads.
This retains identical timestamps across the fixture's separate statements,
so changed-stack and replay assertions continue to isolate their intended
cause. No outer transaction is added, no assertion is changed, and the real
calendar window, financial inputs, production SQL and authorization remain
unchanged. Existing qualification uses its own disposable PostgreSQL17 cluster.

The last comparable successful job, 125007559895 at 2026-11-01T23:01:55Z,
ran the exact same original fixture blob 20dc6c962e6a2382fb40e02018cdcce6cd433032.
After the date boundary, job 125022892392 failed that fixture's existing
aggregate assertion. No fixture input changed between those results.

Local PostgreSQL 17.11 qualification passed through the unchanged maintained
`scripts/dev/test-stats-cash-opportunities-postgres.sh` runner, including all
projection/conflict/privacy/pagination/aggregate assertions. Only its supported
scratch-parent setting changed to the external shared-capacity volume; the
runner creates and removes its own unique fixture directory. The first startup
attempts reached no SQL because their long external socket path exceeded
macOS's 103-byte limit; retained PostgreSQL diagnostics establish that cause.
The successful native run used original PostgreSQL binaries with a 101-byte
socket path and no wrapper. No production database or provider state changed.
