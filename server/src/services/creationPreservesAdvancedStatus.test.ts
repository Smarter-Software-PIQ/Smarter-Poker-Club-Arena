import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { tournamentStartAllowed } from '../maintenance/dailyWindow.js';

import {
  TournamentRecurringService,
  MTT_PUBLISH_LEAD_MS,
  SPIN_CONFIGS,
} from './TournamentRecurringService.js';
import { supabase } from './supabase.js';
import { MTT_BLIND_PRESETS } from '../tournament/mttStructurePolicy.js';
import { HEADS_UP_BLIND_STRUCTURE, HEADS_UP_PAYOUTS } from '../config/headsUpSpec.js';

vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));
// Creation assertions exercise the admitted path independently of the runner hour.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T18:00:00.000Z'));
  expect(tournamentStartAllowed(new Date(Date.now() + MTT_PUBLISH_LEAD_MS))).toBe(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const config = {
  name: 'Creation Race',
  type: 'mtt',
  gameVariant: 'nlh',
  buyIn: 5,
  guarantee: 0,
  startingStack: 10000,
  maxPlayers: 100,
  minPlayers: 3,
  horsesToRegister: 2,
  blindStructure: MTT_BLIND_PRESETS.TURBO,
  payoutStructure: [{ place: 1, percentage: 100 }],
};

it.each(['createTournament', 'createXMTT', 'createSNG', 'createSpin'])(
  '%s cannot rewind a game that starts while seeding is pending',
  async (method) => {
    const service = new TournamentRecurringService() as any;
    let status = 'REGISTERING';
    let inserted: Record<string, unknown> | undefined;
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedSeeding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const seed = async () => {
      entered();
      await pending;
      return 2;
    };
    vi.spyOn(service, 'registerHorses').mockImplementation(seed);
    vi.spyOn(service, 'seedOpenSeatTable').mockImplementation(seed);
    vi.spyOn(service, 'createSeatFirstGameAtomic').mockImplementation(async (row: any) => {
      inserted = row;
      return { tournament: { ...row, id: 'event' }, tableId: 'table' };
    });
    const updates: unknown[] = [];
    vi.spyOn(supabase, 'from').mockImplementation(() => {
      let update: Record<string, unknown> | undefined;
      const chain: any = {
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => ({
          data: { ...inserted, id: 'event', format_contract: 'mtt-v1' },
          error: null,
        }),
        update: (row: Record<string, unknown>) => {
          update = row;
          updates.push(row);
          return chain;
        },
        eq: () => chain,
        then: (resolve: (value: unknown) => unknown) => {
          if (typeof update?.status === 'string') status = update.status;
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return chain;
    });
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        ok: true,
        admission_abi: 'legacy-capacity-v1',
        entries: [
          { tournament_id: 'event', format_contract: 'mtt-v1', effective_max_players: 100 },
        ],
      },
      error: null,
    } as never);
    const selected =
      method === 'createSpin'
        ? SPIN_CONFIGS[0]
        : method === 'createSNG'
          ? {
              ...config,
              type: 'sng',
              maxPlayers: 2,
              minPlayers: 2,
              blindStructure: HEADS_UP_BLIND_STRUCTURE,
              payoutStructure: HEADS_UP_PAYOUTS,
            }
          : config;
    const creating =
      method === 'createXMTT'
        ? service[method](selected, 'union', 'club')
        : service[method](selected);
    try {
      // A refusal must fail this assertion immediately, not wait for an unreachable seed.
      expect(
        await Promise.race([startedSeeding.then(() => 'seeding'), creating.then(() => 'returned')])
      ).toBe('seeding');
      expect(inserted?.status).toBe('REGISTERING');
      status = 'RUNNING';
      release();
      expect(await creating).toMatchObject({ tournamentId: 'event' });
      expect(status).toBe('RUNNING');
      expect(updates).toEqual([]);
    } finally {
      release();
    }
  }
);
