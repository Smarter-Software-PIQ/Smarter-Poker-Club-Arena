import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sliceEnclosingBlock } from '../helpers/sourceWindow';
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

  it('the table page requests an engine snapshot when either countdown begins', () => {
    const page = readFileSync(join(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    expect(page).toMatch(/from '\.\.\/lib\/breakCountdownResync'/);
    for (const needle of [
      'shouldResyncAtBreakCountdown(breakCountdownResyncKeyRef.current, tournamentBreak)',
      'shouldResyncAtBreakCountdown(maintenanceCountdownResyncKeyRef.current, maintenanceBreak)',
    ]) {
      const effect = sliceEnclosingBlock(page, needle);
      expect(effect).toMatch(/requestEngineSnapshot\(\);/);
    }
  });
});
