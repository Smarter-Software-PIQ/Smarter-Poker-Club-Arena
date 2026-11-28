/**
 * THE BETTOR'S OWN RIVER BET FREQUENCY (omahaRiverBetPriorReadsHisFrequency; lead-9 lane RFQ 2026-11-27). Pure
 * arithmetic: no telemetry, no memory of its own (the caller passes his public record), no draw.
 *
 * WHY. Inside omahaFacingBetPriorIsPeopleMeasured's heads-up river price the bettor's own evidence is his SHOWN bets
 * (HorseOmahaBetRead), which a person builds slowly: most people have none or a few in a size cell, so their river
 * bets are priced at the people cell (63-64% value in single-raised pots). His public river FIRST-BET FREQUENCY is
 * known for every river he reaches, shown or not, and it orders people's river bets: people's heads-up river first
 * bets (Oct 27 - Nov 27, 26,823 hands, shown cards only, a bet is non-value when it beats more than 20% of holdings)
 * are 33% non-value from a bettor below 0.8x people's frequency, 42% at 0.8-1.0x, 49% at 1.0-1.2x and 56% above
 * 1.2x (l9-rfq/BUILD.md).
 *
 * WHAT. Value bets arrive at the rate people reach the river with value: v = f0 (1 - q0), f0 = people's heads-up
 * unopened river first-bet rate, q0 = people's non-value share of shown bets in the record's unit for the cell. His
 * frequency f, shrunk to f0 by OMAHA_RIVER_FREQ_PRIOR_OPPS pseudo-opportunities (measured between people), then says
 * his non-value share is q = 1 - v / f. That share replaces q0 as the PRIOR MEAN of his shown-bet record: his shown
 * bets still dominate as they grow (OMAHA_PEOPLE_PRIOR_RECORD_BETS pseudo-bets), so the frequency speaks where his
 * shown record is thin and fades where it is long. A frequency at or below people's never prices more value than the
 * record does: the option only turns a fold into a call (the caller applies it so), never the reverse.
 * WHERE. PLO4 / PLO5 cash, heads-up river, a BET (never a raise), single-raised and limped pots (re-raised pots are
 * omahaRiverBetPriorIsPotTypeSplit's). People-only measurement; his record is his own public actions; no identity.
 */
import {
  omahaPeoplePriorFlopPotOf,
  type OmahaPeoplePriorFlopPot,
} from './HorseOmahaPeoplePriorHidden.js';

/** People's heads-up unopened river first-bet rate (1,574 bets in 4,579 opportunities, 43 people, PLO4+PLO5). */
export const OMAHA_RIVER_FREQ_PEOPLE_RATE = 0.3437;
/** Pseudo-opportunities at people's rate behind his own record (beta-binomial k between people, n >= 20: 34.3). */
export const OMAHA_RIVER_FREQ_PRIOR_OPPS = 34;
/** The pot types the option reads. */
export const OMAHA_RIVER_FREQ_POTS: ReadonlyArray<OmahaPeoplePriorFlopPot> = ['single', 'limped'];

type Hist = Parameters<typeof omahaPeoplePriorFlopPotOf>[0];

/** True for a PLO4 / PLO5 river bet (not a raise) in a pot type the option reads. */
export function omahaRiverFrequencySpotOf(
  variant: string,
  street: string,
  isRaise: boolean,
  history: Hist
): boolean {
  const game = String(variant ?? '').toLowerCase();
  if ((game !== 'plo4' && game !== 'plo5') || street !== 'river' || isRaise) return false;
  return OMAHA_RIVER_FREQ_POTS.includes(omahaPeoplePriorFlopPotOf(history));
}

/** His shrunk frequency and the non-value share it implies in the record's unit; null with no usable record, or
 *  when his shrunk frequency is not above people's (the share it implies would only price more value). */
export function omahaRiverFrequencyPrior(
  record: { bets: number; opps: number } | null | undefined,
  peopleNonValue: number | null
): { rate: number; ratio: number; nonValue: number } | null {
  if (!record || peopleNonValue === null) return null;
  const opps = Number(record.opps);
  const bets = Number(record.bets);
  if (!Number.isFinite(opps) || !Number.isFinite(bets) || !(opps > 0) || bets < 0 || bets > opps)
    return null;
  if (!(peopleNonValue > 0) || !(peopleNonValue < 1)) return null;
  const f0 = OMAHA_RIVER_FREQ_PEOPLE_RATE;
  const K = OMAHA_RIVER_FREQ_PRIOR_OPPS;
  const rate = (bets + K * f0) / (opps + K);
  if (!(rate > f0)) return null;
  const nonValue = 1 - ((1 - peopleNonValue) * f0) / rate;
  return { rate, ratio: rate / f0, nonValue };
}
