import {
  prepareDurableTerminalRequest,
  executeDurableTerminalRequest,
  resolveDurableTerminalRequest,
  closeDurableTerminalRequest,
  type DurableTerminalRequest,
} from './terminalDurableRequest.js';
import { freezeTerminalRequest, type TerminalRequestIdentity } from './terminalRequestIdentity.js';
import { maintenanceSupabase } from '../services/supabase.js';
import { isDeterministicSettlementRefusal } from './settlementRefusal.js';
import {
  verifySatelliteSettlementReceipt,
  type VerifiedSatelliteSettlementReceipt,
} from './satelliteSettlementReceipt.js';

export class SatelliteSettlementRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SatelliteSettlementRefusedError';
  }
}

export class SatelliteSettlementOutcomeUnknownError extends Error {
  readonly originalRequest: TerminalRequestIdentity | null;

  constructor(message: string, originalRequest: TerminalRequestIdentity | null = null) {
    super(message);
    this.name = 'SatelliteSettlementOutcomeUnknownError';
    this.originalRequest = originalRequest ? freezeTerminalRequest(originalRequest) : null;
  }
}

interface SatelliteSettlementRetryOptions {
  attempts?: number;
  wait?: (delayMs: number) => Promise<void>;
}

// Satellite settlement permits 30 seconds in PostgreSQL and its serialized
// resolver permits 45. Use the existing 50-second authority transport for both,
// as ordinary terminal settlement does. A lost response remains unknown; this
// does not widen the ordinary game-data deadline or change replay identity.

const authority = maintenanceSupabase;

const defaultWait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message?: unknown }).message ?? value);
  }
  return String(value);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type OriginalSatelliteOutcome =
  | { state: 'committed'; receipt: VerifiedSatelliteSettlementReceipt }
  | { state: 'not_committed' }
  | { state: 'unknown'; reason: string };

/** Serialized read of one original satellite request; never invokes settlement. */
export async function resolveOriginalSatelliteOutcome(
  identity: TerminalRequestIdentity,
  durable: DurableTerminalRequest | null = null
): Promise<OriginalSatelliteOutcome> {
  const request = freezeTerminalRequest(identity);
  if (request.kind !== 'satellite' || !request.observedWinnerId)
    return { state: 'unknown', reason: 'Wrong satellite resolver' };
  return resolveOriginalSatelliteOutcomeWithArgs(
    request,
    {
      p_tournament_id: request.tournamentId,
      p_observed_winner_id: request.observedWinnerId,
    },
    durable
  );
}

async function resolveOriginalSatelliteOutcomeWithArgs(
  request: TerminalRequestIdentity,
  args: Readonly<Record<string, unknown>>,
  durable: DurableTerminalRequest | null = null
): Promise<OriginalSatelliteOutcome> {
  if (!request.observedWinnerId)
    return { state: 'unknown', reason: 'Satellite winner unavailable' };
  try {
    const { data, error } = durable
      ? await resolveDurableTerminalRequest(durable)
      : await authority.rpc('fn_resolve_satellite_settlement_outcome', args);
    if (error) return { state: 'unknown', reason: errorMessage(error) };
    const outcome = record(data);
    const exact =
      outcome.ok === true &&
      outcome.tournament_id === request.tournamentId &&
      outcome.winner_id === request.observedWinnerId;
    if (
      exact &&
      outcome.satellite_committed === true &&
      outcome.definitively_not_committed === false &&
      outcome.status === 'COMPLETED'
    ) {
      const receipt = verifySatelliteSettlementReceipt(
        outcome.receipt,
        request.tournamentId,
        request.observedWinnerId
      );
      if (receipt) return { state: 'committed', receipt };
      return { state: 'unknown', reason: 'serialized committed receipt was invalid' };
    }
    if (
      exact &&
      outcome.satellite_committed === false &&
      outcome.definitively_not_committed === true &&
      (outcome.status === 'RUNNING' || outcome.status === 'COMPLETING') &&
      outcome.receipt === null
    )
      return { state: 'not_committed' };
    return { state: 'unknown', reason: 'serialized outcome shape was invalid' };
  } catch (error) {
    return { state: 'unknown', reason: errorMessage(error) };
  }
}

/**
 * Replay the same idempotent whole-satellite request after a transport error.
 * If every direct response is lost, the resolver waits behind the same global
 * database lock before it distinguishes a committed receipt from a proven
 * RUNNING or COMPLETING miss. No caller may infer rollback from HTTP failure.
 * Known missing-evidence refusals skip identical writes, but still require that
 * same serialized outcome check before the caller can release its finish guard.
 */
export async function requestSatelliteSettlementReceipt(
  tournamentId: string,
  observedWinnerId: string,
  options: SatelliteSettlementRetryOptions = {}
): Promise<VerifiedSatelliteSettlementReceipt> {
  const attempts = Math.max(1, Math.min(8, Math.trunc(options.attempts ?? 5)));
  const wait = options.wait ?? defaultWait;
  const request = {
    p_tournament_id: tournamentId,
    p_observed_winner_id: observedWinnerId,
  };
  const originalRequest = freezeTerminalRequest({
    kind: 'satellite' as const,
    tournamentId,
    observedWinnerId,
  });
  const durable = await prepareDurableTerminalRequest(originalRequest);
  let lastFailure = 'satellite settlement returned no receipt';
  let attemptedWrites = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      attemptedWrites++;
      const { data, error } = durable
        ? await executeDurableTerminalRequest(durable)
        : await authority.rpc('fn_settle_satellite_tournament', request);
      if (!error) {
        const receipt = verifySatelliteSettlementReceipt(data, tournamentId, observedWinnerId);
        if (receipt) return receipt;
        lastFailure = 'satellite settlement returned an invalid stored receipt';
      } else {
        lastFailure = errorMessage(error);
        if (isDeterministicSettlementRefusal(error, tournamentId)) break;
      }
    } catch (error) {
      lastFailure = errorMessage(error);
    }

    if (attempt < attempts) await wait(200 * 2 ** (attempt - 1));
  }

  const resolved = await resolveOriginalSatelliteOutcomeWithArgs(originalRequest, request, durable);
  if (resolved.state === 'committed') return resolved.receipt;
  if (resolved.state === 'not_committed') {
    if (durable && !(await closeDurableTerminalRequest(durable)))
      throw new SatelliteSettlementOutcomeUnknownError(
        'Original satellite request close is unproven',
        originalRequest
      );
    throw new SatelliteSettlementRefusedError(lastFailure);
  }
  lastFailure = `${lastFailure}; serialized outcome check failed: ${resolved.reason}`;

  throw new SatelliteSettlementOutcomeUnknownError(
    `Satellite settlement outcome is unknown after ${attemptedWrites} identical attempt(s): ${lastFailure}`,
    originalRequest
  );
}
