import { randomUUID } from 'node:crypto';
import { maintenanceSupabase } from '../services/supabase.js';
import {
  bindToProcessRoot,
  currentTournamentDataAuthority,
} from '../services/supabase/dataActorContext.js';
import { UUID_SHAPE } from '../lib/uuidShape.js';
import { freezeTerminalRequest, type TerminalRequestIdentity } from './terminalRequestIdentity.js';

export interface DurableTerminalRequest {
  readonly requestId: string;
  readonly originalGeneration: string;
  readonly currentGeneration: string;
  readonly phase: 'prepared' | 'committed' | 'closed';
  readonly identity: TerminalRequestIdentity;
}

// Every attempted prepare rolled back on a held lock. No payment command was sent.
// This says nothing about earlier operations; the next pass re-enters the
// original durable authority, which adopts an existing request or receipt.
export class TerminalPrepareBusyError extends Error {
  constructor() {
    super('Terminal preparation deferred by a held database lock (55P03)');
    this.name = 'TerminalPrepareBusyError';
  }
}

// Existing satellite callers share the same proven pre-send refusal.
export { TerminalPrepareBusyError as SatelliteTerminalPrepareBusyError };

export class TerminalIntentUnknownError extends Error {
  readonly originalRequest: TerminalRequestIdentity;
  constructor(message: string, identity: TerminalRequestIdentity) {
    super(message);
    this.name = 'TerminalIntentUnknownError';
    this.originalRequest = freezeTerminalRequest(identity);
  }
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function sameIdentity(a: TerminalRequestIdentity, b: TerminalRequestIdentity): boolean {
  const keys = Object.keys(a).sort();
  return (
    JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()) &&
    keys.every((key) => JSON.stringify((a as any)[key]) === JSON.stringify((b as any)[key]))
  );
}
export function parseDurableTerminalRequest(
  raw: unknown,
  tournamentId: string
): DurableTerminalRequest | null {
  const row = object(raw),
    identity = object(row.original_request);
  if (
    !UUID_SHAPE.test(row.request_id ?? '') ||
    !UUID_SHAPE.test(row.original_generation ?? '') ||
    !UUID_SHAPE.test(row.current_generation ?? '') ||
    row.tournament_id !== tournamentId ||
    identity.tournamentId !== tournamentId ||
    !['prepared', 'committed', 'closed'].includes(row.phase)
  )
    return null;
  const kind = identity.kind;
  let expected: string[];
  if (kind === 'places' || kind === 'satellite') {
    if (!UUID_SHAPE.test(identity.observedWinnerId ?? '')) return null;
    expected = ['kind', 'observedWinnerId', 'tournamentId'];
  } else if (kind === 'legacy_deal' || kind === 'proposal_deal') {
    if (identity.observedWinnerId !== null) return null;
    expected =
      kind === 'legacy_deal'
        ? ['kind', 'observedWinnerId', 'tournamentId']
        : ['kind', 'observedWinnerId', 'proposalId', 'revision', 'tournamentId'];
    if (
      kind === 'proposal_deal' &&
      (!UUID_SHAPE.test(identity.proposalId ?? '') ||
        typeof identity.revision !== 'string' ||
        !/^[0-9a-f]{64}$/.test(identity.revision))
    )
      return null;
  } else if (kind === 'satellite_qualifiers') {
    if (
      identity.observedWinnerId !== null ||
      !Array.isArray(identity.qualifierIds) ||
      !identity.qualifierIds.length ||
      identity.qualifierIds.some(
        (id: unknown, i: number, ids: string[]) =>
          typeof id !== 'string' || !UUID_SHAPE.test(id) || (i > 0 && id <= ids[i - 1])
      )
    )
      return null;
    expected = ['kind', 'observedWinnerId', 'qualifierIds', 'tournamentId'];
  } else return null;
  if (JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(expected)) return null;
  return Object.freeze({
    requestId: row.request_id,
    originalGeneration: row.original_generation,
    currentGeneration: row.current_generation,
    phase: row.phase,
    identity: freezeTerminalRequest(identity as TerminalRequestIdentity),
  });
}

function acknowledged(
  raw: unknown,
  expected: DurableTerminalRequest
): DurableTerminalRequest | null {
  const value = object(raw);
  const row =
    value.ok === true
      ? parseDurableTerminalRequest(value.request, expected.identity.tournamentId)
      : null;
  return row &&
    row.requestId === expected.requestId &&
    row.originalGeneration === expected.originalGeneration &&
    row.currentGeneration === expected.currentGeneration &&
    sameIdentity(row.identity, expected.identity)
    ? row
    : null;
}

/** A lost prepare acknowledgement may repeat this same idempotent identity,
 * never a settlement. No money is submitted until the exact row is acknowledged. */
export async function prepareDurableTerminalRequest(
  identity: TerminalRequestIdentity
): Promise<DurableTerminalRequest | null> {
  const authority = currentTournamentDataAuthority();
  // Historical service-root recovery retains its existing canonical path. New
  // manager requests use this contract; the receipt trigger prevents downgrade.
  if (!authority) return null;
  if (authority.tournamentId !== identity.tournamentId)
    throw new TerminalIntentUnknownError('Terminal intent manager identity differs', identity);
  const requestId = randomUUID();
  const params = Object.freeze({
    p_request_id: requestId,
    p_request: identity,
    p_generation: authority.leaseGeneration,
  });
  let busyResponses = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await maintenanceSupabase.rpc(
        'fn_prepare_tournament_terminal_request',
        params
      );
      if (object(error).code === '55P03') busyResponses++;
      const value = object(data);
      if (
        !error &&
        value.ok === true &&
        value.already_terminal === true &&
        value.tournament_id === identity.tournamentId
      )
        return null;
      const row =
        !error && value.ok === true
          ? parseDurableTerminalRequest(value.request, identity.tournamentId)
          : null;
      // An exact active request from this generation is the same operation,
      // even when a duplicate entry generated a different proposed request id.
      if (
        row &&
        row.currentGeneration === authority.leaseGeneration &&
        row.phase === 'prepared' &&
        sameIdentity(row.identity, identity)
      )
        return row;
    } catch {
      /* Remain unsent until the same identity is acknowledged. */
    }
  }
  // Both RPCs positively rolled back. No settlement was sent, regardless
  // of tournament format. A lost reply mixed with contention stays unknown.
  if (busyResponses === 2) {
    throw new TerminalPrepareBusyError();
  }
  throw new TerminalIntentUnknownError(
    'Original terminal intent acknowledgement is unknown',
    identity
  );
}

export async function executeDurableTerminalRequest(
  request: DurableTerminalRequest
): Promise<{ data: unknown; error: unknown }> {
  const result = await maintenanceSupabase.rpc(
    request.identity.kind === 'satellite_qualifiers'
      ? 'fn_execute_capped_satellite_terminal_request'
      : 'fn_execute_tournament_terminal_request',
    {
      p_request_id: request.requestId,
      p_generation: request.currentGeneration,
    }
  );
  if (result.error) return result;
  const row = acknowledged(result.data, request);
  if (!row || row.phase !== 'committed')
    return { data: null, error: new Error('Terminal execution acknowledgement is unproven') };
  return { data: object(result.data).receipt, error: null };
}

export async function resolveDurableTerminalRequest(
  request: DurableTerminalRequest
): Promise<{ data: unknown; error: unknown }> {
  const result = await maintenanceSupabase.rpc('fn_resolve_tournament_terminal_request', {
    p_request_id: request.requestId,
  });
  if (result.error) return result;
  if (!acknowledged(result.data, request))
    return { data: null, error: new Error('Terminal resolver identity is unproven') };
  return { data: object(result.data).outcome, error: null };
}

/** Only a committed close acknowledgement permits the caller to release its
 * finish guard. A queued old execution must then observe CLOSED in SQL. */
export async function closeDurableTerminalRequest(
  request: DurableTerminalRequest
): Promise<boolean> {
  try {
    const { data, error } = await maintenanceSupabase.rpc(
      'fn_close_uncommitted_tournament_terminal_request',
      {
        p_request_id: request.requestId,
        p_generation: request.currentGeneration,
      }
    );
    const row = !error ? acknowledged(data, request) : null;
    const outcome = object(object(data).outcome);
    return (
      row?.phase === 'closed' &&
      outcome.ok === true &&
      outcome.tournament_id === request.identity.tournamentId &&
      outcome.definitively_not_committed === true &&
      outcome.receipt === null &&
      ['RUNNING', 'COMPLETING'].includes(outcome.status)
    );
  } catch {
    return false;
  }
}

/** Process-root read does not grant manager authority or authorize money. */
export const readDurableTerminalRequest = bindToProcessRoot(
  async (tournamentId: string): Promise<DurableTerminalRequest | null> => {
    const { data, error } = await maintenanceSupabase.rpc('fn_read_tournament_terminal_request', {
      p_tournament_id: tournamentId,
    });
    const value = object(data);
    if (
      error ||
      value.ok !== true ||
      value.tournament_id !== tournamentId ||
      typeof value.found !== 'boolean'
    )
      throw new Error('Original terminal request read is unproven');
    if (!value.found) return null;
    const row = parseDurableTerminalRequest(value.request, tournamentId);
    if (!row) throw new Error('Original terminal request identity is unproven');
    return row.phase === 'prepared' ? row : null;
  }
);

export async function adoptDurableTerminalRequest(
  request: DurableTerminalRequest
): Promise<DurableTerminalRequest> {
  const authority = currentTournamentDataAuthority();
  if (!authority || authority.tournamentId !== request.identity.tournamentId)
    throw new Error('Terminal continuation requires admitted manager authority');
  const expected = { ...request, currentGeneration: authority.leaseGeneration };
  const { data, error } = await maintenanceSupabase.rpc('fn_adopt_tournament_terminal_request', {
    p_request_id: request.requestId,
    p_previous_generation: request.currentGeneration,
    p_generation: authority.leaseGeneration,
  });
  const row = !error ? acknowledged(data, expected) : null;
  if (!row)
    throw new TerminalIntentUnknownError(
      'Terminal successor acknowledgement is unproven',
      request.identity
    );
  return row;
}
