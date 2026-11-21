/**
 * THE POOL COUNT, WIRED THROUGH THE REAL HOST (review F1 / F6, 2026-11-19).
 *
 * A fast-table hand runs through the real host and the real HandController,
 * with a scripted lane. Pinned here:
 *   - a floored game's snapshot carries lightningVpipFloor on every ask, and
 *     an unfloored game's snapshot never does;
 *   - a hand is counted once per player, whether it ended at the player's
 *     fold or at settlement;
 *   - a folder's hand is counted at the fold, before the hand settles, so the
 *     next hand the fast fold deals it already sees that hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FastHorseDecisionResult,
  LiveHorseDecisionLane,
  LiveHorseDecisionSnapshot,
} from '../engine/horseDecision/index.js';
import type { HorseDecision } from '../types.js';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the Lightning host fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the Lightning host fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const kit = await import('../testing/lightningHostTestKit.js');
const { LightningHorseVpipLedger } = await import('./LightningHorseVpipLedger.js');
const { buildHost, formedHand, flush } = kit;

afterEach(() => {
  vi.useRealTimers();
});

const gs = (snap: LiveHorseDecisionSnapshot) =>
  snap.gameState as unknown as { toCall: number; lightningVpipFloor?: unknown };
const foldWhenOwing = (snap: LiveHorseDecisionSnapshot) =>
  gs(snap).toCall > 0 ? { action: 'fold' } : { action: 'check' };

function scriptedLane() {
  const calls: LiveHorseDecisionSnapshot[] = [];
  const lane = {
    decideFast: vi.fn(async (snap: LiveHorseDecisionSnapshot) => {
      calls.push(snap);
      return {
        type: 'FAST_RESULT',
        requestId: calls.length,
        generation: snap.generation,
        fence: snap.fence,
        decision: { ...foldWhenOwing(snap), thinkTime: 300 } as unknown as HorseDecision,
        planBinding: null,
        planIssueDisposition: 'no_effects',
        effects: [],
        rngBefore: 0,
        rngAfter: 0,
        computeMs: 1,
        governorScale: 1,
      } as unknown as FastHorseDecisionResult;
    }),
    commitDecisionEffects: vi.fn(async () => ({ type: 'ACK' }) as never),
    runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
    observeCompletedHand: vi.fn(async () => ({ type: 'ACK' }) as never),
  };
  return { lane: lane as unknown as LiveHorseDecisionLane, calls };
}

async function playHand(
  base: number,
  ledger: InstanceType<typeof LightningHorseVpipLedger>,
  rules: Record<string, unknown>
) {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  const formed = formedHand(6, base);
  const scripted = scriptedLane();
  const records: Array<{ who: string[]; hand: number | null | undefined; settled: boolean }> = [];
  const real = ledger.record.bind(ledger);
  let settled = false;
  ledger.record = (participants, actions, hand) => {
    records.push({ who: participants.map((p) => p.playerId), hand, settled });
    real(participants, actions, hand);
  };
  const t = buildHost(
    formed,
    Array.from({ length: 6 }, () => 100),
    {
      horses: new Set(formed.players),
      rules,
      deps: { horseLane: () => scripted.lane, random: () => 0.5, horseVpipLedger: ledger },
    }
  );
  await t.host.start();
  for (let i = 0; i < 1_800 && t.host.lifecycle === 'dealing'; i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    await flush(4);
  }
  settled = true;
  expect(t.host.lifecycle).toBe('complete');
  const participants = [
    ...(
      t.host as unknown as {
        participants: Map<string, { playerId: string; poolSessionId: string }>;
      }
    ).participants.values(),
  ];
  ledger.record = real;
  return { scripted, records, participants };
}

const FLOORED = { nit_game: true, maintain_percent_min: 40, maintain_hands: 10 };

describe('the pool count through the real host', () => {
  it('a floored game carries the floor on every ask, and every hand counts once per player', async () => {
    const ledger = new LightningHorseVpipLedger();
    const first = await playHand(8100, ledger, FLOORED);
    expect(first.scripted.calls.length).toBeGreaterThan(0);
    for (const snap of first.scripted.calls)
      expect(gs(snap).lightningVpipFloor).toMatchObject({
        floor: 40,
        windowHands: 10,
        own: { hands: 0, vpipHands: 0, leavingEntered: false, fromFirstHand: false },
      });
    for (const p of first.participants) expect(ledger.read(p.poolSessionId).hands).toBe(1);
    // the folders were counted at their fold, one player at a time, before settlement
    const atFold = first.records.filter((r) => r.who.length === 1);
    expect(atFold.length).toBeGreaterThan(0);
    // every record of this hand carries its hand number
    const hands = new Set(first.records.map((r) => r.hand));
    expect(hands.size).toBe(1);
    expect([...hands][0]).toEqual(expect.any(Number));
    // a second hand of the same sittings: each counts two, and its window sees both
    const second = await playHand(8100, ledger, FLOORED);
    for (const snap of second.scripted.calls)
      expect(gs(snap).lightningVpipFloor).toMatchObject({
        floor: 40,
        windowHands: 10,
        own: { hands: 1, fromFirstHand: false },
      });
    for (const p of second.participants) {
      expect(ledger.read(p.poolSessionId).hands).toBe(2);
      expect(ledger.readWindow(p.poolSessionId, 9).hands).toBe(2);
    }
  });

  it('a new sitting first seen >120 s after first ledger activity carries fromFirstHand: true in the snapshot (review F3)', async () => {
    let clock = 1_000_000;
    const ledger = new LightningHorseVpipLedger(256, () => clock);
    // Warm up the ledger with another sitting so firstActivityAt is 1_000_000.
    ledger.readWindow('warmup-sitting', 9);
    // Advance past the 120 s carried-over grace window before the new sittings first appear.
    clock += 130_000;
    const fresh = await playHand(8150, ledger, FLOORED);
    expect(fresh.scripted.calls.length).toBeGreaterThan(0);
    for (const snap of fresh.scripted.calls)
      expect(gs(snap).lightningVpipFloor).toMatchObject({
        floor: 40,
        windowHands: 10,
        own: { hands: 0, vpipHands: 0, leavingEntered: false, fromFirstHand: true },
      });
  });

  it('an unfloored game never carries the field (owner 2026-11-18 11:03)', async () => {
    const ledger = new LightningHorseVpipLedger();
    const hand = await playHand(8200, ledger, { nit_game: false, maintain_percent_min: 40 });
    expect(hand.scripted.calls.length).toBeGreaterThan(0);
    for (const snap of hand.scripted.calls) expect(gs(snap).lightningVpipFloor).toBeUndefined();
  });
});
