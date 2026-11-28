/**
 * THE RIVER PEOPLE PRIOR BY POT TYPE (omahaRiverBetPriorIsPotTypeSplit; lead-9 lane RV2 2026-11-27). Pure lookup: no
 * telemetry, no memory, no draw.
 *
 * WHY. The people-only heads-up river cell (HorseOmahaFacingBetPeoplePrior.data.ts, riverRegions) pools every pot.
 * People's shown river bets are not the same hands in a re-raised pot: of their pot-size river bets 35% are in the
 * price's value region in a re-raised pot against 64% in a single-raised one (49 and 107 shown bets, Oct 27 - Nov 27),
 * so the pooled cell (55%) over-states value where the pot was re-raised and the Horse folds too much there (PLO5
 * re-raised pots, a half-to-three-quarter-pot river bet: 62% folds against a 34% break-even, l9-river2/BUILD.md).
 * Every called river bettor is shown by the engine, so the shown river sample has no hidden end to correct.
 *
 * WHAT. The same fit, split by the pot type of the hand (the preflop raises, counted as the flop split counts them),
 * PLO4 and PLO5 pooled. A pot-type cell is thin, so it first shrinks toward the pooled river cell of the same size
 * (OMAHA_RIVER_POT_PRIOR_POOL_BETS pseudo-bets, still people data); the caller then blends toward the equilibrium
 * anchor by the evidence behind it and moves the result by the bettor's own record, exactly as for the pooled cell.
 * WHERE. A heads-up river BET (never a raise) in a RE-RAISED pot only. In single-raised and limped pots the option
 * stands aside and the pooled cell stands: there the split cell is MORE value-heavy than the pooled one, the
 * recorded calls the split would give up are not shown to lose, and the Horses already fold over the pure-bluff
 * break-even there (the measured numbers are in the authority doc). No clamp on the output: a cell is a fit, not a
 * rule. People-only bettors, shown cards only; no identity input.
 */
import { OMAHA_RIVER_POT_PRIOR_DATA } from './HorseOmahaRiverPotPrior.data.js';
import {
  omahaPeoplePriorFlopPotOf,
  type OmahaPeoplePriorFlopPot,
} from './HorseOmahaPeoplePriorHidden.js';

/** Pseudo-bets of the pooled river cell (every pot type, same size) behind a pot-type cell. */
export const OMAHA_RIVER_POT_PRIOR_POOL_BETS = 30;
/** The pot types whose river cell the option reads (see WHERE above). */
export const OMAHA_RIVER_POT_PRIOR_SPLITS: ReadonlyArray<OmahaPeoplePriorFlopPot> = ['reraised'];

export interface OmahaRiverPotKey {
  pot: OmahaPeoplePriorFlopPot;
}
type Hist = Parameters<typeof omahaPeoplePriorFlopPotOf>[0];
type Regions = { n: number; core: number; middle: number; bottom: number };

/** The key of this decision: PLO4 / PLO5, the river, a bet (not a raise), a pot type the option reads; else null. */
export function omahaRiverPotKeyOf(
  variant: string,
  street: string,
  isRaise: boolean,
  history: Hist
): OmahaRiverPotKey | null {
  const game = String(variant ?? '').toLowerCase();
  if ((game !== 'plo4' && game !== 'plo5') || street !== 'river' || isRaise) return null;
  const pot = omahaPeoplePriorFlopPotOf(history);
  return OMAHA_RIVER_POT_PRIOR_SPLITS.includes(pot) ? { pot } : null;
}

/** The pot-type river cell shrunk toward the pooled cell of the same size: regions = (n_p r_p + P r_all) / (n_p + P),
 *  P = OMAHA_RIVER_POT_PRIOR_POOL_BETS capped at the pooled cell's n; n = n_p + P (the people evidence behind it).
 *  nonTop20 the same way in the record's unit. Null when the pot type has no shown bet of that size (the caller's
 *  pooled cell stands). */
export function omahaRiverPotCell(
  bucket: string,
  key: OmahaRiverPotKey | null | undefined,
  pooled: Regions | null,
  pooledNonTop20: number | null
): { regions: Regions; nonTop20: number | null } | null {
  if (!key) return null;
  const b = bucket === 'over' ? 'big' : bucket;
  const c = OMAHA_RIVER_POT_PRIOR_DATA[`${b}|${key.pot}`];
  if (!c || !(c.n > 0) || c.core === null || c.middle === null || c.bottom === null) return null;
  const P = pooled && pooled.n > 0 ? Math.min(OMAHA_RIVER_POT_PRIOR_POOL_BETS, pooled.n) : 0;
  const n = c.n + P;
  const mix = (own: number, all: number): number => (c.n * own + P * all) / n;
  const regions = {
    n,
    core: mix(c.core, pooled?.core ?? 0),
    middle: mix(c.middle, pooled?.middle ?? 0),
    bottom: mix(c.bottom, pooled?.bottom ?? 0),
  };
  const ownNt = c.nonTop20 !== null && c.nonTop20 > 0 && c.nonTop20 < 1 ? c.nonTop20 : null;
  const wAll = pooledNonTop20 !== null ? P : 0;
  const wOwn = ownNt !== null ? c.n : 0;
  const nonTop20 =
    wOwn + wAll > 0 ? ((ownNt ?? 0) * wOwn + (pooledNonTop20 ?? 0) * wAll) / (wOwn + wAll) : null;
  return { regions, nonTop20 };
}
