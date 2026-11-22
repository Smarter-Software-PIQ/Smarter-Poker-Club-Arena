/**
 * LAW: AN INVITE OPENS THE GAME IT NAMES, AND A GAME THAT ALREADY STARTED
 * LEADS TO THE ONE THAT IS OPEN (Dan, 2026-11-22).
 * ═══════════════════════════════════════════════════════════════════════════
 * Dan: "THE SHARE BUTTON FUNCTIONALITY INSIDE OF THE SPINS, SIT N GO'S,
 * SATELLITES HEADS UP AND MTT'S ISN'T WORKING PROPERLY ... FIX THIS WEIRD
 * GLITCH THAT IS HAPPENING WHEN THEY INVITE." The player: "The share link
 * still doesn't work either ... The crazy river is always on the table, even
 * when you invite someone. It doesn't open a new table."
 *
 * Every pin below is a defect that shipped with the invite work of
 * 2026-11-22:
 *
 *   1. the in-app friend invite crossed its two parameters (`i` carried the
 *      Heads Up seat-hold token and `invite` the club code), so the seat held
 *      for the invited friend refused that friend;
 *   2. the club-join detour dropped the seat-hold token from its return path;
 *   3. an invite sent from a tournament table named the TABLE the inviter sat
 *      at, which a Spin or Sit & Go recycles and a running MTT moves, so the
 *      friend landed as a spectator at a felt with other players seated;
 *   4. a link to a When Full game that had already filled led to that running
 *      game and nowhere else.
 *
 * Tests written against made-up values pinned (1) as correct. These use the
 * real shapes: a 7 character club code and the 32 hex token the database
 * mints (fn_set_heads_up_wait_mode).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));
vi.mock('../src/services/MessagingService', () => ({
  messagingService: { isNotificationTypeMuted: vi.fn(() => false) },
}));

import { buildTableInviteDeepLink } from '../src/services/NotificationService';
import { parseTableInviteParams } from '../src/lib/mustMoveInviteRouting';
import { parseHeadsUpInviteToken } from '../src/utils/headsUpWaitMode';
import { safeInviteNextPath } from '../src/lib/inviteCode';
import { gameInviteUrl, tableInviteTarget } from '../src/lib/share';
import {
  findNextOpenGame,
  inviteLandingState,
  isWhenFullGame,
  nextOpenGamePath,
  pickNextOpenGame,
  type WhenFullGameRow,
} from '../src/lib/nextOpenGame';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const TABLE = '11111111-2222-4333-8444-555555555555';
const TOURNAMENT = '22222222-3333-4444-8555-666666666666';
const CLUB = '44444444-5555-4666-8777-888888888888';
const CLUB_CODE = 'ABC2345';
const HOLD_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const ORIGIN = 'https://smarter.poker';

const searchOf = (path: string) => (path.includes('?') ? path.slice(path.indexOf('?')) : '');

describe('an in-app friend invite reaches the table with both keys in the right place', () => {
  const link = buildTableInviteDeepLink({
    kind: 'tournament',
    table_id: TABLE,
    tournament_id: TOURNAMENT,
    invite_code: CLUB_CODE,
    invite_token: HOLD_TOKEN,
  });

  it('spells the club code as i and the seat-hold token as invite', () => {
    expect(link).toBe(`/table/${TABLE}?i=${CLUB_CODE}&invite=${HOLD_TOKEN}`);
  });

  it('is read back by the table as that club code and that seat-hold token', () => {
    const search = searchOf(link);
    expect(parseTableInviteParams(TABLE, search).inviteCode).toBe(CLUB_CODE);
    expect(parseTableInviteParams(TABLE, search).inviteToken).toBe(HOLD_TOKEN);
    expect(parseHeadsUpInviteToken(search)).toBe(HOLD_TOKEN);
  });

  it('the shared link and the in-app link agree on both parameters', () => {
    const shared = gameInviteUrl(
      { kind: 'table', id: TABLE, inviteCode: CLUB_CODE, inviteToken: HOLD_TOKEN },
      ORIGIN
    );
    expect(searchOf(shared)).toBe(searchOf(link));
  });
});

describe('the seat-hold token survives the club-join detour', () => {
  it('rides in the return path, and the return path is one the join flow accepts', () => {
    const { returnPath } = parseTableInviteParams(TABLE, `?i=${CLUB_CODE}&invite=${HOLD_TOKEN}`);
    expect(returnPath).toBe(`/table/${TABLE}?invite=${HOLD_TOKEN}`);
    expect(safeInviteNextPath(returnPath)).toBe(returnPath);
    expect(parseHeadsUpInviteToken(searchOf(returnPath!))).toBe(HOLD_TOKEN);
  });
});

describe('an invite sent from a table names the game, not the chair', () => {
  const base = { tableId: TABLE, inviteCode: CLUB_CODE };

  it.each([
    ['a running MTT', {}],
    ['a seat-first Spin or Sit & Go before it starts', { seatHoldToken: null }],
  ])('%s is shared as its tournament', (_label, extra) => {
    const target = tableInviteTarget({
      ...base,
      isTournament: true,
      tournamentId: TOURNAMENT,
      ...extra,
    });
    expect(target).toEqual({ kind: 'tournament', id: TOURNAMENT, inviteCode: CLUB_CODE });
    expect(gameInviteUrl(target, ORIGIN)).toBe(`${ORIGIN}/t/${TOURNAMENT}`);
  });

  it('a Heads Up seat held for a named player is the table with its token', () => {
    const target = tableInviteTarget({
      ...base,
      isTournament: true,
      tournamentId: TOURNAMENT,
      seatHoldToken: HOLD_TOKEN,
    });
    expect(gameInviteUrl(target, ORIGIN)).toBe(
      `${ORIGIN}/g/${TABLE}?i=${CLUB_CODE}&invite=${HOLD_TOKEN}`
    );
  });

  it('a cash table and a Lightning room keep their own addresses', () => {
    expect(tableInviteTarget({ ...base, isTournament: false, clusterId: CLUB })).toEqual({
      kind: 'table',
      id: TABLE,
      inviteCode: CLUB_CODE,
      clusterId: CLUB,
    });
    expect(tableInviteTarget({ ...base, isTournament: false, lightningClusterId: CLUB })).toEqual({
      kind: 'lightning',
      id: CLUB,
      inviteCode: CLUB_CODE,
    });
  });

  it('the table page sends the link and the friend invite through that one decision', () => {
    const page = read('src/pages/TablePage.tsx');
    expect(page).toContain('const currentInviteTarget = useCallback(');
    expect(page).toContain('const target = currentInviteTarget();');
    expect(page).toContain("currentInviteTarget().kind === 'tournament'");
    // The retired rule: a pre-start seat-first table shared as its table id.
    expect(page).not.toContain('!isSeatFirstOpen;');
  });
});

describe('a When Full game that started leads to the open one', () => {
  const game = (over: Partial<WhenFullGameRow> = {}): WhenFullGameRow => ({
    id: TOURNAMENT,
    name: '10 Chip Heads Up PLO',
    status: 'REGISTERING',
    club_id: CLUB,
    union_id: null,
    format_contract: 'sng-v1',
    buy_in_amount: 10,
    game_type: 'plo',
    max_players: 2,
    current_players: 1,
    satellite_target_id: null,
    created_at: '2026-11-22T10:00:00Z',
    ...over,
  });

  it('knows which formats start when full', () => {
    expect(isWhenFullGame(game())).toBe(true);
    expect(isWhenFullGame(game({ format_contract: 'spin-v1', max_players: 3 }))).toBe(true);
    expect(isWhenFullGame(game({ format_contract: 'seat-first-satellite-v1' }))).toBe(true);
    expect(isWhenFullGame(game({ format_contract: 'mtt-v2', max_players: null }))).toBe(false);
  });

  it('an open game, an MTT and the viewer own game are never called gone', () => {
    expect(inviteLandingState(game(), false)).toBe('open');
    expect(inviteLandingState(game({ format_contract: 'mtt-v2', status: 'RUNNING' }), false)).toBe(
      'open'
    );
    expect(inviteLandingState(game({ status: 'RUNNING' }), true)).toBe('mine');
  });

  it.each(['RUNNING', 'COMPLETED', 'CANCELLED'])('a %s game is gone for a newcomer', (status) => {
    expect(inviteLandingState(game({ status }), false)).toBe('gone');
  });

  it('a full game still marked registering is gone too', () => {
    expect(inviteLandingState(game({ current_players: 2 }), false)).toBe('gone');
  });

  it('picks the open game of the same board, by name first, never another club or stake', () => {
    const origin = game({ status: 'RUNNING', current_players: 2 });
    const sameName = game({ id: 'next-same-name', created_at: '2026-11-22T10:09:00Z' });
    const sameShape = game({
      id: 'next-same-shape',
      name: '10 Chip Heads Up PLO Turbo',
      created_at: '2026-11-22T10:01:00Z',
    });
    const others = [
      game({ id: 'other-club', club_id: 'ffffffff-5555-4666-8777-888888888888' }),
      game({ id: 'other-stake', buy_in_amount: 25 }),
      game({ id: 'other-game', game_type: 'nlh' }),
      game({ id: 'other-size', max_players: 6 }),
      game({ id: 'other-target', satellite_target_id: TABLE }),
      game({ id: 'full', current_players: 2 }),
      game({ id: 'started', status: 'RUNNING' }),
      origin,
    ];
    expect(pickNextOpenGame(origin, [...others, sameShape, sameName])?.id).toBe('next-same-name');
    expect(pickNextOpenGame(origin, [...others, sameShape])?.id).toBe('next-same-shape');
    expect(pickNextOpenGame(origin, others)).toBeNull();
  });

  it('answers the seats for a seat-first game, the lobby for a registered one, null on a failed read', async () => {
    const origin = game({ status: 'RUNNING', current_players: 2 });
    const next = await findNextOpenGame(origin, async () => [game({ id: 'next' })]);
    expect(next).toEqual({ tournamentId: 'next', seatFirst: true });
    expect(nextOpenGamePath(next!)).toBe('/tournaments/next?seat=1');

    const sixMax = game({ max_players: 6, status: 'RUNNING', current_players: 6 });
    const nextSixMax = await findNextOpenGame(sixMax, async () => [
      game({ id: 'next-6', max_players: 6, current_players: 2 }),
    ]);
    expect(nextOpenGamePath(nextSixMax!)).toBe('/tournaments/next-6');

    await expect(
      findNextOpenGame(origin, async () => {
        throw new Error('read failed');
      })
    ).resolves.toBeNull();
  });

  it('the tournament page and the table both offer it', () => {
    const details = read('src/pages/tournament/TournamentDetails.tsx');
    expect(details).toContain('inviteLandingState(tournament, myEntryStatus !== undefined)');
    expect(details).toContain('findNextOpenGame(tournament)');
    expect(details).toContain('data-testid="tournament-next-game-btn"');
    const page = read('src/pages/TablePage.tsx');
    expect(page).toContain('<InviteLandedLateOverlay');
    // A page this browser tab was reading earlier never takes the focus off
    // a table opened by invite link.
    expect(read('src/pages/MultiTablePage.tsx')).toContain(
      "if (routeTableIdRef.current && (searchParams.has('invite') || searchParams.has('i'))) return;"
    );
    const overlay = read('src/components/table/InviteLandedLateOverlay.tsx');
    expect(overlay).toContain("inviteLandingState(origin, Boolean(entry)) !== 'gone'");
    expect(overlay).not.toContain('—');
  });
});
