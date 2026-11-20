/**
 * LEASE HANDOFF STORE: the database half of a rolling engine handoff.
 *
 * Ownership of a table (or of a tournament, whose manager owns all of its
 * tables) is the existing protocol-2 lease row. A handoff is ONE atomic
 * compare-and-set on that row, done by the instance that holds it, at a hand
 * boundary it has already proven:
 *
 *   (from_instance, from_generation, fresh)  ->  (to_instance, to_generation)
 *
 * The successor then claims with `claim_table_lease_v2` /
 * `claim_tournament_lease_v2` using exactly `to_generation`, which those
 * functions already treat as a renewal of its own row. No existing lease
 * function changes. If the successor never claims, the row goes stale after
 * the audited 30 seconds and ordinary discovery takes it, exactly as after a
 * crash.
 *
 * Every answer is parsed fail-closed. A transport error is `unknown`, never a
 * refusal: the CAS may have committed (CLAUDE.md 10.86, "I could not tell" is
 * not "no"). The SQL is idempotent for an exact replay, so the caller may ask
 * again with the same request and learn the truth.
 *
 * SQL: supabase/migrations/20261119211200_an_engine_hands_a_table_on_at_its_own_hand_boundary.sql
 */
import type { BoundaryFingerprint, HandoffScope } from './RollingHandoffCoordinator.js';

export type HandOffKind = 'handoff' | 'return';

export interface HandOffRequest {
  scope: HandoffScope;
  leaseKey: string;
  fromInstance: string;
  fromGeneration: string;
  toInstance: string;
  toVersion: string;
  toGeneration: string;
  fingerprint: BoundaryFingerprint | null;
  kind: HandOffKind;
  /** The handoff this one returns, for `kind: 'return'`. */
  parentId: string | null;
}

export type HandOffResult =
  | { status: 'transferred'; handoffId: string }
  | { status: 'refused'; reason: string }
  | { status: 'unknown'; detail: string };

export interface HandedLease {
  handoffId: string;
  scope: HandoffScope;
  leaseKey: string;
  fromInstance: string;
  toGeneration: string;
  fingerprint: BoundaryFingerprint | null;
  kind: HandOffKind;
}

export type HandoffSettlement = 'adopted' | 'abandoned';

export interface LeaseHandoffStore {
  handOff(request: HandOffRequest): Promise<HandOffResult>;
  /** Live handoffs addressed to this instance whose lease row still names it. */
  handedTo(instanceId: string): Promise<HandedLease[]>;
  settle(
    handoffId: string,
    instanceId: string,
    outcome: HandoffSettlement,
    detail: string
  ): Promise<boolean>;
  /** Live moves from or to this instance that nobody has settled yet. Throws when unreadable. */
  openHandoffs(instanceId: string): Promise<number>;
}

export interface LeaseHandoffRpc {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asFingerprint(value: unknown): BoundaryFingerprint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as { seats?: unknown; clock?: unknown };
  if (!Array.isArray(raw.seats)) return null;
  const seats: BoundaryFingerprint['seats'] = [];
  for (const seat of raw.seats) {
    if (!seat || typeof seat !== 'object') return null;
    const s = seat as Record<string, unknown>;
    if (typeof s.seat !== 'number' || typeof s.userId !== 'string' || typeof s.stack !== 'number')
      return null;
    seats.push({
      seat: s.seat,
      userId: s.userId,
      stack: s.stack,
      ...(typeof s.tableId === 'string' ? { tableId: s.tableId } : {}),
    });
  }
  let clock: BoundaryFingerprint['clock'] = null;
  if (raw.clock && typeof raw.clock === 'object') {
    const c = raw.clock as Record<string, unknown>;
    if (
      typeof c.level !== 'number' ||
      typeof c.levelStartedAtMs !== 'number' ||
      typeof c.onBreak !== 'boolean'
    )
      return null;
    clock = { level: c.level, levelStartedAtMs: c.levelStartedAtMs, onBreak: c.onBreak };
  }
  return { seats, clock };
}

/** PostgREST store over the three migration functions. */
export function createLeaseHandoffStore(client: LeaseHandoffRpc): LeaseHandoffStore {
  return {
    async handOff(request) {
      try {
        const { data, error } = await client.rpc('fn_engine_hand_off_lease_v1', {
          p_scope: request.scope,
          p_lease_key: request.leaseKey,
          p_from_instance: request.fromInstance,
          p_from_generation: request.fromGeneration,
          p_to_instance: request.toInstance,
          p_to_version: request.toVersion,
          p_to_generation: request.toGeneration,
          p_fingerprint: request.fingerprint ?? {},
          p_kind: request.kind,
          p_parent_id: request.parentId,
        });
        if (error) return { status: 'unknown', detail: String(error.message ?? 'rpc error') };
        const row = data as { ok?: unknown; handoff_id?: unknown; reason?: unknown } | null;
        if (!row || typeof row !== 'object' || typeof row.ok !== 'boolean')
          return { status: 'unknown', detail: 'malformed handoff answer' };
        if (row.ok) {
          if (typeof row.handoff_id !== 'string' || !UUID.test(row.handoff_id))
            return { status: 'unknown', detail: 'a transfer answer named no handoff id' };
          return { status: 'transferred', handoffId: row.handoff_id.toLowerCase() };
        }
        return {
          status: 'refused',
          reason: typeof row.reason === 'string' ? row.reason : 'unspecified',
        };
      } catch (err) {
        return { status: 'unknown', detail: err instanceof Error ? err.message : String(err) };
      }
    },

    async handedTo(instanceId) {
      const { data, error } = await client.rpc('fn_engine_handed_leases_v1', {
        p_to_instance: instanceId,
      });
      if (error)
        throw new Error(`fn_engine_handed_leases_v1 failed: ${error.message ?? 'rpc error'}`);
      if (!Array.isArray(data))
        throw new Error('fn_engine_handed_leases_v1 returned no rows array');
      const out: HandedLease[] = [];
      for (const raw of data) {
        const r = raw as Record<string, unknown>;
        if (
          typeof r.handoff_id !== 'string' ||
          !UUID.test(r.handoff_id) ||
          (r.scope !== 'table' && r.scope !== 'tournament') ||
          typeof r.lease_key !== 'string' ||
          !UUID.test(r.lease_key) ||
          typeof r.from_instance !== 'string' ||
          typeof r.to_generation !== 'string' ||
          !UUID.test(r.to_generation) ||
          (r.kind !== 'handoff' && r.kind !== 'return')
        ) {
          // One unreadable row is skipped, never guessed at: its lease simply
          // goes stale and ordinary discovery recovers the table.
          continue;
        }
        out.push({
          handoffId: r.handoff_id.toLowerCase(),
          scope: r.scope,
          leaseKey: r.lease_key.toLowerCase(),
          fromInstance: r.from_instance,
          toGeneration: r.to_generation.toLowerCase(),
          fingerprint: asFingerprint(r.fingerprint),
          kind: r.kind,
        });
      }
      return out;
    },

    async openHandoffs(instanceId) {
      const { data, error } = await client.rpc('fn_engine_open_lease_handoffs_v1', {
        p_instance: instanceId,
      });
      if (error)
        throw new Error(`fn_engine_open_lease_handoffs_v1 failed: ${error.message ?? 'rpc error'}`);
      const n = typeof data === 'number' ? data : Number(data);
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error('fn_engine_open_lease_handoffs_v1 returned no count');
      return n;
    },

    async settle(handoffId, instanceId, outcome, detail) {
      try {
        const { data, error } = await client.rpc('fn_engine_settle_lease_handoff_v1', {
          p_handoff_id: handoffId,
          p_instance: instanceId,
          p_outcome: outcome,
          p_detail: detail,
        });
        if (error) return false;
        return (data as { ok?: unknown } | null)?.ok === true;
      } catch {
        return false;
      }
    },
  };
}

export { asFingerprint as _parseFingerprintForTests };
