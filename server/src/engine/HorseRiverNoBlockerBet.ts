/**
 * horseRiverNoBlockerBet (lane RIVER-BLOCK 2026-11-19, default OFF): a Horse makes no river blocker bet.
 *
 * Owner order 2026-11-19 16:47 America/Chicago (verbatim): "REMOVE BLOCKER BETS ON THE RIVER FOR HORSES, THEY ARE ALMOST ALWAYS
 * WEAKNESS AND THEY ALMOST ALWAYS FOLD AFTER BLOCK BETTING TO A BIG RAISE".
 *
 * Scope: hold'em (NLH) and PLO4/PLO5 cash (PLO6 out: owner 2026-11-19 8:26 PM Chicago), one board, high only, not fixed limit, not All-In-Or-Fold, not a bomb pot; the
 * river; nothing to call; the Horse's final decision is a bet (the first bet of the street) smaller than the stated threshold share
 * of the pot (RIVER_NO_BLOCKER_BET_MIN_SHARE, measured 2026-11-19 on 7 days of production river first bets, see the authority file).
 * Tournaments are excluded by the caller (HorseLogic, isTournamentMode). The turn and every other street are never touched.
 *
 * What the small bet becomes:
 * - priced (PLO, heads-up, inside the card-impact scope, HorseOmahaCardImpact): the check against the cheapest bet at or over the
 *   threshold, on the card-impact model with the measured response of his kind (omahaSmallBetCurve when the variant is measured),
 *   the higher expected value wins and a tie checks;
 * - not priceable (hold'em, multiway, PLO outside the card-impact scope): the check, except a hand holding the river nuts by a hole
 *   card (hasRiverNuts with private value), which bets the threshold size instead (a value bet, not a blocker).
 * An all-in is never changed; a bet at or over the threshold is never changed. Pure: no fires, no writes, no random draws.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { variantInfo } from './HorseEval.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import {
  omahaCardImpact,
  omahaCardImpactLine,
  omahaCardImpactRead,
  omahaCardImpactScope,
} from './HorseOmahaCardImpact.js';
import { omahaSmallBetCurve } from './HorseOmahaSmallBet.js';

/**
 * The smallest river first bet, as a share of the pot, that is not a blocker bet. Measured 2026-11-19 (lane RIVER-BLOCK,
 * archive repairs/RIVER-BLOCK/MEASURE.md): 7 days of Horse river first bets in production cash. PLO: under 40% of the pot a raise
 * was folded to almost every time (0-15%, 15-25% and 25-40% bands) against far fewer folds over 40%. Hold'em: under 25% the same;
 * 25-40% was not raise-then-fold dominated.
 */
export const RIVER_NO_BLOCKER_BET_MIN_SHARE: Readonly<{ omaha: number; holdem: number }> =
  Object.freeze({ omaha: 0.4, holdem: 0.25 });

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ceil2 = (n: number): number => Math.ceil(n * 100 - 1e-9) / 100;

export interface RiverNoBlockerBetSpot {
  family: 'omaha' | 'holdem';
  /** the bet's share of the pot */
  share: number;
  /** the threshold share for this family */
  threshold: number;
  /** chips of the cheapest bet at or over the threshold (legal: at least the minimum bet) */
  thresholdAmount: number;
  /** the threshold bet is the whole stack (it is then an all-in) */
  thresholdAllIn: boolean;
}

/** Is this decision a river blocker bet the option governs? Null: not in scope (the decision stands). */
export function riverNoBlockerBetSpot(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2
): RiverNoBlockerBetSpot | null {
  try {
    if (decision.action !== 'bet' || !fin(decision.amount) || !(decision.amount > 0)) return null;
    if (String(gs.stage ?? '') !== 'river') return null;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    const vi = variantInfo(variant);
    if (vi.isFixedLimit || gs.bettingStructure === 'fixed_limit' || vi.isShortDeck) return null;
    if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
    const family: 'omaha' | 'holdem' | null = vi.isOmaha
      ? [4, 5].includes(vi.holeCount) // PLO6 is out (owner 2026-11-19 8:26 PM Chicago)
        ? 'omaha'
        : null
      : vi.holeCount === 2 || !fin(vi.holeCount)
        ? 'holdem'
        : null;
    if (family === null) return null;
    if (
      (gs.boardCount ?? 1) > 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0
    )
      return null;
    if ((gs.communityCards ?? []).length !== 5) return null;
    if (gs.allInOrFold === true || gs.wagersCapped === true || gs.bombPot === true) return null;
    const toCall = fin(gs.toCall)
      ? Math.max(0, gs.toCall)
      : Math.max(0, (gs.currentBet || 0) - (fin(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005 || (gs.currentBet || 0) > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    const pot = gs.pot;
    if (!fin(pot) || !(pot > 0) || !(hero.stack > 0)) return null;
    // A bet of the whole stack is an all-in: never this option's.
    if (decision.amount >= hero.stack - 0.005) return null;
    const threshold = RIVER_NO_BLOCKER_BET_MIN_SHARE[family];
    const share = decision.amount / pot;
    if (!(share < threshold - 1e-9)) return null;
    const whole = (gs.bigBlind ?? 1) >= 1;
    let amount = whole ? Math.ceil(threshold * pot - 1e-9) : ceil2(threshold * pot);
    if (fin(gs.minRaiseTo) && amount < gs.minRaiseTo) amount = gs.minRaiseTo;
    const max = Math.min(fin(gs.maxRaiseTo) ? gs.maxRaiseTo : hero.stack, hero.stack);
    const thresholdAllIn = amount >= hero.stack - 0.005;
    if (!thresholdAllIn && amount > max + 0.005) return null;
    return {
      family,
      share,
      threshold,
      thresholdAmount: thresholdAllIn ? hero.stack : amount,
      thresholdAllIn,
    };
  } catch {
    return null;
  }
}

export interface RiverNoBlockerBetVerdict {
  decision: HorseDecision;
  /** 'checked': the small bet became a check; 'resized_priced': it became the threshold bet on price; 'resized_nuts': unpriced, the
   *  river nuts bet the threshold size; null: not in scope, the decision stands */
  changed: 'checked' | 'resized_priced' | 'resized_nuts' | null;
  priced: boolean;
  spot: RiverNoBlockerBetSpot | null;
  evCheck: number | null;
  evBet: number | null;
}

function asCheck(decision: HorseDecision): HorseDecision {
  const out: HorseDecision = { ...decision, action: 'check' };
  delete out.amount;
  return out;
}

function asThresholdBet(decision: HorseDecision, spot: RiverNoBlockerBetSpot): HorseDecision {
  return spot.thresholdAllIn
    ? { ...decision, action: 'all_in', amount: undefined }
    : { ...decision, action: 'bet', amount: spot.thresholdAmount };
}

/**
 * The verdict. `read` is the pooled read of the opponent as the card-impact rule takes it (null: the model's priors).
 */
export function riverNoBlockerBetVerdict(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  read: OmahaReadConditional | null
): RiverNoBlockerBetVerdict {
  const spot = riverNoBlockerBetSpot(decision, hero, gs);
  if (!spot)
    return { decision, changed: null, priced: false, spot: null, evCheck: null, evBet: null };
  if (spot.family === 'omaha') {
    try {
      const scope = omahaCardImpactScope(hero, gs);
      if (scope && scope.street === 'river') {
        const impactRead = omahaCardImpactRead(read);
        const curve = omahaSmallBetCurve(
          String(gs.gameVariant ?? '').toLowerCase(),
          'river',
          scope.opponent.is_horse === true,
          impactRead
        );
        const impact = omahaCardImpact({
          hole: hero.cards,
          board: gs.communityCards ?? [],
          dead: hero.knownDeadCards ?? [],
          pot: gs.pot,
          heroStack: hero.stack,
          oppStack: scope.opponent.stack,
          heroCloses: scope.heroCloses,
          line: omahaCardImpactLine(hero, scope.opponent, gs),
          read: impactRead,
          amounts: [spot.thresholdAmount],
          seedSalt: scope.opponent.seat * 16 + hero.seat,
          ...(curve ? { responseAt: curve } : {}),
        });
        const check = impact?.options.find((o) => o.action === 'check');
        const bet = impact?.options.find(
          (o) => o.action !== 'check' && Math.abs(o.amount - spot.thresholdAmount) < 0.006
        );
        if (check && bet) {
          const takeBet = bet.ev > check.ev;
          return {
            decision: takeBet ? asThresholdBet(decision, spot) : asCheck(decision),
            changed: takeBet ? 'resized_priced' : 'checked',
            priced: true,
            spot,
            evCheck: check.ev,
            evBet: bet.ev,
          };
        }
      }
    } catch {
      /* not priceable: the unpriced verdict below */
    }
  }
  let nuts = false;
  try {
    nuts = hasRiverNuts(hero, gs, true);
  } catch {
    nuts = false;
  }
  return nuts
    ? {
        decision: asThresholdBet(decision, spot),
        changed: 'resized_nuts',
        priced: false,
        spot,
        evCheck: null,
        evBet: null,
      }
    : {
        decision: asCheck(decision),
        changed: 'checked',
        priced: false,
        spot,
        evCheck: null,
        evBet: null,
      };
}
