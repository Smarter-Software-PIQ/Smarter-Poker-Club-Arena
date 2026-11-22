/**
 * LAW: refreshRakeConfig reads club rake defaults in ONE round-trip via
 * `club:clubs!fk_tables_club_id(...)` instead of a second sequential `from('clubs')`
 * PostgREST call on `load_next_hand_inputs`, falling back cleanly on PGRST200.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fromMock = vi.fn();
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../services/supabase/tables.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/supabase/tables.js')>();
  return {
    ...actual,
    loadKillSettings: vi.fn(async () => ({ kill_mode: 'off', kill_threshold_bb: 0 })),
  };
});

import { ServerTableEngineBase } from './ServerTableEngineBase.js';

const BASE_SRC = readFileSync(
  fileURLToPath(new URL('./ServerTableEngineBase.ts', import.meta.url)),
  'utf8'
);

function makeEngine(): any {
  const e = Object.create(ServerTableEngineBase.prototype);
  e.tableId = '11111111-1111-4111-8111-111111111111';
  e.tableInfo = {
    id: e.tableId,
    club_id: '22222222-2222-4222-8222-222222222222',
    tournament_id: null,
  };
  e.lastRakeRefreshAtMs = 0;
  e.rakeClubEmbedUnavailable = false;
  e.clubRakeDefaults = null;
  e.isTournamentTable = () => false;
  e.beginDealingHaltRead = () => 1;
  e.applyDealingHaltFromRow = vi.fn();
  e.applyRunItTwiceConfig = vi.fn();
  e.subscribeManualBomb = vi.fn();
  e.readKillSettingsForRefresh = vi.fn(async () => null);
  return e;
}

describe('refreshRakeConfig single-trip club embed', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('pins the fk_tables_club_id embed in ServerTableEngineBase.ts', () => {
    expect(BASE_SRC).toContain(
      'club:clubs!fk_tables_club_id(default_rake_percent, rake_cap, union_id)'
    );
  });

  it('uses embedded club defaults without issuing a second from("clubs") query', async () => {
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === 'tables'
                ? {
                    rake_percent: 5,
                    rake_cap_bb: 3,
                    union_id: '33333333-3333-4333-8333-333333333333',
                    club: {
                      default_rake_percent: 4.5,
                      rake_cap: 2.5,
                      union_id: '33333333-3333-4333-8333-333333333333',
                    },
                  }
                : null,
            error: null,
          }),
        }),
      }),
    }));

    const e = makeEngine();
    await e.refreshRakeConfig(true);

    expect(fromMock.mock.calls.map((c) => c[0])).toEqual(['tables']);
    expect(e.clubRakeDefaults).toEqual({
      rakePercent: 4.5,
      rakeCapBB: 2.5,
      unionId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('falls back cleanly to the two-step read when PostgREST answers PGRST200', async () => {
    let tablesCalls = 0;
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'tables') {
              tablesCalls++;
              if (tablesCalls === 1) {
                return { data: null, error: { code: 'PGRST200', message: 'embed unavailable' } };
              }
              return { data: { rake_percent: 5, union_id: null }, error: null };
            }
            return {
              data: { default_rake_percent: 3, rake_cap: 2, union_id: null },
              error: null,
            };
          },
        }),
      }),
    }));

    const e = makeEngine();
    await e.refreshRakeConfig(true);

    expect(e.rakeClubEmbedUnavailable).toBe(true);
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual(['tables', 'tables', 'clubs']);
    expect(e.clubRakeDefaults).toEqual({
      rakePercent: 3,
      rakeCapBB: 2,
      unionId: null,
    });
  });
});
