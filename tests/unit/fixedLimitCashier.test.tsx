import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CashierModal } from '../../src/components/table/CashierModal';
import { GameRulesModal } from '../../src/components/table/GameRulesModal';
const base = {
  isOpen: true,
  onClose: vi.fn(),
  onAddChips: vi.fn(),
  currentStack: 1200,
  accountBalance: 500,
  maxBuyIn: 0,
  maxStack: 0,
};
describe('uncapped fixed-limit add chips', () => {
  it('offers the known wallet above the existing stack through the actual cashier', () => {
    render(<CashierModal {...base} unlimitedStack />);
    fireEvent.click(screen.getByText('MAX'));
    expect(screen.getByRole('button', { name: 'Add 500' })).toBeEnabled();
    expect(document.body.textContent).not.toContain('Your Stack Is At The Table Maximum');
  });
  it.each([{ accountBalance: null }, { currentStackPending: true }, { currentStack: Number.NaN }])(
    'does not spend with unresolved wallet or stack: %j',
    (patch) => {
      render(<CashierModal {...base} {...patch} unlimitedStack />);
      expect(screen.getByText('MAX').closest('button')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Add 500' })).toBeNull();
    }
  );
  it('preserves finite NLH/PLO headroom', () => {
    render(<CashierModal {...base} currentStack={350} maxBuyIn={400} maxStack={400} />);
    fireEvent.click(screen.getByText('MAX'));
    expect(screen.getByRole('button', { name: 'Add 50' })).toBeEnabled();
  });
  it('prints no maximum in the actual cash-game rules', () => {
    render(
      <GameRulesModal
        isOpen
        onClose={() => {}}
        variant="flh"
        stakes="2/4"
        minBuyIn={80}
        maxBuyIn={0}
        isCashTable
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Table Info' }));
    expect(screen.getByText('No Maximum')).toBeTruthy();
  });
});
