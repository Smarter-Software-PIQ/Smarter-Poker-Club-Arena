# 2026-11-28: the seat-move proof names every build change

Post-Deploy E2E run 46145685859 failed the seat-move notice proof because a publish landed mid-proof
and the first build re-read still used a bare `toEqual`. Both re-reads now go through
`requireSameBuild()`, which throws `PRODUCTION_ADVANCED_DURING_PROOF`, the marker the workflow step
already classifies as a non-verdict when the release window confirms a forward publish. Pinned in
`tests/a-short-phone-keeps-an-absolute-avatar-floor.law.test.ts`. Evidence:
`docs/production-alerts/evidence/450102-seat-move-build-advance/README.md`.
