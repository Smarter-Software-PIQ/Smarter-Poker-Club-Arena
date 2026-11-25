import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClubDataFilters } from '../../src/hooks/useClubDataFilters';
import ClubDataReportGuide from '../../src/components/club/ClubDataReportGuide';
import ClubDataReturnLink from '../../src/components/club/ClubDataReturnLink';
import { clubDataWindow } from '../../src/lib/clubDataDay';

vi.mock('../../src/hooks/usePlayerPreference', async () => {
  const { useState } = await import('react');
  return { usePlayerPreference: (_key: string, value: unknown) => useState(value) };
});
afterEach(cleanup);
function Question() {
  const f = useClubDataFilters('test');
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output>
        {f.game}:{f.stakes}:{f.searchInput}
      </output>
      <p>{location.search}</p>
      <button onClick={() => f.setGame('MTT')}>MTT</button>
      <button onClick={f.clearFilters}>Clear</button>
      <button onClick={() => navigate('?dataGame=OMAHA&dataStakes=HIGH&dataSearch=Other')}>
        Other Question
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
describe('the report question survives navigation', () => {
  it('honors explicit filters, changes them atomically and restores Back', () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/?dataStart=2026-11-09&dataEnd=2026-11-15&dataGame=HOLDEM&dataStakes=SMALL&dataSearch=River',
        ]}
      >
        <Question />
      </MemoryRouter>
    );
    expect(screen.getByRole('status')).toHaveTextContent('HOLDEM:SMALL:River');
    fireEvent.click(screen.getByText('MTT', { selector: 'button' }));
    expect(screen.getByRole('status')).toHaveTextContent('MTT:SMALL:River');
    expect(screen.getByText(/dataStart=/)).toHaveTextContent('dataEnd=2026-11-15');
    fireEvent.click(screen.getByText('Other Question'));
    expect(screen.getByRole('status')).toHaveTextContent('OMAHA:HIGH:Other');
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByRole('status')).toHaveTextContent('MTT:SMALL:River');
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByRole('status')).toHaveTextContent('ALL:ALL:');
    expect(screen.getByText(/dataStart=/)).toHaveTextContent(
      'dataGame=ALL&dataStakes=ALL&dataSearch='
    );
  });
  it('returns from member details to the originating union report with its filters', () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/?dataClub=midway-union&dataStart=2026-11-09&dataEnd=2026-11-15&dataGame=OMAHA&dataStakes=HIGH&dataSearch=River&view=advanced',
        ]}
      >
        <ClubDataReturnLink />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Return To Club Data' })).toHaveAttribute(
      'href',
      '/clubs/midway-union/data?dataStart=2026-11-09&dataEnd=2026-11-15&dataGame=OMAHA&dataStakes=HIGH&dataSearch=River&report=open'
    );
    expect(
      screen.getByText(/Member Ledger Figures Retain Their Stated Chicago Basis/)
    ).toBeInTheDocument();
  });
  it('prints inclusive Pacific dates and explains exclusive clock boundaries', () => {
    render(<ClubDataReportGuide start="2026-11-09" end="2026-11-15" basis="accounting" union />);
    expect(
      screen.getByText(/Nov 9, 2026 Through Nov 15, 2026 Pacific Calendar Dates/)
    ).toBeInTheDocument();
    expect(screen.getByText(/The End Date Is Included/)).toBeInTheDocument();
    expect(screen.getByText(/Player Losses Minus Rake Are Not A Substitute/)).toBeInTheDocument();
  });
  it.each([
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ])('retains the real length of Pacific DST day %s', (day, hours) => {
    const window = clubDataWindow(day as string, day as string, 'pacific')!;
    expect(window.end.getTime() - window.start.getTime()).toBe(Number(hours) * 3600000);
    const next = clubDataWindow(
      new Date(window.end).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
      new Date(window.end).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
      'pacific'
    )!;
    expect(next.start.getTime()).toBe(window.end.getTime());
  });
});
