# 450102: seat-move proof reported a mid-proof publish as a defect

- Alert: `operational_alert_events` 450102 (`PostDeployVerificationIncomplete`, kind `failed-release`,
  head 2c9335f490cbb96a008dcd537aa2993ff35c5a54), episode row 371597.
- Run 46145685859, job 140981586336, step "Verify seat-move notices in the served spectator browser".
- Failure: `tests/e2e/production-seat-move-announcement.spec.ts:429`
  `expect(evidence.after).toEqual(evidence.before)`. Expected ca_sha aaeead9bb / run 46147519331,
  received 51b966e26 / run 46148291483: a protected publish landed in the 9 s the proof ran.
- Root cause: the 2026-11-19 fix gave the SECOND build re-read (after the synthetic diagnostic) the
  `PRODUCTION_ADVANCED_DURING_PROOF` marker that the workflow step classifies, but left the FIRST
  re-read as a bare `toEqual`. A publish during the first stage therefore reached `exit "$STATUS"`
  as a failure instead of the release-window non-verdict branch.
- Fix: one `requireSameBuild()` helper; both re-reads go through it.
- Regression: `tests/a-short-phone-keeps-an-absolute-avatar-floor.law.test.ts`, new case
  "every re-read of the build identity after the first goes through the named check". Fails on
  `origin/main` 65a64d1f6 (AssertionError: not to match /toEqual\(evidence\.before\)/), passes with
  the fix (10/10), vitest 4.0.18.
- The step itself is unchanged: single attempt, classifies only on marker plus a confirmed forward
  publish (`production-e2e-provenance.mjs release-window` exit 3). A real defect still fails.
