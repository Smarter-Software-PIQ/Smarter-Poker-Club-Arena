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
  FLH_MANIAC_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
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
  flhManiacPolicy,
  flhTightValuePolicy,
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
      expect(seen.wagers).toBeGreaterThan(0);
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
  it.each([FLH_MANIAC_PERSONA, FLH_TIGHT_VALUE_PERSONA])(
    '%s: the same deal replays the same hand, and the same card run gives the same result',
    async (persona) => {
      const a = fieldHand(persona, 424242, 3, 6);
      vi.restoreAllMocks();
      const b = fieldHand(persona, 424242, 3, 6);
      expect(b.actions).toEqual(a.actions);
      expect(b.net).toEqual(a.net);
      const card = FIXED_LIMIT_SCRIPTED_FIELD_CARDS.find((m) => m.humanPersona === persona)!;
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
      expect([FLH_MANIAC_PERSONA, FLH_TIGHT_VALUE_PERSONA]).toContain(m.humanPersona);
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
