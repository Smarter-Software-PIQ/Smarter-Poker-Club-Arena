import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerCashStats } from '../../src/components/table/PlayerCashStats';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../src/core/MasterBus', () => ({ masterBus: { subscribe: () => () => {} } }));

afterEach(cleanup);

it('keeps each cash game in its own labeled card and preserves missing values', async () => {
  rpc.mockResolvedValue({
    data: [
      {
        tableId: 'a',
        table: 'PLO5 Madness',
        unit: 'chips',
        boughtIn: 2814.3,
        net: -2346.8,
        hands: 182,
        vpip: 83.5,
        pfr: 48.4,
      },
      {
        tableId: 'b',
        table: 'NLH Classic',
        unit: 'diamonds',
        boughtIn: null,
        net: null,
        hands: 0,
        vpip: null,
        pfr: null,
      },
    ],
  });
  render(<PlayerCashStats tableId="a" playerId="player" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Player Stats' }));
  const [cash, diamonds] = screen.getAllByRole('article').map((card) => within(card));
  expect(cash.getByRole('heading').textContent).toBe('PLO5 Madness');
  expect(cash.getAllByRole('term').map((term) => term.textContent)).toEqual([
    'Bought In',
    'Hands Played',
    'VPIP',
    'PFR',
  ]);
  expect(cash.getAllByRole('definition').map((value) => value.textContent)).toEqual([
    '2,814.30',
    '182',
    '83.5%',
    '48.4%',
  ]);
  expect(cash.getByText('-2,346.80')).toBeTruthy();
  expect(cash.getByText('Chips')).toBeTruthy();
  expect(diamonds.getByText('Diamonds')).toBeTruthy();
  expect(diamonds.getByText('Pending')).toBeTruthy();
  expect(diamonds.getByText('Unavailable')).toBeTruthy();
  expect(diamonds.getAllByText('N/A')).toHaveLength(2);
});
