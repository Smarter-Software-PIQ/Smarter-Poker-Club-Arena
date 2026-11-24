/**
 * LAW (omahaMultiwayFieldDrawsAreIndependent, default OFF; PLO4/PLO5 cash): in the two joint multiway facing-bet
 * samplers (the flop count HorseOmahaFlopFacingBetEv.omahaFlopEvCounts, the turn/river count
 * HorseOmahaFacingBetEvShownField.omahaShownJoint) the holding drawn for a player still to act, and for a player
 * already in, is independent of the holding drawn for the bettor: with the option on, the position a player behind
 * is drawn at in his range (and so how often he holds the stronger half of it) is the same whatever the bettor's
 * sampled strength, in every decision. The walk the samplers use today (one golden-ratio step shared by the bettor
 * and every other player) fails this law: the turn/river field sits at 2x + c of the bettor's position, and the flop
 * field on the lattice 3x - 2y = c.
 *
 * Hands are generated (a fixed LCG), the Horse's own cards and the board only. Nothing reads another player's cards.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { omahaShownJoint } from './HorseOmahaFacingBetEvShownField.js';
import { omahaFlopEvCounts, omahaFlopEvCountsResetCache } from './HorseOmahaFlopFacingBetEv.js';
import {
  omahaFieldDrawStreams,
  omahaFieldDrawSubSeed,
  omahaFieldDrawTraceSet,
} from './HorseOmahaFieldDrawStreams.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

function dealer(seed: number) {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  return (holeCount: number, boardCount: number): { hole: Card[]; board: Card[] } => {
    const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }) as Card));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return { hole: deck.slice(0, holeCount), board: deck.slice(holeCount, holeCount + boardCount) };
  };
}

interface Rec {
  bettor: number;
  value: boolean;
  field: number[];
}
function traced(run: () => unknown): Rec[] {
  const out: Rec[] = [];
  omahaFieldDrawTraceSet((_s, bettor, value, field) =>
    out.push({ bettor, value, field: [...field] })
  );
  try {
    run();
  } finally {
    omahaFieldDrawTraceSet(null);
  }
  return out;
}

/**
 * One decision's dependence of a field slot on the bettor (his value-region draws): the chi-square of the Q x Q
 * table (bettor's position in his region x the slot's position in his range), and the largest z of the rate the
 * slot holds the stronger half of his range given the bettor's quintile against that rate overall.
 */
function dependence(
  recs: Rec[],
  slot: number,
  Q: number
): { chi2: number; df: number; zMax: number } {
  const value = recs.filter((r) => r.value);
  const top = Math.max(...value.map((r) => r.bettor));
  const g = Array.from({ length: Q }, () => new Array<number>(Q).fill(0));
  const q5 = Array.from({ length: 5 }, () => [0, 0]);
  for (const r of value) {
    const a = Math.min(Q - 1, Math.floor((r.bettor / top) * Q));
    const b = Math.min(Q - 1, Math.floor(r.field[slot] * Q));
    g[a][b]++;
    const a5 = Math.min(4, Math.floor((r.bettor / top) * 5));
    q5[a5][0]++;
    if (r.field[slot] < 0.5) q5[a5][1]++;
  }
  const n = value.length;
  const row = g.map((x) => x.reduce((u, v) => u + v, 0));
  const col = g[0].map((_, b) => g.reduce((u, x) => u + x[b], 0));
  let chi2 = 0;
  for (let a = 0; a < Q; a++)
    for (let b = 0; b < Q; b++) {
      const e = (row[a] * col[b]) / n;
      if (e > 0) chi2 += (g[a][b] - e) ** 2 / e;
    }
  const p = q5.reduce((u, x) => u + x[1], 0) / n;
  let zMax = 0;
  for (const [c, h] of q5)
    if (c > 0) zMax = Math.max(zMax, Math.abs(h / c - p) / Math.sqrt((p * (1 - p)) / c));
  return { chi2, df: (Q - 1) * (Q - 1), zMax };
}

type Street = 'flop' | 'turn' | 'river';
const FIELDS = [
  { always: [0.55], behind: 1 },
  { always: [] as number[], behind: 2 },
];
// A decision passes when no field slot shows dependence: chi-square under df + 6 sd (p < 1e-6 per table) and the
// strong-half rate within 4.5 SE in every bettor quintile.
const passes = (d: { chi2: number; df: number; zMax: number }): boolean =>
  d.chi2 < d.df + 6 * Math.sqrt(2 * d.df) && d.zMax < 4.5;

function decisions(street: Street, independent: boolean, count: number): boolean[] {
  const deal = dealer(street === 'flop' ? 101 : street === 'turn' ? 202 : 303);
  const out: boolean[] = [];
  for (let d = 0; d < count; d++) {
    const field = FIELDS[d % FIELDS.length];
    const { hole, board } = deal(
      d % 2 === 0 ? 4 : 5,
      street === 'flop' ? 3 : street === 'turn' ? 4 : 5
    );
    omahaFlopEvCountsResetCache();
    const recs = traced(() =>
      street === 'flop'
        ? omahaFlopEvCounts(hole, board, [], 0.3, {
            always: field.always,
            behind: field.behind,
            behindShare: 0.55,
            ...(independent ? { independentDraws: true } : {}),
          })
        : omahaShownJoint(hole, board, [], 0.3, field.always, field.behind, 0.45, independent)
    );
    if (recs.length < 100) continue;
    // the flop's lattice is fine-grained (many short lines): a 10 x 10 table sees it, 5 x 5 does not
    const Q = street === 'flop' ? 10 : 5;
    let ok = true;
    for (let slot = 0; slot < field.always.length + field.behind; slot++)
      if (!passes(dependence(recs, slot, Q))) ok = false;
    out.push(ok);
  }
  return out;
}

afterEach(() => omahaFieldDrawTraceSet(null));

describe('LAW: a multiway field is drawn independently of the bettor (omahaMultiwayFieldDrawsAreIndependent on)', () => {
  for (const street of ['flop', 'turn', 'river'] as const) {
    it(`${street}: with the option on, every decision shows no dependence of any field player on the bettor`, () => {
      const on = decisions(street, true, 8);
      expect(on.length).toBeGreaterThanOrEqual(6);
      expect(on.every((x) => x)).toBe(true);
    });
    it(`${street}: the walk of today fails the same law (the law has teeth)`, () => {
      const off = decisions(street, false, 8);
      expect(off.length).toBeGreaterThanOrEqual(6);
      expect(off.filter((x) => !x).length).toBeGreaterThanOrEqual(off.length - 1);
    });
  }

  it('heads-up counts (no field) are the same numbers on and off; on is deterministic per decision', () => {
    const deal = dealer(404);
    for (let d = 0; d < 3; d++) {
      const f = deal(4, 3);
      omahaFlopEvCountsResetCache();
      const a = omahaFlopEvCounts(f.hole, f.board, [], 0.3);
      omahaFlopEvCountsResetCache();
      const b = omahaFlopEvCounts(f.hole, f.board, [], 0.3, {
        always: [],
        behind: 0,
        behindShare: 1,
        independentDraws: true,
      });
      expect(b?.value).toEqual(a?.value);
      expect(b?.other).toEqual(a?.other);
      expect(b?.jointValue).toEqual(a?.jointValue);
      const t = deal(5, 4);
      expect(omahaShownJoint(t.hole, t.board, [], 0.3, [0.45], 0, 0.45, true)).toEqual(
        omahaShownJoint(t.hole, t.board, [], 0.3, [0.45], 0, 0.45, true)
      );
      // heads-up on the turn: the bettor's walks are untouched
      expect(omahaShownJoint(t.hole, t.board, [], 0.3, [], 0, 0.45, true)).toEqual(
        omahaShownJoint(t.hole, t.board, [], 0.3, [], 0, 0.45, false)
      );
    }
  });

  it('each role and slot has its own sub-seed and stream', () => {
    const seeds = new Set(
      ['in:0', 'in:1', 'behind:0', 'behind:1', 'behind:2'].map((t) =>
        omahaFieldDrawSubSeed(12345, t)
      )
    );
    expect(seeds.size).toBe(5);
    const [x, y] = omahaFieldDrawStreams(12345, 2, 1);
    const xs = Array.from({ length: 4 }, () => x());
    const ys = Array.from({ length: 4 }, () => y());
    expect(xs).not.toEqual(ys);
    expect(omahaFieldDrawSubSeed(12345, 'behind:0')).not.toBe(
      omahaFieldDrawSubSeed(12346, 'behind:0')
    );
  });
});
