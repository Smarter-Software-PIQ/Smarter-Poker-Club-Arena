import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  gameInviteText,
  gameInviteUrl,
  lightningShareUrl,
  lobbyEntryInviteTarget,
  tableShareUrl,
  tournamentShareUrl,
} from '../../src/lib/share';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

import { parseAppUrl } from '../../src/lib/native/deepLinks';

const CLUSTER_UUID = '11111111-2222-4333-8444-555555555555';

describe('game invite URL builders', () => {
  it('builds a canonical table share URL (/g/:id) with encoded table id', () => {
    expect(tableShareUrl('tbl-123/4', 'https://smarter.poker')).toBe(
      'https://smarter.poker/g/tbl-123%2F4'
    );
  });

  it('appends normalized inviteCode, clusterId, and inviteToken query params cleanly and omits invalid ones', () => {
    expect(
      tableShareUrl('tbl-1', {
        origin: 'https://smarter.poker',
        inviteCode: ' abc2345 ',
        clusterId: CLUSTER_UUID.toUpperCase(),
        inviteToken: 'hu_token-99',
      })
    ).toBe(`https://smarter.poker/g/tbl-1?i=ABC2345&cluster=${CLUSTER_UUID}&invite=hu_token-99`);

    // Invalid params produce a clean URL with no stray '?'.
    expect(
      tableShareUrl('tbl-1', {
        origin: 'https://smarter.poker',
        inviteCode: 'BAD01',
        clusterId: 'not-a-uuid',
        inviteToken: 'x',
      })
    ).toBe('https://smarter.poker/g/tbl-1');
  });

  it('builds a canonical Lightning share URL (/l/:id) with encoded cluster id and optional inviteCode', () => {
    expect(lightningShareUrl('cl-9/a', 'https://smarter.poker')).toBe(
      'https://smarter.poker/l/cl-9%2Fa'
    );
    expect(
      lightningShareUrl('cl-9/a', { origin: 'https://smarter.poker', inviteCode: 'xyz6789' })
    ).toBe('https://smarter.poker/l/cl-9%2Fa?i=XYZ6789');
  });

  it('routes table, lightning, and tournament targets to their canonical builders with query params', () => {
    expect(gameInviteUrl({ kind: 'table', id: 'cash-99' }, 'https://smarter.poker')).toBe(
      tableShareUrl('cash-99', 'https://smarter.poker')
    );
    expect(
      gameInviteUrl(
        {
          kind: 'table',
          id: 'cash-99',
          inviteCode: 'ABC2345',
          clusterId: CLUSTER_UUID,
          inviteToken: 'hold_44',
        },
        'https://smarter.poker'
      )
    ).toBe(`https://smarter.poker/g/cash-99?i=ABC2345&cluster=${CLUSTER_UUID}&invite=hold_44`);
    expect(gameInviteUrl({ kind: 'lightning', id: 'cluster-7' }, 'https://smarter.poker')).toBe(
      lightningShareUrl('cluster-7', 'https://smarter.poker')
    );
    expect(
      gameInviteUrl(
        { kind: 'lightning', id: 'cluster-7', inviteCode: 'ABC2345' },
        'https://smarter.poker'
      )
    ).toBe('https://smarter.poker/l/cluster-7?i=ABC2345');
    expect(gameInviteUrl({ kind: 'tournament', id: 'mtt-42' }, 'https://smarter.poker')).toBe(
      tournamentShareUrl('mtt-42', 'https://smarter.poker')
    );
  });

  it('native deepLinks parseAppUrl resolves /g/:id, /l/:id, and /t/:id preview links with query params', () => {
    expect(
      parseAppUrl(`https://smarter.poker/g/tbl-9?i=ABC2345&cluster=${CLUSTER_UUID}`)?.path
    ).toBe(`/table/tbl-9?i=ABC2345&cluster=${CLUSTER_UUID}`);
    expect(parseAppUrl('https://smarter.poker/l/cl-7?i=ABC2345')?.path).toBe(
      '/lightning/cl-7?i=ABC2345'
    );
    expect(parseAppUrl('https://smarter.poker/t/mtt-42')?.path).toBe('/tournaments/mtt-42');
    expect(parseAppUrl('clubarena://g/tbl-9?i=ABC2345')?.path).toBe('/table/tbl-9?i=ABC2345');
  });

  it('resolves lobby entry invite targets for classic cash, Must-Move cash, Lightning cash, and tournaments', () => {
    expect(lobbyEntryInviteTarget({ id: 'tbl-1', kind: 'cash', game: null })).toEqual({
      kind: 'table',
      id: 'tbl-1',
    });
    expect(
      lobbyEntryInviteTarget(
        {
          id: 'tbl-anchor',
          kind: 'cash',
          game: { id: 'cluster-42', lightning: { players: 8, status: 'live' } },
        },
        { inviteCode: 'ABC2345' }
      )
    ).toEqual({
      kind: 'lightning',
      id: 'cluster-42',
      inviteCode: 'ABC2345',
    });
    expect(
      lobbyEntryInviteTarget({
        id: 'tbl-main',
        kind: 'cash',
        game: { id: 'cluster-mustmove', lightning: undefined },
      })
    ).toEqual({
      kind: 'table',
      id: 'tbl-main',
    });
    expect(
      lobbyEntryInviteTarget(
        {
          id: 'tbl-main',
          kind: 'cash',
          game: { id: CLUSTER_UUID, mustMove: true, lightning: undefined },
        },
        { inviteCode: 'ABC2345' }
      )
    ).toEqual({
      kind: 'table',
      id: 'tbl-main',
      inviteCode: 'ABC2345',
      clusterId: CLUSTER_UUID,
    });
    // Manual (non-must-move) cluster does not attach ?cluster=.
    expect(
      lobbyEntryInviteTarget({
        id: 'tbl-manual',
        kind: 'cash',
        game: { id: CLUSTER_UUID, mustMove: false, lightning: undefined },
      })
    ).toEqual({
      kind: 'table',
      id: 'tbl-manual',
    });
    expect(lobbyEntryInviteTarget({ id: 'hu-9', kind: 'sng' })).toEqual({
      kind: 'tournament',
      id: 'hu-9',
    });
    expect(lobbyEntryInviteTarget({ id: 'spin-3', kind: 'spin' })).toEqual({
      kind: 'tournament',
      id: 'spin-3',
    });
    expect(lobbyEntryInviteTarget({ id: 'mtt-1', kind: 'mtt' })).toEqual({
      kind: 'tournament',
      id: 'mtt-1',
    });
  });

  it('formats invite text cleanly with or without a game name', () => {
    expect(gameInviteText('NLH 1/2 Heads Up')).toBe('Join Me In NLH 1/2 Heads Up On Smarter.Poker');
    expect(gameInviteText('   ')).toBe('Join My Poker Game On Smarter.Poker');
    expect(gameInviteText(null)).toBe('Join My Poker Game On Smarter.Poker');
  });
});

describe('lobby and table invite wiring', () => {
  it('GameLobbyPanel offers Invite To Game via lobbyEntryInviteTarget, shareLink, and ShareLinkFallback', () => {
    const panel = read('src/components/lobby/GameLobbyPanel.tsx');
    expect(panel).toContain('Invite To Game');
    expect(panel).toContain('gameInviteUrl(lobbyEntryInviteTarget(entry, { inviteCode }))');
    expect(panel).toContain("source: 'GameLobbyPanel.inviteToGame'");
    expect(panel).toContain('<ShareLinkFallback');
    expect(panel).toContain("entry.status !== 'completed' && entry.status !== 'closed'");
  });

  it('LobbyTable, TournamentDetails, TournamentLobbyCard, and TournamentPage render hardened Invite To Game controls', () => {
    const lobbyTable = read('src/components/lobby/LobbyTable.tsx');
    const lobbyTableCss = read('src/components/lobby/LobbyTable.css');
    const details = read('src/pages/tournament/TournamentDetails.tsx');
    const card = read('src/components/tournament/TournamentLobbyCard.tsx');
    const tournPage = read('src/pages/TournamentPage.tsx');

    expect(lobbyTable).toContain('data-testid="lobby-invite-btn"');
    expect(lobbyTable).toContain(
      "if (entry.kind === 'cash' || entry.kind === 'mtt') return false;"
    );
    expect(lobbyTable).toContain(
      '<InviteRowButton entry={e} inviteCode={ctx.inviteCode} onFailed={ctx.onInviteFailed} />'
    );
    expect(lobbyTable).toContain('gameInviteUrl(lobbyEntryInviteTarget(entry, { inviteCode }))');
    expect(lobbyTable).toContain("source: 'LobbyTable.inviteToGame'");
    expect(lobbyTable).toContain('<ShareLinkFallback');
    expect(lobbyTable).toContain("if (entry.status === 'completed' || entry.status === 'closed')");
    expect(lobbyTableCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/:hover\b/);

    const eventHeader = read('src/components/tournament/details/MttEventHeader.tsx');
    expect(details).toContain('onInvite={() => void inviteToGame()}');
    expect(eventHeader).toContain('data-testid="tournament-invite-btn"');
    expect(eventHeader).toContain('onClick={onInvite}');
    expect(details).toContain('data-testid="tournament-footer-invite-btn"');
    expect(eventHeader).toContain('Invite To Game');
    // Opening a shared /t/:id link for a seat-first game (Heads-Up SNG / Spin)
    // must offer Take Seat to the live table rather than calling registerMtt.
    expect(details).toContain('if (isSeatFirstTournament)');
    expect(details).toContain("data.status === 'REGISTERING' || data.status === 'ANNOUNCED'");

    expect(card).toContain("['sng', 'spin', 'satellite'].includes(tournament.type)");
    expect(card).toContain('data-testid="tournament-card-invite-btn"');
    expect(card).toContain("source: 'TournamentLobbyCard.inviteToGame'");
    expect(card).toContain("['finished', 'completed', 'cancelled']");

    expect(tournPage).toContain('data-testid="club-tournaments-invite-btn"');
    expect(tournPage).toContain("source: 'TournamentPage.inviteToGame'");
    expect(tournPage).toContain("['COMPLETED', 'CANCELLED', 'FINISHED']");
  });

  it('TableMenu, TableTabBar, MasterBus, and TablePage wire INVITE_TO_GAME including Lightning clusters and sender invite code', () => {
    const bus = read('src/core/MasterBus.ts');
    const menu = read('src/components/table/TableMenu.tsx');
    const bar = read('src/components/table/TableTabBar.tsx');
    const page = read('src/pages/TablePage.tsx');

    expect(bus).toContain("| 'INVITE_TO_GAME'");
    expect(menu).toContain("id: 'invite-to-game'");
    expect(menu).toContain("label: 'Invite To Game'");
    expect(bar).toContain("action: 'INVITE_TO_GAME'");
    expect(page).toContain("case 'INVITE_TO_GAME':");
    expect(page).toContain("source: 'TablePage.inviteToGame'");
    // 2026-11-22: one target for the link and the in-app friend invite
    // (tableInviteTarget), Lightning clusters included.
    expect(page).toContain('tableInviteTarget({');
    expect(page).toContain('lightningClusterId: lightningRoomRef.current?.clusterId ?? null');
    expect(page).toContain('gameInviteUrl(target)');
    expect(page).toContain('useSenderInviteCode(');
    expect(page).toContain('tableInviteFallbackUrl');
    expect(bus).toContain("| 'INVITE_ONLINE_FRIEND'");
    expect(menu).toContain("id: 'invite-online-friend'");
    expect(menu).toContain("label: 'Invite Online Friend'");
    expect(bar).toContain("action: 'INVITE_ONLINE_FRIEND'");
    expect(page).toContain("case 'INVITE_ONLINE_FRIEND':");
    expect(page).toContain('<OnlineFriendInvitePicker');
  });

  it('FriendListPanel Invite To Table button renders a visible icon', () => {
    const friends = read('src/components/social/FriendListPanel.tsx');
    expect(friends).toContain('title="Invite To Table"');
    expect(friends).toContain('<InviteLinkIcon />');
  });
});

describe('Heads-Up Sit N Go empty-table waiting prompt', () => {
  it('TablePage opens HeadsUpWaitingModal only while visible, prioritizes invited-player status, and closes when opponent joins', () => {
    const page = read('src/pages/TablePage.tsx');
    expect(page).toContain(
      "needed === 2 && taken <= 1 && seatFirstLabelRef.current === 'Heads Up'"
    );
    expect(page).toContain('setHeadsUpPromptOpen(true)');
    expect(page).toContain('<HeadsUpWaitingModal');
    expect(page).toContain('isOpen={headsUpPromptOpen && isVisible}');
    expect(page).toContain('seatFirstOccupiedCount >= seatFirstBuyIn.seats');
    expect(page).toContain('spectator-footer-bar__cta--invite');
    const invitedIdx = page.indexOf("if (left > 0 && headsUpWaitMode === 'specific')");
    const waitLongIdx = page.indexOf('if (left > 0 && seatFirstWaitLong)');
    expect(invitedIdx).toBeGreaterThan(-1);
    expect(waitLongIdx).toBeGreaterThan(invitedIdx);
  });

  it('HeadsUpWaitingModal uses native <dialog> safely, keeps step across re-renders, routes sharing through src/lib/share.ts, and has no hover CSS', () => {
    const modal = read('src/components/table/HeadsUpWaitingModal.tsx');
    const css = read('src/components/table/HeadsUpWaitingModal.css');

    expect(modal).toContain('<dialog');
    expect(modal).toContain('showModal');
    expect(modal).toContain('wasOpenRef');
    expect(modal).toContain('onCloseRef');
    expect(modal).not.toContain('role="dialog"');
    expect(modal).not.toContain('aria-modal');
    expect(modal).not.toContain("'this Heads Up Sit N Go'");
    expect(modal).toContain('Are You Waiting For A Specific Player To Join');
    expect(modal).toContain("label: 'Specific Player'");
    expect(modal).toContain("label: 'Play Anyone'");
    expect(modal).toContain("from '../../lib/share'");
    expect(modal).toContain('<ShareLinkFallback');

    expect(css).not.toMatch(/:hover\b/);
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('.hu-waiting-dialog[open]');
    expect(css).toContain('max-height: calc(100dvh - 24px)');
  });
});
