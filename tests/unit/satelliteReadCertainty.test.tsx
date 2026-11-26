import { RETIRED_TOURNAMENT_IDS } from '../../src/lib/retiredTournamentVisibility';
import { act, cleanup, render, screen, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), report: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: mocks.report }));
import SatellitesTab from '../../src/components/tournament/details/SatellitesTab';
import type { TournamentTabProps } from '../../src/components/tournament/details/types';
vi.mock('../../src/components/tournament/details/SatelliteCard', () => ({ default: () => null }));
import { useSatellites } from '../../src/components/tournament/details/useSatellites';
function query(data: unknown) {
  const q: any = { then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve) };
  for (const key of ['select', 'or', 'in', 'eq', 'order', 'limit', 'abortSignal']) q[key] = () => q;
  return q;
}
const row = { id: 'satellite', name: 'Satellite', status: 'REGISTERING' };
beforeEach(() => {
  mocks.from.mockReset();
  mocks.report.mockClear();
});
afterEach(cleanup);
describe('satellite reads distinguish an empty answer from no answer', () => {
  it('omits retired satellite cards and registration candidates while preserving current events', async () => {
    mocks.from.mockImplementation((table) =>
      query(table === 'tournaments' ? [row, { ...row, id: RETIRED_TOURNAMENT_IDS[0] }] : [])
    );
    const { result } = renderHook(() => useSatellites('target', 'viewer'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cards.map((card) => card.id)).toEqual(['satellite']);
    expect(result.current.registration).toEqual({ satellite: false });
  });
  it.each(['diamonds', 'chips'])(
    'displays admission in the feeder arena denomination for %s',
    async (asset) => {
      const q = query([
        {
          ...row,
          arena: { asset, is_platform: true, union_id: null },
          buy_in_amount: 9,
          buy_in_fee: 1,
        },
      ]);
      const select = vi.spyOn(q, 'select');
      mocks.from.mockReturnValue(q);
      render(
        <SatellitesTab
          {...({ tournament: { id: 'target', name: 'Main Event' } } as TournamentTabProps)}
        />
      );
      expect(
        await screen.findByText(asset === 'diamonds' ? '10 Diamonds' : '10 Chips')
      ).toBeVisible();
      expect(select).toHaveBeenCalledWith(
        expect.stringContaining(
          'arena:clubs!tournaments_club_id_fkey(id, asset, is_platform, union_id)'
        )
      );
    }
  );
  it('does not query satellites for a retired target', () => {
    const { result } = renderHook(() => useSatellites(RETIRED_TOURNAMENT_IDS[0], 'viewer'));
    expect(result.current.cards).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('reports an unreadable list and accepts an explicit retry with a real empty list', async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query([]));
    const { result } = renderHook(() => useSatellites('target', 'viewer'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Satellites Could Not Be Loaded');
    act(() => result.current.retry());
    await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.cards).toEqual([]);
  });
  it('keeps unreadable membership unknown instead of authorizing a Register display', async () => {
    mocks.from.mockImplementation((table) => query(table === 'tournaments' ? [row] : null));
    const { result } = renderHook(() => useSatellites('target', 'viewer'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.registration).toBeNull();
    expect(mocks.report).toHaveBeenCalledWith(expect.any(Error), 'useSatellites.registration');
  });
  it('accepts an empty membership answer as not registered', async () => {
    mocks.from.mockImplementation((table) => query(table === 'tournaments' ? [row] : []));
    const { result } = renderHook(() => useSatellites('target', 'viewer'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.registration).toEqual({ satellite: false });
  });
});
