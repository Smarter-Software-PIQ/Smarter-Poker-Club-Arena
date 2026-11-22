/**
 * THE SCRIPTED FIXED-LIMIT FIELD (2026-11-20, docs/horse-league-fixed-limit.md).
 *
 * The league seats scripted fixed-limit players (FixedLimitScriptedField.ts)
 * around one hero Horse through its existing human-field mechanism. This file
 * proves:
 *  1. Hands with scripted seats replay action by action through a REAL
 *     HandController: at every node the menu the seat was offered (a Horse's
 *     brain state, or a script's LeagueSeatSpot) is the controller's own
 *     authoritative menu, the controller accepts every action, and its final
 *     stacks equal the league's settlement.
 *  2. Each script answers only with an action on that menu, at the one legal
 *     wager, and the league applies its answer unchanged; chips are conserved.
 *  3. The field is deterministic from the deal seed.
 *  4. What the field may and may not be seated with is refused out loud.
 *  5. The scripted-field cards are on the card, not refused, and not inert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, HandConfig, HandEvent, HandStage, SeatPlayer } from '../types.js';
import { HandController } from '../engine/HandController.js';
import { HorseMind } from '../engine/HorseMind.js';
import { HorseLogic, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import {
  FIXED_LIMIT_SCRIPTED_FIELD_CARDS,
  FIXED_LIMIT_SCRIPTED_POPULATION_ID,
  FIXED_LIMIT_SCRIPTED_PERSONAS,
  FLH_MANIAC_PERSONA,
  FLH_OVER_FOLDING_BLINDS_PERSONA,
  FLH_PASSIVE_CALLER_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
  FLH_VALUE_ONLY_BLINDS_PERSONA,
  FLH_PREFLOP_DEFENDING_BLINDS_PERSONA,
  FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA,
  LEAGUE_MATCHUPS,
  UNMEASURABLE_MATCHUPS,
  humanFieldPersonaProfile,
  leagueDealtCards,
  leagueProbeHistoryWarmup,
  playHand,
  runMatchup,
  type LeagueHandObserver,
  type LeagueHumanField,
  type LeagueSeatSpot,
} from './HorseLeague.js';
import {
  fixedLimitScriptedPolicy,
  flhDefendingPostflopBlindsPolicy,
  flhManiacPolicy,
  flhOverFoldingBlindsPolicy,
  flhPassiveCallerPolicy,
  flhPreflopDefendingBlindsPolicy,
  flhTightValuePolicy,
  flhValueOnlyBlindsPolicy,
  hasTopPairOrOverpair,
  ownMadeClass,
} from './FixedLimitScriptedField.js';
import type { FixedLimitScriptedPersona } from './HorseLeagueHumanField.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';
import { horseLeagueComputeResponseIsValid } from './HorseLeagueComputeWorkerClient.js';
import {
  LEAGUE_FIXED_LIMIT_MAX_COMMIT_BB,
  leagueFixedLimitRefusal,
} from './LeagueDecisionState.js';

const BB = 2;
const SB = 1;
const STACK_BB = 100;
const HERO = 0;

interface Node {
  seatIdx: number;
  stage: HandStage;
  action: string;
  amount: number;
  pot: number;
  toCall: number;
}

/** One fixed-limit hand: Horse hero at seat 0, the scripted persona everywhere else. */
function fieldHand(
  persona: FixedLimitScriptedPersona,
  handSeed: number,
  dealerSeat: number,
  seats: number
) {
  const actions: Node[] = [];
  const observer: LeagueHandObserver = {
    onAction: (e) =>
      actions.push({
        seatIdx: e.seatIdx,
        stage: e.stage,
        action: e.action,
        amount: e.amount,
        pot: e.pot,
        toCall: e.toCall,
      }),
  };
  const scripted: Array<{ spot: LeagueSeatSpot; answer: { action: string; amount?: number } }> = [];
  const script = fixedLimitScriptedPolicy(persona);
  const field: LeagueHumanField = {
    population: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
    isHuman: (s) => s !== HERO,
    seatPolicyOf: () => (spot) => {
      const answer = script(spot);
      const { horseDecide: _brain, ...publicSpot } = spot;
      scripted.push({ spot: structuredClone(publicSpot) as LeagueSeatSpot, answer });
      return answer;
    },
  };
  const counters = { illegal: 0, truncated: 0, corrected: 0, brainFallback: 0 };
  const spy = vi.spyOn(HorseLogic, 'decide');
  const before = spy.mock.calls.length;
  const net = playHand(
    handSeed,
    dealerSeat,
    () => ({}),
    counters,
    undefined,
    'flh',
    seats,
    STACK_BB,
    undefined,
    undefined,
    field,
    undefined,
    true,
    observer
  );
  const horseStates = spy.mock.calls
    .slice(before)
    .map(([, gs]) => structuredClone(gs) as HorseGameStateV2);
  // One brain call per hero decision and one script call per field decision, in order.
  let h = 0;
  let f = 0;
  const ordered = actions.map((a) =>
    a.seatIdx === HERO
      ? { kind: 'horse' as const, gs: horseStates[h++] }
      : { kind: 'script' as const, ...scripted[f++] }
  );
  expect(h).toBe(horseStates.length);
  expect(f).toBe(scripted.length);
  return { actions, ordered, net, counters };
}

function controllerFor(handSeed: number, dealerSeat: number, seats: number) {
  const players = Array.from({ length: seats }, (_, i) => ({
    seat: i + 1,
    user_id: i === HERO ? `league-${i + 1}` : `league-human-${i + 1}`,
    username: i === HERO ? `League${i + 1}` : `Human${i + 1}`,
    stack: STACK_BB * BB,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: i === HERO,
  })) as SeatPlayer[];
  const controller = new HandController(
    {
      tableId: 'league-fixed-limit-field-replay',
      handNumber: 1,
      gameVariant: 'flh',
      smallBlind: SB,
      bigBlind: BB,
      ante: 0,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    dealerSeat
  );
  const dealt = leagueDealtCards(handSeed, 'flh', seats);
  const deck: Card[] = [...dealt.holes.flat(), ...dealt.board];
  const instance = controller.getState().deck as unknown as {
    deal(n?: number): Card[];
    dealOne(): Card;
    remaining(): number;
    getRemainingCards(): Card[];
  };
  instance.deal = (n = 1) => {
    if (deck.length < n) throw new Error('replay deck exhausted');
    return deck.splice(0, n);
  };
  instance.dealOne = () => instance.deal(1)[0];
  instance.remaining = () => deck.length;
  instance.getRemainingCards = () => deck.slice();
  let complete = false;
  controller.onEvent((event: HandEvent) => {
    if (event.type === 'HAND_COMPLETE') complete = true;
  });
  controller.start();
  return { controller, isComplete: () => complete };
}

function replay(
  persona: FixedLimitScriptedPersona,
  handSeed: number,
  dealerSeat: number,
  seats: number
) {
  const hand = fieldHand(persona, handSeed, dealerSeat, seats);
  const label = `${persona} seed ${handSeed}, dealer ${dealerSeat}, ${seats} seats`;
  expect(hand.counters.illegal, label).toBe(0);
  expect(hand.counters.truncated, label).toBe(0);
  expect(hand.counters.brainFallback, label).toBe(0);
  const live = controllerFor(handSeed, dealerSeat, seats);
  const c = live.controller;
  hand.actions.forEach((a, k) => {
    const at = `${label}, action ${k} (${a.stage} seat ${a.seatIdx + 1} ${a.action})`;
    expect(live.isComplete(), at).toBe(false);
    const state = c.getState();
    const actor = c.getCurrentPlayer()!;
    const menu = c.getAuthoritativeActionState(actor.user_id)!;
    expect(actor.seat, at).toBe(a.seatIdx + 1);
    expect(state.stage, at).toBe(a.stage);
    expect(state.pot, at).toBe(a.pot);
    const o = hand.ordered[k];
    if (o.kind === 'horse') {
      expect(
        {
          legalActions: o.gs.legalActions,
          toCall: o.gs.toCall,
          minRaiseTo: o.gs.minRaiseTo,
          maxRaiseTo: o.gs.maxRaiseTo,
          wagersCapped: o.gs.wagersCapped,
        },
        at
      ).toEqual({
        legalActions: menu.legalActions,
        toCall: menu.toCall,
        minRaiseTo: menu.minRaiseTo,
        maxRaiseTo: menu.maxRaiseTo,
        wagersCapped: menu.wagersCapped,
      });
    } else {
      // The script was offered the controller's own menu...
      expect(
        {
          legalActions: o.spot.legalActions,
          toCall: o.spot.toCall,
          minRaiseTo: o.spot.minRaiseTo,
          maxRaiseTo: o.spot.maxRaiseTo,
        },
        at
      ).toEqual({
        legalActions: menu.legalActions,
        toCall: menu.toCall,
        minRaiseTo: menu.minRaiseTo,
        maxRaiseTo: menu.maxRaiseTo,
      });
      // ...answered with an action on it, at the one legal wager...
      expect(menu.legalActions, at).toContain(o.answer.action);
      expect(o.answer.action, at).not.toBe('all_in');
      if (o.answer.action === 'bet' || o.answer.action === 'raise') {
        expect(o.answer.amount, at).toBe(menu.minRaiseTo);
      }
      // ...and the league applied that answer unchanged.
      expect(a.action, at).toBe(o.answer.action);
    }
    expect(menu.legalActions, at).toContain(a.action);
    const wager = a.action === 'bet' || a.action === 'raise' ? a.amount : undefined;
    expect(c.performAction(actor.seat, a.action as never, wager), at).toBe(true);
  });
  expect(live.isComplete(), label).toBe(true);
  expect(
    c.getState().players.map((p) => p.stack - STACK_BB * BB),
    label
  ).toEqual(hand.net);
  // Chips are conserved and no seat loses more than a fixed-limit hand can cost.
  expect(
    hand.net.reduce((s, n) => s + n, 0),
    label
  ).toBe(0);
  for (const n of hand.net)
    expect(-n, label).toBeLessThanOrEqual(LEAGUE_FIXED_LIMIT_MAX_COMMIT_BB * BB);
  return hand;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the scripted fixed-limit field plays the live controller hand', () => {
  it.each([
    [FLH_MANIAC_PERSONA, 6, 60],
    [FLH_MANIAC_PERSONA, 2, 60],
    [FLH_TIGHT_VALUE_PERSONA, 6, 60],
    [FLH_TIGHT_VALUE_PERSONA, 2, 60],
    [FLH_PASSIVE_CALLER_PERSONA, 6, 60],
    [FLH_PASSIVE_CALLER_PERSONA, 2, 60],
    [FLH_OVER_FOLDING_BLINDS_PERSONA, 6, 60],
    [FLH_OVER_FOLDING_BLINDS_PERSONA, 2, 60],
    [FLH_VALUE_ONLY_BLINDS_PERSONA, 6, 60],
    [FLH_VALUE_ONLY_BLINDS_PERSONA, 2, 60],
    [FLH_PREFLOP_DEFENDING_BLINDS_PERSONA, 6, 60],
    [FLH_PREFLOP_DEFENDING_BLINDS_PERSONA, 2, 60],
    [FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA, 6, 60],
    [FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA, 2, 60],
  ] as const)(
    '%s at %i seats: every node, menu, script answer and settlement equals a real HandController',
    (persona, seats, hands) => {
      const seen = { scripted: 0, wagers: 0, folds: 0, capped: 0, streets: new Set<string>() };
      for (let h = 0; h < hands; h++) {
        const handSeed = ((20261121 + seats) ^ (h * 2654435761)) >>> 0 || 1;
        const hand = replay(persona, handSeed, (h % seats) + 1, seats);
        for (const [k, o] of hand.ordered.entries()) {
          seen.streets.add(hand.actions[k].stage);
          if (o.kind !== 'script') continue;
          seen.scripted++;
          if (o.answer.action === 'bet' || o.answer.action === 'raise') seen.wagers++;
          if (o.answer.action === 'fold') seen.folds++;
          if (!o.spot.legalActions.includes('raise') && !o.spot.legalActions.includes('bet'))
            seen.capped++;
        }
      }
      expect(seen.scripted).toBeGreaterThan(hands);
      // The over-folding blinds never bet or raise; every other script does.
      if (
        persona === FLH_OVER_FOLDING_BLINDS_PERSONA ||
        persona === FLH_PREFLOP_DEFENDING_BLINDS_PERSONA
      )
        expect(seen.wagers).toBe(0);
      else expect(seen.wagers).toBeGreaterThan(0);
      if (persona === FLH_MANIAC_PERSONA) {
        // The maniac never folds, reaches every street, and caps streets.
        expect(seen.folds).toBe(0);
        expect([...seen.streets].sort()).toEqual(['flop', 'preflop', 'river', 'turn']);
        expect(seen.capped).toBeGreaterThan(0);
      } else {
        expect(seen.folds).toBeGreaterThan(0);
      }
    },
    300_000
  );
});

describe('the scripts', () => {
  const spot = (over: Partial<LeagueSeatSpot>): LeagueSeatSpot =>
    ({
      variant: 'flh',
      isPotLimit: false,
      stage: 'flop',
      seatIdx: 1,
      numSeats: 6,
      dealerSeat: 1,
      bigBlind: BB,
      cards: [],
      board: [],
      pot: 10,
      toCall: 0,
      currentBet: 0,
      myBet: 0,
      stack: 200,
      liveCount: 3,
      legalActions: ['fold', 'check', 'bet', 'all_in'],
      minRaiseTo: 2,
      maxRaiseTo: 2,
      history: [],
      userId: 'league-human-2',
      horseDecide: () => {
        throw new Error('a script never calls the Horse brain');
      },
      ...over,
    }) as LeagueSeatSpot;
  const c = (s: string): Card =>
    ({
      rank: s[0],
      suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s[1] as 'h'],
    }) as Card;

  it('the maniac wagers whenever a wager is on the menu, otherwise calls, never folds', () => {
    expect(flhManiacPolicy(spot({}))).toEqual({ action: 'bet', amount: 2 });
    expect(
      flhManiacPolicy(
        spot({
          toCall: 2,
          currentBet: 2,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 4,
          maxRaiseTo: 4,
        })
      )
    ).toEqual({ action: 'raise', amount: 4 });
    // Capped street: fold and call only.
    expect(
      flhManiacPolicy(
        spot({
          toCall: 2,
          currentBet: 8,
          legalActions: ['fold', 'call'],
          minRaiseTo: null,
          maxRaiseTo: null,
        })
      )
    ).toEqual({ action: 'call' });
  });

  it('the tight-value player bets only made hands its own cards improve, and never bluffs', () => {
    const board = ['Kh', '7d', '2c'].map(c);
    // Two pair with both hole cards: value.
    expect(flhTightValuePolicy(spot({ cards: ['Kd', '7s'].map(c), board }))).toEqual({
      action: 'bet',
      amount: 2,
    });
    // Top pair: checks when checked to (no bet below two pair), calls one bet.
    expect(flhTightValuePolicy(spot({ cards: ['Kd', 'Qs'].map(c), board }))).toEqual({
      action: 'check',
    });
    expect(
      flhTightValuePolicy(
        spot({
          cards: ['Kd', 'Qs'].map(c),
          board,
          toCall: 2,
          currentBet: 2,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 4,
          maxRaiseTo: 4,
          history: [
            {
              seat: 3,
              userId: 'x',
              action: 'bet',
              amount: 2,
              stage: 'flop',
              timestamp: 1,
            } as never,
          ],
        })
      )
    ).toEqual({ action: 'call' });
    // Air: checks, and folds to a bet.
    expect(flhTightValuePolicy(spot({ cards: ['9d', '8s'].map(c), board }))).toEqual({
      action: 'check',
    });
    expect(
      flhTightValuePolicy(
        spot({
          cards: ['9d', '8s'].map(c),
          board,
          toCall: 2,
          currentBet: 2,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 4,
          maxRaiseTo: 4,
        })
      )
    ).toEqual({ action: 'fold' });
    // A pair on the board alone is not the player's hand.
    expect(ownMadeClass(['9d', '8s'].map(c), ['Kh', 'Kd', '2c'].map(c))).toBe(1);
    expect(ownMadeClass(['Kc', '8s'].map(c), ['Kh', 'Kd', '2c'].map(c))).toBe(4);
  });

  it('the passive caller never folds after the flop, bets two pair or better, raises only a full house', () => {
    const board = ['Kh', '7d', '2c'].map(c);
    const facing = {
      toCall: 2,
      currentBet: 2,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 4,
      maxRaiseTo: 4,
    };
    // Air: checks when checked to, and calls a bet (it never folds after the flop).
    expect(flhPassiveCallerPolicy(spot({ cards: ['9d', '8s'].map(c), board }))).toEqual({
      action: 'check',
    });
    expect(flhPassiveCallerPolicy(spot({ cards: ['9d', '8s'].map(c), board, ...facing }))).toEqual({
      action: 'call',
    });
    // One pair checks; two pair bets; trips facing a bet only call.
    expect(flhPassiveCallerPolicy(spot({ cards: ['Kd', 'Qs'].map(c), board }))).toEqual({
      action: 'check',
    });
    expect(flhPassiveCallerPolicy(spot({ cards: ['Kd', '7s'].map(c), board }))).toEqual({
      action: 'bet',
      amount: 2,
    });
    expect(flhPassiveCallerPolicy(spot({ cards: ['Kd', 'Kc'].map(c), board, ...facing }))).toEqual({
      action: 'call',
    });
    // A full house raises, at the one legal wager; on a capped street it calls.
    const river = ['Kh', '7d', '2c', '7h', '3s'].map(c);
    expect(
      flhPassiveCallerPolicy(
        spot({ stage: 'river', cards: ['Kd', 'Kc'].map(c), board: river, ...facing })
      )
    ).toEqual({ action: 'raise', amount: 4 });
    expect(
      flhPassiveCallerPolicy(
        spot({
          stage: 'river',
          cards: ['Kd', 'Kc'].map(c),
          board: river,
          toCall: 2,
          currentBet: 8,
          legalActions: ['fold', 'call'],
          minRaiseTo: null,
          maxRaiseTo: null,
        })
      )
    ).toEqual({ action: 'call' });
    // Preflop: calls wide, never raises first in, folds the bottom.
    const pre = (cards: string[]) =>
      flhPassiveCallerPolicy(spot({ stage: 'preflop', cards: cards.map(c), ...facing }));
    expect(pre(['Ah', 'As'])).toEqual({ action: 'call' });
    expect(pre(['7h', '2s'])).toEqual({ action: 'fold' });
  });

  it('the over-folding blinds never wager, defend only the top of their range, and fold to every postflop bet', () => {
    const board = ['Kh', '7d', '2c'].map(c);
    const facing = {
      toCall: 2,
      currentBet: 2,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 4,
      maxRaiseTo: 4,
    };
    // Postflop: checks whatever it holds, folds whatever it holds.
    for (const cards of [
      ['9d', '8s'],
      ['Kd', 'Qs'],
      ['Kd', 'Kc'],
    ]) {
      expect(flhOverFoldingBlindsPolicy(spot({ cards: cards.map(c), board }))).toEqual({
        action: 'check',
      });
      expect(flhOverFoldingBlindsPolicy(spot({ cards: cards.map(c), board, ...facing }))).toEqual({
        action: 'fold',
      });
    }
    // Preflop first in: calls the tight-value opening share, never raises, folds the rest.
    const pre = (cards: string[], over: Partial<LeagueSeatSpot> = {}) =>
      flhOverFoldingBlindsPolicy(
        spot({ stage: 'preflop', cards: cards.map(c), ...facing, ...over })
      );
    expect(pre(['Ah', 'As'])).toEqual({ action: 'call' });
    expect(pre(['7h', '2s'])).toEqual({ action: 'fold' });
    // The big blind's option is a check, aces included.
    expect(pre(['Ah', 'As'], { toCall: 0, legalActions: ['check', 'raise', 'all_in'] })).toEqual({
      action: 'check',
    });
    // Facing one raise: aces call (never a re-raise), a middling hand folds.
    const raised = {
      history: [
        {
          seat: 3,
          userId: 'x',
          action: 'raise',
          amount: 4,
          stage: 'preflop',
          timestamp: 1,
        } as never,
      ],
    };
    expect(pre(['Ah', 'As'], raised)).toEqual({ action: 'call' });
    expect(pre(['Jh', '9s'], raised)).toEqual({ action: 'fold' });
  });

  it('the value-only blinds continue after the flop with two pair or better only, and raise it', () => {
    const board = ['Kh', '7d', '2c'].map(c);
    const facing = {
      toCall: 2,
      currentBet: 2,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 4,
      maxRaiseTo: 4,
    };
    const bet = { seat: 3, userId: 'x', action: 'bet', amount: 2, stage: 'flop', timestamp: 1 };
    // One pair (top pair, an overpair) folds to a wager and checks when checked to.
    for (const cards of [
      ['Kd', 'Qs'],
      ['Ad', 'As'],
      ['9d', '8s'],
    ]) {
      expect(flhValueOnlyBlindsPolicy(spot({ cards: cards.map(c), board }))).toEqual({
        action: 'check',
      });
      expect(
        flhValueOnlyBlindsPolicy(
          spot({ cards: cards.map(c), board, ...facing, history: [bet as never] })
        )
      ).toEqual({ action: 'fold' });
    }
    // Two pair bets when checked to and raises one wager.
    expect(flhValueOnlyBlindsPolicy(spot({ cards: ['Kd', '7s'].map(c), board }))).toEqual({
      action: 'bet',
      amount: 2,
    });
    expect(
      flhValueOnlyBlindsPolicy(
        spot({ cards: ['Kd', '7s'].map(c), board, ...facing, history: [bet as never] })
      )
    ).toEqual({ action: 'raise', amount: 4 });
    // Facing a bet and a raise, two pair calls and trips re-raises.
    const twoWagers = [bet, { ...bet, seat: 4, action: 'raise', amount: 4 }] as never[];
    expect(
      flhValueOnlyBlindsPolicy(
        spot({ cards: ['Kd', '7s'].map(c), board, ...facing, history: twoWagers })
      )
    ).toEqual({ action: 'call' });
    expect(
      flhValueOnlyBlindsPolicy(
        spot({ cards: ['7c', '7s'].map(c), board, ...facing, history: twoWagers })
      )
    ).toEqual({ action: 'raise', amount: 4 });
    // Preflop it is the tight-value raise or fold.
    expect(
      flhValueOnlyBlindsPolicy(spot({ stage: 'preflop', cards: ['Ah', 'As'].map(c), ...facing }))
    ).toEqual({ action: 'raise', amount: 4 });
    expect(
      flhValueOnlyBlindsPolicy(spot({ stage: 'preflop', cards: ['7h', '2s'].map(c), ...facing }))
    ).toEqual({ action: 'fold' });
  });

  it('the preflop-defending blinds call a single raise at the published defence width and fold to every postflop wager', () => {
    const facing = {
      toCall: 2,
      currentBet: 4,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 6,
      maxRaiseTo: 6,
    };
    const raised = [
      { seat: 5, userId: 'x', action: 'raise', amount: 4, stage: 'preflop', timestamp: 1 },
    ] as never[];
    const pre = (cards: string[], over: Partial<LeagueSeatSpot> = {}) =>
      flhPreflopDefendingBlindsPolicy(
        spot({ stage: 'preflop', cards: cards.map(c), ...facing, history: raised, ...over })
      );
    // A middling hand the over-folding blinds fold (below 0.82) is defended here (at 0.20 or better).
    expect(pre(['Jh', '9s'])).toEqual({ action: 'call' });
    expect(
      flhOverFoldingBlindsPolicy(
        spot({ stage: 'preflop', cards: ['Jh', '9s'].map(c), ...facing, history: raised })
      )
    ).toEqual({ action: 'fold' });
    // Aces call, never re-raise; the worst hand folds.
    expect(pre(['Ah', 'As'])).toEqual({ action: 'call' });
    expect(pre(['7h', '2s'])).toEqual({ action: 'fold' });
    // Postflop it checks or folds whatever it holds.
    const board = ['Kh', '7d', '2c'].map(c);
    for (const cards of [
      ['Kd', '7s'],
      ['Ad', 'As'],
    ]) {
      expect(flhPreflopDefendingBlindsPolicy(spot({ cards: cards.map(c), board }))).toEqual({
        action: 'check',
      });
      expect(
        flhPreflopDefendingBlindsPolicy(
          spot({
            cards: cards.map(c),
            board,
            toCall: 2,
            currentBet: 2,
            legalActions: ['fold', 'call', 'raise', 'all_in'],
            minRaiseTo: 4,
            maxRaiseTo: 4,
          })
        )
      ).toEqual({ action: 'fold' });
    }
  });

  it('the defending-postflop blinds defend preflop without raising, continue flop top pair+/overpair, and value-bet/raise two pair+ on every street', () => {
    const preFacing = {
      toCall: 2,
      currentBet: 4,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 6,
      maxRaiseTo: 6,
    };
    const raised = [
      { seat: 5, userId: 'x', action: 'raise', amount: 4, stage: 'preflop', timestamp: 1 },
    ] as never[];
    expect(
      flhDefendingPostflopBlindsPolicy(
        spot({ stage: 'preflop', cards: ['Jh', '9s'].map(c), ...preFacing, history: raised })
      )
    ).toEqual({ action: 'call' });
    expect(
      flhDefendingPostflopBlindsPolicy(
        spot({ stage: 'preflop', cards: ['Ah', 'As'].map(c), ...preFacing, history: raised })
      )
    ).toEqual({ action: 'call' });
    expect(
      flhDefendingPostflopBlindsPolicy(
        spot({ stage: 'preflop', cards: ['7h', '2s'].map(c), ...preFacing, history: raised })
      )
    ).toEqual({ action: 'fold' });

    const flopBoard = ['Kh', '7d', '2c'].map(c);
    const turnBoard = ['Kh', '7d', '2c', '4s'].map(c);
    expect(hasTopPairOrOverpair(['Kd', 'Qs'].map(c), flopBoard)).toBe(true);
    expect(hasTopPairOrOverpair(['Ad', 'As'].map(c), flopBoard)).toBe(true);
    expect(hasTopPairOrOverpair(['Qd', 'Qs'].map(c), flopBoard)).toBe(false);
    expect(hasTopPairOrOverpair(['7s', '9s'].map(c), flopBoard)).toBe(false);

    const postFacing = {
      toCall: 2,
      currentBet: 2,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 4,
      maxRaiseTo: 4,
    };
    const flopBet = [
      { seat: 3, userId: 'x', action: 'bet', amount: 2, stage: 'flop', timestamp: 1 },
    ] as never[];
    const flopTwoWagers = [
      flopBet[0],
      { seat: 4, userId: 'y', action: 'raise', amount: 4, stage: 'flop', timestamp: 2 },
    ] as never[];
    const turnBet = [
      { seat: 3, userId: 'x', action: 'bet', amount: 4, stage: 'turn', timestamp: 3 },
    ] as never[];

    // Flop top pair & overpair bet when checked to, call one flop wager, fold to two flop wagers,
    // and fold unimproved on turn/river big-bet wagers.
    for (const cards of [
      ['Kd', 'Qs'],
      ['Ad', 'As'],
    ]) {
      expect(
        flhDefendingPostflopBlindsPolicy(
          spot({ stage: 'flop', cards: cards.map(c), board: flopBoard })
        )
      ).toEqual({ action: 'bet', amount: 2 });
      expect(
        flhDefendingPostflopBlindsPolicy(
          spot({
            stage: 'flop',
            cards: cards.map(c),
            board: flopBoard,
            ...postFacing,
            history: flopBet,
          })
        )
      ).toEqual({ action: 'call' });
      expect(
        flhDefendingPostflopBlindsPolicy(
          spot({
            stage: 'flop',
            cards: cards.map(c),
            board: flopBoard,
            ...postFacing,
            history: flopTwoWagers,
          })
        )
      ).toEqual({ action: 'fold' });
      expect(
        flhDefendingPostflopBlindsPolicy(
          spot({
            stage: 'turn',
            cards: cards.map(c),
            board: turnBoard,
            ...postFacing,
            history: turnBet,
          })
        )
      ).toEqual({ action: 'fold' });
    }

    // Middle pair, underpair, and air check/fold on the flop.
    for (const cards of [
      ['7s', '9s'],
      ['Qd', 'Qs'],
      ['9d', '8s'],
    ]) {
      expect(
        flhDefendingPostflopBlindsPolicy(
          spot({ stage: 'flop', cards: cards.map(c), board: flopBoard })
        )
      ).toEqual({ action: 'check' });
      expect(
        flhDefendingPostflopBlindsPolicy(
          spot({
            stage: 'flop',
            cards: cards.map(c),
            board: flopBoard,
            ...postFacing,
            history: flopBet,
          })
        )
      ).toEqual({ action: 'fold' });
    }

    // Two pair+ bets and raises on flop and turn; trips re-raises two wagers.
    expect(
      flhDefendingPostflopBlindsPolicy(
        spot({
          stage: 'turn',
          cards: ['Kd', '7s'].map(c),
          board: turnBoard,
          ...postFacing,
          history: turnBet,
        })
      )
    ).toEqual({ action: 'raise', amount: 4 });
    expect(
      flhDefendingPostflopBlindsPolicy(
        spot({
          stage: 'flop',
          cards: ['7c', '7s'].map(c),
          board: flopBoard,
          ...postFacing,
          history: flopTwoWagers,
        })
      )
    ).toEqual({ action: 'raise', amount: 4 });
  });

  it('the tight-value player raises or folds first in: it never limps', () => {
    const pre = (cards: string[]) =>
      flhTightValuePolicy(
        spot({
          stage: 'preflop',
          cards: cards.map(c),
          toCall: 2,
          currentBet: 2,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 4,
          maxRaiseTo: 4,
        })
      );
    expect(pre(['Ah', 'As'])).toEqual({ action: 'raise', amount: 4 });
    expect(pre(['7h', '2s'])).toEqual({ action: 'fold' });
  });
});

describe('the field is deterministic from the deal seed', () => {
  it.each(FIXED_LIMIT_SCRIPTED_PERSONAS)(
    '%s: the same deal replays the same hand, and the same card run gives the same result',
    async (persona) => {
      const a = fieldHand(persona, 424242, 3, 6);
      vi.restoreAllMocks();
      const b = fieldHand(persona, 424242, 3, 6);
      expect(b.actions).toEqual(a.actions);
      expect(b.net).toEqual(a.net);
      // flh_value_only_blinds_v1 has no kept card (almost inert, 2026-11-21): the steal card's shape seats it.
      const card = FIXED_LIMIT_SCRIPTED_FIELD_CARDS.find((m) => m.humanPersona === persona) ?? {
        ...FIXED_LIMIT_SCRIPTED_FIELD_CARDS.find(
          (m) => m.humanPersona === FLH_OVER_FOLDING_BLINDS_PERSONA
        )!,
        name: `flh_steal_vs_tight_blinds_vs_${persona}`,
        humanPersona: persona,
      };
      vi.restoreAllMocks();
      const r1 = await runMatchup(card, 20, 99);
      const r2 = await runMatchup(card, 20, 99);
      const timeless = (r: typeof r1) =>
        JSON.parse(JSON.stringify(r, (k, v) => (k === 'durationMs' ? 0 : v)));
      expect(timeless(r2)).toEqual(timeless(r1));
    },
    300_000
  );
});

describe('what the scripted field may be seated with', () => {
  it('a fixed-limit hand admits the scripted field and no other field', () => {
    const ok = { gameVariant: 'flh', stackBB: 100, gameMode: 'cash' as const, ante: 0 };
    expect(
      leagueFixedLimitRefusal({
        ...ok,
        humanField: true,
        fieldPopulation: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
      })
    ).toBeNull();
    expect(
      leagueFixedLimitRefusal({
        ...ok,
        humanField: true,
        fieldPopulation: HUMAN_CALIBRATED_POPULATION_ID,
      })
    ).toMatch(/Horses only/);
    expect(leagueFixedLimitRefusal({ ...ok, humanField: true })).toMatch(/Horses only/);
    // Its own limits still apply.
    expect(
      leagueFixedLimitRefusal({
        ...ok,
        stackBB: 24,
        humanField: true,
        fieldPopulation: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
      })
    ).toMatch(/above 24 big blinds/);
  });

  it('a fixed-limit field seat without a script is refused, and the field deals no other variant', () => {
    const bare: LeagueHumanField = {
      population: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
      isHuman: (s) => s !== HERO,
    };
    expect(() =>
      playHand(
        7,
        1,
        () => ({}),
        undefined,
        undefined,
        'flh',
        6,
        STACK_BB,
        undefined,
        undefined,
        bare
      )
    ).toThrow(/scripted seat policy/);
    expect(() =>
      playHand(
        7,
        1,
        () => ({}),
        undefined,
        undefined,
        'nlh',
        6,
        STACK_BB,
        undefined,
        undefined,
        bare
      )
    ).toThrow(/scripted seat policy/);
  });

  it('a scripted card needs a scripted persona, and a scripted persona is no calibrated profile', async () => {
    await expect(
      runMatchup(
        {
          name: 'x',
          variant: 'flh',
          seats: 6,
          opponentPopulation: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
          a: {},
          b: {},
        },
        1,
        1
      )
    ).rejects.toThrow(/scripted personas/);
    expect(() =>
      humanFieldPersonaProfile(FLH_MANIAC_PERSONA, {
        population: HUMAN_CALIBRATED_POPULATION_ID,
        variant: 'nlh',
        seats: 6,
      })
    ).toThrow(/scripted persona/);
  });
});

describe('the scripted fixed-limit field cards', () => {
  it('are on the card, in the domain, and not refused', () => {
    expect(FIXED_LIMIT_SCRIPTED_FIELD_CARDS.length).toBeGreaterThan(0);
    const names = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    for (const m of FIXED_LIMIT_SCRIPTED_FIELD_CARDS) {
      expect(names.has(m.name), m.name).toBe(true);
      expect(
        UNMEASURABLE_MATCHUPS.some((u) => u.name === m.name),
        m.name
      ).toBe(false);
      expect(m.variant).toBe('flh');
      expect(m.opponentPopulation).toBe(FIXED_LIMIT_SCRIPTED_POPULATION_ID);
      expect(FIXED_LIMIT_SCRIPTED_PERSONAS).toContain(m.humanPersona);
      expect(
        leagueFixedLimitRefusal({
          gameVariant: 'flh',
          stackBB: m.stackBB ?? 100,
          gameMode: 'cash',
          ante: 0,
          humanField: true,
          fieldPopulation: m.opponentPopulation,
        })
      ).toBeNull();
    }
    // Every value card against the maniac has its tight-value harm control.
    for (const m of FIXED_LIMIT_SCRIPTED_FIELD_CARDS.filter(
      (x) => x.humanPersona === FLH_MANIAC_PERSONA
    )) {
      expect(
        FIXED_LIMIT_SCRIPTED_FIELD_CARDS.some(
          (x) =>
            x.humanPersona === FLH_TIGHT_VALUE_PERSONA &&
            JSON.stringify(x.a) === JSON.stringify(m.a) &&
            x.seats === m.seats
        ),
        m.name
      ).toBe(true);
    }
  });

  it.each(
    FIXED_LIMIT_SCRIPTED_FIELD_CARDS.filter((m) => m.humanPersona === FLH_MANIAC_PERSONA).map(
      (m) => m.name
    )
  )(
    '%s: its arms do not play identical poker, every action is legal, and the worker accepts the result',
    async (name) => {
      const card = LEAGUE_MATCHUPS.find((m) => m.name === name)!;
      // Fixed seed and size: deterministic for a strategy build. Rare is a
      // measurement; zero is not (LeagueMatchupIsNotInert.test.ts).
      const r = await runMatchup(card, 150, 20261120);
      expect(r.illegalActions).toBe(0);
      expect(r.truncatedStreets).toBe(0);
      expect(r.brainExceptionFallbacks).toBe(0);
      expect(r.divergentPairs).toBeGreaterThan(0);
      expect(r.inert).toBe(false);
      expect(r.opponentPopulation).toBe(FIXED_LIMIT_SCRIPTED_POPULATION_ID);
      expect(Object.keys(r.humanResponses ?? {}).length).toBeGreaterThan(0);
      expect(
        horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })
      ).toBe(true);
    },
    300_000
  );
});

describe('the steal harm control card (2026-11-21)', () => {
  it('the preflop-defending blinds card diverges, with every action legal, and the value-only blinds are not on the card', async () => {
    const card = LEAGUE_MATCHUPS.find(
      (m) => m.name === 'flh_steal_vs_tight_blinds_vs_preflop_defending_blinds'
    )!;
    expect(card.humanPersona).toBe(FLH_PREFLOP_DEFENDING_BLINDS_PERSONA);
    expect(card.a).toEqual({ fixedLimitStealVsTightBlinds: true });
    expect(card.seats).toBe(6);
    // The steal ALONE against the value-only blinds is not on the card (2 of 20,000 pairs diverged). Since
    // 2026-11-21 they seat one card whose arms both carry the steal and differ only by the noise-aware style-shift
    // release (flh_style_release_noise_aware_steal_vs_value_only_blinds).
    expect(
      FIXED_LIMIT_SCRIPTED_FIELD_CARDS.filter(
        (m) => m.humanPersona === FLH_VALUE_ONLY_BLINDS_PERSONA
      ).map((m) => [m.name, m.b])
    ).toEqual([
      [
        'flh_style_release_noise_aware_steal_vs_value_only_blinds',
        { fixedLimitStealVsTightBlinds: true },
      ],
    ]);
    // Fixed seed and size: deterministic for a strategy build (measured 2026-11-21: 29 of 900).
    const r = await runMatchup(card, 900, 20261120);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
    expect(r.brainExceptionFallbacks).toBe(0);
    expect(r.divergentPairs).toBeGreaterThan(0);
    expect(r.inert).toBe(false);
    for (const [node, counts] of Object.entries(r.humanResponses ?? {})) {
      expect(counts.bet ?? 0, node).toBe(0);
      expect(counts.raise ?? 0, node).toBe(0);
    }
  }, 300_000);

  it('the defending-postflop blinds card diverges with postflop continuation and zero preflop wagers', async () => {
    const card = LEAGUE_MATCHUPS.find(
      (m) => m.name === 'flh_steal_vs_tight_blinds_vs_defending_postflop_blinds'
    )!;
    expect(card.humanPersona).toBe(FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA);
    expect(card.a).toEqual({ fixedLimitStealVsTightBlinds: true });
    expect(card.seats).toBe(6);
    // Fixed seed and size: deterministic for a strategy build (measured 2026-11-21: 20 of 2,000).
    const r = await runMatchup(card, 1200, 20261120);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
    expect(r.brainExceptionFallbacks).toBe(0);
    expect(r.divergentPairs).toBeGreaterThan(0);
    expect(r.inert).toBe(false);
    const responses = r.humanResponses ?? {};
    // Preflop never raises; postflop continues (calls/bets/raises) with top pair+ / two pair+.
    expect(responses['preflop/facing_bet']?.raise ?? 0).toBe(0);
    expect(responses['preflop/checked_to']?.raise ?? 0).toBe(0);
    expect(responses['flop/facing_bet']?.call ?? 0).toBeGreaterThan(0);
    expect(responses['flop/checked_to']?.bet ?? 0).toBeGreaterThan(0);
    expect(horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })).toBe(
      true
    );
  }, 300_000);
});

describe('the passive caller and the over-folding blinds cards (2026-11-21)', () => {
  const cardNamed = (name: string) => LEAGUE_MATCHUPS.find((m) => m.name === name)!;

  it('the steal card diverges once the over-folder reads fill, with every action legal', async () => {
    const card = cardNamed('flh_steal_vs_tight_blinds_vs_over_folding_blinds');
    expect(card.humanPersona).toBe(FLH_OVER_FOLDING_BLINDS_PERSONA);
    expect(card.a).toEqual({ fixedLimitStealVsTightBlinds: true });
    expect(card.seats).toBe(6);
    // The option needs 15 decayed postflop fold opportunities on every player
    // behind (FIXED_LIMIT_STEAL_MIN_OPPS), which the hero's memory reaches
    // inside the card. Measured 2026-11-21 at seed 20261120: 4 divergent pairs
    // in 500, 19 in 900. Fixed seed and size: deterministic for a strategy build.
    const r = await runMatchup(card, 900, 20261120);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
    expect(r.brainExceptionFallbacks).toBe(0);
    expect(r.divergentPairs).toBeGreaterThan(0);
    expect(r.inert).toBe(false);
    // The script never wagers and folds to every postflop bet.
    const responses = r.humanResponses ?? {};
    for (const [node, counts] of Object.entries(responses)) {
      expect(counts.bet ?? 0, node).toBe(0);
      expect(counts.raise ?? 0, node).toBe(0);
      if (node !== 'preflop/facing_bet' && node.endsWith('/facing_bet'))
        expect(Object.keys(counts), node).toEqual(['fold']);
    }
    expect(horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })).toBe(
      true
    );
  }, 300_000);

  it('the passive-caller value-raise card plays legal hands the worker accepts, and the caller never folds after the flop', async () => {
    const card = cardNamed('flh_river_one_bet_value_raise_vs_passive_caller');
    expect(card.humanPersona).toBe(FLH_PASSIVE_CALLER_PERSONA);
    expect(card.a).toEqual({ fixedLimitRiverOneBetValueRaise: true });
    expect(card.seats).toBe(2);
    // No divergence is pinned at this size: the option changed 60 of 45,000
    // pairs at each of seeds 20261120 and 20261121 (docs/horse-league-fixed-limit.md).
    const r = await runMatchup(card, 150, 20261120);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
    expect(r.brainExceptionFallbacks).toBe(0);
    const responses = r.humanResponses ?? {};
    expect(Object.keys(responses).length).toBeGreaterThan(0);
    for (const [node, counts] of Object.entries(responses))
      if (!node.startsWith('preflop/')) expect(counts.fold ?? 0, node).toBe(0);
    expect(horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })).toBe(
      true
    );
  }, 300_000);

  it('no passive-caller card is kept for the river lead: its refusal records what was measured', () => {
    expect(LEAGUE_MATCHUPS.some((m) => m.a.fixedLimitRiverStrongHandLeads === true)).toBe(false);
    const refusal = UNMEASURABLE_MATCHUPS.find((u) => u.name === 'flh_river_strong_hand_leads')!;
    expect(refusal.reason).toContain(FLH_PASSIVE_CALLER_PERSONA);
    expect(refusal.reason).toContain('1 of 20,000 pairs');
  });
});

describe('the no-limit probe history (LeagueMatchup.probeHistoryHands)', () => {
  it('leaves every field seat with a non-zero pooled probe share before the fixed-limit hands', () => {
    const sb = HorseMind.createSandbox();
    leagueProbeHistoryWarmup(sb, 60, 20261120, 6, STACK_BB, () => ({}));
    for (let s = 2; s <= 6; s++) {
      const st = HorseMind.runInSandbox(sb, () => HorseMind.getStats(`league-human-${s}`));
      expect(st, `seat ${s}`).toBeDefined();
      expect(st!.ctBets ?? 0, `seat ${s}`).toBeGreaterThan(0);
      expect(st!.ctProbes ?? 0, `seat ${s}`).toBeGreaterThan(0);
    }
    // A fresh sandbox, the state every card started from before, holds none.
    const empty = HorseMind.createSandbox();
    expect(
      HorseMind.runInSandbox(empty, () => HorseMind.getStats('league-human-2'))
    ).toBeUndefined();
  });

  it('is refused anywhere but a scripted fixed-limit card with learning on', async () => {
    const base = {
      name: 'x',
      variant: 'flh',
      seats: 6,
      opponentPopulation: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
      humanPersona: FLH_MANIAC_PERSONA,
      a: {},
      b: {},
    } as const;
    await expect(
      runMatchup({ ...base, probeHistoryHands: 10, memoryLearning: 'off' }, 1, 1)
    ).rejects.toThrow(/probeHistoryHands/);
    await expect(runMatchup({ ...base, probeHistoryHands: -1 }, 1, 1)).rejects.toThrow(
      /probeHistoryHands/
    );
    await expect(
      runMatchup(
        {
          name: 'y',
          variant: 'nlh',
          seats: 6,
          opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
          a: {},
          b: {},
          probeHistoryHands: 10,
        },
        1,
        1
      )
    ).rejects.toThrow(/probeHistoryHands/);
    // The scripted field deals flh cards only; nlh is its warm-up variant.
    await expect(runMatchup({ ...base, variant: 'nlh' }, 1, 1)).rejects.toThrow(/deals flh/);
  });
});

describe('the noise-aware style-shift release card (2026-11-21)', () => {
  it('measures the release under the steal against the value-only blinds, with every action legal', async () => {
    const card = LEAGUE_MATCHUPS.find(
      (m) => m.name === 'flh_style_release_noise_aware_steal_vs_value_only_blinds'
    )!;
    expect(card.humanPersona).toBe(FLH_VALUE_ONLY_BLINDS_PERSONA);
    expect(card.a).toEqual({
      fixedLimitStealVsTightBlinds: true,
      styleShiftReleaseIsNoiseAware: true,
    });
    expect(card.b).toEqual({ fixedLimitStealVsTightBlinds: true });
    // Fixed seed and size (measured 2026-11-21: 22 of 3,000 at seed 20261120).
    const r = await runMatchup(card, 3000, 20261120);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
    expect(r.brainExceptionFallbacks).toBe(0);
    expect(r.divergentPairs).toBeGreaterThan(0);
  }, 300_000);
});
