/**
 * `POST /sitout` — Bible V8 §7.12: sit out / sit back in.
 *
 * Extracted Phase U3.3 (2026-04-23). Byte-identical.
 * Body: `{ tableId, sitOut: boolean }`.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { sendJSON } from '../http/respond.js';
import { authenticateRequest } from '../http/auth.js';
import { readBody } from '../http/body.js';
import { reportError } from '../services/errorReporter.js';

export interface SitoutDeps {
  gameServer: {
    getTableEngine(tableId: string):
      | {
          sitOutAndWait?(
            userId: string,
            sitOut: boolean,
            proof?: { completedLightningOccupancyId?: string; requestedByClient?: boolean }
          ): Promise<{ success: boolean; [k: string]: unknown }>;
          sitOut(
            userId: string,
            sitOut: boolean,
            proof?: { completedLightningOccupancyId?: string; requestedByClient?: boolean }
          ): { success: boolean; [k: string]: unknown };
        }
      | null
      | undefined;
    lightningSeatReady?(clusterId: string): void | Promise<void>;
    /** Resolve only an open Lightning room owned by the authenticated caller. */
    lightningAnchorFor?(
      roomId: string,
      userId: string,
      opts?: { requireOpen?: boolean; requireCompletedHand?: boolean }
    ): Promise<{ anchorTableId: string; completedHandOccupancyId?: string } | null>;
  };
}

export async function handleSitout(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SitoutDeps
): Promise<void> {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) {
      return sendJSON(res, 401, { success: false, error: 'Authentication required' });
    }

    const body = JSON.parse(await readBody(req));
    const { tableId, sitOut } = body;
    const userId = auth.userId;

    if (!tableId || typeof sitOut !== 'boolean') {
      return sendJSON(res, 400, {
        success: false,
        error: 'Missing tableId or sitOut must be a boolean',
      });
    }

    let anchorTableId: string | undefined;
    let engine = deps.gameServer.getTableEngine(tableId);
    if (!engine && typeof tableId === 'string' && deps.gameServer.lightningAnchorFor) {
      // The room owns no physical engine. Both directions use the existing
      // anchor's cash sit-out rules; matcher legality reads that seat's flag.
      const anchor = await deps.gameServer.lightningAnchorFor(tableId, userId, {
        requireOpen: true,
      });
      if (anchor) {
        engine = deps.gameServer.getTableEngine(anchor.anchorTableId);
        anchorTableId = anchor.anchorTableId;
      }
    }
    if (!engine) {
      return sendJSON(res, 404, { success: false, error: 'Table engine not found' });
    }

    // This door is the account's own authenticated client. Its Sit Out is the
    // player's, and no horse controller may sit it back in (2026-10-22).
    const apply = (proof: {
      completedLightningOccupancyId?: string;
      requestedByClient?: boolean;
    }) =>
      engine!.sitOutAndWait
        ? engine!.sitOutAndWait(userId, sitOut, proof)
        : engine!.sitOut(userId, sitOut, proof);
    let result = await apply({ requestedByClient: true });
    if (sitOut && anchorTableId && result.code === 'SITOUT_HAND_REQUIRED') {
      // The first refusal made no state change. Only a settled hand of this
      // exact open pool can supplement a restarted feeder's empty local set.
      const proof = await deps.gameServer.lightningAnchorFor!(tableId, userId, {
        requireOpen: true,
        requireCompletedHand: true,
      });
      if (
        proof?.completedHandOccupancyId &&
        proof.anchorTableId === anchorTableId &&
        deps.gameServer.getTableEngine(anchorTableId) === engine
      ) {
        result = await apply({
          completedLightningOccupancyId: proof.completedHandOccupancyId,
          requestedByClient: true,
        });
      }
    }
    if (
      result.success &&
      (!sitOut || result.blindOff === true) &&
      typeof result.lightningClusterId === 'string'
    )
      await deps.gameServer.lightningSeatReady?.(result.lightningClusterId);
    return sendJSON(res, result.success ? 200 : 400, result);
  } catch (err: unknown) {
    reportError(err, 'HTTP.sitout_error');
    return sendJSON(res, 500, {
      success: false,
      error: 'Could Not Confirm Your Seat Change. Please Try Again.',
    });
  }
}
