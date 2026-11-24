/**
 * A SWITCH IN THE TABLE MENU ANSWERS THE PRESS (Dan, 2026-11-14).
 *
 * "THE SOUNDS BUTTON AND ANY OTHER BUTTONS YOU CLICK, SILENTLY FAIL, IT JUST
 * BRINGS YOU BACK TO THE PLAYING PAGE."
 *
 * Three things made that true at once:
 *
 *   1. The Sounds and Vibrations badges read two fields off the active tab that
 *      no table page ever reported, so both said OFF forever. Stand Up Next Big
 *      Blind read a third unreported field and never showed a badge at all.
 *   2. Every row closed the menu, switches included, so the only feedback a
 *      switch could give was a badge the player was no longer looking at.
 *   3. A cached copy of the Settings page could mute the table again after the
 *      player had turned Sounds on, with nothing on screen changing.
 *
 * These pin the behaviour, on the real components, and the three reports the
 * behaviour depends on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const emit = vi.fn();
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: (...args: unknown[]) => emit(...args), subscribe: vi.fn(() => () => {}) },
}));

import { createDefaultMenuSections } from '../../src/components/table/TableMenu';
import { TableTabBar, type TabInfo } from '../../src/components/table/TableTabBar';
import { setTableSetting } from '../../src/hooks/useTableSettings';
import { sliceBetween, sliceCall } from '../helpers/sourceWindow';

const read = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const tab = (over: Partial<TabInfo> = {}): TabInfo => ({
  id: 'table-1',
  name: 'PLO5 1/2',
  stakes: '1/2',
  isMyTurn: false,
  seated: true,
  ...over,
});

const bar = (tabs: TabInfo[]) => (
  <TableTabBar tabs={tabs} activeTabId={tabs[0].id} onTabSelect={() => {}} onAddTable={() => {}} />
);
const openMenu = (tabs: TabInfo[] = [tab()]) => {
  const view = render(bar(tabs));
  fireEvent.click(screen.getByRole('button', { name: 'Table Menu' }));
  return view;
};
const row = (label: string) =>
  Array.from(screen.getByRole('menu').querySelectorAll('button')).find(
    (b) => b.querySelector('.table-menu__action-label')?.textContent === label
  ) as HTMLButtonElement;
const badge = (label: string) =>
  row(label).querySelector('.table-menu__action-badge')?.textContent ?? null;

afterEach(() => {
  cleanup();
  emit.mockClear();
  document.body.innerHTML = '';
});

describe('automatic tournament purchases', () => {
  it('reports both switches and sends table-scoped actions', () => {
    openMenu([tab({ isTournament: true, tournamentAutoRebuy: false, tournamentAutoAddOn: true })]);
    expect(badge('Auto Rebuy')).toBe('OFF');
    expect(badge('Auto Add-On')).toBe('ON');
    fireEvent.click(row('Auto Rebuy'));
    fireEvent.click(row('Auto Add-On'));
    expect(emit).toHaveBeenCalledWith('TABLE_MENU_ACTION', {
      tableId: 'table-1',
      action: 'TOGGLE_AUTO_TOURNAMENT_REBUY',
    });
    expect(emit).toHaveBeenCalledWith('TABLE_MENU_ACTION', {
      tableId: 'table-1',
      action: 'TOGGLE_AUTO_TOURNAMENT_ADD_ON',
    });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('offers only the cash top-up control at a cash table', () => {
    openMenu([tab({ isTournament: false })]);
    expect(row('Auto Top Up')).toBeTruthy();
    expect(row('Auto Rebuy')).toBeUndefined();
    expect(row('Auto Add-On')).toBeUndefined();
  });
});

describe('the Sounds and Vibrations rows', () => {
  it('show the setting the account actually has, not a field nobody reports', () => {
    act(() => setTableSetting('isSoundEnabled', true));
    act(() => setTableSetting('isHapticEnabled', false));
    openMenu();
    expect(badge('Sounds')).toBe('ON');
    expect(badge('Vibrations')).toBe('OFF');
  });

  it('send the press to the table, stay open, and change in front of the player', () => {
    act(() => setTableSetting('isSoundEnabled', false));
    openMenu();
    expect(badge('Sounds')).toBe('OFF');

    /* The owning table page answers TOGGLE_SOUNDS by committing to this store. */
    emit.mockImplementation((type: string, payload: { action?: string }) => {
      if (type === 'TABLE_MENU_ACTION' && payload.action === 'TOGGLE_SOUNDS') {
        setTableSetting('isSoundEnabled', true);
      }
    });
    act(() => {
      fireEvent.click(row('Sounds'));
    });

    expect(emit).toHaveBeenCalledWith('TABLE_MENU_ACTION', {
      tableId: 'table-1',
      action: 'TOGGLE_SOUNDS',
    });
    expect(screen.queryByRole('menu'), 'a switch must not close the menu').not.toBeNull();
    expect(badge('Sounds')).toBe('ON');
  });

  it('take a second press straight away', () => {
    openMenu();
    fireEvent.click(row('Vibrations'));
    fireEvent.click(row('Vibrations'));
    const presses = emit.mock.calls.filter(
      ([type, payload]) => type === 'TABLE_MENU_ACTION' && payload.action === 'TOGGLE_VIBRATIONS'
    );
    expect(presses).toHaveLength(2);
    expect(screen.queryByRole('menu')).not.toBeNull();
  });
});

describe('Stand Up Next Big Blind and Auto Top Up', () => {
  it('say OFF when off and ON when the table page reports them on', () => {
    const view = openMenu([tab()]);
    expect(badge('Stand Up Next Big Blind')).toBe('OFF');
    expect(badge('Auto Top Up')).toBe('OFF');
    view.rerender(bar([tab({ standUpNextBB: true, isAutoRebuyEnabled: true })]));
    expect(badge('Stand Up Next Big Blind')).toBe('ON');
    expect(badge('Auto Top Up')).toBe('ON');
  });

  it('stay open when pressed', () => {
    openMenu();
    fireEvent.click(row('Stand Up Next Big Blind'));
    expect(screen.queryByRole('menu')).not.toBeNull();
  });
});

describe('rows that lived only in a menu no table rendered', () => {
  it('Straddle is offered only at a seat that may straddle, and is a switch', () => {
    const view = openMenu([tab()]);
    expect(row('Straddle')).toBeUndefined();
    view.rerender(bar([tab({ straddleAvailable: true, straddleEnabled: false })]));
    expect(badge('Straddle')).toBe('OFF');
    fireEvent.click(row('Straddle'));
    expect(emit).toHaveBeenCalledWith('TABLE_MENU_ACTION', {
      tableId: 'table-1',
      action: 'TOGGLE_STRADDLE',
    });
    expect(screen.queryByRole('menu')).not.toBeNull();
    view.rerender(bar([tab({ straddleAvailable: true, straddleEnabled: true })]));
    expect(badge('Straddle')).toBe('ON');
  });

  it('Club Marketplace asks the table page to open its club shop', () => {
    openMenu();
    fireEvent.click(row('Club Marketplace'));
    expect(emit).toHaveBeenCalledWith('TABLE_MENU_ACTION', {
      tableId: 'table-1',
      action: 'CLUB_MARKETPLACE',
    });
  });

  it('a tournament seat is offered Rebuy and Add-On, a cash seat Top Up', () => {
    const view = openMenu([tab({ isTournament: true })]);
    expect(row('Rebuy')).toBeDefined();
    expect(row('Top Up')).toBeUndefined();
    fireEvent.click(row('Add-On'));
    expect(emit).toHaveBeenCalledWith('TABLE_MENU_ACTION', {
      tableId: 'table-1',
      action: 'ADD_ON',
    });
    view.unmount();
    openMenu([tab()]);
    expect(row('Top Up')).toBeDefined();
    expect(row('Add-On')).toBeUndefined();
  });

  it('Leave Table Next Hand shows ON while a leave is queued', () => {
    const view = openMenu([tab()]);
    expect(badge('Leave Table Next Hand')).toBeNull();
    view.rerender(bar([tab({ leaveNextHandQueued: true })]));
    expect(badge('Leave Table Next Hand')).toBe('ON');
  });
});

describe('a spectator is offered no seat-only row', () => {
  const SEAT_ROWS = [
    'Sit Out',
    'Stand Up Next Big Blind',
    'Top Up',
    'Auto Top Up',
    'Leave Table Next Hand',
  ];

  it('keeps every row for a seated hero and for a table that has not reported', () => {
    for (const over of [{ heroSeated: true }, {}]) {
      const view = openMenu([tab(over)]);
      for (const label of SEAT_ROWS) expect(row(label), label).toBeDefined();
      view.unmount();
      document.body.innerHTML = '';
    }
  });

  it('drops them, and only them, when the table page reports no seat', () => {
    openMenu([tab({ heroSeated: false, straddleAvailable: true })]);
    for (const label of [...SEAT_ROWS, 'Straddle']) expect(row(label), label).toBeUndefined();
    for (const label of ['Hand History', 'Leaderboard', 'Sounds', 'Game Rules', 'Leave Table']) {
      expect(row(label), label).toBeDefined();
    }
  });
});

describe('Session Stats is the cash ledger', () => {
  it('is offered at a cash table and not at a tournament', () => {
    const view = openMenu([tab()]);
    expect(row('Session Stats')).toBeDefined();
    view.unmount();
    document.body.innerHTML = '';
    openMenu([tab({ isTournament: true })]);
    expect(row('Session Stats')).toBeUndefined();
  });
});

describe('a switch says what it is', () => {
  it('is announced as a checkbox with its state; a destination is a plain item', () => {
    act(() => setTableSetting('isSoundEnabled', true));
    openMenu([tab({ standUpNextBB: true, straddleAvailable: true })]);
    expect(row('Sounds').getAttribute('role')).toBe('menuitemcheckbox');
    expect(row('Sounds').getAttribute('aria-checked')).toBe('true');
    expect(row('Stand Up Next Big Blind').getAttribute('aria-checked')).toBe('true');
    expect(row('Straddle').getAttribute('aria-checked')).toBe('false');
    expect(row('Hand History').getAttribute('role')).toBe('menuitem');
    expect(row('Hand History').hasAttribute('aria-checked')).toBe(false);
  });

  it('Straddle waits while a change is in flight', () => {
    openMenu([tab({ straddleAvailable: true, straddleBusy: true })]);
    expect(row('Straddle').disabled).toBe(true);
    fireEvent.click(row('Straddle'));
    expect(emit).not.toHaveBeenCalledWith('TABLE_MENU_ACTION', {
      tableId: 'table-1',
      action: 'TOGGLE_STRADDLE',
    });
  });
});

describe('a row that opens something still closes the menu', () => {
  it.each([
    ['Hand History', 'HAND_HISTORY'],
    ['Leaderboard', 'LEADERBOARD'],
    ['Table Settings', 'SETTINGS'],
    ['Game Rules', 'HELP'],
  ])('%s', (label, action) => {
    openMenu();
    fireEvent.click(row(label));
    expect(emit).toHaveBeenCalledWith('TABLE_MENU_ACTION', { tableId: 'table-1', action });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('every ON/OFF row is marked as a switch', () => {
  it('in the shared sections', () => {
    const actions = createDefaultMenuSections(
      { onToggleProfitTracking: () => {}, onToggleStraddle: () => {} },
      { soundsBadge: 'OFF', vibrationsBadge: 'OFF', profitTrackingBadge: 'OFF' }
    ).flatMap((s) => s.actions);
    const switches = actions.filter((a) => a.keepOpen).map((a) => a.id);
    expect(switches.sort()).toEqual(
      ['auto-top-up', 'profit-tracking', 'sounds', 'standup-bb', 'straddle', 'vibrations'].sort()
    );
  });
});

describe('the reports the badges depend on', () => {
  const TABLE_PAGE = code('src/pages/TablePage.tsx');
  const MULTI = code('src/pages/MultiTablePage.tsx');
  const BAR = code('src/components/table/TableTabBar.tsx');
  const BUS = code('src/core/MasterBus.ts');

  it('the table page reports Stand Up Next Big Blind and the tab carries it', () => {
    expect(TABLE_PAGE).toMatch(/onTableInfoUpdate\?\.\(\{ standUpNextBB \}\)/);
    expect(MULTI).toMatch(/standUpNextBB: t\.standUpNextBB/);
  });

  it('the bar reads sound and haptics from the gates, never from a tab', () => {
    expect(BAR).toMatch(/const soundOn = useSoundSwitch\(\);/);
    expect(BAR).toMatch(/const vibrationOn = useVibrationSwitch\(\);/);
    expect(BAR).toMatch(/soundsBadge: soundOn \? 'ON' : 'OFF'/);
    expect(BAR).toMatch(/vibrationsBadge: vibrationOn \? 'ON' : 'OFF'/);
    expect(BAR).not.toMatch(/\?\.soundEnabled|\?\.vibrationsEnabled/);
  });

  it('a menu press is never deduplicated and never replayed in another window', () => {
    const list = (name: string) => {
      expect(BUS).toContain(name);
      return sliceBetween(BUS, name, ']');
    };
    expect(list('DEDUP_BYPASS: BusEventType[] = [')).toContain("'TABLE_MENU_ACTION'");
    expect(list('LOCAL_NAVIGATION_EVENTS = new Set<BusEventType>([')).toContain(
      "'TABLE_MENU_ACTION'"
    );
  });
});
