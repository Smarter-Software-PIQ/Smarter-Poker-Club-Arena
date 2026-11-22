/**
 * THE SCRIPTED PLO8 HEADS-UP FIELD (2026-11-21, Plo8HuScriptedField.ts).
 *
 * Proves:
 *  1. Each script plays the line its doc states, on hand-built PLO8 spots.
 *  2. Every pot-limit wager validates against PokerEngine.validateAction even
 *     on fractional-cent pots, consumes no randomness and never calls the
 *     Horse brain; the league applies its answer unchanged and chips are
 *     conserved.
 *  3. The field is deterministic from the deal seed.
 *  4. What the field may and may not be seated with is refused out loud.
 *  5. Both cards are on LEAGUE_MATCHUPS, not inert, legal, and accepted by
 *     the compute worker boundary.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, HandStage } from '../types.js';
import { omahaPreflopPercentile } from '../engine/HorseEval.js';
import { calculateBettingState, validateAction } from '../engine/PokerEngine.js';
import {
  LEAGUE_MATCHUPS,
  PLO8_HU_SCRIPTED_FIELD_CARDS,
  UNMEASURABLE_MATCHUPS,
  humanFieldPersonaProfile,
  playHand,
  runMatchup,
  type LeagueHandObserver,
  type LeagueHumanField,
  type LeagueSeatSpot,
} from './HorseLeague.js';
import {
  PLO8_HU_AGGRO_3BETTOR_THRESHOLDS,
  PLO8_HU_REC_CALLER_THRESHOLDS,
  PLO8_HU_SCRIPTED_STACK_BB,
  PLO8_HU_TIGHT_BLIND_THRESHOLDS,
  plo8HuAggro3BettorPolicy,
  plo8HuRecCallerPolicy,
  plo8HuScriptedPolicy,
  plo8HuTightBlindPolicy,
  plo8PostflopHandRead,
} from './Plo8HuScriptedField.js';
import {
  PLO8_HU_AGGRO_3BETTOR_PERSONA,
  PLO8_HU_REC_CALLER_PERSONA,
  PLO8_HU_SCRIPTED_PERSONAS,
  PLO8_HU_SCRIPTED_POPULATION_ID,
  PLO8_HU_TIGHT_BLIND_PERSONA,
  type Plo8HuScriptedPersona,
} from './HorseLeagueHumanField.js';
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

/** A heads-up pot-limit spot matching HorseLeague.seatPolicyDecision. */
function spot(o: {
  stage: HandStage;
  hole: string[];
  board?: string[];
  pot: number;
  toCall?: number;
  currentBet?: number;
  myBet?: number;
  stack?: number;
  lastRaise?: number;
  history?: LeagueSeatSpot['history'];
}): LeagueSeatSpot {
  const toCall = o.toCall ?? 0;
  const currentBet = o.currentBet ?? toCall;
  const myBet = o.myBet ?? 0;
  const stack = o.stack ?? PLO8_HU_SCRIPTED_STACK_BB * BB;
  const lastRaise = o.lastRaise ?? Math.max(BB, toCall);
  const legalActions: string[] = [toCall > 0 ? 'fold' : 'check'];
  if (toCall > 0 && stack > toCall) legalActions.push('call');
  const stackTo = myBet + stack;
  const potCapTo = currentBet + o.pot + toCall;
  const maxTo = Math.min(stackTo, potCapTo);
  const minTo = currentBet > 0 ? currentBet + Math.max(BB, lastRaise) : BB;
  const canWager = maxTo > currentBet && maxTo >= minTo;
  if (canWager) legalActions.push(currentBet > 0 ? 'raise' : 'bet');
  if (stack > 0 && stackTo <= potCapTo) legalActions.push('all_in');
  return {
    variant: 'plo8',
    isPotLimit: true,
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
  ({ seat: 1, userId: 'league-1', action, amount: 6, timestamp: 0, stage }) as never;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('each PLO8 heads-up script plays its stated line', () => {
  // Hand-picked 4-card PLO8 hands verified against omahaPreflopPercentile(h, true).
  const PREMIUM = ['As', 'Ah', '2s', '3h']; // elite double-suited A23A (~1.00)
  const STRONG_MID = ['Ah', 'Qs', '5d', '3c']; // upper-middle hand (~0.67)
  const MEDIUM = ['As', 'Jd', '8c', '4s']; // playable middle-band hand (~0.49)
  const TRASH = ['Kh', '9d', '6c', '2s']; // disconnected non-nut junk (~0.003)

  it('preflop bands separate premium, strong-mid, medium and trash hands cleanly', () => {
    const pPrem = omahaPreflopPercentile(cards(...PREMIUM), true);
    const pStrong = omahaPreflopPercentile(cards(...STRONG_MID), true);
    const pMed = omahaPreflopPercentile(cards(...MEDIUM), true);
    const pTrash = omahaPreflopPercentile(cards(...TRASH), true);
    expect(pPrem).toBeGreaterThanOrEqual(PLO8_HU_TIGHT_BLIND_THRESHOLDS.vsRaiseThreeBetAt);
    expect(pStrong).toBeGreaterThanOrEqual(PLO8_HU_AGGRO_3BETTOR_THRESHOLDS.vsRaiseThreeBetAt);
    expect(pStrong).toBeLessThan(PLO8_HU_TIGHT_BLIND_THRESHOLDS.vsRaiseCallAt);
    expect(pMed).toBeGreaterThanOrEqual(PLO8_HU_REC_CALLER_THRESHOLDS.vsRaiseCallAt);
    expect(pMed).toBeLessThan(PLO8_HU_REC_CALLER_THRESHOLDS.sbRaiseAt);
    expect(pTrash).toBeLessThan(PLO8_HU_REC_CALLER_THRESHOLDS.sbLimpAt);
  });

  it('preflop first-in (SB): rec caller raises/limps/folds; tight blind raises top 25% only; aggro 3-bettor raises top 70% and never limps', () => {
    const sb = (hole: string[]) =>
      spot({ stage: 'preflop', hole, pot: 3, toCall: 1, currentBet: 2, myBet: 1 });

    // Premium: all three raise pot (to 6).
    expect(plo8HuRecCallerPolicy(sb(PREMIUM))).toEqual({ action: 'raise', amount: 6 });
    expect(plo8HuTightBlindPolicy(sb(PREMIUM))).toEqual({ action: 'raise', amount: 6 });
    expect(plo8HuAggro3BettorPolicy(sb(PREMIUM))).toEqual({ action: 'raise', amount: 6 });

    // Medium (~0.49): rec caller limps; tight blind folds; aggro 3-bettor raises pot (>= 0.30).
    expect(plo8HuRecCallerPolicy(sb(MEDIUM))).toEqual({ action: 'call' });
    expect(plo8HuTightBlindPolicy(sb(MEDIUM))).toEqual({ action: 'fold' });
    expect(plo8HuAggro3BettorPolicy(sb(MEDIUM))).toEqual({ action: 'raise', amount: 6 });

    // Trash (< 0.25): all three fold.
    expect(plo8HuRecCallerPolicy(sb(TRASH))).toEqual({ action: 'fold' });
    expect(plo8HuTightBlindPolicy(sb(TRASH))).toEqual({ action: 'fold' });
    expect(plo8HuAggro3BettorPolicy(sb(TRASH))).toEqual({ action: 'fold' });
  });

  it('preflop facing one raise (BB): rec caller defends wide; tight blind folds medium/strong-mid; aggro 3-bettor 3-bets top 45%', () => {
    const facing = (hole: string[]) =>
      spot({
        stage: 'preflop',
        hole,
        pot: 8,
        toCall: 4,
        currentBet: 6,
        myBet: 2,
        history: [wager('preflop', 'raise')],
      });

    // Premium (>= 0.90): all three 3-bet pot (to 18).
    expect(plo8HuRecCallerPolicy(facing(PREMIUM))).toEqual({ action: 'raise', amount: 18 });
    expect(plo8HuTightBlindPolicy(facing(PREMIUM))).toEqual({ action: 'raise', amount: 18 });
    expect(plo8HuAggro3BettorPolicy(facing(PREMIUM))).toEqual({ action: 'raise', amount: 18 });

    // Strong-mid (~0.67): aggro 3-bettor 3-bets pot (>= 0.55); rec caller calls; tight blind folds (< 0.75).
    expect(plo8HuAggro3BettorPolicy(facing(STRONG_MID))).toEqual({ action: 'raise', amount: 18 });
    expect(plo8HuRecCallerPolicy(facing(STRONG_MID))).toEqual({ action: 'call' });
    expect(plo8HuTightBlindPolicy(facing(STRONG_MID))).toEqual({ action: 'fold' });

    // Medium (~0.49): rec caller and aggro 3-bettor call (>= 0.30); tight blind folds (< 0.75).
    expect(plo8HuRecCallerPolicy(facing(MEDIUM))).toEqual({ action: 'call' });
    expect(plo8HuAggro3BettorPolicy(facing(MEDIUM))).toEqual({ action: 'call' });
    expect(plo8HuTightBlindPolicy(facing(MEDIUM))).toEqual({ action: 'fold' });

    // Trash (< 0.30): all three fold.
    expect(plo8HuRecCallerPolicy(facing(TRASH))).toEqual({ action: 'fold' });
    expect(plo8HuTightBlindPolicy(facing(TRASH))).toEqual({ action: 'fold' });
    expect(plo8HuAggro3BettorPolicy(facing(TRASH))).toEqual({ action: 'fold' });
  });

  it('postflop: value betting, sticky calling vs tight folding, and low-draw detection', () => {
    // Low-draw flop: 2 low board ranks (2, 4), 2 unpaired low hole ranks (A, 3), no pair.
    const lowDrawBoard = ['Kd', '4c', '2s'];
    const lowDrawHole = ['Ah', '3h', 'Jc', '9s'];
    const drawRead = plo8PostflopHandRead(cards(...lowDrawHole), cards(...lowDrawBoard), 'flop');
    expect(drawRead.hasMadeLow).toBe(false);
    expect(drawRead.hasLowDraw).toBe(true);

    const facingFlopBet = (hole: string[], board: string[]) =>
      spot({
        stage: 'flop',
        hole,
        board,
        pot: 16,
        toCall: 6,
        currentBet: 6,
        myBet: 0,
        history: [wager('flop', 'bet')],
      });
    expect(plo8HuRecCallerPolicy(facingFlopBet(lowDrawHole, lowDrawBoard))).toEqual({
      action: 'call',
    });
    expect(plo8HuTightBlindPolicy(facingFlopBet(lowDrawHole, lowDrawBoard))).toEqual({
      action: 'fold',
    });

    // One pair, no low on dry high board: rec caller checks/calls, tight blind checks/folds,
    // aggro 3-bettor pot-bets checked to and calls a bet.
    const dryBoard = ['Kd', 'Jc', '9s'];
    const onePairHole = ['Kh', '7h', '5c', '2d'];
    expect(
      plo8HuRecCallerPolicy(spot({ stage: 'flop', hole: onePairHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'check' });
    expect(
      plo8HuAggro3BettorPolicy(spot({ stage: 'flop', hole: onePairHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'bet', amount: 12 });
    expect(plo8HuRecCallerPolicy(facingFlopBet(onePairHole, dryBoard))).toEqual({ action: 'call' });
    expect(plo8HuAggro3BettorPolicy(facingFlopBet(onePairHole, dryBoard))).toEqual({
      action: 'call',
    });
    expect(plo8HuTightBlindPolicy(facingFlopBet(onePairHole, dryBoard))).toEqual({
      action: 'fold',
    });

    // Two pair, no low: rec caller bets 75% pot (9), tight blind bets 50% pot (6),
    // aggro 3-bettor bets full pot (12) and pot-raises facing a bet.
    const twoPairHole = ['Kh', 'Jh', '5c', '2d'];
    expect(
      plo8HuRecCallerPolicy(spot({ stage: 'flop', hole: twoPairHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'bet', amount: 9 });
    expect(
      plo8HuTightBlindPolicy(spot({ stage: 'flop', hole: twoPairHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'bet', amount: 6 });
    expect(
      plo8HuAggro3BettorPolicy(spot({ stage: 'flop', hole: twoPairHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'bet', amount: 12 });
    expect(plo8HuAggro3BettorPolicy(facingFlopBet(twoPairHole, dryBoard)).action).toBe('raise');

    // Trips: both bet 75% pot when checked to and pot-raise facing one bet.
    const setHole = ['Kh', 'Ks', '5c', '2d'];
    expect(
      plo8HuRecCallerPolicy(spot({ stage: 'flop', hole: setHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'bet', amount: 9 });
    expect(
      plo8HuTightBlindPolicy(spot({ stage: 'flop', hole: setHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'bet', amount: 9 });
    expect(plo8HuRecCallerPolicy(facingFlopBet(setHole, dryBoard)).action).toBe('raise');
    expect(plo8HuTightBlindPolicy(facingFlopBet(setHole, dryBoard)).action).toBe('raise');

    // Pure air: both check and fold to a bet.
    const airHole = ['8h', '7d', '4c', '3s'];
    expect(
      plo8HuRecCallerPolicy(spot({ stage: 'flop', hole: airHole, board: dryBoard, pot: 12 }))
    ).toEqual({ action: 'check' });
    expect(plo8HuRecCallerPolicy(facingFlopBet(airHole, dryBoard))).toEqual({ action: 'fold' });
    expect(plo8HuTightBlindPolicy(facingFlopBet(airHole, dryBoard))).toEqual({ action: 'fold' });
  });

  it('pot-limit wagers validate against PokerEngine.validateAction even on fractional-cent pots', () => {
    const cases = [
      { pot: 19.3, currentBet: 6.3, myBet: 0, stack: 24, lastRaise: 6.3 },
      { pot: 15.58, currentBet: 5.58, myBet: 0, stack: 18.42, lastRaise: 5.58 },
      { pot: 12.75, currentBet: 0, myBet: 0, stack: 16.5, lastRaise: 2 },
    ];
    const setHole = ['Kh', 'Ks', '5c', '2d'];
    const dryBoard = ['Kd', 'Jc', '9s'];
    for (const c of cases) {
      const s = spot({
        stage: 'flop',
        hole: setHole,
        board: dryBoard,
        pot: c.pot,
        toCall: Math.max(0, c.currentBet - c.myBet),
        currentBet: c.currentBet,
        myBet: c.myBet,
        stack: c.stack,
        lastRaise: c.lastRaise,
        history: c.currentBet > 0 ? [wager('flop', 'bet')] : [],
      });
      const bs = calculateBettingState(c.pot, c.currentBet, c.myBet, BB, c.lastRaise, true);
      for (const pol of [plo8HuRecCallerPolicy, plo8HuTightBlindPolicy, plo8HuAggro3BettorPolicy]) {
        const d = pol(s);
        expect(s.legalActions).toContain(d.action);
        if (d.action === 'bet' || d.action === 'raise') {
          const v = validateAction(d.action as never, d.amount, c.stack, bs);
          expect(v.valid, `${v.error} for amount ${d.amount}`).toBe(true);
        }
      }
    }
  });

  it('maps every persona to its script and refuses an unknown one', () => {
    expect(plo8HuScriptedPolicy(PLO8_HU_REC_CALLER_PERSONA)).toBe(plo8HuRecCallerPolicy);
    expect(plo8HuScriptedPolicy(PLO8_HU_TIGHT_BLIND_PERSONA)).toBe(plo8HuTightBlindPolicy);
    expect(plo8HuScriptedPolicy(PLO8_HU_AGGRO_3BETTOR_PERSONA)).toBe(plo8HuAggro3BettorPolicy);
    expect(() => plo8HuScriptedPolicy('x' as Plo8HuScriptedPersona)).toThrow(
      /Unknown scripted PLO8 heads-up persona/
    );
  });
});

/** One heads-up PLO8 hand: Horse hero at seat 0, the persona at seat 1. */
function fieldHand(persona: Plo8HuScriptedPersona, handSeed: number, dealerSeat: number) {
  const actions: Array<{ seatIdx: number; stage: HandStage; action: string; amount: number }> = [];
  const observer: LeagueHandObserver = {
    onAction: (e) =>
      actions.push({ seatIdx: e.seatIdx, stage: e.stage, action: e.action, amount: e.amount }),
  };
  const script = plo8HuScriptedPolicy(persona);
  const answers: Array<{ spot: LeagueSeatSpot; answer: { action: string; amount?: number } }> = [];
  const field: LeagueHumanField = {
    population: PLO8_HU_SCRIPTED_POPULATION_ID,
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
    'plo8',
    2,
    PLO8_HU_SCRIPTED_STACK_BB,
    undefined,
    undefined,
    field,
    undefined,
    true,
    observer
  );
  return { actions, answers, net, counters };
}

describe('the scripted PLO8 HU field plays legal hands and is deterministic', () => {
  it.each(PLO8_HU_SCRIPTED_PERSONAS)(
    '%s: every answer is on its menu, is applied unchanged, and chips are conserved',
    (persona) => {
      let scripted = 0;
      for (let k = 0; k < 60; k++) {
        const seed = (20261121 ^ (k * 2654435761)) >>> 0 || 1;
        const hand = fieldHand(persona, seed, (k % 2) + 1);
        const label = `${persona} hand ${k}`;
        expect(hand.counters.illegal, label).toBe(0);
        expect(hand.counters.truncated, label).toBe(0);
        expect(hand.counters.corrected, label).toBe(0);
        expect(hand.counters.brainFallback, label).toBe(0);
        expect(Math.abs(hand.net.reduce((s, n) => s + n, 0)), label).toBeLessThan(1e-6);
        for (const { spot: s, answer } of hand.answers) {
          expect(s.legalActions, label).toContain(answer.action);
          if (answer.action === 'bet' || answer.action === 'raise') {
            expect(answer.amount!, label).toBeGreaterThanOrEqual(s.minRaiseTo! - 1e-9);
            expect(answer.amount!, label).toBeLessThanOrEqual(s.maxRaiseTo! + 1e-9);
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

  it.each(PLO8_HU_SCRIPTED_PERSONAS)('%s: the same deal replays the same hand', (persona) => {
    const a = fieldHand(persona, 424242, 2);
    const b = fieldHand(persona, 424242, 2);
    expect(b.actions).toEqual(a.actions);
    expect(b.net).toEqual(a.net);
  });
});

describe('what the scripted PLO8 heads-up field may be seated with', () => {
  it('requires variant=plo8, seats=2, and a scripted PLO8 HU persona', async () => {
    const base = {
      name: 'x',
      seats: 2,
      opponentPopulation: PLO8_HU_SCRIPTED_POPULATION_ID,
      a: {},
      b: {},
    } as const;
    await expect(runMatchup({ ...base, variant: 'plo8' }, 1, 1)).rejects.toThrow(
      /scripted personas/
    );
    await expect(
      runMatchup({ ...base, variant: 'plo4', humanPersona: PLO8_HU_REC_CALLER_PERSONA }, 1, 1)
    ).rejects.toThrow(/cannot deal plo4/);
    await expect(
      runMatchup(
        { ...base, variant: 'plo8', seats: 6, humanPersona: PLO8_HU_REC_CALLER_PERSONA },
        1,
        1
      )
    ).rejects.toThrow(/heads-up/);
  });

  it('a scripted PLO8 persona is no calibrated profile', () => {
    for (const persona of PLO8_HU_SCRIPTED_PERSONAS)
      expect(() =>
        humanFieldPersonaProfile(persona, {
          population: HUMAN_CALIBRATED_POPULATION_ID,
          variant: 'nlh',
          seats: 2,
        })
      ).toThrow(/scripted persona/);
  });
});

describe('the scripted PLO8 heads-up field cards', () => {
  it('are on LEAGUE_MATCHUPS, heads-up PLO8 12bb MTT, not refused, with default-off option on arm A', () => {
    expect(PLO8_HU_SCRIPTED_FIELD_CARDS.map((m) => m.name).sort()).toEqual([
      'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor',
      'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller',
      'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind',
    ]);
    const names = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    for (const m of PLO8_HU_SCRIPTED_FIELD_CARDS) {
      expect(names.has(m.name), m.name).toBe(true);
      expect(
        UNMEASURABLE_MATCHUPS.some((u) => u.name === m.name),
        m.name
      ).toBe(false);
      expect(m.variant).toBe('plo8');
      expect(m.seats).toBe(2);
      expect(m.stackBB).toBe(PLO8_HU_SCRIPTED_STACK_BB);
      expect(m.hybridBaseline).toBe(true);
      expect(m.moodClock).toBe('deal_seed');
      expect(m.opponentPopulation).toBe(PLO8_HU_SCRIPTED_POPULATION_ID);
      expect(m.b).toEqual({});
      expect(m.a).toEqual({ omahaHiLoTournamentFirstIn: true });
    }
  });

  it.each([
    'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller',
    'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind',
    'plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor',
  ])(
    '%s: omahaHiLoTournamentFirstIn acts against the scripted field, every action is legal, and the worker accepts the result',
    async (name) => {
      const m = LEAGUE_MATCHUPS.find((x) => x.name === name)!;
      const r = await runMatchup(m, 200, 20261115);
      expect(r.illegalActions).toBe(0);
      expect(r.truncatedStreets).toBe(0);
      expect(r.brainExceptionFallbacks).toBe(0);
      expect(r.divergentPairs).toBeGreaterThan(0);
      expect(r.inert).toBe(false);
      expect(r.opponentPopulation).toBe(PLO8_HU_SCRIPTED_POPULATION_ID);
      expect(
        horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })
      ).toBe(true);
    },
    300_000
  );
});
