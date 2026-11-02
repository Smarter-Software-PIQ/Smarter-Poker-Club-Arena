import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMttLobbyEntryCounts } from '../../src/hooks/useMttLobbyEntryCounts';
import { tournamentEntry, type LobbyTournamentRow } from '../../src/components/lobby/lobbyEntries';
const { rpc, reportError } = vi.hoisted(() => ({ rpc: vi.fn(), reportError: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError }));
vi.mock('../../src/utils/requestDeadline', () => ({
  runWithRequestDeadline: (read: (signal: AbortSignal) => unknown) =>
    read(new AbortController().signal),
}));
const row = (id = 'a', current_players = 88, prize_pool = 11871) =>
  tournamentEntry(
    {
      id,
      format_contract: 'mtt-v1',
      name: 'Sunday',
      game_type: 'NLH',
      buy_in_amount: 50,
      buy_in_fee: 0,
      guaranteed_prize: 7500,
      start_time: new Date().toISOString(),
      status: 'RUNNING',
      current_players,
      max_players: null,
      starting_chips: 1000,
      prize_pool,
    } as LobbyTournamentRow,
    'mtt'
  );
function answer(data: unknown, error: unknown = null) {
  return { abortSignal: () => Promise.resolve({ data, error }) };
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('MTT lobby reads durable entry totals separately from active seats', () => {
  it('prints the aggregate while retaining the active count for admission', async () => {
    rpc.mockReturnValue(answer([{ tournament_id: 'a', entries: 142 }]));
    const { result, rerender } = renderHook(({ rows }) => useMttLobbyEntryCounts(rows), {
      initialProps: { rows: [row()] },
    });
    expect(result.current[0].entryCount).toBeNull();
    await waitFor(() => expect(result.current[0].entryCount).toBe(142));
    expect(result.current[0].players).toBe(88);
    rerender({ rows: [row('a', 87)] });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(result.current[0].entryCount).toBe(142);
  });
  it('refreshes when a rebuy changes the committed pool without changing active seats', async () => {
    rpc
      .mockReturnValueOnce(answer([{ tournament_id: 'a', entries: 142 }]))
      .mockReturnValueOnce(answer([{ tournament_id: 'a', entries: 143 }]));
    const { result, rerender } = renderHook(({ rows }) => useMttLobbyEntryCounts(rows), {
      initialProps: { rows: [row()] },
    });
    await waitFor(() => expect(result.current[0].entryCount).toBe(142));
    rerender({ rows: [row('a', 88, 11921)] });
    await waitFor(() => expect(result.current[0].entryCount).toBe(143));
  });
  it('rejects a superseded response after changing events', async () => {
    let resolve!: (value: unknown) => void;
    rpc
      .mockReturnValueOnce({
        abortSignal: () =>
          new Promise((done) => {
            resolve = done;
          }),
      })
      .mockReturnValueOnce(answer([{ tournament_id: 'b', entries: 7 }]));
    const { result, rerender } = renderHook(({ rows }) => useMttLobbyEntryCounts(rows), {
      initialProps: { rows: [row()] },
    });
    rerender({ rows: [row('b')] });
    await waitFor(() => expect(result.current[0].entryCount).toBe(7));
    await act(async () => resolve({ data: [{ tournament_id: 'a', entries: 999 }], error: null }));
    expect(result.current[0].entryCount).toBe(7);
  });
  it('does not substitute the remaining field when the aggregate fails or is incomplete', async () => {
    rpc.mockReturnValueOnce(answer(null, new Error('denied'))).mockReturnValueOnce(answer([]));
    const { result, rerender } = renderHook(({ rows }) => useMttLobbyEntryCounts(rows), {
      initialProps: { rows: [row()] },
    });
    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    expect(result.current[0].entryCount).toBeNull();
    rerender({ rows: [row('b')] });
    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(2));
    expect(result.current[0].entryCount).toBeNull();
  });
  it('retains and marks the last known total when a refresh fails', async () => {
    rpc
      .mockReturnValueOnce(answer([{ tournament_id: 'a', entries: 142 }]))
      .mockReturnValueOnce(answer(null, new Error('offline')));
    const { result, rerender } = renderHook(({ rows }) => useMttLobbyEntryCounts(rows), {
      initialProps: { rows: [row()] },
    });
    await waitFor(() => expect(result.current[0].entryCount).toBe(142));
    rerender({ rows: [row('a', 87)] });
    await waitFor(() => expect(result.current[0].entryCountStale).toBe(true));
    expect(result.current[0].entryCount).toBe(142);
  });
  it('does not requery on an unrelated render or open per-tournament roster reads', async () => {
    rpc.mockReturnValue(answer([{ tournament_id: 'a', entries: 142 }]));
    const { result, rerender } = renderHook(({ rows }) => useMttLobbyEntryCounts(rows), {
      initialProps: { rows: [row()] },
    });
    await waitFor(() => expect(result.current[0].entryCount).toBe(142));
    rerender({ rows: [row()] });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('fn_mtt_lobby_entry_counts', { p_tournament_ids: ['a'] });
  });
});
