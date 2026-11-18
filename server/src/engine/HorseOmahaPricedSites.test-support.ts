/** The priced sites of HorseOmahaPricedSites.ts (sites-013U37), for the tests. */
import type { HorseDecideOpts } from './HorseLogic.js';

export const SITES_PRICED_OPTIONS = [
  'omahaMadeHandBetIsPriced',
  'omahaTurnSetSizeIsPriced',
  'omahaBlockerBluffIsPriced',
] as const;
export const allSitesPriced = (on: boolean): HorseDecideOpts =>
  Object.fromEntries(SITES_PRICED_OPTIONS.map((o) => [o, on])) as HorseDecideOpts;
