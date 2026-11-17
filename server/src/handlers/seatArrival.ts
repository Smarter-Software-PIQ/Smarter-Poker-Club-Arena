/**
 * `POST /seat_arrival` (Dan 2026-11-17): a chair is shown to every viewer the
 * moment it is taken. See engine/SeatArrivalDisplay.ts for the root cause.
 *
 * Body: `{ tableId, state: 'hold' | 'release' | 'seated', seatNumber? }`.
 *
 *   hold     the + tap; seatNumber required. Only a player who may watch the
 *            table may show a face in its chair.
 *   release  the buy-in sheet closed without a purchase.
 *   seated   the buy-in committed; the engine reads the committed seat rows.
 *
 * The player is always the authenticated token's, never the body's. Nothing
 * here moves chips or changes a hand; the buy-in RPC stays the only door.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { sendJSON } from '../http/respond.js';
import { authenticateRequest } from '../http/auth.js';
import { readBody } from '../http/body.js';
import { isUuidShape } from '../lib/uuidShape.js';
import { reportError } from '../services/errorReporter.js';
import { authorizeTableViewer } from '../services/TableViewerAccess.js';

type SeatArrivalState = 'hold' | 'release' | 'seated';

export interface SeatArrivalDeps {
  gameServer: {
    getTableEngine(tableId: string):
      | {
          noteSeatArrival(
            userId: string,
            request: { state: SeatArrivalState; seatNumber?: number }
          ): Promise<{ ok: true; expires_at_ms?: number } | { ok: false; reason: string }>;
        }
      | null
      | undefined;
  };
  authorizeViewer?: typeof authorizeTableViewer;
}

export async function handleSeatArrival(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SeatArrivalDeps
): Promise<void> {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return sendJSON(res, 401, { success: false, error: 'Authentication required' });

    let body: { tableId?: unknown; state?: unknown; seatNumber?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJSON(res, 400, { success: false, error: 'Invalid request body' });
    }
    const tableId = typeof body.tableId === 'string' ? body.tableId : '';
    const state = body.state;
    if (!isUuidShape(tableId))
      return sendJSON(res, 400, { success: false, error: 'Invalid table id' });
    if (state !== 'hold' && state !== 'release' && state !== 'seated') {
      return sendJSON(res, 400, { success: false, error: 'Invalid state' });
    }
    const seatNumber = Number(body.seatNumber);
    if (state === 'hold') {
      if (!Number.isInteger(seatNumber) || seatNumber < 1) {
        return sendJSON(res, 400, { success: false, error: 'Invalid seat' });
      }
      const access = await (deps.authorizeViewer ?? authorizeTableViewer)(tableId, auth.userId);
      if (!access.allowed) {
        return sendJSON(res, access.reason === 'check_failed' ? 503 : 403, {
          success: false,
          error: 'Not allowed at this table',
          reason: access.reason,
        });
      }
    }

    const engine = deps.gameServer.getTableEngine(tableId);
    // A table this process is not dealing has no felt to draw on here; the
    // seat still shows from the roster when its engine starts.
    if (!engine) return sendJSON(res, 200, { success: true, tracked: false });

    const result = await engine.noteSeatArrival(
      auth.userId,
      state === 'hold' ? { state, seatNumber } : { state }
    );
    if (!result.ok) return sendJSON(res, 409, { success: false, reason: result.reason });
    return sendJSON(res, 200, { success: true, tracked: true, ...result });
  } catch (err: unknown) {
    reportError(err, 'HTTP.seat_arrival_error');
    return sendJSON(res, 500, { success: false, error: 'Seat arrival failed' });
  }
}
