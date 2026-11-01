import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ read: vi.fn(), notify: () => {}, signals: [] as AbortSignal[] }));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: (_id: string, notify: () => void) => {
    io.notify = notify;
    return () => {};
  },
}));
vi.mock('../../src/services/readTournamentStandings', () => ({
  readTournamentStandings: async () => ({
    data: [{ user_id: 'hero', username: 'Hero', chips: 1000, status: 'playing' }],
    count: 1,
    error: null,
  }),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        abortSignal: (s: AbortSignal) => {
          io.signals.push(s);
          return q;
        },
        maybeSingle: io.read,
      };
      return q;
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/console/SpadeConsole', () => ({
  SpadeConsole: ({ children }: any) => <div>{children}</div>,
}));
import TournamentInfoPanel from '../../src/components/tournament/TournamentInfoPanel';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  io.read.mockReset();
  io.signals = [];
});
const answer = () =>
  Promise.resolve({
    data: { id: 'mtt', name: 'MTT', status: 'RUNNING', current_level: 0 },
    error: null,
  });
it.each(['initial', 'refresh'])(
  'finishes an unanswered %s tournament read and accepts the next event',
  async (mode) => {
    vi.useFakeTimers();
    let hang = mode === 'initial';
    io.read.mockImplementation(() => (hang ? new Promise(() => {}) : answer()));
    await act(async () => {
      render(<TournamentInfoPanel tournamentId="mtt" heroUserId="hero" onClose={() => {}} />);
    });
    if (mode === 'refresh') {
      expect(screen.getByText('Hero')).toBeInTheDocument();
      hang = true;
      await act(async () => io.notify());
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(screen.queryByText('Loading...')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Could Not Load Tournament Details');
    expect(io.signals.some((s) => s.aborted)).toBe(true);
    if (mode === 'refresh') expect(screen.getByText('Hero')).toBeInTheDocument();
    const before = io.read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24000);
    });
    expect(io.read).toHaveBeenCalledTimes(before);
    hang = false;
    await act(async () => io.notify());
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(io.read).toHaveBeenCalledTimes(before + 1);
  }
);
