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
