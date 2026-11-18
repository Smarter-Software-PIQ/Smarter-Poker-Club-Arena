/**
 * THE OPPONENT READ, USED BY STREET AND BY FLOP TEXTURE (2026-11-18, PLO Strategy lane,
 * option omahaReadIsByStreetAndTexture, default OFF).
 *
 * #11215 keeps each opponent's postflop play apart by street and by flop texture
 * (HorseOmahaStreetRead; HorseMind.omahaStreetReadOf) and no decision read it. Three things
 * still read ONE pooled postflop figure for every street and every board:
 *
 *  1. The value-leader label (HorseOmahaReadConditional: bets no more than the Horse mean when
 *     checked to, folds to a bet at least as often, no station). A player who bets most flops
 *     and slows down on the turn has a moderate pooled rate and carries the label everywhere.
 *  2. The bettor's bet rate beside the population (OmahaFacingBetEvRead.betCheckedToRatio),
 *     the input the facing-bet range model turns into his bluff share and its 0.65 cap.
 *  3. His fold to a bet and to a raise (OmahaPricedStreetRates), the fold equity of every
 *     priced bet and raise.
 *
 * With the option on, for a PLO4/PLO5 cash decision on the flop, the turn or the river, all
 * three are read from the cell of the decision's own street (on the flop: the flop's texture
 * cell for the bet rate), each blended CONTINUOUSLY with the pooled figure by the cell's own
 * decayed opportunity count: with no street evidence the pooled figure is returned unchanged
 * (byte-identical), with deep evidence the street figure decides. There is no opportunity
 * threshold in this file (the merged street label's 8-opportunity null is not used).
 *
 * ONE OWNER PER QUANTITY. The shrink toward the pooled figure is omahaPricedShrunk (the one
 * the priced read uses, OMAHA_PRICED_SHRINK pseudo-opportunities); the population means are
 * the envelope's (the same means streetLabel and the pooled label compare against); priors
 * and the bluff factor stay with HorseOmahaPricedMode / HorseOmahaFacingBetEv. This file only
 * chooses which cell is read and blends it.
 *
 * THE SHORT OPENING ALL-IN (review note N2 of #11215). The street cells count an all-in that
 * opens a street below the minimum bet as "no bet", the convention of the pooled counters
 * (exploitHandIncrements). It is kept: the street figure is shrunk TOWARD the pooled figure,
 * so the two must count the same events, and the event needs a stack under one minimum bet.
 * Changing it would need the SQL twin (fn_horse_street_read_increments, migration
 * 20261117175407, not installed) changed in the same release as the pooled reducer.
 *
 * Pure apart from the per-decision mode (set by HorseLogic.decide for one decision, the way
 * the priced mode is): no telemetry, no opponent memory, no random draw.
 */
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  flopTextureOf,
  type FlopTexture,
  type PostflopStreet,
  type StreetReadCell,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';
import {
  OMAHA_PRICED_SHRINK,
  omahaPricedShrunk,
  type OmahaPricedStreetRates,
} from './HorseOmahaPricedRules.js';
import { betaCdf } from './HorseOpponentExploit.js';
import {
  OMAHA_READ_BY_STREET_OFF,
  type OmahaReadByStreetMeans,
  type OmahaReadByStreetMode,
} from './HorseOmahaReadByStreetMode.js';

// ───────────────────────────── the mode of one decision ─────────────────────────────

export {
  OMAHA_READ_BY_STREET_OFF,
  omahaReadByStreetNow,
  withOmahaReadByStreet,
  type OmahaReadByStreetMeans,
  type OmahaReadByStreetMode,
} from './HorseOmahaReadByStreetMode.js';

const STREETS: ReadonlySet<string> = new Set(['flop', 'turn', 'river']);

/**
 * The mode of a decision from its option (read `=== true` by the caller) and its state. Only a
 * PLO4/PLO5 cash decision on the flop, the turn or the river with one board and no bomb pot has
 * one; every other decision reads the off mode whatever the option says.
 */
export function omahaReadByStreetModeOf(
  wanted: boolean,
  gs: {
    gameVariant?: unknown;
    gameMode?: unknown;
    tournament?: unknown;
    bigBlind?: unknown;
    stage?: unknown;
    communityCards?: unknown;
    communityCards2?: unknown;
    communityCards3?: unknown;
    boardCount?: unknown;
    bombPot?: unknown;
  } | null
): OmahaReadByStreetMode {
  if (wanted !== true || !gs) return OMAHA_READ_BY_STREET_OFF;
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (variant !== 'plo4' && variant !== 'plo5') return OMAHA_READ_BY_STREET_OFF;
  const tournament = gs.gameMode
    ? gs.gameMode === 'tournament'
    : gs.tournament != null || Number(gs.bigBlind ?? 0) >= 10;
  if (tournament) return OMAHA_READ_BY_STREET_OFF;
  const stage = String(gs.stage ?? '');
  if (!STREETS.has(stage)) return OMAHA_READ_BY_STREET_OFF;
  const extraBoard =
    (Array.isArray(gs.communityCards2) && gs.communityCards2.length > 0) ||
    (Array.isArray(gs.communityCards3) && gs.communityCards3.length > 0);
  if (Number(gs.boardCount ?? 1) !== 1 || extraBoard || gs.bombPot === true)
    return OMAHA_READ_BY_STREET_OFF;
  const street = stage as PostflopStreet;
  const texture = flopTextureOf(
    Array.isArray(gs.communityCards) ? (gs.communityCards as never) : null
  );
  const mode: OmahaReadByStreetMode = Object.freeze({
    on: true,
    street,
    texture,
    readConditional: (
      pooled: OmahaReadConditional | null,
      row: StreetReadCounters | null,
      means: OmahaReadByStreetMeans | null
    ) => omahaReadConditionalByStreet(pooled, row, mode, means),
    betRate: (row: StreetReadCounters | null, pooledRate: number) =>
      omahaStreetBetRate(row, mode, pooledRate),
  });
  return mode;
}
// ───────────────────────────── which cell ─────────────────────────────

const known = (c: StreetReadCell | null | undefined): c is StreetReadCell =>
  !!c && Number.isFinite(c.hit) && Number.isFinite(c.opp) && c.opp > 0 && c.hit >= 0;
const copy = (c: StreetReadCell | null | undefined): StreetReadCell | null =>
  known(c) ? { hit: Math.min(c.hit, c.opp), opp: c.opp } : null;

/** The bet cell of a street: on the flop the texture's cell when the texture is known. */
export function omahaStreetBetCell(
  row: StreetReadCounters,
  street: PostflopStreet,
  texture: FlopTexture | null
): StreetReadCell | null {
  return copy(street === 'flop' && texture ? row.flopBet[texture] : row.bet[street]);
}

/**
 * The cells the priced comparisons read (OmahaPricedStreetRates, through
 * omahaPricedStreetRatesOf) for the decision's street: bet rate (texture cell on the flop),
 * fold to a bet and fold to a raise of that street. A cell with no opportunity is null.
 */
export function omahaStreetRatesOf(
  row: StreetReadCounters | null | undefined,
  street: PostflopStreet | null,
  texture: FlopTexture | null
): OmahaPricedStreetRates | null {
  if (!row || !street) return null;
  const rates: OmahaPricedStreetRates = {
    bet: omahaStreetBetCell(row, street, texture),
    foldToBet: copy(row.foldToBet[street]),
    foldToRaise: copy(row.foldToRaise[street]),
  };
  return rates.bet || rates.foldToBet || rates.foldToRaise ? rates : null;
}

// ───────────────────────────── the value-leader quantity ─────────────────────────────

const finite01 = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** P(rate <= bar) under the beta posterior of a cell shrunk toward `prior` with k pseudo-opportunities. */
function probAtOrBelow(cell: StreetReadCell | null, prior: number, bar: number): number {
  const k = OMAHA_PRICED_SHRINK;
  const hit = cell ? cell.hit : 0;
  const opp = cell ? cell.opp : 0;
  const a = prior * k + hit;
  const b = (1 - prior) * k + (opp - hit);
  if (!(a > 0) || !(b > 0)) return a > 0 ? (bar >= 1 ? 1 : 0) : 1;
  return betaCdf(Math.max(0, Math.min(1, bar)), a, b);
}

export interface OmahaStreetValueLeader {
  /**
   * The continuous quantity, in [0, 1]: w x (street evidence) + (1 - w) x (pooled label), where
   * w = opp / (opp + OMAHA_PRICED_SHRINK) is the weight of the street's bet cell and the street
   * evidence is the posterior probability that, on this street (and flop texture), he bets no
   * more often than the Horse mean, folds to a bet at least as often, and (pooled, there is no
   * street cell for it) calls rivers no more often. With no street evidence it is the pooled
   * label (0 or 1) exactly.
   */
  weight: number;
  /** the label the decision's consumers read: the more likely side of `weight` (>= 0.5) */
  valueLeader: boolean;
  /** decayed opportunities behind the street's bet cell (0: none) */
  opportunities: number;
}

/**
 * The value-leader read of one opponent on the decision's street. `pooled` is the pooled
 * read (its label and posteriors); `row` his street cells. Null when there is no pooled read
 * (unknown stays unknown).
 */
export function omahaStreetValueLeader(
  pooled: OmahaReadConditional | null,
  row: StreetReadCounters | null | undefined,
  street: PostflopStreet,
  texture: FlopTexture | null,
  means: OmahaReadByStreetMeans | null
): OmahaStreetValueLeader | null {
  if (!pooled) return null;
  const label = pooled.valueLeader === true ? 1 : 0;
  if (
    !row ||
    !means ||
    !(means.bet > 0 && means.bet < 1) ||
    !finite01(means.foldToBet) ||
    !finite01(means.riverCall)
  )
    return { weight: label, valueLeader: label === 1, opportunities: 0 };
  const betCell = omahaStreetBetCell(row, street, texture);
  const opp = betCell ? betCell.opp : 0;
  if (!(opp > 0)) return { weight: label, valueLeader: label === 1, opportunities: 0 };
  const pooledBet = finite01(pooled.betCheckedTo?.mean) ? pooled.betCheckedTo.mean : means.bet;
  const pooledFold = finite01(pooled.foldToBet?.mean) ? pooled.foldToBet.mean : means.foldToBet;
  const pBetLow = probAtOrBelow(betCell, pooledBet, means.bet);
  const pFoldHigh = 1 - probAtOrBelow(copy(row.foldToBet[street]), pooledFold, means.foldToBet);
  // river calls have no street cell: the pooled posterior, as a beta of its own mass
  const rc = pooled.riverCall;
  const rcMass = Math.max(0, Number(rc?.n) || 0);
  const pNoStation =
    finite01(rc?.mean) && rcMass > 0
      ? probAtOrBelow({ hit: rc.mean * rcMass, opp: rcMass }, rc.mean, means.riverCall)
      : 1;
  const evidence = pBetLow * pFoldHigh * pNoStation;
  const w = opp / (opp + OMAHA_PRICED_SHRINK);
  const weight = w * evidence + (1 - w) * label;
  return { weight, valueLeader: weight >= 0.5, opportunities: opp };
}

/** The pooled read with its value-leader label read on the decision's street. */
export function omahaReadConditionalByStreet(
  pooled: OmahaReadConditional | null,
  row: StreetReadCounters | null | undefined,
  mode: OmahaReadByStreetMode,
  means: OmahaReadByStreetMeans | null
): OmahaReadConditional | null {
  if (!pooled || !mode.on || !mode.street || !row) return pooled;
  const v = omahaStreetValueLeader(pooled, row, mode.street, mode.texture, means);
  if (!v || v.valueLeader === pooled.valueLeader) return pooled;
  return { ...pooled, valueLeader: v.valueLeader };
}

/**
 * His bet rate on the decision's street (texture cell on the flop), shrunk toward the pooled
 * posterior `pooledRate` by the cell's own opportunities; `pooledRate` itself with no cell.
 */
export function omahaStreetBetRate(
  row: StreetReadCounters | null | undefined,
  mode: OmahaReadByStreetMode,
  pooledRate: number
): number {
  if (!row || !mode.on || !mode.street) return pooledRate;
  return omahaPricedShrunk(omahaStreetBetCell(row, mode.street, mode.texture), pooledRate);
}
