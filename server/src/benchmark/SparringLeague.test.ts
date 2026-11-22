import { describe, expect, it } from 'vitest';
import {
  SPARRING_PROBES,
  SPARRING_PROFILES,
  runSparringCell,
  sizeBand,
  sparringProfilePolicy,
  tellKey,
  tellProbe,
} from './SparringLeague.js';

describe('SparringLeague', () => {
  it("refuses PLO6 and Hold'em (PLO4/PLO5 only)", async () => {
    const base = {
      name: 'x',
      policy: SPARRING_PROBES.barrel_air,
      seats: 2,
      stackBB: 100,
      pairs: 1,
      seed: 1,
    };
    await expect(
      runSparringCell({ ...base, variant: 'plo6' as never, arms: [{ label: 'A', horseOpts: {} }] })
    ).rejects.toThrow(/out of scope/);
    await expect(
      runSparringCell({ ...base, variant: 'nlh' as never, arms: [{ label: 'A', horseOpts: {} }] })
    ).rejects.toThrow(/out of scope/);
  });

  it('two identical arms play identical hands (the paired difference is exactly zero)', async () => {
    const r = await runSparringCell({
      name: 'same',
      policy: sparringProfilePolicy(SPARRING_PROFILES.aggro_reg),
      variant: 'plo4',
      seats: 2,
      stackBB: 100,
      pairs: 12,
      seed: 7,
      arms: [
        { label: 'A', horseOpts: {} },
        { label: 'B', horseOpts: {} },
      ],
    });
    expect(r.arms[1].vsArm0Bb100).toBe(0);
    expect(r.arms[0].bb100).toBe(r.arms[1].bb100);
    expect(r.arms[0].illegal).toBe(0);
  }, 120_000);

  it('a probe that never deviates has exactly zero edge against the Horse mirror', async () => {
    const r = await runSparringCell({
      name: 'mirror',
      policy: (_s, horse) => horse(),
      variant: 'plo5',
      seats: 2,
      stackBB: 100,
      pairs: 10,
      seed: 11,
      arms: [{ label: 'A', horseOpts: {} }],
      mirror: true,
      bbAnte: 1,
    });
    expect(r.arms[0].edgeBb100).toBe(0);
    expect(Object.keys(r.arms[0].deviationEdge)).toEqual([]);
  }, 120_000);

  it('the tell probe keys Horse wagers by street, line, size band and players', () => {
    expect(sizeBand(0.3)).toBe('small');
    expect(sizeBand(0.5)).toBe('half');
    expect(sizeBand(0.7)).toBe('twothirds');
    expect(sizeBand(1)).toBe('pot');
    expect(tellKey('river', 'cbet', 'pot', 2)).toBe('river|cbet|pot|hu');
    expect(typeof tellProbe({})).toBe('function');
  });
});
