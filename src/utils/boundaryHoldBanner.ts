/**
 * Felt status banner for tournament boundary holds (2026-11-21).
 *
 * When a tournament table is parked between hands waiting on hand-for-hand
 * synchronization, table balancing (tournament_move), or terminal closeout,
 * players otherwise stare at a silent idle felt and assume the table froze.
 * This pure selector maps the engine's pause_owners + handForHand state into
 * a concise, non-blocking felt banner while no hand is in progress.
 */

export interface BoundaryHoldBanner {
  kind: 'hand_for_hand' | 'tournament_move' | 'terminal_closeout';
  title: string;
  detail: string;
}

export function selectBoundaryHoldBanner(input: {
  isTournament: boolean;
  isHandInProgress: boolean;
  handForHand?: boolean;
  pauseOwners?: readonly string[];
}): BoundaryHoldBanner | null {
  if (!input.isTournament || input.isHandInProgress) return null;
  const owners = input.pauseOwners ?? [];
  if (owners.includes('terminal_closeout')) {
    return {
      kind: 'terminal_closeout',
      title: 'Finalizing Tournament',
      detail: 'Settling Final Results',
    };
  }
  if (owners.includes('hand_for_hand') || input.handForHand === true) {
    return {
      kind: 'hand_for_hand',
      title: 'Hand-For-Hand Play',
      detail: 'Waiting For Other Tables To Finish The Current Hand',
    };
  }
  if (owners.includes('tournament_move')) {
    return {
      kind: 'tournament_move',
      title: 'Balancing Tables',
      detail: 'Next Hand Starts Momentarily',
    };
  }
  return null;
}
