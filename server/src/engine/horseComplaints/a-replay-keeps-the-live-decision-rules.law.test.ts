/**
 * A REPLAY KEEPS THE LIVE DECISION RULES (2026-11-06).
 *
 * Found by the controlled coverage suite (evidence dir hybrid-release-20261105/
 * controlled-coverage). The live engine hands every horse decision a state of
 * schema version 1 that names the table's all-in-or-fold rule
 * (ServerTableEngineTurns), and records the same rule in the decision's public
 * node (HorsePublicActionNode allInOrFold). HorseComplaintReplay.stateAt
 * rebuilt the state without either, so:
 *
 *   - enforceAuthoritativeDecision (armed only by stateSchemaVersion 1) never
 *     ran in a replay, and the brain could answer outside the recorded menu;
 *   - at an all-in-or-fold node the V27 big-blind-vs-jam chart's `call` came
 *     back as `call` on a fold / all-in menu, where the live engine commits
 *     the all-in (#8196). Measured on the sampled stored profiles: 1,540 of
 *     3,380 MTT and 640 of 1,690 cash AoF replays answered outside the menu.
 *
 * The replay now carries both, so a recorded AoF hand replays the decision the
 * live engine made, and every replayed answer stays inside the recorded menu.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from '../HorseComplaintReplay.js';
import { _clearGtoCharts, setGtoCharts } from '../GtoCharts.js';
import type { Card } from '../../types.js';

const c = (rank: string, suit: Card['suit']): Card => ({ rank: rank as Card['rank'], suit });

/** Three-handed MTT: button folds, the small blind jams 8bb, the big blind (a horse, 20bb) acts. */
function hand(
  hole: Card[],
  aof: boolean | undefined
): { hand: ExtractedHand; node: ComplaintAction } {
  const node: ComplaintAction = {
    ord: 5,
    seat: 2,
    stage: 'preflop',
    action: 'fold',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: 900,
      ante: 0,
      anteType: 'none',
      mode: 'tournament',
      seats: [
        [1, 0, 800, 800, 0, 0, 2],
        [2, 1900, 100, 100, 0, 0, 0],
        [3, 2000, 0, 0, 0, 0, 1],
      ],
      boards: [''],
      street: 'preflop',
      toCall: 700,
      currentBet: 800,
      minRaiseTo: aof ? null : 1500,
      maxRaiseTo: aof ? null : 2000,
      legalActions: aof ? ['fold', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 100,
      smallBlind: 50,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: 2,
      bombPot: false,
      ...(aof === undefined ? {} : { allInOrFold: aof }),
      tournamentStage: null,
    },
  };
  return {
    node,
    hand: {
      handId: 'aof-replay',
      tournamentId: 't',
      variant: 'nlh',
      bigBlind: 100,
      smallBlind: 50,
      buttonSeat: 3,
      players: [1, 2, 3].map((seat) => ({ seat, userId: `p${seat}`, isHorse: true })),
      horseHoleCards: { p2: hole },
      actions: [
        { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 50 },
        { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 100 },
        { ord: 3, seat: 3, stage: 'preflop', action: 'fold', amount: 0 },
        { ord: 4, seat: 1, stage: 'preflop', action: 'all_in', amount: 800, isFullRaise: true },
        node,
      ],
    } as unknown as ExtractedHand,
  };
}

// One production-shaped chart row: the BB calls an 8bb SB jam with K7s (and AA).
setGtoCharts([
  {
    chart_id: 'aof-replay-law',
    game_type: 'Tournament',
    stack_depth: 8,
    hero_position: 'BB',
    villain_action: 'sb_push',
    hand_matrix: { AA: { call: 1, fold: 0 }, K7s: { call: 1, fold: 0 } },
    created_at: '2026-07-19T15:11:48Z',
  } as never,
]);
afterAll(() => _clearGtoCharts());

const K7S = [c('K', 'spades'), c('7', 'spades')];

describe('a replay keeps the live decision rules', () => {
  it('rebuilds the state the live engine hands the brain: schema version 1 and the recorded AoF rule', () => {
    const on = hand(K7S, true);
    const st = stateAt(on.hand, on.node);
    expect(st.gs.stateSchemaVersion).toBe(1);
    expect(st.gs.allInOrFold).toBe(true);
    const off = hand(K7S, false);
    expect(stateAt(off.hand, off.node).gs.allInOrFold).toBe(false);
    // A node recorded before the field existed replays as an ordinary table.
    const old = hand(K7S, undefined);
    expect(stateAt(old.hand, old.node).gs.allInOrFold).toBe(false);
  });

  it('at an AoF node the chart call replays as the all-in, never as a call outside the menu (#8196)', () => {
    for (const profile of replayProfiles('tournament')) {
      const r = replayAt(stateAt(hand(K7S, true).hand, hand(K7S, true).node), profile);
      expect(
        Object.keys(r.actions).every((a) => a === 'fold' || a === 'all_in'),
        profile.name
      ).toBe(true);
      expect(r.actions.all_in ?? 0, profile.name).toBeGreaterThan(0);
      expect(r.receipts.v27_gto_bb_defend ?? 0, profile.name).toBeGreaterThan(0);
    }
  });

  it('control: the same chart call on an ordinary menu replays as the call', () => {
    const { hand: h, node } = hand(K7S, false);
    const r = replayAt(stateAt(h, node), replayProfiles('tournament')[0]);
    expect(r.actions.call ?? 0).toBeGreaterThan(0);
  });
});
