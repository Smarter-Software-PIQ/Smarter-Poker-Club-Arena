/**
 * PLO6 strategy calibration: the six-card constants and class predicates of
 * HorsePlo6StrategyCalibration.ts against SPEC-A and SPEC-B (PLO6 archive,
 * phase1-play/plo-port-20261115). Every hand here is hand-built or drawn by a
 * seeded generator: no production hole cards.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { omahaNutStatus, scoreOmahaHiPartial } from './HorseEval.js';
import { omahaReraisedPremium } from './HorseOmahaReraisedPot.js';
import {
  PLO6_HOLE_PAIRS,
  PLO6_OMAHA_STRATEGY_CONSTANTS as K,
  plo6BoardDrawCompletingCards,
  plo6CoordinationGaps,
  plo6FacingBetEvFoldStands,
  plo6HoldingDrawOuts,
  plo6NutClass,
  plo6OopCoordinated,
  plo6ReraisedPremium,
  plo6RiverM1Fold,
  plo6RiverMediumBetCallBar,
  plo6RiverMediumBetCalls,
  plo6StrategyOptionVerdict,
  plo6StrongHandForValue,
  plo6TurnNutOuts,
} from './HorsePlo6StrategyCalibration.js';

const RANKS = '23456789TJQKA';
const SUITS = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const;
const SUIT_NAMES = Object.values(SUITS);
const card = (t: string): Card => ({ rank: t[0], suit: SUITS[t[1] as keyof typeof SUITS] }) as Card;
const cards = (text: string): Card[] => text.trim().split(/\s+/).map(card);
const key = (c: Card) => `${c.rank}:${c.suit}`;
const keys = (cs: readonly Card[]) => cs.map(key).sort();
const DECK: Card[] = Array.from(
  { length: 52 },
  (_, i) => ({ rank: RANKS[i % 13], suit: SUIT_NAMES[Math.floor(i / 13)] }) as Card
);
const category = (score: number) => Math.floor(score / 0x100000);
const STRAIGHT_CATS = new Set([5, 9, 10]);
const FLUSH_CATS = new Set([6, 9, 10]);

/** A simple LCG (Numerical Recipes constants); the high bits pick the card. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return (n: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * n);
  };
}
/** The first `count` cards of a seeded partial shuffle. */
function deal(next: (n: number) => number, count: number): Card[] {
  const idx = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + next(52 - i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, count).map((i) => DECK[i]);
}
const without = (seen: readonly Card[]): Card[] => {
  const s = new Set(seen.map(key));
  return DECK.filter((c) => !s.has(key(c)));
};

describe('PLO6 strategy constants', () => {
  const entries = Object.entries(K);

  it('every entry carries a value, one of the three bases and a note, and is frozen', () => {
    expect(entries.length).toBeGreaterThan(80);
    expect(Object.isFrozen(K)).toBe(true);
    for (const [name, e] of entries) {
      expect(['derived', 'measured', 'kept_plo5_unmeasured'], name).toContain(e.basis);
      expect(e.note.length, name).toBeGreaterThan(0);
      expect(e.value, name).toBeDefined();
      expect(Object.isFrozen(e), name).toBe(true);
      if (typeof e.value === 'object') expect(Object.isFrozen(e.value), name).toBe(true);
    }
    expect(() => {
      (K.COORDINATED_MAX_GAPS as { value: number }).value = 0;
    }).toThrow();
  });

  it('holds the three PLO6 values that change and the measured river lines', () => {
    expect(PLO6_HOLE_PAIRS).toBe(15);
    expect(K.COORDINATED_MAX_GAPS).toMatchObject({ value: 3, basis: 'derived' });
    expect(K.omahaStrongHandNow).toMatchObject({
      value: 'nut_class_only',
      basis: 'kept_plo5_unmeasured',
    });
    expect(K.OMAHA_OOP_TURN_TOKEN_PRICE.basis).toBe('kept_plo5_unmeasured');
    expect(K.OMAHA_WIDE_RERAISE_MIN_RATE.basis).toBe('kept_plo5_unmeasured');
    expect(K.omahaReraisedPremium.basis).toBe('derived');
    expect(K['holeCheck.holeCount'].value).toBe(6);
    expect(K.PLO6_RIVER_FOLD_BEAT_PROB).toMatchObject({ value: 0.15, basis: 'measured' });
    expect(K.PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB).toMatchObject({ value: 0.3, basis: 'measured' });
    expect(K.PLO6_RIVER_CHEAP_PRICE).toMatchObject({ value: 0.1, basis: 'measured' });
    expect(K.OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET.basis).toBe('kept_plo5_unmeasured');
    expect(K['omahaEvHandCounts.streets'].value).toEqual(['river']);
  });

  // Each numeric entry keyed by a code constant is pinned to the literal the
  // engine source declares (PLO4/PLO5 and the PLO6 river lines): a kept value
  // that drifts from the PLO code fails here.
  it('numeric entries named after a code constant equal the literal in the engine source', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [
      'HorseLogic.ts',
      'HorseMind.ts',
      'HorseOmahaOopChecks.ts',
      'HorseOmahaTurnRiverRaiseNeedsNuts.ts',
      'HorseOmahaBigDrawAggression.ts',
      'HorseOmahaStreetPlan.ts',
      'HorseOmahaCardImpact.ts',
      'HorseOmahaFacingBetEv.ts',
      'HorseOmahaRiverMediumBetCalls.ts',
      'HorsePloPairedBoardFold.ts',
      'HorseOmahaBigBetCalls.ts',
      'HorseOmahaReadConditional.ts',
      'HorseOmahaOopReraisedPot.ts',
      'HorseOmahaReraisedPot.ts',
      'HorseOmahaUnderpair.ts',
      'HorseOmahaStrongHandValue.ts',
      'HorseOpponentExploit.ts',
    ];
    const source = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    const literal = (name: string): number | null => {
      const hit = new RegExp(`const ${name}(?::[^=]+)? = ([^;]+);`).exec(source);
      if (!hit) return null;
      const text = hit[1].trim();
      const ratio = /^(\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?)$/.exec(text);
      if (ratio) return Number(ratio[1]) / Number(ratio[2]);
      return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
    };
    const aliases: Record<string, string> = {
      OMAHA_READCOND_MIN_HANDS: 'PRESUMPTION_PROOF_MIN_OPPS',
      OMAHA_WIDE_RERAISE_MIN_OPPS: 'OMAHA_TIGHT_RERAISE_MIN_OPPS',
    };
    let pinned = 0;
    for (const [name, e] of entries) {
      if (typeof e.value !== 'number' || !/^[A-Z][A-Z0-9_]+$/.test(name)) continue;
      if (name === 'COORDINATED_MAX_GAPS') continue;
      const declared = literal(aliases[name] ?? name);
      expect(declared, `${name} is declared in the engine source`).not.toBeNull();
      expect(e.value, name).toBeCloseTo(declared as number, 12);
      pinned++;
    }
    expect(pinned).toBeGreaterThanOrEqual(55);
    // The one numeric entry that is a NEW row: the code has no six-card key.
    expect(source).toMatch(
      /COORDINATED_MAX_GAPS: Readonly<Record<number, number>> = \{ 4: 1, 5: 2 \};/
    );
  });
});

describe('plo6ReraisedPremium (SPEC-B H27, 3.22)', () => {
  // [hand, PLO6 class, the PLO4/PLO5 text read on the same six cards]
  const table: [string, string, boolean, boolean][] = [
    ['a pair of aces, nothing else', 'As Ah 7d 2c 9h 4s', true, true],
    ['three aces', 'As Ah Ad 2c 9h 4s', true, true],
    ['two kings, each with a suited partner', 'Ks 5s Kh 9h 2d 3c', true, true],
    ['three kings, two of them with a suited partner', 'Ks 5s Kh 9h Kd 3c', true, true],
    ['four cards both the rundown and two-plus-two suited', 'Ts 9s 8h 7h 2d 3c', true, true],
    ['the same with one gap inside the span of four', 'Js Ts 9h 7h 2d 2c', true, true],
    ['two kings, only one with a suited partner', 'Ks 5s Kh 9d 2d 3c', false, true],
    ['rundown on four cards, the suits on other cards', 'Ts 9h 8d 7c 2s 2h', false, true],
    ['rundown suited three and one', 'Ts 9s 8s 7h 2d 3d', false, true],
    ['rundown two-plus-two suited but six-low', '9s 8s 7h 6h 2d 3c', false, false],
    ['four ranks too far apart', 'Qs Js 8h 7h 2d 3c', false, false],
    ['one ace, one king, suited', 'As Ks 8h 3h 2d 4c', false, false],
    ['two kings, both suits on other cards', 'Ks Kh 8d 3c 2d 4c', false, true],
    ['two kings, the one suit on other cards', 'Ks Kh 8d 3d 2d 4c', false, false],
  ];
  it.each(table)('%s', (_name, text, plo6, plo5Text) => {
    const hole = cards(text);
    expect(plo6ReraisedPremium(hole)).toBe(plo6);
    expect(omahaReraisedPremium(hole)).toBe(plo5Text);
  });

  it('is false for anything but six distinct cards', () => {
    expect(plo6ReraisedPremium(cards('As Ah 7d 2c 9h'))).toBe(false);
    expect(plo6ReraisedPremium(cards('As Ah 7d 2c 9h 4s 5s'))).toBe(false);
    expect(plo6ReraisedPremium(cards('As Ah 7d 2c 9h 9h'))).toBe(false);
    expect(plo6ReraisedPremium([])).toBe(false);
  });

  // SPEC-B N1 exact shares over all C(52,6) hands: 11.63% premium, 5.55%
  // without a pair of aces; the PLO4/PLO5 text on six cards 20.25%. Sample:
  // 200,000 hands from one LCG seed. Bands: +/- 0.40 points on 11.63% and
  // 20.25%, +/- 0.30 on 5.55% (each more than five standard errors of a
  // 200,000-hand sample: 0.07, 0.09 and 0.05 points).
  it('admits the spec share of a seeded 200,000-hand sample', () => {
    const next = lcg(20261115);
    const N = 200_000;
    let premium = 0;
    let withoutAces = 0;
    let plo5Text = 0;
    for (let i = 0; i < N; i++) {
      const hole = deal(next, 6);
      if (omahaReraisedPremium(hole)) plo5Text++;
      if (!plo6ReraisedPremium(hole)) continue;
      premium++;
      if (hole.filter((c) => c.rank === 'A').length < 2) withoutAces++;
    }
    expect(premium / N).toBeGreaterThan(0.1123);
    expect(premium / N).toBeLessThan(0.1203);
    expect(withoutAces / N).toBeGreaterThan(0.0525);
    expect(withoutAces / N).toBeLessThan(0.0585);
    expect(plo5Text / N).toBeGreaterThan(0.1985);
    expect(plo5Text / N).toBeLessThan(0.2065);
  }, 60_000);
});

describe('six-card coordination (SPEC-B H29, 3.24)', () => {
  const table: [string, string, number | null, string | null][] = [
    ['six in a row', '4s 5h 6d 7c 8s 9h', 0, 'rundown'],
    ['three one-rank gaps: the bar', '4s 6h 8d Tc Js Qh', 3, 'rundown'],
    ['four gaps, suits not two clean pairs', '3s 5h 7d 9c Js Qs', 4, null],
    [
      'four gaps, double-suited: one more gap allowed',
      '3s 5s 7h 9h Jd Qc',
      4,
      'double_suited_connected',
    ],
    ['five gaps, double-suited', '2s 4s 6h 8h Td Qc', 5, null],
    ['a step of three ranks: two groups', '4s 5h 6d 7c 8s Jh', null, null],
    ['one card outside the group', '9s Th Jd Qc Ks 3h', null, null],
    ['one pair inside the group', '5s 5h 6d 7c 8s 9h', 0, 'rundown'],
    ['two pairs', '5s 5h 6d 6c 7s 8h', null, null],
    ['three of a rank', '5s 5h 5d 6c 7s 8h', null, null],
    ['ace low', 'As 2h 3d 4c 5s 6h', 0, 'rundown'],
    ['ace high', '9s Th Jd Qc Ks Ah', 0, 'rundown'],
    ['ace cannot wrap around', 'Qs Kh Ad 2c 3s 4h', null, null],
  ];
  it.each(table)('%s', (_name, text, gaps, cls) => {
    expect(plo6CoordinationGaps(cards(text))).toBe(gaps);
    expect(plo6OopCoordinated(cards(text))).toBe(cls);
  });

  it('is null for anything but six distinct cards', () => {
    expect(plo6CoordinationGaps(cards('4s 5h 6d 7c 8s'))).toBeNull();
    expect(plo6OopCoordinated(cards('4s 5h 6d 7c 8s'))).toBeNull();
    expect(plo6CoordinationGaps(cards('4s 5h 6d 7c 8s 8s'))).toBeNull();
  });
});

describe('nut class and the strong hand for value (SPEC-A H8, SPEC-B 3.20)', () => {
  const table: [string, string, string, boolean][] = [
    ['top full house, no bigger one possible', 'Kh 7d 9c 3h Jd 5s', 'Ks Kd 7h 4c 2s', true],
    ['full house a bigger full house beats', '7s 7d 9c 3h Jd 5s', 'Ks Kd 7h 4c 2s', false],
    ['nut flush, board unpaired', 'As 3s 9c 8h Jd 5d', 'Qs 9s 4s 7d 2h', true],
    ['second-nut flush, board unpaired', 'Ks 3s 9c 8h Jd 5d', 'Qs 9s 4s 7d 2h', false],
    ['nut flush, board paired', 'As 3s 9c 8h Jd 5d', 'Qs 9s 4s 4d 2h', false],
    ['nut straight, no flush possible', 'Js Th 3c 3d 5s 5h', '9h 8d 7c 2s Kd', true],
    ['nut straight under a possible flush', 'Js Td 3c 3d 5s 5c', '9h 8h 7h 2s Kd', false],
    ['two pair', 'Kh 4d 9c 3h Jd 5s', 'Ks 8d 7h 4c 2s', false],
  ];
  it.each(table)('river: %s', (_name, hole, board, expected) => {
    expect(plo6NutClass(cards(hole), cards(board))).toBe(expected);
    expect(plo6StrongHandForValue(cards(hole), cards(board))).toBe(expected);
  });

  it('strong hand for value is a river class; the flop nuts are nut class only', () => {
    const hole = cards('Kh Kd 9c 3h Jd 5s');
    const flop = cards('Ks 7d 2c');
    expect(plo6NutClass(hole, flop)).toBe(true);
    expect(plo6StrongHandForValue(hole, flop)).toBe(false);
    expect(plo6NutClass(cards('7h 7c 9c 3h Jd 5s'), flop)).toBe(false);
    expect(plo6NutClass(cards('Ah Qd 9c 3h Jd 5s'), flop)).toBe(false);
  });

  it('is false for a malformed hand', () => {
    expect(plo6NutClass(cards('Kh 7d 9c 3h Jd'), cards('Ks Kd 7h 4c 2s'))).toBe(false);
    expect(plo6NutClass(cards('Kh 7d 9c 3h Jd Ks'), cards('Ks Kd 7h 4c 2s'))).toBe(false);
    expect(plo6NutClass(cards('Kh 7d 9c 3h Jd 5s'), cards('Ks Kd'))).toBe(false);
  });
});

describe('river thresholds (SPEC-A M1, 3.12, 3.13)', () => {
  // [beaten, paired, flush possible, price, 3.13 fold may become a call, 3.12 fold stands]
  const table: [number, boolean, boolean, number, boolean, boolean][] = [
    [0.149, true, false, 0.25, true, false],
    [0.15, true, false, 0.25, false, true],
    [0.2, true, false, 0.25, false, true],
    [0.2, true, true, 0.25, false, true],
    [0.2, false, false, 0.25, true, false],
    [0.299, false, false, 0.25, true, false],
    [0.3, false, false, 0.25, false, true],
    [0.35, false, false, 0.25, false, true],
    [0.149, false, true, 0.25, true, false],
    [0.15, false, true, 0.25, false, false],
    [0.2, false, true, 0.25, false, false],
    [0.3, false, true, 0.25, false, true],
    [0.2, true, false, 0.08, false, false],
    [0.2, true, false, 0.1, false, false],
    [0.2, true, false, 0.1001, false, true],
    [0.45, false, false, 0.1, false, false],
    [0, true, false, 0.25, true, false],
    [1, false, false, 0.5, false, true],
  ];
  it.each(table)(
    'beaten %f, paired %s, flush %s, price %f',
    (beaten, paired, flush, price, mediumCalls, foldStands) => {
      expect(plo6RiverMediumBetCalls(beaten, paired, flush, price)).toBe(mediumCalls);
      expect(plo6FacingBetEvFoldStands(beaten, paired, flush, price)).toBe(foldStands);
      expect(plo6RiverM1Fold(beaten, paired, price)).toBe(foldStands);
    }
  );

  it('the three medium-bet bars', () => {
    expect(plo6RiverMediumBetCallBar(true, false)).toBe(0.15);
    expect(plo6RiverMediumBetCallBar(true, true)).toBe(0.15);
    expect(plo6RiverMediumBetCallBar(false, false)).toBe(0.3);
    expect(plo6RiverMediumBetCallBar(false, true)).toBe(0.15);
  });

  it('an unreadable share or price is a fold in both rules', () => {
    for (const [beaten, price] of [
      [NaN, 0.25],
      [0.05, NaN],
      [-0.1, 0.25],
      [1.2, 0.25],
      [0.05, 1.5],
      [Infinity, 0.25],
    ]) {
      expect(plo6RiverMediumBetCalls(beaten, false, false, price)).toBe(false);
      expect(plo6FacingBetEvFoldStands(beaten, false, false, price)).toBe(true);
    }
  });
});

describe('draw outs by distinct real cards (SPEC-A H19, 3.11)', () => {
  it('a flush draw is the real cards left: 13 - 2 - 4 - 2 = 5, not 9', () => {
    const out = plo6HoldingDrawOuts(
      cards('As Qs Js 9s 4h 4c'),
      cards('Ks 7s 2d'),
      cards('3s 5s Td 8c 6h 6d')
    );
    expect(out.flush).toHaveLength(5);
    expect(out.straight).toHaveLength(0);
    expect(out.all).toHaveLength(5);
    expect(out.weighted).toBe(5);
  });

  it('a non-nut flush card weighs 0.6: nine cards are the 5.4 of PLO4/PLO5', () => {
    const out = plo6HoldingDrawOuts(cards('Qs Js 4h 4c 9d 3h'), cards('Ks 7s 2d'));
    expect(out.flush).toHaveLength(9);
    expect(out.straight).toHaveLength(0);
    expect(out.weighted).toBeCloseTo(5.4, 9);
  });

  it('a card completing both the flush and the straight is counted once', () => {
    const holding = cards('9s 8s Ac Ad 4h 4c');
    const board = cards('Ts 7s 3d');
    const out = plo6HoldingDrawOuts(holding, board);
    expect(out.flush).toHaveLength(9);
    expect(out.straight).toHaveLength(8);
    const both = out.flush.filter((c) => keys(out.straight).includes(key(c)));
    expect(keys(both)).toEqual(keys(cards('Js 6s')));
    expect(out.all).toHaveLength(9 + 8 - 2);
    expect(new Set(keys(out.all)).size).toBe(out.all.length);
    expect(out.all.length).toBeLessThanOrEqual(52 - 6 - 3);
    expect(out.weighted).toBeCloseTo(8 + 7 * 0.6, 9);
  });

  it('a made straight or flush has no outs to complete it, and the river has none', () => {
    expect(plo6HoldingDrawOuts(cards('9s 8s Ac Ad 4h 4c'), cards('Ts 7s 6d')).straight).toEqual([]);
    expect(plo6HoldingDrawOuts(cards('9s 8s Ac Ad 4h 4c'), cards('Ts 7s 3s Kd')).flush).toEqual([]);
    expect(plo6HoldingDrawOuts(cards('9s 8s Ac Ad 4h 4c'), cards('Ts 7s 3d Kd 2c')).all).toEqual(
      []
    );
  });

  // The evaluator's verdict on every (two hole, three board) hand through the
  // new card, against the module's rank and suit tests.
  const made = (hole: Card[], board: Card[], cats: Set<number>, through?: Card): boolean => {
    for (let a = 0; a < hole.length; a++)
      for (let b = a + 1; b < hole.length; b++)
        for (let x = 0; x < board.length; x++)
          for (let y = x + 1; y < board.length; y++)
            for (let z = y + 1; z < board.length; z++) {
              const three = [board[x], board[y], board[z]];
              if (through && !three.includes(through)) continue;
              if (cats.has(category(scoreOmahaHiPartial([hole[a], hole[b]], three)))) return true;
            }
    return false;
  };

  it('never exceeds the unseen cards, never repeats a card, and agrees with the evaluator', () => {
    const next = lcg(606);
    for (let trial = 0; trial < 120; trial++) {
      const boardSize = 3 + (trial % 2);
      const dealt = deal(next, 12 + boardSize);
      const holding = dealt.slice(0, 6);
      const hero = dealt.slice(6, 12);
      const board = dealt.slice(12);
      const out = plo6HoldingDrawOuts(holding, board, hero);
      const unseen = without(dealt);
      expect(unseen).toHaveLength(52 - 12 - boardSize);
      const live = new Set(keys(unseen));
      expect(out.all.length).toBeLessThanOrEqual(unseen.length);
      expect(new Set(keys(out.all)).size).toBe(out.all.length);
      expect(out.all.every((c) => live.has(key(c)))).toBe(true);
      const union = new Set([...keys(out.flush), ...keys(out.straight)]);
      expect(keys(out.all)).toEqual([...union].sort());
      expect(out.weighted).toBeLessThanOrEqual(out.all.length + 1e-9);
      const straightNow = made(holding, board, STRAIGHT_CATS);
      const flushSuits = new Set(
        SUIT_NAMES.filter((s) => board.filter((c) => c.suit === s).length >= 3)
      );
      for (const c of unseen) {
        const after = [...board, c];
        const straight = !straightNow && made(holding, after, STRAIGHT_CATS, c);
        const flush = !flushSuits.has(c.suit) && made(holding, after, FLUSH_CATS, c);
        expect(keys(out.straight).includes(key(c)), `straight ${key(c)} trial ${trial}`).toBe(
          straight
        );
        expect(keys(out.flush).includes(key(c)), `flush ${key(c)} trial ${trial}`).toBe(flush);
      }
    }
  });

  it('board form: the cards that complete a draw for some two-card holding, each once', () => {
    const board = cards('Ts 7s 3d');
    const out = plo6BoardDrawCompletingCards(board);
    expect(out.flush).toHaveLength(11);
    expect([...new Set(out.straight.map((c) => c.rank))].sort()).toEqual(
      ['4', '5', '6', '8', '9', 'J'].sort()
    );
    expect(out.straight).toHaveLength(24);
    expect(out.all).toHaveLength(11 + 24 - 6);
    expect(new Set(keys(out.all)).size).toBe(out.all.length);
    expect(out.all.length).toBeLessThanOrEqual(52 - 3);
    const mine = cards('As Ks 9s 9d 8c 2h');
    const seen = plo6BoardDrawCompletingCards(board, mine);
    expect(seen.all.some((c) => keys(mine).includes(key(c)))).toBe(false);
    expect(seen.flush).toHaveLength(11 - 3);
    expect(seen.all.length).toBeLessThanOrEqual(52 - 3 - 6);
    expect(plo6BoardDrawCompletingCards(cards('Ts 7s 3d Kd 2c')).all).toEqual([]);
  });

  it.each(['Ts 7s 3d', 'Ts Td 7s', '9h 8d 7c 2s', 'Ah 2d 3c Kh', 'Qs 7s 2s 9d'])(
    'board form agrees with the evaluator over every unseen two-card holding: %s',
    (text) => {
      const board = cards(text);
      const out = plo6BoardDrawCompletingCards(board);
      const unseen = without(board);
      for (const c of unseen) {
        const rest = unseen.filter((x) => x !== c);
        const after = [...board, c];
        let straight = false;
        for (let i = 0; i < rest.length && !straight; i++)
          for (let j = i + 1; j < rest.length && !straight; j++) {
            const two = [rest[i], rest[j]];
            straight = made(two, after, STRAIGHT_CATS, c) && !made(two, board, STRAIGHT_CATS);
          }
        expect(keys(out.straight).includes(key(c)), `straight ${key(c)}`).toBe(straight);
        const flush = board.filter((x) => x.suit === c.suit).length === 2;
        expect(keys(out.flush).includes(key(c)), `flush ${key(c)}`).toBe(flush);
      }
    },
    60_000
  );
});

describe('plo6TurnNutOuts (SPEC-A H9)', () => {
  const anyFullHouse = (hole: Card[], board: Card[], dead: Card[] = []) =>
    without([...hole, ...board, ...dead]).filter(
      (c) => omahaNutStatus(hole, [...board, c]).category >= 7
    );

  it('a set whose full houses a bigger full house beats has one nut out, the case card', () => {
    const hole = cards('5s 5d Qc Qh Jd Jc');
    const board = cards('Ks 8d 5c 2h');
    // Every board-pairing river fills up (ten cards), which is what the
    // PLO4/PLO5 omahaTurnRedrawShare counts; kings, eights and deuces full
    // all lose to a bigger full house.
    expect(anyFullHouse(hole, board)).toHaveLength(10);
    const out = plo6TurnNutOuts(hole, board);
    expect(keys(out.outs)).toEqual(keys(cards('5h')));
    expect(out.unseen).toBe(52 - 6 - 4);
    expect(out.share).toBeCloseTo(1 / 42, 12);
  });

  it('top set counts every board-pairing river: no bigger full house exists', () => {
    const hole = cards('Ks Kd Qc Qh Jd Jc');
    const board = cards('Kh 8d 5c 2h');
    const out = plo6TurnNutOuts(hole, board);
    expect(keys(out.outs)).toEqual(keys(anyFullHouse(hole, board)));
    expect(out.outs).toHaveLength(10);
    expect(out.share).toBeCloseTo(10 / 42, 12);
  });

  it('counts a nut flush card only on an unpaired board, and a second-nut flush never', () => {
    const board = cards('Qs 9s 4d 2h');
    const spades = (cs: Card[]) => keys(cs.filter((c) => c.suit === 'spades'));
    const nut = plo6TurnNutOuts(cards('As 3s 7c 7h Jd 6d'), board);
    // Nine spades are unseen; the four and the deuce pair the board.
    expect(spades(nut.outs)).toEqual(keys(cards('Ks Js Ts 8s 7s 6s 5s')));
    expect(new Set(keys(nut.outs)).size).toBe(nut.outs.length);
    // King-high is the nut flush only when the ace itself is the river.
    const second = plo6TurnNutOuts(cards('Ks 3s 7c 7h Jd 6d'), board);
    expect(spades(second.outs)).toEqual(keys(cards('As')));
  });

  it('dead cards leave the unseen count, and a non-turn board has no outs', () => {
    const hole = cards('5s 5d Qc Qh Jd Jc');
    const out = plo6TurnNutOuts(hole, cards('Ks 8d 5c 2h'), cards('5h 9c'));
    expect(out).toMatchObject({ outs: [], unseen: 40, share: 0 });
    expect(plo6TurnNutOuts(hole, cards('Ks 8d 5c')).unseen).toBe(0);
    expect(plo6TurnNutOuts(hole.slice(0, 5), cards('Ks 8d 5c 2h')).unseen).toBe(0);
  });
});

describe('plo6StrategyOptionVerdict (SPEC-A section 4, SPEC-B section 6)', () => {
  const names = Object.keys(plo6StrategyOptionVerdict);
  const of = (v: string) =>
    Object.entries(plo6StrategyOptionVerdict)
      .filter(([, r]) => r.verdict === v)
      .map(([n]) => n)
      .sort();

  // The 31 names are the catalogue's (hard-coded in the module from the two
  // specs); this reads HorseDecideOpts from the engine source and requires
  // each one to be a real boolean option there.
  it('covers 31 options, each a boolean field of HorseDecideOpts', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const logic = readFileSync(join(dir, 'HorseLogic.ts'), 'utf8');
    const start = logic.indexOf('export interface HorseDecideOpts {');
    expect(start).toBeGreaterThan(0);
    const body = logic.slice(start, logic.indexOf('\n}\n', start));
    const fields = new Set(
      [...body.matchAll(/^ {2}(omaha[A-Za-z0-9]+)\?: boolean;/gm)].map((x) => x[1])
    );
    expect(fields.size).toBeGreaterThanOrEqual(31);
    expect(names).toHaveLength(31);
    expect(new Set(names).size).toBe(31);
    for (const n of names) expect(fields.has(n), n).toBe(true);
  });

  it('skips exactly the four held options and carries a reason for every verdict', () => {
    expect(of('skip')).toEqual(
      [
        'omahaRiverNutBlockerBluffReachable',
        'omahaReraisedFoldVsTight',
        'omahaEliteContinuesVsMeasuredWideThreeBettor',
        'omahaSmallBlindSteal',
      ].sort()
    );
    expect(of('take')).toHaveLength(13);
    expect(of('adapt')).toHaveLength(14);
    for (const [n, r] of Object.entries(plo6StrategyOptionVerdict)) {
      expect(['take', 'adapt', 'skip'], n).toContain(r.verdict);
      expect(r.reason, n).toMatch(/^3\.\d+/);
      expect(Object.isFrozen(r), n).toBe(true);
    }
    expect(Object.isFrozen(plo6StrategyOptionVerdict)).toBe(true);
  });
});
