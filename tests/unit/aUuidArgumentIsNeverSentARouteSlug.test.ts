/**
 * 2026-11-26 production errors, each a route segment sent to a uuid:
 *   - /api/club-arena/spin-activation answered `clubs.id = 'kings-club'` and
 *     `'crest-cert-*'` with Postgres 22P02 (ClubSettingsPage handed the route
 *     slug to SpinActivationPanel);
 *   - fn_game_creation_access({ p_club_id: 'demo' }) and
 *     tables?id=in.(demo) / in.(nonexistent-table-id) on /table/demo routes.
 * The doors below now refuse to send what is not an id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
    from: vi.fn(),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { spinActivationApi } from '../../src/services/SpinActivationService';
import { fetchGameCreationAccess } from '../../src/services/GameAccessService';

const CLUB = '6b0f5a3e-2c1d-4e7f-9a8b-1c2d3e4f5a6b';

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.getSession.mockReset();
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 't', user: { id: 'u1' } } },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: { owner_id: CLUB }, canManage: false }),
    }))
  );
});

describe('the Spin route is only ever asked about a club id', () => {
  it.each(['kings-club', 'crest-cert-1764190000-3', 'demo', ''])(
    'refuses %j without a request',
    async (slug) => {
      await expect(spinActivationApi.getState(slug)).rejects.toThrow(
        'The Spin Wallet Owner Could Not Be Identified.'
      );
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('still asks for a uuid', async () => {
    await spinActivationApi.getState(CLUB);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ action: 'get_state', clubId: CLUB });
  });
});

describe('fn_game_creation_access is only ever asked about a club id', () => {
  it.each(['demo', 'kings-club', 'nonexistent-table-id'])('%j is an unknown club, not a call', async (slug) => {
    await expect(fetchGameCreationAccess(slug)).resolves.toEqual({
      allowed: false,
      unionId: null,
      reason: 'unknown_club',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('asks for a uuid', async () => {
    mocks.rpc.mockResolvedValue({ data: { allowed: false }, error: null });
    await fetchGameCreationAccess(CLUB);
    expect(mocks.rpc).toHaveBeenCalledWith('fn_game_creation_access', { p_club_id: CLUB });
  });
});
