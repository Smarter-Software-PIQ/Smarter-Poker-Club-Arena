import { createHash } from 'node:crypto';
import { horseDecisionEffectsAreValid } from '../HorseDecisionEffects.js';
import { describe, expect, it } from 'vitest';
import {
  HorseRequestRetentionBudget,
  HorseRequestCapacityError,
  combineHorseRequestAllowanceMetrics,
  horseRequestAllowance,
  horseRequestAllowanceMetrics,
  HORSE_REQUEST_MAX_BYTES,
  HORSE_REQUEST_MAX_NODES,
  HORSE_REQUEST_MAX_PENDING,
  HORSE_REQUEST_MAX_PLANS,
  HORSE_REQUEST_RETAINED_BYTES,
} from './requestRetentionBudget.js';
import { buildHorseDecisionKey, type HorseDecisionJobRequest } from './protocol.js';

// These tests exercise allocation ownership only; request semantics remain
// validated by the real client/worker integration suites.
const request = (requestId: number, type = 'STATUS', extra = {}): HorseDecisionJobRequest =>
  ({
    requestId,
    type,
    generation: 1,
    fence: 'budget-fixture',
    ...extra,
  }) as HorseDecisionJobRequest;
const effect = (id: number, fastId: number, type = 'COMMIT_DECISION_EFFECTS') =>
  request(id, type, { planBinding: { fastRequestId: fastId } });

describe('Horse request retention ownership', () => {
  it('bounds count even for tiny requests and admits again only after release', () => {
    const budget = new HorseRequestRetentionBudget();
    for (let id = 1; id <= HORSE_REQUEST_MAX_PENDING; id++) budget.reserve(request(id));
    expect(() => budget.reserve(request(3000))).toThrow(HorseRequestCapacityError);
    budget.release(1);
    budget.reserve(request(3000));
    expect(budget.status().requestCapacityRefusals).toBe(1);
  });

  it('bounds aggregate bytes before the count ceiling, without evicting an admitted request', () => {
    const budget = new HorseRequestRetentionBudget();
    const data = 'a'.repeat(100_000);
    let admitted = 0;
    while (admitted < HORSE_REQUEST_MAX_PENDING) {
      try {
        budget.reserve(request(admitted + 1, 'STATUS', { data }));
        admitted++;
      } catch (error) {
        expect(error).toBeInstanceOf(HorseRequestCapacityError);
        break;
      }
    }
    expect(admitted).toBeGreaterThan(1);
    expect(admitted).toBeLessThan(HORSE_REQUEST_MAX_PENDING);
    expect(budget.status().retainedRequestBytes).toBeLessThanOrEqual(HORSE_REQUEST_RETAINED_BYTES);
    for (let id = 1; id <= admitted; id++) budget.release(id);
    expect(budget.status().retainedRequestBytes).toBe(0);
  });

  it('retains an issued plan after its FAST response and reserves effects through a full ordinary backlog', () => {
    const budget = new HorseRequestRetentionBudget();
    budget.reserve(request(1, 'DECIDE_FAST'));
    budget.release(1, true);
    const reserved = budget.status().retainedRequestBytes;
    for (let id = 2; id < 2 + HORSE_REQUEST_MAX_PENDING; id++) budget.reserve(request(id));
    budget.reserve(effect(4000, 1));
    budget.reserve(effect(4001, 1, 'RETIRE_DECISION_EFFECTS'));
    expect(() => budget.reserve(effect(4002, 1))).toThrow(HorseRequestCapacityError);
    budget.release(4000, false, true);
    expect(budget.status().pendingPlanReservations).toBe(1);
    budget.release(4001, false, true);
    expect(budget.status().pendingPlanReservations).toBe(0);
    for (let id = 2; id < 2 + HORSE_REQUEST_MAX_PENDING; id++) budget.release(id);
    expect(reserved).toBeGreaterThan(0);
    expect(budget.status().retainedRequestBytes).toBe(0);
  });

  it('does not release an unknown commit at caller settlement or allow an unowned effect', () => {
    const budget = new HorseRequestRetentionBudget();
    budget.reserve(request(1, 'DECIDE_FAST'));
    budget.release(1, true);
    budget.reserve(effect(2, 1));
    // Actual nonterminal response / unposted expiry allows retirement, not reuse.
    budget.release(2);
    expect(budget.status().pendingPlanReservations).toBe(1);
    budget.reserve(effect(3, 1, 'RETIRE_DECISION_EFFECTS'));
    budget.release(3, false, true);
    expect(budget.status().retainedRequestBytes).toBe(0);
    expect(() => budget.reserve(effect(4, 1))).toThrow(HorseRequestCapacityError);
  });

  it('bounds outstanding issued plans independently of ordinary request completion', () => {
    const budget = new HorseRequestRetentionBudget();
    for (let id = 1; id <= HORSE_REQUEST_MAX_PLANS; id++) {
      budget.reserve(request(id, 'DECIDE_FAST'));
      budget.release(id, true);
    }
    expect(() => budget.reserve(request(500, 'DECIDE_FAST'))).toThrow(HorseRequestCapacityError);
    budget.reserve(effect(600, 1, 'RETIRE_DECISION_EFFECTS'));
    budget.release(600, false, true);
    budget.reserve(request(501, 'DECIDE_FAST'));
    budget.release(501); // no issued result / undispatched cancellation
    expect(budget.status().pendingPlanReservations).toBe(HORSE_REQUEST_MAX_PLANS - 1);
    budget.releaseTerminatedWorker();
    expect(budget.status().retainedRequestBytes).toBe(0);
  });

  it('refuses oversized, cyclic, deep, accessor and non-plain payloads without executing getters', () => {
    expect(() =>
      horseRequestAllowance('x'.repeat(Math.ceil(HORSE_REQUEST_MAX_BYTES / 6) + 1))
    ).toThrow(HorseRequestCapacityError);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => horseRequestAllowance(cycle)).toThrow(HorseRequestCapacityError);
    let reads = 0;
    const accessor = {
      get payload() {
        reads++;
        return 'hidden';
      },
    };
    expect(() => horseRequestAllowance(accessor)).toThrow(HorseRequestCapacityError);
    expect(reads).toBe(0);
    expect(() => horseRequestAllowance(new Uint8Array(3_000_000))).toThrow(
      HorseRequestCapacityError
    );
    expect(() => horseRequestAllowance(new Map())).toThrow(HorseRequestCapacityError);
    expect(() => horseRequestAllowance(Array(HORSE_REQUEST_MAX_NODES + 1))).toThrow(
      HorseRequestCapacityError
    );
  });

  it('reserves enough space for all sixteen maximum-size valid effects', () => {
    const cards = [...'23456789TJQKA'].flatMap((rank) => [...'cdhs'].map((suit) => rank + suit));
    const effects = Array.from({ length: 16 }, () => ({
      type: 'outlook',
      handKey: 'h'.repeat(256),
      userId: 'u'.repeat(256),
      street: 'river',
      good: cards,
      scare: cards,
    }));
    expect(horseDecisionEffectsAreValid(effects)).toBe(true);
    const budget = new HorseRequestRetentionBudget();
    budget.reserve(request(1, 'DECIDE_FAST'));
    budget.release(1, true);
    expect(() => budget.reserve(effect(2, 1))).not.toThrow();
    budget.release(2);
    expect(() =>
      budget.reserve(
        request(3, 'COMMIT_DECISION_EFFECTS', {
          effects,
          fence: 'f'.repeat(512),
          planBinding: {
            fastRequestId: 1,
            actorId: 'u'.repeat(256),
            fence: 'f'.repeat(512),
            decisionKey: 'phase5-v1:' + 'a'.repeat(64),
          },
          acceptance: {
            version: 'horse-plan-acceptance-v1',
            action: 'raise',
            amount: 100,
            witness: { requestId: 1, decisionKey: 'phase5-v1:' + 'a'.repeat(64) },
          },
        })
      )
    ).not.toThrow();
  });

  it('charges repeated data, escaped text and property names instead of trusting JSON character length', () => {
    const part = { value: '\\"\n'.repeat(30) };
    const input = { a: part, b: part, ['x'.repeat(200)]: 'é😀' };
    expect(horseRequestAllowance(input)).toBeGreaterThan(Buffer.byteLength(JSON.stringify(input)));
    expect(horseRequestAllowance(input)).toBeGreaterThan(horseRequestAllowance({ a: part }));
  });

  it('combineHorseRequestAllowanceMetrics matches full walk for disjoint spreads and reserve enforces prevalidated limits (1e532243)', () => {
    const base = {
      generation: 1,
      fence: 't1:h1:0:u1',
      nested: { arr: [1, 'two', { three: true }], flag: false },
    };
    const overlay = {
      type: 'DECIDE_FAST' as const,
      requestId: 42,
      ownPublicHistoryState: 'available' as const,
    };
    const combined = combineHorseRequestAllowanceMetrics(
      horseRequestAllowanceMetrics(base),
      horseRequestAllowanceMetrics(overlay)
    );
    const full = horseRequestAllowanceMetrics({ ...base, ...overlay });
    expect(combined).toEqual(full);

    // Overlapping top-level keys remain a conservative upper bound (>= full walk).
    const overlapping = combineHorseRequestAllowanceMetrics(
      horseRequestAllowanceMetrics({ ...base, type: 'IGNORED' }),
      horseRequestAllowanceMetrics(overlay)
    );
    expect(overlapping.bytes).toBeGreaterThanOrEqual(full.bytes);
    expect(overlapping.nodes).toBeGreaterThanOrEqual(full.nodes);

    // reserve() with prevalidated metrics still enforces EFFECT_BYTES, MAX_BYTES, MAX_NODES and tracks refusals.
    const budget = new HorseRequestRetentionBudget();
    budget.reserve(request(1, 'DECIDE_FAST'));
    budget.release(1, true);
    expect(() => budget.reserve(effect(2, 1), { bytes: 256 * 1024 + 1, nodes: 10 })).toThrow(
      HorseRequestCapacityError
    );
    expect(() =>
      budget.reserve(request(3, 'STATUS'), { bytes: 1024, nodes: HORSE_REQUEST_MAX_NODES + 1 })
    ).toThrow(HorseRequestCapacityError);
    expect(budget.status().requestCapacityRefusals).toBe(2);
  });

  it('chunked buildHorseDecisionKey produces byte-identical SHA-256 across >64 KiB multi-chunk Unicode payloads (1e532243)', () => {
    const canonical = (value: unknown): unknown => {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(canonical);
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        const v = (value as Record<string, unknown>)[k];
        if (v !== undefined) out[k] = canonical(v);
      }
      return out;
    };
    const largeNotes = Array.from({ length: 400 }, (_, i) => ({
      idx: i,
      label: `seat-${i}-♠♥♦♣-😀-${'x'.repeat(160)}`,
      amount: i === 0 ? -0 : i * 1.5,
      skipped: undefined,
    }));
    const input = {
      fence: 'chunk-parity-fence',
      decisionTimeMs: 1_764_298_000_000,
      player: { user_id: 'u1', seat: 1, stack: 1000, notes: largeNotes } as any,
      gameState: { pot: 50, board: ['As', 'Kd', 'Qc'], stage: 'flop' } as any,
      style: { aggression: 0.7 } as any,
      mods: { tag: 'parity-test' } as any,
      opts: { trace: true } as any,
    };
    const expectedMaterial = {
      schemaVersion: 1,
      fence: input.fence,
      decisionHour: Math.floor(input.decisionTimeMs / 3_600_000),
      player: input.player,
      gameState: input.gameState,
      style: input.style,
      mods: input.mods,
      opts: input.opts,
    };
    const canonicalJson = JSON.stringify(canonical(expectedMaterial));
    expect(canonicalJson.length).toBeGreaterThan(64 * 1024);
    const expectedKey = `phase5-v1:${createHash('sha256').update(canonicalJson).digest('hex')}`;
    expect(buildHorseDecisionKey(input)).toBe(expectedKey);
  });
});
