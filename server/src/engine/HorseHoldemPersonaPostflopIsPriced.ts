/**
 * HOLD'EM PERSONA POSTFLOP, PRICED — V2 EMPIRICAL PRIORS (option holdemPersonaPostflopIsPriced, 2026-11-21,
 * Horse Switch lane; default OFF, read only as === true, unevaluated). Owner orders: no blanket rule decides a
 * Horse action (2026-11-20 15:27 America/Chicago); every blanket rule goes off one at a time, each tested and
 * validated (2026-11-21 02:00).
 *
 * THE BLANKET RULE IT PRICES. Four V87 postflop spots in two-card no-limit hold'em are decided today by a fixed
 * frequency on a per-spot hash unit (v87SpotUnit), the frequency scaled by the Horse's persona when
 * holdemPersonaPostflop is on (HorseHoldemPersonaPostflop):
 *   cbet         heads-up, in position, hero's initiative, dry flop, weak hand: bet ~0.33 pot on 52% (air) or 58%
 *                (a weak pair) of spots, times the archetype's c-bet scale;
 *   stab         turn takeaway, heads-up in position after the flop stabber checked the turn: bet ~0.67 pot on
 *                min(0.9, 0.55 + probeRate x 0.6) of spots, times the archetype's stab scale;
 *   trap         out of position on the flop against a high-frequency stabber, strong top pair or better or a
 *                12+ out draw: check (to check-raise) on 42% of spots, or the persona's trap figure;
 *   check_raise  the flop check-raise into that stabber's bet: raise ~0.9 x (pot + call) on 42% of spots, or the
 *                persona's trap figure.
 * Not one of those frequencies reads the price of the action or what this opponent has shown.
 *
 * WHAT THIS OPTION DOES (V2 — measured NLH empirical priors, EMPIRICAL-PRIORS-AUDIT.md Patch 2).
 * In the same four spots, with the same entry conditions, the frequency comparison is replaced by a comparison
 * of expected values from the heads-up model of HorseHoldemValueAndCallsArePriced (holdemPricedVerdict),
 * against this opponent's LINE RANGE (his preflop band re-weighted by his line this hand) with MEASURED LIVE
 * NLH EMPIRICAL PRIORS (holdemEmpiricalPriors.ts) shrunk smoothly against his opponent reads (OpponentHud when
 * available, else HorseMind ExploitCounters with k = 6; 100% empirical pool prior at n = 0):
 *   cbet         flop c-bet fold prior conditioned on bettor IP/OOP, bet size (0.33 pot), flop texture
 *                (paired 1.091x / unpaired non-monotone 1.000x / monotone 0.780x), and effective SPR
 *                (low <3: 0.719x, mid 3..7: 1.141x, deep >=7: 1.000x); bet when EV(bet) > EV(check);
 *   stab         turn first-bet fold prior conditioned on bettor IP/OOP and size (0.67 pot); bet when
 *                EV(bet) > EV(check);
 *   trap         flop-specific betWhenCheckedTo (33.50% live NLH prior vs pooled 29.5%-31.2%) and OOP flop
 *                fold-to-bet prior (35.0% medium vs pooled 43.5%) so check vs OOP lead is unbiased; check when
 *                EV(check) >= EV of every priced bet size (a tie keeps the passive option);
 *   check_raise  dedicated NLH flop fold-to-raise prior (estimateHoldemFoldToRaisePrior, #11759)
 *                conditioned on raiseToBetRatio, raiseToPotRatio, effective SPR, all-in commitment,
 *                and OpponentHud f.fRaise/f.fBet shrinkage, mapped onto matched stack price so
 *                wagerValue recovers the exact empirical raise-fold prior; raise when EV(raise) beats
 *                fold and call as a value raise (equity > 0.5 against the continuing range).
 *
 * When a spot is taken the site's own action follows exactly as today (sizes on the site's own hash units, the
 * downstream c-bet blocks, the V78 commit check of the check-raise). When it is declined the decision falls through
 * to the rest of the engine exactly as when today's unit misses. More than one live opponent, or no population cell
 * or an empty range: nothing is priced and the spot is declined (receipt *_unpriced).
 *
 * INDEPENDENT OF THE PARENT. The option is read on its own: with it on, the four spots are priced whether
 * holdemPersonaPostflop is on, off or absent, and the persona scales are not read at them; so the blanket parent
 * can be switched off later without removing the priced child. Off (absent or false): byte-identical, nothing here
 * is read.
 */
import type { Card } from '../types.js';
import {
  HOLDEM_PRICED_FOLD_CAP,
  HOLDEM_PRICED_REFERENCE_PRICE,
  type HoldemPricedOption,
  type HoldemPricedSpot,
  type HoldemPricedVerdict,
} from './HorseHoldemValueAndCallsArePriced.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemFlopCbetFold,
  estimateHoldemFoldToRaisePrior,
  estimateHoldemTurnBetFold,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

export type HoldemPersonaPricedSpot = 'cbet' | 'stab' | 'trap' | 'check_raise';

/** The size each priced bet spot is valued at: the midpoint of the site's own size mix. */
export const HOLDEM_PERSONA_PRICED_CBET_FRACTION = 0.33; // site: 0.30 + unit x 0.06 of the pot
export const HOLDEM_PERSONA_PRICED_STAB_FRACTION = 0.67; // site: 0.62 + unit x 0.10 of the pot
/** The check-raise is valued at raise-to = bet + 0.9 x (pot + call) (site: 0.8 + unit x 0.2). */
export const HOLDEM_PERSONA_PRICED_CHECK_RAISE_FRACTION = 0.9;

const EPS = 1e-9;
const bestOf = (options: readonly HoldemPricedOption[]): number =>
  options.reduce((m, o) => Math.max(m, o.ev), Number.NEGATIVE_INFINITY);

/** Classify the first three community cards into the empirical flop texture buckets. */
export function holdemFlopTexture(board: readonly Card[]): HoldemFlopTexture | undefined {
  if (board.length < 3) return undefined;
  const [a, b, c] = board;
  if (a.suit === b.suit && b.suit === c.suit) return 'mono';
  if (a.rank === b.rank || b.rank === c.rank || a.rank === c.rank) return 'paired';
  return 'unpaired_nonmono';
}

/**
 * Replace the pooled Oct-16 `foldAtReference` and `betWhenCheckedTo` on `spot` with the street-,
 * position-, texture-, and SPR-specific measured NLH empirical priors (EMPIRICAL-PRIORS-AUDIT.md Patch 2),
 * shrunk smoothly against `hudOpp` (when available) or `counters` (`HorseMind` `ExploitCounters`).
 * Pure: returns a new `HoldemPricedSpot` without mutating the input.
 */
export function holdemPersonaPricedAdjustSpot(
  kind: HoldemPersonaPricedSpot,
  spot: HoldemPricedSpot,
  board: readonly Card[],
  target: number | null,
  hudOpp?: HoldemHudPacketOpponent | null,
  counters?: Pick<
    ExploitCounters,
    'foldToBet' | 'foldToBetOpp' | 'betCheckedTo' | 'betCheckedToOpp'
  > | null
): HoldemPricedSpot {
  const texture = holdemFlopTexture(board);
  const effSpr = Math.min(spot.heroStack, spot.villainStack) / Math.max(EPS, spot.pot);

  if (kind === 'cbet') {
    const est = estimateHoldemFlopCbetFold(
      {
        bettorInPosition: spot.inPosition,
        potFraction: HOLDEM_PERSONA_PRICED_CBET_FRACTION,
        texture,
        spr: effSpr,
        headsUp: true,
      },
      hudOpp,
      counters
    );
    // Express `est.mean` as equivalent foldAtReference at the c-bet price so holdemPricedFold recovers `est.mean`.
    const cbetPrice =
      HOLDEM_PERSONA_PRICED_CBET_FRACTION / (1 + HOLDEM_PERSONA_PRICED_CBET_FRACTION);
    const foldAtReference = Math.min(
      HOLDEM_PRICED_FOLD_CAP,
      (est.mean * HOLDEM_PRICED_REFERENCE_PRICE) / cbetPrice
    );
    return { ...spot, foldAtReference };
  }

  if (kind === 'stab') {
    const est = estimateHoldemTurnBetFold(
      {
        bettorInPosition: spot.inPosition,
        potFraction: HOLDEM_PERSONA_PRICED_STAB_FRACTION,
        headsUp: true,
      },
      hudOpp,
      counters
    );
    const stabPrice =
      HOLDEM_PERSONA_PRICED_STAB_FRACTION / (1 + HOLDEM_PERSONA_PRICED_STAB_FRACTION);
    const foldAtReference = Math.min(
      HOLDEM_PRICED_FOLD_CAP,
      (est.mean * HOLDEM_PRICED_REFERENCE_PRICE) / stabPrice
    );
    return { ...spot, foldAtReference };
  }

  if (kind === 'trap') {
    const betWhenCheckedTo = estimateHoldemBetWhenCheckedTo('flop', hudOpp, counters).mean;
    // Trap compares EV(check) against OOP flop leads (0.33..1.0 pot). Anchor foldAtReference on
    // the measured OOP medium flop fold rate (0.5 pot, price 1/3 ~ 0.337) rather than pooled IP/OOP.
    const est = estimateHoldemFlopCbetFold(
      {
        bettorInPosition: spot.inPosition,
        potFraction: 0.5,
        texture,
        spr: effSpr,
        headsUp: true,
      },
      hudOpp,
      counters
    );
    const medPrice = 0.5 / 1.5;
    const foldAtReference = Math.min(
      HOLDEM_PRICED_FOLD_CAP,
      (est.mean * HOLDEM_PRICED_REFERENCE_PRICE) / medPrice
    );
    return { ...spot, betWhenCheckedTo, foldAtReference };
  }

  // check_raise: villain faces hero's flop check-raise to `target`. Consume #11759's dedicated
  // NLH street fold-to-raise prior (`estimateHoldemFoldToRaisePrior`, conditioned on raise-to-bet
  // ratio, matched raise-to-pot ratio, effective SPR, all-in commitment, and OpponentHud
  // f.fRaise / fallback f.fBet shrinkage) and express `est.mean` as equivalent `foldAtReference`
  // at wagerValue's matched price (`matched / (matched + pot)`) so `holdemPricedFold` recovers
  // `est.mean` exactly (up to HOLDEM_PRICED_FOLD_CAP).
  if (target !== null && Number.isFinite(target) && target > spot.currentBet) {
    const add = Math.max(0, Math.min(target - spot.heroIn, spot.heroStack));
    const villainCall = Math.max(0, Math.min(target - spot.villainIn, spot.villainStack));
    const matched = Math.max(0, Math.min(add, spot.villainIn + villainCall - spot.heroIn));
    const matchedPrice = matched > 0 && spot.pot > 0 ? matched / (matched + spot.pot) : 0;
    if (matchedPrice > 0 && villainCall > 0 && spot.pot > 0) {
      const est = estimateHoldemFoldToRaisePrior({
        street: 'flop',
        raiseToBetRatio: spot.currentBet > 0 ? target / spot.currentBet : undefined,
        raiseToPotRatio: matched / spot.pot,
        opponentsInPot: 1,
        spr: effSpr,
        isAllInRaise: matched >= Math.min(spot.heroStack, spot.villainStack) - EPS,
        hudOpp,
      });
      const foldAtReference = Math.min(
        HOLDEM_PRICED_FOLD_CAP,
        (est.mean * HOLDEM_PRICED_REFERENCE_PRICE) / matchedPrice
      );
      return { ...spot, foldAtReference };
    }
  }
  return spot;
}

/**
 * Whether the priced spot takes the site's action. `target` is the legalized street total of the site's wager
 * (cbet, stab, check_raise); unused for the trap. False when the verdict lacks the option it needs.
 */
export function holdemPersonaPricedTakes(
  kind: HoldemPersonaPricedSpot,
  verdict: HoldemPricedVerdict,
  target: number | null
): boolean {
  const opts = verdict.options;
  if (kind === 'trap') {
    const check = opts.find((o) => o.kind === 'check');
    if (!check || !Number.isFinite(check.ev)) return false;
    const bets = opts.filter((o) => o.kind === 'bet' && Number.isFinite(o.ev));
    return bets.length === 0 || check.ev >= bestOf(bets) - EPS;
  }
  if (target === null || !Number.isFinite(target)) return false;
  if (kind === 'check_raise') {
    const raise = opts.find((o) => o.kind === 'raise' && Math.abs(o.to - target) < EPS);
    if (!raise || !Number.isFinite(raise.ev)) return false;
    const passive = opts.filter(
      (o) => (o.kind === 'fold' || o.kind === 'call') && Number.isFinite(o.ev)
    );
    return passive.length > 0 && raise.ev > bestOf(passive) + EPS;
  }
  const bet = opts.find((o) => o.kind === 'bet' && Math.abs(o.to - target) < EPS);
  const check = opts.find((o) => o.kind === 'check');
  if (!bet || !check || !Number.isFinite(bet.ev) || !Number.isFinite(check.ev)) return false;
  return bet.ev > check.ev + EPS;
}
