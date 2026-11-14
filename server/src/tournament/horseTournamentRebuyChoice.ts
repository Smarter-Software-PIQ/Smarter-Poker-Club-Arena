import { createHash } from 'node:crypto';
import { isMidwayFreeBuy } from './midwayFreeBuyPolicy.js';
import { guaranteeShortNow } from '../services/horseOverlayCover.js';

/** Share of eligible tournament busts on which a horse buys back in.
 *
 * Owner rule, 2026-10-29: horses rebuy on 70% of eligible busts before
 * the rebuy period ends. This supersedes the 75% share from 2026-10-24.
 */
export const HORSE_TOURNAMENT_REBUY_SHARE = 0.7;

/** Owner rule, 2026-11-04: in the Midway Union's daily Free Buys horses rebuy
 * on 90% of eligible busts inside the window. Every other tournament keeps
 * the 2026-10-29 share above. */
export const MIDWAY_FREE_BUY_HORSE_REBUY_SHARE = 0.9;

/** The share that applies to a tournament row (the manager's cached row). */
export function horseTournamentRebuyShareFor(
  row: Record<string, unknown> | null | undefined
): number {
  /* Owner 2026-11-13: while an event's guarantee is not covered, every
     eligible bust buys back in. The rebuy period, the event's own cap and the
     wallet still decide whether the purchase is made. */
  if (row && guaranteeShortNow(typeof row.id === 'string' ? row.id : null)) return 1;
  return row && isMidwayFreeBuy(row)
    ? MIDWAY_FREE_BUY_HORSE_REBUY_SHARE
    : HORSE_TOURNAMENT_REBUY_SHARE;
}

/** Bind the draw to the accepted busting hand, not a sweep, clock or process.
 * A retry/restart must preserve a decline. A later bust gets a fresh draw.
 * This is only the input choice; the normal purchase transaction still owns
 * eligibility, caps, pricing, funding and duplicate-effect protection.
 * The draw itself never depends on the share: only the threshold does, so a
 * horse that would rebuy at 70% also rebuys at 90%.
 */
export function horseChoosesTournamentRebuy(
  tournamentId: string,
  userId: string,
  bustHandNumber: number | null | undefined,
  share: number = HORSE_TOURNAMENT_REBUY_SHARE
): boolean {
  if (!Number.isSafeInteger(bustHandNumber) || Number(bustHandNumber) <= 0) return false;
  const draw = createHash('sha256')
    .update(JSON.stringify(['horse-tournament-rebuy-v1', tournamentId, userId, bustHandNumber]))
    .digest()
    .readUInt32BE(0);
  return draw / 0x1_0000_0000 < share;
}
