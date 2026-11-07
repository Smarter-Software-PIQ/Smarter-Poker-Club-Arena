import { describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  decayAndAdd,
  decayAndAddOpportunityScoped,
  exploitHandIncrements,
  freshExploitCounters,
  mergeExploitRows,
  observeExploitRow,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import {
  blendOpponentMemoryWithExpiry,
  computeDonorHandClockStaleness,
  MEMORY_VARIANTS,
  opponentMemoryKey,
  validOpponentProfile,
} from './HorseOpponentMemory.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from './HorseDecisionReadFrame.js';

const uid = '40000000-0000-4000-8000-000000000001';
function aggressive() {
  const counters = freshExploitCounters();
  const increments = exploitHandIncrements([
    { userId: uid, action: 'raise', stage: 'preflop' },
  ]).get(uid)!;
  for (let n = 0; n < 40; n++) decayAndAdd(counters, increments);
  return counters;
}
describe('variant and session durable opponent reads', () => {
  it('validates complete finite snapshots and stable game-specific identities', () => {
    const p = {
      user_id: uid,
      variant: 'plo5',
      mode: 'cash',
      size: 'short',
      observed_hands: 40,
      initialized: true,
      counters: aggressive(),
    };
    expect(validOpponentProfile(p)).toBe(true);
    expect(validOpponentProfile({ ...p, counters: { ...p.counters, pfr: Infinity } })).toBe(false);
    expect(validOpponentProfile({ ...p, observed_hands: NaN })).toBe(false);
    expect(MEMORY_VARIANTS).toEqual([
      'nlh',
      'plo4',
      'plo5',
      'plo6',
      'plo8',
      'flh',
      'flo8',
      'short_deck',
      'pineapple',
    ]);
    expect(
      new Set(MEMORY_VARIANTS.map((v) => opponentMemoryKey(uid, v, 'cash', 'short'))).size
    ).toBe(9);
  });
  it('retains the read through a portable frame, isolates PLO variants and cash/tournament contexts', () => {
    HorseMind.importDurableOpponentProfiles([
      {
        user_id: uid,
        variant: 'plo5',
        mode: 'cash',
        size: 'short',
        observed_hands: 40,
        initialized: true,
        counters: aggressive(),
      },
    ]);
    HorseMind.setDecisionScope('omaha:short', 'plo5');
    const expected = HorseMind.opponentRead(uid);
    expect(expected?.stats.pfr.engaged).toBe('high');
    HorseMind.setDecisionScope('omaha:short', 'plo4');
    const otherVariant = HorseMind.opponentRead(uid);
    expect(otherVariant?.presumed).toBe(true);
    expect(Object.values(otherVariant!.stats).every((stat) => stat.n === 0)).toBe(true);
    HorseMind.setDecisionScope('omaha:short', 'plo5', 'tournament');
    const otherMode = HorseMind.opponentRead(uid);
    expect(otherMode?.presumed).toBe(true);
    expect(Object.values(otherMode!.stats).every((stat) => stat.n === 0)).toBe(true);
    HorseMind.setDecisionScope(null);
    const players = [{ user_id: uid }];
    const view = HorseMind.snapshotDecisionReads(players as never, null);
    expect(view.exploit.get(opponentMemoryKey(uid, 'plo5', 'cash', 'short'))).toEqual(aggressive());
    expect(view.exploit.get(opponentMemoryKey(uid, 'plo4', 'cash', 'short'))).toEqual(
      freshExploitCounters()
    );
    expect(view.exploit.get(opponentMemoryKey(uid, 'plo5', 'tournament', 'short'))).toEqual(
      freshExploitCounters()
    );
    const frame = encodeHorseDecisionReads(view, players as never, null);
    const restored = decodeHorseDecisionReads(frame, players as never, null);
    // The second look has no access to the live map.
    HorseMind.runInSandbox(restored, () => {
      HorseMind.setDecisionScope('omaha:short', 'plo5');
      expect(HorseMind.opponentRead(uid)).toEqual(expected);
    });
  });
  it('bounds a second look to the current game context even with a broad durable cache', () => {
    HorseMind.enableDurableOpponentMemory();
    const players = [{ user_id: uid }];
    const view = HorseMind.snapshotDecisionReads(players as never, null, {
      variant: 'plo5',
      mode: 'cash',
      size: 'short',
    });
    expect(view.exploit.size).toBe(1);
    const frame = encodeHorseDecisionReads(view, players as never, null);
    expect(frame.bytes).toBeLessThan(10000);
    HorseMind.reset();
  });

  it('preserves rare-opportunity stats (riverCall, foldTo3Bet) under opportunity-scoped decay and tapers stale donor weights (Item 12)', () => {
    const counters = freshExploitCounters();
    // Simulate 15 river-call opportunities where villain called every time
    const riverInc = exploitHandIncrements([
      { userId: 'hero', action: 'bet', stage: 'river' },
      { userId: uid, action: 'call', stage: 'river' },
    ]).get(uid)!;
    for (let i = 0; i < 15; i++) {
      decayAndAddOpportunityScoped(counters, riverInc);
    }
    const savedRiverOpp = counters.riverCallOpp;
    const savedRiverCall = counters.riverCall;
    expect(savedRiverOpp).toBeGreaterThan(8);

    // Now simulate 60 preflop fold hands with ZERO river opportunities
    const preflopFoldInc = exploitHandIncrements([
      { userId: uid, action: 'fold', origin: 'player', stage: 'preflop' },
    ]).get(uid)!;
    for (let i = 0; i < 60; i++) {
      decayAndAddOpportunityScoped(counters, preflopFoldInc);
    }
    // Under opportunity-scoped decay, riverCallOpp and riverCall do NOT evaporate during preflop-only hands
    expect(counters.riverCallOpp).toBeCloseTo(savedRiverOpp, 9);
    expect(counters.riverCall).toBeCloseTo(savedRiverCall, 9);
    expect(
      validOpponentProfile({
        user_id: uid,
        variant: 'nlh',
        mode: 'cash',
        size: 'short',
        observed_hands: 75,
        initialized: true,
        counters,
      })
    ).toBe(true);

    // Staleness-weighted donor blend tapers both by exact.hands and by handsSinceDonorUpdate
    const donor = aggressive();
    const freshDonorBlend = blendOpponentMemoryWithExpiry(undefined, [donor], 0)!;
    const halfLifeDonorBlend = blendOpponentMemoryWithExpiry(undefined, [donor], 120)!;
    expect(halfLifeDonorBlend.hands).toBeCloseTo(freshDonorBlend.hands * 0.5, 6);

    // Donor hand clock staleness clamps negative or non-finite deltas (e.g. donor has 80 observed hands, new table has 2)
    expect(computeDonorHandClockStaleness(80, 2)).toBe(0);
    expect(computeDonorHandClockStaleness(80, 200)).toBe(120);
    expect(computeDonorHandClockStaleness(NaN, 100)).toBe(0);
    expect(blendOpponentMemoryWithExpiry(undefined, [donor], -78)!.hands).toBeCloseTo(
      freshDonorBlend.hands,
      9
    );

    // Wire opportunityScoped through observeExploitRow and mergeExploitRows across 100 mixed hands
    const liveStore = new Map<string, ExploitCounters>();
    for (let i = 0; i < 100; i++) {
      const sandbox = new Map<string, ExploitCounters>();
      const inc =
        i % 10 === 0
          ? exploitHandIncrements([
              { userId: 'hero', action: 'raise', stage: 'preflop', amount: 6, isFullRaise: true },
              { userId: uid, action: 'raise', stage: 'preflop', amount: 18, isFullRaise: true },
              { userId: 'hero', action: 'call', stage: 'preflop', amount: 12 },
              { userId: 'hero', action: 'bet', stage: 'river', amount: 20, isFullRaise: true },
              { userId: uid, action: i % 20 === 0 ? 'call' : 'fold', stage: 'river', amount: 20 },
            ]).get(uid)!
          : preflopFoldInc;
      observeExploitRow(sandbox, `holdem:short|${uid}`, inc, 100, true);
      mergeExploitRows(liveStore, sandbox, 100, true);
      const current = liveStore.get(`holdem:short|${uid}`)!;
      expect(
        validOpponentProfile({
          user_id: uid,
          variant: 'nlh',
          mode: 'cash',
          size: 'short',
          observed_hands: i + 1,
          initialized: true,
          counters: current,
        })
      ).toBe(true);
    }
  });
});
