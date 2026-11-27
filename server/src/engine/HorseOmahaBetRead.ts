/**
 * THE PER-OPPONENT BET READ (omahaBetReadIsPerOpponent, default OFF; EMERG lane CR2, 2026-11-20).
 *
 * LIVEGRADE CR-2 (PLO5 heads-up, Nov 17-19, real cards): Horse folds to one frequent bettor's wagers forgo
 * +15.9 +/- 3.5 bb each (n 640); folds to another person's wagers are correct (-8.6 +/- 5.7, n 106). The
 * facing-bet verdicts price every bettor's bluff share with the POPULATION prior for the street and size: the
 * only per-person composition input (OmahaFacingBetEvRead.sizeShown) was a stub no learner ever wrote
 * (OPEN-ITEMS L13). This module is that read, built and applied by ONE rule for every opponent (person or Horse).
 *
 * WHAT IS KEPT, per opponent and game (PLO4 / PLO5 cash, table and Lightning together), by street (flop, turn,
 * river) and size bucket of the FIRST bet of the street (share of the pot before the bet: small <= 0.505,
 * mid <= 0.805, big above; raises are not kept):
 *   bets   how many such bets he made;
 *   seen   on how many hands he acted on that street (the bet frequency's denominator);
 *   shown  how many of those bets ended with his hand tabled at showdown;
 *   value  how many of the shown ones were VALUE when the bet was made: his shown hole cards with the board AS
 *          IT WAS ON THAT STREET (exactly two hole and three board cards) beat at least OMAHA_BET_READ_VALUE_BEATS
 *          of the holdings of his own size drawn from the unseen cards (card-seeded sample).
 * The same counts summed over every PERSON (the action log's origin; the facing-bet priors the read moves are
 * measured on persons' bets) are the POPULATION cell. Every count ages (recency weighting): each street
 * a player acts on multiplies his cells of that street by OMAHA_BET_READ_DECAY first, and the population's by
 * OMAHA_BET_READ_POP_DECAY, so bets / seen stays a frequency on one clock.
 *
 * PUBLIC ONLY. Cards enter only from a showdown reveal (the hand's public record: hand_history.hole_cards, which
 * stores revealed holdings only, or the live completed-hand observation's shownHoleCards, filled from the same
 * reveal), and only for a player the showdown lists as not mucked. A folded or mucked hand never enters.
 *
 * LATER BARRELS. The same counts are also kept for the streets on which he had made the first bet of the previous
 * street (cells2 / seen2): what his second and third barrels contained when shown, and how often he fires them.
 *
 * SCOPE OF THE READ (lead 12:22 AM Chicago Nov 20, from LIVEGRADE-2's measured realization of Horse calls: flop
 * .56, turn .71, river .98): it answers for the river at every size, and for a later barrel on the turn; never the
 * flop and never a first turn bet (no first-call widening where calls realize little). HorseLogic also requires a
 * heads-up pot (offline, the multiway folds it would call lose on both days).
 *
 * THE ESTIMATE of the share of his bets in a cell that are not value, given the consumer's population prior q0. The
 * population he is read against is every OTHER person (leave one out: one regular can be most of a cell's bets):
 *  - below OMAHA_BET_READ_MIN_SHOWN shown bets in his cell: q0 exactly (source 'population');
 *  - SHOWN signal (selection-bias corrected): shown hands over-represent value for every bettor, so his shown
 *    non-value share is read against the other persons' shown non-value share in the same cell, never as a raw
 *    share: qS = q0 * sHim / sPop, sHim shrunk toward sPop by OMAHA_BET_READ_PRIOR_SHOWN pseudo-observations (and
 *    qS = q0 while the others have fewer than OMAHA_BET_READ_POP_MIN_SHOWN shown bets there);
 *  - FREQUENCY signal: if his value bets come at the others' rate, every bet he makes beyond their frequency is
 *    not value: qF = 1 - (1 - q0) * fPop / fHim, fHim shrunk toward fPop by OMAHA_BET_READ_PRIOR_SEEN pseudo-hands;
 *  - q = (qS + qF) / 2, clamped to [OMAHA_BET_READ_Q_MIN, OMAHA_BET_READ_Q_MAX] (source 'person').
 * The consumer prices with q in place of its population prior (OmahaFacingBetEvRead.betRead).
 *
 * Memory only, rebuilt at every boot from the same public hand rows the style read rebuilds from
 * (HorseExploitHydrator: 72 h, up to 12,000 hands; hole_cards and the board are added to that read), so the read
 * survives the daily restart without a table or a migration. PLO6, PLO8, tournaments, bomb pots and multi-board
 * hands are never learned, so they never have a read.
 *
 * MODE SPLIT (omahaBetReadIsModeSplit, default OFF; EMERG lane MODE-READ, 2026-11-20). The learner also files each
 * hand into the rows of its own public mode (table / Lightning) and keeps two more cells per street: the first bet
 * after a checked-through street (the turn stab) and his first raise of a wager he did not make. omahaBetReadModeOf
 * reads his mode cell shrunk toward his own pooled cell against the same-mode persons; omahaBetReadModeBluffShare
 * turns it into a share with the shown signal above and a CALIBRATED frequency signal (OMAHA_BET_READ_FREQ_SLOPE,
 * provenance population_all_cards_capped: an anonymous population curve fitted offline on every player's cards with
 * no player above 20% of a cell, never keyed by player). Still public only: no card argument, no unshown card.
 */
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';

export const OMAHA_BET_READ_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
export type OmahaBetReadStreet = 'flop' | 'turn' | 'river';
export type OmahaBetReadBucket = 'small' | 'mid' | 'big';
export const OMAHA_BET_READ_STREETS: readonly OmahaBetReadStreet[] = ['flop', 'turn', 'river'];
export const OMAHA_BET_READ_BUCKETS: readonly OmahaBetReadBucket[] = ['small', 'mid', 'big'];

/** Shown bets in his cell before his own evidence is used (G7 offline: 4; fit compared 4 / 6 / 8). */
export const OMAHA_BET_READ_MIN_SHOWN = 4;
/** Pseudo-observations of the population's shown non-value share behind his. */
export const OMAHA_BET_READ_PRIOR_SHOWN = 8;
/** Pseudo-hands of the population's bet frequency behind his. */
export const OMAHA_BET_READ_PRIOR_SEEN = 30;
/**
 * Each street he acts on ages his cells of that street by this factor first. Measured on the fit day (offline,
 * CR2.md): 0.99 / 0.997 / 0.999 / 0.9995 all moved fewer folds and graded worse than 1 on the 48 h data, so the
 * shipped clock is 1 and recency is the memory's own window: the boot rebuild reads the last 72 h and the engine
 * restarts daily. The population uses the same clock, so its leave-one-out subtraction is exact.
 */
export const OMAHA_BET_READ_DECAY = 1;
export const OMAHA_BET_READ_POP_DECAY = 1;
/** A shown hand is value when it beats at least this share of holdings on the board of its street. */
export const OMAHA_BET_READ_VALUE_BEATS = 0.8;
/** Holdings sampled for that share (card-seeded). */
export const OMAHA_BET_READ_VALUE_SAMPLES = 240;
/** The population cell needs this many shown bets before the shown signal is read against it. */
export const OMAHA_BET_READ_POP_MIN_SHOWN = 12;
export const OMAHA_BET_READ_Q_MIN = 0.02;
export const OMAHA_BET_READ_Q_MAX = 0.65;
/** Rows kept (least recently touched dropped first). */
export const OMAHA_BET_READ_MAX_ROWS = 20000;

export function omahaBetReadBucketOf(potFrac: number): OmahaBetReadBucket {
  return potFrac <= 0.505 ? 'small' : potFrac <= 0.805 ? 'mid' : 'big';
}

interface Cell {
  bets: number;
  shown: number;
  value: number;
  /** omahaPeoplePriorCountsHiddenBets: his bets never shown although he did not win them uncontested (he folded
   *  later in the hand, or reached the showdown and mucked): public events only; read only with that option on */
  hidden: number;
}
interface Row {
  seen: Record<OmahaBetReadStreet, number>;
  cells: Record<OmahaBetReadStreet, Record<OmahaBetReadBucket, Cell>>;
  /** LATER BARRELS: the streets on which he had made the first bet of the street before and acted again (his
   *  chance to fire the next barrel), and the first bets he made on them, by size */
  seen2: Record<OmahaBetReadStreet, number>;
  cells2: Record<OmahaBetReadStreet, Record<OmahaBetReadBucket, Cell>>;
  /** omahaBetReadIsModeSplit: the streets that came after a checked-through street (nobody wagered on the street
   *  before) and the first bets he made on them, by size (the turn stab) */
  seenX: Record<OmahaBetReadStreet, number>;
  cellsX: Record<OmahaBetReadStreet, Record<OmahaBetReadBucket, Cell>>;
  /** omahaBetReadIsModeSplit: the streets on which he faced a wager he had not made, and his first raise on them */
  seenR: Record<OmahaBetReadStreet, number>;
  cellR: Record<OmahaBetReadStreet, Cell>;
}
function cell0(): Cell {
  return { bets: 0, shown: 0, value: 0, hidden: 0 };
}
const streetCells = (): Record<OmahaBetReadStreet, Record<OmahaBetReadBucket, Cell>> => ({
  flop: { small: cell0(), mid: cell0(), big: cell0() },
  turn: { small: cell0(), mid: cell0(), big: cell0() },
  river: { small: cell0(), mid: cell0(), big: cell0() },
});
const emptyRow = (): Row => ({
  seen: { flop: 0, turn: 0, river: 0 },
  cells: streetCells(),
  seen2: { flop: 0, turn: 0, river: 0 },
  cells2: streetCells(),
  seenX: { flop: 0, turn: 0, river: 0 },
  cellsX: streetCells(),
  seenR: { flop: 0, turn: 0, river: 0 },
  cellR: { flop: cell0(), turn: cell0(), river: cell0() },
});

/** The clocks in use: the exported constants; omahaBetReadFitDecay changes them for an offline fit only. */
const decay = { person: OMAHA_BET_READ_DECAY, pop: OMAHA_BET_READ_POP_DECAY };
/** OFFLINE FIT SEAM (no production caller): the clocks a fit or replay compares; called before any hand is learned. */
export function omahaBetReadFitDecay(person: number, pop: number): void {
  if (person > 0 && person <= 1 && pop > 0 && pop <= 1) {
    decay.person = person;
    decay.pop = pop;
  }
}

/** Per opponent: `${userId lower}|${variant}`; population: `*|${variant}`. */
const rows = new Map<string, Row>();
/** The rows whose streets were also counted in the population (a person's; a Horse's never are). */
const mePerson = new Set<string>();
const handsSeen = new Set<string>();
const HANDS_SEEN_MAX = 50000;

const rowKey = (userId: string, variant: string): string => `${userId.toLowerCase()}|${variant}`;
/** omahaBetReadIsModeSplit: the opponent's row of one mode (`${userId lower}|${variant}|${speed}`). */
const modeKey = (userId: string, variant: string, speed: OmahaBetReadSpeed): string =>
  `${userId.toLowerCase()}|${variant}|${speed}`;
export type OmahaBetReadSpeed = 'table' | 'lightning';
/** The hand's or decision's mode for the split read: 'table' or 'lightning', null for anything else. */
export function omahaBetReadSpeedOf(speed: unknown): OmahaBetReadSpeed | null {
  return speed === 'table' || speed === 'lightning' ? speed : null;
}
function rowOf(k: string): Row {
  let r = rows.get(k);
  if (r) rows.delete(k);
  else r = emptyRow();
  rows.set(k, r);
  while (rows.size > OMAHA_BET_READ_MAX_ROWS) rows.delete(rows.keys().next().value!);
  return r;
}

/** One action of the public action log, as hand_history and the completed-hand observation carry it. */
export interface OmahaBetReadAction {
  userId?: string;
  user_id?: string;
  action: string;
  amount?: number | null;
  stage: string;
  origin?: string;
  publicNode?: { pot?: number; toCall?: number } | null;
}

/** One completed hand, public fields only. */
export interface OmahaBetReadHand {
  handKey: string;
  variant: string;
  /** 'cash' only is learned */
  mode: 'cash' | 'tournament';
  actions: readonly OmahaBetReadAction[];
  /** the final board (one board) */
  board: readonly unknown[] | null;
  /** revealed holdings by user id (showdown reveal only) */
  shown: ReadonlyMap<string, readonly unknown[]>;
  /** the showdown list: a player not listed, or listed as mucked, never counts as shown */
  showdown?: ReadonlyArray<{ user_id: string; mucked?: boolean }> | null;
  bombPot?: boolean;
  boardCount?: number;
  /** omahaBetReadIsModeSplit: the hand's public memory domain speed ('table' or 'lightning'); absent or anything
   *  else: the hand is learned into the pooled rows only */
  speed?: string | null;
}

const RANKS = '23456789TJQKA';
const SUITS: readonly string[] = ['clubs', 'diamonds', 'hearts', 'spades'];
/**
 * A card in the engine's shape ({rank, suit}), or the stored board's text form (rank then suit name, e.g. the
 * hand_history board strings); '10' is read as 'T'. Null when not a card.
 */
export function omahaBetReadCard(c: unknown): Card | null {
  let rank: string;
  let suit: string;
  if (typeof c === 'string') {
    const name = SUITS.find((x) => c.toLowerCase().endsWith(x));
    if (!name) return null;
    rank = c.slice(0, c.length - name.length);
    suit = name;
  } else {
    if (!c || typeof c !== 'object') return null;
    rank = String((c as { rank?: unknown }).rank ?? '');
    suit = String((c as { suit?: unknown }).suit ?? '').toLowerCase();
  }
  if (rank === '10') rank = 'T';
  if (rank.length !== 1 || !RANKS.includes(rank) || !SUITS.includes(suit)) return null;
  return { rank, suit } as Card;
}

function seedOf(cards: readonly Card[]): number {
  let h = 0x811c9dc5;
  for (const c of cards.map((x) => `${x.rank}${x.suit}`).sort())
    for (let i = 0; i < c.length; i++) {
      h ^= c.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  return h >>> 0 || 1;
}

/**
 * The share of holdings of his own size (drawn from the cards unseen to him: the deck less his cards and the
 * board) that his hand beats on this board, ties counted half. Card-seeded sample: a pure function of the cards.
 */
export function omahaBetReadBeatsShare(
  hole: readonly Card[],
  board: readonly Card[]
): number | null {
  if (board.length < 3 || board.length > 5 || hole.length < 4 || hole.length > 5) return null;
  const known = new Set([...hole, ...board].map((c) => `${c.rank}${c.suit}`));
  if (known.size !== hole.length + board.length) return null;
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) if (!known.has(`${rank}${suit}`)) deck.push({ rank, suit } as Card);
  const mine = scoreOmahaHiPartial([...hole], [...board]);
  let a = seedOf([...hole, ...board]);
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = hole.length;
  const opp: Card[] = new Array(n);
  let beats = 0;
  for (let s = 0; s < OMAHA_BET_READ_VALUE_SAMPLES; s++) {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
      opp[i] = deck[i];
    }
    const v = scoreOmahaHiPartial(opp, [...board]);
    if (mine > v) beats += 1;
    else if (mine === v) beats += 0.5;
  }
  return beats / OMAHA_BET_READ_VALUE_SAMPLES;
}

const STREET_BOARD: Readonly<Record<string, number>> = { flop: 3, turn: 4, river: 5 };
/** Action origins of the Horse policy: the population cell is the PERSONS' (the facing-bet priors are measured on
 *  persons' bets), so a Horse's street is kept in his own row only. */
const HORSE_ORIGINS: ReadonlySet<string> = new Set(['horse_policy', 'horse_fallback']);

export interface OmahaBetReadIncrement {
  userId: string;
  /** the player's actions on the street came from the Horse policy (the action log's origin) */
  horse: boolean;
  /** he made the first bet of the previous street (a bet here is his second or later barrel) */
  barrelOpp: boolean;
  street: OmahaBetReadStreet;
  bet: {
    bucket: OmahaBetReadBucket;
    shown: boolean;
    value: boolean;
    /** omahaPeoplePriorCountsHiddenBets: not shown, and he folded later or the hand reached a showdown */
    hidden?: boolean;
  } | null;
  /** omahaBetReadIsModeSplit: nobody wagered on the previous postflop street (always false on the flop) */
  checkedThrough?: boolean;
  /** omahaBetReadIsModeSplit: he acted facing a wager he had not made (not the first bettor of the street) */
  facedWager?: boolean;
  /** omahaBetReadIsModeSplit: his first raise of the street, shown and value as for a bet */
  raise?: { shown: boolean; value: boolean } | null;
}

/** What one completed hand adds: per player, per street he acted on, the first bet of the street he made. Pure. */
export function omahaBetReadIncrementsOf(hand: OmahaBetReadHand): OmahaBetReadIncrement[] {
  const out: OmahaBetReadIncrement[] = [];
  const shownOf = (uid: string): Card[] | null => {
    const low = uid.toLowerCase();
    const sd = hand.showdown?.find((s) => s?.user_id?.toLowerCase() === low);
    if (!sd || sd.mucked === true) return null;
    for (const [k, v] of hand.shown)
      if (k.toLowerCase() === low) {
        const cards = v.map(omahaBetReadCard);
        return cards.every((c): c is Card => c !== null) ? (cards as Card[]) : null;
      }
    return null;
  };
  const board = (hand.board ?? []).map(omahaBetReadCard);
  const boardOk = board.every((c): c is Card => c !== null);
  let pot = 0;
  let stage = '';
  let streetBet = false;
  let acted = new Set<string>();
  let betters = new Set<string>();
  const horses = new Set<string>();
  let prevFirst: string | null = null;
  let curFirst: string | null = null;
  // omahaBetReadIsModeSplit: whether the previous postflop street was checked through, who faced a wager, and
  // each player's first raise of the street (shown / value exactly as for a bet)
  let checkedThrough = false;
  let faced = new Set<string>();
  let raisers = new Map<string, { shown: boolean; value: boolean }>();
  const valueOf = (uid: string, need: number): { shown: boolean; value: boolean } => {
    const cards = shownOf(uid);
    let value = false;
    if (cards && boardOk && board.length >= need) {
      const share = omahaBetReadBeatsShare(cards, board.slice(0, need) as Card[]);
      value = share !== null && share >= OMAHA_BET_READ_VALUE_BEATS;
    }
    return { shown: cards !== null, value };
  };
  const flush = (): void => {
    if (STREET_BOARD[stage])
      for (const uid of acted)
        if (!betters.has(uid))
          out.push({
            userId: uid,
            horse: horses.has(uid),
            barrelOpp: prevFirst === uid,
            street: stage as OmahaBetReadStreet,
            bet: null,
            checkedThrough,
            facedWager: faced.has(uid),
            raise: raisers.get(uid) ?? null,
          });
  };
  for (const a of hand.actions) {
    if (!a || typeof a.stage !== 'string') continue;
    if (a.stage !== stage) {
      flush();
      checkedThrough =
        STREET_BOARD[stage] !== undefined && STREET_BOARD[a.stage] !== undefined && !streetBet;
      prevFirst = STREET_BOARD[stage] ? curFirst : null;
      curFirst = null;
      stage = a.stage;
      streetBet = false;
      acted = new Set();
      betters = new Set();
      faced = new Set();
      raisers = new Map();
    }
    const uid = a.userId ?? a.user_id;
    if (uid && HORSE_ORIGINS.has(String(a.origin ?? ''))) horses.add(uid);
    const amount = Number.isFinite(a.amount) ? Math.max(0, a.amount as number) : 0;
    const potBefore =
      a.publicNode && Number.isFinite(a.publicNode.pot) ? (a.publicNode.pot as number) : pot;
    const need = STREET_BOARD[stage];
    if (uid && need && ['bet', 'check', 'call', 'raise', 'all_in', 'fold'].includes(a.action)) {
      const toCall =
        a.publicNode && Number.isFinite(a.publicNode.toCall)
          ? (a.publicNode.toCall as number)
          : null;
      const isFirstBet =
        !streetBet &&
        (a.action === 'bet' || (a.action === 'all_in' && (toCall === null || toCall <= 0.005)));
      if (isFirstBet && potBefore > 0 && amount > 0 && !betters.has(uid)) {
        const v = valueOf(uid, need);
        betters.add(uid);
        curFirst = uid;
        out.push({
          userId: uid,
          horse: horses.has(uid),
          barrelOpp: prevFirst === uid,
          street: stage as OmahaBetReadStreet,
          bet: { bucket: omahaBetReadBucketOf(amount / potBefore), shown: v.shown, value: v.value },
          checkedThrough,
          facedWager: false,
          raise: null,
        });
      } else if (streetBet && !betters.has(uid)) {
        // he acts facing a wager he did not make (omahaBetReadIsModeSplit's raise cell)
        faced.add(uid);
        const isRaise =
          amount > 0 &&
          (a.action === 'raise' || (a.action === 'all_in' && (toCall === null || toCall > 0.005)));
        if (isRaise && !raisers.has(uid)) raisers.set(uid, valueOf(uid, need));
      }
      if (['bet', 'raise', 'all_in'].includes(a.action) && amount > 0) streetBet = true;
      acted.add(uid);
    }
    pot += amount;
  }
  flush();
  // omahaPeoplePriorCountsHiddenBets: a bet not shown is hidden when it ended in a VOLUNTARY give-up (he checked a
  // street and then folded to a bet on it) or a muck at the showdown (he never folded, two or more players listed);
  // a fold facing a raise of his own wager is not counted (a value hand can be outdrawn or priced out), nor a bet he
  // won uncontested (public events only; lead ruling 2026-11-27)
  const foldedUids = new Set<string>();
  const giveUps = new Set<string>();
  let st = '';
  let checked = new Set<string>();
  for (const a of hand.actions) {
    if (!a || typeof a.stage !== 'string') continue;
    if (a.stage !== st) {
      st = a.stage;
      checked = new Set();
    }
    const uid = (a.userId ?? a.user_id)?.toLowerCase();
    if (!uid) continue;
    if (a.action === 'fold') {
      if (checked.has(uid)) giveUps.add(uid);
      foldedUids.add(uid);
    } else if (a.action === 'check') checked.add(uid);
  }
  const showdownHeld = (hand.showdown ?? []).filter((s) => s && s.user_id).length >= 2;
  for (const inc of out)
    if (inc.bet && !inc.bet.shown) {
      const u = inc.userId.toLowerCase();
      inc.bet.hidden = giveUps.has(u) || (!foldedUids.has(u) && showdownHeld);
    }
  return out;
}

/**
 * Learn one completed hand (idempotent per handKey). Only PLO4 / PLO5 cash, one board, no bomb pot. Never throws.
 */
export function omahaBetReadLearn(hand: OmahaBetReadHand): boolean {
  try {
    const variant = String(hand.variant ?? '').toLowerCase();
    if (!OMAHA_BET_READ_VARIANTS.has(variant) || hand.mode !== 'cash') return false;
    if (hand.bombPot === true || (hand.boardCount ?? 1) !== 1) return false;
    if (!hand.handKey || handsSeen.has(hand.handKey)) return false;
    handsSeen.add(hand.handKey);
    while (handsSeen.size > HANDS_SEEN_MAX) handsSeen.delete(handsSeen.values().next().value!);
    const incs = omahaBetReadIncrementsOf(hand);
    const pop = rowOf(`*|${variant}`);
    // omahaBetReadIsModeSplit: the same hand is also kept in the rows of its own mode (table / Lightning), the
    // opponent's and the persons' population's; a hand without a known speed goes to the pooled rows only
    const speed = omahaBetReadSpeedOf(hand.speed);
    const popMode = speed ? rowOf(`*|${variant}|${speed}`) : null;
    for (const inc of incs) {
      const me = rowOf(rowKey(inc.userId, variant));
      if (!inc.horse) mePerson.add(rowKey(inc.userId, variant));
      const meMode = speed ? rowOf(modeKey(inc.userId, variant, speed)) : null;
      if (meMode && !inc.horse && speed) mePerson.add(modeKey(inc.userId, variant, speed));
      const targets: Array<readonly [Row, number]> = [[me, decay.person]];
      if (!inc.horse) targets.push([pop, decay.pop]);
      if (meMode) targets.push([meMode, decay.person]);
      if (popMode && !inc.horse) targets.push([popMode, decay.pop]);
      for (const [r, d] of targets) {
        // one clock per row and street: every cell of the street ages with the street's opportunity count, so
        // bets / seen stays a frequency and shown / value stay on the same clock
        r.seen[inc.street] = r.seen[inc.street] * d + 1;
        for (const b of OMAHA_BET_READ_BUCKETS) {
          const c = r.cells[inc.street][b];
          c.bets *= d;
          c.shown *= d;
          c.value *= d;
          c.hidden *= d;
        }
        if (inc.bet) {
          const c = r.cells[inc.street][inc.bet.bucket];
          c.bets += 1;
          if (inc.bet.shown) c.shown += 1;
          if (inc.bet.value) c.value += 1;
          if (inc.bet.hidden === true) c.hidden += 1;
        }
        if (inc.checkedThrough === true) {
          r.seenX[inc.street] = r.seenX[inc.street] * d + 1;
          for (const b of OMAHA_BET_READ_BUCKETS) {
            const c = r.cellsX[inc.street][b];
            c.bets *= d;
            c.shown *= d;
            c.value *= d;
            c.hidden *= d;
          }
          if (inc.bet) {
            const c = r.cellsX[inc.street][inc.bet.bucket];
            c.bets += 1;
            if (inc.bet.shown) c.shown += 1;
            if (inc.bet.value) c.value += 1;
            if (inc.bet.hidden === true) c.hidden += 1;
          }
        }
        if (inc.facedWager === true) {
          r.seenR[inc.street] = r.seenR[inc.street] * d + 1;
          const c = r.cellR[inc.street];
          c.bets *= d;
          c.shown *= d;
          c.value *= d;
          c.hidden *= d;
          if (inc.raise) {
            c.bets += 1;
            if (inc.raise.shown) c.shown += 1;
            if (inc.raise.value) c.value += 1;
          }
        }
        if (inc.barrelOpp) {
          r.seen2[inc.street] = r.seen2[inc.street] * d + 1;
          for (const b of OMAHA_BET_READ_BUCKETS) {
            const c = r.cells2[inc.street][b];
            c.bets *= d;
            c.shown *= d;
            c.value *= d;
            c.hidden *= d;
          }
          if (inc.bet) {
            const c = r.cells2[inc.street][inc.bet.bucket];
            c.bets += 1;
            if (inc.bet.shown) c.shown += 1;
            if (inc.bet.value) c.value += 1;
            if (inc.bet.hidden === true) c.hidden += 1;
          }
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** What a decision reads about one bettor's bet in one cell (decayed counts). */
export interface OmahaBetRead {
  source: 'person' | 'population';
  street: OmahaBetReadStreet;
  bucket: OmahaBetReadBucket;
  /** 1: any first bet of the street (river only); 2: his second or later barrel (he bet the street before) */
  barrel: 1 | 2;
  shown: number;
  value: number;
  bets: number;
  seen: number;
  popShown: number;
  popValue: number;
  popBets: number;
  popSeen: number;
  /** omahaBetReadIsModeSplit: the read is the mode-split one (omahaBetReadModeOf); its share follows
   *  omahaBetReadModeBluffShare */
  modeSplit?: true;
  /** omahaBetReadIsModeSplit: the bettor's previous-street line ('x' checked through, 'b' he made the first wager,
   *  'c' another player did) or 'r' for his raise */
  line?: OmahaBetReadLine;
  speed?: OmahaBetReadSpeed | null;
  /** omahaBetReadIsModeSplit: the frequency-to-composition slope of the cell (OMAHA_BET_READ_FREQ_SLOPE) */
  beta?: number;
}

/** The read of one bettor's first bet of a street at this size. Null outside PLO4 / PLO5 or for a raise. */
export function omahaBetReadOf(
  userId: string | null | undefined,
  variant: string,
  street: string,
  potFrac: number,
  isRaise: boolean,
  /** the faced bet is his second or later barrel (he made the first bet of the previous street) */
  laterBarrel = false
): OmahaBetRead | null {
  const v = String(variant ?? '').toLowerCase();
  if (!userId || !OMAHA_BET_READ_VARIANTS.has(v) || isRaise || !Number.isFinite(potFrac))
    return null;
  // SCOPE (lead 12:22 AM Chicago, LIVEGRADE-2 realization): the river at every size, and a later barrel (turn or
  // river); never the flop and never a first turn bet (no first-call widening where calls realize .56 / .71)
  if (street !== 'river' && !(street === 'turn' && laterBarrel)) return null;
  const st = street as OmahaBetReadStreet;
  const bucket = omahaBetReadBucketOf(potFrac);
  const barrel: 1 | 2 = laterBarrel ? 2 : 1;
  const me = rows.get(rowKey(userId, v));
  const pop = rows.get(`*|${v}`);
  const mine = barrel === 2 ? me?.cells2 : me?.cells;
  const all = barrel === 2 ? pop?.cells2 : pop?.cells;
  const c = mine?.[st][bucket] ?? cell0();
  const pAll = all?.[st][bucket] ?? cell0();
  // LEAVE ONE OUT: he is compared with every OTHER person (one regular can be most of the population's bets in a
  // cell, and a comparison with himself would erase his own signal). A Horse is never in the population.
  const inPop = mePerson.has(rowKey(userId, v));
  const p = inPop
    ? {
        bets: Math.max(0, pAll.bets - c.bets),
        shown: Math.max(0, pAll.shown - c.shown),
        value: Math.max(0, pAll.value - c.value),
      }
    : pAll;
  const mySeen = (barrel === 2 ? me?.seen2[st] : me?.seen[st]) ?? 0;
  const popSeenAll = (barrel === 2 ? pop?.seen2[st] : pop?.seen[st]) ?? 0;
  const popSeen = inPop ? Math.max(0, popSeenAll - mySeen) : popSeenAll;
  return {
    source: c.shown >= OMAHA_BET_READ_MIN_SHOWN - 1e-9 ? 'person' : 'population',
    street: st,
    bucket,
    barrel,
    shown: c.shown,
    value: c.value,
    bets: c.bets,
    seen: mySeen,
    popShown: p.shown,
    popValue: p.value,
    popBets: p.bets,
    popSeen,
  };
}

/** Tunable constants of the estimate (fit and test seam; production uses the exported defaults). */
export interface OmahaBetReadParams {
  minShown: number;
  priorShown: number;
  priorSeen: number;
}
export const OMAHA_BET_READ_DEFAULT_PARAMS: Readonly<OmahaBetReadParams> = Object.freeze({
  minShown: OMAHA_BET_READ_MIN_SHOWN,
  priorShown: OMAHA_BET_READ_PRIOR_SHOWN,
  priorSeen: OMAHA_BET_READ_PRIOR_SEEN,
});

/**
 * THE ONE RULE: the share of his bets in this cell that are not value, from the consumer's population prior q0
 * and the read. q0 exactly when the read is absent or below the minimum sample.
 */
export function omahaBetReadBluffShare(
  q0: number,
  read: OmahaBetRead | null | undefined,
  params: Readonly<OmahaBetReadParams> = OMAHA_BET_READ_DEFAULT_PARAMS
): number {
  if (!read || !(q0 > 0) || !(q0 < 1)) return q0;
  if (read.modeSplit === true) return omahaBetReadModeBluffShare(q0, read, params);
  if (read.shown < params.minShown - 1e-9) return q0;
  let qS = q0;
  if (read.popShown >= OMAHA_BET_READ_POP_MIN_SHOWN) {
    const sPop = Math.max(0.02, Math.min(0.98, (read.popShown - read.popValue) / read.popShown));
    const sHim =
      (sPop * params.priorShown + (read.shown - read.value)) / (params.priorShown + read.shown);
    qS = (q0 * sHim) / sPop;
  }
  let qF = q0;
  if (read.popSeen > 0 && read.popBets > 0) {
    const fPop = read.popBets / read.popSeen;
    const fHim = (fPop * params.priorSeen + read.bets) / (params.priorSeen + read.seen);
    if (fHim > 0) qF = 1 - ((1 - q0) * fPop) / fHim;
  }
  const q = (qS + qF) / 2;
  return Math.max(OMAHA_BET_READ_Q_MIN, Math.min(OMAHA_BET_READ_Q_MAX, q));
}

// ───────────────────────── omahaBetReadIsModeSplit (default OFF) ─────────────────────────

export type OmahaBetReadLine = 'x' | 'b' | 'c' | 'r';

/**
 * omahaBetReadIsModeSplit: his mode cell is shrunk toward his own pooled cell by this many pseudo-chances (bet
 * frequency) and OMAHA_BET_READ_MODE_PRIOR_SHOWN pseudo-shown bets (composition); the population he is read
 * against is the persons' population OF THE SAME MODE (leave one out). Builder's choice, compared offline
 * (MODE-READ.md: 20 and 60 graded alike).
 */
export const OMAHA_BET_READ_MODE_PRIOR_SEEN = 20;
export const OMAHA_BET_READ_MODE_PRIOR_SHOWN = 4;
/** The frequency signal acts alone once his mode cell has this many chances (shrinkage included). */
export const OMAHA_BET_READ_MODE_MIN_SEEN = 20;

/**
 * FREQUENCY -> COMPOSITION CALIBRATION (provenance population_all_cards_capped). For a cell (street, his
 * previous-street line), the slope of a player's TRUE non-value share of his first bets (every player's cards
 * from the hand facts, offline) on his fire rate relative to the persons' population (his rate / theirs), one
 * point per person and week, weighted by his bets with no person above 20% of a cell's weight (the frequent
 * bettor is capped), PLO4/PLO5 cash heads-up, Oct 15 to Nov 14 2026 (MODE-READ.md, work/m2.py). Anonymous and
 * never keyed by player: a population curve. The read uses it as q = q0 + slope x (fHim / fPop - 1).
 * The raise cell has no calibrated slope (0: composition from shown raises only).
 */
export const OMAHA_BET_READ_FREQ_SLOPE: Readonly<
  Record<'turn' | 'river', Readonly<Record<OmahaBetReadLine, number>>>
> = Object.freeze({
  turn: Object.freeze({ x: 0.218, b: 0.475, c: 0.06, r: 0 }),
  river: Object.freeze({ x: 0.167, b: 0.187, c: 0.249, r: 0 }),
});
export const OMAHA_BET_READ_FREQ_SLOPE_PROVENANCE = 'population_all_cards_capped';

/**
 * omahaBetReadIsModeSplit: the realization of a heads-up turn call where the mode-split read acts (provenance
 * own_cards_history: the chips the Horses' own heads-up turn calls of persons' bets won back over their all-in
 * equity, Nov 17 to Nov 20 12:13 AM, LIVEGRADE-2: in position .84 +/- .14, out of position .60 +/- .15).
 */
export const OMAHA_BET_READ_TURN_REALIZATION: Readonly<{
  inPosition: number;
  outOfPosition: number;
}> = Object.freeze({ inPosition: 0.84, outOfPosition: 0.6 });

/**
 * omahaBetReadIsModeSplit: the bettor's previous-street line from the public action log: 'b' when he made the first
 * wager of the previous postflop street, 'c' when another player made it, 'x' when nobody wagered on it.
 */
export function omahaBetReadLineOf(
  history:
    | ReadonlyArray<{ stage?: string; seat?: number; action?: string; amount?: number }>
    | undefined,
  street: string,
  seat: number
): 'x' | 'b' | 'c' {
  const prev = street === 'river' ? 'turn' : street === 'turn' ? 'flop' : null;
  if (!prev || !Array.isArray(history)) return 'x';
  for (const a of history) {
    if (a?.stage !== prev) continue;
    if (
      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') &&
      Number(a.amount) > 0
    )
      return a.seat === seat ? 'b' : 'c';
  }
  return 'x';
}

/**
 * omahaBetReadIsModeSplit: the read of one bettor's wager in one MODE (table or Lightning), on the turn or the river:
 * his first bet of the street by his previous-street line (checked through: the stab cell; he bet before: the
 * barrel cell; otherwise every first bet of the street) and size, or his raise. His mode cell is shrunk toward his
 * own pooled cell (OMAHA_BET_READ_MODE_PRIOR_SEEN / _SHOWN); the population is the other persons of the same mode.
 * Public only (his actions and his showdown reveals). Null outside PLO4 / PLO5, off the turn and river, or when the
 * mode is unknown.
 */
export function omahaBetReadModeOf(
  userId: string | null | undefined,
  variant: string,
  street: string,
  potFrac: number,
  isRaise: boolean,
  line: 'x' | 'b' | 'c',
  speed: unknown
): OmahaBetRead | null {
  const v = String(variant ?? '').toLowerCase();
  const sp = omahaBetReadSpeedOf(speed);
  if (!userId || !sp || !OMAHA_BET_READ_VARIANTS.has(v) || !Number.isFinite(potFrac)) return null;
  if (street !== 'turn' && street !== 'river') return null;
  const st: 'turn' | 'river' = street;
  const bucket = omahaBetReadBucketOf(potFrac);
  const useLine: OmahaBetReadLine = isRaise ? 'r' : line;
  const cellOf = (r: Row | undefined): Cell =>
    !r
      ? cell0()
      : useLine === 'r'
        ? r.cellR[st]
        : useLine === 'x'
          ? r.cellsX[st][bucket]
          : useLine === 'b'
            ? r.cells2[st][bucket]
            : r.cells[st][bucket];
  const seenOf = (r: Row | undefined): number =>
    !r
      ? 0
      : useLine === 'r'
        ? r.seenR[st]
        : useLine === 'x'
          ? r.seenX[st]
          : useLine === 'b'
            ? r.seen2[st]
            : r.seen[st];
  const mineM = rows.get(modeKey(userId, v, sp));
  const mineP = rows.get(rowKey(userId, v));
  const popM = rows.get(`*|${v}|${sp}`);
  const cM = cellOf(mineM);
  const cP = cellOf(mineP);
  const sM = seenOf(mineM);
  const sP = seenOf(mineP);
  // the hierarchy: his mode cell, shrunk toward his own pooled cell
  const kSeen = sP > 0 ? OMAHA_BET_READ_MODE_PRIOR_SEEN : 0;
  const kShown = cP.shown > 0 ? Math.min(OMAHA_BET_READ_MODE_PRIOR_SHOWN, cP.shown) : 0;
  const seen = sM + kSeen;
  const bets = cM.bets + (kSeen > 0 ? (kSeen * cP.bets) / sP : 0);
  const shown = cM.shown + kShown;
  const value = cM.value + (kShown > 0 ? (kShown * cP.value) / cP.shown : 0);
  // the persons of the same mode, leave one out
  const inPop = mePerson.has(modeKey(userId, v, sp));
  const pAll = cellOf(popM);
  const popSeenAll = seenOf(popM);
  const p = inPop
    ? {
        bets: Math.max(0, pAll.bets - cM.bets),
        shown: Math.max(0, pAll.shown - cM.shown),
        value: Math.max(0, pAll.value - cM.value),
      }
    : pAll;
  const popSeen = inPop ? Math.max(0, popSeenAll - sM) : popSeenAll;
  const acts =
    shown >= OMAHA_BET_READ_MIN_SHOWN - 1e-9 || sM + kSeen >= OMAHA_BET_READ_MODE_MIN_SEEN - 1e-9;
  return {
    source: acts ? 'person' : 'population',
    street: st,
    bucket,
    barrel: useLine === 'b' ? 2 : 1,
    shown,
    value,
    bets,
    seen,
    popShown: p.shown,
    popValue: p.value,
    popBets: p.bets,
    popSeen,
    modeSplit: true,
    line: useLine,
    speed: sp,
    beta: OMAHA_BET_READ_FREQ_SLOPE[st][useLine],
  };
}

/**
 * omahaBetReadIsModeSplit's ONE RULE for every bettor: q0 exactly while the read is 'population'; otherwise the mean
 * of the signals present: the SHOWN signal of CR2 (his shown non-value share against the same-mode persons', shrunk,
 * at least OMAHA_BET_READ_MIN_SHOWN shown and OMAHA_BET_READ_POP_MIN_SHOWN for the population) and the CALIBRATED
 * FREQUENCY signal q0 + slope x (fHim / fPop - 1) (fHim shrunk toward fPop by priorSeen), clamped.
 */
export function omahaBetReadModeBluffShare(
  q0: number,
  read: OmahaBetRead,
  params: Readonly<OmahaBetReadParams> = OMAHA_BET_READ_DEFAULT_PARAMS
): number {
  if (!(q0 > 0) || !(q0 < 1) || read.source !== 'person') return q0;
  const qs: number[] = [];
  if (read.shown >= params.minShown - 1e-9 && read.popShown >= OMAHA_BET_READ_POP_MIN_SHOWN) {
    const sPop = Math.max(0.02, Math.min(0.98, (read.popShown - read.popValue) / read.popShown));
    const sHim =
      (sPop * params.priorShown + (read.shown - read.value)) / (params.priorShown + read.shown);
    qs.push((q0 * sHim) / sPop);
  }
  const beta = Number.isFinite(read.beta) ? (read.beta as number) : 0;
  if (beta !== 0 && read.popSeen > 0 && read.popBets > 0) {
    const fPop = read.popBets / read.popSeen;
    const fHim = (fPop * params.priorSeen + read.bets) / (params.priorSeen + read.seen);
    if (fPop > 0) qs.push(q0 + beta * (fHim / fPop - 1));
  }
  if (qs.length === 0) return q0;
  const q = qs.reduce((a, b) => a + b, 0) / qs.length;
  return Math.max(OMAHA_BET_READ_Q_MIN, Math.min(OMAHA_BET_READ_Q_MAX, q));
}

/** The factor a consumer applies to its population prior (exactly 1 when the read does not act). */
export function omahaBetReadRatio(q0: number, read: OmahaBetRead | null | undefined): number {
  if (!(q0 > 0) || !read || read.source !== 'person') return 1;
  return omahaBetReadBluffShare(q0, read) / q0;
}

/** TEST AND REPLAY SEAM: forget everything (a replay rebuilds from the hands before each decision). */
export function omahaBetReadReset(): void {
  rows.clear();
  handsSeen.clear();
  mePerson.clear();
}

/** Diagnostics: how many rows are held. */
export function omahaBetReadRowCount(): number {
  return rows.size;
}

/**
 * Whether the wager on `street` by `seat` is his second or later barrel: he made the first bet (bet, or all-in
 * into no bet) of the previous postflop street. Public action log only.
 */
export function omahaBetReadIsLaterBarrel(
  history:
    | ReadonlyArray<{ stage?: string; seat?: number; action?: string; amount?: number }>
    | undefined,
  street: string,
  seat: number
): boolean {
  const prev = street === 'river' ? 'turn' : street === 'turn' ? 'flop' : null;
  if (!prev || !Array.isArray(history)) return false;
  for (const a of history) {
    if (a?.stage !== prev) continue;
    if (
      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') &&
      Number(a.amount) > 0
    )
      return a.seat === seat && a.action !== 'raise';
  }
  return false;
}

/**
 * omahaFacingBetRangeIsMeasuredByLine (PLO-OWNER lead-6 2026-11-24): his OWN shown record of the first bet of this
 * street and size (no population, no comparison with anyone): the shown bets and how many were value. `laterBarrel`
 * reads the cells of a bet made after his own wager of the street before. Null with no row. Pure read.
 */
export function omahaBetReadOwnCellOf(
  userId: string | null | undefined,
  variant: string,
  street: string,
  potFrac: number,
  laterBarrel: boolean,
  /** omahaPeoplePriorCountsHiddenBets: his hidden bets count as shown not-value bets (in the record's unit) */
  countHidden = false
): { shown: number; value: number } | null {
  const v = String(variant ?? '').toLowerCase();
  if (!userId || !OMAHA_BET_READ_VARIANTS.has(v) || !Number.isFinite(potFrac)) return null;
  if (street !== 'flop' && street !== 'turn' && street !== 'river') return null;
  const me = rows.get(rowKey(userId, v));
  if (!me) return null;
  const c = (laterBarrel ? me.cells2 : me.cells)[street][omahaBetReadBucketOf(potFrac)];
  return { shown: c.shown + (countHidden ? c.hidden : 0), value: c.value };
}
