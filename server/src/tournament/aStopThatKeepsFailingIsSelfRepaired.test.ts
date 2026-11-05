/**
 * A STOP THAT KEEPS FAILING DOES NOT KEEP THE EVENT (2026-11-05).
 *
 * 13:57Z on 2026-11-05: PLO4 Spin 312a52c3's table 4f1f0fa6 lost the reply to
 * a hand-continuation write. Its engine stop threw "retains unproven original
 * hand custody" before giving its process slot back, so every manager stop
 * failed "retained time-bank custody" (the bank write refuses while any engine
 * holds the slot). The quarantine re-offered the same stop for sixteen minutes
 * until the whole container was restarted by hand - twice that afternoon.
 *
 * These cases pin the self-repair: after QUARANTINE_SELF_REPAIR_ATTEMPT
 * charged attempts, the quarantine's own retry evicts the fenced manager,
 * writes the stopped banks down, releases exactly its lease generation and
 * frees the slot for the ordinary resume path - and refuses, changing nothing,
 * whenever a guard says the rebuild could not see everything.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GameServer } from '../GameServer.js';
import { selfRepairedTournamentManagerEvictions } from './TournamentManagerOwnership.js';
import {
  QUARANTINE_SELF_REPAIR_ATTEMPT,
  QuarantinedTournamentManagers,
} from './quarantinedTournamentManagers.js';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import * as leases from '../services/tournamentLease.js';

const RETRY = 'GameServer.quarantined_tournament_manager_stop_retry';
const tournamentId = 'aaaaaaaa-0000-4000-8000-000000000011';
const otherTournamentId = 'aaaaaaaa-0000-4000-8000-000000000022';
const generation = 'bbbbbbbb-0000-4000-8000-000000000011';
const otherGeneration = 'bbbbbbbb-0000-4000-8000-000000000022';
const TABLE = '4f1f0fa6-0000-4000-8000-000000000011';

const reported = vi.hoisted(() => [] as Array<{ message: string; context: string }>);
vi.mock('../services/errorReporter.js', () => ({
  reportError: (error: unknown, context: string) => {
    reported.push({ message: String((error as Error)?.message ?? error), context });
  },
}));

class Harness extends TournamentManagerBase {
  async captureDrainedF06Custody() {
    return null;
  }
  async captureMixedF06Custody() {
    return null;
  }
  protected startEliminationChecker() {}
  protected async recalculateEliminatedPrizes() {
    return true;
  }
  protected async resolveTournamentSeatMoveQuarantine() {
    return true;
  }
}

/** The 4f1f0fa6 shape: terminal, stopped, still holding its slot and bank. */
function lockedEngine(opts: { settlementInFlight?: boolean; moveBoundary?: boolean } = {}) {
  const state = { slotHeld: true, banksOnDisk: false };
  const custody = new Error('Table engine retains unproven original hand custody');
  const engine: any = {
    tableId: TABLE,
    terminal: true,
    running: false,
    claimedProcessOwnership: false,
    state,
    isRunning: () => false,
    stop: vi.fn(() => Promise.reject(custody)),
    hasReleasedProcessOwnership: () => !state.slotHeld,
    hasClaimedTournamentMoveBoundary: () => opts.moveBoundary === true,
    hasSettlementInFlight: () => opts.settlementInFlight === true,
    hasUnretiredStoppedTimeBankCustody: () => !state.banksOnDisk,
    // The real write refuses while any live engine holds the table slot.
    persistStoppedTimeBankCustody: vi.fn(async () => {
      if (!state.slotHeld) state.banksOnDisk = true;
    }),
    fenceForEngineLeaseLoss: vi.fn(),
  };
  return engine;
}

function managerWith(engine: any, gen = generation, id = tournamentId): any {
  const manager: any = new Harness(id, {} as any, gen, performance.now() + 20_000);
  manager.tableEngines.set(TABLE, engine);
  // The structural stand-in has no process slot; model surrender on it.
  engine.claimedProcessOwnership = false;
  return manager;
}

function server(managers: Array<[string, any]>, engine: any): any {
  const game: any = Object.assign(Object.create(GameServer.prototype), {
    tournamentEngines: new Map(managers),
    tableEngines: new Map([[TABLE, engine]]),
    tournamentOwnedTables: new Set<string>([TABLE]),
    drainedF06TournamentCustody: new Map(),
    durableMixedF06Custody: new Map(),
    tournamentManagerAdmissionLeaseGenerations: new Map(),
    completedF06TournamentCustody: new Map(),
    tournamentManagerRetirementOperations: new WeakMap(),
    tournamentDiagnosticRetirements: new Map(),
    tournamentManagerLeaseReleaseOperations: new Map(),
    tournamentManagerPendingLeaseReleases: new Map(),
    tournamentManagerQuarantine: new QuarantinedTournamentManagers(),
  });
  for (const [, manager] of managers) {
    manager.gameServer = {
      unregisterTournamentTableEngine: (tableId: string, e: any) =>
        game.unregisterTournamentTableEngine(tableId, e),
    };
  }
  game.unregisterTournamentTableEngine = (tableId: string, e: any) => {
    if (game.tableEngines.get(tableId) !== e) return false;
    if (e.hasUnretiredStoppedTimeBankCustody()) return false;
    game.tableEngines.delete(tableId);
    game.tournamentOwnedTables.delete(tableId);
    return true;
  };
  return game;
}

/** Fail the stop once (the hand-off), then charge retries as the pass does. */
async function quarantineFor(game: any, manager: any, attempts: number): Promise<void> {
  await expect(
    game.stopTournamentManagerIfOwned(
      tournamentId,
      manager,
      'GameServer.unproved_hand_successor_stop_failed'
    )
  ).resolves.toBe(false);
  for (let n = 1; n < attempts; n++) {
    game.tournamentManagerQuarantine.record(tournamentId, RETRY, Date.now(), manager);
  }
}

/** The real 4f1f0fa6 engine releases its slot only through the surrender. */
vi.mock('../engine/strandedTeardownOwnership.js', () => ({
  surrenderProcessOwnershipOfStrandedTeardown: (engine: any) => {
    if (!engine.terminal || engine.running) return false;
    if (engine.state) engine.state.slotHeld = false;
    return true;
  },
}));

beforeEach(() => {
  reported.length = 0;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

test('before the bound the quarantine only re-offers the same stop', async () => {
  const engine = lockedEngine();
  const manager = managerWith(engine);
  const game = server([[tournamentId, manager]], engine);
  const release = vi.spyOn(leases, 'releaseTournaments');
  await quarantineFor(game, manager, QUARANTINE_SELF_REPAIR_ATTEMPT - 1);
  await expect(game.stopTournamentManagerIfOwned(tournamentId, manager, RETRY)).resolves.toBe(
    false
  );
  expect(game.tournamentEngines.get(tournamentId)).toBe(manager);
  expect(game.tableEngines.get(TABLE)).toBe(engine);
  expect(release).not.toHaveBeenCalled();
  expect(engine.state.slotHeld).toBe(true);
});

test('at the bound the locked event is rebuilt: slot freed, banks on disk, exact lease released', async () => {
  const before = selfRepairedTournamentManagerEvictions();
  const engine = lockedEngine();
  const manager = managerWith(engine);
  const otherEngine = lockedEngine();
  const other = managerWith(otherEngine, otherGeneration, otherTournamentId);
  const game = server(
    [
      [tournamentId, manager],
      [otherTournamentId, other],
    ],
    engine
  );
  const release = vi
    .spyOn(leases, 'releaseTournaments')
    .mockResolvedValue({ status: 'confirmed', attempts: 1, releasedCount: 1 });
  await quarantineFor(game, manager, QUARANTINE_SELF_REPAIR_ATTEMPT);
  // The 13:57 shape: every plain retry of this stop fails the same way.
  expect(engine.persistStoppedTimeBankCustody).toHaveBeenCalled();
  expect(engine.state.banksOnDisk).toBe(false);

  await expect(game.stopTournamentManagerIfOwned(tournamentId, manager, RETRY)).resolves.toBe(true);

  // Freed for the RUNNING lane's ordinary resume, which admits a new generation.
  expect(game.tournamentEngines.has(tournamentId)).toBe(false);
  expect(game.tableEngines.has(TABLE)).toBe(false);
  expect(engine.state.slotHeld).toBe(false);
  expect(engine.state.banksOnDisk).toBe(true);
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith([{ tournamentId, leaseGeneration: generation }]);
  expect(game.tournamentManagerPendingLeaseReleases.has(tournamentId)).toBe(false);
  expect(game.tournamentManagerQuarantine.has(tournamentId)).toBe(false);
  // The evicted generation can never deal or renew again.
  expect(manager.hasCurrentTournamentLeaseAuthority()).toBe(false);
  expect(manager.renewTournamentLeaseProof(generation, performance.now() + 20_000)).toBe(false);
  expect(selfRepairedTournamentManagerEvictions()).toBe(before + 1);
  expect(
    reported.some(
      (r) =>
        r.context === 'GameServer.quarantined_tournament_manager_self_repaired' &&
        r.message.includes('self-repair')
    )
  ).toBe(true);
  // Another tournament is never touched.
  expect(game.tournamentEngines.get(otherTournamentId)).toBe(other);
  expect(other.hasCurrentTournamentLeaseAuthority()).toBe(true);
  expect(otherEngine.state.slotHeld).toBe(true);
  expect(otherEngine.persistStoppedTimeBankCustody).not.toHaveBeenCalled();
});

test('only the quarantine retry may self-repair; other stop contexts keep the old behaviour', async () => {
  const engine = lockedEngine();
  const manager = managerWith(engine);
  const game = server([[tournamentId, manager]], engine);
  const release = vi.spyOn(leases, 'releaseTournaments');
  await quarantineFor(game, manager, QUARANTINE_SELF_REPAIR_ATTEMPT + 3);
  await expect(
    game.stopTournamentManagerIfOwned(tournamentId, manager, 'GameServer.tournament_lease_lost')
  ).resolves.toBe(false);
  expect(game.tournamentEngines.get(tournamentId)).toBe(manager);
  expect(release).not.toHaveBeenCalled();
});

for (const [name, setup, reason] of [
  [
    'a table still writing a settlement',
    () => ({ engine: lockedEngine({ settlementInFlight: true }) }),
    'settlement_in_flight',
  ],
  [
    'a claimed seat-move boundary',
    () => ({ engine: lockedEngine({ moveBoundary: true }) }),
    'seat_move_boundary',
  ],
  [
    'a refused seat-move release certificate',
    () => ({ engine: lockedEngine(), certificate: 'shutdown:unresolved_seat_move_uuid' }),
    'seat_move_certificate',
  ],
] as const) {
  test(`refuses, changing nothing, for ${name}`, async () => {
    const { engine, certificate } = setup() as { engine: any; certificate?: string };
    const manager = managerWith(engine);
    if (certificate) manager.seatMoveQuarantineRefusal = () => certificate;
    const game = server([[tournamentId, manager]], engine);
    const release = vi.spyOn(leases, 'releaseTournaments');
    await quarantineFor(game, manager, QUARANTINE_SELF_REPAIR_ATTEMPT);
    await expect(game.stopTournamentManagerIfOwned(tournamentId, manager, RETRY)).resolves.toBe(
      false
    );
    expect(game.tournamentEngines.get(tournamentId)).toBe(manager);
    expect(game.tableEngines.get(TABLE)).toBe(engine);
    expect(release).not.toHaveBeenCalled();
    // Still quarantined, on its own backoff, and the refusal is named.
    expect(game.tournamentManagerQuarantine.heldBy(tournamentId)).toBe(manager);
    expect(
      reported.some(
        (r) =>
          r.context === 'GameServer.quarantined_tournament_manager_self_repair_refused' &&
          r.message.includes(reason)
      )
    ).toBe(true);
  });
}

test('custody held only in this process is never rebuilt over', async () => {
  const engine = lockedEngine();
  const manager = managerWith(engine);
  const game = server([[tournamentId, manager]], engine);
  game.durableMixedF06Custody.set(tournamentId, {} as any);
  const release = vi.spyOn(leases, 'releaseTournaments');
  await quarantineFor(game, manager, QUARANTINE_SELF_REPAIR_ATTEMPT);
  await expect(game.stopTournamentManagerIfOwned(tournamentId, manager, RETRY)).resolves.toBe(
    false
  );
  expect(game.tournamentEngines.get(tournamentId)).toBe(manager);
  expect(release).not.toHaveBeenCalled();
  expect(engine.state.slotHeld).toBe(true);
});

test('banks that cannot be written down keep the manager quarantined', async () => {
  const engine = lockedEngine();
  engine.persistStoppedTimeBankCustody = vi.fn(async () => undefined);
  const manager = managerWith(engine);
  const game = server([[tournamentId, manager]], engine);
  const release = vi.spyOn(leases, 'releaseTournaments');
  await quarantineFor(game, manager, QUARANTINE_SELF_REPAIR_ATTEMPT);
  await expect(game.stopTournamentManagerIfOwned(tournamentId, manager, RETRY)).resolves.toBe(
    false
  );
  expect(game.tournamentEngines.get(tournamentId)).toBe(manager);
  expect(game.tableEngines.get(TABLE)).toBe(engine);
  expect(release).not.toHaveBeenCalled();
  expect(game.tournamentManagerQuarantine.heldBy(tournamentId)).toBe(manager);
  expect(
    reported.some(
      (r) =>
        r.context === 'GameServer.quarantined_tournament_manager_self_repair_refused' &&
        r.message.includes('time_bank_custody_not_on_disk')
    )
  ).toBe(true);
});
