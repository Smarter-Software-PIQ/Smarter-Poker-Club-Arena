/**
 * LAW: A HOLD'EM TOURNAMENT ALL-IN CALL IS PRICED (option holdemTournamentAllInCallIsPriced, default OFF).
 *
 * Horse Decisions audit E (1,522 NLH tournament hands with humans, 10,937 Horse decisions, 48 hours to
 * 2026-11-19 18:45 CST) found Horses folding to all-ins at prices their equity paid for: a fixed strength bar
 * at All-In-Or-Fold tables, strength bars and the Phase 7 arbiter for a re-jam over the Horse's own open, a
 * committed stack folding crumbs, postflop all-in folds at a good price. With the option on, every such call
 * is decided by the Horse's equity against the ranges in the pot versus the exact price
 * (HorseHoldemTournamentAllInCall.ts); no later owner may turn it around beyond 5 equity points (any margin
 * for a committed call). With it off (absent or false) nothing of it runs.
 *
 * Fixtures (AHoldemTournamentAllInCallIsPriced.cases.ts): the audit's own rows, rebuilt as requests from the
 * row's numbers (the audit's hand export was not archived; each fixture states the public action chosen),
 * and the ten anonymised production All-In-Or-Fold requests of AnAofClosingSeatCallsFromTheNashTable. Each
 * preflop audit fixture folds without the option on every seed (RED: the recorded mistake) and calls with it
 * (GREEN). Personas: the base request's own, except where it does not reproduce the recorded fold (stated per
 * fixture: the Hybrid persona, the live fleet's, at the stated tightness).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import {
  HorseLogic,
  holdemAllInCallReversal,
  holdemAllInCallVerdictOfLastDecision,
  type HoldemAllInCallVerdict,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from './HorseEval.js';
import {
  HOLDEM_CLASSES,
  HOLDEM_TOURNAMENT_ALL_IN_LOCK_MARGIN,
  holdemOpenJamRange,
  holdemRangeEquity,
  holdemRangeWidth,
  holdemTopRange,
  preflopRoles,
  priceAllInCall,
  rejamWidth,
} from './HorseHoldemTournamentAllInCall.js';
import { nashV2JamWidth } from './HorseNashPushFoldV2.js';
import {
  BASE_DECISION_TIME_MS,
  BASE_MODS,
  BASE_STYLE,
  buildSpot,
  cards,
} from './AHoldemTournamentAllInCallIsPriced.fixtures.js';
import { AUDIT_CASES } from './AHoldemTournamentAllInCallIsPriced.cases.js';
import AOF from './AnAofClosingSeatCallsFromTheNashTable.fixture.json';
import type { SeatPlayer } from '../types.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';

const SEEDS = [1, 2, 3, 4, 5, 6];
type Arm = 'absent' | false | true;

interface Persona {
  style: string;
  mods: Record<string, unknown>;
}
const BASE_PERSONA: Persona = { style: BASE_STYLE, mods: BASE_MODS as Record<string, unknown> };
const hybrid = (tightness: number): Persona => ({
  style: 'hybrid',
  mods: { ...(BASE_MODS as Record<string, unknown>), tightness },
});

function decide(
  gs: HorseGameStateV2,
  player: SeatPlayer,
  arm: Arm,
  seed: number | null,
  persona: Persona = BASE_PERSONA,
  rngBefore?: number
): { action: string; amount?: number; tournamentUtilityRefusal?: string } {
  HorseMind.reset();
  if (seed === null) restoreFastRandom(rngBefore!);
  else seedFastRandom(seed);
  const decision = HorseLogic.decide(
    structuredClone(player),
    structuredClone(gs),
    persona.style as never,
    persona.mods as never,
    {
      decisionTimeMs: BASE_DECISION_TIME_MS,
      telemetry: true,
      ...(arm === 'absent' ? {} : { holdemTournamentAllInCallIsPriced: arm }),
    } as never
  ) as never as {
    action: string;
    amount?: number;
    tournamentUtilityRefusal?: string;
    tournamentPreflopAttribution?: { route?: string };
  };
  // Every decision passes the worker's own receipt validator (a refused decision folds the seat), and a
  // priced preflop answer is never presented as a named route's (chart_open_jam, chart_bb_defend,
  // variant_price) proposal.
  expect(
    horseDecisionReceiptRefusal(decision, 'nlh', { player, gameState: gs } as never)
  ).toBeNull();
  if (arm === true && holdemAllInCallVerdictOfLastDecision()?.street === 'preflop')
    expect(['chart_open_jam', 'chart_bb_defend', 'variant_price']).not.toContain(
      decision.tournamentPreflopAttribution?.route
    );
  return decision;
}

function caseAnswers(name: string, arm: Arm, persona: Persona = BASE_PERSONA): string[] {
  const { gs, player } = buildSpot(AUDIT_CASES[name].spec);
  return [...new Set(SEEDS.map((seed) => decide(gs, player, arm, seed, persona).action))].sort();
}

function verdictOf(name: string, persona: Persona = BASE_PERSONA): HoldemAllInCallVerdict {
  const { gs, player } = buildSpot(AUDIT_CASES[name].spec);
  decide(gs, player, true, 1, persona);
  const v = holdemAllInCallVerdictOfLastDecision();
  if (!v) throw new Error(`${name}: no priced verdict`);
  return v;
}

afterEach(() => HorseMind.reset());

describe('the price (HorseHoldemTournamentAllInCall)', () => {
  it('with nobody behind the margin is equity minus BF x C / (W + BF x C)', () => {
    const p = priceAllInCall({
      call: 100,
      bubbleFactor: 1,
      scenarios: [{ probability: 1, equity: 0.4, winnable: 200 }],
    })!;
    expect(p.requiredEquity).toBeCloseTo(100 / 300, 12);
    expect(p.margin).toBeCloseTo(0.4 - 100 / 300, 12);
    expect(p.verdict).toBe('call');
    const icm = priceAllInCall({
      call: 100,
      bubbleFactor: 1.5,
      scenarios: [{ probability: 1, equity: 0.4, winnable: 200 }],
    })!;
    expect(icm.requiredEquity).toBeCloseTo(150 / 350, 12);
    expect(icm.verdict).toBe('fold');
  });

  it('an overcall scenario is weighed in by its probability', () => {
    const p = priceAllInCall({
      call: 100,
      bubbleFactor: 1,
      scenarios: [
        { probability: 0.9, equity: 0.5, winnable: 200 },
        { probability: 0.1, equity: 0.2, winnable: 300 },
      ],
    })!;
    const ev = 0.9 * (0.5 * 200 - 0.5 * 100) + 0.1 * (0.2 * 300 - 0.8 * 100);
    expect(p.ev).toBeCloseTo(ev, 9);
    expect(p.margin).toBeCloseTo(ev / 300, 9);
  });

  it('the equity is seeded, has exact card removal and is right where it is known', () => {
    const onlyKK = new Float64Array(169);
    onlyKK[HOLDEM_CLASSES.indexOf('KK')] = 1;
    expect(holdemRangeWidth(onlyKK)).toBeCloseTo(6 / 1326, 12);
    const e1 = holdemRangeEquity(cards('AsAh'), [], [onlyKK], 7, 4000)!;
    const e2 = holdemRangeEquity(cards('AsAh'), [], [onlyKK], 7, 4000)!;
    expect(e1).toBe(e2);
    expect(e1).toBeGreaterThan(0.78);
    expect(e1).toBeLessThan(0.86);
    // A range the Horse's cards and the board make impossible cannot be priced.
    expect(holdemRangeEquity(cards('KsKh'), cards('KcKd2s'), [onlyKK], 1, 100)).toBeNull();
  });

  it('the open-jam range is the Nash V2 jam table; widths come out as stated', () => {
    for (const [behind, depth, ante] of [
      [1, 10, 1],
      [4, 8, 1],
      [8, 15, 0],
    ] as const)
      expect(holdemRangeWidth(holdemOpenJamRange(behind, depth, ante)) * 100).toBeCloseTo(
        nashV2JamWidth(behind, depth, ante),
        9
      );
    expect(holdemRangeWidth(holdemTopRange(0.13))).toBeCloseTo(0.13, 9);
    expect(rejamWidth(8)).toBeCloseTo(0.18, 12);
    expect(rejamWidth(25)).toBeCloseTo(0.06, 12);
  });

  it('the roles: an open-jam, a re-jam over an open, a jam over a 3-bet, a caller of a jam', () => {
    const roles = preflopRoles(
      [
        { seat: 3, action: 'raise', amount: 440 },
        { seat: 5, action: 'raise', amount: 1400 },
        { seat: 7, action: 'all_in', amount: 4000 },
        { seat: 8, action: 'call', amount: 4000 },
      ],
      new Set([7]),
      200
    );
    expect(roles.get(3)).toEqual({ kind: 'raise', raiseIndex: 1 });
    expect(roles.get(5)).toEqual({ kind: 'raise', raiseIndex: 2 });
    expect(roles.get(7)).toEqual({ kind: 'jam_over_three_bet', raiseIndex: 3 });
    expect(roles.get(8)).toEqual({ kind: 'caller', ofJam: true });
    const open = preflopRoles([{ seat: 7, action: 'all_in', amount: 3000 }], new Set([7]), 200);
    expect(open.get(7)).toEqual({ kind: 'open_jam', raiseIndex: 1 });
    const rejam = preflopRoles(
      [
        { seat: 3, action: 'raise', amount: 440 },
        { seat: 7, action: 'all_in', amount: 3000 },
      ],
      new Set([7]),
      200
    );
    expect(rejam.get(7)).toEqual({ kind: 'rejam', raiseIndex: 2 });
  });
});

/** Preflop audit fixtures, RED off and GREEN on, with the persona that reproduces the recorded fold. */
const PREFLOP_RED_GREEN: ReadonlyArray<readonly [string, string, Persona]> = [
  ['da2d1f44', 'the Hybrid persona; the base persona already calls 88 here', hybrid(1.02)],
  ['95b1c217', 'the base persona', BASE_PERSONA],
  ['1b51e45d', 'the base persona', BASE_PERSONA],
  ['d325481d', 'the base persona', BASE_PERSONA],
  [
    'fbfdfc4a',
    'the Hybrid persona at tightness 1.15; the base persona already calls',
    hybrid(1.15),
  ],
];

describe('preflop: the audit fixtures fold without the option and call with it', () => {
  it.each(PREFLOP_RED_GREEN)('%s (%s)', (name, _persona, persona) => {
    const c = AUDIT_CASES[name];
    expect(c.best).toBe('call');
    // RED: absent and false both reproduce the recorded fold on every seed.
    expect(caseAnswers(name, 'absent', persona)).toEqual(['fold']);
    expect(caseAnswers(name, false, persona)).toEqual(['fold']);
    // GREEN: priced, the call.
    const on = caseAnswers(name, true, persona);
    expect(on.length).toBe(1);
    expect(['call', 'all_in']).toContain(on[0]);
    const v = verdictOf(name, persona);
    expect(v.street).toBe('preflop');
    expect(v.price.verdict).toBe('call');
    expect(v.price.margin).toBeGreaterThan(0);
  });

  it('the committed fixture (d325481d) is committed, at a price of about 2%', () => {
    const v = verdictOf('d325481d');
    expect(v.committed).toBe(true);
    expect(v.price.requiredEquity).toBeLessThan(0.03);
    expect(v.price.equity).toBeGreaterThan(0.15);
  });

  it('the re-jams over the Horse own open are priced against the re-jam range, not the open-jam table', () => {
    for (const name of ['da2d1f44', '95b1c217', '1b51e45d']) {
      const v = verdictOf(name, name === 'da2d1f44' ? hybrid(1.02) : BASE_PERSONA);
      expect(v.price.equity, name).toBeGreaterThan(v.price.requiredEquity);
    }
  });

  it('the All-In-Or-Fold rows rebuilt from decisions.csv call with the option (the base persona calls them already)', () => {
    for (const name of ['475e2de7', '09bdb97c']) {
      expect(caseAnswers(name, 'absent'), name).toEqual(['all_in']);
      expect(caseAnswers(name, true), name).toEqual(['all_in']);
      expect(verdictOf(name).price.verdict, name).toBe('call');
    }
  });

  it('a hand the price folds is folded: 72o facing the 15bb re-jam of da2d1f44', () => {
    const spec = { ...AUDIT_CASES.da2d1f44.spec, heroCards: '7d2c' };
    const { gs, player } = buildSpot(spec);
    for (const seed of SEEDS) expect(decide(gs, player, true, seed).action).toBe('fold');
    expect(holdemAllInCallVerdictOfLastDecision()!.price.verdict).toBe('fold');
  });

  it('a short blind posted all-in under a larger non-all-in open is not priced as an all-in call', () => {
    // Seat 1 posted a 0.5bb small blind all-in; Seat 4 (20bb) opened to 2.5bb (not all-in); Hero (20bb) on BTN.
    // Calling 2.5bb leaves 17.5bb behind for postflop play, so preflop all-in call pricing stands aside.
    const { gs, player } = buildSpot({
      bb: 200,
      seats: [1, 2, 3, 4, 5, 6],
      dealer: 6,
      hero: 6,
      heroCards: 'KcQd',
      stacks: { 1: 100, 2: 4000, 3: 4000, 4: 4000, 5: 4000, 6: 4000 },
      streets: {
        preflop: [
          [3, 'fold', 0],
          [4, 'raise', 500],
          [5, 'fold', 0],
        ],
      },
      playersLeft: 200,
      spotsPaid: 30,
    });
    expect(gs.players.find((p) => p.seat === 1)?.is_all_in).toBe(true);
    expect(gs.currentBet).toBe(500);
    for (const seed of [1, 2, 3]) {
      const off = decide(gs, player, false, seed);
      const on = decide(gs, player, true, seed);
      expect(holdemAllInCallVerdictOfLastDecision()).toBeNull();
      expect(on.action).toBe(off.action);
    }
  });

  it('never removes a preflop raise or raising all-in over a short all-in with deeper stacks behind', () => {
    // Seat 3 (4bb) open-jams; Hero (15bb) with AA in CO with deeper live seats behind chooses raise/all_in off.
    // Preflop pricing runs after the reference chooses its action and keeps the raise/all_in untouched.
    const { gs, player } = buildSpot({
      bb: 200,
      seats: [1, 2, 3, 4, 5, 6],
      dealer: 6,
      hero: 5,
      heroCards: 'AsAh',
      stacks: { 1: 3000, 2: 3000, 3: 800, 4: 3000, 5: 3000, 6: 3000 },
      streets: {
        preflop: [
          [3, 'all_in', 0],
          [4, 'fold', 0],
        ],
      },
      playersLeft: 200,
      spotsPaid: 30,
    });
    for (const seed of [1, 2, 3]) {
      const off = decide(gs, player, false, seed);
      const on = decide(gs, player, true, seed);
      expect(['raise', 'all_in']).toContain(off.action);
      expect(on.action).toBe(off.action);
      expect(holdemAllInCallVerdictOfLastDecision()).toBeNull();
    }
  });

  it('preserves exact nashCallVsJam (chart_bb_defend) answers on standard-table lone open-jams', () => {
    // Standard 9-max tournament, 10bb lone open-jam from HJ with 4 players behind; Hero in CO (10bb) with AJo
    // is answered by nashCallVsJam (chart_bb_defend) and is not overridden by the Monte Carlo fold path.
    const { gs, player } = buildSpot({
      bb: 200,
      seats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      dealer: 9,
      hero: 8,
      heroCards: 'AsJd',
      stacks: {
        1: 2000,
        2: 2000,
        3: 2000,
        4: 2000,
        5: 2000,
        6: 2000,
        7: 2000,
        8: 2000,
        9: 2000,
      },
      streets: {
        preflop: [
          [3, 'fold', 0],
          [4, 'fold', 0],
          [5, 'fold', 0],
          [6, 'fold', 0],
          [7, 'all_in', 0],
        ],
      },
      playersLeft: 200,
      spotsPaid: 30,
    });
    // Live HandController marks a raising all-in with isFullRaise (undefined means an all-in call-off).
    for (const a of gs.actionHistory ?? []) {
      if (a.seat === 7 && a.action === 'all_in') a.isFullRaise = true;
    }
    for (const seed of [1, 2, 3]) {
      const off = decide(gs, player, false, seed);
      const on = decide(gs, player, true, seed);
      expect(off.action).toBe('call');
      expect(on.action).toBe('call');
      expect(holdemAllInCallVerdictOfLastDecision()).toBeNull();
    }
  });
});

describe('All-In-Or-Fold: the ten production requests (AnAofClosingSeatCallsFromTheNashTable)', () => {
  type Body = (typeof AOF.cases)[keyof typeof AOF.cases];
  const run = (body: Body, arm: Arm, seed: number | null) =>
    decide(
      body.gameState as unknown as HorseGameStateV2,
      body.player as unknown as SeatPlayer,
      arm,
      seed,
      { style: body.style, mods: body.mods as Record<string, unknown> },
      (body as { rngBefore?: number }).rngBefore
    ).action;

  it('every one folds without the option (the recorded fold) and follows its price with it', () => {
    let flipped = 0;
    for (const [name, body] of Object.entries(AOF.cases)) {
      for (const seed of [1, 2, 3]) {
        expect(run(body, 'absent', seed), name).toBe('fold');
        expect(run(body, false, seed), name).toBe('fold');
      }
      const on = [1, 2, 3].map((seed) => run(body, true, seed));
      const v = holdemAllInCallVerdictOfLastDecision();
      expect(v, name).not.toBeNull();
      expect(new Set(on).size, name).toBe(1);
      expect(on[0], name).toBe(v!.price.verdict === 'call' ? 'all_in' : 'fold');
      if (on[0] === 'all_in') flipped++;
    }
    // Nine of the ten clear their price; K3o (5.5bb, a player behind) does not and still folds.
    expect(flipped).toBe(9);
    expect(run(AOF.cases.kingThreeOffsuit, true, 1)).toBe('fold');
  });
});

describe('postflop: the call is checked against the price with the equity the engine computed', () => {
  it('fb6eb2ec spot (2dKsQh, a 47.72bb all-in into 36.52bb): a fold whose engine equity clears the price by more than 5 points is called', () => {
    // QdJd on the audit's spot: the engine folds it on some seeds while its own equity (about 0.44) is
    // above the price (0.36) by more than the lock.
    const { gs, player } = buildSpot({ ...AUDIT_CASES.fb6eb2ec.spec, heroCards: 'QdJd' });
    let changed = 0;
    for (const seed of SEEDS) {
      const off = decide(gs, player, 'absent', seed).action;
      const on = decide(gs, player, true, seed).action;
      const v = holdemAllInCallVerdictOfLastDecision()!;
      expect(v.street).toBe('postflop');
      if (v.price.margin > HOLDEM_TOURNAMENT_ALL_IN_LOCK_MARGIN) expect(on).not.toBe('fold');
      if (off === 'fold' && on !== 'fold') changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('the audit postflop rows are priced with the engine equity; where the engine itself reads them as the audit does not, it is stated', () => {
    // fb6eb2ec (Kd7d) and 7a7125e8 (Qc5c): the rebuilt requests are already called by the engine, and priced
    // calls. 0f7c778b (TsKh) and 2b5b823c (QhQd): the engine's own equity is about 0.25 against a price of
    // 0.34 and about 0.65 against 0.27, the reverse of the audit's 0.65 and 0.10, so the price agrees with the
    // engine's fold and call. Those two are an equity-model finding, not a price finding (BUILD.md).
    expect(verdictOf('fb6eb2ec').price.verdict).toBe('call');
    expect(verdictOf('7a7125e8').price.verdict).toBe('call');
    expect(verdictOf('0f7c778b').price.equity).toBeLessThan(0.34);
    for (const name of ['fb6eb2ec', '7a7125e8', '0f7c778b']) {
      const v = verdictOf(name);
      expect(v.street, name).toBe('postflop');
      const answers = caseAnswers(name, true);
      if (v.price.margin > HOLDEM_TOURNAMENT_ALL_IN_LOCK_MARGIN)
        expect(answers, name).not.toContain('fold');
      if (v.price.margin < -HOLDEM_TOURNAMENT_ALL_IN_LOCK_MARGIN)
        expect(answers, name).toEqual(['fold']);
    }
  });

  it('review N3: only a jam is priced postflop; a river bet that is not all in (2b5b823c) is not priced and decides as with the option off', () => {
    // The Phase 7 equity is taken against the preflop bands, not the bettor's line range; against a river bet
    // after two check-calls that pushed folds toward calls (the reverse of audit E's "river calls too light").
    // Frozen clock: the shadow joint-sampling budget is wall-clock (4 ms), so a loaded runner would otherwise perturb one side.
    withFrozenDecisionClock(() => {
      const { gs, player } = buildSpot(AUDIT_CASES['2b5b823c'].spec);
      expect(gs.players.some((p) => p.seat !== player.seat && p.is_all_in === true)).toBe(false);
      for (const seed of SEEDS) {
        const on = decide(gs, player, true, seed);
        expect(holdemAllInCallVerdictOfLastDecision()).toBeNull();
        expect(withoutClocks(on)).toBe(withoutClocks(decide(gs, player, 'absent', seed)));
      }
      // A jam on the same street keeps its price (the fb6eb2ec flop jam above, 7a7125e8 heads-up).
      expect(verdictOf('fb6eb2ec').street).toBe('postflop');
    });
  });
});

describe('no later owner turns the priced answer around beyond the lock', () => {
  const { gs, player } = buildSpot(AUDIT_CASES['1b51e45d'].spec);
  const verdict = (margin: number, committed = false): HoldemAllInCallVerdict => ({
    price: {
      equity: 0.5,
      requiredEquity: 0.5 - margin,
      bubbleFactor: 1,
      ev: margin,
      margin,
      call: 100,
      winnable: 100,
      verdict: margin > 0 ? 'call' : 'fold',
    },
    committed,
    street: 'preflop',
  });
  const call = { action: 'call' as const, amount: 100, thinkTime: 0 };
  const fold = { action: 'fold' as const, thinkTime: 0 };
  const raise = { action: 'raise' as const, amount: 900, thinkTime: 0 };
  it('a fold of a call priced 5 points or more above the price is refused; within the lock it stands', () => {
    expect(holdemAllInCallReversal(verdict(0.06), call, fold, player, gs)).toBe(true);
    expect(holdemAllInCallReversal(verdict(0.04), call, fold, player, gs)).toBe(false);
    expect(holdemAllInCallReversal(verdict(-0.06), fold, call, player, gs)).toBe(true);
    expect(holdemAllInCallReversal(verdict(-0.04), fold, call, player, gs)).toBe(false);
  });
  it('a committed call is protected at any positive margin', () => {
    expect(holdemAllInCallReversal(verdict(0.01, true), call, fold, player, gs)).toBe(true);
  });
  it('a raise is never refused, and nothing is refused without a verdict or off the priced answer', () => {
    expect(holdemAllInCallReversal(verdict(0.2), call, raise, player, gs)).toBe(false);
    expect(holdemAllInCallReversal(null, call, fold, player, gs)).toBe(false);
    expect(holdemAllInCallReversal(verdict(0.2), fold, call, player, gs)).toBe(false);
  });
});

/** The decision as JSON without its wall-clock fields (every key ending in Ms: latency, elapsed, policy and simulation milliseconds differ run to run). */
const withoutClocks = (d: unknown): string =>
  JSON.stringify(d, (key, value) => (/Ms$/.test(key) ? undefined : value));

describe('option off: nothing of it runs', () => {
  it('absent and false give the same decision, the same generator state, and no verdict, on every fixture', () => {
    // Frozen clock: the shadow joint-sampling budget is wall-clock (4 ms), so a loaded runner would otherwise perturb one side.
    withFrozenDecisionClock(() => {
      const bodies: Array<[HorseGameStateV2, SeatPlayer, Persona]> = [
        ...Object.values(AUDIT_CASES).map((c) => {
          const { gs, player } = buildSpot(c.spec);
          return [gs, player, BASE_PERSONA] as [HorseGameStateV2, SeatPlayer, Persona];
        }),
        ...Object.values(AOF.cases).map(
          (b) =>
            [
              b.gameState as unknown as HorseGameStateV2,
              b.player as unknown as SeatPlayer,
              { style: b.style, mods: b.mods as Record<string, unknown> },
            ] as [HorseGameStateV2, SeatPlayer, Persona]
        ),
      ];
      for (const [gs, player, persona] of bodies)
        for (const seed of [1, 2]) {
          const a = decide(gs, player, 'absent', seed, persona);
          const ra = saveFastRandom();
          expect(holdemAllInCallVerdictOfLastDecision()).toBeNull();
          const b = decide(gs, player, false, seed, persona);
          const rb = saveFastRandom();
          expect(holdemAllInCallVerdictOfLastDecision()).toBeNull();
          expect(withoutClocks(b)).toBe(withoutClocks(a));
          expect(rb).toBe(ra);
        }
    });
  });
});
