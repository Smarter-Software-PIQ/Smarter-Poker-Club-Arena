/**
 * FIXED-LIMIT CALL PRICE (2026-11-14, Fixed-Limit lane; opt-in
 * HorseDecideOpts.fixedLimitCallIsNotACommitment, default OFF).
 *
 * The no-limit commitment test (HorseLogic committedLegacy: a stack-to-pot
 * ratio under 1.2, or 30 percent of the stack already in) prices a call as a
 * stack-off: pot odds plus 0.02 plus the V20 multiway commit bar (up to 0.12)
 * plus the raised-class shades. A fixed-limit call does not commit a stack.
 * What it costs is the chips to call now plus whatever further wagers this
 * street can still bring: a raise by a player left to act behind, as long as
 * the street is not capped. That is what this module prices; there is no
 * stack-to-pot or invested-share term in it. The stack enters only as the
 * most a caller can still be asked to put in (a caller who is all in after
 * the call faces nothing more).
 *
 * The next street's wager is not added here. The V38 flop/turn verdict that
 * consumes this price models later streets with its own realization factor
 * (and, when barrelContinuationOutlook is on, its continuation model); the
 * river has no next street.
 *
 * Required equity:
 *   closing call (no live player left to act behind, the street capped, or
 *   the caller all in after calling):
 *       bare = toCall / ((pot + toCall) * (1 - deduction))      [pot odds plus rake]
 *   otherwise, with p = 1 - (1 - FIXED_LIMIT_RAISE_BEHIND_RATE)^playersBehind
 *   the chance at least one player behind raises, and e the expected further
 *   wagers the caller must match before the street closes,
 *       e = unit * (p + p^2 + ... + p^wagersLeft), at most the stack left,
 *       required = (toCall + e) / ((pot + toCall + 2e) * (1 - deduction))
 *   The 2e is the raiser's wager plus the caller's matching one; overcalls
 *   by others would enlarge the pot and are left out, so the price is never
 *   understated. required > bare whenever the pot before the call exceeds
 *   the call (pot > toCall), which a facing-a-bet pot always does.
 *
 * FIXED_LIMIT_RAISE_BEHIND_RATE is a stated assumption, not a measurement:
 * how often a fixed-limit player behind raises after a call has not been
 * measured from recorded hands (docs/HORSE-DECISION-CHANGE-EVIDENCE.md row 4,
 * Continuation). That is one of the reasons the option is default off.
 */
import { FIXED_LIMIT_MAX_WAGERS, fixedLimitWagerCount } from './BettingStructure.js';
import type { ActionRecord, HandStage } from '../types.js';

/** Per live player left to act behind the caller, the chance he raises one
 *  wager on an uncapped fixed-limit street. ASSUMED, not measured. */
export const FIXED_LIMIT_RAISE_BEHIND_RATE = 0.12;

export interface FixedLimitRemainingAction {
  /** Live opponents (not folded, not all in, not sitting out) who still act
   *  on this street after the caller: they owe chips or have not acted yet. */
  playersBehind: number;
  /** Wagers the street can still take before the cap (0 = capped). */
  wagersLeft: number;
}

export function fixedLimitRemainingAction(o: {
  players: ReadonlyArray<{
    seat: number;
    bet?: number;
    is_folded?: boolean;
    is_all_in?: boolean;
    is_sitting_out?: boolean;
    user_id?: string;
  }>;
  heroSeat: number;
  currentBet: number;
  stage: HandStage;
  actionHistory: readonly ActionRecord[] | undefined;
  wagersCapped?: boolean;
}): FixedLimitRemainingAction {
  const history = o.actionHistory ?? [];
  const actedThisStreet = new Set<string>();
  for (const a of history)
    if (a && a.stage === o.stage && a.origin !== 'forced' && typeof a.userId === 'string')
      actedThisStreet.add(a.userId);
  let playersBehind = 0;
  for (const p of o.players) {
    if (p.seat === o.heroSeat || p.is_folded || p.is_all_in || p.is_sitting_out === true) continue;
    const owes = (Number(p.bet) || 0) < o.currentBet - 0.005;
    const yetToAct = typeof p.user_id === 'string' && !actedThisStreet.has(p.user_id);
    if (owes || yetToAct) playersBehind++;
  }
  const wagersLeft =
    o.wagersCapped === true
      ? 0
      : Math.max(0, FIXED_LIMIT_MAX_WAGERS - fixedLimitWagerCount([...history], o.stage));
  return { playersBehind, wagersLeft };
}

export interface FixedLimitCallPrice {
  /** Pot odds with the rake deduction: the closing-call price. */
  bare: number;
  /** The price of the call with the remaining action of the street. */
  required: number;
  /** Expected further wagers the caller matches before the street closes. */
  expectedExtra: number;
  /** No further wager can reach the caller on this street. */
  closing: boolean;
}

export function fixedLimitCallRequiredEquity(o: {
  pot: number;
  toCall: number;
  /** This street's fixed wager size. */
  unit: number;
  playersBehind: number;
  wagersLeft: number;
  /** Chips the caller still holds after calling. */
  stackAfterCall: number;
  /** Rake or call-deduction fraction of the pot (0 in tournaments). */
  deduction: number;
}): FixedLimitCallPrice {
  const d = Number.isFinite(o.deduction) ? Math.min(0.99, Math.max(0, o.deduction)) : 0;
  const toCall = Math.max(0, o.toCall);
  const pot = Math.max(0, o.pot);
  const denom = (pot + toCall) * (1 - d);
  const bare = denom > 0 ? toCall / denom : 0;
  const closing =
    !(o.playersBehind > 0) || !(o.wagersLeft > 0) || !(o.stackAfterCall > 0) || !(o.unit > 0);
  if (closing) return { bare, required: bare, expectedExtra: 0, closing: true };
  const p = 1 - Math.pow(1 - FIXED_LIMIT_RAISE_BEHIND_RATE, o.playersBehind);
  let e = 0;
  let pk = 1;
  for (let k = 1; k <= o.wagersLeft; k++) {
    pk *= p;
    e += o.unit * pk;
  }
  e = Math.min(e, o.stackAfterCall);
  const denomBehind = (pot + toCall + 2 * e) * (1 - d);
  const required = denomBehind > 0 ? (toCall + e) / denomBehind : bare;
  return { bare, required, expectedExtra: e, closing: false };
}
