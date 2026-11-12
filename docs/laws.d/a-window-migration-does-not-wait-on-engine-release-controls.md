# tests/a-window-migration-does-not-wait-on-engine-release-controls.law.test.ts

The daily window-migration install in stage-engine-release.yml runs whenever its reservation reached the cutoff, admission is allowed and a window commit is bound, even when the engine path refused because release controls changed during the reservation (2026-11-10 and 2026-11-11 skipped every queued daily-maintenance migration that way); the engine selection and signal jobs never read that commit and keep their exact cutoff, refusal and protected_sha.
