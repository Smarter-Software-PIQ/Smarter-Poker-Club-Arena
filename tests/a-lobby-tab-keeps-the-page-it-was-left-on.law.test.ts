/**
 * A LOBBY TAB KEEPS THE PAGE IT WAS LEFT ON - LAW (Dan 2026-11-13, binding)
 *
 * Verbatim: "WHEN I CLICK ON A + BUTTON AND GO TO THE LOBBY. THEN SELECT
 * ANYTHING LIKE PLAYER MANAGEMENT... THEN GO BACK AND VIEW ANOTHER OPEN TAB...
 * BUT GO BACK TO 'LOBBY TAB' AND ITS NO LONGER PLAYER MANAGEMENT IT DEFAULTS
 * BACK TO THE GAME LOBBY... KEEP IT ON THE EXACT PAGE YOU LEFT IT ON".
 *
 * Root cause: club pages are real routes, so opening one hid the tab
 * container, and selecting the Lobby pill again borrowed a table URL and
 * painted the game lobby. The tab now records the route it is on and the pill
 * goes back to it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decideLobbyOffRoute, type OffRouteInput } from '../src/utils/lobbyOffRoute';

const LOBBY = { id: 'lobby-1', isLobby: true };
const TABLE = { id: 't-1', isLobby: false };
const base = (over: Partial<OffRouteInput>): OffRouteInput => ({
  hidden: false,
  path: '/table/t-1',
  tabs: [TABLE, LOBBY],
  activeIndex: 1,
  pendingTabId: null,
  prev: { hidden: false, tabId: 'lobby-1' },
  navigationType: 'PUSH',
  ...over,
});

describe('a lobby tab keeps the page it was left on', () => {
  it('records Player Management as the lobby tab page when opened from it', () => {
    const d = decideLobbyOffRoute(base({ hidden: true, path: '/clubs/c1/members' }));
    expect(d.record).toEqual({ tabId: 'lobby-1', path: '/clubs/c1/members' });
    expect(d.clear).toEqual([]);
  });

  it('follows the player deeper so the page stays exact', () => {
    const d = decideLobbyOffRoute(
      base({
        hidden: true,
        path: '/clubs/c1/members/u9?tab=stats',
        tabs: [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }],
      })
    );
    expect(d.record?.path).toBe('/clubs/c1/members/u9?tab=stats');
  });

  it('switching to another tab keeps the page (a PUSH onto the other table)', () => {
    const d = decideLobbyOffRoute(
      base({
        hidden: false,
        activeIndex: 0,
        tabs: [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }],
        prev: { hidden: true, tabId: 'lobby-1' },
        navigationType: 'PUSH',
      })
    );
    expect(d.clear).toEqual([]);
    expect(d.record).toBeNull();
  });

  it('a restore focuses the lobby pill only once the route has left /table', () => {
    const tabs = [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }];
    // Still on the table route: nothing focused, nothing cleared.
    const during = decideLobbyOffRoute(
      base({ hidden: false, activeIndex: 0, tabs, pendingTabId: 'lobby-1' })
    );
    expect(during.focusIndex).toBeNull();
    expect(during.consumePending).toBe(false);
    expect(during.clear).toEqual([]);
    // Arrived on the page: the pill is focused, the page kept.
    const arrived = decideLobbyOffRoute(
      base({
        hidden: true,
        path: '/clubs/c1/members',
        activeIndex: 0,
        tabs,
        pendingTabId: 'lobby-1',
      })
    );
    expect(arrived.focusIndex).toBe(1);
    expect(arrived.consumePending).toBe(true);
    expect(arrived.record).toBeNull();
  });

  it('showing the in-tab game lobby again clears the remembered page', () => {
    const d = decideLobbyOffRoute(
      base({ tabs: [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }] })
    );
    expect(d.clear).toEqual(['lobby-1']);
  });

  it('a swipe, number key or tile tap onto the tab goes back to its page too', () => {
    const d = decideLobbyOffRoute(
      base({
        activeIndex: 1,
        tabs: [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }],
        prev: { hidden: false, tabId: 't-1' },
      })
    );
    expect(d.clear).toEqual([]);
    // The index goes back to the table for this frame: no game-lobby flash.
    expect(d.restore).toEqual({ tabId: 'lobby-1', path: '/clubs/c1/members', revertIndex: 0 });
    expect(d.nextPrev.tabId).toBe('t-1');
  });

  it('coming back from its own page into the tab shows the game lobby', () => {
    const d = decideLobbyOffRoute(
      base({
        tabs: [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }],
        prev: { hidden: true, tabId: 'lobby-1' },
      })
    );
    expect(d.restore).toBeNull();
    expect(d.clear).toEqual(['lobby-1']);
  });

  it('a restore that never reaches its page is abandoned, not left pending', () => {
    const d = decideLobbyOffRoute(
      base({
        activeIndex: 0,
        path: '/table/t-2',
        tabs: [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }],
        pendingTabId: 'lobby-1',
        pendingFromPath: '/table/t-1',
      })
    );
    expect(d.consumePending).toBe(true);
    expect(d.focusIndex).toBeNull();
  });

  it('backing out of the page onto a table clears it', () => {
    const d = decideLobbyOffRoute(
      base({
        activeIndex: 0,
        tabs: [TABLE, { ...LOBBY, lobbyOffRoutePath: '/clubs/c1/members' }],
        prev: { hidden: true, tabId: 'lobby-1' },
        navigationType: 'POP',
      })
    );
    expect(d.clear).toEqual(['lobby-1']);
  });

  it('never remembers a table or sign-in route, nor a page reached from a table tab', () => {
    expect(decideLobbyOffRoute(base({ hidden: true, path: '/auth/login' })).record).toBeNull();
    expect(
      decideLobbyOffRoute(base({ hidden: true, path: '/clubs/c1/cashier', activeIndex: 0 })).record
    ).toBeNull();
  });

  it('the tab strip routes a remembered lobby pill back to its page', () => {
    const multi = readFileSync(resolve(__dirname, '../src/pages/MultiTablePage.tsx'), 'utf8');
    const select = multi.slice(multi.indexOf('const handleTabSelect = useCallback('));
    const restore = select.indexOf('selected.lobbyOffRoutePath');
    const focus = select.indexOf('setActiveIndex(idx)');
    expect(restore).toBeGreaterThan(-1);
    // The restore runs before the index moves, so the game lobby never paints.
    expect(restore).toBeLessThan(focus);
    expect(multi).toContain('decideLobbyOffRoute(');
  });
});
