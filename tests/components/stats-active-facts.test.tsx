import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { StatsPersonalRevision } from '../../src/hooks/useStatsFactRead';
import HoleCardHeatmap from '../../src/components/stats/HoleCardHeatmap';
import EVLuckChart from '../../src/components/stats/EVLuckChart';
import NemesisPanel from '../../src/components/stats/NemesisPanel';

const reads = vi.hoisted(() => ({
  getHandGrid: vi.fn(),
  getClassHands: vi.fn(),
  getEVCurve: vi.fn(),
  getNemesis: vi.fn(),
}));
vi.mock('../../src/services/StatsFactsService', () => ({ default: reads }));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: (_name: string, initial: unknown) => useState(initial),
}));

const grid = (hands: number) => ({
  cells: hands
    ? [
        {
          hand_class: 'AA',
          hands,
          hands_vpip: hands,
          hands_won: 1,
          vpip_pct: 1,
          net_bb: 2,
          ev_net_bb: 1,
          bb100: 10,
        },
      ]
    : [],
});
const view = (revision: number) => (
  <MemoryRouter>
    <StatsPersonalRevision.Provider value={revision}>
      <HoleCardHeatmap userId="u1" clubId="club1" />
      <EVLuckChart userId="u1" clubId="club1" />
      <NemesisPanel userId="u1" clubId="club1" />
    </StatsPersonalRevision.Provider>
  </MemoryRouter>
);
beforeEach(() => {
  vi.resetAllMocks();
  reads.getHandGrid.mockResolvedValue(grid(31));
  reads.getClassHands.mockResolvedValue({ hands: [] });
  reads.getEVCurve.mockResolvedValue({ points: [], summary: { hands: 0 } });
  reads.getNemesis.mockResolvedValue({ min_hands: 25 });
});

it('refreshes active cash reports and an open hand drill once per personal revision', async () => {
  const page = render(view(0));
  fireEvent.click(await screen.findByRole('gridcell', { name: /AA, 31 Hands/i }));
  await waitFor(() => expect(reads.getClassHands).toHaveBeenCalledTimes(1));
  page.rerender(view(0));
  for (const read of Object.values(reads)) expect(read).toHaveBeenCalledTimes(1);
  reads.getHandGrid.mockResolvedValue(grid(32));
  reads.getNemesis.mockResolvedValue({ min_hands: 29 });
  page.rerender(view(1));
  await screen.findByRole('gridcell', { name: /AA, 32 Hands/i });
  expect(await screen.findByText(/Played At Least 29 Hands/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  for (const read of Object.values(reads)) expect(read).toHaveBeenCalledTimes(2);
});

it('keeps filters usable when a selection has no hands and restores the grid after clearing it', async () => {
  reads.getHandGrid.mockImplementation(async (_user, _scope, filters) =>
    grid(filters.position ? 0 : 31)
  );
  render(view(0));
  await screen.findByRole('gridcell', { name: /AA, 31 Hands/i });
  fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'BTN' } });
  await screen.findByText(/No Hold.em Hands Recorded Yet For This Filter/i);
  fireEvent.change(screen.getByLabelText('Position'), { target: { value: '' } });
  expect(await screen.findByRole('gridcell', { name: /AA, 31 Hands/i })).toBeInTheDocument();
});
