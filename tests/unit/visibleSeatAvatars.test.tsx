import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import SeatSlot, { type SeatPlayer } from '../../src/components/table/SeatSlot';

const player: SeatPlayer = {
  id: 'spectated-opponent',
  name: 'Opponent',
  avatar: '',
  stack: 100,
  status: 'active',
  isHero: false,
  showCards: false,
};
const common = { seatNumber: 2, player, position: null, isActive: false, lastAction: null };
afterEach(cleanup);

describe('avatars on a visible spectator table', () => {
  it('requests an opponent portrait immediately without a hero or viewport change', () => {
    const { container } = render(<SeatSlot {...common} />);
    expect(container.querySelector('.seat__avatar-img')?.getAttribute('loading')).toBe('eager');
  });
  it('revealing a retained background table updates an otherwise memoized seat', () => {
    const view = render(<SeatSlot {...common} avatarLoading="lazy" />);
    expect(view.container.querySelector('.seat__avatar-img')?.getAttribute('loading')).toBe('lazy');
    view.rerender(<SeatSlot {...common} avatarLoading="eager" />);
    expect(view.container.querySelector('.seat__avatar-img')?.getAttribute('loading')).toBe(
      'eager'
    );
  });
  it('keeps the existing hero admission eager even in a retained table', () => {
    const { container } = render(
      <SeatSlot {...common} player={{ ...player, isHero: true }} avatarLoading="lazy" />
    );
    expect(container.querySelector('.seat__avatar-img')?.getAttribute('loading')).toBe('eager');
  });
});
