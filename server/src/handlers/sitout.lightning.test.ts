import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../http/auth.js', () => ({ authenticateRequest: vi.fn() }));
vi.mock('../http/body.js', () => ({ readBody: vi.fn() }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
import { authenticateRequest } from '../http/auth.js';
import { readBody } from '../http/body.js';
import { handleSitout } from './sitout.js';
import { mockReq, mockRes, parseJson } from './_testHelpers.js';

const room = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const table = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const sitOut = vi.fn();
const getTableEngine = vi.fn();
const lightningAnchorFor = vi.fn();
const lightningSeatReady = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'owner' } as never);
  sitOut.mockReturnValue({ success: true, willFoldNextHand: false });
  getTableEngine.mockImplementation((id: string) => (id === table ? { sitOut } : null));
});

async function request(tableId: string, wanted: boolean) {
  vi.mocked(readBody).mockResolvedValue(
    JSON.stringify({ tableId, sitOut: wanted, userId: 'forged' })
  );
  const { res, captured } = mockRes();
  await handleSitout(mockReq(), res, {
    gameServer: { getTableEngine, lightningAnchorFor, lightningSeatReady },
  });
  return { status: captured.statusCode, body: parseJson(captured) };
}

describe('Lightning room sit out and return', () => {
  it.each([true, false])('routes sitOut=%s through the caller-owned anchor', async (wanted) => {
    lightningAnchorFor.mockResolvedValue({ anchorTableId: table });
    expect(await request(room, wanted)).toMatchObject({ status: 200, body: { success: true } });
    expect(lightningAnchorFor).toHaveBeenCalledWith(room, 'owner', { requireOpen: true });
    expect(sitOut.mock.calls).toEqual([['owner', wanted, { requestedByClient: true }]]);
  });

  it.each(['foreign', 'closed'])('refuses a %s pool without touching an engine', async () => {
    lightningAnchorFor.mockResolvedValue(null);
    expect((await request(room, true)).status).toBe(404);
    expect(sitOut).not.toHaveBeenCalled();
  });

  it('preserves the physical cash-table route and its one-hand refusal', async () => {
    sitOut.mockReturnValue({
      success: false,
      error: 'You Must Play At Least One Hand Before You Can Sit Out',
      willFoldNextHand: false,
    });
    expect(await request(table, true)).toMatchObject({
      status: 400,
      body: { success: false, error: 'You Must Play At Least One Hand Before You Can Sit Out' },
    });
    expect(lightningAnchorFor).not.toHaveBeenCalled();
    expect(sitOut.mock.calls).toEqual([['owner', true, { requestedByClient: true }]]);
  });

  it('refuses an anchor whose engine is unavailable', async () => {
    lightningAnchorFor.mockResolvedValue({ anchorTableId: 'missing' });
    expect((await request(room, false)).status).toBe(404);
    expect(sitOut).not.toHaveBeenCalled();
  });

  it('authenticates before resolving a private room', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null);
    expect((await request(room, true)).status).toBe(401);
    expect(lightningAnchorFor).not.toHaveBeenCalled();
    expect(sitOut).not.toHaveBeenCalled();
  });
});

describe('restarted Lightning feeder eligibility continuation', () => {
  it('supplements only a known no-hand refusal using current authenticated occupancy proof', async () => {
    const engine = { sitOut };
    getTableEngine.mockImplementation((id: string) => (id === table ? engine : null));
    lightningAnchorFor
      .mockResolvedValueOnce({ anchorTableId: table })
      .mockResolvedValueOnce({ anchorTableId: table, completedHandOccupancyId: 'current' });
    sitOut
      .mockReturnValueOnce({ success: false, code: 'SITOUT_HAND_REQUIRED' })
      .mockReturnValueOnce({ success: true, willFoldNextHand: false });
    expect((await request(room, true)).status).toBe(200);
    expect(lightningAnchorFor.mock.calls).toEqual([
      [room, 'owner', { requireOpen: true }],
      [room, 'owner', { requireOpen: true, requireCompletedHand: true }],
    ]);
    expect(sitOut.mock.calls).toEqual([
      ['owner', true, { requestedByClient: true }],
      ['owner', true, { completedLightningOccupancyId: 'current', requestedByClient: true }],
    ]);
  });
  it('keeps no-hand refusal when the exact current pool has no settled participation', async () => {
    lightningAnchorFor.mockResolvedValueOnce({ anchorTableId: table }).mockResolvedValueOnce(null);
    sitOut.mockReturnValue({ success: false, code: 'SITOUT_HAND_REQUIRED' });
    expect((await request(room, true)).status).toBe(400);
    expect(sitOut).toHaveBeenCalledOnce();
  });
  it('never applies proof to a replaced engine after the awaited read', async () => {
    lightningAnchorFor
      .mockResolvedValueOnce({ anchorTableId: table })
      .mockResolvedValueOnce({ anchorTableId: table, completedHandOccupancyId: 'current' });
    sitOut.mockReturnValue({ success: false, code: 'SITOUT_HAND_REQUIRED' });
    expect((await request(room, true)).status).toBe(400);
    expect(sitOut).toHaveBeenCalledOnce();
  });
});

describe('matching follows the original transition ACK', () => {
  it.each([false, true])(
    'waits for persistence before returning a seat to matching (sitOut=%s)',
    async (wanted) => {
      let resolve!: (v: any) => void;
      const committed = new Promise<any>((r) => {
        resolve = r;
      });
      const sitOutAndWait = vi.fn(() => committed);
      const engine = { sitOut, sitOutAndWait };
      getTableEngine.mockImplementation((id: string) => (id === table ? engine : null));
      lightningAnchorFor.mockResolvedValue({ anchorTableId: table });
      const pending = request(room, wanted);
      await vi.waitFor(() =>
        expect(sitOutAndWait).toHaveBeenCalledWith('owner', wanted, { requestedByClient: true })
      );
      expect(lightningSeatReady).not.toHaveBeenCalled();
      resolve({ success: true, blindOff: wanted, lightningClusterId: table });
      expect((await pending).status).toBe(200);
      expect(lightningSeatReady).toHaveBeenCalledWith(table);
      expect(sitOut).not.toHaveBeenCalled();
    }
  );
  it('a refused original write never announces a ready seat', async () => {
    const engine = { sitOut, sitOutAndWait: vi.fn(async () => ({ success: false })) };
    getTableEngine.mockImplementation((id: string) => (id === table ? engine : null));
    lightningAnchorFor.mockResolvedValue({ anchorTableId: table });
    expect((await request(room, false)).status).toBe(400);
    expect(lightningSeatReady).not.toHaveBeenCalled();
  });
});

it.each([
  ['P2S01', 'Your Play Limits Do Not Allow More Hands Right Now.'],
  ['P2S02', 'Your Seat Changed. Refresh The Table Before Trying Again.'],
])('a declared %s refusal reaches the player without a matcher wake', async (code, error) => {
  const engine = {
    sitOut,
    sitOutAndWait: vi.fn(async () => {
      throw Object.assign(new Error('private diagnostic'), { code });
    }),
  };
  getTableEngine.mockImplementation((id: string) => (id === table ? engine : null));
  lightningAnchorFor.mockResolvedValue({ anchorTableId: table });
  expect(await request(room, false)).toMatchObject({
    status: 400,
    body: { success: false, code, error },
  });
  expect(lightningSeatReady).not.toHaveBeenCalled();
});
