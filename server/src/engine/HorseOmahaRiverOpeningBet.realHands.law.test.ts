/**
 * LAW: ON REAL AUDITED HEADS-UP RIVER NODES THE RIVER OPENING OPTIONS DECIDE AS GRADED (PLO-OWNER lead-7 2026-11-26).
 * HorseOmahaRiverOpeningBet.realHands.fixture.json: nodes of the PLO hand audits (daily 2026-11-25T230000Z and
 * 2026-11-20..24) where the live rule chain checks: the public snapshot, the deciding Horse's own cards, the
 * opponent's public river fold record as of the decision. Each option alone decides as the graded replay did
 * (verdict-only scorer: value 6 fixed / 2 newly wrong, bluff 19 fixed / 3 newly wrong over both audits), the off
 * arm keeps every check, and without a record no bluff is made where the record made one.
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
  it('off keeps the check; each option alone decides as graded', () => {
    for (const n of nodes) {
      expect(kind(riverOpeningDecide(n, {}).action), `${n.hand} off`).toBe('check');
      expect(kind(riverOpeningDecide(n, V).action), `${n.hand} value`).toBe(kind(n.expect.value));
      expect(kind(riverOpeningDecide(n, B).action), `${n.hand} bluff`).toBe(kind(n.expect.bluff));
    }
  }, 120_000);
  it('a bluff the record made is not made at the equilibrium prior without a large blocker gain', () => {
    let kept = 0;
    let total = 0;
    for (const n of nodes.filter((x) => x.expect.bluff !== 'check')) {
      total++;
      if (kind(riverOpeningDecide(n, B, false).action) === 'check') kept++;
    }
    expect(kept / total).toBeGreaterThan(0.6);
  }, 120_000);
});
