/**
 * THE PLO6 PORT'S HOOKS IN HorseLogic AND THE SHARED OMAHA MODULES (PLO6 lane
 * 2026-11-16; specifications SPEC-A / SPEC-B in the PLO6 evidence archive).
 *
 * Everything here is reached only with omahaStrategyInPlo6 on, which no live
 * row can do (the option is off-only). Pinned:
 *  - the options the port SKIPS never act in PLO6, gate on or not (3.19,
 *    3.27, 3.28, 3.31), nor does omahaReraisedPotDiscipline (not a catalogue
 *    option);
 *  - 3.9: the turn river-plan look-ahead asks the M1 fold test in PLO6;
 *  - 3.10: the street plan's facing-bet veto asks the paired-board fold and
 *    the M1 fold test in PLO6;
 *  - 3.15: the paired-board price exception is arm (a) only in PLO6;
 *  - 3.20: the PLO6 strong hand is the nut class only;
 *  - 3.24 item 7: the measured-maniac stand-aside is PLO6 only (source pin);
 *  - the receipt validator admits a ported PLO6 conversion only when the
 *    request's own gate is on.
 *
 * The decision-level node is the recorded PLO5 hand 59521326 (a turn bet that
 * leaves under half the pot behind), dealt as PLO6 with a sixth card.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sliceCall, sliceEnclosingBlock, sliceMethod } from '../testHelpers/sourceWindow.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { seedFastRandom } from './HorseEval.js';
import {
  HorseLogic,
  omahaStreetPlanAtTurn,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  omahaRiverShoveFoldVerdict,
  omahaTurnBetLacksRiverPlan,
  omahaTurnBetShortBehind,
  omahaUnseenRiverCards,
} from './HorseOmahaOopChecks.js';
import { withOmahaStrategyGameScope } from './HorseOmahaStrategyGame.js';
import { omahaStrongHandNow } from './HorseOmahaStrongHandValue.js';
import {
  PLO6_OMAHA_STRATEGY_CONSTANTS,
  clearPlo6OmahaStrategyCalibration,
  plo6StrategyOptionVerdict,
} from './HorsePlo6StrategyCalibration.js';
import { ploPairedBoardFoldRespectsPrice } from './HorsePloPairedBoardFold.js';
import {
  DELIVERED_SWITCH_CONFIGS_NONE,
  deliveredSwitchConfigsNote,
  deliveredSwitchConfigsPrevious,
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForPlo6Gates,
  omahaStrategyInPlo6GateCandidates,
} from './horseDecision/responseValidation.js';
import { plo6RiverLiveFoldTest } from './HorsePlo6PricingPort.js';
import { STYLE_SWITCH_POLL_MS } from './HorseStyleSwitch.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { registerPlo6OmahaStrategyCalibration } from './HorsePlo6StrategyCalibration.js';
import { plo6OmahaStrategyCalibrationHeld } from './HorseLogic.js';
import FIXTURE from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99];
const HERO = 5;
const CALLER = 1;
const TURN = 16;
const GATE: HorseDecideOpts = { omahaStrategyInPlo6: true };
const SCOPE_ON = { plo6: true };
const M1_OFF: HorseDecideOpts = { v58Plo6RiverNuts: false, v59Plo6RiverUnpaired: false };
/** Top set of jacks on an unpaired turn: a hand M1 folds on most rivers at this price. */
const SET_HOLE = 'JcJh9hKh7s8c';
const UNPAIRED_TURN = '2d4h5sJd';

type Node = ReturnType<typeof stateAt>;
function node(ord: number, hole: string, board?: string, variant = 'plo6'): Node {
  const f = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  f.variant = variant;
  f.hole[String(HERO)] = cards(hole);
  const n = f.actions.find((a) => a.ord === ord)!;
  if (board) n.publicNode!.boards = [board];
  (n.publicNode as { variant?: string }).variant = variant;
  const st = stateAt(f, n);
  st.gs.gameVariant = variant;
  return st;
}
const bytesOf = (d: unknown): string => JSON.stringify(withoutMeasurements(d));
function play(build: () => Node, opts: HorseDecideOpts) {
  const out = {
    bytes: [] as string[],
    actions: [] as string[],
    states: [] as Node[],
    raw: [] as unknown[],
  };
  for (const s of SEEDS) {
    HorseMind.reset();
    seedFastRandom(s);
    const st = build();
    const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, opts));
    out.bytes.push(bytesOf(d));
    out.actions.push(d.action);
    out.states.push(st);
    out.raw.push(d);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  clearPlo6OmahaStrategyCalibration();
});

const SRC = readFileSync(fileURLToPath(new URL('./HorseLogic.ts', import.meta.url)), 'utf8');
const bodyOf = (fn: string): string => sliceMethod(SRC, `function ${fn}(`);

describe('the options the PLO6 port skips never act in PLO6, gate on or not', () => {
  it('the four catalogue verdicts are skip', () => {
    for (const name of [
      'omahaRiverNutBlockerBluffReachable',
      'omahaReraisedFoldVsTight',
      'omahaEliteContinuesVsMeasuredWideThreeBettor',
      'omahaSmallBlindSteal',
    ] as const)
      expect(plo6StrategyOptionVerdict[name].verdict, name).toBe('skip');
  });

  it('3.19 and 3.28: the two inline game gates admit four and five cards only', () => {
    for (const callAnchor of [
      '(opts.omahaRiverNutBlockerBluffReachable === true &&',
      'if (\n            opts.omahaEliteContinuesVsMeasuredWideThreeBettor === true &&',
    ]) {
      const gate = sliceCall(SRC, callAnchor);
      expect(gate).toContain('(vi.holeCount === 4 || vi.holeCount === 5) &&');
      expect(gate).not.toContain('holeCount === 6');
      expect(gate).not.toContain('omahaStrategyGameInScope');
    }
  });

  it('3.27 and omahaReraisedPotDiscipline: PLO6 returns before the shared preflop cell is asked', () => {
    // omahaReraisedPotFold returns only with the gate on: with it off the cell
    // already refuses PLO6 and the function takes the same opponent reads as before.
    const anchors: Record<string, string> = {
      omahaReraisedFoldVsTight:
        "if (String(gs.gameVariant ?? '').toLowerCase() === 'plo6') return decision;",
      omahaReraisedPotFold:
        "String(gs.gameVariant ?? '').toLowerCase() === 'plo6' &&\n    omahaStrategyGameScopeOf(opts).plo6 === true\n  )\n    return decision;",
    };
    for (const fn of Object.keys(anchors)) {
      const body = bodyOf(fn);
      const out = body.indexOf(anchors[fn]);
      expect(out, fn).toBeGreaterThan(-1);
      expect(out, fn).toBeLessThan(body.indexOf('omahaReraisedPreflopCell('));
    }
  });

  it('3.31: the small blind steal is read through a rule that serves four and five cards only', () => {
    const firstIn = readFileSync(
      fileURLToPath(new URL('./HorseOmahaTournamentFirstIn.ts', import.meta.url)),
      'utf8'
    );
    expect(firstIn).toContain('if (i.holeCount !== 4 && i.holeCount !== 5) return null;');
  });

  it('on the recorded postflop nodes dealt as PLO6, the skipped options change nothing with the gate on', () => {
    const SKIPPED: HorseDecideOpts = {
      omahaRiverNutBlockerBluffReachable: true,
      omahaReraisedFoldVsTight: true,
      omahaEliteContinuesVsMeasuredWideThreeBettor: true,
      omahaSmallBlindSteal: true,
      omahaReraisedPotDiscipline: true,
    };
    for (const ord of [12, 14, 16, 18, 20]) {
      const build = () => node(ord, '6sKhAs3hQs9c');
      expect(play(build, { ...GATE, ...SKIPPED }).bytes, `ord ${ord}`).toEqual(
        play(build, GATE).bytes
      );
    }
  });
});

describe('3.24 item 7: against a measured maniac the out-of-position call rule stands aside in PLO6 only', () => {
  it('the exemption is inside the PLO6 branch and reads the measured read, as 3.26 does', () => {
    const body = bodyOf('omahaOopReraisedPotStrongRange');
    // PLO6 and the gate: with the gate off the extra opponent read is not taken.
    const at = body.indexOf(
      "String(gs.gameVariant ?? '').toLowerCase() === 'plo6' &&\n      omahaStrategyGameScopeOf(opts).plo6 === true &&\n      opts.mind !== false\n    ) {"
    );
    expect(at).toBeGreaterThan(-1);
    const branch = sliceEnclosingBlock(
      body,
      'const raiserRead = HorseMind.opponentRead(raiser.user_id);'
    );
    expect(branch).toContain(
      'raiserRead.presumed !== true && maniacRaiseWidth(raiserRead) !== null'
    );
    expect(at).toBeLessThan(body.indexOf('omahaOopReraisedCallCell('));
    // the same read omahaNoCallColdFourBetWithoutPremium (3.26) exempts on
    expect(bodyOf('omahaColdFourBetFold')).toContain(
      'read.presumed !== true && maniacRaiseWidth(read) !== null'
    );
  });

  it('the six-card coordination row the cell reads is the calibration entry', () => {
    expect(PLO6_OMAHA_STRATEGY_CONSTANTS.COORDINATED_MAX_GAPS.value).toBe(3);
    expect(
      readFileSync(new URL('./HorseOmahaOopReraisedPot.ts', import.meta.url), 'utf8')
    ).toContain('return plo6OopCoordinated(');
  });
});

describe('3.20: the PLO6 strong hand is the nut class only', () => {
  const board = cards('KsKd7h4c2s');
  const gs = (variant: string) =>
    ({
      gameVariant: variant,
      communityCards: board,
      stage: 'river',
    }) as unknown as HorseGameStateV2;
  const hero = (hole: string) => ({ cards: cards(hole) }) as unknown as SeatPlayer;

  it('sevens full of kings, which kings full beats, is strong in PLO5 and not in PLO6; quads are strong in both', () => {
    expect(omahaStrongHandNow(hero('7s7dAh9c4d'), gs('plo5'))).toBe(true);
    expect(omahaStrongHandNow(hero('7s7dAh9c4d3h'), gs('plo6'))).toBe(false);
    expect(omahaStrongHandNow(hero('KhKcAh9c4d'), gs('plo5'))).toBe(true);
    expect(omahaStrongHandNow(hero('KhKcAh9c4d3h'), gs('plo6'))).toBe(true);
  });
});

describe('3.15: the paired-board price exception is arm (a) only in PLO6', () => {
  const board = cards('KsKd7s4s2h');
  const input = (
    variant: string,
    hole: string,
    o: { stack: number; toCall: number; invested: number }
  ) => {
    const me = {
      cards: cards(hole),
      stack: o.stack,
      bet: 0,
      user_id: 'h',
      totalInvested: o.invested,
      is_folded: false,
      is_all_in: false,
    };
    return {
      gameVariant: variant,
      board,
      hero: me,
      players: [me, { user_id: 'v', is_folded: false, is_all_in: false, bet: o.toCall }],
      currentBet: o.toCall,
      toCall: o.toCall,
      pot: 100,
    };
  };
  const flush = { stack: 200, toCall: 20, invested: 10 }; // price 0.167
  const committed = { stack: 20, toCall: 20, invested: 60 }; // the rest of a stack 75% in

  it('gate off, PLO6 is outside the exception', () => {
    expect(ploPairedBoardFoldRespectsPrice(input('plo6', 'AsQs9c8d3c3h', flush))).toBe(false);
  });

  it('gate on: a flush at the price stands aside (arm a); trips for the rest of a committed stack do not (arm b)', () => {
    withOmahaStrategyGameScope(SCOPE_ON, () => {
      expect(ploPairedBoardFoldRespectsPrice(input('plo6', 'AsQs9c8d3c3h', flush))).toBe(true);
      expect(ploPairedBoardFoldRespectsPrice(input('plo6', 'KhQdJc9h8d3c', committed))).toBe(false);
      // PLO5 keeps both arms
      expect(ploPairedBoardFoldRespectsPrice(input('plo5', 'KhQdJc9h8d', committed))).toBe(true);
    });
    expect(ploPairedBoardFoldRespectsPrice(input('plo5', 'KhQdJc9h8d', committed))).toBe(true);
  });
});

describe('3.9: the turn river-plan look-ahead asks the M1 fold test in PLO6', () => {
  const turn = () => node(TURN, SET_HOLE, UNPAIRED_TURN);

  it('gate off the rule has no PLO6 geometry; gate on it has', () => {
    const st = turn();
    expect(omahaTurnBetShortBehind(st.hero, st.gs, 373)).toBeNull();
    expect(omahaTurnBetLacksRiverPlan(st.hero, st.gs, 373)).toBe(false);
    withOmahaStrategyGameScope(SCOPE_ON, () =>
      expect(omahaTurnBetShortBehind(st.hero, st.gs, 373)).not.toBeNull()
    );
  });

  it('the verdicts: M1 folds rivers no PLO4/PLO5 rule folds; with V58 and V59 off it folds none; no PLO6 river goes to the big-bet cells', () => {
    const st = turn();
    withOmahaStrategyGameScope(SCOPE_ON, () => {
      const geo = omahaTurnBetShortBehind(st.hero, st.gs, 373)!;
      const rivers = omahaUnseenRiverCards(st.hero, st.gs.communityCards ?? []);
      const on = rivers.map((r) => omahaRiverShoveFoldVerdict(st.hero, st.gs, 373, geo, r));
      const off = rivers.map((r) =>
        omahaRiverShoveFoldVerdict(st.hero, st.gs, 373, geo, r, {
          plo6RiverNuts: false,
          plo6RiverUnpaired: false,
        })
      );
      expect(on.filter((v) => v === 'plo6_river_m1').length).toBeGreaterThan(rivers.length * 0.35);
      expect(off.every((v) => v === null || v === 'paired_board')).toBe(true);
      expect(on.some((v) => v === 'big_bet_v81' || v === 'big_bet_v86')).toBe(false);
      // a river priced at or under M1's cheap price is not a fold
      const cheap = { ...geo, behind: geo.potAfter * 0.1 };
      expect(
        rivers.some(
          (r) => omahaRiverShoveFoldVerdict(st.hero, st.gs, 373, cheap, r) === 'plo6_river_m1'
        )
      ).toBe(false);
      expect(omahaTurnBetLacksRiverPlan(st.hero, st.gs, 373)).toBe(true);
    });
  });

  it('through decide: gate and option on, the bet is a check; either off, or V58 and V59 off, the bet stands', () => {
    const base = play(turn, {});
    expect(new Set(base.actions)).toEqual(new Set(['bet']));
    expect(play(turn, GATE).bytes).toEqual(base.bytes);
    expect(play(turn, { omahaTurnBetNeedsRiverPlan: true }).bytes).toEqual(base.bytes);
    const on = play(turn, { ...GATE, omahaTurnBetNeedsRiverPlan: true });
    expect(new Set(on.actions)).toEqual(new Set(['check']));
    expect(play(turn, { ...GATE, omahaTurnBetNeedsRiverPlan: true, ...M1_OFF }).bytes).toEqual(
      base.bytes
    );
  });

  it('the validator admits the PLO6 check only for a request whose gate is on', () => {
    const on = play(turn, { ...GATE, omahaTurnBetNeedsRiverPlan: true });
    on.raw.forEach((d, i) => {
      const st = on.states[i];
      const ctx = { player: st.hero, gameState: st.gs };
      expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo6', ctx)).toBe('policy_graph');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo6', {
          ...ctx,
          omahaStrategyInPlo6: false,
        })
      ).toBe('policy_graph');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo6', {
          ...ctx,
          omahaStrategyInPlo6: true,
        })
      ).toBeNull();
    });
    // a gate-off PLO6 decision is admitted exactly as before, with or without the field
    const base = play(turn, {});
    base.raw.forEach((d, i) => {
      const ctx = { player: base.states[i].hero, gameState: base.states[i].gs };
      expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo6', ctx)).toBeNull();
    });
  });
});

describe('3.10: the street plan’s facing-bet veto asks the paired-board fold and the M1 fold test in PLO6', () => {
  const planOf = (st: Node, opts: HorseDecideOpts) => {
    const opp = st.gs.players.find((p) => p.seat === CALLER)!;
    return JSON.stringify(
      omahaStreetPlanAtTurn(st.hero, opp, st.gs, { mind: false, ...opts }, 373).plan
    );
  };

  it('PLO6: the plan differs when the six-card river folds are switched off; PLO5: it does not', () => {
    const six = node(TURN, SET_HOLE, UNPAIRED_TURN);
    const withFolds = planOf(six, {});
    expect(withFolds).not.toBe('null');
    expect(planOf(six, { ...M1_OFF, ploPairedBoardFold: false })).not.toBe(withFolds);
    expect(planOf(six, M1_OFF)).not.toBe(withFolds);
    // the same plan twice (no engine random number)
    expect(planOf(node(TURN, SET_HOLE, UNPAIRED_TURN), {})).toBe(withFolds);
    const five = node(TURN, 'JcJh9hKh7s', UNPAIRED_TURN, 'plo5');
    expect(planOf(five, M1_OFF)).toBe(planOf(five, {}));
  });
});

describe('pre-review finding 6: the accessor holds the six-card values only inside a gate-on decision', () => {
  const held = () => omahaStrategyConstant('turnRedrawNutFullHouseOnly', { gameVariant: 'plo6' });
  it('after a gate-on decision nothing is left; a gate-off decision leaves what was there', () => {
    expect(plo6OmahaStrategyCalibrationHeld()).toBe(false);
    const st = node(TURN, SET_HOLE, UNPAIRED_TURN);
    seedFastRandom(7);
    HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { ...GATE, omahaStreetPlan: true });
    expect(held()).toBe(0);
    expect(plo6OmahaStrategyCalibrationHeld()).toBe(false);
    // Something else registered it (a test, an outer decision): a gate-off
    // decision reads no six-card value inside and hands the state back.
    registerPlo6OmahaStrategyCalibration();
    expect(held()).toBe(1);
    const st2 = node(TURN, SET_HOLE, UNPAIRED_TURN);
    seedFastRandom(7);
    HorseLogic.decide(st2.hero, st2.gs, LIVE.style, LIVE.mods, {});
    expect(held()).toBe(1);
    // and the same after a gate-on decision entered with it held (re-entrance)
    const st3 = node(TURN, SET_HOLE, UNPAIRED_TURN);
    seedFastRandom(7);
    HorseLogic.decide(st3.hero, st3.gs, LIVE.style, LIVE.mods, GATE);
    expect(held()).toBe(1);
  });
  it('the validator sets the accessor for its own run and puts back what it found', () => {
    const st = node(TURN, SET_HOLE, UNPAIRED_TURN);
    seedFastRandom(7);
    const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {}));
    const ctx = { player: st.hero, gameState: st.gs };
    expect(held()).toBe(0);
    horseDecisionReceiptRefusal(d, 'plo6', { ...ctx, omahaStrategyInPlo6: true });
    expect(held()).toBe(0);
    registerPlo6OmahaStrategyCalibration();
    horseDecisionReceiptRefusal(d, 'plo6', ctx);
    expect(held()).toBe(1);
    horseDecisionReceiptRefusal(d, 'plo6', { ...ctx, omahaStrategyInPlo6: true });
    expect(held()).toBe(1);
  });
});

describe('pre-review finding 3: no six-card rule turns into a call a hand the live river fold rule folds', () => {
  it('the live fold rule runs before the medium-bet call and the EV rule on both decision paths', () => {
    // Inside the graph the fold rule (plo6RiverNutDiscipline) is applied to
    // the wager first; the pricing rules wrap what it leaves.
    const first = SRC.indexOf('const nutDisciplined = plo6RiverNutDiscipline(');
    // 2026-11-19 (LEAKMAP): the chain is written as named stages, in the same
    // order: the medium-bet call takes what the earlier rules left, and the EV
    // rule takes what the medium-bet call left.
    const medium = SRC.indexOf(
      'omahaRiverMediumBetStrongHandCalls(reraisedThenCall, player, gs, opts)',
      first
    );
    const wrap = SRC.indexOf('omahaFacingBetEvRule(riverMediumRuled, player, gs, opts)', medium);
    expect(first).toBeGreaterThan(-1);
    expect(medium).toBeGreaterThan(first);
    expect(wrap).toBeGreaterThan(medium);
  });
  it("both pricing rules ask the one live test (HorsePlo6PricingPort.plo6RiverLiveFoldTest) with the live rule's switches", () => {
    // No behavioural route to "which function a private rule calls": the two
    // call sites are pinned as text; what the test answers is behaviour, below.
    const test = bodyOf('plo6RiverLiveFoldStands');
    expect(test).toContain('return plo6RiverLiveFoldTest(player, gs, {');
    expect(test).toContain('paired: opts.v58Plo6RiverNuts !== false,');
    expect(test).toContain('unpaired: opts.v59Plo6RiverUnpaired !== false,');
    expect(bodyOf('omahaRiverMediumBetStrongHandCalls')).toContain(
      'if (plo6RiverLiveFoldStands(player, gs, opts)) return decision;'
    );
    expect(bodyOf('omahaFacingBetEvRule')).toContain(
      'const liveFoldBlocks = verdict.call && plo6RiverLiveFoldStands(player, gs, opts);'
    );
    // the look-ahead and the veto read the live rule's measure too
    expect(bodyOf('omahaStreetPlanCallVeto')).toContain(
      'omahaRiverBeatProbability(player.cards, riverBoard, 6)'
    );
  });
  it('the live test: PLO6 single-board river facing a wager only; the bars, the cheap price and the two switches', () => {
    const river = (hole: string, board: string, toCall: number, pot: number, variant = 'plo6') =>
      [
        { cards: cards(hole), stack: 1000, bet: 0 },
        {
          gameVariant: variant,
          stage: 'river',
          communityCards: cards(board),
          toCall,
          pot,
          currentBet: toCall,
        } as unknown as HorseGameStateV2,
      ] as const;
    // trip kings on K-K-7-4-2: every full house beats it, far more than 15% of the time for six cards
    const weakBoat = 'KsKd7h4c2s';
    const [p, gs] = river('KhQdJc9h8d3c', weakBoat, 50, 100); // price 1/3
    expect(plo6RiverLiveFoldTest(p, gs)).toBe(true);
    expect(plo6RiverLiveFoldTest(p, gs, { paired: false })).toBe(false); // V58 off
    expect(plo6RiverLiveFoldTest(p, gs, { unpaired: false })).toBe(true); // V59 is the other board class
    // a call at or under 10% of the final pot is kept
    const [pc, gc] = river('KhQdJc9h8d3c', weakBoat, 10, 100); // price 1/11
    expect(plo6RiverLiveFoldTest(pc, gc)).toBe(false);
    // quad kings are never beaten here
    const [pq, gq] = river('KhKcAh9c4d3h', weakBoat, 50, 100);
    expect(plo6RiverLiveFoldTest(pq, gq)).toBe(false);
    // not PLO6, not the river, nothing to call, two boards: false
    const [p5, g5] = river('KhQdJc9h8d', weakBoat, 50, 100, 'plo5');
    expect(plo6RiverLiveFoldTest(p5, g5)).toBe(false);
    expect(plo6RiverLiveFoldTest(p, { ...gs, stage: 'turn' } as never)).toBe(false);
    expect(plo6RiverLiveFoldTest(p, { ...gs, toCall: 0, currentBet: 0 } as never)).toBe(false);
    expect(plo6RiverLiveFoldTest(p, { ...gs, boardCount: 2 } as never)).toBe(false);
    // an unpaired board reads V59's bar and switch
    const [pu, gu] = river('4d2d9h9c8s3h', 'KsQd7h4c2s', 50, 100); // bottom two pair
    expect(plo6RiverLiveFoldTest(pu, gu)).toBe(true);
    expect(plo6RiverLiveFoldTest(pu, gu, { unpaired: false })).toBe(false);
  });
});

describe('the validator sees the gate the worker may have run (live switch wiring)', () => {
  const cfg = (options: Record<string, string>) => ({
    version: 2,
    style: { version: 1, options: {} },
    options,
  });
  it('no row: the request option alone', () => {
    expect(omahaStrategyInPlo6GateCandidates({}, null)).toEqual([false]);
    expect(omahaStrategyInPlo6GateCandidates({ omahaStrategyInPlo6: true }, null)).toEqual([true]);
    expect(omahaStrategyInPlo6GateCandidates({ omahaStrategyInPlo6: true }, cfg({}))).toEqual([
      true,
    ]);
    expect(omahaStrategyInPlo6GateCandidates(undefined, { nonsense: 1 })).toEqual([false]);
  });
  it('an off row: off first, then the request value when it differs (an aged-out worker runs the release default)', () => {
    const off = cfg({ omahaStrategyInPlo6: 'off' });
    expect(omahaStrategyInPlo6GateCandidates({}, off)).toEqual([false]);
    expect(omahaStrategyInPlo6GateCandidates({ omahaStrategyInPlo6: true }, off)).toEqual([
      false,
      true,
    ]);
  });
  it('an on row is refused while the option is off-only: the whole set is invalid, nothing is switched', () => {
    const on = cfg({ omahaStrategyInPlo6: 'on' });
    expect(omahaStrategyInPlo6GateCandidates({}, on)).toEqual([false]);
  });
  it('a decision valid under one candidate is admitted; refused under all, the first refusal is reported', () => {
    const st = node(TURN, SET_HOLE, UNPAIRED_TURN);
    seedFastRandom(7);
    const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {}));
    const ctx = { player: st.hero, gameState: st.gs };
    const offOnly = horseDecisionReceiptRefusal(d, 'plo6', ctx);
    expect(horseDecisionReceiptRefusalForPlo6Gates(d, 'plo6', ctx, [false])).toBe(offOnly);
    expect(horseDecisionReceiptRefusalForPlo6Gates(d, 'plo6', ctx, [true, false])).toBe(offOnly);
    expect(horseDecisionReceiptRefusalForPlo6Gates(d, 'plo6', ctx, [])).toBe(offOnly);
    expect(
      horseDecisionReceiptRefusalForPlo6Gates({ action: 'dance', thinkTime: 1 }, 'plo6', ctx, [
        true,
        false,
      ])
    ).toBe('decision_shape');
  });
  it('a conversion refused under [false] is admitted under [false, true]', () => {
    // The 3.9 turn bet -> check: a real ported PLO6 conversion.
    const on = play(() => node(TURN, SET_HOLE, UNPAIRED_TURN), {
      ...GATE,
      omahaTurnBetNeedsRiverPlan: true,
    });
    expect(new Set(on.actions)).toEqual(new Set(['check']));
    on.raw.forEach((d, i) => {
      const ctx = { player: on.states[i].hero, gameState: on.states[i].gs };
      const c = () => structuredClone(d);
      expect(horseDecisionReceiptRefusalForPlo6Gates(c(), 'plo6', ctx, [false])).toBe(
        'policy_graph'
      );
      expect(horseDecisionReceiptRefusalForPlo6Gates(c(), 'plo6', ctx, [false, true])).toBeNull();
      expect(horseDecisionReceiptRefusalForPlo6Gates(c(), 'plo6', ctx, [true])).toBeNull();
    });
  });
  it('the configuration held before a change stays a candidate for one worker poll interval (pre-review 2 finding 1)', () => {
    const off = cfg({ omahaStrategyInPlo6: 'off' });
    const other = cfg({ omahaStrategyInPlo6: 'off', omahaCardImpact: 'on' });
    let st = DELIVERED_SWITCH_CONFIGS_NONE;
    expect(deliveredSwitchConfigsPrevious(st, 0)).toBeUndefined();
    st = deliveredSwitchConfigsNote(st, off, 1_000);
    expect(st.current).toBe(off);
    // the same configuration delivered again changes nothing (the window is not pushed out)
    expect(deliveredSwitchConfigsNote(st, structuredClone(off), 30_000)).toBe(st);
    const changed = deliveredSwitchConfigsNote(st, other, 50_000);
    expect(changed.current).toBe(other);
    expect(changed.previous).toBe(off);
    expect(changed.previousUntilMs).toBe(50_000 + STYLE_SWITCH_POLL_MS);
    expect(deliveredSwitchConfigsPrevious(changed, 50_000 + STYLE_SWITCH_POLL_MS)).toBe(off);
    expect(deliveredSwitchConfigsPrevious(changed, 50_001 + STYLE_SWITCH_POLL_MS)).toBeUndefined();
    // an unreadable answer (null) after a configuration keeps that configuration as previous
    const lost = deliveredSwitchConfigsNote(st, null, 70_000);
    expect(lost.current).toBeNull();
    expect(lost.previous).toBe(off);
  });
  it('the previous configuration adds its gate value as a candidate, after the effective ones', () => {
    const off = cfg({ omahaStrategyInPlo6: 'off' });
    // request on, row now absent, the row before was off: the worker may still run off
    expect(omahaStrategyInPlo6GateCandidates({ omahaStrategyInPlo6: true }, cfg({}), off)).toEqual([
      true,
      false,
    ]);
    // no previous configuration in force: as before
    expect(
      omahaStrategyInPlo6GateCandidates({ omahaStrategyInPlo6: true }, cfg({}), undefined)
    ).toEqual([true]);
    // a previous configuration with no row for the option, or the same value, adds nothing
    expect(omahaStrategyInPlo6GateCandidates({}, off, cfg({}))).toEqual([false]);
    expect(omahaStrategyInPlo6GateCandidates({}, off, off)).toEqual([false]);
    // row off now, request on, and the row before absent: off first, then the request's own
    expect(omahaStrategyInPlo6GateCandidates({ omahaStrategyInPlo6: true }, off, cfg({}))).toEqual([
      false,
      true,
    ]);
  });
  it('the client keeps what it delivered through those two functions and validates under them', () => {
    // No worker in this test: the wiring in the client is pinned as text; the
    // functions it calls are tested above.
    const client = readFileSync(
      fileURLToPath(new URL('./horseDecision/client.ts', import.meta.url)),
      'utf8'
    );
    expect(client).toContain('this.deliveredSwitchConfigs = deliveredSwitchConfigsNote(');
    expect(client).toContain(
      'deliveredSwitchConfigsPrevious(this.deliveredSwitchConfigs, Date.now())'
    );
  });
});
