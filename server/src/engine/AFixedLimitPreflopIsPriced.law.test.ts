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
 *
 * CASH TABLES ONLY (2026-11-15, Fixed-Limit lane owner, after AB-EVALUATION-2
 * 3.6): at a fixed-limit tournament table the option, and the steal with it,
 * is inert (every first-in and big-blind decision equals off, no W5 receipt
 * fires); at cash tables on the same spots and seeds it still acts.
 *
 * CREDITED SCOPE (2026-11-16, Phase 2, AB-EVALUATION-2 0.22 "use of the
 * result"; it replaces the 0.18 hi-lo scope): the option acts only at the cash
 * table types with a credited PASS cell, by variant, floor and dealt seats:
 * flh dealt 2/6/9 unfloored and 2/3/6/7/9 floored, flo8 dealt 6 unfloored. At
 * every other cash table type it is inert (every decision equals off, no W5
 * receipt fires); at every listed type it still acts on the same spots and
 * seeds.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { deal, decide, lcg, menuOf, type Table } from './HuVariantSpot.test-support.js';
import {
  FIXED_LIMIT_DEFENCE_REALIZATION,
  FIXED_LIMIT_OPEN_BAND,
  FIXED_LIMIT_OPEN_REFERENCE,
  fixedLimitBlindDefence,
  fixedLimitEquityVsTopShare,
  fixedLimitOpenShare,
  type FixedLimitPreflopVariant,
} from './HorseFixedLimitPreflop.js';
import { horseCallDeductionFraction } from './HorseCallDeductions.js';
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
        // flo8 is credited only at dealt 6 unfloored (AB 0.22): see the
        // credited scope block (flo8 heads-up and full ring are inert).
        if (variant === 'flo8' && dealt !== 6) continue;
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
    // flo8 is credited only at dealt 6 unfloored (AB 0.22): see the credited scope block.
    for (const n of variant === 'flo8' ? [6] : [6, 2]) {
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

// ═══ 2026-11-15 FIX (R2 replay of 1,845 recorded Horse-only hands) ═══
// The tables above carry no rake, so the price the brain read was the raw
// 2/9. Production carries rake and a per-hand jackpot fee; the projected
// deduction over the 4.5bb preflop pot is about 0.23, and the defence was fed
// 0.29: it never fired at a ring big blind. These cases run on production-
// shaped deductions (10% rake, the jackpot fee 0.6bb) and hold the defence to
// the widths its calibration states at the raw price.
const RAKED = {
  percent: 10,
  cap: 5,
  noFlopNoDrop: true,
  playerCountCaps: [{ players: 2, cap: 2.52 }],
};
const BBJ = { enabled: true, feeBB: 0.6, minPotBB: 0, minPlayersDealt: 2 };

function raked(t: Table): Table {
  const c = t.controller as unknown as {
    getRakeConfigSnapshot: () => unknown;
    getChipRulesSnapshot: () => Record<string, unknown>;
  };
  const rules = c.getChipRulesSnapshot.bind(c);
  c.getRakeConfigSnapshot = () => RAKED;
  c.getChipRulesSnapshot = () => ({ ...rules(), bbjConfig: BBJ });
  return t;
}

/** The generated table's defence width: the largest top share whose realized equity covers `odds`. */
function tableWidth(
  variant: FixedLimitPreflopVariant,
  dealt: number,
  openerBehind: number,
  odds: number
) {
  const opener = fixedLimitOpenShare(variant, dealt, openerBehind)!;
  let w = 0;
  for (let s = 0; s <= 1.0001; s += 0.005)
    if (
      fixedLimitEquityVsTopShare(variant, s, opener.raise) *
        FIXED_LIMIT_DEFENCE_REALIZATION[variant] >=
      odds
    )
      w = s;
  return Math.min(1, w);
}

/** Dealer at seat 1 (6-max): 1 BTN, 2 SB, 3 BB, 4 UTG, 5 HJ, 6 CO. The opener raises, every other seat folds to `to`. */
function facingOne(
  variant: string,
  n: number,
  opener: number,
  to: number,
  i: number,
  coldCall?: number,
  limper?: number
) {
  const t = raked(table(variant, n, 5200 + i));
  if (limper !== undefined) {
    foldTo(t, limper);
    t.controller.performAction(limper, 'call', undefined, 'player');
  }
  foldTo(t, opener);
  t.controller.performAction(opener, 'raise', menuOf(t).minRaiseTo ?? undefined, 'player');
  for (let k = 0; k < 12; k++) {
    const cur = t.controller.getCurrentPlayer()!;
    if (cur.seat === to) return t;
    t.controller.performAction(
      cur.seat,
      cur.seat === coldCall ? 'call' : 'fold',
      undefined,
      'player'
    );
  }
  throw new Error(`seat ${to} never reached`);
}

function defenceRun(
  variant: FixedLimitPreflopVariant,
  n: number,
  opener: number,
  openerBehind: number,
  hero: number,
  heroBehind: number
) {
  enableBrainTelemetry();
  const deals = 300;
  let width = -1;
  let fires = 0;
  let defendOn = 0;
  let defendOff = 0;
  let counted = 0;
  for (let i = 0; i < deals; i++) {
    const t = facingOne(variant, n, opener, hero, i);
    const menu = menuOf(t);
    const state = t.controller.getState();
    const odds = menu.toCall / (state.pot + menu.toCall);
    if (width < 0) width = tableWidth(variant, n, openerBehind, odds);
    const s0 = strengthOf(variant, heroCards(t, hero));
    let calls = true;
    for (let j = -0.03; j <= 0.0301 && calls; j += 0.005)
      calls = fixedLimitBlindDefence({
        variant,
        dealt: n,
        strength: Math.min(1, Math.max(0, s0 + j)),
        openerBehind,
        behind: heroBehind,
        odds,
      })!.calls;
    drainFires();
    const run = decide(t, 11000 + i, { ...ON, telemetry: true });
    const fired = drainFires();
    const classFold = fired.some((f) => f.feature === 'v46_class_fold');
    if (fired.some((f) => f.feature === 'fixed_limit_priced_blind_defence')) fires++;
    // The test reproduces production's price shape: the projected deduction is large.
    if (i === 0)
      expect(horseCallDeductionFraction(run.hero, run.gs, menu.toCall) ?? 0).toBeGreaterThan(0.15);
    const off = decide(t, 11000 + i, {}).d;
    const on = run.d;
    // The option never folds a hand the old code continued.
    if (off.action !== 'fold') expect(on.action, `${variant} deal ${i}`).not.toBe('fold');
    if (calls && !classFold) expect(on.action, `${variant} deal ${i} s=${s0}`).not.toBe('fold');
    if (off.action === 'raise') expect(on.action).toBe('raise');
    if (!classFold) {
      counted++;
      if (on.action !== 'fold') defendOn++;
      if (off.action !== 'fold') defendOff++;
    }
  }
  return {
    width,
    fires,
    defend: defendOn / Math.max(1, counted),
    defendOff: defendOff / Math.max(1, counted),
  };
}

describe('2026-11-15 fix: the blind defends to its price under production rake and jackpot fees (option on)', () => {
  const RING: [string, number, number][] = [
    ['UTG', 4, 5],
    ['CO', 6, 3],
    ['BTN', 1, 2],
  ];
  for (const variant of VARIANTS) {
    for (const [label, opener, openerBehind] of RING) {
      it(`${variant} 6-max big blind vs ${label}: defends at least the generated width (-5 points); it fires wherever the old code defends less`, () => {
        const r = defenceRun(variant, 6, opener, openerBehind, 3, 0);
        expect(
          r.defend,
          `${variant} ${label} defend ${r.defend} width ${r.width}`
        ).toBeGreaterThanOrEqual(r.width - FIXED_LIMIT_OPEN_BAND);
        // Where the old code already defends at least the width (flh versus
        // the early seats) the option has nothing to add and need not fire.
        if (r.defendOff < r.width - FIXED_LIMIT_OPEN_BAND) expect(r.fires).toBeGreaterThan(0);
      }, 240_000);
    }
  }
  // flo8 heads-up big blind: out of scope since AB 0.18 (the option is inert
  // there); pinned in the hi-lo scope block below.
  // The small blind is in scope (the design defends "a blind"): with the big
  // blind still to act its realization is discounted once (0.85). It never
  // folds a hand above its own verdict and never folds a hand the old code
  // continued; at 3 to 10 it seldom needs to fire, so no count is pinned.
  for (const variant of VARIANTS) {
    it(`${variant} 6-max small blind vs the button: above its verdict it never folds`, () => {
      defenceRun(variant, 6, 1, 2, 2, 1);
    }, 240_000);
  }
  it('a cold caller or a limper in the pot: the option leaves the big blind exactly as it was', () => {
    for (const variant of VARIANTS) {
      for (let i = 0; i < 60; i++) {
        const cold = facingOne(variant, 6, 4, 3, i, 6);
        expect(pick(decide(cold, 900 + i, ON).d), `${variant} cold ${i}`).toEqual(
          pick(decide(cold, 900 + i, {}).d)
        );
        const limped = facingOne(variant, 6, 6, 3, i, undefined, 4);
        expect(pick(decide(limped, 950 + i, ON).d), `${variant} limp ${i}`).toEqual(
          pick(decide(limped, 950 + i, {}).d)
        );
      }
    }
  }, 240_000);
  it('off: with the options passed false the raked big blind decides exactly as with them absent', () => {
    for (const variant of VARIANTS) {
      for (let i = 0; i < 80; i++) {
        const t = facingOne(variant, 6, [4, 6, 1][i % 3], 3, i);
        const a = decide(t, 700 + i, {}).d;
        const b = decide(t, 700 + i, {
          fixedLimitPricedPreflop: false,
          fixedLimitStealVsTightBlinds: false,
        }).d;
        expect(pick(b), `${variant} ${i}`).toEqual(pick(a));
      }
    }
  }, 240_000);
});

describe('2026-11-15 fix: the pack big blind defended rule is not held for the reference', () => {
  function bbPack(variant: string, precedence: boolean, i: number) {
    const t = facingOne(variant, 6, 1, 3, 400 + i);
    const { hero, gs } = decide(t, 4400 + i, ON);
    const fold = { action: 'fold', thinkTime: 1000 } as HorseDecision;
    return evaluateRemainingVariantPolicy(
      hero,
      gs,
      fold,
      null,
      'candidate',
      () => 0,
      1,
      false,
      false,
      precedence
    );
  }
  // Only the fixed-limit hold'em pack has the rule (the flo8 round-4 pack sets
  // bigBlindDefendBelowCallBar to null), so this is a flh case.
  for (const variant of ['flh']) {
    it(`${variant}: a big blind the pack defends stays defended under the option`, () => {
      let found = 0;
      for (let i = 0; i < 300 && found < 5; i++) {
        const off = bbPack(variant, false, i);
        if (off.receipt.reason !== 'round3_big_blind_defended') continue;
        found++;
        expect(off.decision.action).toBe('call');
        const on = bbPack(variant, true, i);
        expect(on.decision.action).toBe('call');
        expect(on.receipt.reason).toBe('round3_big_blind_defended');
      }
      expect(found).toBeGreaterThan(0);
    });
  }
});

// ─── CASH ONLY (2026-11-15, Fixed-Limit lane owner, after AB-EVALUATION-2 3.6) ───
// "Separate cash and tournament policy": the option was evaluated for cash; a
// fixed-limit tournament table keeps today's answer until a separately
// evaluated tournament option exists. HorseLogic gates both W5 contexts and the
// pack precedence on isTournamentMode (the shared cash/tournament test).
// Stacks are 100 big blinds, so the short-stack rule (20 big blinds or less)
// is not what keeps a tournament decision unchanged.
function fmtTable(variant: string, fmt: 'cash' | 'tournament', n: number, seed: number): Table {
  return deal({ variant, fmt, stacks: Array(n).fill(200), rnd: lcg(seed) });
}

/** The P spots: six-max first in UTG to small blind, the heads-up button, the big blind facing one raise. */
function cashOnlySpots(variant: string, fmt: 'cash' | 'tournament', i: number) {
  const spots: { label: string; t: Table }[] = [];
  for (const seat of [4, 5, 6, 1, 2]) {
    const t = fmtTable(variant, fmt, 6, 13000 + i * 7 + seat);
    foldTo(t, seat);
    spots.push({ label: `first in seat ${seat} of 6`, t });
  }
  const hu = fmtTable(variant, fmt, 2, 14000 + i);
  foldTo(hu, 1);
  spots.push({ label: 'heads-up button first in', t: hu });
  for (const n of [6, 2]) {
    const t = fmtTable(variant, fmt, n, 15000 + i * 3 + n);
    foldTo(t, 1);
    t.controller.performAction(1, 'raise', menuOf(t).minRaiseTo ?? undefined, 'player');
    if (n > 2) t.controller.performAction(2, 'fold', undefined, 'player');
    expect(t.controller.getCurrentPlayer()!.seat).toBe(n > 2 ? 3 : 2);
    spots.push({ label: n > 2 ? 'big blind vs the button' : 'heads-up big blind', t });
  }
  return spots;
}

const W5_FIRES = /^fixed_limit_(priced|steal)|fixed_limit_priced_retains/;
const CASH_ONLY_DEALS = 60;

describe('cash tables only: at a fixed-limit tournament table the option is inert', () => {
  for (const variant of VARIANTS) {
    it(`${variant} tournament: every first-in and big-blind decision with the option on (and with the steal too) equals off, and no W5 receipt fires`, () => {
      enableBrainTelemetry();
      let n = 0;
      for (let i = 0; i < CASH_ONLY_DEALS; i++) {
        for (const { label, t } of cashOnlySpots(variant, 'tournament', i)) {
          const seed = 16000 + i;
          const off = decide(t, seed, { telemetry: true }).d;
          drainFires();
          const on = decide(t, seed, { ...ON, telemetry: true }).d;
          const fired = drainFires().filter((f) => W5_FIRES.test(f.feature));
          const both = decide(t, seed, {
            fixedLimitPricedPreflop: true,
            fixedLimitStealVsTightBlinds: true,
            telemetry: true,
          }).d;
          const firedBoth = drainFires().filter((f) => W5_FIRES.test(f.feature));
          expect(pick(on), `${variant} ${label} deal ${i}`).toEqual(pick(off));
          expect(pick(both), `${variant} ${label} deal ${i} (steal too)`).toEqual(pick(off));
          expect(
            fired.map((f) => f.feature),
            `${variant} ${label} deal ${i}`
          ).toEqual([]);
          expect(
            firedBoth.map((f) => f.feature),
            `${variant} ${label} deal ${i}`
          ).toEqual([]);
          n++;
        }
      }
      expect(n).toBe(CASH_ONLY_DEALS * 8);
    }, 240_000);
  }

  for (const variant of VARIANTS) {
    it(`${variant} cash, the same spots and seeds: the option still acts (first in and the big blind) and its receipts fire`, () => {
      enableBrainTelemetry();
      let changedFirstIn = 0;
      let changedBlind = 0;
      let firstInFires = 0;
      let defenceFires = 0;
      for (let i = 0; i < CASH_ONLY_DEALS; i++) {
        for (const { label, t } of cashOnlySpots(variant, 'cash', i)) {
          const seed = 16000 + i;
          const off = decide(t, seed, { telemetry: true }).d;
          drainFires();
          const on = decide(t, seed, { ...ON, telemetry: true }).d;
          const fired = drainFires().map((f) => f.feature);
          if (fired.includes('fixed_limit_priced_first_in')) firstInFires++;
          if (fired.includes('fixed_limit_priced_blind_defence')) defenceFires++;
          const changed = on.action !== off.action;
          if (changed && label.includes('big blind')) changedBlind++;
          else if (changed) changedFirstIn++;
        }
      }
      expect(changedFirstIn, `${variant} first-in decisions changed`).toBeGreaterThan(0);
      expect(changedBlind, `${variant} big-blind decisions changed`).toBeGreaterThan(0);
      expect(firstInFires).toBeGreaterThan(0);
      expect(defenceFires).toBeGreaterThan(0);
    }, 240_000);
  }
});

// ─── CREDITED SCOPE (Phase 2, AB-EVALUATION-2 0.22; lane owner 2026-11-16) ───
// P (and S with it) acts only at the cash table types with a credited PASS
// cell: HorseLogic's FIXED_LIMIT_PRICED_PREFLOP_CREDITED allow-list, keyed by
// variant, floored (gs.vpipFloor > 0) and the dealt seat count
// (dealtHorseTableSize: gs.dealtSeatIds, here the seats HandController dealt
// cards to). At every other cash table type every decision with the option on
// equals off and no W5 receipt fires; at every listed type the option still
// changes a first-in or big-blind decision on the same spots and seeds, so this
// block sees the difference if the allow-list is bypassed or widened.
// HorseLogic: fixedLimitPreflopInScope, read at the priced-context entry and
// at the pack precedence.
const SCOPE_DEALS = 40;
const FLOOR = {
  flh: { vpipFloor: 15, vpipWindowHands: 30 },
  flo8: { vpipFloor: 25, vpipWindowHands: 30 },
};

/** First-in seats of an n-handed table with the dealer at seat 1: UTG (4) round to the small blind. */
function firstInSeats(n: number): number[] {
  if (n === 2) return [1];
  const seats: number[] = [];
  for (let s = 4; s <= n; s++) seats.push(s);
  return [...seats, 1, 2];
}

/** First in from every seat of an n-handed table, plus the big blind facing one button raise. */
function scopeSpots(variant: string, n: number, i: number) {
  const spots: { label: string; t: Table }[] = [];
  for (const seat of firstInSeats(n)) {
    const t = fmtTable(variant, 'cash', n, 21000 + i * 11 + seat);
    foldTo(t, seat);
    spots.push({ label: `first in seat ${seat} of ${n}`, t });
  }
  const t = fmtTable(variant, 'cash', n, 22000 + i * 3 + n);
  foldTo(t, 1);
  t.controller.performAction(1, 'raise', menuOf(t).minRaiseTo ?? undefined, 'player');
  if (n > 2) t.controller.performAction(2, 'fold', undefined, 'player');
  expect(t.controller.getCurrentPlayer()!.seat).toBe(n > 2 ? 3 : 2);
  spots.push({ label: n > 2 ? 'big blind vs the button' : 'heads-up big blind', t });
  return spots;
}

type ScopeCase = { variant: 'flh' | 'flo8'; n: number; floored: boolean };
const caseLabel = ({ variant, n, floored }: ScopeCase) =>
  `${variant} dealt ${n} ${floored ? 'floored' : 'unfloored'}`;

describe('credited scope: P acts only at the cash table types with a credited PASS cell', () => {
  // Out of the allow-list: 3.16 HARM or no PASS, floored flh 4 diagnostic,
  // flo8 3 not judgeable, dealt 5 and 8 never measured, flo8 heads-up and
  // floored flo8 (0.18 / 3.6), flo8 7-9 never measured.
  const OUT: ScopeCase[] = [
    ...[3, 4, 5, 7, 8].map((n) => ({ variant: 'flh' as const, n, floored: false })),
    ...[4, 5, 8].map((n) => ({ variant: 'flh' as const, n, floored: true })),
    ...[2, 3, 4, 5, 7, 8, 9].map((n) => ({ variant: 'flo8' as const, n, floored: false })),
    ...[2, 6].map((n) => ({ variant: 'flo8' as const, n, floored: true })),
  ];
  for (const c of OUT) {
    it(`${caseLabel(c)}: with the option on (and with the steal too) every decision equals off, and no W5 receipt fires`, () => {
      enableBrainTelemetry();
      const gsExtra = c.floored ? FLOOR[c.variant] : {};
      let count = 0;
      for (let i = 0; i < SCOPE_DEALS; i++) {
        for (const spot of scopeSpots(c.variant, c.n, i)) {
          const seed = 23000 + i;
          const where = `${caseLabel(c)} ${spot.label} deal ${i}`;
          const off = decide(spot.t, seed, { telemetry: true }, gsExtra).d;
          drainFires();
          const on = decide(spot.t, seed, { ...ON, telemetry: true }, gsExtra).d;
          const fired = drainFires().filter((f) => W5_FIRES.test(f.feature));
          const both = decide(
            spot.t,
            seed,
            { fixedLimitPricedPreflop: true, fixedLimitStealVsTightBlinds: true, telemetry: true },
            gsExtra
          ).d;
          const firedBoth = drainFires().filter((f) => W5_FIRES.test(f.feature));
          expect(pick(on), where).toEqual(pick(off));
          expect(pick(both), `${where} (steal too)`).toEqual(pick(off));
          expect(
            fired.map((f) => f.feature),
            where
          ).toEqual([]);
          expect(
            firedBoth.map((f) => f.feature),
            `${where} (steal too)`
          ).toEqual([]);
          count++;
        }
      }
      expect(count).toBe(SCOPE_DEALS * (firstInSeats(c.n).length + 1));
    }, 240_000);
  }

  // The allow-list, entry by entry (3.4: unfloored flh 2/6/9 and flo8 6;
  // 3.6: floored flh 6/9; 3.12: floored flh 2; 3.16: floored flh 3/7).
  const IN: ScopeCase[] = [
    ...[2, 6, 9].map((n) => ({ variant: 'flh' as const, n, floored: false })),
    ...[2, 3, 6, 7, 9].map((n) => ({ variant: 'flh' as const, n, floored: true })),
    { variant: 'flo8', n: 6, floored: false },
  ];
  for (const c of IN) {
    it(`${caseLabel(c)}: the option still changes a first-in or big-blind decision, and its receipts fire`, () => {
      enableBrainTelemetry();
      const gsExtra = c.floored ? FLOOR[c.variant] : {};
      let changed = 0;
      let fires = 0;
      for (let i = 0; i < SCOPE_DEALS; i++) {
        for (const spot of scopeSpots(c.variant, c.n, i)) {
          const seed = 23000 + i;
          const off = decide(spot.t, seed, { telemetry: true }, gsExtra).d;
          drainFires();
          const on = decide(spot.t, seed, { ...ON, telemetry: true }, gsExtra).d;
          if (drainFires().some((f) => W5_FIRES.test(f.feature))) fires++;
          if (on.action !== off.action) changed++;
        }
      }
      expect(changed, `${caseLabel(c)} decisions changed`).toBeGreaterThan(0);
      expect(fires, `${caseLabel(c)} receipts`).toBeGreaterThan(0);
    }, 240_000);
  }
});
