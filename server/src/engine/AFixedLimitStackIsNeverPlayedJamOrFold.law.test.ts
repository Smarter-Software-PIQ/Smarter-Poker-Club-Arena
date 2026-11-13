/**
 * HU-FL-001 (variants audit, 2026-11-13). Fixed limit has no jam: a raise is
 * one bet whatever the stack. The no-limit jam-or-fold gate (HorsePreflop
 * legacyPushFold / legacyOrangeJam) and the pot-limit commitment zone (ploT)
 * had no fixed-limit exclusion, so a short fixed-limit stack was played
 * jam-or-fold: heads-up at 10 big blinds the small blind folded 88 percent
 * (cash) and the big blind folded 87 to 91 percent to ONE small bet at 3 to 1
 * (tournament, 10 to 20 big blinds), against 38 to 58 percent one step deeper.
 *
 * Law: in a fixed-limit game the heads-up preflop fold share does not depend
 * on a short stack the way a jam decision does, and no fixed-limit preflop
 * decision announces an all-in with more than five big blinds behind.
 * Pins no frequency: it compares the engine with itself across depth.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { BB, deal, decide, lcg, menuOf, type Fmt } from './HuVariantSpot.test-support.js';

const N = 160;
function sweep(variant: string, fmt: Fmt, depth: number) {
  let sbFold = 0,
    bbFold = 0,
    jams = 0;
  for (let i = 0; i < N; i++) {
    const t = deal({
      variant,
      fmt,
      stacks: [depth * BB, depth * BB],
      rnd: lcg(20261113 + i * 7919),
    });
    const sb = decide(t, 1 + i);
    if (sb.d.action === 'fold') sbFold++;
    if (sb.d.action === 'all_in' && sb.hero.stack > 5 * BB) jams++;
    t.controller.performAction(1, 'raise', menuOf(t).minRaiseTo ?? undefined, 'player');
    const bb = decide(t, 1001 + i);
    if (bb.d.action === 'fold') bbFold++;
    if (bb.d.action === 'all_in' && bb.hero.stack > 5 * BB) jams++;
  }
  return { sbFold: sbFold / N, bbFold: bbFold / N, jams };
}
afterEach(() => HorseMind.reset());

describe('a fixed-limit stack is never played jam-or-fold', () => {
  it.each([
    ['flh', 'cash', 10],
    ['flh', 'tournament', 10],
    ['flh', 'tournament', 15],
    ['flh', 'tournament', 20],
    ['flo8', 'tournament', 10],
    ['flo8', 'tournament', 15],
  ] as [string, Fmt, number][])(
    '%s %s at %d big blinds folds like the same game at 30',
    (variant, fmt, depth) => {
      const short = sweep(variant, fmt, depth);
      const deep = sweep(variant, fmt, 30);
      expect(short.jams).toBe(0);
      expect(Math.abs(short.sbFold - deep.sbFold)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(short.bbFold - deep.bbFold)).toBeLessThanOrEqual(0.15);
    },
    120_000
  );
});
