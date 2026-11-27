/**
 * HIS FOLD TO A HEADS-UP TURN FIRST BET IN NO-LIMIT HOLD'EM CASH: HIS OWN RECORD, THEN PEOPLE'S BY LINE AND SIZE, THEN
 * EQUILIBRIUM (PLO-OWNER lead-9, lane nlzb, 2026-11-27; owner order of 2026-11-26: "the stats need to be used against
 * human players, not horses"). Read by holdemTurnBluffIsPricedOnPeople (default OFF).
 *
 * One fold estimate for a heads-up NLH cash turn first wager B into P, as a multiplier m on the equilibrium fold
 * B / (P + B) (m = 1 is equilibrium), built exactly as the river's (HorseHoldemPeopleRiverFold):
 *
 *  1. EQUILIBRIUM ANCHOR: m = 1.
 *  2. PEOPLE'S POPULATION (HorseHoldemPeopleTurnFoldTables.json, scripts/ops/holdem-people-turn-fold-fit.mjs):
 *     answers by PEOPLE only (an answer by a Horse never enters a cell; the stored HUD population rows are not
 *     read), by the bettor's line (the flop's last wager: his, the other player's, nobody's) and the size cell of B.
 *     A size cell is shrunk to the anchor and its line cell to the size cell, each by k pseudo-answers:
 *         m_cell = (F + k g m_parent) / (E + k g)       F folds, E the equilibrium folds of the bets answered,
 *                                                        g = E / n
 *     What it measures (746 answers, 2026-10-01 to 2026-11-26): people fold a turn bet at about equilibrium (all
 *     lines and sizes 1.06), below it to a barrel of two thirds pot or more (0.89) and to a lead into the flop
 *     bettor (0.62 to 0.94), and far above it to a SMALL bet after a checked flop (1.72 on 83 answers). So against
 *     people a pure turn barrel is not a profitable bluff and the small stab after a checked flop is.
 *  3. HIS OWN RECORD BY SIZE (his lifetime public first answers to a heads-up turn first wager, OPPONENT-HUD's
 *     t.fb.sm.hu / t.fb.bg.hu cells: at most 0.7 pot / above it): the cell of THIS bet's size moves people's
 *     multiplier the same way, m = (F + k g m_people) / (E + k g), F his folds, E = his answers x the mean
 *     equilibrium fold of that size cell. The other size cell is not read. With no lifetime record of either size his
 *     decayed window record of folds to a bet (unsized, every street) is his record, at the mean equilibrium fold of
 *     a turn bet. With no record at all m = m_people; as his record grows it dominates. (A record of folds on every
 *     street alone does not see a player who gives up flops and never folds a turn: the turn cells do.)
 *
 * k is the measured between-player prior strength of the turn fold (beta-binomial method of moments on people with at
 * least 5 answers, NLH cash and tournaments pooled, the river module's rule: 44.4 for the small cell on 41 people,
 * 38.1 for the big one on 24; the larger is used).
 *
 * The same function for every opponent: nothing is keyed on an account, a name or a person/Horse flag of the player
 * being priced; only the population's data source is people's play. Public actions only. Pure; reads a frozen table.
 */
import tables from './HorseHoldemPeopleTurnFoldTables.json' with { type: 'json' };

interface PeopleCell {
  n: number;
  fold: number;
  raise: number;
  eq: number;
}
const T = tables as unknown as { version: string; cells: Record<string, PeopleCell> };
export const HOLDEM_PEOPLE_TURN_FOLD_VERSION: string = T.version;

/** Pseudo-answers of every shrink step (the measured between-player prior strength; see the header). */
export const HOLDEM_PEOPLE_TURN_FOLD_PRIOR_OPPS = 44.4;
/** The lifetime record's size boundary (OPPONENT-HUD x.foldToBet: small = at most 0.7 pot, big = above it). */
export const HOLDEM_PEOPLE_TURN_RECORD_BIG_ABOVE = 0.7;

/** The bettor's line: agg he made the last wager of the flop; vsAgg the other player did; chk nobody did. */
export type HoldemPeopleTurnLine = 'agg' | 'vsAgg' | 'chk';

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The size cell of a bet of `ratio` x pot (a bigger bet than any measured cell reads the biggest cell). */
export function holdemPeopleTurnSizeCell(ratio: number): string {
  return ratio < 0.4 ? 'a<40' : ratio < 0.7 ? 'b40-70' : ratio <= 1.1 ? 'c70-110' : 'd>110';
}

function shrink(cell: PeopleCell | undefined, k: number, parent: number): number {
  if (!cell || !(cell.n > 0) || !(cell.eq > 0)) return parent;
  const g = cell.eq / cell.n;
  const m = (Math.min(cell.fold, cell.n) + k * g * parent) / (cell.eq + k * g);
  return fin(m) && m >= 0 ? m : parent;
}

/** People's fold multiplier for the cell of this bet, and the people answers behind it (0: the anchor alone). */
export function holdemPeopleTurnFoldMultiplier(
  line: HoldemPeopleTurnLine | null,
  ratio: number
): { m: number; n: number } {
  if (!(ratio > 0)) return { m: 1, n: 0 };
  const k = HOLDEM_PEOPLE_TURN_FOLD_PRIOR_OPPS;
  const size = holdemPeopleTurnSizeCell(ratio);
  const all = T.cells[`turn|all|${size}`];
  if (!all) return { m: 1, n: 0 };
  const mSize = shrink(all, k, 1);
  const lineCell = line ? T.cells[`turn|${line}|${size}`] : undefined;
  return {
    m: line ? shrink(lineCell, k, mSize) : mSize,
    n: line && lineCell && lineCell.n > 0 ? lineCell.n : all.n,
  };
}

/**
 * The mean equilibrium fold of the bets a record was counted on (people's measured mean; g of step 3): the big or
 * the small lifetime cell, or (null) every turn bet for an unsized record.
 */
export function holdemPeopleTurnRecordEqFold(big: boolean | null): number {
  const c = T.cells[big === null ? 'turn|all|all' : big ? 'turn|all|bg' : 'turn|all|sm'];
  return c && c.n > 0 && c.eq > 0 ? c.eq / c.n : big === null ? 0.35 : big ? 0.48 : 0.31;
}

/**
 * His fold multiplier for a bet of `ratio` x pot: the record cell of that size (folds of opps answers) shrunk to
 * people's multiplier `mPeople` by k pseudo-answers at the cell's equilibrium fold; `unsized` reads the record as
 * counted on every bet. n = his answers read.
 */
export function holdemTurnFoldMultiplierOnPeople(
  record: { folds: number; opps: number } | null | undefined,
  ratio: number,
  mPeople: number,
  unsized = false
): { m: number; n: number } {
  const base = fin(mPeople) && mPeople >= 0 ? mPeople : 1;
  if (!record || !fin(record.folds) || !fin(record.opps) || !(record.opps > 0) || record.folds < 0)
    return { m: base, n: 0 };
  const g = holdemPeopleTurnRecordEqFold(
    unsized ? null : ratio > HOLDEM_PEOPLE_TURN_RECORD_BIG_ABOVE
  );
  const k = HOLDEM_PEOPLE_TURN_FOLD_PRIOR_OPPS;
  const m = (Math.min(record.folds, record.opps) + k * g * base) / (record.opps * g + k * g);
  return fin(m) && m >= 0 ? { m, n: record.opps } : { m: base, n: 0 };
}

/** His fold to a bet B into P at multiplier m (never certain either way). */
export function holdemPeopleTurnFold(m: number, bet: number, pot: number): number {
  if (!(bet > 0) || !(pot >= 0)) return 0;
  return Math.max(0.01, Math.min(0.95, (m * bet) / (pot + bet)));
}

/** The standard error of that fold on the answers behind it (people's cell, his record, and the k pseudo-answers). */
export function holdemPeopleTurnFoldSe(fold: number, answers: number): number {
  const n = Math.max(0, answers) + HOLDEM_PEOPLE_TURN_FOLD_PRIOR_OPPS;
  return Math.sqrt((fold * (1 - fold)) / n);
}

/** The line of the player at `seat` from the public action of the flop. */
export function holdemPeopleTurnLineOf(
  history: ReadonlyArray<{ seat: number; stage?: unknown; action?: unknown }> | undefined,
  seat: number
): HoldemPeopleTurnLine {
  let last: number | null = null;
  for (const a of Array.isArray(history) ? history : []) {
    const act = String(a.action);
    if (String(a.stage) === 'flop' && (act === 'bet' || act === 'raise' || act === 'all_in'))
      last = a.seat;
  }
  return last === null ? 'chk' : last === seat ? 'agg' : 'vsAgg';
}
