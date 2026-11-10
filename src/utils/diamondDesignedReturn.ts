import type { DiamondGame } from '../services/DiamondGamesService';
import { crashFlightReach } from './diamondGamesFairness';

/** Historical table target when the operator response has no active table. */
export const DESIGNED_RETURN = 0.8;
/** Reference only: banking at 2.50× succeeds on every contract-6 flight.
 * Operators see realized payouts because other cash-out targets have different returns. */
export const CRASH_DESIGNED_RETURN = 2.5 * crashFlightReach(250);

/**
 * What the game is built to return: the live Plinko table's own figure when
 * there is one, the house spec otherwise. Realised return only means something
 * next to it, so the console prints the two side by side.
 */
export function designedReturn(
  game: DiamondGame,
  tables: ReadonlyArray<{ spec_rtp: number | null; activated_at: string | null }> | undefined
): number {
  if (game === 'crash') return CRASH_DESIGNED_RETURN;
  if (game === 'plinko') {
    // The table activated last is the one the board is dropping on now.
    let live: { spec_rtp: number | null; activated_at: string | null } | null = null;
    for (const t of tables ?? []) {
      if (!t.activated_at || t.spec_rtp === null) continue;
      if (!live || (live.activated_at ?? '') < t.activated_at) live = t;
    }
    if (live?.spec_rtp != null) return live.spec_rtp;
  }
  return DESIGNED_RETURN;
}
