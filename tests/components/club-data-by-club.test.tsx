import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import ClubDataByClub, {
  clubDataWindowLink,
  isClubRows,
} from '../../src/pages/club/ClubDataByClub';
import { isSnapshot } from '../../src/pages/club/ClubDataSimplePage';

// Midway Union, week 2026-11-02..2026-11-08, as production's reader groups it
// (the four weekly statements and the union's own account).
const clubs = [
  {
    club_id: '946747c6-b991-4220-b0cb-effbea46ecd2',
    name: 'Club Savage',
    slug: 'club-savage-84109',
    union_account: false,
    fee: 0,
    total_winnings: 0,
  },
  {
    club_id: '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3',
    name: 'Deep Stack Society',
    slug: 'deep-stack-society-11192',
    union_account: false,
    fee: 452206.43,
    total_winnings: -562209.57,
  },
  {
    club_id: 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
    name: 'KINGS CLUB',
    slug: 'kings-club',
    union_account: false,
    fee: 25854.24,
    total_winnings: -37160.83,
  },
  {
    club_id: 'a0000000-0000-0000-0000-000000000001',
    name: 'The Felt Society',
    slug: 'the-felt-society',
    union_account: false,
    fee: 455510.12,
    total_winnings: -473091.31,
  },
  {
    club_id: 'fade0000-0000-0000-0000-000000000001',
    name: 'Midway Union',
    slug: 'midway-union',
    union_account: true,
    fee: 0,
    total_winnings: 212.51,
  },
];

afterEach(cleanup);

describe('By Club on the union Club Data page', () => {
  it('lists every member club and the union account with exact figures', () => {
    render(
      <MemoryRouter>
        <ClubDataByClub clubs={clubs} end="2026-11-08" start="2026-11-02" />
      </MemoryRouter>
    );
    const card = screen.getByRole('region', { name: 'By Club' });
    expect(within(card).getByRole('heading', { name: 'By Club' })).toBeInTheDocument();
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[4]).toHaveTextContent('Union Account');
    expect(items[4]).toHaveTextContent('212.51');
    expect(within(items[4]).queryByRole('link')).toBeNull();
    expect(within(card).getByText('-562,209.57')).toBeInTheDocument();
    expect(within(card).getByText('452,206.43')).toBeInTheDocument();
    expect(within(card).getByText('455,510.12')).toBeInTheDocument();
    expect(within(card).getByText('-37,160.83')).toBeInTheDocument();
  });

  it('opens each member club on the same window', () => {
    render(
      <MemoryRouter>
        <ClubDataByClub clubs={clubs} end="2026-11-08" start="2026-11-02" />
      </MemoryRouter>
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(links[2].getAttribute('href')).toBe(
      '/clubs/kings-club/data?dataStart=2026-11-02&dataUntil=2026-11-09'
    );
    expect(clubDataWindowLink({ club_id: 'x', slug: null }, '2026-11-15', null)).toEqual({
      pathname: '/clubs/x/data',
      search: '?dataUntil=2026-11-16',
    });
  });

  it('the rows add up to the page totals', () => {
    const cents = (k: 'fee' | 'total_winnings') =>
      clubs.reduce((a, c) => a + Math.round(Number(c[k]) * 100), 0);
    expect(cents('fee')).toBe(93357079);
    expect(cents('total_winnings')).toBe(-107224920);
  });

  it('the payload check accepts the clubs key and refuses a broken one', () => {
    const base = {
      scope: 'club',
      range: { start: '2026-11-02', end: '2026-11-08', days: 7 },
      summary: { games: 1, total_winnings: -1072249.2, mtt_winnings: 0, fee: 933570.79 },
      rows: [],
      reporting_scope: 'union',
    };
    expect(isClubRows(clubs)).toBe(true);
    expect(isSnapshot(base)).toBe(true);
    expect(isSnapshot({ ...base, clubs })).toBe(true);
    expect(isSnapshot({ ...base, clubs: 'x' })).toBe(false);
    expect(isSnapshot({ ...base, clubs: [{ ...clubs[0], fee: null }] })).toBe(false);
    expect(isSnapshot({ ...base, clubs: [clubs[0], clubs[0]] })).toBe(false);
    expect(isSnapshot({ ...base, clubs: [clubs[4], { ...clubs[4], club_id: 'y' }] })).toBe(false);
  });
});
