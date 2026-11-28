/**
 * A TURN CALL IN NO-LIMIT HOLD'EM CASH PRICED TOGETHER WITH WHAT THE HORSE WILL DO ON THE RIVER (PLO-OWNER lead-10,
 * lane nlt, 2026-11-28; owner orders of 2026-11-26 "the stats need to be used against human players, not horses" and of
 * 2026-11-27 "all overfolding fixes for PLO4, PLO5 and No Limit"; owner rule: floating a street is right only when the
 * Horse will continue later; calling and then folding to every later barrel must stop). Read by
 * holdemTurnFacingBetAfterCheckedFlopIsPeoplePriced (default OFF).
 *
 * The spot: heads-up, the flop checked through, the first bet of the turn. 30 days of NLH cash against people: such a
 * bet folds the Horse 57.8% of the time where a pure bluff breaks even at 36.3% (+2.26 +/- 0.58 bb per bet, 128 bets).
 * A call priced on the turn alone (lane nlof2) did not close it: the Horse called and then folded the river, so the
 * delayed stab with a river barrel kept winning. Here the call is priced on the whole rest of the hand:
 *
 *  1. HIS TURN RANGE: every two-card holding the board and the Horse's cards leave him, placed in six regions by where
 *     it stands ON THE TURN (HorseHoldemFacingBetPeoplePrior's regions), weighted by the shares of his turn stabs (his
 *     own stabs -> people's turn cell with the hidden bets counted -> equilibrium). Holdings of a region weigh alike.
 *  2. HIS RIVER BARREL, on each river card: the holdings of his turn range that bet again are those whose make-up by
 *     RIVER region is what his river bets after his own turn bet are (his own shown river bets of that line -> people's
 *     river cell of that line -> equilibrium; HorseHoldemFacingBetPeoplePrior). By Bayes the chance a holding of river
 *     region r barrels is proportional to C_r / m_r (C the barrels' share of region r, m his turn range's mass there),
 *     the region with the largest ratio barrelling every time. That gives the barrel rate his make-up implies, B. HIS
 *     OWN RECORD of how often he barrels after a called stab (HorseHoldemBetRead) moves it: f = (barrels + K B) /
 *     (spots + K), K the measured between-bettor strength of river bets. Below B every region barrels f / B as often
 *     (the make-up kept); above B the rest of his range fills the extra barrels evenly.
 *  3. THE HORSE'S RIVER, card by card: facing his barrel it calls exactly when the river price calls (the Horse's share
 *     of wins against the barrelling holdings of each river region, weighted by C, clearing its error as
 *     holdemFacingBetPrice rules); facing his check it takes its showdown share against the holdings that check. The
 *     Horse's own river bets are not counted (the plan never counts chips it might not win).
 *  4. THE TURN CALL'S VALUE = the mean over river cards of what the plan wins, less the call. The decision hook makes
 *     the river calls the plan counted (holdemTurnRiverPlanRiverPrice: the same price on the card that came and the
 *     bet that was made), so a call bought with river calls is followed by those calls.
 *
 * The same function for every opponent: nothing is keyed on an account, a name or a person/Horse flag. Public actions,
 * shown cards and the Horse's own cards only. Pure; draws nothing from fastRandom.
 */
import type { Card } from '../types.js';
import { holdemCardId, packHoldemBoardBits, scoreHoldemPlus2Ids } from './HorseEval.js';
import {
  HOLDEM_FACING_BET_OWN_PRIOR_BETS,
  HOLDEM_FACING_BET_REGION_FROM,
  HOLDEM_FACING_BET_TOP_REGIONS,
  holdemFacingBetPrice,
  type HoldemFacingBetPrice,
  type HoldemFacingBetRegions,
  type HoldemFacingBetShares,
} from './HorseHoldemFacingBetPeoplePrior.js';

const R = HOLDEM_FACING_BET_REGION_FROM.length;
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const zeros = (): number[] => new Array<number>(R).fill(0);

function regionOfShare(p: number): number {
  for (let r = 0; r < R; r++) if (p >= (HOLDEM_FACING_BET_REGION_FROM[r] as number)) return r;
  return R - 1;
}

/** The region of each of `n` scores by its standing among them (the share it beats, ties half). */
function regionsOf(score: Float64Array, n: number, out: Uint8Array): void {
  const order: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => (score[x] as number) - (score[y] as number));
  for (let i = 0; i < n; ) {
    let j = i;
    const v = score[order[i] as number] as number;
    while (j + 1 < n && score[order[j + 1] as number] === v) j++;
    const g = regionOfShare(n > 1 ? (i + j) / 2 / (n - 1) : 0);
    for (let k = i; k <= j; k++) out[order[k] as number] = g;
    i = j + 1;
  }
}

/** The holdings and where each stands on the turn; null when the cards do not make a turn. */
interface TurnBoard {
  dead: Uint8Array;
  ids: Uint8Array;
  h0: number;
  h1: number;
  n: number;
  ha: Uint8Array;
  hb: Uint8Array;
  turnRegion: Uint8Array;
  /** holdings per turn region */
  cnt: number[];
}
function turnBoardOf(hero: readonly Card[], board4: readonly Card[]): TurnBoard | null {
  if (hero.length !== 2 || board4.length !== 4) return null;
  const dead = new Uint8Array(64);
  const ids = new Uint8Array(5);
  for (let i = 0; i < 4; i++) {
    const id = holdemCardId(board4[i] as Card);
    if (id < 0 || dead[id]) return null;
    dead[id] = 1;
    ids[i] = id;
  }
  const h0 = holdemCardId(hero[0] as Card);
  const h1 = holdemCardId(hero[1] as Card);
  if (h0 < 0 || h1 < 0 || h0 === h1 || dead[h0] || dead[h1]) return null;
  dead[h0] = 1;
  dead[h1] = 1;
  const bits4 = packHoldemBoardBits(ids, 4);
  const ha = new Uint8Array(1326);
  const hb = new Uint8Array(1326);
  const score = new Float64Array(1326);
  let n = 0;
  for (let a = 0; a < 52; a++) {
    if (dead[a]) continue;
    for (let b = a + 1; b < 52; b++) {
      if (dead[b]) continue;
      ha[n] = a;
      hb[n] = b;
      score[n] = scoreHoldemPlus2Ids(bits4, a, b, false);
      n++;
    }
  }
  if (n < 2) return null;
  const turnRegion = new Uint8Array(n);
  regionsOf(score, n, turnRegion);
  const cnt = zeros();
  for (let i = 0; i < n; i++) cnt[turnRegion[i] as number]! += 1;
  return { dead, ids, h0, h1, n, ha, hb, turnRegion, cnt };
}

/** The weight of one holding of each turn region (his turn shares spread evenly over the region's holdings). */
function holdingWeights(tb: TurnBoard, turnShare: HoldemFacingBetRegions): number[] | null {
  const w = zeros();
  let tot = 0;
  for (let g = 0; g < R; g++) {
    const s = turnShare[g] as number;
    if ((tb.cnt[g] as number) > 0 && fin(s) && s > 0) {
      w[g] = s / (tb.cnt[g] as number);
      tot += s;
    }
  }
  if (!(tot > 0)) return null;
  for (let g = 0; g < R; g++) w[g] = (w[g] as number) / tot;
  return w;
}

/** One river card: his turn range's mass in each river region and the Horse's wins (ties half) against it. */
interface RiverCell {
  mass: number[];
  wins: number[];
}
/** Every river card: each holding's river region (255: the card is in it) and the Horse's result against it, in halves. */
interface RiverTable {
  cards: number[];
  region: Uint8Array[];
  half: Uint8Array[];
}
function riverTableOf(tb: TurnBoard, only: number | null): RiverTable {
  const ids = tb.ids;
  const scratch = new Float64Array(tb.n);
  const reg = new Uint8Array(tb.n);
  const out: RiverTable = { cards: [], region: [], half: [] };
  for (let card = 0; card < 52; card++) {
    if (tb.dead[card] || (only !== null && card !== only)) continue;
    ids[4] = card;
    const bits5 = packHoldemBoardBits(ids, 5);
    const mine = scoreHoldemPlus2Ids(bits5, tb.h0, tb.h1, false);
    let m = 0;
    for (let i = 0; i < tb.n; i++) {
      const a = tb.ha[i] as number;
      const b = tb.hb[i] as number;
      if (a === card || b === card) continue;
      scratch[m++] = scoreHoldemPlus2Ids(bits5, a, b, false);
    }
    regionsOf(scratch, m, reg);
    const region = new Uint8Array(tb.n).fill(255);
    const half = new Uint8Array(tb.n);
    let k = 0;
    for (let i = 0; i < tb.n; i++) {
      const a = tb.ha[i] as number;
      const b = tb.hb[i] as number;
      if (a === card || b === card) continue;
      const v = scratch[k] as number;
      region[i] = reg[k] as number;
      half[i] = mine > v ? 2 : mine === v ? 1 : 0;
      k++;
    }
    out.cards.push(card);
    out.region.push(region);
    out.half.push(half);
  }
  return out;
}
function riverCellOf(
  tb: TurnBoard,
  rt: RiverTable,
  j: number,
  weight: readonly number[]
): RiverCell {
  const mass = zeros();
  const wins = zeros();
  const region = rt.region[j] as Uint8Array;
  const half = rt.half[j] as Uint8Array;
  for (let i = 0; i < tb.n; i++) {
    const r = region[i] as number;
    if (r === 255) continue;
    const w = weight[tb.turnRegion[i] as number] as number;
    if (!(w > 0)) continue;
    mass[r] = (mass[r] as number) + w;
    wins[r] = (wins[r] as number) + (w * (half[i] as number)) / 2;
  }
  return { mass, wins };
}

/** His barrel on one card: the barrel shares (C over the regions his range holds) and the chance each region barrels. */
function barrelOf(
  cell: RiverCell,
  river: HoldemFacingBetRegions
): { share: number[]; p: number[] } | null {
  let tot = 0;
  for (let r = 0; r < R; r++) tot += cell.mass[r] as number;
  if (!(tot > 0)) return null;
  const share = zeros();
  let cs = 0;
  for (let r = 0; r < R; r++)
    if ((cell.mass[r] as number) > 0 && fin(river[r]) && (river[r] as number) > 0) {
      share[r] = river[r] as number;
      cs += river[r] as number;
    }
  if (!(cs > 0)) return null;
  let top = 0;
  const ratio = zeros();
  for (let r = 0; r < R; r++) {
    share[r] = (share[r] as number) / cs;
    if ((share[r] as number) > 0) {
      ratio[r] = (share[r] as number) / ((cell.mass[r] as number) / tot);
      if ((ratio[r] as number) > top) top = ratio[r] as number;
    }
  }
  const p = zeros();
  for (let r = 0; r < R; r++) p[r] = top > 0 ? (ratio[r] as number) / top : 0;
  return { share, p };
}

export interface HoldemTurnRiverPlanSpot {
  /** the turn call */
  toCall: number;
  /** the turn pot the call can win (the pot as it stands, less any part of his bet the Horse cannot match) */
  winnable: number;
  /** chips both players can still put in on the river after the call */
  behind: number;
  /** the river bet the plan expects, in pots (his turn bet's) */
  riverRatio: number;
  /** the house's marginal share of the final pot */
  rake: number;
  /** his river bets after his own turn bet (own shown record -> people -> anchor), with the n of their error */
  river: HoldemFacingBetShares;
  /** his own record of the river after his called turn stabs: spots and barrels (null: none) */
  barrels?: { spots: number; barrels: number } | null;
}

/** The barrel chance of each river region with his own barrel record read against the rate `implied` by his make-up. */
export function holdemTurnRiverPlanBarrelChance(
  p: readonly number[],
  implied: number,
  record: { spots: number; barrels: number } | null | undefined
): number[] {
  const spots = record && fin(record.spots) && record.spots > 0 ? record.spots : 0;
  const barrels =
    spots > 0 && fin(record?.barrels) ? Math.min(spots, Math.max(0, record!.barrels)) : 0;
  if (!(spots > 0) || !(implied > 0)) return p.slice();
  const k = HOLDEM_FACING_BET_OWN_PRIOR_BETS;
  const f = (barrels + k * implied) / (spots + k);
  if (f <= implied) return p.map((x) => (x * f) / implied);
  const a = implied < 1 ? (f - implied) / (1 - implied) : 0;
  return p.map((x) => 1 - (1 - x) * (1 - a));
}

export interface HoldemTurnRiverPlanValue {
  /** chips the call wins over the fold, the river played to the plan */
  value: number;
  /** the share of river cards on which he barrels, mean */
  barrel: number;
  /** the share of his barrels the plan calls, mean */
  riverCall: number;
  /** the Horse's showdown share against the whole range, mean over cards (no river betting) */
  equity: number;
}

function planValue(
  tb: TurnBoard,
  rt: RiverTable,
  turnShare: HoldemFacingBetRegions,
  spot: HoldemTurnRiverPlanSpot
): HoldemTurnRiverPlanValue | null {
  const weight = holdingWeights(tb, turnShare);
  if (!weight) return null;
  const pot1 = spot.winnable + spot.toCall;
  const keepRake = 1 - spot.rake;
  const bet = Math.min(spot.riverRatio * pot1, spot.behind);
  let cards = 0;
  let sum = 0;
  let barrelSum = 0;
  let callSum = 0;
  let eqSum = 0;
  for (let j = 0; j < rt.cards.length; j++) {
    const cell = riverCellOf(tb, rt, j, weight);
    let tot = 0;
    let win = 0;
    for (let r = 0; r < R; r++) {
      tot += cell.mass[r] as number;
      win += cell.wins[r] as number;
    }
    if (!(tot > 0)) continue;
    cards++;
    eqSum += win / tot;
    const b0 = bet > 0 ? barrelOf(cell, spot.river.share) : null;
    if (!b0) {
      sum += (win / tot) * pot1 * keepRake;
      continue;
    }
    let implied = 0;
    for (let r = 0; r < R; r++) implied += ((cell.mass[r] as number) / tot) * (b0.p[r] as number);
    const b = { share: b0.share, p: holdemTurnRiverPlanBarrelChance(b0.p, implied, spot.barrels) };
    // the Horse's share of wins against the barrelling holdings of each river region
    const regionWins = zeros();
    let barrel = 0;
    let checkWins = 0;
    for (let r = 0; r < R; r++) {
      const m = cell.mass[r] as number;
      if (!(m > 0)) continue;
      regionWins[r] = (cell.wins[r] as number) / m;
      barrel += (m / tot) * (b.p[r] as number);
      checkWins += ((cell.wins[r] as number) / tot) * (1 - (b.p[r] as number));
    }
    const price = holdemFacingBetPrice(
      regionWins,
      { share: b.share, n: spot.river.n },
      pot1 + bet,
      bet,
      spot.rake
    );
    const call = price !== null && price.call;
    sum +=
      barrel * (call ? (price as HoldemFacingBetPrice).value : 0) + checkWins * pot1 * keepRake;
    barrelSum += barrel;
    if (call) callSum += barrel;
  }
  if (cards === 0) return null;
  const value = sum / cards - spot.toCall;
  if (!fin(value)) return null;
  return {
    value,
    barrel: barrelSum / cards,
    riverCall: barrelSum > 0 ? callSum / barrelSum : 0,
    equity: eqSum / cards,
  };
}

/** `share` with its not-top part moved down by one standard error on `n` bets (toward his top fifth). */
export function holdemTurnRiverPlanToTop(share: HoldemFacingBetRegions, n: number): number[] {
  let top = 0;
  for (let i = 0; i < HOLDEM_FACING_BET_TOP_REGIONS; i++) top += share[i] as number;
  const q = 1 - top;
  const out = share.slice();
  if (!(q > 0) || !(top > 0)) return out;
  const se = Math.sqrt((q * (1 - q)) / Math.max(1, n));
  // a share stays a share: the not-top part cannot go below none
  const q2 = Math.max(0, q - se);
  for (let i = 0; i < R; i++)
    out[i] =
      i < HOLDEM_FACING_BET_TOP_REGIONS
        ? ((share[i] as number) * (1 - q2)) / top
        : ((share[i] as number) * q2) / q;
  return out;
}

export interface HoldemTurnRiverPlanPrice {
  /** the plan's value on his shares */
  central: HoldemTurnRiverPlanValue;
  /** the plan's value with his turn shares moved one standard error toward his top fifth */
  cautious: HoldemTurnRiverPlanValue;
  /** call: the cautious value is above the fold */
  call: boolean;
}

/**
 * The turn call against his turn stab: `turn` his turn-stab shares and `turnN` the bets behind their error (people's
 * cell plus his own stabs). Null when the cards do not make a turn or nothing can be priced.
 */
export function holdemTurnRiverPlanTurnPrice(
  hero: readonly Card[],
  board4: readonly Card[],
  turn: HoldemFacingBetRegions,
  turnN: number,
  spot: HoldemTurnRiverPlanSpot
): HoldemTurnRiverPlanPrice | null {
  if (
    !(spot.toCall > 0) ||
    !(spot.winnable > 0) ||
    !fin(spot.rake) ||
    spot.rake < 0 ||
    spot.rake >= 1
  )
    return null;
  if (!fin(spot.behind) || spot.behind < 0 || !fin(spot.riverRatio) || spot.riverRatio < 0)
    return null;
  const tb = turnBoardOf(hero, board4);
  if (!tb) return null;
  const rt = riverTableOf(tb, null);
  const central = planValue(tb, rt, turn, spot);
  if (!central) return null;
  const cautious = planValue(tb, rt, holdemTurnRiverPlanToTop(turn, turnN), spot);
  if (!cautious) return null;
  return { central, cautious, call: cautious.value > 0 };
}

/**
 * The river half of the plan: facing his river bet after the Horse called his turn stab, the Horse's share of wins
 * against the holdings of his TURN range (weighted by `turn`) in each river region, priced on his river shares exactly
 * as the turn's plan priced it (holdemFacingBetPrice). Null when the cards do not make a river.
 */
export function holdemTurnRiverPlanRiverPrice(
  hero: readonly Card[],
  board5: readonly Card[],
  turn: HoldemFacingBetRegions,
  river: HoldemFacingBetShares,
  winnable: number,
  toCall: number,
  rake: number
): HoldemFacingBetPrice | null {
  if (board5.length !== 5) return null;
  const tb = turnBoardOf(hero, board5.slice(0, 4));
  if (!tb) return null;
  const card = holdemCardId(board5[4] as Card);
  if (card < 0 || tb.dead[card]) return null;
  const weight = holdingWeights(tb, turn);
  if (!weight) return null;
  const cell = riverCellOf(tb, riverTableOf(tb, card), 0, weight);
  const b = barrelOf(cell, river.share);
  if (!b) return null;
  const regionWins = zeros();
  for (let r = 0; r < R; r++) {
    const m = cell.mass[r] as number;
    regionWins[r] = m > 0 ? (cell.wins[r] as number) / m : 0;
  }
  return holdemFacingBetPrice(regionWins, { share: b.share, n: river.n }, winnable, toCall, rake);
}
