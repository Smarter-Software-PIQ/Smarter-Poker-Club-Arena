/**
 * THE SHARED FUNDING HOOK (2026-11-07): one read of
 * fn_ca_tournament_prize_funding for every projected ladder. It fetches only
 * for a guaranteed event, keys its answer to the tournament's pool columns so
 * a stale read is never shown against a newer row, re-reads on a standings
 * update, and answers null (never zero) when the read fails or mismatches.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  notify: () => {},
  answer: (id: string): any => ({
    data: {
      tournament_id: id,
      collected: 1656,
      overlay: 844,
      net_coverage: 1656,
      house_required: 844,
      house_posted: 0,
      house_due: 844,
    },
    error: null,
  }),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((name: string, args: { p_tournament_id: string }) => {
      state.calls.push(name);
      return { abortSignal: () => Promise.resolve(state.answer(args.p_tournament_id)) };
    }),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: (_id: string, notify: () => void) => {
    state.notify = notify;
    return () => {
      state.notify = () => {};
    };
  },
}));
import { useTournamentPrizeFunding } from '../../src/hooks/useTournamentPrizeFunding';
import { reportError } from '../../src/utils/errorReporter';

afterEach(() => {
  cleanup();
  state.calls = [];
  state.answer = (id) => ({
    data: {
      tournament_id: id,
      collected: 1656,
      overlay: 844,
      net_coverage: 1656,
      house_required: 844,
      house_posted: 0,
      house_due: 844,
    },
    error: null,
  });
  vi.mocked(reportError).mockReset();
});

const row = (over: Record<string, unknown> = {}) => ({
  prize_pool: 1196,
  bounty_pool: 460,
  prize_pool_finalized: false,
  guaranteed_prize: 2500,
  ...over,
});

describe('useTournamentPrizeFunding', () => {
  it('reads the worked example once and returns the database shape', async () => {
    const { result } = renderHook(() => useTournamentPrizeFunding('t-1', row()));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toMatchObject({
      collected: 1656,
      overlay: 844,
      netCoverage: 1656,
      houseRequired: 844,
      housePosted: 0,
      houseSupplementPaid: null,
      houseDue: 844,
    });
    expect(state.calls).toEqual(['fn_ca_tournament_prize_funding']);
  });

  it('reads actual completed promo supplements separately from the sealed prize pool', async () => {
    state.answer = (id) => ({
      data: {
        tournament_id: id,
        collected: 2412,
        overlay: 0,
        net_coverage: 2412,
        house_required: 88,
        house_posted: 88,
        house_due: 0,
        house_supplement_paid: 88,
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useTournamentPrizeFunding(
        't-closed',
        row({
          prize_pool: 1742,
          bounty_pool: 670,
          prize_pool_finalized: true,
        })
      )
    );
    await waitFor(() => expect(result.current?.houseSupplementPaid).toBe(88));
    expect(result.current).toMatchObject({ netCoverage: 2412, housePosted: 88, houseDue: 0 });
  });

  it('does not read for an event without a guarantee', async () => {
    const { result } = renderHook(() =>
      useTournamentPrizeFunding('t-1', row({ guaranteed_prize: 0 }))
    );
    await act(async () => {});
    expect(result.current).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('drops a read keyed to an older pool until the new one lands', async () => {
    const { result, rerender } = renderHook(
      ({ r }: { r: ReturnType<typeof row> }) => useTournamentPrizeFunding('t-1', r),
      { initialProps: { r: row() } }
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    let release!: (v: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    state.answer = () => pending;
    rerender({ r: row({ prize_pool: 1300 }) });
    // The old answer is keyed to the old pool: nothing is shown against the new row.
    expect(result.current).toBeNull();
    await act(async () => {});
    expect(result.current).toBeNull();
    await act(async () =>
      release({
        data: { tournament_id: 't-1', collected: 1800, overlay: 516, house_due: 516 },
        error: null,
      })
    );
    await waitFor(() => expect(result.current?.collected).toBe(1800));
  });

  it('re-reads on a standings update', async () => {
    const { result } = renderHook(() => useTournamentPrizeFunding('t-1', row()));
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => state.notify());
    expect(state.calls).toHaveLength(2);
  });

  it('answers null, and reports, when the read fails or names another event', async () => {
    state.answer = () => ({ data: null, error: new Error('Funding unavailable') });
    const first = renderHook(() =>
      useTournamentPrizeFunding('t-1', row(), 'Surface.prize_funding_load_failed')
    );
    await act(async () => {});
    expect(first.result.current).toBeNull();
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(
        expect.anything(),
        'Surface.prize_funding_load_failed'
      )
    );
    first.unmount();
    state.answer = () => ({
      data: { tournament_id: 'someone-else', collected: 1, overlay: 1 },
      error: null,
    });
    const second = renderHook(() => useTournamentPrizeFunding('t-1', row()));
    await act(async () => {});
    expect(second.result.current).toBeNull();
  });
});
