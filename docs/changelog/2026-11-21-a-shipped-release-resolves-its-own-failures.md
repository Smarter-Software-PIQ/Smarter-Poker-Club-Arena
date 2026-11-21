# A shipped release resolves its own failures (incident 484c4cee, 2026-11-21)

`EngineReleaseFailed` fired at 00:19 UTC for run 44841264851 (target
`e2140d2d`, stage prepare) while sibling run 44841245126 had already sealed the
same SHA. Two lanes fixed the causes: #11558 (a second owner-window dispatch
joins the offer dedupe) and #11579 (an exact already-released redelivery
proves already-released instead of failing on the pruned rollback image).

What was left: the failure fingerprint is per run, so nothing ever resolved
it, and the critical incident stayed escalated with the engine it complained
about already serving (and a later release, 44863049588, shipping cleanly).

Fix at the source: `scripts/ci/record-engine-release-alert.mjs` reads the
append-only `ca_engine_deploy_attempts` receipts before raising. When another
run already shipped this exact SHA, a failed redelivery raises nothing and
names the shipped run (`shippedSibling`). Resolution of earlier failures by a
later verified ship landed in parallel in #11630 (`buildReleaseResolvedAlerts`),
so the database trigger first drafted here was dropped to keep one resolver.

The open alert for `e2140d2d` was resolved through `fn_record_engine_alerts`
with the evidence above.

Pinned in `tests/engine-release-pipeline-hardening.law.test.ts`.
