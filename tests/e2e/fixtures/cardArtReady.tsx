import React, { useState, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CardImage, type Card } from '../../../src/components/table/CardImage';
import { useDeckImages } from '../../../src/hooks/useDeckImages';
import { useTableArt } from '../../../src/hooks/useTableArt';

// Seats/boards stay mounted and memoized underneath the real table's art cover.
const Cards = memo(
  ({
    style,
    hand,
    loading,
  }: {
    style: '4color' | '2color';
    hand: number;
    loading: 'eager' | 'lazy';
  }) => (
    <div key={hand} style={{ display: 'flex', gap: 4 }}>
      {['A', 'K', 'Q', 'J', 'T', '9', '8'].map((rank, i) => (
        <div key={i} className={i < 5 ? 'community-cards__card' : 'seat'}>
          <div className={i < 5 ? undefined : 'seat__card seat__card--face'}>
            <CardImage
              card={{ rank, suit: ['h', 'd', 'c', 's'][i % 4] } as Card}
              loading={loading}
              deckStyle={style}
            />
          </div>
        </div>
      ))}
    </div>
  )
);
function Table() {
  const [style, setStyle] = useState<'4color' | '2color'>('4color');
  const [hand, setHand] = useState(0);
  const [loading, setLoading] = useState<'eager' | 'lazy'>('eager');
  const ready = useDeckImages(style);
  const art = useTableArt('', '', true, 'test', ready);
  Object.assign(window, {
    nextHand: () => flushSync(() => setHand((h) => h + 1)),
    setCardLoading: (value: 'eager' | 'lazy') => flushSync(() => setLoading(value)),
    changeDeck: () => flushSync(() => setStyle('2color')),
  });
  return (
    <div className="table-page" data-ready={String(art.reveal)} style={{ position: 'relative' }}>
      <span className="header-hand-number">Hand #{hand + 1}</span>
      {!art.reveal && (
        <div
          className="table-art-cover"
          style={{ position: 'absolute', inset: 0, background: 'black', zIndex: 10 }}
        >
          Preparing Table
        </div>
      )}
      <Cards style={style} hand={hand} loading={loading} />
    </div>
  );
}
history.replaceState({}, '', '/hub/club-arena/table/fixture');
createRoot(document.getElementById('root')!).render(<Table />);
