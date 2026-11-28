/**
 * WHAT ONE PLAYER'S HEADS-UP RIVER FIRST BETS TURNED OUT TO BE IN NO-LIMIT HOLD'EM CASH (PLO-OWNER lead-9, lane
 * nlof2, 2026-11-27). The Hold'em counterpart of HorseOmahaBetRead, read by holdemRiverFacingBetPriorIsPeopleMeasured
 * (default OFF) as the FIRST step of its evidence order: the bettor's own record -> people's measured cell ->
 * equilibrium.
 *
 * WHY SHOWN BETS AND NOT HOW OFTEN HE BETS. The option's first build read his record of HOW OFTEN he bets an unopened
 * river and failed its grade: a player who bets the river more often than people do may be bluffing more or betting
 * thinner value, and a frequency cannot tell the two apart (the Horses themselves bet more rivers than people, with
 * value). What his called river bets WERE tells them apart, and production shows every called river bettor (136 of
 * 136 called heads-up river first bets by people in cash, 30 days), so the shown sample of river bets carries no muck
 * bias.
 *
 * WHAT IS KEPT, per player (one rule for every player, person or Horse; nothing here knows which he is): for the
 * FIRST bet of a river with two players live, in NLH cash (table and Lightning together), one board, no bomb pot: a
 * count by his line (b: he made the last wager of the turn; c: the other player did; x: the turn was checked
 * through), the size of the bet (four cells of the pot before it) and the REGION of the hand he showed: where it
 * stood among every other two-card holding on that board (the share it beats, ties half), cut at the floors the
 * people table uses. A hand he mucked at the showdown is counted in the table's mucked region, the lower middle (it
 * lost a showdown: it is not counted as air and it is not value). A bet that won without a showdown
 * adds nothing: its cards were never seen.
 *
 * PUBLIC ONLY. Cards enter only from a showdown reveal (hand_history.hole_cards, which stores revealed holdings only,
 * or the live completed-hand observation's shown holdings, filled from the same reveal), and only for a player the
 * showdown lists as not mucked. A folded or mucked hand never enters.
 *
 * THE TURN STAB (read by holdemTurnFacingBetPriorIsPeopleMeasured, default OFF). The same count is kept for the FIRST
 * bet of a turn with two players live after a flop nobody bet, by size and the region his hand stood in ON THE TURN
 * (the four-card board). Before the river the shown sample alone over-states value (a called turn bet is shown only if
 * the hand reaches a showdown), so the bets the public record marks as not value are counted too, exactly as the
 * people table counts them: he reached the showdown and mucked (lower middle), or he gave the hand up (nobody raised
 * his turn bet, he checked the river and then folded to a bet: bottom). Still no unshown card: a hidden bet enters by
 * its public outcome only.
 *
 * Memory only, rebuilt at every boot from the same public hand rows the style read rebuilds from
 * (HorseExploitHydrator), so it needs no table and no migration. Learning changes no decision while the option is
 * off: nothing else reads the store. Pure counts; draws nothing from fastRandom.
 */
import type { Card } from '../types.js';
import { holdemCardId, packHoldemBoardBits, scoreHoldemPlus2Ids } from './HorseEval.js';
import { omahaBetReadCard, type OmahaBetReadHand } from './HorseOmahaBetRead.js';
import tables from './HorseHoldemFacingBetPeoplePriorTables.json' with { type: 'json' };

const T = tables as unknown as { regions: { from: readonly number[]; mucked: number } };
/** The floor of each region (the share of holdings a hand of that region beats, at least), strongest first. */
export const HOLDEM_BET_READ_REGION_FROM: readonly number[] = T.regions.from;
/** The region a hand mucked at the showdown is counted in. */
export const HOLDEM_BET_READ_MUCKED_REGION: number = T.regions.mucked;
export const HOLDEM_BET_READ_REGIONS: number = HOLDEM_BET_READ_REGION_FROM.length;
export type HoldemBetReadLine = 'b' | 'c' | 'x';
export const HOLDEM_BET_READ_LINES: readonly HoldemBetReadLine[] = ['b', 'c', 'x'];
export const HOLDEM_BET_READ_SIZES: readonly string[] = ['a<40', 'b40-70', 'c70-110', 'd>110'];
/** Rows kept (least recently touched dropped first). */
export const HOLDEM_BET_READ_MAX_ROWS = 20000;
const HANDS_SEEN_MAX = 50000;

/** The size cell of a bet of `ratio` pots (the people table's cells). */
export function holdemBetReadSizeIndex(ratio: number): number {
  return ratio < 0.4 ? 0 : ratio < 0.7 ? 1 : ratio <= 1.1 ? 2 : 3;
}
/** The region of a hand that beats the share `p` of the other holdings. */
export function holdemBetReadRegionOf(p: number): number {
  const from = HOLDEM_BET_READ_REGION_FROM;
  for (let r = 0; r < from.length; r++) if (p >= (from[r] as number)) return r;
  return from.length - 1;
}

/** Counts flattened: the river's [line][size][region], then the turn stab's [size][region]. */
type Row = number[];
const RIVER_SLOTS =
  HOLDEM_BET_READ_LINES.length * HOLDEM_BET_READ_SIZES.length * HOLDEM_BET_READ_REGIONS;
const SLOTS = RIVER_SLOTS + HOLDEM_BET_READ_SIZES.length * HOLDEM_BET_READ_REGIONS;
const turnSlot = (size: number, region: number): number =>
  RIVER_SLOTS + size * HOLDEM_BET_READ_REGIONS + region;
const slot = (line: number, size: number, region: number): number =>
  (line * HOLDEM_BET_READ_SIZES.length + size) * HOLDEM_BET_READ_REGIONS + region;

let rows = new Map<string, Row>();
let handsSeen = new Set<string>();

/**
 * GRADING SEAM (no production caller; the grading harness and offline replays only): the learner's whole state as
 * one opaque store, so each simulated world owns its read. Production keeps the one module store it starts with.
 */
export interface HoldemBetReadStore {
  readonly __holdemBetReadStore: true;
}
interface StoreState {
  rows: Map<string, Row>;
  handsSeen: Set<string>;
}
export function holdemBetReadNewStore(): HoldemBetReadStore {
  const st: StoreState = { rows: new Map(), handsSeen: new Set() };
  return st as unknown as HoldemBetReadStore;
}
export function holdemBetReadCloneStore(store: HoldemBetReadStore): HoldemBetReadStore {
  return structuredClone(store as unknown as StoreState) as unknown as HoldemBetReadStore;
}
/** Install `store` as the one every learn/read uses; returns the store that was installed before. */
export function holdemBetReadUseStore(store: HoldemBetReadStore): HoldemBetReadStore {
  const before: StoreState = { rows, handsSeen };
  const st = store as unknown as StoreState;
  rows = st.rows;
  handsSeen = st.handsSeen;
  return before as unknown as HoldemBetReadStore;
}
export function holdemBetReadReset(): void {
  rows = new Map();
  handsSeen = new Set();
}
export function holdemBetReadRowCount(): number {
  return rows.size;
}

/**
 * The share of every other two-card holding on this board (five cards: the river; four: the turn, the hands as they
 * stand) that the holding beats, ties half (the deck less the board and his own two cards). Null when the cards do
 * not make a turn or a river.
 */
export function holdemBetReadBeatsShare(
  hole: readonly Card[],
  board: readonly Card[]
): number | null {
  const nb = board.length;
  if (hole.length !== 2 || (nb !== 5 && nb !== 4)) return null;
  const dead = new Uint8Array(64);
  const ids = new Uint8Array(5);
  for (let i = 0; i < nb; i++) {
    const id = holdemCardId(board[i] as Card);
    if (id < 0 || dead[id]) return null;
    dead[id] = 1;
    ids[i] = id;
  }
  const h0 = holdemCardId(hole[0] as Card);
  const h1 = holdemCardId(hole[1] as Card);
  if (h0 < 0 || h1 < 0 || h0 === h1 || dead[h0] || dead[h1]) return null;
  dead[h0] = 1;
  dead[h1] = 1;
  const bits = packHoldemBoardBits(ids, nb);
  const mine = scoreHoldemPlus2Ids(bits, h0, h1, false);
  let lo = 0;
  let eq = 0;
  let n = 0;
  for (let a = 0; a < 52; a++) {
    if (dead[a]) continue;
    for (let b = a + 1; b < 52; b++) {
      if (dead[b]) continue;
      const v = scoreHoldemPlus2Ids(bits, a, b, false);
      n++;
      if (v < mine) lo++;
      else if (v === mine) eq++;
    }
  }
  return n > 0 ? (lo + eq / 2) / n : null;
}

/** What one completed hand adds: the heads-up river first bet whose bettor reached a showdown, or null. Pure. */
export interface HoldemBetReadIncrement {
  userId: string;
  line: HoldemBetReadLine;
  size: number;
  region: number;
  /** his cards were shown (false: he mucked at the showdown) */
  shown: boolean;
}
/** The turn stab one completed hand adds (the first bet of a heads-up turn after a flop nobody bet), or null. */
export interface HoldemBetReadTurnIncrement {
  userId: string;
  size: number;
  region: number;
  /** how the bet entered: his shown cards, a showdown muck, or a give-up (checked the river, folded to a bet) */
  source: 'shown' | 'mucked' | 'gaveUp';
}
const WAGERS: ReadonlySet<string> = new Set(['bet', 'raise', 'all_in']);
interface Walk {
  river: { uid: string; ratio: number; line: HoldemBetReadLine } | null;
  turn: { uid: string; ratio: number; raised: boolean; riverActs: string[] } | null;
}
/** One pass over the public action log: the river's and the turn's first bet, each kept only with two players live. */
function walk(hand: OmahaBetReadHand): Walk {
  let pot = 0;
  const seen = new Set<string>();
  const folded = new Set<string>();
  let turnLast: string | null = null;
  let flopSeen = false;
  let flopWager = false;
  let turnChips = false;
  let riverChips = false;
  const out: Walk = { river: null, turn: null };
  for (const a of hand.actions) {
    if (!a || typeof a.stage !== 'string') continue;
    const uid = a.userId ?? a.user_id;
    const amount = Number.isFinite(a.amount) ? Math.max(0, a.amount as number) : 0;
    const potBefore =
      a.publicNode && Number.isFinite(a.publicNode.pot) ? (a.publicNode.pot as number) : pot;
    const toCall =
      a.publicNode && Number.isFinite(a.publicNode.toCall) ? (a.publicNode.toCall as number) : null;
    if (uid) {
      seen.add(uid);
      const wager = WAGERS.has(a.action) && amount > 0;
      const first =
        a.action === 'bet' || (a.action === 'all_in' && (toCall === null || toCall <= 0.005));
      const live = (): number => {
        let n = 0;
        for (const u of seen) if (!folded.has(u)) n++;
        return n;
      };
      if (a.stage === 'flop') {
        flopSeen = true;
        if (wager) flopWager = true;
      }
      if (a.stage === 'turn') {
        if (wager) {
          if (out.turn && uid !== out.turn.uid) out.turn.raised = true;
          turnLast = uid;
        }
        if ((wager || a.action === 'call') && !turnChips) {
          turnChips = true;
          // the turn's first chips: a bet with two players live, after a flop that was dealt and nobody bet
          if (first && flopSeen && !flopWager && live() === 2 && potBefore > 0 && amount > 0)
            out.turn = { uid, ratio: amount / potBefore, raised: false, riverActs: [] };
        }
      }
      if (a.stage === 'river') {
        if (out.turn && uid === out.turn.uid) out.turn.riverActs.push(a.action);
        if ((wager || a.action === 'call') && !riverChips) {
          riverChips = true;
          // the river's first chips: only a bet made with exactly two players live is kept
          if (first && live() === 2 && potBefore > 0 && amount > 0)
            out.river = {
              uid,
              ratio: amount / potBefore,
              line: turnLast === null ? 'x' : turnLast === uid ? 'b' : 'c',
            };
        }
      }
      if (a.action === 'fold') folded.add(uid);
    }
    pot += amount;
  }
  return out;
}
/** His shown cards when the showdown lists him as not mucked; 'mucked' when it lists him as mucked; null otherwise. */
function revealOf(hand: OmahaBetReadHand, uid: string): Card[] | 'mucked' | null {
  const low = uid.toLowerCase();
  const sd = hand.showdown?.find((s) => s?.user_id?.toLowerCase() === low);
  if (!sd) return null;
  if (sd.mucked === true) return 'mucked';
  for (const [k, v] of hand.shown)
    if (k.toLowerCase() === low) {
      const c = v.map(omahaBetReadCard);
      return c.every((x): x is Card => x !== null) ? (c as Card[]) : null;
    }
  return null;
}
function boardOf(hand: OmahaBetReadHand, n: number): Card[] | null {
  const board = (hand.board ?? []).slice(0, n).map(omahaBetReadCard);
  return board.length === n && board.every((c): c is Card => c !== null) ? (board as Card[]) : null;
}
export function holdemBetReadIncrementOf(hand: OmahaBetReadHand): HoldemBetReadIncrement | null {
  const bet = walk(hand).river;
  if (!bet) return null;
  const reveal = revealOf(hand, bet.uid);
  if (reveal === null) return null;
  const size = holdemBetReadSizeIndex(bet.ratio);
  if (reveal === 'mucked')
    return {
      userId: bet.uid,
      line: bet.line,
      size,
      region: HOLDEM_BET_READ_MUCKED_REGION,
      shown: false,
    };
  const board = boardOf(hand, 5);
  const p = board ? holdemBetReadBeatsShare(reveal, board) : null;
  if (p === null) return null;
  return { userId: bet.uid, line: bet.line, size, region: holdemBetReadRegionOf(p), shown: true };
}
export function holdemBetReadTurnIncrementOf(
  hand: OmahaBetReadHand
): HoldemBetReadTurnIncrement | null {
  const bet = walk(hand).turn;
  if (!bet) return null;
  const size = holdemBetReadSizeIndex(bet.ratio);
  const reveal = revealOf(hand, bet.uid);
  if (reveal === 'mucked')
    return { userId: bet.uid, size, region: HOLDEM_BET_READ_MUCKED_REGION, source: 'mucked' };
  if (reveal !== null) {
    const board = boardOf(hand, 4);
    const p = board ? holdemBetReadBeatsShare(reveal, board) : null;
    if (p === null) return null;
    return { userId: bet.uid, size, region: holdemBetReadRegionOf(p), source: 'shown' };
  }
  // a give-up: nobody raised his turn bet, he checked the river and then folded
  if (!bet.raised && bet.riverActs[0] === 'check' && bet.riverActs[1] === 'fold')
    return { userId: bet.uid, size, region: HOLDEM_BET_READ_REGIONS - 1, source: 'gaveUp' };
  return null;
}

function rowOf(k: string): Row {
  let r = rows.get(k);
  if (r) rows.delete(k);
  else r = new Array<number>(SLOTS).fill(0);
  rows.set(k, r);
  while (rows.size > HOLDEM_BET_READ_MAX_ROWS) rows.delete(rows.keys().next().value!);
  return r;
}

/** Add one river first bet of `userId` to his record (the learner's only write; offline replays feed it as of a time). */
export function holdemBetReadNote(
  userId: string,
  line: HoldemBetReadLine,
  size: number,
  region: number
): void {
  const l = HOLDEM_BET_READ_LINES.indexOf(line);
  if (l < 0 || !(size >= 0 && size < HOLDEM_BET_READ_SIZES.length)) return;
  if (!(region >= 0 && region < HOLDEM_BET_READ_REGIONS)) return;
  const r = rowOf(userId.toLowerCase());
  const i = slot(l, size, region);
  r[i] = (r[i] as number) + 1;
}

/** Add one turn stab of `userId` (the first bet of a heads-up turn after a checked flop) to his record. */
export function holdemBetReadNoteTurn(userId: string, size: number, region: number): void {
  if (!(size >= 0 && size < HOLDEM_BET_READ_SIZES.length)) return;
  if (!(region >= 0 && region < HOLDEM_BET_READ_REGIONS)) return;
  const r = rowOf(userId.toLowerCase());
  const i = turnSlot(size, region);
  r[i] = (r[i] as number) + 1;
}

/** Learn one completed hand (idempotent per handKey). Only NLH cash, one board, no bomb pot. Never throws. */
export function holdemBetReadLearn(hand: OmahaBetReadHand): boolean {
  try {
    if (String(hand.variant ?? '').toLowerCase() !== 'nlh' || hand.mode !== 'cash') return false;
    if (hand.bombPot === true || (hand.boardCount ?? 1) !== 1) return false;
    if (!hand.handKey || handsSeen.has(hand.handKey)) return false;
    handsSeen.add(hand.handKey);
    while (handsSeen.size > HANDS_SEEN_MAX) handsSeen.delete(handsSeen.values().next().value!);
    const inc = holdemBetReadIncrementOf(hand);
    if (inc) holdemBetReadNote(inc.userId, inc.line, inc.size, inc.region);
    const turn = holdemBetReadTurnIncrementOf(hand);
    if (turn) holdemBetReadNoteTurn(turn.userId, turn.size, turn.region);
    return true;
  } catch {
    return false;
  }
}

/**
 * His record for a river first bet on `line` of `ratio` pots: counts by region of his shown heads-up river first bets
 * in that cell (that line, that size cell); null when he has no row. One function for everyone.
 */
export function holdemBetReadOf(
  userId: string | null | undefined,
  line: HoldemBetReadLine,
  ratio: number
): number[] | null {
  if (!userId) return null;
  const r = rows.get(userId.toLowerCase());
  if (!r) return null;
  const l = HOLDEM_BET_READ_LINES.indexOf(line);
  if (l < 0) return null;
  const s = holdemBetReadSizeIndex(ratio);
  const cell = new Array<number>(HOLDEM_BET_READ_REGIONS).fill(0);
  for (let g = 0; g < HOLDEM_BET_READ_REGIONS; g++) cell[g] = r[slot(l, s, g)] as number;
  return cell;
}

/**
 * His turn-stab record for a bet of `ratio` pots: counts by region of his first bets of a heads-up turn after a
 * checked flop in that size cell (shown, mucked or given up); null when he has no row. One function for everyone.
 */
export function holdemBetReadTurnOf(
  userId: string | null | undefined,
  ratio: number
): number[] | null {
  if (!userId) return null;
  const r = rows.get(userId.toLowerCase());
  if (!r) return null;
  const s = holdemBetReadSizeIndex(ratio);
  const cell = new Array<number>(HOLDEM_BET_READ_REGIONS).fill(0);
  for (let g = 0; g < HOLDEM_BET_READ_REGIONS; g++) cell[g] = r[turnSlot(s, g)] as number;
  return cell;
}
