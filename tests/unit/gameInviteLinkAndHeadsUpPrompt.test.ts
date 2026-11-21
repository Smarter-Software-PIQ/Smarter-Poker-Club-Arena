import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  gameInviteText,
  gameInviteUrl,
  tableShareUrl,
  tournamentShareUrl,
} from '../../src/lib/share';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('game invite URL builders', () => {
  it('builds a canonical table share URL with encoded table id', () => {
    expect(tableShareUrl('tbl-123/4', 'https://smarter.poker')).toBe(
      'https://smarter.poker/hub/club-arena/table/tbl-123%2F4'
    );
  });

  it('routes table targets to tableShareUrl and tournament targets to tournamentShareUrl', () => {
    expect(gameInviteUrl({ kind: 'table', id: 'cash-99' }, 'https://smarter.poker')).toBe(
      tableShareUrl('cash-99', 'https://smarter.poker')
    );
    expect(gameInviteUrl({ kind: 'tournament', id: 'mtt-42' }, 'https://smarter.poker')).toBe(
      tournamentShareUrl('mtt-42', 'https://smarter.poker')
    );
  });

  it('formats invite text cleanly with or without a game name', () => {
    expect(gameInviteText('NLH 1/2 Heads Up')).toBe('Join Me In NLH 1/2 Heads Up On Smarter.Poker');
    expect(gameInviteText('   ')).toBe('Join My Poker Game On Smarter.Poker');
    expect(gameInviteText(null)).toBe('Join My Poker Game On Smarter.Poker');
  });
});

describe('lobby and table invite wiring', () => {
  it('GameLobbyPanel offers Invite To Game for every game type via shareLink and ShareLinkFallback', () => {
    const panel = read('src/components/lobby/GameLobbyPanel.tsx');
    expect(panel).toContain('Invite To Game');
    expect(panel).toContain(
      "isCash ? { kind: 'table', id: entry.id } : { kind: 'tournament', id: entry.id }"
    );
    expect(panel).toContain("source: 'GameLobbyPanel.inviteToGame'");
    expect(panel).toContain('<ShareLinkFallback');
  });

  it('LobbyTable, TournamentDetails, TournamentLobbyCard, and TournamentPage render direct Invite To Game controls', () => {
    const lobbyTable = read('src/components/lobby/LobbyTable.tsx');
    const lobbyTableCss = read('src/components/lobby/LobbyTable.css');
    const details = read('src/pages/tournament/TournamentDetails.tsx');
    const card = read('src/components/tournament/TournamentLobbyCard.tsx');
    const tournPage = read('src/pages/TournamentPage.tsx');

    expect(lobbyTable).toContain('data-testid="lobby-invite-btn"');
    expect(lobbyTable).toContain('<InviteRowButton entry={e} />');
    expect(lobbyTable).toContain("source: 'LobbyTable.inviteToGame'");
    expect(lobbyTableCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/:hover\b/);

    expect(details).toContain('data-testid="tournament-invite-btn"');
    expect(details).toContain('data-testid="tournament-footer-invite-btn"');
    expect(details).toContain('Invite To Game');

    expect(card).toContain('data-testid="tournament-card-invite-btn"');
    expect(card).toContain("source: 'TournamentLobbyCard.inviteToGame'");

    expect(tournPage).toContain('data-testid="club-tournaments-invite-btn"');
    expect(tournPage).toContain("source: 'TournamentPage.inviteToGame'");
  });

  it('TableMenu, TableTabBar, MasterBus, and TablePage wire INVITE_TO_GAME end to end', () => {
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
    expect(page).toContain('tableInviteFallbackUrl');
  });
});

describe('Heads-Up Sit N Go empty-table waiting prompt', () => {
  it('TablePage opens HeadsUpWaitingModal when sitting at an empty Heads-Up Sit N Go and closes when opponent joins', () => {
    const page = read('src/pages/TablePage.tsx');
    expect(page).toContain(
      "needed === 2 && taken <= 1 && seatFirstLabelRef.current === 'Heads Up'"
    );
    expect(page).toContain('setHeadsUpPromptOpen(true)');
    expect(page).toContain('<HeadsUpWaitingModal');
    expect(page).toContain('seatFirstOccupiedCount >= seatFirstBuyIn.seats');
    expect(page).toContain('spectator-footer-bar__cta--invite');
  });

  it('HeadsUpWaitingModal uses native <dialog> without redundant ARIA, routes sharing through src/lib/share.ts, and has no hover CSS', () => {
    const modal = read('src/components/table/HeadsUpWaitingModal.tsx');
    const css = read('src/components/table/HeadsUpWaitingModal.css');

    expect(modal).toContain('<dialog');
    expect(modal).toContain('showModal');
    expect(modal).not.toContain('role="dialog"');
    expect(modal).not.toContain('aria-modal');
    expect(modal).toContain('Are You Waiting For A Specific Player To Join');
    expect(modal).toContain("label: 'Specific Player'");
    expect(modal).toContain("label: 'Play Anyone'");
    expect(modal).toContain("from '../../lib/share'");
    expect(modal).toContain('<ShareLinkFallback');

    expect(css).not.toMatch(/:hover\b/);
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('.hu-waiting-dialog[open]');
  });
});
