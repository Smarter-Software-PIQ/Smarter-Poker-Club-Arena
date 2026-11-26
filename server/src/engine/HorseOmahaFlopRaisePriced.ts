/**
 * THE HEADS-UP FLOP RAISE IS PRICED ABOVE THE CALL AND THE FOLD, AT ITS BEST SIZE (PLO-OWNER lead-7 lane plo-postflop,
 * 2026-11-26; option omahaFlopRaiseIsPriced, default OFF, read `=== true`, scopable per game with horse.omahaGameScope).
 *
 * WHY. The PLO hand audit of 2026-11-25 ranks "raise without price" on the flop the second HARD leak (out of position,
 * heads-up, 4 cases / 97 bb): in 10 of its 12 flop raise mistakes the Horse raised with the nuts or close to them to
 * about half to two thirds of the pot raise, where the full pot raise priced higher; in the other 2 the raise priced
 * below the call.
 *
 * WHAT IT DOES. PLO4/PLO5 cash, high only, one board, no bomb pot, the flop, heads-up, facing a wager, where the rule
 * chain's answer is a RAISE: the raise is priced at each candidate raise-to (the legal minimum, the chain's own size,
 * half way to the pot raise and the pot raise) beside the call and the fold, against the bettor's MEASURED flop range
 * (HorseOmahaMeasuredBettorRange: the shown strength of a player who made this street's wager on his line and size,
 * showdown bias corrected; his own shown record shrunk toward it). The best stands: a larger or smaller raise, or the
 * call (or the fold) when no raise prices above them by more than the equity estimate's error. It never makes a raise
 * out of a call or a fold, so the owner rules on draws (never raised out of position; in position only combo draws)
 * keep holding: they run after this rule, on its answer.
 *
 *   EV(fold) = 0;  EV(call) = R x eq x (P + C) x (1 - rake) - C
 *   EV(raise to T) = f x P x (1 - rake) + (1 - f) x (R' x e_c x (P + A + X) x (1 - rake) - A)
 *     A = T - the Horse's street chips; X = T - his street chips (what he must add); f = his fold share, the
 *     equilibrium X / (P + A + X) (the minimum defence of the pot he is offered); he folds the weakest f of his range
 *     and continues with the rest (e_c the Horse's equity against it); R' = 1 when the call leaves no stack behind,
 *     else the street's realization factor R.
 * Equity: the Horse's two-card-runout equity against each strength bin of holdings (a card-seeded pool of holdings of
 * the unseen cards ranked on the flop, the tables' scale), so one sample serves every size.
 * No identity, no hand class, no fixed size: every size is a price. Pure: no telemetry, no state, no draw from the
 * brain's random stream (the sample's seed is the cards).
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import {
  OMAHA_MEASURED_BIN_EDGES,
  OMAHA_MEASURED_BINS,
  omahaMeasuredBettorRange,
  omahaMeasuredLineOf,
  type OmahaMeasuredRecord,
} from './HorseOmahaMeasuredBettorRange.js';
import {
  OMAHA_FAST_PAIR_STRIDE,
  omahaFastCard,
  omahaFastBestPre,
  omahaFastPairsInto,
  omahaFastTriplesPre,
} from './HorseOmahaFastScore.js';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const OMAHA_FLOP_RAISE_POOL = 320;
export const OMAHA_FLOP_RAISE_PER_BIN = 10;
export const OMAHA_FLOP_RAISE_RUNOUTS = 12;

export interface OmahaFlopRaiseSpot {
  opponent: SeatPlayer;
  pot: number;
  toCall: number;
  heroIn: number;
  hisIn: number;
  potFrac: number;
  isRaiseFaced: boolean;
}

/** The spot, or null: PLO4/PLO5 cash heads-up flop facing a wager. Public information only. */
export function omahaFlopRaiseSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaFlopRaiseSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return null;
    if (String(gs.stage) !== 'flop' || (gs.communityCards ?? []).length !== 3) return null;
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    );
    if (live.length !== 1) return null;
    const opp = live[0];
    const heroIn = fin(hero.bet) ? hero.bet : 0;
    const hisIn = fin(opp.bet) ? opp.bet : 0;
    const toCall = Math.max(0, (gs.currentBet ?? 0) - heroIn);
    if (!(toCall > 0) || !(gs.pot > 0)) return null;
    // the pot before his wager: his street chips are his wager; a raise faced means the Horse wagered first
    const isRaiseFaced = heroIn > 0;
    const before = gs.pot - (hisIn - heroIn) - 0;
    const potFrac = (hisIn - heroIn) / Math.max(before, 1e-9);
    return { opponent: opp, pot: gs.pot, toCall, heroIn, hisIn, potFrac, isRaiseFaced };
  } catch {
    return null;
  }
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

/** The Horse's equity against each strength bin (and each bin's share of the pool), or null. */
export function omahaFlopRaiseBinEquity(
  hole: Card[],
  board: Card[],
  dead: Card[]
): { eq: number[]; mass: number[]; matchups: number } | null {
  const n = hole.length;
  if ((n !== 4 && n !== 5) || board.length !== 3) return null;
  const h = hole.map(omahaFastCard);
  const b = board.map(omahaFastCard);
  const d = (dead ?? []).map(omahaFastCard);
  if (h.some((x) => x < 0) || b.some((x) => x < 0)) return null;
  const used = new Set([...h, ...b, ...d.filter((x) => x >= 0)]);
  if (used.size < h.length + b.length) return null;
  const unseen: number[] = [];
  for (let r = 2; r <= 14; r++)
    for (let s = 0; s < 4; s++) if (!used.has(r * 4 + s)) unseen.push(r * 4 + s);
  const m = unseen.length;
  let seed = 0x9e3779b9;
  for (const x of [...h].sort((p, q) => p - q)) seed = Math.imul(seed ^ x, 0x01000193);
  for (const x of [...b].sort((p, q) => p - q)) seed = Math.imul(seed ^ (x + 64), 0x01000193);
  const rnd = stream(seed >>> 0);
  const P = OMAHA_FLOP_RAISE_POOL;
  const pool = new Int32Array(P * n);
  const pick = new Int32Array(m);
  for (let i = 0; i < P; i++) {
    for (let j = 0; j < m; j++) pick[j] = unseen[j];
    for (let j = 0; j < n; j++) {
      const k = j + Math.floor(rnd() * (m - j));
      const t = pick[j];
      pick[j] = pick[k];
      pick[k] = t;
      pool[i * n + j] = pick[j];
    }
  }
  const pairsPer = (n * (n - 1)) / 2;
  const pairs = new Int32Array(P * pairsPer * OMAHA_FAST_PAIR_STRIDE);
  for (let i = 0; i < P; i++)
    omahaFastPairsInto(pool, i * n, n, pairs, i * pairsPer * OMAHA_FAST_PAIR_STRIDE);
  const flopT = omahaFastTriplesPre(b);
  const score = new Float64Array(P);
  for (let i = 0; i < P; i++)
    score[i] = omahaFastBestPre(pairs, i * pairsPer * OMAHA_FAST_PAIR_STRIDE, pairsPer, flopT);
  const order = Array.from({ length: P }, (_, i) => i).sort((x, y) => score[y] - score[x]);
  const byBin: number[][] = Array.from({ length: OMAHA_MEASURED_BINS }, () => []);
  const mass = new Array<number>(OMAHA_MEASURED_BINS).fill(0);
  for (let r = 0; r < P; r++) {
    // strength = share of holdings that beat it (ties share the strongest rank of their block)
    let first = r;
    while (first > 0 && score[order[first - 1]] === score[order[r]]) first--;
    const s = first / P;
    let bin = OMAHA_MEASURED_BINS - 1;
    for (let e = 1; e < OMAHA_MEASURED_BIN_EDGES.length; e++)
      if (s < OMAHA_MEASURED_BIN_EDGES[e]) {
        bin = e - 1;
        break;
      }
    mass[bin] += 1 / P;
    if (byBin[bin].length < OMAHA_FLOP_RAISE_PER_BIN) byBin[bin].push(order[r]);
  }
  const heroPairs = new Int32Array(pairsPer * OMAHA_FAST_PAIR_STRIDE);
  omahaFastPairsInto(h, 0, n, heroPairs, 0);
  const eq = new Array<number>(OMAHA_MEASURED_BINS).fill(NaN);
  let matchups = 0;
  const board5 = [b[0], b[1], b[2], 0, 0];
  for (let bin = 0; bin < OMAHA_MEASURED_BINS; bin++) {
    const list = byBin[bin];
    if (!list.length) continue;
    let won = 0;
    let cnt = 0;
    for (const idx of list) {
      const theirs = new Set<number>();
      for (let j = 0; j < n; j++) theirs.add(pool[idx * n + j]);
      for (let k = 0; k < OMAHA_FLOP_RAISE_RUNOUTS; k++) {
        let t1 = -1;
        let t2 = -1;
        for (let guard = 0; guard < 64 && (t1 < 0 || t2 < 0); guard++) {
          const c = unseen[Math.floor(rnd() * m)];
          if (theirs.has(c) || c === t1) continue;
          if (t1 < 0) t1 = c;
          else t2 = c;
        }
        if (t1 < 0 || t2 < 0) continue;
        board5[3] = t1;
        board5[4] = t2;
        const T5 = omahaFastTriplesPre(board5);
        const me = omahaFastBestPre(heroPairs, 0, pairsPer, T5);
        const him = omahaFastBestPre(pairs, idx * pairsPer * OMAHA_FAST_PAIR_STRIDE, pairsPer, T5);
        won += me > him ? 1 : me === him ? 0.5 : 0;
        cnt++;
      }
    }
    if (cnt > 0) {
      eq[bin] = won / cnt;
      matchups += cnt;
    }
  }
  return { eq, mass, matchups };
}

export interface OmahaFlopRaiseRow {
  action: 'call' | 'fold' | 'raise';
  to: number;
  ev: number;
  fold?: number;
  eqCall?: number;
  /** A raise row only: the same price with no realization discount, the footing two raise sizes are compared on. */
  evSize?: number;
}
export interface OmahaFlopRaiseVerdict {
  eq: number;
  rows: OmahaFlopRaiseRow[];
  best: OmahaFlopRaiseRow;
  margin: number;
}

/** The pricing, pure arithmetic over the bins. `hist` his range; `stackCap` the most either can put in on the street. */
export function omahaFlopRaisePrice(
  hist: readonly number[],
  bins: { eq: number[]; mass: number[]; matchups: number },
  spot: { pot: number; toCall: number; heroIn: number; hisIn: number },
  targets: readonly number[],
  stackCap: number,
  realization: number,
  rake: number
): OmahaFlopRaiseVerdict | null {
  const r = fin(rake) ? clamp(rake, 0, 0.2) : 0;
  const R = fin(realization) ? clamp(realization, 0.5, 1.2) : 1;
  const w = hist.map((x, i) =>
    Number.isFinite(bins.eq[i]) && bins.mass[i] > 0 ? Math.max(0, x) : 0
  );
  const sw = w.reduce((a, c) => a + c, 0);
  if (!(sw > 0)) return null;
  const p = w.map((x) => x / sw);
  let eq = 0;
  for (let i = 0; i < p.length; i++) if (p[i] > 0) eq += p[i] * bins.eq[i];
  const P = spot.pot;
  const C = Math.min(spot.toCall, Math.max(0, stackCap - spot.heroIn));
  const rows: OmahaFlopRaiseRow[] = [{ action: 'fold', to: 0, ev: 0 }];
  rows.push({ action: 'call', to: spot.heroIn + C, ev: R * eq * (P + C) * (1 - r) - C });
  for (const T of targets) {
    const A = T - spot.heroIn;
    const X = T - spot.hisIn;
    if (!(A > C) || !(X > 0)) continue;
    const f = clamp(X / (P + A + X), 0, 0.95);
    let left = 1 - f;
    let cont = 0;
    let win = 0;
    for (let i = 0; i < p.length; i++) {
      if (!(p[i] > 0) || left <= 0) continue;
      const take = Math.min(p[i], left);
      cont += take;
      win += take * bins.eq[i];
      left -= take;
    }
    const eqCall = cont > 0 ? win / cont : 0;
    const allIn = T >= stackCap - 0.005;
    const Rr = allIn ? 1 : R;
    const ev = f * P * (1 - r) + (1 - f) * (Rr * eqCall * (P + A + X) * (1 - r) - A);
    const evSize = f * P * (1 - r) + (1 - f) * (eqCall * (P + A + X) * (1 - r) - A);
    rows.push({ action: 'raise', to: T, ev, fold: f, eqCall, evSize });
  }
  let best = rows[0];
  for (const row of rows) if (row.ev > best.ev) best = row;
  const se = Math.sqrt(Math.max(eq * (1 - eq), 0.01) / Math.max(1, bins.matchups));
  const margin = se * (P + 2 * Math.max(C, ...targets.map((t) => t - spot.heroIn)));
  return { eq, rows, best, margin };
}

export interface OmahaFlopRaiseResult {
  decision: HorseDecision;
  changed: 'resized' | 'called' | 'folded' | null;
  verdict?: OmahaFlopRaiseVerdict;
}

/**
 * The option's one entry. Only a final flop RAISE in the spot is priced; every other decision is returned as given (the
 * same object). `legalize` is the engine's legalizer. `record` his shown flop record for the measured range, or null.
 */
export function omahaFlopRaisePricedRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  rake: number,
  realization: number,
  legalize: (d: HorseDecision) => HorseDecision,
  record: OmahaMeasuredRecord | null
): OmahaFlopRaiseResult {
  const same: OmahaFlopRaiseResult = { decision, changed: null };
  if (!on) return same;
  const raising =
    decision.action === 'raise' ||
    decision.action === 'bet' ||
    (decision.action === 'all_in' &&
      fin(decision.amount) &&
      (decision.amount as number) > (gs.currentBet ?? 0) + 0.005);
  if (!raising) return same;
  try {
    const spot = omahaFlopRaiseSpot(hero, gs);
    if (!spot) return same;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    const line = omahaMeasuredLineOf(
      gs.actionHistory as never,
      'flop',
      spot.opponent.seat,
      spot.isRaiseFaced
    );
    const range = omahaMeasuredBettorRange(variant, 'flop', line, spot.potFrac, 'hu', {
      record,
      readFactor: 1,
      minDefence: false,
    });
    if (!range) return same;
    const bins = omahaFlopRaiseBinEquity(
      hero.cards,
      gs.communityCards ?? [],
      hero.knownDeadCards ?? []
    );
    if (!bins) return same;
    const stackCap = Math.min(spot.heroIn + hero.stack, spot.hisIn + (spot.opponent.stack ?? 0));
    const min = fin(gs.minRaiseTo) ? (gs.minRaiseTo as number) : (gs.currentBet ?? 0) * 2;
    const max = Math.min(fin(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : stackCap, stackCap);
    const own =
      decision.action === 'all_in'
        ? stackCap
        : fin(decision.amount)
          ? (decision.amount as number)
          : max;
    const whole = (gs.bigBlind ?? 1) >= 1;
    const rnd = (x: number) => (whole ? Math.round(x) : round2(x));
    const targets = [
      ...new Set(
        [min, own, (min + max) / 2, max].map((x) => rnd(clamp(x, Math.min(min, max), max)))
      ),
    ];
    const v = omahaFlopRaisePrice(range.hist, bins, spot, targets, stackCap, realization, rake);
    if (!v) return same;
    const ownRow = v.rows.find(
      (x) =>
        x.action === 'raise' && Math.abs(x.to - rnd(clamp(own, Math.min(min, max), max))) < 0.01
    );
    const ownEv = ownRow ? ownRow.ev : -Infinity;
    // RAISE OR NOT (the realization discount and the error margin stay): the best of the call and the fold replaces
    // the chain's raise only when it prices above it by more than the equity estimate's error.
    let other = v.rows[0];
    for (const row of v.rows) if (row.action !== 'raise' && row.ev > other.ev) other = row;
    const leaves = v.best.action !== 'raise' && v.best.ev - ownEv > v.margin;
    if (!leaves) {
      // WHICH SIZE (the decision is a raise): two sizes of the same raise are compared on the same footing, the same
      // equity sample with no realization discount between them and no margin (the sample's error is common to both
      // sizes). A size is a candidate only if it survives the raise-or-not question the chain's own size survived:
      // the call or the fold must not price above it by more than the margin.
      let pick: OmahaFlopRaiseRow | undefined = ownRow;
      for (const row of v.rows) {
        if (row.action !== 'raise' || !fin(row.evSize)) continue;
        if (other.ev - row.ev > v.margin) continue;
        if (!pick || (row.evSize as number) > (pick.evSize as number) + 1e-9) pick = row;
      }
      if (!pick || !ownRow || Math.abs(pick.to - ownRow.to) < 0.01) return { ...same, verdict: v };
      const legal = legalize({
        ...decision,
        action: pick.to >= stackCap - 0.005 ? 'all_in' : 'raise',
        amount: pick.to,
      });
      if (legal.action !== 'raise' && legal.action !== 'all_in') return { ...same, verdict: v };
      return {
        decision: { ...decision, action: legal.action, amount: legal.amount },
        changed: 'resized',
        verdict: v,
      };
    }
    if (v.best.action === 'call') {
      const legal = legalize({ ...decision, action: 'call', amount: spot.toCall });
      if (legal.action !== 'call' && legal.action !== 'all_in') return { ...same, verdict: v };
      return {
        decision: { ...decision, action: legal.action, amount: legal.amount },
        changed: 'called',
        verdict: v,
      };
    }
    return { decision: { ...decision, action: 'fold', amount: 0 }, changed: 'folded', verdict: v };
  } catch {
    return same;
  }
}
