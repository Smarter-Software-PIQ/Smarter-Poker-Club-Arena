import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({
  stats: null as null | {
    handsPlayed: number;
    handsWon: number | null;
    vpipPercent: number | null;
    pfrPercent: number | null;
    startedAt: string;
    throughAt?: string;
  },
  refresh: vi.fn(),
}));
vi.mock('../../src/hooks/useSessionHandStats', () => ({
  useSessionHandStats: () => ({ stats: mocked.stats, refresh: mocked.refresh }),
}));
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (selector: any) => selector({ user: { id: 'owner' }, currentClubId: null }),
}));
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => ({ userId: 'owner' }) }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../../src/components/ads/HouseAdRotator', () => ({ default: () => null }));
vi.mock('../../src/services/TableService', () => ({ tableService: {} }));
vi.mock('../../src/components/tournament/TournamentRankingCard', () => ({
  default: (props: any) => (
    <div data-testid="ranking-hands">
      {props.handsPlayed === null ? '-' : String(props.handsPlayed)}
    </div>
  ),
}));
import { SessionSummaryHost } from '../../src/components/session/SessionSummaryHost';
import { TournamentRankingHost } from '../../src/components/tournament/TournamentRankingHost';
import {
  publishSessionSummary,
  clearSessionSummary,
  peekSessionSummary,
  settlePendingSummary,
  type SessionSummaryPayload,
} from '../../src/services/pendingSessionSummary';
const fixture = (over: Partial<SessionSummaryPayload> = {}): SessionSummaryPayload => ({
  duration: 3600,
  handsPlayed: 17,
  handsWon: 2,
  totalRebuys: 0,
  profitLoss: 157,
  biggestPot: 200,
  peakStack: 400,
  vpipPercent: 35,
  totalBuyIn: 1000,
  handStatsTarget: { tableId: 'table', userId: 'owner', asOf: Date.parse('2026-11-01T03:00:00Z') },
  ...over,
});
function tile(label: string) {
  return screen.getByText(label).parentElement!;
}
beforeEach(() => {
  clearSessionSummary();
  mocked.stats = null;
  mocked.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  clearSessionSummary();
});
it('uses recovered full cash hand metrics while preserving the published money', () => {
  mocked.stats = {
    handsPlayed: 56,
    handsWon: 20,
    vpipPercent: 46.4,
    pfrPercent: 33.9,
    startedAt: '2026-11-01T02:00:00Z',
  };
  render(
    <MemoryRouter>
      <SessionSummaryHost />
    </MemoryRouter>
  );
  act(() => publishSessionSummary(fixture()));
  expect(within(tile('Hands Played')).getByText('56')).toBeTruthy();
  expect(within(tile('VPIP')).getByText('46.4%')).toBeTruthy();
  expect(within(tile('Win Rate')).getByText('36%')).toBeTruthy();
  expect(screen.queryByText('17')).toBeNull();
  expect(peekSessionSummary()?.profitLoss).toBe(157);
});
it('keeps new-target hand metrics unknown and re-reads at the existing settlement transition', async () => {
  render(
    <MemoryRouter>
      <SessionSummaryHost />
    </MemoryRouter>
  );
  act(() => publishSessionSummary(fixture({ plPending: true })));
  expect(within(tile('Hands Played')).getByText('-')).toBeTruthy();
  expect(within(tile('VPIP')).getByText('-')).toBeTruthy();
  expect(within(tile('Win Rate')).getByText('-')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Share This Session' }) as HTMLButtonElement).disabled
  ).toBe(true);
  expect(mocked.refresh).not.toHaveBeenCalled();
  act(() => settlePendingSummary(172));
  await waitFor(() => expect(mocked.refresh).toHaveBeenCalledTimes(1));
});
it('recovers a result-only tournament count and keeps a requested unknown count visible', async () => {
  const tournament = {
    userId: 'owner',
    finishPlace: 2,
    entrants: 10,
    prize: 30,
    bountyWinnings: 0,
    knockouts: 0,
    rebuys: 0,
    addOns: 0,
  };
  mocked.stats = {
    handsPlayed: 56,
    handsWon: 20,
    vpipPercent: 46.4,
    pfrPercent: 33.9,
    startedAt: '2026-11-01T02:00:00Z',
  };
  render(
    <MemoryRouter>
      <TournamentRankingHost />
    </MemoryRouter>
  );
  act(() => publishSessionSummary(fixture({ resultOnly: true, tournament })));
  await waitFor(() => expect(screen.getByTestId('ranking-hands').textContent).toBe('56'));
  mocked.stats = null;
  act(() => publishSessionSummary(fixture({ resultOnly: true, tournament })));
  await waitFor(() => expect(screen.getByTestId('ranking-hands').textContent).toBe('-'));
});

it('preserves the full-hand target across same-report legacy republishes without leaking it to a new finish', () => {
  const tournament = {
    userId: 'owner',
    tournamentId: 'same-hand-report',
    finishSequence: '1',
    finishPlace: 2,
    entrants: 10,
    prize: 30,
    bountyWinnings: 0,
    knockouts: 0,
    rebuys: 0,
    addOns: 0,
  };
  const report = fixture({ resultOnly: true, tournament });
  publishSessionSummary(report);
  publishSessionSummary({ ...report, handStatsTarget: undefined });
  expect(peekSessionSummary()?.handStatsTarget).toEqual(report.handStatsTarget);
  publishSessionSummary({
    ...report,
    handStatsTarget: undefined,
    tournament: { ...tournament, finishSequence: '2' },
  });
  clearSessionSummary();
  expect(peekSessionSummary()?.tournament?.finishSequence).toBe('2');
  expect(peekSessionSummary()?.handStatsTarget).toBeUndefined();
});
