import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: db }));
import {
  fetchStoppedLightningAnchor,
  rememberedLightningLeaveAnchor,
  rememberLightningLeaveAnchor,
} from '../../src/lightning/lightningLeaveAnchor';
const TABLE = '11111111-1111-4111-8111-111111111111';
const OCCUPANCY = '22222222-2222-4222-8222-222222222222';
const session = { poolSessionId: null, seatTableId: TABLE, seatNumber: 2 } as any;
const room = { poolSessionId: 'room-A', clusterId: 'cluster' };
const original = { tableId: TABLE, occupancyId: OCCUPANCY };
const row = {
  table_id: TABLE,
  user_id: 'hero',
  seat_number: 2,
  occupancy_id: OCCUPANCY,
  left_at: null,
};
beforeEach(() => {
  vi.resetAllMocks();
});
describe('stopping between hands still leaves through the real anchor', () => {
  it('reads the current own occupancy after the pool has closed', async () => {
    db.rpc.mockResolvedValue({ data: row, error: null });
    expect(await fetchStoppedLightningAnchor(session, 'hero', room, original)).toEqual({
      anchorTableId: TABLE,
      seatNumber: 2,
      occupancyId: OCCUPANCY,
    });
    expect(db.rpc).toHaveBeenCalledWith('fn_lightning_stopped_leave_anchor', {
      p_cluster_id: room.clusterId,
      p_pool_session_id: room.poolSessionId,
      p_occupancy_id: OCCUPANCY,
    });
  });
  it('does not invent a seat after cash-out already completed', async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchStoppedLightningAnchor(session, 'hero', room, original)).toBeNull();
    expect(
      await fetchStoppedLightningAnchor({ ...session, seatTableId: null }, 'hero', room, null)
    ).toBeNull();
  });
  it.each([
    { ...row, user_id: 'peer' },
    { ...row, seat_number: 0 },
    { ...row, occupancy_id: null },
    { ...row, occupancy_id: '77777777-7777-4777-8777-777777777777' },
    { ...row, left_at: 'ended' },
  ])('refuses a changed or incomplete occupancy', async (data) => {
    db.rpc.mockResolvedValue({ data, error: null });
    await expect(fetchStoppedLightningAnchor(session, 'hero', room, original)).rejects.toThrow(
      'Unverified'
    );
  });
  it('preserves an unreadable result as an error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: new Error('offline') });
    await expect(fetchStoppedLightningAnchor(session, 'hero', room, original)).rejects.toThrow(
      'offline'
    );
  });
});

it('retains only the verified occupant of this user and room across a reload', () => {
  rememberLightningLeaveAnchor('hero', 'room-A', original);
  expect(rememberedLightningLeaveAnchor('hero', 'room-A')).toEqual(original);
  expect(rememberedLightningLeaveAnchor('hero', 'room-B')).toBeNull();
  expect(rememberedLightningLeaveAnchor('peer', 'room-A')).toBeNull();
});
it('cannot acquire a newly discovered occupancy without the original binding', async () => {
  await expect(fetchStoppedLightningAnchor(session, 'hero', room, null)).rejects.toThrow(
    'Unverified'
  );
  expect(db.rpc).not.toHaveBeenCalled();
});
