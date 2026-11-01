/**
 * V76 THE 4-BET-BLUFF BAND IS RETIRED AT THE SOURCE (2026-11-01, Dan
 * 2026-10-31 rule 4: "STOP 4 BETTING POTS IF THEY ARE FOLDING"):
 *
 *  1. The only thing retirement may do is DE-ESCALATE: on the facing-a-3-bet
 *     node every decision is either exactly what the band arm gave, or a
 *     call / fold where the band arm 4-bet. Never a new raise, never a new
 *     size.
 *  2. Value 4-bets survive: premiums still re-raise the 3-bet (rule 2).
 *  3. One policy for every opponent: flipping horse/human labels never
 *     changes the answer.
 *  4. The explicit off arm really restores the band (historical corpora).
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { holeFor, stateFor, type Vs3Ctx } from './HorseVs3BetDefence.test-support.js';

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
  stackBB: 80,
  mode: 'tournament',
  ante: true,
  openBB: 2.3,
  threeBetX: 3.6,
};

function decide(
  ctx: Vs3Ctx,
  heroSeat: number,
  threeSeat: number,
  cls: string,
  seed: number,
  opts: Record<string, unknown> = {},
  flip = false
) {
  const { hero, gs } = stateFor(ctx, heroSeat, threeSeat, holeFor(cls, seed), flip);
  seedFastRandom(seed * 7919 + heroSeat * 104729 + cls.charCodeAt(0) * 131);
  return HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {} as never,
    {
      mind: false,
      telemetry: false,
      ...opts,
    } as never
  ) as { action: string; amount?: number };
}

const isRaise = (a: string) => a === 'raise' || a === 'bet' || a === 'all_in';

describe('V76 retiring the 4-bet-bluff band keeps the owner rules', () => {
  const spots = [
    { ctx: CASH6, hero: 4, three: 2 },
    { ctx: MTT9, hero: 6, three: 2 },
  ] as const;

  it('retirement only de-escalates: same answer, or call/fold where the band 4-bet', () => {
    // Since rule 4a (2026-11-01) the final layer already converted every
    // band 4-bet to a call, so at the output the two arms usually agree;
    // this pins that retirement never ESCALATES anything and never changes
    // a raise's size.
    for (const { ctx, hero, three } of spots) {
      for (const h of HAND_CLASSES) {
        for (let seed = 1; seed <= 8; seed++) {
          const on = decide(ctx, hero, three, h.cls, seed);
          const off = decide(ctx, hero, three, h.cls, seed, {
            v76RetireFourBetBluffBand: false,
          });
          if (on.action === off.action) {
            // The retirement gate sits after the band's rand() roll, so both
            // arms draw identical streams; the sizing law is on RAISES. A
            // matching 'call' can still differ in representation: the off
            // arm's band 4-bet is converted by rule 4a into a call carrying
            // an explicit amount, the on arm's native call leaves the forced
            // price to the engine - the same chips either way.
            if (isRaise(on.action)) {
              expect(on.amount, `${h.cls} seed ${seed} ${ctx.mode}`).toBe(off.amount);
            }
          } else {
            expect(
              isRaise(off.action) || off.action === 'call',
              `${h.cls} seed ${seed} ${ctx.mode} ${off.action}->${on.action}`
            ).toBe(true);
            expect(['call', 'fold']).toContain(on.action);
          }
        }
      }
    }
  });

  it('the band is really retired: its raise-to-call conversions disappear, the off arm restores them', () => {
    type Graphed = {
      action: string;
      policyGraph?: {
        transitions: Array<{
          node: string;
          changed?: boolean;
          before?: { action?: string };
          after: { action?: string };
        }>;
      };
    };
    const conversions = (opts: Record<string, unknown>) => {
      let n = 0;
      for (const { ctx, hero, three } of spots) {
        for (const h of HAND_CLASSES) {
          for (let seed = 1; seed <= 10; seed++) {
            const d = decide(ctx, hero, three, h.cls, seed, opts) as Graphed;
            const t = d.policyGraph?.transitions.find((x) => x.node === 'wager_rules' && x.changed);
            if (t?.before?.action === 'raise' && t.after.action === 'call') n++;
          }
        }
      }
      return n;
    };
    // The fail-safe stays in force for the OTHER source of sized 4-bets the
    // owner rules convert (the value branch can clear its bar with JJ / AQs
    // grade hands under the exploit and pressure reads), so retirement does
    // not drive the count to zero - it removes the band's share of it. The
    // off arm restores the band, or the gate is dead code.
    const off = conversions({ v76RetireFourBetBluffBand: false });
    const on = conversions({});
    expect(off).toBeGreaterThan(on);
  });

  it('value 4-bets survive: premiums still re-raise the 3-bet', () => {
    for (const { ctx, hero, three } of spots) {
      for (const cls of ['AA', 'KK']) {
        let raised = 0;
        for (let seed = 1; seed <= 6; seed++) {
          if (isRaise(decide(ctx, hero, three, cls, seed).action)) raised++;
        }
        expect(raised, `${cls} ${ctx.mode}`).toBeGreaterThan(0);
      }
    }
  });

  it('one policy: flipping the horse/human labels never changes the answer', () => {
    for (const { ctx, hero, three } of spots) {
      for (const h of HAND_CLASSES) {
        const a = decide(ctx, hero, three, h.cls, 3, {}, false);
        const b = decide(ctx, hero, three, h.cls, 3, {}, true);
        expect(b.action, `${h.cls} ${ctx.mode}`).toBe(a.action);
      }
    }
  });
});
