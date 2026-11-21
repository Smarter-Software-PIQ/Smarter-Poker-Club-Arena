# A shipped release resolves its own failures (incident 484c4cee, 2026-11-21)

`EngineReleaseFailed` fired at 00:19 UTC for run 44841264851 (target
`e2140d2d`, stage prepare) while sibling run 44841245126 had already sealed the
same SHA. Two lanes fixed the causes: #11558 (a second owner-window dispatch
joins the offer dedupe) and #11579 (an exact already-released redelivery
proves already-released instead of failing on the pruned rollback image).

What was left: the failure fingerprint is per run, so nothing ever resolved
it, and the critical incident stayed escalated with the engine it complained
about already serving (and a later release, 44863049588, shipping cleanly).

Fix, at the source and at the fact:

- `scripts/ci/record-engine-release-alert.mjs` reads the append-only
  `ca_engine_deploy_attempts` receipts before raising: when another run
  already shipped this exact SHA, a failed redelivery raises nothing and names
  the shipped run (`shippedSibling`).
- `20261121151027_a_shipped_release_resolves_its_own_failures`: a shipped
  receipt (AFTER INSERT, `shipped = true`) resolves every `EngineReleaseFailed`
  whose latest event is still firing for that exact SHA, through
  `fn_record_engine_alerts`, naming the run that shipped it. An alerting error
  never refuses the receipt. Probed on production in a self-aborting block.

`auto-deploy-hetzner.yml` (release-custody area) is unchanged. The open alert
for `e2140d2d` was resolved through the same door with the evidence above.

Pinned in `tests/engine-release-pipeline-hardening.law.test.ts`.
