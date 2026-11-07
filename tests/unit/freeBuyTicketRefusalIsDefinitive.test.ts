import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Free Buy ticket refusal rolls the whole registration back inside the
// database, so the client neither retries it nor reports it as an
// unconfirmed result; it says why (owner, 2026-11-06).

const { mockRpc, mockReport } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockReport: vi.fn() }));

vi.mock('../../src/lib/supabase', () => {
  const tournament = {
    id: 'free-buy-1',
    name: 'Morning Free Buy (NLH)',
    club_id: 'club-1',
    status: 'REGISTERING',
  };
  const query: any = {
    select: () => query,
    abortSignal: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: tournament, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [tournament], error: null }),
  };
  return {
    getAuthUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    supabase: {
      rpc: (...args: unknown[]) => {
        const result = Promise.resolve(mockRpc(...args));
        return Object.assign(result, { abortSignal: () => result });
      },
      from: () => query,
    },
  };
});
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));
vi.mock('../../src/utils/retryAsync', () => ({ retryAsync: <T>(fn: () => Promise<T>) => fn() }));
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUID: vi.fn().mockResolvedValue('club-1'),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: mockReport }));
vi.mock('../../src/utils/uuid', () => ({ uuid: () => '00000000-0000-4000-8000-000000000001' }));

import { registerReasonText, tournamentService } from '../../src/services/TournamentService';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockRpc.mockReset();
  mockReport.mockReset();
  vi.stubGlobal('navigator', {
    locks: { request: (_k: string, fn: () => Promise<unknown>) => fn() },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('a Free Buy ticket refusal is definitive', () => {
  it.each([
    [
      "FREE_BUY_TICKETS_USED_TODAY: all five of today's Free Buy tickets are used",
      'free_buy_tickets_used_today',
    ],
    [
      'FREE_BUY_TICKET_ALREADY_USED_FOR_EVENT: one Free Buy ticket per player per event',
      'free_buy_ticket_already_used_for_event',
    ],
  ])(
    '%s is said in plain words, asked once, and not reported as unconfirmed',
    async (message, reason) => {
      mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
      await expect(
        tournamentService.registerPlayer('free-buy-1', 'user-1', 'Player')
      ).rejects.toThrow(registerReasonText(reason));
      expect(registerReasonText(reason)).toMatch(/No Chips Were Charged\.$/);
      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockReport.mock.calls.map((c) => c[1])).not.toContain(
        'TournamentService.registration_result_unconfirmed'
      );
    }
  );

  it('any other database error is still retried once and reported as unconfirmed', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    await expect(
      tournamentService.registerPlayer('free-buy-1', 'user-1', 'Player')
    ).rejects.toThrow('Could Not Confirm Tournament Registration');
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockReport.mock.calls.map((c) => c[1])).toContain(
      'TournamentService.registration_result_unconfirmed'
    );
  });

  it('reads the book of the event and treats an unreadable answer as unknown', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        applies: true,
        gaming_day: '2026-11-07',
        today: false,
        allotment: 5,
        used: 4,
        remaining: 1,
        used_here: false,
      },
      error: null,
    });
    await expect(tournamentService.getFreeBuyTicketsForEvent('free-buy-1')).resolves.toMatchObject({
      applies: true,
      remaining: 1,
      today: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('fn_ca_free_buy_tickets_for_event', {
      p_tournament_id: 'free-buy-1',
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    await expect(tournamentService.getFreeBuyTicketsForEvent('free-buy-1')).resolves.toBeNull();
    mockRpc.mockRejectedValueOnce(new Error('offline'));
    await expect(tournamentService.getFreeBuyTicketsForEvent('free-buy-1')).resolves.toBeNull();
  });
});
