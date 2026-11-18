# 371597 item 2: member Player Record caption expected Overall

Alert: `operational_alert_events` row 371597 (`club-arena.post-deploy-e2e`, critical).
Run 43210315096 on `7608c4721`, job 131156857551: `production-club-members.spec.ts`
"wires the live Player Record and Statistics subpages without unsafe writes" read the
`Displayed Activity Scope` caption as `Showing 2026-11-12 To 2026-11-12 Chicago Time`
where the spec expected `Recorded Activity`.

## Root cause

#10579 (`925889971`, owner direction 2026-11-11) made every visit to the member Ledger
Window open on today's Chicago day (`useState(() => lastDaysRange(1))`, mode `custom`)
instead of Overall. It added new today-range assertions to the spec but left two older
assertions in the same test expecting the Overall caption (`Showing All Recorded
Activity`): one on first open, one after an unapplied draft date. The page is correct;
the published-page check was stale, so Post-Deploy E2E failed on every run.

## Fix

Both stale expectations now expect `Showing <today> To <today> Chicago Time`, the range
the page applies. No product code changes.

## Hardening

- Regression law: `tests/member-ledger-starts-on-today.law.test.ts` second case. It
  refuses any `Displayed Activity Scope` expectation of `Recorded Activity` in the
  production spec unless the spec pressed the Overall control earlier. Fails on
  `origin/main`'s spec ("Overall caption expected at offset 36148 without pressing
  Overall first"), passes with this change.
- Invariant: the existing law pins the page to open on one Chicago day.
- Detection: Post-Deploy E2E (`post-deploy-e2e.yml` club-members suite) already routes
  failures to `operational_alert_events` with `target_task_id`.
- CI gate: `Client Unit Tests (vitest)` runs the law on every PR.
