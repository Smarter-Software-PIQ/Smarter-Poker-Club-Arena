/**
 * omahaStrategyInTournaments (owner 2026-11-15 13:16 Chicago: "ALL THE RULES
 * AND THINGS WE ADJUSTED TODAY, ALL NEED TO BE SHARED WITH PLO6 AND
 * IMPLEMENTED FOR TOURNAMENTS AS WELL"), HorseOmahaTournamentScope.ts.
 *
 *  1. The public scope: PLO4/PLO5 tournament hands only, high only, one
 *     board, not All-In-Or-Fold, not Lightning, deeper than the 14 big blind
 *     Omaha push/fold line; never in cash, never PLO6, hi-lo or Hold'em.
 *  2. Each extended option, on a recorded node replayed as a tournament hand:
 *     with the option on and omahaStrategyInTournaments unset it does not act
 *     (no receipt of its family); with both on it acts.
 *  3. The ICM gate: a conversion that adds chips is refused near the bubble
 *     where the engine's survival premium refuses it.
 *  4. Unset and false are the same decisions, and the extension changes
 *     nothing in cash.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import {
  HorseLogic,
  omahaBigDrawAggression,
  omahaNoDrawRaiseFinal,
  omahaTurnRiverRaiseNeedsNutsRule,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB,
  OMAHA_TOURNAMENT_SCOPE_ADMISSION,
  OMAHA_TOURNAMENT_SCOPE_OFF,
  omahaCashOnlyExcludes,
  omahaCategoricalCashOnlyExcludes,
  omahaIcmPremiumOf,
  omahaTournamentExtensionSpot,
  omahaTournamentIcmPremium,
  omahaTournamentScopeNow,
  withOmahaTournamentScope,
} from './HorseOmahaTournamentScope.js';
import { omahaOopTurnFacingBetVerdict } from './HorseOmahaOopChecks.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import { omahaBigDrawVerdict, type OmahaBigDrawInput } from './HorseOmahaBigDrawAggression.js';
import { ploPairedBoardFoldRespectsPrice } from './HorsePloPairedBoardFold.js';
import { omahaReraiseByPositionSpot } from './HorseOmahaOopReraisedPot.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { RECORDED_RIVER_FOLDS, expand } from './HorseOmahaRiverMediumBetCalls.test-support.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';
import TOP_SET from './horseComplaints/plo5-top-set-check-raises-pot-on-the-four-straight-turn.fixture.json';
import QUEENS from './HorseOmahaUnderpair.fixture.json';
import NUT_WRAP from './HorseOmahaBigDrawAggression.plo5-thirteen-out-nut-wrap-checks-and-calls-the-flop.fixture.json';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';
import FD_NUT_WRAP from './HorseOmahaBigDrawAggression.plo4-flush-draw-nut-wrap-checks-and-calls-the-flop.fixture.json';

const EXT: HorseDecideOpts = { omahaStrategyInTournaments: true };
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((c) => ({ rank: c[0] as CardRank, suit: SUIT[c[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4, 5, 6, 101, 102];
type Node = ReturnType<typeof stateAt>;
const asFixture = (f: unknown): ComplaintFixture =>
  JSON.parse(JSON.stringify(f)) as ComplaintFixture;

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

/** Tournament contexts: deep in the money near chip EV, and the stone bubble. */
type Ctx = 'heads_up_itm' | 'bubble' | 'none';
function tournament(node: Node, ctx: Ctx = 'heads_up_itm'): Node {
  const gs = node.gs as unknown as Record<string, unknown>;
  gs.gameMode = 'tournament';
  const chips = node.hero.stack + (node.hero.bet || 0);
  if (ctx === 'heads_up_itm')
    gs.tournament = {
      playersLeft: 2,
      spotsPaid: 9,
      inMoney: true,
      stacks: [chips, chips],
      payoutPct: [30, 20],
    };
  else if (ctx === 'bubble')
    gs.tournament = {
      playersLeft: 10,
      spotsPaid: 9,
      inMoney: false,
      nearBubble: true,
      stacks: Array.from({ length: 10 }, () => chips),
      payoutPct: [30, 20, 14, 10, 8, 6, 5, 4, 3],
    };
  else delete gs.tournament;
  return node;
}

function nodeAt(fx: unknown, ord: number, hole?: string, heroSeat?: number): Node {
  const f = asFixture(fx);
  const node = f.actions.find((a) => a.ord === ord)!;
  if (hole) f.hole[String(heroSeat ?? node.publicNode?.actorSeat ?? node.seat)] = cards(hole);
  return stateAt(f, node);
}

/** Hero (seat 5) checked the recorded node `ord` and seat 1 bet `share` of the pot. */
function facingAfterCheck(fx: unknown, ord: number, share: number, hole?: string): Node {
  const HERO = 5;
  const CALLER = 1;
  const f = asFixture(fx);
  if (hole) f.hole[String(HERO)] = cards(hole);
  const node = f.actions.find((a) => a.ord === ord)!;
  const pn = JSON.parse(JSON.stringify(node.publicNode!)) as NonNullable<
    ComplaintAction['publicNode']
  >;
  const x = Math.round(pn.pot * share);
  f.actions = f.actions.filter((a) => a.ord < ord);
  f.actions.push({
    ord,
    seat: HERO,
    stage: node.stage,
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
  });
  f.actions.push({
    ord: ord + 1,
    seat: CALLER,
    stage: node.stage,
    action: 'bet',
    amount: x,
    origin: 'player',
    isFullRaise: true,
  });
  const row = pn.seats.find((s) => s[0] === CALLER)!;
  row[1] = Math.round((row[1] - x) * 100) / 100;
  row[2] = x;
  row[3] += x;
  const pot = pn.pot;
  pn.pot = pot + x;
  pn.toCall = x;
  pn.currentBet = x;
  pn.minRaiseTo = 2 * x;
  pn.maxRaiseTo = pot + 3 * x;
  pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
  const next: ComplaintAction = {
    ord: ord + 2,
    seat: HERO,
    stage: node.stage,
    action: 'call',
    amount: x,
    origin: 'horse_policy',
    publicNode: pn,
  };
  f.actions.push(next);
  return stateAt(f, next);
}

/**
 * A set raised on the straight-card turn (HorseOmahaBluffCatcherVsValueLeader.test.ts
 * TURN_TOP_SET): today calls; the turn bluff-catcher cell is the cash-only half.
 */
function bluffCatcherTurn(): Node {
  const fx = asFixture(SET_LEADS);
  const jam = fx.actions.find((a) => a.ord === 19)!;
  jam.action = 'raise';
  jam.amount = 848;
  jam.isFullRaise = true;
  const node = fx.actions.find((a) => a.ord === 20)!;
  fx.hole[String(node.seat)] = cards('AdAs8d9c2s');
  const pn = node.publicNode!;
  pn.pot = 1573;
  pn.toCall = 636;
  pn.currentBet = 848;
  pn.seats[3] = [4, 2000, 212, 444, 0, 0, 0];
  pn.seats[4] = [5, 2000, 848, 1080, 0, 0, 0];
  pn.minRaiseTo = 1484;
  pn.maxRaiseTo = 2212;
  pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
  return stateAt(fx, node);
}

/** A recorded PLO4/PLO5 river fold of two pair or better to a 40-70% pot bet. */
function riverFold(n: number): Node {
  const r = JSON.parse(
    JSON.stringify(RECORDED_RIVER_FOLDS.find((x) => x.n === n)!)
  ) as (typeof RECORDED_RIVER_FOLDS)[number];
  const { fx, node } = expand(r);
  return stateAt(fx, node);
}

/**
 * HorseOmahaEliteContinues.test.ts: six-handed pot limit, 100bb (blinds 1/2,
 * dealer seat 6). In position hero on the button opens to 7 and the big blind
 * re-raises pot to 22; out of position hero in the cutoff opens to 7 and the
 * button re-raises pot to 24.
 */
const HERO_ID = '86000001-0000-4000-8000-000000000001';
const VILLAIN_ID = '40000000-0000-4000-8000-0000000000c3';
const otherId = (n: number) => `4000000${n}-0000-4000-8000-0000000000f${n}`;
function threeBet(variant: string, hole: string, outOfPosition = false): Node {
  const heroSeat = outOfPosition ? 5 : 6;
  const villainSeat = outOfPosition ? 6 : 2;
  const to = outOfPosition ? 24 : 22;
  const uid = (n: number) =>
    n === heroSeat ? HERO_ID : n === villainSeat ? VILLAIN_ID : otherId(n);
  const bet: Record<number, number> = { 1: 1, 2: 2, 3: 0, 4: 0, 5: 0, 6: 0 };
  bet[heroSeat] = 7;
  bet[villainSeat] = to;
  const players = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: 200 - bet[n],
        bet: bet[n],
        totalInvested: bet[n],
        cards: n === heroSeat ? cards(hole) : [],
        is_folded: n !== heroSeat && n !== villainSeat,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: n === heroSeat,
      }) as SeatPlayer
  );
  const act = (seat: number, action: string, amount: number, timestamp: number) => ({
    stage: 'preflop',
    seat,
    userId: uid(seat),
    action,
    amount,
    ...(action === 'raise' ? { isFullRaise: true } : {}),
    timestamp,
  });
  const pot = Object.values(bet).reduce((a, b) => a + b, 0);
  const toCall = to - 7;
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet: to,
    toCall,
    minRaise: to - 7,
    minRaiseTo: to + (to - 7),
    maxRaiseTo: to + pot + toCall,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 6,
    gameMode: 'cash',
    actionHistory: outOfPosition
      ? [
          act(1, 'sb', 1, 1),
          act(2, 'bb', 2, 2),
          act(3, 'fold', 0, 3),
          act(4, 'fold', 0, 4),
          act(5, 'raise', 7, 5),
          act(6, 'raise', 24, 6),
          act(1, 'fold', 0, 7),
          act(2, 'fold', 0, 8),
        ]
      : [
          act(1, 'sb', 1, 1),
          act(2, 'bb', 2, 2),
          act(3, 'fold', 0, 3),
          act(4, 'fold', 0, 4),
          act(5, 'fold', 0, 5),
          act(6, 'raise', 7, 6),
          act(1, 'fold', 0, 7),
          act(2, 'raise', 22, 8),
        ],
  } as unknown as HorseGameStateV2;
  return { hero: players[heroSeat - 1], gs } as unknown as Node;
}
/** The measured wide re-raiser (the production PLO5 winner's counted rates). */
function seedWideReRaiser(gs: HorseGameStateV2): void {
  const c: ExploitCounters = freshExploitCounters();
  c.hands = 40;
  c.vpip = 0.88 * 40;
  c.pfr = 0.55 * 40;
  c.rfiOpp = 20;
  c.rfi = 20 * 0.82;
  c.threeBetOpp = 15;
  c.threeBet = 15 * 0.33;
  (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }).exploitCounters.set(
    `${readScopeOf(String(gs.gameVariant), 6)}|${VILLAIN_ID}`,
    c
  );
}

const LEADER = {
  measured: true,
  tightReRaiser: false,
  valueLeader: true,
  postflopAggressor: false,
} as OmahaReadConditional;

interface Outcome {
  actions: string[];
  fires: string[][];
  bytes: string[];
  next: number[];
}
// A tournament record carries wall-clock work times (policyMs, simulationMs)
// and a time-bank think time: not the decision.
const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (/Ms$/.test(k) || k === 'thinkTime' ? undefined : v));
function play(
  build: () => Node,
  opts: HorseDecideOpts,
  reads: OmahaReadConditional | null = null,
  seeds: number[] = SEEDS,
  before?: (st: Node) => void
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { actions: [], fires: [], bytes: [], next: [] };
  for (const s of seeds) {
    HorseMind.reset();
    if (reads)
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => reads) as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    before?.(st);
    const d = withFrozenDecisionClock(() =>
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        telemetry: true,
        ...opts,
      } as never)
    );
    out.next.push(fastRandom());
    out.actions.push(d.action);
    out.bytes.push(bytesOf(d));
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const familyFires = (o: Outcome, family: readonly string[]) =>
  o.fires.flat().filter((f) => family.some((p) => f.startsWith(p))).length;

// ─── 1. the public scope ────────────────────────────────────────────────────

describe('the public scope', () => {
  const base = () => tournament(nodeAt(ACES, 16));

  it('a PLO5 tournament hand deeper than the push/fold line is in scope; cash never is', () => {
    const t = base();
    expect(omahaTournamentExtensionSpot(t.hero, t.gs)).toBe(true);
    const cash = nodeAt(ACES, 16);
    expect(omahaTournamentExtensionSpot(cash.hero, cash.gs)).toBe(false);
    // in cash the cash-only rules are never excluded, whatever the scope
    for (const scope of [OMAHA_TOURNAMENT_SCOPE_OFF, OMAHA_TOURNAMENT_SCOPE_ADMISSION])
      withOmahaTournamentScope(scope, () =>
        expect(omahaCashOnlyExcludes(cash.hero, cash.gs)).toBe(false)
      );
  });

  it('in a tournament the cash-only rules stand aside unless the extension is on', () => {
    const t = base();
    expect(omahaTournamentScopeNow()).toBe(OMAHA_TOURNAMENT_SCOPE_OFF);
    expect(omahaCashOnlyExcludes(t.hero, t.gs)).toBe(true);
    withOmahaTournamentScope({ extension: true, icmRisk: 0.05 }, () =>
      expect(omahaCashOnlyExcludes(t.hero, t.gs)).toBe(false)
    );
    // restored on exit, also after a throw
    expect(() =>
      withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () => {
        throw new Error('x');
      })
    ).toThrow();
    expect(omahaTournamentScopeNow()).toBe(OMAHA_TOURNAMENT_SCOPE_OFF);
  });

  it('All-In-Or-Fold, Lightning, hi-lo, two boards, PLO6 and the push/fold stack are out', () => {
    const cases: Array<(n: Node) => void> = [
      (n) => ((n.gs as { allInOrFold?: boolean }).allInOrFold = true),
      (n) =>
        ((n.gs as { publicMemoryDomain?: unknown }).publicMemoryDomain = {
          speed: 'lightning',
          ante: 0,
        }),
      (n) =>
        ((n.gs as { variantRules?: unknown }).variantRules = {
          ...((n.gs as { variantRules?: object }).variantRules ?? {}),
          splitLow8OrBetter: true,
        }),
      (n) => ((n.gs as { communityCards2?: Card[] }).communityCards2 = cards('2c3c4c5c')),
      (n) => ((n.gs as { gameVariant?: string }).gameVariant = 'plo6'),
      (n) => ((n.gs as { gameVariant?: string }).gameVariant = 'nlh'),
      (n) => {
        n.hero.stack = OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB * n.gs.bigBlind - (n.hero.bet || 0);
      },
    ];
    withOmahaTournamentScope({ extension: true, icmRisk: 0.05 }, () => {
      for (const edit of cases) {
        const t = base();
        edit(t);
        expect(omahaTournamentExtensionSpot(t.hero, t.gs)).toBe(false);
        expect(omahaCashOnlyExcludes(t.hero, t.gs)).toBe(true);
        expect(omahaTournamentIcmPremium(t.hero, t.gs, 100)).toBe(0);
      }
      // one chip above the line is in
      const t = base();
      t.hero.stack = OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB * t.gs.bigBlind - (t.hero.bet || 0) + 1;
      expect(omahaTournamentExtensionSpot(t.hero, t.gs)).toBe(true);
    });
  });

  it('the premium is the engine charge: icmRisk x sqrt(stack share); none in the validator scope', () => {
    expect(omahaIcmPremiumOf(0.1, 25, 100)).toBeCloseTo(0.05, 12);
    expect(omahaIcmPremiumOf(0.1, 400, 100)).toBeCloseTo(0.1, 12);
    expect(omahaIcmPremiumOf(0, 25, 100)).toBe(0);
    const t = base();
    withOmahaTournamentScope({ extension: true, icmRisk: 0.1 }, () =>
      expect(omahaTournamentIcmPremium(t.hero, t.gs, t.hero.stack / 4)).toBeCloseTo(0.05, 9)
    );
    withOmahaTournamentScope(OMAHA_TOURNAMENT_SCOPE_ADMISSION, () =>
      expect(omahaTournamentIcmPremium(t.hero, t.gs, t.hero.stack / 4)).toBe(0)
    );
  });

  it('HorseLogic.decide sets the scope for the decision and restores it', () => {
    const t = tournament(facingAfterCheck(ACES, 18, 0.5), 'bubble');
    const seen: Array<{ extension: boolean; icmRisk: number }> = [];
    const spy = vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(((
      ..._a: unknown[]
    ) => {
      seen.push({ ...omahaTournamentScopeNow() });
      return null;
    }) as never);
    seedFastRandom(1);
    HorseLogic.decide(t.hero, t.gs, LIVE.style, LIVE.mods, { ...EXT, omahaFacingBetEv: true });
    spy.mockRestore();
    expect(seen.length).toBeGreaterThan(0);
    // the extension, with the Horse's own survival premium at the bubble
    expect(seen.every((s) => s.extension && s.icmRisk > 0)).toBe(true);
    expect(omahaTournamentScopeNow()).toBe(OMAHA_TOURNAMENT_SCOPE_OFF);
  });
});

// ─── 2. each extended option: off without the extension, on with it ─────────

interface Case {
  option: keyof HorseDecideOpts;
  build: () => Node;
  family: readonly string[];
  reads?: OmahaReadConditional | null;
  extra?: HorseDecideOpts;
  before?: (st: Node) => void;
  /** how the rule's work shows, when it leaves no receipt of its own */
  detect?: (o: Outcome) => number;
}
const CASES: Case[] = [
  {
    option: 'omahaBareOverpairOopFlopCheck',
    build: () => tournament(nodeAt(ACES, 14)),
    family: ['omaha_bare_overpair_oop_flop_checked'],
  },
  {
    option: 'omahaOopTurnCheckAfterFlopCall',
    build: () => tournament(nodeAt(ACES, 16)),
    family: ['omaha_oop_turn_check_after_flop_call'],
  },
  {
    // facing the turn bet after the check: the nut draw call (fold -> call, ICM-priced)
    option: 'omahaOopTurnCheckAfterFlopCall',
    build: () => tournament(facingAfterCheck(ACES, 16, 0.5)),
    family: ['omaha_oop_turn_check_'],
  },
  {
    option: 'omahaOverpairNoOopBarrelVsValueLeader',
    build: () => tournament(nodeAt(ACES, 16)),
    family: ['omaha_overpair_oop_turn_barrel'],
    reads: LEADER,
  },
  {
    option: 'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
    build: () => tournament(nodeAt(STRAIGHT, 16)),
    family: ['omaha_paired_turn_barrel'],
    reads: LEADER,
  },
  {
    option: 'omahaPairedRiverNoThinLeadVsValueLeader',
    build: () => tournament(nodeAt(ACES, 18)),
    family: ['omaha_paired_river_thin_lead'],
    reads: LEADER,
  },
  {
    option: 'omahaTurnBetNeedsRiverPlan',
    build: () => tournament(nodeAt(STRAIGHT, 16)),
    family: ['omaha_turn_bet_without_river_plan_checked'],
    extra: { mind: false },
  },
  {
    option: 'omahaStreetPlan',
    build: () => tournament(nodeAt(STRAIGHT, 16)),
    family: ['omaha_street_plan_'],
    // a kept bet carries its plan record; a changed one a receipt
    detect: (o) =>
      o.bytes.filter((b) => b.includes('"streetPlan"')).length +
      familyFires(o, ['omaha_street_plan_']),
  },
  {
    option: 'omahaCardImpact',
    build: () => tournament(nodeAt(ACES, 18)),
    family: ['omaha_card_impact_'],
  },
  {
    option: 'omahaFacingBetEv',
    build: () => tournament(facingAfterCheck(ACES, 18, 0.5)),
    family: ['omaha_facing_bet_ev_'],
  },
  {
    option: 'omahaPairedBoardFoldRespectsPrice',
    build: () => tournament(nodeAt(STRAIGHT, 20)),
    family: ['omaha_paired_board_fold_price_respected'],
  },
  {
    option: 'omahaBluffCatcherFoldVsValueLeader',
    build: () => tournament(bluffCatcherTurn()),
    family: ['omaha_bluff_catcher_fold_vs_value_leader'],
    reads: LEADER,
  },
  {
    option: 'omahaPressureNeedsPostflopAggression',
    build: () => tournament(nodeAt(TOP_SET, 20)),
    family: ['omaha_pressure_withheld_value_leader', 'omaha_value_raise_beaten_by_board_flatted'],
    reads: LEADER,
  },
  {
    option: 'omahaNoCallColdFourBetWithoutPremium',
    build: () => tournament(nodeAt(QUEENS, 13)),
    family: ['omaha_no_call_cold_four_bet_without_premium'],
    extra: { mind: false },
  },
  {
    option: 'omahaUnderpairNoMultiwayFlopContinue',
    build: () => tournament(nodeAt(QUEENS, 16)),
    family: ['omaha_underpair_no_multiway_flop_continue'],
    extra: { mind: false },
  },
  {
    option: 'omahaRiverMediumBetStrongHandCalls',
    build: () => tournament(riverFold(59402247)),
    family: ['omaha_river_medium_bet_strong_hand_call'],
    extra: { observeMind: false },
  },
  {
    option: 'omahaBigBetIsPotShare',
    build: () => tournament(riverFold(59402247)),
    family: ['omaha_big_bet_by_pot_share'],
    extra: { observeMind: false },
  },
  {
    option: 'omahaEliteContinuesVsMeasuredWideThreeBettor',
    build: () => tournament(threeBet('plo5', '8d7h6h5c7c')),
    family: ['omaha_elite_continues_vs_measured_wide_three_bettor'],
    before: (st) => seedWideReRaiser(st.gs),
  },
  {
    // out of position facing the 3-bet: the call needs the coordinated strong range
    option: 'omahaOopReraisedPotStrongRange',
    build: () => tournament(threeBet('plo5', 'AhKd9c5s2h', true)),
    family: ['omaha_oop_reraised_call_'],
    before: (st) => seedWideReRaiser(st.gs),
  },
  {
    // the 4-bet out of position without aces or a premium structure: a call
    option: 'omahaReraiseRangeOutOfPosition',
    build: () => tournament(threeBet('plo5', 'KsKhQdJc9s', true)),
    family: ['omaha_reraise_by_position_'],
    before: (st) => seedWideReRaiser(st.gs),
  },
];

describe.each(CASES)('$option in a tournament hand', (c) => {
  it('option on, extension unset: it does not act; extension on: it acts', () => {
    const opts: HorseDecideOpts = { ...c.extra, [c.option]: true };
    const off = play(c.build, opts, c.reads ?? null, SEEDS, c.before);
    const on = play(c.build, { ...opts, ...EXT }, c.reads ?? null, SEEDS, c.before);
    const shown = c.detect ?? ((o: Outcome) => familyFires(o, c.family));
    expect(shown(off)).toBe(0);
    expect(shown(on)).toBeGreaterThan(0);
  });
});

describe('the exported rules in a tournament hand (forced input decisions)', () => {
  /** TOP_SET turn: top set, the fourth straight card, facing a pot bet out of position. */
  const topSetTurn = () => tournament(nodeAt(TOP_SET, 20));

  it('omahaTurnRiverRaiseNeedsNuts: a forced non-nut raise becomes a call or a fold only with the extension', () => {
    const st = topSetTurn();
    const raise: HorseDecision = {
      action: 'raise',
      amount: st.gs.maxRaiseTo as number,
      thinkTime: 1000,
    };
    const opts: HorseDecideOpts = { omahaTurnRiverRaiseNeedsNuts: true };
    const off = omahaTurnRiverRaiseNeedsNutsRule(raise, st.hero, st.gs, opts);
    expect(off).toBe(raise);
    const on = withOmahaTournamentScope({ extension: true, icmRisk: 0.03 }, () =>
      omahaTurnRiverRaiseNeedsNutsRule(raise, st.hero, st.gs, opts)
    );
    expect(['call', 'fold']).toContain(on.action);
  });

  it('omahaNoDrawRaiseOutOfPosition: a draw raise out of position is a call only with the extension', () => {
    const st = tournament(nodeAt(NUT_WRAP, 12));
    const opp = st.gs.players.find(
      (p) => p.seat !== st.hero.seat && !p.is_folded && !p.is_sitting_out
    )!;
    (st.gs as { dealerSeat?: number }).dealerSeat = opp.seat;
    const owed = Number.isFinite(st.gs.toCall)
      ? (st.gs.toCall as number)
      : st.gs.currentBet - st.hero.bet;
    expect(owed).toBeGreaterThan(0);
    const raise: HorseDecision = { action: 'raise', amount: st.gs.currentBet * 3, thinkTime: 1 };
    const opts: HorseDecideOpts = { omahaNoDrawRaiseOutOfPosition: true };
    expect(omahaNoDrawRaiseFinal(raise, st.hero, st.gs, opts)).toBe(raise);
    const on = withOmahaTournamentScope({ extension: true, icmRisk: 0.03 }, () =>
      omahaNoDrawRaiseFinal(raise, st.hero, st.gs, opts)
    );
    expect(on.action).toBe('call');
  });

  it('omahaBigDrawAggression: the combo draw in position wagers only with the extension (premium 0)', () => {
    const st = tournament(nodeAt(FD_NUT_WRAP, 10));
    (st.gs as { dealerSeat?: number }).dealerSeat = st.hero.seat;
    const owed = Number.isFinite(st.gs.toCall)
      ? (st.gs.toCall as number)
      : st.gs.currentBet - st.hero.bet;
    const passive: HorseDecision =
      owed > 0.005
        ? { action: 'call', amount: Math.min(owed, st.hero.stack), thinkTime: 1 }
        : { action: 'check', thinkTime: 1 };
    const opts: HorseDecideOpts = { omahaBigDrawAggression: true, mind: false };
    const cashLike = omahaBigDrawAggression(passive, st.hero, { ...st.gs, gameMode: 'cash' }, opts);
    expect(['bet', 'raise', 'all_in']).toContain(cashLike.action);
    expect(omahaBigDrawAggression(passive, st.hero, st.gs, opts)).toBe(passive);
    const on = withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () =>
      omahaBigDrawAggression(passive, st.hero, st.gs, opts)
    );
    expect(on.action).toBe(cashLike.action);
  });

  it('the re-raise-by-position spot (omahaReraiseRange*, omahaOopReraisedPotStrongRange) opens only with the extension', () => {
    const st = tournament(nodeAt(QUEENS, 13));
    const off = omahaReraiseByPositionSpot(st.hero, st.gs);
    const on = withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () =>
      omahaReraiseByPositionSpot(st.hero, st.gs)
    );
    if (off !== null) expect(off.input.tournament).toBe(true);
    expect(on).not.toBeNull();
    expect(on!.input.tournament).toBe(false);
  });

  it('omahaManiacReRaiseWidthMeasured: the measured re-raise width read is asked for in a tournament only with the extension', () => {
    const t = tournament(nodeAt(QUEENS, 13));
    const asked: unknown[] = [];
    const spy = vi
      .spyOn(HorseMind, 'setDecisionReadOptions')
      .mockImplementation(((o: unknown) => void asked.push(o)) as never);
    HorseLogic.prepareOriginalReads(t.hero, t.gs, {
      omahaManiacReRaiseWidthMeasured: true,
      observeMind: false,
    });
    HorseLogic.prepareOriginalReads(t.hero, t.gs, {
      omahaManiacReRaiseWidthMeasured: true,
      observeMind: false,
      ...EXT,
    });
    spy.mockRestore();
    expect((asked[0] as { omahaManiacReRaiseMeasured?: boolean }).omahaManiacReRaiseMeasured).toBe(
      undefined
    );
    expect((asked[1] as { omahaManiacReRaiseMeasured?: boolean }).omahaManiacReRaiseMeasured).toBe(
      true
    );
  });
});

// ─── 3. the ICM gate ────────────────────────────────────────────────────────

describe('the ICM gate: a chip-adding conversion pays the survival premium', () => {
  it('facing-bet EV: the same call clears the cash margin and is refused under a bubble premium', () => {
    const st = tournament(facingAfterCheck(ACES, 18, 0.5));
    const spot = withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () =>
      omahaFacingBetEvSpot(st.hero, st.gs)
    )!;
    expect(spot).not.toBeNull();
    const at = (riskPremium: number) =>
      omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null, {
        riskPremium,
      })!;
    const v0 = at(0);
    // the premium that makes this exact call refused, if the call is made at all
    if (v0.call) {
      const need = v0.ev / (spot.winnable + spot.paid) - 0.02;
      expect(at(need + 0.01).call).toBe(false);
      expect(at(need + 0.01).margin).toBeGreaterThan(v0.margin);
    }
    expect(at(0.15).margin).toBeCloseTo((0.02 + 0.15) * (spot.winnable + spot.paid), 9);
  });

  it('the OOP turn nut-draw call: kept heads-up in the money, refused at the stone bubble at 0.75 pot', () => {
    const verdictAt = (ctx: Ctx, share: number) => {
      const st = tournament(facingAfterCheck(ACES, 16, share), ctx);
      const risk = HorseLogic.__testables.icmRisk(
        st.gs,
        st.hero.stack / st.gs.bigBlind,
        true,
        true,
        st.hero.user_id
      );
      return {
        risk,
        verdict: withOmahaTournamentScope({ extension: true, icmRisk: risk }, () =>
          omahaOopTurnFacingBetVerdict(st.hero, st.gs)
        ),
        cash: omahaOopTurnFacingBetVerdict(
          facingAfterCheck(ACES, 16, share).hero,
          facingAfterCheck(ACES, 16, share).gs
        ),
      };
    };
    const itm = verdictAt('heads_up_itm', 0.75);
    const bubble = verdictAt('bubble', 0.75);
    expect(itm.cash).toBe('call_nut_draw');
    expect(itm.verdict).toBe('call_nut_draw');
    expect(bubble.risk).toBeGreaterThan(itm.risk);
    expect(bubble.verdict).not.toBe('call_nut_draw');
    // in the decision: at the bubble the owner-ruled nut-draw call is not made
    const onBubble = play(() => tournament(facingAfterCheck(ACES, 16, 0.75), 'bubble'), {
      omahaOopTurnCheckAfterFlopCall: true,
      ...EXT,
    });
    expect(familyFires(onBubble, ['omaha_oop_turn_check_call_nut_draw'])).toBe(0);
    const onItm = play(() => tournament(facingAfterCheck(ACES, 16, 0.75), 'heads_up_itm'), {
      omahaOopTurnCheckAfterFlopCall: true,
      ...EXT,
    });
    expect(onItm.actions).toEqual(SEEDS.map(() => 'call'));
  });

  it('the paired-board price exception: within its bar in chips, refused with the premium', () => {
    const st = nodeAt(STRAIGHT, 20);
    const input = {
      gameVariant: st.gs.gameVariant,
      board: st.gs.communityCards ?? [],
      hero: st.hero,
      players: st.gs.players ?? [],
      currentBet: st.gs.currentBet,
      toCall: st.gs.toCall,
      pot: st.gs.pot,
    };
    expect(ploPairedBoardFoldRespectsPrice(input)).toBe(true);
    expect(ploPairedBoardFoldRespectsPrice({ ...input, icmRisk: 0 })).toBe(true);
    expect(ploPairedBoardFoldRespectsPrice({ ...input, icmRisk: 0.15 })).toBe(false);
  });

  it('big-draw aggression: the wager is withheld when the premium makes it worth less than the passive line', () => {
    const input: OmahaBigDrawInput = {
      variant: 'plo4',
      street: 'flop',
      hole: cards('AhJh9s7c'),
      board: cards('Th8h2c'),
      action: 'check',
      pot: 20,
      toCall: 0,
      stack: 200,
      heroBet: 0,
      currentBet: 0,
      minRaiseTo: 2,
      maxRaiseTo: 20,
      legalActions: ['fold', 'check', 'bet', 'all_in'],
      opponents: [{ stack: 200, bet: 0, allIn: false, foldToBet: 0.1 }],
      inPosition: true,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
      wagersCapped: false,
    };
    const cash = omahaBigDrawVerdict(input)!;
    const priced = omahaBigDrawVerdict({ ...input, icmRisk: 0.15 })!;
    expect(cash).not.toBeNull();
    expect(priced.evAggressive).toBeLessThan(cash.evAggressive);
    expect(priced.evPassive).toBe(cash.evPassive);
    if (cash.wager !== null && priced.wager === null) expect(priced.withheld).toBe('passive_ev');
    expect(omahaBigDrawVerdict({ ...input, icmRisk: 0 })).toEqual(cash);
  });

  it('a fold or check conversion is never premium-priced: the bare-overpair check fires at the bubble as in the money', () => {
    for (const ctx of ['heads_up_itm', 'bubble'] as const) {
      const on = play(() => tournament(nodeAt(ACES, 14), ctx), {
        omahaBareOverpairOopFlopCheck: true,
        ...EXT,
      });
      expect(on.actions).toEqual(SEEDS.map(() => 'check'));
    }
  });
});

// ─── 4. unset, false, and cash ──────────────────────────────────────────────

const DAY: HorseDecideOpts = {
  omahaBareOverpairOopFlopCheck: true,
  omahaOopTurnCheckAfterFlopCall: true,
  omahaOverpairNoOopBarrelVsValueLeader: true,
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
  omahaPairedRiverNoThinLeadVsValueLeader: true,
  omahaTurnBetNeedsRiverPlan: true,
  omahaBluffCatcherFoldVsValueLeader: true,
  omahaRiverMediumBetStrongHandCalls: true,
  omahaBigBetIsPotShare: true,
  omahaPairedBoardFoldRespectsPrice: true,
  omahaPressureNeedsPostflopAggression: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaOopReraisedPotStrongRange: true,
  omahaReraisedPotFlopContinueNeedsEquityShape: true,
  omahaRiverNutBlockerBluffReachable: true,
  omahaCardImpact: true,
  omahaStreetPlan: true,
  omahaFacingBetEv: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaReraiseRangeOutOfPosition: true,
  omahaReraiseRangeEarlyPosition: true,
  omahaBigDrawAggression: true,
  omahaNoDrawRaiseOutOfPosition: true,
};
const NODES: Array<[string, () => Node]> = [
  ['59517323 flop', () => nodeAt(ACES, 14)],
  ['59517323 turn', () => nodeAt(ACES, 16)],
  ['59517323 turn facing a half-pot bet', () => facingAfterCheck(ACES, 16, 0.5)],
  ['59517323 river facing a pot bet', () => facingAfterCheck(ACES, 18, 1)],
  ['59521326 turn', () => nodeAt(STRAIGHT, 16)],
  ['59521326 river fold', () => nodeAt(STRAIGHT, 20)],
  ['top set turn facing a bet', () => nodeAt(TOP_SET, 20)],
  ['queens cold 4-bet', () => nodeAt(QUEENS, 13)],
  ['queens multiway flop', () => nodeAt(QUEENS, 16)],
];

describe('unset and false decide the same, with every option of the day on', () => {
  it.each(NODES)('%s, as a tournament hand at the bubble', (_n, build) => {
    const b = () => tournament(build(), 'bubble');
    const unset = play(b, DAY, LEADER);
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
      const o = play(b, { ...DAY, omahaStrategyInTournaments: v }, LEADER);
      expect(o.bytes).toEqual(unset.bytes);
      expect(o.next).toEqual(unset.next);
    }
  });

  it.each(NODES)('%s, in cash: the extension changes nothing', (_n, build) => {
    const unset = play(build, DAY, LEADER);
    const on = play(build, { ...DAY, ...EXT }, LEADER);
    expect(on.bytes).toEqual(unset.bytes);
    expect(on.next).toEqual(unset.next);
  });
});

describe('the receipt validator admits the tournament answers', () => {
  it('every decision of the day on, with the extension, in a tournament: no refused receipt', async () => {
    const { horseDecisionReceiptRefusal } = await import('./horseDecision/responseValidation.js');
    for (const [, build] of NODES) {
      for (const ctx of ['heads_up_itm', 'bubble'] as const) {
        for (const seed of SEEDS.slice(0, 4)) {
          HorseMind.reset();
          seedFastRandom(seed);
          const st = tournament(build(), ctx);
          const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { ...DAY, ...EXT });
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), String(st.gs.gameVariant), {
              player: st.hero,
              gameState: st.gs,
            } as never)
          ).toBeNull();
        }
      }
    }
  });
});

void (null as unknown as HorseGameStateV2 | SeatPlayer);

// ─── ROWFIX 2026-11-18: omahaTournamentsExcludeCategoricalRules (default OFF) ───
// With omahaStrategyInTournaments on, the rules HorseOmahaRuleSites classes 'categorical' stay cash-only when
// this option is on; the priced and outside rules keep the extension. Off (absent or false) is byte-identical.
describe('omahaTournamentsExcludeCategoricalRules: the categorical rules stay cash-only in tournaments', () => {
  const EXCL = { extension: true, icmRisk: 0.03, excludeCategorical: true } as const;
  it('the scope read: identical to omahaCashOnlyExcludes unless the option is on, and never in cash', () => {
    const t = tournament(nodeAt(ACES, 16));
    const cash = nodeAt(ACES, 16);
    for (const scope of [
      OMAHA_TOURNAMENT_SCOPE_OFF,
      OMAHA_TOURNAMENT_SCOPE_ADMISSION,
      { extension: true, icmRisk: 0.05 },
      { extension: true, icmRisk: 0.05, excludeCategorical: false },
    ])
      withOmahaTournamentScope(scope, () => {
        expect(omahaCategoricalCashOnlyExcludes(t.hero, t.gs)).toBe(
          omahaCashOnlyExcludes(t.hero, t.gs)
        );
        expect(omahaCategoricalCashOnlyExcludes(cash.hero, cash.gs)).toBe(false);
      });
    withOmahaTournamentScope(EXCL, () => {
      expect(omahaCashOnlyExcludes(t.hero, t.gs)).toBe(false);
      expect(omahaCategoricalCashOnlyExcludes(t.hero, t.gs)).toBe(true);
      expect(omahaCategoricalCashOnlyExcludes(cash.hero, cash.gs)).toBe(false);
    });
  });
  it('the forced-input categorical rules stand aside; a rule classed outside still acts', () => {
    const st = tournament(nodeAt(TOP_SET, 20));
    const raise: HorseDecision = {
      action: 'raise',
      amount: st.gs.maxRaiseTo as number,
      thinkTime: 1,
    };
    const nuts: HorseDecideOpts = { omahaTurnRiverRaiseNeedsNuts: true };
    expect(
      withOmahaTournamentScope(EXCL, () =>
        omahaTurnRiverRaiseNeedsNutsRule(raise, st.hero, st.gs, nuts)
      )
    ).toBe(raise);
    const wrap = tournament(nodeAt(NUT_WRAP, 12));
    const opp = wrap.gs.players.find(
      (p) => p.seat !== wrap.hero.seat && !p.is_folded && !p.is_sitting_out
    )!;
    (wrap.gs as { dealerSeat?: number }).dealerSeat = opp.seat;
    const drawRaise: HorseDecision = {
      action: 'raise',
      amount: wrap.gs.currentBet * 3,
      thinkTime: 1,
    };
    const bar: HorseDecideOpts = { omahaNoDrawRaiseOutOfPosition: true };
    expect(
      withOmahaTournamentScope(EXCL, () =>
        omahaNoDrawRaiseFinal(drawRaise, wrap.hero, wrap.gs, bar)
      )
    ).toBe(drawRaise);
    // omahaBigDrawAggression is not categorical: it keeps the extension
    const fd = tournament(nodeAt(FD_NUT_WRAP, 10));
    (fd.gs as { dealerSeat?: number }).dealerSeat = fd.hero.seat;
    const owed = Number.isFinite(fd.gs.toCall)
      ? (fd.gs.toCall as number)
      : fd.gs.currentBet - fd.hero.bet;
    const passive: HorseDecision =
      owed > 0.005
        ? { action: 'call', amount: Math.min(owed, fd.hero.stack), thinkTime: 1 }
        : { action: 'check', thinkTime: 1 };
    const big: HorseDecideOpts = { omahaBigDrawAggression: true, mind: false };
    const open = withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () =>
      omahaBigDrawAggression(passive, fd.hero, fd.gs, big)
    );
    const excl = withOmahaTournamentScope({ ...EXCL, icmRisk: 0 }, () =>
      omahaBigDrawAggression(passive, fd.hero, fd.gs, big)
    );
    expect(excl).toEqual(open);
    expect(['bet', 'raise', 'all_in']).toContain(open.action);
  });
  const CATEGORICAL_RECEIPT =
    /^(omaha_turn_river_raise_needs_nuts_|omaha_oop_|omaha_bare_overpair_|omaha_overpair_no_oop_|omaha_paired_(turn|river)_|omaha_pressure_needs_|omaha_bluff_catcher_fold_vs_value_leader|omaha_underpair_no_multiway_|omaha_made_hand_defense_vs_value_leader|omaha_no_draw_raise_)/;
  it.each(NODES)(
    '%s: off and unset decide the same; in cash the option changes nothing',
    (_n, build) => {
      const b = () => tournament(build(), 'bubble');
      const base = play(b, { ...DAY, ...EXT }, LEADER);
      for (const v of [false, undefined])
        expect(
          play(b, { ...DAY, ...EXT, omahaTournamentsExcludeCategoricalRules: v }, LEADER).bytes
        ).toEqual(base.bytes);
      const cashBase = play(build, { ...DAY, ...EXT }, LEADER);
      const cashOn = play(
        build,
        { ...DAY, ...EXT, omahaTournamentsExcludeCategoricalRules: true },
        LEADER
      );
      expect(cashOn.bytes).toEqual(cashBase.bytes);
      expect(cashOn.next).toEqual(cashBase.next);
    }
  );
  it('in tournament hands no categorical receipt fires with it on, and the corpus reaches them with it off', () => {
    let reachedOff = 0;
    for (const [, build] of NODES) {
      const b = () => tournament(build(), 'bubble');
      const off = play(b, { ...DAY, ...EXT }, LEADER);
      const on = play(b, { ...DAY, ...EXT, omahaTournamentsExcludeCategoricalRules: true }, LEADER);
      reachedOff += off.fires.flat().filter((f) => CATEGORICAL_RECEIPT.test(f)).length;
      expect(on.fires.flat().filter((f) => CATEGORICAL_RECEIPT.test(f))).toEqual([]);
    }
    expect(reachedOff).toBeGreaterThan(0);
  });
});
