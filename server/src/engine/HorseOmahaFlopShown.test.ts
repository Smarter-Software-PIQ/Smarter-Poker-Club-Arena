/**
 * What a flop bet showed and what calling it returned (HorseOmahaFlopShown): the class of a hand on a flop held
 * to the repository's evaluator and to the flop verdict's own class, one hand's evidence from the public record
 * only, the integer add rule and its bounds, validation and the wire row, the readers, and the parity vectors
 * the database twin is held to (scripts/ci/fixtures/horse-flop-shown-vectors.json,
 * scripts/ci/test-horse-exact-public-memory.py).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { omahaFlopHandClass } from './HorseOmahaFlopFacingBetEv.js';
import {
  FLOP_SHOWN_BET_LENGTH,
  FLOP_SHOWN_CALL_LENGTH,
  FLOP_SHOWN_MIN_SHOWN,
  FLOP_SHOWN_PRIOR_MASS,
  FLOP_SHOWN_ROW_LENGTH,
  addFlopShownEvidence,
  copyFlopShown,
  emptyFlopShown,
  flopShownBetIndex,
  flopShownBetRead,
  flopShownCallIndex,
  flopShownCallRead,
  flopShownCarriedFor,
  flopShownCategory,
  flopShownClassOf,
  flopShownFromRow,
  flopShownRow,
  flopShownShare,
  validFlopShown,
} from './HorseOmahaFlopShown.js';
import {
  FLOP_SHOWN_VECTOR_NAMED,
  buildFlopShownVectors,
  engineFlopShownClass,
  engineFlopShownIncrements,
  holeCardOf,
  type FlopShownVectorHand,
} from './HorseOmahaFlopShown.test-support.js';
import { copyFlopShownRecord } from './HorseOpponentMemory.js';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const named = (prefix: string): FlopShownVectorHand => {
  const v = FLOP_SHOWN_VECTOR_NAMED.find((x) => x.name.startsWith(prefix));
  if (!v) throw new Error('no named vector: ' + prefix);
  return v.hand;
};
const row = (cells: Record<number, number>): number[] => {
  const r = new Array<number>(FLOP_SHOWN_ROW_LENGTH).fill(0);
  for (const [i, v] of Object.entries(cells)) r[Number(i)] = v;
  return r;
};
const callAt = (kind: 'horse' | 'person', cell: Parameters<typeof flopShownCallIndex>[1]) =>
  FLOP_SHOWN_BET_LENGTH + flopShownCallIndex(kind, cell);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DECK: string[] = [...'23456789TJQKA'].flatMap((r) => [...'shdc'].map((s) => r + s));
function deals(seed: number, count: number): { hole: Card[]; flop: Card[] }[] {
  const rnd = rng(seed);
  const out: { hole: Card[]; flop: Card[] }[] = [];
  for (let k = 0; k < count; k++) {
    // Half the deals come from two suits and nine ranks, so straights, flushes and full houses are common.
    const from =
      k % 2 === 0 ? DECK.filter((c) => 'sh'.includes(c[1]) && '56789TJQK'.includes(c[0])) : DECK;
    const d = [...from];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    const n = 4 + (k % 3);
    out.push({
      hole: d.slice(0, n).map(holeCardOf) as unknown as Card[],
      flop: d.slice(n, n + 3).map(holeCardOf) as unknown as Card[],
    });
  }
  return out;
}

describe('the class of a hand on a flop', () => {
  it("the category is the evaluator's on 6000 dealt hands of four, five and six cards", () => {
    const seen = new Set<number>();
    for (const { hole, flop } of deals(11, 6000)) {
      const want = Math.min(9, Math.floor(scoreOmahaHiPartial([...hole], [...flop]) / 0x100000));
      const got = flopShownCategory(hole, flop);
      expect(got, JSON.stringify({ hole, flop })).toBe(want);
      seen.add(got);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("the caller class is the flop verdict's own (omahaFlopHandClass) on 6000 dealt hands", () => {
    const seen = new Set<string>();
    for (const { hole, flop } of deals(12, 6000)) {
      const got = flopShownClassOf(hole, flop);
      expect(got?.caller, JSON.stringify({ hole, flop })).toBe(omahaFlopHandClass(hole, flop));
      seen.add(got!.caller);
    }
    expect([...seen].sort()).toEqual(['draw', 'made', 'pair']);
  });

  it('the bet class stands on each of its rules', () => {
    const k = (hole: string, flop: string) => engineFlopShownClass(hole, flop);
    expect(k('Kh Kd 9s 4s', 'Ks 8h 3c')).toBe('nut:made'); // top set
    expect(k('8s 8d 9s 4s', 'Ks 8h 3c')).toBe('strong:made'); // a lower set
    expect(k('Kh Kd 9s 4s', 'Ks 8s 3s')).toBe('strong:made'); // top set under a possible flush
    expect(k('As Qs 9d 4d', 'Ks 8s 3s')).toBe('nut:made'); // the nut flush
    expect(k('Qs Js 9d 4d', 'Ks 8s 3s')).toBe('strong:made'); // a lower flush
    expect(k('Qs Js 9d 4d', 'Ks Ts 9s')).toBe('nut:made'); // a straight flush
    expect(k('Qd Jh 9d 4d', 'Kc Ts 9s')).toBe('nut:made'); // the highest straight the flop allows
    expect(k('8d 7h 2d 2c', 'Jc Ts 9s')).toBe('strong:made'); // the low end
    expect(k('6d 5h Kd Kc', '4c 3s 2s')).toBe('nut:made'); // six-high is the nut straight here
    expect(k('Ad 5h Kd Kc', '4c 3s 2s')).toBe('strong:made'); // the wheel under it
    expect(k('Kh 8d 9s 4s', 'Ks 8h 3c')).toBe('strong:made'); // two pair on an unpaired flop
    expect(k('Ah Kd 9s 4s', 'Ks 8h 3c')).toBe('weak:pair'); // one pair
    expect(k('Ah Qd 9s 4s', 'Ks 8h 3c')).toBe('air:pair'); // nothing
    expect(k('Ah Qh 9s 4s', 'Kh 8h 3c')).toBe('strongDraw:draw'); // the nut flush draw
    expect(k('Qh Jh 9s 4s', 'Kh 8h 3c')).toBe('air:draw'); // a bare lower flush draw, no pair
    expect(k('Qh Jh Ks 4s', 'Kh 8h 3c')).toBe('weak:draw'); // the same with a pair
    expect(k('Qh Jh Ts 9s', 'Kh 8h 7c')).toBe('strongDraw:draw'); // a flush draw with a straight draw
    expect(k('Qd Jh Ts 9s', 'Kh 8c 7c')).toBe('strongDraw:draw'); // a wrap
    expect(k('6d 5h As Ks', 'Qh 8c 7c')).toBe('air:draw'); // eight outs alone
    expect(k('Kh 9d 9s 4s', 'Ks Kd 3c')).toBe('strong:made'); // trips with the board's pair
    expect(k('Kh 3d 9s 4s', 'Ks Kd 3c')).toBe('nut:made'); // a full house
    expect(k('Ah Ad 9s 4s', 'Ks Kd 3c')).toBe('weak:made'); // a pocket pair and the board's pair
    expect(k('Ah Qd 9s 4s', 'Ks Kd 3c')).toBe('air:pair'); // the board's pair alone
    expect(k('Ah Qd 9s 4s', 'Ks Kd Kc')).toBe('air:made'); // the board's three of a kind alone
    expect(k('Ah Kd 9s', 'Ks 8h 3c')).toBe('null'); // three cards
    expect(k('Ah Kd', 'Ks 8h 3c')).toBe('null'); // a hold-em hand
    expect(k('Ah Kd 9s Ks', 'Ks 8h 3c')).toBe('null'); // a card dealt twice
    expect(flopShownClassOf(null, null)).toBeNull();
    expect(flopShownClassOf([{ rank: '1', suit: 'x' }, 1, 2, 3], [])).toBeNull();
  });
});

describe("one hand's evidence, from the public record only", () => {
  const cbetTopSet = flopShownBetIndex('cbet', 'rainbow', 'nut');
  it('a shown continuation bet is classed; a shown caller is counted with his price and his return', () => {
    // A bets 10 into B, who calls 10 with one pair out of position and loses: paid 5 bb, returned -5 bb.
    expect(engineFlopShownIncrements(named('a continuation bet shown as top set'))).toEqual({
      [A]: row({
        [cbetTopSet]: 1,
        [callAt('person', 'pair')]: 1,
        [callAt('person', 'pair') + 1]: 500,
        [callAt('person', 'pair') + 2]: -500,
        [callAt('person', 'pair') + 3]: 1,
      }),
    });
    expect(engineFlopShownIncrements(named('the same hand, the caller a Horse'))).toEqual({
      [A]: row({
        [cbetTopSet]: 1,
        [callAt('horse', 'pair')]: 1,
        [callAt('horse', 'pair') + 1]: 500,
        [callAt('horse', 'pair') + 2]: -500,
        [callAt('horse', 'pair') + 3]: 1,
      }),
    });
  });

  it('a mucked, folded or unlisted hand is never read: the caller is unshown, the bettor has no class', () => {
    const unshown = row({
      [cbetTopSet]: 1,
      [callAt('person', 'unshown')]: 1,
      [callAt('person', 'unshown') + 1]: 500,
      [callAt('person', 'unshown') + 2]: -500,
      [callAt('person', 'unshown') + 3]: 1,
    });
    expect(engineFlopShownIncrements(named('the caller mucks'))).toEqual({ [A]: unshown });
    // Cards written for a player the showdown lists as mucked are still not read.
    expect(engineFlopShownIncrements(named('a mucked showdown entry is never read'))).toEqual({
      [A]: unshown,
    });
    // The bettor mucks: nothing in his bet cells; the shown caller won 30.5 less the 10 he called: +10.25 bb.
    expect(engineFlopShownIncrements(named('the bettor mucks'))).toEqual({
      [A]: row({
        [callAt('person', 'pair')]: 1,
        [callAt('person', 'pair') + 1]: 500,
        [callAt('person', 'pair') + 2]: 1025,
        [callAt('person', 'pair') + 3]: 1,
      }),
    });
    const noList = engineFlopShownIncrements(named('cards without a showdown entry'));
    expect(noList[A].slice(0, FLOP_SHOWN_BET_LENGTH).every((v) => v === 0)).toBe(true);
    expect(noList[A][callAt('person', 'unshown')]).toBe(1);
  });

  it('a showdown entry shows a hand only with mucked: false written out (review note N4, 20261119213206)', () => {
    // no key, null, the string "false", 0: not shown, exactly as if he were not listed at all
    expect(
      engineFlopShownIncrements(named('a showdown entry shows a hand only with mucked: false'))
    ).toEqual(engineFlopShownIncrements(named('cards without a showdown entry')));
    // the bettor listed with mucked: false is classed; the caller listed with mucked: null is unshown
    expect(engineFlopShownIncrements(named('the bettor shown with mucked: false'))).toEqual(
      engineFlopShownIncrements(named('the caller mucks'))
    );
    for (const mucked of [undefined, null, 'false', 0, true]) {
      const h = named('the bettor shown with mucked: false');
      const showdown = (h.showdown as Record<string, unknown>[]).map((e) => ({ ...e }));
      if (mucked === undefined) delete showdown[0].mucked;
      else showdown[0].mucked = mucked;
      const got = engineFlopShownIncrements({ ...h, showdown });
      expect(
        got[A].slice(0, FLOP_SHOWN_BET_LENGTH).every((v) => v === 0),
        String(mucked)
      ).toBe(true);
    }
  });

  it('the cards of a player the record does not show change nothing, whatever they are', () => {
    const base = named('the caller mucks');
    const want = engineFlopShownIncrements(base);
    for (const cards of ['Ac 8c 7d 6d', 'Qs Qh Qd Qc', '2s 2h 2d 5c'])
      for (const where of ['players', 'actions', 'mucked'] as const) {
        const h = JSON.parse(JSON.stringify(base)) as FlopShownVectorHand & { players?: unknown };
        const held = cards.split(' ').map(holeCardOf);
        if (where === 'players') h.players = [{ userId: B, cards: held }];
        if (where === 'actions')
          (h.actions as Record<string, unknown>[]).forEach((a) => (a.holeCards = held));
        if (where === 'mucked') (h.hole_cards as Record<string, unknown>)[B] = held;
        expect(engineFlopShownIncrements(h)).toEqual(want);
      }
  });

  it('a lead is a first bet; an in-position draw is its own cell; an uncalled bet returned is not money put in', () => {
    // B leads 9 and bets 20; A (a Horse, not shown: unshown) calls both, bets 40 on the river, B folds, 40 returned.
    // A put in 9 + 20 from his call (the 40 came back) and was paid 67: +38 chips = +19 bb.
    expect(engineFlopShownIncrements(named('a lead by the caller'))).toEqual({
      [B]: row({
        [callAt('horse', 'unshown')]: 1,
        [callAt('horse', 'unshown') + 1]: 450,
        [callAt('horse', 'unshown') + 2]: 1900,
        [callAt('horse', 'unshown') + 3]: 1,
      }),
    });
  });

  it('a raise closes the calls of his bet; two callers of one bet are both counted, by position', () => {
    const raised = engineFlopShownIncrements(named('a raise closes the calls'));
    // B called 12 before the raise, then folded: unshown, paid 6 bb, returned -6 bb. C raised: not a caller.
    expect(raised).toEqual({
      [A]: row({
        [flopShownBetIndex('cbet', 'twoTone', 'nut')]: 1,
        [callAt('person', 'unshown')]: 1,
        [callAt('person', 'unshown') + 1]: 600,
        [callAt('person', 'unshown') + 2]: -600,
        [callAt('person', 'unshown') + 3]: 1,
      }),
    });
    const two = engineFlopShownIncrements(named('two callers of one bet'));
    // A showed top set. B (a flush draw) is not last to act: out of position. C (a straight draw on the flop)
    // acts last: in position, and wins 51.5 less his 12: +19.75 bb.
    expect(two).toEqual({
      [A]: row({
        [flopShownBetIndex('cbet', 'twoTone', 'nut')]: 1,
        [callAt('horse', 'drawOop')]: 1,
        [callAt('horse', 'drawOop') + 1]: 600,
        [callAt('horse', 'drawOop') + 2]: -600,
        [callAt('horse', 'drawOop') + 3]: 1,
        [callAt('horse', 'drawIp')]: 1,
        [callAt('horse', 'drawIp') + 1]: 600,
        [callAt('horse', 'drawIp') + 2]: 1975,
        [callAt('horse', 'drawIp') + 3]: 1,
      }),
    });
  });

  it('no single flop, a bomb pot and a flop without a clean first bet give nothing; damage never throws', () => {
    expect(engineFlopShownIncrements(named('a double-board hand with two flops'))).toEqual({});
    expect(
      Object.keys(engineFlopShownIncrements(named('a second board that shares the flop')))
    ).toEqual([A]);
    expect(engineFlopShownIncrements(named('a bomb pot is not read'))).toEqual({});
    expect(engineFlopShownIncrements(named('a first flop wager that is an all-in'))).toEqual({});
    const noMoney = engineFlopShownIncrements(named('no winners list or no big blind'));
    expect(noMoney).toEqual({ [A]: row({ [cbetTopSet]: 1 }) });
    const holdem = engineFlopShownIncrements(named('a hold-em hand'));
    expect(holdem[A].slice(0, FLOP_SHOWN_BET_LENGTH).every((v) => v === 0)).toBe(true);
    expect(holdem[A][callAt('person', 'unshown')]).toBe(1);
    // A's bet of 1e300 and the winners' 1e300 read as 0; B's call has no kind; C's call of "ten" costs 0; A's
    // cards hold one that is not a card, so his bet has no class.
    expect(engineFlopShownIncrements(named('damaged amounts'))).toEqual({
      [A]: row({ [callAt('person', 'unshown')]: 1, [callAt('person', 'unshown') + 3]: 1 }),
    });
    for (const junk of [null, 7, 'x', {}, [null, 7, 'x', {}]])
      expect(
        engineFlopShownIncrements({
          actions: junk,
          community_cards: junk,
          community_cards2: junk,
          hole_cards: junk,
          showdown: junk,
          winners: junk,
          big_blind: junk,
        })
      ).toEqual({});
  });
});

describe('the add rule', () => {
  const inc = (bet: Record<number, number>, call: Record<number, number> = {}) => {
    const r = emptyFlopShown();
    for (const [i, v] of Object.entries(bet)) r.bet[Number(i)] = v;
    for (const [i, v] of Object.entries(call)) r.call[Number(i)] = v;
    return r;
  };
  it('a hand with no evidence leaves the record as it was; null stays null', () => {
    expect(addFlopShownEvidence(null, null)).toBeNull();
    expect(addFlopShownEvidence(null, emptyFlopShown())).toBeNull();
    const base = addFlopShownEvidence(null, inc({ 0: 1 }))!;
    expect(addFlopShownEvidence(base, emptyFlopShown())).toBe(base);
    expect(addFlopShownEvidence(base, undefined)).toBe(base);
  });
  it('only the line and texture that took a shown bet age, by 977/1000 truncated; nothing is mutated', () => {
    const one = addFlopShownEvidence(null, inc({ 0: 1 }))!;
    expect(one.bet[0]).toBe(1000);
    const frozen = JSON.stringify(one);
    const two = addFlopShownEvidence(one, inc({ 1: 1 }))!;
    expect(two.bet.slice(0, 5)).toEqual([977, 1000, 0, 0, 0]);
    const other = addFlopShownEvidence(two, inc({ 7: 1 }))!;
    expect(other.bet.slice(0, 8)).toEqual([977, 1000, 0, 0, 0, 0, 0, 1000]);
    expect(JSON.stringify(one)).toBe(frozen);
  });
  it('a call cell ages its calls, price and return and keeps a count that never ages', () => {
    let r = addFlopShownEvidence(null, inc({}, { 0: 1, 1: 500, 2: -501, 3: 1 }))!;
    expect(r.call.slice(0, 4)).toEqual([1000, 500, -501, 1]);
    r = addFlopShownEvidence(r, inc({}, { 0: 2, 1: 300, 2: 77, 3: 2 }))!;
    // -501 * 977 / 1000 = -489.477: truncated toward zero.
    expect(r.call.slice(0, 4)).toEqual([977 + 2000, 488 + 300, -489 + 77, 3]);
    expect(r.call.slice(4).every((v) => v === 0)).toBe(true);
  });
  it('every number stays an integer inside its bound for ever, and the record stays valid', () => {
    let r: ReturnType<typeof addFlopShownEvidence> = null;
    const full = emptyFlopShown();
    for (let g = 0; g < FLOP_SHOWN_BET_LENGTH; g += 5) full.bet[g] = 1;
    for (let i = 0; i < FLOP_SHOWN_CALL_LENGTH; i += 4) {
      full.call[i] = 8;
      full.call[i + 1] = 800000;
      full.call[i + 2] = i % 8 ? 800000 : -800000;
      full.call[i + 3] = 8;
    }
    for (let k = 0; k < 3000; k++) r = addFlopShownEvidence(r, full);
    expect(validFlopShown(r)).toBe(true);
    expect(Math.max(...r!.bet)).toBeLessThanOrEqual(43479);
    expect(Math.max(...r!.call.filter((_, i) => i % 4 === 0))).toBeLessThanOrEqual(347827);
    expect(JSON.stringify(flopShownRow(r!)).length).toBeLessThan(700);
  });
  it('a damaged stored or supplied number counts as 0', () => {
    const damaged = { bet: ['x', 2.5, null, 1000], call: 7 } as never;
    const r = addFlopShownEvidence(damaged, inc({ 0: 1 }, { 0: 1, 1: 5, 2: 5, 3: 1 }))!;
    expect(r.bet.slice(0, 5)).toEqual([1000, 0, 0, 977, 0]);
    expect(r.call.slice(0, 4)).toEqual([1000, 5, 5, 1]);
    expect(validFlopShown(r)).toBe(true);
  });
});

describe('validation, the wire row and the stored copy', () => {
  const some = addFlopShownEvidence(null, {
    bet: emptyFlopShown().bet.map((_, i) => (i === 3 ? 1 : 0)),
    call: emptyFlopShown().call.map((_, i) => (i === 8 ? 1 : i === 10 ? -250 : i === 11 ? 1 : 0)),
  })!;
  it('a record is exactly two integer lists inside their bounds', () => {
    expect(validFlopShown(some)).toBe(true);
    expect(validFlopShown(emptyFlopShown())).toBe(true);
    for (const bad of [
      null,
      7,
      [],
      {},
      { bet: some.bet },
      { ...some, extra: 1 },
      { bet: some.bet.slice(1), call: some.call },
      { bet: some.bet.map((v, i) => (i ? v : 0.5)), call: some.call },
      { bet: some.bet.map((v, i) => (i ? v : -1)), call: some.call },
      { bet: some.bet.map((v, i) => (i ? v : 50001)), call: some.call },
      { bet: some.bet, call: some.call.map((v, i) => (i === 3 ? -1 : v)) },
      { bet: some.bet, call: some.call.map((v, i) => (i === 2 ? 4e7 + 1 : v)) },
      { bet: some.bet, call: some.call.map((v, i) => (i ? v : NaN)) },
    ])
      expect(validFlopShown(bad), JSON.stringify(bad)).toBe(false);
  });
  it('the row round-trips, a copy is detached, and a malformed row is null', () => {
    const r = flopShownRow(some);
    expect(r).toHaveLength(FLOP_SHOWN_ROW_LENGTH);
    expect(flopShownFromRow(r)).toEqual(some);
    expect(flopShownFromRow(r.slice(1))).toBeNull();
    expect(flopShownFromRow(r.map((v, i) => (i ? v : 0.25)))).toBeNull();
    const c = copyFlopShown(some);
    c.bet[0] = 9;
    expect(some.bet[0]).toBe(0);
  });
  it('a stored profile copy keeps a well-formed record, keeps null, and drops a malformed one', () => {
    expect(copyFlopShownRecord({})).toEqual({});
    expect(copyFlopShownRecord({ flop_shown: null })).toEqual({ flop_shown: null });
    expect(copyFlopShownRecord({ flop_shown: { bet: [1], call: [] } })).toEqual({});
    const kept = copyFlopShownRecord({ flop_shown: some });
    expect(kept).toEqual({ flop_shown: some });
    expect(kept.flop_shown).not.toBe(some);
  });
  it('only the Omaha family carries it', () => {
    for (const v of ['plo4', 'plo5', 'plo6', 'plo8', 'flo8', 'PLO5'])
      expect(flopShownCarriedFor(v)).toBe(true);
    for (const v of ['nlh', 'flh', 'short_deck', 'pineapple', '', null, undefined])
      expect(flopShownCarriedFor(v)).toBe(false);
  });
});

describe('the readers', () => {
  it('his shown bets of one line and texture, by class; a share only from eight shown bets, against the prior given', () => {
    let r: ReturnType<typeof addFlopShownEvidence> = null;
    const bet = (klass: Parameters<typeof flopShownBetIndex>[2]) => {
      const i = emptyFlopShown();
      i.bet[flopShownBetIndex('cbet', 'paired', klass)] = 1;
      r = addFlopShownEvidence(r, i);
    };
    expect(flopShownBetRead(null, 'cbet', 'paired')).toBeNull();
    for (let k = 0; k < 7; k++) bet(k % 2 ? 'nut' : 'air');
    const thin = flopShownBetRead(r, 'cbet', 'paired')!;
    expect(thin.shown).toBeLessThan(FLOP_SHOWN_MIN_SHOWN);
    expect(flopShownShare(thin, ['nut'], 0.3)).toBeNull();
    for (let k = 0; k < 6; k++) bet('nut');
    const read = flopShownBetRead(r, 'cbet', 'paired')!;
    expect(read.shown).toBeGreaterThanOrEqual(FLOP_SHOWN_MIN_SHOWN);
    expect(read.byClass.nut + read.byClass.air).toBeCloseTo(read.shown, 9);
    const share = flopShownShare(read, ['nut', 'strong'], 0.3)!;
    expect(share.share).toBeCloseTo(
      (read.byClass.nut + FLOP_SHOWN_PRIOR_MASS * 0.3) / (read.shown + FLOP_SHOWN_PRIOR_MASS),
      12
    );
    expect(share.share).toBeGreaterThan(0.3);
    expect(flopShownShare(read, ['nut'], 1.5)).toBeNull();
    expect(flopShownBetRead(r, 'first', 'paired')!.shown).toBe(0);
    expect(flopShownBetRead(r, 'cbet', 'rainbow')!.shown).toBe(0);
  });
  it('what calls of his bets returned, by caller kind and cell', () => {
    const i = emptyFlopShown();
    const at = flopShownCallIndex('horse', 'drawOop');
    i.call[at] = 2;
    i.call[at + 1] = 1200;
    i.call[at + 2] = -900;
    i.call[at + 3] = 2;
    const r = addFlopShownEvidence(null, i)!;
    expect(flopShownCallRead(r, 'horse', 'drawOop')).toEqual({
      calls: 2,
      paidBb: 12,
      netBb: -9,
      n: 2,
      netPerCallBb: -4.5,
      returnOnCall: -0.75,
    });
    expect(flopShownCallRead(r, 'person', 'drawOop')).toEqual({
      calls: 0,
      paidBb: 0,
      netBb: 0,
      n: 0,
      netPerCallBb: null,
      returnOnCall: null,
    });
    expect(flopShownCallRead({ bet: [], call: [] } as never, 'horse', 'made')).toBeNull();
  });
});

describe('the parity vectors the database twin is held to', () => {
  it('the committed file is exactly what the engine computes (regenerate with scripts/generate-horse-flop-shown-vectors.ts)', () => {
    const file = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../scripts/ci/fixtures/horse-flop-shown-vectors.json'),
        'utf8'
      )
    );
    const now = JSON.parse(JSON.stringify(buildFlopShownVectors()));
    expect(file).toEqual(now);
    const live = now.random.filter((r: { expected: object }) => Object.keys(r.expected).length > 0);
    expect(live.length).toBeGreaterThanOrEqual(60);
    const cells = new Set<number>();
    for (const r of live)
      for (const rowOf of Object.values(r.expected as Record<string, number[]>))
        rowOf.forEach((v, i) => v !== 0 && cells.add(i));
    // the random hands reach bet cells and call cells of both kinds, shown and unshown
    expect([...cells].filter((i) => i < 40).length).toBeGreaterThanOrEqual(8);
    expect([...cells].filter((i) => i >= 40).length).toBeGreaterThanOrEqual(12);
    const classes = new Set(now.classes.map((c: { expected: string }) => c.expected));
    expect(classes.size).toBeGreaterThanOrEqual(11);
  });
});
