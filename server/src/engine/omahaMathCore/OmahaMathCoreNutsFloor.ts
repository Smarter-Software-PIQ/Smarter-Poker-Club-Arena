/**
 * Current-nuts call floor inside omahaMathCore (lane CORE-POOLED-2, Nov 20; owner 9:52 AM Chicago: "FIND THE LEAKS
 * AND FIX IT... NOW"). Held-out hands 60252841 and 60256424 (PLO5 flop, multiway): the core's multi-street value
 * plan turned a call into a fold while the hero held the current nuts. On the flop and turn, facing a wager with a
 * call available, a hand that no unseen two cards beat is never folded: the core prices only the call and the
 * raises. Public information only (the hero's own cards and the board), the same for every player.
 */
import { eval5, omahaBest } from './OmahaMathCoreEval.js';

/** On: the fold is not a candidate for the current nuts facing a flop/turn wager (call or raise only). */
export const CURRENT_NUTS_CALL_FLOOR = true;

/**
 * True when no two cards outside the hero's hand and the board make a better Omaha high hand (exactly two hole
 * cards and three board cards) than the hero's best hand on this board. Exact enumeration, never sampled.
 */
export function holdsCurrentNuts(hole: readonly number[], board: readonly number[]): boolean {
  if (hole.length < 4 || board.length < 3 || board.length > 5) return false;
  const used = new Uint8Array(52);
  for (const c of hole) used[c] = 1;
  for (const c of board) used[c] = 1;
  const hero = omahaBest(hole, hole.length, board, board.length);
  if (!(hero >= 0)) return false;
  const live: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) live.push(c);
  const b = board.length;
  for (let x = 0; x < b - 2; x++)
    for (let y = x + 1; y < b - 1; y++)
      for (let z = y + 1; z < b; z++)
        for (let i = 0; i < live.length - 1; i++)
          for (let j = i + 1; j < live.length; j++)
            if (eval5(live[i], live[j], board[x], board[y], board[z]) > hero) return false;
  return true;
}
