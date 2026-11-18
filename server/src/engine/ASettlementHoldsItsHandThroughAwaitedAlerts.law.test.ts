/**
 * SETTLEMENT HOLDS ITS HAND THROUGH AWAITED ALERTS (SWEEP-001, 2026-11-12).
 *
 * Same class as HVH2D-EXE-002. settleCompletedHand awaits a critical alert
 * when an insurance fee or an EV cashout redirect is larger than the stack it
 * is taken from. While it is suspended the dealing listener can clear the
 * engine's controller. Everything after the alert read the live field: the
 * insurance stack deltas were silently not applied to the hand's state and
 * the seven-deuce bounty block was skipped entirely, so the bounty was not
 * paid on that hand. Reachable only on a hand where one of those alerts
 * fires; not observed in production.
 *
 * settleCompletedHand now takes the controller reference once, before any
 * await, and every later read in the method uses that reference.
 *
 * The behavioural case drives a real ServerTableEngine and HandController
 * through a heads-up cash showdown where the alert fires, resolves a tick
 * late, and the controller is cleared during that tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../services/errorReporter.js', () => ({
  reportError: vi.fn(),
  describeError: (error: unknown) => String(error),
}));
const alertHooks = vi.hoisted(() => ({ duringAlert: null as null | (() => void) }));
vi.mock('../services/financialAlerts.js', () => ({
  raiseFinancialAlert: vi.fn(async () => {
    // The durable alert answers a tick later. In that tick the dealing
    // listener's release clears the engine's controller.
    await new Promise((resolve) => setTimeout(resolve, 5));
    alertHooks.duringAlert?.();
    return { persisted: false, alertId: null };
  }),
}));

import { ServerTableEngine } from './ServerTableEngine.js';
import { HandController } from './HandController.js';
import { raiseFinancialAlert } from '../services/financialAlerts.js';
import { getFullRakeConfig, getPlayerCountCaps } from '../config/RakeConfig.js';
import { waitFor } from '../testing/waitBudget.js';
import type { HandConfig, HandEvent, SeatPlayer } from '../types.js';

const SB = 1;
const BB = 2;
const TABLE = '9e020000-0000-4000-8000-000000000003';
const engines: Record<string, any>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network is not admitted in this isolated settlement test');
    })
  );
});
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.running = false;
    engine.insuranceEngine.disposeAll();
    engine.runItTwiceEngine.disposeAll();
    engine.preciseTimer.dispose();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function playACashShowdownWithAnInsuranceAlert() {
  const ids = ['p1', 'p2'];
  const rc = getFullRakeConfig(SB, BB, 'nlh');
  const engine = new ServerTableEngine(TABLE) as unknown as Record<string, any>;
  engines.push(engine);
  Object.assign(engine, {
    running: true,
    handCount: 1,
    tableInfo: {
      game_variant: 'nlh',
      small_blind: SB,
      big_blind: BB,
      max_players: 2,
      tournament_id: null,
      game_type: 'cash',
      run_it_twice: false,
      allow_run_it_twice: false,
      run_it_twice_enabled: false,
      insurance_enabled: false,
      bbj_percent: 100,
      arena: { id: 'synthetic-chip-arena', asset: 'chips', is_platform: true, union_id: null },
    },
    seatedPlayers: ids.map((user_id, i) => ({
      user_id,
      seat_number: i + 1,
      username: `P${i + 1}`,
      stack: 200,
      is_horse: false,
    })),
    hub: { emitEvent: () => undefined },
    allInFirstPauseMs: 1,
    allInStreetPauseMs: 1,
    allInStreetRevealMs: 1,
    allInPreShowdownPauseMs: 1,
    showdownSettleMs: 1,
  });
  engine.broadcastCurrentState = vi.fn();
  engine.markProgress = vi.fn();
  engine.killForRestart = vi.fn();
  engine.flushSnapshot = vi.fn().mockResolvedValue(undefined);
  engine.lifecycleCanMutate = () => true;
  // Persistence is not under test: what settlement HANDS to it is.
  engine.postHandTasks = vi.fn().mockResolvedValue(undefined);
  engine.claimBBJDrill = vi.fn(async () => null);
  // Every winner bought insurance whose fee is larger than any stack, which
  // is the under-collection the critical alert exists for.
  engine.insuranceEngine.settle = vi.fn((_table: string, winnerIds: string[]) =>
    winnerIds.map((playerId) => ({
      playerId,
      kind: 'insurance',
      won: true,
      payout: 0,
      premium: 1_000_000,
      insuredAmount: 10,
      equity: 0.5,
    }))
  );
  alertHooks.duringAlert = () => {
    engine.handController = null;
  };
  engine.applyRunItTwiceConfig();
  for (const id of ids) engine.atomicStackService.initializeStack(TABLE, id, 200);

  const players: SeatPlayer[] = ids.map((user_id, i) => ({
    user_id,
    seat: i + 1,
    username: `P${i + 1}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  const controller = new HandController(
    {
      tableId: TABLE,
      handNumber: 1,
      gameVariant: 'nlh',
      smallBlind: SB,
      bigBlind: BB,
      asset: 'chips',
      rakeConfig: {
        percent: rc.rakePercent,
        cap: rc.rakeCap,
        noFlopNoDrop: true,
        playerCountCaps: getPlayerCountCaps(rc.rakeCap, 2),
      },
      bbjConfig: {
        enabled: rc.bbjEnabled,
        feeBB: rc.bbjFeeBB,
        minPotBB: rc.rules.minPotBB,
        minPlayersDealt: rc.rules.minPlayersDealt,
      },
    } as HandConfig,
    players,
    1
  );
  engine.handController = controller;
  const applyStackDeltas = vi.spyOn(controller, 'applyStackDeltas');
  const events: HandEvent[] = [];
  const dispatch = new Set(['COMMUNITY_CARDS', 'SHOWDOWN', 'WINNERS', 'HAND_COMPLETE']);
  controller.onEvent((event) => {
    events.push(structuredClone(event));
    if (dispatch.has(event.type)) void engine.handleHandEvent(event, engine.seatedPlayers, 1);
  });
  controller.start();

  // Call, then check every street down to the river: a two-player showdown.
  for (let guard = 0; guard < 40 && !events.some((e) => e.type === 'HAND_COMPLETE'); guard++) {
    const state = controller.getState();
    const seat = state.currentPlayerSeat;
    const menu = controller.getAuthoritativeActionState(ids[seat - 1]);
    if (!menu) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      continue;
    }
    const action = menu.legalActions.includes('check') ? 'check' : 'call';
    expect(controller.performAction(seat, action as never, 0)).toBe(true);
  }
  expect(events.some((e) => e.type === 'SHOWDOWN')).toBe(true);
  await waitFor(
    () => (engine.postHandTasks as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    'settlement to reach the post-hand tasks'
  );
  return { engine, applyStackDeltas };
}

describe('settlement holds its hand through an awaited alert (SWEEP-001)', () => {
  it('still applies the insurance deltas to the hand it is settling after the controller is cleared', async () => {
    const { engine, applyStackDeltas } = await playACashShowdownWithAnInsuranceAlert();
    // The production ordering really happened: the alert was awaited and the
    // controller was cleared while settlement was suspended on it.
    expect(raiseFinancialAlert).toHaveBeenCalled();
    expect(
      (raiseFinancialAlert as ReturnType<typeof vi.fn>).mock.calls.some(
        (call) => call[1] === 'ServerTableEngine.insurance_premium_exceeds_stack'
      )
    ).toBe(true);
    expect(engine.handController).toBeNull();
    // Before the correction this was never called: the live field was null.
    const insuranceCalls = applyStackDeltas.mock.calls.filter(
      ([deltas]) => deltas instanceof Map && [...deltas.values()].some((delta) => delta < 0)
    );
    expect(insuranceCalls.length).toBeGreaterThan(0);
  });
});

describe('source law: settlement reads the live controller only before its first await', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./ServerTableEngineSettlement.ts', import.meta.url)),
    'utf8'
  );
  const settleStart = source.indexOf('private async settleCompletedHand(');
  const settleEnd = source.indexOf('protected async topUpPlo5Horses(');
  // Comments may name the field or the word await; the law is about code.
  const settle = source
    .slice(settleStart, settleEnd)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const holdLine = 'const settlingHand = this.handController;';
  const hold = settle.indexOf(holdLine);

  it('takes the reference before the first await', () => {
    expect(settleStart).toBeGreaterThan(-1);
    expect(settleEnd).toBeGreaterThan(settleStart);
    expect(settle.length).toBeGreaterThan(10_000);
    expect(hold).toBeGreaterThan(-1);
    expect(settle.search(/\bawait\b/)).toBeGreaterThan(hold);
  });

  it('never reads this.handController after taking it', () => {
    expect(settle.slice(hold + holdLine.length)).not.toMatch(/this\.handController/);
  });
});
