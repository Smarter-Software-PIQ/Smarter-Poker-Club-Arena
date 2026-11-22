/**
 * A TOURNAMENT HORSE DOES NOT FOLD ITS LAST CRUMBS AT A PRICE (plain bug fix,
 * HORSE DECISIONS lane builder F-FIX, 2026-11-19; no option).
 *
 * The V11 price-in guard of HorsePreflop.decidePreflopV7 already says it
 * (Dan 2026-08-22, binding: "Folding in tournaments to less than 1 BB"): a
 * tournament Horse with 2 big blinds or less behind calls a price of 0.34 or
 * better. Auditor F (archive plo-handoff-review-01a1cbbd/hvh48-audit-
 * 01TLQer7J/F-plo-tournament, REPORT.md root cause 6) found Horses folding
 * their last 0.55 to 0.92 big blinds at prices of 0.109 to 0.186 (hands
 * 84233985, 6e17fcee, 83b469ee): the guard only rewrites the fold of the V7
 * core, and the V46 class gate (`classFoldAlways`, which returns its fold
 * before the guard) and the Omaha layers after the preflop engine own those
 * folds. This floor applies the guard's own crumbs line once more at the
 * end of the decision, after every one of them, beside the short all-in
 * floor (HorseShortAllInCallFloor) in HorseLogic's `wager_rules` node and
 * on the path outside the policy graph.
 *
 * The rule, all of it public chips and price:
 *  - a pot-limit Omaha tournament hand (PLO4/PLO5/PLO6/PLO8), before the flop, the decision a FOLD with chips to
 *    call;
 *  - calling puts the Horse all in (nothing is left behind, so no later
 *    decision exists to protect) and it has the guard's crumbs line or less
 *    behind (COMMITTED_CRUMBS_BB, 2 big blinds);
 *  - the price, call / (pot + call), is at most the guard's 0.34 AND at most
 *    the share of the pot an average holding takes against the live
 *    opponents, 1 / (opponents + 1): a price no worse than what the field's
 *    average hand gets is not folded for the last chips. (The second bound
 *    keeps the floor priced in a big multiway pot, where 0.34 alone would be
 *    a blanket line.)
 *  - the fold becomes the legal call (the all in, or the call of the stack).
 * Anything else is returned as the same object.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { variantInfo } from './HorseEval.js';
import { COMMITTED_CRUMBS_BB } from './HorsePreflop.js';

/** The V11 guard's tournament crumbs price (HorsePreflop.decidePreflopV7). */
export const TOURNAMENT_CRUMBS_PRICE = 0.34;

const EPS = 0.005;
const fin = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

function isTournament(gs: HorseGameStateV2): boolean {
  if (gs.gameMode) return gs.gameMode === 'tournament';
  return gs.tournament != null;
}

/** The crumbs spot (see the header), or null. Pure. */
export function tournamentCrumbsSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): { call: number; price: number; bound: number; opponents: number } | null {
  if (!isTournament(gs) || String(gs.stage ?? '') !== 'preflop') return null;
  // Pot-limit Omaha only (PLO4/PLO5/PLO6/PLO8): the games the fold was measured in and the lane's scope;
  // the class gate it runs after is Omaha's. Other games keep their decision (their owners decide).
  const vi = variantInfo(String(gs.gameVariant ?? ''));
  if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
  const bb = fin(gs.bigBlind);
  if (!(bb > 0)) return null;
  const stack = Math.max(0, fin(hero.stack));
  const heroBet = Math.max(0, fin(hero.bet));
  const toCall =
    typeof gs.toCall === 'number' && Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall)
      : Math.max(0, fin(gs.currentBet) - heroBet);
  if (!(toCall > EPS) || !(stack > 0)) return null;
  if (toCall < stack - EPS) return null;
  if (stack / bb > COMMITTED_CRUMBS_BB + 1e-9) return null;
  const opponents = (gs.players ?? []).filter(
    (p) => p.seat !== hero.seat && p.user_id !== hero.user_id && !p.is_folded && !p.is_sitting_out
  ).length;
  if (opponents < 1) return null;
  const call = stack;
  const pot = Math.max(0, fin(gs.pot));
  const price = call / (pot + call);
  const bound = Math.min(TOURNAMENT_CRUMBS_PRICE, 1 / (opponents + 1));
  if (!(price <= bound + 1e-9)) return null;
  return { call, price, bound, opponents };
}

/** The floor: the fold in the crumbs spot becomes the legal call; anything else is returned as is. */
export function tournamentCrumbsCallFloor(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2
): HorseDecision {
  if (decision.action !== 'fold') return decision;
  const spot = tournamentCrumbsSpot(hero, gs);
  if (!spot) return decision;
  const legal = Array.isArray(gs.legalActions) ? new Set(gs.legalActions) : null;
  const called: HorseDecision = { ...decision };
  if (!legal || legal.has('all_in')) {
    called.action = 'all_in';
    delete called.amount;
  } else if (legal.has('call')) {
    called.action = 'call';
    called.amount = Math.round(spot.call * 100) / 100;
  } else return decision;
  delete called.continuationGuard;
  return called;
}
