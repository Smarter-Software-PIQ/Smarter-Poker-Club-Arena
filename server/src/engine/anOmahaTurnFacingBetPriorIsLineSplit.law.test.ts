/**
 * LAW: THE TURN BETTOR IS PRICED ON THE PEOPLE CELL OF HIS FLOP LINE (lead-8 lane OFB 2026-11-27,
 * omahaTurnFacingBetPriorIsLineSplit, default OFF). Inside omahaFacingBetEv (PLO4/PLO5 cash, the turn, a first wager,
 * heads-up or multiway) the bettor's non-value share is the people-only cell of the flop line (checked through /
 * wagered) and size, his own shown bets first, the balanced share behind a thin cell. Measured on real turn decisions
 * of Horses facing a person's first turn wager (the deciding Horse's own cards only), the engine's own decide:
 * off it never acts; on it prices heads-up and multiway turn bets, changes only calls and folds (never a raise),
 * and after a checked-through flop it folds less; flipping every other seat between person and Horse changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  omahaTurnFlopLineOf,
  omahaTurnLinePeopleCell,
  omahaTurnLinePeoplePriorShare,
} from './HorseOmahaTurnLinePeoplePrior.js';
import { OMAHA_TURN_LINE_PEOPLE_PRIOR_DATA } from './HorseOmahaTurnLinePeoplePrior.data.js';
import {
  decideTurnLine,
  loadTurnLineStates,
} from './HorseOmahaTurnLinePeoplePrior.test-support.js';

const LIVE = { omahaFacingBetPriorIsPeopleMeasured: true };
const kind = (d: { action?: string }) =>
  d.action === 'fold' ? 'fold' : d.action === 'call' || d.action === 'check' ? 'call' : 'raise';

describe('LAW: the turn bettor is priced on the people cell of his flop line', () => {
  enableBrainTelemetry();
  const states = loadTurnLineStates();

  it('the data is people-only and the cells it reads are measured', () => {
    expect(OMAHA_TURN_LINE_PEOPLE_PRIOR_DATA.source).toBe('people-only');
    expect(OMAHA_TURN_LINE_PEOPLE_PRIOR_DATA.filters.bettor).toContain('is_horse = false');
    expect(OMAHA_TURN_LINE_PEOPLE_PRIOR_DATA.filters.hudPopulationRows).toBe('not read');
    for (const line of ['checked', 'led'] as const)
      for (const mw of [false, true]) {
        const c = omahaTurnLinePeopleCell(0.8, mw, line, false);
        expect(c.n).toBeGreaterThan(30);
        const h = omahaTurnLinePeopleCell(0.8, mw, line, true);
        expect(h.n).toBeGreaterThanOrEqual(c.n);
        expect(h.share!).toBeGreaterThanOrEqual(c.share!);
      }
    // a stab after a checked-through flop is less often value than a bet after a flop wager (people's shown bets)
    expect(omahaTurnLinePeopleCell(0.8, false, 'checked', false).share!).toBeGreaterThan(
      omahaTurnLinePeopleCell(0.8, false, 'led', false).share!
    );
  });

  it('the flop line is read from public actions only', () => {
    expect(
      omahaTurnFlopLineOf([
        { stage: 'flop', action: 'check' },
        { stage: 'flop', action: 'check' },
      ])
    ).toBe('checked');
    expect(omahaTurnFlopLineOf([{ stage: 'flop', action: 'bet', amount: 4 }])).toBe('led');
    expect(omahaTurnFlopLineOf([{ stage: 'preflop', action: 'raise', amount: 6 }])).toBe('checked');
  });

  it('his own shown bets move the share; a raise is never priced here', () => {
    const base = {
      street: 'turn' as const,
      potFrac: 0.8,
      isRaise: false,
      multiway: false,
      paid: 8,
      winnable: 18,
      rake: 0,
      twoStreet: true,
      line: 'checked' as const,
      countsHidden: false,
    };
    const none = omahaTurnLinePeoplePriorShare({ ...base, record: null })!;
    const valueOnly = omahaTurnLinePeoplePriorShare({ ...base, record: { shown: 20, value: 20 } })!;
    const bluffy = omahaTurnLinePeoplePriorShare({ ...base, record: { shown: 20, value: 2 } })!;
    expect(valueOnly.share).toBeLessThan(none.share);
    expect(bluffy.share).toBeGreaterThan(none.share);
    expect(omahaTurnLinePeoplePriorShare({ ...base, isRaise: true, record: null })).toBeNull();
    expect(omahaTurnLinePeoplePriorShare({ ...base, street: 'river', record: null })).toBeNull();
  });

  it('off, it never acts', () => {
    for (const s of states.slice(0, 200)) {
      const fired = withDecisionFireScope(() =>
        decideTurnLine(s.player, s.gs, false, true, LIVE)
      ).fired;
      expect([...fired].some((k) => k.startsWith('omaha_turn_line_prior_'))).toBe(false);
    }
  });

  it('on, it prices heads-up and multiway turn bets, changes only calls and folds, and folds less after a checked flop', () => {
    const t: Record<string, { n: number; priced: number; offFold: number; onFold: number }> = {};
    let raisesAdded = 0;
    for (const s of states) {
      const [, way, line] = s.tag.split('.');
      const key = `${way}.${line}`;
      t[key] ??= { n: 0, priced: 0, offFold: 0, onFold: 0 };
      const off = kind(decideTurnLine(s.player, s.gs, false, false, LIVE));
      const r = withDecisionFireScope(() => decideTurnLine(s.player, s.gs, true, true, LIVE));
      const on = kind(r.value);
      t[key].n++;
      if (r.fired.has('omaha_turn_line_prior_priced')) t[key].priced++;
      if (off === 'fold') t[key].offFold++;
      if (on === 'fold') t[key].onFold++;
      if (on === 'raise' && off !== 'raise') raisesAdded++;
    }
    console.info(`[turn line split] ${JSON.stringify(t)}`);
    expect(raisesAdded).toBe(0);
    for (const k of ['hu.checked', 'mw.checked', 'hu.led', 'mw.led'])
      expect(t[k].priced).toBeGreaterThan(0);
    expect(t['hu.checked'].onFold).toBeLessThan(t['hu.checked'].offFold);
    expect(t['mw.checked'].onFold).toBeLessThan(t['mw.checked'].offFold);
  }, 600_000);

  it('flipping every other seat between person and Horse changes nothing', () => {
    for (const s of states.slice(0, 120)) {
      const gs2 = structuredClone(s.gs);
      for (const p of gs2.players ?? [])
        if (p.seat !== s.player.seat)
          (p as { is_horse?: boolean }).is_horse = !(p as { is_horse?: boolean }).is_horse;
      gs2.humanUserIds = [];
      expect(kind(decideTurnLine(s.player, gs2, true, false, LIVE))).toBe(
        kind(decideTurnLine(s.player, s.gs, true, false, LIVE))
      );
    }
  }, 300_000);
});
