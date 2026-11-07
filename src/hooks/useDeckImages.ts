import { useEffect, useState } from 'react';
import { isDeckReady, prepareDeckImages } from '../utils/deckWarmer';

/** A deck change starts its own load; completion of an older deck cannot release it. */
export function useDeckImages(style: '4color' | '2color'): boolean {
  const [loaded, setLoaded] = useState<string | null>(() => (isDeckReady(style) ? style : null));
  useEffect(() => {
    let active = true;
    void prepareDeckImages(style)
      .then(() => {
        if (active) setLoaded(style);
      })
      .catch(() => {
        // The table's existing bounded cover still permits access to a live turn.
        // CardImage retains its accurate error face if both artwork formats fail.
      });
    return () => {
      active = false;
    };
  }, [style]);
  return loaded === style || isDeckReady(style);
}
