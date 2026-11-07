// Item 12 opportunity-scoped decay with the style-shift release (Dan,
// 2026-11-06): what the decay rule keeps, what it ages and when.
import { describe, expect, it } from 'vitest';
import {
  EXPLOIT_DECAY,
  EXPLOIT_FAST_DECAY,
  decayAndAddOpportunityScoped,
  freshExploitCounters,
  styleShiftReleased,
  type ExploitCounters,
} from './HorseOpponentExploit';

const inc = (over: Partial<ExploitCounters>): ExploitCounters => ({
  ...freshExploitCounters(),
  ...over,
});
// A hand the player saw but folded preflop with no raise in front: no
// 3-bet or river opportunity.
const foldHand = inc({ hands: 1, fHands: 1, rfiOpp: 1, fRfiOpp: 1 });

describe('opportunity-scoped decay with the style-shift release', () => {
  it('keeps a long-window rare sample on a hand without that spot', () => {
    const row = inc({ hands: 20, fHands: 6, riverCallOpp: 5, riverCall: 4 });
    expect(styleShiftReleased(row)).toBe(false);
    decayAndAddOpportunityScoped(row, foldHand);
    expect(row.riverCallOpp).toBe(5);
    expect(row.riverCall).toBe(4);
    expect(row.hands).toBeCloseTo(20 * EXPLOIT_DECAY + 1, 9);
  });

  it('ages the fast window every hand, gated or not', () => {
    const row = inc({ hands: 20, fHands: 6, fRiverCallOpp: 3, fRiverCall: 2 });
    decayAndAddOpportunityScoped(row, foldHand);
    expect(row.fRiverCallOpp).toBeCloseTo(3 * EXPLOIT_FAST_DECAY, 9);
    expect(row.fRiverCall).toBeCloseTo(2 * EXPLOIT_FAST_DECAY, 9);
  });

  it('releases when the fast preflop-raise rate leaves the long one', () => {
    // Long window: a maniac (raises every hand). Fast window: now a nit.
    const row = inc({ hands: 30, pfr: 30, fHands: 6, fPfr: 1, riverCallOpp: 5, riverCall: 5 });
    expect(styleShiftReleased(row)).toBe(true);
    decayAndAddOpportunityScoped(row, foldHand);
    expect(row.riverCallOpp).toBeCloseTo(5 * EXPLOIT_FAST_DECAY, 9);
    expect(row.riverCall).toBeCloseTo(5 * EXPLOIT_FAST_DECAY, 9);
  });

  it('releases on a shift in any fast-mirrored gated statistic', () => {
    const row = inc({
      hands: 30,
      pfr: 6,
      fHands: 6,
      fPfr: 1.2,
      threeBetOpp: 10,
      threeBet: 0,
      fThreeBetOpp: 4,
      fThreeBet: 3,
    });
    expect(styleShiftReleased(row)).toBe(true);
  });

  it('does not release on a thin fast sample or a stable player', () => {
    expect(styleShiftReleased(inc({ hands: 30, pfr: 30, fHands: 2, fPfr: 0 }))).toBe(false);
    expect(styleShiftReleased(inc({ hands: 30, pfr: 9, fHands: 6, fPfr: 2 }))).toBe(false);
    expect(styleShiftReleased(freshExploitCounters())).toBe(false);
  });
});
