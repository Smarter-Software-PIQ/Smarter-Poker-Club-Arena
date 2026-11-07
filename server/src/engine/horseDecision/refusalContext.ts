/**
 * A REFUSED DECISION CARRIES ITS JOURNAL KEY AND ITS SHAPE (2026-11-07).
 *
 * The client refuses a worker answer whose receipt does not bind to the
 * request (`refuseDecision`). Until now the only record of that refusal was
 * the error line `horse decision worker returned invalid policy receipt:
 * <reason>`, which names no hand. The decision journal keys a hand by
 * sha256(`tableId:handNumber:leaseIdentity`), and the lease identity is not
 * stored in the database, so a refusal could only be matched to its journal
 * record by time. One `reference_shape` in 789,282 eligible decisions
 * (Lightning NLH 0.25/0.50, hand cc8a59bb) could not be explained that way.
 *
 * The refusal error now carries, as one flat property beside the unchanged
 * message (the existing log parser matches the message line exactly):
 *
 * - `journalHandKey` / `journalTurnKey`: the exact hashed keys the worker's
 *   request-lifecycle record for this request is stored under, so the refusal
 *   joins to its journal decision record with no clock correlation;
 * - for a Phase 6 refusal, the public returned shape against the expected one
 *   (`horsePhase6RefusalShape`).
 *
 * Hashes and public table facts only: no hole card, no opponent read and no
 * other player's private information. Bounded: a fixed set of scalar fields.
 * This is diagnostic context on the existing refusal record, not a monitor.
 */
import {
  horseLifecycleKeys,
  isHorseLifecycleRequest,
} from '../../services/horseDecisionJournal/lifecycle.js';
import { journalHash } from '../../services/horseDecisionJournal/record.js';
import { horsePhase6RefusalShape, type Phase6RefusalShape } from '../HorsePhase6Attribution.js';
import type { HorseDecision, SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';

export type HorseDecisionRefusalContext = {
  version: 1;
  /** The named refusal, identical to the message's suffix. */
  reason: string;
  /** sha256 hand key exactly as the journal stores it, or null. */
  journalHandKey: string | null;
  /** sha256 turn key of this request's lifecycle record, or null. */
  journalTurnKey: string | null;
  journalKeyStatus: 'available' | 'unavailable';
  requestType: string | null;
} & Partial<Phase6RefusalShape>;

/** A plain Error (so the log line still reads `Error: <message>` and the
 * existing parser keeps matching) with the context as an own property, which
 * Node prints beside the stack. */
export type HorseDecisionRefusalError = Error & { refusal: HorseDecisionRefusalContext };

export function horseDecisionRefusalContextOf(error: unknown): HorseDecisionRefusalContext | null {
  const refusal = (error as { refusal?: unknown } | null)?.refusal;
  return refusal && typeof refusal === 'object' && (refusal as { version?: unknown }).version === 1
    ? (refusal as HorseDecisionRefusalContext)
    : null;
}

const REASON = /^[a-z0-9_]{1,64}$/;

export function horseDecisionRefusalContext(
  reason: string,
  request: { type: string },
  decision?: HorseDecision,
  phase6 = false
): HorseDecisionRefusalContext {
  let journalHandKey: string | null = null,
    journalTurnKey: string | null = null;
  try {
    if (isHorseLifecycleRequest(request)) {
      const keys = horseLifecycleKeys(request);
      journalHandKey = journalHash(keys.hand);
      journalTurnKey = journalHash(keys.turn);
    }
  } catch {
    journalHandKey = journalTurnKey = null;
  }
  const context: HorseDecisionRefusalContext = {
    version: 1,
    reason: REASON.test(reason) ? reason : 'unnamed',
    journalHandKey,
    journalTurnKey,
    journalKeyStatus: journalHandKey === null ? 'unavailable' : 'available',
    requestType: typeof request.type === 'string' ? request.type.slice(0, 32) : null,
  };
  const fields = request as { player?: SeatPlayer; gameState?: HorseGameStateV2; opts?: unknown };
  if (phase6 && decision?.tournamentPreflopAttribution && fields.player && fields.gameState) {
    const shape = horsePhase6RefusalShape(decision, {
      player: fields.player,
      gameState: fields.gameState,
      opts: fields.opts as Parameters<typeof horsePhase6RefusalShape>[1]['opts'],
    });
    if (shape) Object.assign(context, shape);
  }
  return context;
}

export function horseDecisionRefusalError(
  reason: string,
  request: { type: string },
  decision?: HorseDecision,
  phase6 = false
): HorseDecisionRefusalError {
  return Object.assign(
    new Error(`horse decision worker returned invalid policy receipt: ${reason}`),
    { refusal: horseDecisionRefusalContext(reason, request, decision, phase6) }
  );
}
