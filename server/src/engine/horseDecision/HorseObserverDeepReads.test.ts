/**
 * 2026-11-06 daily horse audit, finding 1: v16_reads_tell fired zero times
 * from 2026-11-01, and v16_reads_f3b / v16_reads_cbet / v23_river_read fell
 * to ~0.1-0.5% of their old floors, on the day observer-independent memory
 * (#8075, 2026-10-25) shipped. This pins the reason the ledger now records
 * instead of a defect: the deep reads are still WIRED through the private
 * observer sandbox. A horse that saw the sample itself reads it; a horse that
 * did not, reads nothing, however much the rest of the herd saw. That second
 * half is what made the reads rare, and it is the design (no horse reads
 * another horse's observations).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from '../HorseMind.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { HorseObserverReads } from './observerReads.js';
import { HORSE_DATA_LEDGER } from '../HorseDataLedger.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000011';
const watcher = '20000000-0000-4000-8000-000000000011';
const elsewhere = '20000000-0000-4000-8000-000000000012';
const opponent = '30000000-0000-4000-8000-000000000011';
const lease = '50000000-0000-4000-8000-000000000011';

function decide(id: string, hand: number): FastHorseDecisionRequest {
  return {
    type: 'DECIDE_FAST',
    requestId: hand,
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

function completed(
  hand: number,
  actions: ObserveCompletedHandRequest['actions'],
  showdown?: ObserveCompletedHandRequest['showdown']
): ObserveCompletedHandRequest {
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: hand,
    generation: hand,
    fence: `${table}:${hand}:${lease}:observe`,
    handKey: `${table}:${hand}`,
    committedHandId: `40000000-0000-4000-8000-${String(hand).padStart(12, '0')}`,
    actions,
    bigBlind: 2,
    results: [{ user_id: opponent, net: 0 }],
    ...(showdown ? { showdown } : {}),
  } as ObserveCompletedHandRequest;
}

/** The worker's learner, as workerRuntime wires it into bank.complete(). */
const learn = (r: ObserveCompletedHandRequest) =>
  HorseMind.observeHandComplete(r.handKey, r.actions, r.bigBlind, r.showdown, r.scope);

/** The watcher plays `hand` against the opponent and learns its completion. */
function play(
  bank: HorseObserverReads,
  hand: number,
  actions: ObserveCompletedHandRequest['actions'],
  showdown?: ObserveCompletedHandRequest['showdown']
) {
  bank.run(decide(watcher, hand), () => undefined);
  expect(bank.complete(completed(hand, actions, showdown), learn)).toBe(1);
}

afterEach(() => HorseMind.reset());

describe('observer-gated deep reads still fire for the horse that saw the sample', () => {
  it('v16_reads_f3b: eight of its own 3-bet opportunities make the read; another horse has none', () => {
    const bank = new HorseObserverReads(20, 20, () => 100);
    bank.run(decide(elsewhere, 1), () => undefined);
    for (let h = 1; h <= 8; h++)
      play(bank, 1000 + h, [
        { userId: opponent, action: 'raise', amount: 6, stage: 'preflop' },
        { userId: watcher, action: 'raise', amount: 20, stage: 'preflop' },
        { userId: opponent, action: h <= 6 ? 'fold' : 'call', amount: 14, stage: 'preflop' },
      ] as never);
    bank.run(decide(watcher, 2000), () =>
      expect(HorseMind.foldTo3BetOf(opponent)).toBeCloseTo(6 / 8, 5)
    );
    // The herd's other horse never saw these hands: no read, by design.
    bank.run(decide(elsewhere, 2001), () => expect(HorseMind.foldTo3BetOf(opponent)).toBeNull());
    // And nothing leaked into the process-wide mind.
    expect(HorseMind.foldTo3BetOf(opponent)).toBeNull();
  });

  it('seven opportunities are below the bar: the read stays null (the gate, not a wiring fault)', () => {
    const bank = new HorseObserverReads(20, 20, () => 100);
    for (let h = 1; h <= 7; h++)
      play(bank, 3000 + h, [
        { userId: opponent, action: 'raise', amount: 6, stage: 'preflop' },
        { userId: watcher, action: 'raise', amount: 20, stage: 'preflop' },
        { userId: opponent, action: 'fold', stage: 'preflop' },
      ] as never);
    bank.run(decide(watcher, 4000), () => expect(HorseMind.foldTo3BetOf(opponent)).toBeNull());
  });

  it('v16_reads_tell: five of its own big-river-bet showdowns make the tell; another horse has none', () => {
    const bank = new HorseObserverReads(20, 20, () => 100);
    bank.run(decide(elsewhere, 1), () => undefined);
    for (let h = 1; h <= 5; h++)
      play(
        bank,
        5000 + h,
        [
          { userId: opponent, action: 'bet', amount: 60, stage: 'river' },
          { userId: watcher, action: 'call', amount: 60, stage: 'river' },
        ] as never,
        [
          { user_id: opponent, mucked: false, hand_name: h <= 4 ? 'Two Pair' : 'High Card' },
          { user_id: watcher, mucked: false, hand_name: 'Pair' },
        ]
      );
    bank.run(decide(watcher, 6000), () =>
      expect(HorseMind.bigBetValueTendency(opponent)).toBeCloseTo(4 / 5, 5)
    );
    bank.run(decide(elsewhere, 6001), () =>
      expect(HorseMind.bigBetValueTendency(opponent)).toBeNull()
    );
    expect(HorseMind.bigBetValueTendency(opponent)).toBeNull();
  });
});

describe('the layer ledger records the gate instead of calling these layers dead', () => {
  const row = (key: string) => HORSE_DATA_LEDGER.find((e) => e.kind === 'receipt' && e.key === key);
  it('v16_reads_tell and the opt-in v62_river_bettor_polarity carry no floor', () => {
    for (const key of ['v16_reads_tell', 'v62_river_bettor_polarity']) {
      expect(row(key), key).toBeDefined();
      expect(row(key)!.minRatio, key).toBeUndefined();
      expect(row(key)!.ratioOf, key).toBeUndefined();
    }
  });
  it('the observer-gated reads keep a floor under the measured post-#8075 week, never the pooled one', () => {
    // Per decide, 2026-11-01..11-07: f3b min 0.026%, cbet min 0.011%, v23 min 0.033%,
    // v19 0.0135% after Hybrid v1. A floor above those would call the design dead daily;
    // no floor at all would hide a true zero.
    const measuredWeekMin: Record<string, number> = {
      v16_reads_f3b: 0.00026,
      v16_reads_cbet: 0.00011,
      v23_river_read: 0.00033,
      v19_overbet_polarity: 0.000135,
    };
    for (const [key, min] of Object.entries(measuredWeekMin)) {
      expect(row(key)!.ratioOf, key).toBe('decide');
      expect(row(key)!.minRatio, key).toBeGreaterThan(0);
      expect(row(key)!.minRatio!, key).toBeLessThan(min);
    }
  });
});
