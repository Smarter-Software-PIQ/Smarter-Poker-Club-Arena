/**
 * LAW: A MULTIWAY RIVER BET IS PRICED ON THE BETTOR'S OWN RIVER RECORD OVER PEOPLE'S MULTIWAY RIVER BETS (lead-9 lanes
 * MWR + RV + RV2 2026-11-27, omahaMultiwayRiverBetPriorIsPeopleMeasured, default OFF, read `=== true`).
 *
 * The people-measured facing-bet prior prices heads-up bets only; a multiway river bet was priced on an old constant
 * and reads against the Horse mean, so a bettor who keeps showing river bluffs into a field was never read. With the
 * option a multiway river first bet (outside re-raised pots) is priced on his own shown river bets over the
 * people-only multiway river cell over the balanced share.
 *
 * The laws: it ships dark; it prices only a multiway river first bet outside a re-raised pot (never heads-up, where
 * nothing changes); with no record it prices people's multiway river bets (it does nothing for a first encounter:
 * his record is never read); a record of shown river bluffs turns folds into calls and never the reverse, a record
 * of shown value never adds a call; it never produces a raise; no identity input.
 */
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideMwRiver,
  MW_RIVER_OPTION,
  MW_RIVER_PRICED,
  MW_RIVER_RECORD,
  mwRiverStates,
} from './HorseOmahaMultiwayRiverPeoplePrior.test-support.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';

const MIN_PRICED = 40;
const AIR = { n: 12, kind: 'air' as const };
const VALUE = { n: 12, kind: 'value' as const };
const calls = (a: string) => a === 'call' || a === 'all_in';

describe("LAW: a multiway river bet is priced on the bettor's own river record over people's multiway river bets", () => {
  enableBrainTelemetry();

  it('ships dark: release default off', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(MW_RIVER_OPTION);
  });

  const states = mwRiverStates();
  const runs = states.map((s) => ({
    s,
    off: decideMwRiver(s, false, false),
    on: withDecisionFireScope(() => decideMwRiver(s, true, true)),
  }));
  const priced = runs.filter((r) => r.on.fired.has(MW_RIVER_PRICED));

  it('prices only multiway river first bets outside re-raised pots', () => {
    expect(priced.length).toBeGreaterThanOrEqual(MIN_PRICED);
    for (const r of priced) {
      expect(r.s.live).toBeGreaterThan(2);
      expect(r.s.pot).not.toBe('reraised');
      expect(r.s.gs.stage).toBe('river');
    }
    expect(runs.some((r) => r.s.live > 2 && r.s.pot === 'reraised')).toBe(true);
  });

  it('heads-up nothing changes', () => {
    for (const r of runs) {
      if (r.s.live !== 2) continue;
      expect(r.on.fired.has(MW_RIVER_PRICED)).toBe(false);
      expect(r.on.value.action).toBe(r.off.action);
    }
  });

  it('a first encounter reads no record: the price is people-only, and a change is never a raise', () => {
    for (const r of runs) {
      expect(r.on.fired.has(MW_RIVER_RECORD)).toBe(false);
      if (r.on.value.action === r.off.action) continue;
      expect(r.on.fired.has(MW_RIVER_PRICED)).toBe(true);
      expect(['fold', 'call', 'all_in']).toContain(r.on.value.action);
      expect(['fold', 'call', 'all_in']).toContain(r.off.action);
    }
  });

  it('his shown river bluffs turn folds into calls, never the reverse; shown value never adds a call', () => {
    let added = 0;
    let read = 0;
    for (const r of priced.slice(0, 120)) {
      const air = withDecisionFireScope(() => decideMwRiver(r.s, true, true, AIR));
      const value = decideMwRiver(r.s, true, false, VALUE);
      if (air.fired.has(MW_RIVER_RECORD)) read++;
      const none = r.on.value.action;
      if (calls(none)) expect(calls(air.value.action)).toBe(true);
      if (!calls(none)) expect(calls(value.action)).toBe(false);
      if (!calls(none) && calls(air.value.action)) added++;
      expect(['fold', 'call', 'all_in']).toContain(air.value.action);
      expect(['fold', 'call', 'all_in']).toContain(value.action);
    }
    expect(read).toBeGreaterThan(0);
    expect(added).toBeGreaterThan(0);
  });

  it('with the option off a record changes nothing the option would have priced', () => {
    for (const r of priced.slice(0, 30))
      expect(
        withDecisionFireScope(() => decideMwRiver(r.s, false, true, AIR)).fired.has(MW_RIVER_PRICED)
      ).toBe(false);
  });

  it('no identity input: the bettor being a person or a Horse changes nothing', () => {
    for (const r of priced.slice(0, 30)) {
      const gs = structuredClone(r.s.gs);
      for (const p of gs.players ?? []) {
        if (p.seat === r.s.player.seat) continue;
        (p as { is_horse?: boolean }).is_horse = !(p as { is_horse?: boolean }).is_horse;
      }
      expect(decideMwRiver({ ...r.s, gs }, true, false).action).toBe(r.on.value.action);
    }
  });
});
