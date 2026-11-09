/**
 * Why a heads-up rematch buy-back-in was refused, in the ordinary buy-in
 * words. The server sends the reason only to the player it was refused for;
 * nobody was charged. Kept apart from headsUpRematch.ts because it needs the
 * tournament service, which the first paint must not download (the result
 * host imports this lazily, only when there is a refusal to say).
 */
import { seatFirstBuyInReasonIsKnown, seatFirstBuyInRefusalText } from './TournamentService';

export function rematchRefusalText(reason: string | undefined): string {
  if (/rematch_unavailable/.test(reason ?? '')) return 'The Rematch Is Not Available Right Now';
  return seatFirstBuyInRefusalText(reason);
}

export function rematchRefusalReasonIsKnown(reason: string | undefined): boolean {
  return /rematch_unavailable/.test(reason ?? '') || seatFirstBuyInReasonIsKnown(reason);
}
