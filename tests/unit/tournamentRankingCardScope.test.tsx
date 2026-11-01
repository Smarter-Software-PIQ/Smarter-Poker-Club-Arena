import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ paint: vi.fn(), share: vi.fn() }));
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => ({ userId: 'hero' }) }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  },
}));
vi.mock('../../src/components/tournament/rankingShareImage', () => ({
  paintRankingShareImage: io.paint,
}));
import TournamentRankingHost from '../../src/components/tournament/TournamentRankingHost';
import {
  clearSessionSummary,
  dismissSessionSummary,
  publishSessionSummary,
} from '../../src/services/pendingSessionSummary';
beforeAll(async () => {
  await import('../../src/components/tournament/TournamentRankingCard');
});
afterEach(() => {
  cleanup();
  clearSessionSummary();
  vi.unstubAllGlobals();
});
const publish = (id: string) =>
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
      finishSequence: 'finish',
      name: id,
      finishPlace: 3,
      entrants: 9,
      prize: 0,
      bountyWinnings: 0,
      knockouts: 0,
      rebuys: 0,
      addOns: 0,
    },
  });
it('never shares the previous report image while the next report is painting', async () => {
  clearSessionSummary();
  io.paint
    .mockResolvedValueOnce(new Blob(['old-result'], { type: 'image/png' }))
    .mockReturnValue(new Promise(() => {}));
  io.share.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share: io.share, canShare: () => true });
  render(
    <MemoryRouter>
      <TournamentRankingHost />
    </MemoryRouter>
  );
  await act(async () => {
    publish('First Event');
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
  expect(await screen.findByRole('dialog', { name: /tournament ranking/i })).toBeInTheDocument();
  await act(async () => {
    publish('Second Event');
    dismissSessionSummary();
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share' })));
  expect(io.share).toHaveBeenCalledOnce();
  expect(io.share.mock.calls[0][0].text).toContain('Second Event');
  expect(io.share.mock.calls[0][0].files).toBeUndefined();
});
