# The Lightning handoff trigger reaches its Lightning branch (2026-11-11)

Reliability incident ee77584d-da8d-4535-ad86-e27c5a2e8b35,
`LightningHandHost.post_commit_obligations_pending`, table 0f84a1ab:
79 occurrences, 6 recurrences, escalated to AI AGENT NEEDED.

20261110234927 taught `fn_post_commit_handoff_is_a_warning()` to downgrade a
Lightning `predecessor_pending` handoff to a warning when the hand carries a
durable `post_commit_payload`. It installed and never fired once: trigger
`a2_post_commit_handoff_is_a_warning` was created by 20261105174016 with
`WHEN (new.source = 'ServerTableEngine.post_commit_obligations_pending')`, so
Postgres never called the function for the Lightning source.

Measured on production 2026-11-11 13:30Z: all 10 Lightning rows in the last 12
hours were critical with no `reclassified` key. Each of the 9
predecessor_pending rows had exactly one `hand_atomic_commits` row with a
payload, which is the exact shape the branch downgrades, and the projection
worker completed every one.

Migration 20261111133739 widens the WHEN clause to both sources and nothing
else. Timeouts, LIGHTNING_HAND_IN_PROGRESS, lookup and scan failures, and a
handoff with no durable envelope all still page critical. So does
post-commit-stranded-watchdog-5m. The new law
`tests/a-handoff-trigger-reaches-every-source-its-function-names.law.test.ts`
fails the build if the trigger stops admitting a source the function names.
