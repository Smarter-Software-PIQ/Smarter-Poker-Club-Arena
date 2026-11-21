/**
 * omahaStrategyInTournaments (owner 2026-11-15 13:16 Chicago): THE SAME
 * PRECEDENCE LAWS IN A TOURNAMENT HAND. Generated from
 * HorseOmahaStrategyPrecedence.test.ts (the cash laws, unchanged): every node
 * is the same recorded decision of hands 59517323 and 59521326, replayed as a
 * PLO5 tournament hand (gameMode tournament, a trusted field context ten left
 * and twelve paid, so in the money with chip-EV-like stacks: the survival
 * premium is small), and every arm also carries omahaStrategyInTournaments.
 * The owner's rulings stay final in tournaments too: the owner-ruled checks
 * and folds, the facing-bet EV as the single river decider and the
 * failure-keeps-the-decision rule hold exactly as in cash.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, omahaStreetPlanFromRiver, type HorseDecideOpts } from './HorseLogic.js';
import { withOmahaTournamentScope } from './HorseOmahaTournamentScope.js';

type HorseDecision = ReturnType<typeof HorseLogic.decide>;
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  omahaBareOverpairOopFlopSpot,
  omahaOopTurnCheckAfterFlopCallSpot,
  omahaOopTurnFacingBetVerdict,
  omahaPairedBoardNoBoatSpot,
  omahaPairedRiverThinLeadSpot,
  omahaPairedTurnBarrelSpot,
} from './HorseOmahaOopChecks.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { readFileSync } from 'node:fs';
import {
  OptionSwitchHolder,
  optionSwitchDecisionOpts,
  type OptionSwitchReading,
} from './HorseOptionSwitch.js';
import { STYLE_SWITCH_POLL_MS, STYLE_SWITCH_STALE_MS } from './HorseStyleSwitch.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const forced = vi.hoisted(() => ({
  /** card impact proposes a bet where the engine checked */
  impactBet: false,
  /** card impact proposes a check where the engine bet */
  impactCheck: false,
  impactThrows: false,
  planThrows: false,
  /** the facing-bet verdict: null = the real one */
  evCall: null as boolean | null,
  evThrows: false,
  evCalls: 0,
  /** card impact proposes the full pot where the engine bet less */
  impactBigger: false,
  /** the made-hand defence checks every wager facing no bet (its own test replaced) */
  defenceChecks: false,
  /** strong-hand value proposes a half-pot bet where the final answer is a check */
  strongBet: false,
  /** the turn river-plan test refuses a bet above this amount */
  lacksPlanAbove: null as number | null,
  /** the street plan prices the check line far above the bet line */
  planChecks: false,
  planRuns: 0,
  /** the turn plan, re-read on the river, calls this river */
  planCallsRiver: false,
  /** how often the plan's river verdict was asked */
  planRiverVerdicts: 0,
  /** the big-draw rule prices a half-pot bet above the check */
  drawBet: false,
}));

vi.mock('./HorseOmahaBigDrawAggression.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaBigDrawAggression.js')>();
  return {
    ...real,
    omahaBigDrawVerdict: (input: { action: string; pot: number }, ...rest: unknown[]) => {
      if (forced.drawBet && input.action === 'check')
        return { wager: { action: 'bet', amount: Math.round(input.pot * 0.5) } };
      return (real.omahaBigDrawVerdict as (...a: unknown[]) => unknown)(input, ...rest);
    },
  };
});

vi.mock('./HorseOmahaCardImpact.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaCardImpact.js')>();
  return {
    ...real,
    omahaCardImpactDecision: (
      decision: HorseDecision,
      ...rest: [never, { pot: number }, never]
    ) => {
      if (forced.impactThrows) throw new Error('forced card impact failure');
      if (forced.impactBet && decision.action === 'check')
        return {
          changed: 'press_bet',
          decision: { ...decision, action: 'bet', amount: Math.round(rest[1].pot * 0.5) },
        };
      if (forced.impactBigger && decision.action === 'bet')
        return {
          changed: 'resized',
          decision: { ...decision, amount: Math.round(rest[1].pot) },
        };
      if (forced.impactCheck && decision.action !== 'check') {
        const checked = { ...decision, action: 'check' };
        delete checked.amount;
        return { changed: 'defence_check', decision: checked };
      }
      return (real.omahaCardImpactDecision as (...a: unknown[]) => unknown)(decision, ...rest);
    },
  };
});
vi.mock('./HorseOmahaStreetPlan.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaStreetPlan.js')>();
  return {
    ...real,
    omahaStreetPlanTurnSpot: (...a: unknown[]) => {
      if (forced.planThrows) throw new Error('forced street plan failure');
      return (real.omahaStreetPlanTurnSpot as (...x: unknown[]) => unknown)(...a);
    },
    omahaStreetPlan: (...a: unknown[]) => {
      forced.planRuns++;
      const plan = (real.omahaStreetPlan as (...x: unknown[]) => unknown)(...a) as {
        lines: { ev: number }[];
      } | null;
      if (!forced.planChecks || !plan || plan.lines.length < 2) return plan;
      const lines = plan.lines.map((l, i) => (i === 0 ? { ...l, ev: plan.lines[1].ev + 1e6 } : l));
      return { ...plan, lines };
    },
    omahaPlanRiverVerdict: (...a: unknown[]) => {
      forced.planRiverVerdicts++;
      return forced.planCallsRiver
        ? 'call'
        : (real.omahaPlanRiverVerdict as (...x: unknown[]) => unknown)(...a);
    },
  };
});
vi.mock('./HorseOmahaMadeHandDefense.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaMadeHandDefense.js')>();
  return {
    ...real,
    omahaBeatenNoBet: (decision: HorseDecision, ...rest: unknown[]) => {
      if (
        forced.defenceChecks &&
        rest[2] === true &&
        ['bet', 'raise', 'all_in'].includes(decision.action)
      ) {
        const checked = { ...decision, action: 'check' };
        delete checked.amount;
        return { decision: checked, changed: 'river_check' };
      }
      return (real.omahaBeatenNoBet as (...x: unknown[]) => unknown)(decision, ...rest);
    },
  };
});
vi.mock('./HorseOmahaStrongHandValue.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaStrongHandValue.js')>();
  return {
    ...real,
    omahaStrongHandValueDecision: (
      decision: HorseDecision,
      ...rest: [never, { pot: number }, never]
    ) => {
      if (forced.strongBet && decision.action === 'check')
        return {
          changed: 'value_bet',
          priced: true,
          decision: { ...decision, action: 'bet', amount: Math.round(rest[1].pot * 0.5) },
        };
      return (real.omahaStrongHandValueDecision as (...a: unknown[]) => unknown)(decision, ...rest);
    },
  };
});
vi.mock('./HorseOmahaOopChecks.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaOopChecks.js')>();
  return {
    ...real,
    omahaTurnBetLacksRiverPlan: (...a: unknown[]) =>
      forced.lacksPlanAbove !== null
        ? Number(a[2]) > forced.lacksPlanAbove
        : (real.omahaTurnBetLacksRiverPlan as (...x: unknown[]) => unknown)(...a),
  };
});
vi.mock('./HorseOmahaFacingBetEv.js', async (original) => {
  const real = await original<typeof import('./HorseOmahaFacingBetEv.js')>();
  return {
    ...real,
    omahaFacingBetEvVerdict: (...a: unknown[]) => {
      forced.evCalls++;
      if (forced.evThrows) throw new Error('forced facing-bet failure');
      const v = (real.omahaFacingBetEvVerdict as (...x: unknown[]) => unknown)(...a);
      if (forced.evCall === null || v === null) return v;
      return { ...(v as object), call: forced.evCall };
    },
  };
});

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((c) => ({ rank: c[0] as CardRank, suit: SUIT[c[1]] }));
const FLOP = 14;
const TURN = 16;
const RIVER = 18;
const HERO = 5;
const CALLER = 1;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 101, 102, 103, 104, 105, 106, 107, 108];
type Node = ReturnType<typeof stateAt>;
const asFixture = (f: unknown): ComplaintFixture =>
  JSON.parse(JSON.stringify(f)) as ComplaintFixture;

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(forced, {
    impactBet: false,
    impactCheck: false,
    impactThrows: false,
    planThrows: false,
    evCall: null,
    evThrows: false,
    evCalls: 0,
    impactBigger: false,
    defenceChecks: false,
    strongBet: false,
    lacksPlanAbove: null,
    planChecks: false,
    planRuns: 0,
    planCallsRiver: false,
    planRiverVerdicts: 0,
    drawBet: false,
  });
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

/**
 * The recorded node as a tournament hand: two left of a paid field, deep
 * stacks. The survival premium is at its smallest there (V23: heads-up of an
 * MTT plays near chip EV), so these laws test the ORDER of the rules, as the
 * cash laws do; the premium's own effect near the bubble is tested in
 * HorseOmahaStrategyInTournaments.test.ts.
 */
function asTournament(node: Node): Node {
  const gs = node.gs as unknown as Record<string, unknown>;
  gs.gameMode = 'tournament';
  const heroChips = node.hero.stack + (node.hero.bet || 0);
  gs.tournament = {
    playersLeft: 2,
    spotsPaid: 9,
    inMoney: true,
    stacks: [heroChips, heroChips],
    payoutPct: [30, 20],
  };
  return node;
}

function nodeAt(fx: unknown, ord: number, hole?: string): Node {
  const f = asFixture(fx);
  if (hole) f.hole[String(HERO)] = cards(hole);
  return asTournament(stateAt(f, f.actions.find((a) => a.ord === ord)!));
}

/** Hero checked the recorded node `ord` and the caller bet `share` of the pot. */
function facingAfterCheck(fx: unknown, ord: number, share: number, hole?: string): Node {
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
  return asTournament(stateAt(f, next));
}

const leader = { measured: true, tightReRaiser: false, valueLeader: true } as OmahaReadConditional;

interface Outcome {
  actions: string[];
  amounts: (number | null)[];
  fires: string[][];
  bytes: string[];
  /** the worker receipt validator's refusal of each decision (null = admitted) */
  refusals: (string | null)[];
}
// A tournament decision record carries wall-clock work times (policyMs,
// simulationMs: the Phase 7/8 budgets) and a time-bank think time; they are
// not the decision, so the byte comparison leaves them out.
const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (/Ms$/.test(k) || k === 'thinkTime' ? undefined : v));
function play(build: () => Node, opts: HorseDecideOpts, valueLeader = true): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { actions: [], amounts: [], fires: [], bytes: [], refusals: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (valueLeader)
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => leader) as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = withFrozenDecisionClock(() =>
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        omahaStrategyInTournaments: true,
        telemetry: true,
        ...opts,
      } as never)
    );
    out.actions.push(d.action);
    out.amounts.push(d.amount ?? null);
    out.bytes.push(bytesOf(d));
    out.refusals.push(
      horseDecisionReceiptRefusal(structuredClone(d), String(st.gs.gameVariant), {
        player: st.hero,
        gameState: st.gs,
      })
    );
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const all = (o: Outcome, action: string) => o.actions.every((a) => a === action);
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;

/** The owner-ruled options. */
const OWNER: HorseDecideOpts = {
  omahaBareOverpairOopFlopCheck: true,
  omahaOopTurnCheckAfterFlopCall: true,
  omahaOverpairNoOopBarrelVsValueLeader: true,
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
  omahaPairedRiverNoThinLeadVsValueLeader: true,
  omahaTurnBetNeedsRiverPlan: true,
};
/** Every option of the 2026-11-15 strategy head. */
const ALL: HorseDecideOpts = {
  ...OWNER,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaReraisedFoldVsTight: true,
  omahaBluffCatcherFoldVsValueLeader: true,
  omahaRiverMediumBetStrongHandCalls: true,
  omahaBigBetIsPotShare: true,
  omahaPairedBoardFoldRespectsPrice: true,
  omahaPressureNeedsPostflopAggression: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
  omahaVpipFloorByLimp: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaOopReraisedPotStrongRange: true,
  omahaReraisedPotFlopContinueNeedsEquityShape: true,
  omahaRiverNutBlockerBluffReachable: true,
  omahaSmallBlindSteal: true,
  omahaCardImpact: true,
  omahaStreetPlan: true,
  omahaFacingBetEv: true,
  omahaBigDrawAggression: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaStreetPlanFlop: true,
  omahaStreetPlanThreeWay: true,
  omahaPreflopStackPlan: true,
};
const ARMS: [string, HorseDecideOpts][] = [
  ['the owner-ruled options alone', OWNER],
  ['+ omahaCardImpact', { ...OWNER, omahaCardImpact: true }],
  ['+ omahaStreetPlan', { ...OWNER, omahaStreetPlan: true }],
  ['+ omahaFacingBetEv', { ...OWNER, omahaFacingBetEv: true }],
  ['+ omahaBigDrawAggression', { ...OWNER, omahaBigDrawAggression: true }],
  [
    '+ omahaBigDrawAggression and omahaStreetPlan',
    { ...OWNER, omahaBigDrawAggression: true, omahaStreetPlan: true },
  ],
  // the street plan's flop, three-way and preflop layers (owner 2026-11-15
  // 11:43): inside the owner-ruled chain, so every ruling below holds.
  [
    '+ omahaStreetPlanFlop, omahaStreetPlanThreeWay and omahaPreflopStackPlan',
    {
      ...OWNER,
      omahaStreetPlanFlop: true,
      omahaStreetPlanThreeWay: true,
      omahaPreflopStackPlan: true,
    },
  ],
  ['every option on', ALL],
];

/** A hand with no out on 5d 8d 9h 2h: aces, no flush draw, no straight draw. */
const NO_OUT = 'AsAcKcKs3c';

describe('TOURNAMENT the recorded spots are the ruled spots', () => {
  it('flop, turn, river of 59517323 and the pairing turn of 59521326', () =>
    withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () => {
      const flop = nodeAt(ACES, FLOP);
      expect(omahaBareOverpairOopFlopSpot(flop.hero, flop.gs)).toBe(true);
      const turn = nodeAt(ACES, TURN);
      expect(omahaOopTurnCheckAfterFlopCallSpot(turn.hero, turn.gs)).toBe(true);
      const river = nodeAt(ACES, RIVER);
      expect(omahaPairedRiverThinLeadSpot(river.hero, river.gs)).toBe(true);
      const paired = nodeAt(STRAIGHT, TURN);
      expect(omahaPairedTurnBarrelSpot(paired.hero, paired.gs)).toBe(true);
      const draw = facingAfterCheck(ACES, TURN, 0.5);
      expect(omahaOopTurnFacingBetVerdict(draw.hero, draw.gs)).toBe('call_nut_draw');
      const dead = facingAfterCheck(ACES, TURN, 0.5, NO_OUT);
      expect(omahaOopTurnFacingBetVerdict(dead.hero, dead.gs)).toBe('fold_no_outs');
    }));
});

describe.each(ARMS)(
  'TOURNAMENT (a) the owner-ruled checks and folds are final: %s',
  (_name, opts) => {
    it('59517323 flop, the bare overpair out of position: a check at every seed', () => {
      expect(
        all(
          play(() => nodeAt(ACES, FLOP), opts),
          'check'
        )
      ).toBe(true);
      expect(
        all(
          play(() => nodeAt(ACES, FLOP), opts, false),
          'check'
        )
      ).toBe(true);
    });

    it('turn out of position after the called flop bet, no nut hand: a check at every seed', () => {
      expect(
        all(
          play(() => nodeAt(ACES, TURN), opts),
          'check'
        )
      ).toBe(true);
      expect(
        all(
          play(() => nodeAt(ACES, TURN), opts, false),
          'check'
        )
      ).toBe(true);
      expect(
        all(
          play(() => nodeAt(STRAIGHT, TURN), opts),
          'check'
        )
      ).toBe(true);
    });

    it.each([0.33, 0.5, 0.75])(
      'facing the turn bet of %s pot after the check: the nut draw calls, never raises or folds',
      (share) => {
        const o = play(() => facingAfterCheck(ACES, TURN, share), opts, false);
        expect(o.actions).toEqual(SEEDS.map(() => 'call'));
      }
    );

    it.each([0.33, 0.5, 1])(
      'facing the turn bet of %s pot after the check with no out: a fold at every seed',
      (share) => {
        const o = play(() => facingAfterCheck(ACES, TURN, share, NO_OUT), opts, false);
        expect(o.actions).toEqual(SEEDS.map(() => 'fold'));
      }
    );

    it('the paired river without a full house into a value leader: no bet', () => {
      expect(
        all(
          play(() => nodeAt(ACES, RIVER), opts),
          'check'
        )
      ).toBe(true);
    });
  }
);

describe('TOURNAMENT (a) the guard itself: a pricing rule that proposes the forbidden action', () => {
  it('card impact proposing a bet where the owner rule checks is refused', () => {
    forced.impactBet = true;
    for (const build of [
      () => nodeAt(ACES, FLOP),
      () => nodeAt(ACES, TURN),
      () => nodeAt(ACES, RIVER),
      () => nodeAt(STRAIGHT, TURN),
    ]) {
      const o = play(build, ALL);
      expect(all(o, 'check')).toBe(true);
    }
  });

  it('a facing-bet verdict of fold cannot fold the nut draw, and of call cannot call with no out', () => {
    forced.evCall = false;
    expect(
      all(
        play(() => facingAfterCheck(ACES, TURN, 0.5), ALL, false),
        'call'
      )
    ).toBe(true);
    forced.evCall = true;
    expect(
      all(
        play(() => facingAfterCheck(ACES, TURN, 0.5, NO_OUT), ALL, false),
        'fold'
      )
    ).toBe(true);
  });

  it('a nut-class wager is not checked by a pricing rule', () => {
    // the nut straight on the unpaired turn 5d 8d 9h 2h: 7-6 for the nine-high straight
    forced.impactCheck = true;
    const nuts = 'AsAh7c6s4h';
    const off = play(() => nodeAt(ACES, TURN, nuts), {});
    const on = play(() => nodeAt(ACES, TURN, nuts), { omahaCardImpact: true });
    expect(on.actions).toEqual(off.actions);
    expect(off.actions.some((a) => a !== 'check')).toBe(true);
  });
});

describe('TOURNAMENT (b) on the river the facing-bet expected value is the single decider', () => {
  const RIVER_RULES: HorseDecideOpts = {
    omahaRiverMediumBetStrongHandCalls: true,
    omahaPairedBoardFoldRespectsPrice: true,
    omahaBluffCatcherFoldVsValueLeader: true,
  };
  const YIELDING = [
    'omaha_river_medium_bet_strong_hand_call',
    'omaha_river_medium_bet_strong_hand_call_withheld',
    'omaha_river_medium_bet_strong_hand_call_unpriced',
    'omaha_paired_board_fold_price_respected',
    'omaha_bluff_catcher_fold_vs_value_leader',
    'omaha_bluff_catcher_fold_vs_value_leader_withheld',
  ];
  const builds: [string, () => Node][] = [
    ['aces up, half pot', () => facingAfterCheck(ACES, RIVER, 0.5)],
    ['aces up, pot', () => facingAfterCheck(ACES, RIVER, 1)],
    ['the straight on the paired board, half pot', () => facingAfterCheck(STRAIGHT, 18, 0.5)],
  ];

  it.each(builds)('%s: with it on, the three river rules fire nothing', (_n, build) => {
    const o = play(build, { ...RIVER_RULES, omahaFacingBetEv: true }, false);
    expect(forced.evCalls).toBeGreaterThan(0);
    for (const f of YIELDING) expect(fired(o, f)).toBe(0);
    expect(fired(o, 'omaha_facing_bet_ev_call') + fired(o, 'omaha_facing_bet_ev_fold')).toBe(
      SEEDS.length
    );
  });

  it.each(builds)(
    "%s: its verdict is the fold-or-call, whatever the river rules would have done (a raise is the raise rules' own)",
    (_n, build) => {
      forced.evCall = true;
      const called = play(build, { ...RIVER_RULES, omahaFacingBetEv: true }, false);
      expect(called.actions.filter((a) => a === 'fold')).toEqual([]);
      // a call of the whole stack is recorded as an all-in
      expect(called.actions.some((a) => a === 'call' || a === 'all_in')).toBe(true);
      forced.evCall = false;
      const folded = play(build, { ...RIVER_RULES, omahaFacingBetEv: true }, false);
      expect(folded.actions.filter((a) => a === 'call')).toEqual([]);
      expect(folded.actions.every((a, i) => a === 'fold' || a === called.actions[i])).toBe(true);
    }
  );

  it.each(builds)(
    '(c) %s: when it throws, the decision is the one with it off, with the failure receipt',
    (_n, build) => {
      const off = play(build, RIVER_RULES, false);
      forced.evThrows = true;
      const thrown = play(build, { ...RIVER_RULES, omahaFacingBetEv: true }, false);
      expect(thrown.actions).toEqual(off.actions);
      expect(fired(thrown, 'omaha_strategy_rule_failed')).toBe(SEEDS.length);
      expect(fired(thrown, 'omaha_facing_bet_ev_changed')).toBe(0);
    }
  );
});

describe('TOURNAMENT (c) a pricing rule that throws leaves the decision it was given', () => {
  it('card impact', () => {
    const off = play(() => nodeAt(ACES, RIVER, 'AsAh9s9c4h'), {});
    forced.impactThrows = true;
    const thrown = play(() => nodeAt(ACES, RIVER, 'AsAh9s9c4h'), { omahaCardImpact: true });
    expect(thrown.bytes).toEqual(off.bytes);
    expect(fired(thrown, 'omaha_strategy_rule_failed')).toBeGreaterThan(0);
  });

  it('street plan', () => {
    const off = play(() => nodeAt(STRAIGHT, TURN), {});
    forced.planThrows = true;
    const thrown = play(() => nodeAt(STRAIGHT, TURN), { omahaStreetPlan: true });
    expect(thrown.bytes).toEqual(off.bytes);
    expect(off.actions.some((a) => a === 'bet' || a === 'all_in')).toBe(true);
    expect(fired(thrown, 'omaha_strategy_rule_failed')).toBeGreaterThan(0);
  });
});

describe('TOURNAMENT audit 2026-11-15 item 2: omahaOopTurnCheckAfterFlopCall multiway, the Horse first to act', () => {
  /** A third player, seat 6 (acts after the Horse, before seat 1), called preflop and the flop bet. */
  function threeWay(node: Node, flopCall = true): Node {
    const p6 = node.gs.players.find((p) => p.seat === 6)!;
    p6.is_folded = false;
    p6.user_id = p6.user_id ?? 'third-player';
    const history = node.gs.actionHistory ?? [];
    const flopCallAt = history.findIndex((a) => String(a.stage) === 'flop' && a.seat === CALLER);
    if (flopCall) history.splice(flopCallAt + 1, 0, { ...history[flopCallAt], seat: 6 });
    node.gs.pot += flopCall ? 218 : 119;
    return node;
  }
  const ON: HorseDecideOpts = { omahaOopTurnCheckAfterFlopCall: true };

  it('the spots hold three-way when both opponents called the flop bet, and not when one did not', () =>
    withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () => {
      const t = threeWay(nodeAt(ACES, TURN));
      expect(t.gs.players.filter((p) => p.seat !== HERO && !p.is_folded).length).toBe(2);
      expect(omahaOopTurnCheckAfterFlopCallSpot(t.hero, t.gs)).toBe(true);
      const f = threeWay(facingAfterCheck(ACES, TURN, 0.5));
      expect(omahaOopTurnFacingBetVerdict(f.hero, f.gs)).toBe('call_nut_draw');
      const d = threeWay(facingAfterCheck(ACES, TURN, 0.5, NO_OUT));
      expect(omahaOopTurnFacingBetVerdict(d.hero, d.gs)).toBe('fold_no_outs');
      const notCalled = threeWay(nodeAt(ACES, TURN), false);
      expect(omahaOopTurnCheckAfterFlopCallSpot(notCalled.hero, notCalled.gs)).toBe(false);
    }));

  it.each([
    ['the option alone', ON],
    ['every option on', ALL],
  ] as [string, HorseDecideOpts][])(
    '%s: three-way the turn is a check, the nut draw calls a bet, no out folds',
    (_n, opts) => {
      expect(
        all(
          play(() => threeWay(nodeAt(ACES, TURN)), opts, false),
          'check'
        )
      ).toBe(true);
      expect(play(() => threeWay(facingAfterCheck(ACES, TURN, 0.5)), opts, false).actions).toEqual(
        SEEDS.map(() => 'call')
      );
      expect(
        play(() => threeWay(facingAfterCheck(ACES, TURN, 0.5, NO_OUT)), opts, false).actions
      ).toEqual(SEEDS.map(() => 'fold'));
    }
  );
});

describe('TOURNAMENT conflict sweep 2026-11-15, the open findings', () => {
  /** the nut straight on the unpaired turn 5d 8d 9h 2h: 7-6 for the nine-high straight */
  const NUTS = 'AsAh7c6s4h';
  const DEFENCE: HorseDecideOpts = { omahaMadeHandDefenseVsValueLeader: true };

  it('B2: a check the made-hand defence makes stands over a card-impact bet and a strong-hand value bet', () => {
    forced.defenceChecks = true;
    for (const [pricing, flag] of [
      [{ omahaCardImpact: true }, 'impactBet'],
      [{ omahaStrongHandValue: true }, 'strongBet'],
    ] as [HorseDecideOpts, 'impactBet' | 'strongBet'][]) {
      forced.impactBet = false;
      forced.strongBet = false;
      forced[flag] = true;
      const alone = play(() => nodeAt(ACES, RIVER), pricing);
      const bets = alone.actions.filter((a) => a === 'bet').length;
      const on = play(() => nodeAt(ACES, RIVER), { ...DEFENCE, ...pricing });
      expect(on.actions).toEqual(SEEDS.map(() => 'check'));
      if (flag === 'impactBet') {
        // Sweep S4: on this paired river, without a full house, against a
        // measured value leader the card-impact comparison no longer creates
        // the bet itself, so there is nothing for the defence to overrule.
        expect(bets).toBe(0);
        expect(fired(alone, 'omaha_card_impact_paired_board_press_withheld')).toBeGreaterThan(0);
      } else {
        // the proposal is real: without the defence the pricing rule's bet is made
        expect(bets).toBeGreaterThan(0);
        expect(fired(on, 'omaha_owner_ruled_check_kept')).toBeGreaterThan(0);
      }
      expect(on.refusals).toEqual(SEEDS.map(() => null));
      // not a measured value leader: the read-gated defence is withheld and the bet is made
      const aloneNoRead = play(() => nodeAt(ACES, RIVER), pricing, false);
      const noRead = play(() => nodeAt(ACES, RIVER), { ...DEFENCE, ...pricing }, false);
      expect(noRead.actions).toEqual(aloneNoRead.actions);
      expect(noRead.actions.some((a) => a === 'bet')).toBe(true);
      // the unconditional defence needs no read
      const always = play(
        () => nodeAt(ACES, RIVER),
        { omahaBeatenMadeHandDefense: true, ...pricing },
        false
      );
      expect(all(always, 'check')).toBe(true);
      // against no value leader the card-impact bet is proposed, and the defence's check stands over it
      expect(fired(always, 'omaha_owner_ruled_check_kept')).toBeGreaterThan(0);
    }
  });

  it('B3: the street plan never asks the facing-bet expected value on a hypothetical river, and runs once per bet size', () => {
    const TRIPLE: HorseDecideOpts = {
      omahaStreetPlan: true,
      omahaFacingBetEv: true,
      omahaBluffCatcherFoldVsValueLeader: true,
    };
    enableBrainTelemetry();
    let planned = 0;
    for (const s of SEEDS) {
      HorseMind.reset();
      seedFastRandom(s);
      const st = nodeAt(ACES, TURN, NUTS);
      forced.evCalls = 0;
      forced.planRuns = 0;
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        omahaStrategyInTournaments: true,
        telemetry: true,
        ...TRIPLE,
        omahaBigDrawAggression: true,
        omahaCardImpact: true,
      } as never);
      // the turn decision faces no bet: nothing asks the exact-hand count
      expect(forced.evCalls).toBe(0);
      // one plan per bet size priced (the engine's and, at most, card impact's)
      expect(forced.planRuns).toBeLessThanOrEqual(2);
      if (forced.planRuns > 0) planned++;
      expect(['bet', 'check', 'all_in']).toContain(d.action);
    }
    drainFires();
    expect(planned).toBeGreaterThan(0);
  });

  it('B4: a nut-class turn bet is not re-checked by the street plan outermost, and the validator admits it', () => {
    forced.planChecks = true;
    const off = play(() => nodeAt(ACES, TURN, NUTS), {});
    expect(off.actions.some((a) => a === 'bet')).toBe(true);
    for (const opts of [
      { omahaStreetPlan: true, omahaBigDrawAggression: true },
      { omahaStreetPlan: true, omahaStrongHandValue: true },
      { ...ALL, omahaCardImpact: false, omahaOopTurnCheckAfterFlopCall: false },
    ] as HorseDecideOpts[]) {
      const on = play(() => nodeAt(ACES, TURN, NUTS), opts);
      expect(on.actions).toEqual(off.actions);
      expect(on.amounts).toEqual(off.amounts);
      expect(fired(on, 'omaha_nut_class_wager_kept')).toBe(
        off.actions.filter((a) => a === 'bet').length
      );
      expect(fired(on, 'omaha_owner_ruled_check_kept')).toBe(0);
      expect(on.refusals).toEqual(SEEDS.map(() => null));
    }
  });

  it('S3: the outermost own-bet re-check runs with any pricing option on, not only the big-draw wager', () => {
    forced.strongBet = true;
    // the paired river without a full house into a value leader: the owner rule checks
    const on = play(() => nodeAt(ACES, RIVER), { ...OWNER, omahaStrongHandValue: true });
    expect(on.actions).toEqual(SEEDS.map(() => 'check'));
    expect(fired(on, 'omaha_owner_ruled_check_kept')).toBe(SEEDS.length);
    // no pricing option on: the rule does not run at all
    const none = play(() => nodeAt(ACES, RIVER), OWNER);
    expect(fired(none, 'omaha_owner_ruled_check_kept')).toBe(0);
  });

  it('S2: a bigger size the owner rules refuse leaves the bet they had let through, at its own size', () => {
    const off = play(() => nodeAt(ACES, TURN), {});
    const bets = off.actions.filter((a) => a === 'bet').length;
    expect(bets).toBeGreaterThan(0);
    forced.impactBigger = true;
    // the river-plan test passes the engine's size and refuses the full pot
    forced.lacksPlanAbove = Math.max(...off.amounts.map((a) => a ?? 0));
    const on = play(() => nodeAt(ACES, TURN), {
      omahaTurnBetNeedsRiverPlan: true,
      omahaCardImpact: true,
    });
    expect(on.actions).toEqual(off.actions);
    expect(on.amounts).toEqual(off.amounts);
    expect(fired(on, 'omaha_owner_approved_bet_kept')).toBe(bets);
    expect(fired(on, 'omaha_owner_ruled_check_kept')).toBe(0);
    expect(on.refusals).toEqual(SEEDS.map(() => null));
  });

  // The street plan's river follow (the turn plan that calls this river) is
  // cash-only by design: in a tournament hand it does not run, so the
  // facing-bet expected value yields to nothing and stays the single decider.
  it('S1 in a tournament: the street plan’s river follow does not run, even when a plan asked there would call', () => {
    const PLAN_EV: HorseDecideOpts = { omahaStreetPlan: true, omahaFacingBetEv: true };
    const build = () => facingAfterCheck(ACES, RIVER, 0.5);
    forced.evCall = false;
    // the verdict alone (a fold) decides
    const evOnly = play(build, { omahaFacingBetEv: true }, false);
    expect(all(evOnly, 'fold')).toBe(true);
    // a plan that, if it were asked on this river, would answer "call"
    forced.planCallsRiver = true;
    forced.planRiverVerdicts = 0;
    const st = build();
    expect(
      omahaStreetPlanFromRiver(st.hero, st.gs, { omahaStrategyInTournaments: true, ...PLAN_EV })
    ).toBeNull();
    const both = play(build, PLAN_EV, false);
    const planOnly = play(build, { omahaStreetPlan: true }, false);
    const neither = play(build, {}, false);
    // the plan's river verdict is never asked, and no decision follows a plan
    expect(forced.planRiverVerdicts).toBe(0);
    expect(fired(both, 'omaha_street_plan_followed')).toBe(0);
    expect(fired(planOnly, 'omaha_street_plan_followed')).toBe(0);
    // with the plan on, every decision is the decision without it
    expect(both.actions).toEqual(evOnly.actions);
    expect(both.amounts).toEqual(evOnly.amounts);
    expect(fired(both, 'omaha_facing_bet_ev_fold')).toBe(fired(evOnly, 'omaha_facing_bet_ev_fold'));
    expect(fired(both, 'omaha_facing_bet_ev_call')).toBe(0);
    expect(planOnly.actions).toEqual(neither.actions);
    expect(planOnly.amounts).toEqual(neither.amounts);
  });

  it('audit item 7: the street plan attaches its record to a copy; the validator and a JSON round trip carry the field', () => {
    let carried = 0;
    for (const s of SEEDS) {
      HorseMind.reset();
      seedFastRandom(s);
      const st = nodeAt(ACES, TURN, NUTS);
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        omahaStrategyInTournaments: true,
        omahaStreetPlan: true,
      } as never);
      if (d.streetPlan === undefined) continue;
      carried++;
      const wire = JSON.parse(JSON.stringify(d)) as HorseDecision;
      expect(wire.streetPlan).toEqual(JSON.parse(JSON.stringify(d.streetPlan)));
      expect(
        horseDecisionReceiptRefusal(wire, String(st.gs.gameVariant), {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
    expect(carried).toBeGreaterThan(0);
  });
});

describe('TOURNAMENT audit item 11: a switched-on option reaches the brain through the worker spread', () => {
  const OPTION = 'omahaBareOverpairOopFlopCheck';
  const v2 = (options: Record<string, unknown>) => ({
    version: 2,
    style: { version: 1, options: {} },
    options,
  });
  const present = (raw: unknown, receivedAtMs: number): OptionSwitchReading => ({
    kind: 'present',
    raw,
    receivedAtMs,
  });
  /** What workerRuntime spreads into the decision options after each reading, in order. */
  function spread(readings: Array<OptionSwitchReading | 'throw'>): Record<string, boolean>[] {
    let i = 0;
    const h = new OptionSwitchHolder(
      () => {
        const r = readings[Math.min(i++, readings.length - 1)]!;
        if (r === 'throw') throw new Error('unreadable');
        return r;
      },
      () => undefined
    );
    return readings.map((_r, k) => ({
      ...optionSwitchDecisionOpts(h.refresh(k * STYLE_SWITCH_POLL_MS)),
    }));
  }

  it('the worker spreads the switched set into both looks, after the request options', () => {
    const runtime = readFileSync(
      new URL('./horseDecision/workerRuntime.ts', import.meta.url),
      'utf8'
    );
    expect(runtime).toContain('const optionBrainOpts = optionSwitchDecisionOpts(optionStates);');
    // the fast look, its mind observation, and the deep look
    expect(runtime.match(/\.\.\.request\.opts,[\s\S]{0,600}?\.\.\.optionBrainOpts,/g)?.length).toBe(
      2
    );
    expect(runtime).toMatch(
      /\.\.\.request\.opts,[\s\S]{0,700}?\.\.\.optionSwitchDecisionOpts\(deepOptionStates\),/
    );
  });

  it('on in the switch: the option decides; stale, unreadable, invalid or unknown: it stays off', () => {
    const off = play(() => nodeAt(ACES, FLOP), {}, false);
    expect(off.actions.some((a) => a !== 'check')).toBe(true);

    const [on] = spread([present(v2({ [OPTION]: 'on' }), 0)]);
    expect(on).toEqual({ [OPTION]: true });
    // request.opts first, the switched set after it, as workerRuntime builds the options
    const requestOpts: HorseDecideOpts = {};
    const live = play(() => nodeAt(ACES, FLOP), { ...requestOpts, ...on }, false);
    expect(live.actions).toEqual(SEEDS.map(() => 'check'));
    expect(fired(live, 'omaha_bare_overpair_oop_flop_checked')).toBe(
      off.actions.filter((a) => a !== 'check').length
    );

    const good = present(v2({ [OPTION]: 'on' }), 0);
    for (const bad of [
      present(v2({ [OPTION]: 'on' }), -STYLE_SWITCH_STALE_MS),
      'throw' as const,
      present({ nonsense: true }, STYLE_SWITCH_POLL_MS),
      { kind: 'present', raw: v2({ [OPTION]: 'on' }) } as never,
    ]) {
      const [first, after] = spread([good, bad]);
      expect(first).toEqual({ [OPTION]: true });
      // nothing switched: the key is not passed and the code default (off) decides
      expect(after).toEqual({});
      const stale = play(() => nodeAt(ACES, FLOP), { ...requestOpts, ...after }, false);
      expect(stale.bytes).toEqual(off.bytes);
    }
    // a name the registry does not know never becomes a decision option
    const [unknown] = spread([present(v2({ omahaNoSuchOption: 'on' }), 0)]);
    expect(unknown).toEqual({});
    const [mixed] = spread([present(v2({ omahaNoSuchOption: 'on', [OPTION]: 'on' }), 0)]);
    expect(Object.keys(mixed)).not.toContain('omahaNoSuchOption');
    // an off-only option (an owner hold) cannot be switched on
    const [held] = spread([present(v2({ omahaSmallBlindSteal: 'on' }), 0)]);
    expect(held).toEqual({});
  });
});

describe('TOURNAMENT omahaStrongHandSlowplayMix in the precedence chain (owner 2026-11-15 14:13)', () => {
  const SLOW: HorseDecideOpts = { omahaStrongHandSlowplayMix: true };
  /** the nut straight on the unpaired turn 5d 8d 9h 2h: 7-6 for the nine-high straight */
  const NUT_STRAIGHT = 'AsAh7c6s4h';
  const OWNER_CHECKS: [string, () => Node][] = [
    ['59517323 flop', () => nodeAt(ACES, FLOP)],
    ['59517323 turn', () => nodeAt(ACES, TURN)],
    ['59517323 river', () => nodeAt(ACES, RIVER)],
    ['59521326 pairing turn', () => nodeAt(STRAIGHT, TURN)],
  ];
  const FACING: [string, () => Node][] = [
    [
      'turn, the nut straight facing half pot',
      () => facingAfterCheck(ACES, TURN, 0.5, NUT_STRAIGHT),
    ],
    ['turn, the nut draw facing half pot', () => facingAfterCheck(ACES, TURN, 0.5)],
    ['river, aces up facing pot', () => facingAfterCheck(ACES, RIVER, 1)],
  ];

  it.each(OWNER_CHECKS)('%s: it never converts an owner-ruled check', (_n, build) => {
    for (const opts of [
      { ...OWNER, ...SLOW },
      { ...ALL, ...SLOW },
    ]) {
      const o = play(build, opts);
      expect(all(o, 'check')).toBe(true);
    }
  });

  it.each([...OWNER_CHECKS, ...FACING])(
    '%s: it never folds where the chain without it does not',
    (_n, build) => {
      const off = play(build, ALL, false);
      const on = play(build, { ...ALL, ...SLOW }, false);
      on.actions.forEach((a, i) => {
        if (a === 'fold') expect(off.actions[i]).toBe('fold');
      });
    }
  );

  it.each(FACING)(
    '%s: it sits inside omahaTurnRiverRaiseNeedsNuts (adds no raise; a slowplay call stays a call)',
    (_n, build) => {
      const RAISE_NUTS: HorseDecideOpts = { omahaTurnRiverRaiseNeedsNuts: true };
      const alone = play(build, RAISE_NUTS, false);
      const both = play(build, { ...RAISE_NUTS, ...SLOW }, false);
      both.actions.forEach((a, i) => {
        if (a === 'raise' || a === 'all_in')
          expect(['raise', 'all_in']).toContain(alone.actions[i]);
        if (both.fires[i].includes('omaha_strong_hand_slowplay_call'))
          expect(['call', 'all_in']).toContain(a);
        // the slowplay mix itself never folds
        if (a === 'fold') expect(alone.actions[i]).toBe('fold');
      });
    }
  );
});

/**
 * Conflict sweep 2026-11-15: a receipt must describe the final action. A
 * verdict a later rule can overturn is proposed and settled when the decision
 * is final: the receipt fires when its verdict is the final action, and its
 * `_vetoed` receipt fires when a later rule replaced it.
 */
describe('TOURNAMENT a receipt describes the final action', () => {
  const NUTS = 'AsAh7c6s4h';

  it('a card-impact bet the made-hand defence checks is recorded as vetoed, not as a press bet; a bet that is made is recorded as made', () => {
    forced.impactBet = true;
    forced.defenceChecks = true;
    const vetoed = play(
      () => nodeAt(ACES, RIVER),
      { omahaBeatenMadeHandDefense: true, omahaCardImpact: true },
      false
    );
    expect(all(vetoed, 'check')).toBe(true);
    expect(fired(vetoed, 'omaha_card_impact_press_bet_vetoed')).toBeGreaterThan(0);
    expect(fired(vetoed, 'omaha_card_impact_press_bet_vetoed')).toBe(
      fired(vetoed, 'omaha_owner_ruled_check_kept')
    );
    expect(vetoed.fires.flat()).not.toContain('omaha_card_impact_press_bet');
    expect(vetoed.fires.flat()).not.toContain('omaha_card_impact_changed');

    forced.defenceChecks = false;
    const made = play(() => nodeAt(ACES, RIVER), { omahaCardImpact: true }, false);
    made.actions.forEach((a, i) => {
      const press = made.fires[i].includes('omaha_card_impact_press_bet');
      if (!press) return;
      expect(a).toBe('bet');
      expect(made.fires[i]).toContain('omaha_card_impact_changed');
    });
    expect(fired(made, 'omaha_card_impact_press_bet')).toBeGreaterThan(0);
    expect(made.fires.flat().some((f) => f.endsWith('_vetoed'))).toBe(false);
  });

  it('a card-impact check a nut-class hand does not take is not recorded at all; one that is taken is', () => {
    forced.impactCheck = true;
    const taken = play(() => nodeAt(STRAIGHT, TURN), { omahaCardImpact: true }, false);
    taken.actions.forEach((a, i) => {
      if (taken.fires[i].includes('omaha_card_impact_defence_check')) expect(a).toBe('check');
    });
    expect(fired(taken, 'omaha_card_impact_defence_check')).toBeGreaterThan(0);
    const nuts = play(() => nodeAt(ACES, TURN, NUTS), { omahaCardImpact: true }, false);
    expect(nuts.fires.flat().filter((f) => f.startsWith('omaha_card_impact'))).toEqual([]);
  });

  it('a street-plan check a nut-class bet overrules is recorded as vetoed; a check that stands is recorded as the plan’s', () => {
    forced.planChecks = true;
    const kept = play(() => nodeAt(ACES, TURN, NUTS), { omahaStreetPlan: true }, false);
    expect(kept.actions.every((a) => a === 'bet' || a === 'all_in')).toBe(true);
    const plan = (o: Outcome, suffix = '') =>
      fired(o, `omaha_street_plan_line_changed${suffix}`) +
      fired(o, `omaha_street_plan_commit_avoided${suffix}`);
    expect(plan(kept)).toBe(0);
    expect(plan(kept, '_vetoed')).toBe(SEEDS.length);
    expect(fired(kept, 'omaha_nut_class_wager_kept')).toBe(SEEDS.length);

    const stands = play(() => nodeAt(STRAIGHT, TURN), { omahaStreetPlan: true }, false);
    expect(all(stands, 'check')).toBe(true);
    expect(plan(stands)).toBeGreaterThan(0);
    expect(plan(stands, '_vetoed')).toBe(0);
  });

  it('a big-draw bet an owner-ruled check overrules is recorded as vetoed; one that is made is recorded as made', () => {
    forced.drawBet = true;
    const vetoed = play(() => nodeAt(ACES, TURN), { ...OWNER, omahaBigDrawAggression: true });
    expect(all(vetoed, 'check')).toBe(true);
    expect(fired(vetoed, 'omaha_big_draw_aggression_bet_vetoed')).toBeGreaterThan(0);
    expect(vetoed.fires.flat()).not.toContain('omaha_big_draw_aggression_bet');

    const made = play(() => nodeAt(ACES, TURN), { omahaBigDrawAggression: true }, false);
    made.actions.forEach((a, i) => {
      if (made.fires[i].includes('omaha_big_draw_aggression_bet'))
        expect(['bet', 'all_in']).toContain(a);
    });
    expect(made.fires.flat()).not.toContain('omaha_big_draw_aggression_bet_vetoed');
  });

  it('a turn raise flatted and then folded by the facing-bet expected value is recorded as vetoed; a flat that stands is recorded as flatted', () => {
    const opts: HorseDecideOpts = { omahaOopTurnCheckAfterFlopCall: true, omahaFacingBetEv: true };
    const build = () => facingAfterCheck(STRAIGHT, TURN, 0.33);
    expect(
      withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () =>
        omahaOopTurnFacingBetVerdict(build().hero, build().gs)
      )
    ).toBe('no_raise');
    const raises = play(build, {}, false).actions.filter((a) => a === 'raise' || a === 'all_in');
    expect(raises.length).toBeGreaterThan(0);

    forced.evCall = false;
    const folded = play(build, opts, false);
    expect(all(folded, 'fold')).toBe(true);
    expect(fired(folded, 'omaha_oop_turn_check_raise_flatted_vetoed')).toBe(raises.length);
    expect(folded.fires.flat()).not.toContain('omaha_oop_turn_check_raise_flatted');

    forced.evCall = true;
    const called = play(build, opts, false);
    expect(all(called, 'call')).toBe(true);
    expect(fired(called, 'omaha_oop_turn_check_raise_flatted')).toBe(raises.length);
    expect(called.fires.flat()).not.toContain('omaha_oop_turn_check_raise_flatted_vetoed');
  });

  it('every option off: nothing is proposed and no _vetoed receipt exists', () => {
    for (const build of [
      () => nodeAt(ACES, TURN),
      () => nodeAt(ACES, RIVER),
      () => nodeAt(STRAIGHT, TURN),
    ]) {
      const off = play(build, {});
      expect(off.fires.flat().some((f) => f.endsWith('_vetoed'))).toBe(false);
    }
  });
});

/**
 * Follow-up head 2026-11-15: the wider paired-board spot (every line of a
 * paired turn or river without a full house) reads the common scope. In a
 * tournament hand it exists only inside omahaStrategyInTournaments's public
 * scope, and there it only ever turns a bet into a check.
 */
describe('TOURNAMENT the wider paired-board spot stays cash-only without the tournament option', () => {
  it('outside the tournament scope the spot is null; inside it is the paired river of 59517323', () => {
    const river = nodeAt(ACES, RIVER);
    expect(omahaPairedBoardNoBoatSpot(river.hero, river.gs)).toBeNull();
    const inside = withOmahaTournamentScope({ extension: true, icmRisk: 0 }, () =>
      omahaPairedBoardNoBoatSpot(river.hero, river.gs)
    );
    expect(inside).not.toBeNull();
    expect(inside?.street).toBe('river');
  });

  it('the two paired-board options without the tournament option change nothing in a tournament hand', () => {
    const paired: HorseDecideOpts = {
      omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
      omahaPairedRiverNoThinLeadVsValueLeader: true,
      omahaCardImpact: true,
    };
    for (const build of [() => nodeAt(ACES, RIVER), () => nodeAt(STRAIGHT, TURN)]) {
      const none = play(build, { omahaStrategyInTournaments: false });
      const off = play(build, { ...paired, omahaStrategyInTournaments: false });
      expect(off.bytes).toEqual(none.bytes);
      expect(off.fires).toEqual(none.fires);
    }
  });
});
