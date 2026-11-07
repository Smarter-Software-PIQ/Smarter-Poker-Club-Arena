/**
 * LAW (Dan 2026-11-06): "I DON'T CARE HOW LONG A HAND TAKES TO FINISH... I
 * ONLY CARE HOW LONG IT TAKES TO START THE NEXT HAND DEAL AFTER THE POT IS
 * PUSHED TO THE WINNER."
 *
 * 1. The winner's display beat (1.5 s, 2 s on an all-in) is spent after the
 *    winner is named and BEFORE the pot ships: TablePage delays the ship by
 *    showdownDisplayBeatMs, and the hold counts that beat exactly once.
 * 2. The client's sweep before the ship is the shared BETS_SWEEP_MS (the real
 *    pdCollect length), not a number of its own.
 * 3. After the "+N" float lands, the hold has nothing left but the muck: no
 *    post-push pause on top of the rest.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HAND_COMPLETION as H,
  handCompletionHoldMs,
  showdownDisplayBeatMs,
} from '../src/config/handCompletionSpec';

const table = readFileSync('src/pages/TablePage.tsx', 'utf8');
const css = readFileSync('src/components/table/PotDisplay.css', 'utf8');

/** When the client's last "+N" float lands, measured from WINNERS. */
function floatLandsAt(opts: { wentToShowdown: boolean; allIn?: boolean; betsOnFelt: boolean }) {
  const read = opts.wentToShowdown ? H.SHOWDOWN_READ_BASE_MS : 0;
  const ship =
    read +
    (opts.betsOnFelt ? H.BETS_SWEEP_MS : 0) +
    showdownDisplayBeatMs({ wentToShowdown: opts.wentToShowdown, allInShowdown: opts.allIn });
  return ship + H.POT_PUSH_MS;
}

describe('the next deal follows the pushed pot', () => {
  it('the display beat is the longer of the two owner beats, and none on a fold', () => {
    expect(showdownDisplayBeatMs({ wentToShowdown: false, allInShowdown: true })).toBe(0);
    expect(showdownDisplayBeatMs({ wentToShowdown: true })).toBe(H.WINNING_CARDS_EXTRA_MS);
    expect(showdownDisplayBeatMs({ wentToShowdown: true, allInShowdown: true })).toBe(
      Math.max(H.ALL_IN_SHOWDOWN_EXTRA_MS, H.WINNING_CARDS_EXTRA_MS)
    );
  });

  it('the client ships after the sweep and the display beat, from the shared spec', () => {
    const at = table.indexOf('let shipDelayMs =');
    expect(at).toBeGreaterThan(0);
    const block = table.slice(at, at + 700);
    expect(block).toContain('HAND_COMPLETION.BETS_SWEEP_MS * getAnimationSpeed()');
    expect(block).toContain('showdownDisplayBeatMs(');
    expect(block).toContain('allInShowdown: handShowdownRef.current.allIn');
    expect(block).not.toMatch(/\b(700|1500) \* getAnimationSpeed\(\)/);
  });

  it('the sweep beat is the real collect animation', () => {
    const m = css.match(/--pd-collect-duration:\s*([\d.]+)s/);
    expect(m).not.toBeNull();
    expect(Math.round(Number(m![1]) * 1000)).toBe(H.BETS_SWEEP_MS);
  });

  it('the hold covers the float and then only the muck, on every kind of hand', () => {
    expect(H.POST_PUSH_PAUSE_MS).toBe(0);
    for (const wentToShowdown of [false, true]) {
      for (const allIn of [false, true]) {
        if (!wentToShowdown && allIn) continue;
        const hold = handCompletionHoldMs({
          wentToShowdown,
          showdownHands: 2,
          allInShowdown: allIn,
        });
        // With bets on the felt (every fold win, every called last street)
        // the float lands exactly one muck before the table is free.
        expect(hold - floatLandsAt({ wentToShowdown, allIn, betsOnFelt: true })).toBe(H.MUCK_MS);
        // A check-down ships without a sweep; the hold still covers it.
        expect(hold).toBeGreaterThanOrEqual(
          floatLandsAt({ wentToShowdown, allIn, betsOnFelt: false })
        );
      }
    }
  });
});
