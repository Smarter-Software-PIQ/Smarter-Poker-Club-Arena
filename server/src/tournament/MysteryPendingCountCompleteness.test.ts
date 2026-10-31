import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import { supabase } from '../services/supabase.js';

afterEach(() => vi.restoreAllMocks());
function fixture(
  options: {
    failPage?: boolean;
    failCount?: boolean;
    stop?: boolean;
    count?: unknown;
    stopCount?: boolean;
    size?: number;
  } = {}
) {
  // window-ok: this reproduces the real REST result cap, not a production slice.
  const candidates = Array.from({ length: options.size ?? 1002 }, (_, i) => ({
    id: String(i + 1).padStart(8, '0'),
    eliminated_user_id: `player-${i === 1001 ? 0 : i}`,
  }));
  const countBatches: string[][] = [];
  let current = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(supabase, 'from').mockImplementation(((relation: string) => {
    let cursor: string | null = null;
    let limit = 1000;
    let ids: string[] = [];
    const query: any = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: (n: number) => {
        limit = Math.min(n, 1000);
        return query;
      },
      gt: (_key: string, value: string) => {
        cursor = value;
        return query;
      },
      in: (_key: string, value: string[]) => {
        ids = value;
        return query;
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        let response: unknown;
        if (relation === 'tournament_knockout_candidates') {
          response =
            options.failPage && cursor !== null
              ? { data: null, error: { message: 'later page unavailable' } }
              : {
                  data: candidates
                    .filter((row) => cursor === null || row.id > cursor)
                    .slice(0, limit),
                  error: null,
                };
          if (options.stop) current = false;
        } else {
          expect(relation).toBe('tournament_players');
          countBatches.push(ids);
          if (options.stopCount) current = false;
          response =
            options.failCount && countBatches.length > 1
              ? { data: null, error: { message: 'count unavailable' }, count: null }
              : {
                  data: null,
                  error: null,
                  count: options.count === undefined ? ids.length : options.count,
                };
        }
        return Promise.resolve(response).then(resolve, reject);
      },
    };
    return query;
  }) as never);
  const manager = Object.assign(Object.create(TournamentManagerBase.prototype), {
    tournamentId: 'mystery-pending-count',
    captureLifecycleToken: () => 'generation',
    lifecycleIsCurrent: () => current,
  });
  return { manager, countBatches };
}
describe('mystery activation counts every pending busted player', () => {
  it.each([0, 1, 1000])('preserves an exact %i-player boundary', async (size) => {
    const { manager, countBatches } = fixture({ size });
    expect(await manager.readUnrecordedKnockoutCount()).toBe(size);
    expect(countBatches.flat()).toHaveLength(size);
  });
  it('counts 1001 distinct players across 1002 candidate generations', async () => {
    const { manager, countBatches } = fixture();
    expect(await manager.readUnrecordedKnockoutCount()).toBe(1001);
    expect(Math.max(...countBatches.map((batch) => batch.length))).toBeLessThanOrEqual(200);
    expect(countBatches.flat()).toHaveLength(1001);
  });
  it('keeps a later-page failure unknown', async () => {
    const { manager, countBatches } = fixture({ failPage: true });
    expect(await manager.readUnrecordedKnockoutCount()).toBeNull();
    expect(countBatches).toEqual([]);
  });
  it('keeps a later-count failure unknown', async () => {
    const { manager } = fixture({ failCount: true });
    expect(await manager.readUnrecordedKnockoutCount()).toBeNull();
  });
  it.each([null, false, '', '1', -1, 0.5, 201])(
    'keeps a malformed or oversized count %j unknown',
    async (count) => {
      const { manager } = fixture({ count });
      expect(await manager.readUnrecordedKnockoutCount()).toBeNull();
    }
  );
  it('does not certify a count returned after withdrawal', async () => {
    const { manager, countBatches } = fixture({ stopCount: true });
    expect(await manager.readUnrecordedKnockoutCount()).toBeNull();
    expect(countBatches).toHaveLength(1);
  });
  it('does not count after its lifecycle is withdrawn', async () => {
    const { manager, countBatches } = fixture({ stop: true });
    expect(await manager.readUnrecordedKnockoutCount()).toBeNull();
    expect(countBatches).toEqual([]);
  });
});
