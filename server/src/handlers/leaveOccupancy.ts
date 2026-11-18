import type { IncomingMessage, ServerResponse } from 'http';
import { sendJSON } from '../http/respond.js';
import { authenticateRequest } from '../http/auth.js';
import { readBody } from '../http/body.js';
import { reportError } from '../services/errorReporter.js';
import {
  getSeatCashoutReceipt,
  requestLightningRoomDeparture,
  legacyLightningLeaveRequiresReload,
} from '../services/supabase/seats.js';

export interface LeaveOccupancyDeps {
  gameServer: {
    getTableEngine(tableId: string):
      | {
          adoptLightningBlindOff?(userId: string, occupancyId: string): void;
          leaveTable(
            userId: string,
            opts: { occupancyId: string; seatNumber: number; confirmHandCount?: boolean }
          ): Promise<{
            success: boolean;
            immediate: boolean;
            code?: string;
            tournament?: boolean;
            error?: string;
            stay_remaining_ms?: number;
            held?: boolean;
            blindOff?: boolean;
            hands_remaining?: number;
            needs_confirmation?: boolean;
          }>;
        }
      | null
      | undefined;
    /**
     * Lightning Phase 6 remediation: a pool_session_id (the player's Lightning
     * room) resolves to the anchor seat the chips sit in, so a leave from a
     * Lightning room is a leave from that seat, at that table's engine.
     */
    lightningAnchorFor?(
      roomId: string,
      userId: string
    ): Promise<{ anchorTableId: string; seatNumber: number; occupancyId: string } | null>;
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Separate URL: an older engine must not silently ignore the occupancy contract. */
export async function handleLeaveOccupancy(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeaveOccupancyDeps,
  scopedLightning = false
): Promise<void> {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return sendJSON(res, 401, { success: false, error: 'Authentication required' });
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJSON(res, 400, { success: false, error: 'Invalid leave request' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJSON(res, 400, { success: false, error: 'Invalid leave request' });
    }
    const requested = body as Record<string, unknown>;
    let { tableId, occupancyId, seatNumber } = requested;
    const poolSessionId = requested.poolSessionId;
    if (scopedLightning && (typeof poolSessionId !== 'string' || !UUID.test(poolSessionId)))
      return sendJSON(res, 400, { success: false, error: 'Original Lightning room required' });

    // A Lightning room is no table: the leave is the anchor seat's.
    if (
      !scopedLightning &&
      deps.gameServer.lightningAnchorFor &&
      typeof tableId === 'string' &&
      UUID.test(tableId) &&
      !deps.gameServer.getTableEngine(tableId)
    ) {
      const anchor = await deps.gameServer.lightningAnchorFor(tableId, auth.userId);
      if (anchor) {
        if (
          (occupancyId !== undefined && occupancyId !== anchor.occupancyId) ||
          (seatNumber !== undefined && seatNumber !== anchor.seatNumber)
        )
          return sendJSON(res, 409, {
            protocol: 'seat-occupancy-v1',
            success: false,
            immediate: false,
            code: 'STALE_OCCUPANCY',
            error: 'This Request Belongs To A Previous Seat.',
          });
        tableId = anchor.anchorTableId;
        occupancyId = anchor.occupancyId;
        seatNumber = anchor.seatNumber;
      }
    }
    if (
      typeof tableId !== 'string' ||
      !UUID.test(tableId) ||
      typeof occupancyId !== 'string' ||
      !UUID.test(occupancyId) ||
      typeof seatNumber !== 'number' ||
      !Number.isInteger(seatNumber) ||
      seatNumber < 0
    ) {
      return sendJSON(res, 400, { success: false, error: 'Original seat identity required' });
    }
    const envelope = {
      protocol: 'seat-occupancy-v1',
      occupancyId,
      seatNumber,
      ...(scopedLightning ? { poolSessionId } : {}),
    };
    const receiptForOriginal = () =>
      scopedLightning && typeof poolSessionId === 'string'
        ? getSeatCashoutReceipt(
            auth.userId,
            tableId as string,
            seatNumber as number,
            occupancyId as string,
            poolSessionId
          )
        : getSeatCashoutReceipt(
            auth.userId,
            tableId as string,
            seatNumber as number,
            occupancyId as string
          );
    const original = await receiptForOriginal();
    if (original)
      return sendJSON(res, 200, {
        ...envelope,
        success: true,
        immediate: true,
        cashout: original,
      });
    if (
      !scopedLightning &&
      requested.origin !== 'physical-table' &&
      (await legacyLightningLeaveRequiresReload(auth.userId, tableId, occupancyId))
    )
      return sendJSON(res, 409, {
        ...envelope,
        success: false,
        immediate: false,
        reloadRequired: true,
        code: 'STALE_OCCUPANCY',
        error: 'Refresh the table before leaving so your current Lightning room can be verified.',
      });
    const engine = deps.gameServer.getTableEngine(tableId);
    if (!engine)
      return sendJSON(res, 503, {
        ...envelope,
        success: false,
        error: 'The Table Is Temporarily Unavailable. Please Try Again.',
      });
    // HIT AND RUN (owner 2026-11-06): the player saw "YOUR HAND COUNT IS NOT
    // COMPLETED" and chose to leave; their seat is blinded off for the rest.
    const confirmHandCount = requested.confirmHandCount === true;
    if (scopedLightning && typeof poolSessionId === 'string') {
      if (!engine.adoptLightningBlindOff)
        return sendJSON(res, 503, {
          ...envelope,
          success: false,
          error: 'Lightning leave is temporarily unavailable.',
        });
      const decision = await requestLightningRoomDeparture(
        poolSessionId,
        auth.userId,
        tableId,
        seatNumber,
        occupancyId,
        confirmHandCount
      );
      if (!decision.ok) {
        const needsConfirmation = decision.reason === 'LEAVE_LOCKED';
        return sendJSON(res, needsConfirmation ? 200 : 409, {
          ...envelope,
          success: false,
          immediate: false,
          code: decision.reason,
          needs_confirmation: needsConfirmation,
          hands_remaining: decision.hands_remaining,
          error: needsConfirmation
            ? 'Hands remain before leaving.'
            : 'Could not confirm this room and seat.',
        });
      }
      if (decision.blind_off) {
        engine.adoptLightningBlindOff(auth.userId, occupancyId);
        return sendJSON(res, 200, {
          ...envelope,
          success: true,
          immediate: false,
          held: true,
          blindOff: true,
          sittingOut: false,
          hands_remaining: decision.hands_remaining,
          cashout: null,
        });
      }
    }
    const result = await engine.leaveTable(auth.userId, {
      occupancyId,
      seatNumber,
      ...(confirmHandCount ? { confirmHandCount } : {}),
    });
    if (!result.success)
      return sendJSON(
        res,
        result.code === 'LEAVE_LOCKED' ? 200 : result.code === 'STALE_OCCUPANCY' ? 409 : 400,
        { ...result, ...envelope }
      );
    if (!result.immediate || result.tournament)
      return sendJSON(res, 200, {
        ...result,
        ...envelope,
        cashout: null,
      });
    const receipt = await receiptForOriginal();
    if (!receipt)
      return sendJSON(res, 503, {
        ...envelope,
        success: false,
        error: 'The Cashout Was Not Confirmed. Please Try Again.',
      });
    return sendJSON(res, 200, { ...envelope, success: true, immediate: true, cashout: receipt });
  } catch (error) {
    reportError(error, 'HTTP.leave_occupancy');
    return sendJSON(res, 503, {
      success: false,
      error: 'The Cashout Was Not Confirmed. Please Try Again.',
    });
  }
}
