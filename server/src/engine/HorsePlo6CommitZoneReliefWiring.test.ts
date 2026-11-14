/**
 * omahaCommitZoneThreeBetPriceRelief through HorseLogic.decide (the wiring).
 *
 * HorsePlo6CommitZoneRelief.test.ts pins the rule inside decidePreflopV7 by
 * building the preflop context directly. This file pins the one line that
 * carries the option from the decision options into that context
 * (HorseLogic.decide), which the context-level cases cannot see: an absent
 * option must decide exactly like an explicit false, and an explicit true
 * must reach the preflop engine and change a decision.
 *
 * The spot is synthetic and has the shape the PLO6 tournament-folds study
 * recorded: a 40bb six-handed big-blind-ante tournament, hero opened to 3.5bb,
 * one cold call, a pot re-raise to 14.5bb, one cold call of the re-raise, both
 * blinds folded; hero has 34.5bb behind and 11bb to call (32% of the stack).
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

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((t) => ({ rank: t[0] as CardRank, suit: SUIT[t[1]] }));

const HERO_SEAT = 3;
const NODE_ORD = 11;

function fixture(hole: string, variant = 'plo6'): ComplaintFixture {
  return {
    version: 1,
    slug: 'plo6-commit-zone-relief-wiring-synthetic',
    title: 'synthetic PLO6 tournament opener facing a cold-called pot re-raise',
    complaint: 'synthetic',
    handId: 'synthetic',
    fmt: 'tour',
    variant,
    players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, isHorse: true })),
    hole: { [HERO_SEAT]: cards(hole) },
    actions: [
      { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 50 },
      { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 100 },
      { ord: 3, seat: 2, stage: 'preflop', action: 'ante', amount: 100 },
      { ord: 4, seat: 3, stage: 'preflop', action: 'raise', amount: 350, isFullRaise: true },
      { ord: 5, seat: 4, stage: 'preflop', action: 'call', amount: 350 },
      { ord: 6, seat: 5, stage: 'preflop', action: 'raise', amount: 1450, isFullRaise: true },
      { ord: 7, seat: 6, stage: 'preflop', action: 'call', amount: 1450 },
      { ord: 8, seat: 1, stage: 'preflop', action: 'fold', amount: 0 },
      { ord: 9, seat: 2, stage: 'preflop', action: 'fold', amount: 0 },
      {
        ord: NODE_ORD,
        seat: HERO_SEAT,
        stage: 'preflop',
        action: 'fold',
        amount: 0,
        publicNode: {
          pot: 3850,
          ante: 100,
          anteType: 'big_blind',
          mode: 'tournament',
          asset: 'chips',
          seats: [
            [1, 3950, 50, 50, 0, 0, 1],
            [2, 3800, 100, 200, 100, 0, 1],
            [3, 3450, 350, 350, 0, 0, 0],
            [4, 3650, 350, 350, 0, 0, 0],
            [5, 2550, 1450, 1450, 0, 0, 0],
            [6, 2550, 1450, 1450, 0, 0, 0],
          ],
          boards: [''],
          street: 'preflop',
          toCall: 1100,
          currentBet: 1450,
          minRaiseTo: 2550,
          maxRaiseTo: 3800,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          dealerSeat: 6,
          chipUnit: 1,
          bigBlind: 100,
          smallBlind: 50,
          variant,
          structure: 'pot_limit',
          actorSeat: HERO_SEAT,
          bombPot: false,
          boardCount: 1,
          allInOrFold: false,
          fixedBetSize: null,
          wagersCapped: false,
          tournamentStage: { status: 'not_applicable', version: 1 },
        },
      },
    ],
    forbidden: [],
    seeds: COMPLAINT_SEEDS,
  };
}

/** Six-card hands across the strength range the brain can fold or continue with at this price. */
const HOLES = [
  'AsKsQhJh9d8d',
  'KsQsJhTh8d7d',
  'AsAhJd9c6s3h',
  'QsQhTd9c7s4h',
  'JsThTd9c8s7h',
  'KsKh8d7c5s2h',
  'AsJs9h8h6d5d',
  'TsTh9d8c6s5h',
  'AhQhJs9s7d4c',
  'KdQdTs9s6h5h',
  '9s9h8d7c6s3h',
  'AsTs8h7h5d4d',
];

const ON = { omahaCommitZoneThreeBetPriceRelief: true };

function run(fx: ComplaintFixture, opts?: Record<string, unknown>) {
  const node = fx.actions.find((a) => a.ord === NODE_ORD)!;
  const st = stateAt(fx, node);
  const live = replayProfiles(st.pn.mode).find((p) => p.live)!;
  // Decisions only: some occurrence receipts fire once per process, so the
  // receipt map of an earlier run differs from a later one for that reason alone.
  const r = replayAt(st, live, COMPLAINT_SEEDS, opts);
  return { kinds: r.kinds, actions: r.actions, sizesBb: r.sizesBb };
}

describe('omahaCommitZoneThreeBetPriceRelief through HorseLogic.decide', () => {
  afterEach(() => HorseMind.reset());

  it('absent and explicit false are the same decision, hand by hand and seed by seed', () => {
    for (const hole of HOLES) {
      const fx = fixture(hole);
      expect(run(fx, { omahaCommitZoneThreeBetPriceRelief: false })).toEqual(run(fx));
    }
  }, 120_000);

  it('explicit true reaches the preflop engine: fewer folds, more raises, never a new fold', () => {
    let offFolds = 0;
    let onFolds = 0;
    let offRaises = 0;
    let onRaises = 0;
    let changedHands = 0;
    for (const hole of HOLES) {
      const fx = fixture(hole);
      const off = run(fx);
      const on = run(fx, ON);
      const of = off.actions.fold ?? 0;
      const nf = on.actions.fold ?? 0;
      expect(nf).toBeLessThanOrEqual(of);
      if (JSON.stringify(off.actions) !== JSON.stringify(on.actions)) changedHands += 1;
      offFolds += of;
      onFolds += nf;
      offRaises += (off.kinds.raise ?? 0) + (off.kinds.jam ?? 0);
      onRaises += (on.kinds.raise ?? 0) + (on.kinds.jam ?? 0);
    }
    expect(changedHands).toBeGreaterThan(0);
    expect(onFolds).toBeLessThan(offFolds);
    expect(onRaises).toBeGreaterThan(offRaises);
  }, 120_000);

  it('control: five-card Omaha is unchanged with the option on', () => {
    for (const hole of HOLES.slice(0, 6)) {
      const fx = fixture(hole.slice(0, 10), 'plo5');
      expect(run(fx, ON)).toEqual(run(fx));
    }
  }, 120_000);
});
