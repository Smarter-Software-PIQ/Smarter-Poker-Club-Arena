/**
 * A SHOWDOWN HAND KEEPS ITS MEMORY DOMAIN (HVH2D-EXE-002, 2026-11-12).
 *
 * On ordinary cash tables every hand that reached a showdown was written with
 * public_memory_domain null: 589 of 589 in one production hour, against 0 of
 * 1,493 hands that ended without one. The opponent-memory learner skips a hand
 * without a valid domain, so Horses' exact opponent profiles on cash tables
 * were built only from hands that never showed cards.
 *
 * Cause: settlement awaits the jackpot drill on a cash showdown. During that
 * await the dealing listener releases the hand and clears the controller. The
 * post-hand tasks then read the live controller, found none, and wrote no
 * domain. A hand with no showdown has no such await, which is why only
 * showdowns were lost.
 *
 * settleCompletedHand now reads the hand's blind snapshot and all-in runout
 * witness before its first await and hands them to postHandTasks, which no
 * longer reads the live controller at all.
 *
 * The behavioural case drives a real ServerTableEngine and a real
 * HandController through a heads-up cash hand to showdown, with the drill
 * resolving a tick later and the controller cleared during that tick, exactly
 * as production orders it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../services/errorReporter.js', () => ({
  reportError: vi.fn(),
  describeError: (error: unknown) => String(error),
}));
vi.mock('../services/financialAlerts.js', () => ({
  raiseFinancialAlert: vi.fn(async () => ({ persisted: false, alertId: null })),
}));

import { ServerTableEngine } from './ServerTableEngine.js';
import { HandController } from './HandController.js';
import { publicMemoryDomainFromRules } from './HorsePublicMemoryDomain.js';
import { getFullRakeConfig, getPlayerCountCaps } from '../config/RakeConfig.js';
import { waitFor } from '../testing/waitBudget.js';
import type { HandConfig, HandEvent, SeatPlayer } from '../types.js';

const SB = 1;
const BB = 2;
const TABLE = '9e020000-0000-4000-8000-000000000002';
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

async function playACashShowdown() {
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
  // The jackpot drill answers a tick later, and in that tick the dealing
  // listener's release clears the controller, as it does in production.
  engine.claimBBJDrill = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    engine.handController = null;
    return null;
  });
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
  const blinds = controller.getBlindSnapshot();
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
  return { engine, blinds };
}

describe('a cash showdown keeps its memory domain (HVH2D-EXE-002)', () => {
  it('hands the post-hand tasks the blinds of its own hand after the controller is gone', async () => {
    const { engine, blinds } = await playACashShowdown();
    // The production ordering really happened: the drill was awaited and the
    // controller was cleared before the post-hand tasks were called.
    expect(engine.claimBBJDrill).toHaveBeenCalledTimes(1);
    expect(engine.handController).toBeNull();
    const [, , originalHand] = (engine.postHandTasks as ReturnType<typeof vi.fn>).mock.calls[0];
    // Before the correction there was no third argument and the row's domain was null.
    expect(originalHand).toBeDefined();
    expect(originalHand.blinds).toEqual(blinds);
    expect(
      publicMemoryDomainFromRules(
        'table',
        originalHand.blinds.ante,
        originalHand.blinds.bigBlindAnte
      )
    ).toEqual({ version: 1, speed: 'table', ante: 'none' });
    expect('allInRunoutWitness' in originalHand).toBe(true);
  });
});

describe('source law: the post-hand tasks never read the live controller', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./ServerTableEngineSettlement.ts', import.meta.url)),
    'utf8'
  );
  const from = (marker: string) => {
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return start;
  };
  const settleStart = from('private async settleCompletedHand(');
  const postStart = from('protected async postHandTasks(');
  const settle = source.slice(settleStart, postStart);
  // postHandTasks runs to the next class member declared at two-space indent.
  const rest = source.slice(postStart + 10);
  const next = rest.search(/\n  (private|protected|public) (async )?[A-Za-z_]+\(/);
  const post = next > -1 ? rest.slice(0, next) : rest;

  it('postHandTasks contains no read of this.handController', () => {
    expect(post.length).toBeGreaterThan(5_000);
    expect(post).not.toMatch(/this\.handController/);
  });

  it('settleCompletedHand takes the controller facts before its first await and passes them on', () => {
    const capture = settle.indexOf('const originalHand: OriginalHandFacts = {');
    const firstAwait = settle.search(/\bawait\b(?![^\n]*\*\/)/);
    expect(capture).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstAwait);
    expect(settle).toContain('this.postHandTasks(players, persistenceGeneration, originalHand)');
  });
});
