/**
 * OMAHA STAB DEFENCE: THE BETTOR'S NON-VALUE SHARE PRICED FROM HIS OWN PUBLIC BET FREQUENCY
 * (omahaStabDefenceIsPriced, default OFF, read `=== true`; EMERG lane STAB-DEFENCE, 2026-11-20).
 *
 * WHY. The SPARRING bench measured that an opponent who bets the pot on the turn and the river with ANY hand
 * whenever a Horse checks wins beyond the Horse mirror (+23.6 +/- 8.5 bb/100 heads-up, +74.6 +/- 17.1 six-max):
 * the facing-bet verdict prices every first bet of a street with the POPULATION non-value share, and the
 * population under-bluffs (river non-value share of bets about .05 to .19), so the Horse folds 87% of its river
 * checks to a pot bet whoever bets. Calling every bet is wrong too (the population's big bets are value).
 *
 * THE ARITHMETIC (one formula for every opponent; no hand class, no size band, no position, no kind).
 * Cards are dealt to every player alike, so the share of unopened spots in which a player HOLDS a value hand is
 * the same for everyone. The population bets a first wager with frequency fPop; a share (1 - q0) of those bets is
 * value; and it CHECKS a measured share `trap` of its value region (MATHCORE-2 trap table). So the value density
 * of an unopened spot is
 *     D = fPop * (1 - q0) / (1 - trap).
 * A bettor who wagers with frequency f cannot bet more value than he holds. The share g of his value region he
 * bets rises from the population's (1 - trap) at f = fPop to 1 at f = 1 (a player who bets every time bets every
 * value hand: an identity), linearly in between, and stays (1 - trap) below fPop. The non-value share of his bets:
 *     q(f) = 1 - D * g(f) / f.
 * At f = fPop this is q0 exactly (the population prior the verdict already uses); at f = 1 it is 1 - D (his
 * betting range is every holding); below fPop it falls under q0 (a rare bettor is value). The verdict then prices
 * the call with q in place of q0: equity against that range must beat the price.
 *
 * WHOSE FREQUENCY. f is the bettor's own PUBLIC record of first wagers on unopened postflop action (bets over
 * opportunities, the opponent memory's betCheckedTo counters: public actions only, never a card), shrunk toward
 * the population by n / (n + k) so it acts from his first hand; with no record f = fPop and q = q0: the
 * population decides, exactly as today.
 *
 * RIVER POOL. The river verdict counts the hand against a non-value POOL (the weakest OMAHA_EV_BLUFF_POOL of
 * holdings). A frequent bettor's extra non-value bets are spread over EVERY non-value holding, not only the
 * weakest ones, so only the part of the excess that lies inside the pool is credited: the rest is counted as
 * beating the Horse (omahaStabDefencePoolShare; conservative, never optimistic).
 *
 * Pure: no random draws, no telemetry, no memory. PLO4 / PLO5 only (the caller's scope); PLO6 never reads it.
 */

/** MATHCORE-2 trapShare.v1-pooled.json (sha256 1dc30ea3ad2a...4305): provenance population_all_cards, every
 *  player pooled, each capped at 20% of a cell, never keyed by player; fit Oct 14 - Nov 16 2026. betRate = the
 *  population's first-wager frequency on unopened action; trap = the share of its value region that checks. */
export const OMAHA_STAB_DEFENCE_TABLE_SHA256 =
  '1dc30ea3ad2aa8c8dc5395e65da9344702d8891e16260d59979233b0c07d4305';
export const OMAHA_STAB_DEFENCE_TABLE_PROVENANCE = 'population_all_cards';
export const OMAHA_STAB_DEFENCE_TABLE: Readonly<
  Record<string, Readonly<{ betRate: number; trap: number; n: number }>>
> = Object.freeze({
  'plo4|turn|hu': { betRate: 0.4851, trap: 0.335, n: 5479 },
  'plo4|turn|mw': { betRate: 0.3268, trap: 0.3223, n: 2772 },
  'plo4|river|hu': { betRate: 0.3714, trap: 0.3084, n: 4305 },
  'plo4|river|mw': { betRate: 0.1877, trap: 0.4369, n: 1247 },
  'plo5|turn|hu': { betRate: 0.4736, trap: 0.3288, n: 5586 },
  'plo5|turn|mw': { betRate: 0.2758, trap: 0.4053, n: 6479 },
  'plo5|river|hu': { betRate: 0.4111, trap: 0.3107, n: 4780 },
  'plo5|river|mw': { betRate: 0.1574, trap: 0.5404, n: 3298 },
});

/**
 * Pseudo-opportunities of the population's frequency behind his own (the shrink constant k of n / (n + k)).
 * MEASURED (STAB-DEFENCE.md, 84,425 unopened postflop decisions of 776 players, Oct 12 - Nov 20 2026, public
 * actions only): between-player SD of the bet-when-unopened rate .077 around a mean of .349 (587 players with at
 * least 20 opportunities), so k = p(1 - p) / SD^2 - 1 = 37 (method of moments; by street 30 to 62).
 */
export const OMAHA_STAB_DEFENCE_PRIOR_OPPS = 37;
/** The same constant measured per street and table (STAB-DEFENCE.md: p(1-p)/SD^2 - 1 on the per-street rates of the
 *  same public extract): the weight of a per-street record is n / (n + k) with the k of its own street. */
export const OMAHA_STAB_DEFENCE_PRIOR_OPPS_BY_CELL: Readonly<Record<string, number>> =
  Object.freeze({
    'turn|hu': 43,
    'river|hu': 33,
    'turn|mw': 62,
    'river|mw': 45,
  });
export function omahaStabDefencePriorOpps(street: string, opponents: number): number {
  return (
    OMAHA_STAB_DEFENCE_PRIOR_OPPS_BY_CELL[`${street}|${opponents <= 1 ? 'hu' : 'mw'}`] ??
    OMAHA_STAB_DEFENCE_PRIOR_OPPS
  );
}
/** Arithmetic bounds of a share. */
export const OMAHA_STAB_DEFENCE_Q_MIN = 0.02;
export const OMAHA_STAB_DEFENCE_Q_MAX = 0.98;

export interface OmahaStabDefenceRecord {
  /** his first wagers on unopened action of this street (lifetime public count) */
  bets: number;
  /** his unopened opportunities on this street (lifetime public count) */
  opps: number;
  /** the population's frequency on the same counter; absent = the table's frequency of the cell */
  popRate?: number;
}

export interface OmahaStabDefenceShare {
  /** the non-value share of his bets in this cell */
  q: number;
  /** his frequency over the population's, after shrinkage (1 with no record) */
  ratio: number;
  /** his frequency in the cell */
  f: number;
  fPop: number;
  /** the value density of an unopened spot */
  density: number;
  /** n / (n + k) */
  weight: number;
  cell: string;
}

export function omahaStabDefenceCell(variant: string, street: string, opponents: number): string {
  return `${String(variant).toLowerCase()}|${street}|${opponents <= 1 ? 'hu' : 'mw'}`;
}

/**
 * THE ONE RULE. q0 = the population prior of the verdict for this bet; record = his public counters or null.
 * Null outside the table (no cell: the caller keeps the population prior).
 */
export function omahaStabDefenceShare(
  q0: number,
  record: OmahaStabDefenceRecord | null | undefined,
  variant: string,
  street: string,
  opponents: number
): OmahaStabDefenceShare | null {
  const cell = omahaStabDefenceCell(variant, street, opponents);
  const row = OMAHA_STAB_DEFENCE_TABLE[cell];
  if (!row || !(q0 > 0) || !(q0 < 1)) return null;
  const fPop = row.betRate;
  let ratio = 1;
  let weight = 0;
  if (
    record &&
    Number.isFinite(record.bets) &&
    Number.isFinite(record.opps) &&
    record.opps > 0 &&
    record.bets >= 0
  ) {
    const popRate =
      typeof record.popRate === 'number' && record.popRate > 0 && record.popRate < 1
        ? record.popRate
        : fPop;
    const k = omahaStabDefencePriorOpps(street, opponents);
    const bets = Math.min(record.bets, record.opps);
    const his = (bets + k * popRate) / (record.opps + k);
    ratio = his / popRate;
    weight = record.opps / (record.opps + k);
  }
  const f = Math.max(1e-6, Math.min(1, ratio * fPop));
  const density = Math.min(1, (fPop * (1 - q0)) / (1 - row.trap));
  const g = f > fPop ? 1 - row.trap + (row.trap * (f - fPop)) / (1 - fPop) : 1 - row.trap;
  const q = 1 - (density * g) / f;
  return {
    q: Math.max(OMAHA_STAB_DEFENCE_Q_MIN, Math.min(OMAHA_STAB_DEFENCE_Q_MAX, q)),
    ratio,
    f,
    fPop,
    density,
    weight,
    cell,
  };
}

/**
 * RIVER POOL CREDIT. The river verdict's non-value holdings are the weakest `pool` of all holdings; his excess
 * non-value bets (q - q0) lie anywhere below the value region (the weakest 1 - valueShare). Only the part inside
 * the pool is credited as non-value; the rest is left in the value term (it beats the Horse in the count).
 * q <= q0 is returned unchanged.
 */
export function omahaStabDefencePoolShare(
  q: number,
  q0: number,
  pool: number,
  valueShare: number
): number {
  if (!(q > q0)) return q;
  const below = Math.max(pool, 1 - Math.max(0, Math.min(1, valueShare)));
  const inside = below > 0 ? Math.min(1, pool / below) : 1;
  return q0 + (q - q0) * inside;
}
