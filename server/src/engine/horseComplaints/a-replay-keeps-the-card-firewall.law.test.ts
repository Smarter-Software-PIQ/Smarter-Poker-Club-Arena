/**
 * A REPLAY KEEPS THE CARD FIREWALL (2026-11-15).
 *
 * Found by the Fixed-Limit lane's recorded-hand replay (evidence dir
 * fixed-limit-01Gw7aDr/r2, R2-METHOD.md amendment 1). The live engine builds
 * every horse decision behind a HIDDEN-INFORMATION FIREWALL
 * (ServerTableEngineTurns publicPlayers): every seat in the shared state has
 * `cards: []`, and the horse's own cards exist exactly once, on the deciding
 * player it hands the brain beside the state. HorseComplaintReplay.stateAt
 * left the horse's hole cards on its own seat in gs.players, so:
 *
 *   - every pack that refuses a state carrying private cards refused every
 *     replayed decision it would have read live (`private_state_rejected`):
 *     on the committed fixtures, Phase 10 at every PLO4 node and Phase 11 at
 *     every PLO5 node; on fixed-limit nodes, Phase 12 and Phase 13;
 *   - a replay was therefore not production-equivalent wherever those packs
 *     touch the decision: measured on 1,845 recorded Horse-only fixed-limit
 *     cash hands with the Phase 12 pack in candidate mode, the flh button
 *     folded first in 46.3 % of replays without the firewall, 76.4 % with it,
 *     against 78.6 % recorded.
 *
 * The replay now builds the state as the live engine does. The hero's cards
 * reach the brain only on `hero` (the live decisionPlayer).
 */
import { describe, expect, it } from 'vitest';
import {
  horseNodes,
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ExtractedHand,
} from '../HorseComplaintReplay.js';
import type { Card } from '../../types.js';
import PLO4 from './plo4-heads-up-final-small-blind-folds-sevens-at-ten-blinds.fixture.json';
import QQ from './qq-big-blind-four-bet-then-fold-to-the-deeper-opener.fixture.json';
import PLO5 from './plo5-set-bets-the-river-into-the-turn-leader.fixture.json';

const c = (rank: string, suit: Card['suit']): Card => ({ rank: rank as Card['rank'], suit });

/**
 * A fixed-limit cash node in the shape the live engine records
 * (HorsePublicActionNode, captured deductions, 0.25/0.50 blinds, chip unit
 * 0.01): six seats, three folds, the horse on the button first in. The
 * values are constructed for the law; no recorded hand is copied.
 */
export function flSyntheticHand(variant: 'flh' | 'flo8'): {
  hand: ExtractedHand;
  node: ComplaintAction;
  hole: Card[];
} {
  const hole =
    variant === 'flh'
      ? [c('K', 'spades'), c('Q', 'spades')]
      : [c('A', 'spades'), c('2', 'spades'), c('3', 'hearts'), c('K', 'diamonds')];
  const node: ComplaintAction = {
    ord: 6,
    seat: 4,
    stage: 'preflop',
    action: 'raise',
    amount: 1,
    origin: 'horse_policy',
    publicNode: {
      pot: 0.75,
      ante: 0,
      anteType: 'per_player',
      mode: 'cash',
      asset: 'chips',
      seats: [
        [1, 100, 0, 0, 0, 0, 1],
        [2, 100, 0, 0, 0, 0, 1],
        [3, 100, 0, 0, 0, 0, 1],
        [4, 100, 0, 0, 0, 0, 0],
        [5, 99.75, 0.25, 0.25, 0, 0, 0],
        [6, 99.5, 0.5, 0.5, 0, 0, 0],
      ],
      boards: [''],
      boardCount: 1,
      street: 'preflop',
      toCall: 0.5,
      currentBet: 0.5,
      minRaiseTo: 1,
      maxRaiseTo: 1,
      fixedBetSize: 0.5,
      wagersCapped: false,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 4,
      chipUnit: 0.01,
      bigBlind: 0.5,
      smallBlind: 0.25,
      variant,
      structure: 'fixed_limit',
      actorSeat: 4,
      bombPot: false,
      allInOrFold: false,
      vpipFloor: 0,
      deductions: {
        status: 'captured',
        version: 1,
        rules: 'controller-rake-bbj-v1',
        rake: {
          cap: 1.25,
          percent: 10,
          noFlopNoDrop: true,
          playerCountCaps: [
            [2, 0.63],
            [3, 0.94],
            [4, 1.25],
          ],
        },
        bbj: { enabled: true, feeBB: 0.6, minPotBB: 10, minPlayersDealt: 3 },
      },
      tournamentStage: { status: 'not_applicable', version: 1 },
    } as never,
  };
  return {
    hole,
    node,
    hand: {
      handId: `card-firewall-${variant}`,
      tournamentId: null,
      variant,
      bigBlind: 0.5,
      smallBlind: 0.25,
      buttonSeat: 4,
      hasHuman: false,
      players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, userId: `p${seat}`, isHorse: true })),
      horseHoleCards: { p4: hole },
      actions: [
        { ord: 1, seat: 5, stage: 'preflop', action: 'sb', amount: 0.25, origin: 'forced' },
        { ord: 2, seat: 6, stage: 'preflop', action: 'bb', amount: 0.5, origin: 'forced' },
        { ord: 3, seat: 1, stage: 'preflop', action: 'fold', amount: 0 },
        { ord: 4, seat: 2, stage: 'preflop', action: 'fold', amount: 0 },
        { ord: 5, seat: 3, stage: 'preflop', action: 'fold', amount: 0 },
        node,
      ],
    } as unknown as ExtractedHand,
  };
}

const FIXTURES = [PLO4, QQ, PLO5] as unknown as ComplaintFixture[];
const SEEDS = [1, 7, 42];
const rejected = (receipts: Record<string, number>) =>
  Object.keys(receipts).filter((k) => k.endsWith('private_state_rejected'));

describe('a replay keeps the card firewall', () => {
  it('no seat of a replayed state carries hole cards; the horse holds its own cards once, on hero', () => {
    for (const variant of ['flh', 'flo8'] as const) {
      const { hand, node, hole } = flSyntheticHand(variant);
      const st = stateAt(hand, node);
      expect(st.gs.players.every((p) => Array.isArray(p.cards) && p.cards.length === 0)).toBe(true);
      expect(st.hero.cards).toEqual(hole);
      expect(st.gs.players.includes(st.hero)).toBe(false);
      expect(st.gs.players.find((p) => p.seat === st.hero.seat)).toMatchObject({
        seat: 4,
        stack: 100,
        cards: [],
      });
    }
    for (const fx of FIXTURES)
      for (const node of horseNodes(fx)) {
        const seat = node.publicNode?.actorSeat ?? node.seat;
        if (!fx.hole[String(seat)]?.length) continue;
        const st = stateAt(fx, node);
        expect(
          st.gs.players.every((p) => p.cards.length === 0),
          `${fx.slug} ord ${node.ord}`
        ).toBe(true);
        expect(st.hero.cards, `${fx.slug} ord ${node.ord}`).toEqual(fx.hole[String(seat)]);
      }
  });

  it('the fixed-limit pack reads a replayed fixed-limit decision instead of refusing it as private state', () => {
    for (const variant of ['flh', 'flo8'] as const) {
      const { hand, node } = flSyntheticHand(variant);
      for (const profile of replayProfiles('cash')) {
        const r = replayAt(stateAt(hand, node), profile, SEEDS);
        expect(rejected(r.receipts), `${variant} ${profile.name}`).toEqual([]);
        expect(r.receipts[`phase12_${variant}_eligible`] ?? 0, `${variant} ${profile.name}`).toBe(
          SEEDS.length
        );
      }
    }
  });

  it('no pack refuses a replayed complaint fixture decision as private state', () => {
    for (const fx of FIXTURES)
      for (const node of horseNodes(fx)) {
        const seat = node.publicNode?.actorSeat ?? node.seat;
        if (!fx.hole[String(seat)]?.length) continue;
        const st = stateAt(fx, node);
        for (const profile of replayProfiles(st.pn.mode)) {
          const r = replayAt(st, profile, SEEDS);
          expect(rejected(r.receipts), `${fx.slug} ord ${node.ord} ${profile.name}`).toEqual([]);
        }
      }
  });
});
