/**
 * LAW: ON REAL AUDITED HEADS-UP RIVER NODES THE RIVER OPENING OPTIONS DECIDE AS GRADED (PLO-OWNER lead-7 2026-11-26).
 * HorseOmahaRiverOpeningBet.realHands.fixture.json: nodes of the PLO hand audits (daily 2026-11-25T230000Z and
 * 2026-11-20..24) where the live rule chain checks: the public snapshot, the deciding Horse's own cards, the
 * opponent's public river fold record as of the decision. Each option alone decides as the graded replay did
 * (verdict-only scorer: value 6 fixed / 2 newly wrong over both audits), the off arm keeps every check.
 * 2026-11-26 (lead-7, owner order "the stats need to be used against human players, not horses"): the bluff's fold
 * is people's measured fold for the line and size moved by his record (HorseOmahaPeopleFold.ts), and the blocker leg
 * is read on every size that clears. Graded against the audit's best action on the 57 nodes: the bluff bets 29
 * (27 the audit's bet, 2 newly wrong); without his record 25 (23 / 2). The range-advantage bluff bets 6 (6 / 0; 4 / 0
 * before review t4 of 2026-11-26 refit his range on people only and the Horse's own range on Horses only).
 * 2026-11-26 (river range people only): HorseOmahaRiverOpeningRangeTables.json v3-2026-11-26-people fits his river
 * range and betting rate on people's shown hands only (was pooled with Horse hands). Re-graded on the same 57 nodes:
 * the blocker bluff bets 25 (23 the audit's bet, 2 newly wrong; was 29 / 27 / 2), without his record 24 (22 / 2; was
 * 25 / 23 / 2); the value option bets 4 (4 the audit's bet, 0 newly wrong; was 6 / 6 / 0): nodes 492c593d and ac3272e1
 * (both the audit's bet) are now checks, so their pinned `expect.value` is re-pinned to the new decision. No
 * threshold is changed.
 */
import { describe, expect, it } from 'vitest';
import {
  RIVER_OPENING_FIXTURE,
  riverOpeningDecide,
} from './HorseOmahaRiverOpeningBet.test-support.js';

const V = { omahaRiverValueBetInPositionIsPriced: true };
const B = { omahaRiverBluffIsPricedOnBlockers: true };
const kind = (a: string) => (a === 'all_in' || a === 'raise' ? 'bet' : a);

describe('LAW: the river opening options on real audited nodes', () => {
  const nodes = RIVER_OPENING_FIXTURE.nodes;
  it('the fixture holds value bets, bluffs and kept checks', () => {
    expect(nodes.filter((n) => n.expect.value !== 'check').length).toBeGreaterThanOrEqual(6);
    expect(nodes.filter((n) => n.expect.bluff !== 'check').length).toBeGreaterThanOrEqual(15);
    expect(
      nodes.filter((n) => n.expect.value === 'check' && n.expect.bluff === 'check').length
    ).toBeGreaterThanOrEqual(10);
  });
  const want = (n: (typeof nodes)[number]): string => {
    const b = String(n.audit.best ?? '').toLowerCase();
    return /bet|raise|all/.test(b) ? 'bet' : /check/.test(b) ? 'check' : b;
  };
  const grade = (on: Record<string, boolean>, withRecord = true) => {
    let bets = 0;
    let fixed = 0;
    let wrong = 0;
    for (const n of nodes) {
      if (kind(riverOpeningDecide(n, on, withRecord).action) !== 'bet') continue;
      bets++;
      if (want(n) === 'bet') fixed++;
      else if (want(n) === 'check') wrong++;
    }
    return { bets, fixed, wrong };
  };
  it('off keeps the check; the value option decides as graded', () => {
    for (const n of nodes) {
      expect(kind(riverOpeningDecide(n, {}).action), `${n.hand} off`).toBe('check');
      expect(kind(riverOpeningDecide(n, V).action), `${n.hand} value`).toBe(kind(n.expect.value));
    }
  }, 120_000);
  it("the blocker bluff on people's measured fold: most bets are the audit's bet, few are newly wrong", () => {
    const g = grade(B);
    console.info(
      `[river bluff, people fold] bets ${g.bets}, audit bet ${g.fixed}, newly wrong ${g.wrong}`
    );
    expect(g.bets).toBeGreaterThanOrEqual(25);
    expect(g.fixed).toBeGreaterThanOrEqual(8 * g.wrong);
    expect(g.wrong).toBeLessThanOrEqual(3);
  }, 120_000);
  it('without his record the bluff still prices on people, with the same accuracy', () => {
    const g = grade(B, false);
    console.info(
      `[river bluff, no record] bets ${g.bets}, audit bet ${g.fixed}, newly wrong ${g.wrong}`
    );
    expect(g.bets).toBeGreaterThanOrEqual(20);
    expect(g.fixed).toBeGreaterThanOrEqual(8 * g.wrong);
  }, 120_000);
  it('the range-advantage river bluff makes no bet the audit calls a check', () => {
    const g = grade({ omahaRiverBluffIsPricedOnRangeAdvantage: true });
    expect(g.bets).toBeGreaterThanOrEqual(1);
    expect(g.wrong).toBe(0);
  }, 120_000);
});
