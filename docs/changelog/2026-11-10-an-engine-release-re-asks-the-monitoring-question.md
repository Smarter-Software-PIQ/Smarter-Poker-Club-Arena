# An engine release re-asks the monitoring question (2026-11-10)

`deploy-monitoring.yml` refuses rules whose metric only a newer engine emits. Engines release once a day, so this refusal is routine, and it is correct. Before this change, though, the refusal only cleared when some later push happened to touch `infra/monitoring`. On 11-09/10 that was 9.5 hours after the engine had already caught up.

The workflow now also runs when a successful Engine Release or Engine Withdrawal completes. That run converges on current main, so the verdict closes the episode from evidence instead of waiting for an unrelated push.

The refusal text now names the 04:00 America/Chicago window instead of the retired :55 break.

- Law: `tests/an-engine-release-re-asks-the-monitoring-question.law.test.ts`
- Evidence: `docs/production-alerts/evidence/monitoring-deploy-failed-a09be630/`
