import { beforeEach, describe, expect, it, vi } from 'vitest';
const { from, query } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(), order: vi.fn() };
  return { from: vi.fn(), query };
});
vi.mock('../../src/lib/supabase', () => ({ supabase: { from } }));
import { getMemberLiveTables } from '../../src/services/PlayerSearchService';

const seat = (id: string, club = 'club-1') => ({
  table_id: id,
  club_id: club,
  tables: {
    id,
    name: `Table ${id}`,
    stakes: '100/200',
    tournament_id: null as string | null,
    is_deleted: false,
    club_id: club,
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  from.mockReturnValue(query);
  for (const key of ['select', 'eq', 'is', 'in'] as const) query[key].mockReturnValue(query);
});
describe('every live member table', () => {
  it('returns all unique cash and tournament seats, including funded union seats, without truncation', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => seat(String(i)));
    rows[3].tables.tournament_id = 'event-1';
    rows[4].tables.club_id = 'union-host';
    query.order.mockResolvedValue({ data: [...rows, rows[0]], error: null });
    const tables = await getMemberLiveTables('player-1', 'club-1');
    expect(tables).toHaveLength(12);
    expect(tables[3]).toMatchObject({ table_id: '3', is_tournament: true });
    expect(tables[4].table_id).toBe('4');
    expect(from).toHaveBeenCalledWith('table_seats');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'player-1');
    expect(query.is).toHaveBeenCalledWith('left_at', null);
    expect(query.in).toHaveBeenCalledWith('tables.status', ['waiting', 'running']);
  });
  it('omits deleted, unreadable and other-club tables', async () => {
    query.order.mockResolvedValue({
      data: [
        seat('ok'),
        seat('other', 'club-2'),
        { ...seat('gone'), tables: { ...seat('gone').tables, is_deleted: true } },
        { ...seat('private'), tables: null },
      ],
      error: null,
    });
    expect((await getMemberLiveTables('player-1', 'club-1')).map((t) => t.table_id)).toEqual([
      'ok',
    ]);
  });
  it('preserves an empty result and surfaces failed reads', async () => {
    query.order.mockResolvedValueOnce({ data: [], error: null });
    expect(await getMemberLiveTables('player-1', 'club-1')).toEqual([]);
    query.order.mockResolvedValueOnce({ data: null, error: { message: 'Access Denied' } });
    await expect(getMemberLiveTables('player-1', 'club-1')).rejects.toThrow('Access Denied');
  });
});
