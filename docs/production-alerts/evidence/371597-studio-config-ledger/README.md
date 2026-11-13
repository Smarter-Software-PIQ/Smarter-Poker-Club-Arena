# 371597 item 3: Table Studio "Custom Mix" not visible

Alert: `operational_alert_events` row 371597 (`club-arena.post-deploy-e2e`, critical).
Run 43210315096 on `7608c4721`, job 131156857551, `production-customization-realtime.spec.ts`:

```
Locator: getByRole('dialog', { name: 'Make The Table Yours' })
  .locator('[aria-label="Current Table Configuration"]').getByText('Custom Mix', { exact: true })
Expected: visible   Timeout: 60000ms   Error: element(s) not found
```

## Root cause

#10290 (`4154d19a8`, 2026-11-09, "Match all ten Table Studio control finishes and streamline
the editor") changed the configuration ledger in `src/components/table/ThemeSettingsModal.tsx`
from `<div className="tsc__ledger" aria-label="Current Table Configuration">` to a collapsed
`<details className="tsc__ledger"><summary>Current Table Configuration</summary>`. The
spec still selected the removed aria-label. That matched nothing, and even a matching
locator would find the value hidden inside the closed `<details>`. The page still prints
`Custom Mix` correctly (`selectedThemePreset?.name || 'Custom Mix'`). The timing fits:
the failures began on 11-09.

## Fix

The spec now finds `details.tsc__ledger` by its summary, opens it if it is closed (as a
player would), and then expects `Custom Mix`. There is no product change.

## Hardening

- Regression law: `tests/production-specs-select-labels-the-page-renders.law.test.ts`. Every
  `[aria-label="..."]` in `tests/e2e/production-*.spec.ts` must be renderable by `src/`.
  It fails on `origin/main` with `production-customization-realtime.spec.ts: Current Table
Configuration` and passes with this change. It covers all production specs, so a future
  label rename fails in Client Unit Tests instead of on production.
- Invariant: the label/selector contract is enforced statically for every production spec.
- Detection: Post-Deploy E2E already routes this suite's failures to
  `operational_alert_events` with `target_task_id`.
- CI gate: `Client Unit Tests (vitest)`.
