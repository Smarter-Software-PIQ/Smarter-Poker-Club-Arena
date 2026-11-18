/**
 * OMAHA TURN RIVER TABLES (2026-11-16, wave two; no decision changes).
 *
 * One exact-hand count per decision, shared by the turn and river pricing
 * rules that each used to take it themselves: omahaCardImpact (its river
 * pair tables), the street plan's turn layer, its river verdict (which
 * rebuilds the turn plan) and its three-way turn (their sampled hands' exact
 * river ranks), and the facing-bet EV's turn river sets.
 *
 * For a turn board B (four cards) and the cards the Horse cannot see U (every
 * card but his hole cards, the board and his known dead cards, in SUITS x
 * RANKS order, the order each of those modules uses):
 *   - now[i * n + j]: the best Omaha-high score of the unseen pair (i, j) on
 *     B (exactly scoreOmahaHiPartial([U_i, U_j], B));
 *   - river[r][i * n + j]: its best score on B + U_r (exactly
 *     scoreOmahaHiPartial([U_i, U_j], [...B, U_r])), 0 for a pair holding U_r.
 * Both are symmetric. A hand's exact Omaha-high river score is the largest
 * river[r] entry over its card pairs (scoreOmahaHi takes the same maximum
 * over the same five-card sets with the same evaluator).
 *
 * The river tables are built the facing-bet EV's way: a five-card set that
 * is not a flush scores by its ranks alone, so each river card is scored
 * once per rank pair with each of the six board pairs (and once more per
 * rank pair in the river card's suit where both board cards share it), and
 * every unseen pair reads its score from those small tables. The values are
 * the engine evaluator's, bit for bit.
 *
 * PER DECISION: one entry, keyed by the cards; HorseLogic clears it at the
 * start and the end of every decision (omahaClearDecisionMemos). A call from
 * outside a decision (the receipt validator, a test) is answered from the
 * entry only when its cards are the entry's.
 */
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { RANKS, RANK_VALUES, SUITS } from './PokerEngine.js';

export interface OmahaTurnRiverTables {
  unseen: Card[];
  n: number;
  now: Float64Array;
  river: Float64Array[];
}

const key = (c: Card): string => `${c.rank}${c.suit[0]}`;
const RANK_OF_VALUE: string[] = [];
for (const r of RANKS) RANK_OF_VALUE[RANK_VALUES[r]] = r;

let memo: { id: string; tables: OmahaTurnRiverTables } | null = null;

/** The tables of this turn board, or null when the cards are not a turn hand. */
export function omahaTurnRiverTables(
  hole: Card[],
  board: Card[],
  dead: Card[] = []
): OmahaTurnRiverTables | null {
  if (board.length !== 4) return null;
  const removed = new Set([...hole, ...board, ...dead].map(key));
  const id = `${[...removed].sort().join('')}|${board.map(key).join('')}`;
  if (memo !== null && memo.id === id) return memo.tables;
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const c = { rank, suit } as Card;
      if (!removed.has(key(c))) unseen.push(c);
    }
  const n = unseen.length;
  if (n < 3) return null;
  const now = new Float64Array(n * n);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < n; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < n; j++) {
      two[1] = unseen[j];
      const s = scoreOmahaHiPartial(two, board);
      now[i * n + j] = s;
      now[j * n + i] = s;
    }
  }
  const rv = new Int32Array(n);
  for (let i = 0; i < n; i++) rv[i] = RANK_VALUES[unseen[i].rank];
  const W = 16;
  const plain = new Float64Array(W * W);
  const suited = new Float64Array(W * W);
  const pair: Card[] = [board[0], board[0]];
  const three: Card[] = [board[0], board[0], board[0]];
  const river: Float64Array[] = new Array(n);
  for (let r = 0; r < n; r++) {
    const rc = unseen[r];
    plain.fill(0);
    suited.fill(0);
    let flushSuit: string | null = null;
    three[2] = rc;
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++) {
        const x = board[a];
        const y = board[b];
        three[0] = x;
        three[1] = y;
        const mono = x.suit === rc.suit && y.suit === rc.suit;
        // Not a flush: one of the pair in a suit the first board card is not.
        const off = SUITS.find((s) => s !== x.suit)!;
        for (let p = 2; p <= 14; p++) {
          pair[0] = { rank: RANK_OF_VALUE[p], suit: off } as Card;
          for (let q = p; q <= 14; q++) {
            pair[1] = { rank: RANK_OF_VALUE[q], suit: rc.suit } as Card;
            const s = scoreOmahaHiPartial(pair, three);
            if (s > plain[p * W + q]) plain[p * W + q] = s;
          }
        }
        if (!mono) continue;
        flushSuit = rc.suit;
        for (let p = 2; p <= 14; p++) {
          pair[0] = { rank: RANK_OF_VALUE[p], suit: rc.suit } as Card;
          for (let q = p + 1; q <= 14; q++) {
            pair[1] = { rank: RANK_OF_VALUE[q], suit: rc.suit } as Card;
            const s = scoreOmahaHiPartial(pair, three);
            if (s > suited[p * W + q]) suited[p * W + q] = s;
          }
        }
      }
    const t = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      if (i === r) continue;
      const ri = rv[i];
      const flushI = flushSuit !== null && unseen[i].suit === flushSuit;
      for (let j = i + 1; j < n; j++) {
        if (j === r) continue;
        const rj = rv[j];
        const at = ri <= rj ? ri * W + rj : rj * W + ri;
        let s = now[i * n + j];
        const u = plain[at];
        if (u > s) s = u;
        if (flushI && unseen[j].suit === flushSuit) {
          const v = suited[at];
          if (v > s) s = v;
        }
        t[i * n + j] = s;
        t[j * n + i] = s;
      }
    }
    river[r] = t;
  }
  const tables: OmahaTurnRiverTables = { unseen, n, now, river };
  memo = { id, tables };
  return tables;
}

/** A hand's exact Omaha-high score on the river U_r: its best pair in river[r]. */
export function omahaHandRiverScore(
  tables: OmahaTurnRiverTables,
  hand: readonly number[],
  r: number
): number {
  const t = tables.river[r];
  const n = tables.n;
  let best = 0;
  for (let x = 0; x < hand.length; x++)
    for (let y = x + 1; y < hand.length; y++) {
      const s = t[hand[x] * n + hand[y]];
      if (s > best) best = s;
    }
  return best;
}

/** Forget the entry (HorseLogic, at the start and the end of every decision; tests). */
export function omahaTurnRiverTablesClear(): void {
  memo = null;
}

/** Whether an entry is held now (HorseLogic's per-decision memo list). */
export function omahaTurnRiverTablesHeld(): boolean {
  return memo !== null;
}
