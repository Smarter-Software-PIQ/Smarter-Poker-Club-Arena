/**
 * WHAT A HEADS-UP RIVER FIRST BET IS IN NO-LIMIT HOLD'EM CASH: THE BETTOR'S OWN RECORD, THEN PEOPLE'S, THEN EQUILIBRIUM
 * (PLO-OWNER lead-9, lane nlof, 2026-11-27; owner orders of 2026-11-26 "the stats need to be used against human
 * players, not horses" and of 2026-11-27 "all overfolding fixes for PLO4, PLO5 and No Limit"). Read by
 * holdemRiverFacingBetPriorIsPeopleMeasured (default OFF). The Hold'em analogue of omahaFacingBetPriorIsPeopleMeasured.
 *
 * A river first bet is placed in one of five regions by where the bettor's hand stands among every two-card holding
 * the board and the Horse's own cards leave him (the share it beats, ties half): nut (0.95 and above), strong (0.9 to
 * 0.95), good (0.8 to 0.9) (the three together: the top fifth), mid (0.5 to 0.8), bottom (below 0.5). The top fifth is
 * cut in three because people's big river bets are not spread evenly over it (of 25 shown top-fifth bets of 0.7 pot
 * and more in cash, 14 were nut and 3 good: a hand that beats the good part does not beat the bet). The price of the
 * Horse's call is its exact share of wins against each region, weighted by the share of his bets from that region:
 *
 *  1. EQUILIBRIUM ANCHOR: a bet of s pots bluffs s / (1 + 2 s) of the time (the share that leaves a call
 *     indifferent): bottom = s / (1 + 2 s), the rest spread over the top fifth by width, mid = 0.
 *  2. PEOPLE'S POPULATION (HorseHoldemFacingBetPeoplePriorTables.json, scripts/ops/holdem-people-facing-bet-prior-fit.mjs):
 *     first bets of a heads-up river by PEOPLE only (a bet by a Horse never enters a cell), by size, the bettor's line
 *     (he made the last wager of the turn / the other player did / the turn was checked through) and the pot type
 *     (limped, single raised, re-raised), counted where the cards were shown; a hand he mucked at the showdown is
 *     counted mid (it lost: it is not value, and it is not counted as air). Each cell is shrunk to its parent by K
 *     pseudo-bets: size x line x pot type -> size x line -> size (cash) -> size (cash and tournaments) -> anchor.
 *  3. HIS OWN RECORD (public actions only): how often he makes the first wager on an unopened heads-up river (his
 *     lifetime record, OPPONENT-HUD's river stab and lead cells), shrunk by the measured between-player prior strength
 *     to people's measured river rate times his pooled rate ratio (how often he bets when no bet is to be faced on
 *     any street, his decayed betCheckedTo counters, shrunk to people's). The cards deal every player the same share of top-fifth hands, so the rate at which he bets
 *     one is people's and the rest of his bets is not top:
 *         rho = his rate / people's rate            top_his = top / rho (nut : strong : good as people's), mid and
 *                                                   bottom share the rest in people's proportion (when rho is below
 *                                                   the top share itself, all top)
 *     With no record rho = 1 and the price is people's; as his record grows it dominates. A player who bets every
 *     checked-to spot is priced as a bluffer within a few hands, before a single showdown; a player who bets rarely
 *     is priced as value.
 *
 * The call is taken only when its value clears the sampling error of the share it was priced on (one standard error
 * of the not-top share on the bets behind the cell and the pseudo-bets), so a thin cell does not buy a call.
 *
 * The same function for every opponent: nothing is keyed on an account, a name or a person/Horse flag of the player
 * being priced; only the population's data source is people's play. Public actions and the Horse's own cards only.
 * Pure; reads a frozen table; draws nothing from fastRandom.
 */
import type { Card } from '../types.js';
import { holdemCardId, packHoldemBoardBits, scoreHoldemPlus2Ids } from './HorseEval.js';
import tables from './HorseHoldemFacingBetPeoplePriorTables.json' with { type: 'json' };

/** Shares or wins by region, strongest first: nut, strong, good, mid, bottom. */
export type HoldemFacingBetRegions = readonly [number, number, number, number, number];
const T = tables as unknown as {
  version: string;
  regions: { from: readonly number[]; top: number; mid: number };
  checkedTo: { bets: number; opps: number; rate: number; priorStrength: number | null };
  riverUnopened: { bets: number; opps: number; rate: number; priorStrength: number | null };
  cells: Record<string, HoldemFacingBetRegions>;
};
export const HOLDEM_FACING_BET_PEOPLE_PRIOR_VERSION: string = T.version;
/** The floor of each region (the share of holdings a hand of that region beats, at least). */
export const HOLDEM_FACING_BET_REGION_FROM: readonly number[] = T.regions.from;
/** The first `HOLDEM_FACING_BET_TOP_REGIONS` regions are the top fifth. */
export const HOLDEM_FACING_BET_TOP_REGIONS: number = T.regions.top;
/** Pseudo-bets of every shrink step of the population cell. */
export const HOLDEM_FACING_BET_PRIOR_BETS = 20;
/** People's measured rate of betting when no bet is to be faced postflop (NLH cash), and its prior strength. */
export const HOLDEM_FACING_BET_PEOPLE_CHECKED_TO_RATE: number = T.checkedTo.rate;
export const HOLDEM_FACING_BET_RECORD_PRIOR_OPPS: number = T.checkedTo.priorStrength ?? 20;
/** People's measured rate of making the first wager on an unopened heads-up river (NLH cash), and its prior strength. */
export const HOLDEM_FACING_BET_PEOPLE_RIVER_RATE: number = T.riverUnopened.rate;
export const HOLDEM_FACING_BET_RIVER_RECORD_PRIOR_OPPS: number =
  T.riverUnopened.priorStrength ?? 20;

export type HoldemFacingBetLine = 'b' | 'c' | 'x';
export type HoldemFacingBetPot = 'limped' | 'single' | 'reraised';
/** Shares of his bets by region (they sum to 1) and the bets behind them. */
export interface HoldemFacingBetShares {
  share: HoldemFacingBetRegions;
  /** people's bets in the finest cell read, plus the pseudo-bets: the sample the shares stand on */
  n: number;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const R = 5;

export function holdemFacingBetSizeCell(ratio: number): string {
  return ratio < 0.4 ? 'a<40' : ratio < 0.7 ? 'b40-70' : ratio <= 1.1 ? 'c70-110' : 'd>110';
}

/** The share of his bets in the top fifth. */
export function holdemFacingBetTopShare(share: HoldemFacingBetRegions): number {
  let t = 0;
  for (let i = 0; i < HOLDEM_FACING_BET_TOP_REGIONS; i++) t += share[i] as number;
  return t;
}

/** The equilibrium anchor of a bet of `ratio` pots: the indifference bluff share at the bottom, the rest over the
 *  top fifth by the width of its regions. */
export function holdemFacingBetAnchor(ratio: number): HoldemFacingBetRegions {
  const s = fin(ratio) && ratio > 0 ? ratio : 0;
  const bluff = s / (1 + 2 * s);
  const f = HOLDEM_FACING_BET_REGION_FROM;
  const width = [
    1 - (f[0] as number),
    (f[0] as number) - (f[1] as number),
    (f[1] as number) - (f[2] as number),
  ];
  const top = width[0]! + width[1]! + width[2]!;
  return [
    ((1 - bluff) * width[0]!) / top,
    ((1 - bluff) * width[1]!) / top,
    ((1 - bluff) * width[2]!) / top,
    0,
    bluff,
  ];
}

function shrink(
  cell: HoldemFacingBetRegions | undefined,
  parent: HoldemFacingBetRegions
): { p: HoldemFacingBetRegions; n: number } {
  const k = HOLDEM_FACING_BET_PRIOR_BETS;
  const c = cell ?? [0, 0, 0, 0, 0];
  let n = 0;
  for (let i = 0; i < R; i++) n += c[i] as number;
  const p = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  for (let i = 0; i < R; i++) p[i] = ((c[i] as number) + k * (parent[i] as number)) / (n + k);
  return { p, n };
}

/** People's shares for a heads-up river first bet of `ratio` pots on this line in this pot type. */
export function holdemFacingBetPeopleShares(
  ratio: number,
  line: HoldemFacingBetLine | null,
  pot: HoldemFacingBetPot | null
): HoldemFacingBetShares {
  const size = holdemFacingBetSizeCell(ratio);
  const any = shrink(T.cells[`river|any|${size}|all|all`], holdemFacingBetAnchor(ratio));
  const cash = shrink(T.cells[`river|cash|${size}|all|all`], any.p);
  let last = cash;
  if (line) {
    last = shrink(T.cells[`river|cash|${size}|${line}|all`], cash.p);
    if (pot) last = shrink(T.cells[`river|cash|${size}|${line}|${pot}`], last.p);
  }
  return { share: last.p, n: last.n + HOLDEM_FACING_BET_PRIOR_BETS };
}

/** A public record of his: `bets` first wagers in `opps` spots. */
export interface HoldemFacingBetRecord {
  bets: number;
  opps: number;
}
const usable = (r: HoldemFacingBetRecord | null | undefined): r is HoldemFacingBetRecord =>
  !!r && fin(r.bets) && fin(r.opps) && r.opps > 0 && r.bets >= 0;

/**
 * rho: how often he makes the river's first wager, over people's rate. His own RIVER record (his lifetime first
 * wagers on an unopened heads-up river) is shrunk to people's river rate times his pooled rho; his pooled rho is his
 * rate of betting when no bet is to be faced on any street (his betCheckedTo counters) shrunk to people's, over
 * people's. Evidence order: his river record -> his pooled record -> people. No record at all: 1.
 */
export function holdemFacingBetRho(
  river: HoldemFacingBetRecord | null | undefined,
  pooled: HoldemFacingBetRecord | null | undefined
): { rho: number; opps: number } {
  const base = HOLDEM_FACING_BET_PEOPLE_CHECKED_TO_RATE;
  const baseRiver = HOLDEM_FACING_BET_PEOPLE_RIVER_RATE;
  let rho = 1;
  let opps = 0;
  if (usable(pooled) && base > 0) {
    const k = HOLDEM_FACING_BET_RECORD_PRIOR_OPPS;
    rho = (Math.min(pooled.bets, pooled.opps) + k * base) / (pooled.opps + k) / base;
    opps += pooled.opps;
  }
  if (usable(river) && baseRiver > 0) {
    const k = HOLDEM_FACING_BET_RIVER_RECORD_PRIOR_OPPS;
    // the prior rate of his river record is a rate: people's river rate times his pooled rho, never above 1
    const prior = baseRiver * rho < 1 ? baseRiver * rho : 1;
    rho = (Math.min(river.bets, river.opps) + k * prior) / (river.opps + k) / baseRiver;
    opps += river.opps;
  }
  return fin(rho) && rho > 0 ? { rho, opps } : { rho: 1, opps: 0 };
}

/**
 * His shares at `rho` times people's rate of betting: the top fifth's share is people's over rho (its three regions in
 * people's proportion), the rest keeps people's mid : bottom proportion.
 */
export function holdemFacingBetOwnShares(
  people: HoldemFacingBetShares,
  rho: number
): HoldemFacingBetShares {
  const top0 = holdemFacingBetTopShare(people.share);
  const rest0 = 1 - top0;
  if (!fin(rho) || !(rho > 0) || rho === 1 || !(rest0 > 0) || !(top0 > 0)) return people;
  // a probability: when he bets more rarely than people bet their top fifth, every bet of his is top
  const top = top0 / rho < 1 ? top0 / rho : 1;
  const share = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  for (let i = 0; i < R; i++)
    share[i] =
      i < HOLDEM_FACING_BET_TOP_REGIONS
        ? ((people.share[i] as number) * top) / top0
        : ((people.share[i] as number) * (1 - top)) / rest0;
  return { share, n: people.n };
}

/**
 * The Horse's exact share of wins (ties half) on this river against his holdings of each region, the regions cut by
 * each holding's standing among all the holdings the board and the Horse's cards leave him. Null when the cards do
 * not make a river.
 */
export function holdemFacingBetRegionWins(
  hero: readonly Card[],
  board: readonly Card[]
): { wins: HoldemFacingBetRegions; holdings: number } | null {
  if (hero.length !== 2 || board.length !== 5) return null;
  const dead = new Uint8Array(64);
  const ids = new Uint8Array(5);
  for (let i = 0; i < 5; i++) {
    const id = holdemCardId(board[i] as Card);
    if (id < 0 || dead[id]) return null;
    dead[id] = 1;
    ids[i] = id;
  }
  const h0 = holdemCardId(hero[0] as Card);
  const h1 = holdemCardId(hero[1] as Card);
  if (h0 < 0 || h1 < 0 || h0 === h1 || dead[h0] || dead[h1]) return null;
  const bits = packHoldemBoardBits(ids, 5);
  const mine = scoreHoldemPlus2Ids(bits, h0, h1, false);
  dead[h0] = 1;
  dead[h1] = 1;
  const scores: number[] = [];
  for (let a = 0; a < 52; a++) {
    if (dead[a]) continue;
    for (let b = a + 1; b < 52; b++) {
      if (dead[b]) continue;
      scores.push(scoreHoldemPlus2Ids(bits, a, b, false));
    }
  }
  const n = scores.length;
  if (n < 2) return null;
  scores.sort((x, y) => x - y);
  const win = [0, 0, 0, 0, 0];
  const cnt = [0, 0, 0, 0, 0];
  const from = HOLDEM_FACING_BET_REGION_FROM;
  for (let i = 0; i < n; ) {
    let j = i;
    const v = scores[i] as number;
    while (j + 1 < n && scores[j + 1] === v) j++;
    const p = (i + j) / 2 / (n - 1);
    let region = R - 1;
    for (let r = 0; r < R; r++)
      if (p >= (from[r] as number)) {
        region = r;
        break;
      }
    const m = j - i + 1;
    cnt[region] = (cnt[region] as number) + m;
    win[region] = (win[region] as number) + m * (mine > v ? 1 : mine === v ? 0.5 : 0);
    i = j + 1;
  }
  const wins = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  for (let r = 0; r < R; r++)
    wins[r] = (cnt[r] as number) > 0 ? (win[r] as number) / (cnt[r] as number) : 0;
  return { wins, holdings: n };
}

export interface HoldemFacingBetPrice {
  /** the Horse's share of wins against the priced bet */
  equity: number;
  /** the value of the call in chips, counted from the decision (a fold is 0) */
  value: number;
  /** one standard error of that value from the sampling error of the not-top share */
  error: number;
  /** the call clears its error */
  call: boolean;
}

/**
 * The call of `toCall` to win `winnable` (the pot as it stands, less any part of his bet the Horse cannot match),
 * `rake` the marginal share of the final pot the house takes.
 */
export function holdemFacingBetPrice(
  wins: HoldemFacingBetRegions,
  shares: HoldemFacingBetShares,
  winnable: number,
  toCall: number,
  rake: number
): HoldemFacingBetPrice | null {
  if (!(winnable > 0) || !(toCall > 0) || !fin(rake) || rake < 0 || rake >= 1) return null;
  let equity = 0;
  let topEq = 0;
  for (let i = 0; i < R; i++) {
    const part = (shares.share[i] as number) * (wins[i] as number);
    equity += part;
    if (i < HOLDEM_FACING_BET_TOP_REGIONS) topEq += part;
  }
  const prize = (winnable + toCall) * (1 - rake);
  const value = equity * prize - toCall;
  // the not-top share q on n bets: se = sqrt(q (1 - q) / n); it moves the equity by (wins not-top - wins top) se
  const top = holdemFacingBetTopShare(shares.share);
  // a share: rounding must not leave it outside [0, 1]
  const q = Math.min(1, Math.max(0, 1 - top));
  const winsTop = top > 0 ? topEq / top : 0;
  const winsRest = q > 0 ? (equity - topEq) / q : winsTop;
  const se = Math.sqrt((q * (1 - q)) / Math.max(1, shares.n));
  const error = Math.abs(winsRest - winsTop) * se * prize;
  if (!fin(value) || !fin(error)) return null;
  return { equity, value, error, call: value > error };
}

/** The bettor's line from the public action of the turn. */
export function holdemFacingBetLineOf(
  history:
    | ReadonlyArray<{ seat: number; stage?: unknown; action?: unknown; isFullRaise?: boolean }>
    | undefined,
  bettorSeat: number
): HoldemFacingBetLine {
  let last: number | null = null;
  for (const a of Array.isArray(history) ? history : []) {
    const act = String(a.action);
    if (String(a.stage) === 'turn' && (act === 'bet' || act === 'raise' || act === 'all_in'))
      last = a.seat;
  }
  return last === null ? 'x' : last === bettorSeat ? 'b' : 'c';
}

/** The pot type from the public preflop action: the number of raises. */
export function holdemFacingBetPotOf(
  history: ReadonlyArray<{ stage?: unknown; action?: unknown; isFullRaise?: boolean }> | undefined
): HoldemFacingBetPot {
  let raises = 0;
  for (const a of Array.isArray(history) ? history : []) {
    if (String(a.stage ?? 'preflop') !== 'preflop') continue;
    const act = String(a.action);
    if (act === 'raise' || act === 'bet' || (act === 'all_in' && a.isFullRaise === true)) raises++;
  }
  return raises === 0 ? 'limped' : raises === 1 ? 'single' : 'reraised';
}
