/**
 * The six-card defects the PLO6 lane found in the shared PLO helpers
 * (coordination 2026-11-15T20:44:24Z item 2, spec SPEC-A section 2), fixed
 * behind the one game interface (HorseOmahaStrategyGame.ts) with PLO4/PLO5
 * unchanged:
 *
 *   H20  the hole-count checks read the game's hole count, never a literal
 *        4 or 5, so a rule whose game gate admits PLO6 is not silently off.
 *   H9   omahaTurnRedrawShare can count only the full houses no bigger full
 *        house beats (the PLO6 lane's calibration switches it on for PLO6).
 *   H19  the card impact's draw outs of a sampled hand can be the distinct
 *        live completing cards instead of fixed flush and straight counts.
 *   H15  the big draw's continuing range can hold straight draws (13 outs).
 *
 * The PLO4/PLO5 pins below were computed on the base head 8e6bbbea675, before
 * any of these changes, over the same fixed deals.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { RANKS, SUITS } from './PokerEngine.js';
import {
  OMAHA_STRATEGY_HOLE_COUNTS,
  omahaStrategyConstant,
  omahaStrategyHoleCount,
  omahaStrategyHoleCountServed,
  registerOmahaPlo6StrategyCalibration,
  withOmahaStrategyGameScope,
} from './HorseOmahaStrategyGame.js';
import { omahaTurnRedrawShare, omahaTurnRedrawShareOf } from './HorseOmahaMadeHandDefense.js';
import { omahaBluffCatcherCell, v81Cell, type BluffCatcherInput } from './HorseOmahaBigBetCalls.js';
import {
  omahaBigDraw,
  omahaBigDrawContinues,
  omahaBigDrawEquities,
  omahaBigDrawStraightOutCards,
  omahaBigDrawVerdict,
  omahaDrawRaiseBar,
  type OmahaBigDrawInput,
} from './HorseOmahaBigDrawAggression.js';
import {
  omahaPlanHeroInPosition,
  omahaPlanOppLine,
  omahaStreetPlan,
  omahaStreetPlanDomain,
  omahaStreetPlanTurnSpot,
} from './HorseOmahaStreetPlan.js';
import {
  omahaCardImpactDecision,
  omahaCardImpactDrawOuts,
  omahaCardImpactResetCache,
  omahaCardImpactScope,
} from './HorseOmahaCardImpact.js';
import { stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
/** The PLO6 lane's gate on (omahaStrategyInPlo6 === true), as HorseLogic.decide sets it. */
const plo6On = <T>(fn: () => T): T => withOmahaStrategyGameScope({ plo6: true }, fn);

afterEach(() => {
  registerOmahaPlo6StrategyCalibration({});
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  omahaCardImpactResetCache();
});

const DECK: Card[] = [];
for (const suit of SUITS) for (const rank of RANKS) DECK.push({ rank, suit } as Card);
/** Fixed deals (a linear congruential shuffle), the same ones the pins were computed on. */
function deals(holeCount: number, boardCount: number, n: number, seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: Array<{ hole: Card[]; board: Card[] }> = [];
  for (let k = 0; k < n; k++) {
    const d = DECK.slice();
    for (let i = 0; i < holeCount + boardCount; i++) {
      const j = i + Math.floor(next() * (d.length - i));
      const t = d[i]!;
      d[i] = d[j]!;
      d[j] = t;
    }
    out.push({ hole: d.slice(0, holeCount), board: d.slice(holeCount, holeCount + boardCount) });
  }
  return out;
}

type Node = ReturnType<typeof stateAt>;
/** The recorded PLO5 turn node (hand 59521326, the Horse to act, nothing to call). */
const turnNode = (): Node => {
  const f = JSON.parse(JSON.stringify(STRAIGHT)) as ComplaintFixture;
  return stateAt(f, f.actions.find((a) => a.ord === 16)!);
};
/** The same node dealt as PLO6: a sixth hole card that is not on the table. */
const turnNodePlo6 = (): Node => {
  const st = turnNode();
  const taken = new Set(
    [...st.hero.cards, ...(st.gs.communityCards ?? [])].map((c) => `${c.rank}${c.suit}`)
  );
  const sixth = cards('7c7d8c8d')
    .concat(cards('JcJdQcQd'))
    .find((c) => !taken.has(`${c.rank}${c.suit}`))!;
  st.hero.cards = [...st.hero.cards, sixth];
  const me = st.gs.players.find((p) => p.seat === st.hero.seat);
  if (me) me.cards = st.hero.cards;
  st.gs.gameVariant = 'plo6';
  return st;
};

describe('H20: the hole count comes from the game', () => {
  it('the accessor: PLO4 4, PLO5 5, PLO6 6, every other game 0', () => {
    expect(OMAHA_STRATEGY_HOLE_COUNTS).toEqual({ plo4: 4, plo5: 5, plo6: 6 });
    expect(omahaStrategyHoleCount({ gameVariant: 'plo4' })).toBe(4);
    expect(omahaStrategyHoleCount({ gameVariant: 'PLO5' })).toBe(5);
    expect(omahaStrategyHoleCount({ gameVariant: 'plo6' })).toBe(6);
    for (const v of ['plo8', 'plo5_hilo', 'nlh', 'flo8', '', undefined])
      expect(omahaStrategyHoleCount({ gameVariant: v })).toBe(0);
    expect(omahaStrategyHoleCount(null)).toBe(0);
  });

  it('PLO4/PLO5: the new checks are the old literal checks', () => {
    for (let n = 0; n <= 8; n++) {
      // the old `variant === 'plo4' ? 4 : 5`, on the two games it was reached with
      expect(n !== omahaStrategyHoleCount({ gameVariant: 'plo4' })).toBe(n !== 4);
      expect(n !== omahaStrategyHoleCount({ gameVariant: 'plo5' })).toBe(n !== 5);
      // the old `length !== 4 && length !== 5`: equal for every size but six
      if (n !== 6) expect(!omahaStrategyHoleCountServed(n)).toBe(n !== 4 && n !== 5);
    }
    expect(omahaStrategyHoleCountServed(6)).toBe(true);
  });

  it('no literal 4/5 hole-count check is left in the four modules', () => {
    for (const file of [
      'HorseOmahaBigBetCalls.ts',
      'HorseOmahaBigDrawAggression.ts',
      'HorseOmahaStreetPlan.ts',
      'HorseOmahaCardImpact.ts',
    ]) {
      const src = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
      expect(src).not.toMatch(/'plo4' \? 4 : 5/);
      expect(src).not.toMatch(/(hole|cards)\.length !== 4 && [\w.]*(hole|cards)\.length !== 5/);
    }
  });

  const cell = (over: Partial<BluffCatcherInput> = {}): BluffCatcherInput => ({
    variant: 'plo5',
    street: 'river',
    hole: cards('JcJs7c7hAs'),
    board: cards('KsJd2dTc4c'),
    potFrac: 1.1,
    effectiveBB: 200,
    tournament: false,
    headsUpTable: false,
    bountyEvent: false,
    hiLo: false,
    multiBoard: false,
    bombPot: false,
    heroHasStreetChips: true,
    bettorOverBluffs: false,
    callPrice: 0.3,
    chipsBehindCall: true,
    bettorWageredPreviousStreet: false,
    redrawShare: 0,
    ...over,
  });
  const SIX = cards('JcJs7c7hAs3h');

  it('the bluff-catcher cell: a six-card hand reaches it with the PLO6 gate on, and only then', () => {
    expect(omahaBluffCatcherCell(cell())).toBe('bc_trips_set_drawy');
    expect(omahaBluffCatcherCell(cell({ variant: 'plo6', hole: SIX }))).toBeNull();
    plo6On(() => {
      expect(omahaBluffCatcherCell(cell({ variant: 'plo6', hole: SIX }))).toBe(
        'bc_trips_set_drawy'
      );
      // a hand of the wrong size for its game is still outside
      expect(omahaBluffCatcherCell(cell({ variant: 'plo6' }))).toBeNull();
      expect(omahaBluffCatcherCell(cell({ variant: 'plo5', hole: SIX }))).toBeNull();
      expect(omahaBluffCatcherCell(cell())).toBe('bc_trips_set_drawy');
    });
  });

  it('the measured big-bet cell keeps its own games (PLO4/PLO5) and their hand sizes', () => {
    const v81 = cell({ heroHasStreetChips: false, riverSetCell: true });
    expect(v81Cell(v81)).toBe('trips_set_drawy');
    expect(v81Cell({ ...v81, hole: cards('JcJs7c7h') })).toBeNull();
    expect(v81Cell({ ...v81, variant: 'plo4', hole: cards('JcJs7c7h') })).toBe('trips_set_drawy');
    expect(v81Cell({ ...v81, variant: 'plo4' })).toBeNull();
    plo6On(() => expect(v81Cell({ ...v81, variant: 'plo6', hole: SIX })).toBeNull());
  });

  const bar = (variant: string, hole: string) =>
    omahaDrawRaiseBar({
      variant,
      street: 'flop',
      hole: cards(hole),
      board: cards('Th8h2c'),
      inPosition: false,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
    });

  it('the draw-raise bar and the big draw: six cards are read with the PLO6 gate on', () => {
    expect(bar('plo4', 'AhJh9s7c')).toBe('out_of_position');
    expect(bar('plo5', 'AhJh9s7c4d')).toBe('out_of_position');
    expect(bar('plo6', 'AhJh9s7c4d3s')).toBeNull();
    plo6On(() => {
      expect(bar('plo6', 'AhJh9s7c4d3s')).toBe('out_of_position');
      expect(bar('plo6', 'AhJh9s7c4d')).toBeNull();
    });
    expect(omahaBigDraw(cards('AhJh9s7c'), cards('Th8h2c'))?.cls).toBe('nfd_wrap');
    expect(omahaBigDraw(cards('AhJh9s7c4d3s'), cards('Th8h2c'))?.cls).toBe('nfd_wrap');
    expect(omahaBigDraw(cards('AhJh9s'), cards('Th8h2c'))).toBeNull();
    expect(omahaBigDraw(cards('AhJh9s7c4d3s2d'), cards('Th8h2c'))).toBeNull();
    const spot: OmahaBigDrawInput = {
      variant: 'plo6',
      street: 'flop',
      hole: cards('AhJh9s7c4d3s'),
      board: cards('Th8h2c'),
      action: 'check',
      pot: 20,
      toCall: 0,
      stack: 200,
      heroBet: 0,
      currentBet: 0,
      minRaiseTo: 2,
      maxRaiseTo: 20,
      legalActions: ['fold', 'check', 'bet', 'all_in'],
      opponents: [{ stack: 200, bet: 0, allIn: false, foldToBet: null }],
      inPosition: true,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
      wagersCapped: false,
    };
    expect(omahaBigDrawVerdict(spot)).toBeNull();
    plo6On(() => expect(omahaBigDrawVerdict(spot)?.draw.cls).toBe('nfd_wrap'));
  });

  it('the street plan and the card impact: a PLO6 turn is in the domain with the gate on, and priced', () => {
    const five = turnNode();
    expect(omahaStreetPlanTurnSpot(five.hero, five.gs)).toBe(true);
    expect(omahaCardImpactScope(five.hero, five.gs)).not.toBeNull();
    const six = turnNodePlo6();
    expect(six.hero.cards.length).toBe(6);
    expect(omahaStreetPlanTurnSpot(six.hero, six.gs)).toBe(false);
    expect(omahaCardImpactScope(six.hero, six.gs)).toBeNull();
    plo6On(() => {
      expect(omahaStreetPlanTurnSpot(six.hero, six.gs)).toBe(true);
      // five cards in a six-card game: outside, as a wrong-sized hand always was
      expect(omahaStreetPlanTurnSpot({ ...six.hero, cards: five.hero.cards }, six.gs)).toBe(false);
      const opp = omahaStreetPlanDomain(six.hero, six.gs)!;
      const plan = omahaStreetPlan({
        hole: six.hero.cards,
        board: six.gs.communityCards,
        pot: six.gs.pot,
        heroStack: six.hero.stack,
        oppStack: opp.stack,
        heroInvested: six.hero.totalInvested ?? 0,
        heroInPosition: omahaPlanHeroInPosition(opp, six.gs, 'turn'),
        bets: [373],
        oppLine: omahaPlanOppLine(six.hero, opp, six.gs, 'flop'),
      });
      expect(plan).not.toBeNull();
      expect(plan!.lines.length).toBe(2);
      expect(omahaCardImpactScope(six.hero, six.gs)).not.toBeNull();
      const check = { action: 'check' } as HorseDecision;
      const priced = omahaCardImpactDecision(check, six.hero, six.gs, null);
      expect(priced).not.toBeNull();
      expect(priced!.impact.street).toBe('turn');
      expect(priced!.impact.options.length).toBeGreaterThan(0);
      expect(priced!.impact.options.every((o) => Number.isFinite(o.ev))).toBe(true);
    });
  });
});

describe('H9: the turn redraw share can count only the full houses no bigger one beats', () => {
  const TURN = cards('KsJd2dTc');

  it('any full house (today): a set has ten outs; nut only: middle set has one, top set all ten', () => {
    // middle set: K, 2 and T rivers make jacks full, which kings full beats; the case jack makes quads
    expect(omahaTurnRedrawShare(cards('JcJs7c7h3s'), TURN)).toBeCloseTo(10 / 43, 9);
    expect(omahaTurnRedrawShare(cards('JcJs7c7h3s'), TURN, [], false)).toBeCloseTo(10 / 43, 9);
    expect(omahaTurnRedrawShare(cards('JcJs7c7h3s'), TURN, [], true)).toBeCloseTo(1 / 43, 9);
    // top set: every pairing river makes kings full or quads, which no full house beats
    expect(omahaTurnRedrawShare(cards('KcKd7c7h3s'), TURN)).toBeCloseTo(10 / 43, 9);
    expect(omahaTurnRedrawShare(cards('KcKd7c7h3s'), TURN, [], true)).toBeCloseTo(10 / 43, 9);
    // bottom two pair: four outs today, none of them the nut full house
    expect(omahaTurnRedrawShare(cards('Td2c7c7h3s'), TURN)).toBeCloseTo(4 / 43, 9);
    expect(omahaTurnRedrawShare(cards('Td2c7c7h3s'), TURN, [], true)).toBe(0);
    // the nut flush and nut straight outs are counted the same either way
    const draw = cards('AdQd7c7h3s');
    expect(omahaTurnRedrawShare(draw, TURN, [], true)).toBe(omahaTurnRedrawShare(draw, TURN));
    expect(omahaTurnRedrawShare(draw, TURN)).toBeGreaterThan(0);
  });

  it('nut only never counts more than today, on fixed PLO4, PLO5 and PLO6 deals', () => {
    for (const h of [4, 5, 6])
      for (const { hole, board } of deals(h, 4, 60, 100 + h))
        expect(omahaTurnRedrawShare(hole, board, [], true)).toBeLessThanOrEqual(
          omahaTurnRedrawShare(hole, board)
        );
  });

  it('PLO4/PLO5 read the measure exactly as before, with or without a PLO6 calibration (pinned)', () => {
    const PIN: Record<number, string> = {
      4: 'd115c83d77da6c0c5c85649cdc3547ac46e7d16b9bbea2471b2a4e8480634c4b',
      5: '7b30f035692dc81d047ed4d176acee861c4a626dbdedcac24f5e6c1250dff361',
    };
    for (const calibration of [{}, { turnRedrawNutFullHouseOnly: 1 }]) {
      registerOmahaPlo6StrategyCalibration(calibration);
      for (const h of [4, 5]) {
        expect(
          omahaStrategyConstant('turnRedrawNutFullHouseOnly', { gameVariant: `plo${h}` })
        ).toBe(0);
        const digest = createHash('sha256');
        for (const { hole, board } of deals(h, 4, 400, 9000 + h))
          digest.update(
            `${omahaTurnRedrawShareOf({ gameVariant: `plo${h}` }, hole, board).toFixed(12)}\n`
          );
        expect(digest.digest('hex')).toBe(PIN[h]);
      }
    }
  });

  it("PLO6 reads today's measure until its calibration sets the switch, then nut only", () => {
    const six = cards('JcJs7c7h3s4h');
    const gs = { gameVariant: 'plo6' };
    expect(omahaTurnRedrawShareOf(gs, six, TURN)).toBeCloseTo(10 / 42, 9);
    registerOmahaPlo6StrategyCalibration({ turnRedrawNutFullHouseOnly: 1 });
    expect(omahaTurnRedrawShareOf(gs, six, TURN)).toBeCloseTo(1 / 42, 9);
    // a known dead card is not an out
    expect(omahaTurnRedrawShareOf(gs, six, TURN, cards('Jh'))).toBe(0);
    expect(omahaTurnRedrawShareOf({ gameVariant: 'plo5' }, cards('JcJs7c7h3s'), TURN)).toBeCloseTo(
      10 / 43,
      9
    );
  });
});

describe('H19: the draw outs of a sampled hand in the card impact', () => {
  const FLOP = cards('Th7h2c');
  const liveFor = (...seen: Card[][]): Card[] => {
    const gone = new Set(seen.flat().map((c) => `${c.rank}${c.suit}`));
    return DECK.filter((c) => !gone.has(`${c.rank}${c.suit}`));
  };

  it('fixed form (PLO4/PLO5): flush 9 or 5.4, three per straight rank, added, whatever is held', () => {
    // the nut heart draw, and a six or a jack makes a straight
    expect(omahaCardImpactDrawOuts(cards('AhKh9s8c'), FLOP, null)).toBe(15);
    // four hearts in the hand: still nine flush outs
    expect(omahaCardImpactDrawOuts(cards('AhKh5h4h9s8c'), FLOP, null)).toBe(15);
    // a heart draw that is not the nut draw
    expect(omahaCardImpactDrawOuts(cards('9h8hKsQc'), FLOP, null)).toBeCloseTo(11.4, 9);
    expect(omahaCardImpactDrawOuts(cards('AhKh9s8c'), cards('Th7h2c3d4s'), null)).toBe(0);
  });

  it('distinct form: every live completing card once; held and dead cards are not outs', () => {
    const four = cards('AhKh9s8c');
    // nine hearts are left, and three sixes and three jacks that are not hearts
    expect(omahaCardImpactDrawOuts(four, FLOP, liveFor(four, FLOP))).toBe(15);
    // the Horse holds two hearts and a six: three outs fewer
    expect(omahaCardImpactDrawOuts(four, FLOP, liveFor(four, FLOP, cards('Qh3h6s')))).toBe(12);
    // six cards with four hearts: seven hearts are left, not nine
    const six = cards('AhKh5h4h9s8c');
    expect(omahaCardImpactDrawOuts(six, FLOP, liveFor(six, FLOP))).toBe(13);
    // not the nut draw: the six and the jack of hearts count once (1), the other seven hearts 0.6
    const weak = cards('9h8hKsQc');
    expect(omahaCardImpactDrawOuts(weak, FLOP, liveFor(weak, FLOP))).toBeCloseTo(
      2 + 7 * 0.6 + 6,
      9
    );
    expect(omahaCardImpactDrawOuts(four, cards('Th7h2c3d4s'), liveFor(four))).toBe(0);
  });

  const impactDigest = (): string => {
    const digest = createHash('sha256');
    for (const [fx, ord] of [
      [ACES, 16],
      [ACES, 18],
      [STRAIGHT, 16],
      [STRAIGHT, 18],
    ] as const) {
      const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
      const st = stateAt(f, f.actions.find((a) => a.ord === ord)!);
      const r = omahaCardImpactDecision({ action: 'check' } as HorseDecision, st.hero, st.gs, null);
      digest.update(JSON.stringify(r?.impact ?? null));
    }
    return digest.digest('hex');
  };

  it('PLO5: the whole card impact of the four recorded nodes is as before, with or without a PLO6 calibration (pinned)', () => {
    const PIN = 'cd3685c0a30c325d1d270f9f31b46574d6ca90d2223c2a4459a57c123e59d0f9';
    expect(impactDigest()).toBe(PIN);
    omahaCardImpactResetCache();
    registerOmahaPlo6StrategyCalibration({ cardImpactDistinctDrawOuts: 1 });
    expect(omahaStrategyConstant('cardImpactDistinctDrawOuts', { gameVariant: 'plo5' })).toBe(0);
    expect(omahaStrategyConstant('cardImpactDistinctDrawOuts', { gameVariant: 'plo4' })).toBe(0);
    expect(impactDigest()).toBe(PIN);
  });

  it('PLO6: the fixed form until its calibration sets the switch; then the distinct form prices the turn', () => {
    const six = turnNodePlo6();
    const check = { action: 'check' } as HorseDecision;
    const price = () =>
      plo6On(() => JSON.stringify(omahaCardImpactDecision(check, six.hero, six.gs, null)?.impact));
    const fixed = price();
    expect(fixed).not.toBe('undefined');
    omahaCardImpactResetCache();
    expect(price()).toBe(fixed);
    omahaCardImpactResetCache();
    registerOmahaPlo6StrategyCalibration({ cardImpactDistinctDrawOuts: 1 });
    const distinct = price();
    expect(distinct).not.toBe('undefined');
    expect(distinct).not.toBe(fixed);
    // the Horse's own counts do not depend on the sampled range's draw outs
    expect(JSON.parse(distinct).own).toEqual(JSON.parse(fixed).own);
  });
});

describe('H15: straight draws in the range that continues against a big-draw bet', () => {
  const FLOP = cards('9h8d3s');

  it('the straight outs of a hand: the thirteen-out wrap, by rank with the held copies removed', () => {
    // a seven (four), and a ten, jack or queen (three each: one of each is held)
    expect(omahaBigDrawStraightOutCards(cards('QsJdTc2h'), FLOP)).toBe(13);
    expect(omahaBigDrawStraightOutCards(cards('JsTd4c2h'), FLOP)).toBe(8);
    expect(omahaBigDrawStraightOutCards(cards('KsKd4c2h'), FLOP)).toBe(0);
    // a made straight has no straight outs
    expect(omahaBigDrawStraightOutCards(cards('JsTd4c2h'), cards('9h8d7s'))).toBe(0);
  });

  it('off (0, PLO4/PLO5): a wrap does not continue; at 13 it continues against a bet only', () => {
    const wrap = cards('QsJdTc2h');
    expect(omahaBigDrawContinues(wrap, FLOP)).toBe(0);
    expect(omahaBigDrawContinues(wrap, FLOP, 0)).toBe(0);
    expect(omahaBigDrawContinues(wrap, FLOP, 13)).toBe(1);
    expect(omahaBigDrawContinues(wrap, FLOP, 14)).toBe(0);
    expect(omahaBigDrawContinues(cards('JsTd4c2h'), FLOP, 13)).toBe(0);
    // the rest of the range is unchanged by the argument
    for (const hand of ['9s9d4c2h', '9s8s4c2h', 'KsKd4c2h', 'AsQd4c2h'])
      expect(omahaBigDrawContinues(cards(hand), FLOP, 13)).toBe(
        omahaBigDrawContinues(cards(hand), FLOP)
      );
  });

  it('PLO4/PLO5: the range and the equities are as before, with or without a PLO6 calibration (pinned)', () => {
    const CONTINUES: Record<number, string> = {
      4: '248fa14581488c943ed4cffff24edf269a33a14aa50ec135d34cf79e62741eec',
      5: 'd2f11b5d551b8a227d604c94d6f65c6a7610bf3794dd0a83cd00c944e5bd2549',
    };
    const EQUITIES: Record<number, string> = {
      4: '367ccdf0a16fbd3b6dde515555888028815ad1c524ea33489f4c00765ce45b8f',
      5: '04897a23a1301d49756d176401422d4e9620fffa5b2df9ed22c0176aad264e5b',
    };
    for (const calibration of [{}, { bigDrawContinueStraightOuts: 13 }]) {
      registerOmahaPlo6StrategyCalibration(calibration);
      for (const h of [4, 5]) {
        expect(
          omahaStrategyConstant('bigDrawContinueStraightOuts', { gameVariant: `plo${h}` })
        ).toBe(0);
        const range = createHash('sha256');
        for (const boardCount of [3, 4])
          for (const { hole, board } of deals(h, boardCount, 400, 7000 + h + boardCount))
            range.update(`${omahaBigDrawContinues(hole, board)}`);
        expect(range.digest('hex')).toBe(CONTINUES[h]);
        const equities = createHash('sha256');
        for (const { hole, board } of deals(h, 3, 12, 5000 + h))
          equities.update(JSON.stringify(omahaBigDrawEquities(hole, board)));
        expect(equities.digest('hex')).toBe(EQUITIES[h]);
      }
    }
  });

  it('PLO6: the range as it was until its calibration sets 13 outs; then wraps join the range that continues', () => {
    const hole = cards('AhJh9s7c4d3s');
    const board = cards('Th8h2c');
    const before = omahaBigDrawEquities(hole, board)!;
    registerOmahaPlo6StrategyCalibration({ bigDrawContinueStraightOuts: 13 });
    const after = omahaBigDrawEquities(hole, board)!;
    // the same sampled hands and run-outs: only the range they are put in moves
    expect(after.all).toBe(before.all);
    expect(after.bet).not.toBe(before.bet);
    // five cards are untouched by the PLO6 value
    const five = cards('AhJh9s7c4d');
    registerOmahaPlo6StrategyCalibration({});
    const fiveBefore = omahaBigDrawEquities(five, board);
    registerOmahaPlo6StrategyCalibration({ bigDrawContinueStraightOuts: 13 });
    expect(omahaBigDrawEquities(five, board)).toEqual(fiveBefore);
  });
});
