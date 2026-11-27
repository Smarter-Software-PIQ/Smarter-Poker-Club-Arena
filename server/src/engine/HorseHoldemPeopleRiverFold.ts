/**
 * HIS FOLD TO A HEADS-UP RIVER FIRST BET IN NO-LIMIT HOLD'EM CASH: HIS OWN RECORD BY SIZE, THEN PEOPLE'S, THEN
 * EQUILIBRIUM (PLO-OWNER + Hold'em owner lead-8, lane nlhriver, 2026-11-27; owner order of 2026-11-26: "the stats need
 * to be used against human players, not horses"). Read by holdemRiverBluffIsPricedOnPeople (default OFF).
 *
 * One fold estimate for a heads-up NLH cash river first wager B into P, as a multiplier m on the equilibrium fold
 * B / (P + B) (the fold a minimum-defence player gives the bet; m = 1 is equilibrium):
 *
 *  1. EQUILIBRIUM ANCHOR: m = 1.
 *  2. PEOPLE'S POPULATION (HorseHoldemPeopleRiverFoldTables.json, scripts/ops/holdem-people-river-fold-fit.mjs):
 *     answers by PEOPLE only (an answer by a Horse never enters a cell; the stored HUD population rows, almost all
 *     Horse play, are not read), by the bettor's line and the size cell of B. A size cell is shrunk to the anchor
 *     and its line cell to the size cell, each by k pseudo-answers:
 *         m_cell = (F + k g m_parent) / (E + k g)       F folds, E the equilibrium folds of the bets answered
 *                                                        (sum of B / (P + B)), g = E / n
 *     so a thin cell stays near equilibrium and a deep one reads people's play.
 *  3. HIS OWN RECORD BY SIZE (his lifetime public first answers to a heads-up river first wager, OPPONENT-HUD's
 *     r.fb.sm.hu / r.fb.bg.hu cells: at most 0.7 pot / above it): the cell of THIS bet's size moves people's
 *     multiplier the same way, m = (F + k g m_people) / (E + k g), F his folds, E = his answers x the mean
 *     equilibrium fold of that size cell. The other size cell is not read: people answer small and big river bets
 *     differently (a multiplier of 1.47 against 1.15), so a record of one is no record of the other. With no record
 *     m = m_people; as his record grows it dominates.
 *
 * k is the measured between-player prior strength of the river fold (beta-binomial method of moments on people with
 * at least 5 answers, NLH cash and tournaments pooled: 18.9 for the small cell, 19.9 for the big one; the larger is
 * used. Cash alone measures 7.6 and 12.3 on 17 and 10 people, too few to prefer).
 *
 * The same function for every opponent: nothing is keyed on an account, a name or a person/Horse flag of the player
 * being priced; only the population's data source is people's play. Public actions only. Pure; reads a frozen table.
 */
import tables from './HorseHoldemPeopleRiverFoldTables.json' with { type: 'json' };

interface PeopleCell {
  n: number;
  fold: number;
  raise: number;
  eq: number;
}
const T = tables as unknown as { version: string; cells: Record<string, PeopleCell> };
export const HOLDEM_PEOPLE_RIVER_FOLD_VERSION: string = T.version;

/** Pseudo-answers of every shrink step (the measured between-player prior strength; see the header). */
export const HOLDEM_PEOPLE_RIVER_FOLD_PRIOR_OPPS = 19.9;
/** The lifetime record's size boundary (OPPONENT-HUD x.foldToBet: small = at most 0.7 pot, big = above it). */
export const HOLDEM_PEOPLE_RIVER_RECORD_BIG_ABOVE = 0.7;

/** The bettor's line: agg he made the last wager of the turn; vsAgg the other player did; chk nobody did. */
export type HoldemPeopleRiverLine = 'agg' | 'vsAgg' | 'chk';

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The size cell of a bet of `ratio` x pot (a bigger bet than any measured cell reads the biggest cell). */
export function holdemPeopleRiverSizeCell(ratio: number): string {
  return ratio < 0.4 ? 'a<40' : ratio < 0.7 ? 'b40-70' : ratio <= 1.1 ? 'c70-110' : 'd>110';
}

function shrink(cell: PeopleCell | undefined, k: number, parent: number): number {
  if (!cell || !(cell.n > 0) || !(cell.eq > 0)) return parent;
  const g = cell.eq / cell.n;
  const m = (Math.min(cell.fold, cell.n) + k * g * parent) / (cell.eq + k * g);
  return fin(m) && m >= 0 ? m : parent;
}

/** People's fold multiplier for the cell of this bet, and the people answers behind it (0: the anchor alone). */
export function holdemPeopleRiverFoldMultiplier(
  line: HoldemPeopleRiverLine | null,
  ratio: number
): { m: number; n: number } {
  if (!(ratio > 0)) return { m: 1, n: 0 };
  const k = HOLDEM_PEOPLE_RIVER_FOLD_PRIOR_OPPS;
  const size = holdemPeopleRiverSizeCell(ratio);
  const all = T.cells[`river|all|${size}`];
  if (!all) return { m: 1, n: 0 };
  const mSize = shrink(all, k, 1);
  const lineCell = line ? T.cells[`river|${line}|${size}`] : undefined;
  return { m: line ? shrink(lineCell, k, mSize) : mSize, n: all.n };
}

/** The mean equilibrium fold of the bets a lifetime record cell was counted on (people's measured mean; g of step 3). */
export function holdemPeopleRiverRecordEqFold(big: boolean): number {
  const c = T.cells[big ? 'river|all|bg' : 'river|all|sm'];
  return c && c.n > 0 && c.eq > 0 ? c.eq / c.n : big ? 0.5 : 0.3;
}

/**
 * His fold multiplier for a bet of `ratio` x pot: the record cell of that size (folds of opps answers) shrunk to
 * people's multiplier `mPeople` by k pseudo-answers at the cell's equilibrium fold. n = his answers read.
 */
export function holdemRiverFoldMultiplierOnPeople(
  cell: { folds: number; opps: number } | null | undefined,
  ratio: number,
  mPeople: number,
  /** the mean equilibrium fold of the bets the record was counted on, when it is not this size's cell */
  eqFold?: number
): { m: number; n: number } {
  const base = fin(mPeople) && mPeople >= 0 ? mPeople : 1;
  if (!cell || !fin(cell.folds) || !fin(cell.opps) || !(cell.opps > 0) || cell.folds < 0)
    return { m: base, n: 0 };
  const g =
    fin(eqFold) && eqFold > 0
      ? eqFold
      : holdemPeopleRiverRecordEqFold(ratio > HOLDEM_PEOPLE_RIVER_RECORD_BIG_ABOVE);
  const k = HOLDEM_PEOPLE_RIVER_FOLD_PRIOR_OPPS;
  const m = (Math.min(cell.folds, cell.opps) + k * g * base) / (cell.opps * g + k * g);
  return fin(m) && m >= 0 ? { m, n: cell.opps } : { m: base, n: 0 };
}

/** His fold to a bet B into P at multiplier m (never certain either way). */
export function holdemPeopleRiverFold(m: number, bet: number, pot: number): number {
  if (!(bet > 0) || !(pot >= 0)) return 0;
  return Math.max(0.01, Math.min(0.95, (m * bet) / (pot + bet)));
}

/** The standard error of that fold on the answers behind it (people's cell, his record, and the k pseudo-answers). */
export function holdemPeopleRiverFoldSe(fold: number, answers: number): number {
  const n = Math.max(0, answers) + HOLDEM_PEOPLE_RIVER_FOLD_PRIOR_OPPS;
  return Math.sqrt((fold * (1 - fold)) / n);
}

/** The line of the player at `seat` from the public action of the turn. */
export function holdemPeopleRiverLineOf(
  history: ReadonlyArray<{ seat: number; stage?: unknown; action?: unknown }> | undefined,
  seat: number
): HoldemPeopleRiverLine {
  let last: number | null = null;
  for (const a of Array.isArray(history) ? history : []) {
    const act = String(a.action);
    if (String(a.stage) === 'turn' && (act === 'bet' || act === 'raise' || act === 'all_in'))
      last = a.seat;
  }
  return last === null ? 'chk' : last === seat ? 'agg' : 'vsAgg';
}
