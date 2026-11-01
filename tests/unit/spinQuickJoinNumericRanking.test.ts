import { afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { quickJoinSpinRows } from '../../src/lib/quickJoinSpins';
afterEach(() => vi.restoreAllMocks());
function fixture(stakes: number[]) {
  h.from.mockImplementation((relation: string) => {
    const q: any = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'or', 'order', 'limit']) q[method] = () => q;
    q.maybeSingle = async () => ({
      data:
        relation === 'tables'
          ? { id: 'current-table', tournament_id: 'current-event' }
          : { id: 'current-event', club_id: 'club', tournament_type: 'SPIN', buy_in_amount: 1000 },
      error: null,
    });
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: stakes.map((stake, i) =>
          relation === 'tournaments'
            ? { id: `event-${i}`, name: 'Spin', buy_in_amount: stake, max_players: 3 }
            : { id: `table-${i}`, tournament_id: `event-${i}`, current_players: 1, max_players: 3 }
        ),
        error: null,
      }).then(resolve);
    return q;
  });
}
describe('Spin suggestions rank original numeric stakes', () => {
  it.each(['de-DE', 'ar-EG', 'en-US'])(
    'keeps nearest stakes first with %s display labels',
    async (locale) => {
      const original = Number.prototype.toLocaleString;
      vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number) {
        return original.call(this, locale);
      });
      fixture([16000, 1500, 1100]);
      const rows = await quickJoinSpinRows(['club'], 'current-table', new Set());
      expect(rows?.map((row) => row.id)).toEqual(['table-2', 'table-1', 'table-0']);
      expect(rows?.[0].stakes).toBe(original.call(1100, locale));
    }
  );
  it('keeps same stake first and excludes an already open table', async () => {
    fixture([1100, 1000, 1500]);
    const rows = await quickJoinSpinRows(['club'], 'current-table', new Set(['table-0']));
    expect(rows?.map((row) => row.id)).toEqual(['table-1', 'table-2']);
  });
});
