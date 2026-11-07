import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  breakCountdownKey,
  shouldResyncAtBreakCountdown,
} from '../../src/lib/breakCountdownResync';

describe('a break countdown starts on a clean felt (Dan 2026-11-06)', () => {
  it('asks once when a countdown first becomes known', () => {
    const view = { active: true, phase: 'counting_down' as const, breakEndsAtMs: 1_000_000 };
    expect(shouldResyncAtBreakCountdown(null, view)).toBe(true);
    expect(shouldResyncAtBreakCountdown(breakCountdownKey(view), view)).toBe(false);
  });

  it('never asks during the last-hand window or with no break', () => {
    expect(
      shouldResyncAtBreakCountdown(null, { active: true, phase: 'last_hand', breakEndsAtMs: null })
    ).toBe(false);
    expect(
      shouldResyncAtBreakCountdown(null, {
        active: false,
        phase: 'counting_down',
        breakEndsAtMs: 5,
      })
    ).toBe(false);
    expect(shouldResyncAtBreakCountdown(null, null)).toBe(false);
    expect(
      shouldResyncAtBreakCountdown(null, {
        active: true,
        phase: 'counting_down',
        breakEndsAtMs: Number.NaN,
      })
    ).toBe(false);
  });

  it('asks again for the next break', () => {
    const first = { active: true, phase: 'counting_down' as const, breakEndsAtMs: 1_000 };
    const second = { active: true, phase: 'counting_down' as const, breakEndsAtMs: 3_601_000 };
    expect(shouldResyncAtBreakCountdown(breakCountdownKey(first), second)).toBe(true);
  });

  it('the table page requests an engine snapshot when the countdown begins', () => {
    const page = readFileSync(join(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    const at = page.indexOf('shouldResyncAtBreakCountdown(');
    expect(at).toBeGreaterThan(-1);
    const effect = page.slice(at, at + 600);
    expect(effect).toMatch(/requestEngineSnapshot\(\)/);
    expect(page).toMatch(/from '\.\.\/lib\/breakCountdownResync'/);
    const maintenance = page.indexOf(
      'shouldResyncAtBreakCountdown(maintenanceCountdownResyncKeyRef.current, maintenanceBreak)'
    );
    expect(maintenance).toBeGreaterThan(-1);
    expect(page.slice(maintenance, maintenance + 400)).toMatch(/requestEngineSnapshot\(\)/);
  });
});
