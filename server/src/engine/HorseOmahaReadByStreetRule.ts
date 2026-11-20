/**
 * omahaReadIsByStreetAndTexture (default OFF): what HorseLogic.decide installs for one decision
 * (PLO Strategy lane 2026-11-18; the read itself is HorseOmahaReadByStreet.ts).
 *
 * For the length of one PLO4/PLO5 cash postflop decision with the option on:
 *  - the per-street read mode (HorseMind.omahaReadConditionalOf reads its value-leader label on
 *    the decision's street, HorseMind.omahaFacingBetEvReadOf the bettor's street bet rate);
 *  - the priced comparisons' street cells (omahaPricedStreetRatesOf, the seam #11212 left for
 *    this read): his bet / fold-to-bet / fold-to-raise cells of the decision's street, which
 *    omahaPricedRead shrinks toward the pooled figure; with omahaSampledRaiseIsPricedAtEverySize
 *    also on, the fold-to-raise cell carries the mean price of the raises behind it
 *    (HorseMind.omahaFoldToRaisePriceOf) where his record holds one.
 * Both are put back when the decision returns, so a decision with the option off, or a second
 * decision nested in this one, reads exactly what it read before.
 *
 * Receipt: omaha_read_by_street_carried, counted once per decision whose mode is on and in which
 * at least one live opponent carries a street record (telemetry on only).
 */
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { noteFire, telemetryOn } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import {
  omahaReadByStreetModeOf,
  omahaStreetRatesOf,
  withOmahaReadByStreet,
  type OmahaReadByStreetMode,
} from './HorseOmahaReadByStreet.js';
import {
  omahaPricedSetStreetRatesSource,
  omahaPricedStreetRatesSourceNow,
} from './HorseOmahaPricedWiring.js';

export function withOmahaReadByStreetDecision<T>(
  /** opts.omahaReadIsByStreetAndTexture === true, read by the caller */
  on: boolean,
  opts: HorseDecideOpts,
  gs: HorseGameStateV2,
  fn: () => T
): T {
  if (on !== true) return fn();
  const mode: OmahaReadByStreetMode = omahaReadByStreetModeOf(true, gs);
  if (!mode.on) return fn();
  const before = omahaPricedStreetRatesSourceNow();
  // The price behind a fold-to-raise cell (2026-11-19, horse decisions stack 2): only the sampled
  // raise priced at every size reads a cell's price (omahaPricedSampledFoldAtPrice), so the record is
  // asked only with that option on (=== true) and only for a street cell that exists. Off, or with
  // no record for him, the cells are exactly as before.
  const priced = opts.omahaSampledRaiseIsPricedAtEverySize === true;
  omahaPricedSetStreetRatesSource((userId) => {
    if (opts.mind === false) return null;
    const read = HorseMind.omahaStreetReadOf(userId, mode.texture);
    if (!read) return null;
    const rates = omahaStreetRatesOf(read.counters, mode.street, mode.texture);
    if (!priced || !rates?.foldToRaise || !mode.street) return rates;
    const price = HorseMind.omahaFoldToRaisePriceOf(userId)?.[mode.street]?.price ?? null;
    return price === null
      ? rates
      : omahaStreetRatesOf(read.counters, mode.street, mode.texture, price);
  });
  try {
    return withOmahaReadByStreet(mode, () => {
      if (telemetryOn(opts) && opts.mind !== false) {
        try {
          const carried = (gs.players ?? []).some(
            (p) =>
              !!p?.user_id &&
              p.is_folded !== true &&
              HorseMind.omahaStreetReadOf(p.user_id, mode.texture) !== null
          );
          if (carried) noteFire('omaha_read_by_street_carried');
        } catch {
          // a receipt never changes a decision
        }
      }
      return fn();
    });
  } finally {
    omahaPricedSetStreetRatesSource(before);
  }
}
