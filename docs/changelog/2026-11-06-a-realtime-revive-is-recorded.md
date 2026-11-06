# A Realtime Revive Is Recorded

The resume probe from #9645 forces a dead realtime socket back the moment a player returns to the page, but it reported each revive only to the browser console. On 2026-11-06 at 10:20 UTC production held no record that it had ever fired, and the transport loss rate in client_error_events could not show it either, because a forced reconnect files the same visible channel error as an organic drop.

Each forced reconnect is now measured from the moment the page came back to the first channel joined again (src/lib/realtimeTransportLoss.ts, already in the entry chunk) and written once per ten minutes per player to client_realtime_revivals (migration 20261106102321) from the lazily loaded liveness module. A forced reconnect with no join within two minutes is written as rejoined false. v_realtime_revival_daily reports revives, rejoins, players and gap p50, p95 and max per day and reason. A transport loss filed within five seconds of a forced reconnect now carries forcedByLiveness so the two can be told apart.

Proof: tests/unit/aRealtimeReviveIsRecorded.test.ts, tests/a-realtime-revive-is-recorded.law.test.ts, scripts/ci/test-realtime-revive-is-recorded.py.
