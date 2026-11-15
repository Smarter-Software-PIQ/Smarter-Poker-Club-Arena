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
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { withOmahaTournamentScope } from './HorseOmahaTournamentScope.js';

type HorseDecision = ReturnType<typeof HorseLogic.decide>;
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  omahaBareOverpairOopFlopSpot,
  omahaOopTurnCheckAfterFlopCallSpot,
  omahaOopTurnFacingBetVerdict,
  omahaPairedRiverThinLeadSpot,
  omahaPairedTurnBarrelSpot,
} from './HorseOmahaOopChecks.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
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
}));

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
  fires: string[][];
  bytes: string[];
}
// A tournament decision record carries wall-clock work times (policyMs,
// simulationMs: the Phase 7/8 budgets) and a time-bank think time; they are
// not the decision, so the byte comparison leaves them out.
const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (/Ms$/.test(k) || k === 'thinkTime' ? undefined : v));
function play(build: () => Node, opts: HorseDecideOpts, valueLeader = true): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { actions: [], fires: [], bytes: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (valueLeader)
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => leader) as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
      omahaStrategyInTournaments: true,
    } as never);
    out.actions.push(d.action);
    out.bytes.push(bytesOf(d));
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
