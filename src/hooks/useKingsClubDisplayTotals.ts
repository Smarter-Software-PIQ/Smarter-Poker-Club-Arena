import { useEffect, useState } from 'react';
import {
  readKingsClubDisplayTotals,
  type KingsClubDisplayTotals,
} from '../services/KingsClubDisplayService';

export function useKingsClubDisplayTotals(enabled: boolean): KingsClubDisplayTotals | null {
  const [totals, setTotals] = useState<KingsClubDisplayTotals | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void readKingsClubDisplayTotals().then((result) => {
      if (current) setTotals(result);
    });
    return () => {
      current = false;
    };
  }, [enabled]);

  return enabled ? totals : null;
}
