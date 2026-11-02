/**
 * V78 (2026-11-02, Dan: "I GET RANDOMLY RAISED ON THE TURN AND THEN THE HORSE
 * JUST CALLS OFF AN ENTIRE STACK WITH A10"): the hold'em semi-bluff / bluff
 * raise may never commit 40%+ of the stack without being all-in.
 *
 * The recorded hand (6a30e154, NLH 0.50/1): A-T in the small blind called a
 * 3.5 open, check-called 6 on 8c6h9h, then on the 3d CHECK-RAISED a 15 bet to
 * 67 with about 84 effective and called off the jam. A raise that leaves a
 * stack too small to fold turns the never-raise-to-fold rule into a forced
 * call-off.
 *
 *  1. The recorded spot, rebuilt: across many rolls and every style the
 *     horse never makes a non-all-in raise that commits 40%+ of its stack.
 *  2. Deep, the same hand may still semi-bluff raise (the guard is about
 *     commitment, not about the draw): with the flag on the deep spot is
 *     answered exactly as with it off.
 *  3. Value is untouched: a set facing the same short-stack bet still raises
 *     or jams at the rate it did before.
 *  4. The off arm restores today's raise (the gate is live code).
 *  5. One policy for every opponent: label flips never change the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-000000000078';
const STYLES = ['balanced', 'tag', 'lag', 'tricky', 'grinder'] as const;

/**
 * The recorded geometry in chips (1 chip = 1bb): preflop 3.5 / 3.5, flop
 * 6 / 6, so 19 in the pot; hero (small blind, out of position) checks the
 * turn, villain bets 15. `heroBehind` is hero's stack before acting (the
 * recorded hand: ~84 after the flop call). `flip` swaps horse/human labels.
 */
function spot(hole: string, heroBehind: number, flip = false) {
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: heroBehind,
      bet: 0,
      totalInvested: 9.5,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: 400,
      bet: 15,
      totalInvested: 24.5,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: flip,
    } as SeatPlayer,
  ];
  const history = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 3.5, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 3, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 6, timestamp: 4 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 6, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'bet', amount: 15, timestamp: 7 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('8c6h9h3d'),
      pot: 19 + 15,
      currentBet: 15,
      minRaise: 15,
      stage: 'turn',
      gameVariant: 'nlh',
      gameMode: 'cash',
      bigBlind: 1,
      dealerSeat: 2,
      actionHistory: history,
    },
  };
}

type D = { action: string; amount?: number };
function run(
  s: ReturnType<typeof spot>,
  style: string,
  seed: number,
  opts: Record<string, unknown> = {}
) {
  seedFastRandom(seed * 7919 + 13);
  HorseMind.reset();
  drainFires();
  return HorseLogic.decide(s.hero, s.gs as never, style as never, {}, {
    telemetry: true,
    mind: false,
    ...opts,
  } as never) as D;
}
/** A non-all-in raise that puts 40%+ of the stack in. */
function commitsWithoutJam(d: D, s: ReturnType<typeof spot>): boolean {
  if (d.action !== 'raise' || typeof d.amount !== 'number') return false;
  return d.amount - (s.hero.bet ?? 0) >= 0.4 * s.hero.stack;
}

describe('V78 the bluff raise never commits the stack without jamming', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('the recorded spot: no committing non-jam raise with A-T, every style, many rolls', () => {
    const s = spot('AsTd', 84);
    let offCommits = 0;
    for (const style of STYLES) {
      for (let seed = 1; seed <= 120; seed++) {
        const on = run(s, style, seed);
        expect(commitsWithoutJam(on, s), `${style} seed ${seed} ${on.action} ${on.amount}`).toBe(
          false
        );
        if (commitsWithoutJam(run(s, style, seed, { v78NoCommittingBluffRaise: false }), s))
          offCommits++;
      }
    }
    // 4. The off arm reproduces the recorded defect somewhere in the sweep.
    expect(offCommits).toBeGreaterThan(0);
  });

  it('deep, the same draw is answered exactly as before (commitment, not the draw, is the rule)', () => {
    const s = spot('AsTd', 400);
    for (const style of STYLES) {
      for (let seed = 1; seed <= 40; seed++) {
        const on = run(s, style, seed);
        const off = run(s, style, seed, { v78NoCommittingBluffRaise: false });
        expect(on.action, `${style} seed ${seed}`).toBe(off.action);
        expect(on.amount, `${style} seed ${seed}`).toBe(off.amount);
      }
    }
  });

  it('value is untouched: a set facing the short-stack bet answers exactly as before', () => {
    const s = spot('9s9d', 84);
    for (const style of STYLES) {
      for (let seed = 1; seed <= 40; seed++) {
        const on = run(s, style, seed);
        const off = run(s, style, seed, { v78NoCommittingBluffRaise: false });
        expect(on.action, `${style} seed ${seed}`).toBe(off.action);
        expect(on.amount, `${style} seed ${seed}`).toBe(off.amount);
      }
    }
  });

  it('one policy: flipping the horse/human labels never changes the answer', () => {
    for (const hole of ['AsTd', 'Th7d', '9s9d']) {
      for (let seed = 1; seed <= 30; seed++) {
        const a = run(spot(hole, 84, false), 'balanced', seed);
        const b = run(spot(hole, 84, true), 'balanced', seed);
        expect(b.action, `${hole} seed ${seed}`).toBe(a.action);
        expect(b.amount, `${hole} seed ${seed}`).toBe(a.amount);
      }
    }
  });
});
