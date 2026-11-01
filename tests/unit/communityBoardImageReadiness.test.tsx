import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommunityCards } from '../../src/components/table/CommunityCards';

describe('a retained community board does not defer its face images', () => {
  it('requests every static flop face eagerly even while its table is hidden', () => {
    const html = renderToStaticMarkup(
      <CommunityCards
        cards={[
          { rank: 'A', suit: 'spades' },
          { rank: '7', suit: 'hearts' },
          { rank: '3', suit: 'clubs' },
        ]}
        stage="flop"
        isVisible={false}
        playSounds={false}
      />
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    const faces = host.querySelectorAll<HTMLImageElement>('img.card-image__img');
    expect(faces).toHaveLength(3);
    for (const face of faces) {
      expect(face.getAttribute('loading')).toBe('eager');
      expect(face.getAttribute('src')).toBeTruthy();
    }
  });
});
