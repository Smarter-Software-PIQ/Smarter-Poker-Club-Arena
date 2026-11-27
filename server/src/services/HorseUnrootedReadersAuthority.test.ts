import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  observedTournamentIds: [] as Array<string | null>,
}));

vi.mock('./supabase/client.js', () => ({
  supabase: {
    rpc: mock.rpc,
    from: mock.from,
  },
}));

import {
  currentTournamentIdOrNull,
  runWithTournamentDataAuthority,
} from './supabase/dataActorContext.js';
import { horseSavedProfilePresence } from './HorseSavedProfilePresence.js';
import {
  HORSE_OWN_PUBLIC_HISTORY_DEFINITION_MD5,
  readHorseOwnPublicHistory,
} from './HorseOwnPublicHistory.js';
import { recordHorseHandReviews } from './HorseHandReview.js';
import {
  HUD_ALERT_WINDOW_MS,
  HUD_PERSIST_MS,
  OpponentHudStore,
  supabaseHudDeps,
} from './OpponentHudStore.js';
import { ServerTableEngineDealing } from '../engine/ServerTableEngineDealing.js';
import { ServerTableEngineSettlement } from '../engine/ServerTableEngineSettlement.js';
import {
  __clearTournamentBrainCache,
  refreshTournamentBrainContext,
  refreshTournamentBrainContextAfterClockCommit,
} from './TournamentBrainContext.js';

const TOURNAMENT_AUTH = {
  tournamentId: '64b7c660-575a-45d7-8e76-55f9ae758cc1',
  leaseGeneration: '11111111-1111-4111-8111-111111111111',
};

describe('observe-only horse readers bind to process root outside tournament data authority (1e532243)', () => {
  afterEach(() => {
    mock.rpc.mockReset();
    mock.from.mockReset();
    mock.observedTournamentIds.length = 0;
  });

  it('HorseSavedProfilePresence clears tournament authority before calling fn_horse_saved_profile_presence', async () => {
    let resolveRpc!: (value: { data: unknown; error: null }) => void;
    const rpcDone = new Promise<void>((resolve) => {
      mock.rpc.mockImplementation((name: string) => {
        expect(name).toBe('fn_horse_saved_profile_presence');
        mock.observedTournamentIds.push(currentTournamentIdOrNull());
        return {
          abortSignal: () =>
            new Promise<{ data: unknown; error: null }>((res) => {
              resolveRpc = res;
              resolve();
            }),
        };
      });
    });

    runWithTournamentDataAuthority(TOURNAMENT_AUTH, () => {
      expect(currentTournamentIdOrNull()).toBe(TOURNAMENT_AUTH.tournamentId);
      horseSavedProfilePresence.prime({
        tableId: '7a8db697-8592-4c7e-8588-99ad001fb5f7',
        handNumber: 60735482,
        lease: TOURNAMENT_AUTH.leaseGeneration,
        variant: 'nlh',
        mode: 'tournament',
        domain: { version: 1, speed: 'table', ante: 'big_blind' },
        roster: [
          { seat: 1, id: '10000000-0000-4000-8000-000000000001', human: true },
          { seat: 2, id: '10000000-0000-4000-8000-000000000002', human: false },
        ],
      });
    });

    await rpcDone;
    resolveRpc({ data: [], error: null });
    expect(mock.observedTournamentIds).toEqual([null]);
  });

  it('readHorseOwnPublicHistory clears tournament authority across all queries', async () => {
    const observerId = '10000000-0000-4000-8000-000000000002';
    const opponentId = '10000000-0000-4000-8000-000000000001';
    const context = {
      version: 1 as const,
      observerId,
      variant: 'nlh' as const,
      format: 'mtt' as const,
      dealtCount: 2,
    };
    const handId = '20000000-0000-4000-8000-000000000001';

    mock.rpc.mockImplementation((name: string) => {
      mock.observedTournamentIds.push(currentTournamentIdOrNull());
      if (name === 'fn_horse_own_public_history_read_v3') {
        return {
          abortSignal: async () => ({
            data: {
              definitionMd5: HORSE_OWN_PUBLIC_HISTORY_DEFINITION_MD5,
              window: {
                version: 1,
                source: 'original_dealt_public_v1',
                context,
                capped: false,
                hands: [
                  {
                    handId,
                    tableId: '7a8db697-8592-4c7e-8588-99ad001fb5f7',
                    handNumber: 1000001,
                    observerId,
                    observerSeat: 1,
                    position: 'BTN',
                    playersDealt: 2,
                    variant: 'nlh',
                    format: 'mtt',
                    playedAtMs: 100,
                    bigBlind: 100,
                    actions: [
                      {
                        userId: observerId,
                        seat: 1,
                        action: 'bet',
                        amount: 100,
                        stage: 'river',
                        timestamp: 1,
                      },
                      {
                        userId: opponentId,
                        seat: 2,
                        action: 'call',
                        amount: 100,
                        stage: 'river',
                        timestamp: 2,
                      },
                    ],
                    results: null,
                  },
                ],
              },
            },
            error: null,
          }),
        };
      }
      return { abortSignal: async () => ({ data: null, error: null }) };
    });

    mock.from.mockImplementation((table: string) => {
      expect(table).toBe('hand_history');
      mock.observedTournamentIds.push(currentTournamentIdOrNull());
      return {
        select: () => ({
          in: () => ({
            limit: () => ({
              abortSignal: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    });

    await runWithTournamentDataAuthority(TOURNAMENT_AUTH, async () => {
      expect(currentTournamentIdOrNull()).toBe(TOURNAMENT_AUTH.tournamentId);
      await readHorseOwnPublicHistory(context);
    });

    expect(mock.observedTournamentIds).toEqual([null, null]);
  });

  it('recordHorseHandReviews clears tournament authority before calling fn_hhr_record_atomic', async () => {
    const horseId = '10000000-0000-4000-8000-000000000002';
    const villainId = '10000000-0000-4000-8000-000000000001';
    mock.rpc.mockImplementation(async (name: string) => {
      if (name === 'fn_hhr_record_atomic') {
        mock.observedTournamentIds.push(currentTournamentIdOrNull());
        return { data: { status: 'recorded', inserted: 1, replayed: 0 }, error: null };
      }
      return { data: null, error: null };
    });

    await runWithTournamentDataAuthority(TOURNAMENT_AUTH, async () => {
      expect(currentTournamentIdOrNull()).toBe(TOURNAMENT_AUTH.tournamentId);
      await recordHorseHandReviews({
        handId: '30000000-0000-4000-8000-000000000001',
        tableId: '7a8db697-8592-4c7e-8588-99ad001fb5f7',
        tournamentId: TOURNAMENT_AUTH.tournamentId,
        gameVariant: 'nlh',
        bigBlind: 100,
        playedAt: '2026-11-24T00:00:00.000Z',
        potSize: 5000,
        board: ['Ah', 'Kh', 'Qh', '2c', '3d'],
        holeCardsAll: new Map([
          [horseId, { seat: 1, cards: ['As', 'Ad'] }],
          [villainId, { seat: 2, cards: ['Ks', 'Kd'] }],
        ]),
        contributions: new Map([
          [horseId, 2500],
          [villainId, 2500],
        ]),
        winners: [{ userId: horseId, amount: 5000 }],
        actions: [],
        roster: [
          { userId: horseId, isHorse: true },
          { userId: villainId, isHorse: false },
        ],
        rollupsInAcceptedFacts: true,
      });
    });

    expect(mock.observedTournamentIds).toEqual([null]);
  });

  it('OpponentHudStore supabaseHudDeps RPC methods clear tournament authority', async () => {
    const fakeClient = {
      rpc: (name: string) => {
        mock.observedTournamentIds.push(currentTournamentIdOrNull());
        return {
          abortSignal: async () => ({
            data: name === 'fn_opponent_hud_profiles_upsert' ? ['u1'] : [],
            error: null,
            status: 200,
          }),
        };
      },
    };
    const deps = supabaseHudDeps(fakeClient);
    const signal = new AbortController().signal;

    await runWithTournamentDataAuthority(TOURNAMENT_AUTH, async () => {
      expect(currentTournamentIdOrNull()).toBe(TOURNAMENT_AUTH.tournamentId);
      await deps.read(['u1'], 'nlh', signal);
      await deps.recent('nlh', '2026-11-24T00:00:00.000Z', null, 10, signal);
      await deps.handsPage!('2026-11-24T00:00:00.000Z', '', 10, signal);
      await deps.upsert([], signal);
    });

    expect(mock.observedTournamentIds).toEqual([null, null, null, null]);
  });

  it('OpponentHudStore.start() interval callbacks stay root-bound when armed under tournament authority', async () => {
    vi.useFakeTimers();
    const observed: Array<string | null> = [];
    const store = new OpponentHudStore({
      read: async () => [],
      recent: async () => [],
      handsPage: async () => [],
      upsert: async () => [],
      now: () => Date.now(),
    });
    const persistSpy = vi.spyOn(store, 'persist').mockImplementation(async () => {
      observed.push(currentTournamentIdOrNull());
    });
    const reconcileSpy = vi.spyOn(store, 'maybeReconcile').mockImplementation(async () => {
      observed.push(currentTournamentIdOrNull());
    });
    try {
      runWithTournamentDataAuthority(TOURNAMENT_AUTH, () => {
        expect(currentTournamentIdOrNull()).toBe(TOURNAMENT_AUTH.tournamentId);
        store.start();
      });
      await vi.advanceTimersByTimeAsync(Math.max(HUD_PERSIST_MS, HUD_ALERT_WINDOW_MS) + 10);
      expect(persistSpy).toHaveBeenCalled();
      expect(reconcileSpy).toHaveBeenCalled();
      expect(observed.length).toBeGreaterThanOrEqual(2);
      expect(observed.every((id) => id === null)).toBe(true);
    } finally {
      store.stop();
      vi.useRealTimers();
    }
  });

  it('ServerTableEngine fire-and-forget hand_discards, rabbit_hunt_reveals, and rabbit_hunt_offers stay root-bound', async () => {
    let revealDone!: () => void;
    const revealWritten = new Promise<void>((res) => {
      revealDone = res;
    });
    mock.from.mockImplementation((table: string) => {
      mock.observedTournamentIds.push(currentTournamentIdOrNull());
      if (table === 'hand_discards') {
        return { upsert: async () => ({ error: null }) };
      }
      if (table === 'rabbit_hunt_reveals') {
        return {
          insert: async () => {
            revealDone();
            return { error: null };
          },
        };
      }
      return { upsert: async () => ({ error: null }), insert: async () => ({ error: null }) };
    });
    mock.rpc.mockResolvedValue({
      data: { success: true, diamonds_spent: 5, diamonds_remaining: 95, source: 'diamonds' },
      error: null,
    });

    await runWithTournamentDataAuthority(TOURNAMENT_AUTH, async () => {
      expect(currentTournamentIdOrNull()).toBe(TOURNAMENT_AUTH.tournamentId);

      // Behavioral check: persistDiscardedCard -> hand_discards upsert
      await (
        ServerTableEngineDealing.prototype as unknown as {
          persistDiscardedCard: (userId: string, seat: number, card: unknown) => Promise<void>;
        }
      ).persistDiscardedCard.call(
        { tableId: '7a8db697-8592-4c7e-8588-99ad001fb5f7', handCount: 42 },
        '10000000-0000-4000-8000-000000000001',
        1,
        'Ah'
      );

      // Behavioral check: revealRabbitHunt -> fire-and-forget rabbit_hunt_reveals insert
      const offers = new Map([
        [
          42,
          {
            handNumber: 42,
            cards: [{ rank: 'A', suit: 's' }],
            boardLength: 3,
            eligible: new Set(['10000000-0000-4000-8000-000000000001']),
            revealed: new Set<string>(),
            expiresAt: Date.now() + 60_000,
          },
        ],
      ]);
      const result = await (
        ServerTableEngineSettlement.prototype as unknown as {
          revealRabbitHunt: (userId: string, handNumber?: number) => Promise<{ success: boolean }>;
        }
      ).revealRabbitHunt.call(
        {
          tableId: '7a8db697-8592-4c7e-8588-99ad001fb5f7',
          handCount: 42,
          rabbitHuntOffers: offers,
          rabbitHuntInFlight: new Set<string>(),
          getRabbitHuntOffer: () => offers.get(42),
          callerHasActiveVip: async () => true,
          detachTableWork: (_label: string, work: Promise<unknown>) => {
            void work.catch(() => undefined);
          },
        },
        '10000000-0000-4000-8000-000000000001',
        42
      );
      expect(result.success).toBe(true);
    });

    await revealWritten;
    expect(mock.observedTournamentIds).toEqual([null, null]);

    // Source pin: rabbit_hunt_offers fire-and-forget upsert is also wrapped in bindToProcessRoot
    const settlementSrc = readFileSync(
      resolve(process.cwd(), 'src/engine/ServerTableEngineSettlement.ts'),
      'utf8'
    );
    expect(settlementSrc).toMatch(
      /bindToProcessRoot\(async \(\) => \{\s*try \{\s*const \{ error: offerPersistError \} = await supabase\s*\.from\('rabbit_hunt_offers'\)\s*\.upsert\(/
    );
  });

  it('TournamentBrainContext refresh and post-clock-commit refresh clear tournament authority via bindToProcessRoot (1e532243)', async () => {
    const tid = TOURNAMENT_AUTH.tournamentId;
    __clearTournamentBrainCache();

    let firstQueryStarted!: () => void;
    let firstQueryPromise = new Promise<void>((resolve) => {
      firstQueryStarted = resolve;
    });

    const buildQuery = () => {
      const q: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'gt']) {
        q[method] = () => q;
      }
      q.maybeSingle = async () => ({ data: null, error: { message: 'stubbed' } });
      q.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
      return q;
    };

    mock.from.mockImplementation(() => {
      mock.observedTournamentIds.push(currentTournamentIdOrNull());
      firstQueryStarted();
      return buildQuery();
    });

    runWithTournamentDataAuthority(TOURNAMENT_AUTH, () => {
      expect(currentTournamentIdOrNull()).toBe(tid);
      refreshTournamentBrainContext(tid);
    });
    await firstQueryPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mock.observedTournamentIds.length).toBeGreaterThan(0);
    expect(mock.observedTournamentIds.every((seen) => seen === null)).toBe(true);

    // Post-clock-commit refresh also runs unbound from tournament data authority.
    mock.observedTournamentIds.length = 0;
    firstQueryPromise = new Promise<void>((resolve) => {
      firstQueryStarted = resolve;
    });
    runWithTournamentDataAuthority(TOURNAMENT_AUTH, () => {
      expect(currentTournamentIdOrNull()).toBe(tid);
      refreshTournamentBrainContextAfterClockCommit(tid);
    });
    await firstQueryPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mock.observedTournamentIds.length).toBeGreaterThan(0);
    expect(mock.observedTournamentIds.every((seen) => seen === null)).toBe(true);

    __clearTournamentBrainCache();

    const brainSrc = readFileSync(
      resolve(process.cwd(), 'src/services/TournamentBrainContext.ts'),
      'utf8'
    );
    expect(brainSrc).toContain('const refreshAtRoot = bindToProcessRoot(refresh);');
  });
});
