import type { CashGameJoinResult } from '../services/cashGameLobby';
import { normalizeInviteCode, normalizeInviteToken, normalizeUuid } from './inviteCode';

export interface TableInviteParams {
  inviteCode: string | null;
  clusterId: string | null;
  /** Heads Up seat-hold token (`?invite=`), the key to a seat held for one invited player. */
  inviteToken: string | null;
  returnPath: string | null;
}

/**
 * Parse and validate `?i=<CODE>`, `?cluster=<UUID>` and `?invite=<TOKEN>` from
 * a table URL's query string, and build the safe internal return path for
 * club-join flows.
 *
 * THE RETURN PATH CARRIES THE SEAT-HOLD TOKEN (2026-11-22). It used to carry
 * only `cluster`, so a friend who had to join the club first came back to the
 * table without `invite`, and the seat held for them answered
 * heads_up_invite_required: the one person the hold was made for was the one
 * person it refused.
 */
export function parseTableInviteParams(
  tableId: string | undefined,
  search: string
): TableInviteParams {
  const params = new URLSearchParams(search);
  const inviteCode = normalizeInviteCode(params.get('i'));
  const clusterId = normalizeUuid(params.get('cluster'));
  const inviteToken = normalizeInviteToken(params.get('invite'));
  let returnPath: string | null = null;
  if (tableId) {
    const back = new URLSearchParams();
    if (clusterId) back.set('cluster', clusterId);
    if (inviteToken) back.set('invite', inviteToken);
    const qs = back.toString();
    returnPath = `/table/${encodeURIComponent(tableId)}${qs ? `?${qs}` : ''}`;
  }
  return { inviteCode, clusterId, inviteToken, returnPath };
}

export interface MustMoveRoutingEligibilityInput {
  tableId: string | undefined;
  clusterId: string | null;
  userId: string | null | undefined;
  isLightningRoom: boolean;
  tableLoadFailure: 'missing' | 'unreachable' | null;
  loadedTableId: string | undefined;
  loadedClusterId: string | null | undefined;
  isTournament: boolean;
  maxPlayers: number;
  occupiedSeats: number;
  heroSeated: boolean;
}

export type MustMoveRoutingTrigger = 'missing' | 'full' | null;

/**
 * Decide whether arriving at a Must-Move table invite (`?cluster=<UUID>`)
 * should invoke a single bounded `joinCashGame(clusterId)` smart-routing call.
 *
 * Triggers only when:
 *   (a) the specific Main/Feeder table is missing/closed (`tableLoadFailure === 'missing'`), OR
 *   (b) the table loaded as a non-tournament cash table, the viewer is not
 *       seated, and every chair (`maxPlayers`) is already occupied.
 */
export function evaluateMustMoveRoutingTrigger(
  input: MustMoveRoutingEligibilityInput
): MustMoveRoutingTrigger {
  if (!input.tableId || !input.clusterId) return null;
  if (!input.userId || input.userId === 'guest') return null;
  if (input.isLightningRoom) return null;

  if (input.tableLoadFailure === 'missing') {
    return 'missing';
  }
  if (input.tableLoadFailure === 'unreachable') {
    return null;
  }

  if (input.loadedTableId !== input.tableId) return null;
  if (input.isTournament) return null;
  if (input.loadedClusterId && normalizeUuid(input.loadedClusterId) !== input.clusterId) {
    return null;
  }
  if (input.heroSeated) return null;
  if (input.maxPlayers > 0 && input.occupiedSeats >= input.maxPlayers) {
    return 'full';
  }
  return null;
}

export type MustMoveRoutingOutcome =
  | { kind: 'redirect'; to: string; toastMessage: string }
  | { kind: 'waitlisted'; toastMessage: string }
  | { kind: 'stay' };

export const MUST_MOVE_REDIRECT_TOAST = 'Moved To An Open Table In This Game';
export const MUST_MOVE_WAITLISTED_TOAST = 'Table Full. Added To Game Waitlist.';

/**
 * Map a `joinCashGame` result into the deterministic navigation/toast action.
 * Never redirects to the current table id, structurally preventing self-loops.
 */
export function resolveMustMoveRoutingOutcome(
  result: CashGameJoinResult,
  currentTableId: string,
  clusterId: string
): MustMoveRoutingOutcome {
  if (result.action === 'waitlisted') {
    return {
      kind: 'waitlisted',
      toastMessage: MUST_MOVE_WAITLISTED_TOAST,
    };
  }
  if (
    (result.action === 'seat' || result.action === 'seated') &&
    typeof result.table_id === 'string' &&
    result.table_id.trim() !== '' &&
    result.table_id !== currentTableId
  ) {
    return {
      kind: 'redirect',
      to: `/table/${encodeURIComponent(result.table_id)}?cluster=${clusterId}`,
      toastMessage: MUST_MOVE_REDIRECT_TOAST,
    };
  }
  return { kind: 'stay' };
}
