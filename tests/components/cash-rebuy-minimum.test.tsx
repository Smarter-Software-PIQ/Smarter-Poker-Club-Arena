import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CashierModal } from '../../src/components/table/CashierModal';
afterEach(cleanup);
const base = {
  isOpen: true,
  onClose: vi.fn(),
  onAddChips: vi.fn(),
  currentStack: 0,
  accountBalance: 44,
  minBuyIn: 80,
  maxBuyIn: 400,
  maxStack: 400,
};
describe('a felted cash player must fund a full rebuy', () => {
  it('denies the 44-chip short buy on a 1/2 Madness table and explains the 80 minimum', () => {
    render(<CashierModal {...base} />);
    fireEvent.click(screen.getByText('MAX'));
    expect(screen.getByRole('button', { name: 'Add 44' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/Insufficient Chips.*Minimum Rebuy: 80/);
    expect(base.onAddChips).not.toHaveBeenCalled();
  });
  it('allows exactly 40BB and refuses one cent below', () => {
    render(<CashierModal {...base} accountBalance={100} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '79.99' } });
    expect(screen.getByRole('button', { name: 'Add 79.99' })).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '80' } });
    expect(screen.getByRole('button', { name: 'Add 80' })).toBeEnabled();
  });
  it('preserves a legitimate small top-up for a player who still has chips', () => {
    render(<CashierModal {...base} currentStack={20} />);
    fireEvent.click(screen.getByText('MAX'));
    expect(screen.getByRole('button', { name: 'Add 44' })).toBeEnabled();
  });
});
