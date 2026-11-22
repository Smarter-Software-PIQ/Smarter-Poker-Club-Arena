/**
 * THE SCRIPTED FIXED-LIMIT OMAHA HI-LO FIELD (2026-11-21, Flo8ScriptedField.ts).
 *
 * Proves:
 *  1. Purity and determinism: every persona reads only its own cards and public
 *     state, consumes zero randomness (fastRandom state untouched), and returns
 *     the same decision across repeated calls.
 *  2. Policy semantics: omahaHiCat, hasNutLow, hasLowDraw, high-barreler
 *     preflop/postflop lines, maniac never folds, tight-value never bluffs,
 *     river-folder folds one-pair/air on the river while calling two-pair/low,
 *     passive-caller never folds postflop.
 *  3. Real HandController action-by-action parity and hi-lo split settlement
 *     stack parity across all 5 personas (heads-up and six-max) with zero
 *     illegal actions, zero truncated streets, and zero brain fallbacks.
 *  4. Domain refusal boundaries: flo8_scripted_field_v1 admits flo8 only;
 *     flh_scripted_field_v1 stays flh-only; scripted personas are refused as
 *     calibrated profiles; missing seat policy throws.
 *  5. Card wiring: all 9 FLO8_SCRIPTED_FIELD_CARDS (3 per option) are on
 *     LEAGUE_MATCHUPS, none in UNMEASURABLE_MATCHUPS, valid under
 *     leagueFixedLimitRefusal, and accepted by horseLeagueComputeResponseIsValid.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Card,
  CardRank,
  CardSuit,
  HandConfig,
  HandEvent,
  HandStage,
  SeatPlayer,
} from '../types.js';
import { HandController } from '../engine/HandController.js';
import { HorseMind } from '../engine/HorseMind.js';
import { HorseLogic, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from '../engine/HorseEval.js';
import {
  FIXED_LIMIT_SCRIPTED_POPULATION_ID,
  FLO8_HIGH_BARRELER_PERSONA,
  FLO8_MANIAC_PERSONA,
  FLO8_PASSIVE_CALLER_PERSONA,
  FLO8_RIVER_FOLDER_PERSONA,
  FLO8_SCRIPTED_FIELD_CARDS,
  FLO8_SCRIPTED_PERSONAS,
  FLO8_SCRIPTED_POPULATION_ID,
  FLO8_TIGHT_VALUE_PERSONA,
  LEAGUE_MATCHUPS,
  UNMEASURABLE_MATCHUPS,
  humanFieldPersonaProfile,
  leagueDealtCards,
  playHand,
  runMatchup,
  type Flo8ScriptedPersona,
  type LeagueHandObserver,
  type LeagueHumanField,
  type LeagueSeatSpot,
} from './HorseLeague.js';
import {
  flo8HighBarrelerPolicy,
  flo8ManiacPolicy,
  flo8PassiveCallerPolicy,
  flo8RiverFolderPolicy,
  flo8ScriptedPolicy,
  flo8TightValuePolicy,
  hasLowDraw,
  hasNutLow,
  omahaHiCat,
} from './Flo8ScriptedField.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';
import { horseLeagueComputeResponseIsValid } from './HorseLeagueComputeWorkerClient.js';
import { leagueFixedLimitRefusal } from './LeagueDecisionState.js';

const BB = 2;
const SB = 1;
const STACK_BB = 100;
const HERO = 0;

const SUIT_MAP: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};
const c = (code: string): Card => ({
  rank: code[0] as CardRank,
  suit: SUIT_MAP[code[1]],
});
const cs = (list: string[]): Card[] => list.map(c);

function spot(over: Partial<LeagueSeatSpot> = {}): LeagueSeatSpot {
  return {
    seatIdx: 1,
    userId: 'league-human-2',
    stage: 'river',
    cards: cs(['As', '2d', 'Kh', 'Qd']),
    board: cs(['Kc', '9d', '7h', '4s', '3c']),
    variant: 'flo8',
    isPotLimit: false,
    pot: 16,
    currentBet: 0,
    myBet: 0,
    toCall: 0,
    stack: 180,
    bigBlind: BB,
    numSeats: 6,
    dealerSeat: 1,
    liveCount: 3,
    legalActions: ['check', 'bet', 'all_in'],
    minRaiseTo: 4,
    maxRaiseTo: 4,
    history: [],
    horseDecide: () => {
      throw new Error('script must never call horseDecide');
    },
    ...over,
  };
}

interface Node {
  seatIdx: number;
  stage: HandStage;
  action: string;
  amount: number;
  pot: number;
  toCall: number;
}

function fieldHand(
  persona: Flo8ScriptedPersona,
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
  const script = flo8ScriptedPolicy(persona);
  const field: LeagueHumanField = {
    population: FLO8_SCRIPTED_POPULATION_ID,
    isHuman: (s) => s !== HERO,
    seatPolicyOf: () => (s) => {
      const answer = script(s);
      const { horseDecide: _brain, ...publicSpot } = s;
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
    'flo8',
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
      tableId: 'league-flo8-scripted-field-replay',
      handNumber: 1,
      gameVariant: 'flo8',
      smallBlind: SB,
      bigBlind: BB,
      ante: 0,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    dealerSeat
  );
  const dealt = leagueDealtCards(handSeed, 'flo8', seats);
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

function replay(persona: Flo8ScriptedPersona, handSeed: number, dealerSeat: number, seats: number) {
  const hand = fieldHand(persona, handSeed, dealerSeat, seats);
  const label = `${persona} seed ${handSeed}, dealer ${dealerSeat}, ${seats} seats`;
  expect(hand.counters.illegal, label).toBe(0);
  expect(hand.counters.truncated, label).toBe(0);
  expect(hand.counters.brainFallback, label).toBe(0);
  const live = controllerFor(handSeed, dealerSeat, seats);
  const cLive = live.controller;
  hand.actions.forEach((a, k) => {
    const at = `${label}, action ${k} (${a.stage} seat ${a.seatIdx + 1} ${a.action})`;
    expect(live.isComplete(), at).toBe(false);
    const state = cLive.getState();
    const actor = cLive.getCurrentPlayer()!;
    const menu = cLive.getAuthoritativeActionState(actor.user_id)!;
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
      expect(menu.legalActions, at).toContain(o.answer.action);
      expect(o.answer.action, at).not.toBe('all_in');
      if (o.answer.action === 'bet' || o.answer.action === 'raise') {
        expect(o.answer.amount, at).toBe(menu.minRaiseTo);
      }
      expect(a.action, at).toBe(o.answer.action);
    }
    expect(menu.legalActions, at).toContain(a.action);
    const wager = a.action === 'bet' || a.action === 'raise' ? a.amount : undefined;
    expect(cLive.performAction(actor.seat, a.action as never, wager), at).toBe(true);
  });
  expect(live.isComplete(), label).toBe(true);
  const controllerNet = cLive
    .getState()
    .players.map((p) => Math.round((p.stack - STACK_BB * BB) * 100));
  const leagueNet = hand.net.map((x) => Math.round(x * 100));
  expect(leagueNet, label).toEqual(controllerNet);
  expect(
    leagueNet.reduce((s, x) => s + x, 0),
    label
  ).toBe(0);
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('Flo8ScriptedField helpers and persona purity', () => {
  it('omahaHiCat, hasNutLow and hasLowDraw classify Omaha hi-lo holdings accurately', () => {
    const lowBoard = cs(['Kc', '9d', '7h', '4s', '3c']);
    const flopLowDrawBoard = cs(['Kc', '7h', '4s']);
    const highBoard = cs(['Kc', 'Qd', 'Jh', 'Ts', '9c']);

    expect(omahaHiCat(cs(['Kh', 'Ks', 'Qd', 'Jd']), lowBoard)).toBe(4); // trips Kings (using 2 hole + 3 board)
    expect(omahaHiCat(cs(['As', '2d', 'Qc', 'Jh']), lowBoard)).toBe(1); // high card
    expect(hasNutLow(cs(['As', '2d', 'Qc', 'Jh']), lowBoard)).toBe(true);
    expect(hasNutLow(cs(['As', '5d', 'Qc', 'Jh']), lowBoard)).toBe(false);
    expect(hasNutLow(cs(['As', '2d', 'Qc', 'Jh']), highBoard)).toBe(false);

    expect(hasLowDraw(cs(['As', '2d', 'Qc', 'Jh']), flopLowDrawBoard)).toBe(true);
    expect(hasLowDraw(cs(['7d', '4c', 'Qc', 'Jh']), flopLowDrawBoard)).toBe(false);
    expect(hasLowDraw(cs(['As', '5d', 'Qc', 'Jh']), lowBoard)).toBe(true);
  });

  it('every persona is pure and leaves fastRandom state completely untouched', () => {
    const saved = saveFastRandom();
    try {
      seedFastRandom(12345);
      const before = saveFastRandom();
      const samples = [
        spot({
          stage: 'preflop',
          board: [],
          toCall: 2,
          currentBet: 2,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 4,
          maxRaiseTo: 4,
        }),
        spot({ stage: 'flop', board: cs(['Kc', '7h', '4s']) }),
        spot({
          stage: 'river',
          toCall: 4,
          currentBet: 4,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 8,
          maxRaiseTo: 8,
        }),
      ];
      for (const persona of FLO8_SCRIPTED_PERSONAS) {
        const policy = flo8ScriptedPolicy(persona);
        for (const s of samples) {
          const d1 = policy(s);
          const d2 = policy(s);
          expect(d2, persona).toEqual(d1);
          expect(s.legalActions, persona).toContain(d1.action);
          expect(d1.action, persona).not.toBe('all_in');
        }
      }
      expect(saveFastRandom()).toEqual(before);
    } finally {
      restoreFastRandom(saved);
    }
  });

  it('pins key behavioral invariants of all 5 personas', () => {
    const lowBoard = cs(['Kc', '9d', '7h', '4s', '3c']);
    const pairNoLow = cs(['Kh', 'Qd', 'Jc', 'Ts']);
    const airNoLow = cs(['Qh', 'Qd', 'Jc', 'Ts']);
    const nutLowNoHigh = cs(['As', '2d', 'Jc', 'Ts']);
    const tripsNoLow = cs(['Kh', 'Ks', 'Qd', 'Jc']);

    const facingOneRiverBet = (cards: Card[]) =>
      spot({
        stage: 'river',
        cards,
        board: lowBoard,
        toCall: 4,
        currentBet: 4,
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        minRaiseTo: 8,
        maxRaiseTo: 8,
        history: [
          { userId: 'league-1', seat: 1, action: 'bet', amount: 4, stage: 'river', timestamp: 1 },
        ],
      });
    const checkedRiver = (cards: Card[]) =>
      spot({
        stage: 'river',
        cards,
        board: lowBoard,
        toCall: 0,
        currentBet: 0,
        legalActions: ['check', 'bet', 'all_in'],
        minRaiseTo: 4,
        maxRaiseTo: 4,
      });

    // 1. High barreler bets pairs when checked to, raises trips facing a bet.
    expect(flo8HighBarrelerPolicy(checkedRiver(pairNoLow))).toEqual({ action: 'bet', amount: 4 });
    expect(flo8HighBarrelerPolicy(facingOneRiverBet(tripsNoLow))).toEqual({
      action: 'raise',
      amount: 8,
    });

    // 2. Maniac bets/raises whenever legal and never folds.
    expect(flo8ManiacPolicy(facingOneRiverBet(airNoLow))).toEqual({ action: 'raise', amount: 8 });
    expect(
      flo8ManiacPolicy(
        facingOneRiverBet(airNoLow) &&
          spot({
            cards: airNoLow,
            board: lowBoard,
            toCall: 4,
            currentBet: 16,
            legalActions: ['fold', 'call'],
            minRaiseTo: null,
            maxRaiseTo: null,
          })
      )
    ).toEqual({ action: 'call' });

    // 3. Tight-value never bluffs (checks one pair / air) and bets nut low or two-pair+.
    expect(flo8TightValuePolicy(checkedRiver(pairNoLow))).toEqual({ action: 'check' });
    expect(flo8TightValuePolicy(checkedRiver(nutLowNoHigh))).toEqual({ action: 'bet', amount: 4 });
    expect(flo8TightValuePolicy(facingOneRiverBet(nutLowNoHigh))).toEqual({
      action: 'raise',
      amount: 8,
    });

    // 4. River folder checks non-trips on river, folds one-pair/air facing a river bet, calls low.
    expect(flo8RiverFolderPolicy(checkedRiver(pairNoLow))).toEqual({ action: 'check' });
    expect(flo8RiverFolderPolicy(facingOneRiverBet(pairNoLow))).toEqual({ action: 'fold' });
    expect(flo8RiverFolderPolicy(facingOneRiverBet(nutLowNoHigh))).toEqual({ action: 'call' });

    // 5. Passive caller checks non-trips and never folds postflop.
    expect(flo8PassiveCallerPolicy(checkedRiver(pairNoLow))).toEqual({ action: 'check' });
    expect(flo8PassiveCallerPolicy(facingOneRiverBet(pairNoLow))).toEqual({ action: 'call' });
    expect(flo8PassiveCallerPolicy(facingOneRiverBet(airNoLow))).toEqual({ action: 'call' });
  });
});

describe('HandController action-by-action and hi-lo settlement parity for all 5 flo8 personas', () => {
  const cases: Array<[Flo8ScriptedPersona, number]> = [
    [FLO8_HIGH_BARRELER_PERSONA, 6],
    [FLO8_MANIAC_PERSONA, 6],
    [FLO8_TIGHT_VALUE_PERSONA, 6],
    [FLO8_RIVER_FOLDER_PERSONA, 2],
    [FLO8_PASSIVE_CALLER_PERSONA, 2],
  ];

  it.each(cases)(
    '%s (%i seats): replays node-for-node through HandController with exact hi-lo stack parity',
    (persona, seats) => {
      for (const seed of [101, 202, 303]) {
        replay(persona, seed, (seed % seats) + 1, seats);
      }
    },
    120_000
  );
});

describe('domain boundaries and FLO8_SCRIPTED_FIELD_CARDS registration', () => {
  it('admits flo8 for flo8_scripted_field_v1 and keeps flh_scripted_field_v1 flh-only', () => {
    expect(
      leagueFixedLimitRefusal({
        gameVariant: 'flo8',
        stackBB: 100,
        gameMode: 'cash',
        ante: 0,
        humanField: true,
        fieldPopulation: FLO8_SCRIPTED_POPULATION_ID,
      })
    ).toBeNull();
    expect(
      leagueFixedLimitRefusal({
        gameVariant: 'flh',
        stackBB: 100,
        gameMode: 'cash',
        ante: 0,
        humanField: true,
        fieldPopulation: FLO8_SCRIPTED_POPULATION_ID,
      })
    ).toMatch(/Horses only/);
    expect(
      leagueFixedLimitRefusal({
        gameVariant: 'flo8',
        stackBB: 100,
        gameMode: 'cash',
        ante: 0,
        humanField: true,
        fieldPopulation: FIXED_LIMIT_SCRIPTED_POPULATION_ID,
      })
    ).toMatch(/Horses only/);
    for (const persona of FLO8_SCRIPTED_PERSONAS) {
      expect(() =>
        humanFieldPersonaProfile(persona, {
          population: HUMAN_CALIBRATED_POPULATION_ID,
          variant: 'nlh',
          seats: 6,
        })
      ).toThrow(/scripted persona/);
    }
  });

  it('registers all 9 cards (3 per option), none refused, and worker accepts a small run', async () => {
    expect(FLO8_SCRIPTED_FIELD_CARDS).toHaveLength(9);
    const leagueNames = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    for (const m of FLO8_SCRIPTED_FIELD_CARDS) {
      expect(leagueNames.has(m.name), m.name).toBe(true);
      expect(
        UNMEASURABLE_MATCHUPS.some((u) => u.name === m.name),
        m.name
      ).toBe(false);
      expect(m.variant).toBe('flo8');
      expect(m.opponentPopulation).toBe(FLO8_SCRIPTED_POPULATION_ID);
      expect(FLO8_SCRIPTED_PERSONAS).toContain(m.humanPersona);
      expect(
        leagueFixedLimitRefusal({
          gameVariant: 'flo8',
          stackBB: m.stackBB ?? 100,
          gameMode: 'cash',
          ante: 0,
          humanField: true,
          fieldPopulation: m.opponentPopulation,
        }),
        m.name
      ).toBeNull();
    }
    expect(
      FLO8_SCRIPTED_FIELD_CARDS.filter((m) => m.a.fixedLimitHiLoLowHalfFloor === true)
    ).toHaveLength(3);
    expect(
      FLO8_SCRIPTED_FIELD_CARDS.filter((m) => m.a.fixedLimitHiLoNutLowRiverBet === true)
    ).toHaveLength(3);
    expect(
      FLO8_SCRIPTED_FIELD_CARDS.filter((m) => m.a.fixedLimitOmahaNoPresumption === true)
    ).toHaveLength(3);
    expect(UNMEASURABLE_MATCHUPS.some((u) => u.name === 'flo8_hilo_low_half_floor')).toBe(false);
    expect(UNMEASURABLE_MATCHUPS.some((u) => u.name === 'flo8_nut_low_river_bet')).toBe(false);

    // Fast 10-pair smoke run to verify worker contract and legality (zero heavy sim).
    const card = FLO8_SCRIPTED_FIELD_CARDS[0];
    const r = await runMatchup(card, 10, 20261121);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
    expect(r.brainExceptionFallbacks).toBe(0);
    expect(r.opponentPopulation).toBe(FLO8_SCRIPTED_POPULATION_ID);
    expect(Object.keys(r.humanResponses ?? {}).length).toBeGreaterThan(0);
    expect(horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })).toBe(
      true
    );
  }, 120_000);
});
