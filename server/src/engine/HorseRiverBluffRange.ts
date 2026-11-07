/**
 * ═══ THE BASELINE RIVER BLUFF RANGE (Dan 2026-11-06) ═══
 *
 * Dan, 2026-11-06 20:52 Chicago: "MAKE SURE THAT YOU FULLY UPGRADE ENHANCE,
 * OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION FOR BOTH
 * HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING THAT IS
 * EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR QUALIFIED
 * CANDITATES OR SITUATIONS."
 *
 * Measured before this layer (production, 12 hours to 2026-11-07 02:00 UTC,
 * heads-up rivers checked to a horse or first to act): Hold'em air bet
 * 12.8% of the time and air was 24% of river bets; PLO4 air was 7.8% of
 * river bets, PLO5 1.5%, PLO6 1.4%. At showdown only 0.8% of PLO4 river bets
 * were a high card or one pair. Players noticed: "rarely any bluffs on here".
 *
 * Why: every river bluff path was conditional on something an ordinary spot
 * does not have. V53 needs a credible river-fold read (no read, no bluff);
 * V54 and the bluff check-raise are default-off candidates; V17's probe is
 * opt-in; V7 continues only a recorded barrel plan and otherwise "gives up"
 * 80% of the time; the V38 EV engine (the whole of Omaha below the value
 * bars) excludes the river; and in Hold'em the V30 solver cell is a CLASS
 * MEAN over every board, so it checks the missed draw of a class whose
 * average holding has showdown value. What was left was a generic ladder
 * that ignored the line and the blockers.
 *
 * This module owns ONE spot and answers it from poker, not from a read:
 * heads-up, river, no bet to face, hero holding no showdown value (air or a
 * missed draw: equity under RIVER_BLUFF_AIR_EQUITY against the read range).
 * Hero bets a size s of the pot and bluffs at the balanced rate for that
 * size: a bet of s risks s to win 1 + s, so the caller is indifferent when
 * s/(1+2s) of the betting range is bluffs - one bluff per two value bets at
 * a pot-sized bet. The per-combo probability is that ratio over hero's
 * value and air shares on this board (v54BluffProbability), then weighted
 * so the right combos carry the bluffs:
 *
 *  - blockers (riverNutBlocker): Hold'em, the top unseen card of a three-flush
 *    board's suit, or a rank of a holding that makes the best straight;
 *    Omaha, the nut-flush blocker class (omahaFlushBlocker) or the best
 *    straight's rank. A missed front-door flush hero does not block
 *    (none of a two-suited board's suit) is the Hold'em unblocker bonus.
 *  - missed draws over pure junk: a flush or straight draw on the turn that
 *    bricked is in every betting range that barrelled, and has no showdown
 *    value at all.
 *  - line coherence: hero barrelled the turn and was called, hero bet the
 *    flop and the turn checked through (a delayed bet), the turn
 *    checked through (both ranges capped), the opponent gave up after
 *    betting (hero in position), or the river card is a scare card hero
 *    blocks or whose range it improves. Leading out of position into the
 *    player who bet the turn, on a river that changed nothing, is not a
 *    story: that spot stays with the layers below.
 *
 * Reads RESHAPE the baseline; they never switch it off. A credible station
 * (foldToBet engaged low, riverCall engaged high, or a measured
 * fold-to-river-bet under 35%) keeps a fifth of the bluffs; a measured river
 * folder gets up to 1.6x; and the V53 over-folder frequency, when a credible
 * read exists, is a floor. No read means the baseline - never zero.
 *
 * Tournaments keep their survival arithmetic, not a switch: the icmRisk
 * premium scales the frequency down (never below a quarter), a locked
 * satellite seat never bluffs (V37, it does not play big pots at all), and a
 * shove bluff under survival pressure is sized down to a non-shove bet.
 *
 * ═══ THE OTHER GAMES (2026-11-07, docs/changelog/2026-11-07-river-bluff-other-games.md) ═══
 * Fixed limit, short deck, bomb pots and multi-board pots were excluded by
 * #9803. Each now has its own correct path, default on (opts per type):
 *
 *  - FIXED LIMIT: the bet is one fixed big bet (fixedBet), so s = bet/pot is
 *    small (production flh/flo8 river bets average 0.20-0.22 pot) and the
 *    balanced share s/(1+s) is low - about one bluff per six value bets -
 *    but real. A fixed-limit caller needs to fold only s/(1+s) (about 16%)
 *    for the bluff to pay; production heads-up river bets were folded to 36%
 *    (flh) and 28% (flo8), so the population is not the calling-station wall
 *    the reputation suggests, and a measured station still gets x0.2.
 *  - SHORT DECK: the engine's ranking (PokerEngine.evaluate5Cards): a 36-card
 *    deck (six to ace), A-6-7-8-9 is the lowest straight (the ace plays as a
 *    five), and a flush beats a full house. Draws and straight blockers read
 *    ranks six to ace with the ace also low as five; a flush board's nut
 *    blocker stays the top unseen card of the suit, now even on a paired
 *    board (a boat no longer beats it).
 *  - BOMB POTS: nobody acted preflop, so no story may rest on preflop
 *    aggression. Every line above is already postflop-only (a turn barrel, a
 *    flop bet, a checked-through turn, a turn bettor giving up, a scare
 *    card), and a preflop raise alone never tells one. The public range
 *    composition comes from HorseMind.bandFor, which already starts a bomb
 *    pot from a random hand and narrows it by postflop play (V36).
 *  - MULTI-BOARD: the pot is split by board, so a bluff must fold out EVERY
 *    board (HorseLogic V36 rule 2: "bluff volume drops by half on two boards
 *    and by two-thirds on three"). Hero is a candidate only with no showdown
 *    value on any board; blockers and missed draws are read on every board
 *    and averaged; the frequency is divided by the number of boards.
 *
 * ═══ OUT-OF-POSITION RIVER LEADS (2026-11-07) ═══
 * Hero is out of position, the opponent bet the turn, hero called, and hero
 * is first to act on the river. Before this, everything but a scare card hero
 * held the nut blocker for was checked. The lead lines:
 *  - leadDraw: the river completed a flush (third card of a suit that showed
 *    two on the turn) or a straight that was not possible on the turn. Those
 *    are the draws the CALLER's range holds and the turn bettor's range holds
 *    least, so the caller represents them; blockers carry the bluffs.
 *  - leadBlank: any other river. Rare (a quarter of the barrel weight).
 *  - Omaha on a paired board: no lead (Dan's paired-board rulings: a hand
 *    without a full house does not put chips in on a paired board).
 * A credible station is never bluff-led into (it keeps its fifth of the
 * bluffs only where hero holds the betting lead). Value leads are passed by
 * the V11 initiative gate on draw-completing rivers (riverLeadValuePass).
 *
 * ═══ HI-LO WITH A LOW POSSIBLE (2026-11-07) ═══
 * Three or more distinct low ranks (8 or under) on the board split the pot.
 * A bet with no high and no low is called by every low, so it wins only when
 * the opponent holds neither half:
 *  - freeroll: hero holds the nut low (no unseen two-card low beats it) and no
 *    high (high share under 0.25). A bet called by a better high splits
 *    exactly as a check would; a fold from that better high scoops. Bet at
 *    RIVER_BLUFF_HILO_FREEROLL, scaled down by the chance hero is quartered.
 *  - scoop: hero holds neither half. A bluff for the whole pot is a story
 *    only when the opponent is unlikely to hold a low at all
 *    (riverOpponentLowChance at most RIVER_BLUFF_HILO_MAX_OPP_LOW, counted
 *    from the public cards and hero's own) and the line tells one; it bets the
 *    balanced share times the chance the opponent has no low.
 *  - low_giveaway: otherwise the opponent's likely low makes the bet a
 *    half-pot giveaway, and hero checks (the layers below are not consulted).
 *  - a low that is not the nut, or any high share of 0.25 or more, is
 *    showdown value and left to the layers below.
 */
import type { ActionRecord, Card } from '../types.js';
import { RANK_VALUES } from './PokerEngine.js';

/** Equity against the read range below which a hand has no showdown value. */
export const RIVER_BLUFF_AIR_EQUITY = 0.25;
/** The most often any one combo bluffs, whatever the composition says. */
export const RIVER_BLUFF_MAX_PROBABILITY = 0.45;
/** Value-to-air ratio assumed when the public ranges cannot be sampled. */
export const RIVER_BLUFF_PRIOR_VALUE_SHARE = 0.6;
export const RIVER_BLUFF_PRIOR_AIR_SHARE = 1;
/** The most value per air combo the public ranges are believed to show. The
 *  bands are preflop-strength slices: they cannot see the missed draws a
 *  betting range really carries, so a band read of "nearly all value" is
 *  taken as no more than 0.6 value combos per air combo. The composition can
 *  lower the ratio (a board where hero's range is mostly air), never raise
 *  it past this. */
export const RIVER_BLUFF_MAX_VALUE_PER_AIR = 0.6;

/** Combo selection weights: the average air combo bluffs at about the
 *  balanced rate, blockers and missed draws more, pure junk less. */
export const RIVER_BLUFF_WEIGHTS = {
  junk: 0.5,
  missedDraw: 0.9,
  blocker: 1.15,
  blockerAndDraw: 1.3,
  unblockerBonus: 0.1,
} as const;

/** Line coherence factor: how well hero's line represents a river bet. */
export const RIVER_BLUFF_LINE = {
  barrel: 1.1,
  initiative: 0.95,
  checkedThrough: 0.8,
  opponentGaveUp: 0.85,
  scare: 0.85,
  /** out of position, leading into the turn bettor on a river that completed
   *  the caller's draws */
  leadDraw: 0.9,
  /** the same lead on a river that completed nothing: rare */
  leadBlank: 0.25,
} as const;

/** Hi-lo: the freeroll bet frequency with the nut low and no high. */
export const RIVER_BLUFF_HILO_FREEROLL = 0.55;
/** Hi-lo: a whole-pot bluff needs the opponent's low chance at most this. */
export const RIVER_BLUFF_HILO_MAX_OPP_LOW = 0.5;
/** V11 gate: how often a value hand leads a draw-completing river out of
 *  position (the monster bar), and a strong hand under it. */
export const RIVER_LEAD_VALUE_PASS = { monster: 0.6, strong: 0.3 } as const;
/** The game types #9803 excluded, each with its own path (2026-11-07). */
export type RiverBluffGameType = 'fixedLimit' | 'shortDeck' | 'bombPot' | 'multiBoard';

/** Read reshaping: a station keeps a fifth of the bluffs, a folder gets more. */
export const RIVER_BLUFF_STATION_FACTOR = 0.2;
export const RIVER_BLUFF_FOLDER_MAX = 1.6;

export type RiverBluffLine = keyof typeof RIVER_BLUFF_LINE | 'none';
export type RiverBluffSelection = 'junk' | 'missedDraw' | 'blocker' | 'blockerAndDraw' | 'freeroll';

export interface RiverBluffSpot {
  omaha: boolean;
  potLimit: boolean;
  hiLo: boolean;
  /** hi-lo only: three or more distinct low ranks on the board */
  lowPossible: boolean;
  fixedLimit: boolean;
  shortDeck: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  holeCount: number;
  hole: Card[];
  board: Card[];
  history: readonly ActionRecord[];
  heroId: string;
  opponentId: string;
  /** opponents still live in the hand (not folded) */
  opponentsLive: number;
  /** the one opponent can still put chips in (not all in, has a stack) */
  opponentCanRespond: boolean;
  /** hero's equity against the read range */
  equity: number;
  /** hero acts last on the river */
  inPosition: boolean;
  /** the last aggressor of the earlier streets */
  initiative: 'hero' | 'opp' | 'none';
  /** the river card completed a flush, a straight or paired the board */
  scareCard: boolean;
  /** hero holds the nut blocker for this game (riverNutBlocker) */
  nutBlocker: boolean;
  /** the public ranges: hero's range improved on, or got the nuts on, this river */
  riverHelpsHero: boolean;
  /** the public ranges: the runout or the ranges favour the opponent */
  rangesFavorOpponent: boolean;
  /** hero's recorded barrel plan for this hand */
  barrelPlan: boolean;
  /** Omaha: how many earlier-street hero bets this opponent called */
  calledBarrels: number;
  /** out-of-position lead lines (opts.riverLeadRange, default on) */
  leadRange?: boolean;
  /** hi-lo with a low possible (opts.riverBluffHiLo, default on) */
  hiLoRange?: boolean;
  /** hi-lo: hero's share of the high half against the read range */
  hiShare?: number;
  /** hi-lo: the fraction of runouts hero takes a quarter or less */
  quarterShare?: number;
  /** Multi-board: every board (`board` is the style board, one of these). */
  boards?: Card[][];
  /** Multi-board: hero's equity on each board, in `boards` order. */
  boardEquities?: number[];
  /** Multi-board: hero holds the nut blocker on each board, in `boards` order. */
  nutBlockerByBoard?: boolean[];
  /** Per-type paths (2026-11-07). Absent or true: the type has its bluff
   *  path. false restores #9803's exclusion for that type (ablation only). */
  paths?: Partial<Record<RiverBluffGameType, boolean>>;
}

export interface RiverBluffEligibility {
  eligible: boolean;
  reason:
    | 'eligible'
    | 'domain'
    | 'multiway'
    | 'cannot_respond'
    | 'showdown_value'
    | 'no_story'
    | 'low_giveaway';
  line: RiverBluffLine;
  selection: RiverBluffSelection;
  missedDraw: boolean;
  unblocker: boolean;
  /** hi-lo with a low possible: what the bet is */
  hiLo?: { kind: 'freeroll' | 'scoop'; oppLowChance: number; quarterShare: number };
  /** How many boards the bluff must fold out (1 on a single board). */
  boardCount: number;
  /** The combo weight: RIVER_BLUFF_WEIGHTS of the selection (plus the
   *  unblocker bonus), averaged over every board on a multi-board pot. */
  selectionWeight: number;
  /** The excluded game types this spot belongs to (receipt labels). */
  gameTypes: RiverBluffGameType[];
}

const rank = (c: Card): number => RANK_VALUES[c.rank] ?? 0;

/** The ace's low rank: below the deuce in a full deck; below the six (as a
 *  five) in short deck, where A-6-7-8-9 is the lowest straight. */
const aceLow = (shortDeck: boolean): number => (shortDeck ? 5 : 1);

/** Distinct ranks, with the ace also counted low. */
function rankSet(cards: readonly Card[], shortDeck = false): Set<number> {
  const s = new Set<number>();
  for (const c of cards) {
    const r = rank(c);
    s.add(r);
    if (r === 14) s.add(aceLow(shortDeck));
  }
  return s;
}

/** Four distinct ranks inside some five-rank window (an open-ender or a gutshot). */
function hasFourInWindow(ranks: Set<number>, mustUse: Set<number>): boolean {
  for (let lo = 1; lo <= 10; lo++) {
    let n = 0;
    let used = false;
    for (let r = lo; r < lo + 5; r++) {
      if (ranks.has(r)) {
        n++;
        if (mustUse.has(r)) used = true;
      }
    }
    if (n >= 4 && used) return true;
  }
  return false;
}

/** Five distinct ranks in a row. */
function hasStraight(ranks: Set<number>): boolean {
  for (let lo = 1; lo <= 10; lo++) {
    let ok = true;
    for (let r = lo; r < lo + 5 && ok; r++) ok = ranks.has(r);
    if (ok) return true;
  }
  return false;
}

/**
 * A flush or straight draw on the turn that the river did not complete.
 * Public cards and hero's own only. Hold'em: any combination of hole and
 * board; Omaha: exactly two hole cards with the board.
 */
export function riverMissedDraw(
  hole: readonly Card[],
  board: readonly Card[],
  omaha: boolean,
  shortDeck = false
): boolean {
  const rs = (cards: readonly Card[]) => rankSet(cards, shortDeck);
  if (board.length !== 5 || hole.length < 2) return false;
  const turn = board.slice(0, 4);
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  if (!omaha) {
    for (const s of suits) {
      const h = hole.filter((c) => c.suit === s).length;
      const t = turn.filter((c) => c.suit === s).length;
      const r = board.filter((c) => c.suit === s).length;
      if (h >= 1 && h + t === 4 && h + r < 5) return true;
    }
    const holeRanks = rs(hole);
    if (hasFourInWindow(rs([...hole, ...turn]), holeRanks) && !hasStraight(rs([...hole, ...board])))
      return true;
    return false;
  }
  // Omaha: two suited hole cards with two of the suit on the turn, and the
  // river is not the third (a third would have completed it).
  for (const s of suits) {
    const h = hole.filter((c) => c.suit === s).length;
    const t = turn.filter((c) => c.suit === s).length;
    const r = board.filter((c) => c.suit === s).length;
    if (h >= 2 && t === 2 && r === 2) return true;
  }
  // A straight draw: two hole cards with turn cards making four in a window,
  // and no two hole cards with three river-board cards making the straight.
  for (let i = 0; i < hole.length; i++) {
    for (let j = i + 1; j < hole.length; j++) {
      const pair = [hole[i], hole[j]];
      const pr = rs(pair);
      if (pr.size < 2 || !hasFourInWindow(rs([...pair, ...turn]), pr)) continue;
      // the draw used both hole cards and two turn cards
      let completed = false;
      for (let a = 0; a < 5 && !completed; a++)
        for (let b = a + 1; b < 5 && !completed; b++)
          for (let c = b + 1; c < 5 && !completed; c++)
            completed = hasStraight(rs([...pair, board[a], board[b], board[c]]));
      if (!completed) return true;
    }
  }
  return false;
}

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/** The best straight top (5..14) these ranks make, or 0. */
function straightTop(ranks: Set<number>): number {
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let r = hi - 4; r <= hi && ok; r++) ok = ranks.has(r === 1 ? 1 : r);
    if (ok) return hi;
  }
  return 0;
}

/**
 * Does hero hold a card that removes the nut hands from the opponent's range?
 *
 * - A flush is possible (three or more of a suit on the board): Hold'em, hero
 *   holds the highest unseen card of that suit; Omaha, the caller's
 *   omahaFlushBlocker fact (`omahaNutFlush`) decides, because one card does
 *   not block an Omaha flush - the whole top suited pair class must go.
 * - Otherwise a straight is possible: hero holds a rank that appears in a
 *   two-card holding making the BEST straight this board allows (Hold'em may
 *   also use one card with four on board; Omaha uses exactly two).
 * - A board with neither has no blocker (its nuts are sets and boats, and a
 *   card of the paired rank is itself showdown value).
 *
 * Deliberately sharper than HorseMind.hasBlocker, whose straight test (any
 * card within four ranks of three board cards) calls a queen a blocker on
 * 9-8-5-K-2, where the only straight is seven-six.
 */
export function riverNutBlocker(
  hole: readonly Card[],
  board: readonly Card[],
  omaha: boolean,
  omahaNutFlush: boolean,
  shortDeck = false
): boolean {
  if (board.length !== 5 || hole.length < 2) return false;
  const suitN = new Map<string, number>();
  for (const c of board) suitN.set(c.suit, (suitN.get(c.suit) ?? 0) + 1);
  for (const [suit, n] of suitN) {
    if (n < 3) continue;
    if (omaha) return omahaNutFlush;
    const onBoard = new Set<string>(board.filter((c) => c.suit === suit).map((c) => c.rank));
    let top: string | null = null;
    // Short deck has no deuce to five; the loop stops at its six.
    const lowest = shortDeck ? RANK_ORDER.indexOf('6') : 0;
    for (let i = RANK_ORDER.length - 1; i >= lowest; i--) {
      if (!onBoard.has(RANK_ORDER[i])) {
        top = RANK_ORDER[i];
        break;
      }
    }
    return top !== null && hole.some((c) => c.suit === suit && c.rank === top);
  }
  const boardRanks = board.map(rank);
  // Every unseen two-rank holding (rank level; suits do not matter here).
  let best = 0;
  const makers: Array<[number, number]> = [];
  const tops = (a: number, b: number): number => {
    let t = 0;
    if (!omaha) {
      const rs = new Set<number>();
      for (const r of [a, b, ...boardRanks]) {
        rs.add(r);
        if (r === 14) rs.add(aceLow(shortDeck));
      }
      return straightTop(rs);
    }
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++)
        for (let k = j + 1; k < 5; k++) {
          const rs = new Set<number>();
          for (const r of [a, b, boardRanks[i], boardRanks[j], boardRanks[k]]) {
            rs.add(r);
            if (r === 14) rs.add(aceLow(shortDeck));
          }
          if (rs.size >= 5) t = Math.max(t, straightTop(rs));
        }
    return t;
  };
  const lowestRank = shortDeck ? 6 : 2;
  for (let a = lowestRank; a <= 14; a++) {
    for (let b = a; b <= 14; b++) {
      if (omaha && a === b) continue;
      const t = tops(a, b);
      if (t === 0) continue;
      if (t > best) {
        best = t;
        makers.length = 0;
      }
      if (t === best) makers.push([a, b]);
    }
  }
  if (best === 0) return false;
  // Hold'em with four to a straight on board: every one-card maker counts.
  const heroRanks = new Set(hole.map(rank));
  return makers.some(([a, b]) => heroRanks.has(a) || heroRanks.has(b));
}

/** Hold'em: the board shows exactly two of a suit and hero holds none of it -
 *  the missed front-door flush draws that make up the folding range are all
 *  still in the opponent's range. */
export function riverFlushUnblocker(hole: readonly Card[], board: readonly Card[]): boolean {
  const n = new Map<string, number>();
  for (const c of board) n.set(c.suit, (n.get(c.suit) ?? 0) + 1);
  for (const [s, k] of n) if (k === 2 && !hole.some((c) => c.suit === s)) return true;
  return false;
}

function streetCheckedThrough(history: readonly ActionRecord[], stage: string): boolean {
  let saw = false;
  for (const a of history) {
    if (a.stage !== stage) continue;
    saw = true;
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') return false;
  }
  return saw;
}

const aggressive = (a: ActionRecord): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

function boardPaired(board: readonly Card[]): boolean {
  const seen = new Set<string>();
  for (const c of board) {
    if (seen.has(c.rank)) return true;
    seen.add(c.rank);
  }
  return false;
}

/** Every straight top two unseen hole ranks could make with this board. */
function straightTops(board: readonly Card[], omaha: boolean): Set<number> {
  const br = board.map(rank);
  const out = new Set<number>();
  for (let a = 2; a <= 14; a++) {
    for (let b = a + 1; b <= 14; b++) {
      if (!omaha) {
        const hole2 = [{ rank: rankName(a) } as Card, { rank: rankName(b) } as Card];
        const t = straightTop(rankSet([...board, ...hole2]));
        if (t > 0) out.add(t);
        continue;
      }
      for (let i = 0; i < br.length; i++)
        for (let j = i + 1; j < br.length; j++)
          for (let k = j + 1; k < br.length; k++) {
            const rs = new Set<number>();
            for (const r of [a, b, br[i], br[j], br[k]]) {
              rs.add(r);
              if (r === 14) rs.add(1);
            }
            if (rs.size >= 5) {
              const t = straightTop(rs);
              if (t > 0) out.add(t);
            }
          }
    }
  }
  return out;
}

const rankName = (v: number): string => RANK_ORDER[v - 2];

/**
 * Did the river complete a draw the turn left open? A flush: the river is the
 * third card of a suit that showed exactly two on the turn. A straight: a
 * straight top two hole ranks make on the river board that no two hole ranks
 * made on the turn board. Public cards only.
 */
export function riverCompletedDraw(
  board: readonly Card[],
  omaha: boolean
): 'flush' | 'straight' | null {
  if (board.length !== 5) return null;
  const turn = board.slice(0, 4);
  const river = board[4];
  if (turn.filter((c) => c.suit === river.suit).length === 2) return 'flush';
  const before = omaha ? straightTops(turn, true) : straightTops(turn, false);
  for (const t of straightTops(board, omaha)) if (!before.has(t)) return 'straight';
  return null;
}

/**
 * The out-of-position lead spot: the last turn bet or raise was the
 * opponent's, hero called it, and nobody has acted on the river yet.
 */
export function riverLeadSpot(
  spot: Pick<RiverBluffSpot, 'history' | 'heroId' | 'opponentId'>
): boolean {
  let lastAggressor: string | null = null;
  let heroCalled = false;
  for (const a of spot.history) {
    if (a.stage === 'river') return false;
    if (a.stage !== 'turn') continue;
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
      lastAggressor = a.userId;
      heroCalled = false;
    } else if (a.action === 'call' && a.userId === spot.heroId) heroCalled = true;
  }
  return lastAggressor === spot.opponentId && heroCalled;
}

/**
 * The V11 gate's value-lead spot: out of position, first on the river, into
 * the turn bettor, on a river that completed a draw (and, in Omaha, not on a
 * paired board). The gate then lets a value hand through to the value
 * ladder at RIVER_LEAD_VALUE_PASS instead of checking it.
 */
export function riverLeadValueSpot(spot: {
  history: readonly ActionRecord[];
  heroId: string;
  opponentId: string;
  board: readonly Card[];
  omaha: boolean;
}): boolean {
  if (spot.board.length !== 5) return false;
  if (spot.omaha && boardPaired(spot.board)) return false;
  return riverLeadSpot(spot) && riverCompletedDraw(spot.board, spot.omaha) !== null;
}

/** Ace low: the rank values a low uses (A = 1, 2..8), or 0 for none. */
const lowRank = (c: Card): number => {
  const r = rank(c);
  return r === 14 ? 1 : r <= 8 ? r : 0;
};

/** Compare two lows (descending rank lists): negative when a is better. */
function compareLow(a: number[], b: number[]): number {
  for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The best 8-or-better low two hole ranks make with exactly three board
 *  ranks (descending), or null. */
function lowWith(r1: number, r2: number, boardLow: number[]): number[] | null {
  if (r1 === r2 || r1 === 0 || r2 === 0) return null;
  const rest = [...new Set(boardLow)].filter((r) => r !== r1 && r !== r2).sort((x, y) => x - y);
  if (rest.length < 3) return null;
  return [r1, r2, rest[0], rest[1], rest[2]].sort((x, y) => y - x);
}

function bestLow(hole: readonly Card[], board: readonly Card[]): number[] | null {
  const bl = board.map(lowRank).filter((r) => r > 0);
  let best: number[] | null = null;
  for (let i = 0; i < hole.length; i++)
    for (let j = i + 1; j < hole.length; j++) {
      const l = lowWith(lowRank(hole[i]), lowRank(hole[j]), bl);
      if (l && (!best || compareLow(l, best) < 0)) best = l;
    }
  return best;
}

/** Unseen copies of each low rank (index 1..8) given the board and hero. */
function unseenLowCounts(hole: readonly Card[], board: readonly Card[]): number[] {
  const n = [0, 4, 4, 4, 4, 4, 4, 4, 4];
  for (const c of [...hole, ...board]) {
    const r = lowRank(c);
    if (r > 0) n[r]--;
  }
  return n;
}

/**
 * Hi-lo: does hero hold the nut low? Hero's best low is at least as good as
 * any low two unseen ranks make with this board (a tie is possible; that is
 * the quarter, priced by the caller).
 */
export function riverHeroNutLow(hole: readonly Card[], board: readonly Card[]): boolean {
  const mine = bestLow(hole, board);
  if (!mine) return false;
  const bl = board.map(lowRank).filter((r) => r > 0);
  const n = unseenLowCounts(hole, board);
  for (let a = 1; a <= 8; a++)
    for (let b = a + 1; b <= 8; b++) {
      if (n[a] <= 0 || n[b] <= 0) continue;
      const l = lowWith(a, b, bl);
      if (l && compareLow(l, mine) < 0) return false;
    }
  return true;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * Hi-lo: the chance a random holding of `holeCount` unseen cards makes an
 * 8-or-better low with this board. Exact over the public cards and hero's
 * own (a combinatorial count over which low ranks the holding contains); the
 * opponent's real range is played, not random, so the caller treats this as
 * a floor and demands it be small.
 */
export function riverOpponentLowChance(
  hole: readonly Card[],
  board: readonly Card[],
  holeCount: number
): number {
  const bl = board.map(lowRank).filter((r) => r > 0);
  if (new Set(bl).size < 3) return 0;
  const n = unseenLowCounts(hole, board);
  const unseen = 52 - hole.length - board.length;
  const lowUnseen = n.slice(1).reduce((x, y) => x + Math.max(0, y), 0);
  const high = unseen - lowUnseen;
  const total = choose(unseen, holeCount);
  if (!(total > 0)) return 0;
  let withLow = 0;
  for (let mask = 1; mask < 256; mask++) {
    const ranks: number[] = [];
    for (let r = 1; r <= 8; r++) if (mask & (1 << (r - 1))) ranks.push(r);
    if (ranks.length < 2 || ranks.length > holeCount) continue;
    let low = false;
    for (let i = 0; i < ranks.length && !low; i++)
      for (let j = i + 1; j < ranks.length && !low; j++) low = !!lowWith(ranks[i], ranks[j], bl);
    if (!low) continue;
    // Coefficient of x^holeCount in prod_{r in ranks}((1+x)^n_r - 1) * (1+x)^high.
    let poly = [1];
    for (const r of ranks) {
      const f: number[] = [];
      for (let j = 0; j <= Math.max(0, n[r]); j++) f.push(j === 0 ? 0 : choose(n[r], j));
      const next = new Array(Math.min(holeCount, poly.length + f.length - 2) + 1).fill(0);
      for (let i = 0; i < poly.length; i++)
        for (let j = 0; j < f.length; j++) if (i + j <= holeCount) next[i + j] += poly[i] * f[j];
      poly = next;
    }
    let ways = 0;
    for (let i = 0; i < poly.length; i++) ways += poly[i] * choose(high, holeCount - i);
    withLow += ways;
  }
  return Math.max(0, Math.min(1, withLow / total));
}

/** Which story hero's line tells on this river, or 'none'. */
/** Which story hero's line tells on this river, or 'none'. Every story is
 *  told by flop, turn and river actions alone (a preflop raise is never
 *  enough), which is what lets a bomb pot - no preflop street - use it. */
export function riverBluffLine(spot: RiverBluffSpot): RiverBluffLine {
  const h = spot.history;
  const heroTurnBet = h.some(
    (a) => a.stage === 'turn' && a.userId === spot.heroId && aggressive(a)
  );
  const oppTurnCall = h.some(
    (a) => a.stage === 'turn' && a.userId === spot.opponentId && a.action === 'call'
  );
  const oppRaisedLate = h.some(
    (a) =>
      (a.stage === 'turn' || a.stage === 'river') &&
      a.userId === spot.opponentId &&
      (a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true))
  );
  // A turn raise by the opponent uncaps their range; the bet is not a story.
  if (oppRaisedLate) return 'none';
  const scareStory = spot.scareCard && (spot.nutBlocker || spot.riverHelpsHero);
  if (spot.initiative === 'hero') {
    if (heroTurnBet && oppTurnCall) return 'barrel';
    // Hero bet the flop and the turn checked through: a delayed river bet.
    const heroFlopBet = h.some(
      (a) => a.stage === 'flop' && a.userId === spot.heroId && aggressive(a)
    );
    if (heroFlopBet) return 'initiative';
  }
  // Hero checked behind (or nobody bet) the turn: both ranges are capped.
  if (streetCheckedThrough(h, 'turn')) return 'checkedThrough';
  // Out of position, first to act, into the player who bet the turn.
  if (
    spot.leadRange !== false &&
    !spot.inPosition &&
    spot.board?.length === 5 &&
    riverLeadSpot(spot)
  ) {
    if (spot.omaha && boardPaired(spot.board)) return 'none';
    return riverCompletedDraw(spot.board, spot.omaha) ? 'leadDraw' : 'leadBlank';
  }
  // The opponent bet the turn, hero called, and the opponent checked the
  // river to hero: they gave up. In position that is the classic stab.
  if (spot.initiative === 'opp' && spot.inPosition) {
    const oppCheckedRiver = h.some(
      (a) => a.stage === 'river' && a.userId === spot.opponentId && a.action === 'check'
    );
    if (oppCheckedRiver) return 'opponentGaveUp';
  }
  if (scareStory) return 'scare';
  return 'none';
}

function selectionOf(
  nutBlocker: boolean,
  missedDraw: boolean
): Exclude<RiverBluffSelection, 'freeroll'> {
  return nutBlocker && missedDraw
    ? 'blockerAndDraw'
    : nutBlocker
      ? 'blocker'
      : missedDraw
        ? 'missedDraw'
        : 'junk';
}

/** Is this a qualified river-bluff candidate, and which kind. */
export function riverBluffEligibility(spot: RiverBluffSpot): RiverBluffEligibility {
  const gameTypes: RiverBluffGameType[] = [];
  if (spot.fixedLimit) gameTypes.push('fixedLimit');
  if (spot.shortDeck) gameTypes.push('shortDeck');
  if (spot.bombPot) gameTypes.push('bombPot');
  if (spot.multiBoard) gameTypes.push('multiBoard');
  // Every board the bluff must fold out. A multi-board spot without its
  // boards cannot be read on each of them: it stays with the layers below.
  const boards: readonly Card[][] = spot.multiBoard ? (spot.boards ?? []) : [spot.board];
  const perBoard = boards.map((b, i) => {
    const draw = riverMissedDraw(spot.hole, b, spot.omaha, spot.shortDeck);
    const blocks = spot.multiBoard ? spot.nutBlockerByBoard?.[i] === true : spot.nutBlocker;
    const unb = !spot.omaha && riverFlushUnblocker(spot.hole, b);
    const sel = selectionOf(blocks, draw);
    return {
      draw,
      unb,
      sel,
      weight: RIVER_BLUFF_WEIGHTS[sel] + (unb ? RIVER_BLUFF_WEIGHTS.unblockerBonus : 0),
    };
  });
  // The board the bluff is weakest on names the selection; the weight is the
  // average over every board.
  let weakest = 0;
  for (let i = 1; i < perBoard.length; i++)
    if (perBoard[i].weight < perBoard[weakest].weight) weakest = i;
  const missedDraw = perBoard.length > 0 && perBoard.every((b) => b.draw);
  const unblocker = perBoard.length > 0 && perBoard.every((b) => b.unb);
  const selection: RiverBluffSelection = perBoard[weakest]?.sel ?? 'junk';
  const selectionWeight =
    perBoard.length > 0
      ? perBoard.reduce((n, b) => n + b.weight, 0) / perBoard.length
      : RIVER_BLUFF_WEIGHTS.junk;
  const out = (reason: RiverBluffEligibility['reason'], line: RiverBluffLine = 'none') => ({
    eligible: reason === 'eligible',
    reason,
    line,
    selection,
    missedDraw,
    unblocker,
    boardCount: Math.max(1, boards.length),
    selectionWeight,
    gameTypes,
  });
  const holeOk = spot.omaha ? [4, 5, 6].includes(spot.holeCount) : spot.holeCount === 2;
  const pathOff = gameTypes.some((t) => spot.paths?.[t] === false);
  const multiBoardOk =
    !spot.multiBoard ||
    (boards.length >= 2 &&
      boards.every((b) => b.length === 5) &&
      (spot.boardEquities?.length ?? 0) === boards.length &&
      (spot.nutBlockerByBoard?.length ?? 0) === boards.length);
  if (
    spot.board.length !== 5 ||
    !holeOk ||
    spot.hole.length !== spot.holeCount ||
    pathOff ||
    !multiBoardOk ||
    (spot.hiLo &&
      spot.lowPossible &&
      (spot.hiLoRange === false ||
        spot.multiBoard ||
        !(Number.isFinite(spot.hiShare) && spot.omaha)))
  )
    return out('domain');
  if (spot.opponentsLive !== 1) return out('multiway');
  if (!spot.opponentCanRespond) return out('cannot_respond');
  if (spot.hiLo && spot.lowPossible) {
    // The high half: a share of 0.25 or more is showdown value.
    if (!((spot.hiShare as number) < RIVER_BLUFF_AIR_EQUITY)) return out('showdown_value');
    const quarterShare = Number.isFinite(spot.quarterShare) ? (spot.quarterShare as number) : 0;
    const lineHl = riverBluffLine(spot);
    if (riverHeroNutLow(spot.hole, spot.board)) {
      // Called by a better high it splits as a check would; a fold scoops.
      return {
        ...out('eligible', lineHl),
        selection: 'freeroll',
        hiLo: { kind: 'freeroll', oppLowChance: 0, quarterShare },
      };
    }
    // A low that is not the nut still owns half of the pot often enough.
    if (bestLow(spot.hole, spot.board) !== null) return out('showdown_value');
    const oppLowChance = riverOpponentLowChance(spot.hole, spot.board, spot.holeCount);
    if (oppLowChance > RIVER_BLUFF_HILO_MAX_OPP_LOW || lineHl === 'none')
      return {
        ...out('low_giveaway', lineHl),
        hiLo: { kind: 'scoop', oppLowChance, quarterShare },
      };
    return { ...out('eligible', lineHl), hiLo: { kind: 'scoop', oppLowChance, quarterShare } };
  }
  if (!(spot.equity < RIVER_BLUFF_AIR_EQUITY)) return out('showdown_value');
  // Multi-board: showdown value on ANY board is showdown value (that board
  // alone wins its share of the pot); the bluff needs air on every one.
  if (spot.multiBoard && !spot.boardEquities!.every((e) => e < RIVER_BLUFF_AIR_EQUITY))
    return out('showdown_value');
  const line = riverBluffLine(spot);
  if (line === 'none') return out('no_story', line);
  return out('eligible', line);
}

export interface RiverBluffReads {
  /** credible station (isStation) or a measured fold-to-river-bet under 35% */
  station: boolean;
  /** HorseMind.riverFoldRate, or null without a sample */
  riverFoldRate: number | null;
  /** the V53 frequency against a credible over-folder (0 without a read) */
  overFolderFrequency: number;
  /** HorseMind.exploit(...).bluffMod (1 = neutral) */
  bluffMod: number;
  /** the shown light-river-caller read: 0.70-0.85 when credible, else 1 */
  lightCallerFactor?: number;
}

/** The reshaping a read applies to the baseline. 1 without a read. */
export function riverBluffReadFactor(reads: RiverBluffReads): number {
  if (reads.station) return RIVER_BLUFF_STATION_FACTOR;
  let f = 1;
  if (reads.riverFoldRate !== null && Number.isFinite(reads.riverFoldRate)) {
    f *= 1 + Math.max(-0.6, Math.min(0.6, (reads.riverFoldRate - 0.45) * 1.5));
  }
  if (Number.isFinite(reads.bluffMod) && reads.bluffMod > 0) {
    f *= Math.max(0.5, Math.min(1.35, reads.bluffMod));
  }
  if (reads.lightCallerFactor !== undefined && Number.isFinite(reads.lightCallerFactor)) {
    f *= Math.max(0.5, Math.min(1, reads.lightCallerFactor));
  }
  return Math.max(RIVER_BLUFF_STATION_FACTOR, Math.min(RIVER_BLUFF_FOLDER_MAX, f));
}

/** Per-combo balanced bluff probability at size s for this value/air mix. */
export function riverBluffBalancedProbability(
  s: number,
  valueShare: number,
  airShare: number
): number {
  if (!(s > 0) || !(valueShare > 0)) return 0;
  return (
    (s / (1 + s)) * Math.min(RIVER_BLUFF_MAX_VALUE_PER_AIR, valueShare / Math.max(0.02, airShare))
  );
}

export interface RiverBluffFrequencyInput {
  eligibility: RiverBluffEligibility;
  sizeFrac: number;
  valueShare: number;
  airShare: number;
  reads: RiverBluffReads;
  /** tournament survival premium (icmRisk); 0 in cash */
  icmRisk: number;
  /** Omaha: the opponent called two pot-limit barrels and the river did not
   *  move the ranges to hero */
  omahaThirdBarrel: boolean;
}

/** The probability this combo bluffs. Zero only outside the owned spot. */
export function riverBluffProbability(input: RiverBluffFrequencyInput): number {
  const e = input.eligibility;
  if (!e.eligible) return 0;
  if (e.selection === 'freeroll') {
    // No read lowers it: a station calls with a better high and splits.
    let pf = RIVER_BLUFF_HILO_FREEROLL * Math.max(0, 1 - 2 * (e.hiLo?.quarterShare ?? 0));
    if (input.icmRisk > 0) pf *= Math.max(0.25, 1 - 3 * input.icmRisk);
    return Math.max(0, Math.min(RIVER_BLUFF_HILO_FREEROLL, pf));
  }
  if (e.line === 'none') return 0;
  // Never bluff-lead into the turn bettor when he is a credible station.
  if ((e.line === 'leadDraw' || e.line === 'leadBlank') && input.reads.station) return 0;
  const balanced = riverBluffBalancedProbability(input.sizeFrac, input.valueShare, input.airShare);
  let p =
    balanced * e.selectionWeight * RIVER_BLUFF_LINE[e.line] * riverBluffReadFactor(input.reads);
  // Hi-lo whole-pot bluff: it wins only when the opponent holds no low.
  if (e.hiLo?.kind === 'scoop') p *= 1 - e.hiLo.oppLowChance;
  // The range that called two pot-sized barrels is condensed, not closed.
  if (input.omahaThirdBarrel) p *= 0.5;
  if (input.icmRisk > 0) p *= Math.max(0.25, 1 - 3 * input.icmRisk);
  p = Math.min(RIVER_BLUFF_MAX_PROBABILITY, p);
  // A credible over-folder read is a floor, never a ceiling.
  if (!input.reads.station && !e.hiLo && input.reads.overFolderFrequency > p) {
    p = Math.min(0.9, input.reads.overFolderFrequency);
  }
  // A bluff must fold out every board (V36 rule 2): half on two boards, a
  // third on three. The over-folder floor is a one-board read, so it is
  // divided too.
  p /= Math.max(1, e.boardCount);
  return Math.max(0, p);
}

/**
 * The bluff size as a fraction of the pot. Pot limit: 0.6-1.0 pot (the max).
 * No limit: 0.65-1.0 pot; a polar 1.0-1.5x overbet when hero holds the nut
 * blocker and the river helped hero's range; the shove when the effective
 * stack is at most 1.5 pots and the shove is not a survival risk. `u` is one
 * uniform draw in [0, 1).
 */
export function riverBluffSize(input: {
  potLimit: boolean;
  pot: number;
  effectiveStack: number;
  nutBlocker: boolean;
  riverHelpsHero: boolean;
  icmRisk: number;
  u: number;
  /** Fixed limit: the street's one legal bet (the big bet on the river). */
  fixedLimitBet?: number | null;
}): { sizeFrac: number; shove: boolean } {
  const { pot, effectiveStack: eff } = input;
  if (!(pot > 0) || !(eff > 0)) return { sizeFrac: 0, shove: false };
  const cap = eff / pot;
  // Fixed limit has one size: the fixed bet, or all in for less.
  if (input.fixedLimitBet !== undefined) {
    const fb = input.fixedLimitBet;
    if (fb === null || !Number.isFinite(fb) || !(fb > 0)) return { sizeFrac: 0, shove: false };
    return fb >= eff ? { sizeFrac: cap, shove: true } : { sizeFrac: fb / pot, shove: false };
  }
  if (input.potLimit) {
    const s = Math.min(1, 0.6 + input.u * 0.4);
    return s >= cap ? { sizeFrac: cap, shove: true } : { sizeFrac: s, shove: false };
  }
  if (cap <= 1.5 && input.icmRisk < 0.03) return { sizeFrac: cap, shove: true };
  const polar = input.nutBlocker && input.riverHelpsHero;
  const s = polar ? 1 + input.u * 0.5 : 0.65 + input.u * 0.35;
  return s >= cap ? { sizeFrac: cap, shove: true } : { sizeFrac: s, shove: false };
}
