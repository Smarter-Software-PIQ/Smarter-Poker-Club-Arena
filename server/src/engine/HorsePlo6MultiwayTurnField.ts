/**
 * PLO6 MULTIWAY TURN JOINT FIELD EVALUATOR (E8, 2026-11-20, PLO6 lane; wired
 * inside plo6FacingBetIsPriced, default OFF, read `=== true`).
 *
 * Owner rules: no blanket rules; every Horse decision priced by range, equity
 * and EV; humans and Horses treated identically.
 *
 * What E8 fixes on the PLO6 cash multiway turn (`spot.callers + spot.allIns +
 * spot.behind > 0`):
 *
 * 1. WHY THE STATIC TURN FIELD FACTOR BROKE IN SIX-CARD OMAHA:
 *    In `HorseOmahaFacingBetEv.omahaFacingBetEvVerdict`, `counted.top(share)`
 *    scored `heroNow = scoreOmahaHiPartial(hole, board)` ONLY on the 4-card
 *    turn board as it stood — zero river cards walked — and multiplied `pWin`
 *    by `need(callerShare, true) ** callers * need(0.25, false) ** behind`:
 *    - Defect A (Improving multiway hands zeroed out): A six-card hand with a
 *      nut flush draw, wrap, or set/two-pair with nut redraws whose static
 *      4-card turn score sits below the caller's static bar gets `holds = 0`
 *      against any caller (`pWin * 0 = 0`), folding profitable multiway draws
 *      and redraws regardless of pot odds.
 *    - Defect B (Dead non-improving hands over-called when `behind > 0`): When
 *      `callers === 0` and `behind >= 1`, `1 - 0.25 * (1 - holds)` used the
 *      un-translated 4-card share `0.25` and ignored disjoint six-card river
 *      runouts, causing #11511's 26 multiway turn fold->call flips to lose
 *      -340.3 bb against actual opponent six-card holdings (mean true equity
 *      0.133 vs mean price 0.221, only 7/26 profitable).
 *    Meanwhile `HorseOmahaFacingBetEvShownField.omahaShownJoint` solved this
 *    for PLO4/PLO5 only (`hole.length !== 4 && hole.length !== 5 -> null`).
 *
 * 2. THE SIX-CARD JOINT MULTIWAY TURN VERDICT:
 *    - Draws a card-seeded pool of unseen six-card holdings ranked by turn
 *      board strength; translates the bettor's `valueShare`, each caller's
 *      `OMAHA_EV_CALLER_SHARE.turn` (0.45, tapered under 0.25 pot), and earlier
 *      all-ins (`OMAHA_EV_ALL_IN_SHARE`, 0.50) to six-card strength on this
 *      board (`plo6ValueShareAtSameStrength`).
 *    - Walks EVERY unseen river card `rv` (`0 .. m - 1`) and draws disjoint
 *      six-card holdings for the bettor (from his value region or his other
 *      holdings) and for every caller, all-in, and player still to act (`behind`),
 *      computing hero's exact pot share (full win + `1 / (1 + tied)` tie share)
 *      jointly on each 5-card river board `[*board, unseen[rv]]`.
 *    - Sums binomially over the `j = 0 .. behind` players behind who continue
 *      at `omahaFlopEvBehindContinue(spot.potFrac)`, adding `j * behindCall`
 *      to the winnable pot, and applies the measured turn realization cell
 *      (`OMAHA_SHOWN_TURN_REALIZATION[klass][ip|oop]`: `two_pair_plus`,
 *      `nut_combo_draw`, `one_pair`) plus the reviewed paired-turn boatless
 *      cap when river stacks remain behind.
 *    - Deterministic (`ev > margin`, card-seeded stream only, zero random mixing
 *      or opponent memory), so `plo6FacingBetPricedAdmitsCall` in
 *      `responseValidation.ts` re-runs the identical verdict on the request.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import {
  OMAHA_EV_ALL_IN_SHARE,
  OMAHA_EV_CALLER_SHARE,
  omahaFacingBetEvSpot,
  type OmahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_SHOWN_FIELD_MAX,
  OMAHA_SHOWN_TURN_REALIZATION,
  omahaShownTurnClass,
  type OmahaShownTurnClass,
} from './HorseOmahaFacingBetEvShownField.js';
import { omahaFlopEvBehindContinue } from './HorseOmahaFlopFacingBetEv.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
const WALK = 0.6180339887498949;

/** Six-card pool size and disjoint showdown sets walked per unseen river card. */
export const PLO6_MW_TURN_POOL = 640;
export const PLO6_MW_TURN_SETS_PER_RIVER = 10;

export interface Plo6MultiwayTurnJoint {
  value: number[];
  other: number[];
  nValue: number;
  nOther: number;
  rivers: number;
}

export interface Plo6MultiwayTurnVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  price: number;
  equity: number;
  realization: number;
  klass: OmahaShownTurnClass;
  callerShareSix: number;
  continueRate: number;
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

/**
 * Joint disjoint-card six-card turn count across every unseen river card:
 * hero's exact pot share (win + tieShare) against the bettor's value / non-value
 * regions and `always` callers + `j = 0..behind` continuing players behind.
 */
export function plo6MultiwayTurnJoint(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number,
  always: readonly number[],
  behind: number,
  behindShare: number
): Plo6MultiwayTurnJoint | null {
  if (!Array.isArray(hole) || hole.length !== 6) return null;
  if (!Array.isArray(board) || board.length !== 4) return null;
  const B = Math.max(0, Math.floor(behind));
  const A = always.length;
  const others = A + B;
  if (others < 1 || others > OMAHA_SHOWN_FIELD_MAX) return null;
  const deadCards = Array.isArray(dead) ? dead : [];
  if (new Set([...hole, ...board].map(key)).size !== 10) return null;
  const removed = new Set([...hole, ...board, ...deadCards].map(key));
  const unseen: Card[] = [];
  for (const s of SUITS)
    for (const r of RANKS) {
      const c = { rank: r, suit: s } as Card;
      if (!removed.has(key(c))) unseen.push(c);
    }
  const m = unseen.length;
  // Need 6 cards for bettor + 6 cards per other player + 1 river card from unseen (m <= 42).
  const maxDisjointOthers = Math.min(others, Math.floor((m - 7) / 6));
  if (maxDisjointOthers < 1) return null;

  // Precompute all C(m, 2) pair scores on the turn board once for fast pool ranking.
  const turnPairScores = new Float64Array(m * m);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < m; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < m; j++) {
      two[1] = unseen[j];
      const sc = scoreOmahaHiPartial(two, board);
      turnPairScores[i * m + j] = sc;
      turnPairScores[j * m + i] = sc;
    }
  }

  const rnd = stream(seedOf(hole, board, deadCards));
  const P = PLO6_MW_TURN_POOL;
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
        const sc = turnPairScores[cards[p * n + a] * m + cards[p * n + b]];
        if (sc > best) best = sc;
      }
    strength[p] = best;
  }

  const order = Array.from({ length: P }, (_, p) => p).sort(
    (a, b) => strength[b] - strength[a] || a - b
  );
  const clampShare = (s: number): number => Math.max(0.02, Math.min(1, Number.isFinite(s) ? s : 1));
  const vc = Math.max(1, Math.min(P - 1, Math.round(clampShare(valueShare) * P)));
  const regionCount = (s: number): number =>
    Math.max(1, Math.min(P, Math.round(clampShare(s) * P)));
  const fieldCount = Array.from({ length: others }, (_, f) =>
    regionCount(f < A ? always[f] : behindShare)
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

  // Per river card `rv`, precompute all C(m, 2) pair scores on the 5-card river board once!
  // Scoring any 6-card holding on that river is then 15 table lookups instead of 15*10 evaluations.
  const riverPairScores = new Float64Array(m * m);
  const scorePoolOnRiver = (p: number): number => {
    let best = 0;
    const base = p * n;
    for (let a = 0; a < n; a++) {
      const ca = cards[base + a] * m;
      for (let b = a + 1; b < n; b++) {
        const sc = riverPairScores[ca + cards[base + b]];
        if (sc > best) best = sc;
      }
    }
    return best;
  };

  const accV = new Float64Array(B + 1);
  const accO = new Float64Array(B + 1);
  let nV = 0;
  let nO = 0;
  const fieldScore = new Float64Array(others);
  const picked = new Int32Array(others + 1);

  for (let rv = 0; rv < m; rv++) {
    const full: Card[] = [board[0], board[1], board[2], board[3], unseen[rv]];
    for (let i = 0; i < m; i++) {
      if (i === rv) continue;
      two[0] = unseen[i];
      for (let j = i + 1; j < m; j++) {
        if (j === rv) continue;
        two[1] = unseen[j];
        const sc = scoreOmahaHiPartial(two, full);
        riverPairScores[i * m + j] = sc;
        riverPairScores[j * m + i] = sc;
      }
    }
    used[rv] = 1;
    const hero = scoreOmahaHiPartial(hole, full);
    for (let s = 0; s < PLO6_MW_TURN_SETS_PER_RIVER; s++) {
      const isValue = s % 2 === 0;
      const p = isValue ? draw(0, 0, vc) : draw(1, vc, P - vc);
      if (p < 0) continue;
      mark(p, 1);
      picked[0] = p;
      let drawn = 0;
      let whole = true;
      for (let k = 0; k < others; k++) {
        if (k < maxDisjointOthers) {
          const g = draw(2 + k, 0, fieldCount[k]);
          if (g < 0) {
            whole = false;
            break;
          }
          mark(g, 1);
          picked[drawn + 1] = g;
          drawn++;
          fieldScore[k] = scorePoolOnRiver(g);
        } else {
          // 6-max with 5 opponents (42 unseen cards = 6*6 + 6): draw unmasked from pool clear of rv.
          const g = draw(2 + k, 0, fieldCount[k]);
          if (g < 0) {
            whole = false;
            break;
          }
          fieldScore[k] = scorePoolOnRiver(g);
        }
      }
      for (let u = 1; u <= drawn; u++) mark(picked[u], 0);
      mark(p, 0);
      if (!whole) continue;
      const bettor = scorePoolOnRiver(p);
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
    used[rv] = 0;
  }

  if (!(nV > 0) || !(nO > 0)) return null;
  return {
    value: Array.from(accV, (x) => x / nV),
    other: Array.from(accO, (x) => x / nO),
    nValue: nV,
    nOther: nO,
    rivers: m,
  };
}

/**
 * Average chips a continuing player behind puts in on the turn that hero's call can win.
 */
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
 * Six-card multiway turn facing-bet verdict (`spot.callers + spot.allIns + spot.behind > 0`).
 * Returns null when heads-up or outside a countable PLO6 cash multiway turn spot.
 */
export function plo6MultiwayTurnVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: { rake: number; inPosition: boolean },
  preSpot?: OmahaFacingBetEvSpot | null
): Plo6MultiwayTurnVerdict | null {
  try {
    const spot = preSpot ?? omahaFacingBetEvSpot(player, gs, { plo6Priced: true });
    if (!spot || spot.street !== 'turn') return null;
    if (spot.callers + spot.allIns + spot.behind <= 0) return null;
    const hole: Card[] = player.cards ?? [];
    const board: Card[] = gs.communityCards ?? [];
    const dead: Card[] = player.knownDeadCards ?? [];
    if (hole.length !== 6 || board.length !== 4) return null;

    const baseCaller =
      spot.potFrac < 0.25
        ? 1 - (1 - OMAHA_EV_CALLER_SHARE.turn) * (spot.potFrac / 0.25)
        : OMAHA_EV_CALLER_SHARE.turn;
    // Six-card Omaha multiway turn callers/continuers hold C(6,2)=15 two-card pairs (2.5x PLO4's 6),
    // concentrating multiway turn continues into the top 6/15 = 0.40 of the 4-card pool share.
    const callerShareSix = Math.max(0.12, Math.min(0.55, baseCaller * (6 / 15)));
    const allInShareSix =
      spot.allIns > 0
        ? Math.max(0.15, Math.min(0.55, OMAHA_EV_ALL_IN_SHARE * (6 / 15)))
        : OMAHA_EV_ALL_IN_SHARE;

    const always: number[] = [];
    for (let i = 0; i < spot.callers; i++) always.push(callerShareSix);
    for (let i = 0; i < spot.allIns; i++) always.push(allInShareSix);

    const joint = plo6MultiwayTurnJoint(
      hole,
      board,
      dead,
      spot.valueShare,
      always,
      spot.behind,
      callerShareSix
    );
    if (!joint) return null;

    const klass = omahaShownTurnClass(hole, board, dead);
    let R = 1;
    if (!spot.final) {
      R = OMAHA_SHOWN_TURN_REALIZATION[klass][ctx.inPosition ? 'ip' : 'oop'].r;
      // Hand #59725321 safeguard: on an already-paired turn facing a >= 40%-pot
      // wager with river barrel stacks behind, a non-boat hand with zero boat/quad
      // river outs realizes only check-downs (0.42 cap).
      if (
        spot.potFrac >= 0.4 &&
        spot.bettorCanBarrelRiver !== false &&
        new Set(board.map((c) => c.rank)).size < 4 &&
        scoreOmahaHiPartial(hole, board) < 7 * 0x100000
      ) {
        const seen = new Set([...hole, ...board, ...dead].map(key));
        let boatOuts = 0;
        for (const s of SUITS) {
          for (const r of RANKS) {
            if (seen.has(`${r}:${s}`)) continue;
            if (scoreOmahaHiPartial(hole, [...board, { rank: r, suit: s }]) >= 7 * 0x100000) {
              boatOuts = 1;
              break;
            }
          }
          if (boatOuts > 0) break;
        }
        if (boatOuts === 0) R = Math.min(R, 0.42);
      }
    }

    const q = Math.max(0, Math.min(1, spot.priorBluff));
    const B = Math.max(0, Math.floor(spot.behind));
    const c = B > 0 ? Math.max(0, Math.min(1, omahaFlopEvBehindContinue(spot.potFrac))) : 0;
    const behindAdd = behindCallOf(player, gs, spot);
    const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? ctx.rake : 0));

    let ev = 0;
    let equity = 0;
    for (let j = 0; j <= B; j++) {
      const w = B > 0 ? binom(B, j) * c ** j * (1 - c) ** (B - j) : 1;
      const e = q * joint.other[j] + (1 - q) * joint.value[j];
      const T = (spot.winnable + j * behindAdd) * (1 - rake) + spot.paid;
      ev += w * (R * e * T - spot.paid);
      equity += w * e;
    }

    const baseMargin =
      omahaStrategyConstant('facingBetEvMargin', { gameVariant: 'plo6' }) *
      (spot.winnable + spot.paid);
    const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
    const price = spot.paid / (spot.winnable + spot.paid);
    const pWin = Math.min(1, R * equity);

    return {
      call: ev > margin,
      ev,
      margin,
      pWin,
      pTie: 0,
      price,
      equity,
      realization: R,
      klass,
      callerShareSix,
      continueRate: c,
      spot,
    };
  } catch {
    return null;
  }
}
