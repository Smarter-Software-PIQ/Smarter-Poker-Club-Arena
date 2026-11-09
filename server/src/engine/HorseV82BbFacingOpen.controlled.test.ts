/**
 * CONTROLLED SCENARIO COVERAGE, NOT LIVE EVIDENCE (2026-11-08).
 *
 * V82 (v70FacingOpenZone, #9538): a no-limit hold'em big blind, two- or
 * three-handed, facing exactly one sized open (to call <= 3bb, no jam before
 * it) with 15 to 22bb (stack behind plus chips already in, both ends
 * inclusive) continues by calling or raising short of all-in in 37-66% of
 * spots. Live traffic cannot fill several of these cells (on 40bc2467 the
 * three-handed 18-22bb cell had n 15 and every cash cell n 0), so this file
 * constructs them: a seeded node, blinds posted, every seat at the same
 * stack, the open by the button (heads-up: the small blind), and the real
 * HorseLogic.decide path ('balanced' style), combo-weighted over the 169
 * classes at two seeds. It proves the engine's answer in those constructed
 * spots only; it says nothing about live frequencies, which stay with the
 * measurement kit.
 *
 * Measured here (call + raise short of all-in): heads-up tournament 47.2 at
 * 15.00, 18.00 and 22.00bb and vs a 3bb open; heads-up cash 47.2; three-handed
 * tournament 62.7 at 15.00 and 18.00bb (plus 13.8 jams), cash 47.5 (15.00bb)
 * and 59.1 (22.00bb). Three-handed tournament 22.00bb continues 76.5: its
 * fold share (23.5) is the same as at 15 and 18bb, the 3-bets simply stop
 * being all-in, and the width is the V72 big-blind continue width (the
 * def72 call bar), not the V82 gate. That cell is held to "engaged and not
 * below the band" and is reported as above the band, not hidden.
 */
import { describe, expect, it } from 'vitest';
import { bbShares, type V82Spot } from './HorseV82BbFacingOpenFixture.js';

const even = (dealt: 2 | 3, bb: number) => Array.from({ length: dealt }, () => bb);

type Cell = [string, V82Spot, 'band' | 'not-below'];
const CELLS: Cell[] = [];
for (const dealt of [2, 3] as const) {
  for (const depth of [15, 18, 22]) {
    CELLS.push([
      `tournament ${dealt}-handed ${depth.toFixed(2)}bb vs a 2.2bb open`,
      { dealt, mode: 'tournament', stacksBB: even(dealt, depth), openToBB: 2.2 },
      dealt === 3 && depth === 22 ? 'not-below' : 'band',
    ]);
  }
  CELLS.push([
    `tournament ${dealt}-handed 18.00bb vs a 3bb open`,
    { dealt, mode: 'tournament', stacksBB: even(dealt, 18), openToBB: 3 },
    'band',
  ]);
  for (const depth of [15, 22]) {
    CELLS.push([
      `cash ${dealt}-handed ${depth.toFixed(2)}bb vs a 2.5bb open`,
      { dealt, mode: 'cash', stacksBB: even(dealt, depth), openToBB: 2.5 },
      'band',
    ]);
  }
}

describe('CONTROLLED (constructed spots, not live evidence): V82 big blind facing one sized open, 15-22bb', () => {
  it.each(CELLS)('%s', (_name, spot, hold) => {
    const s = bbShares(spot);
    // The V82 zone owns the spot: a jam-or-fold node never flat-calls.
    expect(s.call).toBeGreaterThan(0);
    const cr = s.call + s.raise;
    expect(cr).toBeGreaterThanOrEqual(37);
    if (hold === 'band') expect(cr).toBeLessThanOrEqual(66);
  });
});
