# The Phase 1 customization certificate runs its own journey (2026-11-15)

## What failed

Post-Deploy E2E 43635213490, 43643304336 and 43652573106: the step "Did every Phase 1 customization journey pass exactly?" answered NON-VERDICT, "gameplay-customization-runtime.json did not contain its one exact first-attempt pass", and the next step, "Classify the Phase 1 customization certificate", then failed with "Phase 1 customization coverage was missing or incomplete".

## Cause

`tests/e2e/gameplay-customization-runtime.spec.ts` gained a second case on 2026-11-11 (#10466, the published hero showdown celebration). The Phase 1 sweep ran the whole file, so the report held two specs. The coverage contract accepts exactly one spec per journey on purpose (an extra spec is refused), so it could not certify, whatever the two cases did:

- 43643304336: both cases passed on their first attempt.
- 43635213490 and 43652573106: the celebration case failed, because ca-static's build-info was already ahead of the job's `LIVE_SHA` (a release-identity mismatch inside the long sweep). The contracted journey is not that case.

The independent review of #10889 found this: the failure was not downstream of the cashier or Lightning failures.

## Change

- The sweep runs the contracted gameplay journey by its own describe (`--grep=production.routed.gameplay.customization.mobile.table.art`; dots stand for spaces because `run_suite` word-splits its flags), inside the Phase 1 bracket. The coverage contract is unchanged and still refuses an extra spec.
- The celebration case keeps running on every publication: its own `run_suite` right after the bracket, its own report `gameplay-hero-celebration.json`, listed with the reports the run must have executed, and its failure still fails the sweep. Because a skipped case exits 0 and the shared executed-reports check counts by spec file, its report is also checked alone right after its run (`assert-e2e-actually-ran.mjs`), so a skip fails the sweep too. (The separate `hero-celebration-proof` job is dispatch-only and nothing sends its event, so it could not stand in; the first version of this change wrongly relied on it and the independent review refused that.)
- Not changed: the celebration case's own release-identity race. When it fails for that reason it stays red and visible; it no longer blocks the Phase 1 certificate, which was never about it.

## Verified

- `playwright --list` with the workflow's flags selects exactly the contracted case (1 test in 1 file).
- `tests/unit/phase1CustomizationCertificateCoverage.test.ts` reads the grep from the workflow, applies it to every case title in the spec file, and requires exactly the contracted journey. It requires the second suite to select exactly the other case, to run after the bracket, to fail the sweep on failure and to be in the executed-reports list.

## Limits

The live proof is the next Post-Deploy E2E client run.
