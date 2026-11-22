/**
 * LAW - A REPLAYED HAND HAS NO FORCED POSTS IN ITS HISTORY (2026-11-20)
 *
 * A horse decision replayed from a recorded hand (HorseComplaintReplay.stateAt)
 * must hand HorseLogic the same decision inputs the live engine handed it.
 * Live HandController never records a forced post (small blind, big blind,
 * ante, straddle, dead post, bomb ante, kill blind) in `state.actionHistory`;
 * postBlinds only emits FORCED_BETS_POSTED, which ServerTableEngineHandEvents
 * writes into the hand record beside the voluntary actions. The replay used to
 * copy every recorded row before the node into actionHistory, posts included,
 * so a big blind facing a raise read as having already acted
 * (HorseLogic heroPreviouslyActed: any own action that is not a fold or a
 * check) and its orbit state read a prior voluntary action that never
 * happened. Live play was never affected; every replay of a preflop decision
 * by a blind or ante poster was.
 *
 * This drives a real HandController to a big blind facing a raise, records
 * the hand exactly as the engine records it (forced posts from
 * FORCED_BETS_POSTED, then each PLAYER_ACTION with its public node), and
 * requires the replayed node to give the live actionHistory, the live
 * heroPreviouslyActed and the live preflop orbit state.
 */
import { describe, expect, it } from 'vitest';
import { HandController } from './HandController.js';
import { analyzePreflopOrbit } from './HorsePreflopOrbitState.js';
import {
  stateAt,
  type ComplaintAction,
  type ComplaintPublicNode,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import type { ActionRecord, Card, HandConfig, HandEvent, SeatPlayer } from '../types.js';

type Projected = {
  stage: string;
  seat: number;
  action: string;
  amount: number;
  isFullRaise: boolean;
};

const project = (h: ReadonlyArray<Partial<ActionRecord>>): Projected[] =>
  h.map((a) => ({
    stage: String(a.stage),
    seat: Number(a.seat),
    action: String(a.action),
    amount: Number(a.amount),
    isFullRaise: a.isFullRaise === true,
  }));

/** HorseLogic.decide's heroPreviouslyActed, the same predicate over the same history. */
const heroPreviouslyActed = (history: ReadonlyArray<Partial<ActionRecord>>, seat: number) =>
  history.some((a) => a.seat === seat && a.action !== 'fold' && a.action !== 'check');

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

function playToBigBlindFacingARaise() {
  const players = [1, 2, 3, 4].map(
    (seat) =>
      ({
        seat,
        user_id: `p${seat}`,
        username: `p${seat}`,
        stack: 200,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      }) as SeatPlayer
  );
  const config = {
    tableId: 't-replay-law',
    handNumber: 1,
    gameVariant: 'nlh',
    smallBlind: 1,
    bigBlind: 2,
    ante: 0.5,
  } as HandConfig;
  const hc = new HandController(config, players, 1);
  // The hand record, written the way ServerTableEngineHandEvents writes it.
  const recorded: ComplaintAction[] = [];
  const push = (a: Omit<ComplaintAction, 'ord'>) =>
    recorded.push({ ...a, ord: recorded.length + 1 });
  hc.onEvent((e: HandEvent) => {
    const ev = e as unknown as Record<string, any>;
    if (ev.type === 'FORCED_BETS_POSTED') {
      for (const p of ev.postings)
        push({
          seat: p.seat,
          stage: 'preflop',
          action: p.kind,
          amount: p.amount,
          origin: 'forced',
          dead: p.dead === true,
        });
    }
    if (ev.type === 'PLAYER_ACTION') {
      push({
        seat: ev.seat,
        stage: ev.stage,
        action: ev.action,
        amount: ev.amount,
        origin: ev.origin,
        isFullRaise: ev.record?.isFullRaise === true,
        ...(ev.publicNode?.status === 'captured'
          ? { publicNode: ev.publicNode as ComplaintPublicNode }
          : {}),
      });
    }
  });
  hc.start();
  const live = () => hc.getState();
  const sbSeat = 2;
  const bbSeat = 3;
  expect(live().currentPlayerSeat).toBe(4);
  expect(hc.performAction(4, 'raise', 6, 'horse_policy')).toBe(true);
  expect(hc.performAction(1, 'fold', undefined, 'horse_policy')).toBe(true);
  expect(hc.performAction(sbSeat, 'fold', undefined, 'horse_policy')).toBe(true);
  expect(live().currentPlayerSeat).toBe(bbSeat);
  // What the live engine hands the big blind's decision (ServerTableEngineTurns
  // copies getState().actionHistory into the horse state).
  const liveHistory = live().actionHistory.map((a) => ({ ...a }));
  const liveState = live();
  expect(hc.performAction(bbSeat, 'call', undefined, 'horse_policy')).toBe(true);
  const node = recorded.find((a) => a.seat === bbSeat && a.publicNode);
  if (!node) throw new Error('the big blind decision recorded no public node');
  const hand: ExtractedHand = {
    handId: 'h-replay-law',
    variant: 'nlh',
    bigBlind: 2,
    smallBlind: 1,
    players: players.map((p) => ({ seat: p.seat, userId: p.user_id, isHorse: true })),
    horseHoleCards: { p3: [c('A', 'spades'), c('5', 'spades')] },
    actions: recorded,
  };
  return { hand, node, liveHistory, liveState, bbSeat };
}

describe('a replayed hand has no forced posts in its history', () => {
  it('the hand record carries the forced posts the replay must leave out', () => {
    const { hand, node } = playToBigBlindFacingARaise();
    const before = hand.actions.filter((a) => a.ord < node.ord).map((a) => a.action);
    expect(before).toEqual(expect.arrayContaining(['sb', 'bb', 'ante']));
  });

  it('a big blind facing a raise replays with the live actionHistory', () => {
    const { hand, node, liveHistory } = playToBigBlindFacingARaise();
    const st = stateAt(hand, node);
    expect(project(st.gs.actionHistory as Partial<ActionRecord>[])).toEqual(project(liveHistory));
    expect((st.gs.actionHistory as Partial<ActionRecord>[]).map((a) => a.action)).toEqual([
      'raise',
      'fold',
      'fold',
    ]);
  });

  it('heroPreviouslyActed and the preflop orbit state are the live ones', () => {
    const { hand, node, liveHistory, liveState, bbSeat } = playToBigBlindFacingARaise();
    const st = stateAt(hand, node);
    const replayHistory = st.gs.actionHistory as ActionRecord[];
    expect(heroPreviouslyActed(liveHistory, bbSeat)).toBe(false);
    expect(heroPreviouslyActed(replayHistory, bbSeat)).toBe(false);
    const orbit = (history: readonly ActionRecord[], players: SeatPlayer[], hero: SeatPlayer) =>
      analyzePreflopOrbit({
        history,
        players,
        heroSeat: bbSeat,
        heroStack: hero.stack,
        heroBet: hero.bet,
        bigBlind: 2,
        smallBlind: 1,
        currentBet: liveState.currentBet,
        dealerSeat: liveState.dealerSeat,
      });
    const liveHero = liveState.players.find((p) => p.seat === bbSeat)!;
    const liveOrbit = orbit(liveHistory, liveState.players, liveHero);
    const replayOrbit = orbit(replayHistory, st.gs.players as SeatPlayer[], st.hero);
    expect(liveOrbit.heroPriorAction).toBe('none');
    expect(replayOrbit).toEqual(liveOrbit);
  });
});
