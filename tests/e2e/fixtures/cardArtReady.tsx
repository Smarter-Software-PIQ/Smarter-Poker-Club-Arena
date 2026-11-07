import React, { useState, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { CardImage, type Card } from '../../../src/components/table/CardImage';
import { useDeckImages } from '../../../src/hooks/useDeckImages';
import { isTableImageDecoded, useTableArt } from '../../../src/hooks/useTableArt';
import { deckImageUrls, decodedCardImageUrl, isDeckReady } from '../../../src/utils/deckWarmer';

// Seats/boards stay mounted and memoized underneath the real table's art cover.
const Cards = memo(({ style, hand }: { style: '4color' | '2color'; hand: number }) => (
  <div key={hand} style={{ display: 'flex', gap: 4 }}>
    {['A', 'K', 'Q', 'J', 'T', '9', '8'].map((rank, i) => (
      <div key={i} className={i < 5 ? 'community-cards__card' : 'seat'}>
        <div className={i < 5 ? undefined : 'seat__card seat__card--face'}>
          <CardImage
            card={{ rank, suit: ['h', 'd', 'c', 's'][i % 4] } as Card}
            loading="eager"
            deckStyle={style}
          />
        </div>
      </div>
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
    // WHAT data-ready IS STILL WAITING ON (2026-11-07). data-ready is
    // useTableArt().reveal: the deck decoded (useDeckImages), the felt and
    // room decoded (both '' here), or the cover's TABLE_ART_MAX_COVER_MS
    // expiry. A spec that times out on it learned nothing; this names the
    // pending half, read from the same caches the hooks read.
    cardArtReadiness: () => {
      const urls = deckImageUrls(style);
      const pendingUrls = urls.filter((url) => decodedCardImageUrl(url) === url);
      return {
        reveal: art.reveal,
        artReady: art.ready,
        deckStyle: style,
        deckReady: isDeckReady(style),
        deckDecoded: urls.length - pendingUrls.length,
        deckTotal: urls.length,
        deckPending: pendingUrls.slice(0, 8),
        feltDecoded: isTableImageDecoded(''),
        hand: hand + 1,
      };
    },
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
      <Cards style={style} hand={hand} />
    </div>
  );
}
history.replaceState({}, '', '/hub/club-arena/table/fixture');
createRoot(document.getElementById('root')!).render(<Table />);
