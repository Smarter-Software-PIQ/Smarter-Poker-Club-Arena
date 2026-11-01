import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CommunityCards } from '../../src/components/table/CommunityCards';
import { cardPresentationEngine } from '../../src/presentation/cardPresentation';

vi.mock('../../src/hooks/useDeckStyle', () => ({ useDeckStyle: () => '4color' }));
vi.mock('../../src/services/SoundService', () => ({
  soundService: { isEnabled: () => false, playCommunityCard: vi.fn() },
  haptic: { light: vi.fn(), medium: vi.fn(), strong: vi.fn() },
}));
afterEach(() => {
  cleanup();
  cardPresentationEngine.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const cards = [
  { rank: '2', suit: 'h' },
  { rank: '2', suit: 'd' },
  { rank: 'T', suit: 'h' },
  { rank: '3', suit: 'c' },
  { rank: '4', suit: 'c' },
] as any;
it.each(['duplicate', 'stale', 'instant'] as const)(
  'releases prior-street equity immediately when the next card is rendered statically (%s)',
  (status) => {
    vi.useFakeTimers();
    const hold = vi.fn();
    const props = {
      tableId: 'equity-reveal-' + status,
      handId: 177,
      slowReveal: true,
      squeezeEligible: true,
      playSounds: false,
      onSqueezeHold: hold,
    };
    const view = render(<CommunityCards {...props} cards={cards.slice(0, 3)} stage="flop" />);
    view.rerender(<CommunityCards {...props} cards={cards.slice(0, 4)} stage="turn" />);
    expect(hold).toHaveBeenLastCalledWith(true);
    const present = vi.spyOn(cardPresentationEngine, 'presentCard');
    const profile = cardPresentationEngine.presentCard(
      {
        tableId: 'profile-only',
        handId: 1,
        boardIndex: 0,
        street: 'river',
        slotIndex: 4,
        sequence: 5,
      },
      {
        mode: 'cash',
        platform: 'desktop',
        focus: 'hidden',
        reducedMotion: false,
        allIn: true,
        squeeze: true,
      }
    ).profile;
    present.mockReturnValueOnce({ status, key: 'already-rendered-river', profile, durationMs: 0 });
    view.rerender(<CommunityCards {...props} cards={cards} stage="river" />);
    expect(
      view.container.querySelector('.community-cards__card--river.card-squeeze-host')
    ).toBeNull();
    expect(hold).toHaveBeenLastCalledWith(false);
  }
);

it('cancels the previous interactive card when a newer street is presented instantly', () => {
  vi.useFakeTimers();
  const input = {
    mode: 'cash',
    platform: 'desktop',
    focus: 'focused',
    reducedMotion: false,
    allIn: true,
    squeeze: true,
  } as const;
  const turn = cardPresentationEngine.presentCard(
    {
      tableId: 'equity-static-lane',
      handId: 178,
      boardIndex: 0,
      street: 'turn',
      slotIndex: 3,
      sequence: 4,
    },
    input
  );
  expect(turn.status).toBe('started');
  const river = cardPresentationEngine.presentCard(
    {
      tableId: 'equity-static-lane',
      handId: 178,
      boardIndex: 0,
      street: 'river',
      slotIndex: 4,
      sequence: 5,
    },
    { ...input, focus: 'hidden' }
  );
  expect(river.status).toBe('instant');
  expect(cardPresentationEngine.isActive(turn.key)).toBe(false);
});
