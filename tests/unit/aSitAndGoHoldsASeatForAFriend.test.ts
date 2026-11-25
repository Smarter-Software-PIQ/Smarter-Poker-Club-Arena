/**
 * A SIT & GO HOLDS SEATS FOR INVITED FRIENDS (2026-11-23).
 *
 * Dan: "if a human joins any Sit & Go it starts", so a friend sent a plain
 * link to a six or nine seat Sit & Go arrived to a game that had filled and
 * started. Invite To Game on one now holds up to seats - 1 seats in place
 * (migration 20261123071654, native proof scripts/ci/test-private-game-holds-postgres.py;
 * engine law server/src/services/aSeatHeldForAFriendIsNotGivenToAHorse.law.test.ts).
 *
 * This pins the client half: which games offer it, how many friends can be
 * chosen, the link the friends open (the tournament page, a Sit & Go has no
 * table before it starts), the engine gate (/health privateSitAndGoHolds), and
 * that every Sit & Go registration asks the hold before any money moves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sliceBetween, sliceMethod } from '../helpers/sourceWindow';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));

import {
  _resetPrivateGameSupportForTests,
  inviteToPrivateGame,
  isPrivateGameSeatHeldError,
  isPrivateInviteFormat,
  isSitAndGoInviteFormat,
  privateGameHoldsSupported,
  privateGameRefusalText,
  privateInviteTokenFor,
  privateSeatsChoosable,
  privateSeatsHoldable,
  privateSitAndGoHoldsSupported,
  privateSitAndGoInviteUrl,
  rememberPrivateInviteToken,
} from '../../src/lib/privateGameInvite';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('which games hold a seat for a friend', () => {
  it('a Sit & Go of four to nine seats does, beside the Spin and the Heads Up', () => {
    expect(isSitAndGoInviteFormat({ variant: 'sng', max_players: 6 })).toBe(true);
    expect(
      isSitAndGoInviteFormat({ variant: 'SNG', max_players: 9, format_contract: 'sng-v1' })
    ).toBe(true);
    expect(isPrivateInviteFormat({ variant: 'sng', max_players: 9 })).toBe(true);
    expect(isPrivateInviteFormat({ variant: 'spin', max_players: 3 })).toBe(true);
    expect(isPrivateInviteFormat({ variant: 'sng', max_players: 2 })).toBe(true);
  });

  it('a field outside that, an MTT, or a row with another persisted format does not', () => {
    for (const row of [
      { variant: 'sng', max_players: 10 },
      { variant: 'sng', max_players: 3 },
      { variant: 'sng', max_players: 6, format_contract: null },
      { variant: 'sng', max_players: 6, format_contract: 'mtt-v2' },
      { variant: 'freezeout', max_players: 9 },
    ]) {
      expect(isSitAndGoInviteFormat(row)).toBe(false);
    }
    expect(isPrivateInviteFormat({ variant: 'freezeout', max_players: 9 })).toBe(false);
  });

  it('holds at most every seat but the inviter, and no more than the field has room for', () => {
    expect(privateSeatsHoldable(2)).toBe(1);
    expect(privateSeatsHoldable(3)).toBe(2);
    expect(privateSeatsHoldable(6)).toBe(5);
    expect(privateSeatsHoldable(9)).toBe(8);
    expect(privateSeatsHoldable(10)).toBe(0);
    // Six seats, nobody in: the inviter takes one, five can be held.
    expect(privateSeatsChoosable(6, 0, false)).toBe(5);
    // Six seats, three in, the inviter outside: two after the inviter.
    expect(privateSeatsChoosable(6, 3, false)).toBe(2);
    // Nine seats, the inviter already in alone: eight.
    expect(privateSeatsChoosable(9, 1, true)).toBe(8);
    // Unknown field: the most, and the database bounds it under its lock.
    expect(privateSeatsChoosable(9, null, false)).toBe(8);
    // No room left: still one, so the database's own answer is what is read.
    expect(privateSeatsChoosable(6, 6, false)).toBe(1);
  });
});

describe('the link the friends open', () => {
  it('is the tournament itself with the hold token and the club code', () => {
    const url = privateSitAndGoInviteUrl({
      tournamentId: 'abc-123',
      inviteToken: 'a1b2c3d4e5f6a7b8c9d0',
      inviteCode: 'abc2345',
    });
    expect(url).toMatch(/\/t\/abc-123\?i=ABC2345&invite=a1b2c3d4e5f6a7b8c9d0$/);
  });

  it('the token a friend arrived with is remembered for the registration, never a bad one', () => {
    rememberPrivateInviteToken('t-1', 'a1b2c3d4e5f6a7b8c9d0');
    rememberPrivateInviteToken('t-2', 'bad token!');
    expect(privateInviteTokenFor('t-1')).toBe('a1b2c3d4e5f6a7b8c9d0');
    expect(privateInviteTokenFor('t-2')).toBeNull();
  });
});

describe('the door and its words', () => {
  beforeEach(() => rpc.mockReset());

  it('reads a Sit & Go answer: held in place, the inviter registered', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        created: false,
        registered: true,
        sit_and_go: true,
        tournament_id: 't-9',
        table_id: null,
        invite_token: 'a1b2c3d4e5f6a7b8c9d0',
        live: true,
        exclusive: false,
        seats_held: 2,
        held_open: 2,
        hold_expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
      error: null,
    });
    const res = await inviteToPrivateGame('t-9', 2);
    expect(rpc).toHaveBeenCalledWith('fn_invite_to_private_game', {
      p_tournament_id: 't-9',
      p_seats_held: 2,
    });
    expect(res.ok && res.sitAndGo && res.registered && !res.created).toBe(true);
    expect(res.hold?.isCreator).toBe(true);
    expect(res.hold?.exclusive).toBe(false);
    expect(res.hold?.heldOpen).toBe(2);
    expect(res.hold?.tableId).toBeNull();
  });

  it('a refusal is plain words: Title Case, no em dash', () => {
    for (const reason of [
      'format_not_supported',
      'no_open_seat',
      'private_game_seat_held',
      'another_invite_is_holding',
      'already_registered',
      'tournament_full',
      'spin_sng_closed_until_reopen',
      undefined,
    ]) {
      const text = privateGameRefusalText(reason);
      expect(text).not.toMatch(/\u2014/);
      for (const word of text.split(/\s+/)) expect(word[0]).toBe(word[0].toUpperCase());
    }
    expect(privateGameRefusalText('format_not_supported')).toBe(
      'Seats Can Be Held For Spins, Heads Up And Sit N Gos Only'
    );
  });

  it('the guard refusal is recognised from a database error', () => {
    expect(
      isPrivateGameSeatHeldError({
        message: 'PRIVATE_GAME_SEAT_HELD: this seat is held for an invited friend',
      })
    ).toBe(true);
    expect(isPrivateGameSeatHeldError({ message: 'x', hint: 'private_game_seat_held' })).toBe(true);
    expect(isPrivateGameSeatHeldError({ message: 'tournament_full' })).toBe(false);
  });
});

describe('offered only by an engine that honours a Sit & Go hold', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    _resetPrivateGameSupportForTests();
  });
  const health = (body: unknown, ok = true) => {
    globalThis.fetch = vi.fn(async () => ({ ok, json: async () => body })) as never;
    _resetPrivateGameSupportForTests();
  };

  it('an engine with only the Spin and Heads Up half does not offer the Sit & Go hold', async () => {
    health({ privateGameHolds: 1 });
    expect(await privateGameHoldsSupported()).toBe(true);
    expect(await privateSitAndGoHoldsSupported()).toBe(false);
  });

  it('an engine that says both offers both', async () => {
    health({ privateGameHolds: 1, privateSitAndGoHolds: 1 });
    expect(await privateGameHoldsSupported()).toBe(true);
    expect(await privateSitAndGoHoldsSupported()).toBe(true);
  });

  it('an unreadable answer offers neither: the plain link is shared instead', async () => {
    health(null, false);
    expect(await privateSitAndGoHoldsSupported()).toBe(false);
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as never;
    _resetPrivateGameSupportForTests();
    expect(await privateGameHoldsSupported()).toBe(false);
  });
});

describe('it is wired where a player meets it', () => {
  it('every Sit & Go registration asks the hold before any money moves, and is not retried past it', () => {
    const register = sliceMethod(
      read('src/services/TournamentService.ts'),
      'async registerPlayer('
    );
    const ask = register.search(
      /acceptPrivateGameInvite\(\s*tournamentId,\s*privateInviteTokenFor\(tournamentId\)\s*\)/
    );
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(register.indexOf("'fn_register_for_tournament_request'"));
    expect(register).toMatch(/if \(\s*isSitAndGoInviteFormat\(\s*tournament/);
    expect(register.indexOf('isSitAndGoInviteFormat(')).toBeLessThan(ask);
    expect(register).toMatch(/!isPrivateGameSeatHeldError\(rpcCall\.error\)/);
    expect(register).toMatch(/if \(isPrivateGameSeatHeldError\(rpcError\)\)/);
  });

  it('the launcher asks the Sit & Go engine flag and lands the inviter on the tournament page', () => {
    const launcher = read('src/hooks/usePrivateGameInviteLauncher.tsx');
    expect(launcher).toMatch(
      /sitAndGo \? privateSitAndGoHoldsSupported\(\) : privateGameHoldsSupported\(\)/
    );
    expect(launcher).toMatch(
      /navigate\(`\/tournaments\/\$\{encodeURIComponent\(res\.hold\.tournamentId\)\}\?held=1`\)/
    );
  });

  it("the tournament page shows the held seats and the friend's Take Seat", () => {
    const page = read('src/pages/tournament/TournamentDetails.tsx');
    expect(page).toMatch(/usePrivateSitAndGoHold\(\{/);
    expect(page).toMatch(/\{sitAndGoHold\.element\}/);
    expect(page).toMatch(/parseTournamentInviteParams\(tournamentId, search\)\.inviteToken/);
    const hold = read('src/hooks/usePrivateSitAndGoHold.tsx');
    const take = sliceBetween(hold, 'const takeSeat = useCallback(', 'const element =');
    expect(take.indexOf('acceptPrivateGameInvite(tournamentId, inviteToken)')).toBeLessThan(
      take.indexOf('onRegister()')
    );
  });

  it('every surface hands the field size and format to the chooser', () => {
    for (const f of [
      'src/components/lobby/GameLobbyPanel.tsx',
      'src/components/lobby/LobbyTable.tsx',
      'src/components/tournament/TournamentLobbyCard.tsx',
      'src/pages/tournament/TournamentDetails.tsx',
    ]) {
      const src = read(f);
      expect(src, f).toMatch(/current_players:/);
      expect(src, f).toMatch(/format_contract:/);
    }
  });

  it('the dialog speaks in Title Case with no em dash and no new painted control', () => {
    const modal = read('src/components/table/PrivateGameInviteModal.tsx');
    const sng = sliceBetween(
      modal,
      "if (step === 'start' && sitAndGo) {",
      "} else if (step === 'start') {"
    );
    expect(sng).not.toMatch(/\u2014/);
    expect(sng).toMatch(/hu-waiting-dialog__copy-inline/);
    expect(sng).not.toMatch(/style=\{|border-radius|linear-gradient/);
  });
});
