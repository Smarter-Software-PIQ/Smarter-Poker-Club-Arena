import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTournamentService } from './ScheduledTournamentService.js';
import { supabase } from './supabase.js';
afterEach(() => vi.restoreAllMocks());
import { readFileSync } from 'node:fs';
import {
  withReducedTournamentGuarantee as apply,
  GUARANTEE_REDUCTION_START_MS as start,
} from './TournamentGuaranteePolicy.js';
const base = {
  name: 'Nightly 10K (NLH)',
  guaranteed_prize: 10000,
  buy_in_amount: 32,
  buy_in_fee: 3,
  start_time: new Date(start).toISOString(),
  starting_chips: 20000,
};
describe('November midnight tournament guarantee reduction', () => {
  it('halves the fresh guarantee at the Chicago cutoff and preserves all other terms', () => {
    expect(apply({ ...base, start_time: new Date(start - 1).toISOString() }).guaranteed_prize).toBe(
      10000
    );
    expect(apply(base)).toEqual({ ...base, name: 'Nightly 5K (NLH)', guaranteed_prize: 5000 });
    expect(base.guaranteed_prize).toBe(10000);
  });
  it('preserves the 200 entry 25k guarantee, but not other 200 entry amounts', () => {
    expect(
      apply({ ...base, buy_in_amount: 180, buy_in_fee: 20, guaranteed_prize: 25000 })
        .guaranteed_prize
    ).toBe(25000);
    expect(
      apply({ ...base, buy_in_amount: 180, buy_in_fee: 20, guaranteed_prize: 40000 })
        .guaranteed_prize
    ).toBe(20000);
  });
  it('halves free-entry guarantees too and leaves zero alone', () => {
    expect(
      apply({ ...base, buy_in_amount: 0, buy_in_fee: 0, guaranteed_prize: 250 }).guaranteed_prize
    ).toBe(125);
    expect(apply({ ...base, guaranteed_prize: 0 }).guaranteed_prize).toBe(0);
  });
  it('updates guarantee labels without changing entry prices or stack amounts', () => {
    const result = apply({
      ...base,
      guaranteed_prize: 5000,
      name: '40 Chip Freezeout - 5K GTD (NLH)',
      short_description: '5K GTD | 20K Stack | 8 Min Levels',
    });
    expect(result.name).toBe('40 Chip Freezeout - 2.5K GTD (NLH)');
    expect(result.short_description).toBe('2.5K GTD | 20K Stack | 8 Min Levels');
  });
  it('uses unchanged schedule identity so reduced 5K cannot match the separate 2.5K event', () => {
    const source = readFileSync(
      new URL('./ScheduledTournamentService.ts', import.meta.url),
      'utf8'
    );
    expect(source).toContain(".from('tournament_schedules').select('id').eq('name', name)");
    const live = source.slice(
      source.indexOf('private async resolveSatelliteTarget('),
      source.indexOf('// RESTART-EVERY')
    );
    expect(live.match(/query\.in\('schedule_id', targetSchedules\)/g)).toHaveLength(2);
    expect(live).not.toContain('guaranteeTargetNameFilter');
  });
  it('queries the original schedule ID after its displayed guarantee has changed', async () => {
    const ids: unknown[][] = [];
    const scheduleQuery: any = {
      select: vi.fn(() => scheduleQuery),
      eq: vi.fn(() => scheduleQuery),
      then: (resolve: any) =>
        Promise.resolve({ data: [{ id: 'original-five-k-schedule' }], error: null }).then(resolve),
    };
    const eventQuery: any = {
      select: vi.fn(() => eventQuery),
      eq: vi.fn(() => eventQuery),
      in: vi.fn((...args: unknown[]) => {
        ids.push(args);
        return eventQuery;
      }),
      gt: vi.fn(() => eventQuery),
      order: vi.fn(() => eventQuery),
      limit: vi.fn(() => eventQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: 'same-target',
          name: '40 Chip Freezeout - 2.5K GTD (NLH)',
          start_time: '2026-11-03T06:00:00Z',
        },
        error: null,
      })),
    };
    vi.spyOn(supabase, 'from').mockImplementation((table: string) =>
      table === 'tournament_schedules' ? scheduleQuery : eventQuery
    );
    const result = await (new ScheduledTournamentService() as any).cancelledSatelliteTarget(
      { club_id: 'club', union_id: 'union' },
      '40 Chip Freezeout - 5K GTD (NLH)',
      new Date('2026-11-02T06:00:00Z')
    );
    expect(scheduleQuery.eq).toHaveBeenCalledWith('name', '40 Chip Freezeout - 5K GTD (NLH)');
    expect(scheduleQuery.eq).toHaveBeenCalledWith('union_id', 'union');
    expect(ids).toContainEqual(['schedule_id', ['original-five-k-schedule']]);
    expect(result.id).toBe('same-target');
  });
  it('applies after the fixed/weekly row builder and before Diamond pricing or admission', () => {
    const source = readFileSync(
      new URL('./ScheduledTournamentService.ts', import.meta.url),
      'utf8'
    );
    const begin = source.indexOf('private async spawnInstance(');
    const body = source.slice(begin, source.indexOf('private async spawnDiamondInstance', begin));
    expect(body.indexOf('withReducedTournamentGuarantee(')).toBeGreaterThan(
      body.indexOf('await this.buildInsertRow(')
    );
    expect(body.indexOf('withReducedTournamentGuarantee(')).toBeLessThan(
      body.indexOf('diamondSpawnConfig(')
    );
  });
});
