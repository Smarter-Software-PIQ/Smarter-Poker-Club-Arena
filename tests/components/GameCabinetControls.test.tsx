import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PageHelp from '../../src/components/help/PageHelp';
import { GameConsole, bonusPrizeBay } from '../../src/components/games/GameConsole';
import { PlinkoDropSelector } from '../../src/components/games/BonusSetup';

afterEach(cleanup);

it('keeps a pending cabinet action focused and refuses its duplicate press', () => {
  const play = vi.fn();
  const { rerender } = render(
    <GameConsole
      game="crossing"
      title="Donkey Cross"
      bays={[]}
      primary={{ label: 'Cross Street', onClick: play }}
    />
  );
  const cross = screen.getByRole('button', { name: 'Cross Street' });
  cross.focus();
  rerender(
    <GameConsole
      game="crossing"
      title="Donkey Cross"
      bays={[]}
      primary={{ label: 'Cross Street', onClick: play, 'aria-disabled': true }}
    />
  );
  expect(cross).toHaveFocus();
  fireEvent.click(cross);
  expect(play).not.toHaveBeenCalled();
});

it('uses the Mines central face for its real cashout action when a tile is open', () => {
  const cashout = vi.fn();
  render(
    <GameConsole
      game="mines"
      title="Diamond Mines"
      bays={[]}
      secondary={{ label: 'Book The Win', onClick: cashout }}
    />
  );
  const book = screen.getByRole('button', { name: 'Book The Win' });
  expect(book).toHaveAttribute('data-plate', 'primary');
  fireEvent.click(book);
  expect(cashout).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Select A Diamond' })).toBeNull();
});

it('keeps Plinko pagination and selected denominations inert while a release is pending', () => {
  const change = vi.fn();
  const budget = { base: 100, doubled: false, denomination: null };
  const { rerender } = render(
    <PlinkoDropSelector budget={budget} onChange={change} disabled={false} docked sculpted />
  );
  const first = screen.getByRole('button', { name: '1 Diamond Per Drop, 100 Drops' });
  fireEvent.click(screen.getByRole('button', { name: 'Next Denominations' }));
  expect(screen.queryByRole('button', { name: '1 Diamond Per Drop, 100 Drops' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Previous Denominations' }));
  fireEvent.click(screen.getByRole('button', { name: first.getAttribute('aria-label')! }));
  expect(change).toHaveBeenCalledWith({ ...budget, denomination: 1 });
  rerender(<PlinkoDropSelector budget={budget} onChange={change} disabled docked sculpted />);
  expect(screen.getByRole('button', { name: 'Next Denominations' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '1 Diamond Per Drop, 100 Drops' })).toBeDisabled();
});

it('keeps entry and proof available through help without a second footer surface', () => {
  const { container } = render(
    <GameConsole
      game="mines"
      title="Diamond Mines"
      collapseSetup
      setup={
        <label>
          Entry Diamonds
          <input defaultValue="1000" />
        </label>
      }
      bays={[]}
      help={
        <PageHelp title="Diamond Mines">
          <button>Verify Saved Round</button>
        </PageHelp>
      }
    />
  );
  expect(container.querySelector('aside')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Verify Saved Round' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Page Help' }));
  expect(screen.getByRole('button', { name: 'Verify Saved Round' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Entry Diamonds'), { target: { value: '2500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close Help' }));
  fireEvent.click(screen.getByRole('button', { name: 'Page Help' }));
  expect(screen.getByLabelText('Entry Diamonds')).toHaveValue('2500');
});

it('prints the original funded entry until the exact posted receipt replaces it', () => {
  expect(bonusPrizeBay(30, null, true, 1000)).toMatchObject({
    label: 'Entry',
    value: '1,000 Diamonds',
  });
  expect(bonusPrizeBay(30, 43.21, true, 1000)).toMatchObject({
    label: 'Paid',
    value: '43.21 Chips',
  });
});
