/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE ACTION-LINE POSTERIOR (Wave 2 Enhancement #1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Zero-allocation, street-by-street Bayesian range-bucket posterior tracker
 * across `preflop -> flop -> turn -> river` from public `actionHistory`,
 * board texture (`wet`, `paired`, `flushComplete`, `straightComplete`),
 * bet sizing (`potFrac`), and optional observed `HorseMind` tendencies.
 *
 * Five canonical range buckets sum to `1.0`:
 *   0. `nutted`           — sets, boats, flushes, straights, nut two-pair
 *   1. `overpair_top_pair`— overpairs, strong top pair / medium showdown
 *   2. `nut_draw_wrap`    — nut flush draws, big wraps, combo draws
 *   3. `float_weak_draw`  — gutshots, weak pairs, positional floats
 *   4. `air_blocker`      — pure air / missed preflop hands / blocker bluffs
 *
 * Public-only contract: inspects ONLY public `actionHistory`, public
 * `communityCards`, public `pot` / `bigBlind`, and public opponent tendencies.
 * Zero private opponent cards are ever read.
 */

import type { Card } from '../types.js';
import { RANK_VALUES } from './PokerEngine.js';

const SUIT_INDEX_MAP: Record<string, number> = {
  hearts: 0,
  diamonds: 1,
  clubs: 2,
  spades: 3,
};

function rankVal(rank: string): number {
  return RANK_VALUES[rank as Card['rank']] ?? 0;
}

function suitIdx(suit: string): number {
  return SUIT_INDEX_MAP[suit] ?? 0;
}

export interface PublicActionHistoryEntry {
  stage?: string;
  seat?: number;
  userId?: string;
  action: string;
  amount?: number;
  isFullRaise?: boolean;
}

export interface ActionLineVillainTendency {
  vpip?: number;
  pfr?: number;
  aggFactor?: number;
  foldToBetRate?: number;
}

export interface ActionLinePosteriorInput {
  villainUserId?: string;
  villainSeat?: number;
  heroSeat?: number;
  stage: 'flop' | 'turn' | 'river';
  board: readonly Card[];
  pot: number;
  bigBlind: number;
  actionHistory?: readonly PublicActionHistoryEntry[];
  isOmaha?: boolean;
  holeCount?: number;
  multiwayCount?: number;
  tendency?: ActionLineVillainTendency;
}

export interface ActionLinePosterior {
  nutted: number;
  overpairTopPair: number;
  nutDrawWrap: number;
  floatWeakDraw: number;
  airBlocker: number;
  /** True when villain's prior passive action on a dynamic board caps top-of-range share. */
  rangeCapped: boolean;
  /** True when villain's sizing/line polarizes toward `nutted` + `airBlocker` and hollows out medium hands. */
  polarized: boolean;
  /** Multiplier (`0.55 .. 1.45`) on villain's top-of-range concentration for equity / defense adjustments. */
  nutDensityMultiplier: number;
  /** Estimated bluff share (`0.04 .. 0.60`) conditional on villain's public line through this street. */
  bluffShareEstimate: number;
  /** Recommended hero opponent-range `[lo, hi]` narrowing from the public action line (`0 <= lo < hi <= 1`). */
  narrowedRange: [number, number];
}

interface BoardTextureFacts {
  paired: boolean;
  tripsOnBoard: boolean;
  maxSuitCount: number;
  flushDrawPossible: boolean;
  flushComplete: boolean;
  connectedness: number;
  straightComplete: boolean;
  wet: boolean;
  highCardRank: number;
}

function inspectBoardPrefix(board: readonly Card[], count: number): BoardTextureFacts {
  const n = Math.min(board.length, count);
  let suit0 = 0;
  let suit1 = 0;
  let suit2 = 0;
  let suit3 = 0;
  let rankMask = 0;
  let paired = false;
  let tripsOnBoard = false;
  let pairMask = 0;
  let highCardRank = 0;

  for (let i = 0; i < n; i++) {
    const c = board[i];
    const r = rankVal(c.rank);
    if (r > highCardRank) highCardRank = r;
    const bit = 1 << r;
    if ((rankMask & bit) !== 0) {
      if ((pairMask & bit) !== 0) tripsOnBoard = true;
      paired = true;
      pairMask |= bit;
    }
    rankMask |= bit;
    if (r === 14) rankMask |= 1 << 1;

    const s = suitIdx(c.suit);
    if (s === 0) suit0++;
    else if (s === 1) suit1++;
    else if (s === 2) suit2++;
    else suit3++;
  }

  const maxSuitCount = Math.max(suit0, suit1, suit2, suit3);
  let maxWindow5 = 0;
  for (let low = 1; low <= 10; low++) {
    let cnt = 0;
    for (let k = 0; k < 5; k++) {
      if ((rankMask & (1 << (low + k))) !== 0) cnt++;
    }
    if (cnt > maxWindow5) maxWindow5 = cnt;
  }

  const flushDrawPossible = maxSuitCount >= 2;
  const flushComplete = maxSuitCount >= 3;
  const straightComplete = maxWindow5 >= 3;
  const wet = flushComplete || (maxSuitCount >= 2 && maxWindow5 >= 3);

  return {
    paired,
    tripsOnBoard,
    maxSuitCount,
    flushDrawPossible,
    flushComplete,
    connectedness: maxWindow5,
    straightComplete,
    wet,
    highCardRank,
  };
}

function matchesVillain(
  entry: PublicActionHistoryEntry,
  villainUserId?: string,
  villainSeat?: number
): boolean {
  if (villainUserId && entry.userId) return entry.userId === villainUserId;
  if (villainSeat !== undefined && entry.seat !== undefined) return entry.seat === villainSeat;
  return false;
}

/**
 * Compute villain's Bayesian 5-bucket range posterior from public action history
 * and board texture. Zero heap allocations beyond the single returned record.
 */
export function computeActionLinePosterior(input: ActionLinePosteriorInput): ActionLinePosterior {
  const {
    villainUserId,
    villainSeat,
    stage,
    board,
    pot,
    bigBlind,
    actionHistory,
    isOmaha = false,
    holeCount = isOmaha ? 4 : 2,
    multiwayCount = 2,
    tendency,
  } = input;

  const bb = Math.max(0.01, bigBlind);
  // Prior weights before street actions:
  let wNut = isOmaha ? (holeCount >= 5 ? 0.17 : 0.15) : 0.12;
  let wTop = isOmaha ? 0.22 : 0.28;
  let wDraw = isOmaha ? (holeCount >= 5 ? 0.3 : 0.26) : 0.18;
  let wFloat = 0.22;
  let wAir = isOmaha ? (holeCount >= 5 ? 0.09 : 0.15) : 0.2;

  // Adjust prior weakly from public VPIP/PFR/AF if known, shrunk by sample credibility:
  if (tendency) {
    const cred = Math.min(
      1,
      Math.max(0, (tendency as { sampleSize?: number }).sampleSize ?? 20) / 25
    );
    if (tendency.vpip !== undefined && tendency.vpip > 0.42) {
      wFloat += 0.05 * cred;
      wAir += 0.05 * cred;
    } else if (tendency.vpip !== undefined && tendency.vpip < 0.2) {
      wTop += 0.05 * cred;
      wAir = Math.max(0.05, wAir - 0.06 * cred);
    }
    if (tendency.aggFactor !== undefined && tendency.aggFactor > 2.8) {
      wAir += 0.04 * cred;
      wDraw += 0.03 * cred;
    }
  }

  let rangeCapped = false;
  let polarized = false;
  let preflopAggressor = false;
  let preflopThreeBet = false;
  let preflopRaisesSeen = 0;
  let streetActionsSeen = 0;

  const flopFacts = board.length >= 3 ? inspectBoardPrefix(board, 3) : null;
  const turnFacts = board.length >= 4 ? inspectBoardPrefix(board, 4) : null;
  const riverFacts = board.length >= 5 ? inspectBoardPrefix(board, 5) : null;

  let runningPot = Math.max(bb * 1.5, bb * Math.max(2, multiwayCount));
  let flopAggressor = false;
  let turnCheckedThrough = false;
  let currentTrackStreet = 'preflop';
  const seatStreetCommitted = new Map<string, number>();

  if (actionHistory && actionHistory.length > 0) {
    for (let i = 0; i < actionHistory.length; i++) {
      const e = actionHistory[i];
      const act = e.action;
      const amt = Math.max(0, e.amount ?? 0);
      const st = e.stage ?? 'preflop';
      if (st !== currentTrackStreet) {
        currentTrackStreet = st;
        seatStreetCommitted.clear();
      }
      const actorKey =
        e.seat !== undefined ? `s:${e.seat}` : e.userId ? `u:${e.userId}` : `idx:${i}`;
      const prevCommitted = seatStreetCommitted.get(actorKey) ?? 0;
      const deltaAdded =
        act === 'raise' || act === 'all_in'
          ? amt > prevCommitted
            ? amt - prevCommitted
            : amt
          : amt;
      if (amt > 0) {
        seatStreetCommitted.set(
          actorKey,
          act === 'raise' || act === 'all_in' ? Math.max(prevCommitted, amt) : prevCommitted + amt
        );
      }
      const isVillain = matchesVillain(e, villainUserId, villainSeat);

      if (st === 'preflop') {
        if (act === 'raise' || act === 'bet' || act === 'all_in') {
          preflopRaisesSeen++;
          if (isVillain) {
            preflopAggressor = true;
            if (preflopRaisesSeen >= 2) preflopThreeBet = true;
          } else {
            preflopAggressor = false;
          }
        }
        if (deltaAdded > 0) runningPot += deltaAdded;
        continue;
      }

      if (!isVillain) {
        if (deltaAdded > 0) runningPot += deltaAdded;
        continue;
      }

      streetActionsSeen++;
      const potBefore = Math.max(bb * 2, runningPot);
      const potFrac = deltaAdded > 0 ? deltaAdded / potBefore : 0;
      const tex =
        st === 'flop'
          ? flopFacts
          : st === 'turn'
            ? (turnFacts ?? flopFacts)
            : (riverFacts ?? turnFacts ?? flopFacts);

      if (act === 'check') {
        if (st === 'flop') {
          // Checking back or checking a wet flop reduces fast-play sets/two-pair/vulnerable overpairs,
          // especially in Omaha or multiway where slowplaying sets on wet boards bleeds equity.
          if (tex?.wet || multiwayCount >= 3 || isOmaha) {
            wNut *= isOmaha ? 0.52 : 0.62;
            wTop *= preflopAggressor ? 0.78 : 0.9;
            wFloat *= 1.22;
            wAir *= 1.15;
            if (preflopAggressor && tex?.wet) rangeCapped = true;
          } else {
            wNut *= 0.8;
            wFloat *= 1.12;
          }
        } else if (st === 'turn') {
          turnCheckedThrough = true;
          // Checking back a wet turn or after flop action strongly caps nutted hands.
          if (tex?.wet || flopAggressor || isOmaha) {
            wNut *= 0.45;
            wTop *= 0.85;
            wDraw *= 0.85;
            wFloat *= 1.28;
            wAir *= 1.18;
            rangeCapped = true;
          } else {
            wNut *= 0.68;
            rangeCapped = true;
          }
        } else if (st === 'river') {
          wNut *= 0.35;
          wDraw *= 0.02;
          wAir *= 0.8;
          wFloat *= 1.3;
          rangeCapped = true;
        }
      } else if (act === 'call') {
        if (st === 'flop') {
          // Cold-calling or flatting flop: heavy in draws, medium pairs, floats; fewer pure air or top sets on wet boards.
          wNut *= tex?.wet ? 0.72 : 0.85;
          wTop *= 1.12;
          wDraw *= 1.35;
          wFloat *= potFrac <= 0.45 ? 1.25 : 0.85;
          wAir *= 0.4;
        } else if (st === 'turn') {
          // Calling a turn bet narrows out pure air and weak floats; concentrates medium showdown + strong draws.
          wNut *= tex?.wet ? 0.78 : 0.88;
          wTop *= 1.18;
          wDraw *= 1.28;
          wFloat *= potFrac <= 0.45 ? 0.95 : 0.55;
          wAir *= 0.25;
        } else if (st === 'river') {
          wDraw *= 0.02;
          wAir *= 0.05;
          wTop *= 1.25;
        }
      } else if (act === 'bet' || act === 'raise' || act === 'all_in') {
        const isRaise = act === 'raise' || (act === 'all_in' && potFrac >= 1.15);
        if (st === 'flop') {
          flopAggressor = true;
          if (isRaise) {
            // Flop raise / check-raise: polarizes to sets/two-pair + strong combo draws + occasional air blocker.
            wNut *= 2.15;
            wDraw *= isOmaha ? 1.85 : 1.65;
            wTop *= 0.65;
            wFloat *= 0.35;
            wAir *= 0.75;
            rangeCapped = false;
            polarized = true;
          } else if (potFrac >= 0.72) {
            wNut *= 1.45;
            wTop *= 1.15;
            wDraw *= 1.3;
            wFloat *= 0.6;
            wAir *= 0.95;
            rangeCapped = false;
          } else {
            // Small/medium c-bet or probe: wide merged range.
            wNut *= 1.1;
            wTop *= 1.12;
            wDraw *= 1.1;
            wAir *= 1.08;
          }
        } else if (st === 'turn') {
          if (isRaise || potFrac >= 0.75) {
            wNut *= isRaise ? 2.35 : 1.7;
            wDraw *= isOmaha ? 1.55 : 1.35;
            wTop *= isRaise ? 0.52 : 0.85;
            wFloat *= 0.3;
            wAir *= potFrac >= 0.85 ? 1.05 : 0.8;
            rangeCapped = false;
            polarized = true;
          } else {
            wNut *= 1.2;
            wTop *= 1.15;
            wDraw *= 1.15;
            wFloat *= 0.75;
          }
        } else if (st === 'river') {
          // On the river, busted draws must either give up or convert into `airBlocker` bluffs!
          const bustedDrawConversion =
            flopFacts?.flushDrawPossible && !riverFacts?.flushComplete ? 0.55 : 0.35;
          const convertedAir = wDraw * bustedDrawConversion;
          wDraw *= 0.08;
          wAir += convertedAir;

          if (isRaise || potFrac >= 0.8) {
            // Big polar river bet or raise: hollows out thin 1-pair (`overpairTopPair`, `floatWeakDraw`).
            // HOWEVER, if villain checked back a wet turn (`turnCheckedThrough` & `rangeCapped`) and suddenly blasts river
            // when obvious draws bricked, airBlocker share stays elevated relative to capped nuts!
            wNut *= turnCheckedThrough && !riverFacts?.flushComplete ? 1.45 : 2.25;
            wTop *= isRaise ? 0.3 : 0.55;
            wFloat *= 0.18;
            wAir *= isRaise ? (isOmaha ? 0.65 : 0.85) : 1.15;
            polarized = true;
            if (!turnCheckedThrough) rangeCapped = false;
          } else if (potFrac > 0 && potFrac <= 0.4) {
            // Small river block-bet: weighted toward thin showdown (`overpairTopPair`, `floatWeakDraw`) and fewer nuts.
            wNut *= 0.72;
            wTop *= 1.35;
            wFloat *= 1.15;
            wAir *= 0.7;
          } else {
            wNut *= 1.45;
            wTop *= 0.95;
            wFloat *= 0.45;
            wAir *= 0.95;
          }
        }
      }

      if (deltaAdded > 0) runningPot += deltaAdded;
    }
  }

  // Preflop 3-bettor shift if no postflop contradictions:
  if (preflopThreeBet && !rangeCapped) {
    wNut *= 1.15;
    wTop *= 1.25;
    wFloat *= 0.65;
  } else if (!preflopAggressor && streetActionsSeen === 0) {
    // Preflop caller before acting postflop: capped out of AA/KK preflop 3-bet portion in NLH.
    if (!isOmaha) wTop *= 0.9;
    wDraw *= 1.1;
    wFloat *= 1.1;
  }

  // Multiway discipline: bluff share drops in 3+ way pots.
  if (multiwayCount >= 3) {
    const damp = multiwayCount >= 4 ? 0.55 : 0.72;
    wAir *= damp;
    wNut *= 1.12;
  }

  // Normalize buckets to sum to 1.0:
  const floor = 1e-4;
  wNut = Math.max(floor, wNut);
  wTop = Math.max(floor, wTop);
  wDraw = Math.max(floor, wDraw);
  wFloat = Math.max(floor, wFloat);
  wAir = Math.max(floor, wAir);
  const sum = wNut + wTop + wDraw + wFloat + wAir;

  const nutted = wNut / sum;
  const overpairTopPair = wTop / sum;
  const nutDrawWrap = wDraw / sum;
  const floatWeakDraw = wFloat / sum;
  const airBlocker = wAir / sum;

  const baselineNut = isOmaha ? (holeCount >= 5 ? 0.17 : 0.15) : 0.12;
  const nutDensityMultiplier = Math.max(0.55, Math.min(1.45, nutted / Math.max(0.05, baselineNut)));

  const rawBluffShare =
    stage === 'river'
      ? airBlocker + floatWeakDraw * (polarized ? 0.35 : 0.15)
      : airBlocker + floatWeakDraw * 0.25 + nutDrawWrap * 0.35;
  const bluffShareEstimate = Math.max(0.04, Math.min(0.6, rawBluffShare));

  // Derive narrowed [lo, hi] percentile range matching HorseEval's ascending [0..1]
  // CDF convention (0.0 = weakest hand, 1.0 = pure nuts):
  // - Capped lines clamp `hi` below 1.0 (trimming pure top-of-range nuts).
  // - Uncapped / polarized aggressive lines raise `lo` toward the upper slice while keeping `hi = 1.0`.
  const valueConcentration = nutted + overpairTopPair;
  let lo: number;
  let hi: number;
  if (rangeCapped) {
    hi = Math.max(0.35, Math.min(0.95, 0.72 + (valueConcentration + nutDrawWrap * 0.35) * 0.26));
    lo = Math.max(
      0.08,
      Math.min(hi - 0.14, 0.22 + valueConcentration * 0.38 - (airBlocker + floatWeakDraw) * 0.16)
    );
  } else {
    hi = 1.0;
    const baseLo = isOmaha ? 0.42 : 0.5;
    lo = Math.max(
      0.12,
      Math.min(0.86, baseLo + valueConcentration * 0.34 - (airBlocker + floatWeakDraw) * 0.22)
    );
    const potBB = pot / bb;
    if (potBB >= 45 && polarized) {
      lo = Math.min(0.88, lo + 0.06);
    }
  }

  return {
    nutted,
    overpairTopPair,
    nutDrawWrap,
    floatWeakDraw,
    airBlocker,
    rangeCapped,
    polarized,
    nutDensityMultiplier,
    bluffShareEstimate,
    narrowedRange: [lo, hi],
  };
}
