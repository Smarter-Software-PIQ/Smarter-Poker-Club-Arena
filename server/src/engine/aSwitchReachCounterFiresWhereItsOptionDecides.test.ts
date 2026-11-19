/**
 * SWITCH REACH COUNTERS (2026-11-18, Horse Switch lane): telemetry only, no decision change.
 *
 * The lane ranks the Horse option switches by how many decisions each one changes, and several could not be
 * measured. Each counter below is pinned to fire where its option decides and not otherwise, and the decision a
 * counter observes is the decision made without it (a counter is a map increment after the answer is known):
 *  - tournament_utility_stack_scaled_margin_changed_seen: only when the stack-scaled margin changed the action;
 *  - icm_bust_pays_place_factor_changed_seen: only when the paid-bust value moved a bubble factor;
 *  - <shared PLO key>_plo6: beside the shared key, exactly on six-card decisions;
 *  - decide_flh, decide_flo8, decide_lightning: parallel denominators, the existing decide_* unchanged;
 *  - v70_facing_open_zone_changed_seen and facing_closed_all_in_call_seen: where those preflop options decide.
 * The worker-side counters (holdem_option_decision_*, *_receipt_picked_seen) are pinned in
 * horseDecision/aSwitchReachWorkerCountersAreTelemetryOnly.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  bubbleFactor,
  icmBustPaysPlaceFactorChangeCount,
  pairwiseBubbleFactor,
  withIcmBustPaysPlace,
} from './IcmModel.js';
import {
  buildSpot,
  callSpot,
  type SpotSpec,
} from './AShortStackJamPricesThePayJump.test-support.js';
import { decidePreflopV7, type PreflopCtx } from './HorsePreflop.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import TT from './horseComplaints/tt-heads-up-opener-folds-to-an-all-in-3-bet.fixture.json';
import QQ from './horseComplaints/qq-opener-folds-to-an-all-in-3-bet.fixture.json';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (t: string): Card[] =>
  (t.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));
type Opts = Record<string, unknown>;

interface Run {
  bytes: string;
  fired: ReadonlySet<string>;
}
/** One live-shaped decision (telemetry on) inside a decision fire scope, as the worker's FAST look runs it. */
function decideScoped(
  hero: SeatPlayer,
  gs: unknown,
  seed: number,
  opts: Opts,
  style: unknown = 'balanced',
  mods: unknown = {}
): Run {
  enableBrainTelemetry();
  seedFastRandom(seed);
  HorseMind.reset();
  drainFires();
  const run = withDecisionFireScope(() =>
    HorseLogic.decide(
      hero,
      gs as never,
      style as never,
      mods as never,
      {
        telemetry: true,
        mind: false,
        ...opts,
      } as never
    )
  );
  const d = run.value as { action: string; amount?: number };
  return { bytes: `${d.action}:${d.amount ?? ''}`, fired: run.fired };
}

afterEach(() => HorseMind.reset());

// ── PLO: a synthetic heads-up pot (three seats, one folded), the street and the bet set per spot ─────────────────
const VILLAIN = '10000000-0000-4000-8000-000000000184';
type Kind = 'raised' | 'faceBet' | 'leadAfterTurnBet' | 'shove';
function ploSpot(
  variant: string,
  hole: string,
  board: string,
  kind: Kind,
  size = 1,
  extra: Opts = {}
) {
  const shove = kind === 'shove';
  const potStart = shove ? 300 : 36;
  const start = shove ? 250 : 300;
  const pre = shove ? 150 : 18;
  const turnStage = board.length === 8;
  let heroBet = 0;
  let vBet = 0;
  const hist: Array<{
    stage: string;
    seat: number;
    userId: string;
    action: string;
    amount: number;
  }> = [
    { stage: 'preflop', seat: 3, userId: 'f0', action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: pre },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: pre - 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
  ];
  let pot = potStart;
  const turnIn = kind === 'leadAfterTurnBet' ? 24 : 0;
  if (kind === 'faceBet' || shove) vBet = shove ? start - pre : Math.round(pot * size);
  if (turnStage) {
    hist.push(
      { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
      { stage: 'turn', seat: 2, userId: VILLAIN, action: 'bet', amount: vBet }
    );
  } else {
    if (kind === 'leadAfterTurnBet') {
      hist.push(
        { stage: 'turn', seat: 1, userId: 'hero', action: 'bet', amount: 24 },
        { stage: 'turn', seat: 2, userId: VILLAIN, action: 'call', amount: 24 }
      );
      pot += 48;
    } else
      hist.push(
        { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
        { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 }
      );
    if (kind === 'raised') {
      heroBet = 24;
      vBet = 96;
      hist.push(
        { stage: 'river', seat: 1, userId: 'hero', action: 'bet', amount: 24 },
        { stage: 'river', seat: 2, userId: VILLAIN, action: 'raise', amount: 96 }
      );
    } else if (kind === 'faceBet' || shove)
      hist.push(
        { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0 },
        { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: vBet }
      );
  }
  const players = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: start - pre - turnIn - heroBet,
      bet: heroBet,
      totalInvested: pre + turnIn + heroBet,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    },
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: start - pre - turnIn - vBet,
      bet: vBet,
      totalInvested: pre + turnIn + vBet,
      cards: [],
      is_folded: false,
      is_all_in: shove,
      is_sitting_out: false,
      is_horse: false,
    },
    {
      seat: 3,
      user_id: 'f0',
      username: 'f',
      stack: 300,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    },
  ] as unknown as SeatPlayer[];
  const toCall = Math.max(0, vBet - heroBet);
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: pot + heroBet + vBet,
      currentBet: Math.max(heroBet, vBet),
      toCall,
      minRaiseTo: toCall > 0 ? vBet + (vBet - heroBet) : 2,
      maxRaiseTo: players[0].stack + heroBet,
      legalActions: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
      stage: turnStage ? 'turn' : 'river',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: 'cash',
      bigBlind: 2,
      dealerSeat: 1,
      actionHistory: hist.map((a, k) => ({ ...a, timestamp: k })),
      ...extra,
    },
  };
}
const HOLES = (four: string, fifth: string, sixth: string) => ({
  plo4: four,
  plo5: four + fifth,
  plo6: four + fifth + sixth,
});
const PLO_SEEDS = Array.from({ length: 8 }, (_, i) => i * 7919 + 84);

describe('the shared PLO counters get a six-card parallel, fired beside them and only on PLO6', () => {
  const cases: Array<[string, string, ReturnType<typeof HOLES>, string, Kind, number, Opts]> = [
    [
      'plo_paired_board_fold',
      'ploPairedBoardFold',
      HOLES('Qh8hTsTd', '2c', '3s'),
      'Kh9h4h9c',
      'shove',
      1,
      {},
    ],
    [
      'plo_paired_board_river_check',
      'ploPairedBoardRiverCheck',
      HOLES('Qh8hTsTd', '2c', '3s'),
      'Kh9h4h9c2d',
      'leadAfterTurnBet',
      1,
      {},
    ],
    [
      'omaha_river_non_nut_raise_flatted',
      'omahaRiverNutRaiseOnly',
      HOLES('KhJh5c3c', '6d', '7s'),
      'Th9h4h7c2d',
      'faceBet',
      0.25,
      {},
    ],
    [
      'v84_omaha_river_reraise_call_fold',
      'v84OmahaRiverReraiseCalls',
      HOLES('Qh8hTsTd', '2c', '3s'),
      'Kh9h4h7c2d',
      'raised',
      1,
      {},
    ],
  ];
  for (const [key, option, holes, board, kind, size] of cases)
    it(`${key}_plo6: fires exactly when ${key} fires on a PLO6 decision; switched off, neither fires`, () => {
      let plo6Fires = 0;
      for (const variant of ['plo4', 'plo5', 'plo6'] as const)
        for (const seed of PLO_SEEDS) {
          const s = ploSpot(variant, holes[variant], board, kind, size);
          const on = decideScoped(s.hero, s.gs, seed, {});
          const base = on.fired.has(key);
          expect(on.fired.has(`${key}_plo6`), `${variant} seed ${seed}`).toBe(
            base && variant === 'plo6'
          );
          if (variant === 'plo6' && base) plo6Fires++;
          const off = decideScoped(s.hero, s.gs, seed, { [option]: false });
          expect(off.fired.has(key) || off.fired.has(`${key}_plo6`)).toBe(false);
        }
      expect(plo6Fires, 'the spot reaches the rule in PLO6').toBeGreaterThan(0);
    });
});

describe('decide_flh, decide_flo8 and decide_lightning beside the family counts', () => {
  const families = (fired: ReadonlySet<string>) =>
    ['decide_nlh', 'decide_omaha', 'decide_flh', 'decide_flo8', 'decide_lightning'].filter((k) =>
      fired.has(k)
    );
  it('fixed-limit Omaha hi-lo counts decide_omaha (unchanged) and decide_flo8', () => {
    const s = ploSpot('flo8', 'Qh8hTsTd', 'Kh9h4h7c2d', 'faceBet', 0.5, {
      bettingStructure: 'fixed_limit',
    });
    expect(families(decideScoped(s.hero, s.gs, 1, {}).fired)).toEqual([
      'decide_omaha',
      'decide_flo8',
    ]);
  });
  it("fixed-limit hold'em counts decide_nlh (unchanged) and decide_flh", () => {
    const s = ploSpot('flh', 'Qh8h', 'Kh9h4h7c2d', 'faceBet', 0.5, {
      bettingStructure: 'fixed_limit',
    });
    expect(families(decideScoped(s.hero, s.gs, 1, {}).fired)).toEqual(['decide_nlh', 'decide_flh']);
  });
  it("pot-limit Omaha and no-limit hold'em count neither fixed-limit key", () => {
    const plo = ploSpot('plo5', 'Qh8hTsTd2c', 'Kh9h4h7c2d', 'faceBet', 0.5);
    expect(families(decideScoped(plo.hero, plo.gs, 1, {}).fired)).toEqual(['decide_omaha']);
    const nlh = ploSpot('nlh', 'Qh8h', 'Kh9h4h7c2d', 'faceBet', 0.5, {
      bettingStructure: 'no_limit',
    });
    expect(families(decideScoped(nlh.hero, nlh.gs, 1, {}).fired)).toEqual(['decide_nlh']);
  });
  it("a Lightning decision (public memory domain speed 'lightning') counts decide_lightning; a table one does not", () => {
    const fast = ploSpot('plo5', 'Qh8hTsTd2c', 'Kh9h4h7c2d', 'faceBet', 0.5, {
      publicMemoryDomain: { speed: 'lightning' },
    });
    expect(families(decideScoped(fast.hero, fast.gs, 1, {}).fired)).toEqual([
      'decide_omaha',
      'decide_lightning',
    ]);
    const table = ploSpot('plo5', 'Qh8hTsTd2c', 'Kh9h4h7c2d', 'faceBet', 0.5, {
      publicMemoryDomain: { speed: 'table' },
    });
    expect(families(decideScoped(table.hero, table.gs, 1, {}).fired)).toEqual(['decide_omaha']);
  });
});

// ── Tournament: the 86-entrant final table of hand 59441335 (nine left, thirteen paid) ─────────────────────────
const FIXTURE_STYLE = 'balanced';
function tourney(spec: SpotSpec, seed: number, opts: Opts) {
  const { gs, hero } = buildSpot(spec);
  return decideScoped(hero as SeatPlayer, gs, seed, opts, FIXTURE_STYLE);
}
const SHORT_HANDS = ['72o', '32o', '83o', '94o', 'T2o', 'J3o', '85o', '62o'];
const CALL_HANDS = ['JTs', 'Q9o', 'K5o', 'T8s', '97s'];
const SPOTS: SpotSpec[] = [
  ...SHORT_HANDS.map((hand) => ({ hand })),
  ...CALL_HANDS.map((hand) => callSpot(hand)),
];
const T_SEEDS = [1, 2, 3, 4, 5, 6];

describe('tournament_utility_stack_scaled_margin_changed_seen counts a changed action, not a utility run', () => {
  it('fires only where the option moved the action, and never with the option off', () => {
    let runs = 0;
    let changed = 0;
    let differs = 0;
    for (const spec of SPOTS)
      for (const seed of T_SEEDS) {
        const on = tourney(spec, seed, { tournamentUtilityStackScaledMargin: true });
        const off = tourney(spec, seed, { tournamentUtilityStackScaledMargin: false });
        if (on.fired.has('tournament_utility_stack_scaled_margin_seen')) runs++;
        const fired = on.fired.has('tournament_utility_stack_scaled_margin_changed_seen');
        if (fired) changed++;
        if (on.bytes !== off.bytes) differs++;
        // A count says the margin changed this action: the same decision without the option differs.
        if (fired) expect(on.bytes, `${spec.hand} seed ${seed}`).not.toBe(off.bytes);
        // And a decision the option changed is counted.
        if (on.bytes !== off.bytes) expect(fired, `${spec.hand} seed ${seed}`).toBe(true);
        expect(off.fired.has('tournament_utility_stack_scaled_margin_changed_seen')).toBe(false);
      }
    expect(runs, 'the utility ran with the option on').toBeGreaterThan(0);
    expect(changed).toBe(differs);
    expect(changed, 'the sample holds decisions the option changes').toBeGreaterThan(0);
    expect(changed).toBeLessThan(runs);
  });
});

describe('icm_bust_pays_place_factor_changed_seen', () => {
  const FINAL_TABLE = [342_381, 310_173, 191_640, 126_232, 124_308, 74_332, 69_856, 38_469, 12_609];
  const LADDER_13 = [25.14, 14.44, 10.44, 8.3, 6.94, 6.0, 5.31, 4.77, 4.34, 3.99, 3.69, 3.44, 3.2];
  const counted = (fn: () => number) => {
    const before = icmBustPaysPlaceFactorChangeCount();
    const value = fn();
    return { value, n: icmBustPaysPlaceFactorChangeCount() - before };
  };
  it('IcmModel counts a factor the paid bust moved, and returns the same factor it returned before', () => {
    const on = counted(() =>
      withIcmBustPaysPlace(true, () => bubbleFactor(FINAL_TABLE, LADDER_13, 8, 12_609))
    );
    expect(on.n).toBe(1);
    expect(on.value).toBeLessThan(1.3);
    const pair = counted(() =>
      withIcmBustPaysPlace(true, () => pairwiseBubbleFactor(FINAL_TABLE, LADDER_13, 8, 0, 12_609))
    );
    expect(pair.n).toBe(1);
    // Off: the 0 valuation, nothing counted.
    expect(counted(() => bubbleFactor(FINAL_TABLE, LADDER_13, 8, 12_609)).n).toBe(0);
    // No bust (a part of the stack at risk): nothing counted.
    expect(
      counted(() =>
        withIcmBustPaysPlace(true, () => bubbleFactor(FINAL_TABLE, LADDER_13, 8, 6_000))
      ).n
    ).toBe(0);
    // Outside the money a bust is worth 0 either way: nothing counted.
    expect(
      counted(() =>
        withIcmBustPaysPlace(true, () =>
          bubbleFactor([9_000, 6_000, 3_000, 1_500, 500], [50, 30, 20], 4, 500)
        )
      ).n
    ).toBe(0);
  });
  it('fires on a live in-the-money decision with the option on, never with it off', () => {
    // A 20bb under-the-gun stack and a 12bb stack facing one fold: the V16 ICM premium prices a whole-stack risk.
    const deeper: SpotSpec[] = [
      {
        stacks: {
          1: 120_000,
          2: 69_856,
          3: 310_173,
          4: 126_232,
          5: 124_308,
          6: 12_609,
          7: 191_640,
          8: 38_469,
          9: 342_381,
        },
        hero: 1,
        hand: 'KQo',
        foldedBefore: [],
      },
      { hero: 2, hand: 'A9o', foldedBefore: [1] },
    ];
    let fires = 0;
    for (const spec of deeper)
      for (const seed of [1, 2]) {
        const on = tourney(spec, seed, { icmBustPaysPlace: true });
        if (on.fired.has('icm_bust_pays_place_factor_changed_seen')) fires++;
        const off = tourney(spec, seed, { icmBustPaysPlace: false, nashPushFoldIcm: false });
        expect(off.fired.has('icm_bust_pays_place_factor_changed_seen')).toBe(false);
      }
    expect(fires).toBe(4);
  });
});

// ── Preflop: the heads-up opener facing an all-in 3-bet (TT) and the nine-handed QQ hand ───────────────────────
describe('v70_facing_open_zone_changed_seen and facing_closed_all_in_call_seen', () => {
  const LIVE = replayProfiles('tournament').find((p) => p.live) ?? replayProfiles('tournament')[0];
  const node = (fx: unknown, ord: number) => {
    const f = fx as ComplaintFixture;
    return stateAt(f, f.actions.find((a) => a.ord === ord)!);
  };
  const SEEDS = [1, 7, 42, 99, 2026, 3];
  const at = (fx: unknown, ord: number, seed: number, opts: Opts) => {
    const st = node(fx, ord);
    return decideScoped(st.hero, st.gs, seed, opts, LIVE.style, LIVE.mods);
  };
  it('the closed all-in call is counted where the exception lets the call through, and never with it off', () => {
    let fires = 0;
    for (const [fx, ord] of [
      [TT, 5],
      [QQ, 11],
    ] as const)
      for (const seed of SEEDS) {
        const on = at(fx, ord, seed, {});
        const off = at(fx, ord, seed, { facingClosedAllIn: false });
        expect(off.fired.has('facing_closed_all_in_call_seen')).toBe(false);
        if (on.fired.has('facing_closed_all_in_call_seen')) {
          fires++;
          // It counts a call the exception let in: the call stands, and off it is not made.
          expect(on.bytes.startsWith('call') || on.bytes.startsWith('all_in')).toBe(true);
          expect(off.bytes).not.toBe(on.bytes);
        }
      }
    expect(fires).toBeGreaterThan(0);
  });
  // The V82 case itself, at the preflop engine: a three-handed big blind with 11.5bb behind and 1bb posted faces
  // one open. The legacy zone reads the stack behind (<= 12: jam-or-fold); the short-handed zone reads the
  // 12.5bb the hand started with (not jam-or-fold). Full ring the zone does not apply.
  const facingOpen = (tableSize: number, zone: boolean | undefined) => {
    const layers: string[] = [];
    const intent = decidePreflopV7({
      strength: 0.6,
      position: 'bb',
      isButton: false,
      raiserPosition: 'late',
      raises: 1,
      limpers: 0,
      callers: 0,
      oppsLeft: 1,
      toCall: 3,
      currentBet: 5,
      pot: 8,
      bigBlind: 2,
      stack: 23,
      stackBB: 11.5,
      effectiveStackBB: 11.5,
      tightness: 1,
      bluffFreq: 0.17,
      aggression: 1,
      slowplayFreq: 0.08,
      sizingMultiplier: 1,
      isOmaha: false,
      isPotLimit: false,
      riskAdd: 0,
      mode: 'tournament',
      format: 'mtt',
      tableSize,
      facingOpenShortHandedZone: zone,
      rand: () => 0.25,
      noteLayer: (layer) => layers.push(layer),
    } as PreflopCtx);
    return {
      intent,
      zoneChanged: layers.filter((l) => l === 'v70_facing_open_zone_changed_seen').length,
    };
  };
  it('the short-handed zone change is counted where it moves the spot, never full ring, never with the option off', () => {
    expect(facingOpen(3, true).zoneChanged).toBe(1);
    expect(facingOpen(2, true).zoneChanged).toBe(1);
    expect(facingOpen(3, undefined).zoneChanged).toBe(0);
    expect(facingOpen(9, true).zoneChanged).toBe(0);
    // Counting changes nothing: the intent with the callback is the intent without it.
    const bare = decidePreflopV7({
      strength: 0.6,
      position: 'bb',
      isButton: false,
      raiserPosition: 'late',
      raises: 1,
      limpers: 0,
      callers: 0,
      oppsLeft: 1,
      toCall: 3,
      currentBet: 5,
      pot: 8,
      bigBlind: 2,
      stack: 23,
      stackBB: 11.5,
      effectiveStackBB: 11.5,
      tightness: 1,
      bluffFreq: 0.17,
      aggression: 1,
      slowplayFreq: 0.08,
      sizingMultiplier: 1,
      isOmaha: false,
      isPotLimit: false,
      riskAdd: 0,
      mode: 'tournament',
      format: 'mtt',
      tableSize: 3,
      facingOpenShortHandedZone: true,
      rand: () => 0.25,
    } as PreflopCtx);
    expect(facingOpen(3, true).intent).toEqual(bare);
  });
});
