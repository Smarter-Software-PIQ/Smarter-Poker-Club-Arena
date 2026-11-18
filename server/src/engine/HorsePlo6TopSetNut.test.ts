/**
 * PLO6-AUDIT P6-4: the top-set current-nuts test (HorsePlo6TopSetNut.ts) and
 * the opt-in option plo6TopSetNutRealization through HorseLogic.decide.
 *
 * The decision spot is synthetic: it copies the shape of a recorded PLO6 cash
 * flop (big blind 0.25, 10% rake, hero out of position facing a
 * pot-sized bet into 5.75, so a one-third price, with the bettor and two
 * players behind still live) but uses its own hole cards. The recorded
 * folds are reproduced in the archive's reconstructed replay (s4-FINDING.md);
 * this fixture pins the mechanism and its scope.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  COMPLAINT_SEEDS,
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { HorseMind } from './HorseMind.js';
import { plo6TopSetIsCurrentNuts } from './HorsePlo6TopSetNut.js';
import { KNOWN_VARIANTS, holeCardCount, isHiLoVariant } from './VariantRules.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((t) => ({ rank: t[0] as CardRank, suit: SUIT[t[1]] }));

describe('plo6TopSetIsCurrentNuts', () => {
  const nuts = (hole: string, board: string) => plo6TopSetIsCurrentNuts(cards(hole), cards(board));

  it('top set on a rainbow disconnected flop is the current nuts', () => {
    expect(nuts('KsKcQh8c5s2h', 'Kd7h2c')).toBe(true);
    expect(nuts('9s9cKhQc5s2h', '3d7d9h')).toBe(true);
  });

  it('a paired board is not', () => {
    expect(nuts('KsKcQh8c5s2h', 'Kd7h7c')).toBe(false);
  });

  it('three of a suit on the board is not, monotone or on the turn', () => {
    expect(nuts('KsKcQh8c5s2h', 'Kd7d2d')).toBe(false);
    expect(nuts('KsKcQh8c5s2h', 'Kd7d2c3d')).toBe(false);
  });

  it('three ranks inside a five-rank window is not, the wheel included', () => {
    expect(nuts('JsJcQh8c5s2h', 'Jd9h7c')).toBe(false);
    expect(nuts('AsAcQh8c5s9h', 'Ad2h4c')).toBe(false);
    expect(nuts('AsAcQh8c5s9h', 'AdKhQc')).toBe(false);
  });

  it('one card of the top rank in the hole is not a set', () => {
    expect(nuts('KsQcQh8c5s2h', 'Kd7h2c')).toBe(false);
  });

  it('a set below the top rank is not', () => {
    expect(nuts('7s7cQh8c5s4h', 'Kd7h2c')).toBe(false);
  });

  it('a four-card turn board is read the same way', () => {
    expect(nuts('KsKcQh9c5s3h', 'Kd8h2c5d')).toBe(true);
    expect(nuts('KsKcQh9c5s3h', 'Kd7h2cJd')).toBe(true);
    expect(nuts('KsKcQh9c5s3h', 'Kd7h2c7d')).toBe(false);
    expect(nuts('KsKcQh9c5s3h', 'Kd7h2cQd')).toBe(true);
    expect(nuts('KsKcQh9c5s3h', 'Kd7hJcQd')).toBe(false);
    expect(nuts('KsKcQh9c5s3h', 'Kd7d2cJd')).toBe(false);
  });

  it('a five-card board and a two-card board are outside the rule', () => {
    expect(nuts('KsKcQh9c5s3h', 'Kd7h2cJd4s')).toBe(false);
    expect(nuts('KsKcQh9c5s3h', 'Kd7h')).toBe(false);
  });
});

const HERO_SEAT = 4;
const NODE_ORD = 12;

/** One-third price flop: seat 1 bets the pot (5.75 into 5.75), seat 2 folds, seats 5 and 6 behind. */
function fixture(
  o: {
    hole?: string;
    board?: string;
    variant?: string;
    tournament?: boolean;
    bombPot?: boolean;
    secondBoard?: string;
  } = {}
): ComplaintFixture {
  const variant = o.variant ?? 'plo6';
  const mode = o.tournament ? 'tournament' : 'cash';
  return {
    version: 1,
    slug: 'plo6-top-set-nut-synthetic',
    title: 'synthetic PLO6 top set facing a one-third price',
    complaint: 'synthetic',
    handId: 'synthetic',
    fmt: o.tournament ? 'tour' : 'cash',
    variant,
    players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, isHorse: true })),
    hole: { [HERO_SEAT]: cards(o.hole ?? '9s9cKhQc5s2h') },
    actions: [
      { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 0.1 },
      { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 0.25 },
      { ord: 3, seat: 2, stage: 'preflop', action: 'ante', amount: 0.25 },
      { ord: 4, seat: 3, stage: 'preflop', action: 'fold', amount: 0 },
      { ord: 5, seat: 4, stage: 'preflop', action: 'raise', amount: 1.1, isFullRaise: true },
      { ord: 6, seat: 5, stage: 'preflop', action: 'call', amount: 1.1 },
      { ord: 7, seat: 6, stage: 'preflop', action: 'call', amount: 1.1 },
      { ord: 8, seat: 1, stage: 'preflop', action: 'call', amount: 1 },
      { ord: 9, seat: 2, stage: 'preflop', action: 'call', amount: 0.85 },
      { ord: 10, seat: 1, stage: 'flop', action: 'bet', amount: 5.75, isFullRaise: true },
      { ord: 11, seat: 2, stage: 'flop', action: 'fold', amount: 0 },
      {
        ord: NODE_ORD,
        seat: HERO_SEAT,
        stage: 'flop',
        action: 'fold',
        amount: 0,
        publicNode: {
          pot: 11.5,
          ante: 0.25,
          anteType: 'big_blind',
          mode,
          asset: 'chips',
          seats: [
            [1, 40.02, 5.75, 6.85, 0, 0, 0],
            [2, 92.93, 0, 1.35, 0.25, 0, 1],
            [3, 54.43, 0, 0, 0, 0, 1],
            [4, 31.11, 0, 1.1, 0, 0, 0],
            [5, 216.74, 0, 1.1, 0, 0, 0],
            [6, 47.54, 0, 1.1, 0, 0, 0],
          ],
          boards: o.secondBoard ? [o.board ?? '3d7d9h', o.secondBoard] : [o.board ?? '3d7d9h'],
          street: 'flop',
          toCall: 5.75,
          currentBet: 5.75,
          minRaiseTo: 11.5,
          maxRaiseTo: 23,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          dealerSeat: 6,
          chipUnit: 0.01,
          bigBlind: 0.25,
          smallBlind: 0.1,
          variant,
          structure: 'pot_limit',
          actorSeat: HERO_SEAT,
          bombPot: o.bombPot === true,
          boardCount: o.secondBoard ? 2 : 1,
          allInOrFold: false,
          fixedBetSize: null,
          wagersCapped: false,
          deductions: {
            bbj: { feeBB: 0, enabled: false, minPotBB: 10, minPlayersDealt: 3 },
            rake: {
              cap: 0.62,
              percent: 10,
              noFlopNoDrop: true,
              playerCountCaps: [
                [2, 0.31],
                [3, 0.62],
                [4, 0.62],
              ],
            },
            rules: 'controller-rake-bbj-v1',
            status: 'captured',
            version: 1,
          } as never,
          tournamentStage: { status: 'not_applicable', version: 1 },
        },
      },
    ],
    forbidden: [],
    seeds: COMPLAINT_SEEDS,
  };
}

const RECEIPT = 'plo6_top_set_nut_realization_seen';
const ON = { plo6TopSetNutRealization: true };

/** The live profile's replay at the node over the fixed complaint seeds. */
function run(fx: ComplaintFixture, opts?: Record<string, unknown>) {
  const node = fx.actions.find((a) => a.ord === NODE_ORD)!;
  const st = stateAt(fx, node);
  const mode = st.pn.mode;
  const live = replayProfiles(mode).find((p) => p.live)!;
  return replayAt(st, live, COMPLAINT_SEEDS, opts);
}

describe('plo6TopSetNutRealization through decide (PLO6-AUDIT P6-4)', () => {
  afterEach(() => HorseMind.reset());

  it('absent and false are the same decision seed by seed, and nothing fires', () => {
    const fx = fixture();
    const absent = run(fx);
    const off = run(fx, { plo6TopSetNutRealization: false });
    expect(off).toEqual(absent);
    expect(absent.receipts[RECEIPT] ?? 0).toBe(0);
  }, 120_000);

  it('off, the realization discount folds the current nuts in some seeds; on, fewer folds and the receipt fires', () => {
    const fx = fixture();
    const off = run(fx);
    const on = run(fx, ON);
    const offFolds = off.actions.fold ?? 0;
    const onFolds = on.actions.fold ?? 0;
    expect(offFolds).toBeGreaterThan(0);
    expect(onFolds).toBeLessThan(offFolds);
    expect(on.receipts[RECEIPT]).toBe(COMPLAINT_SEEDS.length);
  }, 120_000);

  const controls: Array<[string, Parameters<typeof fixture>[0]]> = [
    ['PLO5 (five hole cards)', { variant: 'plo5', hole: '9s9cKhQc5s' }],
    ['a tournament', { tournament: true }],
    ['a paired board', { board: '7d7c9h' }],
    ['three of a suit on the board', { board: '3d7d9d' }],
    // HA-10861-1: the bomb-pot and two-board guards each get a control.
    ['a bomb pot', { bombPot: true }],
    ['two boards', { secondBoard: '2c4sJh' }],
  ];
  for (const [name, o] of controls) {
    it(`control: ${name} is unchanged with the option on`, () => {
      const fx = fixture(o);
      const off = run(fx);
      const on = run(fx, ON);
      expect(on).toEqual(off);
      expect(on.receipts[RECEIPT] ?? 0).toBe(0);
    }, 120_000);
  }

  // HA-10861-1, the hi-lo guard. No registered variant deals six hole cards
  // and splits hi-lo, so that guard cannot be reached through decide today
  // and has no decision-level control. If such a variant is registered this
  // fails, and a control for it belongs in the list above.
  it('no registered variant is six-card hi-lo, so the hi-lo guard is unreachable today', () => {
    expect(KNOWN_VARIANTS.filter((v) => holeCardCount(v) === 6 && isHiLoVariant(v))).toEqual([]);
    expect(KNOWN_VARIANTS).toContain('plo6');
  });
});
