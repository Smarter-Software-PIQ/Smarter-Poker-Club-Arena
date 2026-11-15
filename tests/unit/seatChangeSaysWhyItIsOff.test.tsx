/**
 * SEAT CHANGE SAYS WHY IT IS OFF (2026-11-15).
 *
 * A Lightning game withholds seat change on purpose (#10818). The row used to
 * vanish there, so it was in the menu at one table and gone at the next, which
 * reads as a bug and broke the post-deploy live-table proof on every publish
 * that happened to land on a Lightning game. It now stays, disabled, naming
 * Lightning. While the table's mode is still loading it stays hidden: that is
 * not yet an answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));

import { TableTabBar, type TabInfo } from '../../src/components/table/TableTabBar';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const tab = (over: Partial<TabInfo> = {}): TabInfo => ({
  id: 'table-1',
  name: 'PLO4 1/2',
  stakes: '1/2',
  isMyTurn: false,
  seated: true,
  ...over,
});

const open = (over: Partial<TabInfo>) => {
  render(
    <TableTabBar
      tabs={[tab(over)]}
      activeTabId="table-1"
      onTabSelect={() => {}}
      onAddTable={() => {}}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Table Menu' }));
  return screen.getByRole('menu');
};

describe('the Seat Change row', () => {
  it('is a switch at a Classic table', () => {
    open({ seatChangeEnabled: true });
    const row = screen.getByRole('menuitemcheckbox', { name: /^Seat Change/ });
    expect(row.hasAttribute('disabled')).toBe(false);
  });

  it('is a disabled row naming Lightning at a Lightning table', () => {
    open({ seatChangeEnabled: false, seatChangeOffInLightning: true });
    expect(screen.queryByRole('menuitemcheckbox', { name: /^Seat Change/ })).toBeNull();
    const row = screen.getByRole('menuitem', { name: 'Seat Change Off In Lightning' });
    expect(row.hasAttribute('disabled')).toBe(true);
    fireEvent.click(row);
    expect(screen.getByRole('menu'), 'pressing a disabled row closes nothing').toBeTruthy();
  });

  it('is hidden while the table has not said which it is', () => {
    const menu = open({ seatChangeEnabled: false });
    expect(menu.textContent).not.toContain('Seat Change');
  });
});
