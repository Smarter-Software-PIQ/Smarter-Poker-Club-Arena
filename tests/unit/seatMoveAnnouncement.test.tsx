import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeatMoveAnnouncement } from '../../src/hooks/useSeatMoveAnnouncement';
const { read, selects } = vi.hoisted(() => ({
  read: vi.fn(),
  selects: [] as [string, string][],
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q = {
        select: (columns: string) => {
          selects.push([table, columns]);
          return q;
        },
        eq: () => q,
        maybeSingle: () => read(table),
      };
      return q;
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
const move = (extra = {}) => ({
  type: 'seat_moved',
  table_id: 'source',
  user_id: 'alice',
  to_table_id: 'destination',
  timestamp: 1,
  reason: 'seat_change',
  ...extra,
});
const props = (event: Record<string, unknown> | null = move()) => ({
  tableId: 'source',
  event,
  players: [{ id: 'alice', name: 'VeryPainful' }],
  announce: vi.fn(),
});
beforeEach(() => {
  read.mockReset();
  selects.length = 0;
  // Today's Main 1 (2026-11-19): the bare game name, role 'main'.
  read.mockResolvedValue({ data: { name: 'NLH 0.50/1 Classic', role: 'main' }, error: null });
});
describe('source-table seat move announcements', () => {
  it('tells remaining spectators who moved to the main game', async () => {
    const p = props();
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith(
        'VeryPainful Was Moved To The Main Game',
        expect.any(String)
      )
    );
  });
  it('names another destination for a requested seat change', async () => {
    read.mockResolvedValue({ data: { name: 'PLO Feeder 3', role: 'feeder' }, error: null });
    const p = props();
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith(
        'VeryPainful Was Moved To PLO Feeder 3',
        expect.any(String)
      )
    );
  });
  it('keeps the source roster name after the seat disappears', async () => {
    const p = props(null);
    const h = renderHook(useSeatMoveAnnouncement, { initialProps: p });
    h.rerender({ ...p, event: move(), players: [] });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith(
        'VeryPainful Was Moved To The Main Game',
        expect.any(String)
      )
    );
  });
  it('resolves a swap partner not present in the current roster', async () => {
    read.mockImplementation(async (table) => ({
      data:
        table === 'profiles'
          ? { alias: 'SwapPartner', username: 'swappartner' }
          : { name: 'Feeder', role: 'feeder' },
      error: null,
    }));
    const p = { ...props(), players: [] };
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith('SwapPartner Was Moved To Feeder', expect.any(String))
    );
  });
  for (const extra of [
    { replayed: true },
    { table_id: 'other' },
    { to_table_id: 'source' },
    { type: 'seat_move_pending' },
  ]) {
    it(`ignores historical, foreign or uncommitted moves ${JSON.stringify(extra)}`, async () => {
      const p = props(move(extra));
      renderHook(useSeatMoveAnnouncement, { initialProps: p });
      expect(read).not.toHaveBeenCalled();
      expect(p.announce).not.toHaveBeenCalled();
    });
  }
  it('deduplicates repeated delivery and StrictMode effects', async () => {
    const p = props();
    const h = renderHook(useSeatMoveAnnouncement, { initialProps: p, wrapper: StrictMode });
    await waitFor(() => expect(p.announce).toHaveBeenCalledTimes(1));
    h.rerender({ ...p, event: move() });
    expect(p.announce).toHaveBeenCalledTimes(1);
  });
  it('drops a late read when the viewed table changes', async () => {
    let resolve!: (value: unknown) => void;
    read.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const p = props();
    const h = renderHook(useSeatMoveAnnouncement, { initialProps: p });
    h.rerender({ ...p, tableId: 'new-table' });
    resolve({ data: { name: 'Main', role: 'main' }, error: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(p.announce).not.toHaveBeenCalled();
  });
  it('announces a must-move as the main game when the main table carries no "Main" in its name', async () => {
    read.mockResolvedValue({ data: { name: 'NLH 0.50/1 Classic', role: 'main' }, error: null });
    const p = props(move({ reason: 'must_move' }));
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith(
        'VeryPainful Was Moved To The Main Game',
        expect.any(String)
      )
    );
  });

  it('uses truthful fallback copy when the destination read fails', async () => {
    read.mockRejectedValue(new Error('offline'));
    const p = props(move({ reason: 'must_move' }));
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith(
        'VeryPainful Was Moved To The Main Game',
        expect.any(String)
      )
    );
  });

  it('reads the destination role with its name', async () => {
    const p = props();
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() => expect(p.announce).toHaveBeenCalled());
    expect(selects).toContainEqual(['tables', 'name,role']);
  });

  for (const reason of ['break', 'balance', 'seat_change'])
    it(`announces a renamed main as the main game on a ${reason} move`, async () => {
      read.mockResolvedValue({ data: { name: 'NLH 0.50/1 Classic', role: 'main' }, error: null });
      const p = props(move({ reason }));
      renderHook(useSeatMoveAnnouncement, { initialProps: p });
      await waitFor(() =>
        expect(p.announce).toHaveBeenCalledWith(
          'VeryPainful Was Moved To The Main Game',
          expect.any(String)
        )
      );
    });

  it('names a feeder whose name says Main, because its role says feeder', async () => {
    read.mockResolvedValue({ data: { name: 'Main Street Feeder', role: 'feeder' }, error: null });
    const p = props(move({ reason: 'seat_change' }));
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith(
        'VeryPainful Was Moved To Main Street Feeder',
        expect.any(String)
      )
    );
  });

  it('names a non-cluster table that happens to be called Main', async () => {
    read.mockResolvedValue({ data: { name: 'Main 2', role: null }, error: null });
    const p = props(move({ reason: 'balance' }));
    renderHook(useSeatMoveAnnouncement, { initialProps: p });
    await waitFor(() =>
      expect(p.announce).toHaveBeenCalledWith('VeryPainful Was Moved To Main 2', expect.any(String))
    );
  });
});
