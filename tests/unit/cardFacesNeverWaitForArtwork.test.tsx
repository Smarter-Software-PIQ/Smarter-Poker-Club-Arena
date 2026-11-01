import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { CommunityCards } from '../../src/components/table/CommunityCards';
import { CardImage, type Card } from '../../src/components/table/CardImage';

vi.mock('../../src/hooks/useDeckStyle', () => ({ useDeckStyle: () => '4color' }));

function face(container: HTMLElement) {
  const fallback = container.querySelector<HTMLElement>('.card-image__fallback');
  expect(fallback, 'a known card must be readable before any image event').not.toBeNull();
  return fallback!;
}

describe('known card faces never wait for artwork', () => {
  it('requests every static board face eagerly after mount or reconnect', () => {
    const { container } = render(
      <CommunityCards
        cards={[
          { rank: 'Q', suit: 'c' },
          { rank: '7', suit: 'c' },
          { rank: '3', suit: 'h' },
        ]}
        stage="flop"
        playSounds={false}
      />
    );
    const images = container.querySelectorAll('.card-image__img');
    expect(images).toHaveLength(3);
    for (const image of images) expect(image).toHaveAttribute('loading', 'eager');
    expect(container.querySelectorAll('.card-image__fallback')).toHaveLength(3);
  });

  it('paints the actual rank and suit while the request is pending', () => {
    const { container } = render(<CardImage card={{ rank: '7', suit: 'c' }} loading="eager" />);
    expect(face(container)).toHaveTextContent('7♣');
    expect(face(container)).toHaveStyle({ color: '#22c55e', background: '#fff' });
  });

  it('keeps the same face under successful artwork and both failure steps', () => {
    const { container } = render(<CardImage card={{ rank: 'Q', suit: 'd' }} />);
    const image = container.querySelector('img')!;
    fireEvent.load(image);
    expect(face(container)).toHaveTextContent('Q♦');
    fireEvent.error(image);
    expect(image.src).toMatch(/diamonds_q\.png$/);
    expect(face(container)).toHaveTextContent('Q♦');
    fireEvent.error(image);
    expect(image).toHaveStyle({ display: 'none' });
    expect(face(container)).toHaveTextContent('Q♦');
  });

  it('changes the readable face immediately when the slot is reused', () => {
    const { container, rerender } = render(<CardImage card={{ rank: 'A', suit: 's' }} />);
    fireEvent.error(container.querySelector('img')!);
    fireEvent.error(container.querySelector('img')!);
    rerender(<CardImage card={{ rank: '8', suit: 'h' }} deckStyle="2color" />);
    expect(face(container)).toHaveTextContent('8♥');
    expect(container.querySelector('img')!.src).toMatch(/2color\/hearts_8.webp$/);
    expect(face(container)).not.toHaveTextContent('A');
  });

  it('honors two-color clubs and never guesses an invalid card', () => {
    const { container, rerender } = render(
      <CardImage card={{ rank: 'T', suit: 'c' }} deckStyle="2color" />
    );
    expect(face(container)).toHaveStyle({ color: '#1e293b' });
    rerender(<CardImage card={{ rank: '?', suit: 'c' } as Card} />);
    expect(container.querySelector('.card-image__fallback')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[aria-label="Card Could Not Be Read"]')).not.toBeNull();
  });
});
