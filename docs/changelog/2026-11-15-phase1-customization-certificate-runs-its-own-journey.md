# The Phase 1 customization certificate runs its own journey (2026-11-15)

## What failed

Post-Deploy E2E 43635213490, 43643304336 and 43652573106: "Classify the Phase 1 customization certificate" answered NON-VERDICT, "gameplay-customization-runtime.json did not contain its one exact first-attempt pass".

## Cause

Nothing failed in the product. `tests/e2e/gameplay-customization-runtime.spec.ts` gained a second case on 2026-11-11 (#10466, the published hero showdown celebration). The Phase 1 sweep ran the whole file, so the report held two first-attempt passes. The coverage contract accepts exactly one spec per journey on purpose (an extra spec is refused), so it could not certify. The independent review of #10889 found this: the failure was not downstream of the cashier or Lightning failures.

## Change

The sweep runs the gameplay journey by its own describe (`--grep=production.routed.gameplay.customization.mobile.table.art`; dots stand for spaces because `run_suite` word-splits its flags). The coverage contract is unchanged and still refuses an extra spec. The celebration case is not dropped: it already has its own job, config (`playwright.hero-celebration.config.ts`) and report (`hero-celebration.json`).

## Verified

- `playwright --list` with the workflow's flags selects exactly the contracted case (1 test in 1 file).
- `tests/unit/phase1CustomizationCertificateCoverage.test.ts` reads the grep from the workflow, applies it to every case title in the spec file, and requires exactly the contracted journey; it also requires the celebration job to exist.

## Limits

The live proof is the next Post-Deploy E2E client run.
