// Prices every option at a Horse decision whose hole cards were shown at showdown (tier A) and grades the action.
import {
  omaha,
  category,
  holdingPool,
  poolStrength,
  histWeights,
  truncateStrongest,
  rangeEquity,
  rng,
  isNutsExact,
  nutClass,
  comboDrawForRaise,
  outsToStraightPlus,
  preflopScore,
} from './omaha.mjs';
import { sizeBucket, STREETS } from './hand.mjs';
import {
  foldToBet,
  foldToRaise,
  pfFoldToRaise,
  pfRaiseRate,
  pfContRate,
  firstCheck,
  checkThrough,
} from './pop.mjs';
export const NBOARD = { preflop: 0, flop: 3, turn: 4, river: 5 };
/** Realisation of equity when the hand is not over (assumed, not measured): position-dependent share of raw equity. */
export const REALISE = {
  preflop: { ip: 0.9, oop: 0.8 },
  flop: { ip: 1.0, oop: 0.9 },
  turn: { ip: 1.0, oop: 0.95 },
  river: { ip: 1, oop: 1 },
};
export const TOL_BB = 1;
export const TOL_POT = 0.05;
export const BET_SIZES = [0.33, 0.66, 1.0];
export const DEFAULTS = { M: 1200, N: 1500, seed: 20261120 };

const quantCache = new Map();
/** preflop score quantile table per hole size, from random holdings (seeded) */
function pfQuantiles(n) {
  if (quantCache.has(n)) return quantCache.get(n);
  const r = rng(77 + n);
  const pool = holdingPool([], n, 20000, r);
  const s = Float64Array.from(pool.map(preflopScore)).sort();
  quantCache.set(n, s);
  return s;
}
/** share of random holdings that score strictly better (0 = best) */
export function pfQuantile(h) {
  const s = pfQuantiles(h.length);
  const v = preflopScore(h);
  let lo = 0,
    hi = s.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m] <= v) lo = m + 1;
    else hi = m;
  }
  return (s.length - lo) / s.length;
}
/** absolute preflop range width of player u from his preflop actions before decision index di (linear ranges) */
export function preflopWidth(hand, u, di, pop) {
  let w = 1;
  const ds = hand.decisions;
  for (let j = 0; j < di; j++) {
    const e = ds[j];
    if (e.u !== u || e.street !== 'preflop') continue;
    const k = Math.min(e.k, 3);
    if (e.isRaise) w *= pfRaiseRate(pop, hand.gv, k);
    else if (e.act === 'call' || e.act === 'all_in') w *= pfContRate(pop, hand.gv, k);
  }
  return Math.max(0.005, Math.min(1, w));
}
/** the range an opponent holds at decision di: his latest informative action (see docs). */
export function oppSpec(hand, o, di, pop) {
  const ds = hand.decisions;
  for (let j = di - 1; j >= 0; j--) {
    const e = ds[j];
    if (e.u !== o) continue;
    if (e.street === 'preflop') break;
    const into = e.live <= 2 ? 'hu' : 'mw';
    if (e.firstWager) {
      const line =
        e.street === 'flop'
          ? e.lastPfRaiser === o
            ? 'agg'
            : 'non'
          : (e.wageredPrev ?? []).includes(o)
            ? 'agg'
            : 'non';
      return {
        kind: 'hist',
        table: 'bettor',
        key: `${hand.gv}|${e.street}|${line}|${sizeBucket(e.amt / Math.max(e.pot, 1e-9))}|${into}`,
        street: e.street,
      };
    }
    if (e.isRaise)
      return {
        kind: 'hist',
        table: 'bettor',
        key: `${hand.gv}|${e.street}|raise|any|${into}`,
        street: e.street,
      };
    if ((e.act === 'call' || e.act === 'all_in') && e.toCall > 0) {
      if (e.nStreetRaises > 1) {
        const base = oppSpec(hand, o, j, pop);
        return {
          kind: 'trunc',
          base,
          share:
            1 - foldToRaise(pop, hand.gv, e.street, into, hand.byUid.get(o)?.isHorse ? 'h' : 'p'),
          street: e.street,
        };
      }
      const b = sizeBucket(e.streetFirstSize ?? e.toCall / Math.max(e.pot - e.toCall, 1e-9));
      return {
        kind: 'hist',
        table: 'caller',
        key: `${hand.gv}|${e.street}|${b}|${into}`,
        street: e.street,
      };
    }
  }
  return { kind: 'pf', width: preflopWidth(hand, o, di, pop) };
}
export function specLabel(s) {
  if (!s) return 'none';
  if (s.kind === 'pf') return `pf<=${(s.width * 100).toFixed(1)}%`;
  if (s.kind === 'trunc') return `top${Math.round(s.share * 100)}%(${specLabel(s.base)})`;
  return `${s.table}:${s.key}`;
}
/** a decision context: one pool, cached strengths per street board, cached preflop quantiles */
export function makeCtx(hero, board, n, opts) {
  const r = rng((opts.seed ?? 1) >>> 0);
  const pool = holdingPool([...hero, ...board], n, opts.M, r);
  const str = new Map();
  let pfq = null;
  return {
    r,
    pool,
    board,
    strengths(boardAt) {
      const k = boardAt.join(',');
      if (!str.has(k)) str.set(k, poolStrength(pool, boardAt));
      return str.get(k);
    },
    pfq() {
      if (!pfq) pfq = pool.map(pfQuantile);
      return pfq;
    },
  };
}
export function specWeights(spec, ctx, fullBoard, tables) {
  if (spec.kind === 'pf') return ctx.pfq().map((q) => (q < spec.width ? 1 : 0));
  const b = fullBoard.slice(0, NBOARD[spec.street]);
  const st = ctx.strengths(b);
  if (spec.kind === 'trunc')
    return truncateStrongest(specWeights(spec.base, ctx, fullBoard, tables), st, spec.share);
  const cell = tables[spec.table]?.[spec.key];
  if (!cell) return ctx.pool.map(() => 1);
  return histWeights(st, cell.hist, tables.binEdges);
}
function nz(w) {
  return w.some((x) => x > 0) ? w : w.map(() => 1);
}

/** Grade one decision. hand: parsed; di: index into hand.decisions; hero cards shown. */
export function gradeDecision(hand, di, tables, pop, opts = DEFAULTS, hindsight = true) {
  const d = hand.decisions[di];
  const hero = hand.shown.get(d.u);
  const st = d.street;
  const board = hand.board.slice(0, NBOARD[st]);
  if (board.length < NBOARD[st]) return null;
  const n = hero.length;
  const ctx = makeCtx(hero, board, n, {
    ...opts,
    seed: (opts.seed ?? 1) + di * 7919 + hand.id.charCodeAt(0),
  });
  let opps = d.liveUids.filter((x) => x !== d.u);
  if (!opps.length) return null;
  if (st === 'preflop') {
    // preflop, only players who have already acted voluntarily define the field; players still to act are left out
    // (their effect enters through the measured fold rates); if nobody has, one unknown opponent (any holding)
    const acted = opps.filter((o) =>
      hand.decisions.slice(0, di).some((e) => e.u === o && e.street === 'preflop')
    );
    opps = acted.length ? acted : [opps.find((o) => o === d.facing) ?? opps[opps.length - 1]];
  }
  const specs = new Map(opps.map((o) => [o, oppSpec(hand, o, di, pop)]));
  const weights = new Map(
    opps.map((o) => [o, nz(specWeights(specs.get(o), ctx, hand.board, tables))])
  );
  const eqOf = (list) => rangeEquity(hero, board, list, ctx.pool, opts.N, ctx.r);
  const eqNow = eqOf(opps.map((o) => ({ weights: weights.get(o) })));
  if (!eqNow) return null;
  const pos = d.oop ? 'oop' : 'ip';
  const R = REALISE[st][pos];
  const P = d.pot,
    C = Math.min(d.toCall, d.stackLeft);
  const into = d.live <= 2 ? 'hu' : 'mw';
  const rt = d.liveUids.some((x) => x !== d.u && hand.byUid.get(x) && !hand.byUid.get(x).isHorse)
    ? 'p'
    : 'h';
  const myStack = d.stackLeft;
  const bbv = hand.bb;
  // hindsight: every live opponent shown
  const allShown = hindsight && opps.every((o) => hand.shown.has(o));
  const eqHind = allShown ? eqOf(opps.map((o) => ({ known: hand.shown.get(o) }))) : null;
  const options = [];
  const final = st === 'river';
  // One-street pricing: equity is realised at the position-dependent REALISE share; no later-street betting is modelled.
  // This under-values checking and calling relative to betting (the check branch gets no credit for later fold equity),
  // so verdicts whose best option is a bet or raise the Horse did not make are reported as OPPORTUNITY, not as chips lost.
  const fut = (e) => e;
  const callAllIn = d.toCall >= d.stackLeft - 1e-9;
  const Rc = final || callAllIn ? 1 : R;
  if (d.toCall > 0) {
    options.push({ a: 'fold', ev: 0 });
    const okc = !final && !callAllIn;
    options.push({
      a: 'call',
      ev: Rc * fut(eqNow.eq, okc) * (P + C) - C,
      hev: eqHind ? Rc * fut(eqHind.eq, okc) * (P + C) - C : null,
    });
  } else {
    const futc = (e) => e;
    options.push({
      a: 'check',
      ev: R * futc(eqNow.eq) * P,
      hev: eqHind ? R * futc(eqHind.eq) * P : null,
    });
  }
  // aggression: bet (no bet faced) at standard sizes + the taken size, or a pot raise (+ the taken raise)
  const takenAdd = d.isRaise ? Math.max(0, d.amt - d.myCom) : 0;
  const caller = opps.find((o) => o === d.facing) ?? opps[0];
  const priceAgg = (add, label, sizeFrac) => {
    add = Math.min(add, myStack);
    if (add <= 0) return null;
    let fe, callRange;
    if (d.toCall > 0 || st === 'preflop') {
      fe =
        st === 'preflop'
          ? pfFoldToRaise(pop, hand.gv, d.k, into, rt)
          : foldToRaise(pop, hand.gv, st, into, rt);
      if (st === 'preflop') {
        const base = specs.get(caller);
        const width =
          (base.kind === 'pf' ? base.width : 0.3) * pfContRate(pop, hand.gv, (d.k ?? 0) + 1);
        callRange = { weights: nz(ctx.pfq().map((q) => (q < width ? 1 : 0))) };
      } else {
        callRange = {
          weights: nz(truncateStrongest(weights.get(caller), ctx.strengths(board), 1 - fe)),
        };
      }
    } else {
      const b = sizeBucket(sizeFrac);
      fe = foldToBet(pop, hand.gv, st, b, into, rt);
      const cell = tables.caller?.[`${hand.gv}|${st}|${b}|${into}`];
      callRange = {
        weights: nz(
          cell ? histWeights(ctx.strengths(board), cell.hist, tables.binEdges) : weights.get(caller)
        ),
      };
    }
    const target = d.myCom + add; // street total
    // the caller adds what he still owes: target minus what he has in on the street (the level he set, or 0)
    const callerIn = d.toCall > 0 ? d.streetLevel : st === 'preflop' ? d.streetLevel : 0;
    const oAdd = Math.max(0, Math.min(target - callerIn, d.stacks?.[caller] ?? 1e9));
    const eqc = eqOf([callRange]);
    const hc = eqHind
      ? hand.shown.has(caller)
        ? eqOf([{ known: hand.shown.get(caller) }])
        : null
      : null;
    const allin = add >= myStack - 1e-9 || oAdd >= (d.stacks?.[caller] ?? 1e9) - 1e-9;
    const Rr = final || allin ? 1 : R;
    const okf = !final && !allin && st !== 'preflop';
    const ev = fe * P + (1 - fe) * (Rr * fut(eqc.eq, okf) * (P + add + oAdd) - add);
    const hev = hc ? fe * P + (1 - fe) * (Rr * fut(hc.eq, okf) * (P + add + oAdd) - add) : null;
    return { a: label, add, ev, hev, fe, eqc: eqc.eq };
  };
  if (d.toCall > 0 || (st === 'preflop' && d.toCall > 0)) {
    const potRaiseAdd = C + (P + C);
    const o = priceAgg(potRaiseAdd, 'raise', null);
    if (o && C < myStack) options.push(o);
  } else if (st === 'preflop') {
    // BB option: raise pot
    const o = priceAgg(P, 'raise', null);
    if (o) options.push(o);
  } else {
    for (const f of BET_SIZES) {
      const o = priceAgg(f * P, `bet${Math.round(f * 100)}`, f);
      if (o) options.push(o);
    }
  }
  // taken action
  let taken;
  // A raise or all-in over opponents who are ALL already all in is a call: nobody can put another chip in, so the
  // chips above the call come straight back (hand 9fb142d2, 2026-11-26: an all-in for 494 bb over a person who was
  // all in, 313 bb returned, was priced as a raise against a caller and listed as a 75 bb "raise without price").
  const overAllIn =
    d.isRaise && d.toCall > 0 && opps.length > 0 && opps.every((o) => (d.stacks?.[o] ?? 1) <= 1e-9);
  const actTaken = overAllIn
    ? 'call'
    : d.act === 'all_in'
      ? d.isRaise
        ? d.toCall > 0 || st === 'preflop'
          ? 'raise'
          : 'bet'
        : 'call'
      : d.act === 'raise' && d.toCall === 0 && st !== 'preflop'
        ? 'bet'
        : d.act;
  if (actTaken === 'fold') taken = options.find((x) => x.a === 'fold');
  else if (actTaken === 'check') taken = options.find((x) => x.a === 'check');
  else if (actTaken === 'call')
    taken = options.find((x) => x.a === 'call') ?? options.find((x) => x.a === 'check');
  else if (actTaken === 'bet' || actTaken === 'raise') {
    const frac = takenAdd / Math.max(P, 1e-9);
    taken = priceAgg(
      takenAdd,
      d.toCall > 0 || st === 'preflop' ? 'raise(taken)' : `bet(taken)`,
      frac
    );
    if (taken) taken.size = frac;
  }
  if (!taken) return null;
  const all = [...options, taken];
  const best = all.reduce((a, b) => (b.ev > a.ev ? b : a));
  const potAfter = P + C;
  const tol = Math.max(TOL_BB * bbv, TOL_POT * potAfter);
  const cost = best.ev - taken.ev;
  const verdict = cost <= tol ? 'CORRECT' : 'MISTAKE';
  const passive =
    d.toCall > 0
      ? Math.max(...options.filter((x) => x.a === 'fold' || x.a === 'call').map((x) => x.ev))
      : options.find((x) => x.a === 'check').ev;
  // hindsight cost
  let hcost = null;
  if (eqHind && taken.hev !== null && taken.hev !== undefined) {
    const hb = all.filter((x) => (x.hev !== null && x.hev !== undefined) || x.a === 'fold');
    const hv = (x) => (x.a === 'fold' ? 0 : x.hev);
    const bestH = hb.reduce((a, b) => (hv(b) > hv(a) ? b : a));
    hcost = (hv(bestH) - hv(taken)) / bbv;
  }
  const heroStr = st === 'preflop' ? pfQuantile(hero) : null;
  const sc = st === 'preflop' ? null : omaha(hero, board);
  const nuts = st === 'preflop' ? null : isNutsExact(hero, board);
  const outs = st === 'flop' || st === 'turn' ? outsToStraightPlus(hero, board) : 0;
  const madeCat = sc === null ? null : category(sc);
  // the engine's own nut class ('nuts' | 'effective' | null), read only where the owner rule reads it
  const nutCls = st === 'turn' || st === 'river' ? (nuts ? 'nuts' : nutClass(hero, board)) : null;
  // the owner's 12:30 exception the engine keeps (omahaTurnComboDrawRaisePermitted): on the turn, in position, the
  // combo draw (comboDrawForRaise = omahaComboDrawForRaise) may raise; hand 13456d61
  const turnComboIp =
    st === 'turn' && !d.oop && nutCls === null && comboDrawForRaise(hero, board.slice(0, 4));
  const mtype =
    verdict === 'MISTAKE'
      ? mistakeType(hand, d, actTaken, best, {
          nuts,
          nutCls,
          turnComboIp,
          outs,
          madeCat,
          eqNow: eqNow.eq,
          taken,
          hcost,
        })
      : null;
  const mclass = mtype ? mistakeClass(mtype, st, best, d.oop) : null;
  const breach = [];
  const notes = [];
  if (
    (actTaken === 'raise' || (actTaken === 'bet' && d.toCall > 0)) &&
    (st === 'turn' || st === 'river') &&
    d.toCall > 0
  ) {
    // The owner rule is "a hand that is not nut class never raises the turn or river", and the engine keeps a
    // raise by its own nut-class test. The audit used the exact nuts here, so the two disagreed on every top full
    // house on a paired board (hand 0bf48e08: tens full on 8-T-8-3, quad eights possible). Now the same test;
    // "nut class but not the exact nuts" is counted on its own line, not as a breach.
    if (turnComboIp) notes.push('turn in-position combo-draw raise (owner 12:30 exception)');
    else if (nutCls === null) breach.push('non-nut raise turn/river');
    else if (nutCls === 'effective') notes.push('nut-class raise turn/river, not the exact nuts');
  }
  if (
    actTaken === 'raise' &&
    d.toCall > 0 &&
    d.oop &&
    (st === 'flop' || st === 'turn') &&
    madeCat !== null &&
    madeCat <= 1 &&
    outs >= 4
  )
    breach.push('draw raised OOP');
  return {
    eq: eqNow.eq,
    eqSe: eqNow.se,
    eqHind: eqHind ? eqHind.eq : null,
    options: all.map((x) => ({ a: x.a, ev: x.ev / bbv, fe: x.fe, eqc: x.eqc })),
    taken: taken.a,
    best: best.a,
    evTaken: taken.ev / bbv,
    evBest: best.ev / bbv,
    cost: cost / bbv,
    tol: tol / bbv,
    verdict,
    hcost,
    gain: (taken.ev - (actTaken === 'bet' || actTaken === 'raise' ? passive : 0)) / bbv,
    actTaken,
    mtype,
    mclass,
    breach,
    notes,
    nutClass: nutCls,
    pos,
    into,
    specs: opps.map((o) => specLabel(specs.get(o))),
    nuts,
    outs,
    madeCat,
    heroPf: heroStr,
    R: Rc,
  };
}
export function mistakeType(hand, d, actTaken, best, x) {
  const st = d.street;
  const b = best.a;
  if (st === 'preflop') {
    const k = d.k;
    if (actTaken === 'raise' && k >= 1)
      return k === 1
        ? 'preflop: 3-bet that cannot continue'
        : k === 2
          ? 'preflop: 4-bet without price'
          : 'preflop: 5-bet+ without price';
    if (actTaken === 'raise' && k === 0) return 'preflop: open/iso-raise without price';
    if (actTaken === 'call' && k >= 2 && d.oop)
      return 'preflop: call of a 3-bet or 4-bet out of position';
    if (actTaken === 'call' && k >= 2) return 'preflop: call of a 3-bet or 4-bet in position';
    if (actTaken === 'call' && k === 0 && d.limpersBefore > 0) return 'preflop: limp-behind';
    if (actTaken === 'call' && k === 0) return 'preflop: open-limp / complete';
    if (actTaken === 'call' && k === 1 && b.startsWith('raise') && d.callersSinceRaise > 0)
      return 'preflop: missed squeeze';
    if (actTaken === 'call' && k === 1 && b === 'fold') return 'preflop: cold-call too wide';
    if (actTaken === 'call' && k === 1) return 'preflop: flat instead of 3-bet';
    if (actTaken === 'fold') return 'preflop: folded too strong';
    if (actTaken === 'check') return 'preflop: checked option instead of raising';
    return `preflop: ${actTaken} vs ${b}`;
  }
  if (actTaken === 'call' && b === 'fold')
    return st === 'river' && x.hcost !== null && x.hcost > 0
      ? 'paid off (river call)'
      : 'called too light';
  if (actTaken === 'fold') return 'folded too strong';
  if (actTaken === 'call' && b.startsWith('raise')) return 'missed raise for value';
  if (actTaken === 'raise') {
    if (
      (st === 'turn' || st === 'river') &&
      x.turnComboIp !== true &&
      (x.nutCls === undefined ? x.nuts === false : x.nutCls === null)
    )
      return 'raised a non-nut hand on turn/river';
    if (d.oop && x.madeCat <= 1 && x.outs >= 4) return 'raised a draw out of position';
    return 'raise without price';
  }
  if (actTaken === 'bet') {
    if (b === 'check')
      return (x.taken.eqc ?? 0) < 0.35 ? 'bluffed without price' : 'bet too thin (check better)';
    const sz = x.taken.size ?? 0;
    const bs = Number(b.replace('bet', '')) / 100;
    return bs > sz ? 'bet too small' : 'bet too big';
  }
  if (actTaken === 'check') {
    if ((st === 'flop' || st === 'turn') && x.nuts) return 'slow-played into a free card';
    if (x.eqNow >= 0.5) return 'missed value bet';
    return 'missed bet (fold equity)';
  }
  return `${actTaken} vs ${b}`;
}

/** HARD: the action taken lost chips against a passive or folding alternative (robust to the one-street model).
 *  OPPORTUNITY: a bet or raise the Horse did not make priced higher (model-dependent upper bound), except an in-position
 *  river check of a hand whose equity when called is at least 50%, which is HARD (the check ends the hand, so its value is
 *  exact, and the bet is profitable even if nobody folds). Out of position the check also wins the bets it induces, which
 *  the one-street model does not price, so it stays OPPORTUNITY. */
export function mistakeClass(mtype, street, best, oop = false) {
  if (mtype === 'missed value bet' && street === 'river' && !oop && (best.eqc ?? 0) >= 0.5)
    return 'HARD';
  const opp = [
    'missed bet (fold equity)',
    'missed raise for value',
    'missed value bet',
    'bet too small',
    'bet too big',
    'slow-played into a free card',
    'preflop: missed squeeze',
    'preflop: flat instead of 3-bet',
    'preflop: checked option instead of raising',
  ];
  return opp.includes(mtype) ? 'OPPORTUNITY' : 'HARD';
}
