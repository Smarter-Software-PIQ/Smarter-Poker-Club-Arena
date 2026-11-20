/**
 * omahaMathCore, the made-hand offence component (lane VALUE 2026-11-19; owner
 * orders 7:33-8:26 PM Chicago: "take charge of hands ... take advantage of all
 * the opportunities, exploit weaknesses ... take advantage of position", math
 * first, PLO4 and PLO5 cash only).
 *
 * For a hero who may wager (unopened: check or bet; facing a wager: the raise
 * sizes beside the core's call / fold) it prices every candidate size over the
 * hand's remaining streets, in chips from now on (the core's convention: fold
 * = 0, everything the hero adds from now is a cost):
 *
 *   wager f   = P(all fold) x pot
 *             + P(raised)   x max(fold: -adds, stack off: equity vs the raising share x final pot - stack)
 *             + P(called)   x (continuation - adds)
 *   check     = (out of position) P(field wagers when checked to) x best reply (fold / call / check-raise)
 *             + (1 - that)  x next street (or showdown on the river)
 *   continuation (flop, turn) = the best plan for the next street over
 *             {check, the geometric size that is all-in by the river, pot, all-in},
 *             the calling share of the opponents' range narrowed street by street;
 *             (river, or all-in) = equity vs the calling band x final pot after rake.
 *
 * Every rate is a measured public cell supplied by the core (lane OPPMODEL's
 * per-person shrunk curves, else the population cell for street / line / size
 * / players / mode). Equity vs the strongest share x of the opponents' range is
 * supplied by the core (equityCurveFromHoldings turns one per-holding equity
 * vector into that curve in O(1) per lookup). No persona, no random stream, no
 * unmeasured constant: the only tolerance is the equity sampling error the core
 * reports.
 *
 * Protection (equity denial) is in the formula already: the check line credits
 * the opponents their equity share of the whole range, the wager line takes the
 * pot from the share that folds.
 *
 * Unreadable sizes (owner 2026-11-18 23:00 Chicago): every hand prices the same
 * size menu, and among the wager sizes whose EV is within two standard errors
 * of the best one the size is picked by a hash of the decision seed, so a size
 * is never chosen by hand class when the math cannot tell the sizes apart.
 *
 * PLO6 is outside the owner's scope tonight (8:26 PM): planValue answers null
 * for it and for anything that is not a postflop pot-limit spot.
 *
 * Pure and deterministic; throws only on inconsistent input (the core then
 * keeps its own decision with an error receipt).
 */

export const OMAHA_MATH_CORE_VALUE_VERSION = 'omaha-math-core-value-v1';

export type ValueStreet = 'flop' | 'turn' | 'river';

/** The field's measured response to a hero wager. */
export interface ValueResponse {
  /** probability every live opponent folds */
  fold: number;
  /** probability some opponent raises */
  raise: number;
  /** expected number of opponents who call when the wager is not folded to or raised */
  callers: number;
  /** observations behind the fold rate (its binomial error widens the indifference band); absent: none counted */
  n?: number;
  source: string;
}

/** The field's measured wager when the hero checks (public frequencies). */
export interface ValueWagerWhenChecked {
  /** probability some opponent wagers after the hero's check */
  p: number;
  /** that wager as a share of the pot */
  frac: number;
  /**
   * the measured value share of such wagers (showdown-revealed, bias corrected);
   * absent: the wager is taken as the strongest p of his range (no bluffs credited)
   */
  valueShare?: number;
  source: string;
}

export interface ValueSpot {
  variant: 'plo4' | 'plo5' | 'plo6';
  street: ValueStreet;
  /** every chip in the middle, this street's bets included */
  pot: number;
  /** chips the hero must add to call (0 when nothing to call) */
  toCall: number;
  /** the hero's chips behind before this decision */
  heroStack: number;
  /** the largest live opponent's chips behind (his current street bet excluded) */
  oppStack: number;
  /** live opponents */
  nOpp: number;
  /** the hero acts last on the later streets */
  ip: boolean;
  /** unopened and every opponent has already checked: the hero's check closes the street */
  checkCloses: boolean;
  /** the pot the winner takes after rake */
  rakeNet: (finalPot: number) => number;
  /**
   * The field's response to a hero wager of share `frac` of the pot (bet: frac x pot;
   * raise: the raise above the call is frac x (pot + to call)), `streetOffset` streets
   * from now (0 = this street), `line` the hero's wager line.
   */
  response: (
    frac: number,
    allIn: boolean,
    streetOffset: number,
    line: 'bet' | 'raise' | 'check_raise'
  ) => ValueResponse | null;
  /** the field's wager after a hero check, `streetOffset` streets from now (null = no measured cell: no wager credited) */
  wagerWhenChecked: (streetOffset: number) => ValueWagerWhenChecked | null;
  /** the hero's equity against the strongest share `share` of the opponents' current range (share 1 = the whole range) */
  equityAtShare: (share: number) => number;
  /** the standard error of the equities above (sampling) */
  equitySe: number;
  /** wager sizes as shares of the pot; defaults to VALUE_SIZE_MENU */
  sizes?: readonly number[];
  /** the decision seed (the same key the core seeds its sampler with) */
  seed: string;
  /**
   * optional (lane XR-BLUFF, OmahaMathCoreBluff.ts): blockerShift maps the field's continuing share to the share
   * left after the hero's blockers; exploitBack scales the measured fold / raise rates toward this opponent's
   * observed responses to the hero's wagers of that line
   */
  bluffCtx?: {
    blockerShift?: (continueShare: number) => number;
    exploitBack?: (line: 'bet' | 'raise' | 'check_raise') => {
      foldMult: number;
      raiseMult: number;
      source: string;
    };
  };
}

export interface ValueCandidate {
  kind: 'check' | 'wager' | 'call' | 'fold';
  /** share of the pot (null for the check, the call and the fold) */
  frac: number | null;
  allIn: boolean;
  /** chips the hero adds now */
  adds: number;
  ev: number;
  /** wager terms: P(all fold), P(raised), P(called) and their EV parts */
  fold: number;
  raise: number;
  call: number;
  evFold: number;
  evRaise: number;
  evCall: number;
  /** the plan after a call (e.g. "turn geometric 0.62 > river all-in") */
  plan: string;
  /** standard error of ev: equity sampling and the measured fold rate's binomial error */
  se: number;
  source: string;
}

export interface ValueReceipt {
  version: string;
  street: ValueStreet;
  pot: number;
  toCall: number;
  spr: number;
  geometric: number;
  candidates: ValueCandidate[];
  /** sizes inside two standard errors (equity sampling and response cells) of the best wager */
  indifferent: number[];
  choice: {
    kind: 'check' | 'wager' | 'call' | 'fold';
    frac: number | null;
    allIn: boolean;
    adds: number;
    ev: number;
  };
}

/** The shared size menu (pot shares); every hand prices the same menu. */
export const VALUE_SIZE_MENU: readonly number[] = Object.freeze([
  1 / 4,
  1 / 3,
  1 / 2,
  0.7,
  0.88,
  1,
]);

const STREETS: readonly ValueStreet[] = ['flop', 'turn', 'river'];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 100) / 100;

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The bet share that, made on each of `streets` streets and called by `callers`
 * opponents each time, puts the stack in by the last one: pot x (1 + (callers+1) g)^streets = pot + (callers+1) x stack.
 */
export function geometricFraction(
  pot: number,
  stack: number,
  streets: number,
  callers = 1
): number {
  if (!(pot > 0) || !(stack > 0) || streets < 1) return 0;
  const m = Math.max(1, callers) + 1;
  return (Math.pow(1 + (m * stack) / pot, 1 / streets) - 1) / m;
}

/**
 * Equity against the strongest share of a range from one per-holding equity
 * vector: `order` lists the holdings strongest first, `weight[i]` is holding
 * i's range weight, `equity[i]` the hero's equity against it.
 */
export function equityCurveFromHoldings(
  order: ArrayLike<number>,
  weight: ArrayLike<number>,
  equity: ArrayLike<number>
): (share: number) => number {
  const n = order.length;
  const cw = new Float64Array(n + 1);
  const ce = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const w = Math.max(0, weight[i]);
    cw[k + 1] = cw[k] + w;
    ce[k + 1] = ce[k] + w * equity[i];
  }
  const total = cw[n];
  if (!(total > 0)) throw new Error('omahaMathCoreValue: empty range');
  return (share: number) => {
    const target = clamp01(share) * total;
    if (target <= 0) return n > 0 ? equity[order[0]] : 0;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cw[mid + 1] < target) lo = mid + 1;
      else hi = mid;
    }
    const k = Math.min(lo, n - 1);
    const i = order[k];
    const w = Math.max(0, weight[i]);
    const part = w > 0 ? (target - cw[k]) / w : 0;
    return (ce[k] + part * w * equity[i]) / target;
  };
}

interface Node {
  pot: number;
  /** effective stack behind (hero vs the biggest live opponent) */
  stack: number;
  /** the strongest share of the original range still in */
  share: number;
  /** street index 0 flop .. 2 river */
  st: number;
  /** offset from the decision street */
  off: number;
}

interface Best {
  ev: number;
  plan: string;
}

/** Equity against the band of the range between the strongest `hi x share` and the strongest `lo x share` (callers below the raisers). */
function bandEquity(eqAt: (s: number) => number, share: number, lo: number, hi: number): number {
  const a = share * lo;
  const b = share * hi;
  if (b - a < 1e-6) return eqAt(Math.max(b, 1e-6));
  const eb = eqAt(b) * b;
  const ea = a > 1e-9 ? eqAt(a) * a : 0;
  return clamp01((eb - ea) / (b - a));
}

/** planValue: prices the check line and every wager size; null outside PLO4/PLO5 postflop. */
export function planValue(spot: ValueSpot): ValueReceipt | null {
  if (spot.variant !== 'plo4' && spot.variant !== 'plo5') return null;
  const st0 = STREETS.indexOf(spot.street);
  if (st0 < 0) return null;
  if (!(spot.pot > 0) || !(spot.heroStack >= 0) || !(spot.oppStack >= 0) || spot.nOpp < 1)
    throw new Error('omahaMathCoreValue: inconsistent spot');
  const menuSizes = (spot.sizes ?? VALUE_SIZE_MENU).filter((f) => f > 0 && f <= 1 + 1e-9);
  const memo = new Map<string, number>();
  const eqAt = (s: number): number => {
    const k = Math.max(0.005, Math.round(clamp01(s) * 200) / 200);
    const key = k.toFixed(3);
    let v = memo.get(key);
    if (v === undefined) {
      v = clamp01(spot.equityAtShare(k));
      if (!Number.isFinite(v)) throw new Error('omahaMathCoreValue: equity unavailable');
      memo.set(key, v);
    }
    return v;
  };
  const net = spot.rakeNet;

  /** EV of a wager of `frac` at node n (the hero adds `adds` = toCall + raise part; `callAmt` = toCall at the node). */
  const wagerEv = (
    n: Node,
    frac: number,
    toCall: number,
    line: 'bet' | 'raise' | 'check_raise',
    future: boolean
  ): {
    ev: number;
    allIn: boolean;
    adds: number;
    fold: number;
    raise: number;
    call: number;
    evFold: number;
    evRaise: number;
    evCall: number;
    plan: string;
    se: number;
    source: string;
  } | null => {
    const heroBehind = n.stack + toCall; // the hero's chips before this action (toCall comes out of them)
    // a raise adds at least the wager faced on top of the call (the minimum raise heads-up)
    const want = Math.max(toCall + frac * (n.pot + toCall), toCall > 0 ? 2 * toCall : 0);
    const cap = Math.min(heroBehind, toCall + n.stack); // the hero cannot put in more than the opponent can match
    const adds = Math.min(want, cap);
    if (adds <= toCall + 1e-9) return null;
    const allIn = adds >= cap - 1e-9;
    const realFrac = (adds - toCall) / (n.pot + toCall);
    const r0 = spot.response(realFrac, allIn, n.off, line);
    if (!r0) return null;
    let fold = r0.fold;
    let raise = r0.raise;
    let src = r0.source;
    const xb = spot.bluffCtx;
    if (xb?.exploitBack) {
      const e = xb.exploitBack(line);
      fold = clamp01(fold * e.foldMult);
      raise = clamp01(raise * e.raiseMult);
      src += `; ${e.source}`;
    }
    if (xb?.blockerShift) {
      const cont = clamp01(xb.blockerShift(clamp01(1 - fold)));
      fold = 1 - cont;
      src += '; blockers';
    }
    const r = { ...r0, fold, raise, source: src };
    const pf = clamp01(r.fold);
    const pr = allIn ? 0 : clamp01(Math.min(r.raise, 1 - pf));
    const pc = clamp01(1 - pf - pr);
    const callers = Math.max(1, r.callers);
    const evFold = pf * net(n.pot);
    // raised: the raisers are the strongest pr of what was in; the hero folds or stacks off, whichever is worth more
    let evRaise = 0;
    if (pr > 0) {
      // he raises the pot (capped by the stacks); the hero folds or calls, whichever is worth more, against the
      // raising share; the hero's total from now if he calls is H (the opponent's earlier bet covers toCall)
      const all = toCall + n.stack;
      const H = Math.min(all, adds + (n.pot + 2 * adds - toCall));
      const eR = eqAt(n.share * pr);
      const callRaise = eR * net(n.pot + 2 * H - toCall) - H;
      evRaise = pr * Math.max(-adds, callRaise);
    }
    // called: the callers are the band below the raisers
    let evCall = 0;
    let plan = 'showdown';
    if (pc > 0) {
      const eC = bandEquity(eqAt, n.share, pr, pr + pc);
      const potAfter = n.pot + adds + callers * (adds - toCall);
      const stackAfter = n.stack - (adds - toCall);
      if (n.st >= 2 || allIn || stackAfter <= 1e-9 || !future) {
        evCall = pc * (eC * net(potAfter) - adds);
        plan = allIn ? 'all-in' : 'showdown';
      } else {
        const next: Node = {
          pot: potAfter,
          stack: stackAfter,
          share: n.share * (pr + pc),
          st: n.st + 1,
          off: n.off + 1,
        };
        const b = bestPlan(next);
        evCall = pc * (b.ev - adds);
        plan = b.plan;
      }
    }
    // error of this EV: the fold rate's binomial error moves chips between the fold branch (the pot) and the call
    // branch; the equity error moves the call branch's share of the final pot
    const seFold = r.n && r.n > 0 ? Math.sqrt((pf * (1 - pf)) / r.n) : 0;
    const callValue = pc > 0 ? evCall / pc : 0;
    const se = Math.sqrt(
      Math.pow(seFold * Math.abs(net(n.pot) - callValue), 2) +
        Math.pow(Math.max(0, spot.equitySe) * pc * net(n.pot + 2 * adds), 2)
    );
    return {
      ev: evFold + evRaise + evCall,
      se,
      allIn,
      adds,
      fold: pf,
      raise: pr,
      call: pc,
      evFold,
      evRaise,
      evCall,
      plan,
      source: r.source,
    };
  };

  /** The check line at node n (nothing to call). */
  const checkEv = (n: Node, closes: boolean, eqHere: number, afterHisCheck?: () => Best): Best => {
    const goOn = (): Best => {
      if (afterHisCheck) return afterHisCheck();
      if (n.st >= 2 || n.stack <= 1e-9) return { ev: eqHere * net(n.pot), plan: 'check down' };
      const b = bestPlan({ ...n, st: n.st + 1, off: n.off + 1 });
      return { ev: b.ev, plan: `check > ${b.plan}` };
    };
    if (closes) return goOn();
    const w = spot.wagerWhenChecked(n.off);
    if (!w || !(w.p > 0)) return goOn();
    const p = clamp01(w.p);
    const bet = Math.min(w.frac * n.pot, n.stack);
    // the wagering range: its value part is the strongest p x v of the range, its bluffs the weakest p x (1 - v)
    const v = w.valueShare === undefined ? 1 : clamp01(w.valueShare);
    const top = n.share * p * v;
    const low = n.share * p * (1 - v);
    const eqTop = top > 1e-6 ? eqAt(top) : 0;
    const eqLow =
      low > 1e-6
        ? clamp01((eqAt(n.share) * n.share - eqAt(n.share - low) * (n.share - low)) / low)
        : 0;
    const eqVsWager = v * eqTop + (1 - v) * eqLow;
    // facing that wager: fold (0), call (continue with the pot grown), or check-raise (priced as a raise)
    const potFacing = n.pot + bet;
    let call: Best;
    const stackAfter = n.stack - bet;
    if (n.st >= 2 || stackAfter <= 1e-9)
      call = { ev: eqVsWager * net(potFacing + bet) - bet, plan: 'check-call' };
    else {
      // later streets against the wagering range: its value part (bluffs give up), the conservative continuation
      const b = bestPlan({
        pot: potFacing + bet,
        stack: stackAfter,
        share: Math.max(1e-3, n.share * p * v || n.share * p),
        st: n.st + 1,
        off: n.off + 1,
      });
      call = { ev: b.ev - bet, plan: `check-call > ${b.plan}` };
    }
    let reply: Best = call.ev > 0 ? call : { ev: 0, plan: 'check-fold' };
    // the check-raise prices the shared menu and the all-in (decision street); later streets the pot and the all-in
    const crNode: Node = { ...n, pot: potFacing, stack: stackAfter, share: n.share * p };
    const crAllIn = stackAfter / (potFacing + bet);
    const crSizes = [...(n.off === 0 ? menuSizes : [1]), ...(crAllIn <= 1 + 1e-9 ? [crAllIn] : [])];
    for (const f of crSizes) {
      const cr = wagerEv(crNode, f, bet, 'check_raise', true);
      if (cr && cr.ev > reply.ev) reply = { ev: cr.ev, plan: `check-raise ${r2(f)} > ${cr.plan}` };
    }
    const behind = goOn();
    return {
      ev: p * reply.ev + (1 - p) * behind.ev,
      plan: `check (${r2(p)} ${reply.plan} | ${behind.plan})`,
    };
  };

  /** The best plan at a later-street node: check, geometric, pot, all-in. */
  // later streets: in position the opponent has checked to the hero (his lead is not modelled: conservative for
  // the hero's wager, which is then priced only against the checking share); out of position the hero acts first
  const bestPlan = (n: Node): Best => {
    const eqHere = eqAt(n.share);
    const streetsLeft = 3 - n.st;
    const g = geometricFraction(n.pot, n.stack, streetsLeft);
    let best = checkEv(n, spot.ip, eqHere);
    const fr = new Set<number>([Math.min(1, g), 1]);
    for (const f of fr) {
      const w = wagerEv(n, f, 0, 'bet', true);
      if (w && w.ev > best.ev)
        best = { ev: w.ev, plan: `${STREETS[n.st]} ${w.allIn ? 'all-in' : r2(f)} > ${w.plan}` };
    }
    const allInFrac = n.stack / n.pot;
    if (allInFrac <= 1 + 1e-9) {
      const w = wagerEv(n, allInFrac, 0, 'bet', true);
      if (w && w.ev > best.ev) best = { ev: w.ev, plan: `${STREETS[n.st]} all-in > ${w.plan}` };
    }
    return best;
  };

  const eff = Math.min(spot.heroStack - spot.toCall, spot.oppStack);
  const root: Node = { pot: spot.pot, stack: Math.max(0, eff), share: 1, st: st0, off: 0 };
  const eqNow = eqAt(1);
  const cands: ValueCandidate[] = [];
  if (spot.toCall <= 1e-9) {
    const c = checkEv(root, spot.checkCloses, eqNow);
    cands.push({
      kind: 'check',
      frac: null,
      allIn: false,
      adds: 0,
      ev: c.ev,
      fold: 0,
      raise: 0,
      call: 0,
      evFold: 0,
      evRaise: 0,
      evCall: 0,
      plan: c.plan,
      se: 0,
      source: 'measured wager-when-checked cell',
    });
  }
  const menu = menuSizes;
  const seen = new Set<string>();
  for (const f of menu) {
    const w = wagerEv(root, f, spot.toCall, spot.toCall > 0 ? 'raise' : 'bet', true);
    if (!w) continue;
    const key = w.adds.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push({
      kind: 'wager',
      frac: w.allIn ? r4((w.adds - spot.toCall) / (spot.pot + spot.toCall)) : f,
      ...pick(w),
    });
  }
  // the all-in (when it is within the pot limit)
  const allInFrac = root.stack / (spot.pot + spot.toCall);
  if (allInFrac <= 1 + 1e-9 && allInFrac > 0) {
    const w = wagerEv(root, allInFrac, spot.toCall, spot.toCall > 0 ? 'raise' : 'bet', true);
    if (w && !seen.has(w.adds.toFixed(4)))
      cands.push({ kind: 'wager', frac: r4(allInFrac), ...pick(w) });
  }
  // facing a wager: the call, with the later streets priced on the same basis as the raise (lane XR-BLUFF
  // review: in position his next-street lead at the measured rate, else the hero's float / check behind; out of
  // position the hero's own next-street plan). Without it the raise alone carried the later streets.
  if (spot.toCall > 1e-9) {
    const callAdds = Math.min(spot.toCall, spot.heroStack);
    const potC = spot.pot + callAdds;
    let ev: number;
    let plan: string;
    if (st0 >= 2 || root.stack <= 1e-9 || callAdds >= spot.heroStack - 1e-9) {
      ev = eqNow * net(potC) - callAdds;
      plan = 'call > showdown';
    } else {
      const next: Node = { pot: potC, stack: root.stack, share: 1, st: st0 + 1, off: 1 };
      const b = spot.ip ? checkEv(next, false, eqAt(1), () => bestPlan(next)) : bestPlan(next);
      ev = b.ev - callAdds;
      plan = `call > ${b.plan}`;
    }
    cands.push({
      kind: 'call',
      frac: null,
      allIn: callAdds >= spot.heroStack - 1e-9,
      adds: callAdds,
      ev,
      fold: 0,
      raise: 0,
      call: 0,
      evFold: 0,
      evRaise: 0,
      evCall: 0,
      plan,
      se: Math.max(0, spot.equitySe) * net(potC),
      source: spot.ip
        ? 'call: his next-street lead at the measured rate, else float'
        : 'call: next street out of position',
    });
    cands.push({
      kind: 'fold',
      frac: null,
      allIn: false,
      adds: 0,
      ev: 0,
      fold: 0,
      raise: 0,
      call: 0,
      evFold: 0,
      evRaise: 0,
      evCall: 0,
      plan: 'fold',
      se: 0,
      source: 'fold',
    });
  }
  if (cands.length === 0) return null;

  let best = cands[0];
  for (const c of cands)
    if (c.ev > best.ev + 1e-9 || (Math.abs(c.ev - best.ev) <= 1e-9 && c.adds < best.adds)) best = c;
  // unreadable sizes: among wagers within two standard errors of the best wager, the seed picks
  const wagers = cands.filter((c) => c.kind === 'wager');
  let indifferent: number[] = [];
  let choice = best;
  if (best.kind === 'wager' && wagers.length > 1) {
    const near = wagers
      .filter((c) => c.ev >= best.ev - 2 * Math.sqrt(c.se * c.se + best.se * best.se))
      .sort((a, b) => a.adds - b.adds);
    indifferent = near.map((c) => c.frac ?? 0);
    if (near.length > 1) choice = near[hash32(`${spot.seed}|value-size`) % near.length];
  }
  const g = geometricFraction(spot.pot, root.stack, 3 - st0);
  return {
    version: OMAHA_MATH_CORE_VALUE_VERSION,
    street: spot.street,
    pot: spot.pot,
    toCall: spot.toCall,
    spr: r2(root.stack / spot.pot),
    geometric: r4(g),
    candidates: cands.map((c) => ({
      ...c,
      ev: r2(c.ev),
      evFold: r2(c.evFold),
      evRaise: r2(c.evRaise),
      evCall: r2(c.evCall),
      fold: r4(c.fold),
      raise: r4(c.raise),
      call: r4(c.call),
      adds: r2(c.adds),
      se: r2(c.se),
    })),
    indifferent,
    choice: {
      kind: choice.kind,
      frac: choice.frac,
      allIn: choice.allIn,
      adds: r2(choice.adds),
      ev: r2(choice.ev),
    },
  };
}

function pick(w: {
  ev: number;
  allIn: boolean;
  adds: number;
  fold: number;
  raise: number;
  call: number;
  evFold: number;
  evRaise: number;
  evCall: number;
  plan: string;
  se: number;
  source: string;
}): Omit<ValueCandidate, 'kind' | 'frac'> {
  return {
    allIn: w.allIn,
    adds: w.adds,
    ev: w.ev,
    fold: w.fold,
    raise: w.raise,
    call: w.call,
    evFold: w.evFold,
    evRaise: w.evRaise,
    evCall: w.evCall,
    plan: w.plan,
    se: w.se,
    source: w.source,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RANGE-LEVEL SIZING (lead decision 8:5x PM Chicago; owner 2026-11-18 23:00: value sizes must be
// unreadable). At a betting node the size is chosen for the hero's WHOLE perceived betting range at
// that node (lane RANGEADV's trackRanges gives the range): the size that maximises the range's EV
// against the opponents' public response curve, every member wagering at max(check, EV at that size).
// Every hand that wagers then uses that one size, so the nuts and the bluffs cannot be told apart by
// size; each hand's own EV still decides wager or check. Nothing here reads the hero's cards beyond
// marking which member is the hero's holding.
// ─────────────────────────────────────────────────────────────────────────────

/** One holding of the hero's perceived range at the node. */
export interface RangeMember {
  /** the range weight of this holding (any positive scale) */
  weight: number;
  /** this holding's equity against the strongest share of the opponents' range */
  equityAtShare: (share: number) => number;
  equitySe: number;
}

export interface RangeSizingReceipt {
  version: string;
  members: number;
  /** range EV per size: sum of weight x max(check, EV at the size), normalised by total weight */
  rangeEv: { frac: number; allIn: boolean; ev: number; wagerShare: number }[];
  rangeCheckEv: number;
  /** the node's size for every wagering hand (null: the whole range checks) */
  size: { frac: number; allIn: boolean } | null;
  /** the hero's own decision at the node's size */
  hero: {
    kind: 'check' | 'wager';
    frac: number | null;
    allIn: boolean;
    adds: number;
    ev: number;
    checkEv: number;
    wagerEv: number | null;
  };
  /** the hero's per-hand plan (all sizes) for the receipt */
  heroPlan: ValueReceipt;
}

const sizeKey = (c: { frac: number | null; allIn: boolean }) =>
  c.allIn ? 'allin' : (c.frac ?? 0).toFixed(4);

/**
 * planRangeSize: the hero's members are priced with planValue on the same public spot; the node size is
 * the one with the highest range EV (ties: the smaller wager). `hero` is the hero's own holding priced
 * the same way (it need not be in `members`; when it is, pass it as well).
 */
export function planRangeSize(
  spot: Omit<ValueSpot, 'equityAtShare' | 'equitySe'>,
  members: readonly RangeMember[],
  hero: RangeMember
): RangeSizingReceipt | null {
  const heroPlan = planValue({
    ...spot,
    equityAtShare: hero.equityAtShare,
    equitySe: hero.equitySe,
  });
  if (!heroPlan) return null;
  const live = members.filter((m) => m.weight > 0);
  if (live.length === 0) return null;
  let total = 0;
  const plans: { w: number; r: ValueReceipt }[] = [];
  for (const m of live) {
    const r = planValue({ ...spot, equityAtShare: m.equityAtShare, equitySe: m.equitySe });
    if (!r) continue;
    plans.push({ w: m.weight, r });
    total += m.weight;
  }
  if (plans.length === 0 || !(total > 0)) return null;
  // the wager options every member priced (same menu, same spot: the same keys)
  const keys = new Map<string, { frac: number; allIn: boolean; adds: number }>();
  for (const c of heroPlan.candidates)
    if (c.kind === 'wager')
      keys.set(sizeKey(c), { frac: c.frac ?? 0, allIn: c.allIn, adds: c.adds });
  // the alternative to wagering: the check, or facing a wager the better of the call (priced over the later
  // streets) and the fold (0)
  const checkOf = (r: ValueReceipt) => {
    const c = r.candidates.find((x) => x.kind === 'check');
    if (c) return c.ev;
    const k = r.candidates.find((x) => x.kind === 'call');
    return k ? Math.max(0, k.ev) : 0;
  };
  let rangeCheckEv = 0;
  for (const p of plans) rangeCheckEv += (p.w / total) * Math.max(0, checkOf(p.r));
  const rangeEv: RangeSizingReceipt['rangeEv'] = [];
  for (const [k, s] of keys) {
    let ev = 0;
    let wagering = 0;
    for (const p of plans) {
      const c = p.r.candidates.find((x) => x.kind === 'wager' && sizeKey(x) === k);
      const alt = checkOf(p.r);
      const alt0 = Number.isFinite(alt) ? alt : 0;
      if (c && c.ev > alt0) {
        ev += (p.w / total) * c.ev;
        wagering += p.w / total;
      } else ev += (p.w / total) * alt0;
    }
    rangeEv.push({ frac: s.frac, allIn: s.allIn, ev: r2(ev), wagerShare: r4(wagering) });
  }
  rangeEv.sort((a, b) => b.ev - a.ev || keys.get(sizeKey(a))!.adds - keys.get(sizeKey(b))!.adds);
  const top = rangeEv.find((x) => x.wagerShare > 0) ?? null;
  const size = top ? { frac: top.frac, allIn: top.allIn } : null;
  const hc = checkOf(heroPlan);
  const hw = size
    ? (heroPlan.candidates.find((x) => x.kind === 'wager' && sizeKey(x) === sizeKey(size)) ?? null)
    : null;
  const heroCheck = Number.isFinite(hc) ? hc : 0;
  const wagerWins = hw !== null && hw.ev > heroCheck;
  return {
    version: OMAHA_MATH_CORE_VALUE_VERSION + '+range-size',
    members: plans.length,
    rangeEv,
    rangeCheckEv: r2(rangeCheckEv),
    size,
    hero: wagerWins
      ? {
          kind: 'wager',
          frac: hw!.frac,
          allIn: hw!.allIn,
          adds: hw!.adds,
          ev: hw!.ev,
          checkEv: r2(heroCheck),
          wagerEv: hw!.ev,
        }
      : {
          kind: 'check',
          frac: null,
          allIn: false,
          adds: 0,
          ev: r2(heroCheck),
          checkEv: r2(heroCheck),
          wagerEv: hw ? hw.ev : null,
        },
    heroPlan,
  };
}

/**
 * Equity curves for a set of hero holdings against one weighted opponent range on shared runouts:
 * each runout scores every holding once (hero members + opponent pool), then compares pairwise, so
 * the cost is (members + pool) x runouts hand evaluations. `best(hole, board5)` is the exact 2+3
 * evaluator (OmahaMathCoreEval.omahaBest); `runouts` are the completions of the board to five cards.
 * Opponent holdings are ordered strongest first by their mean score percentile over the runouts.
 */
export function equityCurvesOnSharedRunouts(
  heroHoldings: readonly (readonly number[])[],
  oppHoldings: readonly (readonly number[])[],
  oppWeight: ArrayLike<number>,
  runouts: readonly (readonly number[])[],
  best: (hole: readonly number[], board5: readonly number[]) => number
): { curves: ((share: number) => number)[]; se: number } {
  const H = heroHoldings.length;
  const O = oppHoldings.length;
  const win = Array.from({ length: H }, () => new Float64Array(O));
  const cnt = Array.from({ length: H }, () => new Float64Array(O));
  const pct = new Float64Array(O);
  const pctN = new Float64Array(O);
  const clash = (h: readonly number[], b: readonly number[]) => h.some((c) => b.includes(c));
  for (const b of runouts) {
    const os = new Float64Array(O).fill(NaN);
    for (let j = 0; j < O; j++) if (!clash(oppHoldings[j], b)) os[j] = best(oppHoldings[j], b);
    const valid = [...os.keys()].filter((j) => !Number.isNaN(os[j])).sort((a, c) => os[a] - os[c]);
    valid.forEach((j, k) => {
      pct[j] += valid.length > 1 ? k / (valid.length - 1) : 0.5;
      pctN[j] += 1;
    });
    for (let i = 0; i < H; i++) {
      if (clash(heroHoldings[i], b)) continue;
      const hs = best(heroHoldings[i], b);
      for (let j = 0; j < O; j++) {
        if (Number.isNaN(os[j]) || oppHoldings[j].some((c) => heroHoldings[i].includes(c)))
          continue;
        win[i][j] += os[j] < hs ? 1 : os[j] === hs ? 0.5 : 0;
        cnt[i][j] += 1;
      }
    }
  }
  const order = Array.from({ length: O }, (_, j) => j).sort(
    (a, c) => (pctN[c] > 0 ? pct[c] / pctN[c] : 0) - (pctN[a] > 0 ? pct[a] / pctN[a] : 0)
  );
  const curves = win.map((wi, i) => {
    const w = new Float64Array(O);
    const e = new Float64Array(O);
    for (let j = 0; j < O; j++) {
      w[j] = cnt[i][j] > 0 ? Math.max(0, oppWeight[j]) : 0;
      e[j] = cnt[i][j] > 0 ? wi[j] / cnt[i][j] : 0;
    }
    return equityCurveFromHoldings(order, w, e);
  });
  return { curves, se: 0.5 / Math.sqrt(Math.max(1, runouts.length * O)) };
}
