import React, { useState, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { CardImage, type Card } from '../../../src/components/table/CardImage';
import { useDeckImages } from '../../../src/hooks/useDeckImages';
import { useTableArt } from '../../../src/hooks/useTableArt';

// Seats/boards stay mounted and memoized underneath the real table's art cover.
const Cards = memo(({ style, hand }: { style: '4color' | '2color'; hand: number }) => (
  <div key={hand}>
    {['A', 'K', 'Q', 'J', 'T', '9', '8'].map((rank, i) => (
      <CardImage
        key={i}
        card={{ rank, suit: ['h', 'd', 'c', 's'][i % 4] } as Card}
        loading="eager"
        deckStyle={style}
      />
    ))}
  </div>
));
function Table() {
  const [style, setStyle] = useState<'4color' | '2color'>('4color');
  const [hand, setHand] = useState(0);
  const ready = useDeckImages(style);
  const art = useTableArt('', '', true, 'test', ready);
  Object.assign(window, {
    nextHand: () => setHand((h) => h + 1),
    changeDeck: () => setStyle('2color'),
  });
  return (
    <div data-ready={String(art.reveal)}>
      <Cards style={style} hand={hand} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Table />);
