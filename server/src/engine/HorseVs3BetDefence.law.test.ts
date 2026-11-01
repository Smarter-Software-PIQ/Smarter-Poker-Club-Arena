/**
 * V73 THE OPENER FACING A 3-BET (2026-11-01): the three things the new
 * continue width may never change.
 *
 *  1. Dan 2026-10-25: "THE ONE HORSE SHOULD BE FOLDING TO A HUGE THREE BET
 *     WITH KQO." An opener's offsuit unpaired hand other than AKo / AQo still
 *     folds to a big 3-bet, whatever the width says.
 *  2. Dan 2026-10-25, deep 5-bet discipline: facing a 4-bet or more the
 *     decision is exactly what it was. V73 reads the 3-bet node only.
 *  3. Dan 2026-10-27, one policy for every opponent: who the players are
 *     (horse or human) never changes the answer.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import {
  fiveBetStateFor,
  holeFor,
  stateFor,
  type Vs3Ctx,
} from './HorseVs3BetDefence.test-support.js';

const CASH6: Vs3Ctx = {
  seats: 6,
  stackBB: 100,
  mode: 'cash',
  ante: false,
  openBB: 2.5,
  threeBetX: 4,
};
const MTT9_DEEP: Vs3Ctx = {
  seats: 9,
  stackBB: 100,
  mode: 'tournament',
  ante: true,
  openBB: 2.2,
  threeBetX: 4,
};
const STYLES = ['balanced', 'tag', 'lag', 'tricky', 'grinder'] as const;

function decide(
  build: () => ReturnType<typeof stateFor>,
  seed: number,
  style: (typeof STYLES)[number],
  opts: Record<string, unknown> = {}
) {
  const { hero, gs } = build();
  seedFastRandom(seed);
  return HorseLogic.decide(
    hero,
    gs,
    style,
    {} as never,
    {
      mind: false,
      telemetry: false,
      ...opts,
    } as never
  );
}

describe('V73 law', () => {
  it('an opener still folds dominated offsuit hands to a big 3-bet, every style and seat', () => {
    for (const style of STYLES)
      for (const [hero, three] of [
        [6, 2],
        [5, 2],
        [5, 6],
        [3, 2],
      ] as const)
        for (const cls of ['KQo', 'AJo', 'KJo', 'QJo', 'ATo', 'JTo', 'KTo'])
          for (let s = 0; s < 3; s++) {
            const d = decide(() => stateFor(CASH6, hero, three, holeFor(cls, s)), 101 + s, style);
            expect(d.action, `${style} ${cls} hero ${hero} vs ${three}`).toBe('fold');
          }
  });

  it('facing a 4-bet or more the decision is identical with the V73 read on and off', () => {
    for (const ctx of [CASH6, MTT9_DEEP]) {
      const seen = new Set<string>();
      for (const h of HAND_CLASSES)
        for (let s = 0; s < 2; s++) {
          const heroSeat = ctx.seats;
          const build = () => fiveBetStateFor(ctx, heroSeat, 2, holeFor(h.cls, s));
          const on = decide(build, 7 + s, 'balanced');
          const off = decide(build, 7 + s, 'balanced', { v73Vs3BetDefence: false });
          expect([on.action, on.amount], `${ctx.mode} ${h.cls}`).toEqual([off.action, off.amount]);
          seen.add(on.action);
        }
      // The node is a real decision, not one fixed answer (since #9065 a
      // horse whose 4-bet is re-raised never folds: it calls or re-raises).
      expect(seen.size).toBeGreaterThan(1);
    }
  });

  it('who the players are never changes the answer to a 3-bet', () => {
    for (const h of HAND_CLASSES)
      for (let s = 0; s < 2; s++) {
        const a = decide(() => stateFor(CASH6, 6, 2, holeFor(h.cls, s)), 31 + s, 'balanced');
        const b = decide(() => stateFor(CASH6, 6, 2, holeFor(h.cls, s), true), 31 + s, 'balanced');
        expect([a.action, a.amount], h.cls).toEqual([b.action, b.amount]);
      }
  });
});
