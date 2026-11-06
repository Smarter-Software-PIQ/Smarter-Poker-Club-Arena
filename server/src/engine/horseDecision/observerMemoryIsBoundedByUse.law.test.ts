/**
 * LAW: OBSERVER MEMORY IS BOUNDED BY USE, NOT BY ARRIVAL (2026-11-05)
 *
 * Engine 71087373, 4.7 hours up: eight decision workers at 583 to 937 MB of
 * old space each and rising about 90 MB per worker per hour. The growth was
 * HorseObserverReads.entries: every shard learns every completed hand on the
 * floor into every existing entry, the capacity caps were checked only when
 * the horse decided, eviction was by creation order, and a horse that stopped
 * deciding on a shard left a bank behind that learned the floor forever.
 *
 * These laws pin: an entry that has not decided for idleMs stops learning and
 * leaves; a completion that pushes an entry over capacity resets it the same
 * way a decision would; and pressure evicts the least recently run entry.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from '../HorseMind.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { HorseObserverReads } from './observerReads.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000001';
const opponent = '30000000-0000-4000-8000-000000000001';
const lease = '50000000-0000-4000-8000-000000000001';
const horse = (i: number) => `20000000-0000-4000-8000-${(i + 10).toString(16).padStart(12, '0')}`;
const committed = (i: number) => `40000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

function request(id: string, hand: number): FastHorseDecisionRequest {
  return {
    type: 'DECIDE_FAST',
    requestId: 1,
    generation: 7,
    fence: `${table}:${hand}:1:${lease}:7`,
    decisionKey: '',
    decisionTimeMs: 1000,
    handJournalContext: captureHorseHandJournalContext([]),
    player: { user_id: id, seat: 1 },
    gameState: {
      gameVariant: 'nlh',
      format: 'cash',
      gameMode: 'cash',
      dealtSeatIds: [1, 2],
      players: [
        { user_id: id, seat: 1 },
        { user_id: opponent, seat: 2 },
      ],
    },
  } as never;
}
function completion(hand: number): ObserveCompletedHandRequest {
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: hand,
    fence: `${table}:${hand}:${lease}:observe`,
    handKey: `${table}:${hand}`,
    committedHandId: committed(hand),
    actions: [],
    bigBlind: 2,
    results: [{ user_id: opponent, net: 20 }],
  };
}
const learn = (): void => {
  HorseMind.observe(
    [
      { userId: opponent, seat: 2, action: 'raise', amount: 8, stage: 'preflop', timestamp: 1 },
    ] as never,
    []
  );
};

type HandRecord = { entries: Set<unknown> };
type Internals = { entries: Map<string, unknown>; hands: Map<string, HandRecord> };
const internals = (bank: HorseObserverReads): Internals => bank as unknown as Internals;
/** Counts passes over the hand records: every call to hands.values(). */
function countHandPasses(bank: HorseObserverReads): () => number {
  const hands = internals(bank).hands;
  const values = hands.values.bind(hands);
  let passes = 0;
  hands.values = () => {
    passes++;
    return values();
  };
  return () => passes;
}
const referencedByAnyHand = (bank: HorseObserverReads, entry: unknown): boolean =>
  [...internals(bank).hands.values()].some((hand) => hand.entries.has(entry));
afterEach(() => HorseMind.reset());

describe('observer memory is bounded by use', () => {
  it('an entry that has not decided for idleMs stops learning and leaves', () => {
    let now = 1_000;
    const idleMs = 60_000;
    const bank = new HorseObserverReads(2048, 4096, () => now, idleMs);
    bank.run(request(horse(1), 1000001), () => undefined);
    bank.run(request(horse(1), 1000002), () => undefined);
    expect(bank.size()).toBe(1);
    // Still fresh: the completion is learned.
    now += idleMs;
    expect(bank.complete(completion(1000001), learn)).toBe(1);
    // Idle: the next completion that names this bank finds it idle, learns
    // nothing into it, and removes it.
    now += idleMs + 1;
    expect(bank.complete(completion(1000002), learn)).toBe(0);
    expect(bank.size()).toBe(0);
    bank.run(request(horse(1), 1000003), () =>
      expect(HorseMind.getStats(opponent), 'the returning horse starts fresh').toBeUndefined()
    );
  });

  it('the periodic sweep removes idle banks even when no hand names them', () => {
    let now = 1_000;
    const bank = new HorseObserverReads(2048, 4096, () => now, 60_000);
    for (let i = 0; i < 50; i++) bank.run(request(horse(i), 1000001 + i), () => undefined);
    expect(bank.size()).toBe(50);
    now += 60_001;
    expect(bank.sweepIdle()).toBe(50);
    expect(bank.size()).toBe(0);
  });

  it('a completion that takes an entry over capacity resets it like a decision would', () => {
    const bank = new HorseObserverReads(2048, 4096, () => 1000, 60_000);
    bank.run(request(horse(1), 1000001), () => undefined);
    // 513 distinct opponents learned purely through completions.
    for (let i = 0; i < 513; i++) {
      bank.complete(completion(1000001 + i), () => {
        HorseMind.observe(
          [
            {
              userId: `30000000-0000-4000-8000-${(i + 100).toString(16).padStart(12, '0')}`,
              seat: 2,
              action: 'raise',
              amount: 8,
              stage: 'preflop',
              timestamp: 1,
            },
          ] as never,
          []
        );
      });
    }
    bank.run(request(horse(1), 1000900), () => {
      expect(HorseMind.getStats(opponent)).toBeUndefined();
    });
    expect(bank.receipt(request(horse(1), 1000900))?.disposition).not.toBe('capacity_reset');
  });

  it('pressure evicts the least recently run entry, not the oldest created', () => {
    let now = 1_000;
    const bank = new HorseObserverReads(2, 4096, () => now, 10 * 60_000);
    bank.run(request(horse(1), 1000001), learn);
    now += 1;
    bank.run(request(horse(2), 1000002), learn);
    now += 1;
    // Horse 1 decides again: it is now the most recently run.
    bank.run(request(horse(1), 1000003), () => undefined);
    now += 1;
    bank.run(request(horse(3), 1000004), () => undefined);
    bank.run(request(horse(1), 1000005), () =>
      expect(HorseMind.getStats(opponent), 'horse 1 kept its bank').toBeDefined()
    );
    bank.run(request(horse(2), 1000006), () =>
      expect(HorseMind.getStats(opponent), 'horse 2 was evicted').toBeUndefined()
    );
  });

  it('idle sweep unlinks every evicted entry in ONE pass over the hand records', () => {
    let now = 1_000;
    const bank = new HorseObserverReads(2048, 4096, () => now, 60_000);
    // 200 banks, each bound to 3 live hand records (600 hands).
    for (let i = 0; i < 200; i++)
      for (let h = 0; h < 3; h++) bank.run(request(horse(i), 2000000 + i * 3 + h), () => undefined);
    const evicted = [...internals(bank).entries.values()];
    expect(evicted).toHaveLength(200);
    expect(internals(bank).hands.size).toBe(600);
    now += 60_001;
    const passes = countHandPasses(bank);
    expect(bank.sweepIdle()).toBe(200);
    expect(passes(), 'one pass over hands, not one per evicted entry').toBe(1);
    for (const entry of evicted) expect(referencedByAnyHand(bank, entry)).toBe(false);
  });

  it('a horse returning after idleMs drops its old bank from every hand record', () => {
    let now = 1_000;
    const bank = new HorseObserverReads(2048, 4096, () => now, 60_000);
    bank.run(request(horse(1), 3000001), () => undefined);
    bank.run(request(horse(1), 3000002), () => undefined);
    const [old] = internals(bank).entries.values();
    now += 60_001;
    const passes = countHandPasses(bank);
    bank.run(request(horse(1), 3000003), () => undefined);
    expect(passes()).toBe(1);
    expect(referencedByAnyHand(bank, old)).toBe(false);
  });

  it('complete() idle eviction leaves no hand record referencing the evicted bank', () => {
    let now = 1_000;
    const bank = new HorseObserverReads(2048, 4096, () => now, 60_000);
    bank.run(request(horse(1), 4000001), () => undefined);
    bank.run(request(horse(1), 4000002), () => undefined);
    const [old] = internals(bank).entries.values();
    expect(referencedByAnyHand(bank, old)).toBe(true);
    now += 60_001;
    const passes = countHandPasses(bank);
    // Hand 4000001 names the idle bank; it is evicted. Hand 4000002 must not
    // keep it reachable.
    expect(bank.complete(completion(4000001), learn)).toBe(0);
    expect(bank.size()).toBe(0);
    expect(passes()).toBe(1);
    expect(referencedByAnyHand(bank, old)).toBe(false);
    expect(bank.complete(completion(4000002), learn), 'nothing left to learn into').toBe(0);
  });

  it('pressure eviction unlinks the least recently run bank from the hand records', () => {
    let now = 1_000;
    const bank = new HorseObserverReads(2, 4096, () => now, 10 * 60_000);
    bank.run(request(horse(1), 5000001), () => undefined);
    now += 1;
    bank.run(request(horse(2), 5000002), () => undefined);
    const [lru] = internals(bank).entries.values();
    now += 1;
    bank.run(request(horse(3), 5000003), () => undefined);
    expect(bank.size()).toBe(2);
    expect(referencedByAnyHand(bank, lru)).toBe(false);
  });
});
