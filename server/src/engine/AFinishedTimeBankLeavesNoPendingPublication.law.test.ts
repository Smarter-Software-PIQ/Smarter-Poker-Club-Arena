/**
 * A FINISHED TIME BANK LEAVES NO PENDING PUBLICATION (2026-11-05).
 *
 * WHAT WAS WRONG, READ FROM PRODUCTION ROWS
 *
 * On 2026-11-05 engine_recovery_events held 119 `seat N had no clock after
 * ~50s; re-armed` rows on Spin / Sit & Go / MTT tables between 03:00 and
 * 17:00 UTC (still about four an hour after the 14:50 release). Every one of
 * the twelve most recent was read hand by hand from hand_history, and in all
 * twelve the frozen seat had TIMED OUT on its previous decision (an action
 * landing ~17.5 s after the one before it: the 15 s clock plus the settle
 * beat). On that seat's very next decision there was no clock at all, the
 * table sat still until the watchdog's ~50 s stall check re-armed it, and the
 * hand then went on.
 *
 * THE MECHANISM
 *
 * A clock that runs out on a tournament table (which retains every original
 * hand through HandContinuationLane) auto-activates the time bank with
 * `deferPublication = true`: the bank is allocated (`isActive`) and flagged
 * `pendingPublication` until its bytes are retained. If the seat then acts or
 * is auto-folded before that publication happens, `playerActed()` turns the
 * bank off (`isActive = false`) but left `pendingPublication = true`. The same
 * was true of `onTimeBankExpired()`.
 *
 * On the seat's next TURN_CHANGE, `handleTurnChange` saw `pendingPublication`
 * and took the "publish the already-allocated bank" branch instead of arming
 * the ordinary turn clock. `resumeDeferredPublication()` then refused because
 * the bank was not active, so NOTHING was armed: no clock, no Horse decision,
 * no auto-fold. It also broadcast a phantom "time bank activated" frame.
 *
 * THE RULE THIS FILE PINS
 *
 *   1. A bank that is not active has nothing waiting to be published.
 *      playerActed() and expiry clear `pendingPublication`.
 *   2. handleTurnChange only takes the deferred-publication branch for a bank
 *      that is actually active; anything else gets the ordinary clock.
 */
import { describe, expect, it } from 'vitest';
import { TimeBankEngine } from './TimeBankEngine.js';
import { PreciseActionTimer } from './PreciseActionTimer.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TABLE = 'eeeeeeee-1105-4000-8000-00000000c10c';
const noop = () => {};

function bankFor(playerId = 'u1') {
  const timer = new PreciseActionTimer();
  const tbe = new TimeBankEngine(timer);
  tbe.initializePlayer(TABLE, playerId, { remainingSeconds: 100, usesRemaining: 5 });
  return { tbe, timer };
}

describe('a finished time bank leaves no pending publication', () => {
  it('an automatic deferred bank the seat then acts through is not still pending', () => {
    const { tbe, timer } = bankFor();
    expect(tbe.tryActivate(TABLE, 'u1', noop, 0, 'automatic', true)).toBe('activated');
    expect(tbe.getPlayerBank(TABLE, 'u1')?.pendingPublication).toBe(true);

    // The seat is auto-folded / acts before the deferred bank is published.
    tbe.playerActed(TABLE, 'u1');

    const bank = tbe.getPlayerBank(TABLE, 'u1')!;
    expect(bank.isActive).toBe(false);
    expect(bank.pendingPublication).toBe(false);
    // And nothing can resurrect it as a phantom publication next turn.
    expect(tbe.resumeDeferredPublication(TABLE, 'u1', noop)).toBeNull();
    timer.dispose();
  });

  it('a published bank that expires is not left pending either', () => {
    const { tbe, timer } = bankFor();
    expect(tbe.tryActivate(TABLE, 'u1', noop, 0, 'automatic', true)).toBe('activated');
    expect(tbe.resumeDeferredPublication(TABLE, 'u1', noop)).not.toBeNull();
    // Expire it the way the countdown does.
    (tbe as unknown as { onTimeBankExpired(t: string, p: string): void }).onTimeBankExpired(
      TABLE,
      'u1'
    );
    const bank = tbe.getPlayerBank(TABLE, 'u1')!;
    expect(bank.isActive).toBe(false);
    expect(bank.pendingPublication).toBe(false);
    timer.dispose();
  });

  it('cancelling every active bank at hand end clears a pending publication', () => {
    const { tbe, timer } = bankFor();
    expect(tbe.tryActivate(TABLE, 'u1', noop, 0, 'automatic', true)).toBe('activated');
    tbe.cancelActiveForTable(TABLE);
    expect(tbe.getPlayerBank(TABLE, 'u1')?.pendingPublication).toBe(false);
    timer.dispose();
  });

  it('the turn handler only treats an ACTIVE bank as awaiting publication', () => {
    // Source pin: the deferred-publication branch in handleTurnChange must be
    // gated on the bank being active, so a stale flag can never take the
    // ordinary clock away from a seat.
    const src = readFileSync(
      fileURLToPath(new URL('./ServerTableEngineTurns.ts', import.meta.url)),
      'utf8'
    );
    expect(src).toMatch(
      /pendingBank\?\.isActive\s*&&\s*pendingBank\.pendingPublication\s*&&\s*this\.handContinuation/
    );
  });
});
