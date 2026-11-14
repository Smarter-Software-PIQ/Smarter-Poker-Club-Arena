/**
 * STYLE READ, PRE-REPAIR (2026-11-14): the fold-rate stand-down (styleFoldRatePreRepair) reaches every reader of the
 * stored fold-to-bet figure, not only the lifetime branch: the opponent-exploit read's over-folder increase and the
 * river bluff's opponent profile. Synthetic players only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import { v54OpponentProfile } from './HorseLogic.js';
import { postflopBluffMod } from './HorseOpponentExploit.js';
import { VILLAIN } from './HorseOpponentStyle.contexts.test-support.js';
import { counters } from './HorseOpponentStyle.test-support.js';

const drain = (): Record<string, number> => {
  enableBrainTelemetry();
  return Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
};
interface Setup {
  /** stored fold-to-bet: folds of 40 opportunities */
  folds: number;
  /** post-release fold-to-bet opportunities (null: none supplied) */
  m: number | null;
  /** lifetime folds of 50 spots facing aggression */
  lifetimeFolds?: number;
  speed?: string;
}
function install(s: Setup): void {
  HorseMind.reset();
  HorseMind.importStats([
    {
      user_id: VILLAIN,
      hands: 100,
      folds: s.lifetimeFolds ?? 25,
      facedAggr: 50,
      riverBetOpps: 14,
      riverBetFolds: 5,
    } as never,
  ]);
  HorseMind.importDurableOpponentProfiles([
    {
      user_id: VILLAIN,
      variant: 'nlh',
      mode: 'cash',
      size: 'full',
      observed_hands: 80,
      initialized: true,
      public_memory_domain: { version: 1, speed: s.speed ?? 'table', ante: 'none' },
      counters: counters({ hands: 80, vpip: 0.2, pfr: 0.14, foldToBetOpp: 40, foldToBet: s.folds }),
    } as never,
  ]);
  if (s.m !== null)
    HorseMind.importPostReleaseObservations([
      {
        user_id: VILLAIN,
        variant: 'nlh',
        mode: 'cash',
        size: 'full',
        opportunities: { foldToBet: s.m },
      },
    ]);
  HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
}
function exploit(s: Setup, on: boolean) {
  install(s);
  drain();
  const e = HorseMind.exploit(VILLAIN, true, on ? { styleFoldRatePreRepair: true } : {});
  const read = postflopBluffMod(HorseMind.opponentRead(VILLAIN));
  const fires = drain();
  HorseMind.setDecisionScope(null);
  return { e, read, fires };
}
afterEach(() => HorseMind.reset());

describe('the pre-repair stand-down reaches the opponent-exploit read', () => {
  const overFolder: Setup = { folds: 38, m: null };

  it('off: a stored 95 percent fold-to-bet raises the bluff multiplier through the read', () => {
    const off = exploit(overFolder, false);
    expect(off.read).not.toBeNull();
    expect(off.read!).toBeGreaterThanOrEqual(1.2);
    expect(off.e.bluffMod).toBe(off.read);
  });

  it('on, pre-repair profile with fewer than 60 post-release opportunities: the increase is withheld, with the receipt', () => {
    for (const m of [null, 30, 59]) {
      const on = exploit({ ...overFolder, m }, true);
      expect(on.e.bluffMod, String(m)).toBe(1);
      // the thin-value cut the read takes from the same figure is withheld with it
      expect(on.e.valueThinMod, String(m)).toBe(1);
      expect(on.fires.style_pre_repair_fold_rate_discounted_seen, String(m)).toBeGreaterThan(0);
    }
  });

  it('on, once 60 post-release opportunities are in: the read is used again', () => {
    const off = exploit({ ...overFolder, m: 120 }, false);
    const on = exploit({ ...overFolder, m: 120 }, true);
    expect(on.e).toEqual(off.e);
    expect(on.fires.style_pre_repair_fold_rate_discounted_seen ?? 0).toBe(0);
  });

  it('on, a profile that is not pre-repair (Lightning): the read is used', () => {
    const off = exploit({ ...overFolder, speed: 'lightning' }, false);
    const on = exploit({ ...overFolder, speed: 'lightning' }, true);
    expect(on.e).toEqual(off.e);
  });

  it('a station keeps its decrease, on or off', () => {
    const station: Setup = { folds: 2, m: null, lifetimeFolds: 10 };
    const off = exploit(station, false);
    const on = exploit(station, true);
    expect(off.e.bluffMod).toBeLessThan(1);
    expect(on.e).toEqual(off.e);
  });
});

describe('the pre-repair stand-down reaches the river bluff profile', () => {
  // lifetime: folds 80 percent of the time facing aggression (the legacy over-folder line); stored fold-to-bet neutral
  const lifetimeFolder: Setup = { folds: 22, m: 30, lifetimeFolds: 40 };

  it('off: the lifetime fold rate makes him a folder for the river bluff', () => {
    install(lifetimeFolder);
    expect(v54OpponentProfile(VILLAIN, true, true)).toBe('folder');
    expect(v54OpponentProfile(VILLAIN, true, true, false)).toBe('folder');
  });

  it('on: a pre-repair profile is not a folder on that figure', () => {
    install(lifetimeFolder);
    expect(v54OpponentProfile(VILLAIN, true, true, true)).toBe('neutral');
  });

  it('on, discount lifted: a folder again', () => {
    install({ ...lifetimeFolder, m: 120 });
    expect(v54OpponentProfile(VILLAIN, true, true, true)).toBe('folder');
  });
});
