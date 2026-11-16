/**
 * LAW (Lightning ledger L-010b, 2026-11-15): the Omaha tight-opponent response
 * (omahaTightOpponent, default OFF, owner-held OFF until its promotion evidence
 * passes) is not excluded from Lightning. On a Lightning cash snapshot (public
 * memory domain speed 'lightning', big-blind ante) it changes the same committed
 * actions as at a Classic table when switched on, is byte-identical when off,
 * and wins over the Lightning participation cells (lightningParticipationOmaha):
 * a respect fold or flat against a proven tight raiser is never widened back,
 * and a proven-tight steal is never narrowed. Nothing here switches anything on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from '../engine/HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import { HorseMind, readScopeOf } from '../engine/HorseMind.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i + 1 < spec.length; i += 2)
    out.push({ rank: spec[i] as CardRank, suit: SUIT[spec[i + 1]] });
  return out;
};
const HERO = '86000000-0000-4000-8000-000000000007';
/** button in the respect spot, big blind in the steal spot */
const RAISER = '40000000-0000-4000-8000-0000000000a1';
/** small blind in both spots */
const SB = '40000000-0000-4000-8000-0000000000b2';
/** the under-the-gun seat, folded in both spots */
const UTG = '40000000-0000-4000-8000-0000000000c3';
const TABLE = 4;
const SEEDS = [1000, 1001, 1002, 1003, 1004, 1005];

const seat = (n: number, id: string, hole: string, over: Partial<SeatPlayer> = {}): SeatPlayer =>
  ({
    seat: n,
    user_id: id,
    username: `P${n}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: false,
    ...over,
  }) as SeatPlayer;

type Kind =
  'unknown' | 'sparse' | 'tight' | 'loose_passive' | 'maniac' | 'average' | 'tight_then_raising';

/** One preflop action per hand: raise on `raiseEvery`, call on `callEvery`, else fold. */
function playHands(
  userId: string,
  variant: string,
  hands: number,
  tag: string,
  act: (h: number) => 'raise' | 'call' | 'fold'
): void {
  const scope = readScopeOf(variant, TABLE);
  for (let h = 0; h < hands; h++) {
    const a = act(h);
    const acts = [
      {
        stage: 'preflop',
        seat: 3,
        userId,
        action: a,
        amount: a === 'raise' ? 7 : a === 'call' ? 2 : 0,
        ...(a === 'raise' ? { isFullRaise: true } : {}),
        origin: 'player',
        timestamp: h * 10 + 1,
      },
    ] as unknown as ActionRecord[];
    HorseMind.observeHandComplete(`${tag}:${variant}:${h}`, acts, 2, null, scope);
  }
}
const tightAct = (h: number) => (h % 25 === 0 ? 'raise' : 'fold');
function remember(userId: string, kind: Kind, variant: string): void {
  if (kind === 'sparse') playHands(userId, variant, 8, `${userId}:s`, tightAct);
  if (kind === 'tight') playHands(userId, variant, 200, `${userId}:t`, tightAct);
  // limps four hands in five, never raises
  if (kind === 'loose_passive')
    playHands(userId, variant, 200, `${userId}:lp`, (h) => (h % 5 === 0 ? 'fold' : 'call'));
  if (kind === 'maniac')
    playHands(userId, variant, 200, `${userId}:m`, (h) => (h % 5 < 3 ? 'raise' : 'call'));
  // raises one hand in four, plays one in three: a Horse-like player
  if (kind === 'average')
    playHands(userId, variant, 200, `${userId}:a`, (h) =>
      h % 4 === 0 ? 'raise' : h % 12 === 1 ? 'call' : 'fold'
    );
  if (kind === 'tight_then_raising') {
    playHands(userId, variant, 200, `${userId}:t`, tightAct);
    playHands(userId, variant, 12, `${userId}:r`, (h) => (h % 2 === 0 ? 'raise' : 'fold'));
  }
}

interface Spot {
  variant: string;
  kind: 'respect' | 'steal';
  hole: string;
}
/** The big blind faces a pot-sized button open; UTG and the small blind folded. */
function respectGs(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(2, HERO, s.hole, { bet: 2, totalInvested: 2, stack: 198, is_horse: true });
  const gs = {
    players: [
      seat(1, SB, '', { bet: 1, totalInvested: 1, stack: 199, is_folded: true }),
      hero,
      seat(3, UTG, '', { is_folded: true }),
      seat(4, RAISER, '', { bet: 7, totalInvested: 7, stack: 193 }),
    ],
    communityCards: [],
    pot: 10,
    currentBet: 7,
    toCall: 5,
    minRaise: 5,
    minRaiseTo: 12,
    maxRaiseTo: 24,
    legalActions: ['fold', 'call', 'raise'],
    stage: 'preflop',
    gameVariant: s.variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 4,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: UTG, action: 'fold', amount: 0, timestamp: 3 },
      {
        stage: 'preflop',
        seat: 4,
        userId: RAISER,
        action: 'raise',
        amount: 7,
        isFullRaise: true,
        timestamp: 4,
      },
      { stage: 'preflop', seat: 1, userId: SB, action: 'fold', amount: 0, timestamp: 5 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}
/** The button is first in after UTG folds; both blinds are left to act. */
function stealGs(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(4, HERO, s.hole, { is_horse: true });
  const gs = {
    players: [
      seat(1, SB, '', { bet: 1, totalInvested: 1, stack: 199 }),
      seat(2, RAISER, '', { bet: 2, totalInvested: 2, stack: 198 }),
      seat(3, UTG, '', { is_folded: true }),
      hero,
    ],
    communityCards: [],
    pot: 3,
    currentBet: 2,
    toCall: 2,
    minRaise: 2,
    minRaiseTo: 4,
    maxRaiseTo: 7,
    legalActions: ['fold', 'call', 'raise'],
    stage: 'preflop',
    gameVariant: s.variant,
    bettingStructure: s.variant === 'nlh' ? 'no_limit' : 'pot_limit',
    bigBlind: 2,
    dealerSeat: 4,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: UTG, action: 'fold', amount: 0, timestamp: 3 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** The whole decision, with only wall-clock timings (latencyMs, elapsedMs) removed. */
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));

interface Outcome {
  decisions: string[];
  actions: string[];
  fires: Set<string>;
}
function play(
  s: Spot,
  kinds: Partial<Record<'raiser' | 'sb' | 'utg', Kind>>,
  opts: HorseDecideOpts
): Outcome {
  const decisions: string[] = [];
  const actions: string[] = [];
  const fires = new Set<string>();
  enableBrainTelemetry();
  for (const seed of SEEDS) {
    HorseMind.reset();
    remember(RAISER, kinds.raiser ?? 'unknown', s.variant);
    remember(SB, kinds.sb ?? 'unknown', s.variant);
    remember(UTG, kinds.utg ?? 'unknown', s.variant);
    drainFires();
    seedFastRandom(seed);
    const { hero, gs } = s.kind === 'respect' ? respectGs(s) : stealGs(s);
    const d = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
    decisions.push(decisionBytes(d));
    actions.push(d.action);
    for (const f of drainFires()) if (/^plo_tight_/.test(f.feature)) fires.add(f.feature);
  }
  return { decisions, actions, fires };
}
const ON: HorseDecideOpts = { omahaTightOpponent: true };
const OFF: HorseDecideOpts = {};

const SPOTS: Spot[] = [
  { variant: 'plo4', kind: 'respect', hole: 'TsQcKcJd' },
  { variant: 'plo5', kind: 'respect', hole: 'Kd6sQdJsTs' },
  { variant: 'plo4', kind: 'steal', hole: 'Qh7s8d5h' },
  { variant: 'plo5', kind: 'steal', hole: 'Jh4c2cKcTh' },
];
/** The proven-tight table for each spot: the raiser faced, or both blinds. */
const tightTable = (s: Spot) =>
  s.kind === 'respect'
    ? ({ raiser: 'tight' } as const)
    : ({ raiser: 'tight', sb: 'tight' } as const);

/** The same spot dealt as a Lightning hand: domain speed lightning, big-blind ante of one big blind. */
function lightning(gs: HorseGameStateV2): HorseGameStateV2 {
  const g = gs as unknown as Record<string, unknown>;
  const ante = 2;
  return {
    ...g,
    pot: (g.pot as number) + ante,
    ante,
    bigBlindAnte: true,
    smallBlind: 1,
    allInOrFold: false,
    dealtSeatIds: (g.players as SeatPlayer[]).map((p) => p.seat),
    publicMemoryDomain: { version: 1, speed: 'lightning', ante: 'big_blind' },
  } as unknown as HorseGameStateV2;
}
function playL(
  s: Spot,
  kinds: Partial<Record<'raiser' | 'sb' | 'utg', Kind>>,
  opts: HorseDecideOpts
) {
  const decisions: string[] = [];
  const actions: string[] = [];
  const fires = new Set<string>();
  enableBrainTelemetry();
  for (const seed of SEEDS) {
    HorseMind.reset();
    remember(RAISER, kinds.raiser ?? 'unknown', s.variant);
    remember(SB, kinds.sb ?? 'unknown', s.variant);
    remember(UTG, kinds.utg ?? 'unknown', s.variant);
    drainFires();
    seedFastRandom(seed);
    const { hero, gs } = s.kind === 'respect' ? respectGs(s) : stealGs(s);
    const d = HorseLogic.decide(hero, lightning(gs), 'balanced', {}, { telemetry: true, ...opts });
    decisions.push(decisionBytes(d));
    actions.push(d.action);
    for (const f of drainFires()) if (/^plo_tight_/.test(f.feature)) fires.add(f.feature);
  }
  return { decisions, actions, fires };
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe.each(SPOTS)('Lightning: omahaTightOpponent, $variant $kind', (s) => {
  it('off: byte-identical whatever the option value, nothing fires', () => {
    const t = tightTable(s);
    const absent = playL(s, t, OFF);
    expect(playL(s, t, { omahaTightOpponent: false }).decisions).toEqual(absent.decisions);
    expect([...absent.fires]).toEqual([]);
  });

  it('on: the read reaches the Lightning decision and its answer is the tight-respect one', () => {
    const t = tightTable(s);
    const off = playL(s, t, OFF);
    const on = playL(s, t, ON);
    // The read is consulted on every seed (receipt), so Lightning is not excluded.
    expect(on.fires.size).toBeGreaterThan(0);
    // Respect only ever continues less (raise -> call); steal only ever opens more (fold -> raise).
    // With the big-blind ante, two spots already sit on that answer without the option.
    expect(new Set(on.actions)).toEqual(new Set([s.kind === 'respect' ? 'call' : 'raise']));
    const expected: Record<string, string> = {
      'plo4 respect': 'call', // the ante already prices the flat; the read agrees (considered)
      'plo5 respect': 'raise', // the read changes it: plo_tight_raiser_respected
      'plo4 steal': 'fold', // the read changes it: plo_tight_blinds_steal
      'plo5 steal': 'raise', // the ante already opens it; the read agrees (considered)
    };
    expect(new Set(off.actions)).toEqual(new Set([expected[`${s.variant} ${s.kind}`]]));
  });

  it('on: unknown players get the baseline', () => {
    const t =
      s.kind === 'respect'
        ? { raiser: 'unknown' as Kind }
        : { raiser: 'unknown' as Kind, sb: 'unknown' as Kind };
    expect(playL(s, t, ON).decisions).toEqual(playL(s, t, OFF).decisions);
  });

  it('with the Lightning participation cells on too, the tight response still decides', () => {
    const t = tightTable(s);
    const tightOnly = playL(s, t, ON);
    const both = playL(s, t, { ...ON, lightningParticipationOmaha: true });
    expect(both.actions).toEqual(tightOnly.actions);
  });
});
