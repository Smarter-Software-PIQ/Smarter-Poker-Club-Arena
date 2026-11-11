import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lane: vi.fn(), rpc: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { rpc: mocks.rpc },
  DB_TIMEOUT_MS: 15_000,
}));
vi.mock('../services/lightningLaneSession.js', async () => {
  const real = await vi.importActual<typeof import('../services/lightningLaneSession.js')>(
    '../services/lightningLaneSession.js'
  );
  return { ...real, lightningLaneCall: mocks.lane };
});
const { createSupabaseLightningHandBackend } = await import('./LightningHandBackend.js');

const hand = '027ab7d1-b13c-4a9d-a7c3-4616f3d39e29';
const request = 'b13cc1cf-8efc-4147-a262-cb2c640bf701';
const table = '121f80d2-5290-42e5-a32b-4d3a702e2772';
const settle = {
  handId: hand,
  requestId: request,
  hostTableId: table,
  leaseInstance: 'engine-1',
  leaseGeneration: '6f2c3a3e-8c55-4a6e-9a0d-1f1e2d3c4b5a',
  results: [],
  rake: 0,
  bbj: 0,
  handRow: {},
};
beforeEach(() => {
  mocks.lane.mockReset();
  mocks.rpc.mockReset();
});

describe("Lightning's per-hand calls: PostgREST only when the lane proves nothing was sent", () => {
  it('a lane that sent nothing (null) lets the same call go through PostgREST once', async () => {
    mocks.lane.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ data: { ok: true, hand_history_id: hand }, error: null });
    const out = await createSupabaseLightningHandBackend().settle(settle as never);
    expect(out.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe('fn_lightning_settle_hand');
  });

  for (const [name, error] of [
    ['unknown', { message: 'lightning_lane_outcome_unknown', code: 'LIGHTNING_LANE_UNKNOWN' }],
    [
      'rolled back',
      {
        message: 'lightning_lane_rolled_back',
        code: 'LIGHTNING_LANE_ROLLED_BACK',
        sqlState: '55P03',
      },
    ],
  ] as const) {
    it(`a lane call that was sent and came back ${name} never reaches PostgREST; it is a transport failure the host resolves by the same request id`, async () => {
      mocks.lane.mockResolvedValue({ data: null, error });
      const out = await createSupabaseLightningHandBackend().settle(settle as never);
      expect(out).toEqual({
        ok: false,
        reason: 'fn_lightning_settle_hand_failed',
        transport: true,
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }

  it('a settle retried after an unknown outcome carries the same request id, so the database replays its receipt', async () => {
    mocks.lane
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'lightning_lane_outcome_unknown', code: 'LIGHTNING_LANE_UNKNOWN' },
      })
      .mockResolvedValueOnce({
        data: { ok: true, replay: true, hand_history_id: hand },
        error: null,
      });
    const backend = createSupabaseLightningHandBackend();
    expect((await backend.settle(settle as never)).ok).toBe(false);
    const second = await backend.settle(settle as never);
    expect(second.ok).toBe(true);
    expect(mocks.lane.mock.calls[0][1]).toEqual(mocks.lane.mock.calls[1][1]);
    expect(mocks.lane.mock.calls[1][1].p_request_id).toBe(request);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
