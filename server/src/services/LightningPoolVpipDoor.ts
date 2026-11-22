/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIGHTNING POOL VPIP EVICTION DOOR (leader-owned, between hands only)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The anchor-seat eviction door behind LightningPoolVpipJudge. Mirrors
 * LightningBankTheWinDoor.ts so no file under src/lightning/ touches
 * table_seats or cashouts directly (ALightningHandsCardsAndMoneyStayWithTheir
 * Owners law).
 *
 * HORSES ARE PLAYERS (CLAUDE.md 10.5): humans and Horses go through this same
 * door, resolve their open anchor seat via lightningAnchorSeat, and cash out
 * cleanly between hands through ServerTableEngine.evictForLightningVpip
 * (atomicCashout with leaveMode 'vpip_evicted').
 *
 * SAFETY GUARANTEES:
 *   - Never evicts mid-hand: ServerTableEngine.evictForLightningVpip checks
 *     inLiveLightningHand AND atomic_seat_cashout_locked refuses with
 *     LIGHTNING_HAND_IN_PROGRESS if the player is in any live hand.
 *   - Never loses chips: 100% of the anchor stack is returned atomically to
 *     the player's wallet by fn_cashout_seat_occupancy.
 *   - Never evicts during maintenance freeze.
 *   - Uncertain throws re-verify via lightningAnchorSeat before counting a
 *     failure so a committed eviction is never retried.
 */
import { isMaintenanceFrozen } from '../maintenance/freezeState.js';
import { reportError } from './errorReporter.js';
import { lightningAnchorSeat, type LightningAnchorSeat } from './supabase/lightningAnchor.js';
import {
  onLightningPoolVpipEvict,
  type LightningPoolVpipEvictOutcome,
  type LightningPoolVpipEvictRequest,
} from '../lightning/LightningPoolVpipJudge.js';

export type LightningPoolVpipDoorOutcome = Extract<
  LightningPoolVpipEvictOutcome,
  'evicted' | 'deferred' | 'not_seated' | 'failed'
>;

export interface LightningVpipAnchorEngine {
  evictForLightningVpip(
    userId: string,
    opts: {
      occupancyId: string;
      seatNumber: number;
      vpip: number;
      required: number;
      hands: number;
    }
  ): Promise<LightningPoolVpipDoorOutcome>;
}

export interface LightningPoolVpipDoorDeps {
  getEngine: (tableId: string) => LightningVpipAnchorEngine | null | undefined;
  readAnchorSeat?: (poolSessionId: string, userId: string) => Promise<LightningAnchorSeat | null>;
  emitRoomEvent?: (roomId: string, payload: Record<string, unknown>) => void;
  frozen?: () => boolean;
  now?: () => number;
}

export async function executeLightningPoolVpipEviction(
  req: LightningPoolVpipEvictRequest,
  deps: LightningPoolVpipDoorDeps
): Promise<LightningPoolVpipDoorOutcome> {
  const frozen = deps.frozen ?? isMaintenanceFrozen;
  if (frozen()) return 'deferred';

  const readAnchor =
    deps.readAnchorSeat ??
    ((poolSessionId: string, userId: string) =>
      lightningAnchorSeat(poolSessionId, userId, { requireOpen: true }));

  let anchor: LightningAnchorSeat | null = null;
  try {
    anchor = await readAnchor(req.poolSessionId, req.playerId);
  } catch (err) {
    reportError(err, 'LightningPoolVpipDoor.anchorRead', {
      clusterId: req.clusterId,
      poolSessionId: req.poolSessionId,
      playerId: req.playerId,
    });
    return 'failed';
  }
  if (!anchor || anchor.clusterId !== req.clusterId) return 'not_seated';

  const engine = deps.getEngine(anchor.anchorTableId);
  if (!engine) return 'deferred';

  try {
    const outcome = await engine.evictForLightningVpip(req.playerId, {
      occupancyId: anchor.occupancyId,
      seatNumber: anchor.seatNumber,
      vpip: req.vpip,
      required: req.required,
      hands: req.hands,
    });
    if (outcome === 'evicted') {
      try {
        deps.emitRoomEvent?.(req.poolSessionId, {
          type: 'seat_left',
          table_id: req.poolSessionId,
          seat: anchor.seatNumber,
          user_id: req.playerId,
          mid_hand: false,
          reason: 'nit_game_vpip',
          vpip: req.vpip,
          required: req.required,
          hands: req.hands,
          timestamp: (deps.now ?? Date.now)(),
        });
      } catch {
        /* room event delivery never reverses a committed cashout */
      }
      console.log(
        `[LightningVpipFloor] evicted ${req.playerId.slice(0, 8)} from cluster ${req.clusterId.slice(0, 8)} ` +
          `(anchor ${anchor.anchorTableId.slice(0, 8)}): ${req.vpip}% VPIP over ${req.hands} hands < ${req.required}% floor`
      );
    }
    return outcome;
  } catch (err) {
    reportError(err, 'LightningPoolVpipDoor.evict', {
      clusterId: req.clusterId,
      poolSessionId: req.poolSessionId,
      playerId: req.playerId,
      anchorTableId: anchor.anchorTableId,
    });
    // UNCERTAIN: verify whether the seat already departed before counting a failure.
    try {
      const after = await readAnchor(req.poolSessionId, req.playerId);
      if (!after || after.occupancyId !== anchor.occupancyId) return 'evicted';
    } catch {
      /* treat as failed so the next hand boundary re-checks safely */
    }
    return 'failed';
  }
}

export function startLightningPoolVpipDoor(
  getEngine: (tableId: string) => LightningVpipAnchorEngine | null | undefined,
  emitRoomEvent?: (roomId: string, payload: Record<string, unknown>) => void
): void {
  onLightningPoolVpipEvict((req) =>
    executeLightningPoolVpipEviction(req, { getEngine, emitRoomEvent })
  );
}

export function stopLightningPoolVpipDoor(): void {
  onLightningPoolVpipEvict(null);
}
