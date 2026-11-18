/**
 * ═══ THE BASELINE FLOP AND TURN BLUFF RANGE (2026-11-07) ═══
 *
 * Players report the horses "rarely bluff". The river was audited and fixed
 * in HorseRiverBluffRange.ts (#9803); the owner instruction behind it applies
 * to every street (Dan, 2026-11-06): "CHECK THAT THERE IS NOTHING THAT IS
 * EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' ... BLUFFS FOR QUALIFIED
 * CANDITATES OR SITUATIONS."
 *
 * Measured before this layer (production, 2026-11-07, see
 * docs/changelog/2026-11-07-horse-flop-turn-bluff-range.md): the aggregate
 * c-bet, barrel and probe rates looked normal, because MADE hands carried
 * them. With the hole cards shown, Hold'em draws checked to a horse on the
 * turn bet 20% of the time and a flop draw facing a bet raised 6%; PLO4 turn
 * bets were 95% made hands, a draw checked to a horse on the PLO4 turn bet 11%
 * of the time, and a PLO4 wrap (13 outs) on a blank turn after a called c-bet
 * bet ZERO times in 200 replayed decisions. The gates that did it:
 *
 *  - the V38 EV engine (the whole of Omaha below the value bars) prices a
 *    bluff with an opponent who folds exactly MDF, which makes every bluff
 *    worth zero, and assumes the folded hands are ones hero beat 85% of the
 *    time, which makes a draw's continuing equity collapse: draws check;
 *  - the V29/V30 solver cells are CLASS MEANS over every board in a texture
 *    class: they cannot see this board's flush draw or wrap;
 *  - the V7 "one-and-done give up" checked a turn draw 80% (cash) of the time
 *    whenever the flop bet had not recorded a multi-street plan, and a
 *    solver-cell c-bet in cash never records one;
 *  - the semi-bluff raise rolled bluffFreq x aggression x 0.5, about 8%, with
 *    any draw, and the semi-bluff bet bluffFreq x aggression x 1.4 heads-up.
 *
 * This module owns the spots poker says are bluffs and semi-bluffs, and
 * answers them from poker rather than from a read:
 *
 *  NOT FACING A BET (flop or turn), hero holding no showdown value (no pair
 *  of its own, or a weak pair that also draws), on a line that tells a story:
 *    cbet     hero raised preflop; the flop is hero's to bet (OOP or checked to)
 *    barrel   hero bet the flop and was called; the turn is hero's
 *    delayed  hero raised preflop; the flop checked through
 *    probe    the raiser checked the flop back; hero leads the turn
 *    stab     the aggressor checked to hero in position (a float, or the
 *             raiser gave up on the turn)
 *  Leading out of position into the aggressor on a street they have not
 *  checked is not a story: that stays with the V11 initiative gate.
 *
 *  FACING A BET (flop or turn): the semi-bluff raise and the check-raise with
 *  a real draw.
 *
 * Who bluffs (selection), strongest first:
 *  - strongDraw: a flush draw, an open-ender or double gutter, a combo draw;
 *    Omaha a nut flush draw, an 8+ out wrap, or a flush draw with a straight
 *    draw beside it;
 *  - pairDraw: a weak pair (below top pair) with a strong draw;
 *  - weakDraw: a gutshot; Omaha a non-nut flush draw or 6-7 straight outs;
 *  - backdoor (flop only): a backdoor flush or straight with an overcard;
 *  - overcards: two cards over the board (Hold'em);
 *  - blocker: the top unseen card of a two-or-more-flush board's suit.
 *  On a board with three of a suit, only a draw or that blocker qualifies.
 *  Junk with none of these is NOT a qualified candidate: the layers below keep
 *  it (the range c-bet on a board the raiser owns, the give-up otherwise).
 *
 * How often: per-combo frequencies for a heads-up single-raised pot against an
 * unknown opponent, set to what solved heads-up pots do with each class (a
 * flop flush draw c-bets about three times in four, a blank-turn barrel with
 * a draw about two in three, overcards about a third), then reshaped:
 *  - out of position x0.85 (c-bet) / x0.9 (barrel);
 *  - multiway: draws only, x0.55 three-handed, strong draws only x0.3
 *    four-handed, never five or more;
 *  - Omaha: no overcards class, weak draws and blockers x0.75; a paired board
 *    x0.5 (every raise is a boat);
 *  - ranges: a runout that favours the opponent x0.7 (x0.9 for draws), a
 *    range advantage on a c-bet x1.15 for non-draws; a turn that completes a
 *    flush or straight hero does not block or draw to x0.6 for non-draws;
 *  - reads reshape, never switch off: a credible station x0.55 for draws and
 *    x0.25 for the rest, fold-to-c-bet and the exploit fold read inside
 *    [0.6, 1.4];
 *  - tournaments: the survival premium scales it (draws never below a half,
 *    the rest never below 0.3); a locked satellite seat is out of scope;
 *  - shallow (under 1.2 pots behind): non-draws x0.5 and the bet is the shove.
 *
 * No read means the baseline - never zero. `opts.flopTurnBluffBaseline`
 * (default on) ablates it.
 */
import type { ActionRecord, Card } from '../types.js';
import { RANK_VALUES } from './PokerEngine.js';
import type { OmahaDrawInfo } from './HorseEval.js';

export type FlopTurnBluffLine = 'cbet' | 'barrel' | 'delayed' | 'probe' | 'stab' | 'none';
export type FlopTurnBluffSelection =
  | 'strongDraw'
  | 'pairDraw'
  | 'weakDraw'
  | 'backdoor'
  | 'overcards'
  | 'blocker'
  | 'junk';

/** Hands with at least this much equity are bet by the value ladder. */
export const FT_BLUFF_VALUE_EQUITY = 0.52;
/** The most often any one combo bets, whatever the multipliers say. */
export const FT_BLUFF_MAX_PROBABILITY = 0.88;
/** The most often any one combo semi-bluff raises. */
export const FT_RAISE_MAX_PROBABILITY = 0.6;

/** Heads-up, in position, cash, unknown opponent: bet frequency per combo. */
export const FT_BLUFF_BASE: Record<
  Exclude<FlopTurnBluffLine, 'none'>,
  Record<Exclude<FlopTurnBluffSelection, 'junk'>, number>
> = {
  cbet: {
    strongDraw: 0.78,
    pairDraw: 0.7,
    weakDraw: 0.6,
    backdoor: 0.5,
    overcards: 0.45,
    blocker: 0.45,
  },
  barrel: {
    strongDraw: 0.72,
    pairDraw: 0.64,
    weakDraw: 0.45,
    backdoor: 0,
    overcards: 0.3,
    blocker: 0.35,
  },
  delayed: {
    strongDraw: 0.7,
    pairDraw: 0.6,
    weakDraw: 0.45,
    backdoor: 0,
    overcards: 0.32,
    blocker: 0.35,
  },
  probe: {
    strongDraw: 0.68,
    pairDraw: 0.58,
    weakDraw: 0.45,
    backdoor: 0,
    overcards: 0.28,
    blocker: 0.3,
  },
  stab: {
    strongDraw: 0.68,
    pairDraw: 0.6,
    weakDraw: 0.5,
    backdoor: 0.42,
    overcards: 0.4,
    blocker: 0.38,
  },
};

/** Facing a bet: semi-bluff raise frequency per combo (heads-up, cash). */
export const FT_RAISE_BASE = {
  flop: {
    oop: { strongDraw: 0.36, pairDraw: 0.3, weakDraw: 0.12 },
    ip: { strongDraw: 0.24, pairDraw: 0.2, weakDraw: 0.06 },
  },
  turn: {
    oop: { strongDraw: 0.24, pairDraw: 0.2, weakDraw: 0 },
    ip: { strongDraw: 0.18, pairDraw: 0.15, weakDraw: 0 },
  },
} as const;

export const FT_STATION_DRAW_FACTOR = 0.55;
export const FT_STATION_AIR_FACTOR = 0.25;

const isDraw = (s: FlopTurnBluffSelection): boolean =>
  s === 'strongDraw' || s === 'pairDraw' || s === 'weakDraw';

const rank = (c: Card): number => RANK_VALUES[c.rank] ?? 0;
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function withAceLow(ranks: Iterable<number>): Set<number> {
  const s = new Set<number>();
  for (const r of ranks) {
    s.add(r);
    if (r === 14) s.add(1);
  }
  return s;
}

function hasStraight(ranks: Set<number>): boolean {
  for (let lo = 1; lo <= 10; lo++) {
    let ok = true;
    for (let r = lo; r < lo + 5 && ok; r++) ok = ranks.has(r);
    if (ok) return true;
  }
  return false;
}

/** The highest rank of `suit` that is not on the board. */
function topUnseen(suit: string, board: readonly Card[]): string | null {
  const on = new Set(board.filter((c) => c.suit === suit).map((c) => c.rank as string));
  for (let i = RANK_ORDER.length - 1; i >= 0; i--) if (!on.has(RANK_ORDER[i])) return RANK_ORDER[i];
  return null;
}

export interface HoldemDrawRead {
  flushDraw: boolean;
  nutFlushDraw: boolean;
  /** distinct ranks that complete a straight hero plays a hole card in */
  straightRanks: number;
  /** hole ranks above every board card */
  overcards: number;
  backdoorFlush: boolean;
  backdoorStraight: boolean;
  /** hero holds the top unseen card of a suit with two or more on board */
  blocker: boolean;
  madeFlush: boolean;
  madeStraight: boolean;
}

/** Hold'em draws from hero's cards and the public board. Flop or turn. */
export function holdemDrawRead(hole: readonly Card[], board: readonly Card[]): HoldemDrawRead {
  const out: HoldemDrawRead = {
    flushDraw: false,
    nutFlushDraw: false,
    straightRanks: 0,
    overcards: 0,
    backdoorFlush: false,
    backdoorStraight: false,
    blocker: false,
    madeFlush: false,
    madeStraight: false,
  };
  if (hole.length !== 2 || board.length < 3 || board.length > 4) return out;
  for (const s of SUITS) {
    const h = hole.filter((c) => c.suit === s).length;
    const b = board.filter((c) => c.suit === s).length;
    if (h >= 1 && h + b >= 5) out.madeFlush = true;
    else if (h >= 1 && h + b === 4) {
      out.flushDraw = true;
      const top = topUnseen(s, board);
      if (hole.some((c) => c.suit === s && c.rank === top)) out.nutFlushDraw = true;
    } else if (board.length === 3 && h >= 1 && h + b === 3) out.backdoorFlush = true;
    if (b >= 2) {
      const top = topUnseen(s, board);
      if (top && hole.some((c) => c.suit === s && c.rank === top)) out.blocker = true;
    }
  }
  const holeR = hole.map(rank);
  const boardR = board.map(rank);
  const all = withAceLow([...holeR, ...boardR]);
  const boardOnly = withAceLow(boardR);
  out.madeStraight = hasStraight(all) && !hasStraight(boardOnly);
  if (!out.madeStraight) {
    for (let r = 2; r <= 14; r++) {
      const plus = new Set(all);
      plus.add(r);
      if (r === 14) plus.add(1);
      const bPlus = new Set(boardOnly);
      bPlus.add(r);
      if (r === 14) bPlus.add(1);
      if (hasStraight(plus) && !hasStraight(bPlus)) out.straightRanks++;
    }
  }
  const maxBoard = Math.max(...boardR);
  out.overcards = new Set(holeR.filter((r) => r > maxBoard)).size;
  if (board.length === 3 && out.straightRanks === 0 && !out.madeStraight) {
    // Three distinct ranks inside a five-rank window, two of them hero's.
    const holeSet = withAceLow(holeR);
    for (let lo = 1; lo <= 10 && !out.backdoorStraight; lo++) {
      let n = 0;
      let mine = 0;
      for (let r = lo; r < lo + 5; r++) {
        if (all.has(r)) n++;
        if (holeSet.has(r)) mine++;
      }
      if (n >= 3 && mine >= 2) out.backdoorStraight = true;
    }
  }
  return out;
}

export interface FlopTurnBluffSpot {
  omaha: boolean;
  potLimit: boolean;
  hiLo: boolean;
  fixedLimit: boolean;
  shortDeck: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  /** a locked satellite seat (V37): it does not play big pots */
  satelliteLocked: boolean;
  holeCount: number;
  hole: Card[];
  board: Card[];
  history: readonly ActionRecord[];
  heroId: string;
  /** live (not folded) opponents */
  opponentIds: string[];
  /** every live opponent can still put chips in */
  opponentsCanRespond: boolean;
  /** hero's equity against the read range */
  equity: number;
  /** made category of hero's best hand (1 = high card, 2 = a pair, ...) */
  category: number;
  /** hero acts last on this street */
  inPosition: boolean;
  /** the last aggressor of the earlier streets */
  initiative: 'hero' | 'opp' | 'none';
  /** Omaha draw grading (omahaDrawQuality), null in Hold'em */
  omahaDraw: OmahaDrawInfo | null;
}

export interface FlopTurnBluffEligibility {
  eligible: boolean;
  reason:
    | 'eligible'
    | 'domain'
    | 'multiway'
    | 'cannot_respond'
    | 'showdown_value'
    | 'unqualified'
    | 'no_story';
  line: FlopTurnBluffLine;
  selection: FlopTurnBluffSelection;
  /** the board carries a pair (Omaha: every raise is a boat) */
  pairedBoard: boolean;
}

const aggressive = (a: ActionRecord): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

/** Hero's own pair: a pocket pair, or a hole rank on the board. Ranks only. */
function heroPair(hole: readonly Card[], board: readonly Card[]): { top: boolean; any: boolean } {
  const boardR = board.map(rank);
  const maxBoard = Math.max(...boardR);
  let any = false;
  let top = false;
  for (let i = 0; i < hole.length; i++)
    for (let j = i + 1; j < hole.length; j++)
      if (hole[i].rank === hole[j].rank) {
        any = true;
        if (rank(hole[i]) >= maxBoard) top = true; // an overpair
      }
  for (const h of hole)
    if (boardR.includes(rank(h))) {
      any = true;
      if (rank(h) === maxBoard) top = true;
    }
  return { top, any };
}

/** Which kind of bluff hero's cards make on this board. */
export function flopTurnSelection(spot: FlopTurnBluffSpot): {
  selection: FlopTurnBluffSelection;
  showdownValue: boolean;
} {
  const board = spot.board;
  if (spot.omaha) {
    const d = spot.omahaDraw;
    const pr = heroPair(spot.hole, board);
    // Omaha: one pair is not showdown value unless it is top pair or an
    // overpair; two pair or better is (the value ladder owns it).
    // In 5/6-card Omaha, non-nut wraps without nut outs are frequently dominated
    // ("sucker wraps"), so strongDraw requires nut flush draw, nut straight outs,
    // or a massive 13+ wrap rather than any bare 8-out non-nut draw.
    const minNutWrapOuts = spot.holeCount >= 6 ? 8 : spot.holeCount === 5 ? 6 : 0;
    const strong =
      !!d &&
      (d.nutFlushDraw ||
        (spot.holeCount <= 4
          ? d.straightOuts >= 8 || (d.dominatedFlushDraw && d.straightOuts >= 4)
          : d.nutStraightOuts >= minNutWrapOuts ||
            d.straightOuts >= 13 ||
            (d.dominatedFlushDraw && d.nutStraightOuts >= 4)) ||
        d.nutty);
    // Four straight outs are nearly every Omaha hand; a weak draw needs six (eight in PLO6).
    const weak =
      !!d &&
      (spot.holeCount >= 6
        ? (d.dominatedFlushDraw && d.straightOuts >= 4) || d.straightOuts >= 8
        : d.dominatedFlushDraw || d.straightOuts >= 6);
    if (spot.category >= 3) return { selection: 'junk', showdownValue: true };
    if (pr.top && !strong) return { selection: 'junk', showdownValue: true };
    if (strong)
      return { selection: pr.any && pr.top ? 'pairDraw' : 'strongDraw', showdownValue: false };
    if (weak) return { selection: 'weakDraw', showdownValue: false };
    // The nut-flush card of a two-flush board, without the draw itself.
    for (const s of SUITS) {
      if (board.filter((c) => c.suit === s).length < 2) continue;
      const top = topUnseen(s, board);
      if (top && spot.hole.some((c) => c.suit === s && c.rank === top))
        return { selection: 'blocker', showdownValue: false };
    }
    return { selection: 'junk', showdownValue: false };
  }
  const r = holdemDrawRead(spot.hole, board);
  if (r.madeFlush || r.madeStraight || (spot.category >= 3 && heroPair(spot.hole, board).any))
    return { selection: 'junk', showdownValue: true };
  const pr = heroPair(spot.hole, board);
  const strong = r.flushDraw || r.straightRanks >= 2;
  if (pr.any) {
    if (!pr.top && strong) return { selection: 'pairDraw', showdownValue: false };
    return { selection: 'junk', showdownValue: true };
  }
  if (strong) return { selection: 'strongDraw', showdownValue: false };
  if (r.straightRanks === 1) return { selection: 'weakDraw', showdownValue: false };
  // Three of a suit on the board: a hand holding none of the flush cards is
  // not a bluff candidate (it represents nothing the board allows); only the
  // nut-flush blocker is.
  const flushSuit = SUITS.find((s) => board.filter((c) => c.suit === s).length >= 3);
  if (flushSuit) return { selection: r.blocker ? 'blocker' : 'junk', showdownValue: false };
  if (board.length === 3 && (r.backdoorFlush || r.backdoorStraight) && r.overcards >= 1)
    return { selection: 'backdoor', showdownValue: false };
  if (r.overcards >= 2) return { selection: 'overcards', showdownValue: false };
  if (r.blocker) return { selection: 'blocker', showdownValue: false };
  return { selection: 'junk', showdownValue: false };
}

/** Which story hero's line tells on this flop or turn, or 'none'. */
export function flopTurnBluffLine(spot: FlopTurnBluffSpot): FlopTurnBluffLine {
  const h = spot.history;
  const street = spot.board.length === 3 ? 'flop' : 'turn';
  const opp = new Set(spot.opponentIds);
  const aggressorCheckedHere = h.some(
    (a) => a.stage === street && opp.has(a.userId) && a.action === 'check'
  );
  const oppAggressedHere = h.some((a) => a.stage === street && opp.has(a.userId) && aggressive(a));
  if (oppAggressedHere) return 'none';
  if (street === 'flop') {
    if (spot.initiative === 'hero') return 'cbet';
    // The aggressor checked to hero in position: a float stab.
    if (spot.inPosition && aggressorCheckedHere) return 'stab';
    return 'none';
  }
  const flopBetByHero = h.some(
    (a) => a.stage === 'flop' && a.userId === spot.heroId && aggressive(a)
  );
  const flopAny = h.some((a) => a.stage === 'flop' && aggressive(a));
  const flopSeen = h.some((a) => a.stage === 'flop');
  if (spot.initiative === 'hero') {
    if (flopBetByHero) return 'barrel';
    if (flopSeen && !flopAny) return 'delayed';
    return 'none';
  }
  if (flopSeen && !flopAny) {
    // The raiser checked the flop back: a lead is a probe. In position after
    // they check the turn too, it is a stab.
    if (!spot.inPosition) return 'probe';
    return aggressorCheckedHere ? 'stab' : 'none';
  }
  // The opponent bet the flop, hero called, and they checked the turn to hero.
  if (spot.inPosition && aggressorCheckedHere) return 'stab';
  return 'none';
}

const boardPaired = (board: readonly Card[]): boolean =>
  new Set(board.map((c) => c.rank)).size < board.length;

function domainOk(spot: FlopTurnBluffSpot): boolean {
  const holeOk = spot.omaha ? [4, 5, 6].includes(spot.holeCount) : spot.holeCount === 2;
  return (
    (spot.board.length === 3 || spot.board.length === 4) &&
    holeOk &&
    spot.hole.length === spot.holeCount &&
    !spot.fixedLimit &&
    !spot.shortDeck &&
    !spot.multiBoard &&
    !spot.bombPot &&
    !spot.hiLo &&
    !spot.satelliteLocked &&
    (spot.omaha ? spot.potLimit : !spot.potLimit)
  );
}

/** Is this a qualified flop/turn bluff or semi-bluff bet, and which kind. */
export function flopTurnBluffEligibility(spot: FlopTurnBluffSpot): FlopTurnBluffEligibility {
  const pairedBoard = boardPaired(spot.board);
  const { selection, showdownValue } = domainOk(spot)
    ? flopTurnSelection(spot)
    : { selection: 'junk' as const, showdownValue: false };
  const out = (
    reason: FlopTurnBluffEligibility['reason'],
    line: FlopTurnBluffLine = 'none'
  ): FlopTurnBluffEligibility => ({
    eligible: reason === 'eligible',
    reason,
    line,
    selection,
    pairedBoard,
  });
  if (!domainOk(spot)) return out('domain');
  const n = spot.opponentIds.length;
  if (n < 1 || n > 3) return out('multiway');
  if (!spot.opponentsCanRespond) return out('cannot_respond');
  if (showdownValue || !(spot.equity < FT_BLUFF_VALUE_EQUITY)) return out('showdown_value');
  if (selection === 'junk') return out('unqualified');
  if (n >= 2 && !isDraw(selection)) return out('multiway');
  if (n === 3 && selection !== 'strongDraw') return out('multiway');
  const line = flopTurnBluffLine(spot);
  if (line === 'none') return out('no_story', line);
  if (FT_BLUFF_BASE[line][selection as Exclude<FlopTurnBluffSelection, 'junk'>] <= 0)
    return out('unqualified', line);
  return out('eligible', line);
}

export interface FlopTurnBluffReads {
  /** a credible station (isStation) */
  station: boolean;
  /** HorseMind.foldToCbetOf for a heads-up c-bet or barrel, else null */
  foldToCbet: number | null;
  /** HorseMind.exploit(...).bluffMod (1 = neutral) */
  bluffMod: number;
}

/** The reshaping a read applies. 1 without a read; never zero. */
export function flopTurnReadFactor(reads: FlopTurnBluffReads, draw: boolean): number {
  if (reads.station) return draw ? FT_STATION_DRAW_FACTOR : FT_STATION_AIR_FACTOR;
  let f = 1;
  if (reads.foldToCbet !== null && Number.isFinite(reads.foldToCbet))
    f *= Math.max(0.7, Math.min(1.4, 0.6 + reads.foldToCbet));
  if (Number.isFinite(reads.bluffMod) && reads.bluffMod > 0)
    f *= Math.max(0.6, Math.min(1.35, reads.bluffMod));
  return Math.max(0.6, Math.min(1.4, f));
}

export interface FlopTurnBluffFrequencyInput {
  eligibility: FlopTurnBluffEligibility;
  omaha: boolean;
  opponents: number;
  inPosition: boolean;
  /** the runout or the public ranges favour the opponent */
  rangesFavorOpponent: boolean;
  /** hero's public range has the advantage on this board */
  rangeAdvantage: boolean;
  /** the turn completed a flush or straight hero neither blocks nor draws to */
  scareUnblocked: boolean;
  /** effective stack behind over the pot */
  stackToPot: number;
  reads: FlopTurnBluffReads;
  /** tournament survival premium (icmRisk); 0 in cash */
  icmRisk: number;
}

/** The probability this combo bets. Zero only outside the owned spot. */
export function flopTurnBluffProbability(i: FlopTurnBluffFrequencyInput): number {
  const e = i.eligibility;
  if (!e.eligible || e.line === 'none' || e.selection === 'junk') return 0;
  const draw = isDraw(e.selection);
  let p = FT_BLUFF_BASE[e.line][e.selection];
  if (!i.inPosition) {
    if (e.line === 'cbet') p *= 0.85;
    else if (e.line === 'barrel' || e.line === 'delayed') p *= 0.9;
  }
  if (i.opponents === 2) p *= 0.55;
  else if (i.opponents >= 3) p *= 0.3;
  if (e.pairedBoard && e.selection !== 'pairDraw') p *= 0.5;
  // Omaha equities run close: a weak draw or a blocker alone is a thinner
  // bluff than in Hold'em.
  if (i.omaha && (e.selection === 'weakDraw' || e.selection === 'blocker')) p *= 0.75;
  if (i.rangesFavorOpponent) p *= draw ? 0.9 : 0.7;
  else if (i.rangeAdvantage && e.line === 'cbet' && !draw) p *= 1.15;
  if (i.scareUnblocked && !draw) p *= 0.6;
  if (i.stackToPot < 1.2 && !draw) p *= 0.5;
  p *= flopTurnReadFactor(i.reads, draw);
  if (i.icmRisk > 0)
    p *= draw ? Math.max(0.5, 1 - 1.5 * i.icmRisk) : Math.max(0.3, 1 - 3 * i.icmRisk);
  return Math.max(0, Math.min(FT_BLUFF_MAX_PROBABILITY, p));
}

/**
 * The bet as a fraction of the pot. Hold'em: a third on a dry c-bet board the
 * raiser owns, 0.55-0.75 with a draw, 0.45-0.6 otherwise on the flop; the
 * turn 0.6-0.8 (a probe 0.5-0.7). Pot limit 0.5-0.8 of the pot on the flop,
 * 0.6-0.9 on the turn, never above it. The shove when it is the size anyway.
 */
export function flopTurnBluffSize(input: {
  potLimit: boolean;
  street: 'flop' | 'turn';
  line: FlopTurnBluffLine;
  selection: FlopTurnBluffSelection;
  dryRangeBoard: boolean;
  pot: number;
  effectiveStack: number;
  u: number;
}): { sizeFrac: number; shove: boolean } {
  const { pot, effectiveStack: eff, u } = input;
  if (!(pot > 0) || !(eff > 0)) return { sizeFrac: 0, shove: false };
  const cap = eff / pot;
  let s: number;
  if (input.potLimit) s = input.street === 'flop' ? 0.5 + u * 0.3 : 0.6 + u * 0.3;
  else if (input.street === 'flop') {
    if (input.line === 'cbet' && input.dryRangeBoard && !isDraw(input.selection))
      s = 0.3 + u * 0.06;
    else s = isDraw(input.selection) ? 0.55 + u * 0.2 : 0.45 + u * 0.15;
  } else s = input.line === 'probe' ? 0.5 + u * 0.2 : 0.6 + u * 0.2;
  if (input.potLimit) s = Math.min(1, s);
  return s >= cap ? { sizeFrac: cap, shove: true } : { sizeFrac: s, shove: false };
}

// ═══ FACING A BET: the semi-bluff raise ════════════════════════════════════

export interface FlopTurnRaiseSpot extends FlopTurnBluffSpot {
  /** the bet hero faces over the pot before it */
  potFrac: number;
  /** hero bet this street and was raised */
  raisedAfterAggr: boolean;
  /** hero's chips behind over the call */
  stackOverCall: number;
}

export interface FlopTurnRaiseEligibility {
  eligible: boolean;
  reason:
    | 'eligible'
    | 'domain'
    | 'multiway'
    | 'cannot_respond'
    | 'showdown_value'
    | 'unqualified'
    | 'reraise'
    | 'oversized'
    | 'paired_board'
    | 'short';
  selection: FlopTurnBluffSelection;
}

export function flopTurnRaiseEligibility(spot: FlopTurnRaiseSpot): FlopTurnRaiseEligibility {
  const ok = domainOk(spot);
  const { selection, showdownValue } = ok
    ? flopTurnSelection(spot)
    : { selection: 'junk' as const, showdownValue: false };
  const out = (reason: FlopTurnRaiseEligibility['reason']): FlopTurnRaiseEligibility => ({
    eligible: reason === 'eligible',
    reason,
    selection,
  });
  if (!ok) return out('domain');
  const n = spot.opponentIds.length;
  if (n < 1 || n > 2) return out('multiway');
  if (!spot.opponentsCanRespond) return out('cannot_respond');
  if (showdownValue || !(spot.equity < FT_BLUFF_VALUE_EQUITY)) return out('showdown_value');
  if (!isDraw(selection)) return out('unqualified');
  if (n === 2 && selection !== 'strongDraw') return out('multiway');
  if (spot.raisedAfterAggr) return out('reraise');
  // A semi-bluff raise into a pot-sized turn bet commits the stack with a
  // draw; the call/fold layers price that one (V68 implied odds).
  if (!(spot.potFrac <= (spot.board.length === 3 ? 1.0 : 0.75))) return out('oversized');
  // Dan 2026-10-25: on a paired Omaha board every raise is a full house; a
  // draw does not raise into one (HorsePloPairedBoardFold).
  if (spot.omaha && boardPaired(spot.board)) return out('paired_board');
  if (!(spot.stackOverCall > 1)) return out('short');
  const street = spot.board.length === 3 ? 'flop' : 'turn';
  const base = FT_RAISE_BASE[street][spot.inPosition ? 'ip' : 'oop'];
  if ((base[selection as 'strongDraw' | 'pairDraw' | 'weakDraw'] ?? 0) <= 0)
    return out('unqualified');
  return out('eligible');
}

export function flopTurnRaiseProbability(i: {
  eligibility: FlopTurnRaiseEligibility;
  street: 'flop' | 'turn';
  inPosition: boolean;
  opponents: number;
  potFrac: number;
  /** Omaha: nut flush draw or a 9+ nut wrap */
  nutDraw: boolean;
  reads: FlopTurnBluffReads;
  icmRisk: number;
}): number {
  const e = i.eligibility;
  if (!e.eligible) return 0;
  const base = FT_RAISE_BASE[i.street][i.inPosition ? 'ip' : 'oop'];
  let p = base[e.selection as 'strongDraw' | 'pairDraw' | 'weakDraw'] ?? 0;
  if (i.nutDraw) p *= 1.2;
  if (i.opponents >= 2) p *= 0.4;
  if (i.potFrac > 0.75) p *= 0.7;
  p *= flopTurnReadFactor(i.reads, true);
  if (i.icmRisk > 0) p *= Math.max(0.4, 1 - 2 * i.icmRisk);
  return Math.max(0, Math.min(FT_RAISE_MAX_PROBABILITY, p));
}
