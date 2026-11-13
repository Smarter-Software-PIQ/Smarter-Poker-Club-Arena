/**
 * Active Now moves as it happens (Dan, 2026-11-12): the loaded roster is
 * re-ranked from the presence door and the club's live seats, seated first,
 * then online, then last active, without a roster re-read.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seatRows: { rows: unknown[] } = { rows: [] };
const rpc = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  LIVE_SEATS_RPC,
  readClubLiveSeats,
  resetClubLiveSeatsForTests,
  watchClubLiveSeats,
} from '../../src/lib/clubLiveSeats';
import { liveStateOf, orderByActivity, useLiveStates, type ClubLiveSeats } from '../../src/hooks/useRosterLiveOrder';
import { PRESENCE_RECHECK_MS } from '../../src/lib/profilePresence';
import LiveNowStrip from '../../src/components/club/LiveNowStrip';

const seat = (
  user_id: string,
  table_id: string,
  name: string,
  alias: string,
  extra: Partial<Record<string, unknown>> = {}
) => ({
  user_id,
  table_id,
  tournament_id: null,
  name,
  stakes: '1/2',
  is_tournament: false,
  alias,
  username: alias.toLowerCase(),
  avatar_url: null,
  joined_at: '2026-11-12T20:00:00Z',
  ...extra,
});

beforeEach(() => {
  resetClubLiveSeatsForTests();
  rpc.mockClear();
  seatRows.rows = [];
  rpc.mockImplementation(() => Promise.resolve({ data: seatRows.rows, error: null }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('readClubLiveSeats', () => {
  it('reads the club through ca_club_live_seats, once per player and table', async () => {
    seatRows.rows = [
      seat('u1', 't1', 'Table One', 'Moose'),
      seat('u1', 't1', 'Table One', 'Moose'),
      seat('u2', 't2', 'Table Two', 'Burls', { stakes: '2/5', tournament_id: 'mtt-1', is_tournament: true }),
      seat('u3', 't3', '  ', '', { username: 'quiet' }),
    ];
    const seats = await readClubLiveSeats('club-a');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(LIVE_SEATS_RPC, { p_club_id: 'club-a' });
    expect(seats.map((s) => [s.user_id, s.name, s.is_tournament, s.alias])).toEqual([
      ['u1', 'Table One', false, 'Moose'],
      ['u2', 'Table Two', true, 'Burls'],
      ['u3', 'Live Table', false, 'quiet'],
    ]);
  });

  it('surfaces a refused read instead of answering empty', async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'permission denied' } }));
    await expect(readClubLiveSeats('club-a')).rejects.toThrow('permission denied');
  });
});

describe('watchClubLiveSeats', () => {
  it('asks once per club per minute while visible, shares the answer, and stops when nobody watches', async () => {
    vi.useFakeTimers();
    seatRows.rows = [seat('u1', 't1', 'Table One', 'Moose')];
    const a = vi.fn();
    const b = vi.fn();
    const stopA = watchClubLiveSeats('club-a', a);
    const stopB = watchClubLiveSeats('club-a', b);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0].get('u1')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
    stopA();
    stopB();
    await vi.advanceTimersByTimeAsync(PRESENCE_RECHECK_MS * 2);
    expect(rpc).toHaveBeenCalledTimes(2);
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
