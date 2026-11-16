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
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForPlo6Gates,
  omahaStrategyInPlo6GateCandidates,
} from './horseDecision/responseValidation.js';
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
const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (/Ms$/.test(k) ? undefined : v));
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
/** The source from `anchor` for `chars` characters. */
const after = (anchor: string, chars: number): string => {
  const at = SRC.indexOf(anchor);
  expect(at, anchor).toBeGreaterThan(-1);
  expect(SRC.indexOf(anchor, at + 1), `${anchor} is unique`).toBe(-1);
  return SRC.slice(at, at + chars);
};
const bodyOf = (fn: string): string => {
  const at = SRC.indexOf(`\nfunction ${fn}(`);
  expect(at, fn).toBeGreaterThan(-1);
  const end = SRC.indexOf('\n}\n', at);
  return SRC.slice(at, end);
};

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
    for (const anchor of [
      'opts.omahaRiverNutBlockerBluffReachable === true &&',
      'opts.omahaEliteContinuesVsMeasuredWideThreeBettor === true &&',
    ]) {
      const gate = after(anchor, 520);
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
    const branch = body.slice(at, at + 420);
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
    const wrap = SRC.indexOf(
      'omahaFacingBetEvRule(\n            omahaRiverMediumBetStrongHandCalls(',
      first
    );
    expect(first).toBeGreaterThan(-1);
    expect(wrap).toBeGreaterThan(first);
  });
  it('both pricing rules ask the live rule, with its own switches, share and price', () => {
    const test = bodyOf('plo6RiverLiveFoldStands');
    expect(test).toContain("!== 'plo6' || gs.stage !== 'river') return false;");
    expect(test).toContain(
      'if (paired ? opts.v58Plo6RiverNuts === false : opts.v59Plo6RiverUnpaired === false)'
    );
    expect(test).toContain('omahaRiverBeatProbability(player.cards, board, 6)');
    expect(test).toContain('price > PLO6_RIVER_CHEAP_PRICE');
    expect(bodyOf('omahaRiverMediumBetStrongHandCalls')).toContain(
      'if (plo6RiverLiveFoldStands(player, gs, opts)) return decision;'
    );
    expect(bodyOf('omahaFacingBetEvRule')).toContain(
      'const evCall = verdict.call && !plo6RiverLiveFoldStands(player, gs, opts);'
    );
    // the look-ahead and the veto read the live rule's measure too
    expect(bodyOf('omahaStreetPlanCallVeto')).toContain(
      'omahaRiverBeatProbability(player.cards, riverBoard, 6)'
    );
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
  it('the client reads the row from the configuration it last delivered to that worker', () => {
    const client = readFileSync(
      fileURLToPath(new URL('./horseDecision/client.ts', import.meta.url)),
      'utf8'
    );
    expect(client).toContain(
      "this.deliveredSwitchConfig = message.status === 'ok' ? message.config : null;"
    );
    expect(client).toContain(
      'omahaStrategyInPlo6GateCandidates(active.request.opts, this.deliveredSwitchConfig)'
    );
  });
});
