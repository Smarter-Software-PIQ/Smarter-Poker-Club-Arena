import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import SeatSlot, { type SeatPlayer } from '../../src/components/table/SeatSlot';
import { lightningSeatKey } from '../../src/lightning/lightningSeatKey';
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
afterEach(cleanup);
const hero: SeatPlayer = {
  id: 'hero',
  name: 'Hero',
  avatar: '/avatars/table/free_king.webp',
  isHero: true,
  status: 'active',
  stack: 100,
  holeCards: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
  ],
};
const opponent: SeatPlayer = { ...hero, id: 'other', name: 'Other', isHero: false };
function Felt({ seat }: { seat: number }) {
  return (
    <>
      {[1, 2, 3].map((n) => (
        <div key={lightningSeatKey(true, n, seat)} data-seat-wrapper={n}>
          <SeatSlot
            seatNumber={n}
            player={n === seat ? hero : opponent}
            position={null}
            isActive={false}
            lastAction={null}
          />
        </div>
      ))}
    </>
  );
}
it('keeps the same hero portrait and card DOM through successive physical seat assignments', () => {
  const { container, rerender } = render(<Felt seat={1} />);
  const portrait = container.querySelector('[data-seat-wrapper="1"] .seat__avatar-img');
  const card = container.querySelector('[data-seat-wrapper="1"] .seat__card');
  expect(portrait).not.toBeNull();
  expect(card).not.toBeNull();
  for (const seat of [3, 2, 1]) {
    rerender(<Felt seat={seat} />);
    expect(container.querySelector(`[data-seat-wrapper="${seat}"] .seat__avatar-img`)).toBe(
      portrait
    );
    expect(container.querySelector(`[data-seat-wrapper="${seat}"] .seat__card`)).toBe(card);
  }
});
it('preserves physical keys outside Lightning and wires the stable identity into the live felt', () => {
  expect(lightningSeatKey(false, 2, 2)).toBe(2);
  expect(lightningSeatKey(true, 2, 0)).toBe(2);
  expect(readFileSync('src/pages/TablePage.tsx', 'utf8')).toContain(
    'key={lightningSeatKey(!!lightningRoom, seatNumber, tableState.heroSeat)}'
  );
});
