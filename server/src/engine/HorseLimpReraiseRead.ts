/**
 * LIMP-RERAISE READ (2026-11-07, flag limpReraiseIsoRead).
 *
 * The exploiter suite (hx_limp_reraise, ExploiterLeague.ts) found a player who
 * limps the hands a horse would raise and re-raises 4x after a horse isolates
 * took +18.6 +/- 8.7 bb/100 at six-handed 40bb: the button isolated 39.5% of
 * hands over an under-the-gun limp and folded 69% of that to the re-raise.
 * Limping alone earned nothing; the re-raise did, and defending it like a
 * 3-bet did not help (the extra calls were lost later). The isolation range
 * itself was the leak: it is built for the population, who limp weak hands
 * and almost never limp-raise.
 *
 * HorseMind counts, per player, how often a limp met a raise behind it and
 * the action came back (OpponentStats.lrOpps), and how often the answer was
 * a re-raise (lrRaises). The rate is shrunk toward the population's
 * (LIMP_RERAISE_POPULATION_RATE, LIMP_RERAISE_PRIOR_STRENGTH pseudo-
 * observations), so a handful of hands moves nothing. Against a limper whose
 * shrunk rate is above LIMP_RERAISE_ENGAGE_RATE, the isolation bar rises
 * toward LIMP_RERAISE_ISO_BAR (the hands that can stand a 4x re-raise), fully
 * at LIMP_RERAISE_FULL_RATE; the V10 isolation widen is withdrawn against
 * him. Hands below the bar limp behind or fold as they do today. Nothing
 * changes against anyone who has not been seen to limp-raise.
 */

/** Population limp-reraise rate given the chance (humans and horses both
 *  limp weak and rarely limp-raise; the human-calibrated league field never
 *  does). */
export const LIMP_RERAISE_POPULATION_RATE = 0.05;
/** Pseudo-observations of the population rate in the shrunk estimate. */
export const LIMP_RERAISE_PRIOR_STRENGTH = 10;
/** The shrunk rate at which the read starts to narrow isolation. */
export const LIMP_RERAISE_ENGAGE_RATE = 0.12;
/** The shrunk rate at which isolation is fully narrowed. */
export const LIMP_RERAISE_FULL_RATE = 0.3;
/** The isolation bar (strength) at full engagement: about the hands a horse
 *  continues with against a 4x re-raise. Six-handed 40bb cash, the button
 *  over an under-the-gun limp isolates 12% of hands at this bar (38% off). */
export const LIMP_RERAISE_ISO_BAR = 0.58;

/** The shrunk limp-reraise rate of `raises` re-raises in `opps` chances. */
export function limpReraiseRate(raises: number, opps: number): number {
  const n = Number.isFinite(opps) && opps > 0 ? opps : 0;
  const r = Number.isFinite(raises) && raises > 0 ? Math.min(raises, n) : 0;
  return (
    (r + LIMP_RERAISE_PRIOR_STRENGTH * LIMP_RERAISE_POPULATION_RATE) /
    (n + LIMP_RERAISE_PRIOR_STRENGTH)
  );
}

/** How far the read is engaged, 0 (not at all) to 1 (fully). */
export function limpReraiseEngagement(rate: number): number {
  if (!Number.isFinite(rate) || rate <= LIMP_RERAISE_ENGAGE_RATE) return 0;
  return Math.min(
    1,
    (rate - LIMP_RERAISE_ENGAGE_RATE) / (LIMP_RERAISE_FULL_RATE - LIMP_RERAISE_ENGAGE_RATE)
  );
}

/**
 * The isolation bar against limpers whose strongest shrunk limp-reraise rate
 * is `rate`, given today's bar; today's bar (unchanged) when not engaged.
 * Never lowers a bar.
 */
export function limpReraiseIsoBar(currentBar: number, rate: number): number {
  const e = limpReraiseEngagement(rate);
  if (e <= 0 || currentBar >= LIMP_RERAISE_ISO_BAR) return currentBar;
  return currentBar + e * (LIMP_RERAISE_ISO_BAR - currentBar);
}
