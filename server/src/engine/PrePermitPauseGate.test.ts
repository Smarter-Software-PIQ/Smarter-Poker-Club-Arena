import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerTableEngine } from './ServerTableEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, 'ServerTableEngineDealing.ts'), 'utf8');

describe('Pre-permit pause & hand-for-hand readiness gate in dealHand()', () => {
  it('checks isNextHandPaused() || isHandForHandReleaseBlocked() before allocating a hand number or reserving an f06 permit while retaining post-allocation discardPreparedHandForPause()', () => {
    const method = SRC.slice(SRC.indexOf('protected async dealHand('));
    const prePermitGate = method.indexOf(
      'if (this.isNextHandPaused() || this.isHandForHandReleaseBlocked())'
    );
    const allocate = method.indexOf('await this.allocateGlobalHandNumber()');
    const reserve = method.indexOf('await this.reserveF06Hand(this.handCount);');
    const postPermitGate = method.indexOf(
      'if (this.discardPreparedHandForPause()) return;',
      reserve
    );

    expect(prePermitGate).toBeGreaterThan(-1);
    expect(allocate).toBeGreaterThan(prePermitGate);
    expect(reserve).toBeGreaterThan(allocate);
    expect(postPermitGate).toBeGreaterThan(reserve);
  });

  it('aborts dealHand before allocateGlobalHandNumber and reserveF06Hand when a pause arrives during acquireSeatBoundary()', async () => {
    const tableId = 'bbbbbbbb-0000-4000-8000-000000000001';
    const engine = new ServerTableEngine(tableId) as any;
    const players = [
      { user_id: 'u1', occupancy_id: 'o1', seat_number: 1, stack: 1000 },
      { user_id: 'u2', occupancy_id: 'o2', seat_number: 2, stack: 1000 },
    ];
    engine.running = true;
    engine.handCount = 42;
    engine.tableInfo = {
      id: tableId,
      tournament_id: 'tttttttt-0000-4000-8000-000000000001',
      game_type: 'NLH',
      max_players: 6,
      big_blind: 20,
      small_blind: 10,
    };
    engine.seatedPlayers = players;

    const allocateSpy = vi.fn(async () => 43);
    const reserveSpy = vi.fn(async () => {});
    engine.allocateGlobalHandNumber = allocateSpy;
    engine.reserveF06Hand = reserveSpy;
    engine.resolveUnstartedF06Permit = vi.fn(async () => false);

    // Simulate a maintenance or hand-for-hand pause arriving while acquireSeatBoundary() is awaited
    engine.acquireSeatBoundary = vi.fn(async () => {
      engine.pauseForMaintenance(60_000);
      return () => {};
    });

    await engine.dealHand(players);

    expect(allocateSpy).not.toHaveBeenCalled();
    expect(reserveSpy).not.toHaveBeenCalled();
    expect(engine.handCount).toBe(42);
    expect(engine.f06HandPreparation).toBeNull();
  });

  it('aborts dealHand before allocateGlobalHandNumber and reserveF06Hand when isHandForHandReleaseBlocked() is raised during pre-deal awaits', async () => {
    const tableId = 'bbbbbbbb-0000-4000-8000-000000000002';
    const engine = new ServerTableEngine(tableId) as any;
    const players = [
      { user_id: 'u1', occupancy_id: 'o1', seat_number: 1, stack: 1000 },
      { user_id: 'u2', occupancy_id: 'o2', seat_number: 2, stack: 1000 },
    ];
    engine.running = true;
    engine.handCount = 99;
    engine.tableInfo = {
      id: tableId,
      tournament_id: 'tttttttt-0000-4000-8000-000000000002',
      game_type: 'NLH',
      max_players: 6,
      big_blind: 20,
      small_blind: 10,
    };
    engine.seatedPlayers = players;

    const allocateSpy = vi.fn(async () => 100);
    const reserveSpy = vi.fn(async () => {});
    engine.allocateGlobalHandNumber = allocateSpy;
    engine.reserveF06Hand = reserveSpy;
    engine.resolveUnstartedF06Permit = vi.fn(async () => false);

    engine.acquireSeatBoundary = vi.fn(async () => {
      engine.tournamentMovePauseOwners.add('move-owner-1');
      return () => {};
    });

    await engine.dealHand(players);

    expect(allocateSpy).not.toHaveBeenCalled();
    expect(reserveSpy).not.toHaveBeenCalled();
    expect(engine.handCount).toBe(99);
    expect(engine.f06HandPreparation).toBeNull();
  });
});
