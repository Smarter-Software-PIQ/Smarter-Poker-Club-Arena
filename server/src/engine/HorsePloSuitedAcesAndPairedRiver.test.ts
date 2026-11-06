/**
 * Boundaries of the two rules from Dan's 2026-11-06 complaint on hand
 * 55704472 (PLO5 1/2 Madness): suited aces 4-bet a single 3-bet
 * (HorsePreflop OMAHA_SUITED_ACES_FOUR_BET_MAX_BB) and no river bet without a
 * full house after a called bet on a paired turn
 * (HorsePloPairedBoardFold.ploPairedBoardRiverMustCheck). The real hand is
 * pinned by the two complaint laws in horseComplaints/; these pin the edges.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { ploPairedBoardRiverMustCheck } from './HorsePloPairedBoardFold.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import ACES from './horseComplaints/plo5-suited-aces-flat-vs-3bet.fixture.json';

const FX = ACES as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  s.match(/../g)!.map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

/** The recorded 4-bet node (seat 3 facing the small blind's pot 3-bet). */
function fourBetNode(hole: string, edit: (fx: ComplaintFixture) => void = () => {}) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  fx.hole = { '3': cards(hole) };
  edit(fx);
  const node = fx.actions.find((a) => a.ord === 9)!;
  return stateAt(fx, node);
}
const live = replayProfiles('cash').find((p) => p.live)!;
const kinds = (st: ReturnType<typeof stateAt>, opts: Record<string, unknown> = {}) =>
  replayAt(st, live, [1, 7, 42, 99, 2026], opts).kinds;

describe('PLO suited aces 4-bet a single 3-bet', () => {
  afterEach(() => HorseMind.reset());

  it('the real hand 4-bets every seed, and the rule is what makes it', () => {
    const st = fourBetNode('3h9dAdKdAc');
    expect(kinds(st)).toEqual({ raise: 5 });
    expect(kinds(st, { ploSuitedAcesFourBet: false }).raise ?? 0).toBe(0);
  });

  it('aces with no ace suited to another card are not anchored', () => {
    const st = fourBetNode('AhAc9d7s3d');
    expect(kinds(st).raise ?? 0).toBe(kinds(st, { ploSuitedAcesFourBet: false }).raise ?? 0);
  });

  it('three aces are not a pair of aces', () => {
    const st = fourBetNode('AhAcAdKd9d');
    expect(kinds(st).raise ?? 0).toBe(kinds(st, { ploSuitedAcesFourBet: false }).raise ?? 0);
  });

  it('PLO4 and PLO6 suited aces 4-bet too', () => {
    const p4 = fourBetNode('AdAcKd9h', (fx) => {
      fx.variant = 'plo4';
      for (const a of fx.actions) if (a.publicNode) a.publicNode.variant = 'plo4';
    });
    expect(kinds(p4).raise).toBe(5);
    const p6 = fourBetNode('AdAcKd9d3h7s', (fx) => {
      fx.variant = 'plo6';
      for (const a of fx.actions) if (a.publicNode) a.publicNode.variant = 'plo6';
    });
    expect(kinds(p6).raise).toBe(5);
  });

  it('hi-lo Omaha is out of scope', () => {
    const st = fourBetNode('AdAcKd9h', (fx) => {
      fx.variant = 'plo8';
      for (const a of fx.actions) if (a.publicNode) a.publicNode.variant = 'plo8';
    });
    expect(kinds(st).raise ?? 0).toBe(kinds(st, { ploSuitedAcesFourBet: false }).raise ?? 0);
  });

  it('deeper than 250 big blinds effective the anchor stands aside', () => {
    const st = fourBetNode('3h9dAdKdAc');
    for (const p of st.gs.players) p.stack = p.stack + 600;
    expect(kinds(st).raise ?? 0).toBe(kinds(st, { ploSuitedAcesFourBet: false }).raise ?? 0);
  });
});

describe('PLO paired-board river check after a called turn bet', () => {
  const hero = { user_id: 'h', cards: cards('AdAcKd9d3h') };
  const turnBetCalled = [
    { userId: 'v', action: 'check', stage: 'turn' },
    { userId: 'h', action: 'bet', stage: 'turn' },
    { userId: 'v', action: 'call', stage: 'turn' },
  ];
  const base = {
    gameVariant: 'plo5',
    hiLo: false,
    multiBoard: false,
    board: cards('4d5cJc5d2s'),
    hero,
    toCall: 0,
    actionHistory: turnBetCalled,
  };

  it('a five-high straight that barreled a paired turn into a caller checks the river', () => {
    expect(ploPairedBoardRiverMustCheck(base)).toBe(true);
  });
  it('a full house still bets', () => {
    expect(
      ploPairedBoardRiverMustCheck({ ...base, hero: { ...hero, cards: cards('5h4sAd9c3h') } })
    ).toBe(false);
  });
  it('a board that pairs only on the river is out of scope', () => {
    expect(ploPairedBoardRiverMustCheck({ ...base, board: cards('4d5cJc8d5s') })).toBe(false);
  });
  it('the turn bet was not called, or the horse was raised', () => {
    expect(
      ploPairedBoardRiverMustCheck({ ...base, actionHistory: turnBetCalled.slice(0, 2) })
    ).toBe(false);
    expect(
      ploPairedBoardRiverMustCheck({
        ...base,
        actionHistory: [
          ...turnBetCalled.slice(0, 2),
          { userId: 'v', action: 'raise', stage: 'turn' },
          { userId: 'h', action: 'call', stage: 'turn' },
        ],
      })
    ).toBe(false);
  });
  it('the turn checked through: no barrel, no rule', () => {
    expect(
      ploPairedBoardRiverMustCheck({
        ...base,
        actionHistory: [
          { userId: 'v', action: 'check', stage: 'turn' },
          { userId: 'h', action: 'check', stage: 'turn' },
        ],
      })
    ).toBe(false);
  });
  it('facing a river bet is the paired-board fold, not this rule', () => {
    expect(ploPairedBoardRiverMustCheck({ ...base, toCall: 50 })).toBe(false);
  });
  it('hi-lo, multi-board and hold em are out of scope; PLO4 and PLO6 are in', () => {
    expect(ploPairedBoardRiverMustCheck({ ...base, hiLo: true })).toBe(false);
    expect(ploPairedBoardRiverMustCheck({ ...base, multiBoard: true })).toBe(false);
    expect(
      ploPairedBoardRiverMustCheck({
        ...base,
        gameVariant: 'nlh',
        hero: { ...hero, cards: cards('Ad3h') },
      })
    ).toBe(false);
    expect(
      ploPairedBoardRiverMustCheck({
        ...base,
        gameVariant: 'plo4',
        hero: { ...hero, cards: cards('AdAc3h9d') },
      })
    ).toBe(true);
    expect(
      ploPairedBoardRiverMustCheck({
        ...base,
        gameVariant: 'plo6',
        hero: { ...hero, cards: cards('AdAc3h9dKd7s') },
      })
    ).toBe(true);
  });
});
