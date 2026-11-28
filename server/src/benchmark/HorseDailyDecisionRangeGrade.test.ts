import { describe, expect, it } from 'vitest';
import {
  RANGE_GRADE,
  buildReport,
  gradeHand,
  parseCards,
  priceSpot,
  rangeActionWeight,
  rangeGradeHand,
  rangeSection,
  renderMarkdown,
  renderRangeSection,
  validateRangeGrade,
  type GradedDecision,
  type RangeGradedDecision,
  type RangeSpot,
  type RawAction,
  type RawHand,
  type SeatTuple,
} from './HorseDailyDecisionGrade.js';
import { insuranceEquity } from '../engine/InsuranceEquity.js';

const cards = (s: string) => parseCards(s)!;
const seat = (n: number, stack: number, sbet: number, inv: number, flags = 0): SeatTuple => [
  n,
  stack,
  sbet,
  inv,
  0,
  0,
  flags,
];
const act = (a: Partial<RawAction> & Pick<RawAction, 'seat' | 'stage' | 'action'>): RawAction => ({
  amount: 0,
  origin: 'horse_policy',
  pot: 0,
  toCall: 0,
  currentBet: 0,
  board: '',
  seats: [],
  ...a,
});
const DRAWS = 400;

// Seat 1 a person, seats 2 and 3 Horses. PLO4, blinds 1/2, river As Td 6s 4c 9h (as in the daily grade's tests).
const BOARD = 'AsTd6s4c9h';
function riverHand(over: Partial<RawHand> = {}): RawHand {
  return {
    id: 'h1',
    created_at: '2026-11-20T20:00:00Z',
    g: 'plo4',
    bb: 2,
    tournament: false,
    ltg: false,
    bomb: false,
    build: 'x',
    facts: [
      { uid: 'p', seat: 1, net: 60, net_bb: 30, invested: 60, horse: false, alias: 'vera' },
      { uid: 'h2', seat: 2, net: -20, net_bb: -10, invested: 20, horse: true, alias: 'slow_cocoa' },
      { uid: 'h3', seat: 3, net: -60, net_bb: -30, invested: 60, horse: true, alias: 'MrFox' },
    ],
    acts: [
      act({
        seat: 1,
        stage: 'river',
        action: 'bet',
        amount: 40,
        origin: 'player',
        pot: 60,
        board: BOARD,
        seats: [seat(1, 200, 0, 20), seat(2, 200, 0, 20), seat(3, 200, 0, 20)],
      }),
      act({
        seat: 2,
        stage: 'river',
        action: 'fold',
        pot: 100,
        toCall: 40,
        currentBet: 40,
        board: BOARD,
        seats: [seat(1, 160, 40, 60), seat(2, 200, 0, 20), seat(3, 200, 0, 20)],
      }),
      act({
        seat: 3,
        stage: 'river',
        action: 'call',
        amount: 40,
        pot: 100,
        toCall: 40,
        currentBet: 40,
        board: BOARD,
        seats: [seat(1, 160, 40, 60), seat(2, 200, 0, 20, 1), seat(3, 200, 0, 20)],
      }),
    ],
    horse_cards: [
      { uid: 'h2', seat: 2, cards: ['Ah', 'Kd', '7c', '2d'] },
      { uid: 'h3', seat: 3, cards: ['Ac', 'Tc', '3d', '2h'] },
    ],
    shown: { p: ['6d', '6c', 'Kh', 'Qh'] },
    ...over,
  };
}
const rangeOf = (h: RawHand) => rangeGradeHand(h, gradeHand(h, insuranceEquity), DRAWS);

describe('range grade: one to one with the daily grade, public information only', () => {
  it('prices the same decisions in the same order, and the real-card column is exact on the river', () => {
    const h = riverHand();
    const base = gradeHand(h, insuranceEquity);
    const r = rangeOf(h);
    expect(r.map((d) => d.base)).toEqual(base);
    expect(r.map((d) => d.family)).toEqual(['postflop', 'postflop']);
    for (const d of r) {
      expect(d.ungraded).toBeNull();
      expect(Number.isFinite(d.rangeLossBb)).toBe(true);
      expect(d.ess!).toBeGreaterThanOrEqual(RANGE_GRADE.essMin);
    }
    // Real cards: the person's set of sixes beats both Horses. Folding saved the 40 call (-20 bb);
    // calling lost it (+20 bb).
    expect(r[0].realLossBb).toBeCloseTo(-20, 9);
    expect(r[1].realLossBb).toBeCloseTo(20, 9);
  });

  it("never reads a person's real cards: the range grade is identical whether or not they were shown", () => {
    const shown = rangeOf(riverHand());
    const hidden = rangeOf(riverHand({ shown: null }));
    expect(hidden.map((d) => d.rangeLossBb)).toEqual(shown.map((d) => d.rangeLossBb));
    // without the person's cards there is no ground truth, so no validation value
    expect(hidden.map((d) => d.realLossBb)).toEqual([null, null]);
    // and the daily grade's own coverage gap is exactly what this closes
    const base = gradeHand(riverHand({ shown: null }), insuranceEquity);
    expect(base[0].ungraded).toBe('person_cards_not_shown');
    expect(hidden[0].rangeLossBb).not.toBeNull();
  });

  it('is deterministic (seeded per decision)', () => {
    expect(rangeOf(riverHand()).map((d) => d.rangeLossBb)).toEqual(
      rangeOf(riverHand()).map((d) => d.rangeLossBb)
    );
  });

  it('a raise or bet narrows the range to stronger holdings by the declared weights', () => {
    expect(rangeActionWeight('raise', 0.85)).toBe(1);
    expect(rangeActionWeight('raise', 0.5)).toBe(0.15);
    expect(rangeActionWeight('preflop_open', 0.6)).toBe(0.05);
    expect(rangeActionWeight('check', 0)).toBe(1);
    // NLH river, the Horse calls 10 into 20 with one pair; against an opponent who raised the
    // flop and bet the river the call is worse than against an opponent with no voluntary action.
    const board = cards('Ks9d4c2h7s');
    const flop = board.slice(0, 3);
    const spot = (history: RangeSpot['opps'][0]['history']): RangeSpot => ({
      g: 'nlh',
      bb: 2,
      action: 'call',
      hero: cards('Kd8c'),
      board,
      pot: 30,
      pay: 10,
      potFor: 30,
      added: 10,
      heroStreetWager: 0,
      opps: [{ streetWager: 10, behind: 100, allIn: false, history, real: null }],
    });
    const passive = priceSpot(spot([]), 'range', 's', 3000).lossBb;
    const strong = priceSpot(
      spot([
        { kind: 'raise', board: flop },
        { kind: 'bet', board },
      ]),
      'range',
      's',
      3000
    ).lossBb;
    expect(strong).toBeGreaterThan(passive);
  });

  it('prices an unopened bet against checking with the declared response model', () => {
    // The Horse holds the royal flush; the opponent's real holding is the weakest high card,
    // so it continues with the floor probability 0.3: EVbet - EVcheck = 0.3 x 10 = 3 chips = 1.5 bb.
    const r = priceSpot(
      {
        g: 'nlh',
        bb: 2,
        action: 'bet',
        hero: cards('Ts3c'),
        board: cards('AsKsQsJs2d'),
        pot: 20,
        pay: 0,
        potFor: 20,
        added: 10,
        heroStreetWager: 0,
        opps: [{ streetWager: 0, behind: 100, allIn: false, history: [], real: cards('3h4c') }],
      },
      'real',
      's',
      50
    );
    expect(r.lossBb).toBeCloseTo(-1.5, 9);
  });
});

describe('range grade: the declared validation bar', () => {
  const dec = (i: number, range: number, real: number): RangeGradedDecision => ({
    base: {
      hand: `h${i}`,
      game: 'plo5',
      pool: 'table',
      street: 'flop',
      situation: 'facing 34-66% pot',
      action: 'call',
      cls: 'x',
      headsUp: true,
      persons: [i % 3 === 0 ? 'ann' : 'bob'],
      lossBb: null,
      basis: 'realised',
      ungraded: null,
    } as GradedDecision,
    family: 'postflop',
    rangeLossBb: range,
    ungraded: null,
    ess: 500,
    realLossBb: real,
  });
  const reals = Array.from({ length: 90 }, (_, i) => ((i * 37) % 41) - 20 + 0.5);

  it('passes when the range grade tracks the real-card grade', () => {
    const v = validateRangeGrade(reals.map((x, i) => dec(i, x * 0.95 + 0.1, x)));
    expect(v[0].verdict).toBe('PASS');
    expect(v[1].verdict).toBe('INCONCLUSIVE');
  });
  it('fails when the signs disagree', () => {
    const v = validateRangeGrade(reals.map((x, i) => dec(i, -x, x)));
    expect(v[0].verdict).toBe('FAIL');
    expect(v[0].all.v1).toBe(false);
  });
  it('fails on a biased mean even when the signs mostly agree', () => {
    const v = validateRangeGrade(reals.map((x, i) => dec(i, x + 8, x)));
    expect(v[0].all.v2).toBe(false);
    expect(v[0].verdict).toBe('FAIL');
  });
  it('is inconclusive below the declared minimum n', () => {
    expect(validateRangeGrade(reals.slice(0, 20).map((x, i) => dec(i, x, x)))[0].verdict).toBe(
      'INCONCLUSIVE'
    );
  });
  it('a group that fails is NOT GRADED: the miss is stated and none of its rows is flagged', () => {
    // 2026-11-27: G2 failed V2 with WooWoo excluded and its roll-up still printed FLAGGED marks
    const g2 = reals.map((x, i) => ({ ...dec(i, x + 8, x), family: 'preflop_r1' as const }));
    const s = rangeSection(g2);
    expect(s.validation[1].verdict).toBe('FAIL');
    const md = renderRangeSection(s).join('\n');
    expect(md).toContain('**G2 preflop_r1 is NOT GRADED in this report (FAIL).** 90 of its');
    expect(md).toMatch(
      /all validation decisions: the range grade's mean is \+8\.00 bb per decision off/
    );
    expect(md).toContain('The bar is unchanged.');
    expect(md).not.toContain('FLAGGED');
    expect(md).toContain('| ALL G2 (preflop_r1) | 90 |');
    expect(md).toMatch(/\| ALL G2 \(preflop_r1\) \| 90 \|.*\| not graded \|/);
    // G1 here is inconclusive (no decisions), stated as such
    expect(md).toContain('only 0 validation decisions, below the declared 60');
  });
  it('counts coverage against the daily grade rows', () => {
    const s = rangeSection([
      dec(1, 1, 1),
      {
        ...dec(2, 1, 1),
        base: { ...dec(2, 1, 1).base, basis: null, ungraded: 'person_cards_not_shown' },
      },
      { ...dec(3, 1, 1), rangeLossBb: null, ungraded: 'range_ess_low' },
    ]);
    expect(s.coverage.realised).toEqual({ rows: 2, graded: 1, byFamily: { postflop: 1 } });
    expect(s.coverage.unshown).toEqual({ rows: 1, graded: 1, byFamily: { postflop: 1 } });
  });
});

describe('range grade in the report', () => {
  const input = {
    command: 'test',
    startMs: Date.parse('2026-11-20T19:00:00Z'),
    endMs: Date.parse('2026-11-20T21:00:00Z'),
    hands: [riverHand()],
    equity: insuranceEquity,
  };
  it('leaves the real-card sections unchanged and adds its own section only when asked', () => {
    const plain = buildReport(input);
    const withRange = buildReport({ ...input, rangeGrade: true, rangeDraws: DRAWS });
    expect('range' in plain).toBe(false);
    expect(withRange.sections).toEqual(plain.sections);
    const mdPlain = renderMarkdown(plain, null, null);
    const md = renderMarkdown(withRange, null, null);
    expect(md.startsWith(mdPlain.trimEnd())).toBe(true);
    expect(md).toContain('## Range grade');
    expect(md).toContain('INCONCLUSIVE');
    // aggregates only: no hand id, no card
    expect(md).not.toMatch(/\bh1\b/);
    expect(md).not.toMatch(/\b(6d|Kh|Qh|Ah|Kd|Ac|Tc)\b/);
    expect(JSON.stringify(withRange.range)).not.toMatch(/"h1"|6d|Kh/);
  });
});
