/**
 * OPPONENT HUD BACKFILL PLAN (2026-11-21, PLO-OWNER lane OPPONENT-HUD-FIX-1; AUDIT-C items 6 and 10; lead ruling
 * 18:38Z: history starts at the first PLO4/PLO5 hand). Pure: which rows scripts/opponent-hud-build.ts --apply may
 * write, decided from the ACTUAL retained hand_history rows, never from a retention assumption.
 *
 * - The backfill starts at the first PLO4/PLO5 hand hand_history holds (`firstRetainedMs`, read from the database).
 *   An --apply whose window starts later would store partial lifetimes over the stored rows: refused.
 * - A stored row with MORE hands than the rebuild holds hands the rebuild did not read (rows no longer retained, or
 *   hands the live engine counted after the rebuild's end): it is KEPT, always. There is no override: a rebuild can
 *   never wipe stored history (the old --force did, on the premise that hands with no person are purged after 7
 *   days; production keeps them, AUDIT-C item 10).
 */
export interface BackfillProfileLike {
  user: string;
  family: string;
  hands: number;
}

export interface BackfillPlan<P extends BackfillProfileLike> {
  ok: boolean;
  /** why nothing may be written (ok false) */
  refusal?: string;
  write: P[];
  kept: P[];
}

export function planOpponentHudBackfill<P extends BackfillProfileLike>(input: {
  profiles: Iterable<P>;
  /** stored hands per 'family|user' */
  storedHands: ReadonlyMap<string, number>;
  /** the window's start the rebuild read from */
  sinceMs: number;
  /** created_at of the first PLO4/PLO5 hand hand_history holds (null: none) */
  firstRetainedMs: number | null;
  /** an operator flag that asked to override (the removed --force): refused, never honoured */
  forceRequested?: boolean;
}): BackfillPlan<P> {
  const refuse = (refusal: string): BackfillPlan<P> => ({
    ok: false,
    refusal,
    write: [],
    kept: [],
  });
  if (input.forceRequested)
    return refuse(
      '--force is removed: a rebuild never replaces a stored row that holds more hands than it read (AUDIT-C item 10)'
    );
  if (!Number.isFinite(input.sinceMs)) return refuse('--since is not a time');
  if (input.firstRetainedMs !== null && input.sinceMs > input.firstRetainedMs)
    return refuse(
      `--since ${new Date(input.sinceMs).toISOString()} is after the first retained PLO4/PLO5 hand ` +
        `${new Date(input.firstRetainedMs).toISOString()}: the lifetime starts at hand one (omit --since)`
    );
  const write: P[] = [];
  const kept: P[] = [];
  for (const p of input.profiles) {
    const stored = input.storedHands.get(`${p.family}|${p.user}`);
    (stored !== undefined && stored > p.hands ? kept : write).push(p);
  }
  return { ok: true, write, kept };
}
