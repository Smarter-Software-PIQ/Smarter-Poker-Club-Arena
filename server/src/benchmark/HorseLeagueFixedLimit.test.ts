/**
 * THE LEAGUE DEALS LEGAL FIXED-LIMIT HOLD'EM (2026-11-20).
 *
 * Until this date HorseLeague.playHand dealt every variant with no-limit or
 * pot-limit betting, so a fixed-limit card measured a game nobody plays and
 * UNMEASURABLE_MATCHUPS refused every one of them. playHand now deals
 * fixed-limit hold'em with the engine's own structure functions. This file is
 * the proof that what it deals is the game the live table deals:
 *
 *  1. Every league hand is replayed, action by action, through a REAL
 *     HandController holding the same cards. At every node the controller
 *     must have the same seat on the clock, the same street, pot and bet
 *     level, and the menu the league handed the brain (legal actions, the
 *     price to call, the single legal wager, the street unit, the cap flag)
 *     must be the controller's own authoritative menu. The controller must
 *     accept every league action, and its final stacks must equal the
 *     league's settlement, seat by seat.
 *  2. The structure itself, read off the league's own actions: wagers are
 *     exactly one small bet preflop and on the flop and one big bet on the
 *     turn and river, a street takes at most four of them (the big blind is
 *     the first preflop), a capped street offers fold and call only, the pot
 *     is the sum of what the seats put in, and chips are conserved.
 *  3. What the league cannot deal correctly it refuses out loud.
 *  4. The fixed-limit hold'em cards are on the card, inside that domain, and
 *     their arms do not play identical poker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, HandConfig, HandEvent, HandStage, SeatPlayer } from '../types.js';
import { HandController } from '../engine/HandController.js';
import { HorseLogic, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import { FIXED_LIMIT_MAX_WAGERS } from '../engine/BettingStructure.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { variantInfo } from '../engine/HorseEval.js';
import {
  FIXED_LIMIT_HOLDEM_CARDS,
  FIXED_LIMIT_OMAHA_HILO_CARDS,
  FIXED_LIMIT_SCRIPTED_FIELD_CARDS,
  FIXED_LIMIT_SCRIPTED_POPULATION_ID,
  FLO8_SCRIPTED_FIELD_CARDS,
  LEAGUE_MATCHUPS,
  UNMEASURABLE_MATCHUPS,
  leagueDealtCards,
  playHand,
  runMatchup,
  type LeagueHandObserver,
} from './HorseLeague.js';
import { evaluateOmahaLowHand } from '../engine/PokerEngine.js';
import { horseLeagueComputeResponseIsValid } from './HorseLeagueComputeWorkerClient.js';
import {
  LEAGUE_FIXED_LIMIT_MAX_COMMIT_BB,
  leagueActionState,
  leagueDealsFixedLimit,
  leagueFixedLimitRefusal,
} from './LeagueDecisionState.js';

const BB = 2;
const SB = 1;
const STACK_BB = 100;

interface LeagueAction {
  seatIdx: number;
  stage: HandStage;
  action: string;
  amount: number;
  pot: number;
  toCall: number;
}

/** One league fixed-limit hand (flh or flo8): its actions, the states the brain was handed, its settlement. */
function leagueHand(
  handSeed: number,
  dealerSeat: number,
  seats: number,
  stackBB = STACK_BB,
  variant: 'flh' | 'flo8' = 'flh'
) {
  const actions: LeagueAction[] = [];
  let endInfo:
    | { endedByFolds: boolean; folded: boolean[]; cards: Card[][]; board: Card[]; net: number[] }
    | undefined;
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
    onEnd: (e) => {
      endInfo = e;
    },
  };
  const counters = { illegal: 0, truncated: 0, corrected: 0, brainFallback: 0 };
  const decide = vi.spyOn(HorseLogic, 'decide');
  const before = decide.mock.calls.length;
  const net = playHand(
    handSeed,
    dealerSeat,
    () => ({}),
    counters,
    undefined,
    variant,
    seats,
    stackBB,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
    observer
  );
  const states = decide.mock.calls
    .slice(before)
    .map(([, gs]) => structuredClone(gs) as HorseGameStateV2);
  return { actions, states, net, counters, endInfo };
}

/** A real HandController dealt the league's own cards for the same deal. */
function controllerFor(
  handSeed: number,
  dealerSeat: number,
  seats: number,
  stackBB = STACK_BB,
  variant: 'flh' | 'flo8' = 'flh'
) {
  const players = Array.from({ length: seats }, (_, i) => ({
    seat: i + 1,
    user_id: `league-${i + 1}`,
    username: `League${i + 1}`,
    stack: stackBB * BB,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  })) as SeatPlayer[];
  const controller = new HandController(
    {
      tableId: `league-fixed-limit-replay-${variant}`,
      handNumber: 1,
      gameVariant: variant,
      smallBlind: SB,
      bigBlind: BB,
      ante: 0,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    dealerSeat
  );
  // The controller deals hole cards in seat order and then the board with no
  // burn card, which is the order the league cuts its deck in. Only this
  // instance's deck is replaced (as Plo4PolicyLeague.playPlo4PolicyHand does).
  const dealt = leagueDealtCards(handSeed, variant, seats);
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
  let rake = 0;
  controller.onEvent((event: HandEvent) => {
    if (event.type === 'HAND_COMPLETE') {
      complete = true;
      rake = event.rake;
    }
  });
  controller.start();
  return { controller, dealt, isComplete: () => complete, rake: () => rake };
}

const key = (c: Card) => `${c.rank}${c.suit}`;

/** Replays one league hand through the real controller and compares every node. */
function replayAgainstController(
  handSeed: number,
  dealerSeat: number,
  seats: number,
  variant: 'flh' | 'flo8' = 'flh'
) {
  const league = leagueHand(handSeed, dealerSeat, seats, STACK_BB, variant);
  const label = `${variant} seed ${handSeed}, dealer ${dealerSeat}, ${seats} seats`;
  expect(league.counters.illegal, label).toBe(0);
  expect(league.counters.truncated, label).toBe(0);
  expect(league.counters.brainFallback, label).toBe(0);
  // Every seat is a Horse and every decision is one brain call, in order.
  expect(league.states.length, label).toBe(league.actions.length);

  const live = controllerFor(handSeed, dealerSeat, seats, STACK_BB, variant);
  const c = live.controller;
  // The same cards at the same seats.
  c.getState().players.forEach((p, i) => {
    expect(p.cards.map(key), label).toEqual(live.dealt.holes[i].map(key));
  });

  league.actions.forEach((a, k) => {
    const at = `${label}, action ${k} (${a.stage} seat ${a.seatIdx + 1} ${a.action})`;
    expect(live.isComplete(), at).toBe(false);
    const state = c.getState();
    const actor = c.getCurrentPlayer()!;
    const menu = c.getAuthoritativeActionState(actor.user_id)!;
    const gs = league.states[k];

    // The same node.
    expect(actor.seat, at).toBe(a.seatIdx + 1);
    expect(state.stage, at).toBe(a.stage);
    expect(state.pot, at).toBe(a.pot);
    expect(gs.pot, at).toBe(state.pot);
    expect(gs.currentBet, at).toBe(state.currentBet);
    expect(gs.minRaise, at).toBe(state.minRaise);
    expect(gs.lastRaise, at).toBe(state.lastRaise);
    expect(gs.communityCards.map(key), at).toEqual(state.communityCards.map(key));
    gs.players.forEach((seat, i) => {
      const real = state.players[i];
      expect(
        {
          stack: seat.stack,
          bet: seat.bet,
          totalInvested: seat.totalInvested,
          is_folded: seat.is_folded,
          is_all_in: seat.is_all_in,
        },
        at
      ).toEqual({
        stack: real.stack,
        bet: real.bet,
        totalInvested: real.totalInvested,
        is_folded: real.is_folded,
        is_all_in: real.is_all_in,
      });
    });
    // The same recorded actions, as the cap and the reopen rule read them.
    expect(
      (gs.actionHistory ?? []).map((r) => [r.seat, r.stage, r.action, r.amount, r.isFullRaise]),
      at
    ).toEqual(state.actionHistory.map((r) => [r.seat, r.stage, r.action, r.amount, r.isFullRaise]));

    // The menu the brain was handed is the controller's own.
    expect(
      {
        legalActions: gs.legalActions,
        toCall: gs.toCall,
        minRaiseTo: gs.minRaiseTo,
        maxRaiseTo: gs.maxRaiseTo,
        bettingStructure: gs.bettingStructure,
        fixedBetSize: gs.fixedBetSize,
        wagersCapped: gs.wagersCapped,
        fixedLimitSmallBet: gs.fixedLimitSmallBet,
      },
      at
    ).toEqual({
      legalActions: menu.legalActions,
      toCall: menu.toCall,
      minRaiseTo: menu.minRaiseTo,
      maxRaiseTo: menu.maxRaiseTo,
      bettingStructure: menu.structure,
      fixedBetSize: menu.fixedBetSize,
      wagersCapped: menu.wagersCapped,
      fixedLimitSmallBet: c.getFixedLimitSmallBet(),
    });
    expect(menu.structure, at).toBe('fixed_limit');

    // The controller accepts the league's action exactly as the league applied it.
    expect(menu.legalActions, at).toContain(a.action);
    const wager = a.action === 'bet' || a.action === 'raise' ? a.amount : undefined;
    expect(c.performAction(actor.seat, a.action as never, wager), at).toBe(true);
  });

  // The hand ended where the league ended it, and paid what the league paid.
  expect(live.isComplete(), label).toBe(true);
  expect(live.rake(), label).toBe(0);
  const end = c.getState();
  expect(
    end.players.map((p) => Math.round((p.stack - STACK_BB * BB) * 100)),
    label
  ).toEqual(league.net.map((n) => Math.round(n * 100)));
  return league;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the league fixed-limit hand (flh and flo8) is the live controller hand', () => {
  it.each([
    ['flh heads-up', 'flh', 2, 120],
    ['flh six-max', 'flh', 6, 120],
    ['flo8 heads-up', 'flo8', 2, 80],
    ['flo8 six-max', 'flo8', 6, 80],
  ] as const)(
    '%s: every node, menu, action and settlement equals a real HandController',
    (_name, variant, seats, hands) => {
      let actions = 0;
      let showdowns = 0;
      let qualifyingLowShowdowns = 0;
      let cappedNodes = 0;
      const streets = new Set<string>();
      for (let h = 0; h < hands; h++) {
        const handSeed = ((20261120 + seats) ^ (h * 2654435761)) >>> 0 || 1;
        const league = replayAgainstController(handSeed, (h % seats) + 1, seats, variant);
        actions += league.actions.length;
        cappedNodes += league.states.filter((gs) => gs.wagersCapped === true).length;
        for (const a of league.actions) streets.add(a.stage);
        const folded = new Set(
          league.actions.filter((a) => a.action === 'fold').map((a) => a.seatIdx)
        );
        if (seats - folded.size >= 2) {
          showdowns++;
          if (variant === 'flo8' && league.endInfo) {
            const hasLow = league.endInfo.cards.some(
              (hole, idx) =>
                !league.endInfo!.folded[idx] &&
                evaluateOmahaLowHand(hole, league.endInfo!.board) !== null
            );
            if (hasLow) qualifyingLowShowdowns++;
          }
        }
      }
      // The sample reaches what it claims to prove: every street, showdowns,
      // and for flo8 qualifying-low hi-lo split showdowns.
      expect(actions).toBeGreaterThan(hands * 2);
      expect([...streets].sort()).toEqual(['flop', 'preflop', 'river', 'turn']);
      expect(showdowns).toBeGreaterThan(0);
      if (variant === 'flo8') expect(qualifyingLowShowdowns).toBeGreaterThan(0);
      // Reported, not required: how many nodes sat on a capped street.
      expect(cappedNodes).toBeGreaterThanOrEqual(0);
    },
    300_000
  );
});

describe('the league fixed-limit hand (flh and flo8) keeps the structure', () => {
  it.each([
    ['flh heads-up', 'flh', 2, 150],
    ['flh six-max', 'flh', 6, 150],
    ['flo8 heads-up', 'flo8', 2, 100],
    ['flo8 six-max', 'flo8', 6, 100],
  ] as const)(
    '%s: fixed units by street, four wagers a street, exact pot, conserved chips',
    (_name, variant, seats, hands) => {
      for (let h = 0; h < hands; h++) {
        const handSeed = ((7700000 + seats) ^ (h * 2654435761)) >>> 0 || 1;
        const { actions, states, net, counters } = leagueHand(
          handSeed,
          (h % seats) + 1,
          seats,
          STACK_BB,
          variant
        );
        const label = `${variant} seed ${handSeed}`;
        expect(counters.illegal, label).toBe(0);
        expect(counters.truncated, label).toBe(0);

        const put = new Array<number>(seats).fill(0);
        // The blinds: the league posts one small and one big blind and nothing else.
        let pot = SB + BB;
        let level = BB;
        let stage: HandStage = 'preflop';
        let wagers = 1;
        actions.forEach((a, k) => {
          if (a.stage !== stage) {
            stage = a.stage;
            level = 0;
            wagers = 0;
          }
          const unit = stage === 'preflop' || stage === 'flop' ? BB : 2 * BB;
          const at = `${label}, action ${k} (${stage} ${a.action})`;
          // The pot before every action is exactly what has gone in.
          expect(a.pot, at).toBe(pot);
          const gs = states[k];
          expect(gs.fixedBetSize, at).toBe(unit);
          expect(gs.wagersCapped, at).toBe(wagers >= FIXED_LIMIT_MAX_WAGERS);
          if (wagers >= FIXED_LIMIT_MAX_WAGERS) {
            // A capped street offers fold and call, nothing else.
            expect(gs.legalActions, at).toEqual(['fold', 'call']);
            expect(['fold', 'call'], at).toContain(a.action);
          }
          if (a.action === 'bet' || a.action === 'raise') {
            // One unit over the standing level, never more or less.
            expect(a.amount - level, at).toBe(unit);
            expect(gs.minRaiseTo, at).toBe(level + unit);
            expect(gs.maxRaiseTo, at).toBe(level + unit);
            level = a.amount;
            wagers++;
            expect(wagers, at).toBeLessThanOrEqual(FIXED_LIMIT_MAX_WAGERS);
            pot += a.toCall + unit;
            put[a.seatIdx] += a.toCall + unit;
          } else if (a.action === 'call') {
            expect(a.amount, at).toBe(a.toCall);
            pot += a.amount;
            put[a.seatIdx] += a.amount;
          } else {
            expect(['fold', 'check'], at).toContain(a.action);
            expect(a.action === 'check' ? a.toCall : 0, at).toBe(0);
          }
          expect(a.action, at).not.toBe('all_in');
        });

        // Chips are conserved, and nobody can lose more than a hand can cost.
        expect(Math.round(net.reduce((s, n) => s + n, 0) * 100), label).toBe(0);
        for (const n of net) {
          expect(-n, label).toBeLessThanOrEqual(LEAGUE_FIXED_LIMIT_MAX_COMMIT_BB * BB + 1e-9);
        }
        // The winners are paid exactly the pot: the blinds plus every chip put in.
        const paidIn = SB + BB + put.reduce((s, n) => s + n, 0);
        expect(pot, label).toBe(paidIn);
        const won = Math.round(net.filter((n) => n > 0).reduce((s, n) => s + n, 0) * 100);
        const lost = Math.round(net.filter((n) => n < 0).reduce((s, n) => s - n, 0) * 100);
        expect(won, label).toBe(lost);
        expect(lost, label).toBeLessThanOrEqual(Math.round(pot * 100));
      }
    },
    300_000
  );

  it('a capped street has taken exactly four wagers and the league reaches one (flh and flo8)', () => {
    // A street is capped by play, not by construction: this asserts the cap
    // is actually reached in the sample the structure test reads.
    for (const variant of ['flh', 'flo8'] as const) {
      let capped = 0;
      for (let h = 0; h < 200 && capped === 0; h++) {
        const handSeed = (7700002 ^ (h * 2654435761)) >>> 0 || 1;
        capped += leagueHand(handSeed, (h % 2) + 1, 2, STACK_BB, variant).states.filter(
          (gs) => gs.wagersCapped === true
        ).length;
      }
      expect(capped, variant).toBeGreaterThan(0);
    }
  });
});

describe('what the league cannot deal as fixed limit it refuses', () => {
  it('names the fixed-limit games it deals', () => {
    expect(leagueDealsFixedLimit('flh')).toBe(true);
    expect(leagueDealsFixedLimit('flo8')).toBe(true);
    for (const v of ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'short_deck', 'pineapple'])
      expect(leagueDealsFixedLimit(v), v).toBe(false);
    expect(LEAGUE_FIXED_LIMIT_MAX_COMMIT_BB).toBe(24);
  });

  it('refuses a stack a hand can exhaust, a tournament, an ante and an unqualified field population', () => {
    for (const gameVariant of ['flh', 'flo8'] as const) {
      const ok = { gameVariant, stackBB: 100, gameMode: 'cash', ante: 0, humanField: false };
      expect(leagueFixedLimitRefusal(ok as never), gameVariant).toBeNull();
      expect(leagueFixedLimitRefusal({ ...ok, stackBB: 25 } as never), gameVariant).toBeNull();
      expect(leagueFixedLimitRefusal({ ...ok, stackBB: 24 } as never), gameVariant).toMatch(
        /above 24 big blinds/
      );
      expect(
        leagueFixedLimitRefusal({ ...ok, gameMode: 'tournament' } as never),
        gameVariant
      ).toMatch(/cash/);
      expect(leagueFixedLimitRefusal({ ...ok, ante: 1 } as never), gameVariant).toMatch(/ante/);
      expect(leagueFixedLimitRefusal({ ...ok, humanField: true } as never), gameVariant).toMatch(
        /Horses only/
      );
    }
    // The scripted flh field is qualified for flh only, not flo8.
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
    expect(
      leagueFixedLimitRefusal({
        gameVariant: 'nlh',
        stackBB: 100,
        gameMode: 'cash',
        ante: 0,
        humanField: false,
      })
    ).toMatch(/nlh/);
  });

  it('playHand throws instead of dealing a fixed-limit table it has no rules for (flh and flo8)', () => {
    for (const variant of ['flh', 'flo8'] as const) {
      expect(
        () =>
          playHand(
            1,
            1,
            () => ({}),
            undefined,
            undefined,
            variant,
            6,
            LEAGUE_FIXED_LIMIT_MAX_COMMIT_BB
          ),
        variant
      ).toThrow(/above 24 big blinds/);
      expect(
        () =>
          playHand(1, 1, () => ({}), undefined, undefined, variant, 6, 100, {
            gameMode: 'tournament',
            format: 'mtt',
            ante: 0,
          }),
        variant
      ).toThrow(/cash hand/);
    }
  });

  it('a fixed-limit menu refuses a seat that could not cover the wager (flh and flo8)', () => {
    for (const gameVariant of ['flh', 'flo8'] as const) {
      const spot = {
        player: {
          seat: 1,
          stack: 1,
          bet: 0,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        gameVariant,
        pot: 3,
        currentBet: 2,
        lastRaise: 2,
        bigBlind: 2,
        wholeChip: false,
        stage: 'preflop' as const,
        history: [],
      };
      expect(() => leagueActionState(spot), gameVariant).toThrow(/cannot cover a wager/);
      expect(
        leagueActionState({ ...spot, player: { ...spot.player, stack: 200 } }),
        gameVariant
      ).toMatchObject({
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        toCall: 2,
        minRaiseTo: 4,
        maxRaiseTo: 4,
        structure: 'fixed_limit',
        fixedBetSize: 2,
        wagersCapped: false,
      });
    }
  });
});

describe('the fixed-limit cards (flh and flo8)', () => {
  const fixedLimitCards = LEAGUE_MATCHUPS.filter(
    (m) => variantInfo(m.variant ?? 'nlh').isFixedLimit
  );

  it('are on the card, in the domain the league deals, and no longer refused', () => {
    // The Horse-field cards (flh and flo8) and the scripted-field cards
    // (HorseLeagueFixedLimitField.test.ts).
    expect(fixedLimitCards.map((m) => m.name).sort()).toEqual(
      [
        ...FIXED_LIMIT_HOLDEM_CARDS,
        ...FIXED_LIMIT_OMAHA_HILO_CARDS,
        ...FIXED_LIMIT_SCRIPTED_FIELD_CARDS,
        ...FLO8_SCRIPTED_FIELD_CARDS,
      ]
        .map((m) => m.name)
        .sort()
    );
    expect(FIXED_LIMIT_HOLDEM_CARDS.map((m) => [m.name, m.variant, m.seats, m.a, m.b])).toEqual([
      ['flh_priced_preflop', 'flh', 6, { fixedLimitPricedPreflop: true }, {}],
      ['flh_river_full_bet_read', 'flh', 2, { fixedLimitRiverFullBetRead: true }, {}],
    ]);
    expect(FIXED_LIMIT_OMAHA_HILO_CARDS.map((m) => [m.name, m.variant, m.seats, m.a, m.b])).toEqual(
      [
        ['flo8_no_omaha_presumption', 'flo8', 2, { fixedLimitOmahaNoPresumption: true }, {}],
        ['flo8_priced_preflop', 'flo8', 6, { fixedLimitPricedPreflop: true }, {}],
        ['flo8_river_full_bet_read', 'flo8', 2, { fixedLimitRiverFullBetRead: true }, {}],
      ]
    );
    for (const m of fixedLimitCards) {
      // Every fixed-limit card is one playHand deals: it would throw on any other.
      expect(
        leagueFixedLimitRefusal({
          gameVariant: m.variant!,
          stackBB: m.stackBB ?? 100,
          gameMode: m.context?.gameMode ?? 'cash',
          ante: m.context?.ante ?? 0,
          humanField: m.opponentPopulation !== undefined,
          ...(m.opponentPopulation ? { fieldPopulation: m.opponentPopulation } : {}),
        }),
        m.name
      ).toBeNull();
      expect(
        UNMEASURABLE_MATCHUPS.some((u) => u.name === m.name),
        m.name
      ).toBe(false);
    }
    // Every fixed-limit arm still refused says why on the legal game; none
    // repeats the retired no-limit or hold'em-only claims.
    for (const u of UNMEASURABLE_MATCHUPS.filter(
      (r) => variantInfo(r.variant ?? 'nlh').isFixedLimit
    )) {
      expect(u.reason, u.name).not.toContain(
        'playHand deals no-limit and pot-limit betting and has no'
      );
      expect(u.reason, u.name).not.toContain("it deals fixed-limit hold'em only");
      expect(u.reason, u.name).toContain('Refused, though the league deals this game');
      expect(u.reason, u.name).toContain('docs/horse-league-fixed-limit.md');
    }
    expect(existsSync(resolve(__dirname, '../../../docs/horse-league-fixed-limit.md'))).toBe(true);
  });

  it.each([
    ['flh_priced_preflop', 120],
    ['flh_river_full_bet_read', 300],
    ['flo8_no_omaha_presumption', 120],
    ['flo8_priced_preflop', 120],
    ['flo8_river_full_bet_read', 300],
  ] as const)(
    '%s: its arms do not play identical poker, and every action is legal',
    async (name, pairs) => {
      const card = LEAGUE_MATCHUPS.find((m) => m.name === name)!;
      // The seed is fixed, so the count is deterministic for a strategy build.
      // Rare is a measurement; zero is not (LeagueMatchupIsNotInert.test.ts).
      const r = await runMatchup(card, pairs, 20261115);
      expect(r.hands).toBe(pairs * 2);
      expect(r.illegalActions).toBe(0);
      expect(r.truncatedStreets).toBe(0);
      expect(r.correctedActions ?? 0).toBe(0);
      expect(r.brainExceptionFallbacks).toBe(0);
      expect(r.divergentPairs).toBeGreaterThan(0);
      expect(r.inert).toBe(false);
      expect(r.stderr).toBeGreaterThan(0);
      // Production runs every matchup in the compute worker, whose boundary
      // refuses a result it does not know.
      expect(
        horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })
      ).toBe(true);
    },
    300_000
  );
});
