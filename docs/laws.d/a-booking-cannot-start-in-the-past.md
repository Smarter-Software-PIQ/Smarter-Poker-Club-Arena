# tests/a-booking-cannot-start-in-the-past.law.test.ts

Dan, 2026-11-07: an owner maintenance window cannot merge after its own `playerNoticeAt`. `scripts/ci/check-owner-window-notice-after-merge.mjs` (CI, TypeScript compilation and repository checks, full history) judges each window against the first commit on main that added it, or against now for a window this change is booking; a certified recovery window and windows main held before 2026-11-08 02:00 UTC are exempt. Enforced at merge, not in the certified release transaction.
