import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../http/auth.js', () => ({ authenticateRequest: vi.fn() }));
vi.mock('../http/body.js', () => ({ readBody: vi.fn() }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
vi.mock('../services/TableViewerAccess.js', () => ({ authorizeTableViewer: vi.fn() }));
import { authenticateRequest } from '../http/auth.js';
import { readBody } from '../http/body.js';
import { handleSeatArrival } from './seatArrival.js';
import { mockReq, mockRes, parseJson } from './_testHelpers.js';

const tableId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const noteSeatArrival = vi.fn();
const getTableEngine = vi.fn();
const authorizeViewer = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'token-user' } as any);
  noteSeatArrival.mockResolvedValue({ ok: true });
  getTableEngine.mockReturnValue({ noteSeatArrival });
  authorizeViewer.mockResolvedValue({ allowed: true, reason: 'club_member', clubId: 'c' });
});
async function post(body: unknown) {
  vi.mocked(readBody).mockResolvedValue(JSON.stringify(body));
  const { res, captured } = mockRes();
  await handleSeatArrival(mockReq(), res, { gameServer: { getTableEngine }, authorizeViewer });
  return { status: captured.statusCode, body: parseJson(captured) };
}

describe('POST /seat_arrival', () => {
  it('requires authentication', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null);
    expect((await post({ tableId, state: 'seated' })).status).toBe(401);
    expect(getTableEngine).not.toHaveBeenCalled();
  });
  it('acts for the token player, never a player named in the body', async () => {
    await post({ tableId, state: 'hold', seatNumber: 3, userId: 'someone-else' });
    expect(noteSeatArrival).toHaveBeenCalledWith('token-user', { state: 'hold', seatNumber: 3 });
  });
  it.each([
    { tableId: 'not-a-table', state: 'seated' },
    { tableId, state: 'sit' },
    { tableId, state: 'hold' },
    { tableId, state: 'hold', seatNumber: 0 },
    { tableId, state: 'hold', seatNumber: 1.5 },
  ])('refuses a malformed request %o', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(noteSeatArrival).not.toHaveBeenCalled();
  });
  it('lets only a permitted viewer show a face in a chair', async () => {
    authorizeViewer.mockResolvedValue({
      allowed: false,
      reason: 'membership_required',
      clubId: 'c',
    });
    expect((await post({ tableId, state: 'hold', seatNumber: 2 })).status).toBe(403);
    expect(noteSeatArrival).not.toHaveBeenCalled();
  });
  it('reports the engine refusal as a conflict, not a failure', async () => {
    noteSeatArrival.mockResolvedValue({ ok: false, reason: 'seat_held' });
    expect(await post({ tableId, state: 'hold', seatNumber: 2 })).toEqual({
      status: 409,
      body: { success: false, reason: 'seat_held' },
    });
  });
  it('says untracked when this process deals no such table', async () => {
    getTableEngine.mockReturnValue(null);
    expect(await post({ tableId, state: 'seated' })).toEqual({
      status: 200,
      body: { success: true, tracked: false },
    });
  });
});
