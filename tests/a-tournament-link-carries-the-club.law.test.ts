/**
 * LAW: A TOURNAMENT LINK CARRIES THE CLUB, AND AN IN-APP INVITE IS SENT BY
 * THE SERVER (2026-11-22).
 * ═══════════════════════════════════════════════════════════════════════════
 * Dan: "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY
 * BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN
 * AND TESTED BEFORE CLAIMING SUCCESS." Two defects left open by the invite
 * work of the same day (tests/an-invite-opens-the-game-it-names.law.test.ts):
 *
 *   1. A tournament was shared as smarter.poker/t/<id> with no club code, and
 *      the World Hub page passed no query on. A tournament is readable only
 *      inside its club (the RESTRICTIVE SELECT policy on tournaments), so a
 *      signed-in friend who was not yet a member opened the link on
 *      "Tournament Not Found" with Back To Clubs, and could never register.
 *      Every tournament link now carries `?i=<the sender's club code>`, spelled
 *      as a table link spells it; the tournament page reads it and offers the
 *      club's own join step (/i/<CODE>?next=/tournaments/<id>), which comes
 *      back to the tournament. The code survives sign-in (AuthGuard keeps the
 *      query in the return path) and the native /t/ deep link.
 *
 *   2. The in-app friend invite inserted the friend's `notifications` row from
 *      the browser. Production refuses that write (no INSERT for
 *      `authenticated`), so every in-app invite answered "Could Not Send
 *      Invite"; and the only INSERT policy this repository ever wrote was
 *      WITH CHECK (true), which would let anyone write anything to anyone.
 *      The send now goes through public.fn_send_game_invite (migration
 *      20261123013356), which checks the recipient, the game and the rate and
 *      builds the link itself.
 *
 * Real shapes throughout: a 7 character club code from the database's own
 * alphabet and uuids, because made-up values are how #11772's crossed
 * parameters were pinned as correct.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createElement } from 'react';

vi.mock('../src/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  gameInviteUrl,
  lobbyEntryInviteTarget,
  tableInviteTarget,
  tournamentShareUrl,
} from '../src/lib/share';
import { parseTournamentInviteParams } from '../src/lib/mustMoveInviteRouting';
import {
  appendInviteNextParam,
  clubInviteJoinPath,
  safeInviteNextPath,
} from '../src/lib/inviteCode';
import { parseAppUrl } from '../src/lib/native/deepLinks';
import { safeInAppRedirect, signInUrl } from '../src/lib/signIn';
import { TournamentClubJoinGate } from '../src/components/tournament/TournamentClubJoinGate';
import { blankNonCode, sliceCall, sliceDollarQuoted } from './helpers/sourceWindow';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const TOURNAMENT = '8c5474fd-f1e6-4112-91f9-6d6e8af4c842';
const TABLE = '11111111-2222-4333-8444-555555555555';
const CLUB_CODE = 'K7MQ2XR';
const ORIGIN = 'https://smarter.poker';

/** Comments out, strings kept: a pin on a call's literal arguments. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
/** SQL line comments out, so the header's prose is never read as DDL. */
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

const searchOf = (url: string) => {
  const u = new URL(url, ORIGIN);
  return u.search;
};

afterEach(() => cleanup());

describe('every tournament link carries the sender club code', () => {
  it('the one builder spells it i, normalised, and drops anything that is not a code', () => {
    expect(tournamentShareUrl(TOURNAMENT, { origin: ORIGIN, inviteCode: 'k7mq2xr' })).toBe(
      `${ORIGIN}/t/${TOURNAMENT}?i=${CLUB_CODE}`
    );
    expect(tournamentShareUrl(TOURNAMENT, { origin: ORIGIN, inviteCode: 'NOT-A-CODE' })).toBe(
      `${ORIGIN}/t/${TOURNAMENT}`
    );
    // The old string-origin form still works for a caller with no code.
    expect(tournamentShareUrl(TOURNAMENT, ORIGIN)).toBe(`${ORIGIN}/t/${TOURNAMENT}`);
  });

  it('a lobby row, a table and the in-app target all reach the link with the code', () => {
    const fromLobby = lobbyEntryInviteTarget(
      { id: TOURNAMENT, kind: 'tournament' },
      { inviteCode: CLUB_CODE }
    );
    expect(gameInviteUrl(fromLobby, ORIGIN)).toBe(`${ORIGIN}/t/${TOURNAMENT}?i=${CLUB_CODE}`);
    const fromTable = tableInviteTarget({
      tableId: TABLE,
      isTournament: true,
      tournamentId: TOURNAMENT,
      inviteCode: CLUB_CODE,
    });
    expect(gameInviteUrl(fromTable, ORIGIN)).toBe(`${ORIGIN}/t/${TOURNAMENT}?i=${CLUB_CODE}`);
    expect(
      gameInviteUrl(
        { kind: 'tournament', id: TOURNAMENT },
        { origin: ORIGIN, inviteCode: CLUB_CODE }
      )
    ).toBe(`${ORIGIN}/t/${TOURNAMENT}?i=${CLUB_CODE}`);
  });

  it('every call to the builder in src passes the sender code', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk(resolve(ROOT, 'src'));
    const sites: string[] = [];
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1);
      if (rel === 'src/lib/share.ts') continue; // the builder itself
      const src = readFileSync(file, 'utf8');
      const code = blankNonCode(src);
      let at = code.indexOf('tournamentShareUrl(');
      while (at >= 0) {
        const call = sliceCall(src.slice(at), 'tournamentShareUrl(');
        sites.push(rel);
        expect(call, `${rel}: ${call}`).toMatch(/\binviteCode\b/);
        at = code.indexOf('tournamentShareUrl(', at + 1);
      }
    }
    // The five surfaces that share a tournament directly. The lobby rows, the
    // table menu and the in-app invite reach it through gameInviteUrl.
    for (const surface of [
      'src/pages/tournament/TournamentDetails.tsx',
      'src/pages/TournamentPage.tsx',
      'src/components/tournament/TournamentLobbyCard.tsx',
      'src/components/table/TournamentBreakScreen.tsx',
      'src/components/tournament/TournamentRankingCard.tsx',
    ]) {
      expect(sites, surface).toContain(surface);
    }
    const door = read('src/lib/share.ts');
    expect(
      sliceCall(door.slice(door.indexOf('export function gameInviteUrl(')), 'tournamentShareUrl(')
    ).toContain('inviteCode');
  });

  it('the lobby hands the card its club so the code is asked once per club', () => {
    const page = read('src/pages/tournament/TournamentLobbyPage.tsx');
    expect(page).toContain('club_id: tournament.clubId,');
    expect(page).toContain('union_id: tournament.unionId ?? null,');
  });
});

describe('the code survives the way to the tournament', () => {
  const shared = tournamentShareUrl(TOURNAMENT, { origin: ORIGIN, inviteCode: CLUB_CODE });

  it('the native app maps the /t/ link to the tournament with i intact', () => {
    expect(parseAppUrl(shared)?.path).toBe(`/tournaments/${TOURNAMENT}?i=${CLUB_CODE}`);
  });

  it('a signed-out arrival keeps i through sign-in and back', () => {
    const arrival = `/tournaments/${TOURNAMENT}${searchOf(shared)}`;
    const login = signInUrl(arrival);
    const redirect = new URL(login, ORIGIN).searchParams.get('redirect');
    expect(redirect).toBe(`/hub/club-arena/tournaments/${TOURNAMENT}?i=${CLUB_CODE}`);
    expect(safeInAppRedirect(redirect)).toBe(arrival);
    // AuthGuard hands signInUrl the whole address, query included.
    expect(read('src/components/auth/AuthGuard.tsx')).toContain(
      'const back = location.pathname + location.search + location.hash;'
    );
  });

  it('a signed-in non-member is offered the club join, which returns to the tournament', () => {
    const arrival = parseAppUrl(shared)!.path;
    const { inviteCode, returnPath } = parseTournamentInviteParams(TOURNAMENT, searchOf(arrival));
    expect(inviteCode).toBe(CLUB_CODE);
    // No i on the way back, so a member who still cannot open it is told
    // "Tournament Not Found" rather than sent round the join again.
    expect(returnPath).toBe(`/tournaments/${TOURNAMENT}`);
    const join = clubInviteJoinPath(inviteCode, returnPath);
    expect(join).toBe(`/i/${CLUB_CODE}?next=${encodeURIComponent(`/tournaments/${TOURNAMENT}`)}`);
    // InviteCodePage carries next onto the club join page; InvitePage goes there.
    const next = new URL(join!, ORIGIN).searchParams.get('next');
    const joinPage = appendInviteNextParam(`/invite/kings-club?i=${CLUB_CODE}&ref=1042`, next);
    expect(safeInviteNextPath(new URL(joinPage, ORIGIN).searchParams.get('next'))).toBe(
      `/tournaments/${TOURNAMENT}`
    );
  });

  it('a seat-hold token rides the return path, a malformed code offers no join', () => {
    const hold = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(
      parseTournamentInviteParams(TOURNAMENT, `?i=${CLUB_CODE}&invite=${hold}`).returnPath
    ).toBe(`/tournaments/${TOURNAMENT}?invite=${hold}`);
    expect(parseTournamentInviteParams(TOURNAMENT, '?i=BAD01').inviteCode).toBeNull();
    expect(clubInviteJoinPath('BAD01', `/tournaments/${TOURNAMENT}`)).toBeNull();
  });

  it('the tournament page shows the join step instead of a dead end', () => {
    const details = read('src/pages/tournament/TournamentDetails.tsx');
    expect(details).toMatch(
      /const clubJoin = tournamentIdOverride\s*\?\s*null\s*:\s*parseTournamentInviteParams\(tournamentId, search\);/
    );
    expect(details).toContain('if (clubJoin?.inviteCode) {');
    expect(details).toContain('<TournamentClubJoinGate');
    // The table's join plate builds its detour with the same helper.
    expect(read('src/components/table/TableLoadFailureOverlay.tsx')).toContain(
      'clubInviteJoinPath(inviteCode, returnPath)'
    );
  });

  it('the join step navigates to the club join with the tournament as next', async () => {
    const Probe = () => {
      const loc = useLocation();
      return createElement('div', { 'data-testid': 'probe' }, `${loc.pathname}${loc.search}`);
    };
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/tournaments/${TOURNAMENT}?i=${CLUB_CODE}`] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/tournaments/:tournamentId',
            element: createElement(TournamentClubJoinGate, {
              inviteCode: CLUB_CODE,
              returnPath: `/tournaments/${TOURNAMENT}`,
            }),
          }),
          createElement(Route, { path: '/i/:code', element: createElement(Probe) })
        )
      )
    );
    expect(screen.getByTestId('tournament-club-join-copy').textContent).not.toMatch(/\u2014/);
    expect(screen.getByRole('button', { name: 'Back To Clubs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join Club & Open Tournament' }));
    await waitFor(() =>
      expect(screen.getByTestId('probe').textContent).toBe(
        `/i/${CLUB_CODE}?next=${encodeURIComponent(`/tournaments/${TOURNAMENT}`)}`
      )
    );
  });
});

describe('an in-app invite is sent by the server, never written by the browser', () => {
  const MIGRATION =
    'supabase/migrations/20261123013356_a_game_invite_is_sent_by_the_server_to_a_clubmate_or_friend.sql';

  it('the send path calls fn_send_game_invite and inserts nothing', () => {
    const service = stripComments(read('src/services/TableInviteService.ts'));
    expect(service).toContain("supabase.rpc('fn_send_game_invite'");
    expect(service).not.toContain("from('notifications')");
    expect(service).not.toMatch(/\.insert\(/);
  });

  it('no client file writes a table_invite notification row', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          const src = readFileSync(full, 'utf8');
          const code = blankNonCode(src);
          let at = code.indexOf('.insert(');
          while (at >= 0) {
            const call = stripComments(sliceCall(src.slice(at), '.insert('));
            if (/['"`]table_invite['"`]/.test(call)) offenders.push(full.slice(ROOT.length + 1));
            at = code.indexOf('.insert(', at + 1);
          }
        }
      }
    };
    walk(resolve(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });

  it('the door checks recipient, game, repeat and rate, and opens no write to notifications', () => {
    const sql = read(MIGRATION);
    const body = sliceDollarQuoted(sql, '$fn$');
    expect(sql).toMatch(/LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    // the sender can see the game: the RESTRICTIVE SELECT policies' predicate
    expect(body).toContain('public.fn_poker_can_read_games(v_scope)');
    // the recipient is a friend or in the game's club scope
    expect(body).toContain('FROM public.friendships f');
    expect(body).toContain('public.fn_club_scope_ids(v_scope)');
    expect(body).toContain("RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');");
    // one per sender, recipient and game a minute; thirty in ten minutes
    expect(body).toContain("c_repeat_window constant interval := interval '60 seconds';");
    expect(body).toContain('c_rate_limit    constant integer  := 30;');
    expect(body).toContain('pg_advisory_xact_lock(');
    // the link is built here; the code must be the sender's own
    expect(body).toContain('l.code = v_code AND l.inviter_id = v_uid');
    expect(body).toContain("v_url := '/hub/club-arena' || v_path;");
    expect(body).not.toMatch(/is_horse/);
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_send_game_invite(uuid, text, uuid, uuid, uuid, text, text) FROM PUBLIC, anon;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_send_game_invite(uuid, text, uuid, uuid, uuid, text, text) TO authenticated, service_role;'
    );
    const ddl = stripSqlComments(sql.replace(/\$fn\$[\s\S]*?\$fn\$/, ''));
    expect(ddl).not.toMatch(/POLICY[^;]*\bnotifications\b/i);
    expect(ddl).not.toMatch(/GRANT[^;]*\bON\s+(TABLE\s+)?(public\.)?notifications\b/i);
    expect(sql).toContain('-- @probe-for: public.fn_send_game_invite');
  });
});
