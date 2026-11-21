/**
 * UPGRADE 10 IS COUNTED WHERE IT ACTS (2026-11-21, Horse Switch lane).
 *
 * Measured on production the same day: the per-Horse evidence table showed upgrade 10 invoked on no decision while
 * holdem_gear_shift_reach_seen (the 0.90 reach, on by production row since 2026-11-15) fired 700 to 3,000 times a
 * day under no upgrade's name, and the fast window's OFF switch (a read withdrawn from a player it calls calm) fired
 * no counter at all.
 *
 * Counters only. This file holds:
 *  1. NO DECISION CHANGES: every read is the same with telemetry armed and disarmed, and the reach argument absent,
 *     empty or false gives the same read, on every hand of every replay in every game and table size.
 *  2. THE NEW COUNTER FIRES EXACTLY WHERE A READ IS WITHDRAWN: upgrade10_fast_window_calmed_seen fires on a read
 *     computation if and only if a statistic the long window engages comes back not engaged, at each of the three
 *     withdrawal sites (the back-inside OFF, the preflop-calm withdrawal of rfi and threeBet, the flop-stab OFF).
 *  3. THE EVIDENCE MAPPING: both needles are upgrade 10 invocations; the opportunity counter still is not.
 *
 * Counters are built by the live primitive (decayAndAddOpportunityScoped), one hand at a time, or written directly
 * where a site needs a shape a replay does not give.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  disarmBrainTelemetryForTest,
  drainFires,
  enableBrainTelemetry,
  withDecisionFireScope,
} from './BrainTelemetry.js';
import {
  decayAndAddOpportunityScoped,
  exploitEnvelopeFor,
  flopStabStatRead,
  freshExploitCounters,
  opponentExploitRead,
  type ExploitCounters,
  type FlopStabCounters,
} from './HorseOpponentExploit.js';
import { HORSE_UPGRADE_LIVE_EVIDENCE } from './HorseUpgradeActivationManifest.js';
import { PER_HORSE_OPPORTUNITY_ONLY_NEEDLES, upgradeIdsForFires } from './HorseUpgradeEvidence.js';

const VARIANTS = ['nlh', 'flh', 'plo4', 'plo5', 'plo6', 'flo8'] as const;
const SIZES = ['hu', 'short', 'full'] as const;
type Variant = (typeof VARIANTS)[number];
type Size = (typeof SIZES)[number];
const family = (v: Variant): string => (/^plo|^flo/.test(v) ? 'omaha' : 'holdem');
const scopeOf = (v: Variant, s: Size) => `${family(v)}:${s}` as never;
const UPGRADE_10 = 'upgrade_10_fast_recency_gear_shift';
const CALMED = 'upgrade10_fast_window_calmed_seen';
const FAST_FIELDS = [
  'fHands',
  'fPfr',
  'fRfi',
  'fRfiOpp',
  'fThreeBet',
  'fThreeBetOpp',
  'fBetCheckedTo',
  'fBetCheckedToOpp',
  'fFoldToBet',
  'fFoldToBetOpp',
  'fRiverCall',
  'fRiverCallOpp',
] as const;

/** One hand: preflop raise weight `r`, an open-raise opportunity taken with weight `r` when `rfiOpp`. */
const hand = (r: number, rfiOpp = false): ExploitCounters => {
  const inc = freshExploitCounters();
  inc.hands = 1;
  inc.fHands = 1;
  inc.pfr = r;
  inc.fPfr = r;
  inc.vpip = Math.max(r, 0.25);
  if (rfiOpp) {
    inc.rfiOpp = 1;
    inc.fRfiOpp = 1;
    inc.rfi = r;
    inc.fRfi = r;
  }
  return inc;
};
/** `before` hands at `from` times the game's Horse mean (1 = a raise every hand when `from` > 1/mean), then 40 at `to`. */
function* replay(
  v: Variant,
  s: Size,
  from: number,
  to: number,
  rfi = false
): Generator<ExploitCounters> {
  const mean = exploitEnvelopeFor(scopeOf(v, s), v)!.pfr.mean;
  const row = freshExploitCounters();
  for (let i = 0; i < 40; i++)
    decayAndAddOpportunityScoped(row, hand(Math.min(1, mean * from), rfi));
  for (let k = 0; k < 40; k++) {
    decayAndAddOpportunityScoped(row, hand(to, rfi));
    yield { ...row };
  }
}
/** Gear shifts up (a Horse or a tight player starts raising) and calm-downs (a maniac stops). */
const GRID = VARIANTS.flatMap((v) =>
  SIZES.flatMap((s) =>
    [
      { from: 1, to: 1 },
      { from: 1, to: 0.9 },
      { from: 0.3, to: 1 },
      { from: 0.3, to: 0.75 },
      { from: 100, to: 0 },
      { from: 100, to: 0.1 },
    ].flatMap(({ from, to }) => [false, true].map((rfi) => ({ v, s, from, to, rfi })))
  )
);
type Reach = Parameters<typeof opponentExploitRead>[4];
const read = (c: ExploitCounters, v: Variant, s: Size, reach?: Reach) =>
  opponentExploitRead(c, scopeOf(v, s), v, [], reach);
/** The read the long window alone gives: every fast-window field zero, so no fast-window branch is entered. */
const longOnly = (c: ExploitCounters): ExploitCounters => {
  const z = { ...c };
  for (const f of FAST_FIELDS) z[f] = 0;
  return z;
};
/** Statistics the long window engages that the full read leaves not engaged. */
const withdrawn = (c: ExploitCounters, v: Variant, s: Size): string[] => {
  const long = read(longOnly(c), v, s);
  if (!long) return [];
  const full = read(c, v, s);
  return Object.entries(long.stats)
    .filter(
      ([stat, r]) => r.engaged !== null && !full?.stats[stat as keyof typeof long.stats]?.engaged
    )
    .map(([stat]) => stat);
};
function fired<T>(fn: () => T): { value: T; fired: ReadonlySet<string> } {
  enableBrainTelemetry();
  try {
    return withDecisionFireScope(fn);
  } finally {
    disarmBrainTelemetryForTest();
    drainFires();
  }
}
afterEach(() => {
  disarmBrainTelemetryForTest();
  drainFires();
});

describe('the fast-window fields', () => {
  it('are every f-prefixed field of a fresh counter row', () => {
    const own = Object.keys(freshExploitCounters()).filter((k) => /^f[A-Z]/.test(k));
    expect([...own].sort()).toEqual([...FAST_FIELDS].sort());
  });
});

describe('1. NO DECISION CHANGES', () => {
  it('every read is identical with telemetry armed and disarmed, and with the reach absent, empty or false', () => {
    let reads = 0;
    for (const { v, s, from, to, rfi } of GRID)
      for (const c of replay(v, s, from, to, rfi)) {
        const today = JSON.stringify(read(c, v, s));
        expect(JSON.stringify(fired(() => read(c, v, s)).value)).toBe(today);
        expect(JSON.stringify(read(c, v, s, {}))).toBe(today);
        expect(JSON.stringify(read(c, v, s, { gearShift: false }))).toBe(today);
        expect(JSON.stringify(fired(() => read(c, v, s, { gearShift: true })).value)).toBe(
          JSON.stringify(read(c, v, s, { gearShift: true }))
        );
        reads++;
      }
    expect(reads).toBe(GRID.length * 40);
  });
  it('the flop-stab read is identical with telemetry armed and disarmed', () => {
    for (const fs of [0, 3, 6, 12])
      for (const v of VARIANTS) {
        const row: FlopStabCounters = {
          flopCheckedToOpps: 60,
          flopBetCheckedTo: 55,
          fFlopCheckedToOpps: 12,
          fFlopBetCheckedTo: fs,
        };
        expect(
          JSON.stringify(fired(() => flopStabStatRead(row, scopeOf(v, 'full'), v)).value)
        ).toBe(JSON.stringify(flopStabStatRead(row, scopeOf(v, 'full'), v)));
      }
  });
});

describe('2. upgrade10_fast_window_calmed_seen fires exactly where a read is withdrawn', () => {
  it('on every hand of every replay, it fires if and only if a long-window read is withdrawn', () => {
    let withdrawals = 0;
    let hands = 0;
    for (const { v, s, from, to, rfi } of GRID)
      for (const c of replay(v, s, from, to, rfi)) {
        const w = withdrawn(c, v, s);
        expect(fired(() => read(c, v, s)).fired.has(CALMED)).toBe(w.length > 0);
        if (w.length) withdrawals++;
        hands++;
      }
    // The calm-downs reach the OFF switch; the gear shifts up do not.
    expect(withdrawals).toBeGreaterThan(0);
    expect(withdrawals).toBeLessThan(hands);
  });
  it('the back-inside OFF: a maniac whose last hands are folds', () => {
    const row = freshExploitCounters();
    for (let i = 0; i < 30; i++) decayAndAddOpportunityScoped(row, hand(1));
    const engaged = fired(() => read({ ...row }, 'nlh', 'full'));
    expect(engaged.value?.stats.pfr.engaged).toBe('high');
    expect(engaged.fired.has(CALMED)).toBe(false);
    let calmedAt = 0;
    for (let k = 1; k <= 30 && !calmedAt; k++) {
      decayAndAddOpportunityScoped(row, hand(0));
      const now = fired(() => read({ ...row }, 'nlh', 'full'));
      const w = withdrawn(row, 'nlh', 'full');
      expect(now.fired.has(CALMED)).toBe(w.length > 0);
      if (w.includes('pfr')) {
        calmedAt = k;
        expect(row.fHands).toBeGreaterThanOrEqual(8);
      }
    }
    expect(calmedAt).toBeGreaterThan(0);
  });
  for (const stat of ['rfi', 'threeBet'] as const)
    it(`the preflop-calm withdrawal: ${stat} with too few recent opportunities goes off with a calm preflop`, () => {
      const base = (fPfr: number): ExploitCounters => {
        const c = freshExploitCounters();
        c.hands = 60;
        c.vpip = 15;
        // Preflop raising at the Horse mean: the long pfr read is not engaged on either side.
        c.pfr = 60 * exploitEnvelopeFor(scopeOf('nlh', 'full'), 'nlh')!.pfr.mean;
        c.fHands = 12;
        c.fPfr = fPfr;
        if (stat === 'rfi') {
          c.rfiOpp = 20;
          c.rfi = 20;
          c.fRfiOpp = 2;
          c.fRfi = 2;
        } else {
          c.threeBetOpp = 30;
          c.threeBet = 25;
          c.fThreeBetOpp = 2;
          c.fThreeBet = 2;
        }
        return c;
      };
      // Long window: this statistic engaged, preflop raising not (so no other site can fire).
      const long = read(longOnly(base(0)), 'nlh', 'full');
      expect(long?.stats[stat].engaged).toBe('high');
      expect(long?.stats.pfr.engaged).toBeNull();
      // Calm preflop (no recent raise): withdrawn, counted.
      const calm = fired(() => read(base(0), 'nlh', 'full'));
      expect(calm.value?.stats[stat].engaged ?? null).toBeNull();
      expect(withdrawn(base(0), 'nlh', 'full')).toEqual([stat]);
      expect(calm.fired.has(CALMED)).toBe(true);
      // Recent preflop raising not credibly calm: the read stands, nothing counted.
      const hot = fired(() => read(base(6), 'nlh', 'full'));
      expect(hot.value?.stats[stat].engaged).toBe('high');
      expect(hot.fired.has(CALMED)).toBe(false);
    });
  it('the flop-stab OFF: fires when the fast window withdraws the stab read, and only then', () => {
    for (const v of VARIANTS) {
      const row = (fs: number): FlopStabCounters => ({
        flopCheckedToOpps: 60,
        flopBetCheckedTo: 55,
        fFlopCheckedToOpps: 12,
        fFlopBetCheckedTo: fs,
      });
      const scope = scopeOf(v, 'full');
      const long = flopStabStatRead({ ...row(0), fFlopCheckedToOpps: 0 }, scope, v);
      expect(long?.engaged).toBe('high');
      const calm = fired(() => flopStabStatRead(row(0), scope, v));
      expect(calm.value?.engaged).toBeNull();
      expect(calm.fired.has(CALMED)).toBe(true);
      const hot = fired(() => flopStabStatRead(row(12), scope, v));
      expect(hot.value?.engaged).toBe('high');
      expect(hot.fired.has(CALMED)).toBe(false);
      const few = fired(() =>
        flopStabStatRead({ ...row(0), fFlopCheckedToOpps: 4, fFlopBetCheckedTo: 0 }, scope, v)
      );
      expect(few.value?.engaged).toBe('high');
      expect(few.fired.has(CALMED)).toBe(false);
    }
  });
});

describe('3. the evidence mapping: what upgrade 10 is counted by', () => {
  it('the reach and the OFF switch are upgrade 10 invocations; the opportunity counter is not', () => {
    const needles = HORSE_UPGRADE_LIVE_EVIDENCE[UPGRADE_10]!;
    expect(needles).toContain("'holdem_gear_shift_reach_seen'");
    expect(needles).toContain(`'${CALMED}'`);
    expect(upgradeIdsForFires(['holdem_gear_shift_reach_seen'])).toEqual([UPGRADE_10]);
    expect(upgradeIdsForFires([CALMED])).toEqual([UPGRADE_10]);
    expect(upgradeIdsForFires(['upgrade10_fast_window_engaged'])).toEqual([UPGRADE_10]);
    expect(upgradeIdsForFires(['upgrade10_gear_shift_engaged'])).toEqual([UPGRADE_10]);
    expect(PER_HORSE_OPPORTUNITY_ONLY_NEEDLES.has("'upgrade10_fast_window_ready_seen'")).toBe(true);
    expect(upgradeIdsForFires(['upgrade10_fast_window_ready_seen'])).toEqual([]);
  });
  it('a read the 0.90 reach engages, and a read the window withdraws, are credited to upgrade 10', () => {
    let reach = false;
    for (const c of replay('nlh', 'full', 1, 1)) {
      const on = fired(() => read(c, 'nlh', 'full', { gearShift: true }));
      if (on.fired.has('holdem_gear_shift_reach_seen')) {
        reach = true;
        expect(upgradeIdsForFires(on.fired)).toContain(UPGRADE_10);
      }
    }
    expect(reach).toBe(true);
    let calmed = false;
    for (const c of replay('nlh', 'full', 100, 0)) {
      const off = fired(() => read(c, 'nlh', 'full'));
      if (off.fired.has(CALMED)) {
        calmed = true;
        expect(upgradeIdsForFires(off.fired)).toContain(UPGRADE_10);
      }
    }
    expect(calmed).toBe(true);
  });
});
