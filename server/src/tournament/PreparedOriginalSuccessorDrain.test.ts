import { afterEach, expect, it, vi } from 'vitest';
import { TournamentManager } from './TournamentManager.js';
import * as qualifiers from './satelliteQualifierRpc.js';
import { supabase } from '../services/supabase.js';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import { ServerTableEngine } from '../engine/ServerTableEngine.js';
import { HandController } from '../engine/HandController.js';
import type { GameServer } from '../GameServer.js';
import type { HandConfig, SeatPlayer } from '../types.js';

class Manager extends TournamentManagerBase {
  protected override startEliminationChecker(): void {}
  protected override async recalculateEliminatedPrizes(): Promise<boolean> {
    return true;
  }
}
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
  vi.restoreAllMocks();
});
function fixture() {
  const tableId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const event = 'aaaaaaaa-0000-4000-8000-000000000002';
  const handoff = vi.fn();
  const manager = new Manager(event, {
    handTournamentToSuccessorGeneration: handoff,
  } as unknown as GameServer) as any;
  manager.running = true;
  manager.tournamentLeaseAuthorityIsCurrent = () => true;
  const engine = new ServerTableEngine(tableId) as any;
  engine.running = true;
  engine.lifecycleCanMutate = () => true;
  engine.isCurrentEngine = () => true;
  const players = [1, 2].map((seat) => ({
    seat,
    user_id: `p${seat}`,
    username: `P${seat}`,
    stack: 100,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const controller = new HandController(
    {
      tableId,
      handNumber: 1,
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    1
  );
  engine.handController = controller;
  engine.handCount = 1;
  const original = { hand_number: '1', permit_id: 'aaaaaaaa-0000-4000-8000-000000000003' };
  engine.f06CurrentPermit = { binding: original, recoveryState: () => 'attempted' };
  // The production marker accepts only exact positively retained sequence-zero bytes.
  engine.markRetainedPreparedOriginal(controller, original, {
    version: 1,
    sequence: 0,
    controller: controller.serializeRecoveryState(),
    events: [],
    engine: {},
  });
  manager.tableEngines.set(tableId, engine);
  manager.wireEliminationWake(engine);
  cleanup.push(() => {
    engine.running = false;
    engine.resumeDealing();
    engine.engineTelemetry.dispose();
  });
  return { manager, engine, controller, handoff };
}

it.each([false, true])(
  'hands off a durably prepared original at its actual park (claimed=%s)',
  async (claimed) => {
    const { manager, engine, controller, handoff } = fixture();
    if (claimed)
      engine.pendingOriginalContinuation = {
        original: engine.f06CurrentPermit.binding,
        batch: { sequence: 0, events: [], controller: controller.serializeRecoveryState() },
      };
    manager.requestSuccessorDrain();
    expect(handoff).not.toHaveBeenCalled();
    const parked = engine.awaitPauseGate();
    expect(engine.isBetweenHands()).toBe(false);
    expect(JSON.parse(controller.serializeRecoveryState()).handStarted).toBe(false);
    expect(handoff).toHaveBeenCalledTimes(1);
    manager.completeSuccessorDrain();
    expect(handoff).toHaveBeenCalledTimes(1);
    engine.running = false;
    engine.resumeDealing();
    await parked;
  }
);

it.each([
  'started',
  'unconfirmed',
  'wrong-controller',
  'settling',
  'read-pending',
  'owner-lost',
  'permit-replaced',
  'permit-missing',
] as const)('does not hand off a %s original as an idle hand', async (scenario) => {
  const { manager, engine, controller, handoff } = fixture();
  if (scenario === 'started') controller.start();
  if (scenario === 'unconfirmed') engine.preparedOriginalRetentionUnconfirmed = true;
  if (scenario === 'wrong-controller') engine.retainedPreparedOriginalController = null;
  if (scenario === 'settling') engine.postHandTasksPromise = Promise.resolve();
  if (scenario === 'read-pending') engine.readContinuationTasks.add(Promise.resolve());
  if (scenario === 'owner-lost') engine.lifecycleCanMutate = () => false;
  if (scenario === 'permit-replaced') engine.f06CurrentPermit.binding = { hand_number: '2' };
  if (scenario === 'permit-missing') engine.f06CurrentPermit = null;
  manager.requestSuccessorDrain();
  const parked = engine.awaitPauseGate();
  manager.completeSuccessorDrain();
  expect(handoff).not.toHaveBeenCalled();
  engine.running = false;
  engine.resumeDealing();
  await parked;
});

it('parkForTerminalCloseout accepts a durably prepared sequence-zero original parked at the pause gate', async () => {
  const { manager, engine, controller } = fixture();
  manager.requestSuccessorDrain();
  const parked = engine.awaitPauseGate();
  expect(engine.isBetweenHands()).toBe(false);
  expect(JSON.parse(controller.serializeRecoveryState()).handStarted).toBe(false);
  expect(engine.isPreparedOriginalParkedForSuccessor()).toBe(true);
  await expect(engine.parkForTerminalCloseout(0)).resolves.toBe(true);
  engine.running = false;
  engine.releaseTerminalCloseoutPause();
  engine.resumeDealing();
  await parked;
});

it('completes successor drain when an already-parked prepared original finishes its in-flight settlement', async () => {
  const { manager, engine, handoff } = fixture();
  let resolveSettlement!: () => void;
  const settlement = new Promise<void>((resolve) => {
    resolveSettlement = resolve;
  });
  engine.postHandTasksPromise = settlement;
  engine.trackSettlementInFlight(settlement);
  manager.requestSuccessorDrain();
  const parked = engine.awaitPauseGate();
  expect(engine.isPreparedOriginalParkedForSuccessor()).toBe(false);
  expect(handoff).not.toHaveBeenCalled();

  resolveSettlement();
  await settlement;
  await Promise.resolve();
  expect(engine.isPreparedOriginalParkedForSuccessor()).toBe(true);
  expect(handoff).toHaveBeenCalledTimes(1);

  engine.running = false;
  engine.resumeDealing();
  await parked;
});

it('completes successor drain when pauseAfterHand(untilResumed) upgrades a table already parked on another pause owner', async () => {
  const { manager, engine, handoff } = fixture();
  engine.tournamentMovePauseOwners.add('move-owner');
  const parked = engine.awaitPauseGate();
  expect(engine.isPreparedOriginalParkedForSuccessor()).toBe(false);
  expect(handoff).not.toHaveBeenCalled();

  expect(manager.requestSuccessorDrain()).toBe(true);
  expect(engine.isPreparedOriginalParkedForSuccessor()).toBe(true);
  expect(handoff).toHaveBeenCalledTimes(1);

  engine.running = false;
  engine.tournamentMovePauseOwners.clear();
  engine.resumeDealing();
  await parked;
});

/*
 * 2026-11-05, Satellite 25 fbb86b2a: the qualifier boundary's closeout hold
 * (not a successor drain) held a prepared original at the gate, and
 * parkForTerminalCloseout never counted it as parked. The narrower predicate
 * names exactly that shape and nothing more.
 */
it('a prepared original held by the terminal closeout gate is named as held, not in the air', async () => {
  const { engine, controller } = fixture();
  void engine.parkForTerminalCloseout(0);
  const parked = engine.awaitPauseGate();
  expect(engine.isBetweenHands()).toBe(false);
  expect(JSON.parse(controller.serializeRecoveryState()).handStarted).toBe(false);
  expect(engine.isPreparedOriginalParkedForSuccessor()).toBe(false);
  await expect(engine.parkForTerminalCloseout(0)).resolves.toBe(false);
  expect(engine.isPreparedOriginalHeldAtTerminalCloseout()).toBe(true);
  engine.running = false;
  engine.releaseTerminalCloseoutPause();
  engine.resumeDealing();
  await parked;
});

it.each([
  'started',
  'no-closeout-hold',
  'not-at-gate',
  'wrong-controller',
  'settling',
  'owner-lost',
  'permit-replaced',
  'permit-missing',
  'continuation-batch',
] as const)('a %s original is never named held at the closeout gate', async (scenario) => {
  const { engine, controller } = fixture();
  if (scenario !== 'no-closeout-hold') void engine.parkForTerminalCloseout(0);
  if (scenario === 'started') controller.start();
  if (scenario === 'wrong-controller') engine.retainedPreparedOriginalController = null;
  if (scenario === 'settling') engine.postHandTasksPromise = Promise.resolve();
  if (scenario === 'owner-lost') engine.lifecycleCanMutate = () => false;
  if (scenario === 'permit-replaced') engine.f06CurrentPermit.binding = { hand_number: '2' };
  if (scenario === 'permit-missing') engine.f06CurrentPermit = null;
  if (scenario === 'continuation-batch') engine.handContinuation = {};
  const parked = scenario === 'not-at-gate' ? null : engine.awaitPauseGate();
  expect(engine.isPreparedOriginalHeldAtTerminalCloseout()).toBe(false);
  engine.handContinuation = null;
  engine.running = false;
  engine.releaseTerminalCloseoutPause();
  engine.resumeDealing();
  await parked;
});

it.each(['same', 'different permit', 'started', 'uncertain', 'replaced dealer'] as const)(
  'the entry-open qualifier rechecks the physical prepared original (%s)',
  async (scenario) => {
    const { engine, controller } = fixture();
    const event = 'aaaaaaaa-0000-4000-8000-000000000002';
    const manager: any = new TournamentManager(event, {} as GameServer);
    manager.running = true;
    manager.isCohortSatellite = () => true;
    manager.eliminationMutationAllowed = () => true;
    manager.tableEngines.set(engine.tableId, engine);
    manager.gameServer.getTableEngine = () => manager.tableEngines.get(engine.tableId);
    manager.advanceHandForHandBarrier = vi.fn();
    manager.declareConsolidationOutstanding = vi.fn();
    const settle = vi.spyOn(qualifiers, 'requestSatelliteQualifierReceipt');
    const query: any = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => Promise.resolve({ data: [{ id: engine.tableId }], error: null }),
    };
    vi.spyOn(supabase, 'from').mockReturnValue(query);
    vi.spyOn(qualifiers, 'readSatelliteQualifierState')
      .mockResolvedValueOnce({ state: 'entry_open' })
      .mockImplementationOnce(async () => {
        if (scenario === 'different permit') {
          engine.f06CurrentPermit = {
            ...engine.f06CurrentPermit,
            binding: {
              ...engine.f06CurrentPermit.binding,
              permit_id: 'aaaaaaaa-0000-4000-8000-000000000004',
            },
          };
        } else if (scenario === 'started') controller.start();
        else if (scenario === 'uncertain') engine.preparedOriginalRetentionUnconfirmed = true;
        else if (scenario === 'replaced dealer') manager.tableEngines.delete(engine.tableId);
        return { state: 'entry_open' };
      });
    manager.holdSatelliteQualifierBoundary();
    const parked = engine.awaitPauseGate();
    try {
      expect(await manager.checkSatelliteQualifierCompletion()).toBe(
        scenario === 'same' ? 'continue' : 'pending'
      );
      expect(engine.terminalCloseoutPaused).toBe(scenario !== 'same');
      expect(settle).not.toHaveBeenCalled();
    } finally {
      engine.running = false;
      engine.releaseTerminalCloseoutPause();
      engine.resumeDealing();
      await parked;
    }
  }
);
