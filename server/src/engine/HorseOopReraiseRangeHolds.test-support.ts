/**
 * Generated states for the out-of-position 3-bet range rule (HorseOopReraiseRangeHolds): a six-seat cash table, button
 * seat 1, the Horse out of position facing one open, and (after a Horse 3-bet) the same hand at the Horse's answer to
 * the 4-bet (pot-sized in PLO, 2.3x the 3-bet in NLH). Built from public nodes through HorseComplaintReplay.stateAt, as
 * the trace harness of hand a6f9206d did (OOP-3BET-FOLD-TRACE.md scripts/tb.ts); used by the law tests and by
 * server/scripts/oop-reraise-range/replay.ts. Seeded deals only; no real hole cards.
 */
import type { Card } from '../types.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { stateAt, actionKind } from './HorseComplaintReplay.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';

export type OopGame = 'plo4' | 'plo5' | 'plo6' | 'nlh';
export type OopPos = 'bb_co' | 'bb_btn' | 'sb_btn' | 'bb_utg';
export type OopRead = 'none' | 'wide' | 'tight' | 'rows';
export const OOP_OPENER_ID = '00000000-0000-4000-8000-000000000006';

const SU = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const RK = '23456789TJQKA';
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const holeCount = (g: OopGame): number =>
  g === 'plo4' ? 4 : g === 'plo5' ? 5 : g === 'plo6' ? 6 : 2;
/** The i-th seeded uniform deal of the game's hole cards. */
export function oopDeal(game: OopGame, i: number): Card[] {
  const r = rng(0x5eed0000 + i);
  const d: Card[] = [];
  for (const s of SU) for (const k of RK) d.push({ rank: k, suit: s } as Card);
  for (let j = d.length - 1; j > 0; j--) {
    const x = Math.floor(r() * (j + 1));
    [d[j], d[x]] = [d[x]!, d[j]!];
  }
  return d.slice(0, holeCount(game));
}

/** Durable public counter rows for the opener (a neutral id): shaped wide, shaped tight, or given rows. */
export function oopOpenerRows(
  game: OopGame,
  read: OopRead,
  rows?: readonly Record<string, unknown>[]
): unknown[] {
  if (read === 'none') return [];
  if (read === 'rows')
    return (rows ?? [])
      .filter(
        (r) =>
          r.variant === game &&
          r.mode === 'cash' &&
          (r.public_memory_domain as { speed?: string } | undefined)?.speed === 'table'
      )
      .map((r) => ({ ...r, user_id: OOP_OPENER_ID }));
  const H = 44;
  const shape =
    read === 'wide'
      ? {
          pfr: 0.6,
          rfi: 0.62,
          vpip: 0.72,
          threeBet: 0.3,
          foldTo3Bet: 0,
          foldToBet: 0.3,
          betCheckedTo: 0.5,
        }
      : {
          pfr: 0.12,
          rfi: 0.14,
          vpip: 0.18,
          threeBet: 0.04,
          foldTo3Bet: 0.7,
          foldToBet: 0.55,
          betCheckedTo: 0.35,
        };
  const c: Record<string, number> = {
    hands: H,
    vpip: shape.vpip * H,
    pfr: shape.pfr * H,
    rfiOpp: 30,
    rfi: shape.rfi * 30,
    threeBetOpp: 24,
    threeBet: shape.threeBet * 24,
    foldTo3BetOpp: 12,
    foldTo3Bet: shape.foldTo3Bet * 12,
    betCheckedToOpp: 40,
    betCheckedTo: shape.betCheckedTo * 40,
    foldToBetOpp: 30,
    foldToBet: shape.foldToBet * 30,
    riverCallOpp: 8,
    riverCall: 4,
  };
  const fast: Record<string, string> = {
    hands: 'fHands',
    pfr: 'fPfr',
    rfiOpp: 'fRfiOpp',
    rfi: 'fRfi',
    threeBetOpp: 'fThreeBetOpp',
    threeBet: 'fThreeBet',
    betCheckedToOpp: 'fBetCheckedToOpp',
    betCheckedTo: 'fBetCheckedTo',
    foldToBetOpp: 'fFoldToBetOpp',
    foldToBet: 'fFoldToBet',
    riverCallOpp: 'fRiverCallOpp',
    riverCall: 'fRiverCall',
  };
  for (const [long, f] of Object.entries(fast)) c[f] = c[long]! * 0.3;
  const omaha = game !== 'nlh';
  return ['full', 'short'].map((size) => ({
    user_id: OOP_OPENER_ID,
    variant: game,
    mode: 'cash',
    size,
    counters: c,
    observed_hands: 400,
    initialized: true,
    public_memory_domain: { ante: omaha ? 'big_blind' : 'none', speed: 'table', version: 1 },
  }));
}

const DED = {
  bbj: { feeBB: 0.25, enabled: true, minPotBB: 10, minPlayersDealt: 3 },
  rake: {
    cap: 5,
    percent: 10,
    noFlopNoDrop: true,
    playerCountCaps: [
      [2, 2.5],
      [3, 5],
      [4, 5],
    ],
  },
  rules: 'controller-rake-bbj-v1',
  status: 'captured',
  version: 1,
};
const POSITIONS: Record<OopPos, { hero: number; opener: number }> = {
  bb_co: { hero: 3, opener: 6 },
  bb_btn: { hero: 3, opener: 1 },
  sb_btn: { hero: 2, opener: 1 },
  bb_utg: { hero: 3, opener: 4 },
};
const OTHER_STACK: Record<number, number> = {
  1: 872.4,
  2: 399,
  3: 640,
  4: 614.17,
  5: 493.5,
  6: 700,
};
const PREFLOP_ORDER = [4, 5, 6, 1, 2, 3];

export interface OopHandSpec {
  game: OopGame;
  pos: OopPos;
  depthBB: number;
  hole: Card[];
  /** the Horse's 3-bet to (chips), or null for the hand up to its node facing the open */
  threeTo: number | null;
  mode?: 'cash' | 'tournament';
}

/** The hand (HorseComplaintReplay shape) and the action index of the node asked. */
export function oopHand(spec: OopHandSpec): { hand: Record<string, unknown>; node: number } {
  const { game, pos, depthBB, hole, threeTo } = spec;
  const omaha = game !== 'nlh';
  const ante = omaha ? 2 : 0;
  const openTo = omaha ? 9 : 5;
  const mode = spec.mode ?? 'cash';
  const { hero, opener } = POSITIONS[pos];
  const S = 2 * depthBB;
  const stack0: Record<number, number> = { ...OTHER_STACK, [hero]: S, [opener]: S };
  const bet: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 0, 5: 0, 6: 0 };
  const inv: Record<number, number> = { 1: 0, 2: 1, 3: 2 + ante, 4: 0, 5: 0, 6: 0 };
  const dead: Record<number, number> = { 1: 0, 2: 0, 3: ante, 4: 0, 5: 0, 6: 0 };
  const folded = new Set<number>();
  const allIn = new Set<number>();
  const stack: Record<number, number> = {};
  for (const s of [1, 2, 3, 4, 5, 6]) stack[s] = stack0[s]! - inv[s]!;
  let pot = 1 + 2 + ante;
  const pn = (o: Record<string, unknown>) => ({
    ante,
    mode,
    asset: 'chips',
    seats: [1, 2, 3, 4, 5, 6].map((s) => [
      s,
      Math.round(stack[s]! * 100) / 100,
      bet[s]!,
      inv[s]!,
      dead[s]!,
      0,
      folded.has(s) ? 1 : allIn.has(s) ? 2 : 0,
    ]),
    boards: [''],
    status: 'captured',
    street: 'preflop',
    bombPot: false,
    variant: game,
    version: 1,
    anteType: omaha ? 'big_blind' : 'none',
    bigBlind: 2,
    chipUnit: 0.01,
    actorSeat: hero,
    structure: omaha ? 'pot_limit' : 'no_limit',
    vpipFloor: 40,
    boardCount: 1,
    dealerSeat: 1,
    deductions: DED,
    smallBlind: 1,
    allInOrFold: false,
    fixedBetSize: null,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    wagersCapped: false,
    tournamentStage: { status: 'not_applicable', version: 1 },
    vpipWindowHands: 30,
    ...o,
  });
  const acts: Record<string, unknown>[] = [
    { ord: 0, seat: 2, stage: 'preflop', action: 'sb', amount: 1, origin: 'forced' },
    { ord: 1, seat: 3, stage: 'preflop', action: 'bb', amount: 2, origin: 'forced' },
  ];
  if (ante)
    acts.push({
      ord: 2,
      seat: 3,
      stage: 'preflop',
      action: 'ante',
      amount: ante,
      origin: 'forced',
      dead: true,
    });
  const push = (a: Record<string, unknown>) =>
    acts.push({ ord: acts.length, stage: 'preflop', ...a });
  let heroNode = -1;
  for (const s of PREFLOP_ORDER) {
    if (s === opener) {
      bet[s] = openTo;
      inv[s] = openTo;
      stack[s] = stack0[s]! - openTo;
      pot += openTo;
      push({ seat: s, action: 'raise', amount: openTo, origin: 'player', isFullRaise: true });
      continue;
    }
    if (s === hero) {
      heroNode = acts.length;
      const heroBet = bet[hero]!;
      const toCall = openTo - heroBet;
      push({
        seat: hero,
        action: 'fold',
        amount: 0,
        origin: 'horse_policy',
        publicNode: pn({
          pot,
          toCall,
          currentBet: openTo,
          minRaiseTo: openTo + (openTo - 2),
          maxRaiseTo: omaha ? openTo + pot + toCall : heroBet + stack[hero]!,
        }),
      });
      break;
    }
    folded.add(s);
    push({ seat: s, action: 'fold', amount: 0, origin: 'horse_policy' });
  }
  let node = heroNode;
  if (threeTo !== null) {
    const heroBet = bet[hero]!;
    Object.assign(acts[heroNode]!, { action: 'raise', amount: threeTo, isFullRaise: true });
    const heroIn = threeTo - heroBet;
    stack[hero] = stack[hero]! - heroIn;
    inv[hero] = inv[hero]! + heroIn;
    bet[hero] = threeTo;
    pot += heroIn;
    for (const s of PREFLOP_ORDER.slice(PREFLOP_ORDER.indexOf(hero) + 1)) {
      if (s === opener || folded.has(s)) continue;
      folded.add(s);
      push({ seat: s, action: 'fold', amount: 0, origin: 'horse_policy' });
    }
    const openerAll = openTo + stack[opener]!;
    const want = omaha
      ? threeTo + (pot + (threeTo - openTo))
      : Math.round(threeTo * 2.3 * 100) / 100;
    const fourTo = Math.min(openerAll, want);
    const oIn = fourTo - bet[opener]!;
    stack[opener] = stack[opener]! - oIn;
    inv[opener] = inv[opener]! + oIn;
    bet[opener] = fourTo;
    pot += oIn;
    const oAll = stack[opener]! <= 0.005;
    if (oAll) allIn.add(opener);
    push({
      seat: opener,
      action: oAll ? 'all_in' : 'raise',
      amount: fourTo,
      origin: 'player',
      isFullRaise: true,
    });
    const toCall4 = Math.min(fourTo - threeTo, stack[hero]!);
    const heroMax = threeTo + stack[hero]!;
    node = acts.length;
    push({
      seat: hero,
      action: 'fold',
      amount: 0,
      origin: 'horse_policy',
      publicNode: pn({
        pot,
        toCall: toCall4,
        currentBet: fourTo,
        minRaiseTo: oAll ? null : Math.min(heroMax, fourTo + (fourTo - threeTo)),
        maxRaiseTo: oAll
          ? null
          : Math.min(heroMax, omaha ? fourTo + pot + (fourTo - threeTo) : heroMax),
        legalActions: oAll ? ['fold', 'call', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
      }),
    });
  }
  return {
    hand: {
      handId: '00000000-0000-4000-8000-0000000000aa',
      variant: game,
      bigBlind: 2,
      smallBlind: 1,
      buttonSeat: 1,
      publicMemoryDomain: { version: 1, speed: 'table', ante: omaha ? 'big_blind' : 'none' },
      players: [1, 2, 3, 4, 5, 6].map((s) => ({ seat: s, userId: 'u' + s, isHorse: s !== opener })),
      horseHoleCards: { ['u' + hero]: hole },
      actions: acts,
    },
    node,
  };
}

export interface OopAsk {
  kind: string;
  amount: number | undefined;
  decision: Record<string, unknown>;
}

/**
 * The Horse's decision at a node, with fresh memory holding only `rows` (the opener under OOP_OPENER_ID, or under
 * `openerId` when given) and seeded streams. `mutate` may edit the state before the ask (the tournament arm).
 */
export function oopAsk(
  spec: OopHandSpec,
  opts: Record<string, unknown>,
  rows: readonly unknown[],
  seed: number,
  openerId: string = OOP_OPENER_ID,
  mutate?: (gs: Record<string, unknown>) => void
): OopAsk {
  const { hand, node } = oopHand(spec);
  const { opener } = POSITIONS[spec.pos];
  const st = stateAt(hand as never, (hand.actions as unknown[])[node] as never) as unknown as {
    gs: {
      players: { user_id: string; username: string }[];
      humanUserIds?: string[];
      actionHistory: { userId: string }[];
    };
    hero: unknown;
    pn: unknown;
  };
  const P = 'p' + opener;
  for (const p of st.gs.players)
    if (p.user_id === P) {
      p.user_id = openerId;
      p.username = openerId;
    }
  if (st.gs.humanUserIds)
    st.gs.humanUserIds = st.gs.humanUserIds.map((x) => (x === P ? openerId : x));
  for (const a of st.gs.actionHistory) if (a.userId === P) a.userId = openerId;
  HorseMind.reset();
  if (rows.length)
    HorseMind.importDurableOpponentProfiles(
      rows.map((r) => ({ ...(r as Record<string, unknown>), user_id: openerId })) as never
    );
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
  const gs = JSON.parse(JSON.stringify(st.gs)) as Record<string, unknown>;
  mutate?.(gs);
  const hy = HORSE_HYBRID_PROFILES.cash;
  const d = HorseLogic.decide(st.hero as never, gs as never, hy.style, { ...hy.mods }, {
    ...opts,
    decisionTimeMs: 1795501563479,
  } as never) as unknown as Record<string, unknown>;
  return {
    kind: actionKind(d.action as never, d.amount as never, st.pn as never),
    amount: d.amount as number | undefined,
    decision: d,
  };
}

export interface OopCellResult {
  dealt: number;
  threeBets: number;
  foldsToFourBet: number;
  /** 3-bets that folded to the 4-bet without an ace */
  foldsWithoutAce: number;
}

/** One cell: `n` seeded deals from `start`; the 3-bet decision and, after a 3-bet, the 4-bet answer. */
export function oopCell(
  spec: Omit<OopHandSpec, 'hole' | 'threeTo'>,
  opts: Record<string, unknown>,
  rows: readonly unknown[],
  n: number,
  start = 0
): OopCellResult {
  const out: OopCellResult = { dealt: 0, threeBets: 0, foldsToFourBet: 0, foldsWithoutAce: 0 };
  for (let i = start; i < start + n; i++) {
    const hole = oopDeal(spec.game, i);
    out.dealt++;
    const a = oopAsk({ ...spec, hole, threeTo: null }, opts, rows, 1000 + i);
    if (a.kind !== 'raise' || !Number.isFinite(a.amount)) continue;
    out.threeBets++;
    const f = oopAsk({ ...spec, hole, threeTo: a.amount as number }, opts, rows, 5000 + i);
    if (f.kind === 'fold') {
      out.foldsToFourBet++;
      if (!hole.some((c) => c.rank === 'A')) out.foldsWithoutAce++;
    }
  }
  return out;
}
