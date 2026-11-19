/**
 * Lightning parity test support (2026-11-18). The recorded lines are from
 * production Lightning PLO5 1/2 hands of 2026-11-18 (six Horses dealt, a
 * big-blind ante), anonymised to seats (1 UTG, 2 HJ, 3 CO, 4 button, 5 small
 * blind, 6 big blind) on the 200 bb stacks of the shared recorded template.
 * Hole cards named RECORDED are the deciding Horse's own cards in that hand;
 * no other seat's cards and no person's cards are here. A Horse that pressed
 * the fast fold has no recorded cards, so first-in spots deal seeded hands.
 */
import { publicMemoryDomainFromRules } from './HorsePublicMemoryDomain.js';
import {
  decideAt,
  PRODUCTION_28372C9A,
  type Decided,
  type Spot,
} from './HorseVpipFloorLimpOnly.test-support.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import type { Card, CardRank, CardSuit } from '../types.js';

/** The option set production decided with, plus nothing. */
export const BASE: HorseDecideOpts = { ...PRODUCTION_28372C9A };

export interface PoolFloor {
  floor: number;
  windowHands: number;
  own: { hands: number; vpipHands: number; leavingEntered?: boolean; fromFirstHand?: boolean };
}

/** Turns the shared table state into a Lightning pool decision (no table floor fields). */
export function asLightning(floor?: PoolFloor | null) {
  return (gs: Record<string, unknown>): void => {
    delete gs.vpipFloor;
    delete gs.vpipWindowHands;
    delete gs.ownVpip;
    gs.publicMemoryDomain = publicMemoryDomainFromRules(
      'lightning',
      typeof gs.ante === 'number' ? gs.ante : 0,
      gs.bigBlindAnte === true
    );
    if (floor) gs.lightningVpipFloor = JSON.parse(JSON.stringify(floor));
  };
}

/** The same state left a table decision (speed 'table'), with the pool field attached anyway. */
export function asTable(floor?: PoolFloor | null) {
  return (gs: Record<string, unknown>): void => {
    delete gs.vpipFloor;
    delete gs.vpipWindowHands;
    delete gs.ownVpip;
    gs.publicMemoryDomain = publicMemoryDomainFromRules(
      'table',
      typeof gs.ante === 'number' ? gs.ante : 0,
      gs.bigBlindAnte === true
    );
    if (floor) gs.lightningVpipFloor = JSON.parse(JSON.stringify(floor));
  };
}

export function decideLightning(
  spot: Spot,
  hole: string | Card[],
  opts: HorseDecideOpts,
  seed: number,
  floor?: PoolFloor | null,
  extra?: (gs: Record<string, unknown>) => void
): Decided {
  return decideAt(spot, { variant: 'plo5', floor: 0 }, hole, opts, seed, (gs) => {
    asLightning(floor)(gs);
    extra?.(gs);
  });
}

const RANKS = '23456789TJQKA';
const SUITS: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
/** Seeded five-card deals (mulberry32). */
export function deals(seed: number, n: number): Card[][] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Card[][] = [];
  while (out.length < n) {
    const picked = new Set<number>();
    while (picked.size < 5) picked.add(Math.floor(rnd() * 52));
    out.push(
      [...picked].map((i) => ({ rank: RANKS[i % 13] as CardRank, suit: SUITS[Math.floor(i / 13)] }))
    );
  }
  return out;
}

/**
 * RECORDED LINES (2026-11-18, PLO5 1/2 Lightning, six Horses dealt).
 * A: UTG and HJ fold, the cutoff opens to 8, the button re-raises to 29, the
 *    small blind decides with the opener still to act (recorded: fold).
 * B: the same hand, the big blind decides after the small blind's fold
 *    (recorded: fold).
 * C: UTG folds, HJ opens to 8, the cutoff re-raises to 29, the button folds,
 *    the small blind decides with the opener still to act (recorded: fold).
 * D: line C, the big blind after the small blind's fold (recorded: fold).
 */
export const RECORDED_LINES = {
  A: {
    spot: {
      hero: 5,
      prior: [
        [1, 'fold'],
        [2, 'fold'],
        [3, 'raise', 8],
        [4, 'raise', 29],
      ],
    } as Spot,
    hole: '4sAs2h5s3d',
    recorded: 'fold',
  },
  B: {
    spot: {
      hero: 6,
      prior: [
        [1, 'fold'],
        [2, 'fold'],
        [3, 'raise', 8],
        [4, 'raise', 29],
        [5, 'fold'],
      ],
    } as Spot,
    hole: '3s9c5c6c3c',
    recorded: 'fold',
  },
  C: {
    spot: {
      hero: 5,
      prior: [
        [1, 'fold'],
        [2, 'raise', 8],
        [3, 'raise', 29],
        [4, 'fold'],
      ],
    } as Spot,
    hole: '5d5cKh2h6s',
    recorded: 'fold',
  },
  D: {
    spot: {
      hero: 6,
      prior: [
        [1, 'fold'],
        [2, 'raise', 8],
        [3, 'raise', 29],
        [4, 'fold'],
        [5, 'fold'],
      ],
    } as Spot,
    hole: 'Ad8cQcTd7h',
    recorded: 'fold',
  },
} as const;

/** What the Horse does: the action, its amount and its think time (diagnostics and state hashes aside). */
export const core = (d: {
  decision: { action: string; amount?: number; thinkTime?: number };
}): { action: string; amount?: number; thinkTime?: number } => ({
  action: d.decision.action,
  amount: d.decision.amount,
  thinkTime: d.decision.thinkTime,
});
