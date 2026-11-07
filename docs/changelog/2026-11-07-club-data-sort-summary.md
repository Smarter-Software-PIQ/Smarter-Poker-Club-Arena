# Keep verified Club Data totals when sorting its games

Changing to Highest Fee repeated the complete summary and hand-count scans beside the ranked games query. Production run42323640109 returned SQLSTATE57014 from snapshot_v2 on both reads; its screenshot correctly showed a ledger failure. A bounded read-only plan measured the summary scan at7.275seconds, nearly its8second production limit.

A sort-only transition now retains the immediately preceding verified summary for the exact signed-in user, club, range and filters, while still fetching and validating the authenticated ranked game page. Initial loads, changed scopes, Most Recent, manual refresh, realtime and recovery heartbeat keep their complete authoritative snapshot reads. Identity changes and new full reads retire the summary handoff. No fake rows, changed dates, relaxed assertions or new timed cache.

The component regression fails before the change on the duplicate snapshot call, then passes while proving the ranked request, its pagination and a fresh manual summary read. Existing stale response, scope, empty and failure coverage remains active.
