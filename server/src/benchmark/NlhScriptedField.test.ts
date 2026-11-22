/**
 * THE SCRIPTED NO-LIMIT FIELD (2026-11-21, NlhScriptedField.ts).
 *
 * Proves:
 *  1. Each script plays the line its doc states, on hand-built spots.
 *  2. Each script answers only with an action on the menu it is offered, at a
 *     size inside the legal range, consumes no randomness and never calls the
 *     Horse brain; the league applies its answer unchanged and chips are
 *     conserved.
 *  3. The field is deterministic from the deal seed.
 *  4. What the field may and may not be seated with is refused out loud.
 *  5. The four cards are on the card, each value card beside its harm
 *     control, and the two value cards are not inert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, HandStage } from '../types.js';
import {
  LEAGUE_MATCHUPS,
  NLH_SCRIPTED_FIELD_CARDS,
  NLH_SCRIPTED_OPEN_JAMMER_CARDS,
  UNMEASURABLE_MATCHUPS,
  humanFieldPersonaProfile,
  playHand,
  runMatchup,
  type LeagueHandObserver,
  type LeagueHumanField,
  type LeagueSeatSpot,
} from './HorseLeague.js';
import {
  NLH_SCRIPTED_COMMITTED_STACK_BB,
  NLH_SCRIPTED_PREFLOP,
  NLH_TIGHT_JAMMER_PREFLOP,
  nlhDangerBoard,
  nlhDangerBoardBettorPolicy,
  nlhDangerBoardValuePolicy,
  nlhNashOpenJammerPolicy,
  nlhPotBarrelerPolicy,
  nlhScriptedPolicy,
  nlhTightJammerPolicy,
  nlhValueBarrelerPolicy,
  preflopSeatsBehind,
} from './NlhScriptedField.js';
import {
  NLH_DANGER_BOARD_BETTOR_PERSONA,
  NLH_DANGER_BOARD_VALUE_PERSONA,
  NLH_NASH_OPEN_JAMMER_PERSONA,
  NLH_POT_BARRELER_PERSONA,
  NLH_SCRIPTED_PERSONAS,
  NLH_SCRIPTED_POPULATION_ID,
  NLH_TIGHT_JAMMER_PERSONA,
  NLH_VALUE_BARRELER_PERSONA,
  type NlhScriptedPersona,
} from './HorseLeagueHumanField.js';
import {
  disarmBrainTelemetryForTest,
  drainFires,
  enableBrainTelemetry,
} from '../engine/BrainTelemetry.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';
import { horseLeagueComputeResponseIsValid } from './HorseLeagueComputeWorkerClient.js';

const BB = 2;
const HERO = 0;

const card = (code: string): Card =>
  ({
    rank: code[0],
    suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[code[1] as 'h'],
  }) as Card;
const cards = (...codes: string[]): Card[] => codes.map(card);

/** A heads-up spot with a no-limit menu like seatPolicyDecision builds. */
function spot(o: {
  stage: HandStage;
  hole: string[];
  board?: string[];
  pot: number;
  toCall?: number;
  currentBet?: number;
  myBet?: number;
  stack?: number;
  history?: LeagueSeatSpot['history'];
}): LeagueSeatSpot {
  const toCall = o.toCall ?? 0;
  const currentBet = o.currentBet ?? toCall;
  const myBet = o.myBet ?? 0;
  const stack = o.stack ?? 100 * BB;
  const legalActions: string[] = [toCall > 0 ? 'fold' : 'check'];
  if (toCall > 0 && stack > toCall) legalActions.push('call');
  const maxTo = myBet + stack;
  const minTo = currentBet > 0 ? currentBet + Math.max(BB, toCall) : BB;
  const canWager = maxTo > currentBet && maxTo >= minTo;
  if (canWager) legalActions.push(currentBet > 0 ? 'raise' : 'bet');
  if (stack > 0) legalActions.push('all_in');
  return {
    variant: 'nlh',
    isPotLimit: false,
    stage: o.stage,
    seatIdx: 1,
    numSeats: 2,
    dealerSeat: 1,
    bigBlind: BB,
    cards: cards(...o.hole),
    board: cards(...(o.board ?? [])),
    pot: o.pot,
    toCall,
    currentBet,
    myBet,
    stack,
    liveCount: 2,
    legalActions,
    minRaiseTo: canWager ? minTo : null,
    maxRaiseTo: canWager ? maxTo : null,
    history: o.history ?? [],
    userId: 'league-human-2',
    horseDecide: () => {
      throw new Error('a script never calls the Horse brain');
    },
  };
}

const wager = (stage: HandStage, action = 'bet') =>
  ({ seat: 1, userId: 'league-1', action, amount: 10, timestamp: 0, stage }) as never;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('each script plays its stated line', () => {
  it('preflop: opens 2.5bb at the 80% bar, folds below it, defends a raise at the 60% bar', () => {
    for (const pol of [nlhPotBarrelerPolicy, nlhDangerBoardBettorPolicy]) {
      const open = pol(
        spot({ stage: 'preflop', hole: ['As', 'Kd'], pot: 3, toCall: 1, currentBet: 2, myBet: 1 })
      );
      expect(open).toEqual({ action: 'raise', amount: NLH_SCRIPTED_PREFLOP.openToBb * BB });
      expect(
        pol(
          spot({ stage: 'preflop', hole: ['7h', '2c'], pot: 3, toCall: 1, currentBet: 2, myBet: 1 })
        )
      ).toEqual({ action: 'fold' });
      const facing = (hole: string[]) =>
        pol(
          spot({
            stage: 'preflop',
            hole,
            pot: 7,
            toCall: 3,
            currentBet: 5,
            myBet: 2,
            history: [wager('preflop', 'raise')],
          })
        );
      expect(facing(['As', 'Kd'])).toEqual({ action: 'call' });
      expect(facing(['7h', '2c'])).toEqual({ action: 'fold' });
    }
  });

  it('the pot barreler bets the pot with any two cards on every street, and folds no pair to a raise', () => {
    for (const stage of ['flop', 'turn', 'river'] as const) {
      const board = ['Kh', '8d', '3c', '2s', '9h'].slice(
        0,
        stage === 'flop' ? 3 : stage === 'turn' ? 4 : 5
      );
      expect(nlhPotBarrelerPolicy(spot({ stage, hole: ['7c', '4d'], board, pot: 20 }))).toEqual({
        action: 'bet',
        amount: 20,
      });
    }
    // A raise over its bet: one pair continues, no pair folds.
    const raised = (hole: string[]) =>
      nlhPotBarrelerPolicy(
        spot({
          stage: 'turn',
          hole,
          board: ['Kh', '8d', '3c', '2s'],
          pot: 80,
          toCall: 40,
          currentBet: 60,
          myBet: 20,
          history: [wager('turn'), wager('turn', 'raise')],
        })
      );
    expect(raised(['7c', '4d'])).toEqual({ action: 'fold' });
    expect(raised(['8c', '4d'])).toEqual({ action: 'call' });
    // Facing a Horse's lead: floats the flop with anything, folds no pair on the turn.
    expect(
      nlhPotBarrelerPolicy(
        spot({
          stage: 'flop',
          hole: ['7c', '4d'],
          board: ['Kh', '8d', '3c'],
          pot: 20,
          toCall: 10,
          history: [wager('flop')],
        })
      )
    ).toEqual({ action: 'call' });
    expect(
      nlhPotBarrelerPolicy(
        spot({
          stage: 'turn',
          hole: ['7c', '4d'],
          board: ['Kh', '8d', '3c', '2s'],
          pot: 20,
          toCall: 10,
          history: [wager('turn')],
        })
      )
    ).toEqual({ action: 'fold' });
    // Once the pot covers its stack, the bet is the whole stack.
    expect(
      nlhPotBarrelerPolicy(
        spot({
          stage: 'turn',
          hole: ['7c', '4d'],
          board: ['Kh', '8d', '3c', '2s'],
          pot: 60,
          stack: 40,
        })
      )
    ).toEqual({ action: 'all_in' });
  });

  it('the value barreler bets only two pair or better and never bluffs', () => {
    const board = ['Kh', '8d', '3c', '2s'];
    expect(
      nlhValueBarrelerPolicy(spot({ stage: 'turn', hole: ['7c', '4d'], board, pot: 20 }))
    ).toEqual({
      action: 'check',
    });
    expect(
      nlhValueBarrelerPolicy(spot({ stage: 'turn', hole: ['Kc', '4d'], board, pot: 20 }))
    ).toEqual({
      action: 'check',
    });
    expect(
      nlhValueBarrelerPolicy(spot({ stage: 'turn', hole: ['Kc', '8h'], board, pot: 20 }))
    ).toEqual({
      action: 'bet',
      amount: 20,
    });
    const raised = (hole: string[]) =>
      nlhValueBarrelerPolicy(
        spot({
          stage: 'turn',
          hole,
          board,
          pot: 80,
          toCall: 40,
          currentBet: 60,
          myBet: 20,
          history: [wager('turn'), wager('turn', 'raise')],
        })
      );
    expect(raised(['Kc', '4d'])).toEqual({ action: 'fold' });
    expect(raised(['Kc', '8h'])).toEqual({ action: 'call' });
  });

  it('the danger-board bettor bets half the pot with value and with no pair on a four-flush or four-straight board only', () => {
    const fourFlush = ['Kh', '8h', '3h', '2h'];
    const fourStraight = ['5c', '6d', '7h', 'Ks', '8c'];
    const plain = ['Kh', '8d', '3c', '2s'];
    expect(nlhDangerBoard(cards(...fourFlush))).toBe(true);
    expect(nlhDangerBoard(cards(...fourStraight))).toBe(true);
    expect(nlhDangerBoard(cards(...plain))).toBe(false);
    const half = { action: 'bet', amount: 10 };
    // Value (a flush, a straight) and bluff (no pair) both bet; one pair checks.
    expect(
      nlhDangerBoardBettorPolicy(
        spot({ stage: 'turn', hole: ['Ah', '4c'], board: fourFlush, pot: 20 })
      )
    ).toEqual(half);
    expect(
      nlhDangerBoardBettorPolicy(
        spot({ stage: 'turn', hole: ['Qc', '4d'], board: fourFlush, pot: 20 })
      )
    ).toEqual(half);
    expect(
      nlhDangerBoardBettorPolicy(
        spot({ stage: 'turn', hole: ['Kc', '4d'], board: fourFlush, pot: 20 })
      )
    ).toEqual({
      action: 'check',
    });
    expect(
      nlhDangerBoardBettorPolicy(
        spot({ stage: 'river', hole: ['9d', '2s'], board: fourStraight, pot: 20 })
      )
    ).toEqual(half);
    expect(
      nlhDangerBoardBettorPolicy(spot({ stage: 'turn', hole: ['Qc', '4d'], board: plain, pot: 20 }))
    ).toEqual({
      action: 'check',
    });
    // The value-only control bets the flush and checks the bluff.
    expect(
      nlhDangerBoardValuePolicy(
        spot({ stage: 'turn', hole: ['Ah', '4c'], board: fourFlush, pot: 20 })
      )
    ).toEqual(half);
    expect(
      nlhDangerBoardValuePolicy(
        spot({ stage: 'turn', hole: ['Qc', '4d'], board: fourFlush, pot: 20 })
      )
    ).toEqual({
      action: 'check',
    });
    // Never folds before the river; folds no pair to a river bet.
    for (const pol of [nlhDangerBoardBettorPolicy, nlhDangerBoardValuePolicy]) {
      expect(
        pol(
          spot({
            stage: 'turn',
            hole: ['Qc', '4d'],
            board: plain,
            pot: 20,
            toCall: 10,
            history: [wager('turn')],
          })
        )
      ).toEqual({ action: 'call' });
      expect(
        pol(
          spot({
            stage: 'river',
            hole: ['Qc', '4d'],
            board: [...plain, '9s'],
            pot: 20,
            toCall: 10,
            history: [wager('river')],
          })
        )
      ).toEqual({ action: 'fold' });
    }
  });

  it('maps every persona to its script and refuses an unknown one', () => {
    expect(nlhScriptedPolicy(NLH_POT_BARRELER_PERSONA)).toBe(nlhPotBarrelerPolicy);
    expect(nlhScriptedPolicy(NLH_VALUE_BARRELER_PERSONA)).toBe(nlhValueBarrelerPolicy);
    expect(nlhScriptedPolicy(NLH_DANGER_BOARD_BETTOR_PERSONA)).toBe(nlhDangerBoardBettorPolicy);
    expect(nlhScriptedPolicy(NLH_DANGER_BOARD_VALUE_PERSONA)).toBe(nlhDangerBoardValuePolicy);
    expect(nlhScriptedPolicy(NLH_NASH_OPEN_JAMMER_PERSONA)).toBe(nlhNashOpenJammerPolicy);
    expect(nlhScriptedPolicy(NLH_TIGHT_JAMMER_PERSONA)).toBe(nlhTightJammerPolicy);
    expect(() => nlhScriptedPolicy('x' as NlhScriptedPersona)).toThrow(
      /Unknown scripted no-limit persona/
    );
  });

  it('preflopSeatsBehind matches the table blind assignment at 2 and 6 seats', () => {
    // 2 seats, dealerSeat=1 -> seat 0 is SB (1 behind), seat 1 is BB (0 behind).
    expect(preflopSeatsBehind(0, 1, 2)).toBe(1);
    expect(preflopSeatsBehind(1, 1, 2)).toBe(0);
    // 6 seats, dealerSeat=1 -> seat 0 BTN (2), 1 SB (1), 2 BB (0), 3 UTG (5), 4 HJ (4), 5 CO (3).
    expect(preflopSeatsBehind(3, 1, 6)).toBe(5);
    expect(preflopSeatsBehind(4, 1, 6)).toBe(4);
    expect(preflopSeatsBehind(5, 1, 6)).toBe(3);
    expect(preflopSeatsBehind(0, 1, 6)).toBe(2);
    expect(preflopSeatsBehind(1, 1, 6)).toBe(1);
    expect(preflopSeatsBehind(2, 1, 6)).toBe(0);
  });

  it('the Nash open-jammer jams <=20bb by position and dead ante, and calls lone open-jams from the Nash table', () => {
    const sixMaxSpot = (
      seatIdx: number,
      hole: string[],
      stackBB: number,
      anteBB: number,
      history: LeagueSeatSpot['history'] = []
    ): LeagueSeatSpot => ({
      ...spot({
        stage: 'preflop',
        hole,
        pot: 3 + anteBB * BB,
        toCall: seatIdx === 1 ? 1 : 2,
        currentBet: 2,
        myBet: seatIdx === 1 ? 1 : 0,
        stack: stackBB * BB - (seatIdx === 1 ? 1 : 0),
        history,
      }),
      seatIdx,
      numSeats: 6,
      dealerSeat: 1,
      liveCount: 6,
    });
    // A2o at 12bb: folds UTG (5 behind, cash) but jams BTN (2 behind, BBA) and SB (1 behind).
    expect(nlhNashOpenJammerPolicy(sixMaxSpot(3, ['As', '2d'], 12, 0))).toEqual({ action: 'fold' });
    expect(nlhNashOpenJammerPolicy(sixMaxSpot(0, ['As', '2d'], 12, 1))).toEqual({
      action: 'all_in',
    });
    expect(nlhNashOpenJammerPolicy(sixMaxSpot(1, ['As', '2d'], 12, 0))).toEqual({
      action: 'all_in',
    });
    // Trash (72o) folds from BTN at 12bb; AA jams from UTG at 15bb.
    expect(nlhNashOpenJammerPolicy(sixMaxSpot(0, ['7h', '2c'], 12, 1))).toEqual({ action: 'fold' });
    expect(nlhNashOpenJammerPolicy(sixMaxSpot(3, ['Ah', 'As'], 15, 0))).toEqual({
      action: 'all_in',
    });
    // Facing a lone BTN all-in at 12bb BBA, BB calls AJs (all_in for whole stack) and folds 72o.
    const btnJamHistory = [
      { seat: 1, userId: 'league-1', action: 'all_in', amount: 24, timestamp: 1, stage: 'preflop' },
    ] as unknown as LeagueSeatSpot['history'];
    const bbFacingJam = (hole: string[]): LeagueSeatSpot => ({
      ...spot({
        stage: 'preflop',
        hole,
        pot: 5 + 24,
        toCall: 22,
        currentBet: 24,
        myBet: 2,
        stack: 20,
        history: btnJamHistory,
      }),
      seatIdx: 2,
      numSeats: 6,
      dealerSeat: 1,
      liveCount: 2,
    });
    expect(nlhNashOpenJammerPolicy(bbFacingJam(['As', 'Js']))).toEqual({ action: 'all_in' });
    expect(nlhNashOpenJammerPolicy(bbFacingJam(['7h', '2c']))).toEqual({ action: 'fold' });
  });

  it('the tight jammer harm control open-jams only the top ~9% hands at <=20bb and folds the rest', () => {
    expect(NLH_TIGHT_JAMMER_PREFLOP.openJamAt).toBe(0.91);
    const btnSpot = (hole: string[]): LeagueSeatSpot => ({
      ...spot({
        stage: 'preflop',
        hole,
        pot: 5,
        toCall: 2,
        currentBet: 2,
        myBet: 0,
        stack: 15 * BB,
      }),
      seatIdx: 0,
      numSeats: 6,
      dealerSeat: 1,
      liveCount: 6,
    });
    expect(nlhTightJammerPolicy(btnSpot(['As', 'Kd']))).toEqual({ action: 'all_in' });
    expect(nlhTightJammerPolicy(btnSpot(['Qd', 'Qh']))).toEqual({ action: 'all_in' });
    expect(nlhTightJammerPolicy(btnSpot(['As', '2d']))).toEqual({ action: 'fold' });
    expect(nlhTightJammerPolicy(btnSpot(['Ks', '9d']))).toEqual({ action: 'fold' });
    expect(nlhTightJammerPolicy(btnSpot(['7h', '2c']))).toEqual({ action: 'fold' });
  });
});

/** One heads-up hand: Horse hero at seat 0, the persona at seat 1. */
function fieldHand(
  persona: NlhScriptedPersona,
  handSeed: number,
  dealerSeat: number,
  stackBB: number
) {
  const actions: Array<{ seatIdx: number; stage: HandStage; action: string; amount: number }> = [];
  const observer: LeagueHandObserver = {
    onAction: (e) =>
      actions.push({ seatIdx: e.seatIdx, stage: e.stage, action: e.action, amount: e.amount }),
  };
  const script = nlhScriptedPolicy(persona);
  const answers: Array<{ spot: LeagueSeatSpot; answer: { action: string; amount?: number } }> = [];
  const field: LeagueHumanField = {
    population: NLH_SCRIPTED_POPULATION_ID,
    isHuman: (s) => s !== HERO,
    seatPolicyOf: () => (s) => {
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('a script consumes no randomness');
      });
      const answer = script({
        ...s,
        horseDecide: () => {
          throw new Error('a script never calls the Horse brain');
        },
      });
      random.mockRestore();
      answers.push({ spot: s, answer });
      return answer;
    },
  };
  const counters = { illegal: 0, truncated: 0, corrected: 0, brainFallback: 0 };
  const net = playHand(
    handSeed,
    dealerSeat,
    () => ({}),
    counters,
    undefined,
    'nlh',
    2,
    stackBB,
    undefined,
    undefined,
    field,
    undefined,
    true,
    observer
  );
  return { actions, answers, net, counters };
}

const STACK_OF: Record<NlhScriptedPersona, number> = {
  [NLH_POT_BARRELER_PERSONA]: NLH_SCRIPTED_COMMITTED_STACK_BB,
  [NLH_VALUE_BARRELER_PERSONA]: NLH_SCRIPTED_COMMITTED_STACK_BB,
  [NLH_DANGER_BOARD_BETTOR_PERSONA]: 100,
  [NLH_DANGER_BOARD_VALUE_PERSONA]: 100,
  [NLH_NASH_OPEN_JAMMER_PERSONA]: 12,
  [NLH_TIGHT_JAMMER_PERSONA]: 15,
};

describe('the field plays legal hands and is deterministic', () => {
  it.each(NLH_SCRIPTED_PERSONAS)(
    '%s: every answer is on its menu, is applied unchanged, and chips are conserved',
    (persona) => {
      let scripted = 0;
      for (let k = 0; k < 60; k++) {
        const seed = (20261121 ^ (k * 2654435761)) >>> 0 || 1;
        const hand = fieldHand(persona, seed, (k % 2) + 1, STACK_OF[persona]);
        const label = `${persona} hand ${k}`;
        expect(hand.counters.illegal, label).toBe(0);
        expect(hand.counters.truncated, label).toBe(0);
        expect(hand.counters.corrected, label).toBe(0);
        expect(
          hand.net.reduce((s, n) => s + n, 0),
          label
        ).toBe(0);
        for (const { spot: s, answer } of hand.answers) {
          expect(s.legalActions, label).toContain(answer.action);
          if (answer.action === 'bet' || answer.action === 'raise') {
            expect(answer.amount!, label).toBeGreaterThanOrEqual(s.minRaiseTo!);
            expect(answer.amount!, label).toBeLessThanOrEqual(s.maxRaiseTo!);
          }
        }
        const fieldActions = hand.actions.filter((a) => a.seatIdx !== HERO);
        expect(
          fieldActions.map((a) => a.action),
          label
        ).toEqual(hand.answers.map((x) => x.answer.action));
        scripted += hand.answers.length;
      }
      expect(scripted).toBeGreaterThan(0);
    }
  );

  it.each(NLH_SCRIPTED_PERSONAS)('%s: the same deal replays the same hand', (persona) => {
    const a = fieldHand(persona, 424242, 2, STACK_OF[persona]);
    const b = fieldHand(persona, 424242, 2, STACK_OF[persona]);
    expect(b.actions).toEqual(a.actions);
    expect(b.net).toEqual(a.net);
  });
});

describe('what the scripted no-limit field may be seated with', () => {
  it('a scripted no-limit card deals nlh and names one of its personas', async () => {
    const base = {
      name: 'x',
      seats: 2,
      opponentPopulation: NLH_SCRIPTED_POPULATION_ID,
      a: {},
      b: {},
    } as const;
    await expect(runMatchup({ ...base, variant: 'nlh' }, 1, 1)).rejects.toThrow(
      /scripted personas/
    );
    await expect(
      runMatchup({ ...base, variant: 'plo4', humanPersona: NLH_POT_BARRELER_PERSONA }, 1, 1)
    ).rejects.toThrow(/cannot deal plo4/);
  });

  it('a scripted persona is no calibrated profile', () => {
    for (const persona of NLH_SCRIPTED_PERSONAS)
      expect(() =>
        humanFieldPersonaProfile(persona, {
          population: HUMAN_CALIBRATED_POPULATION_ID,
          variant: 'nlh',
          seats: 2,
        })
      ).toThrow(/scripted persona/);
  });
});

describe('the scripted no-limit field cards', () => {
  it('are on the card, heads-up, not refused, and each value card has its harm control', () => {
    expect(NLH_SCRIPTED_FIELD_CARDS.map((m) => m.name).sort()).toEqual([
      'nlh_committed_no_pair_is_priced_vs_pot_barreler',
      'nlh_committed_no_pair_is_priced_vs_value_barreler',
      'nlh_danger_board_equity_is_priced_vs_danger_bettor',
      'nlh_danger_board_equity_is_priced_vs_danger_value',
    ]);
    const names = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    for (const m of NLH_SCRIPTED_FIELD_CARDS) {
      expect(names.has(m.name), m.name).toBe(true);
      expect(
        UNMEASURABLE_MATCHUPS.some((u) => u.name === m.name),
        m.name
      ).toBe(false);
      expect(m.variant).toBe('nlh');
      expect(m.seats).toBe(2);
      expect(m.opponentPopulation).toBe(NLH_SCRIPTED_POPULATION_ID);
      expect(m.b).toEqual({});
      expect(Object.values(m.a)).toEqual([true]);
    }
    const pairs: Array<[NlhScriptedPersona, NlhScriptedPersona]> = [
      [NLH_POT_BARRELER_PERSONA, NLH_VALUE_BARRELER_PERSONA],
      [NLH_DANGER_BOARD_BETTOR_PERSONA, NLH_DANGER_BOARD_VALUE_PERSONA],
    ];
    for (const [value, control] of pairs) {
      const v = NLH_SCRIPTED_FIELD_CARDS.find((m) => m.humanPersona === value)!;
      const c = NLH_SCRIPTED_FIELD_CARDS.find((m) => m.humanPersona === control)!;
      expect(c.a).toEqual(v.a);
      expect(c.stackBB).toBe(v.stackBB);
    }
    expect(
      NLH_SCRIPTED_FIELD_CARDS.find((m) => m.humanPersona === NLH_POT_BARRELER_PERSONA)!.a
    ).toEqual({
      holdemCommittedNoPairIsPriced: true,
    });
    expect(
      NLH_SCRIPTED_FIELD_CARDS.find((m) => m.humanPersona === NLH_DANGER_BOARD_BETTOR_PERSONA)!.a
    ).toEqual({
      holdemDangerBoardEquityIsPriced: true,
    });
  });

  it.each([
    'nlh_committed_no_pair_is_priced_vs_pot_barreler',
    'nlh_danger_board_equity_is_priced_vs_danger_bettor',
  ])(
    '%s: the option acts against its field, every action is legal, and the worker accepts the result',
    async (name) => {
      const m = LEAGUE_MATCHUPS.find((x) => x.name === name)!;
      // Fixed seed and size: deterministic for a strategy build. Rare is a
      // measurement; zero is not. Measured 2026-11-21: 3 and 2 of 300 pairs diverged.
      const r = await runMatchup(m, 300, 20261115);
      expect(r.illegalActions).toBe(0);
      expect(r.truncatedStreets).toBe(0);
      expect(r.brainExceptionFallbacks).toBe(0);
      expect(r.divergentPairs).toBeGreaterThan(0);
      expect(r.inert).toBe(false);
      expect(r.opponentPopulation).toBe(NLH_SCRIPTED_POPULATION_ID);
      expect(
        horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })
      ).toBe(true);
    },
    300_000
  );
});

describe('the scripted open-jammer field cards (nashCallVsJam, 2026-11-21)', () => {
  it('are on the card, six-max <=20bb, not refused, with default-ON nashCallVsJam arms', () => {
    expect(NLH_SCRIPTED_OPEN_JAMMER_CARDS.map((m) => m.name).sort()).toEqual([
      'nlh_scripted_nash_open_jammer_12bb',
      'nlh_scripted_nash_open_jammer_15bb',
      'nlh_scripted_nash_open_jammer_cash_12bb',
      'nlh_scripted_tight_jammer_15bb',
    ]);
    const names = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    for (const m of NLH_SCRIPTED_OPEN_JAMMER_CARDS) {
      expect(names.has(m.name), m.name).toBe(true);
      expect(
        UNMEASURABLE_MATCHUPS.some((u) => u.name === m.name),
        m.name
      ).toBe(false);
      expect(m.variant).toBe('nlh');
      expect(m.seats).toBe(6);
      expect(m.stackBB).toBeLessThanOrEqual(20);
      expect(m.opponentPopulation).toBe(NLH_SCRIPTED_POPULATION_ID);
      expect(m.a).toEqual({});
      expect(m.b).toEqual({ nashCallVsJam: false });
    }
  });

  it.each(NLH_SCRIPTED_OPEN_JAMMER_CARDS.map((m) => m.name))(
    '%s: scripted jammers open-jam <=20bb, nashCallVsJam fires and diverges with 0 harness defects',
    async (name) => {
      const m = LEAGUE_MATCHUPS.find((x) => x.name === name)!;
      enableBrainTelemetry();
      drainFires();
      let r: Awaited<ReturnType<typeof runMatchup>>;
      let fires: Array<{ feature: string; fires: number }>;
      try {
        r = await runMatchup({ ...m, a: { ...m.a, telemetry: true } }, 200, 20261120);
        fires = drainFires();
      } finally {
        disarmBrainTelemetryForTest();
      }
      expect(r.illegalActions).toBe(0);
      expect(r.truncatedStreets).toBe(0);
      expect(r.correctedActions).toBe(0);
      expect(r.brainExceptionFallbacks).toBe(0);
      expect(r.divergentPairs).toBeGreaterThan(0);
      expect(r.inert).toBe(false);
      expect(r.opponentPopulation).toBe(NLH_SCRIPTED_POPULATION_ID);
      expect(r.humanResponses?.['preflop/facing_bet']?.all_in ?? 0).toBeGreaterThan(0);
      const nashFires = fires.find((f) => f.feature === 'nash_call_vs_jam')?.fires ?? 0;
      expect(nashFires).toBeGreaterThan(0);
      expect(
        horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })
      ).toBe(true);
    },
    300_000
  );
});
