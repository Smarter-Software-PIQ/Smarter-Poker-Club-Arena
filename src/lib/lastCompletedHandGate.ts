/**
 * Pure gating and scope-safety helpers for TablePage's `lastCompletedHand` HUD state.
 *
 * Prevents:
 *  - Spectators, guests, sitting-out / non-participant players, and Lightning
 *    observers from stamping `lastCompletedHand` (which would hit World Hub's
 *    non-participant 404 -> 429 probe lockout).
 *  - Cross-table (`T1 -> T2`) and cross-account (`U1 -> U2`) contamination when
 *    `engineLastEvent` has not yet cleared in the same commit.
 *  - Out-of-order late-settling fast-folded Lightning hands overwriting a newer
 *    completed hand in the same pool session.
 */

import { normalizeCanonicalUuid } from '../services/SavedHandsService';

export interface LastCompletedHandState {
  scope: string;
  handId: string;
  handNumber: number | null;
}

export interface HandHistorySavedGateInput {
  event: Record<string, unknown>;
  alreadyProcessed: boolean;
  userId: string | null | undefined;
  tableId: string | null | undefined;
  poolSessionId: string | null | undefined;
  currentScope: string;
  heroAtTable: boolean;
  lightningObserver: boolean;
  heroDealtHands: ReadonlySet<number>;
  heroCardsHandNumber: number;
  heroHandOutcome: { dealtIn: boolean; handNumber: number };
  previous: LastCompletedHandState | null;
}

export function normalizePositiveHandNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

export function handHistorySavedEventIdentity(event: Record<string, unknown>): string {
  const handId = typeof event.hand_id === 'string' ? event.hand_id.trim().toLowerCase() : '';
  const tableId = typeof event.table_id === 'string' ? event.table_id.trim() : '';
  const poolSessionId =
    typeof event.pool_session_id === 'string' ? event.pool_session_id.trim() : '';
  const playerId = typeof event.player_id === 'string' ? event.player_id.trim() : '';
  const handNumber = normalizePositiveHandNumber(event.hand_number) ?? '';
  const timestamp =
    typeof event.timestamp === 'number' || typeof event.timestamp === 'string'
      ? String(event.timestamp)
      : '';
  return `${tableId}|${poolSessionId}|${playerId}|${handId}|${handNumber}|${timestamp}`;
}

export function resolveNextLastCompletedHand(
  input: HandHistorySavedGateInput
): LastCompletedHandState | null {
  const {
    event,
    alreadyProcessed,
    userId,
    tableId,
    poolSessionId,
    currentScope,
    heroAtTable,
    lightningObserver,
    heroDealtHands,
    heroCardsHandNumber,
    heroHandOutcome,
    previous,
  } = input;

  if (alreadyProcessed) return previous;
  if (!heroAtTable || lightningObserver || !userId || userId === 'guest') {
    return previous;
  }

  const canonicalHandId = normalizeCanonicalUuid(event.hand_id);
  if (!canonicalHandId) return previous;

  const eventTableId =
    typeof event.table_id === 'string' && event.table_id.trim() ? event.table_id.trim() : null;
  const eventPoolSessionId =
    typeof event.pool_session_id === 'string' && event.pool_session_id.trim()
      ? event.pool_session_id.trim()
      : null;
  const eventPlayerId =
    typeof event.player_id === 'string' && event.player_id.trim() ? event.player_id.trim() : null;

  // Cross-account guard: if the event names a player, it MUST be the active hero.
  if (eventPlayerId && eventPlayerId !== userId) {
    return previous;
  }

  // Cross-table / cross-pool guard: validate event belongs to the active table or pool session.
  if (poolSessionId) {
    const matchesPool = eventPoolSessionId === poolSessionId || eventTableId === poolSessionId;
    if (!matchesPool) {
      return previous;
    }
  } else {
    if (eventPoolSessionId) {
      return previous;
    }
    if (eventTableId && tableId && eventTableId !== tableId) {
      return previous;
    }
  }

  const eventHandNumber = normalizePositiveHandNumber(event.hand_number);

  // Participation guard: Hero must have actually participated in THIS hand (never sat out or observed).
  let heroParticipated = false;
  if (eventPlayerId === userId) {
    // Lightning participant receipts are privately routed per dealt participant.
    heroParticipated = true;
  } else if (Array.isArray(event.players)) {
    heroParticipated = event.players.some((rawPlayer) => {
      if (!rawPlayer || typeof rawPlayer !== 'object') return false;
      const p = rawPlayer as Record<string, unknown>;
      const isHeroRow =
        p.isHero === true ||
        p.id === userId ||
        p.user_id === userId ||
        p.userId === userId ||
        p.playerId === userId ||
        p.player_id === userId;
      if (!isHeroRow) return false;
      if (p.is_sitting_out === true || p.sittingOut === true || p.status === 'sitting_out') {
        return false;
      }
      return true;
    });
  } else if (eventHandNumber !== null) {
    heroParticipated =
      heroDealtHands.has(eventHandNumber) ||
      heroCardsHandNumber === eventHandNumber ||
      (heroHandOutcome.dealtIn && heroHandOutcome.handNumber === eventHandNumber);
  } else {
    heroParticipated = heroHandOutcome.dealtIn;
  }

  if (!heroParticipated) {
    return previous;
  }

  // Monotonic hand-number guard within the same scope (blocks late-settling fast-folded Lightning hands).
  if (
    previous &&
    previous.scope === currentScope &&
    previous.handNumber !== null &&
    eventHandNumber !== null &&
    eventHandNumber < previous.handNumber
  ) {
    return previous;
  }

  return {
    scope: currentScope,
    handId: canonicalHandId,
    handNumber: eventHandNumber,
  };
}
