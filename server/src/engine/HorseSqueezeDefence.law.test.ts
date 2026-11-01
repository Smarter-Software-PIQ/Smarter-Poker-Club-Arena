/**
 * V75 THE SQUEEZED OPENER (2026-11-01): the four things the squeeze width
 * may never change.
 *
 *  1. Dan 2026-10-25: an opener's offsuit unpaired hand other than AKo / AQo
 *     still folds to a big squeeze, whatever the width says (rule 1,
 *     HorseHoldemPremiumAggression).
 *  2. Dan 2026-10-27, one policy for every opponent: who the players are
 *     (horse or human) never changes the answer.
 *  3. V75 reads the single-squeeze node only (hero opened, callers, ONE
 *     re-raise): facing a 4-bet or more the decision is exactly what it was,
 *     Dan's 2026-10-25 deep 5-bet discipline included.
 *  4. The explicit off arm (v75SqueezeDefence: false) routes the squeeze
 *     node exactly where it routed before V75 existed: the same legacy
 *     branch the v73Vs3BetDefence off arm reads (on the squeeze node the two
 *     flags gate the same single read, so their off arms must be identical).
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import {
  fiveBetStateFor,
  holeFor,
  squeezeStateFor,
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
const MTT9: Vs3Ctx = {
  seats: 9,
  stackBB: 60,
  mode: 'tournament',
  ante: true,
  openBB: 2.3,
  threeBetX: 3.6,
};
const STYLES = ['balanced', 'tag', 'lag', 'tricky', 'grinder'] as const;

function decide(
  build: () => ReturnType<typeof squeezeStateFor>,
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

describe('V75 squeeze defence keeps the owner rules', () => {
  // CASH6: hero the cutoff (seat 4), the button (5) called, the big blind
  // squeezed. MTT9: hero the hijack (6), the button (9) called, the big
  // blind squeezed.
  const spots = [
    { ctx: CASH6, hero: 4, callers: [5], three: 2 },
    { ctx: MTT9, hero: 6, callers: [9], three: 2 },
  ] as const;

  it('rule 1: a dominated offsuit hand folds to a big squeeze, every style, both formats', () => {
    for (const { ctx, hero, callers, three } of spots) {
      for (const cls of ['KQo', 'KJo', 'QJo', 'ATo']) {
        for (const style of STYLES) {
          for (let seed = 1; seed <= 6; seed++) {
            const d = decide(
              () => squeezeStateFor(ctx, hero, [...callers], three, holeFor(cls, seed)),
              seed * 101,
              style
            );
            expect(d.action, `${cls} ${style} seed ${seed} ${ctx.mode}`).toBe('fold');
          }
        }
      }
    }
  });

  it('one policy: flipping the horse/human labels never changes the answer', () => {
    for (const { ctx, hero, callers, three } of spots) {
      for (const h of HAND_CLASSES) {
        for (let seed = 1; seed <= 2; seed++) {
          const a = decide(
            () => squeezeStateFor(ctx, hero, [...callers], three, holeFor(h.cls, seed), false),
            seed * 7331,
            'balanced'
          );
          const b = decide(
            () => squeezeStateFor(ctx, hero, [...callers], three, holeFor(h.cls, seed), true),
            seed * 7331,
            'balanced'
          );
          expect(b.action, `${h.cls} seed ${seed} ${ctx.mode}`).toBe(a.action);
        }
      }
    }
  });

  it('the 4-bet-or-more node is untouched: flag on and flag off answer identically', () => {
    for (const h of HAND_CLASSES) {
      const on = decide(() => fiveBetStateFor(CASH6, 4, 2, holeFor(h.cls, 1)), 991, 'balanced', {
        v75SqueezeDefence: true,
      });
      const off = decide(() => fiveBetStateFor(CASH6, 4, 2, holeFor(h.cls, 1)), 991, 'balanced', {
        v75SqueezeDefence: false,
      });
      expect(on.action, h.cls).toBe(off.action);
      expect((on as { amount?: number }).amount, h.cls).toBe((off as { amount?: number }).amount);
    }
  });

  it('the off arm is exactly the pre-V75 route (identical to the v73 off arm on this node)', () => {
    for (const { ctx, hero, callers, three } of spots) {
      for (const h of HAND_CLASSES) {
        const v75off = decide(
          () => squeezeStateFor(ctx, hero, [...callers], three, holeFor(h.cls, 3)),
          4409,
          'balanced',
          { v75SqueezeDefence: false }
        );
        const v73off = decide(
          () => squeezeStateFor(ctx, hero, [...callers], three, holeFor(h.cls, 3)),
          4409,
          'balanced',
          { v73Vs3BetDefence: false }
        );
        expect(v75off.action, `${h.cls} ${ctx.mode}`).toBe(v73off.action);
      }
    }
  });
});
