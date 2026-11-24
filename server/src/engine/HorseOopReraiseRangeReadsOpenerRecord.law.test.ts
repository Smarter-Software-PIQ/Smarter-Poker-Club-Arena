/**
 * LAW (2026-11-24, PLO-LEAD-6): with holdem/omahaOopReraiseRangeReadsOpenerRecord the out-of-position 3-bet rule
 * (HorseOopReraiseRangeHolds) binds in proportion to THIS opener's own record of 4-betting a 3-bet
 * (HorseOpenerAnswersThreeBet), anchored to its baseline:
 *   - no record: the verdict is exactly the verdict without the option (guard weight 1);
 *   - an opener whose record shows he 4-bets at or above the baseline: the guard binds in full (no 3-bet the rule
 *     rejects stands through the record);
 *   - an opener whose record shows he never 4-bets: 3-bets the guard or the price rejected stand at the seeded
 *     frequency 1 - w, recorded on the receipt; never more 3-bets than the brain made (the rule only removes).
 * Pure verdict level: seeded deals, no state, no random stream.
 */
import { describe, expect, it } from 'vitest';
import {
  oopReraiseVerdict,
  type OopReraiseInput,
  type OopReraiseSpot,
} from './HorseOopReraiseRangeHolds.js';
import {
  addOpenerResponseEvidence,
  emptyOpenerResponse,
  openerFourBetRead,
  plannedFoldGuardWeight,
  type OpenerResponseCounters,
} from './HorseOpenerAnswersThreeBet.js';
import { oopDeal } from './HorseOopReraiseRangeHolds.test-support.js';

/** Heads-up NLH, 100 bb: the small blind opened to 2.5 bb, the Horse in the big blind out of position. */
const SPOT: OopReraiseSpot = {
  game: 'nlh',
  openerSeat: 1,
  openerId: 'opener',
  heroBet: 2,
  heroStack: 198,
  openerBet: 5,
  openerStack: 195,
  pot: 7,
  currentBet: 5,
  toCall: 3,
  bigBlind: 2,
  effBB: 100,
  potLimit: false,
};
const base = (i: number, answer: 'fold' | 'call' | 'raise'): OopReraiseInput => ({
  spot: SPOT,
  hole: oopDeal('nlh', i),
  dead: [],
  raiseTo: 20,
  answers: {
    fold: 0.5,
    call: 0.42,
    raise: 0.08,
    source: 'measured',
    opportunities: 40,
    prior: 'nlh:le135',
  },
  openBand: [0.3, 1],
  fourBetAnswer: answer,
  rakeOfPot: () => 0,
  callAdmitted: true,
  cap: 0.45,
  horseId: `horse-${i}`,
});
const record = (
  each: () => { fold: number; call: number; raise: number }
): OpenerResponseCounters => {
  let r: OpenerResponseCounters | null = null;
  for (let k = 0; k < 60; k++) {
    const inc = emptyOpenerResponse();
    inc.inPosition = { opp: 1, ...each() };
    r = addOpenerResponseEvidence(r, inc);
  }
  return r!;
};
const NEVER = record(() => ({ fold: 0, call: 1, raise: 0 }));
let n = 0;
const OFTEN = record(() =>
  n++ % 3 === 0 ? { fold: 0, call: 0, raise: 1 } : { fold: 1, call: 0, raise: 0 }
);
const strip = (r: unknown) => {
  const { openerRecord: _drop, ...rest } = r as Record<string, unknown>;
  return rest;
};
const DEALS = Array.from({ length: 400 }, (_, i) => i);

describe('the out-of-position 3-bet rule reads the opener record', () => {
  it('no record: every verdict is the verdict without the option', () => {
    for (const i of DEALS)
      for (const ans of ['fold', 'call'] as const) {
        const without = oopReraiseVerdict(base(i, ans));
        const withRead = oopReraiseVerdict({
          ...base(i, ans),
          openerRecord: openerFourBetRead(null, 'inPosition', 0.5),
        });
        expect(withRead && strip(withRead)).toEqual(without);
        if (withRead) expect(withRead.openerRecord?.guardWeight).toBe(1);
      }
  });

  it('an opener who 4-bets at or above the baseline: the guard binds in full', () => {
    const read = openerFourBetRead(OFTEN, 'inPosition', 0.5);
    expect(plannedFoldGuardWeight(read)).toBe(1);
    for (const i of DEALS) {
      const v = oopReraiseVerdict({ ...base(i, 'fold'), openerRecord: read });
      if (!v) continue;
      expect(v.reason).not.toBe('opener_record_planned_fold');
      expect(v.reason).not.toBe('opener_record_price');
    }
  });

  it('an opener who never 4-bets: rejected 3-bets stand at the seeded frequency 1 - w, recorded', () => {
    const read = openerFourBetRead(NEVER, 'inPosition', 0.5);
    const w = plannedFoldGuardWeight(read);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(0.2);
    let rejectedWithout = 0;
    let standingThroughRecord = 0;
    for (const i of DEALS) {
      const without = oopReraiseVerdict(base(i, 'fold'));
      const v = oopReraiseVerdict({ ...base(i, 'fold'), openerRecord: read });
      if (!without || !v) continue;
      expect(v.openerRecord).toMatchObject({ source: 'measured', node: 'inPosition' });
      if (without.verdict !== 'kept') rejectedWithout++;
      if (
        without.verdict !== 'kept' &&
        v.verdict === 'kept' &&
        (v.reason === 'opener_record_planned_fold' ||
          v.reason === 'opener_record_price' ||
          v.reason === 'blocker_planned_fold')
      )
        standingThroughRecord++;
    }
    expect(rejectedWithout).toBeGreaterThan(50);
    const share = standingThroughRecord / rejectedWithout;
    expect(share).toBeGreaterThan(1 - w - 0.15);
    expect(share).toBeLessThanOrEqual(1);
  });

  it('the rule only removes: a verdict is kept, called or folded, never a new raise', () => {
    const read = openerFourBetRead(NEVER, 'inPosition', 0.5);
    for (const i of DEALS) {
      const v = oopReraiseVerdict({ ...base(i, 'call'), openerRecord: read });
      if (v) expect(['kept', 'called', 'folded']).toContain(v.verdict);
    }
  });
});
