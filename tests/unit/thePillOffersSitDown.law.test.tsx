/**
 * THE ACTION PILL OFFERS SIT DOWN - LAW (Dan 2026-11-14).
 *
 * Verbatim: "EVEN AFTER A HARD REFRESH I WASN'T ABLE TO CLICK ON THE ACTION
 * BAR PILL TO SIT DOWN. (IF A USER EVER CLICKS THE ACTION BAR PILL FOR A GAME,
 * IT SHOULD OPEN THE DROP DOWN MENU TO 'SIT DOWN')".
 *
 * That morning the pill's menu offered Sit Out, Leave Table Next Hand and
 * Leave Table to a player whom nothing was dealing. A table that deals the
 * hero nothing now leads its menu with Sit Down; the owning table page picks
 * the door (the Lightning room, Join Lightning, the first open chair's buy-in,
 * or the waiting list). A seated player keeps Sit Out, a sitting-out one
 * keeps I'm Back.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TableTabBar, { type TabInfo } from '../../src/components/table/TableTabBar';

const TABLE = '72db7c6a-f925-4f56-ab93-4b98cbbab47a';

function tab(over: Partial<TabInfo> = {}): TabInfo {
  return {
    id: TABLE,
    name: 'PLO4 1.00/2.00 Lightning Games Feeder',
    stakes: '1/2',
    gameCode: 'PLO',
    isMyTurn: false,
    ...over,
  };
}

function openMenu(t: TabInfo) {
  const onQuickAction = vi.fn();
  render(
    <TableTabBar
      tabs={[t]}
      activeTabId={t.id}
      onTabSelect={vi.fn()}
      onAddTable={vi.fn()}
      onQuickAction={onQuickAction}
    />
  );
  const pill = document.querySelector(`[data-tabid="${t.id}"]`) as HTMLElement;
  fireEvent.click(pill);
  const menu = screen.getByRole('menu');
  const labels = Array.from(menu.querySelectorAll('button')).map((b) => b.textContent);
  return { menu, labels, onQuickAction };
}

afterEach(cleanup);

describe('a tap on the pill of a table that deals the hero nothing offers Sit Down', () => {
  it('Sit Down is the first item, and it asks the table to sit the hero down', () => {
    const { labels, menu, onQuickAction } = openMenu(tab({ canSitDown: true, seated: true }));
    expect(labels[0]).toBe('Sit Down');
    // Nothing here describes a seat that is not playing on this table.
    expect(labels).not.toContain('Sit Out');
    expect(labels).not.toContain("I'm Back");
    expect(labels).not.toContain('Leave Table Next Hand');
    fireEvent.click(
      Array.from(menu.querySelectorAll('button')).find((b) => b.textContent === 'Sit Down')!
    );
    expect(onQuickAction).toHaveBeenCalledWith(TABLE, 'sitdown');
  });

  it("a seated player keeps Sit Out, and a sitting-out one keeps I'm Back", () => {
    expect(openMenu(tab({ canSitDown: false, seated: true })).labels).toEqual(
      expect.arrayContaining(['Sit Out', 'Leave Table Next Hand'])
    );
    cleanup();
    const back = openMenu(tab({ canSitDown: false, seated: true, sittingOut: true })).labels;
    expect(back).toContain("I'm Back");
    expect(back).not.toContain('Sit Down');
  });

  it('a lobby or hub tab is never offered Sit Down', () => {
    expect(openMenu(tab({ id: 'lobby:1', canSitDown: true })).labels).not.toContain('Sit Down');
  });
});

describe('the door behind Sit Down', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const MULTI = read('src/pages/MultiTablePage.tsx');
  const PAGE = read('src/pages/TablePage.tsx');

  it('the container hands Sit Down to the owning table page', () => {
    expect(MULTI).toMatch(
      /case 'sitdown': \{\s*masterBus\.emit\('TABLE_MENU_ACTION', \{ tableId: tabId, action: 'SIT_DOWN' \}\);/
    );
    expect(MULTI).toContain('canSitDown: t.canSitDown,');
  });

  it('the table page reports whether anything deals the hero here, and answers SIT_DOWN', () => {
    expect(PAGE).toMatch(/onTableInfoUpdate\?\.\(\{ canSitDown: pillCanSitDown \}\);/);
    const handler = PAGE.slice(PAGE.indexOf("event.action !== 'SIT_DOWN'"));
    const body = handler.slice(0, handler.indexOf('// Timer warning sound'));
    // In order: the converted seat's room, Join Lightning, the first open
    // chair's buy-in, the waiting list. Never a seat picked on a Lightning felt.
    const order = [
      'lightningHandoff.viewReady()',
      'openLightningAnchorEntry()',
      'handleSeatClick(openSeat)',
      'handleOpenWaitlist()',
    ].map((s) => body.indexOf(s));
    for (const at of order) expect(at).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('a tournament spectator is sent to the event, never to a chair or a second entry', () => {
    const offer = PAGE.slice(PAGE.indexOf('const pillCanSitDown ='));
    const offerExpr = offer.slice(0, offer.indexOf('useEffect('));
    expect(offerExpr).toMatch(
      /tableState\.isTournament\s*\?\s*heroHoldsNoChairHere &&\s*!awaitingTournamentSeat/
    );
    const handler = PAGE.slice(PAGE.indexOf("event.action !== 'SIT_DOWN'"));
    const body = handler.slice(0, handler.indexOf('// Timer warning sound'));
    expect(body).toMatch(
      /if \(tableState\.isTournament && !seatFirstBuyIn\) \{[\s\S]*?navigate\(`\/tournaments\/\$\{tableState\.tournamentId\}`\);/
    );
    // Its waiting list is a cash door only.
    expect(body).toMatch(/else if \(!tableState\.isTournament\) handleOpenWaitlist\(\);/);
  });
});
