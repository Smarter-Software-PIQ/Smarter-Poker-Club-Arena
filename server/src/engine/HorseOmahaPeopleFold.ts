/**
 * HIS FOLD TO A HEADS-UP OPENING BET: HIS OWN RECORD, THEN PEOPLE'S, THEN EQUILIBRIUM (PLO-OWNER lead-7 lane
 * plo-bluffs, 2026-11-26; owner order: "the stats need to be used against human players, not horses").
 *
 * One fold estimate for a heads-up PLO4/PLO5 cash turn or river first wager B into P, as a multiplier m on the
 * equilibrium fold B / (P + B) (the fold a minimum-defence player gives the bet; m = 1 is equilibrium):
 *
 *  1. EQUILIBRIUM ANCHOR: m = 1.
 *  2. PEOPLE'S POPULATION (HorseOmahaPeopleFoldTables.json, scripts/ops/omaha-people-fold-fit.mjs): answers by PEOPLE
 *     only (an answer by a Horse never enters a cell; the stored HUD population rows, which are almost all Horse
 *     play, are not read), by game, street, the bettor's line and the size cell of B. A size cell is shrunk to the
 *     anchor and its line cell to the size cell, each by k pseudo-answers:
 *         m_cell = (F + k g m_parent) / (E + k g)       F folds, E the equilibrium folds of the bets answered
 *                                                        (sum of B/(P+B)), g = E / n
 *     k is the street's measured between-player prior (OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS: 27.8 turn answers,
 *     75.9 river answers), so a thin cell stays near equilibrium and a deep one reads people's play.
 *  3. HIS OWN RECORD (his lifetime public answers, OPPONENT-HUD; HorseMind.omahaStrongHandCheckRecordsOf) moves the
 *     people's multiplier the same way: m = (F + k g m_people) / (E + k g), F his folds, E the folds equilibrium
 *     expects on what he faced. With no record m = m_people; as his record grows it dominates.
 *
 * The same function for every opponent: nothing is keyed on an account, a name or a person/Horse flag of the player
 * being priced; only the population's data source is people's play. Pure; reads a frozen table.
 */
import tables from './HorseOmahaPeopleFoldTables.json' with { type: 'json' };
import { OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS } from './HorseOmahaStrongHandCheck.js';

interface PeopleCell {
  n: number;
  fold: number;
  raise: number;
  eq: number;
}
const T = tables as unknown as { version: string; cells: Record<string, PeopleCell> };
export const OMAHA_PEOPLE_FOLD_VERSION: string = T.version;

export type OmahaPeopleFoldStreet = 'turn' | 'river';
/** The bettor's line: agg he made the last wager of the street before; vsAgg the other player did; chk nobody did. */
export type OmahaPeopleFoldLine = 'agg' | 'vsAgg' | 'chk';

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The size cell of a bet of `ratio` x pot (a bigger bet than any measured cell reads the biggest cell). */
export function omahaPeopleFoldSizeCell(ratio: number): string {
  return ratio < 0.4 ? 'a<40' : ratio < 0.7 ? 'b40-70' : ratio <= 1.1 ? 'c70-110' : 'd>110';
}
const ORDER = ['d>110', 'c70-110', 'b40-70', 'a<40'];

function shrink(cell: PeopleCell | undefined, k: number, parent: number): number {
  if (!cell || !(cell.n > 0) || !(cell.eq > 0)) return parent;
  const g = cell.eq / cell.n;
  const m = (Math.min(cell.fold, cell.n) + k * g * parent) / (cell.eq + k * g);
  return fin(m) && m >= 0 ? m : parent;
}

/** People's fold multiplier for the cell of this bet, and the people answers behind it (0: the anchor alone). */
export function omahaPeopleFoldMultiplier(
  variant: string,
  street: OmahaPeopleFoldStreet,
  line: OmahaPeopleFoldLine | null,
  ratio: number
): { m: number; n: number } {
  const game = String(variant ?? '').toLowerCase();
  if ((game !== 'plo4' && game !== 'plo5') || !(ratio > 0)) return { m: 1, n: 0 };
  const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS[street];
  let size = omahaPeopleFoldSizeCell(ratio);
  // a size above every measured cell reads the biggest measured one
  for (
    let i = ORDER.indexOf(size);
    i < ORDER.length && !T.cells[`${game}|${street}|all|${size}`];
    i++
  )
    size = ORDER[i];
  const all = T.cells[`${game}|${street}|all|${size}`];
  if (!all) return { m: 1, n: 0 };
  const mSize = shrink(all, k, 1);
  const lineCell = line ? T.cells[`${game}|${street}|${line}|${size}`] : undefined;
  const m = line ? shrink(lineCell, k, mSize) : mSize;
  return { m, n: all.n };
}

/**
 * His fold multiplier on the equilibrium fold: his record cell(s) shrunk to people's multiplier `mPeople` by k
 * pseudo-answers at the equilibrium fold `g` of the cell (each record cell gives folds and answers, and the fold
 * equilibrium expects there). n = his answers read.
 */
export function omahaFoldMultiplierOnPeople(
  cells: ReadonlyArray<{ cell: { folds: number; opps: number } | null | undefined; eq: number }>,
  mPeople: number,
  g: number,
  k: number
): { m: number; n: number } {
  let F = 0;
  let E = 0;
  let n = 0;
  for (const { cell, eq } of cells) {
    if (!cell || !fin(cell.folds) || !fin(cell.opps) || !(cell.opps > 0) || cell.folds < 0)
      continue;
    F += Math.min(cell.folds, cell.opps);
    E += cell.opps * eq;
    n += cell.opps;
  }
  const base = fin(mPeople) && mPeople >= 0 ? mPeople : 1;
  if (!(n > 0)) return { m: base, n: 0 };
  const m = (F + k * g * base) / (E + k * g);
  return fin(m) && m >= 0 ? { m, n } : { m: base, n: 0 };
}

/** The line of the player at `seat` from the public action of the street before `street`. */
export function omahaPeopleFoldLineOf(
  history: ReadonlyArray<{ seat: number; stage?: unknown; action?: unknown }> | undefined,
  street: OmahaPeopleFoldStreet,
  seat: number
): OmahaPeopleFoldLine {
  const prev = street === 'turn' ? 'flop' : 'turn';
  let last: number | null = null;
  for (const a of Array.isArray(history) ? history : []) {
    const act = String(a.action);
    if (String(a.stage) === prev && (act === 'bet' || act === 'raise' || act === 'all_in'))
      last = a.seat;
  }
  return last === null ? 'chk' : last === seat ? 'agg' : 'vsAgg';
}

/**
 * omahaRiverBetFoldIsPeopleMeasured (PLO-OWNER lead-7 2026-11-26; default OFF): the answer curve the two river bet rules
 * (omahaRiverFirstToActBetIsPriced, omahaRiverCheckedToBetIsMeasured) price a heads-up river bet with, re-measured on
 * PEOPLE: at each point of the curve (a bet of `share` x pot) his fold is people's measured fold for the Horse's line and
 * that size (omahaPeopleFoldMultiplier: people's answers only, shrunk to equilibrium by k = 75.9). The continue share
 * is 1 - fold; the raise share of the point keeps its share of the continues; the standard error is the binomial error
 * on the cell's answers plus k. The rules' own curve is measured on every player pooled (Horses included), which the
 * owner order of 2026-11-26 forbids as a population. Pure: the same function for every opponent.
 */
export function omahaPeopleRiverCurve<
  P extends { share: number; cont: number; raise: number; foldSe: number; n: number },
>(variant: string, line: OmahaPeopleFoldLine | null, population: readonly P[]): P[] {
  const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
  return population.map((pt) => {
    const s = pt.share;
    if (!(s > 0)) return { ...pt };
    const ppl = omahaPeopleFoldMultiplier(variant, 'river', line, s);
    if (!(ppl.n > 0)) return { ...pt };
    const fold = Math.max(0.01, Math.min(0.97, (ppl.m * s) / (1 + s)));
    const cont = 1 - fold;
    const raiseOfCont = pt.cont > 0 ? Math.max(0, Math.min(1, pt.raise / pt.cont)) : 0;
    return {
      ...pt,
      cont,
      raise: cont * raiseOfCont,
      foldSe: Math.sqrt((fold * (1 - fold)) / (ppl.n + k)),
      n: ppl.n,
    };
  });
}
