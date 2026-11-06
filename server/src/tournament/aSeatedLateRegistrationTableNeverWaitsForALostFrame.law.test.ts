/**
 * A SEATED LATE-REGISTRATION TABLE NEVER WAITS FOR A LOST FRAME (2026-11-06).
 *
 * Registry: docs/laws.d/a-seated-late-registration-table-never-waits-for-a-lost-frame.md
 *
 * Production 2026-11-06 03:07-03:18 UTC, engine 71087373: every capacity table
 * opened after the 03:00 maintenance break was committed by a generation bump
 * of an already-pending `late_registration` wake and waited for a later full
 * elimination sweep to start its dealer - Six-Card Feature 716f92a0 304 s with
 * three players seated, 1817ecac 72 s, 40 Chip Bounty Freezeout 4b7f39d4 164 s -
 * against about 1 s for the 30 capacity tables opened earlier that night.
 * Realtime is the primary delivery, not a guarantee; a lost frame must not
 * leave a seated table without a dealer until the next full sweep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const transport = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), report: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: transport.from, rpc: transport.rpc },
  maintenanceSupabase: { from: transport.from, rpc: transport.rpc },
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: transport.report,
  reportThrottled: vi.fn(),
}));

import { GameServer } from '../GameServer.js';
import { TournamentManager } from './TournamentManager.js';
import { setMaintenanceFrozen } from '../maintenance/freezeState.js';

const GAME_SERVER = readFileSync(join(process.cwd(), 'src/GameServer.ts'), 'utf8');
const EVENT = '00000000-0000-4000-8000-000000009931';
const TABLE = '00000000-0000-4000-8000-000000009932';
const LEASE = '00000000-0000-4000-8000-000000009933';

function query(result: unknown) {
  const value: any = {};
  for (const method of ['select', 'eq', 'is', 'order']) value[method] = vi.fn(() => value);
  value.limit = vi.fn(async () => result);
  value.maybeSingle = vi.fn(async () => result);
  return value;
}

function fixture(ready = true) {
  const game: any = Object.assign(Object.create(GameServer.prototype), {
    running: true,
    lifecycleGeneration: 1,
    tournamentEngines: new Map(),
    tournamentManagersReadyForCapacityWake: new WeakSet(),
  });
  const manager: any = new TournamentManager(EVENT, game, LEASE, performance.now() + 60_000);
  manager.lifecycleEpoch.begin();
  manager.running = true;
  game.tournamentEngines.set(EVENT, manager);
  if (ready) game.tournamentManagersReadyForCapacityWake.add(manager);
  vi.spyOn(manager, 'createManagedTableEngine').mockReturnValue({ setHub: vi.fn() });
  vi.spyOn(manager, 'wireEliminationWake').mockImplementation(() => {});
  vi.spyOn(manager, 'prepareManagedTableEngineForPlay').mockImplementation(() => {});
  vi.spyOn(manager, 'admitManagedTableEngine').mockImplementation(() => {});
  vi.spyOn(manager, 'startManagedTableEngine').mockImplementation(() => {});
  vi.spyOn(manager, 'broadcast').mockResolvedValue(undefined);
  vi.spyOn(manager, 'requestUrgentEliminationSweepAfter').mockImplementation(() => {});
  const sweep = vi.spyOn(manager, 'requestEliminationSweep');
  return { game, manager, sweep };
}

beforeEach(() => {
  transport.from.mockReset();
  transport.rpc.mockReset();
  transport.report.mockReset();
  transport.from.mockImplementation((table: string) =>
    query({
      data:
        table === 'tournaments'
          ? { status: 'RUNNING' }
          : table === 'tournament_manager_wakes'
            ? [{ tournament_id: EVENT }]
            : [{ table_id: TABLE, created_at: new Date().toISOString() }],
      error: null,
    })
  );
  transport.rpc.mockResolvedValue({ data: { ok: true, requested: 1 }, error: null });
});
afterEach(() => {
  setMaintenanceFrozen(false);
  vi.restoreAllMocks();
});

describe('a seated late-registration table never waits for a lost Realtime frame', () => {
  it('starts the dealer of a committed capacity table with no frame and no sweep', async () => {
    const { game, manager, sweep } = fixture();
    // No Realtime frame arrives (the lost-frame case). The recheck alone admits.
    await game.recheckTournamentCapacityWakes();
    expect(manager.startManagedTableEngine).toHaveBeenCalledOnce();
    expect(transport.rpc).toHaveBeenCalledWith('fn_ack_tournament_capacity_tables', {
      p_tournament_id: EVENT,
      p_table_ids: [TABLE],
    });
    // A safety net, not a second sweep owner: it never requests or acks a sweep.
    expect(sweep).not.toHaveBeenCalled();
    expect(transport.rpc).not.toHaveBeenCalledWith(
      'fn_ack_tournament_manager_wakes',
      expect.anything()
    );
  });

  it('reads only pending late_registration wakes', async () => {
    const { game } = fixture();
    await game.recheckTournamentCapacityWakes();
    const wakeReads = transport.from.mock.calls.filter(([t]) => t === 'tournament_manager_wakes');
    expect(wakeReads).toHaveLength(1);
    const q =
      transport.from.mock.results[
        transport.from.mock.calls.findIndex(([t]) => t === 'tournament_manager_wakes')
      ].value;
    expect(q.eq).toHaveBeenCalledWith('reason', 'late_registration');
    expect(q.is).toHaveBeenCalledWith('consumed_at', null);
  });

  it('keeps every gate of the direct path: unready manager, freeze, stopped server', async () => {
    const unready = fixture(false);
    await unready.game.recheckTournamentCapacityWakes();
    expect(unready.manager.startManagedTableEngine).not.toHaveBeenCalled();

    const frozen = fixture();
    setMaintenanceFrozen(true);
    await frozen.game.recheckTournamentCapacityWakes();
    expect(frozen.manager.startManagedTableEngine).not.toHaveBeenCalled();
    setMaintenanceFrozen(false);

    const stopped = fixture();
    stopped.game.running = false;
    await stopped.game.recheckTournamentCapacityWakes();
    expect(stopped.manager.startManagedTableEngine).not.toHaveBeenCalled();
  });

  it('is idempotent: an admitted receipt is never started twice', async () => {
    const { game, manager } = fixture();
    await game.recheckTournamentCapacityWakes();
    manager.tableEngines.set(TABLE, {});
    await game.recheckTournamentCapacityWakes();
    expect(manager.startManagedTableEngine).toHaveBeenCalledOnce();
  });

  it('a frame and the recheck share one admission path', () => {
    const wake = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async admitTournamentManagerWake('),
      GAME_SERVER.indexOf('private async admitCapacityTablesOnLateRegistrationWake(')
    );
    expect(wake).toContain('this.admitCapacityTablesOnLateRegistrationWake(tournamentId, manager)');
    const recheck = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async recheckTournamentCapacityWakes('),
      GAME_SERVER.indexOf(
        '/** Acknowledge durable action wakes only after their full sweep completed. */'
      )
    );
    expect(recheck).toContain(
      'this.admitCapacityTablesOnLateRegistrationWake(tournamentId, manager)'
    );
  });

  it('is armed with the wake subscription, bounded, unref-ed and cleared on stop', () => {
    expect(GAME_SERVER).toMatch(/static readonly CAPACITY_WAKE_RECHECK_MS = 5_000;/);
    const subscription = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private startTournamentManagerWakeSubscription()'),
      GAME_SERVER.indexOf('private async admitTournamentManagerWake(')
    );
    expect(subscription).toContain('this.scheduleTournamentCapacityWakeRecheck();');
    expect(GAME_SERVER).toContain('this.tournamentCapacityWakeRecheckTimer.unref?.();');
    expect(GAME_SERVER).toContain('clearTimeout(this.tournamentCapacityWakeRecheckTimer);');
  });
});
