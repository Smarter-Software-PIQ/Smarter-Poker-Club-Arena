import { describe, expect, it } from 'vitest';
import {
  countHorseSeats,
  type HorseSeatEngineSource,
  type LightningHorseSeatSource,
} from './HorseSeatCounter.js';
import { LightningRegistry } from '../lightning/LightningRegistry.js';
import type { LightningHandHost } from '../lightning/LightningHandHost.js';

function fakeEngine(
  horses: number,
  anchor?: { clusterId: string; userIds: string[] } | null
): HorseSeatEngineSource {
  return {
    horsesSeated: () => horses,
    lightningAnchorHorseIds: () => anchor ?? null,
  };
}

function fakeLightningHost(
  instanceId: string,
  clusterId: string,
  participants: Array<{ playerId: string; poolSessionId: string; isHorse: boolean; stack: number }>
): LightningHandHost {
  const byPlayer = new Map(participants.map((p) => [p.playerId, p]));
  return {
    instanceId,
    clusterId,
    participantIds: () => participants.map((p) => p.playerId),
    roomOf: (playerId: string) => byPlayer.get(playerId)?.poolSessionId ?? null,
    seatedHorseParticipants: () =>
      participants
        .filter((p) => p.isHorse && p.stack > 0)
        .map((p) => ({ playerId: p.playerId, poolSessionId: p.poolSessionId })),
  } as unknown as LightningHandHost;
}

describe('countHorseSeats (poker_horses_seated)', () => {
  it('counts Classic/tournament table engines when Lightning is absent or null', () => {
    const engines = [fakeEngine(4), fakeEngine(0), fakeEngine(3)];
    expect(countHorseSeats(engines)).toEqual({ horses: 7, tables: 2 });
    expect(countHorseSeats(engines, null)).toEqual({ horses: 7, tables: 2 });
  });

  it('includes Lightning pool horses when no anchor engine is loaded', () => {
    const engines = [fakeEngine(3)];
    const lightning: LightningHorseSeatSource = {
      seatedHorseEntries: () => [
        { clusterId: 'c1', playerId: 'h1', poolSessionId: 'ps1' },
        { clusterId: 'c1', playerId: 'h2', poolSessionId: 'ps2' },
      ],
    };
    expect(countHorseSeats(engines, lightning)).toEqual({ horses: 5, tables: 1 });
  });

  it('includes Lightning pool horses when the anchor engine has a stale 0 stack', () => {
    const engines = [fakeEngine(0, { clusterId: 'c1', userIds: [] })];
    const lightning: LightningHorseSeatSource = {
      seatedHorseEntries: () => [{ clusterId: 'c1', playerId: 'h1', poolSessionId: 'ps1' }],
    };
    expect(countHorseSeats(engines, lightning)).toEqual({ horses: 1, tables: 0 });
  });

  it('does not double-count a horse already counted on a live Lightning anchor engine', () => {
    const engines = [
      fakeEngine(2, { clusterId: 'c1', userIds: ['h1', 'h2'] }),
      fakeEngine(1), // classic table
    ];
    const lightning: LightningHorseSeatSource = {
      seatedHorseEntries: () => [
        { clusterId: 'c1', playerId: 'h1', poolSessionId: 'ps1' },
        { clusterId: 'c1', playerId: 'h2', poolSessionId: 'ps2' },
        { clusterId: 'c1', playerId: 'h3', poolSessionId: 'ps3' }, // not on anchor
      ],
    };
    expect(countHorseSeats(engines, lightning)).toEqual({ horses: 4, tables: 2 });
  });

  it('counts a horse multi-tabling a Classic table and a Lightning pool as two seats', () => {
    const engines = [fakeEngine(1, null)]; // classic table (not a Lightning anchor)
    const lightning: LightningHorseSeatSource = {
      seatedHorseEntries: () => [{ clusterId: 'c1', playerId: 'h1', poolSessionId: 'ps1' }],
    };
    expect(countHorseSeats(engines, lightning)).toEqual({ horses: 2, tables: 1 });
  });

  it('deduplicates repeated poolSessionId entries from overlapping fast-fold hosts', () => {
    const lightning: LightningHorseSeatSource = {
      seatedHorseEntries: () => [
        { clusterId: 'c1', playerId: 'h1', poolSessionId: 'ps1' },
        { clusterId: 'c1', playerId: 'h1', poolSessionId: 'ps1' },
      ],
    };
    expect(countHorseSeats([], lightning)).toEqual({ horses: 1, tables: 0 });
  });

  it('never throws when an engine or Lightning source throws', () => {
    const badEngine: HorseSeatEngineSource = {
      horsesSeated: () => {
        throw new Error('corrupt table state');
      },
    };
    const badLightning: LightningHorseSeatSource = {
      seatedHorseEntries: () => {
        throw new Error('lightning unavailable');
      },
    };
    expect(countHorseSeats([badEngine, fakeEngine(5)], badLightning)).toEqual({
      horses: 5,
      tables: 1,
    });
  });

  it('LightningRegistry.seatedHorseEntries exposes only funded horse rooms and tracks release/unregister', () => {
    const registry = new LightningRegistry();
    const host1 = fakeLightningHost('inst-1', 'cluster-1', [
      { playerId: 'horse-1', poolSessionId: 'room-1', isHorse: true, stack: 100 },
      { playerId: 'human-1', poolSessionId: 'room-2', isHorse: false, stack: 100 },
      { playerId: 'horse-busted', poolSessionId: 'room-3', isHorse: true, stack: 0 },
    ]);
    registry.register(host1);

    expect(registry.seatedHorseEntries()).toEqual([
      { clusterId: 'cluster-1', playerId: 'horse-1', poolSessionId: 'room-1' },
    ]);
    expect(countHorseSeats([], registry)).toEqual({ horses: 1, tables: 0 });

    // Fast-fold releases room-1 from host1 before host1 finishes; re-dealt into host2 counts once.
    registry.releaseRoom(host1, 'horse-1');
    expect(registry.seatedHorseEntries()).toEqual([]);

    const host2 = fakeLightningHost('inst-2', 'cluster-1', [
      { playerId: 'horse-1', poolSessionId: 'room-1', isHorse: true, stack: 95 },
    ]);
    registry.register(host2);
    expect(registry.seatedHorseEntries()).toEqual([
      { clusterId: 'cluster-1', playerId: 'horse-1', poolSessionId: 'room-1' },
    ]);

    registry.unregister(host2);
    registry.unregister(host1);
    expect(registry.seatedHorseEntries()).toEqual([]);
  });
});
