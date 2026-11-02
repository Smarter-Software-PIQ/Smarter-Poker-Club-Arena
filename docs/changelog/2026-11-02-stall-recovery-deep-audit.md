# Recovery reporting deep audit

The final two-hand recovery path still accepted missing uptime as healthy, and
could resolve a disappeared table during maintenance using hands recorded just
before the pause. Both failures were reproduced through the maintained ingest
in private PostgreSQL 17.

The original parser now requires complete, valid, single-instance telemetry
witnesses before any observation transition. Missing, malformed or duplicate
witnesses use the existing failed-observation path. A bounded maintenance pause
cannot certify recovery. No scheduler, game repair, money path or historical
episode is changed.

The existing required shard-7 PostgreSQL gate now exercises the final body for
absent, foreign, old, future and malformed hand evidence; the exact freshness
boundary; incomplete and ambiguous telemetry; standby, boot and maintenance;
all six intended-wait classes and duplicate observations; successful sustained
dealing; and atomic migration replay refusal. The two reproduced failures remain
explicit counterfactual checks against the earlier body.

Delivery requires protected merge and Apply Merged Migration, followed by exact
installed-source readback and a live rollback check. This is an audit correction
to Phase 1; it does not certify the stalled-game repairs assigned to Phase 2.
