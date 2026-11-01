import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ read: vi.fn(), report: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: io.report }));
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => ({ userId: 'hero' }) }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const b: any = {
        select: () => b,
        eq: () => b,
        abortSignal: (signal: AbortSignal) => {
          io.signals.push(signal);
          return b;
        },
        maybeSingle: io.read,
      };
      return b;
    },
  },
}));
vi.mock('../../src/components/tournament/TournamentRankingCard', () => ({
  default: ({ result }: any) => (
    <output data-testid="rank">
      {result.finishSequence}:{result.finishPlace ?? 'unknown'}
    </output>
  ),
}));
import TournamentRankingHost from '../../src/components/tournament/TournamentRankingHost';
import {
  clearSessionSummary,
  dismissSessionSummary,
  publishSessionSummary,
} from '../../src/services/pendingSessionSummary';
const publish = (id: string, sequence: string) =>
  publishSessionSummary({
    duration: 0,
    handsPlayed: 0,
    handsWon: 0,
    totalRebuys: 0,
    profitLoss: 0,
    biggestPot: 0,
    peakStack: 0,
    tournament: {
      tournamentId: id,
      userId: 'hero',
      finishSequence: sequence,
      name: 'Event',
      finishPlace: null,
      entrants: 9,
      prize: 0,
      bountyWinnings: 0,
      knockouts: 0,
      rebuys: 0,
      addOns: 0,
    },
  });
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 25; i++) await Promise.resolve();
  });
};
beforeEach(() => {
  clearSessionSummary();
  io.read.mockReset();
  io.report.mockReset();
  io.signals = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearSessionSummary();
});
it('enriches a second finish sequence in the same event', async () => {
  io.read
    .mockResolvedValueOnce({
      data: { position: 7, prize: 0, elimination_sequence: 'first' },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { position: 3, prize: 20, elimination_sequence: 'second' },
      error: null,
    });
  render(
    <MemoryRouter>
      <TournamentRankingHost />
    </MemoryRouter>
  );
  await act(async () => publish('reentry-event', 'first'));
  await flush();
  expect(await screen.findByTestId('rank')).toHaveTextContent('first:7');
  await act(async () => dismissSessionSummary());
  await act(async () => publish('reentry-event', 'second'));
  await flush();
  expect(screen.getByTestId('rank')).toHaveTextContent('second:3');
  expect(io.read).toHaveBeenCalledTimes(2);
});
it('keeps the in-flight fill when the same report is republished', async () => {
  let resolve!: (value: unknown) => void;
  io.read.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render(
    <MemoryRouter>
      <TournamentRankingHost />
    </MemoryRouter>
  );
  await act(async () => publish('republish-event', 'first'));
  await act(async () => publish('republish-event', 'first'));
  await act(async () =>
    resolve({ data: { position: 4, prize: 0, elimination_sequence: 'first' }, error: null })
  );
  await flush();
  expect(await screen.findByTestId('rank')).toHaveTextContent('first:4');
  expect(io.read).toHaveBeenCalledTimes(1);
});

it('queues another finish sequence without inheriting the first report rank', async () => {
  io.read
    .mockResolvedValueOnce({
      data: { position: 7, prize: 0, elimination_sequence: 'first' },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { position: 3, prize: 20, elimination_sequence: 'second' },
      error: null,
    });
  render(
    <MemoryRouter>
      <TournamentRankingHost />
    </MemoryRouter>
  );
  await act(async () => publish('queued-reentry-event', 'first'));
  await flush();
  expect(await screen.findByTestId('rank')).toHaveTextContent('first:7');
  await act(async () => publish('queued-reentry-event', 'second'));
  expect(screen.getByTestId('rank')).toHaveTextContent('first:7');
  await act(async () => dismissSessionSummary());
  await flush();
  expect(screen.getByTestId('rank')).toHaveTextContent('second:3');
});

it('never enriches an older report with a later elimination result', async () => {
  io.read.mockResolvedValue({
    data: { position: 2, prize: 500, elimination_sequence: 8 },
    error: null,
  });
  render(
    <MemoryRouter>
      <TournamentRankingHost />
    </MemoryRouter>
  );
  await act(async () => publish('same-event', '7'));
  await flush();
  expect(await screen.findByTestId('rank')).toHaveTextContent('7:unknown');
});
it('finishes an unanswered enrichment read without retry and ignores its late result', async () => {
  vi.useFakeTimers();
  let resolve!: (x: unknown) => void;
  io.read.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  render(
    <MemoryRouter>
      <TournamentRankingHost />
    </MemoryRouter>
  );
  await act(async () => publish('hung-event', '7'));
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(io.report).toHaveBeenCalled();
  expect(io.signals[0].aborted).toBe(true);
  await act(async () =>
    resolve({ data: { position: 2, prize: 500, elimination_sequence: 7 }, error: null })
  );
  expect(screen.getByTestId('rank')).toHaveTextContent('7:unknown');
  expect(io.read).toHaveBeenCalledTimes(1);
});
