import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
