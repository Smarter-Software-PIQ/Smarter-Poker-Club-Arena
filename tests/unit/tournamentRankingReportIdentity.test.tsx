import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => ({ userId: 'hero' }) }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const b: any = { select: () => b, eq: () => b, maybeSingle: io.read };
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
});
afterEach(() => {
  cleanup();
  clearSessionSummary();
});
it('enriches a second finish sequence in the same event', async () => {
  io.read
    .mockResolvedValueOnce({ data: { position: 7, prize: 0 }, error: null })
    .mockResolvedValueOnce({ data: { position: 3, prize: 20 }, error: null });
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
  await act(async () => resolve({ data: { position: 4, prize: 0 }, error: null }));
  await flush();
  expect(await screen.findByTestId('rank')).toHaveTextContent('first:4');
  expect(io.read).toHaveBeenCalledTimes(1);
});

it('queues another finish sequence without inheriting the first report rank', async () => {
  io.read
    .mockResolvedValueOnce({ data: { position: 7, prize: 0 }, error: null })
    .mockResolvedValueOnce({ data: { position: 3, prize: 20 }, error: null });
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
