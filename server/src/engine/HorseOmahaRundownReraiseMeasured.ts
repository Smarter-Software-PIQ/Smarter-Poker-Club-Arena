/**
 * omahaRundownReraiseRangeIsMeasured and omahaRundownReraiseRangeTrial (each default OFF; EMERG lane
 * RUNDOWNS, 2026-11-20; owner 1:50 AM Chicago: "add in the rundown 3-bet / 4-bet ranges as well").
 * PLO4/PLO5 cash, high only, one board, no bomb pot, preflop: the rundown re-raise range, cell by
 * cell, as the measurement left it. One module, the cells are data.
 *
 * MEASURED, NOT ASSUMED. Rundowns were classified by structure from the Horse's own cards alone
 * (connectedness and where the gap is, height, suits, pairs inside, the fifth card in PLO5, nut
 * potential), the classes declared before any result was read (archive
 * repairs/EMERG/CRITERIA-RUNDOWNS.md, sha256 eeb36ba851aafdf10c07edbe7460bfe4609abfa965a1139ed7c04e0df192c741;
 * classifier d0a3ffca83d933d807cb0ddfb49ad5d49eb8371fdbf000836780901c8f949710). Every Horse preflop
 * decision facing a raise in PLO4/PLO5 cash hands with a person, 2026-10-15 to 2026-11-19 (43,400
 * decisions with cards in a re-raise spot, 11,620 of them rundowns), the re-raise against the call
 * inside the same spot (strata: stack band, game, table or Lightning), fit = to 11-14, held out =
 * 11-15 to 11-19, in REAL CHIPS (lead 1:42 AM: the chips of the hand result that went to or came
 * from persons plus 1.9% of the deductions, all-in adjusted where the sign holds; rake and chips
 * between Horses are internal). 290 class-by-spot cells were graded.
 *
 * WHAT THE MATH SAID.
 * 1. No cell where a rundown re-raise beats the call passes beyond what chance gives (1 of 290
 *    cells passed, where about 7 pass on noise; its carved remainder has 7 re-raises). In position
 *    the re-raise is level with the call: 3-bet facing an open +2.82 +/- 3.41 bb, squeeze
 *    +6.57 +/- 5.82, 4-bet -3.75 +/- 13.96 (pooled). So the MEASURED set has no call that becomes a
 *    re-raise.
 * 2. Out of position the rundown re-raise LOSES real chips: the squeeze from a blind (an open and
 *    one caller or more) -10.74 +/- 5.05 fit and -18.51 +/- 10.36 held out (210 re-raises, 1,550
 *    calls); all of it at an own stack above 250 bb with a high rundown (top card ten or higher):
 *    -27.35 +/- 11.40 fit (50 re-raises, 218 calls) and -34.99 +/- 16.58 held out (42, 176); net
 *    -19.08 +/- 12.06 and -22.55 +/- 17.99. At 100 to 250 bb the same squeeze is level
 *    (+2.03 +/- 5.42, +0.35 +/- 9.38) and is not touched. Kings, queens or jacks with broadway and
 *    double-suited hands that are not rundowns do not lose there, so the cell is the rundown's.
 *    That cell is the MEASURED set: the re-raise becomes the call.
 * 3. Where the Horses' own record is too thin, two public-information estimates were declared: (a)
 *    persons' own results with the same classes in hands shown at showdown, (b) equity, position
 *    and initiative pricing (PREFLOP-EV realization). (b) did not validate against the cells that
 *    have data (sign agreement 14 of 26), so it carries nothing alone. The cells that are not
 *    failing on the Horses' record, with persons' shown re-raises ahead of their calls and above
 *    zero by more than one standard error (ten shown re-raises or more) and (b) positive, less every
 *    finer cell that fails, are the TRIAL set (omahaRundownReraiseRangeTrial): a watched live trial
 *    to GET the data, never a proven gain.
 * 4. DEPTH decides in position. Pooled over the three in-position spots (a pooling made after the
 *    grade, so it is trial and not measured), a tier A or B rundown (double suited, or single
 *    suited with no gap or one gap and a top card ten or higher; never a low one) with an own stack
 *    of 250 bb or less: re-raise minus call +7.83 +/- 5.26 bb fit (127 re-raises, 468 calls) and
 *    +8.51 +/- 7.88 held out (90, 190). By spot: the squeeze +23.60 +/- 14.48 and +18.05 +/- 11.31,
 *    the 4-bet as the opener +20.68 +/- 16.10 and +50.51 +/- 30.75, the 3-bet facing an open level
 *    (-0.14 +/- 5.23, -1.87 +/- 8.29). Above 250 bb in position the re-raise is level to negative
 *    (+8.55 +/- 7.85, -8.92 +/- 7.54) and is not in any cell but the two of point 3.
 *
 * PUBLIC INFORMATION ONLY: the Horse's own cards, the public action history, the chips, the seats.
 * The same rule against every opponent, a person or a Horse (the real-chip accounting grades, no
 * rule reads it). Pure: no opponent memory, no draw from the brain's random stream. PLO6, PLO8,
 * hold'em and tournaments are never in scope: byte-identical with either option on. A decision that
 * omahaPreflopJamFacingReraiseIsPriced priced (its receipt is on the decision) stands.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { RANK_VALUES } from './PokerEngine.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';

export const OMAHA_RUNDOWN_RERAISE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

export type OmahaRundownConnection =
  | 'nogap'
  | 'gap1_top'
  | 'gap1_mid'
  | 'gap1_bot'
  | 'gap2'
  | 'paired';

/** The structure of a rundown, from the Horse's own cards only (the declared classifier). */
export interface OmahaRundownStructure {
  /** four distinct ranks with no gap, one gap (by where it is) or two; or three ranks and a pair */
  connection: OmahaRundownConnection;
  /** B = every core card ten or higher; H = top card ten or higher; M = top 7 to 9; L = lower */
  height: 'B' | 'H' | 'M' | 'L';
  /** suits of the whole hand: two suits with two cards or more, one, none */
  suits: 'ds' | 'ss' | 'rb';
  /** the highest card is in a suit of two or more */
  topSuited: boolean;
  aceSuited: boolean;
  /** a pair anywhere in the hand (never aces: a pair of aces is not a rundown) */
  pair: boolean;
  kings: boolean;
  /** PLO5: the card outside the core. conn5 = five distinct ranks spanning at most six */
  fifth: 'none' | 'conn5' | 'pair5' | 'dangler';
  /** suited ace (nut flush) + four distinct ranks, one gap at most, top card ten or higher (nut wraps) */
  nutPotential: 0 | 1 | 2;
  /** no gap or one gap */
  tight: boolean;
  /** height B or H */
  high: boolean;
  /**
   * The declared composite: A = double suited, no gap or one gap, high. B = single suited with no
   * gap or one gap and high; or double suited, two gaps or paired, high; or double suited, no gap or
   * one gap, top card 7 to 9. C = every other rundown.
   */
  tier: 'A' | 'B' | 'C';
}

interface Core {
  gap: number;
  four: boolean;
  gaps: number[];
  ranks: number[];
}

function coreOf(ranks: readonly number[]): Core | null {
  const u = [...new Set(ranks)].sort((a, b) => b - a);
  const gaps: number[] = [];
  for (let i = 0; i + 1 < u.length; i++) gaps.push(u[i]! - u[i + 1]! - 1);
  const gap = gaps.reduce((a, b) => a + b, 0);
  if (u.length === 4 && gap <= 2) return { gap, four: true, gaps, ranks: u };
  if (u.length === 3 && gap <= 1) return { gap, four: false, gaps, ranks: u };
  return null;
}

/**
 * The rundown structure of four or five hole cards, or null when the hand is not a rundown. The ace
 * is high only. PLO5: the core is the best four of the five (least total gap, then four distinct
 * ranks before a paired core, then the highest).
 */
export function omahaRundownStructure(hole: readonly Card[]): OmahaRundownStructure | null {
  const n = hole.length;
  if (n !== 4 && n !== 5) return null;
  const ranks = hole.map((c) => RANK_VALUES[c.rank]);
  if (ranks.some((r) => !Number.isFinite(r))) return null;
  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  if ((count.get(14) ?? 0) >= 2) return null;
  for (const k of count.values()) if (k >= 3) return null;
  let best: { key: number[]; out: number; core: Core } | null = null;
  const leaveOut = n === 4 ? [-1] : [0, 1, 2, 3, 4];
  for (const out of leaveOut) {
    const core = coreOf(ranks.filter((_, j) => j !== out));
    if (!core) continue;
    const key = [
      core.gap,
      core.four ? 0 : 1,
      -core.ranks[0]!,
      -core.ranks.reduce((a, b) => a + b, 0),
    ];
    let better = best === null;
    if (best !== null)
      for (let i = 0; i < key.length; i++) {
        if (key[i]! < best.key[i]!) better = true;
        if (key[i] !== best.key[i]) break;
      }
    if (better) best = { key, out, core };
  }
  if (best === null) return null;
  const { core, out } = best;
  const connection: OmahaRundownConnection = !core.four
    ? 'paired'
    : core.gap === 0
      ? 'nogap'
      : core.gap === 1
        ? core.gaps[0] === 1
          ? 'gap1_top'
          : core.gaps[1] === 1
            ? 'gap1_mid'
            : 'gap1_bot'
        : 'gap2';
  const top = core.ranks[0]!;
  const bottom = core.ranks[core.ranks.length - 1]!;
  const height = bottom >= 10 ? 'B' : top >= 10 ? 'H' : top >= 7 ? 'M' : 'L';
  const suitCount = new Map<string, number>();
  for (const c of hole) suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
  const suited = [...suitCount.values()].filter((k) => k >= 2).length;
  const suits = suited >= 2 ? 'ds' : suited === 1 ? 'ss' : 'rb';
  const highest = Math.max(...ranks);
  const inSuit = (rank: number) =>
    hole.some((c) => RANK_VALUES[c.rank] === rank && (suitCount.get(c.suit) ?? 0) >= 2);
  const aceSuited = inSuit(14);
  let fifth: OmahaRundownStructure['fifth'] = 'none';
  if (n === 5) {
    const f = ranks[out]!;
    const five = [...new Set([...core.ranks, f])].sort((a, b) => b - a);
    if (core.ranks.includes(f)) fifth = 'pair5';
    else if (five.length === 5 && five[0]! - five[4]! <= 6) fifth = 'conn5';
    else fifth = 'dangler';
  }
  const nutWrap = core.four && core.gap <= 1 && top >= 10;
  const tight = connection !== 'gap2' && connection !== 'paired';
  const high = height === 'B' || height === 'H';
  const tier =
    suits === 'ds' && tight && high
      ? 'A'
      : (suits === 'ss' && tight && high) ||
          (suits === 'ds' && !tight && high) ||
          (suits === 'ds' && tight && height === 'M')
        ? 'B'
        : 'C';
  return {
    connection,
    height,
    suits,
    topSuited: inSuit(highest),
    aceSuited,
    pair: [...count.values()].some((k) => k === 2),
    kings: count.get(13) === 2,
    fifth,
    nutPotential: ((aceSuited ? 1 : 0) + (nutWrap ? 1 : 0)) as 0 | 1 | 2,
    tight,
    high,
    tier,
  };
}

export type OmahaRundownSpotKind =
  /** one raise, nobody has called it, the Horse has not acted and acts after the raiser later */
  | 'threeBetInPosition'
  | 'threeBetOutOfPosition'
  /** one raise and one caller of it or more, the Horse has not acted */
  | 'squeezeInPosition'
  | 'squeezeOutOfPosition'
  /** two raises, the first of them the Horse's own open */
  | 'fourBetInPosition'
  | 'fourBetOutOfPosition'
  /** two raises, the Horse has not acted */
  | 'coldFourBet';

export interface OmahaRundownGrade {
  /** re-raise minus call, real chips, big blinds a decision, and its standard error */
  fitBB: number;
  fitSeBB: number;
  heldOutBB: number;
  heldOutSeBB: number;
}

export interface OmahaRundownCell {
  id: string;
  /** measured = decided by the Horses' own record on fit and held-out data; trial = a watched trial */
  set: 'measured' | 'trial';
  /** what the cell makes of the other action: the call becomes the re-raise, or the re-raise the call */
  becomes: 'reraise' | 'call';
  spots: readonly OmahaRundownSpotKind[];
  /** own stack (chips in front included) strictly above this many big blinds, when given */
  stackAboveBB?: number;
  /** own stack (chips in front included) at or under this many big blinds, when given */
  stackAtMostBB?: number;
  /** the hand structure the cell covers */
  covers: (s: OmahaRundownStructure, holeCount: number) => boolean;
  /** the Horses' own record in the cell (real chips), the re-raise minus the call */
  horse: OmahaRundownGrade & { reraises: number; calls: number };
  /** persons' shown hands in the declared cell: the re-raise's own value and the count */
  personsShown?: { reraises: number; reraiseBB: number; reraiseSeBB: number };
}

/**
 * THE CELLS (data). Archive repairs/EMERG/RUNDOWNS.md; scripts emerg/rundowns/work/g1.py to g4.py.
 */
export const OMAHA_RUNDOWN_RERAISE_CELLS: readonly OmahaRundownCell[] = Object.freeze([
  {
    // MEASURED (out of the range): the squeeze from a blind, out of position, with a high rundown
    // and more than 250 bb. The call earned more real chips than the re-raise in both periods.
    id: 'squeeze_out_of_position_high_rundown_above_250bb',
    set: 'measured',
    becomes: 'call',
    spots: ['squeezeOutOfPosition'],
    stackAboveBB: 250,
    covers: (s) => s.high,
    horse: {
      fitBB: -27.35,
      fitSeBB: 11.4,
      heldOutBB: -34.99,
      heldOutSeBB: 16.58,
      reraises: 92,
      calls: 394,
    },
  },
  {
    // TRIAL: the 3-bet in position facing an open nobody has called, a rundown with no gap, double
    // suited, no pair, not low, and in PLO5 the fifth card connected. The declared cell (no gap):
    // Horses +4.54 +/- 18.48 fit and +15.28 +/- 11.76 held out (73 re-raises, 229 calls); persons'
    // shown re-raises +36.9 +/- 36.8 (17). The carved remainder itself: 18 re-raises, 46 calls.
    id: 'three_bet_in_position_no_gap_double_suited',
    set: 'trial',
    becomes: 'reraise',
    spots: ['threeBetInPosition'],
    covers: (s) =>
      s.connection === 'nogap' &&
      s.height !== 'L' &&
      s.suits === 'ds' &&
      !s.pair &&
      (s.fifth === 'none' || s.fifth === 'conn5'),
    horse: {
      fitBB: 4.54,
      fitSeBB: 18.48,
      heldOutBB: 15.28,
      heldOutSeBB: 11.76,
      reraises: 73,
      calls: 229,
    },
    personsShown: { reraises: 17, reraiseBB: 36.9, reraiseSeBB: 36.8 },
  },
  {
    // TRIAL: the 4-bet in position as the opener facing a 3-bet, PLO5, five connected cards (the
    // fifth card inside the run), no gap or one gap, no pair, with a suited ace or a high run. The
    // declared cell (every rundown in the spot): Horses +4.95 +/- 15.61 fit and -16.37 +/- 25.64
    // held out (109 re-raises, 385 calls), persons' shown re-raises +35.9 +/- 24.9 (36); less the
    // finer cells that fail (PLO4, a pair, two gaps, a dangler, no nut potential) this remainder is
    // left: Horses +59.98 +/- 25.78 fit and +94.62 +/- 84.54 held out on 11 re-raises and 35 calls.
    id: 'four_bet_in_position_five_connected',
    set: 'trial',
    becomes: 'reraise',
    spots: ['fourBetInPosition'],
    covers: (s, holeCount) =>
      holeCount === 5 && s.fifth === 'conn5' && s.tight && !s.pair && s.nutPotential >= 1,
    horse: {
      fitBB: 59.98,
      fitSeBB: 25.78,
      heldOutBB: 94.62,
      heldOutSeBB: 84.54,
      reraises: 11,
      calls: 35,
    },
    personsShown: { reraises: 36, reraiseBB: 35.9, reraiseSeBB: 24.9 },
  },
  {
    // TRIAL (depth, pooled after the grade): the squeeze in position and the 4-bet in position as
    // the opener with a tier A or B rundown and an own stack of 250 bb or less. Horses, real chips:
    // the squeeze +23.60 +/- 14.48 fit (20 re-raises, 80 calls) and +18.05 +/- 11.31 held out (13,
    // 24); the 4-bet +20.68 +/- 16.10 (29, 105) and +50.51 +/- 30.75 (11, 44). The figures here are
    // the two spots together with the 3-bet below (the pooled cell that was graded).
    id: 'squeeze_or_four_bet_in_position_tier_a_b_at_most_250bb',
    set: 'trial',
    becomes: 'reraise',
    spots: ['squeezeInPosition', 'fourBetInPosition'],
    stackAtMostBB: 250,
    covers: (s) => s.tier === 'A' || s.tier === 'B',
    horse: {
      fitBB: 7.83,
      fitSeBB: 5.26,
      heldOutBB: 8.51,
      heldOutSeBB: 7.88,
      reraises: 217,
      calls: 658,
    },
  },
  {
    // TRIAL (depth, the level part): the 3-bet in position facing an open nobody has called with a
    // tier A or B rundown and an own stack of 250 bb or less. Horses, real chips: -0.14 +/- 5.23 fit
    // (78 re-raises, 283 calls) and -1.87 +/- 8.29 held out (66, 122): LEVEL with the call, not a
    // gain. In the trial for the data and because it is where the 3-bet range is face-up (aces 28%
    // of table 3-bets); the lead reads this figure before switching.
    id: 'three_bet_in_position_tier_a_b_at_most_250bb',
    set: 'trial',
    becomes: 'reraise',
    spots: ['threeBetInPosition'],
    stackAtMostBB: 250,
    covers: (s) => s.tier === 'A' || s.tier === 'B',
    horse: {
      fitBB: -0.14,
      fitSeBB: 5.23,
      heldOutBB: -1.87,
      heldOutSeBB: 8.29,
      reraises: 144,
      calls: 405,
    },
  },
]);

/**
 * A measured cell is in the rule only when the two periods agree beyond one standard error each:
 * both above zero for a cell that re-raises, both below zero for a cell that calls.
 */
export function omahaRundownMeasuredPasses(cell: OmahaRundownCell): boolean {
  const g = cell.horse;
  return cell.becomes === 'reraise'
    ? g.fitBB - g.fitSeBB > 0 && g.heldOutBB - g.heldOutSeBB > 0
    : g.fitBB + g.fitSeBB < 0 && g.heldOutBB + g.heldOutSeBB < 0;
}

export interface OmahaRundownSpot {
  variant: string;
  kind: OmahaRundownSpotKind;
  structure: OmahaRundownStructure;
  holeCount: number;
  /** the Horse's stack plus its chips in front, in big blinds */
  stackBB: number;
  toCall: number;
  stack: number;
  /** the pot-size raise capped by the stack, or null when no raise is legal */
  raiseTo: number | null;
  allIn: number;
}

/** Order to act on a postflop street: the small blind first, the dealer last. */
function order(seat: number, dealerSeat: number | undefined): number {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
}

/** The spot the cells read, or null out of scope. Reads only the request. */
export function omahaRundownReraiseSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRundownSpot | null {
  try {
    if (String(gs.stage ?? '') !== 'preflop') return null;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_RUNDOWN_RERAISE_VARIANTS.has(variant)) return null;
    const hole = player.cards ?? [];
    if (hole.length !== (variant === 'plo4' ? 4 : 5)) return null;
    if (omahaIsTournamentMode(gs)) return null;
    if (gs.bombPot === true || gs.allInOrFold === true) return null;
    if ((gs.boardCount ?? 1) > 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.variantRules?.splitLow8OrBetter === true) return null;
    const bb = Number(gs.bigBlind);
    if (!(bb > 0)) return null;
    const structure = omahaRundownStructure(hole);
    if (structure === null) return null;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - heroBet);
    if (toCall <= 0.005 || stack <= toCall + 0.005) return null;
    // The public action history: the raises, who made the last one, who has called it, and what
    // the Horse has done voluntarily. A raise is counted as the re-raised-pot rules count it.
    let raises = 0;
    let raiserSeat = -1;
    let heroOpened = false;
    let heroActed = false;
    const callers = new Set<number>();
    for (const a of gs.actionHistory ?? []) {
      if (a.stage !== 'preflop') continue;
      const isRaise =
        a.action === 'raise' ||
        a.action === 'bet' ||
        (a.action === 'all_in' && (a as { isFullRaise?: unknown }).isFullRaise !== undefined);
      if (isRaise) {
        raises++;
        callers.clear();
        if (a.seat === player.seat) {
          heroActed = true;
          heroOpened = raises === 1;
        } else raiserSeat = a.seat;
        if (a.seat === player.seat) raiserSeat = -1;
      } else if (a.action === 'call' || a.action === 'all_in') {
        if (a.seat === player.seat) heroActed = true;
        else if (raises >= 1) callers.add(a.seat);
      } else if (a.action === 'check' && a.seat === player.seat) heroActed = true;
    }
    if (raiserSeat < 0 || (raises !== 1 && raises !== 2)) return null;
    const dealt = (gs.players ?? []).filter((p) => !p.is_sitting_out || p.is_all_in);
    // Heads-up the dealer posts the small blind and acts last after the flop: not in the record's cells.
    if (dealt.length < 3) return null;
    const live = dealt.filter((p) => p.seat !== player.seat && !p.is_folded);
    // Somebody must be able to answer a raise.
    if (!live.some((p) => !p.is_all_in && Number.isFinite(p.stack) && p.stack > 0.005)) return null;
    const liveCallers = live.filter((p) => callers.has(p.seat)).length;
    const inPosition = order(player.seat, gs.dealerSeat) > order(raiserSeat, gs.dealerSeat);
    let kind: OmahaRundownSpotKind;
    if (raises === 1) {
      if (heroActed) return null;
      kind =
        liveCallers > 0
          ? inPosition
            ? 'squeezeInPosition'
            : 'squeezeOutOfPosition'
          : inPosition
            ? 'threeBetInPosition'
            : 'threeBetOutOfPosition';
    } else if (heroOpened) kind = inPosition ? 'fourBetInPosition' : 'fourBetOutOfPosition';
    else if (!heroActed) kind = 'coldFourBet';
    else return null;
    const allIn = heroBet + stack;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    let raiseTo: number | null = null;
    if (
      (!legal || legal.includes('raise')) &&
      Number.isFinite(gs.maxRaiseTo) &&
      Number.isFinite(gs.minRaiseTo) &&
      (gs.maxRaiseTo as number) >= (gs.minRaiseTo as number)
    ) {
      const to = Math.min(allIn, gs.maxRaiseTo as number);
      if (to > heroBet + toCall + 0.005) raiseTo = to;
    }
    return {
      variant,
      kind,
      structure,
      holeCount: hole.length,
      stackBB: allIn / bb,
      toCall,
      stack,
      raiseTo,
      allIn,
    };
  } catch {
    return null;
  }
}

/** The cell of one set that covers the spot, or null. */
export function omahaRundownReraiseCell(
  spot: OmahaRundownSpot,
  set: 'measured' | 'trial'
): OmahaRundownCell | null {
  for (const cell of OMAHA_RUNDOWN_RERAISE_CELLS) {
    if (cell.set !== set || !cell.spots.includes(spot.kind)) continue;
    if (cell.stackAboveBB !== undefined && !(spot.stackBB > cell.stackAboveBB)) continue;
    if (cell.stackAtMostBB !== undefined && !(spot.stackBB <= cell.stackAtMostBB)) continue;
    if (set === 'measured' && !omahaRundownMeasuredPasses(cell)) continue;
    if (cell.covers(spot.structure, spot.holeCount)) return cell;
  }
  return null;
}

/** The chips of the call the measured set leaves (the whole-stack call is never made by it). */
function callAmount(spot: OmahaRundownSpot): number {
  return Math.round(Math.min(spot.toCall, spot.stack) * 100) / 100;
}

function rule<D extends { action: string; amount?: number | null }>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  set: 'measured' | 'trial',
  entered?: string
): D {
  if (!on) return decision;
  const a = decision.action;
  if (a !== 'call' && a !== 'raise' && a !== 'all_in') return decision;
  try {
    // one owner per cell: a decision the three-way pricing judged is that option's verdict
    if ((decision as { omahaPreflopThreeWay?: unknown }).omahaPreflopThreeWay != null)
      return decision;
    const spot = omahaRundownReraiseSpot(player, gs);
    if (!spot) return decision;
    const cell = omahaRundownReraiseCell(spot, set);
    if (!cell) return decision;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    if (cell.becomes === 'reraise') {
      if (a !== 'call' || spot.raiseTo === null) return decision;
      const out = { ...decision } as D;
      if (spot.raiseTo >= spot.allIn - 0.005 && (!legal || legal.includes('all_in'))) {
        out.action = 'all_in';
        delete out.amount;
      } else {
        out.action = 'raise';
        out.amount = Math.round(spot.raiseTo * 100) / 100;
      }
      return out;
    }
    if (a === 'call') return decision;
    // The node records one transition, from the action it entered with: the call is made only of a
    // re-raise the node entered with (raise -> call is what the response validator admits).
    if (entered !== undefined && entered !== 'raise' && entered !== 'all_in') return decision;
    if (legal && !legal.includes('call')) return decision;
    return { ...decision, action: 'call', amount: callAmount(spot) };
  } catch {
    return decision;
  }
}

/**
 * omahaRundownReraiseRangeIsMeasured: with the option on, a final re-raise in a measured cell where
 * the call earned more real chips on fit and held-out data becomes the call (today: the squeeze from
 * a blind with a high rundown above 250 bb), and a final call in a measured cell where the re-raise
 * earned more becomes the pot-size re-raise (today: no such cell passes). `entered` is the action
 * the wager_rules node entered with: the call is made only of a re-raise the node entered with.
 * Everything else is returned untouched (the same object).
 */
export function omahaRundownReraiseMeasuredRule<
  D extends { action: string; amount?: number | null },
>(decision: D, player: SeatPlayer, gs: HorseGameStateV2, on: boolean, entered?: string): D {
  return rule(decision, player, gs, on, 'measured', entered);
}

/**
 * omahaRundownReraiseRangeTrial: with the option on, a final call in a trial cell becomes the
 * pot-size re-raise (the all-in when the pot raise is the whole stack). Everything else is returned
 * untouched (the same object).
 */
export function omahaRundownReraiseTrialRule<D extends { action: string; amount?: number | null }>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean
): D {
  return rule(decision, player, gs, on, 'trial');
}

/**
 * The response validator's question: on this request, is a re-raise that became a call of exactly
 * these chips the measured set's own conversion? A pure function of the request.
 */
export function omahaRundownMeasuredAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const spot = omahaRundownReraiseSpot(player, gs);
    if (!spot) return false;
    const cell = omahaRundownReraiseCell(spot, 'measured');
    if (!cell || cell.becomes !== 'call') return false;
    return amount === callAmount(spot);
  } catch {
    return false;
  }
}
