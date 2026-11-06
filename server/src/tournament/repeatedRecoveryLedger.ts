/**
 * A REBUILD THAT RECREATES THE SAME STALL IS NOT RECOVERY (2026-11-05).
 *
 * Deliberately import-free, like quarantinedTournamentManagers.ts: the law is
 * a bookkeeping map and its test must not have to start a database client.
 *
 * Sunday Deep Stack Satellite 25 (fbb86b2a) stopped dealing at 18:30Z. Three
 * independent recoveries each rebuilt it - the table zombie rebuild at 18:39Z
 * (which handed the whole event to a successor), the zombie rebuild of all
 * five tables at 18:49Z and the dark-event manager rebuild at 18:54Z - and
 * every one replayed the same retained hand into the same wait
 * (`start_wait_for_players:permit=attempted` on the same table). Each rebuild
 * cost the event a full re-adoption and told nobody that the previous rebuild
 * had already failed in exactly this way.
 *
 * Owner requirement (Dan, 2026-11-05): "Two rebuilds that return to the same
 * deadlock should trigger a different diagnostic or recovery path."
 *
 * So every rebuild of a tournament records the stall it is curing, as a
 * signature built from what the stalled tables say about themselves (loop
 * phase and permit phase, no timings). When a rebuild is asked for an event
 * whose previous rebuild cured exactly the same signature, and no hand has
 * completed since, the ledger answers `repeat`: the caller does NOT rebuild
 * yet and raises a critical, named incident instead. A different signature
 * is a different stall and is rebuilt as before. Nothing here moves a chip,
 * settles a hand or releases a slot.
 *
 * A REFUSAL IS A BACKOFF, NEVER A STOP (2026-11-06). The first version of this
 * ledger refused every repeat for a whole hour (REPEATED_RECOVERY_WINDOW_MS),
 * so an event whose stall a rebuild could not cure stood frozen for up to an
 * hour with nothing left trying. Owner rule: a tournament must never freeze.
 * A repeat is now held only for an exponential backoff measured from the last
 * rebuild of that same stall - 2, then 4, then 8 minutes, capped at 8 - and
 * then the ledger answers `rebuild` again (counting it in `repeats`), so the
 * stall is retried at a falling rate for as long as it lasts and is never
 * left standing still. The incident is still named, once per window.
 */

/** How long a recorded rebuild is remembered, and the incident's page cadence. */
export const REPEATED_RECOVERY_WINDOW_MS = 60 * 60_000;

/** The first hold after a rebuild returned to the same stall. */
export const REPEATED_RECOVERY_FIRST_BACKOFF_MS = 2 * 60_000;
/** No repeated stall is ever held longer than this between rebuilds. */
export const REPEATED_RECOVERY_MAX_BACKOFF_MS = 8 * 60_000;

/**
 * How long a stall already rebuilt `repeatedRebuilds` times after its first
 * rebuild is held before it is rebuilt again: 2, 4, 8, 8, ... minutes.
 */
export function repeatedRecoveryBackoffMs(repeatedRebuilds: number): number {
  const n = Math.max(0, Math.min(Math.floor(repeatedRebuilds), 8));
  return Math.min(REPEATED_RECOVERY_FIRST_BACKOFF_MS * 2 ** n, REPEATED_RECOVERY_MAX_BACKOFF_MS);
}

/** The stall a rebuild is curing, stable across rebuilds of the same cause. */
export function stallSignature(stalls: Iterable<{ tableId: string; stalledAt: string }>): string {
  const parts = new Set<string>();
  for (const { tableId, stalledAt } of stalls) {
    // A table with no engine, or one that could not say where it stopped,
    // proves nothing about sameness: the whole signature is unknown, and an
    // unknown signature is never a repeat (admission has its own backoff).
    if (stalledAt === 'no_engine' || stalledAt === 'unknown' || !stalledAt) return '';
    // Seconds are never part of a signature; they differ on every rebuild.
    parts.add(`${tableId}=${String(stalledAt).replace(/\+\d+s\b/g, '')}`);
  }
  return [...parts].sort().join('|');
}

export type RecoveryDecision =
  /** `repeatedRebuilds` > 0: this rebuild retries a stall a rebuild did not cure. */
  | { kind: 'rebuild'; repeatedRebuilds?: number }
  | {
      kind: 'repeat';
      previousAtMs: number;
      previousBy: string;
      repeats: number;
      /** When the held stall is rebuilt again; never more than 8 minutes away. */
      retryAtMs: number;
    };

export class RepeatedRecoveryLedger {
  private readonly last = new Map<
    string,
    {
      signature: string;
      atMs: number;
      by: string;
      /** Refused asks since the first rebuild of this stall. */
      repeats: number;
      /** Rebuilds of this same stall after its first one. */
      rebuilds: number;
    }
  >();

  /**
   * Ask before rebuilding `scopeId` (a tournament id) to cure `signature`.
   * `rebuild` is recorded at once, so two recoveries racing on the same pass
   * cannot both rebuild the same stall; `repeat` records nothing new except
   * the count, so the event keeps naming the rebuild that first failed. A
   * `repeat` lasts only until its backoff ends (repeatedRecoveryBackoffMs);
   * the next ask after that rebuilds the same stall again.
   */
  decide(
    scopeId: string,
    signature: string,
    by: string,
    nowMs: number,
    lastProgressAtMs = 0
  ): RecoveryDecision {
    const previous = this.last.get(scopeId);
    const sameUncuredStall =
      signature !== '' &&
      previous !== undefined &&
      previous.signature === signature &&
      nowMs - previous.atMs < REPEATED_RECOVERY_WINDOW_MS &&
      // A hand completed after that rebuild: it worked, and this is a new stall.
      !(lastProgressAtMs > previous.atMs);
    if (sameUncuredStall) {
      const retryAtMs = previous.atMs + repeatedRecoveryBackoffMs(previous.rebuilds);
      if (nowMs < retryAtMs) {
        previous.repeats += 1;
        return {
          kind: 'repeat',
          previousAtMs: previous.atMs,
          previousBy: previous.by,
          repeats: previous.repeats,
          retryAtMs,
        };
      }
      // The hold is over: rebuild the same stall again, and hold the next
      // repeat twice as long (capped). The first failed rebuild stays named.
      previous.atMs = nowMs;
      previous.rebuilds += 1;
      return { kind: 'rebuild', repeatedRebuilds: previous.rebuilds };
    }
    this.last.set(scopeId, { signature, atMs: nowMs, by, repeats: 0, rebuilds: 0 });
    return { kind: 'rebuild' };
  }

  /** The event made progress: its next stall is a new one. */
  forget(scopeId: string): void {
    this.last.delete(scopeId);
  }

  /** Drop rebuild records older than the window. */
  prune(nowMs: number): void {
    for (const [scopeId, entry] of this.last)
      if (nowMs - entry.atMs >= REPEATED_RECOVERY_WINDOW_MS) this.last.delete(scopeId);
  }

  get size(): number {
    return this.last.size;
  }
}
