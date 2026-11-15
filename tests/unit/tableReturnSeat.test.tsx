import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TableTabBar from '../../src/components/table/TableTabBar';
vi.mock('../../src/hooks/useButtonImage', () => ({ useButtonImage: () => '/test-icon.webp' }));
afterEach(cleanup);
it('the selected table quick menu offers a direct Sit Down navigation', () => {
  const select = vi.fn();
  render(
    <TableTabBar
      tabs={[{ id: 'table', name: 'PLO4', stakes: '1/2', isMyTurn: false }]}
      activeTabId="table"
      onTabSelect={select}
      onAddTable={() => {}}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'PLO4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sit Down' }));
  expect(select).toHaveBeenCalledExactlyOnceWith('table');
  expect(screen.queryByRole('menu')).toBeNull();
});
