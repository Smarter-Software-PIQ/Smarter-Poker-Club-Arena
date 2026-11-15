/**
 * A PLO6 TOP SET THAT IS THE CURRENT NUTS IS NOT A NON-DRAW (PLO6-AUDIT P6-4, 2026-11-14).
 *
 * Why: in the solverless flop/turn call menu (HorseLogic evaluateSpot, V38)
 * call EV is equity x realization x final pot minus the call, and the
 * realization factor (GtoFacingDefenseV32 realizationFactor) is 0.75 out of
 * position on the flop for every hand that is not a draw. That discount
 * models a marginal made hand that must give up on later streets. A top set
 * on a board with no pair, no three of a suit and no three ranks inside any
 * five-rank window is the current nuts, not that hand. At a one-third price
 * multiway the discount raises the required equity from 0.333 to 0.444, the
 * sampled range equity sits near 0.35 to 0.46, and the menu folds the nuts.
 * The PLO6 audit recorded six clear top-set folds of this shape in two days;
 * five reproduce in a reconstructed replay on current main
 * (agent-evidence extreme-archive plo6-audit-01TLQer9Hdf, phase2
 * postflop-screens s4-FINDING.md).
 *
 * Scope: this module only answers whether the hole cards hold a top set that
 * is the current nuts on a 3 or 4 card board. The caller (HorseLogic,
 * option plo6TopSetNutRealization) restricts the rule to six-card Omaha
 * high cash games on one board outside bomb pots, and changes only the
 * realization factor of that one call menu.
 *
 * Default OFF: the evidence is five cases, Horse-only, in a reconstructed
 * replay, and a pessimistic continuation model still favours the fold in
 * four of six. Turning it on needs its own evaluation and a
 * docs/horse-default-on.d evidence file.
 */
import type { Card } from '../types.js';

const RANK_ORDER = '23456789TJQKA';

function rankValue(card: Card): number {
  return RANK_ORDER.indexOf(card.rank) + 2;
}

/**
 * True iff `hole` holds two or more cards of the board's top rank and the
 * board (3 or 4 cards) permits no full house, flush or straight: no rank
 * pairs, no suit appears three or more times, and no five-rank window (ace
 * counted both low and high) holds three or more board ranks. Any other board
 * length returns false.
 */
export function plo6TopSetIsCurrentNuts(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length < 3 || board.length > 4) return false;
  const ranks = board.map(rankValue);
  if (new Set(ranks).size !== ranks.length) return false;
  const suitCounts = new Map<string, number>();
  for (const c of board) {
    const n = (suitCounts.get(c.suit) ?? 0) + 1;
    if (n >= 3) return false;
    suitCounts.set(c.suit, n);
  }
  const present = new Set(ranks);
  if (present.has(14)) present.add(1);
  for (let lo = 1; lo <= 10; lo++) {
    let inWindow = 0;
    for (let r = lo; r < lo + 5; r++) if (present.has(r)) inWindow++;
    if (inWindow >= 3) return false;
  }
  const top = Math.max(...ranks);
  let held = 0;
  for (const c of hole) if (rankValue(c) === top) held++;
  return held >= 2;
}
