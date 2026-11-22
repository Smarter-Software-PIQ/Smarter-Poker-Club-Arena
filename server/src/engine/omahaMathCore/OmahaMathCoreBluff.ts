/**
 * omahaMathCore, the check-raise and bluff component (lane XR-BLUFF 2026-11-19;
 * owner 8:27 PM Chicago: "build out the CHECK-RAISE for value and CHECK-RAISE as
 * a bluff, both in position and out of position. Horses hardly ever bluff, but
 * they need to in certain spots with hands like combo draws and pair + straight
 * draw / flush draw equity against one-pair ranges").
 *
 * ONE implementation per term (agreed with lanes VALUE, DRAWS, OPPMODEL):
 *  - the check node, the check-raise, the raise against a bet / probe / donk and
 *    the multi-street follow-through are lane VALUE's planValue
 *    (OmahaMathCoreValue.ts: P(he wagers | checked to) x max(fold, call,
 *    check-raise over the shared size menu, his re-raise answered by max(fold,
 *    call)) + P(he checks back) x next street; after a call the next street plays
 *    against his continuing share). Value raises and bluff raises are the SAME
 *    formula over the SAME size menu, so a size never tells value from a bluff.
 *  - a bluff or semi-bluff is selected by that EV alone: fold equity + the hero's
 *    exact equity when called (draws included) - what it costs. Nothing here
 *    gates a raise by hand class.
 *  - THIS file supplies the two inputs the measured response cells cannot carry:
 *      blockerShift: the measured fold rate is the population's against a
 *        typical hero; the hero's actual cards remove part of the holdings that
 *        continue (nut-flush / nut-straight blockers), computed by card removal:
 *        continue share c of a reference field (hero cards unknown) defines a
 *        strength threshold; the hero's field (his cards removed) continues with
 *        the share of holdings at or above it.
 *      (the per-opponent exploit-back tracker was removed by lane CORE-POOLED, Nov 20:
 *        identity-free, no per-user row; it never recorded in production.)
 *  - receipts: bluffSelectionReceipt names why a hand is a candidate bluff
 *    (DRAWS' omahaDrawFeatures + blockers) for the decision receipt only.
 *
 * Scope: PLO4 and PLO5 cash only. holeCount 6 (and anything else) returns null /
 * no context: PLO6 behaviour is untouched (owner 8:27 PM, law test).
 *
 * Public information only: own cards and the board. Pure and deterministic for a given input (seeded sampler).
 */

export const OMAHA_MATH_CORE_BLUFF_VERSION = 'omaha-math-core-xr-bluff-v1';

export type XrLine = 'bet' | 'raise' | 'check_raise';
export type XrResponse = 'fold' | 'call' | 'raise';

/** PLO4 / PLO5 only (never PLO6). */
export function xrBluffInScope(variant: string, holeCount: number): boolean {
  return (variant === 'plo4' && holeCount === 4) || (variant === 'plo5' && holeCount === 5);
}

// ───────────────────────────── blockers by card removal ─────────────────────────────

/** Score of the best exactly-2-hole + 3-board hand (higher is better). The core passes OmahaMathCoreEval.omahaBest. */
export type OmahaBestFn = (
  hole: ArrayLike<number>,
  holeLen: number,
  board: ArrayLike<number>,
  boardLen: number
) => number;

export interface BlockerInput {
  variant: string;
  hero: readonly number[];
  board: readonly number[];
  best: OmahaBestFn;
  /** seeded uniform [0,1) */
  rng: () => number;
  /** holdings sampled per field (default 2000 on the river, 1000 before it) */
  holdings?: number;
  /** shared random completions of the board before the river (default 8; the river is exact) */
  runouts?: number;
}

export interface BlockerShift {
  /** continue share of the reference field -> continue share of the hero's field */
  shift: (continueShare: number) => number;
  /** shift(c) - c at the top 10% / 30% / 50% continue shares, for the receipt (negative = the hero blocks continues) */
  at: { c10: number; c30: number; c50: number };
  source: string;
}

function sampleHolding(deck: number[], holeCount: number, rng: () => number, out: number[]): void {
  // partial Fisher-Yates on a copy view: the caller passes a scratch copy
  for (let k = 0; k < holeCount; k++) {
    const j = k + Math.floor(rng() * (deck.length - k));
    const t = deck[k];
    deck[k] = deck[j];
    deck[j] = t;
    out[k] = deck[k];
  }
}

/**
 * The blocker shift of the hero's cards on this board. Reference field: holdings
 * from every card but the board (what the measured response cells saw: hero
 * cards unknown). Hero field: holdings from every card but the board and the
 * hero's cards. Both are scored on the same shared completions (percentile of
 * the holding among both fields per completion, averaged), so a strength
 * threshold means the same in both. Null outside PLO4 / PLO5 or before the flop.
 */
export function blockerShiftOf(i: BlockerInput): BlockerShift | null {
  const hc = i.hero.length;
  if (!xrBluffInScope(i.variant, hc) || i.board.length < 3 || i.board.length > 5) return null;
  const n = Math.max(50, Math.floor(i.holdings ?? (i.board.length === 5 ? 2000 : 1000)));
  const runs = i.board.length === 5 ? 1 : Math.max(1, Math.floor(i.runouts ?? 8));
  const used = new Uint8Array(52);
  for (const c of i.board) used[c] = 1;
  const refDeck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) refDeck.push(c);
  for (const c of i.hero) used[c] = 1;
  const heroDeck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) heroDeck.push(c);
  const holdings: number[][] = []; // first n reference, next n hero field
  const tmp: number[] = new Array(hc).fill(0);
  const rdeck = refDeck.slice();
  for (let k = 0; k < n; k++) {
    sampleHolding(rdeck, hc, i.rng, tmp);
    holdings.push(tmp.slice());
  }
  const hdeck = heroDeck.slice();
  for (let k = 0; k < n; k++) {
    sampleHolding(hdeck, hc, i.rng, tmp);
    holdings.push(tmp.slice());
  }
  const total = 2 * n;
  const strength = new Float64Array(total);
  const counted = new Float64Array(total);
  const full = new Array<number>(5).fill(0);
  const scores = new Float64Array(total);
  const valid = new Uint8Array(total);
  for (let r = 0; r < runs; r++) {
    for (let k = 0; k < i.board.length; k++) full[k] = i.board[k];
    const taken = new Set<number>([...i.board, ...i.hero]);
    for (let k = i.board.length; k < 5; k++) {
      let c: number;
      do c = heroDeck[Math.floor(i.rng() * heroDeck.length)];
      while (taken.has(c));
      taken.add(c);
      full[k] = c;
    }
    let m = 0;
    for (let h = 0; h < total; h++) {
      const hold = holdings[h];
      let clash = false;
      for (const c of hold)
        for (let k = i.board.length; k < 5; k++) if (full[k] === c) clash = true;
      valid[h] = clash ? 0 : 1;
      if (clash) continue;
      scores[h] = i.best(hold, hc, full, 5);
      m++;
    }
    if (m === 0) continue;
    const ordered = Array.from({ length: total }, (_, h) => h)
      .filter((h) => valid[h] === 1)
      .sort((a, b) => scores[a] - scores[b]);
    // percentile with ties shared
    let k = 0;
    while (k < ordered.length) {
      let j = k;
      while (j + 1 < ordered.length && scores[ordered[j + 1]] === scores[ordered[k]]) j++;
      const pct = (k + j) / 2 / Math.max(1, ordered.length - 1);
      for (let t = k; t <= j; t++) {
        strength[ordered[t]] += pct;
        counted[ordered[t]] += 1;
      }
      k = j + 1;
    }
  }
  const ref: number[] = [];
  const mine: number[] = [];
  for (let h = 0; h < total; h++) {
    if (!(counted[h] > 0)) continue;
    (h < n ? ref : mine).push(strength[h] / counted[h]);
  }
  if (ref.length < 20 || mine.length < 20) return null;
  ref.sort((a, b) => b - a);
  mine.sort((a, b) => b - a);
  const shift = (c: number): number => {
    const cc = Math.min(1, Math.max(0, c));
    if (cc <= 0) return 0;
    if (cc >= 1) return 1;
    // threshold: the reference field's strength at its top share cc
    const idx = Math.min(ref.length - 1, Math.max(0, Math.round(cc * ref.length) - 1));
    const thr = ref[idx];
    // hero field: share at or above the threshold (binary search on the descending list)
    let lo = 0;
    let hi = mine.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (mine[mid] >= thr) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(1, Math.max(0, lo / mine.length));
  };
  const d = (c: number) => Math.round((shift(c) - c) * 1e4) / 1e4;
  const at = { c10: d(0.1), c30: d(0.3), c50: d(0.5) };
  return {
    shift,
    at,
    source: `blockers by card removal (${n}+${n} holdings, ${runs} completion${runs > 1 ? 's' : ''}; continue shift ${at.c10} / ${at.c30} / ${at.c50} at 0.1 / 0.3 / 0.5)`,
  };
}

// ───────────────────────────── the context planValue reads ─────────────────────────────

export interface XrBluffCtx {
  blockerShift?: (continueShare: number) => number;
}

/**
 * The `bluffCtx` for lane VALUE's ValueSpot. Heads-up only for exploit-back (one
 * opponent's answers); blockers apply to any field. Null outside PLO4 / PLO5.
 * `measured(line)` returns the measured cell the core already looked up for that
 * line at the decision's size (fold, raise), so the multipliers re-centre it.
 */
export function xrBluffCtx(i: {
  variant: string;
  holeCount: number;
  blockers: BlockerShift | null;
}): XrBluffCtx | null {
  if (!xrBluffInScope(i.variant, i.holeCount)) return null;
  const ctx: XrBluffCtx = {};
  if (i.blockers) ctx.blockerShift = i.blockers.shift;
  return ctx;
}

// ───────────────────────────── receipts ─────────────────────────────

/** The subset of lane DRAWS' OmahaDrawFeatures this receipt reads. */
export interface XrDrawFeatures {
  outs: number;
  nutOuts: number;
  made: string;
  fd: 'none' | 'fd' | 'nfd';
  wrapSize: number;
  comboDraw: boolean;
  pairPlusDraw: boolean;
}

export interface BluffSelectionReceipt {
  version: string;
  kind:
    | 'value'
    | 'semi_bluff_combo'
    | 'semi_bluff_pair_draw'
    | 'semi_bluff_draw'
    | 'blocker_bluff'
    | 'bluff'
    | 'none';
  outs: number | null;
  nutOuts: number | null;
  /** blocker shift of the top-10% continue share (negative = blocks his strongest continues) */
  blockerTop: number | null;
  /** the chosen action's fold equity and equity when called, from planValue */
  fold: number | null;
  equityCalled: number | null;
  note: string;
}

/**
 * Why the chosen wager is what it is (receipt only; the choice itself is the EV
 * argmax). `valueClass` = the hero's hand is in the top of the field the core
 * already ranks (his equity vs the continuing range > 0.5).
 */
export function bluffSelectionReceipt(i: {
  features: XrDrawFeatures | null;
  blockers: BlockerShift | null;
  equityCalled: number | null;
  fold: number | null;
}): BluffSelectionReceipt {
  const f = i.features;
  const eq = i.equityCalled;
  let kind: BluffSelectionReceipt['kind'] = 'none';
  if (eq !== null && eq > 0.5) kind = 'value';
  else if (f?.comboDraw) kind = 'semi_bluff_combo';
  else if (f?.pairPlusDraw) kind = 'semi_bluff_pair_draw';
  else if (f && f.outs >= 8) kind = 'semi_bluff_draw';
  else if (i.blockers && i.blockers.at.c10 < 0) kind = 'blocker_bluff';
  else if (eq !== null) kind = 'bluff';
  return {
    version: OMAHA_MATH_CORE_BLUFF_VERSION,
    kind,
    outs: f ? f.outs : null,
    nutOuts: f ? f.nutOuts : null,
    blockerTop: i.blockers ? i.blockers.at.c10 : null,
    fold: i.fold,
    equityCalled: eq,
    note: 'receipt only: the action is the EV maximum of planValue; class never gates it',
  };
}
