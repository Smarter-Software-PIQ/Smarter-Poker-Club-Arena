import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Keep passive work pending at the browser's paint boundary. Ordinary act()
// drains it before assertions and concealed the face -> back -> face commit.
const pending = vi.hoisted(() => [] as Array<() => void>);
vi.mock('react', async (load) => {
  const real = await load<typeof import('react')>();
  return {
    ...real,
    useEffect: (effect: React.EffectCallback, dependencies?: React.DependencyList) => {
      real.useEffect(() => {
        let alive = true;
        let dispose: ReturnType<React.EffectCallback>;
        pending.push(() => {
          if (alive) dispose = effect();
        });
        return () => {
          alive = false;
          dispose?.();
        };
      }, dependencies);
    },
  };
});
vi.mock('../../src/services/SoundService', () => {
  const silent = new Proxy({}, { get: () => () => undefined });
  return { soundService: silent, haptic: silent, default: silent };
});
import { CommunityCards } from '../../src/components/table/CommunityCards';
import { cardPresentationEngine } from '../../src/presentation/cardPresentation';

const cards = [
  { rank: '4', suit: 'd' },
  { rank: '7', suit: 's' },
  { rank: 'A', suit: 's' },
  { rank: 'T', suit: 'd' },
  { rank: '7', suit: 'c' },
] as const;
let hand = 0;
const board = (count: number) => (
  <CommunityCards
    tableId="prepaint-board"
    handId={hand}
    cards={cards.slice(0, count)}
    stage={count === 3 ? 'flop' : count === 4 ? 'turn' : 'river'}
  />
);
const flushPassive = () =>
  act(() => {
    while (pending.length) pending.shift()!();
  });

beforeEach(() => {
  vi.useFakeTimers();
  hand++;
  cardPresentationEngine.forgetTable('prepaint-board');
});
afterEach(() => {
  cleanup();
  pending.length = 0;
  vi.useRealTimers();
});

it.each([4, 5])(
  'street %i is already a face-down two-surface reveal before passive effects',
  (count) => {
    const view = render(board(count - 1));
    flushPassive();
    act(() => vi.advanceTimersByTime(2500));
    view.rerender(board(count));
    // The existing cards remain static; only the newly admitted street squeezes.
    const slots = view.container.querySelectorAll('.community-cards__card');
    const incoming = slots[count - 1];
    expect(incoming.querySelector('.card-squeeze__face--back')).not.toBeNull();
    expect(incoming.querySelector('.card-squeeze__face--front')).not.toBeNull();
    expect(incoming.classList.contains('card-squeeze-host')).toBe(true);
    expect(view.container.querySelectorAll('.card-squeeze-host')).toHaveLength(1);
    flushPassive();
    act(() => vi.advanceTimersByTime(2500));
    expect(view.container.querySelector('.card-squeeze')).toBeNull();
    expect(view.container.querySelectorAll('.community-cards__card')).toHaveLength(count);
  }
);

it('a full board mounted after reconnect stays static before passive effects', () => {
  const view = render(board(5));
  expect(view.container.querySelectorAll('.community-cards__card')).toHaveLength(5);
  expect(view.container.querySelector('.card-squeeze')).toBeNull();
});
