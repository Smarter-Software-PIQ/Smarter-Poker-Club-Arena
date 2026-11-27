// The over-fold fix validation (scripts/ops/horse-overfold-fix-validation*.mjs) and its place in the daily audit.
// Fixtures are counts and a Horse's own SHOWN cards only.
import { describe, expect, it } from 'vitest';
import { onOwnersOf, onOwnersSql, planRuns } from '../../scripts/ops/horse-daily-audit-lib.mjs';
import { parseCard } from '../../scripts/ops/horse-hand-audit-omaha-lib/omaha.mjs';
import {
  DAY,
  beforeWindows,
  cellVerdict,
  watchClass,
  watchVerdict,
} from '../../scripts/ops/horse-overfold-fix-validation-lib.mjs';

const cs = (s: string) => s.split(' ').map((c) => parseCard(c) as number);
const ON = Date.parse('2026-11-27T08:40:00Z');

describe('over-fold fix validation', () => {
  it('BEFORE is the same clock hours on each of the 7 days before ON (one 7-day block past 24 h)', () => {
    const w = beforeWindows(ON, ON + 2 * 3600_000);
    expect(w).toHaveLength(7);
    expect(w[6]).toEqual([ON - DAY, ON - DAY + 2 * 3600_000]);
    expect(beforeWindows(ON, ON + 2 * DAY)).toEqual([[ON - 7 * DAY, ON]]);
  });

  it('classes the three river watch cells from the Horse own cards', () => {
    // paired board, three hearts: a non-nut flush, the nut flush
    expect(watchClass(cs('Kh 3h Qs Jd'), cs('Th 6d 6c 2h 9s'))).toBe(null);
    const paired = cs('Th 6h 6c 2h 9s');
    expect(watchClass(cs('Kh 3h Qs Jd'), paired)).toBe('non-nut flush on paired board');
    expect(watchClass(cs('Ah 3h Qs Jd'), paired)).toBe('nut flush on paired board');
    // unpaired three-heart board, a straight without the ace of hearts
    expect(watchClass(cs('8c 7d Ks Kd'), cs('Th 9h 6h 2c 3s'))).toBe(
      'straight on flush board without the nut-flush card'
    );
    expect(watchClass(cs('8c 7d Ah Kd'), cs('Th 9h 6h 2c 3s'))).toBe(null);
  });

  it('verdicts: REGRESSED over the bar or worse than before, VALIDATED at the ceiling, NOT YET says the n', () => {
    const b = { n: 100, folds: 50, rate: 0.5 };
    expect(
      cellVerdict(b, { n: 40, folds: 30, rate: 0.75, ceiling: 0.45, zCeiling: 4 }, 3).verdict
    ).toBe('REGRESSED');
    expect(
      cellVerdict(b, { n: 40, folds: 18, rate: 0.45, ceiling: 0.46, zCeiling: -0.2 }, 3).verdict
    ).toBe('VALIDATED');
    const ny = cellVerdict(b, { n: 8, folds: 4, rate: 0.5, ceiling: 0.45, zCeiling: 0.3 }, 3);
    expect(ny.verdict).toBe('NOT YET');
    expect(ny.need).toBe(12);
    expect(watchVerdict([{ bb: -3 }]).verdict).toBe('NOT YET');
    expect(watchVerdict([1, 2, -1, 4, 0].map((bb) => ({ bb }))).verdict).toBe('VALIDATED');
  });

  it('the daily audit runs it for every owner-map option that is ON, and only those', () => {
    const opts = ['omahaFacingBetPriorIsPeopleMeasured', 'omahaFlopPressureCapIsPriced'];
    expect(onOwnersSql(opts)).toMatch(
      /^SELECT option, state FROM public\.ca_horse_style_switch WHERE/
    );
    const on = onOwnersOf(
      [
        { option: opts[0], state: 'on' },
        { option: opts[1], state: 'shadow' },
        { option: 'notAnOwner', state: 'on' },
      ],
      opts
    );
    expect(on).toEqual([opts[0]]);
    const U = ON + DAY;
    const runs = planRuns(U - DAY, U, [], on);
    const v = runs.find((r) => r.script === 'horse-overfold-fix-validation.mjs');
    expect(v?.args).toEqual(['--option', opts[0], '--until', '2026-11-28T08:40:00Z', '--json']);
    expect(
      planRuns(U - DAY, U, []).some((r) => r.script === 'horse-overfold-fix-validation.mjs')
    ).toBe(false);
  });
});
