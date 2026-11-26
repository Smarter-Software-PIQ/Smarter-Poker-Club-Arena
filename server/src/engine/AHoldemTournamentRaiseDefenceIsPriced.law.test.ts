/**
 * LAW: A HOLD'EM TOURNAMENT RAISE IS DEFENDED AT ITS PRICE (three options, default OFF):
 * holdemTournamentHeadsUpBigBlindDefenceIsPriced, holdemTournamentBlindDefenceIsPriced,
 * holdemTournamentCommittedRaiseIsPriced (HorseHoldemTournamentRaiseDefence.ts, ...Wiring.ts).
 *
 * The read-only sweep NLH-TOURNAMENT-SWEEP (2026-11-24) measured three preflop leaks a person can farm: the heads-up
 * big blind under 20 big blinds folds 82% to a small open; both blinds at 10-15 big blinds fold 74% to small steals;
 * a non-all-in re-raise gets more folds than a jam at a better price. On main the short-stack node answers any faced
 * raise with jam-on-a-fixed-bar or fold. With an option on, the answer in its scope is the fold, call or shove of
 * highest expected value, with no random draw.
 *
 * Every decision here goes through HorseLogic.decide with the production switch snapshot (the repo's
 * docs/horse-option-switch-state.json, mapped by this build's switch code), the base production tournament request
 * re-dealt (HorseHoldemTournamentRaiseDefence.spots.ts), the base persona, one combo per starting-hand class weighted
 * by the class's combos. Run 2026-11-24 against origin/main 0de6d1c with only the new files copied and no hooks, the
 * heads-up laws without an ante, the three blind laws, the 4-bet and committing-raise laws, registration, ownership
 * and the three real hands FAIL (the big-blind-ante heads-up cases and the 3-bet-to-6bb comparison already hold on
 * main); on this branch every case passes.
 *
 * v2 (2026-11-24, anchored to equilibrium): v1's pure max-EV answer, priced against the pool's own over-folding,
 * overshot to never folding and shoving nearly every hand at 15-25 big blinds. The bands are now the solved
 * equilibrium's (HorseHoldemTournamentRaiseDefenceSolved): at each depth the fold, call and raise shares of the
 * Horse's answer (production switch snapshot, the measured population priors in force) sit within BAND of the
 * solved shares; the solved tables are exploitable by less than 0.05 big blinds per hand in every spot; at the
 * solved prior the Horse plays the table; the all-in call price reads the same jam range the Horse jams.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HorseLogic,
  holdemAllInCallVerdictOfLastDecision,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  HOLDEM_CLASSES,
  holdemClassComboCount,
  priceAllInCall,
} from './HorseHoldemTournamentAllInCall.js';
import {
  COMMIT_BEHIND_SHARE,
  classVsClassEquity,
  equityVsRange,
  isCommitted,
  priceRaiseDefence,
  raiserModel,
} from './HorseHoldemTournamentRaiseDefence.js';
import { holdemRaiseDefenceOfLastDecision } from './HorseHoldemTournamentRaiseDefenceWiring.js';
import {
  HOLDEM_RAISE_DEFENCE_SOLVED_INDEX,
  HOLDEM_RAISE_DEFENCE_SOLVED_WORST_GAIN_BB,
  SOLVED_NODE_ACTIONS,
  solvedAction,
  solvedJamRange,
  solvedRangeOf,
  solvedNode,
  type SolvedQuery,
} from './HorseHoldemTournamentRaiseDefenceSolved.js';
import {
  priceAnchoredDefence,
  type AnchoredNode,
  type AnchoredSpot,
} from './HorseHoldemTournamentRaiseDefenceAnchored.js';
import { REJAM_WIDTH_DEEP, REJAM_WIDTH_SHORT } from './HorseHoldemTournamentAllInCall.js';
import {
  BASE_MODS,
  BASE_STYLE,
  buildRaiseDefenceSpot,
  cards,
  productionDecideOpts,
  type Act,
  type RaiseDefenceSpotSpec,
} from './HorseHoldemTournamentRaiseDefence.spots.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF, optionSwitchStatesOf } from './HorseOptionSwitch.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import type { SeatPlayer } from '../types.js';

const HU = 'holdemTournamentHeadsUpBigBlindDefenceIsPriced';
const BLIND = 'holdemTournamentBlindDefenceIsPriced';
const COMMIT = 'holdemTournamentCommittedRaiseIsPriced';
const ALL_ON = { [HU]: true, [BLIND]: true, [COMMIT]: true };
const BB = 100;
/** The band (share points) the Horse's answer keeps around the solved equilibrium's shares. */
const BAND = 0.07;
/** The exploitability tolerance of the solved tables (best-response gain, big blinds per hand). */
const EXPLOIT_TOLERANCE_BB = 0.05;

/** Combo-weighted shares of a solved node's actions over the classes, weighted by `weight` (all hands when absent). */
function solvedShares(
  q: SolvedQuery,
  node: keyof typeof SOLVED_NODE_ACTIONS,
  weight?: Float64Array
) {
  const n = solvedNode(q, node)!;
  const out: Record<string, number> = {};
  let tot = 0;
  for (let c = 0; c < 169; c++)
    tot += (weight ? weight[c] : 1) * holdemClassComboCount(HOLDEM_CLASSES[c]);
  n.actions.forEach((a, i) => {
    let x = 0;
    for (let c = 0; c < 169; c++)
      x += (weight ? weight[c] : 1) * holdemClassComboCount(HOLDEM_CLASSES[c]) * n.p[i][c];
    out[a] = x / tot;
  });
  return out;
}
/**
 * The Horse's frequencies (fold, call, all_in, raise) weighted per class: where the anchored price answered, the
 * frequencies it played (the receipt's played mix: one combo per class would otherwise show one draw of a mixed
 * class); elsewhere the decision's shape.
 */
function weightedRates(
  spotOf: (c: string) => RaiseDefenceSpotSpec,
  extra: Record<string, unknown>,
  weight?: Float64Array
) {
  const out: Record<Shape, number> = { fold: 0, call: 0, all_in: 0, raise: 0 };
  let n = 0;
  HOLDEM_CLASSES.forEach((cls, i) => {
    const w = (weight ? weight[i] : 1) * holdemClassComboCount(cls);
    if (!(w > 0)) return;
    const r = run(spotOf(comboOf(cls)), extra);
    const a = holdemRaiseDefenceOfLastDecision()?.anchored;
    if (a)
      a.actions.forEach((act, j) => {
        const k: Shape =
          act === 'jam' ? 'all_in' : act === 'fold' || act === 'call' ? act : 'raise';
        out[k] += w * a.played[j];
      });
    else out[r.shape] += w;
    n += w;
  });
  for (const k of Object.keys(out) as Shape[]) out[k] /= n;
  return out;
}
function expectInBand(horse: Record<Shape, number>, solved: Record<string, number>, label: string) {
  const pairs: Array<[Shape, number]> = [
    ['fold', solved.fold ?? 0],
    ['call', solved.call ?? 0],
    ['all_in', solved.jam ?? 0],
    ['raise', (solved.three_bet ?? 0) + (solved.four_bet ?? 0)],
  ];
  for (const [k, want] of pairs)
    expect(
      Math.abs(horse[k] - want),
      `${label} ${k}: Horse ${horse[k].toFixed(3)} solved ${want.toFixed(3)}`
    ).toBeLessThanOrEqual(BAND);
}
const DECISION_TIME_MS = 1795000000000;

let PROD: Record<string, unknown> = {};
beforeAll(async () => {
  PROD = await productionDecideOpts();
  enableBrainTelemetry();
});
afterEach(() => HorseMind.reset());

/** One combo per class (fixed suits), weighted by the class's combo count. */
const comboOf = (cls: string) =>
  cls.length === 2
    ? `${cls[0]}c${cls[1]}d`
    : cls.endsWith('s')
      ? `${cls[0]}c${cls[1]}c`
      : `${cls[0]}c${cls[1]}d`;

type Shape = 'fold' | 'call' | 'all_in' | 'raise';
interface Run {
  shape: Shape;
  action: string;
  amount: number | null;
  fires: string[];
  decision: Record<string, unknown>;
  gs: HorseGameStateV2;
  player: SeatPlayer;
}

function shapeOf(
  d: { action: string; amount?: number },
  gs: HorseGameStateV2,
  player: SeatPlayer
): Shape {
  const matchable = Math.min(
    player.stack + player.bet,
    Math.max(
      ...gs.players
        .filter((p) => p.seat !== player.seat && !p.is_folded)
        .map((p) => p.stack + p.bet)
    )
  );
  if (d.action === 'fold') return 'fold';
  if (d.action === 'call' || d.action === 'check') return 'call';
  if (d.action === 'all_in') return 'all_in';
  return (d.amount ?? 0) >= matchable - 1e-9 ? 'all_in' : 'raise';
}

function run(
  spec: RaiseDefenceSpotSpec,
  extra: Record<string, unknown>,
  seed = 1,
  mode?: 'cash'
): Run {
  const { gs, player } = buildRaiseDefenceSpot(spec);
  if (mode === 'cash') {
    gs.gameMode = 'cash' as never;
    delete (gs as { tournament?: unknown }).tournament;
  }
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
  drainFires();
  const d = withFrozenDecisionClock(() =>
    HorseLogic.decide(
      structuredClone(player),
      structuredClone(gs),
      BASE_STYLE as never,
      BASE_MODS as never,
      {
        ...PROD,
        ...extra,
        telemetry: true,
        observeMind: false,
        decisionTimeMs: DECISION_TIME_MS,
      } as never
    )
  ) as unknown as { action: string; amount?: number };
  const fires = drainFires().map((f) => f.feature);
  return {
    shape: shapeOf(d, gs, player),
    action: d.action,
    amount: d.amount ?? null,
    fires,
    decision: d as unknown as Record<string, unknown>,
    gs,
    player,
  };
}

// ── Spots ──────────────────────────────────────────────────────────────────
/** Heads-up: seat 1 the dealer and small blind opens to `open` big blinds; seat 2 the big blind decides. */
const huSpot = (
  depth: number,
  open: number,
  ante: 'none' | 'bba',
  heroCards: string
): RaiseDefenceSpotSpec => ({
  bb: BB,
  seats: [1, 2],
  dealer: 1,
  hero: 2,
  heroCards,
  stacks: { 1: depth * BB, 2: depth * BB },
  preflop: [[1, 'raise', open * BB]],
  ante,
  playersLeft: 2,
  spotsPaid: 1,
  format: ante === 'none' ? 'spin' : 'mtt',
});
const NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const stacksOf = (depth: number) => Object.fromEntries(NINE.map((s) => [s, depth * BB]));
/** Nine dealt, the button (7) opens; the small blind (8) or, after it folds, the big blind (9) decides. */
const stealSpot = (
  depth: number,
  open: number,
  hero: 8 | 9,
  heroCards: string
): RaiseDefenceSpotSpec => {
  const pre: Act[] = [1, 2, 3, 4, 5, 6].map((s) => [s, 'fold', 0] as Act);
  pre.push([7, 'raise', open * BB]);
  if (hero === 9) pre.push([8, 'fold', 0]);
  return {
    bb: BB,
    seats: NINE,
    dealer: 7,
    hero,
    heroCards,
    stacks: stacksOf(depth),
    preflop: pre,
    ante: 'bba',
    playersLeft: 40,
    spotsPaid: 6,
  };
};
/** Nine dealt, the button (7) opens and the big blind (9) re-raises to `to` (a jam with `to` = its stack). */
const vs3betSpot = (
  depth: number,
  open: number,
  to: number | 'jam',
  heroCards: string
): RaiseDefenceSpotSpec => ({
  bb: BB,
  seats: NINE,
  dealer: 7,
  hero: 7,
  heroCards,
  stacks: stacksOf(depth),
  preflop: [
    ...[1, 2, 3, 4, 5, 6].map((s) => [s, 'fold', 0] as Act),
    [7, 'raise', open * BB],
    [8, 'fold', 0],
    to === 'jam' ? [9, 'all_in', 0] : [9, 'raise', to * BB],
  ],
  ante: 'bba',
  playersLeft: 40,
  spotsPaid: 6,
});
const firstInSpot = (depth: number, heroCards: string): RaiseDefenceSpotSpec => ({
  bb: BB,
  seats: NINE,
  dealer: 7,
  hero: 7,
  heroCards,
  stacks: stacksOf(depth),
  preflop: [1, 2, 3, 4, 5, 6].map((s) => [s, 'fold', 0] as Act),
  ante: 'bba',
  playersLeft: 40,
  spotsPaid: 6,
});

/** Combo-weighted share of each shape over the classes kept by `keep` (all when absent). */
function rates(
  spotOf: (c: string) => RaiseDefenceSpotSpec,
  extra: Record<string, unknown>,
  keep?: (cls: string) => boolean
) {
  const out: Record<Shape, number> = { fold: 0, call: 0, all_in: 0, raise: 0 };
  let n = 0;
  for (const cls of HOLDEM_CLASSES) {
    if (keep && !keep(cls)) continue;
    const w = holdemClassComboCount(cls);
    out[run(spotOf(comboOf(cls)), extra).shape] += w;
    n += w;
  }
  for (const k of Object.keys(out) as Shape[]) out[k] /= n;
  return { ...out, combos: n };
}

/** The classes that open with a raise that is not all in, first in on the button at this depth (this build, these options). */
function openingClasses(depth: number, extra: Record<string, unknown>): Set<string> {
  const keep = new Set<string>();
  for (const cls of HOLDEM_CLASSES)
    if (run(firstInSpot(depth, comboOf(cls)), extra).shape === 'raise') keep.add(cls);
  return keep;
}

// ── Registration ───────────────────────────────────────────────────────────
describe('registration', () => {
  it('the three options are registered dark: release default off, switchable', () => {
    for (const name of [HU, BLIND, COMMIT]) {
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(name);
      expect(optionSwitchStatesOf(name)).toContain('off');
      expect(optionSwitchStatesOf(name)).toContain('on');
    }
  });
});

// ── The price ──────────────────────────────────────────────────────────────
describe('the price (HorseHoldemTournamentRaiseDefence)', () => {
  it('the class equity table is a probability table that is antisymmetric', () => {
    const aa = HOLDEM_CLASSES.indexOf('AA');
    const kk = HOLDEM_CLASSES.indexOf('KK');
    const o72 = HOLDEM_CLASSES.indexOf('72o');
    expect(classVsClassEquity(aa, kk)).toBeGreaterThan(0.8);
    expect(classVsClassEquity(aa, kk)).toBeLessThan(0.84);
    expect(classVsClassEquity(aa, kk) + classVsClassEquity(kk, aa)).toBeCloseTo(1, 4);
    expect(classVsClassEquity(o72, o72)).toBeCloseTo(0.5, 4);
    // Card removal: AsAh against a range of only aces has the one combo left.
    const onlyAA = new Float64Array(169);
    onlyAA[aa] = 1;
    expect(equityVsRange(cards('AsAh'), onlyAA)).toBeCloseTo(0.5, 4);
  });

  it('a committed raise is priced exactly like the equivalent shove (the all-in call price)', () => {
    // 15bb big blind (14 behind + 1 posted) facing an open to 12bb from a covering stack: behind after the call 3bb.
    const raiser = raiserModel({ role: 'open', depthBB: 15, dealt: 6, raiserBehind: 2 });
    for (const hand of ['AsKd', '9h9c', 'Qc7d', '7s2h', 'JdTd']) {
      const spot = {
        hero: cards(hand),
        bb: BB,
        pot: 1200 + 100 + 50 + 100,
        heroStack: 1400,
        heroBet: 100,
        raiserStack: 3000,
        raiserBet: 1200,
        heroInPosition: false,
        raiser,
        behind: [],
        bubbleFactor: 1.2,
        canCall: true,
        canShove: false,
      };
      expect(
        isCommitted({
          behindAfterCall: 1400 - 1100,
          potAfterCall: spot.pot + 1100,
          raiseTo: 1200,
          chipsAtStreetStart: 1500,
        })
      ).toBe(true);
      const v = priceRaiseDefence(spot)!;
      expect(v.committed).toBe(true);
      const allIn = priceAllInCall({
        call: 1400,
        bubbleFactor: 1.2,
        scenarios: [{ probability: 1, equity: v.equity, winnable: spot.pot + 300 }],
      })!;
      expect(v.evCall! * BB).toBeCloseTo(allIn.ev, 6);
      expect(v.action === 'call' ? 'call' : 'fold').toBe(allIn.verdict);
    }
    expect(COMMIT_BEHIND_SHARE).toBe(0.25);
  });

  it('draws no random number: the price runs with every generator stubbed to throw, and the sources name none', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('the raise defence read Math.random');
    });
    try {
      const raiser = raiserModel({ role: 'open', depthBB: 12, dealt: 2, raiserBehind: 1 });
      for (const cls of HOLDEM_CLASSES) {
        const v = priceRaiseDefence({
          hero: cards(comboOf(cls)),
          bb: BB,
          pot: 300,
          heroStack: 1100,
          heroBet: 100,
          raiserStack: 1000,
          raiserBet: 200,
          heroInPosition: false,
          raiser,
          behind: [],
          bubbleFactor: 1,
          canCall: true,
          canShove: true,
        });
        expect(v).not.toBeNull();
      }
    } finally {
      spy.mockRestore();
    }
    for (const f of [
      'HorseHoldemTournamentRaiseDefence.ts',
      'HorseHoldemTournamentRaiseDefenceWiring.ts',
      'HorseHoldemTournamentRaiseDefencePriors.data.ts',
      'HorseHoldemPreflopClassEquity.data.ts',
    ]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(
        /Math\.random|SeededRandom|seedFastRandom|fastRandom|hashSeed|\brng\b|\.next\(\)/
      );
    }
  });
});

// ── A: the heads-up big blind ──────────────────────────────────────────────
describe('A: the heads-up big blind facing a min-raise answers near the solved equilibrium', () => {
  // A min-raise to 2bb risks 1.5bb (no ante) to win 1.5bb, or 1.5bb to win 2.5bb with a big-blind ante: a pure
  // any-two bluff breaks even when the big blind folds 50% / 37.5%. Main folds about 88% at every depth below the
  // zone's end; v1 folded 0-2% and shoved up to 100%. The band: fold, call, jam within BAND of the solved shares.
  const cases: Array<[number, 'none' | 'bba', number]> = [];
  for (const d of [6, 8, 10, 12, 14, 17, 20, 25]) {
    cases.push([d, 'none', 0.5]);
    cases.push([d, 'bba', 1.5 / 4]);
  }
  it.each(cases)(
    '%ibb, ante %s: shares within the band of the solved shares, fold below the any-two break-even %f',
    (depth, ante, breakEven) => {
      const r = weightedRates((c) => huSpot(depth, 2, ante, c), { [HU]: true });
      const q = { kind: 'hu', depthBB: depth, openBB: 2, anteBB: ante === 'none' ? 0 : 1 };
      expectInBand(r, solvedShares(q, 'd_vs_open'), `${depth}bb ${ante}`);
      expect(r.fold).toBeLessThanOrEqual(breakEven);
    },
    120_000
  );
});

// ── B: the blinds facing a steal ───────────────────────────────────────────
describe('B: both blinds facing a button min-raise steal at 10-15bb answer near the solved equilibrium', () => {
  // The button risks 2.2bb to win 2.5bb (0.5 + 1 + a 1bb big-blind ante): break-even all-fold 46.8%.
  it.each([10, 12, 15])(
    '%ibb: each blind within the band of its solved shares; P(both blinds fold) <= 46.8%%',
    (depth) => {
      const sb = weightedRates((c) => stealSpot(depth, 2.2, 8, c), { [BLIND]: true });
      const bb = weightedRates((c) => stealSpot(depth, 2.2, 9, c), { [BLIND]: true });
      const q = (side: 'sb' | 'bb') => ({
        kind: `ring:2:${side}`,
        depthBB: depth,
        openBB: 2.2,
        anteBB: 1,
      });
      expectInBand(sb, solvedShares(q('sb'), 'd_vs_open'), `${depth}bb small blind`);
      expectInBand(bb, solvedShares(q('bb'), 'd_vs_open'), `${depth}bb big blind`);
      expect(sb.fold * bb.fold).toBeLessThanOrEqual(2.2 / 4.7);
    },
    240_000
  );
});

// ── C: a re-raise that is not all in ───────────────────────────────────────
describe('C: a non-all-in re-raise gets no more folds than the jam at a worse price', () => {
  it('22bb: over the solved opening range the reply to a 3-bet to 6bb sits within the band of the solved reply', () => {
    const q = { kind: 'ring:2:bb', depthBB: 22, openBB: 2.2, anteBB: 1 };
    const open = solvedRangeOf(solvedNode(q, 'o_root')!, 'open');
    const horse = weightedRates((c) => vs3betSpot(22, 2.2, 6, c), { [COMMIT]: true }, open);
    expectInBand(horse, solvedShares(q, 'o_vs_3bet', open), '22bb opener vs 3-bet');
  }, 300_000);

  it('22bb button opening range: fold to a 3-bet to 6bb <= fold to the 3-bet jam', () => {
    const extra = { [COMMIT]: true };
    const range = openingClasses(22, extra);
    expect(range.size).toBeGreaterThan(20);
    const small = rates(
      (c) => vs3betSpot(22, 2.2, 6, c),
      extra,
      (cls) => range.has(cls)
    );
    const jam = rates(
      (c) => vs3betSpot(22, 2.2, 'jam', c),
      extra,
      (cls) => range.has(cls)
    );
    expect(small.fold).toBeLessThanOrEqual(jam.fold);
  }, 300_000);
});

/** Nine dealt: the button (7) opens to `open`, the big blind (9, the hero) re-raised to `three`, the button 4-bets to `four`. */
const vs4betSpot = (
  depth: number,
  open: number,
  three: number,
  four: number,
  heroCards: string
): RaiseDefenceSpotSpec => ({
  bb: BB,
  seats: NINE,
  dealer: 7,
  hero: 9,
  heroCards,
  stacks: stacksOf(depth),
  preflop: [
    ...[1, 2, 3, 4, 5, 6].map((s) => [s, 'fold', 0] as Act),
    [7, 'raise', open * BB],
    [8, 'fold', 0],
    [9, 'raise', three * BB],
    [7, 'raise', four * BB],
  ],
  ante: 'bba',
  playersLeft: 40,
  spotsPaid: 6,
});

describe('C: a 4-bet that is not all in is not farmed, and a committing raise is answered like the jam', () => {
  it.each([25, 30, 40])(
    '%ibb: over the solved heads-up 3-betting range, the reply to a non-all-in 4-bet sits within the band of the solved reply',
    (depth) => {
      // Heads-up: the small blind opens 2bb, the big blind 3-bets to 6bb, the small blind 4-bets to 13.2bb.
      const q = { kind: 'hu', depthBB: depth, openBB: 2, anteBB: 0 };
      const three = solvedRangeOf(solvedNode(q, 'd_vs_open')!, 'three_bet');
      const spec = (c: string): RaiseDefenceSpotSpec => ({
        ...huSpot(depth, 2, 'none', c),
        preflop: [
          [1, 'raise', 2 * BB],
          [2, 'raise', 6 * BB],
          [1, 'raise', 13.2 * BB],
        ],
      });
      const horse = weightedRates(spec, { [COMMIT]: true }, three);
      expectInBand(horse, solvedShares(q, 'd_vs_4bet', three), `${depth}bb 3-bettor vs 4-bet`);
      // (v1 held the fold under a pure 4-bet bluff's break-even, 58.3%; the equilibrium 4-bet range holds value and
      // the solved reply folds up to about 61% of the 3-betting range at 30bb: the band is the law now.)
    },
    300_000
  );

  it("22bb: the button's opening range answers a re-raise to 20bb (committing) as the all-in call price answers the jam: the same verdict on every clear class, fold shares within 10 points", () => {
    // The committing raise is priced in the class equity table against the solved jam range; the jam by the all-in
    // call price against the same range with a seeded Monte Carlo of 3,000 deals (about 1 equity point of noise).
    // Against the polarized solved re-jam range many classes sit within a point or two of the price, so the shares
    // are compared on the clear classes: those whose committed call is more than 2 equity points from the price
    // (|EV| above 2% of the all-in pot, 45.5bb here).
    const extra = { [COMMIT]: true };
    // The jam is the all-in call price's domain: it is on for the jam runs (the production snapshot may hold it off).
    const jamArm = { ...extra, holdemTournamentAllInCallIsPriced: true };
    const range = openingClasses(22, extra);
    let clear = 0;
    let compared = 0;
    for (const cls of range) {
      const c = run(vs3betSpot(22, 2.2, 20, comboOf(cls)), extra);
      const v = holdemRaiseDefenceOfLastDecision()?.verdict;
      if (!v || v.evCall === null || Math.abs(v.evCall) <= 0.02 * 45.5) continue;
      clear++;
      run(vs3betSpot(22, 2.2, 'jam', comboOf(cls)), jamArm);
      // The all-in call price's own verdict (the Phase 7 arbiter may still move a jam call within its 5-point lock).
      // Where the reference answered the jam with a raise all in the price stands aside (it never removes a raise):
      // that class is not a comparison of the two prices.
      const jv = holdemAllInCallVerdictOfLastDecision();
      if (!jv) continue;
      compared++;
      expect(c.shape === 'fold' ? 'fold' : 'call', cls).toBe(jv.price.verdict);
    }
    expect(clear).toBeGreaterThan(range.size / 2);
    expect(compared).toBeGreaterThan(10);
    const committing = rates(
      (c) => vs3betSpot(22, 2.2, 20, c),
      extra,
      (cls) => range.has(cls)
    );
    const jam = rates(
      (c) => vs3betSpot(22, 2.2, 'jam', c),
      jamArm,
      (cls) => range.has(cls)
    );
    expect(Math.abs(committing.fold - jam.fold)).toBeLessThanOrEqual(0.1);
  }, 300_000);
});

// ── Determinism, ownership, receipts ───────────────────────────────────────
describe('the priced answer is the final answer, the same on every seed, with its receipts', () => {
  it('heads-up 12bb and 17bb, blinds 12bb, re-raises 22bb: every priced decision', () => {
    const spots: Array<(c: string) => RaiseDefenceSpotSpec> = [
      (c) => huSpot(12, 2, 'none', c),
      (c) => huSpot(17, 2.5, 'bba', c),
      (c) => stealSpot(12, 2.2, 8, c),
      (c) => stealSpot(12, 2.2, 9, c),
      (c) => vs3betSpot(22, 2.2, 6, c),
    ];
    let priced = 0;
    for (const spotOf of spots)
      for (const cls of HOLDEM_CLASSES.filter((_, i) => i % 3 === 0)) {
        const spec = spotOf(comboOf(cls));
        const first = run(spec, ALL_ON, 1);
        const pending = holdemRaiseDefenceOfLastDecision();
        if (!pending) continue;
        priced++;
        expect(first.shape, `${cls}`).toBe(pending.shape);
        expect(first.fires).toContain(
          pending.kind === 'hu_bb'
            ? 'holdem_tournament_raise_defence_hu_bb_priced_seen'
            : pending.kind === 'blind_defence'
              ? 'holdem_tournament_raise_defence_blind_defence_priced_seen'
              : 'holdem_tournament_raise_defence_committed_raise_priced_seen'
        );
        expect(first.fires).toContain(
          `holdem_tournament_raise_defence_${
            pending.shape === 'all_in'
              ? 'shove'
              : pending.shape === 'raise'
                ? 'reraise'
                : pending.shape
          }_seen`
        );
        if (pending.anchored) {
          // The receipt carries the mix, the played mix and the draw; the played action is the draw's.
          const v = pending.anchored;
          expect(v.played.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
          let acc = 0;
          let pick = -1;
          for (let i = 0; i < v.played.length; i++) {
            acc += v.played[i];
            if (pick < 0 && v.draw < acc - 1e-12) pick = i;
          }
          expect(v.actions[pick]).toBe(v.action);
        }
        expect(
          horseDecisionReceiptRefusal(first.decision as never, 'nlh', {
            player: first.player,
            gameState: first.gs,
          } as never)
        ).toBeNull();
        expect(['chart_open_jam', 'chart_bb_defend', 'variant_price']).not.toContain(
          (first.decision.tournamentPreflopAttribution as { route?: string } | undefined)?.route
        );
        for (const seed of [2, 7, 20261124]) {
          const again = run(spec, ALL_ON, seed);
          expect([again.action, again.amount], `${cls} seed ${seed}`).toEqual([
            first.action,
            first.amount,
          ]);
        }
      }
    expect(priced).toBeGreaterThan(200);
  }, 600_000);
});

// ── Off is main; out of scope is untouched ─────────────────────────────────
describe('off changes nothing; cash and spots outside the scope are untouched', () => {
  it('false equals absent; on equals off in cash, facing a jam, and deeper than the scope', () => {
    const sample = HOLDEM_CLASSES.filter((_, i) => i % 7 === 0);
    const offArms = [{}, { [HU]: false, [BLIND]: false, [COMMIT]: false }];
    for (const cls of sample) {
      const c = comboOf(cls);
      for (const spec of [
        huSpot(12, 2, 'none', c),
        stealSpot(12, 2.2, 9, c),
        vs3betSpot(22, 2.2, 6, c),
      ]) {
        const [a, b] = offArms.map((x) => run(spec, x).decision);
        const diff = Object.keys({ ...a, ...b }).filter(
          (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])
        );
        expect(diff, `${cls}`).toEqual([]);
      }
      // cash: the same heads-up spot as a cash hand
      const cashOn = run(huSpot(12, 2, 'none', c), ALL_ON, 1, 'cash').decision;
      const cashOff = run(huSpot(12, 2, 'none', c), {}, 1, 'cash').decision;
      expect(
        Object.keys({ ...cashOn, ...cashOff }).filter(
          (k) => JSON.stringify(cashOn[k]) !== JSON.stringify(cashOff[k])
        ),
        'cash'
      ).toEqual([]);
      // facing a jam: the all-in call price's domain. With that price off, the options change nothing there; with it
      // on they change only the jam range it reads (the law below).
      const allInOff = { holdemTournamentAllInCallIsPriced: false };
      expect(
        JSON.stringify(run(vs3betSpot(22, 2.2, 'jam', c), { ...ALL_ON, ...allInOff }).decision)
      ).toBe(JSON.stringify(run(vs3betSpot(22, 2.2, 'jam', c), allInOff).decision));
      // deeper than the blind scope (40bb heads-up)
      expect(
        JSON.stringify(run(huSpot(40, 2, 'none', c), { [HU]: true, [BLIND]: true }).decision)
      ).toBe(JSON.stringify(run(huSpot(40, 2, 'none', c), {}).decision));
    }
  }, 300_000);
});

// ── Three real hands from the sweep's window ───────────────────────────────
describe('three real hands (hand_history, 2026-11-23, rebuilt from the public node; the Horse folded on main)', () => {
  // a8a15a42: Spin heads-up, blinds 10/20, no ante. Big blind (seat 1, 290 chips, A8o) faced the small blind's
  // (seat 2, 610 chips) open to 41 and folded (14.5bb effective).
  const l1: RaiseDefenceSpotSpec = {
    bb: 20,
    seats: [1, 2],
    dealer: 2,
    hero: 1,
    heroCards: 'As8h',
    stacks: { 1: 290, 2: 610 },
    preflop: [[2, 'raise', 41]],
    ante: 'none',
    playersLeft: 2,
    spotsPaid: 1,
    format: 'spin',
  };
  // 6d685c9a: MTT, eight dealt, blinds 150/300, no ante that level. Small blind (seat 9, 3,703 chips, ATo) faced the
  // cutoff's (seat 6, 5,601 chips) open to 667 with the big blind behind and folded (12.3bb effective). The
  // tournament stage was missing from the public node: 40 left and 6 paid are stated, not recorded.
  const l2: RaiseDefenceSpotSpec = {
    bb: 300,
    seats: [1, 2, 3, 4, 5, 6, 7, 9],
    dealer: 7,
    hero: 9,
    heroCards: 'AsTc',
    stacks: { 1: 2607, 2: 5000, 3: 7536, 4: 7204, 5: 9482, 6: 5601, 7: 8867, 9: 3703 },
    preflop: [
      [2, 'fold', 0],
      [3, 'fold', 0],
      [4, 'fold', 0],
      [5, 'fold', 0],
      [6, 'raise', 667],
      [7, 'fold', 0],
    ],
    ante: 'none',
    playersLeft: 40,
    spotsPaid: 6,
  };
  // 8b5a715a: MTT, eight dealt, 34 left, 6 paid, blinds 100/200, no ante that level. Seat 6 (5,355 chips, AJo)
  // opened to 462; the big blind (seat 4, 4,645 chips) re-raised to 1,486, not all in; the Horse folded (23.2bb).
  const l4: RaiseDefenceSpotSpec = {
    bb: 200,
    seats: [1, 2, 3, 4, 5, 6, 7, 8],
    dealer: 2,
    hero: 6,
    heroCards: 'AdJs',
    stacks: { 1: 4800, 2: 920, 3: 5657, 4: 4645, 5: 5391, 6: 5355, 7: 11054, 8: 7178 },
    preflop: [
      [5, 'fold', 0],
      [6, 'raise', 462],
      [7, 'fold', 0],
      [8, 'fold', 0],
      [1, 'fold', 0],
      [2, 'fold', 0],
      [3, 'fold', 0],
      [4, 'raise', 1486],
    ],
    ante: 'none',
    playersLeft: 34,
    spotsPaid: 6,
  };
  it('8b5a715a AJo opener vs non-all-in 3-bet: folds on main; with its option on plays the solved mix (seeded draw)', () => {
    for (const seed of [1, 2, 3]) {
      expect(run(l4, {}, seed).shape).toBe('fold');
      const on = run(l4, { [COMMIT]: true }, seed);
      const a = holdemRaiseDefenceOfLastDecision()!.anchored!;
      expect(a.played).toEqual(a.mix);
      expect(on.shape).toBe(
        a.action === 'jam' ? 'all_in' : a.action === 'four_bet' ? 'raise' : a.action
      );
    }
  }, 120_000);
  it.each([
    ['a8a15a42 heads-up big blind A8o', l1, HU],
    ['6d685c9a small blind ATo vs cutoff steal', l2, BLIND],
  ] as const)(
    '%s: folds on main, continues with its option on',
    (_name, spec, option) => {
      for (const seed of [1, 2, 3]) {
        expect(run(spec, {}, seed).shape).toBe('fold');
        const on = run(spec, { [option]: true }, seed);
        expect(['call', 'all_in']).toContain(on.shape);
        const v = holdemRaiseDefenceOfLastDecision()!;
        expect(v.shape).not.toBe('fold');
        // The solved equilibrium never folds this class here.
        const a = v.anchored!;
        expect(a.mix[a.actions.indexOf('fold')]).toBeLessThan(1e-9);
      }
    },
    120_000
  );
});

// ── v2: equilibrium anchoring ──────────────────────────────────────────────
describe('v2: the solved tables, the prior, the reads, the bubble and the all-in call price agree', () => {
  it('the solved tables are exploitable by less than 0.05bb per hand in every spot (either side, as stored)', () => {
    expect(HOLDEM_RAISE_DEFENCE_SOLVED_WORST_GAIN_BB).toBeLessThan(EXPLOIT_TOLERANCE_BB);
    for (const s of HOLDEM_RAISE_DEFENCE_SOLVED_INDEX) {
      expect(s.gainO, `${s.kind} ${s.S} ${s.o} ${s.A}`).toBeLessThan(EXPLOIT_TOLERANCE_BB);
      expect(s.gainD, `${s.kind} ${s.S} ${s.o} ${s.A}`).toBeLessThan(EXPLOIT_TOLERANCE_BB);
    }
  });

  const priorSpot = (node: AnchoredNode, q: SolvedQuery, hero: string): AnchoredSpot => {
    // Heads-up at a grid point: SB opens to q.openBB, BB 3-bets to 3x, SB 4-bets to 2.2x the 3-bet.
    const S = q.depthBB * BB;
    const o = q.openBB * BB;
    const t = 3 * o;
    const f = 2.2 * t;
    const A = q.anteBB * BB;
    const at = node === 'd_vs_open' ? [1 * BB, o] : node === 'o_vs_3bet' ? [o, t] : [t, f];
    return {
      node,
      query: q,
      hero: cards(hero) as never,
      bb: BB,
      pot: at[0] + at[1] + A,
      heroStack: S - at[0],
      heroBet: at[0],
      oppStack: S - at[1],
      oppBet: at[1],
      behind: 0,
      bubbleFactor: 1,
      legal: { call: true, jam: true, raise: true },
      population: { fold: null, width: null },
      own: { foldRatio: null, foldN: 0, widthRatio: null, widthN: 0 },
      seedParts: ['law', hero],
    };
  };

  it.each([
    ['d_vs_open', 12],
    ['d_vs_open', 20],
    ['o_vs_3bet', 25],
    ['d_vs_4bet', 30],
  ] as const)(
    'heads-up %s %ibb: at the solved prior (no population, no record, no bubble) the Horse plays the table mix of every class',
    (node, depth) => {
      const q = { kind: 'hu', depthBB: depth, openBB: 2, anteBB: 0 };
      const table = solvedNode(q, node)!;
      for (let c = 0; c < 169; c++) {
        const v = priceAnchoredDefence(priorSpot(node, q, comboOf(HOLDEM_CLASSES[c])))!;
        expect(v, HOLDEM_CLASSES[c]).not.toBeNull();
        expect(v.played).toEqual(v.mix);
        const tot = v.actions.reduce((x, a) => x + table.p[table.actions.indexOf(a)][c], 0);
        v.actions.forEach((a, i) => {
          expect(v.mix[i], `${HOLDEM_CLASSES[c]} ${a}`).toBeCloseTo(
            table.p[table.actions.indexOf(a)][c] / tot,
            9
          );
        });
      }
    }
  );

  it('an own record moves the answer: an over-folder is jammed on more, a wide caller less; a real sample dominates', () => {
    const q = { kind: 'hu', depthBB: 15, openBB: 2, anteBB: 0 };
    const jamShare = (foldRatio: number | null, foldN: number) => {
      let j = 0;
      let n = 0;
      for (let c = 0; c < 169; c++) {
        const spot = priorSpot('d_vs_open', q, comboOf(HOLDEM_CLASSES[c]));
        spot.own = { foldRatio, foldN, widthRatio: null, widthN: 0 };
        const v = priceAnchoredDefence(spot)!;
        const w = holdemClassComboCount(HOLDEM_CLASSES[c]);
        j += w * v.played[v.actions.indexOf('jam')];
        n += w;
      }
      return j / n;
    };
    const prior = jamShare(null, 0);
    expect(jamShare(1.8, 200)).toBeGreaterThan(prior + 0.05);
    expect(jamShare(0.4, 200)).toBeLessThan(prior - 0.02);
    // A thin record moves less than a real one.
    expect(jamShare(1.8, 3) - prior).toBeLessThan(jamShare(1.8, 200) - prior);
  });

  it('near a bubble (bubble factor 1.5) the defence tightens relative to chip EV; at chip EV it is the table', () => {
    for (const depth of [10, 15, 20]) {
      const q = { kind: 'hu', depthBB: depth, openBB: 2, anteBB: 0 };
      let fold1 = 0;
      let foldB = 0;
      let n = 0;
      for (let c = 0; c < 169; c++) {
        const w = holdemClassComboCount(HOLDEM_CLASSES[c]);
        const a = priceAnchoredDefence(priorSpot('d_vs_open', q, comboOf(HOLDEM_CLASSES[c])))!;
        const spot = priorSpot('d_vs_open', q, comboOf(HOLDEM_CLASSES[c]));
        spot.bubbleFactor = 1.5;
        const b = priceAnchoredDefence(spot)!;
        fold1 += w * a.played[0];
        foldB += w * b.played[0];
        n += w;
      }
      expect(foldB / n, `${depth}bb`).toBeGreaterThan(fold1 / n + 0.03);
    }
  });

  it('the all-in call price reads the range the Horse re-jams (options on), and the tables against its 6-18% widths', () => {
    for (const [kind, depth] of [
      ['hu', 10],
      ['hu', 20],
      ['ring:2:bb', 12],
      ['ring:3:sb', 15],
    ] as const) {
      const q = { kind, depthBB: depth, openBB: 2, anteBB: kind === 'hu' ? 0 : 1 };
      const jam = solvedAction(solvedNode(q, 'd_vs_open')!, 'jam');
      const [k, side] =
        kind === 'hu' ? [1, 'bb'] : [Number(kind.split(':')[1]), kind.split(':')[2]];
      const read = solvedJamRange({
        dealt: kind === 'hu' ? 2 : 9,
        raiseIndex: 2,
        openerBehind: k,
        defender: side as 'sb' | 'bb',
        depthBB: depth,
        openBB: 2,
        anteBB: q.anteBB,
      })!;
      for (let c = 0; c < 169; c++) expect(read[c]).toBeCloseTo(jam[c], 12);
      // What the Horse jams at the prior is that column.
      if (kind === 'hu')
        for (let c = 0; c < 169; c += 5) {
          const v = priceAnchoredDefence(priorSpot('d_vs_open', q, comboOf(HOLDEM_CLASSES[c])))!;
          const tot = (['fold', 'call', 'three_bet', 'jam'] as const).reduce(
            (x, a) =>
              x + solvedNode(q, 'd_vs_open')!.p[SOLVED_NODE_ACTIONS.d_vs_open.indexOf(a)][c],
            0
          );
          expect(v.mix[v.actions.indexOf('jam')]).toBeCloseTo(jam[c] / tot, 9);
        }
    }
    // The equilibrium re-jam is wider than the 6-18% the all-in call price assumes without the options (heads-up
    // 10-20bb: about 27-40% of all hands): the tables, not those widths, are what a Horse meets with them on.
    const wide = solvedShares({ kind: 'hu', depthBB: 12, openBB: 2, anteBB: 0 }, 'd_vs_open').jam;
    expect(wide).toBeGreaterThan(Math.max(REJAM_WIDTH_SHORT, REJAM_WIDTH_DEEP));
  });
});
