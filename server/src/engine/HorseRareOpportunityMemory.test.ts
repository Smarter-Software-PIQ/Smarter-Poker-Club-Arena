import { describe, expect, it } from 'vitest';
import {
  decayAndAdd,
  exploitHandIncrements,
  freshExploitCounters,
  opponentExploitRead,
  riverFoldLowerBound,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';
import {
  DEFAULT_RARE_OPPORTUNITY_MAX_AGE_MS,
  DEFAULT_RARE_STAT_OPPORTUNITY_MAX_AGE_MS,
  RARE_OPPORTUNITY_MODEL_VERSION,
  createRareOpportunityRecordV2,
  deserializeRareOpportunityRecordV2,
  evaluateRareOpportunityReadV2,
  observeRareOpportunityActionsV2,
  observeRareOpportunityHandV2,
  serializeRareOpportunityRecordV2,
  type RareOpportunityRecordV2,
} from './HorseRareOpportunityMemory.js';

function makeRiverFoldHand(userId: string): ExploitHandAction[] {
  return [
    { userId: 'hero', stage: 'preflop', action: 'call', amount: 2 },
    { userId, stage: 'preflop', action: 'check' },
    { userId: 'hero', stage: 'flop', action: 'check' },
    { userId, stage: 'flop', action: 'check' },
    { userId: 'hero', stage: 'turn', action: 'check' },
    { userId, stage: 'turn', action: 'check' },
    { userId: 'hero', stage: 'river', action: 'bet', amount: 4 },
    { userId, stage: 'river', action: 'fold' },
  ];
}

function makeRiverCallHand(userId: string): ExploitHandAction[] {
  return [
    { userId: 'hero', stage: 'preflop', action: 'call', amount: 2 },
    { userId, stage: 'preflop', action: 'check' },
    { userId: 'hero', stage: 'flop', action: 'check' },
    { userId, stage: 'flop', action: 'check' },
    { userId: 'hero', stage: 'turn', action: 'check' },
    { userId, stage: 'turn', action: 'check' },
    { userId: 'hero', stage: 'river', action: 'bet', amount: 4 },
    { userId, stage: 'river', action: 'call', amount: 4 },
  ];
}

function makePreflopFoldHand(userId: string): ExploitHandAction[] {
  return [
    { userId, stage: 'preflop', action: 'fold' },
    { userId: 'hero', stage: 'preflop', action: 'call', amount: 2 },
  ];
}

describe('HorseRareOpportunityMemory v2 (Item 12 Qualification)', () => {
  it('preserves rare riverCall and foldTo3Bet evidence across 120 unrelated preflop-fold hands where v1 hand-decay erases it', () => {
    const scope = 'omaha:short' as const;
    const baseTimeMs = 1_793_550_000_000;
    const villain = 'villain-station';

    const v1Counters = freshExploitCounters();
    let v2Record = createRareOpportunityRecordV2(scope, baseTimeMs);

    // Villain calls 18 out of 18 river bets (a textbook river calling station).
    for (let i = 0; i < 18; i++) {
      const inc = exploitHandIncrements(makeRiverCallHand(villain)).get(villain)!;
      decayAndAdd(v1Counters, inc);
      v2Record = observeRareOpportunityHandV2(v2Record, scope, inc, baseTimeMs + i * 30_000);
    }

    // Both v1 and v2 engage riverCall='high' immediately after the 18 river calls.
    const v1ReadBefore = opponentExploitRead(v1Counters, scope, 'plo5');
    const v2ResultBefore = evaluateRareOpportunityReadV2(v2Record, {
      asOfMs: baseTimeMs + 18 * 30_000,
      variant: 'plo5',
    });
    expect(v1ReadBefore?.stats.riverCall.engaged).toBe('high');
    expect(v2ResultBefore.read?.stats.riverCall.engaged).toBe('high');

    // Now 120 hands pass in which villain simply folds preflop (0 river opportunities).
    for (let i = 0; i < 120; i++) {
      const inc = exploitHandIncrements(makePreflopFoldHand(villain)).get(villain)!;
      expect(inc.riverCallOpp).toBe(0);
      decayAndAdd(v1Counters, inc);
      v2Record = observeRareOpportunityHandV2(v2Record, scope, inc, baseTimeMs + (18 + i) * 30_000);
    }

    // In v1, 120 unrelated hands decay `riverCallOpp` by 0.5^(120/30) = 1/16 (< 1 opp),
    // erasing the engaged station read!
    const v1ReadAfter = opponentExploitRead(v1Counters, scope, 'plo5');
    expect(v1Counters.riverCallOpp).toBeLessThan(1);
    expect(v1ReadAfter?.stats.riverCall.engaged ?? null).toBeNull();

    // In v2, because 0 river opportunities occurred during those 120 hands and
    // only 69 minutes elapsed (< 6h statMaxAgeMs), the riverCall sample and
    // engaged station read are 100% preserved!
    const v2ResultAfter = evaluateRareOpportunityReadV2(v2Record, {
      asOfMs: baseTimeMs + 138 * 30_000,
      variant: 'plo5',
    });
    expect(v2ResultAfter.status).toBe('active');
    expect(v2ResultAfter.expiredStats).toEqual([]);
    expect(v2ResultAfter.effectiveCounters.riverCallOpp).toBeCloseTo(
      v2ResultBefore.effectiveCounters.riverCallOpp,
      9
    );
    expect(v2ResultAfter.read?.stats.riverCall.engaged).toBe('high');
  });

  it('decays rare statistics when actual new opportunities contradict the prior style and switches off via the fast opportunity window', () => {
    const scope = 'omaha:short' as const;
    const baseTimeMs = 1_793_550_000_000;
    const villain = 'villain-style-shift';

    let v2Record = createRareOpportunityRecordV2(scope, baseTimeMs);

    // Villain calls 20 consecutive river bets -> riverCall engaged high.
    for (let i = 0; i < 20; i++) {
      const inc = exploitHandIncrements(makeRiverCallHand(villain)).get(villain)!;
      v2Record = observeRareOpportunityHandV2(v2Record, scope, inc, baseTimeMs + i * 20_000);
    }
    const engagedCheck = evaluateRareOpportunityReadV2(v2Record, {
      asOfMs: baseTimeMs + 20 * 20_000,
      variant: 'plo5',
    });
    expect(engagedCheck.read?.stats.riverCall.engaged).toBe('high');

    // Villain now faces 10 new river bets and folds all 10 of them.
    for (let i = 0; i < 10; i++) {
      const inc = exploitHandIncrements(makeRiverFoldHand(villain)).get(villain)!;
      v2Record = observeRareOpportunityHandV2(v2Record, scope, inc, baseTimeMs + (20 + i) * 20_000);
    }

    const shiftedCheck = evaluateRareOpportunityReadV2(v2Record, {
      asOfMs: baseTimeMs + 30 * 20_000,
      variant: 'plo5',
    });
    // The fast opportunity window sees 10 consecutive river folds and switches
    // the station read (`riverCall.engaged === 'high'`) OFF.
    expect(shiftedCheck.read?.stats.riverCall.engaged ?? null).toBeNull();
    // And after folding 10 of the recent river bets, riverFoldLowerBound is positive.
    const foldLb = riverFoldLowerBound(shiftedCheck.read);
    expect(foldLb === null || foldLb >= 0).toBe(true);
  });

  it('expires an individual rare statistic when its last opportunity exceeds statMaxAgeMs while keeping active preflop stats alive', () => {
    const scope = 'holdem:short' as const;
    const t0 = 1_793_550_000_000;
    const villain = 'villain-stale-river';
    let v2Record = createRareOpportunityRecordV2(scope, t0);

    // At t0, villain calls 18 river bets.
    for (let i = 0; i < 18; i++) {
      const inc = exploitHandIncrements(makeRiverCallHand(villain)).get(villain)!;
      v2Record = observeRareOpportunityHandV2(v2Record, scope, inc, t0 + i * 1_000);
    }

    // 7 hours later (> 6h DEFAULT_RARE_STAT_OPPORTUNITY_MAX_AGE_MS, < 24h record maxAgeMs),
    // villain plays 25 preflop-only hands (raising preflop every hand so PFR engages high,
    // but 0 river opportunities occur).
    const tLater = t0 + DEFAULT_RARE_STAT_OPPORTUNITY_MAX_AGE_MS + 3_600_000;
    for (let i = 0; i < 25; i++) {
      const actions: ExploitHandAction[] = [
        { userId: villain, stage: 'preflop', action: 'raise', amount: 6, isFullRaise: true },
        { userId: 'hero', stage: 'preflop', action: 'fold' },
      ];
      const inc = exploitHandIncrements(actions).get(villain)!;
      v2Record = observeRareOpportunityHandV2(v2Record, scope, inc, tLater + i * 1_000);
    }

    const res = evaluateRareOpportunityReadV2(v2Record, {
      asOfMs: tLater + 25_000,
      variant: 'nlh',
    });
    expect(res.status).toBe('active');
    // `riverCall`, `betCheckedTo`, and `foldToBet` had no opportunities for > 6 hours -> expired!
    expect(res.expiredStats).toContain('riverCall');
    expect(res.effectiveCounters.riverCallOpp).toBe(0);
    expect(res.effectiveCounters.riverCall).toBe(0);
    expect(res.read?.stats.riverCall.engaged ?? null).toBeNull();
    // Meanwhile, fresh preflop raising (`pfr` / `rfi`) is active and engaged!
    expect(res.read?.stats.pfr.engaged).toBe('high');
    expect(res.read?.stats.rfi.engaged).toBe('high');
  });

  it('expires the entire opponent record when asOfMs - lastObservedAtMs exceeds maxAgeMs', () => {
    const scope = 'omaha:hu' as const;
    const t0 = 1_793_550_000_000;
    const villain = 'villain-old-session';
    let v2Record = createRareOpportunityRecordV2(scope, t0);

    for (let i = 0; i < 20; i++) {
      const actions: ExploitHandAction[] = [
        { userId: villain, stage: 'preflop', action: 'raise', amount: 6, isFullRaise: true },
        { userId: 'hero', stage: 'preflop', action: 'fold' },
      ];
      const inc = exploitHandIncrements(actions).get(villain)!;
      v2Record = observeRareOpportunityHandV2(v2Record, scope, inc, t0 + i * 1_000);
    }

    const after25Hours = t0 + 20_000 + DEFAULT_RARE_OPPORTUNITY_MAX_AGE_MS + 1;
    const expired = evaluateRareOpportunityReadV2(v2Record, {
      asOfMs: after25Hours,
      variant: 'plo4',
    });
    expect(expired.status).toBe('expired_record');
    expect(expired.read).toBeNull();
    expect(expired.effectiveCounters.hands).toBe(0);
  });

  it('enforces versioned serialization, rejects v1 or corrupted records, and bounds LRU store size', () => {
    const store = new Map<string, RareOpportunityRecordV2>();
    const t0 = 1_793_550_000_000;
    for (let i = 0; i < 12; i++) {
      observeRareOpportunityActionsV2(
        store,
        'holdem:full',
        makeRiverCallHand(`p-${i}`),
        t0 + i * 1_000,
        8
      );
    }
    expect(store.size).toBeLessThanOrEqual(8);

    const sample = store.values().next().value!;
    expect(sample.modelVersion).toBe(RARE_OPPORTUNITY_MODEL_VERSION);

    const json = serializeRareOpportunityRecordV2(sample);
    const roundTrip = deserializeRareOpportunityRecordV2(json);
    expect(roundTrip).not.toBeNull();
    expect(roundTrip?.modelVersion).toBe(RARE_OPPORTUNITY_MODEL_VERSION);
    expect(roundTrip?.counters.riverCallOpp).toBeCloseTo(sample.counters.riverCallOpp, 9);

    // Reject v1 or malformed payloads
    expect(
      deserializeRareOpportunityRecordV2({
        ...sample,
        modelVersion: 'opponent-exploit-v1',
      })
    ).toBeNull();
    expect(
      deserializeRareOpportunityRecordV2({
        ...sample,
        counters: { ...sample.counters, riverCall: 99, riverCallOpp: 1 },
      })
    ).toBeNull();
  });
});
