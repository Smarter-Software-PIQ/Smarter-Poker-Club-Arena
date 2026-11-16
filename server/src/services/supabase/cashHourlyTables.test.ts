import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './client.js';
import { closeHourlyCashTable, readHourlyCashAdmissions } from './cashHourlyTables.js';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.restoreAllMocks());
describe('hourly cash closure checks original receipt identity', () => {
  it('only exposes admitted tables with an explicit individual arrival budget', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: [
        { table_id: id, allowed: true, max_horses: 1, starts_game: true },
        { table_id: 'blocked', allowed: false, max_horses: 6, starts_game: false },
      ],
      error: null,
    } as any);
    expect([...(await readHourlyCashAdmissions())]).toEqual([
      [id, { maxHorses: 1, startsGame: true }],
    ]);
  });
  it.each([null, [{ table_id: id, allowed: true, max_horses: 0, starts_game: true }]])(
    'an unreadable arrival budget permits no purchases',
    async (data) => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data, error: null } as any);
      await expect(readHourlyCashAdmissions()).rejects.toThrow();
    }
  );
  it.each([
    null,
    { closed: true, table_id: 'other', operation_id: id, departures: [] },
    { closed: true, table_id: id, operation_id: 'other', departures: [] },
    { closed: true, table_id: id, operation_id: id, departures: [{}] },
    { closed: false },
  ])('retains malformed outcomes as unknown', async (data) => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data, error: null } as any);
    await expect(closeHourlyCashTable(id, id, 'engine', id)).rejects.toThrow();
  });
  it('binds the operation to the exact engine lease', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { closed: false, reason: 'within_cap_or_human' },
      error: null,
    } as any);
    expect(await closeHourlyCashTable(id, id, 'engine', id)).toEqual({
      closed: false,
      reason: 'within_cap_or_human',
    });
    expect(rpc).toHaveBeenCalledWith('fn_cash_hourly_table_close', {
      p_table_id: id,
      p_operation_id: id,
      p_instance_id: 'engine',
      p_lease_generation: id,
    });
  });
});
