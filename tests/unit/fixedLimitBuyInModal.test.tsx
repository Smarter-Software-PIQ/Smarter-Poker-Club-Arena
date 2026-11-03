import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BuyInModal from '../../src/components/table/BuyInModal';
const base = {
  isOpen: true,
  onClose: () => {},
  onConfirm: async () => {},
  tableName: 'Limit Table',
  minBuyIn: 80,
  maxBuyIn: 400,
  bigBlind: 2,
};
describe('fixed-limit purchase amount', () => {
  it.each(['flh', 'flo8'])('offers the wallet above the former table cap for %s', (gameType) => {
    render(<BuyInModal {...base} gameType={gameType} accountBalance={5000} />);
    expect(screen.getByRole('slider', { name: 'Buy-In Amount' }).getAttribute('max')).toBe('5000');
    expect(screen.getByText('Available')).toBeTruthy();
  });
  it('keeps an unknown wallet unconfirmed', () => {
    render(<BuyInModal {...base} gameType="flh" accountBalance={null} />);
    expect(screen.getByText('Balance Unavailable').closest('button')?.disabled).toBe(true);
  });
});

it.each(['flh', 'flo8'])('does not offer an unpriced %s buy-in with a known wallet', (gameType) => {
  render(
    <BuyInModal
      {...base}
      gameType={gameType}
      minBuyIn={0}
      maxBuyIn={0}
      bigBlind={0}
      accountBalance={5000}
    />
  );
  expect(screen.getByText('Buy-In Unavailable').closest('button')?.disabled).toBe(true);
});
