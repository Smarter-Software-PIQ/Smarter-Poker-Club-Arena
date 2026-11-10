/**
 * THE BUST REBUY WINDOW (Dan 2026-11-09)
 *
 * "WHEN A PLAYER LOSES ALL HIS CHIPS, THERE SHOULD BE A REALTIME CHECK OF THE
 * DATABASE TO SEE IF HE HAS CHIPS IN HIS WALLET TO REBUY, AND IF HE DOESN'T, IT
 * KICKS HIM OFF THE TABLE RIGHT AWAY. IF HE DOES GIVE THE PLAYER 20 SECONDS TO
 * REBUY BEFORE KICKING THEM OFF THE TABLE."
 *
 * One rule, two outcomes, decided once per bust from the wallet the seat was
 * bought from:
 *
 *   cannot_rebuy  the wallet is read and holds less than this table's minimum
 *                 buy-in. The seat is released at once.
 *   can_rebuy     the wallet covers the minimum. The seat is held for
 *                 BUST_REBUY_WINDOW_MS from the bust and then released. The
 *                 deadline is fixed: an open rebuy sheet does not extend it.
 *
 * An UNREADABLE wallet or an unpriced table is can_rebuy. Being wrong that way
 * costs twenty seconds of an empty chair; being wrong the other way stands up
 * a player who had the chips.
 *
 * Pure on purpose: the engine supplies the read and the clock, and this file
 * is the whole decision, so the rule can be tested without an engine.
 */

/** How long a busted cash seat that can afford a rebuy is held. */
export const BUST_REBUY_WINDOW_MS = 20_000;

export type BustRebuyVerdict = 'can_rebuy' | 'cannot_rebuy';

/**
 * @param walletBalance the seat's wallet as just read; undefined when the
 *                      read failed or returned no row for this player.
 * @param minBuyIn      the table's minimum buy-in; 0 or NaN when unknown.
 */
export function bustRebuyVerdict(
  walletBalance: number | undefined,
  minBuyIn: number
): BustRebuyVerdict {
  if (!Number.isFinite(minBuyIn) || minBuyIn <= 0) return 'can_rebuy';
  if (walletBalance === undefined || !Number.isFinite(walletBalance)) return 'can_rebuy';
  return walletBalance >= minBuyIn ? 'can_rebuy' : 'cannot_rebuy';
}

/** Is this busted seat due for release at `nowMs`? */
export function bustRebuyWindowExpired(
  verdict: BustRebuyVerdict,
  bustedAtMs: number,
  nowMs: number
): boolean {
  if (verdict === 'cannot_rebuy') return true;
  return nowMs - bustedAtMs >= BUST_REBUY_WINDOW_MS;
}

/** Milliseconds a can_rebuy seat still has, never negative. */
export function bustRebuyRemainingMs(bustedAtMs: number, nowMs: number): number {
  return Math.max(0, BUST_REBUY_WINDOW_MS - (nowMs - bustedAtMs));
}

export { cashRebuyMinimum } from '../config/cashBuyIn.js';

/**
 * A pending rebuy row is "in time" when the database stamped it no later than
 * the window's end. The row's clock is the database's and the deadline is the
 * engine's, so the comparison allows this much drift in the player's favour.
 */
export const REBUY_ROW_CLOCK_TOLERANCE_MS = 1_000;

export function rebuyRowInTime(createdAtMs: number, deadlineWallMs: number): boolean {
  if (!Number.isFinite(createdAtMs)) return true; // unreadable stamp: never refuse a payer
  return createdAtMs <= deadlineWallMs + REBUY_ROW_CLOCK_TOLERANCE_MS;
}

export interface DurableHandCommit {
  committed_at: string;
  stacks: Array<{ user_id?: string | null; stack?: number | string | null }> | null;
}
export interface DurableThaw {
  freeze_started_at: string;
  frozen_seconds: number | string;
}

/**
 * How much of a player's window has already been used, read from the record
 * an engine restart cannot lose: the newest accepted hand at this table that
 * lists the player. If it left them at zero, the bust happened when that hand
 * committed, and every maintenance freeze since then is excluded, exactly as
 * the live engine's maintenance-excluding clock would have excluded it.
 *
 * Null when the record does not show this bust (the newest listing has chips,
 * or the player is in none of the hands read): the caller then does not know
 * when the seat went to zero.
 *
 * @param commits newest first.
 */
export function durableBustElapsedMs(
  commits: DurableHandCommit[],
  thaws: DurableThaw[],
  userId: string,
  nowMs: number
): number | null {
  for (const commit of commits) {
    const entry = (commit.stacks ?? []).find((s) => s?.user_id === userId);
    if (!entry) continue;
    if (Number(entry.stack) !== 0) return null;
    const bustMs = Date.parse(commit.committed_at);
    if (!Number.isFinite(bustMs)) return null;
    let frozenMs = 0;
    for (const thaw of thaws) {
      const started = Date.parse(thaw.freeze_started_at);
      const seconds = Number(thaw.frozen_seconds);
      if (Number.isFinite(started) && started >= bustMs && Number.isFinite(seconds) && seconds > 0)
        frozenMs += seconds * 1000;
    }
    return Math.max(0, nowMs - bustMs - frozenMs);
  }
  return null;
}
