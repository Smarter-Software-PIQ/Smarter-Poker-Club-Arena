/**
 * LAW (PLO-OWNER lead-7 2026-11-27; owner orders "the stats need to be used against human players, not horses" and
 * "PLO4 cash needs adjustments too"): omahaMultiwayFieldIsPeopleMeasured prices the FIELD of a multiway PLO4/PLO5
 * cash turn or river call inside omahaFacingBetEv on people's measured play, anchored to equilibrium.
 *
 *  1. The numbers: a caller holds the strongest W = (n x people caller width + 30 x 1 / (1 + s)) / (n + 30) of
 *     holdings; a player still to act continues at C = 1 - (n x people multiway fold + 30 x (s / (1 + s))^(1/k)) /
 *     (n + 30). The population is the people-only data (no Horse play, no HUD population rows).
 *  2. Real audited decisions (plo4-audit: PLO4 cash Nov 19 to 26, the 162 multiway turn and river spots where a Horse
 *     faced a first bet, the deciding Horse's own cards only), the engine's own decide on the live switch rows:
 *     the option prices them, never acts when off, changes only folds and calls (it never makes a raise), and
 *     facing PEOPLE's bets the Horses fold less (32 -> 28 of 41 on the turn).
 *  3. Heads-up turn and river decisions (the committed facing-bet state set) are byte-identical in action and amount.
 *  4. No identity input: flipping every other seat's Horse flag changes no decision and no receipt of the option;
 *     the module reads no account, name or Horse flag; the option is read `=== true` in PLO4/PLO5 cash only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { OMAHA_FACING_BET_PEOPLE_PRIOR_DATA } from './HorseOmahaFacingBetPeoplePrior.data.js';
import { loadPricedStates } from './HorseOmahaFacingBetPriced.test-support.js';
import {
  OMAHA_MW_PEOPLE_FIELD_ANCHOR_N,
  omahaPeopleMultiwayField,
} from './HorseOmahaMultiwayPeopleField.js';
import {
  decideMultiway,
  loadMultiwayAuditedStates,
} from './HorseOmahaMultiwayPeopleField.test-support.js';

const kind = (d: { action: string }): string => (d.action === 'all_in' ? 'call' : d.action);

describe('LAW: the multiway field of the PLO facing-bet price is measured on people', () => {
  enableBrainTelemetry();

  it('1. the caller width and the continue rate are the people cells anchored to equilibrium', () => {
    const K = OMAHA_MW_PEOPLE_FIELD_ANCHOR_N;
    const D = OMAHA_FACING_BET_PEOPLE_PRIOR_DATA;
    expect(D.source).toBe('people-only');
    expect(D.filters.hudPopulationRows).toBe('not read');
    const f = omahaPeopleMultiwayField({ street: 'turn', potFrac: 0.5, behind: 1 })!;
    const n = D.caller.turn.n;
    expect(f.callerWidth).toBeCloseTo((n * D.caller.turn.share + K * (1 / 1.5)) / (n + K), 9);
    const fc = D.fold.turn.mw.mid;
    const anchorFold = (0.5 / 1.5) ** (1 / 2);
    expect(f.behindContinue).toBeCloseTo(
      1 - (fc.n * (fc.share as number) + K * anchorFold) / (fc.n + K),
      9
    );
    // the people field is far wider than the stated 0.45 / 0.35 caller constants and continues more than 0.25
    expect(f.callerWidth).toBeGreaterThan(0.7);
    const r = omahaPeopleMultiwayField({ street: 'river', potFrac: 0.8, behind: 2 })!;
    expect(r.callerWidth).toBeGreaterThan(0.5);
    expect(r.behindContinue).toBeGreaterThan(0.05);
    expect(r.behindContinue).toBeLessThan(0.3);
    expect(omahaPeopleMultiwayField({ street: 'flop' as never, potFrac: 0.5, behind: 1 })).toBe(
      null
    );
    expect(omahaPeopleMultiwayField({ street: 'turn', potFrac: Number.NaN, behind: 1 })).toBe(null);
  });

  const states = loadMultiwayAuditedStates();
  const rows = states.map((s) => {
    const off = withDecisionFireScope(() => decideMultiway(s.player, s.gs, false, true));
    const on = withDecisionFireScope(() => decideMultiway(s.player, s.gs, true, true));
    return { s, off, on };
  });

  it('2a. the 162 audited multiway decisions are priced by it and never touched when off', () => {
    expect(states.length).toBe(162);
    const priced = rows.filter((r) => r.on.fired.has('omaha_mw_people_field_priced')).length;
    expect(priced).toBeGreaterThanOrEqual(140);
    for (const r of rows)
      expect([...r.off.fired].some((x) => x.startsWith('omaha_mw_people_field'))).toBe(false);
  });

  it('2b. it changes only folds and calls, never makes a raise, and names every change', () => {
    for (const r of rows) {
      const a = kind(r.off.value);
      const b = kind(r.on.value);
      if (a === b) continue;
      expect(['fold', 'call']).toContain(a);
      expect(['fold', 'call']).toContain(b);
      expect(r.on.fired.has('omaha_mw_people_field_changed')).toBe(true);
    }
  });

  it("2c. facing people's bets the Horses fold less; more folds become calls than calls become folds", () => {
    const people = rows.filter((r) => r.s.tag === 'turn.mw.P');
    const offFold = people.filter((r) => kind(r.off.value) === 'fold').length;
    const onFold = people.filter((r) => kind(r.on.value) === 'fold').length;
    expect(people.length).toBe(41);
    expect(offFold).toBe(32);
    expect(onFold).toBe(28);
    const f2c = rows.filter(
      (r) => kind(r.off.value) === 'fold' && kind(r.on.value) === 'call'
    ).length;
    const c2f = rows.filter(
      (r) => kind(r.off.value) === 'call' && kind(r.on.value) === 'fold'
    ).length;
    expect(f2c).toBeGreaterThan(c2f * 2);
  });

  it('3. heads-up turn and river decisions are identical in action and amount', () => {
    for (const s of loadPricedStates()
      .filter((x) => x.gs.stage !== 'flop')
      .slice(0, 120)) {
      const a = decideMultiway(s.player, s.gs, false, false);
      const b = decideMultiway(s.player, s.gs, true, false);
      expect([b.action, b.amount]).toEqual([a.action, a.amount]);
    }
  });

  it('4a. flipping every other seat between person and Horse changes no decision and no receipt of the option', () => {
    for (const r of rows.slice(0, 60)) {
      const gs = structuredClone(r.s.gs);
      for (const p of gs.players ?? [])
        if (p.seat !== r.s.player.seat)
          (p as { is_horse?: boolean }).is_horse = !(p as { is_horse?: boolean }).is_horse;
      const flipped = withDecisionFireScope(() => decideMultiway(r.s.player, gs, true, true));
      expect([flipped.value.action, flipped.value.amount]).toEqual([
        r.on.value.action,
        r.on.value.amount,
      ]);
      const mine = (f: ReadonlySet<string>) =>
        [...f].filter((x) => x.startsWith('omaha_mw_people_field')).sort();
      expect(mine(flipped.fired)).toEqual(mine(r.on.fired));
    }
  });

  it('4b. the module reads no identity; the option is read === true in PLO4/PLO5 cash only', () => {
    const code = readFileSync(join(__dirname, 'HorseOmahaMultiwayPeopleField.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const banned of ['omahaOpponentKindOf', 'is_horse', 'isHorse', 'username', 'user_id'])
      expect(code.includes(banned), banned).toBe(false);
    const src = readFileSync(join(__dirname, 'HorseLogic.ts'), 'utf8');
    expect(
      /const multiwayFieldPeople =\s+opts\.omahaMultiwayFieldIsPeopleMeasured === true &&\s+!isTournamentMode\(gs\) &&\s+\(\(player\.cards \?\? \[\]\)\.length === 4 \|\| \(player\.cards \?\? \[\]\)\.length === 5\);/.test(
        src
      )
    ).toBe(true);
    expect(
      src.includes('if (!multiwayFieldPeople || !s || s.callers + s.behind === 0) return null;')
    ).toBe(true);
  });
});
