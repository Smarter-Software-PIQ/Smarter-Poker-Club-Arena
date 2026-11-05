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
 * whose previous rebuild, inside REPEATED_RECOVERY_WINDOW_MS, cured exactly the
 * same signature, the ledger answers `repeat`: the caller does NOT rebuild
 * again and raises a critical, named incident instead. A different signature
 * is a different stall and is rebuilt as before. Nothing here moves a chip,
 * settles a hand or releases a slot.
 */

/** How long a recorded rebuild can make a later one a repeat. */
export const REPEATED_RECOVERY_WINDOW_MS = 60 * 60_000;

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
  | { kind: 'rebuild' }
  | { kind: 'repeat'; previousAtMs: number; previousBy: string; repeats: number };

export class RepeatedRecoveryLedger {
  private readonly last = new Map<
    string,
    { signature: string; atMs: number; by: string; repeats: number }
  >();

  /**
   * Ask before rebuilding `scopeId` (a tournament id) to cure `signature`.
   * `rebuild` is recorded at once, so two recoveries racing on the same pass
   * cannot both rebuild the same stall; `repeat` records nothing new except
   * the count, so the event keeps naming the rebuild that first failed.
   */
  decide(
    scopeId: string,
    signature: string,
    by: string,
    nowMs: number,
    lastProgressAtMs = 0
  ): RecoveryDecision {
    const previous = this.last.get(scopeId);
    if (
      signature !== '' &&
      previous !== undefined &&
      previous.signature === signature &&
      nowMs - previous.atMs < REPEATED_RECOVERY_WINDOW_MS &&
      // A hand completed after that rebuild: it worked, and this is a new stall.
      !(lastProgressAtMs > previous.atMs)
    ) {
      previous.repeats += 1;
      return {
        kind: 'repeat',
        previousAtMs: previous.atMs,
        previousBy: previous.by,
        repeats: previous.repeats,
      };
    }
    this.last.set(scopeId, { signature, atMs: nowMs, by, repeats: 0 });
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
