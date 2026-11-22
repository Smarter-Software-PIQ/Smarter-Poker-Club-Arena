/**
 * PLO6 RIVER DEFENCE AND SIX-CARD CURRENT-NUTS CALL FLOOR (E7, 2026-11-20,
 * PLO6 lane; wired inside plo6FacingBetIsPriced, default OFF, read `=== true`).
 *
 * Owner rules: everything depends on the math; humans and Horses treated
 * identically; no blanket rules; every Horse decision priced by range, equity
 * and EV.
 *
 * Measured across all 270 PLO6 postflop river facing-bet decisions and 387
 * PLO6 river wagers in the 48 h human-table cash dataset (1,218 hands,
 * opponent six-card holdings read from facts.json):
 *
 * 1. MULTIWAY SIX-CARD JOINT RIVER FIELD EVALUATOR (`plo6MultiwayRiverVerdict`):
 *    - In `HorseOmahaFacingBetEv`, multiway rivers multiply `vsBettor` by the
 *      independent four-card factor `top(0.35)^callers * (1 - 0.25 * beaten)^behind`,
 *      ignoring (a) that six-card multiway river bets have only 3.5% non-value
 *      holdings (`u >= 0.5`: 3 of 85 measured multiway PLO6 river bets, vs
 *      16.0% heads-up) and (b) disjoint six-card removal across the bettor,
 *      callers, and players behind.
 *    - `plo6MultiwayRiverVerdict` draws a deterministic card-seeded pool of
 *      640 six-card holdings ranked on the 5-card river board, translates each
 *      caller (`0.35`) and earlier all-in (`0.50`) to six-card strength at the
 *      four-card bar (`plo6ValueShareAtSameStrength`), walks 360 disjoint
 *      six-card showdown sets across the bettor and all `callers + allIns +
 *      behind` opponents, and weights `j = 0 .. behind` continuing players
 *      binomially at `omahaFlopEvBehindContinue(potFrac)` with the measured
 *      multiway river non-value share (`PLO6_MULTIWAY_RIVER_BLUFF_SCALE = 0.25`
 *      of the heads-up prior, matching `0.035 / 0.160 = 0.22`).
 *    - Eliminates dominated multiway river over-calls (two-pair in 4-way pot
 *      #59947932, wheel straight on 3-flush board #59970374, trips on 3-flush
 *      board #59968124, T-high flush in 4-way pot #60043092, underboat `22` on
 *      `A922A` in 4-way pot #60069439) while keeping profitable multiway flushes,
 *      straights, and full houses.
 *
 * 2. HEADS-UP SIX-CARD RIVER VALUE-DOMINATION GUARD (`plo6RiverFoldGuardStands`):
 *    - On a heads-up river raise (`29/29` measured PLO6 river raises had
 *      `0.0%` bluffs, `beaten <= 0.065`) or a non-flush hand (`cat < 6`) on a
 *      three-flush board where `> 60%` of unseen six-card holdings beat hero
 *      and hero beats `< 15%` of the bettor's value region (`#59973046`), the
 *      bluff prior alone cannot manufacture a losing call (`price > 0.10`).
 *
 * 3. SIX-CARD EXACT CURRENT-NUTS RIVER CALL FLOOR (`plo6RiverCurrentNutsCallSpot`):
 *    - Mirrors `HorseOmahaRiverCurrentNutsCallFloor` (#11522, PLO4/PLO5 only)
 *      for six-card PLO6 cash: when hero holds the exact unbeatable current
 *      river nuts (`hasRiverNuts(player, gs, false)`) and worst-case chop
 *      `(pot + paid) / (live + 1) >= paid`, `EV(call) >= 0` against ANY range
 *      and the Horse NEVER folds.
 *
 * 4. NUT-END RIVER RAISE PRESERVATION & STANDING CALL PROTECTION:
 *    - `plo6RiverKeepStandingRaise`: in `#11511`, `omahaPricedRaise` flattened
 *      unbeaten river value jams (#59962430 quads Aces `beaten = 0.000`,
 *      #59973676 nut straight `beaten = 0.000`, #60055450 nut straight
 *      `beaten = 0.000`, #59974331 top boat `KK` on `K-J-4-2-2` `beaten = 0.018`,
 *      `vsValue = 0.977`) into passive calls or min-raises because
 *      `plo6ValueShareAtSameStrength` widened `counts.valueShare` on paired /
 *      straight boards. When hero holds private river nuts OR a top-2% river
 *      monster (`beaten <= 0.02` and `vsValue >= 0.75`), a standing river
 *      raise/all-in is NEVER flattened to a passive call or smaller raise.
 *    - Likewise, a standing heads-up river call made by the brain (#60091132,
 *      winning flush with `vsValue = 0.250`) is preserved when
 *      `plo6RiverFoldGuardStands` is false and `vsValue >= 0.20` (while
 *      dominated river calls like #59973335 `44` underboat with `vsValue = 0.091`
 *      still fold by price).
 *
 * Pure: reads only the public request and hero's six cards + known dead cards.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import {
  OMAHA_EV_ALL_IN_SHARE,
  OMAHA_EV_CALLER_SHARE,
  omahaEvHandCounts,
  omahaFacingBetEvSpot,
  type OmahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import { OMAHA_SHOWN_FIELD_MAX } from './HorseOmahaFacingBetEvShownField.js';
import { omahaFlopEvBehindContinue } from './HorseOmahaFlopFacingBetEv.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { plo6BoardFlushPossible, plo6BoardPaired } from './HorsePlo6PricingPort.js';
import { plo6ValueShareAtSameStrength } from './HorsePlo6ValueShare.js';
import { hasRiverNuts } from './HorseRiverNuts.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
const WALK = 0.6180339887498949;

/** Pool size and disjoint showdown sets for six-card multiway river evaluation. */
export const PLO6_MW_RIVER_POOL = 640;
export const PLO6_MW_RIVER_SETS = 360;
/**
 * Measured multiway PLO6 river non-value ratio relative to heads-up:
 * 3/85 (3.5%) multiway vs 41/256 (16.0%) heads-up across 1,218 PLO6 cash hands (`0.035 / 0.160 = 0.22`).
 */
export const PLO6_MW_RIVER_BLUFF_SCALE = 0.25;

export interface Plo6RiverCurrentNutsCallSpot {
  paid: number;
  allIn: boolean;
}

export interface Plo6MultiwayRiverVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  price: number;
  equity: number;
  callerShareSix: number;
  spot: OmahaFacingBetEvSpot;
}

function stream(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(hole: Card[], board: Card[], dead: Card[]): number {
  let h = 0x811c9dc5;
  for (const g of [hole, board, dead]) {
    for (const k of g.map(key).sort())
      for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 124, 0x01000193);
  }
  return h >>> 0 || 1;
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function behindCallOf(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: OmahaFacingBetEvSpot
): number {
  if (spot.behind <= 0) return 0;
  const heroTotal = (Number.isFinite(player.bet) ? Math.max(0, player.bet) : 0) + spot.paid;
  let total = 0;
  let count = 0;
  for (const p of gs.players ?? []) {
    if (p.seat === player.seat || p.seat === spot.bettorSeat || p.is_folded || p.is_sitting_out)
      continue;
    const bet = Number.isFinite(p.bet) ? Math.max(0, p.bet) : 0;
    if (p.is_all_in || bet + 0.011 >= gs.currentBet) continue;
    const stack = Number.isFinite(p.stack) ? Math.max(0, p.stack) : 0;
    total += Math.max(0, Math.min(bet + stack, gs.currentBet, heroTotal) - bet);
    count++;
  }
  return count > 0 ? total / count : spot.paid;
}

/**
 * Six-card PLO6 cash exact current-nuts river call floor spot:
 * non-null when hero holds the exact unbeatable river nuts (`hasRiverNuts`) and
 * `(pot + paid) / (live + 1) >= paid - 1e-9` so the call can never lose chips
 * even if every live opponent chops with the identical nuts.
 */
export function plo6RiverCurrentNutsCallSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): Plo6RiverCurrentNutsCallSpot | null {
  try {
    if (String(gs.gameVariant ?? '').toLowerCase() !== 'plo6') return null;
    if (omahaIsTournamentMode(gs)) return null;
    if (
      gs.stage !== 'river' ||
      gs.wagersCapped === true ||
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.bombPot === true ||
      gs.allInOrFold
    )
      return null;
    if ((gs.communityCards ?? []).length !== 5 || (player.cards ?? []).length !== 6) return null;
    if (player.is_folded || player.is_all_in || player.is_sitting_out) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Number.isFinite(gs.currentBet) && Number.isFinite(player.bet)
        ? Math.max(0, gs.currentBet - player.bet)
        : NaN;
    if (!Number.isFinite(toCall) || !(toCall > 0.005)) return null;
    if (!Number.isFinite(gs.pot) || !(gs.pot > 0)) return null;
    if (!Number.isFinite(player.stack) || !(player.stack > 0)) return null;
    const allIn = player.stack <= toCall + 0.005;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    if (legal && !legal.includes(allIn ? 'all_in' : 'call') && !legal.includes('call')) return null;
    const paid = Math.min(toCall, player.stack);
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    ).length;
    if (live < 1) return null;
    if ((gs.pot + paid) / (live + 1) < paid - 1e-9) return null;
    if (!hasRiverNuts(player, gs, false)) return null;
    return { paid: Math.round(paid * 100) / 100, allIn };
  } catch {
    return null;
  }
}

/**
 * True when hero holds either the exact unbeatable private-card river nuts OR a
 * top-2% river value monster (`beaten <= 0.02` and `vsValue >= 0.75`) in PLO6 cash,
 * so a standing river value raise / jam is never flattened into a passive call or smaller raise.
 */
export function plo6HasPrivateRiverNuts(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot?: OmahaFacingBetEvSpot | null
): boolean {
  try {
    if (String(gs.gameVariant ?? '').toLowerCase() !== 'plo6' || gs.stage !== 'river') return false;
    if (hasRiverNuts(player, gs, true)) return true;
    const s = spot ?? omahaFacingBetEvSpot(player, gs, { plo6Priced: true });
    if (!s || s.street !== 'river') return false;
    const hole = player.cards ?? [];
    const board = gs.communityCards ?? [];
    const dead = player.knownDeadCards ?? [];
    if (hole.length !== 6 || board.length !== 5) return false;
    const counted = omahaEvHandCounts(hole, board, dead, s.valueShare);
    if (!counted) return false;
    const beaten = Math.max(0, 1 - counted.all.win - counted.all.tie);
    const vsValue = counted.value.win + 0.5 * counted.value.tie;
    return beaten <= 0.02 && vsValue >= 0.75;
  } catch {
    return false;
  }
}

/**
 * True when a standing river call made by the brain has genuine equity against the
 * bettor's value region (`vsValue >= 0.20` and `plo6RiverFoldGuardStands` is false),
 * preventing borderline pot-odds noise from turning winning flushes (#60091132) into folds
 * while still folding dominated bluff-catchers (#59973335 `vsValue = 0.091`).
 */
export function plo6RiverStandingCallHolds(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot?: OmahaFacingBetEvSpot | null
): boolean {
  try {
    const s = spot ?? omahaFacingBetEvSpot(player, gs, { plo6Priced: true });
    if (!s || s.street !== 'river') return false;
    if (plo6RiverFoldGuardStands(player, gs, s) === true) return false;
    const hole = player.cards ?? [];
    const board = gs.communityCards ?? [];
    const dead = player.knownDeadCards ?? [];
    if (hole.length !== 6 || board.length !== 5) return false;
    const counted = omahaEvHandCounts(hole, board, dead, s.valueShare);
    if (!counted) return false;
    const vsValue = counted.value.win + 0.5 * counted.value.tie;
    return vsValue >= 0.2;
  } catch {
    return false;
  }
}

/**
 * Joint disjoint-card six-card multiway river verdict (`callers + allIns + behind > 0`).
 * Returns null heads-up or outside a countable PLO6 cash multiway river spot.
 */
export function plo6MultiwayRiverVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: { rake: number },
  preSpot?: OmahaFacingBetEvSpot | null
): Plo6MultiwayRiverVerdict | null {
  try {
    const spot = preSpot ?? omahaFacingBetEvSpot(player, gs, { plo6Priced: true });
    if (!spot || spot.street !== 'river') return null;
    const B = Math.max(0, Math.floor(spot.behind));
    const others = spot.callers + spot.allIns + B;
    if (others < 1 || others > OMAHA_SHOWN_FIELD_MAX) return null;
    const hole: Card[] = player.cards ?? [];
    const board: Card[] = gs.communityCards ?? [];
    const dead: Card[] = player.knownDeadCards ?? [];
    if (hole.length !== 6 || board.length !== 5) return null;
    if (new Set([...hole, ...board].map(key)).size !== 11) return null;

    const removed = new Set([...hole, ...board, ...dead].map(key));
    const unseen: Card[] = [];
    for (const s of SUITS)
      for (const r of RANKS) {
        const c = { rank: r, suit: s } as Card;
        if (!removed.has(key(c))) unseen.push(c);
      }
    const m = unseen.length;
    const maxDisjointOthers = Math.min(others, Math.floor((m - 6) / 6));
    if (maxDisjointOthers < 1) return null;

    const baseCaller =
      spot.potFrac < 0.25
        ? 1 - (1 - OMAHA_EV_CALLER_SHARE.river) * (spot.potFrac / 0.25)
        : OMAHA_EV_CALLER_SHARE.river;
    const callerShareSix = plo6ValueShareAtSameStrength(hole, board, dead, baseCaller);
    const allInShareSix =
      spot.allIns > 0
        ? plo6ValueShareAtSameStrength(hole, board, dead, OMAHA_EV_ALL_IN_SHARE)
        : OMAHA_EV_ALL_IN_SHARE;
    const always: number[] = [];
    for (let i = 0; i < spot.callers; i++) always.push(callerShareSix);
    for (let i = 0; i < spot.allIns; i++) always.push(allInShareSix);

    const pairScores = new Float64Array(m * m);
    const two: Card[] = [unseen[0], unseen[0]];
    for (let i = 0; i < m; i++) {
      two[0] = unseen[i];
      for (let j = i + 1; j < m; j++) {
        two[1] = unseen[j];
        const sc = scoreOmahaHiPartial(two, board);
        pairScores[i * m + j] = sc;
        pairScores[j * m + i] = sc;
      }
    }

    const rnd = stream(seedOf(hole, board, dead));
    const P = PLO6_MW_RIVER_POOL;
    const n = 6;
    const cards = new Int8Array(P * n);
    const strength = new Float64Array(P);
    const deck = new Int8Array(m);
    for (let p = 0; p < P; p++) {
      for (let i = 0; i < m; i++) deck[i] = i;
      for (let k = 0; k < n; k++) {
        const j = k + Math.floor(rnd() * (m - k));
        const t = deck[k];
        deck[k] = deck[j];
        deck[j] = t;
        cards[p * n + k] = deck[k];
      }
      let best = 0;
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) {
          const sc = pairScores[cards[p * n + a] * m + cards[p * n + b]];
          if (sc > best) best = sc;
        }
      strength[p] = best;
    }

    const order = Array.from({ length: P }, (_, p) => p).sort(
      (a, b) => strength[b] - strength[a] || a - b
    );
    const clampShare = (s: number): number =>
      Math.max(0.02, Math.min(1, Number.isFinite(s) ? s : 1));
    const vc = Math.max(1, Math.min(P - 1, Math.round(clampShare(spot.valueShare) * P)));
    const A = always.length;
    const fieldCount = Array.from({ length: others }, (_, f) =>
      Math.max(1, Math.min(P, Math.round(clampShare(f < A ? always[f] : callerShareSix) * P)))
    );
    const walks = Array.from({ length: others + 2 }, () => rnd());
    const used = new Uint8Array(m);
    const draw = (w: number, from: number, count: number): number => {
      const i = Math.floor(walks[w] * count);
      walks[w] = (walks[w] + WALK) % 1;
      const tries = Math.min(count, 320);
      for (let t = 0; t < tries; t++) {
        const p = order[from + ((i + t) % count)];
        let ok = true;
        for (let k = 0; k < n; k++)
          if (used[cards[p * n + k]]) {
            ok = false;
            break;
          }
        if (ok) return p;
      }
      return -1;
    };
    const mark = (p: number, v: number): void => {
      for (let k = 0; k < n; k++) used[cards[p * n + k]] = v;
    };

    const hero = scoreOmahaHiPartial(hole, board);
    const accV = new Float64Array(B + 1);
    const accO = new Float64Array(B + 1);
    let nV = 0;
    let nO = 0;
    const fieldScore = new Float64Array(others);
    const picked = new Int32Array(others + 1);

    for (let s = 0; s < PLO6_MW_RIVER_SETS; s++) {
      const isValue = s % 2 === 0;
      const p = isValue ? draw(0, 0, vc) : draw(1, vc, P - vc);
      if (p < 0) continue;
      mark(p, 1);
      picked[0] = p;
      let drawn = 0;
      let whole = true;
      for (let k = 0; k < others; k++) {
        const g = draw(2 + k, 0, fieldCount[k]);
        if (g < 0) {
          whole = false;
          break;
        }
        if (k < maxDisjointOthers) {
          mark(g, 1);
          picked[++drawn] = g;
        }
        fieldScore[k] = strength[g];
      }
      for (let u = 1; u <= drawn; u++) mark(picked[u], 0);
      mark(p, 0);
      if (!whole) continue;
      const bettor = strength[p];
      let best = bettor;
      let tied = hero === bettor ? 1 : 0;
      for (let f = 0; f < A; f++) {
        if (fieldScore[f] > best) best = fieldScore[f];
        if (fieldScore[f] === hero) tied++;
      }
      const acc = isValue ? accV : accO;
      for (let j = 0; j <= B; j++) {
        if (j > 0) {
          const x = fieldScore[A + j - 1];
          if (x > best) best = x;
          if (x === hero) tied++;
        }
        if (hero > best) acc[j] += 1;
        else if (hero === best) acc[j] += 1 / (1 + tied);
      }
      if (isValue) nV++;
      else nO++;
    }
    if (!(nV > 0) || !(nO > 0)) return null;

    const q = Math.max(0, Math.min(1, spot.priorBluff * PLO6_MW_RIVER_BLUFF_SCALE));
    const c = B > 0 ? Math.max(0, Math.min(1, omahaFlopEvBehindContinue(spot.potFrac))) : 0;
    const behindAdd = behindCallOf(player, gs, spot);
    const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? ctx.rake : 0));

    let ev = 0;
    let equity = 0;
    for (let j = 0; j <= B; j++) {
      const w = B > 0 ? binom(B, j) * c ** j * (1 - c) ** (B - j) : 1;
      const e = q * (accO[j] / nO) + (1 - q) * (accV[j] / nV);
      const T = (spot.winnable + j * behindAdd) * (1 - rake) + spot.paid;
      ev += w * (e * T - spot.paid);
      equity += w * e;
    }

    const baseMargin =
      omahaStrategyConstant('facingBetEvMargin', { gameVariant: 'plo6' }) *
      (spot.winnable + spot.paid);
    const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
    const price = spot.paid / (spot.winnable + spot.paid);

    return {
      call: ev > margin,
      ev,
      margin,
      pWin: Math.min(1, equity),
      pTie: 0,
      price,
      equity,
      callerShareSix,
      spot,
    };
  } catch {
    return null;
  }
}

/**
 * Six-card river value-domination fold guard (`price > 0.10`):
 * 1. Facing a river raise (`29/29` measured PLO6 river raises had `0.0%` bluffs,
 *    `beaten <= 0.065`): fold when `beaten >= 0.15` and hero beats `< 35%` of the
 *    bettor's value region (`vsValue < 0.35`, e.g. #59974302 AA boat on `69222` or
 *    #60096350 trips vs river raise).
 * 2. Facing a river bet with a non-flush hand (`cat < 6`) on a three-flush board or
 *    a non-boat hand (`cat < 7`) on a paired board when `beaten >= 0.60` and hero
 *    beats `< 15%` of the bettor's value region (`vsValue < 0.15`, e.g. #59973046
 *    two-pair on 3-flush river `beaten = 0.781, vsValue = 0.109` -> `E = 0.041`).
 * Null outside a countable six-card river.
 */
export function plo6RiverFoldGuardStands(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot?: OmahaFacingBetEvSpot | null
): boolean | null {
  try {
    const s = spot ?? omahaFacingBetEvSpot(player, gs, { plo6Priced: true });
    if (!s || s.street !== 'river') return null;
    const hole = player.cards ?? [];
    const board = gs.communityCards ?? [];
    const dead = player.knownDeadCards ?? [];
    if (hole.length !== 6 || board.length !== 5) return null;
    const price = s.paid / (s.winnable + s.paid);
    if (price <= 0.1) return false;
    const counted = omahaEvHandCounts(hole, board, dead, s.valueShare);
    if (!counted) return null;
    const beaten = Math.max(0, 1 - counted.all.win - counted.all.tie);
    const vsValue = counted.value.win + 0.5 * counted.value.tie;
    if (s.isRaise && beaten >= 0.15 && vsValue < 0.35) return true;
    const cat = Math.floor(scoreOmahaHiPartial(hole, board) / 0x100000);
    const flushBlocked = plo6BoardFlushPossible(board) && cat < 6;
    const boatBlocked = plo6BoardPaired(board) && cat < 7;
    if ((flushBlocked || boatBlocked) && beaten >= 0.6 && vsValue < 0.15) return true;
    return false;
  } catch {
    return null;
  }
}
