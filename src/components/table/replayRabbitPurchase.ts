/**
 * RABBIT HUNT FROM THE HAND HISTORY PAGE (Dan 2026-11-01).
 *
 * "If you are looking at a PREVIOUS HAND you can RABBIT HUNT." The table's
 * own replayer reached the purchase through TablePage.handleRabbitReveal,
 * but the full Hand History page opens the same HandDetailModal with no
 * handler at all, so the Rabbit Hunt block never rendered there - the
 * feature was unreachable from the one screen built for previous hands.
 *
 * This is the replayer-only half of TablePage's handler, for a page that has
 * no live felt to repaint. It buys through the SAME requestRabbitHunt (and
 * so the same per-login receipt cache and durable server request id), and it
 * decides nothing about money or eligibility: the engine applies the felt
 * window, the VIP rule, dealt-in, the table toggle and the free re-open.
 */
import { readRabbitHuntReceipt, requestRabbitHunt } from '../../services/GameServerAPI';
import { canonicalCards } from '../../utils/tableGeometry';
import type { Card, RabbitHuntRevealResult } from './RabbitHunt';

/**
 * The engine answers 404 "Table Not Ready" when the table is no longer loaded
 * on it (a finished tournament, a closed table). From the history page that
 * means the run-out cannot be served, so say THAT rather than a sentence
 * about a table the player is not sitting at.
 */
const NOT_SERVABLE = 'Rabbit Hunt Is No Longer Available For That Hand';

export async function buyReplayRabbitHunt(
  tableId: string,
  handNumber: number
): Promise<RabbitHuntRevealResult> {
  const result = await requestRabbitHunt(tableId, handNumber);
  if (!result.success || !result.cards?.length) {
    return {
      success: false,
      error: result.error === 'Table Not Ready' ? NOT_SERVABLE : result.error,
      retryable: result.retryable,
    };
  }
  return {
    success: true,
    cards: canonicalCards(result.cards) as Card[],
    source: result.source,
    diamondsSpent: result.diamonds_spent,
    vipRemaining: result.vip_remaining ?? null,
    usesRemaining: result.uses_remaining,
  };
}

export async function readReplayRabbitReceipt(
  tableId: string,
  handNumber: number
): Promise<RabbitHuntRevealResult | null> {
  const result = await readRabbitHuntReceipt(tableId, handNumber);
  return result?.success && result.cards?.length
    ? { success: true, cards: canonicalCards(result.cards) as Card[], source: 'already_revealed' }
    : null;
}
