/**
 * The buy-in sheet says why its minimum is higher (Dan 2026-11-14): "I think
 * the issue is that he is trying to buy in for less than he left the table
 * with. And if so, it should say that specifically."
 *
 * `cashoutRestriction` reaches the sheet only when the server answered that
 * the rejoin floor is what raised the minimum, and that floor is the stack
 * the player left this game with.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BuyInModal from '../../src/components/table/BuyInModal';

const base = {
  isOpen: true,
  onClose: () => {},
  onConfirm: async () => {},
  tableName: 'PLO 0.25/0.50',
  minBuyIn: 25,
  maxBuyIn: 100,
  bigBlind: 0.5,
  accountBalance: 500,
};

describe('the buy-in sheet names the rejoin floor', () => {
  it('says what the player left with and that it is now the minimum', () => {
    render(<BuyInModal {...base} minBuyIn={63.4} cashoutRestriction={63.4} />);
    const line = screen.getByTestId('buy-in-rejoin-floor');
    expect(line.textContent?.replace(/\s+/g, ' ')).toMatch(
      /^You Left This Game With \D*63\.40?\D*\. Your Minimum Buy In Is \D*63\.40?\D*\.$/
    );
    expect(line.textContent).not.toMatch(/rathole|hit[ -]and[ -]run/i);
  });

  it('says nothing when no floor applies', () => {
    render(<BuyInModal {...base} />);
    expect(screen.queryByTestId('buy-in-rejoin-floor')).toBeNull();
  });

  it('gives way to an unresolved original buy-in, which has its own sentence', () => {
    render(
      <BuyInModal
        {...base}
        minBuyIn={63.4}
        cashoutRestriction={63.4}
        recovery={{ amount: 25, seat: 5 }}
      />
    );
    expect(screen.queryByTestId('buy-in-rejoin-floor')).toBeNull();
  });
});
