/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE TIME A HORSE TAKES IS PUBLIC INFORMATION ONLY (owner order 2026-11-15)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "There is a timing tell, when the Horses snap bet the turn ... fix that
 *  globally."
 *
 * A person watching the table sees the street, the board, the pot, the price,
 * the stacks, who is still in, which seat is acting and what it finally does.
 * This module turns exactly that, and nothing else, into the Horse's think
 * time. It is the ONE place a think time is produced when the option
 * `horseActionTimeIsPublicOnly` is on (HorseLogic's timing step), for every
 * variant and format, Lightning included (Lightning reads the same decision's
 * think time).
 *
 * What may NOT reach it, and cannot by construction (the spot type below has
 * no field for any of them, and the law test reads this file):
 *   - the Horse's hole cards, its hand class, its equity or its draws;
 *   - which internal rule, path or layer produced the action;
 *   - the brain's own "how close was this" hint (HorseLogic difficultyHint),
 *     the hold'em made-hand category behind the V87 Hollywood tank;
 *   - the strategy / Monte Carlo random stream (HorseEval fastRandom), whose
 *     position at the timing step depends on how many samples the private
 *     hand drew. The draws here come from a separate stream that only this
 *     module advances.
 *
 * THE MODEL IS THE SHIPPED ONE. The mixture (snap / beat / tank / time bank),
 * its weights, the per-Horse tempo, the decision-size gravity, the floors and
 * the soft floor are HorseLogic.computeThinkTime's, number for number, so the
 * table keeps today's pace. Three inputs are replaced by public ones:
 *   1. difficulty = the public complexity HorseLogic already uses postflop
 *      (board wetness of the primary board, street depth, price, extra
 *      boards), computed here from the board itself, on every path;
 *   2. the hold'em Hollywood tank is drawn for every hold'em raise or big
 *      river wager that fits the PUBLIC half of its rule, at a lower rate
 *      (the private half, "and it holds a straight or better", is gone);
 *   3. the random draws.
 *
 * COMPUTE TIME. The engine releases the action at max(decision ready, think
 * time) (ServerTableEngineTurns scheduleHorseAction and LightningHandHost
 * scheduleHorse both subtract the elapsed decision time from the think time),
 * so a decision that needed the deep path is hidden whenever it finishes
 * inside the think time. The floors below are what guarantee that: nothing
 * acts sooner than 350 ms (no bet to call), 1,250 ms (facing a bet) or
 * 2,000 ms (a tournament shove), and the measured decision time of the
 * slowest path is inside them (see the property test).
 *
 * Pure apart from the dedicated random stream. No I/O.
 */
import { randomBytes } from 'node:crypto';
import { decisionGravity } from './horseDecisionGravity.js';
import { HorseMind } from './HorseMind.js';
import { personaHash } from './HorsePersona.js';
import type { Card } from '../types.js';

/** Same value as HorseLogic.THINK_TIMEBANK_SENTINEL (pinned by the test). */
export const HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL = 90_000;
/** Nothing that may check acts sooner than this. */
export const HORSE_PUBLIC_FREE_FLOOR_MS = 350;
/** Nothing that faces a bet acts sooner than this. */
export const HORSE_PUBLIC_FACING_FLOOR_MS = 1250;
/** A tournament shove, or a deliberate tournament check/fold. */
export const HORSE_PUBLIC_SHOVE_FLOOR_MS = 2000;
/** Share of publicly eligible hold'em spots that take a Hollywood tank. */
export const HORSE_PUBLIC_HOLLYWOOD_POSTFLOP_PER_MILLE = 120;
export const HORSE_PUBLIC_HOLLYWOOD_PREFLOP_PER_MILLE = 300;

/**
 * Everything the public pacing function may read. Every field is something
 * the whole table can see (or a fixed property of the seat's public persona).
 * There is deliberately no hole-card, hand-class, equity or branch field.
 */
export interface HorsePublicTimingSpot {
  stage: string;
  /** The action the table is about to see. */
  action: string;
  /** The wager the table is about to see, when there is one. */
  amount?: number;
  toCall: number;
  /** The pot being contested before this action. */
  pot: number;
  bigBlind: number;
  heroStack: number;
  /** Largest stack behind among the opponents still in the hand. */
  opponentStack: number;
  /** Players still contesting the pot (all-in players included). */
  contestingPlayers: number;
  /** The primary board, as dealt so far. */
  board: readonly Card[];
  /** Number of boards in play (1 for an ordinary hand). */
  boardCount: number;
  tournament: boolean;
  facingTournamentShove: boolean;
  /** Tournament persona that never quick check/folds (public per-seat trait). */
  deliberateCheckFold: boolean;
  /** Stable per-Horse id: the seat's public tempo persona. */
  tempoSeed: string;
  /** The style's think band, used only by the timing ablation. */
  thinkRange: readonly [number, number];
  /** `v9Timing` ablation: false keeps the flat band. */
  useTiming: boolean;
  /** `decisionGravityTiming` ablation. */
  useGravity: boolean;
  /** V86 Hollywood balance on postflop raises and big river bets (public rule). */
  hollywoodRaise: boolean;
  /** Public half of the V87 hold'em Hollywood rule fits this spot. */
  hollywoodHoldem: boolean;
  /** Remaining turn budget, when the caller supplied a deadline. */
  deadlineRemainingMs?: number;
}

// ── the dedicated timing stream ─────────────────────────────────────────────
// xorshift32, seeded from the operating system at load. It is never seeded
// from a hand, a card or the strategy stream, and only this module advances it.
let timingState = (randomBytes(4).readUInt32LE(0) || 0x9e3779b9) >>> 0;

/** Pin the timing stream (tests and replays only). */
export function seedHorseTimingRandom(seed: number): void {
  // Mixed first: xorshift32 started from a small integer returns a run of
  // near-zero values, which would make every seeded draw a snap.
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  timingState = (h ^ (h >>> 16)) >>> 0 || 1;
}

/** The timing stream's position, and putting it back (a side ask that must not move the decision's own draws). */
export function saveHorseTimingRandom(): number {
  return timingState;
}
export function restoreHorseTimingRandom(state: number): void {
  timingState = state >>> 0 || 1;
}

export function horseTimingRandom(): number {
  timingState ^= timingState << 13;
  timingState ^= timingState >>> 17;
  timingState ^= timingState << 5;
  timingState >>>= 0;
  return timingState / 4294967296;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function hash01(key: string, salt: number): number {
  let h = (0x811c9dc5 ^ (salt >>> 0)) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 8) / 16777216;
}

/**
 * How hard the spot LOOKS from the rail: wet board, late street, a big price,
 * more than one board. The formula HorseLogic's postflop brain already uses
 * for its public timing hint, computed here from the board so it holds on
 * every path. Preflop is 0, as today.
 */
export function horsePublicDifficulty(
  spot: Pick<HorsePublicTimingSpot, 'stage' | 'board' | 'toCall' | 'pot' | 'boardCount'>
): number {
  if (spot.stage === 'preflop') return 0;
  let wetness = 0.35;
  try {
    wetness = HorseMind.texture(spot.board as Card[]).wetness;
  } catch {
    /* an unreadable board keeps the neutral texture */
  }
  const streetDepth = spot.stage === 'river' ? 0.35 : spot.stage === 'turn' ? 0.2 : 0.08;
  const priceStress = spot.toCall > 0 ? Math.min(0.45, spot.toCall / Math.max(1, spot.pot)) : 0;
  return clamp01(wetness * 0.4 + streetDepth + priceStress + (spot.boardCount >= 2 ? 0.2 : 0));
}

/**
 * The think time, in ms, for a public spot. A value at or above
 * HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL is a deliberate time-bank burn, as in
 * HorseLogic.computeThinkTime; the engine decodes it the same way.
 */
export function horsePublicActionTimeMs(
  spot: HorsePublicTimingSpot,
  random: () => number = horseTimingRandom
): number {
  const deadline = spot.deadlineRemainingMs;
  const hasDeadlineClamp = deadline !== undefined && Number.isFinite(deadline);
  const clampToDeadline = (ms: number, minFloor: number): number =>
    hasDeadlineClamp
      ? Math.min(ms, Math.max(minFloor, Math.round((deadline as number) - 1500)))
      : ms;

  if (!spot.useTiming) {
    const [lo, hi] = spot.thinkRange;
    return clampToDeadline(Math.round(lo + random() * (hi - lo)), lo);
  }

  const action = spot.action;
  const stage = spot.stage;
  const toCall = spot.toCall;
  const pricePot = Number.isFinite(spot.pot) ? Math.max(0, spot.pot) : 0;
  const difficulty = horsePublicDifficulty(spot);
  const simple = action === 'check' || action === 'fold';
  const aggressive = action === 'raise' || action === 'all_in';
  const facingBet = toCall > 0;
  const bigRiverCall = stage === 'river' && toCall > pricePot * 0.5;
  const { gravity, easy } = spot.useGravity
    ? decisionGravity({
        stage,
        action,
        toCall,
        pot: pricePot,
        heroStack: Number(spot.heroStack) || 0,
        opponentStack: Number(spot.opponentStack) || 0,
        amount: spot.amount,
      })
    : { gravity: 0, easy: false };

  // Per-Horse tempo: FNV-1a of the seat's id, high bits (as shipped).
  const tempoSeed = spot.tempoSeed;
  let h = 2166136261;
  for (let i = 0; i < tempoSeed.length; i++) {
    h ^= tempoSeed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const tempo = (h >>> 11) / 2097152;

  let wSnap = 0.34 + (simple ? 0.3 : 0) + (stage === 'preflop' ? 0.14 : 0);
  const wBeat = 0.52;
  let wTank = 0.12 + (difficulty > 0 ? difficulty * 0.28 : 0) + (aggressive ? 0.05 : 0);
  let wBank = 0.012 + (bigRiverCall ? 0.04 : 0) + (difficulty > 0.6 ? 0.02 : 0);
  if (bigRiverCall) wSnap *= 0.25;
  if (difficulty > 0.5) wSnap *= 0.5;
  wSnap *= 1 - 0.7 * gravity;
  if (easy) wSnap *= 1.35;
  wTank += 0.4 * gravity;
  if (gravity > 0.6) wBank += 0.03 * gravity;
  wSnap *= 0.4 + (1 - tempo) * 1.7;
  wTank *= 0.35 + tempo * 1.5;
  wBank *= 0.3 + tempo * 1.7;

  const floor =
    spot.facingTournamentShove || (spot.deliberateCheckFold && simple)
      ? HORSE_PUBLIC_SHOVE_FLOOR_MS
      : facingBet
        ? HORSE_PUBLIC_FACING_FLOOR_MS
        : HORSE_PUBLIC_FREE_FLOOR_MS;

  const total = wSnap + wBeat + wTank + wBank;
  const roll = random() * total;
  let think: number;
  if (roll < wSnap) {
    think = facingBet ? 1150 + random() * 1450 : 180 + random() * 620;
  } else if (roll < wSnap + wBeat) {
    think = 1100 + random() * 3400;
  } else if (roll < wSnap + wBeat + wTank) {
    think = 4600 + random() * 6200;
  } else {
    const bankSentinel = Math.round(HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL + random() * 6500);
    return clampToDeadline(bankSentinel, floor);
  }

  think *= 0.6 + tempo * 0.85;
  if (difficulty > 0) think *= 1 + difficulty * 0.35;
  think *= 1 + 0.45 * gravity;
  if (easy) think *= 0.85;
  if (simple && stage === 'preflop' && !facingBet) think *= 0.8;
  if (aggressive) think *= 1.1;
  if (spot.contestingPlayers === 2) think *= 0.85;

  // Hold'em Hollywood tank, public half of the rule only.
  if (spot.hollywoodHoldem) {
    const hw = personaHash(
      `${tempoSeed}|hw87|${stage}|${Math.round(pricePot * 100)}|${Math.round(
        (spot.bigBlind || 1) * 100
      )}|${action}|${Math.round((spot.amount ?? 0) * 100)}|${Math.floor(think)}`
    );
    const perMille =
      stage === 'preflop'
        ? HORSE_PUBLIC_HOLLYWOOD_PREFLOP_PER_MILLE
        : HORSE_PUBLIC_HOLLYWOOD_POSTFLOP_PER_MILLE;
    if (hw % 1000 < perMille) think = Math.max(think, 4800 + ((hw >>> 10) % 3800));
  }

  // V86 Hollywood balance on postflop raises and big river bets (already public).
  const hwBb = Math.max(1e-6, spot.bigBlind || 2);
  if (
    spot.useGravity &&
    spot.hollywoodRaise &&
    stage !== 'preflop' &&
    ((action === 'raise' && facingBet) ||
      (stage === 'river' && action === 'bet' && pricePot >= 25 * hwBb))
  ) {
    const hwKey = `${tempoSeed}:${Math.floor(think * 1000)}:${Math.round((pricePot / hwBb) * 10)}`;
    if (hash01(hwKey, 8609) < 0.28) {
      const hwMul = 1.65 + 0.7 * hash01(hwKey, 8617);
      think = Math.max(think * hwMul, think + 1850 + 950 * hash01(hwKey, 8618));
    }
  }
  if (think >= floor) return clampToDeadline(Math.round(think), floor);

  // Soft floor: a draw beneath the floor lands just above it, never on it.
  let jh = (2166136261 ^ Math.floor(think * 1000)) >>> 0;
  jh = Math.imul(jh ^ (jh >>> 15), 2246822507) >>> 0;
  jh = Math.imul(jh ^ (jh >>> 13), 3266489909) >>> 0;
  const u = Math.max(1e-6, 1 - (jh >>> 8) / 16777216);
  return clampToDeadline(Math.round(floor + -Math.log(u) * floor * 0.18), floor);
}
