/** Accounting records are not player decisions, even when attributed to a seat. */
const DECISIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);

export function isPokerStatDecision(action: {
  action?: string;
  origin?: string;
  dead?: boolean;
}): boolean {
  return action.origin !== 'forced' && action.dead !== true && DECISIONS.has(action.action ?? '');
}

export interface StatActionRights {
  seat?: number;
  publicNode?: {
    status: string;
    actorSeat?: number;
    currentBet?: number;
    legalActions?: readonly string[];
    seats?: ReadonlyArray<readonly number[]>;
  };
}

/** Older histories lack captured rights; preserve their action-based estimate.
 * Captured rights take precedence: call-only all-ins are not raise opportunities.
 */
export function canRaiseForPokerStats(action: StatActionRights): boolean {
  const node = action.publicNode;
  if (node?.status !== 'captured') return true;
  if (node.actorSeat !== action.seat || !node.legalActions) return false;
  if (node.legalActions.includes('raise') || node.legalActions.includes('bet')) return true;
  const actor = node.seats?.find((seat) => seat[0] === action.seat);
  return (
    node.legalActions.includes('all_in') &&
    actor !== undefined &&
    Number.isFinite(node.currentBet) &&
    actor[1] + actor[2] > node.currentBet!
  );
}
