/**
 * LAW (STAB-DEFENCE-5, 2026-11-21): a scripted benchmark seat never asks the
 * street engine for a wager the engine refuses.
 *
 * Root cause this law pins: ExploiterLeague.wager rounded its amount to a
 * whole chip AFTER clamping it to the legal range. A pot-limit cap is a
 * fraction of a chip whenever a wager in cents is in the pot (Horses wager in
 * cents), so a pot-sized wager was rounded up past the cap (198.90 -> 199);
 * the league counted an illegal action and played a check or a fold instead.
 * It happened in the BASE and the candidate arm alike, only at seats driven
 * by these helpers, and more often the more often a Horse wagers in cents.
 *
 * The property is checked against the engine's own validator on random
 * states, including the four states recorded on the development seed.
 */
import { describe, expect, it } from 'vitest';
import { calculateBettingState, validateAction } from '../engine/PokerEngine.js';
import { exploiterSpotHelpers as H, legalWagerTo } from './ExploiterLeague.js';
import type { LeagueSeatSpot } from './HorseLeague.js';

const BB = 2;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cents = (x: number) => Math.round(x * 100) / 100;

/** The menu HorseLeague.seatPolicyDecision hands a scripted seat. */
function spotOf(t: {
  pot: number;
  currentBet: number;
  myBet: number;
  stack: number;
  lastRaise: number;
  potLimit: boolean;
}): LeagueSeatSpot {
  const toCall = Math.max(0, t.currentBet - t.myBet);
  const legalActions: string[] = [toCall > 0 ? 'fold' : 'check'];
  if (toCall > 0 && t.stack > toCall) legalActions.push('call');
  const stackTo = t.myBet + t.stack;
  const potCapTo = t.potLimit ? t.currentBet + t.pot + toCall : Number.POSITIVE_INFINITY;
  const maxTo = Math.min(stackTo, potCapTo);
  const minTo = t.currentBet > 0 ? t.currentBet + Math.max(BB, t.lastRaise) : BB;
  const canWager = maxTo > t.currentBet && maxTo >= minTo;
  if (canWager) legalActions.push(t.currentBet > 0 ? 'raise' : 'bet');
  if (t.stack > 0 && stackTo <= potCapTo) legalActions.push('all_in');
  return {
    isPotLimit: t.potLimit,
    bigBlind: BB,
    pot: t.pot,
    toCall,
    currentBet: t.currentBet,
    myBet: t.myBet,
    stack: t.stack,
    legalActions,
    minRaiseTo: canWager ? minTo : null,
    maxRaiseTo: canWager ? maxTo : null,
  } as unknown as LeagueSeatSpot;
}

function refusal(
  t: Parameters<typeof spotOf>[0],
  d: { action: string; amount?: number }
): string | null {
  if (d.action !== 'bet' && d.action !== 'raise') return null;
  const bs = calculateBettingState(t.pot, t.currentBet, t.myBet, BB, t.lastRaise, t.potLimit);
  const v = validateAction(d.action as never, d.amount, t.stack, bs);
  return v.valid ? null : `${v.error} (amount ${d.amount}, state ${JSON.stringify(t)})`;
}

describe('LAW: a scripted seat wager is inside the legal range', () => {
  it('the four states recorded on the development seed are legal now', () => {
    const recorded = [
      { pot: 102.3, currentBet: 48.3, myBet: 0, stack: 374, lastRaise: 48.3, potLimit: true },
      { pot: 88.58, currentBet: 42.58, myBet: 0, stack: 378, lastRaise: 42.58, potLimit: true },
      { pot: 60.87, currentBet: 28.87, myBet: 0, stack: 383, lastRaise: 28.87, potLimit: true },
      { pot: 64.5, currentBet: 0, myBet: 0, stack: 166.75, lastRaise: 2, potLimit: true },
    ];
    for (const t of recorded) {
      const d = H.potWager(spotOf(t), 1);
      expect(d.action === 'bet' || d.action === 'raise').toBe(true);
      expect(refusal(t, d)).toBeNull();
      // Still a pot-sized wager: within one chip of the cap, never above it.
      const cap = t.currentBet + t.pot + Math.max(0, t.currentBet - t.myBet);
      expect(d.amount!).toBeLessThanOrEqual(cap + 1e-9);
      expect(d.amount!).toBeGreaterThan(cap - 1);
    }
  });

  it('random states: every wager and pot wager validates (pot-limit and no-limit, cents in the pot)', () => {
    const r = rng(20261121);
    let wagers = 0;
    let fractionalCaps = 0;
    for (let n = 0; n < 60_000; n++) {
      const potLimit = r() < 0.8;
      const facing = r() < 0.6;
      const whole = r() < 0.25;
      const q = (x: number) => (whole ? Math.max(0, Math.round(x)) : cents(x));
      const currentBet = facing ? Math.max(BB, q(BB + r() * 150)) : 0;
      const myBet = facing && r() < 0.4 ? q(r() * currentBet * 0.9) : 0;
      const lastRaise = facing ? Math.max(BB, q(currentBet * (0.3 + 0.7 * r()))) : BB;
      const pot = q(currentBet + myBet + 3 + r() * 300);
      const stack = q(0.5 + r() * (r() < 0.3 ? 30 : 600));
      const t = { pot, currentBet, myBet, stack, lastRaise, potLimit };
      const s = spotOf(t);
      if (s.maxRaiseTo !== null && Math.abs(s.maxRaiseTo - Math.round(s.maxRaiseTo)) > 1e-6)
        fractionalCaps++;
      const tries = [
        H.potWager(s, 1),
        H.potWager(s, 0.75),
        H.potWager(s, 0.5),
        H.potWager(s, r() * 1.6),
        H.wager(s, currentBet * 3),
        H.wager(s, r() * 900),
        H.wager(s, myBet + stack),
      ];
      for (const d of tries) {
        if (d.action === 'bet' || d.action === 'raise') wagers++;
        expect(refusal(t, d)).toBeNull();
      }
    }
    expect(wagers).toBeGreaterThan(100_000);
    expect(fractionalCaps).toBeGreaterThan(10_000);
  });

  it('keeps the whole chip whenever the whole chip is legal, and never leaves the range', () => {
    expect(legalWagerTo(2, 150, 64.4)).toBe(64);
    expect(legalWagerTo(2, 150, 64.6)).toBe(65);
    expect(legalWagerTo(2, 64.5, 64.5)).toBe(64.5);
    expect(legalWagerTo(96.6, 198.9, 198.9)).toBe(198.9);
    expect(legalWagerTo(96.6, 198.9, 10)).toBe(96.6);
    expect(legalWagerTo(57.74, 89.74000000000001, 500)).toBe(89.74);
    const r = rng(7);
    for (let n = 0; n < 20_000; n++) {
      const lo = cents(1 + r() * 200);
      const hi = cents(lo + r() * 300);
      const a = legalWagerTo(lo, hi, r() * 700);
      expect(a).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(a).toBeLessThanOrEqual(hi + 1e-9);
      expect(Math.abs(a * 100 - Math.round(a * 100))).toBeLessThan(1e-6);
    }
  });
});
