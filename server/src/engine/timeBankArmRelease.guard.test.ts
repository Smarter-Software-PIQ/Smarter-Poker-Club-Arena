/**
 * AN ARMED TIME BANK MUST BE RELEASED WHEN THE PLAYER ACTS (2026-08-26).
 *
 * Pressing the time-bank button while the ordinary clock still has time on it
 * does not spend anything - activateTimeBank's arm-only branch records the
 * INTENT (bank.armed = true) and returns "Time Bank Armed. It Starts When Your
 * Clock Runs Out". Critically it returns BEFORE timeBankActivatedThisTurn is
 * set, because nothing was spent.
 *
 * handlePlayerAction then gated its call to timeBankEngine.playerActed on
 * timeBankActivatedThisTurn alone. playerActed is the only thing that clears
 * bank.armed. So: press early, act in time, and the intent survives into a
 * LATER turn on the same street, where onPrimaryTimerExpired redeems it and
 * burns a use the player never asked to spend.
 *
 * This is a source guard rather than a behavioural test because the defect is
 * in the CALLER's condition, not in TimeBankEngine - whose own contract is
 * already pinned by TimeBankEngine.manualcountdown.test.ts ("player acted in
 * time; the intent dies with it").
 *
 * 2026-11-05: the gate was widened once more, to nothing. See
 * aClockExpiryBelongsToItsTurn.test.ts for the orphaned countdown it hid.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  fileURLToPath(new URL('./ServerTableEngineTurns.ts', import.meta.url)),
  'utf8'
);

describe('releasing an armed-but-unspent time bank', () => {
  it('handlePlayerAction reaches playerActed unconditionally: armed, activated, or neither', () => {
    // 2026-11-05: the gate (timeBankActivatedThisTurn || isArmed) is gone. A
    // bank can be active with a live countdown and neither flag set (a
    // deferred activation published onto a turn that handleTurnChange then
    // reset), and that orphan fired 20 s later over the brain's next
    // decision. playerActed is idempotent, so the call is now unconditional on
    // both the human and the horse path.
    const call = 'this.timeBankEngine.playerActed(this.tableId, userId);';
    const calls = src.split(call).length - 1;
    expect(calls, 'the playerActed calls in handlePlayerAction and settleHorseSeatActed').toBe(2);
    const guarded = new RegExp(
      String.raw`if \([^{]*\)\s*\{\s*` + call.replace(/[.()]/g, (c) => '\\' + c)
    );
    expect(
      src,
      'playerActed is gated again: an active bank with the flag off would leak'
    ).not.toMatch(guarded);
  });

  it('the arm-only branch still returns without claiming anything was spent', () => {
    // If this ever starts setting timeBankActivatedThisTurn, the reader should know.
    expect(src).toContain('Time Bank Armed. It Starts When Your Clock Runs Out');
  });
});
