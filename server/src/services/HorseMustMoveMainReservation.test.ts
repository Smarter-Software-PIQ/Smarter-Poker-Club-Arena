import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gameOwesALine,
  isMainTableReservedForMustMoveList,
  lastChairGameKey,
  lastChairVerdict,
  openChairsByGame,
  type LastChairTable,
} from './HorseLastChair.js';
import { allocateBuyers, type BuyerPool } from './HorseBuyerAllocation.js';

const MUST_MOVE_CLUSTER = { must_move: true, cluster_mode: 'must_move' };
const LIGHTNING_CLUSTER = { must_move: true, cluster_mode: 'lightning' };
const MANUAL_CLUSTER = { must_move: false, cluster_mode: 'must_move' };

describe('isMainTableReservedForMustMoveList mirrors fn_cash_main_chair_is_the_lists', () => {
  it('reserves Main 1 and Main 2 when a live feeder exists (6-max and 9-max alike)', () => {
    const tables: LastChairTable[] = [
      {
        id: 'm1',
        cluster_id: 'g1',
        role: 'main',
        main_index: 1,
        lifecycle: 'live',
        max_players: 6,
        cluster: MUST_MOVE_CLUSTER,
      },
      {
        id: 'm2',
        cluster_id: 'g1',
        role: 'main',
        main_index: 2,
        lifecycle: 'live',
        max_players: 6,
        cluster: MUST_MOVE_CLUSTER,
      },
      {
        id: 'f1',
        cluster_id: 'g1',
        role: 'feeder',
        main_index: null,
        lifecycle: 'live',
        max_players: 6,
        cluster: MUST_MOVE_CLUSTER,
      },
    ];

    expect(isMainTableReservedForMustMoveList(tables[0], tables)).toBe(true);
    expect(isMainTableReservedForMustMoveList(tables[1], tables)).toBe(true);
    expect(isMainTableReservedForMustMoveList(tables[2], tables)).toBe(false);
  });

  it('reserves Main 1 when a higher live Main exists even if no feeder is present, without reserving the top Main', () => {
    const tables: LastChairTable[] = [
      {
        id: 'm1',
        cluster_id: 'g1',
        role: 'main',
        main_index: 1,
        lifecycle: 'live',
        max_players: 9,
        cluster: [MUST_MOVE_CLUSTER],
      },
      {
        id: 'm2',
        cluster_id: 'g1',
        role: 'main',
        main_index: 2,
        lifecycle: 'live',
        max_players: 9,
        cluster: [MUST_MOVE_CLUSTER],
      },
    ];

    expect(isMainTableReservedForMustMoveList(tables[0], tables)).toBe(true);
    expect(isMainTableReservedForMustMoveList(tables[1], tables)).toBe(false);
  });

  it('never blocks Main 1 when only an empty 0-player opening feeder exists, and reserves once a player sits or is pending inbound', () => {
    const main1: LastChairTable = {
      id: 'm1',
      cluster_id: 'g1',
      role: 'main',
      main_index: 1,
      lifecycle: 'live',
      max_players: 6,
      current_players: 5,
      cluster: MUST_MOVE_CLUSTER,
    };
    const openingEmpty: LastChairTable = {
      id: 'f1',
      cluster_id: 'g1',
      role: 'feeder',
      main_index: null,
      lifecycle: 'opening',
      max_players: 6,
      current_players: 0,
      cluster: MUST_MOVE_CLUSTER,
    };

    // Empty opening feeder (0 seated, 0 pending): Main 1 stays directly buyable.
    expect(isMainTableReservedForMustMoveList(main1, [main1, openingEmpty])).toBe(false);
    expect(
      isMainTableReservedForMustMoveList(
        main1,
        [main1, openingEmpty],
        () => 0,
        () => 0
      )
    ).toBe(false);

    // 1 seated player via current_players fallback: Main 1 is reserved.
    expect(
      isMainTableReservedForMustMoveList(main1, [main1, { ...openingEmpty, current_players: 1 }])
    ).toBe(true);

    // 1 seated player via live occupiedByTable map: Main 1 is reserved.
    expect(
      isMainTableReservedForMustMoveList(main1, [main1, openingEmpty], (id) =>
        id === 'f1' ? 1 : 5
      )
    ).toBe(true);

    // 0 seated yet, but 1 pending inbound move (e.g. full-ring bump): Main 1 is reserved.
    expect(
      isMainTableReservedForMustMoveList(
        main1,
        [main1, openingEmpty],
        (id) => (id === 'f1' ? 0 : 7),
        (id) => (id === 'f1' ? 1 : 0)
      )
    ).toBe(true);
  });

  it('does not reserve a lone Main, breaking/closed feeder, manual game, or active Lightning cluster', () => {
    const main1: LastChairTable = {
      id: 'm1',
      cluster_id: 'g1',
      role: 'main',
      main_index: 1,
      lifecycle: 'live',
      max_players: 9,
      cluster: MUST_MOVE_CLUSTER,
    };
    const breakingFeeder: LastChairTable = {
      id: 'f-break',
      cluster_id: 'g1',
      role: 'feeder',
      lifecycle: 'breaking',
      max_players: 9,
      current_players: 3,
      cluster: MUST_MOVE_CLUSTER,
    };
    const closedFeeder: LastChairTable = {
      id: 'f-closed',
      cluster_id: 'g1',
      role: 'feeder',
      lifecycle: 'live',
      status: 'closed',
      max_players: 9,
      current_players: 0,
      cluster: MUST_MOVE_CLUSTER,
    };

    expect(isMainTableReservedForMustMoveList(main1, [main1])).toBe(false);
    expect(isMainTableReservedForMustMoveList(main1, [main1, breakingFeeder])).toBe(false);
    expect(isMainTableReservedForMustMoveList(main1, [main1, closedFeeder])).toBe(false);

    // Active Lightning mode: open chairs are NOT must-move reserved.
    const lightningMain: LastChairTable = { ...main1, cluster: LIGHTNING_CLUSTER };
    const lightningFeeder: LastChairTable = {
      id: 'f-live',
      cluster_id: 'g1',
      role: 'feeder',
      lifecycle: 'live',
      max_players: 6,
      cluster: LIGHTNING_CLUSTER,
    };
    expect(
      isMainTableReservedForMustMoveList(lightningMain, [lightningMain, lightningFeeder])
    ).toBe(false);

    // Manual game (must_move: false): NOT reserved.
    const manualMain: LastChairTable = { ...main1, cluster: MANUAL_CLUSTER };
    expect(
      isMainTableReservedForMustMoveList(manualMain, [
        manualMain,
        { ...lightningFeeder, cluster: MANUAL_CLUSTER },
      ])
    ).toBe(false);
  });
});

describe('openChairsByGame excludes reserved Main open chairs so lastChairVerdict sees the last buyable Feeder chair', () => {
  it('counts only Feeder open chairs when Main 1 has an open chair reserved for the must-move list', () => {
    const tables: LastChairTable[] = [
      {
        id: 'm1',
        cluster_id: 'g1',
        role: 'main',
        main_index: 1,
        lifecycle: 'live',
        max_players: 9,
        cluster: MUST_MOVE_CLUSTER,
      },
      {
        id: 'f1',
        cluster_id: 'g1',
        role: 'feeder',
        main_index: null,
        lifecycle: 'live',
        max_players: 9,
        cluster: MUST_MOVE_CLUSTER,
      },
    ];
    const open = openChairsByGame({
      tables,
      occupiedByTable: (id) => (id === 'm1' ? 8 : 8),
    });
    // Main 1's 1 open chair is reserved; only the Feeder's 1 open chair is directly buyable.
    expect(open.get(lastChairGameKey(tables[1]))).toBe(1);

    const verdict = lastChairVerdict({
      seatsPlanned: 1,
      seatedHere: 8,
      openInGame: open.get(lastChairGameKey(tables[1])) ?? 0,
      gameHasList: false,
      canCarryLine: true,
      spareWaiters: 2,
    });
    expect(verdict).toEqual({ seats: 1, startsLine: true, reason: 'paired' });
    expect(gameOwesALine({ canCarryLine: true, openInGame: 0 })).toBe(true);
  });

  it('keeps Main 1 open chairs counted when only an empty 0-player opening feeder exists', () => {
    const tables: LastChairTable[] = [
      {
        id: 'm1',
        cluster_id: 'g1',
        role: 'main',
        main_index: 1,
        lifecycle: 'live',
        max_players: 6,
        cluster: MUST_MOVE_CLUSTER,
      },
      {
        id: 'f1',
        cluster_id: 'g1',
        role: 'feeder',
        main_index: null,
        lifecycle: 'opening',
        max_players: 6,
        cluster: MUST_MOVE_CLUSTER,
      },
    ];
    const open = openChairsByGame({
      tables,
      occupiedByTable: (id) => (id === 'm1' ? 5 : 0),
    });
    // 1 on Main 1 + 6 on empty opening Feeder = 7.
    expect(open.get('game:g1')).toBe(7);
  });
});

describe('HorseFleetManager wiring: reserved Mains do not steal buyer allocation from the Feeder', () => {
  it('omitting a reserved Main from clusterPools lets allocateBuyers assign spare horses to the Feeder', () => {
    const capacity = new Map([
      ['h1', 1],
      ['h2', 1],
    ]);
    // Without the reserved Main claiming 'seating' ahead of the Feeder, the Feeder receives both buyers.
    const pools: BuyerPool[] = [
      {
        tableId: 'feeder-1',
        clusterId: 'g1',
        pool: ['h1', 'h2'],
        seatsWanted: 2,
        claim: 'seating',
      },
    ];
    const allocated = allocateBuyers(pools, capacity);
    expect(allocated.get('feeder-1')).toBe(2);
  });

  it('wires isMainTableReservedForMustMoveList into countOnly, seatsNeeded, and clusterPools exclusion', () => {
    const fleet = readFileSync(join(__dirname, 'HorseFleetManager.ts'), 'utf8');
    expect(fleet).toContain('const mainReservedForList = isMainTableReservedForMustMoveList(');
    expect(fleet).toContain('let countOnly = queueOnly || mainReservedForList;');
    expect(fleet).toContain('if (mainReservedForList) seatsNeeded = 0;');
    expect(fleet).toContain(
      'if (!queueOnly && !skipReservedMainPool) clusterPools.push(clusterPool);'
    );
  });
});
