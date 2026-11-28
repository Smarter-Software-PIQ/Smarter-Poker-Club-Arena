/**
 * LAW: THE RIVER BET OF A RE-RAISED POT IS PRICED ON PEOPLE'S RE-RAISED-POT RIVER BETS (lead-9 lane RV2 2026-11-27,
 * omahaRiverBetPriorIsPotTypeSplit, default OFF, read `=== true`).
 *
 * The people-only heads-up river cell pools every pot type; people's shown river bets in re-raised pots hold fewer
 * value hands than in single-raised pots, so the pooled cell makes the Horse fold too much to a river bet in a
 * re-raised pot. With the option the river price reads the re-raised-pot cell, shrunk toward the pooled cell and
 * then the equilibrium anchor, moved by the bettor's record as before.
 *
 * The laws: it ships dark; off nothing changes; it reads only a PLO4 / PLO5 heads-up river BET in a re-raised pot
 * (never a raise, another street, a single-raised or limped pot, multiway); the cell is the stated shrink of the
 * fitted cells and nothing else; it never produces a raise; no identity input.
 */
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  omahaPeopleNonTop20,
  omahaPeoplePriorShare,
  omahaPeopleRiverRegionCell,
} from './HorseOmahaFacingBetPeoplePrior.js';
import { OMAHA_RIVER_POT_PRIOR_DATA } from './HorseOmahaRiverPotPrior.data.js';
import {
  OMAHA_RIVER_POT_PRIOR_POOL_BETS,
  OMAHA_RIVER_POT_PRIOR_SPLITS,
  omahaRiverPotCell,
  omahaRiverPotKeyOf,
} from './HorseOmahaRiverPotPrior.js';
import {
  decideRiverPot,
  RIVER_POT_BASE,
  RIVER_POT_ON,
  RIVER_POT_RECEIPT,
  riverPotStates,
} from './HorseOmahaRiverPotPrior.test-support.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';

const pre = (seat: number, action: string, amount: number) => ({
  stage: 'preflop',
  seat,
  action,
  amount,
});
const LIMPED = [pre(1, 'sb', 1), pre(2, 'bb', 2), pre(1, 'call', 1)];
const SINGLE = [pre(1, 'sb', 1), pre(2, 'bb', 2), pre(1, 'raise', 6), pre(2, 'call', 4)];
const RERAISED = [
  pre(1, 'sb', 1),
  pre(2, 'bb', 2),
  pre(1, 'raise', 6),
  pre(2, 'raise', 18),
  pre(1, 'call', 12),
];
const RIVER_BET = {
  street: 'river' as const,
  paid: 10,
  winnable: 20,
  rake: 0,
  multiway: false,
  twoStreet: false,
};
const MIN_READ = 20;

describe("LAW: the river bet of a re-raised pot is priced on people's re-raised-pot river bets", () => {
  enableBrainTelemetry();

  it('ships dark: release default off', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaRiverBetPriorIsPotTypeSplit');
  });

  it('reads only a PLO4 / PLO5 river bet in a re-raised pot', () => {
    expect(OMAHA_RIVER_POT_PRIOR_SPLITS).toEqual(['reraised']);
    expect(omahaRiverPotKeyOf('plo5', 'river', false, RERAISED)).toEqual({ pot: 'reraised' });
    expect(omahaRiverPotKeyOf('plo4', 'river', false, RERAISED)).toEqual({ pot: 'reraised' });
    expect(omahaRiverPotKeyOf('plo5', 'river', true, RERAISED)).toBeNull();
    expect(omahaRiverPotKeyOf('plo5', 'turn', false, RERAISED)).toBeNull();
    expect(omahaRiverPotKeyOf('plo5', 'flop', false, RERAISED)).toBeNull();
    expect(omahaRiverPotKeyOf('plo5', 'river', false, SINGLE)).toBeNull();
    expect(omahaRiverPotKeyOf('plo5', 'river', false, LIMPED)).toBeNull();
    expect(omahaRiverPotKeyOf('plo6', 'river', false, RERAISED)).toBeNull();
    expect(omahaRiverPotKeyOf('nlh', 'river', false, RERAISED)).toBeNull();
  });

  it('the cell is the fitted re-raised cell shrunk toward the pooled river cell, and nothing else', () => {
    for (const [bucket, frac] of [
      ['under40', 0.3],
      ['mid', 0.6],
      ['big', 1],
    ] as const) {
      const own = OMAHA_RIVER_POT_PRIOR_DATA[`${bucket}|reraised`]!;
      const pooled = omahaPeopleRiverRegionCell(frac, false, false)!;
      const cell = omahaRiverPotCell(
        bucket,
        { pot: 'reraised' },
        pooled,
        omahaPeopleNonTop20('river', frac, false, false)
      )!;
      const P = Math.min(OMAHA_RIVER_POT_PRIOR_POOL_BETS, pooled.n);
      expect(cell.regions.n).toBe(own.n + P);
      expect(cell.regions.core).toBeCloseTo((own.n * own.core! + P * pooled.core) / (own.n + P), 9);
      expect(cell.regions.bottom).toBeCloseTo(
        (own.n * own.bottom! + P * pooled.bottom) / (own.n + P),
        9
      );
      expect(cell.regions.core + cell.regions.middle + cell.regions.bottom).toBeCloseTo(1, 2);
      expect(cell.nonTop20).toBeGreaterThan(0);
      expect(cell.nonTop20).toBeLessThan(1);
    }
    expect(omahaRiverPotCell('big', null, null, null)).toBeNull();
    expect(omahaRiverPotCell('raise', { pot: 'reraised' }, null, null)).toBeNull();
  });

  it('the people cells it reads are people-only fits with their n', () => {
    for (const [key, c] of Object.entries(OMAHA_RIVER_POT_PRIOR_DATA)) {
      expect(key).toMatch(/^(under40|mid|big|over)\|(limped|single|reraised)$/);
      expect(c.n).toBeGreaterThan(0);
    }
  });

  it('the share moves only for a heads-up river bet with the key; without it nothing changes', () => {
    for (const potFrac of [0.3, 0.6, 1]) {
      const today = omahaPeoplePriorShare({ ...RIVER_BET, potFrac, isRaise: false, record: null });
      const nullKey = omahaPeoplePriorShare({
        ...RIVER_BET,
        potFrac,
        isRaise: false,
        record: null,
        riverPot: null,
      });
      const on = omahaPeoplePriorShare({
        ...RIVER_BET,
        potFrac,
        isRaise: false,
        record: null,
        riverPot: { pot: 'reraised' },
      });
      expect(nullKey).toEqual(today);
      expect(on!.regions).not.toEqual(today!.regions);
      // a raise, a multiway pot and the turn never read the key
      for (const other of [
        { ...RIVER_BET, potFrac, isRaise: true },
        { ...RIVER_BET, potFrac, isRaise: false, multiway: true },
        { ...RIVER_BET, potFrac, isRaise: false, street: 'turn' as const },
      ])
        expect(
          omahaPeoplePriorShare({ ...other, record: null, riverPot: { pot: 'reraised' } })
        ).toEqual(omahaPeoplePriorShare({ ...other, record: null }));
    }
  });

  it("the bettor's own record still moves the re-raised cell in both directions", () => {
    const at = (record: { shown: number; value: number } | null) =>
      omahaPeoplePriorShare({
        ...RIVER_BET,
        potFrac: 1,
        isRaise: false,
        record,
        riverPot: { pot: 'reraised' },
      })!.regions!.core;
    expect(at({ shown: 20, value: 19 })).toBeGreaterThan(at(null));
    expect(at({ shown: 20, value: 2 })).toBeLessThan(at(null));
  });

  const states = riverPotStates();
  const runs = states.map((s) => ({
    s,
    off: decideRiverPot(s, RIVER_POT_BASE, false),
    on: withDecisionFireScope(() => decideRiverPot(s, RIVER_POT_ON, true)),
  }));
  const read = runs.filter((r) => r.on.fired.has(RIVER_POT_RECEIPT));

  it('reads real heads-up river bets, and only in re-raised pots', () => {
    expect(read.length).toBeGreaterThanOrEqual(MIN_READ);
    for (const r of read) {
      expect(r.s.pot).toBe('reraised');
      expect((r.s.gs.players ?? []).filter((p) => !p.is_folded).length).toBe(2);
    }
  });

  it('changes a decision only where it read the cell, and never into a raise', () => {
    for (const r of runs) {
      if (r.off.action === r.on.value.action) continue;
      expect(r.on.fired.has(RIVER_POT_RECEIPT)).toBe(true);
      expect(['fold', 'call', 'all_in']).toContain(r.on.value.action);
      expect(['fold', 'call', 'all_in']).toContain(r.off.action);
    }
  });

  it('without the people-measured prior it does nothing', () => {
    for (const r of read.slice(0, 20)) {
      const alone = withDecisionFireScope(() =>
        decideRiverPot(r.s, { omahaRiverBetPriorIsPotTypeSplit: true }, true)
      );
      expect(alone.fired.has(RIVER_POT_RECEIPT)).toBe(false);
      expect(alone.value.action).toBe(decideRiverPot(r.s, {}, false).action);
    }
  });

  it('no identity input: the bettor being a person or a Horse, or renamed, changes nothing', () => {
    for (const r of read.slice(0, 20)) {
      const gs = structuredClone(r.s.gs);
      for (const p of gs.players ?? []) {
        if (p.seat === r.s.player.seat) continue;
        (p as { is_horse?: boolean }).is_horse = !(p as { is_horse?: boolean }).is_horse;
        (p as { user_id: string }).user_id = `renamed-${p.seat}`;
      }
      expect(decideRiverPot({ ...r.s, gs }, RIVER_POT_ON, false).action).toBe(r.on.value.action);
    }
  });
});
