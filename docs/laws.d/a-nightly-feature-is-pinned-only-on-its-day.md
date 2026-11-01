# tests/a-nightly-feature-is-pinned-only-on-its-day.law.test.ts

Owner update October 31, 2026: only host-featured events whose start date is today in the viewer's calendar are pinned. Future nightly and weekly editions stay in the normal schedule, even when only one future edition remains or another edition is running. This supersedes the historical weekly-flagship exception. All tournament displays use `src/lib/featuredOnItsDay.ts`; no database flags or records are changed.
