/**
 * AGENTS SEE THEIR PLAYERS ON EVERY LOBBY TAB, AND THE HERO LEADS REWARDS
 * (Dan 2026-11-08).
 *
 *   "IF THEY DON'T HAVE ANY PLAYERS LEFT OR REGISTERED. IT SHOULDN'T NOT SHOW.
 *    IT SHOULD ALWAYS SHOW SOMETHING EITHER 'NONE OF YOUR PLAYERS REGISTERED FOR
 *    THIS EVENT' OR NO PLAYERS ARE REMAINING AND SHOW WHICH PLAYERS ENTERED AND
 *    WHAT POSITION THE FINISHED ... AND IF YOU CLICK ON THE 'TABLES' PAGE, IT
 *    SHOULD TELL YOU IF YOU HAVE A PLAYER ON THE TABLE AND WHO."
 *
 *   "WHEN A PLAYER CHECKS 'REWARDS' IT SHOULD DEFAULT THE HERO TO THE TOP, LIKE
 *    IT DOES WHEN YOU CLICK 'RANKING'."
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mine = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock('../../src/components/tournament/details/useDownlineIds', () => ({
  useDownlineIds: () => ({
    downlineIds: mine.ids,
    carriesDownline: mine.ids.size > 0,
    loading: false,
  }),
}));
vi.mock('../../src/services/tableWarmup', () => ({
  warmTable: () => {},
  observeLobbyTableWarmups: () => () => {},
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => ({ warning: () => {} }) }));
import TablesTab from '../../src/components/tournament/details/TablesTab';
import {
  deriveMyPlayers,
  heroFirst,
  myPlayerStatusText,
} from '../../src/components/tournament/details/myPlayersSummary';
import MyPlayersCard from '../../src/components/tournament/details/MyPlayersCard';
import {
  chipsCompact,
  ordinal,
  type TournamentEntry,
  type TournamentTabProps,
} from '../../src/components/tournament/details/types';

afterEach(cleanup);

const T = { id: 'event', name: 'Midday Free Buy', status: 'RUNNING' };
const TABLES = [
  { id: 't1', name: 'Midday Free Buy - Table 1' },
  { id: 't2', name: 'Midday Free Buy - Table 2' },
];

function e(
  user: string,
  chips: number,
  status: TournamentEntry['status'],
  extra: Partial<TournamentEntry> = {}
): TournamentEntry {
  return {
    id: `id-${user}`,
    user_id: user,
    username: user,
    avatar_url: null,
    chips,
    status,
    ...extra,
  };
}

const FIELD: TournamentEntry[] = [
  e('leader', 9000, 'playing', { table_id: 't1' }),
  e('danimal', 5000, 'playing', { table_id: 't1' }),
  e('kingfish', 5000, 'playing', { table_id: 't2' }),
  e('stranger', 3000, 'playing', { table_id: 't2' }),
  e('zoe', 0, 'eliminated', { position: 6 }),
  e('bust', 0, 'eliminated', { position: 5 }),
];

describe('deriveMyPlayers', () => {
  it('nobody of mine entered is its own state, never silence', () => {
    const s = deriveMyPlayers(T, FIELD, TABLES, new Set(['absent']));
    expect(s.mode).toBe('none');
    expect(s.entered).toBe(0);
    expect(s.players).toEqual([]);
  });

  it('before the start it counts who registered', () => {
    const s = deriveMyPlayers(
      { ...T, status: 'REGISTERING' },
      [e('danimal', 5000, 'registered'), e('kingfish', 5000, 'registered')],
      [],
      new Set(['danimal', 'kingfish'])
    );
    expect(s.mode).toBe('registered');
    expect(s.entered).toBe(2);
    expect(s.players.map((p) => p.state)).toEqual(['registered', 'registered']);
  });

  it('while running it ranks mine over the whole field with competition ranks, as Ranking does', () => {
    const s = deriveMyPlayers(T, FIELD, TABLES, new Set(['danimal', 'kingfish', 'zoe']));
    expect(s.mode).toBe('live');
    expect(s.entered).toBe(3);
    expect(s.alive).toBe(2);
    // 9000 is 1st; the two 5000 stacks share 2nd.
    expect(s.bestRank).toBe(2);
    expect(s.totalChips).toBe(10000);
    expect(s.players.map((p) => [p.username, p.state, p.rank, p.tableName])).toEqual([
      ['danimal', 'live', 2, 'Table 1'],
      ['kingfish', 'live', 2, 'Table 2'],
      ['zoe', 'out', null, null],
    ]);
    expect(s.byTable.get('t1')).toEqual(['danimal']);
    expect(s.byTable.get('t2')).toEqual(['kingfish']);
  });

  it('when all of mine are out it lists every entrant, best finish first', () => {
    const s = deriveMyPlayers(T, FIELD, TABLES, new Set(['zoe', 'bust']));
    expect(s.mode).toBe('finished');
    expect(s.alive).toBe(0);
    expect(s.players.map((p) => [p.username, p.position])).toEqual([
      ['bust', 5],
      ['zoe', 6],
    ]);
    expect(s.byTable.size).toBe(0);
  });

  it('a completed event is finished even for the winner, and the seat-out-of-play is not "remaining"', () => {
    const done = { ...T, status: 'COMPLETED' };
    const s = deriveMyPlayers(
      done,
      [
        e('champ', 50000, 'winner', { position: 1, table_id: 't1' }),
        e('zoe', 0, 'eliminated', { position: 4 }),
      ],
      TABLES,
      new Set(['champ', 'zoe'])
    );
    expect(s.mode).toBe('finished');
    expect(s.players.map((p) => [p.username, p.state])).toEqual([
      ['champ', 'winner'],
      ['zoe', 'out'],
    ]);
    expect(myPlayerStatusText(s.players[0], ordinal, chipsCompact)).toBe('Winner - 1st');
    expect(myPlayerStatusText(s.players[1], ordinal, chipsCompact)).toBe('Finished 4th');
  });

  it('a recorded satellite seat reads Qualified', () => {
    const sat = {
      id: 'sat',
      name: 'Sat',
      status: 'COMPLETED',
      format_contract: 'mtt-v2',
      satellite_target_id: '11111111-2222-3333-4444-555555555555',
    };
    const s = deriveMyPlayers(
      sat,
      [e('seat', 4000, 'winner'), e('zoe', 0, 'eliminated', { position: 9 })],
      [],
      new Set(['seat', 'zoe'])
    );
    expect(s.mode).toBe('finished');
    expect(s.players[0].state).toBe('qualified');
    expect(myPlayerStatusText(s.players[0], ordinal, chipsCompact)).toBe('Qualified');
  });

  it('never includes a player outside the downline, horse or human alike', () => {
    const s = deriveMyPlayers(T, FIELD, TABLES, new Set(['danimal']));
    expect(s.players.map((p) => p.username)).toEqual(['danimal']);
  });
});

describe('MyPlayersCard', () => {
  it('says so when none of mine registered', () => {
    render(<MyPlayersCard summary={deriveMyPlayers(T, FIELD, TABLES, new Set(['absent']))} />);
    expect(screen.getByText('None Of Your Players Registered For This Event')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the two running lines exactly, with the list collapsed behind Show Players', () => {
    render(<MyPlayersCard summary={deriveMyPlayers(T, FIELD, TABLES, new Set(['danimal']))} />);
    expect(screen.getByText('1 Of 1 Of Your Players Is Still In')).toBeTruthy();
    expect(screen.getByText('Best 2nd - 5,000 Chips Between Them')).toBeTruthy();
    expect(screen.queryByText('danimal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Players' }));
    expect(screen.getByText('danimal')).toBeTruthy();
    expect(screen.getByText('2nd - 5,000 Chips - Table 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide Players' })).toBeTruthy();
  });

  it('opens the finishing list by itself once nobody is remaining', () => {
    render(<MyPlayersCard summary={deriveMyPlayers(T, FIELD, TABLES, new Set(['zoe', 'bust']))} />);
    expect(screen.getByText('None Of Your Players Are Remaining')).toBeTruthy();
    expect(screen.getByText('Finished 5th')).toBeTruthy();
    expect(screen.getByText('Finished 6th')).toBeTruthy();
  });

  it('counts registrations with the right number', () => {
    const one = deriveMyPlayers(
      { ...T, status: 'REGISTERING' },
      [e('a', 1, 'registered')],
      [],
      new Set(['a'])
    );
    render(<MyPlayersCard summary={one} />);
    expect(screen.getByText('1 Of Your Players Is Registered')).toBeTruthy();
  });

  it('carries no em dash in anything it prints', () => {
    const { container } = render(
      <MyPlayersCard
        summary={deriveMyPlayers(T, FIELD, TABLES, new Set(['zoe', 'bust', 'danimal']))}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show Players' }));
    expect(container.textContent).not.toContain('—');
  });
});

describe('heroFirst', () => {
  const rows = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'hero' }, { user_id: 'c' }];
  it('moves only the hero, and keeps everyone else in order', () => {
    expect(heroFirst(rows, 'hero').map((r) => r.user_id)).toEqual(['hero', 'a', 'b', 'c']);
  });
  it('leaves a list without the hero alone', () => {
    expect(heroFirst(rows, 'nobody').map((r) => r.user_id)).toEqual(['a', 'b', 'hero', 'c']);
    expect(heroFirst(rows, undefined).map((r) => r.user_id)).toEqual(['a', 'b', 'hero', 'c']);
  });
});

describe('the Tables tab tells an agent who of theirs sits where', () => {
  const tables = [
    {
      id: 't1',
      name: 'Midday Free Buy - Table 1',
      status: 'running',
      max_players: 9,
      current_players: 4,
      small_blind: 50,
      big_blind: 100,
    },
    {
      id: 't2',
      name: 'Midday Free Buy - Table 2',
      status: 'running',
      max_players: 9,
      current_players: 2,
      small_blind: 50,
      big_blind: 100,
    },
  ];
  const field = [
    e('anna', 5000, 'playing', { table_id: 't1' }),
    e('bob', 5000, 'playing', { table_id: 't1' }),
    e('cara', 5000, 'playing', { table_id: 't1' }),
    e('dave', 5000, 'playing', { table_id: 't1' }),
    e('stranger', 5000, 'playing', { table_id: 't2' }),
    e('gone', 0, 'eliminated', { position: 7, table_id: 't2' }),
  ];
  const props = (): TournamentTabProps =>
    ({
      tournament: { id: 'event', name: 'Midday Free Buy', status: 'RUNNING' },
      entries: field,
      tables,
      blindLevels: [],
      currentUserId: 'agent',
      isRegistered: false,
    }) as unknown as TournamentTabProps;

  it('names my seated players on their table, folds the rest, and badges the row Yours', () => {
    mine.ids = new Set(['anna', 'bob', 'cara', 'dave', 'gone']);
    const { container } = render(<TablesTab {...props()} />);
    const rows = [...container.querySelectorAll('.tt-row')];
    expect(rows[0].querySelector('.tt-mine')?.textContent).toBe('Your Players: anna, bob +2 More');
    expect(rows[0].querySelector('.tt-mine')?.getAttribute('title')).toBe('anna, bob, cara, dave');
    expect([...rows[0].querySelectorAll('.tl-badge')].map((b) => b.textContent)).toContain('Yours');
    // A busted player keeps a stale table_id; it never counts as seated.
    expect(rows[1].querySelector('.tt-mine')).toBeNull();
    expect(container.querySelector('.mp-card')?.textContent).toContain(
      '4 Of 5 Of Your Players Are Still In'
    );
  });

  it('a plain player sees neither the card nor any row line', () => {
    mine.ids = new Set();
    const { container } = render(<TablesTab {...props()} />);
    expect(container.querySelector('.mp-card')).toBeNull();
    expect(container.querySelector('.tt-mine')).toBeNull();
  });
});
