/**
 * HOLD'EM PERSONA POSTFLOP, PRICED (option holdemPersonaPostflopIsPriced, 2026-11-21, Horse Switch lane; default
 * OFF, read only as === true, unevaluated). Owner orders: no blanket rule decides a Horse action (2026-11-20 15:27
 * America/Chicago); every blanket rule goes off one at a time, each tested and validated (2026-11-21 02:00).
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
 * WHAT THIS OPTION DOES. In the same four spots, with the same entry conditions, the frequency comparison is
 * replaced by a comparison of expected values from the heads-up model of HorseHoldemValueAndCallsArePriced
 * (holdemPricedVerdict), against this opponent's LINE RANGE (his preflop band re-weighted by his line this hand)
 * with his MEASURED fold to a bet and bet share when checked to: each a Beta posterior (HorseOpponentExploit.statRead,
 * prior strength 6) on his decayed counters, centred on the population cell of the table's size
 * (OPPONENT_EXPLOIT_ENVELOPE, horse-population-2026-10-16). With no read the posterior IS the population cell, so an
 * unknown opponent gets the population's price, never a coin flip. No random number is drawn:
 *   cbet, stab   bet (at the site's mid size) when EV(bet) > EV(check); the check realizes equity against his
 *                line range (he has already checked to the Horse);
 *   trap         check when EV(check) >= EV of every priced bet size (the check carries his bet at his measured
 *                share and the Horse's best answer: call or a value check-raise); a tie keeps the passive option,
 *                as in holdemPricedVerdict;
 *   check_raise  raise (at the site's mid size) when EV(raise) beats fold and call; a raise is priced only as a
 *                value raise (equity above one half against the part of his range that continues).
 * When a spot is taken the site's own action follows exactly as today (sizes on the site's own hash units, the
 * downstream c-bet blocks, the V78 commit check of the check-raise). When it is declined the decision falls through
 * to the rest of the engine exactly as when today's unit misses. More than one live opponent, or no population cell
 * or an empty range: nothing is priced and the spot is declined (receipt *_unpriced).
 *
 * INDEPENDENT OF THE PARENT. The option is read on its own: with it on, the four spots are priced whether
 * holdemPersonaPostflop is on, off or absent, and the persona scales are not read at them; so the blanket parent
 * can be switched off later without removing the priced child (the river full-house option, by contrast, acts only
 * under its parent). Off (absent or false): byte-identical, nothing here is read.
 *
 * STATED LIMITS (assumptions, not measurements). The model is heads-up chip EV (tournaments included: no ICM);
 * re-raises by him are left out of every value alike; realization out of position on the flop and turn is the
 * audit's 0.88 (1 in position); a draw's check-raise is not priced in the trap's check line (only a made hand's
 * value raise is), which leans the trap of a 12+ out draw toward the bet; the size priced is the midpoint of the
 * site's own size mix; the population cell is the HORSES' rates, so against a person with no read the prior is the
 * Horse figure.
 */
import type {
  HoldemPricedOption,
  HoldemPricedVerdict,
} from './HorseHoldemValueAndCallsArePriced.js';

export type HoldemPersonaPricedSpot = 'cbet' | 'stab' | 'trap' | 'check_raise';

/** The size each priced bet spot is valued at: the midpoint of the site's own size mix. */
export const HOLDEM_PERSONA_PRICED_CBET_FRACTION = 0.33; // site: 0.30 + unit x 0.06 of the pot
export const HOLDEM_PERSONA_PRICED_STAB_FRACTION = 0.67; // site: 0.62 + unit x 0.10 of the pot
/** The check-raise is valued at raise-to = bet + 0.9 x (pot + call) (site: 0.8 + unit x 0.2). */
export const HOLDEM_PERSONA_PRICED_CHECK_RAISE_FRACTION = 0.9;

const EPS = 1e-9;
const bestOf = (options: readonly HoldemPricedOption[]): number =>
  options.reduce((m, o) => Math.max(m, o.ev), Number.NEGATIVE_INFINITY);

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
