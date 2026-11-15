/**
 * AN OMAHA MADE HAND THAT A POSSIBLE STRAIGHT OR FLUSH BEATS PLAYS DEFENSE;
 * A BLUFF CATCHER FOLDS TO A VALUE RAISE; THE NUTS BET THE POT.
 *
 * Hands 59414191 and 59416584 (PLO5 1/2 cash, 2026-11-14), beside hand
 * 59401453. In the first a set raised a pot-sized turn lead on the card that
 * made two straights possible and then bet the river into the player who had
 * led. In the second a set led out of position into the card that made a
 * straight possible and top two pair moved all in over that bet.
 *
 * The nodes are the hands' own public records (the complaint fixtures; the
 * cards are read from them, never retyped); the variations change one thing
 * at a time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import {
  omahaBeatenByBoard,
  omahaBeatenMustCheck,
  omahaBeatenNoBet,
  omahaBeatenNoRaise,
  omahaBoardThreat,
  omahaFreshThreat,
  omahaMadeHandDefenseStreet,
  omahaNutClassNow,
  omahaNutClassValueSize,
  omahaTurnRedrawShare,
} from './HorseOmahaMadeHandDefense.js';
import {
  bettorWageredPreviousStreet,
  omahaBluffCatcherCell,
  type BluffCatcherInput,
} from './HorseOmahaBigBetCalls.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import SET_RAISES_TURN from './horseComplaints/plo5-set-raises-a-pot-turn-lead-on-the-straight-card.fixture.json';
import TOP_TWO_JAMS from './horseComplaints/plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';
import TOP_SET_RIVER from './horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.fixture.json';

/** Hand 59414191: the set in seat 4 (turn decision 19, river decision 22). */
const FA = SET_RAISES_TURN as unknown as ComplaintFixture;
/** Hand 59416584: top two pair in seat 5 (turn decision 19). */
const FB5 = TOP_TWO_JAMS as unknown as ComplaintFixture;
/** Hand 59416584: the set in seat 4 (turn decisions 18 and 20). */
const FB4 = SET_LEADS as unknown as ComplaintFixture;
/** Hand 59401453: top set in seat 4 (turn decision 20). */
const F1 = TOP_SET_RIVER as unknown as ComplaintFixture;

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const LIVE = replayProfiles('cash').find((p) => p.live)!;

interface Variation {
  seat?: number;
  hole?: string;
  variant?: 'plo4' | 'plo5' | 'plo6' | 'plo8';
  node?: (pn: ComplaintPublicNode) => void;
  actions?: (fx: ComplaintFixture) => void;
}

function spot(base: ComplaintFixture, ord: number, v: Variation = {}) {
  const fx = JSON.parse(JSON.stringify(base)) as ComplaintFixture;
  v.actions?.(fx);
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (v.hole) fx.hole[String(v.seat ?? node.seat)] = cards(v.hole);
  if (v.variant) {
    fx.variant = v.variant;
    node.publicNode!.variant = v.variant;
  }
  v.node?.(node.publicNode!);
  return stateAt(fx, node);
}

type Built = ReturnType<typeof spot>;
interface Run {
  action: string;
  amount: number | null;
  fires: string[];
}

function decideMany(s: Built, opts: Record<string, unknown> = {}, seeds = SEEDS): Run[] {
  enableBrainTelemetry();
  return seeds.map((seed) => {
    seedFastRandom(seed);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      // Both options ship OFF (opt-in) until their paired evaluation passes;
      // this file measures them switched on unless a test says otherwise.
      omahaBeatenMadeHandDefense: true,
      omahaNutClassValueSize: true,
      ...opts,
    } as never);
    return {
      action: d.action,
      amount: typeof d.amount === 'number' ? d.amount : null,
      fires: drainFires().map((f) => f.feature),
    };
  });
}

const raises = (s: Built, runs: Run[]) =>
  runs.filter(
    (r) => r.action === 'raise' || (r.action === 'all_in' && s.hero.stack > (s.gs.toCall ?? 0))
  ).length;
const count = (runs: Run[], action: string) => runs.filter((r) => r.action === action).length;
const fired = (runs: Run[], feature: string) =>
  runs.filter((r) => r.fires.includes(feature)).length;
const same = (a: Run[], b: Run[]) =>
  expect(a.map((r) => [r.action, r.amount])).toEqual(b.map((r) => [r.action, r.amount]));

const DEFENSE_OFF = { omahaBeatenMadeHandDefense: false };
const BLUFF_CATCHER_ON = { omahaBluffCatcherRaiseFold: true };
const ALL_OFF = {
  omahaBeatenMadeHandDefense: false,
  omahaBluffCatcherRaiseFold: false,
  omahaNutClassValueSize: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('the public measures', () => {
  it('a straight or flush is possible with three ranks in a five-rank window or three of a suit', () => {
    expect(omahaBoardThreat(cards('KsJd2d'))).toEqual({ straight: false, flush: false });
    expect(omahaBoardThreat(cards('KsJd2dTc'))).toEqual({ straight: true, flush: false });
    expect(omahaBoardThreat(cards('Ac3hTd'))).toEqual({ straight: false, flush: false });
    expect(omahaBoardThreat(cards('Ac3hTdKh'))).toEqual({ straight: true, flush: false });
    expect(omahaBoardThreat(cards('Ac3hTdKh4h'))).toEqual({ straight: true, flush: true });
    expect(omahaBoardThreat(cards('As2d7c5h'))).toEqual({ straight: true, flush: false });
  });

  it('the fresh threat is what the last card made possible', () => {
    expect(omahaFreshThreat(cards('KsJd2dTc'))).toEqual({ straight: true, flush: false });
    expect(omahaFreshThreat(cards('KsJd2dTc4c'))).toEqual({ straight: false, flush: false });
    expect(omahaFreshThreat(cards('Ac3hTdKh4h'))).toEqual({ straight: false, flush: true });
    expect(omahaFreshThreat(cards('KsJd2d'))).toEqual({ straight: false, flush: false });
  });

  it('two pair, sets, lower straights and lower flushes are beaten; the nut hands are not', () => {
    const turn = cards('KsJd2dTc');
    expect(omahaBeatenByBoard(cards('JcJs7c7hAs'), turn)).toBe(true); // a set
    expect(omahaBeatenByBoard(cards('KdJh7c7h3s'), turn)).toBe(true); // top two pair
    expect(omahaBeatenByBoard(cards('Qc9c7c7h3s'), turn)).toBe(true); // the lower straight
    expect(omahaBeatenByBoard(cards('AcQc7c7h3s'), turn)).toBe(false); // the nut straight
    expect(omahaBeatenByBoard(cards('AcAh7c7h3s'), turn)).toBe(false); // one pair: not a made hand here
    // No straight or flush possible: nothing is beaten.
    expect(omahaBeatenByBoard(cards('JcJs7c7hAs'), cards('KsJd2d'))).toBe(false);
    // A flush board: the nut straight and the second-nut flush are beaten, the nut flush is not.
    const flush = cards('Kh9h2h8c');
    expect(omahaBeatenByBoard(cards('QhJh7c7d3s'), flush)).toBe(true);
    expect(omahaBeatenByBoard(cards('AhJh7c7d3s'), flush)).toBe(false);
    // A full house is never beaten by a straight or a flush.
    expect(omahaBeatenByBoard(cards('KdKc7c7d3s'), cards('KsJd2dJc'))).toBe(false);
  });

  it('the turn redraw share counts the river cards that make a full house or the nut hand', () => {
    // A bare set: the ten cards that pair the board, of 43 unseen.
    expect(omahaTurnRedrawShare(cards('JcJs7c7h3s'), cards('KsJd2dTc'))).toBeCloseTo(10 / 43, 6);
    // With an ace beside the jack, three queens also make the nut straight
    // (the queen of diamonds makes a flush possible and does not count).
    expect(omahaTurnRedrawShare(cards('JcJs7c7hAs'), cards('KsJd2dTc'))).toBeCloseTo(13 / 43, 6);
    // The set with the nut flush draw adds the hearts that do not pair the board.
    const withDraw = omahaTurnRedrawShare(FB4.hole['4'], cards('Ac3hTdKh'));
    expect(withDraw).toBeGreaterThan(0.4);
  });

  it('the scope refuses hi-lo, a second board, fixed limit, all-in-or-fold and hold’em', () => {
    const s = spot(FA, 19);
    expect(omahaMadeHandDefenseStreet(s.hero, s.gs)).toBe('turn');
    const out = (gs: Record<string, unknown>, hero = s.hero) =>
      expect(omahaMadeHandDefenseStreet(hero, { ...s.gs, ...gs } as never)).toBeNull();
    out({ gameVariant: 'plo8', variantRules: undefined }, { ...s.hero, cards: cards('JcJs7c7h') });
    out({ boardCount: 2 });
    out({ communityCards2: cards('2c3c4c5c') });
    out({ bettingStructure: 'fixed_limit' });
    out({ allInOrFold: true });
    out({ gameVariant: 'nlh' }, { ...s.hero, cards: cards('JcJs') });
    out({ stage: 'preflop' });
  });
});

describe('hand 59414191, turn: a set facing a pot-sized lead on the straight card', () => {
  it('the node is the recorded one', () => {
    const s = spot(FA, 19);
    expect(s.gs.stage).toBe('turn');
    expect(s.gs.toCall).toBe(56);
    expect(s.gs.pot).toBe(112);
    expect(omahaBeatenByBoard(s.hero.cards, s.gs.communityCards)).toBe(true);
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(false);
  });

  it('never raises: the priced call is made on every seed', () => {
    const s = spot(FA, 19);
    const runs = decideMany(s);
    expect(raises(s, runs)).toBe(0);
    expect(count(runs, 'call')).toBe(SEEDS.length);
  });

  it('never raises with the opponent memory on either (the raise the table saw came from there)', () => {
    const s = spot(FA, 19);
    expect(raises(s, decideMany(s, { mind: undefined }))).toBe(0);
    expect(raises(s, decideMany(s, { mind: undefined, ...DEFENSE_OFF }))).toBeGreaterThan(0);
  });

  it('the rule turns a raise or an all-in into the call and restores a reference fold', () => {
    const s = spot(FA, 19);
    const raise: HorseDecision = { action: 'raise', amount: 182, thinkTime: 0 };
    expect(omahaBeatenNoRaise(raise, s.hero, s.gs, true)).toMatchObject({
      decision: { action: 'call', amount: 56 },
      changed: 'flatted',
    });
    expect(
      omahaBeatenNoRaise({ action: 'all_in', thinkTime: 0 }, s.hero, s.gs, true)
    ).toMatchObject({ decision: { action: 'call', amount: 56 }, changed: 'flatted' });
    expect(omahaBeatenNoRaise(raise, s.hero, s.gs, false).changed).toBeNull();
    expect(
      omahaBeatenNoRaise(raise, s.hero, s.gs, true, { action: 'fold', thinkTime: 0 })
    ).toMatchObject({ decision: { action: 'fold' }, changed: 'fold_restored' });
    // A call, a fold and a check are never touched.
    for (const action of ['call', 'fold', 'check'] as const)
      expect(omahaBeatenNoRaise({ action, thinkTime: 0 }, s.hero, s.gs, true).changed).toBeNull();
  });

  it('the nut straight with a redraw still raises, and raises the pot', () => {
    // Ace-queen for the nut straight, with the nut diamond draw.
    const s = spot(FA, 19, { hole: 'AdQd9d9s3s' });
    expect(omahaBeatenByBoard(s.hero.cards, s.gs.communityCards)).toBe(false);
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(true);
    const runs = decideMany(s);
    expect(raises(s, runs)).toBe(SEEDS.length);
    for (const r of runs) expect(r.amount).toBe(224);
  });

  it('where no straight or flush is possible nothing changes', () => {
    const dry = (pn: ComplaintPublicNode) => {
      pn.boards = ['KsJd2d6h'];
    };
    const s = spot(FA, 19, { node: dry });
    expect(omahaBeatenByBoard(s.hero.cards, s.gs.communityCards)).toBe(false);
    same(decideMany(s, { mind: undefined }), decideMany(s, { mind: undefined, ...DEFENSE_OFF }));
  });
});

describe('hand 59414191, river: the set checked to by the player who led the turn', () => {
  it('checks on every seed; with the rule off it bets', () => {
    const s = spot(FA, 22);
    expect(s.gs.stage).toBe('river');
    expect(s.gs.toCall).toBe(0);
    expect(omahaBeatenMustCheck(s.hero, s.gs)).toBe('river_check');
    const runs = decideMany(s);
    expect(count(runs, 'check')).toBe(SEEDS.length);
    expect(fired(runs, 'omaha_beaten_river_no_value_bet')).toBeGreaterThan(0);
    expect(count(decideMany(s, DEFENSE_OFF), 'bet')).toBeGreaterThan(0);
  });

  it('the nut straight still bets the river, for the pot', () => {
    const s = spot(FA, 22, { hole: 'AhQh7c7h3s' });
    expect(omahaBeatenMustCheck(s.hero, s.gs)).toBeNull();
    const runs = decideMany(s);
    expect(count(runs, 'bet')).toBe(SEEDS.length);
    for (const r of runs) expect(r.amount).toBe(420);
  });

  it('a set may bet the river when nobody bet a street on which the straight was possible', () => {
    const s = spot(FA, 22, {
      actions: (fx) => {
        // The turn went check, check instead of lead, raise, call.
        fx.actions = fx.actions.filter((a) => ![16, 19, 20].includes(a.ord));
      },
    });
    expect(omahaBeatenMustCheck(s.hero, s.gs)).toBeNull();
  });
});

describe('hand 59416584, turn: the straight card', () => {
  it('top two pair facing the bet never raises; it calls', () => {
    const s = spot(FB5, 19);
    expect(s.gs.toCall).toBe(212);
    expect(s.hero.stack).toBe(335.5);
    const runs = decideMany(s);
    expect(raises(s, runs)).toBe(0);
    expect(count(runs, 'call')).toBe(SEEDS.length);
    expect(fired(runs, 'omaha_turn_beaten_raise_flatted')).toBe(SEEDS.length);
    expect(raises(s, decideMany(s, DEFENSE_OFF))).toBe(SEEDS.length);
  });

  it('the set out of position checks the straight card; with the rule off it bets', () => {
    const s = spot(FB4, 18);
    expect(omahaBeatenMustCheck(s.hero, s.gs)).toBe('fresh_card_check');
    const runs = decideMany(s);
    expect(count(runs, 'check')).toBe(SEEDS.length);
    expect(fired(runs, 'omaha_beaten_fresh_card_check')).toBe(SEEDS.length);
    expect(count(decideMany(s, DEFENSE_OFF), 'bet')).toBe(SEEDS.length);
  });

  it('the same set checked to in position may bet, and bets large', () => {
    const s = spot(FB4, 18, {
      actions: (fx) => {
        fx.actions.push({
          ord: 17.5,
          seat: 5,
          stage: 'turn',
          action: 'check',
          amount: 0,
          origin: 'horse_policy',
        } as ComplaintAction);
        fx.actions.sort((a, b) => a.ord - b.ord);
      },
    });
    expect(omahaBeatenMustCheck(s.hero, s.gs)).toBeNull();
    const runs = decideMany(s);
    expect(count(runs, 'bet')).toBe(SEEDS.length);
    for (const r of runs) expect(r.amount!).toBeGreaterThanOrEqual(0.5 * s.gs.pot);
  });

  it('an all-in that is itself the call stays a call (the set with the flush draw, priced in)', () => {
    const s = spot(FB4, 20);
    expect(s.gs.toCall).toBe(123.5);
    const runs = decideMany(s);
    expect(count(runs, 'call')).toBe(SEEDS.length);
    expect(fired(runs, 'omaha_bluff_catcher_raise_fold')).toBe(0);
  });
});

describe('hand 59401453, turn: the set in position, checked to on the straight card', () => {
  it('still bets large (the turn pound), on every seed', () => {
    const s = spot(F1, 20);
    expect(omahaFreshThreat(s.gs.communityCards)).toEqual({ straight: true, flush: false });
    expect(omahaBeatenMustCheck(s.hero, s.gs)).toBeNull();
    const runs = decideMany(s);
    expect(count(runs, 'bet')).toBe(SEEDS.length);
    for (const r of runs) expect(r.amount!).toBeGreaterThanOrEqual(75);
  });
});

describe('the turn rule across PLO4, PLO5 and PLO6, and outside its scope', () => {
  const HOLES: Record<'plo4' | 'plo5' | 'plo6', string> = {
    plo4: 'KsJcAd7c',
    plo5: 'KsJc6d7cAd',
    plo6: 'KsJc6d7cAd2s',
  };
  for (const variant of ['plo4', 'plo5', 'plo6'] as const)
    it(`${variant} top two pair: no raise over the turn bet`, () => {
      const s = spot(FB5, 19, { variant, hole: HOLES[variant] });
      expect(omahaMadeHandDefenseStreet(s.hero, s.gs)).toBe('turn');
      expect(raises(s, decideMany(s, {}, SEEDS.slice(0, 20)))).toBe(0);
      expect(
        omahaBeatenNoRaise({ action: 'all_in', thinkTime: 0 }, s.hero, s.gs, true).changed
      ).toBe('flatted');
    });

  it('hi-lo decisions are the same with the rules on and off', () => {
    const s = spot(FB5, 19, { variant: 'plo8', hole: 'KsJcAd7c' });
    same(decideMany(s, {}, SEEDS.slice(0, 20)), decideMany(s, ALL_OFF, SEEDS.slice(0, 20)));
    const lead = spot(FB4, 18, { variant: 'plo8', hole: 'TcThAhQs' });
    same(decideMany(lead, {}, SEEDS.slice(0, 20)), decideMany(lead, ALL_OFF, SEEDS.slice(0, 20)));
  });

  it('the flop is outside the two defense rules', () => {
    const s = spot(FB4, 16);
    const raise: HorseDecision = { action: 'raise', amount: 195, thinkTime: 0 };
    expect(omahaBeatenNoRaise(raise, s.hero, s.gs, true).changed).toBeNull();
    expect(
      omahaBeatenNoBet({ action: 'bet', amount: 50, thinkTime: 0 }, s.hero, s.gs, true).changed
    ).toBeNull();
  });
});

describe('the worker receipt', () => {
  const decideOne = (s: Built) => {
    seedFastRandom(7);
    HorseMind.reset();
    return structuredClone(
      HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
        mind: false,
        telemetry: false,
        omahaBeatenMadeHandDefense: true,
      })
    );
  };

  it('the turn raise that became a call is admitted with the request only', () => {
    const s = spot(FB5, 19);
    const d = decideOne(s);
    expect({ action: d.action, amount: d.amount }).toEqual({ action: 'call', amount: 212 });
    const node = d.policyGraph!.transitions.find((t) => t.node === 'wager_rules')!;
    expect(node.before?.action).toBe('all_in');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { player: s.hero, gameState: s.gs })
    ).toBeNull();
    expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo5')).toBe('policy_graph');
    // Against a request in which the Horse holds the nut straight it is refused.
    const nuts = spot(FB5, 19, { hole: 'QsJc6d7c2d' });
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: nuts.hero,
        gameState: nuts.gs,
      })
    ).toBe('policy_graph');
  });

  it('the bet that became a check is admitted with the request that produces it', () => {
    const s = spot(FB4, 18);
    const d = decideOne(s);
    expect(d.action).toBe('check');
    const node = d.policyGraph!.transitions.find((t) => t.node === 'wager_rules')!;
    expect(node.before?.action).toBe('bet');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { player: s.hero, gameState: s.gs })
    ).toBeNull();
    // Against a request in which the Horse holds the nut straight it is refused.
    const nuts = spot(FB4, 18, { hole: 'QdJc8dTc2s' });
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: nuts.hero,
        gameState: nuts.gs,
      })
    ).toBe('policy_graph');
  });
});

describe('a bluff catcher folds to a value raise', () => {
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

  it('river, raised: sets, two pair, lower straights and lower flushes fold; the nut straight does not', () => {
    expect(omahaBluffCatcherCell(cell())).toBe('bc_trips_set_drawy');
    expect(omahaBluffCatcherCell(cell({ hole: cards('KdJh7c7h3s') }))).toBe('bc_two_pair');
    expect(omahaBluffCatcherCell(cell({ hole: cards('Qc9c7c7h3s') }))).toBe('bc_straight_nonnut');
    expect(omahaBluffCatcherCell(cell({ hole: cards('AcQc7c7h3s') }))).toBeNull();
    expect(
      omahaBluffCatcherCell(cell({ hole: cards('QhJh7c7d3s'), board: cards('Kh9h2h8c3d') }))
    ).toBe('bc_flush_second');
    expect(
      omahaBluffCatcherCell(cell({ hole: cards('AhJh7c7d3s'), board: cards('Kh9h2h8c3d') }))
    ).toBeNull();
  });

  it('keeps every V81 exclusion', () => {
    for (const over of [
      { heroHasStreetChips: false }, // a river bet, not a raise: V81's own cells judge it
      { bettorOverBluffs: true },
      { chipsBehindCall: false },
      { potFrac: 0.89 },
      { effectiveBB: 20 },
      { callPrice: 0.12 },
      { headsUpTable: true },
      { bountyEvent: true },
      { bombPot: true },
      { hiLo: true },
      { multiBoard: true },
      { variant: 'plo6', hole: cards('JcJs7c7hAs3h') },
    ] as Partial<BluffCatcherInput>[])
      expect(omahaBluffCatcherCell(cell(over))).toBeNull();
    expect(omahaBluffCatcherCell(cell({ variant: 'plo4', hole: cards('JcJs7c7h') }))).toBe(
      'bc_trips_set_drawy'
    );
  });

  it('turn: a raise, or a big bet from the flop bettor, folds unless the redraw pays the price', () => {
    const turn = { street: 'turn', board: cards('KsJd2dTc') };
    expect(omahaBluffCatcherCell(cell({ ...turn, redrawShare: 10 / 43 }))).toBe(
      'bc_trips_set_drawy'
    );
    expect(omahaBluffCatcherCell(cell({ ...turn, redrawShare: 0.44 }))).toBeNull();
    expect(
      omahaBluffCatcherCell(cell({ ...turn, redrawShare: 10 / 43, callPrice: 0.2 }))
    ).toBeNull();
    // Not raised, and the bettor did not bet the flop: the first turn bet is called (hand 59414191).
    expect(omahaBluffCatcherCell(cell({ ...turn, heroHasStreetChips: false }))).toBeNull();
    expect(
      omahaBluffCatcherCell(
        cell({ ...turn, heroHasStreetChips: false, bettorWageredPreviousStreet: true })
      )
    ).toBe('bc_trips_set_drawy');
    const history = [
      { stage: 'flop', seat: 5, action: 'bet', amount: 50 },
      { stage: 'flop', seat: 4, action: 'call', amount: 50 },
    ];
    expect(bettorWageredPreviousStreet(history, 'turn', 5)).toBe(true);
    expect(bettorWageredPreviousStreet(history, 'turn', 4)).toBe(false);
    expect(bettorWageredPreviousStreet(history, 'river', 5)).toBe(false);
  });

  /** Hand 59414191's river, continued: the set bets 177 and is raised to 708. */
  const riverRaised: Variation = {
    actions: (fx) => {
      const lead = fx.actions.find((a) => a.ord === 22)!;
      const pn = JSON.parse(JSON.stringify(lead.publicNode)) as ComplaintPublicNode;
      const raise = fx.actions.find((a) => a.ord === 23)!;
      raise.action = 'raise';
      raise.amount = 708;
      raise.isFullRaise = true;
      pn.pot = 1305;
      pn.toCall = 531;
      pn.currentBet = 708;
      pn.seats[3] = [4, 716, 177, 372, 0, 0, 0];
      pn.seats[5] = [6, 2458.1, 708, 903, 0, 0, 0];
      pn.minRaiseTo = null as never;
      pn.maxRaiseTo = null as never;
      pn.legalActions = ['fold', 'call', 'all_in'];
      fx.actions.push({
        ord: 24,
        seat: 4,
        stage: 'river',
        action: 'call',
        amount: 531,
        origin: 'horse_policy',
        publicNode: pn,
      } as ComplaintAction);
    },
  };

  it('the set that bet the river and is raised the pot folds', () => {
    const s = spot(FA, 24, riverRaised);
    expect(s.gs.toCall).toBe(531);
    // The cell is opt-in (owner 2026-11-14 23:10: no blanket fold without a
    // measurement): switched on it folds, by default the set calls.
    const runs = decideMany(s, BLUFF_CATCHER_ON);
    expect(count(runs, 'fold')).toBe(SEEDS.length);
    expect(count(decideMany(s), 'fold')).toBe(0);
  });

  it('against a measured postflop over-bluffer the bluff-catcher fold is not made', () => {
    const s = spot(FA, 24, riverRaised);
    vi.spyOn(HorseMind, 'opponentRead').mockImplementation(((id: string) =>
      id === 'p6' ? { stats: { betCheckedTo: { engaged: 'high', mean: 0.9 } } } : null) as never);
    const runs = decideMany(s, BLUFF_CATCHER_ON);
    expect(fired(runs, 'omaha_bluff_catcher_raise_fold')).toBe(0);
    expect(count(runs, 'call')).toBe(SEEDS.length);
  });

  /** Hand 59416584's turn with deep stacks: the set bets 212 and is raised to 848. */
  const turnRaised: Variation = {
    actions: (fx) => {
      const jam = fx.actions.find((a) => a.ord === 19)!;
      jam.action = 'raise';
      jam.amount = 848;
      jam.isFullRaise = true;
    },
    node: (pn) => {
      pn.pot = 1573;
      pn.toCall = 636;
      pn.currentBet = 848;
      pn.seats[3] = [4, 2000, 212, 444, 0, 0, 0];
      pn.seats[4] = [5, 2000, 848, 1080, 0, 0, 0];
      pn.minRaiseTo = 1484;
      pn.maxRaiseTo = 2212;
      pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
    },
  };

  it('turn: the set with the nut flush draw calls the raise (the redraw pays the price)', () => {
    const s = spot(FB4, 20, turnRaised);
    const runs = decideMany(s);
    expect(fired(runs, 'omaha_bluff_catcher_raise_fold')).toBe(0);
    expect(count(runs, 'call')).toBe(SEEDS.length);
  });

  it('turn: the bare set folds to the same raise, and calls it with the rule off', () => {
    const s = spot(FB4, 20, { ...turnRaised, hole: 'TcTs8d9c2s' });
    const runs = decideMany(s, BLUFF_CATCHER_ON);
    expect(count(runs, 'fold')).toBe(SEEDS.length);
    expect(fired(runs, 'omaha_bluff_catcher_raise_fold')).toBeGreaterThan(0);
    // Off is the default.
    expect(fired(decideMany(s), 'omaha_bluff_catcher_raise_fold')).toBe(0);
  });
});

describe('a nut-class hand bets and raises the pot', () => {
  const SIZE_OFF = { omahaNutClassValueSize: false };
  const potBets = (s: Built, pot: number) => {
    const runs = decideMany(s);
    const bets = runs.filter((r) => r.action === 'bet');
    expect(bets.length).toBeGreaterThan(0);
    for (const r of bets) expect(r.amount).toBe(pot);
    return runs;
  };

  it('flop: top set on a board with no straight or flush possible bets the pot', () => {
    const s = spot(FA, 15, { hole: 'KcKh7c7hAs' });
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(true);
    const runs = potBets(s, 56);
    expect(fired(runs, 'omaha_nut_class_pot_wager')).toBeGreaterThan(0);
    const off = decideMany(s, SIZE_OFF).filter((r) => r.action === 'bet');
    expect(off.some((r) => r.amount! < 56)).toBe(true);
  });

  it('turn: the nut straight with no flush possible bets the pot', () => {
    const s = spot(F1, 20, { hole: '9h7hKdKs2s' });
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(true);
    potBets(s, 100);
  });

  it('river: the nut straight bets the pot', () => {
    const s = spot(FA, 22, { hole: 'AhQh7c7h3s' });
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(true);
    potBets(s, 420);
  });

  it('a hand that is not nut class keeps its size; a check and a call are never turned into a wager', () => {
    const s = spot(F1, 20);
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(false);
    const bet: HorseDecision = { action: 'bet', amount: 40, thinkTime: 0 };
    expect(omahaNutClassValueSize(bet, s.hero, s.gs, true).changed).toBeNull();
    const nuts = spot(F1, 20, { hole: '9h7hKdKs2s' });
    expect(omahaNutClassValueSize(bet, nuts.hero, nuts.gs, true)).toMatchObject({
      decision: { action: 'bet', amount: 100 },
      changed: 'pot_sized',
    });
    expect(omahaNutClassValueSize(bet, nuts.hero, nuts.gs, false).changed).toBeNull();
    for (const action of ['check', 'call', 'fold'] as const)
      expect(
        omahaNutClassValueSize({ action, thinkTime: 0 }, nuts.hero, nuts.gs, true).changed
      ).toBeNull();
    // PLO6 is outside the sizing rule.
    const six = spot(F1, 20, { variant: 'plo6', hole: '9h7hKdKs2s3d' });
    expect(omahaNutClassValueSize(bet, six.hero, six.gs, true).changed).toBeNull();
  });
});
