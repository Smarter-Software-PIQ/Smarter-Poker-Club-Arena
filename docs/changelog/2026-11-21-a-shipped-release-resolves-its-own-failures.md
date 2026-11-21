# A shipped release resolves its own failures (incident 484c4cee, 2026-11-21)

`EngineReleaseFailed` fired at 00:19 UTC for run 44841264851 (target
`e2140d2d`, stage prepare) while sibling run 44841245126 had already sealed the
same SHA. Two lanes fixed the causes: #11558 (a second owner-window dispatch
joins the offer dedupe) and #11579 (an exact already-released redelivery
proves already-released instead of failing on the pruned rollback image).

What was left: the failure fingerprint is per run, so nothing ever resolved
it, and the critical incident stayed escalated with the engine it complained
about already serving (and a later release, 44863049588, shipping cleanly).

Fix: `scripts/ci/record-engine-release-alert.mjs` now also runs for a shipped
release (`auto-deploy-hetzner.yml`), reads every `EngineReleaseFailed` still
firing for that exact target SHA and resolves each through
`fn_record_engine_alerts`, naming the run that shipped it. A failure for any
other SHA is left firing. The open alert for `e2140d2d` was resolved with the
same door and evidence.

Pinned in `tests/engine-release-pipeline-hardening.law.test.ts`.
