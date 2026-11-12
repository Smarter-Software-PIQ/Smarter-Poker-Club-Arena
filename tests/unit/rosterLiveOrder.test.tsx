/**
 * Active Now moves as it happens (Dan, 2026-11-12): the loaded roster is
 * re-ranked from the presence door and the club's live seats, seated first,
 * then online, then last active, without a roster re-read.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seatRows: { stamped: unknown[]; owned: unknown[] } = { stamped: [], owned: [] };
const from = vi.fn();
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a), rpc: vi.fn() } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  readClubLiveSeats,
  resetClubLiveSeatsForTests,
  watchClubLiveSeats,
} from '../../src/lib/clubLiveSeats';
import { liveStateOf, orderByActivity, useLiveStates, type ClubLiveSeats } from '../../src/hooks/useRosterLiveOrder';
import { PRESENCE_RECHECK_MS } from '../../src/lib/profilePresence';
import LiveNowStrip from '../../src/components/club/LiveNowStrip';

function builder(result: { data: unknown[]; error: null }) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order']) b[m] = vi.fn(() => b);
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

const table = (name: string, stakes = '1/2', tournament_id: string | null = null) => ({
  id: name,
  name,
  stakes,
  tournament_id,
  status: 'running',
  is_deleted: false,
  club_id: 'club-a',
});
const profile = (alias: string) => ({
  alias,
  username: alias.toLowerCase(),
  display_name: null,
  arena_avatar_url: null,
  avatar_url: null,
  status: 'active',
});

beforeEach(() => {
  resetClubLiveSeatsForTests();
  from.mockClear();
  seatRows.stamped = [];
  seatRows.owned = [];
  let call = 0;
  from.mockImplementation(() => {
    call += 1;
    return builder({ data: call % 2 === 1 ? seatRows.stamped : seatRows.owned, error: null });
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('readClubLiveSeats', () => {
  it('reads seats stamped with the club and seats on the club tables, once per player and table', async () => {
    seatRows.stamped = [
      { user_id: 'u1', table_id: 't1', club_id: 'club-a', joined_at: '2026-11-12T20:00:00Z', tables: table('Table One'), profiles: profile('Moose') },
      { user_id: 'u1', table_id: 't1', club_id: 'club-a', joined_at: '2026-11-12T20:00:00Z', tables: table('Table One'), profiles: profile('Moose') },
      { user_id: 'gone', table_id: 't9', club_id: 'club-a', joined_at: null, tables: { ...table('Dead'), is_deleted: true }, profiles: profile('X') },
    ];
    seatRows.owned = [
      { user_id: 'u2', table_id: 't2', club_id: null, joined_at: null, tables: table('Table Two', '2/5', 'mtt-1'), profiles: profile('Burls') },
    ];
    const seats = await readClubLiveSeats('club-a');
    expect(seats.map((s) => [s.user_id, s.name, s.is_tournament, s.alias])).toEqual([
      ['u1', 'Table One', false, 'Moose'],
      ['u2', 'Table Two', true, 'Burls'],
    ]);
    expect(from).toHaveBeenCalledTimes(2);
  });
});

describe('watchClubLiveSeats', () => {
  it('asks once per club per minute while visible, shares the answer, and stops when nobody watches', async () => {
    vi.useFakeTimers();
    seatRows.stamped = [
      { user_id: 'u1', table_id: 't1', club_id: 'club-a', joined_at: null, tables: table('Table One'), profiles: profile('Moose') },
    ];
    const a = vi.fn();
    const b = vi.fn();
    const stopA = watchClubLiveSeats('club-a', a);
    const stopB = watchClubLiveSeats('club-a', b);
    await vi.advanceTimersByTimeAsync(0);
    expect(from).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0].get('u1')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MS);
    expect(from).toHaveBeenCalledTimes(4);
    stopA();
    stopB();
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MS * 2);
    expect(from).toHaveBeenCalledTimes(4);
  });
});

describe('orderByActivity', () => {
  /* In the order the server serves Active Now: online, then last active. */
  const rows = [
    { user_id: 'b', is_seated: false, is_online: true, last_login: '2026-11-12T09:00:00Z' },
    { user_id: 'c', is_seated: false, is_online: false, last_login: '2026-11-12T12:00:00Z' },
    { user_id: 'a', is_seated: false, is_online: false, last_login: '2026-11-12T10:00:00Z' },
    { user_id: 'd', is_seated: false, is_online: false, last_login: null },
  ];
  const noSeats: ClubLiveSeats = { byUser: new Map(), seats: [], known: false };

  it('keeps the server order when nothing has changed', () => {
    const presence = new Map<string, boolean>();
    expect(orderByActivity(rows, noSeats, presence)).toBe(rows);
  });

  it('puts a player who just sat down first, then the online, then last active', () => {
    const seat = { user_id: 'c', table_id: 't1', tournament_id: null, name: 'T', stakes: '', is_tournament: false, alias: 'C', username: 'c', avatar_url: null };
    const seats: ClubLiveSeats = { byUser: new Map([['c', [seat]]]), seats: [seat], known: true };
    const presence = new Map<string, boolean>([['a', true], ['b', false]]);
    expect(orderByActivity(rows, seats, presence).map((r) => r.user_id)).toEqual(['c', 'a', 'b', 'd']);
    expect(liveStateOf(rows[1], seats, presence)).toMatchObject({ seated: true, online: true });
    expect(liveStateOf(rows[0], seats, presence)).toMatchObject({ seated: false, online: false });
  });

  it('trusts the loaded row until the seat answer and the door have spoken', () => {
    const seated = [{ ...rows[3], is_seated: true, is_online: true }];
    expect(liveStateOf(seated[0], noSeats, new Map())).toMatchObject({ seated: true, online: true });
    const known: ClubLiveSeats = { byUser: new Map(), seats: [], known: true };
    expect(liveStateOf(seated[0], known, new Map())).toMatchObject({ seated: false, online: true });
  });
});

describe('useLiveStates', () => {
  const rows = [
    { user_id: 'a', is_seated: false, is_online: false, last_login: null },
    { user_id: 'b', is_seated: false, is_online: true, last_login: null },
  ];
  const noSeats: ClubLiveSeats = { byUser: new Map(), seats: [], known: true };

  it('hands back the identical object while a row is unchanged, a new one when it moves', () => {
    const { result, rerender } = renderHook(
      ({ presence }: { presence: Map<string, boolean> }) => useLiveStates(rows, noSeats, presence),
      { initialProps: { presence: new Map<string, boolean>() } }
    );
    const a1 = result.current.get('a');
    const b1 = result.current.get('b');
    expect(b1).toMatchObject({ online: true });
    // A fresh presence answer that says the same thing: both objects survive,
    // so memoized rows skip work.
    rerender({ presence: new Map<string, boolean>([['a', false], ['b', true]]) });
    expect(result.current.get('a')).toBe(a1);
    expect(result.current.get('b')).toBe(b1);
    // b goes dark: only b gets a new object.
    rerender({ presence: new Map<string, boolean>([['a', false], ['b', false]]) });
    expect(result.current.get('a')).toBe(a1);
    expect(result.current.get('b')).not.toBe(b1);
    expect(result.current.get('b')).toMatchObject({ online: false });
  });
});

describe('LiveNowStrip', () => {
  it('prints one chip per seated player, alphabetical, and opens the watch door on tap', () => {
    const onWatch = vi.fn();
    const seat = (user_id: string, alias: string, name: string) => ({
      user_id,
      table_id: `t-${user_id}`,
      tournament_id: null,
      name,
      stakes: '1/2',
      is_tournament: false,
      alias,
      username: alias.toLowerCase(),
      avatar_url: null,
    });
    render(
      <LiveNowStrip
        seats={[seat('u2', 'Zed', 'Table Two'), seat('u1', 'Amy', 'Table One'), seat('u1', 'Amy', 'Table Three')]}
        onWatch={onWatch}
      />
    );
    const chips = screen.getAllByRole('listitem');
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Watch Amy At Table, Table One',
      'Watch Zed At Table, Table Two',
    ]);
    expect(screen.getByText('2')).toBeInTheDocument();
    act(() => {
      fireEvent.click(chips[1]);
    });
    expect(onWatch).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u2' }), { userId: 'u2', name: 'Zed' });
  });

  it('renders nothing with nobody seated', () => {
    const { container } = render(<LiveNowStrip seats={[]} onWatch={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
