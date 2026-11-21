/**
 * omahaMathCore MULTIWAY terms (lane HVH-MULTI, lead session_01TLQer8, Nov 19 2026).
 *
 * Pure, total helpers the core (OmahaMathCore.ts, lane MATHCORE) calls when two or more
 * opponents are live. Scope: PLO4 / PLO5 cash, table and Lightning (one path; hole count
 * is the core's business, not this file's). Nothing here reads a card: every input is a
 * public frequency cell, a chip amount or an equity the core computed from its own hole
 * cards against public ranges.
 *
 * Terms:
 *  - continuationOutcomes: the probability of every set of responders that continues after
 *    a wager (empty set = everybody folds), from each responder's measured fold / raise
 *    share, with the measured multiway fold CORRELATION applied to the all-fold outcome
 *    (48h audit, PLO4+PLO5 cash, every wager pooled whoever made it: 2 responders ratio 0.91,
 *    n=295; 3+ responders 0.96, n=54; lane CORE-POOLED, identity-free). The deficit is redistributed over the non-empty outcomes pro rata, so
 *    the distribution still sums to 1.
 *  - wagerEvMultiway: EV of a bet / raise = sum over outcomes of
 *    (empty: pot won net of rake) | (some continue: realization x equity vs exactly those
 *    continuing ranges x final pot net of rake - chips added), plus a raised branch
 *    (somebody re-raises) priced by the caller or, by default, as the hero folding (-adds,
 *    a lower bound, said in the source).
 *  - callEvWithPlayersBehind: EV of a call when players still act behind: each behind
 *    player re-raises (squeeze) at his measured raise share, else folds / overcalls at his
 *    measured fold share; the hero's equity is taken against exactly the set that is in.
 *  - sidePotLayers / layeredShowdownValue: unequal stacks. The pot is cut into layers by
 *    contribution; the hero wins a layer only against the players eligible for it, so each
 *    layer is priced with the hero's equity against that set (the core used one joint
 *    equity x the whole pot).
 *
 * Exact enumeration of continuing sets up to MAX_ENUM responders (2^n outcomes); beyond
 * that the responders past MAX_ENUM are folded into an expected-chips term (said in the
 * source). Never throws for finite inputs; non-finite inputs return null so the core keeps
 * its own term.
 */

export interface Responder {
  seat: number;
  /** measured fold share facing this wager (0..1) */
  fold: number;
  /** measured re-raise share facing this wager (0..1, part of 1 - fold) */
  raise: number;
  /** chips he adds when he calls (capped by his stack) */
  callChips: number;
  /** the cell the shares came from (receipt) */
  source: string;
}

export interface Outcome {
  /** seats that call (continue); empty = everybody folded */
  callers: number[];
  p: number;
}

export interface Outcomes {
  outcomes: Outcome[];
  /** probability that at least one responder re-raises before the action closes */
  pRaise: number;
  pAllFold: number;
  pAllFoldIndependent: number;
  correlation: number;
  source: string;
}

/** Multiway fold correlation: P(all fold) / product of per-responder fold shares, by the number of responders. */
export interface CorrelationCell {
  ratio: number;
  n: number;
  source: string;
}

/**
 * Measured on the 48h PLO4+PLO5 cash audit (Nov 17 6:44 PM - Nov 19 6:49 PM Chicago), public
 * actions only (who folded / called / raised facing a postflop wager, first response round).
 * Provenance public_actions. IDENTITY-FREE (lane CORE-POOLED, Nov 20): every wager pooled whoever
 * made it (the audit's wager-kind cells summed by their n: 2 responders 164 + 131 wagers, 3+
 * responders 23 + 31). Ratio shrunk toward 1 with k = 50 pseudo-wagers: (n x measured + 50 x 1) / (n + 50).
 */
export const MULTIWAY_FOLD_CORRELATION = {
  provenance: 'public_actions' as const,
  version: 'hvh-multi-corr-v2-pooled',
  cells: {
    '2': {
      ratio: 0.913,
      n: 295,
      source: 'audit48 every wager, 2 responders: all-fold vs product, pooled ratio 0.913',
    },
    '3+': {
      ratio: 0.963,
      n: 54,
      source: 'audit48 every wager, 3+ responders: all-fold vs product, pooled ratio 0.963',
    },
  } as Record<string, CorrelationCell>,
};
const CORR_K = 50;

export function foldCorrelation(responders: number): CorrelationCell {
  if (responders < 2) return { ratio: 1, n: 0, source: 'heads-up: no correlation term' };
  const c = MULTIWAY_FOLD_CORRELATION.cells[responders === 2 ? '2' : '3+'];
  if (!c) return { ratio: 1, n: 0, source: 'no measured correlation cell: independent product' };
  const r = (c.n * c.ratio + CORR_K * 1) / (c.n + CORR_K);
  return { ratio: r, n: c.n, source: `${c.source} (n=${c.n}), shrunk to ${r.toFixed(3)}` };
}

export const MAX_ENUM = 4;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));

/**
 * Every continuing set after a wager. Responders are taken as acting independently on the
 * marginals except for the measured all-fold correlation; a re-raise by anybody ends the
 * enumeration into the raised branch (pRaise).
 */
export function continuationOutcomes(responders: Responder[]): Outcomes | null {
  if (!responders.every((r) => finite(r.fold, r.raise, r.callChips))) return null;
  const rs = responders.slice(0, MAX_ENUM).map((r) => {
    const f = clamp01(r.fold);
    const ra = Math.min(clamp01(r.raise), 1 - f);
    return { ...r, f, ra, c: 1 - f - ra };
  });
  const pNoRaise = rs.reduce((p, r) => p * (1 - r.ra), 1);
  const pRaise = 1 - pNoRaise;
  const outs: Outcome[] = [];
  const n = rs.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    let p = 1;
    const callers: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        p *= rs[i].c;
        callers.push(rs[i].seat);
      } else p *= rs[i].f;
    }
    outs.push({ callers, p });
  }
  const indep = outs[0].p;
  const corr = foldCorrelation(n);
  // all-fold can never exceed the no-raise mass; the deficit (or surplus) goes pro rata to the other no-raise outcomes
  const target = Math.min(indep * corr.ratio, pNoRaise);
  const rest = pNoRaise - indep;
  if (rest > 1e-12) {
    const scale = (pNoRaise - target) / rest;
    for (let i = 1; i < outs.length; i++) outs[i].p *= scale;
    outs[0].p = target;
  }
  const extra =
    responders.length > MAX_ENUM
      ? `; ${responders.length - MAX_ENUM} responder(s) past ${MAX_ENUM} priced as expected chips`
      : '';
  return {
    outcomes: outs,
    pRaise,
    pAllFold: outs[0].p,
    pAllFoldIndependent: indep,
    correlation: corr.ratio,
    source: `${n} responders, ${corr.source}${extra}`,
  };
}

export interface WagerEvInput {
  /** chips in the middle before the hero's wager (this street's bets included) */
  pot: number;
  /** chips the hero adds with this wager */
  adds: number;
  responders: Responder[];
  /** hero equity vs exactly these continuing seats (the core's equity engine; ranges = continue share of each) */
  equityVs: (callers: number[]) => number;
  /** rake: final pot -> pot net of rake */
  potNet: (final: number) => number;
  /** realization of the hero's equity (1 on the river or all-in) */
  realization: number;
  /** EV of the raised branch; default: the hero folds (-adds) - a lower bound */
  raisedEv?: () => number;
}

export interface MultiwayEv {
  ev: number;
  pAllFold: number;
  pRaise: number;
  terms: { callers: number[]; p: number; equity: number | null; value: number }[];
  source: string;
}

export function wagerEvMultiway(x: WagerEvInput): MultiwayEv | null {
  if (!finite(x.pot, x.adds, x.realization)) return null;
  const head = x.responders.slice(0, MAX_ENUM);
  const tail = x.responders.slice(MAX_ENUM);
  const o = continuationOutcomes(head);
  if (!o) return null;
  // responders past MAX_ENUM: expected chips only (their equity share is not priced)
  const tailChips = tail.reduce(
    (s, r) => s + (1 - clamp01(r.fold) - clamp01(r.raise)) * r.callChips,
    0
  );
  const tailContinue = tail.some((r) => r.fold < 1);
  const callChips = new Map(head.map((r) => [r.seat, r.callChips]));
  const terms: MultiwayEv['terms'] = [];
  let ev = 0;
  for (const oc of o.outcomes) {
    if (oc.p <= 0) continue;
    let value: number;
    let equity: number | null = null;
    if (oc.callers.length === 0 && !tailContinue) value = x.potNet(x.pot);
    else {
      const calls = oc.callers.reduce((s, c) => s + (callChips.get(c) ?? 0), 0) + tailChips;
      equity = x.equityVs(oc.callers);
      if (!Number.isFinite(equity)) return null;
      value = x.realization * equity * x.potNet(x.pot + x.adds + calls) - x.adds;
    }
    ev += oc.p * value;
    terms.push({ callers: oc.callers, p: oc.p, equity, value });
  }
  const rEv = x.raisedEv ? x.raisedEv() : -x.adds;
  if (!Number.isFinite(rEv)) return null;
  ev += o.pRaise * rEv;
  return {
    ev,
    pAllFold: o.pAllFold,
    pRaise: o.pRaise,
    terms,
    source: `${o.source}; raised branch ${x.raisedEv ? 'priced by caller' : 'hero folds (lower bound)'}`,
  };
}

export interface CallBehindInput {
  pot: number;
  toCall: number;
  /** players still to act behind the hero on this wager; their call chips = what they add to call */
  behind: Responder[];
  /** the aggressor / players already in front (always in the hand) */
  front: number[];
  equityVs: (seats: number[]) => number;
  potNet: (final: number) => number;
  realization: number;
  /** kind of the player whose wager the behind players face */
  /** EV once somebody behind re-raises (squeeze); default: the hero folds and loses his call */
  squeezedEv?: () => number;
  /** chips above the hero's stack he cannot win (all-in call) */
  uncovered?: number;
}

export function callEvWithPlayersBehind(x: CallBehindInput): MultiwayEv | null {
  if (!finite(x.pot, x.toCall, x.realization)) return null;
  const unc = x.uncovered ?? 0;
  const o = continuationOutcomes(x.behind);
  if (!o) return null;
  const chips = new Map(x.behind.map((r) => [r.seat, r.callChips]));
  const terms: MultiwayEv['terms'] = [];
  let ev = 0;
  for (const oc of o.outcomes) {
    if (oc.p <= 0) continue;
    const seats = [...x.front, ...oc.callers];
    const equity = x.equityVs(seats);
    if (!Number.isFinite(equity)) return null;
    const extra = oc.callers.reduce((s, c) => s + (chips.get(c) ?? 0), 0);
    const value = x.realization * equity * x.potNet(x.pot + x.toCall + extra - unc) - x.toCall;
    ev += oc.p * value;
    terms.push({ callers: oc.callers, p: oc.p, equity, value });
  }
  const sq = x.squeezedEv ? x.squeezedEv() : -x.toCall;
  if (!Number.isFinite(sq)) return null;
  ev += o.pRaise * sq;
  return {
    ev,
    pAllFold: o.pAllFold,
    pRaise: o.pRaise,
    terms,
    source: `behind: ${o.source}; squeeze branch ${x.squeezedEv ? 'priced by caller' : 'hero folds (lower bound)'}`,
  };
}

export interface Contribution {
  seat: number;
  /** total chips this player has put (or will have put, in the priced line) into the pot this hand */
  total: number;
  /** still contesting (not folded) */
  live: boolean;
}

export interface Layer {
  amount: number;
  /** live seats eligible to win this layer */
  eligible: number[];
}

/** Main pot and side pots by contribution level (folded chips stay in the layers they reached). */
export function sidePotLayers(contribs: Contribution[]): Layer[] {
  const levels = [
    ...new Set(contribs.filter((c) => c.live && c.total > 0).map((c) => c.total)),
  ].sort((a, b) => a - b);
  const layers: Layer[] = [];
  let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.total, lv) - prev);
    const eligible = contribs.filter((c) => c.live && c.total >= lv).map((c) => c.seat);
    if (amount > 0) layers.push({ amount, eligible });
    prev = lv;
  }
  // chips folded above the top live level go to the top layer
  let over = 0;
  for (const c of contribs) over += Math.max(0, c.total - prev);
  if (over > 0 && layers.length) layers[layers.length - 1].amount += over;
  // a layer only one player is eligible for is returned to him, not won
  return layers;
}

/**
 * The hero's expected share of all layers: equity vs exactly the other eligible seats
 * of each layer; a layer where the hero is alone is his returned chips. Rake is taken
 * once on the contested total (net factor applied pro rata).
 */
export function layeredShowdownValue(
  hero: number,
  layers: Layer[],
  equityVs: (others: number[]) => number,
  potNet: (final: number) => number
): { value: number; layers: { amount: number; others: number[]; equity: number }[] } | null {
  const contested = layers.filter((l) => l.eligible.length > 1).reduce((s, l) => s + l.amount, 0);
  const netFactor = contested > 0 ? potNet(contested) / contested : 1;
  if (!Number.isFinite(netFactor)) return null;
  let value = 0;
  const out: { amount: number; others: number[]; equity: number }[] = [];
  for (const l of layers) {
    if (!l.eligible.includes(hero)) continue;
    const others = l.eligible.filter((s) => s !== hero);
    const equity = others.length === 0 ? 1 : equityVs(others);
    if (!Number.isFinite(equity)) return null;
    value += equity * l.amount * (others.length === 0 ? 1 : netFactor);
    out.push({ amount: l.amount, others, equity });
  }
  return { value, layers: out };
}
