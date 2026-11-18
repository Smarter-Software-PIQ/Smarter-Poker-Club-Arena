/**
 * V87 ALL-HANDS HUMAN-VS-HORSE DEEP-DIVE DISCIPLINE (2026-11-10)
 *
 * Builds on top of V86 (`v86PloOverhaul`). Calibrated from the complete
 * PokerIQ-Production human-vs-Horse dataset (49,310 physical hands, 41,151
 * eligible included hands, 349,970 Horse decisions across the 8 target Cash &
 * MTT NLH/PLO4/PLO5/PLO6 domains) and replayed against current HorseLogic
 * before and after implementation:
 *
 *   1. Omaha preflop multiway & 5/6-card selectivity (PLO4 / PLO5 / PLO6):
 *      - Presumed unknown-opener reads keep their value 3-bet adaptation in
 *        Omaha without overriding cold-call / BB-flat thresholds into family
 *        pots; observed human reads keep full measured adaptation.
 *      - V24 Omaha price-defense relief is capped by hole-card count, seat,
 *        and caller count, with multiway cold-call tightening and higher
 *        PLO5 / PLO6 continue floors.
 *      - 5-card and 6-card V46 hand-class calibration rescues playable trips
 *        carrying a coordinated 4-card AA-ds / broadway-ds core while
 *        penalizing self-blocked 4-to-a-suit hands and non-Ace-suited shapes.
 *
 *   2. Heads-up Omaha position-stab qualification holdback:
 *      - Both turn (-8.96 +/- 3.34 bb/100, 3,000 HU hands) and river
 *        (-15.03 +/- 3.79 bb/100 across 15,000 paired seat-swapped HU self-play
 *        deals = 30,000 hands, p = 0.00007; +0.66 +/- 1.97 bb/100 vs human HU)
 *        suppression of `heads_up_position_stab` failed qualification and are
 *        retained OFF (`v87ShouldSuppressOmahaPositionStab` returns `false`).
 *
 *   3. Postflop PLO6 big-bet call discipline & Omaha bet-then-raised sizing:
 *      - Extends V81/V86 >= 0.90-pot non-HU turn/river call-fold protection to
 *        6-card PLO6 turn and river cells (two pair, vulnerable trips,
 *        vulnerable straights, non-nut / paired-board flushes, and dead-bottom
 *        underboats with >= 3 higher boats and 0 lower boats).
 *      - Withholds the unconditional +0.10 flop V40 cap lift on drawless bare
 *        pair / air in Omaha.
 *      - Excludes current-street hero bets from commitment and shades the call
 *        bar when an Omaha bet is raised and hero holds a vulnerable non-nut
 *        made hand without a nutty redraw.
 *
 *   4. Ante / multiway pricedIn trash floor & NLH turn cold-raise shade:
 *      - Prevents the V13 pricedIn pot-odds override from turning folds into
 *        calls with bottom-decile trash facing a preflop raise in tournaments
 *        or non-HiLo Omaha (Cash NLH and all-in <= 2bb calls are untouched).
 *      - Shades single-board Hold'em turn bluff-catchers facing a cold raise
 *        or a multiway >= 0.75-pot barrel without a hole-card draw.
 *
 * Pure, deterministic, zero RNG draws. PLO8 / Hi-Lo variants are excluded.
 */

import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import {
  omahaBoatPosition,
  omahaDrawQuality,
  omahaNutStatus,
  scoreOmahaHi,
  scoreOmahaHiPartial,
} from './HorseEval.js';
import { handClassRead, type HandClassRead } from './HorseHandClasses.js';
import type { PreflopOpenerExploit } from './HorseOpponentExploit.js';
import { RANKS, RANK_VALUES, SUITS } from './PokerEngine.js';

export interface V87PositionStabState {
  stage: string;
  bombPot?: boolean;
  communityCards: Card[];
  communityCards2?: Card[];
  communityCards3?: Card[];
  players: SeatPlayer[];
  dealerSeat?: number;
  currentBet?: number;
  actionHistory?: ReadonlyArray<{ stage?: string; action?: string }>;
}

const V87_OMAHA_BIG_BET_MIN_WAGER_FRACTION = 0.9;

function boardIsPaired(board: readonly Card[]): boolean {
  const seen = new Set<string>();
  for (const c of board) {
    if (seen.has(c.rank)) return true;
    seen.add(c.rank);
  }
  return false;
}

function hasOmahaSingleBoardRiverNuts(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length !== 5 || hole.length < 4 || hole.length > 6) return false;
  const known = new Set<string>();
  for (const c of hole) known.add(`${c.rank}:${c.suit}`);
  for (const c of board) known.add(`${c.rank}:${c.suit}`);
  if (known.size !== hole.length + 5) return false;
  const unseen: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (!known.has(`${rank}:${suit}`)) unseen.push({ rank, suit });
    }
  }
  const boardArr = [...board];
  const heroHigh = scoreOmahaHi([...hole], boardArr);
  for (let i = 0; i < unseen.length; i++) {
    for (let j = i + 1; j < unseen.length; j++) {
      if (scoreOmahaHi([unseen[i], unseen[j]], boardArr) > heroHigh) return false;
    }
  }
  return true;
}

export function v87HoldsDryNutFlushBlocker(hole: readonly Card[], board: readonly Card[]): boolean {
  const boardSuitCounts = new Map<string, number>();
  for (const c of board) {
    boardSuitCounts.set(c.suit, (boardSuitCounts.get(c.suit) ?? 0) + 1);
  }
  for (const [suit, count] of boardSuitCounts) {
    if (count < 3) continue;
    const heroSuit = hole.filter((c) => c.suit === suit);
    // In Omaha a made flush requires 2 suited hole cards; holding 1 card of
    // the 3-flush suit when it is the highest rank not already on the board
    // is the dry nut-flush blocker.
    if (heroSuit.length >= 2) continue;
    const targetRank = [...RANKS]
      .reverse()
      .find((r) => !board.some((c) => c.suit === suit && c.rank === r));
    if (targetRank && heroSuit.some((c) => c.rank === targetRank)) return true;
  }
  return false;
}

/**
 * Pillar 1A: Presumed unknown-opener reads in non-HiLo Omaha retain their
 * value 3-bet adaptation (`threeBetBar`) without overriding cold-call or
 * BB-flat bars (`flatBar` / `bbFlatBar`) into loose multiway flats. Observed
 * reads (`presumed !== true`) remain completely unchanged.
 */
export function v87SanitizeOmahaOpenerExploit(
  opener: PreflopOpenerExploit | undefined,
  openerPresumed: boolean,
  isOmaha: boolean,
  isHiLo: boolean,
  omahaHoleCount?: number,
  callers?: number
): PreflopOpenerExploit | undefined {
  if (!opener || !openerPresumed || !isOmaha || isHiLo) return opener;
  if ((omahaHoleCount === 4 || omahaHoleCount === 5) && (callers ?? 0) === 0) return opener;
  if (opener.flatBar === null && opener.bbFlatBar === null) return opener;
  return {
    ...opener,
    flatBar: null,
    bbFlatBar: null,
  };
}

/**
 * Pillar 1B: Hole-count, seat, and multiway-aware bounds for V24 Omaha preflop
 * price-defense relief and continue floor.
 */
export function v87OmahaCallBarBounds(
  holeCount: number | undefined,
  position: string,
  callers: number
): { maxPriceRelief: number; callFloor: number } {
  const hc = holeCount === 6 ? 6 : holeCount === 5 ? 5 : 4;
  const c = Math.max(0, callers);
  if (hc <= 5 && c === 0) {
    return { maxPriceRelief: 0.5, callFloor: 0.28 };
  }
  if (position === 'bb') {
    const maxPriceRelief =
      c === 0 ? (hc === 6 ? 0.1 : 0.12) : hc === 6 ? 0.06 : hc === 5 ? 0.08 : 0.1;
    const callFloor = c === 0 ? (hc === 6 ? 0.36 : 0.33) : hc === 6 ? 0.42 : hc === 5 ? 0.39 : 0.34;
    return { maxPriceRelief, callFloor };
  }
  const maxPriceRelief = c >= 1 ? 0.02 : hc === 6 ? 0.04 : 0.05;
  const callFloor =
    hc === 6
      ? 0.46 + Math.min(2, c) * 0.04
      : hc === 5
        ? 0.42 + Math.min(2, c) * 0.035
        : 0.38 + Math.min(2, c - 1) * 0.03;
  return { maxPriceRelief, callFloor };
}

/**
 * Pillar 1C: Post-exploit multiway overcall & deep-stack OOP cold-call bar
 * tightening in non-HiLo Omaha.
 */
export function v87OmahaColdCallTighten(
  holeCount: number | undefined,
  position: string,
  callers: number,
  stackBB: number
): number {
  const hc = holeCount === 6 ? 6 : holeCount === 5 ? 5 : 4;
  if (hc <= 5 && callers <= 0) return 0;
  let bump = 0;
  if (callers >= 1) {
    bump += (position === 'bb' ? 0.025 : 0.04) * Math.min(3, callers);
    if (hc === 6) bump += 0.03;
    else if (hc === 5) bump += 0.015;
  } else if (position !== 'bb') {
    if (hc === 6) bump += 0.03;
    else if (hc === 5) bump += 0.015;
  }
  if (position !== 'bb' && position !== 'late' && stackBB >= 60) {
    bump += 0.03;
  }
  return bump;
}

/**
 * Pillar 1D: 5-card and 6-card Omaha hand-class adjustment.
 * - Rescues 5/6-card `trips` when a 4-card subset drops the redundant trip card
 *   and still forms `aa_ds` or `broadway_ds` (or `kk_plus` alongside a suited Ace).
 * - Penalizes 4+-of-one-suit self-blocked hands and non-Ace-suited 5/6-card
 *   rundowns / pair-support classes whose dominated flushes over-realize poorly.
 */
export function v87AdjustFiveSixCardHandClass(
  cards: readonly Card[],
  baseRead: HandClassRead
): { read: HandClassRead; changed: boolean } {
  if (cards.length < 5) return { read: baseRead, changed: false };

  const suitCounts = new Map<string, number>();
  for (const c of cards) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  let maxSuit = 0;
  for (const n of suitCounts.values()) {
    if (n > maxSuit) maxSuit = n;
  }
  const hasSuitedAce = cards.some((c) => c.rank === 'A' && (suitCounts.get(c.suit) ?? 0) >= 2);

  if (baseRead.cls === 'trips') {
    let bestRescue: HandClassRead | null = null;
    let bestRank = -1;
    const n = cards.length;
    for (let a = 0; a < n - 3; a++) {
      for (let b = a + 1; b < n - 2; b++) {
        for (let c = b + 1; c < n - 1; c++) {
          for (let d = c + 1; d < n; d++) {
            const sub = [cards[a], cards[b], cards[c], cards[d]];
            const subRead = handClassRead(sub, true, false);
            const nonAceRanks = sub
              .filter((c) => c.rank !== 'A')
              .map((c) => RANK_VALUES[c.rank] ?? 0);
            const coordinatedSide =
              nonAceRanks.length === 2 &&
              Math.min(nonAceRanks[0], nonAceRanks[1]) >= 9 &&
              Math.abs(nonAceRanks[0] - nonAceRanks[1]) <= 3;
            const rank =
              subRead.cls === 'aa_ds' && coordinatedSide
                ? 3
                : subRead.cls === 'broadway_ds'
                  ? 2
                  : subRead.cls === 'kk_plus' && hasSuitedAce && coordinatedSide
                    ? 1
                    : 0;
            if (rank > bestRank) {
              bestRank = rank;
              bestRescue = subRead;
            }
          }
        }
      }
    }
    if (bestRescue && bestRank > 0 && maxSuit <= 3) {
      return {
        changed: true,
        read: {
          cls: bestRescue.cls,
          shift: {
            open: Math.max(-0.02, bestRescue.shift.open + 0.03),
            threeBet: Math.max(0, bestRescue.shift.threeBet + 0.04),
            fourBet: Math.max(0, bestRescue.shift.fourBet + 0.04),
            coldCall: Math.max(0, bestRescue.shift.coldCall + 0.03),
            bbDefend: Math.max(0, bestRescue.shift.bbDefend + 0.03),
          },
          neverThreeBet: bestRescue.neverThreeBet,
          foldAlways: false,
        },
      };
    }
    return { read: baseRead, changed: false };
  }

  if (maxSuit >= 4) {
    return {
      changed: true,
      read: {
        ...baseRead,
        cls: baseRead.cls === 'other' ? 'dangler' : baseRead.cls,
        shift: {
          open: baseRead.shift.open + 0.06,
          threeBet: baseRead.shift.threeBet + 0.08,
          fourBet: baseRead.shift.fourBet + 0.08,
          coldCall: baseRead.shift.coldCall + 0.06,
          bbDefend: baseRead.shift.bbDefend + 0.05,
        },
        neverThreeBet: true,
      },
    };
  }

  if (!hasSuitedAce && (baseRead.cls === 'rundown' || baseRead.cls === 'pair_support')) {
    const pad = cards.length >= 6 ? 0.05 : 0.03;
    return {
      changed: true,
      read: {
        ...baseRead,
        shift: {
          open: baseRead.shift.open + pad * 0.75,
          threeBet: baseRead.shift.threeBet + pad,
          fourBet: baseRead.shift.fourBet + pad,
          coldCall: baseRead.shift.coldCall + pad,
          bbDefend: baseRead.shift.bbDefend + pad * 0.75,
        },
      },
    };
  }

  return { read: baseRead, changed: false };
}

/**
 * Pillar 2: Heads-up Omaha position-stab suppression (`heads_up_position_stab`)
 * is EXCLUDED from production activation following qualification:
 * - Turn suppression measured `-8.96 +/- 3.34` bb/100 (`3,000` HU hands).
 * - River suppression measured `-15.03 +/- 3.79` bb/100 across `15,000` paired
 *   seat-swapped HU self-play deals (`30,000` hands, `p = 0.00007`) and
 *   `+0.66 +/- 1.97` bb/100 vs human-calibrated HU (`p = 0.74`).
 * Always returns `false` so both turn and river Phase 10/11 `heads_up_position_stab`
 * remain intact.
 */
export function v87ShouldSuppressOmahaPositionStab(
  _player: SeatPlayer,
  _gs: V87PositionStabState,
  _referenceDecision: HorseDecision
): boolean {
  return false;
}

/**
 * Pillar 3A: PLO6 turn/river >= 0.90-pot call discipline (non-HU, non-bounty,
 * > 20bb effective, no postflop-maniac read on the bettor, first action on the
 * street). Mirrors V81's exact shared gate and returns the matched losing cell
 * name, or null when no fold applies.
 */
export interface V87Plo6BigBetInput {
  variant: string;
  street: string;
  hole: Card[];
  board: Card[];
  potFrac: number;
  effectiveBB: number;
  tournament: boolean;
  headsUpTable: boolean;
  bountyEvent: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  bettorOverBluffs: boolean;
  heroHasStreetChips: boolean;
}

export function v87Plo6BigBetCell(input: V87Plo6BigBetInput): string | null {
  if (input.variant.toLowerCase() !== 'plo6') return null;
  if (input.street !== 'turn' && input.street !== 'river') return null;
  if (
    input.hiLo ||
    input.multiBoard ||
    input.bombPot ||
    input.headsUpTable ||
    input.bountyEvent ||
    input.bettorOverBluffs ||
    input.heroHasStreetChips
  ) {
    return null;
  }
  if (!(input.effectiveBB > 20)) return null;
  if (!(input.potFrac >= V87_OMAHA_BIG_BET_MIN_WAGER_FRACTION)) return null;

  const { hole, board } = input;
  if (!hole || hole.length !== 6) return null;
  if (!board || (input.street === 'turn' ? board.length !== 4 : board.length !== 5)) return null;

  if (input.street === 'river' && hasOmahaSingleBoardRiverNuts(hole, board)) return null;

  const score = board.length === 5 ? scoreOmahaHi(hole, board) : scoreOmahaHiPartial(hole, board);
  const cat = Math.floor(score / 0x100000);
  const nuts = omahaNutStatus(hole, board);
  const paired = boardIsPaired(board);

  if (input.street === 'river') {
    if (cat === 3) return 'plo6_river_two_pair';
    if (cat === 4 && (paired || nuts.flushPossible)) return 'plo6_river_vulnerable_trips';
    if (cat === 5 && (!nuts.straightIsNut || nuts.flushPossible || paired)) {
      return 'plo6_river_vulnerable_straight';
    }
    if (cat === 6 && (paired || nuts.higherFlushRanks >= 1)) {
      return 'plo6_river_non_nut_or_paired_flush';
    }
    if (cat === 7) {
      const bp = omahaBoatPosition(hole, board);
      if (bp !== null && bp.boats >= 3 && bp.lowerBoats === 0) {
        return 'plo6_river_dead_bottom_boat';
      }
    }
    return null;
  }

  // Turn: keep hands carrying a nutty redraw; fold bare dominated classes
  // facing a pot-sized multiway turn bet in 6-card PLO6.
  const draw = omahaDrawQuality(hole, board, false);
  if (draw.nutty || draw.nutFlushDraw || draw.nutStraightOuts >= 6) return null;
  if (cat === 3) return 'plo6_turn_two_pair_no_nut_draw';
  if (cat === 5 && (paired || nuts.flushPossible || !nuts.straightIsNut)) {
    return 'plo6_turn_vulnerable_straight_no_nut_draw';
  }
  if (cat === 6 && (paired || nuts.higherFlushRanks >= 1)) {
    return 'plo6_turn_non_nut_or_paired_flush';
  }
  return null;
}

/**
 * Pillar 3B: Raise shade for non-HiLo Omaha when hero bet (or raised) this
 * street and faces a raise with a vulnerable non-nut made hand and no nutty
 * redraw. Mirrors V66/V67's linear scaling with raise-to-pot size.
 */
export function v87OmahaBetRaisedShade(toCall: number, pot: number, isRiver: boolean): number {
  if (!(toCall > 0) || !(pot > 0)) return 0;
  const ratio = toCall / pot;
  const cap = isRiver ? 0.14 : 0.11;
  if (ratio <= 0.2) return cap * 0.35;
  const t = Math.min(1, (ratio - 0.2) / 0.65);
  return cap * (0.35 + 0.65 * t);
}

/**
 * Pillar 4A: Minimum preflop hand-strength floor required before V13's
 * `pricedIn` pot-odds guard can turn a `fold` into a `call` against a raise
 * (when the call is NOT an all-in). Cash NLH is intentionally exempt (returns 0).
 */
export function v87PricedInMinStrength(opts: {
  isTourney: boolean;
  isOmaha: boolean;
  isHiLo: boolean;
  omahaHoleCount: number | undefined;
  callers: number;
  guardOdds?: number;
  evidencedManiacRaiser?: boolean;
}): number {
  if (opts.evidencedManiacRaiser) return 0;
  // At extreme pot odds (guardOdds <= 0.065, roughly 14.4:1 or better such as a
  // 22:1 min-click), V13's pricedIn guard deliberately calls with any holding.
  if (opts.guardOdds !== undefined && opts.guardOdds <= 0.065) return 0;
  if (opts.isOmaha) {
    if (opts.isHiLo) return 0;
    const hc = opts.omahaHoleCount === 6 ? 6 : opts.omahaHoleCount === 5 ? 5 : 4;
    const base = hc === 6 ? 0.34 : hc === 5 ? 0.31 : 0.28;
    return base + Math.min(2, Math.max(0, opts.callers)) * 0.03;
  }
  if (opts.isTourney) {
    return opts.callers >= 1 ? 0.26 : 0.2;
  }
  return 0;
}

/**
 * Pillar 4B: Additional turn call shade in single-board Hold'em when facing a
 * cold raise (`pressure20 >= 2`) or a multiway >= 0.75-pot barrel (`oppCount >= 2`)
 * with bare one pair / board-paired two pair and no hole-card draw.
 */
export function v87NlhTurnMultiwayOrColdRaiseShade(
  pressure20: number,
  oppCount: number,
  potFrac: number
): number {
  if (pressure20 >= 2) return 0.07;
  if (oppCount >= 2 && potFrac >= 0.75) return 0.05;
  return 0;
}
