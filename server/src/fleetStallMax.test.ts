import { describe, expect, it } from 'vitest';
import { FLEET_STALL_PAUSE_BOUND_MS, fleetStallMaxMs } from './fleetStallMax.js';

const MIN = 60_000;

describe('fleetStallMaxMs', () => {
  it('ignores a closed-arena table that cannot deal, however long it has been idle', () => {
    expect(
      fleetStallMaxMs([
        { dealable: 0, paused: false, msSinceProgress: 40 * MIN },
        { dealable: 6, paused: false, msSinceProgress: 2_000 },
      ])
    ).toBe(2_000);
  });

  it('ignores a single seated player waiting for an opponent', () => {
    expect(fleetStallMaxMs([{ dealable: 1, paused: false, msSinceProgress: 25 * MIN }])).toBe(0);
  });

  it('ignores a table parked on a break inside the bound', () => {
    expect(fleetStallMaxMs([{ dealable: 8, paused: true, msSinceProgress: 20 * MIN }])).toBe(0);
  });

  it('counts a paused table again once the pause outlives its bound', () => {
    const wedged = FLEET_STALL_PAUSE_BOUND_MS + MIN;
    expect(fleetStallMaxMs([{ dealable: 8, paused: true, msSinceProgress: wedged }])).toBe(wedged);
  });

  it('reports a real stall on a dealable, unpaused table', () => {
    expect(
      fleetStallMaxMs([
        { dealable: 0, paused: false, msSinceProgress: 50 * MIN },
        { dealable: 4, paused: false, msSinceProgress: 21 * MIN },
        { dealable: 3, paused: null, msSinceProgress: 3 * MIN },
      ])
    ).toBe(21 * MIN);
  });

  it('is zero for an empty fleet', () => {
    expect(fleetStallMaxMs([])).toBe(0);
  });
});
