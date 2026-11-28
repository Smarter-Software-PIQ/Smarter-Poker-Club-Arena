/**
 * WHAT A HEADS-UP RIVER FIRST BET IS IN NO-LIMIT HOLD'EM CASH: THE BETTOR'S OWN SHOWN RIVER BETS, THEN PEOPLE'S, THEN
 * EQUILIBRIUM (PLO-OWNER lead-9, lanes nlof and nlof2, 2026-11-27; owner orders of 2026-11-26 "the stats need to be
 * used against human players, not horses" and of 2026-11-27 "all overfolding fixes for PLO4, PLO5 and No Limit").
 * Read by holdemRiverFacingBetPriorIsPeopleMeasured (default OFF). The Hold'em analogue of
 * omahaFacingBetPriorIsPeopleMeasured.
 *
 * A river first bet is placed in one of six regions by where the bettor's hand stands among every two-card holding
 * the board and the Horse's own cards leave him (the share it beats, ties half): nut (0.95 and above), strong (0.9 to
 * 0.95), good (0.8 to 0.9) (the three together: the top fifth), upper middle (0.7 to 0.8), lower middle (0.5 to
 * 0.7), bottom (below 0.5). The top fifth is cut in three and the middle in two because people's river bets are not
 * spread evenly over them (of 25 shown top-fifth bets of 0.7 pot and more in cash, 14 were nut and 3 good; of 62
 * shown middle bets, 30 stood in the upper third of the middle): a hand that beats the lower part of a band does
 * not beat the bet. The price of the Horse's call is its exact share of wins against each region, weighted by the
 * share of his bets from that region:
 *
 *  1. EQUILIBRIUM ANCHOR: a bet of s pots bluffs s / (1 + 2 s) of the time (the share that leaves a call
 *     indifferent): bottom = s / (1 + 2 s), the rest spread over the top fifth by width, the middle = 0.
 *  2. PEOPLE'S POPULATION (HorseHoldemFacingBetPeoplePriorTables.json, scripts/ops/holdem-people-facing-bet-prior-fit.mjs):
 *     first bets of a heads-up river by PEOPLE only (a bet by a Horse never enters a cell), by size, the bettor's line
 *     (he made the last wager of the turn / the other player did / the turn was checked through) and the pot type
 *     (limped, single raised, re-raised), counted where the cards were shown (production shows every called river
 *     bettor, so the shown sample has no muck bias); a hand he mucked at the showdown is counted lower middle. Each
 *     cell is shrunk to its parent by K pseudo-bets: size x line x pot type -> size x line -> size (cash) -> size
 *     (cash and tournaments) -> anchor.
 *  3. HIS OWN SHOWN RIVER BETS (HorseHoldemBetRead: what his called heads-up river first bets turned out to be, by
 *     region; public showdown reveals only): his shown bets on THIS line of THIS size, against K_own pseudo-bets of
 *     people's cell, K_own the MEASURED between-bettor prior strength of people's river bets (the table's ownShown).
 *     His bets enter once, in the cell they were made in: a bettor's sizes and lines are not pooled (the Horse field
 *     itself sizes by strength: its shown river bets are 43% top under 0.4 pot and 67% top at 0.7 to 1.1 pot, so his
 *     small bets say little about his big ones). With no shown bet of his in the cell the shares are people's cell
 *     exactly; as his shown bets grow they dominate. How OFTEN he bets is not read: a bettor who bets more rivers
 *     than people may bluff more or bet thinner value, and only his shown bets tell which (the first build read the
 *     frequency and failed its grade on exactly that).
 *
 * The call is taken only when its value clears one standard error of the share it was priced on, and that error is
 * the error about THIS bettor: his not-top share on his shown bets in the cell plus the prior's pseudo-bets, the
 * pseudo-bets discounted by the sampling error of people's own cell. A bettor never seen at a showdown is priced on
 * people with the full between-bettor spread as the margin; the margin narrows as his own bets are shown.
 *
 * The same function for every opponent: nothing is keyed on an account, a name or a person/Horse flag of the player
 * being priced; only the population's data source is people's play. Public actions, shown cards and the Horse's own
 * cards only. Pure; reads a frozen table; draws nothing from fastRandom.
 */
import type { Card } from '../types.js';
import { holdemCardId, packHoldemBoardBits, scoreHoldemPlus2Ids } from './HorseEval.js';
import tables from './HorseHoldemFacingBetPeoplePriorTables.json' with { type: 'json' };

/** Shares or wins by region, strongest first: nut, strong, good, upper middle, lower middle, bottom. */
export type HoldemFacingBetRegions = readonly number[];
const T = tables as unknown as {
  version: string;
  regions: { from: readonly number[]; top: number; mucked: number };
  ownShown: { bettors: number; bets: number; priorStrength: number | null };
  ownShownTurn?: { bettors: number; bets: number; priorStrength: number | null };
  cells: Record<string, HoldemFacingBetRegions>;
};
export const HOLDEM_FACING_BET_PEOPLE_PRIOR_VERSION: string = T.version;
/** The floor of each region (the share of holdings a hand of that region beats, at least). */
export const HOLDEM_FACING_BET_REGION_FROM: readonly number[] = T.regions.from;
/** The first `HOLDEM_FACING_BET_TOP_REGIONS` regions are the top fifth. */
export const HOLDEM_FACING_BET_TOP_REGIONS: number = T.regions.top;
/** Pseudo-bets of every shrink step of the population cell. */
export const HOLDEM_FACING_BET_PRIOR_BETS = 20;
/** The measured between-bettor prior strength of people's river bets: the pseudo-bets people's cell keeps against a
 *  bettor's own shown river bets (the population shrink's own strength when the table could not measure it). */
export const HOLDEM_FACING_BET_OWN_PRIOR_BETS: number =
  T.ownShown.priorStrength ?? HOLDEM_FACING_BET_PRIOR_BETS;

export type HoldemFacingBetLine = 'b' | 'c' | 'x';
export type HoldemFacingBetPot = 'limped' | 'single' | 'reraised';
/** Shares of his bets by region (they sum to 1) and the bets behind them. */
export interface HoldemFacingBetShares {
  share: HoldemFacingBetRegions;
  /** the bets the shares stand on: people's bets in the finest cell read plus the pseudo-bets; with his own record,
   *  his shown bets of the line plus the prior's (discounted) pseudo-bets */
  n: number;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const R = T.regions.from.length;
const zeros = (): number[] => new Array<number>(R).fill(0);

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
  const out = zeros();
  for (let i = 0; i < 3; i++) out[i] = ((1 - bluff) * width[i]!) / top;
  out[R - 1] = bluff;
  return out;
}

function shrink(
  cell: HoldemFacingBetRegions | undefined,
  parent: HoldemFacingBetRegions
): { p: HoldemFacingBetRegions; n: number } {
  const k = HOLDEM_FACING_BET_PRIOR_BETS;
  const c = cell ?? zeros();
  let n = 0;
  for (let i = 0; i < R; i++) n += c[i] as number;
  const p = zeros();
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

const total = (c: readonly number[]): number => {
  let n = 0;
  for (let i = 0; i < R; i++)
    n += Number.isFinite(c[i]) && (c[i] as number) > 0 ? (c[i] as number) : 0;
  return n;
};
/** His counts against `k` pseudo-bets of `prior` (shares). */
function posterior(c: readonly number[], prior: readonly number[], k: number): number[] {
  const n = total(c);
  const p = zeros();
  for (let i = 0; i < R; i++) {
    const v = Number.isFinite(c[i]) && (c[i] as number) > 0 ? (c[i] as number) : 0;
    p[i] = (v + k * (prior[i] as number)) / (n + k);
  }
  return p;
}
/**
 * The shares of a heads-up river first bet of `ratio` pots by THIS bettor: his own shown river bets in this cell (this
 * line, this size; counts by region), then people's: his counts against K_own pseudo-bets of people's cell. No record:
 * people's cell, with the margin of a bettor about whom nothing is known (K_own pseudo-bets, discounted by the
 * sampling error of people's cell).
 */
export function holdemFacingBetOwnShares(
  ratio: number,
  line: HoldemFacingBetLine,
  pot: HoldemFacingBetPot | null,
  record: readonly number[] | null | undefined
): HoldemFacingBetShares & { shown: number } {
  const people = holdemFacingBetPeopleShares(ratio, line, pot);
  const k = HOLDEM_FACING_BET_OWN_PRIOR_BETS;
  // the prior's pseudo-bets cannot stand for more than people's own cell knows: 1 / (1 / k + 1 / n)
  const kEff = (k * people.n) / (k + people.n);
  const n = record ? total(record) : 0;
  if (!record || !(n > 0)) return { share: people.share, n: kEff, shown: 0 };
  return { share: posterior(record, people.share, k), n: kEff + n, shown: n };
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
  const win = zeros();
  const cnt = zeros();
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
  const wins = zeros();
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

// ---------------------------------------------------------------------------------------------------------------
// THE TURN: THE FIRST BET OF A HEADS-UP TURN AFTER A FLOP NOBODY BET (lane nlof2, 2026-11-27; NOT SHIPPED: no decision
// calls these functions; graded as a turn option it failed its delayed-stab bluffer bar). 30 days of NLH cash against people: such a bet folds the Horse 57.8% of the
// time where a pure bluff breaks even at 36.3% (+2.26 +/- 0.58 bb per bet, 128 bets), and people's shown turn bets on
// that line are the weakest of any line (not top: 62% shown, 67% with the hidden bets). The same price as the river
// with two differences: the regions are where his hand stands ON THE TURN, and the Horse's share against each region
// is its exact equity over every river card. The people cells count the hidden bets (mucked at the showdown, given
// up on the river), because before the river the shown sample alone over-states value.
// ---------------------------------------------------------------------------------------------------------------

/** The measured between-bettor prior strength of people's turn bets after a checked flop (the river's when the table
 *  could not measure it). */
export const HOLDEM_TURN_FACING_BET_OWN_PRIOR_BETS: number =
  T.ownShownTurn?.priorStrength ?? HOLDEM_FACING_BET_OWN_PRIOR_BETS;

/** People's shares for the first bet of `ratio` pots of a heads-up turn after a checked flop, in this pot type. */
export function holdemTurnFacingBetPeopleShares(
  ratio: number,
  pot: HoldemFacingBetPot | null
): HoldemFacingBetShares {
  const size = holdemFacingBetSizeCell(ratio);
  const any = shrink(T.cells[`turn|any|${size}|x|all`], holdemFacingBetAnchor(ratio));
  const cash = shrink(T.cells[`turn|cash|${size}|x|all`], any.p);
  const last = pot ? shrink(T.cells[`turn|cash|${size}|x|${pot}`], cash.p) : cash;
  return { share: last.p, n: last.n + HOLDEM_FACING_BET_PRIOR_BETS };
}

/**
 * The shares of the first bet of `ratio` pots of a heads-up turn after a checked flop by THIS bettor: his own turn
 * stabs of this size (HorseHoldemBetRead: shown, mucked at the showdown or given up; counts by region), then
 * people's: his counts against the measured between-bettor pseudo-bets of people's cell. No record: people's cell,
 * with the margin of a bettor about whom nothing is known.
 */
export function holdemTurnFacingBetOwnShares(
  ratio: number,
  pot: HoldemFacingBetPot | null,
  record: readonly number[] | null | undefined
): HoldemFacingBetShares & { shown: number } {
  const people = holdemTurnFacingBetPeopleShares(ratio, pot);
  const k = HOLDEM_TURN_FACING_BET_OWN_PRIOR_BETS;
  const kEff = (k * people.n) / (k + people.n);
  const n = record ? total(record) : 0;
  if (!record || !(n > 0)) return { share: people.share, n: kEff, shown: 0 };
  return { share: posterior(record, people.share, k), n: kEff + n, shown: n };
}

/**
 * The Horse's exact equity on this turn (every river card, ties half) against his holdings of each region, the
 * regions cut by each holding's standing ON THE TURN among all the holdings the board and the Horse's cards leave
 * him. Null when the cards do not make a turn. Draws nothing from fastRandom.
 */
export function holdemTurnFacingBetRegionEquities(
  hero: readonly Card[],
  board: readonly Card[]
): { wins: HoldemFacingBetRegions; holdings: number } | null {
  if (hero.length !== 2 || board.length !== 4) return null;
  const dead = new Uint8Array(64);
  const ids = new Uint8Array(5);
  for (let i = 0; i < 4; i++) {
    const id = holdemCardId(board[i] as Card);
    if (id < 0 || dead[id]) return null;
    dead[id] = 1;
    ids[i] = id;
  }
  const h0 = holdemCardId(hero[0] as Card);
  const h1 = holdemCardId(hero[1] as Card);
  if (h0 < 0 || h1 < 0 || h0 === h1 || dead[h0] || dead[h1]) return null;
  dead[h0] = 1;
  dead[h1] = 1;
  // his holdings and where each stands on the turn
  const bits4 = packHoldemBoardBits(ids, 4);
  const ha: number[] = [];
  const hb: number[] = [];
  const score: number[] = [];
  for (let a = 0; a < 52; a++) {
    if (dead[a]) continue;
    for (let b = a + 1; b < 52; b++) {
      if (dead[b]) continue;
      ha.push(a);
      hb.push(b);
      score.push(scoreHoldemPlus2Ids(bits4, a, b, false));
    }
  }
  const n = score.length;
  if (n < 2) return null;
  const order = score.map((_, i) => i).sort((x, y) => (score[x] as number) - (score[y] as number));
  const regionOf = new Uint8Array(n);
  const from = HOLDEM_FACING_BET_REGION_FROM;
  for (let i = 0; i < n; ) {
    let j = i;
    const v = score[order[i] as number] as number;
    while (j + 1 < n && score[order[j + 1] as number] === v) j++;
    const p = (i + j) / 2 / (n - 1);
    let region = R - 1;
    for (let r = 0; r < R; r++)
      if (p >= (from[r] as number)) {
        region = r;
        break;
      }
    for (let k = i; k <= j; k++) regionOf[order[k] as number] = region;
    i = j + 1;
  }
  // every river card: the Horse against each holding the card leaves him
  const win = zeros();
  const cnt = zeros();
  for (let c = 0; c < 52; c++) {
    if (dead[c]) continue;
    ids[4] = c;
    const bits5 = packHoldemBoardBits(ids, 5);
    const mine = scoreHoldemPlus2Ids(bits5, h0, h1, false);
    for (let i = 0; i < n; i++) {
      const a = ha[i] as number;
      const b = hb[i] as number;
      if (a === c || b === c) continue;
      const v = scoreHoldemPlus2Ids(bits5, a, b, false);
      const g = regionOf[i] as number;
      cnt[g] = (cnt[g] as number) + 1;
      if (mine > v) win[g] = (win[g] as number) + 1;
      else if (mine === v) win[g] = (win[g] as number) + 0.5;
    }
  }
  const wins = zeros();
  for (let r = 0; r < R; r++)
    wins[r] = (cnt[r] as number) > 0 ? (win[r] as number) / (cnt[r] as number) : 0;
  return { wins, holdings: n };
}

/** `wins` scaled by the share of its equity a call before the river realizes. */
export function holdemFacingBetRealized(
  wins: HoldemFacingBetRegions,
  realization: number
): HoldemFacingBetRegions {
  const r = fin(realization) && realization > 0 && realization < 1 ? realization : 1;
  return wins.map((w) => w * r);
}

/** Whether nobody wagered on the flop (and the flop was acted on). */
export function holdemFacingBetFlopWasChecked(
  history: ReadonlyArray<{ stage?: unknown; action?: unknown }> | undefined
): boolean {
  let acted = false;
  for (const a of Array.isArray(history) ? history : []) {
    if (String(a.stage) !== 'flop') continue;
    acted = true;
    const act = String(a.action);
    if (act === 'bet' || act === 'raise' || act === 'all_in') return false;
  }
  return acted;
}
