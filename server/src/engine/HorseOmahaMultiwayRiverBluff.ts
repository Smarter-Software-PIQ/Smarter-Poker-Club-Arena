/**
 * THE MULTIWAY RIVER OPENING BLUFF: MATH AND BLOCKERS (PLO-OWNER lead-9 lane underbluff, 2026-11-27).
 * One option, default OFF (read `=== true`), switchable live, scopable per game (horse.omahaGameScope):
 *
 *  omahaMultiwayRiverBluffIsPricedOnBlockers   PLO4/PLO5 cash river, nothing to call, nobody has wagered on the
 *     river, two or more opponents live: a final CHECK becomes the best-priced bet only when BOTH (math) the bet,
 *     scored as losing every time anybody continues, is worth more than the check by more than the error of their
 *     fold rates, AND (blockers) the Horse's cards take more of their continuing hands than of their folding hands
 *     (the share of the field that folds given the Horse's cards is above the share without them).
 *
 * WHY (the measured node; NODES.md of the lane, 25,944 hands with a person, Oct 28 to Nov 27 2026): on a multiway
 * river after a checked-through turn Horses bet 10.9% (PLO5) and 12.5% (PLO4) of the time against people's 15.9% and
 * 18.9%, and people fold 92% / 90% of their answers to those bets; the priced river bluffs
 * (HorseOmahaRiverOpeningBet.ts, HorseOmahaOpeningBluff.ts) are heads-up, and the baseline multiway river bluff
 * (HorseMultiwayRiverBluff.ts, 2026-11-06: a nut blocker, a capped line and a frequency draw) prices nobody's fold;
 * the gap was measured with it on, and this rule prices the checks it leaves. Owner order: a late-street bluff is
 * never random; it is math dependent and blocker dependent.
 *
 * EACH OPPONENT'S FOLD. One estimate for every opponent, in the order his own lifetime public multiway river fold
 * record (HorseMind.omahaStrongHandCheckRecordsOf, small and big cells) -> PEOPLE's multiway population
 * (HorseOmahaMultiwayRiverFoldTables.json, scripts/ops/omaha-multiway-river-fold-fit.mjs: answers by people only to a
 * river first wager made with two or more opponents live, by game, turn line and size; a Horse's answer never enters
 * a cell) -> equilibrium, each level shrunk to the next by k = 75.9 river answers (the measured between-player prior
 * of HorseOmahaStrongHandCheck). The equilibrium of one opponent of N: the bettor is indifferent when all N fold
 * B / (P + B) of the time, so each folds (B / (P + B)) ^ (1 / N). Nothing is keyed on an account, a name or a
 * person/Horse flag of the player being priced; only the population's data source is people's play.
 *
 * THE PRICE. Each opponent folds the WEAKEST share of his range (his strategy cannot see the Horse's cards); the
 * share that actually folds given the Horse's cards is read on his card-removed range, exactly as the heads-up river
 * price reads it (omahaRiverOpeningPrice; his range is the measured people-only river range of
 * HorseOmahaRiverOpeningRangeTables.json for a player who checked, or who has not acted: measured heads-up, and a
 * multiway range is no weaker, so the check is never under-valued by it). The opponents' folds are taken as
 * independent: F0 = product of their strategy folds, F = product of their card-removed folds.
 *   EV(check) = product of the Horse's share against each range x P x (1 - rake)     (an upper bound first to act)
 *   EV(bet B) = F x P x (1 - rake) - (1 - F) x B          (anybody continues: the Horse is scored as losing the bet;
 *                                                           a raise costs the same, the Horse folds)
 *   margin    = (P x (1 - rake) + B) x F x sqrt( sum_i (1 - f_i) / (f_i x (n_i + k)) )   (binomial error of each fold)
 * The bet is made only when EV(bet) - EV(check) > margin and F > F0, on the best such size; a hand that beats more
 * than half of every opponent's continuing hands is a value bet and is not this file's.
 *
 * It changes only a check into a bet; never a raise (owner rule: a hand that is not nut class never raises the turn
 * or river), never a fold. PLO4/PLO5 cash, high only, one board, no bomb pot; heads-up spots, PLO6, hold'em and
 * tournaments are untouched. Pure: no telemetry, no state, no random draw.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaCardImpactAmounts } from './HorseOmahaCardImpact.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { omahaFoldMultiplierOnPeople, omahaPeopleFoldSizeCell } from './HorseOmahaPeopleFold.js';
import {
  OMAHA_RIVER_OPENING_EQ_FOLD,
  omahaRiverOpeningBins,
  omahaRiverOpeningCellHist,
  omahaRiverOpeningPrice,
  type OmahaRiverOpeningFoldRecord,
} from './HorseOmahaRiverOpeningBet.js';
import { OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS } from './HorseOmahaStrongHandCheck.js';
import tables from './HorseOmahaMultiwayRiverFoldTables.json' with { type: 'json' };

interface PeopleCell {
  n: number;
  fold: number;
  raise: number;
  eq: number;
}
const T = tables as unknown as { version: string; cells: Record<string, PeopleCell> };
export const OMAHA_MULTIWAY_RIVER_FOLD_VERSION: string = T.version;

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const WAGERS = new Set(['bet', 'raise', 'all_in']);
const ORDER = ['d>110', 'c70-110', 'b40-70', 'a<40'];

export type OmahaMultiwayRiverTurnLine = 'chk' | 'bet';

function shrink(cell: PeopleCell | undefined, k: number, parent: number): number {
  if (!cell || !(cell.n > 0) || !(cell.eq > 0)) return parent;
  const g = cell.eq / cell.n;
  const m = (Math.min(cell.fold, cell.n) + k * g * parent) / (cell.eq + k * g);
  return fin(m) && m >= 0 ? m : parent;
}

/**
 * People's multiway river fold multiplier on the equilibrium fold of one opponent of N, for the game, the turn line
 * and the size of the bet; n = the people answers of the size cell (0: the anchor alone, m = 1).
 */
export function omahaMultiwayRiverPeopleFold(
  variant: string,
  line: OmahaMultiwayRiverTurnLine,
  ratio: number
): { m: number; n: number } {
  const game = String(variant ?? '').toLowerCase();
  if ((game !== 'plo4' && game !== 'plo5') || !(ratio > 0)) return { m: 1, n: 0 };
  const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
  let size = omahaPeopleFoldSizeCell(ratio);
  // a size above every measured cell reads the biggest measured one
  for (let i = ORDER.indexOf(size); i < ORDER.length && !T.cells[`${game}|all|${size}`]; i++)
    size = ORDER[i];
  const all = T.cells[`${game}|all|${size}`];
  if (!all) return { m: 1, n: 0 };
  const mSize = shrink(all, k, 1);
  return { m: shrink(T.cells[`${game}|${line}|${size}`], k, mSize), n: all.n };
}

export interface OmahaMultiwayRiverBluffSpot {
  variant: 'plo4' | 'plo5';
  opponents: SeatPlayer[];
  /** per opponent: he has checked this river (the Horse acts after him) */
  checked: boolean[];
  line: OmahaMultiwayRiverTurnLine;
}

/** The spot, or null: PLO4/PLO5 cash river, nothing to call, no river wager, two or more opponents who can fold. */
export function omahaMultiwayRiverBluffSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaMultiwayRiverBluffSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return null;
    if (String(gs.stage ?? '') !== 'river') return null;
    if (gs.bettingStructure === 'fixed_limit') return null;
    if (gs.allInOrFold === true || gs.wagersCapped === true) return null;
    if ((gs.communityCards ?? []).length !== 5) return null;
    if (hero.is_folded || hero.is_all_in || !(hero.stack > 0)) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    if (!Number.isFinite(gs.pot) || !(gs.pot > 0)) return null;
    const opponents = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    );
    if (opponents.length < 2) return null;
    // an opponent who is all in cannot fold: the pot cannot be won without a showdown
    if (opponents.some((p) => p.is_all_in || !(p.stack > 0))) return null;
    const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
    const river = history.filter((a) => String(a.stage) === 'river');
    if (river.some((a) => WAGERS.has(String(a.action)))) return null;
    const turnWager = history.some(
      (a) => String(a.stage) === 'turn' && WAGERS.has(String(a.action))
    );
    const variant = String(gs.gameVariant ?? '').toLowerCase() === 'plo5' ? 'plo5' : 'plo4';
    return {
      variant,
      opponents,
      checked: opponents.map((o) =>
        river.some((a) => a.seat === o.seat && String(a.action) === 'check')
      ),
      line: turnWager ? 'bet' : 'chk',
    };
  } catch {
    return null;
  }
}

export interface OmahaMultiwayRiverBluffRow {
  amount: number;
  /** the field's fold without / with the Horse's cards */
  fold0: number;
  fold: number;
  ev: number;
  margin: number;
  /** the Horse beats more than half of every opponent's continuing hands: a value bet, not a bluff */
  value: boolean;
}
export interface OmahaMultiwayRiverBluffVerdict {
  opponents: number;
  evCheck: number;
  rows: OmahaMultiwayRiverBluffRow[];
  best: OmahaMultiwayRiverBluffRow | null;
}
export interface OmahaMultiwayRiverBluffOpponent {
  /** his measured river range (bins, strong to weak) */
  hist: readonly number[];
  record: OmahaRiverOpeningFoldRecord | null;
}

/** The comparison. Pure arithmetic over omahaRiverOpeningPrice, one opponent at a time. */
export function omahaMultiwayRiverBluffPrice(
  variant: string,
  line: OmahaMultiwayRiverTurnLine,
  opponents: readonly OmahaMultiwayRiverBluffOpponent[],
  bins: NonNullable<ReturnType<typeof omahaRiverOpeningBins>>,
  pot: number,
  amounts: readonly number[],
  rake: number
): OmahaMultiwayRiverBluffVerdict | null {
  const N = opponents.length;
  if (N < 2 || !(pot > 0)) return null;
  const sizes = amounts.filter((B) => B > 0);
  if (!sizes.length) return null;
  const r = fin(rake) ? Math.max(0, Math.min(0.2, rake)) : 0;
  const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
  let eqAll = 1;
  const per: Array<{
    rows: Map<number, { fold0: number; fold: number; eqCall: number }>;
    n: number[];
  }> = [];
  for (const o of opponents) {
    const ns: number[] = [];
    // omahaRiverOpeningPrice reads a multiplier on the heads-up equilibrium B / (P + B): hand it the multiway fold
    const foldAt = (B: number) => {
      const eqHu = B / (pot + B);
      const eqN = Math.pow(eqHu, 1 / N);
      const fm = omahaFoldMultiplierOnPeople(
        [
          { cell: o.record?.foldSmall, eq: OMAHA_RIVER_OPENING_EQ_FOLD.small },
          { cell: o.record?.foldBig, eq: OMAHA_RIVER_OPENING_EQ_FOLD.big },
        ],
        omahaMultiwayRiverPeopleFold(variant, line, B / pot).m,
        OMAHA_RIVER_OPENING_EQ_FOLD.mean,
        k
      );
      return { m: (fm.m * eqN) / eqHu, n: fm.n };
    };
    const v = omahaRiverOpeningPrice(o.hist, bins, pot, sizes, r, foldAt(sizes[0]), 'oop', foldAt);
    if (!v) return null;
    eqAll *= v.eq;
    const rows = new Map<number, { fold0: number; fold: number; eqCall: number }>();
    for (const row of v.rows) rows.set(row.amount, row);
    for (const B of sizes) ns.push(foldAt(B).n);
    per.push({ rows, n: ns });
  }
  const evCheck = eqAll * pot * (1 - r);
  const rows: OmahaMultiwayRiverBluffRow[] = [];
  sizes.forEach((B, si) => {
    let F0 = 1;
    let F = 1;
    let rel = 0;
    let value = true;
    for (const p of per) {
      const row = p.rows.get(B);
      if (!row) return;
      F0 *= row.fold0;
      F *= row.fold;
      rel += (1 - row.fold0) / (Math.max(row.fold0, 1e-6) * (p.n[si] + k));
      if (!(row.eqCall > 0.5)) value = false;
    }
    const ev = F * pot * (1 - r) - (1 - F) * B;
    rows.push({
      amount: B,
      fold0: round4(F0),
      fold: round4(F),
      ev: round4(ev),
      margin: round4((pot * (1 - r) + B) * F * Math.sqrt(rel)),
      value,
    });
  });
  if (!rows.length) return null;
  let best: OmahaMultiwayRiverBluffRow | null = null;
  for (const row of rows)
    if (
      !row.value &&
      row.ev - evCheck > row.margin &&
      row.fold > row.fold0 &&
      (!best || row.ev > best.ev)
    )
      best = row;
  return { opponents: N, evCheck: round4(evCheck), rows, best };
}

export interface OmahaMultiwayRiverBluffResult {
  decision: HorseDecision;
  changed: boolean;
  verdict?: OmahaMultiwayRiverBluffVerdict;
}

/**
 * The option's one entry. Every decision that is not a final check in the spot is returned as given (the same
 * object). `recordOf` reads an opponent's lifetime public multiway river fold record (null: none).
 */
export function omahaMultiwayRiverBluffRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  rake: number,
  legalize: (d: HorseDecision) => HorseDecision,
  recordOf: (opponent: SeatPlayer, opponents: number) => OmahaRiverOpeningFoldRecord | null
): OmahaMultiwayRiverBluffResult {
  const same: OmahaMultiwayRiverBluffResult = { decision, changed: false };
  if (!on || decision.action !== 'check') return same;
  try {
    const spot = omahaMultiwayRiverBluffSpot(hero, gs);
    if (!spot) return same;
    const bins = omahaRiverOpeningBins(
      hero.cards,
      gs.communityCards ?? [],
      hero.knownDeadCards ?? []
    );
    if (!bins) return same;
    const opponents: OmahaMultiwayRiverBluffOpponent[] = [];
    for (let i = 0; i < spot.opponents.length; i++) {
      const hist = omahaRiverOpeningCellHist(
        spot.variant,
        spot.checked[i] ? 'checkfirst' : 'ipstart',
        spot.line === 'bet' ? 'bet' : 'check'
      );
      if (!hist) return same;
      let record: OmahaRiverOpeningFoldRecord | null = null;
      try {
        record = recordOf(spot.opponents[i], spot.opponents.length);
      } catch {
        record = null;
      }
      opponents.push({ hist, record });
    }
    // the sizes the engine prices, capped by the deepest opponent's stack
    const deepest = spot.opponents.reduce((a, b) => (b.stack > a.stack ? b : a));
    const amounts = omahaCardImpactAmounts(hero, deepest, gs);
    if (!amounts.length) return same;
    const verdict = omahaMultiwayRiverBluffPrice(
      spot.variant,
      spot.line,
      opponents,
      bins,
      gs.pot,
      amounts,
      rake
    );
    if (!verdict) return same;
    if (!verdict.best) return { ...same, verdict };
    const legal = legalize({ ...decision, action: 'bet', amount: verdict.best.amount });
    if (legal.action !== 'bet' && legal.action !== 'all_in') return { ...same, verdict };
    if (
      !fin(legal.amount) ||
      !((legal.amount as number) > 0) ||
      (legal.amount as number) > hero.stack + 0.005
    )
      return { ...same, verdict };
    return {
      decision: { ...decision, action: legal.action, amount: round2(legal.amount as number) },
      changed: true,
      verdict,
    };
  } catch {
    return same;
  }
}
