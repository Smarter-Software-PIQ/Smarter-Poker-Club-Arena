/**
 * LAW: FIXED-LIMIT PREFLOP IS PRICED (Fixed-Limit lane W5, 2026-11-15;
 * HorseDecideOpts.fixedLimitPricedPreflop, read `=== true`, DEFAULT OFF).
 *
 * Main decides fixed-limit preflop on the no-limit percentile bars: the
 * heads-up button folds 27% (flh) / 57% (flo8) first in, the six-handed flh
 * button opens ~19% against 40-48% in standard limit charts, and the big
 * blind folds 30-42% to one raise at 3.5 to 1, because the fold-rescue guard
 * stops at a price of 0.22 and the big blind's price is 2/9 = 0.2222.
 *
 * With the option on (HorseFixedLimitPreflop.ts), on real HandController
 * fixed-limit tables decided by the real HorseLogic.decide (live Hybrid cash
 * persona, seeded deals):
 *  - first-in raise shares by seat land inside FIXED_LIMIT_OPEN_REFERENCE +/-
 *    FIXED_LIMIT_OPEN_BAND (six-max UTG to small blind, full-ring UTG,
 *    heads-up button), and the small blind folded to completes a band;
 *  - a big blind facing one button raise at 3.5 to 1 (heads-up at 3 to 1)
 *    never folds a hand whose realized equity clears the price even at the
 *    worst jitter, and folds less often than main;
 *  - under the same option the phase12 pack's round-3 entry rules retain the
 *    priced reference in fixed limit (FL-PRE-02), and only there.
 * Off (absent or false) is the old answer; no-limit and pot-limit decisions
 * are identical with the option on.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { deal, decide, lcg, menuOf, type Table } from './HuVariantSpot.test-support.js';
import {
  FIXED_LIMIT_OPEN_BAND,
  FIXED_LIMIT_OPEN_REFERENCE,
  fixedLimitBlindDefence,
  fixedLimitOpenShare,
  type FixedLimitPreflopVariant,
} from './HorseFixedLimitPreflop.js';
import { holdemPreflopScore, omahaElitePreflopStrength } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { evaluateRemainingVariantPolicy } from './remainingVariants/RemainingVariantLivePolicy.js';
import type { HorseDecision } from '../types.js';

const ON = { fixedLimitPricedPreflop: true } as const;
const VARIANTS: FixedLimitPreflopVariant[] = ['flh', 'flo8'];
const DEALS = 400;

function foldTo(t: Table, seat: number): void {
  for (let k = 0; k < 12; k++) {
    const cur = t.controller.getCurrentPlayer()!;
    if (cur.seat === seat) return;
    t.controller.performAction(cur.seat, 'fold', undefined, 'player');
  }
  throw new Error(`seat ${seat} never reached`);
}

function table(variant: string, n: number, seed: number): Table {
  return deal({ variant, fmt: 'cash', stacks: Array(n).fill(200), rnd: lcg(seed) });
}

function heroCards(t: Table, seat: number): Card[] {
  return t.controller.getState().players.find((p) => p.seat === seat)!.cards;
}

function strengthOf(variant: FixedLimitPreflopVariant, c: Card[]): number {
  return variant === 'flh'
    ? holdemPreflopScore(c[0], c[1], false)
    : omahaElitePreflopStrength(c, true);
}

/** First-in shares at one seat: raise and (small blind) complete. */
function firstIn(variant: string, n: number, seat: number, opts: object) {
  let raise = 0;
  let complete = 0;
  for (let i = 0; i < DEALS; i++) {
    const t = table(variant, n, 7000 + i);
    foldTo(t, seat);
    const { d } = decide(t, 9000 + i, opts);
    if (d.action === 'raise' || d.action === 'bet') raise++;
    else if (d.action === 'call') complete++;
  }
  return { raise: raise / DEALS, complete: complete / DEALS };
}

// (dealt, hero seat, players behind) with the dealer at seat 1.
const SEATS: [number, number, number][] = [
  [6, 4, 5],
  [6, 5, 4],
  [6, 6, 3],
  [6, 1, 2],
  [6, 2, 1],
  [9, 4, 7],
  [2, 1, 1],
];

describe('first in, the fixed-limit open is the reference range by seat (option on)', () => {
  for (const variant of VARIANTS) {
    it(`${variant}: every seat's raise share lands in the reference band`, () => {
      const rows: string[] = [];
      for (const [dealt, seat, behind] of SEATS) {
        const ref = fixedLimitOpenShare(variant, dealt, behind)!;
        const on = firstIn(variant, dealt, seat, ON);
        rows.push(`${dealt}-handed behind ${behind}: ref ${ref.raise} on ${on.raise.toFixed(3)}`);
        expect(Math.abs(on.raise - ref.raise), rows.join('\n')).toBeLessThanOrEqual(
          FIXED_LIMIT_OPEN_BAND
        );
        if (ref.complete !== null) {
          // The small blind folded to completes the band below its raise.
          expect(on.complete, rows.join('\n')).toBeGreaterThan(
            ref.complete - ref.raise - FIXED_LIMIT_OPEN_BAND
          );
          expect(on.complete, rows.join('\n')).toBeLessThan(
            ref.complete - ref.raise + FIXED_LIMIT_OPEN_BAND
          );
        }
      }
    }, 240_000);
  }

  it('off (main): the heads-up button opens below the reference band', () => {
    // Six-handed, the reference bars alone open the button near the chart;
    // live, the phase12 pack (candidate mode) folds a quarter to a third of
    // those opens (FL-PRE-02), which the pack test below covers.
    for (const variant of VARIANTS) {
      const ref = FIXED_LIMIT_OPEN_REFERENCE[variant];
      expect(firstIn(variant, 2, 1, {}).raise, `${variant} HU`).toBeLessThan(
        ref.headsUpButton - FIXED_LIMIT_OPEN_BAND
      );
    }
  }, 240_000);
});

/** The big blind facing one raise from the button (small blind folded), or heads-up. */
function bbSpot(variant: string, n: number, i: number) {
  const t = table(variant, n, 5000 + i);
  const raiser = 1;
  foldTo(t, raiser);
  t.controller.performAction(raiser, 'raise', menuOf(t).minRaiseTo ?? undefined, 'player');
  if (n > 2) t.controller.performAction(2, 'fold', undefined, 'player');
  const bbSeat = n > 2 ? 3 : 2;
  expect(t.controller.getCurrentPlayer()!.seat).toBe(bbSeat);
  return { t, bbSeat };
}

describe('the big blind defends to its price (option on)', () => {
  for (const variant of VARIANTS) {
    for (const n of [6, 2]) {
      it(`${variant} ${n === 2 ? 'heads-up (3 to 1)' : 'vs the button (3.5 to 1)'}: no hand above the price folds; fewer folds than main`, () => {
        enableBrainTelemetry();
        let foldsOn = 0;
        let foldsOff = 0;
        let above = 0;
        for (let i = 0; i < DEALS; i++) {
          const { t, bbSeat } = bbSpot(variant, n, i);
          const menu = menuOf(t);
          const state = t.controller.getState();
          const odds = menu.toCall / (state.pot + menu.toCall);
          expect(odds).toBeCloseTo(n === 2 ? 0.25 : 2 / 9, 6);
          const s0 = strengthOf(variant, heroCards(t, bbSeat));
          // The decision jitters strength by up to 0.03 either way: the hand
          // is above the price when it is at every strength it can be read at.
          let calls = true;
          for (let j = -0.03; j <= 0.0301 && calls; j += 0.005)
            calls = fixedLimitBlindDefence({
              variant,
              dealt: n,
              strength: Math.min(1, Math.max(0, s0 + j)),
              openerBehind: n === 2 ? 1 : 2,
              behind: 0,
              odds,
            })!.calls;
          const verdict = { calls };
          drainFires();
          const on = decide(t, 11000 + i, { ...ON, telemetry: true }).d;
          // The V46 class gate (a hand whose percentile lies, e.g. trips in
          // Omaha) folds before any bar or price is read; it stays.
          const classFold = drainFires().some((f) => f.feature === 'v46_class_fold');
          const off = decide(t, 11000 + i, {}).d;
          if (on.action === 'fold') foldsOn++;
          if (off.action === 'fold') foldsOff++;
          if (verdict.calls && !classFold) {
            above++;
            expect(on.action, `${variant} deal ${i} s=${s0}`).not.toBe('fold');
          }
          // Raises (3-bets) are the old answer: the option never changes one.
          if (off.action === 'raise') expect(on.action).toBe('raise');
        }
        expect(above).toBeGreaterThan(DEALS / 3);
        expect(foldsOn).toBeLessThan(foldsOff);
      }, 240_000);
    }
  }

  it('the verdict is the price: at 2/9 a hand calls exactly when its realized equity covers it', () => {
    for (const variant of VARIANTS) {
      let prev = -1;
      for (let s = 0; s <= 1.0001; s += 0.01) {
        const v = fixedLimitBlindDefence({
          variant,
          dealt: 6,
          strength: s,
          openerBehind: 2,
          behind: 0,
          odds: 2 / 9,
        })!;
        expect(v.calls).toBe(v.realized >= 2 / 9);
        // Rake (a higher price) and a player behind only ever fold more.
        const raked = fixedLimitBlindDefence({
          variant,
          dealt: 6,
          strength: s,
          openerBehind: 2,
          behind: 0,
          odds: 2 / 9 / 0.95,
        })!;
        const behind = fixedLimitBlindDefence({
          variant,
          dealt: 6,
          strength: s,
          openerBehind: 2,
          behind: 1,
          odds: 2 / 9,
        })!;
        if (raked.calls || behind.calls) expect(v.calls).toBe(true);
        prev = Math.max(prev, v.equity);
      }
      expect(prev).toBeGreaterThan(0.5);
    }
  });
});

describe('the phase12 pack gives way to the priced reference in fixed limit only', () => {
  function packAt(variant: string, precedence: boolean, seed: number) {
    const t = table(variant, 6, 3000 + seed);
    foldTo(t, 6);
    const { hero, gs, menu } = decide(t, 4000 + seed, ON);
    const baseline: HorseDecision = {
      action: 'raise',
      amount: menu.minRaiseTo ?? undefined,
      thinkTime: 1000,
    } as HorseDecision;
    return evaluateRemainingVariantPolicy(
      hero,
      gs,
      baseline,
      null,
      'candidate',
      () => 0,
      1,
      false,
      false,
      precedence
    );
  }

  for (const variant of VARIANTS) {
    it(`${variant}: a cutoff open the pack would fold is retained under the option`, () => {
      let found = 0;
      for (let seed = 0; seed < 200 && found < 5; seed++) {
        const off = packAt(variant, false, seed);
        if (off.receipt.reason !== 'round3_open_tightened') continue;
        found++;
        expect(off.decision.action).toBe('fold');
        const on = packAt(variant, true, seed);
        expect(on.decision.action).toBe('raise');
        expect(on.receipt.reason).toBe('fixed_limit_priced_retains_round3_open_tightened');
      }
      expect(found).toBeGreaterThan(0);
    });
  }
});

const pick = (d: HorseDecision) => ({ action: d.action, amount: d.amount, thinkTime: d.thinkTime });

describe('off is the old answer; no-limit and pot-limit never see the option', () => {
  it('flh/flo8 with the options passed false decide exactly as with them absent', () => {
    for (const variant of VARIANTS) {
      for (let i = 0; i < 150; i++) {
        const t = table(variant, 6, 600 + i);
        foldTo(t, [4, 5, 6, 1, 2][i % 5]);
        const a = decide(t, 700 + i, {}).d;
        const b = decide(t, 700 + i, {
          fixedLimitPricedPreflop: false,
          fixedLimitStealVsTightBlinds: false,
        }).d;
        expect(pick(b), `${variant} ${i}`).toEqual(pick(a));
      }
    }
  }, 240_000);

  it('nlh, plo4 and plo8 decide exactly the same with both options on', () => {
    for (const variant of ['nlh', 'plo4', 'plo8']) {
      for (let i = 0; i < 100; i++) {
        const n = i % 3 === 0 ? 2 : 6;
        const t = table(variant, n, 800 + i);
        if (n === 6) foldTo(t, 4 + (i % 3));
        const a = decide(t, 900 + i, {}).d;
        const b = decide(t, 900 + i, {
          fixedLimitPricedPreflop: true,
          fixedLimitStealVsTightBlinds: true,
        }).d;
        expect(pick(b), `${variant} ${i}`).toEqual(pick(a));
      }
    }
  }, 240_000);
});
