// Tier B: decisions whose Horse cards were not shown, graded as populations per node.
// The cost of a node's folds is NOT "fold rate above s/(1+s)". It is estimated from what the bettors in that node
// actually hold when shown (their measured strength histogram for that street, line, size and heads-up/multiway,
// measured separately for person and Horse bettors and shrunk toward the pooled range table), applied to the Horse's
// own folding range (the weakest share of the range it arrived with): over-fold cost = the folded hands that would
// have won enough against that actual range at the price. "Theoretical exploitability" (what an any-two-cards bluff
// would win against the node's fold rate) is reported separately and is never added to chips lost.
import { holdingPool, strengthVsPool, rng } from './omaha.mjs';
import { sizeBucket } from './hand.mjs';
import { NBOARD, REALISE } from './grade.mjs';
const K = 30;
function binOf(p, edges) {
  for (let b = 0; b < edges.length - 1; b++) if (p < edges[b + 1]) return b;
  return edges.length - 2;
}
export function bettorKey(hand, d) {
  const into = d.live <= 2 ? 'hu' : 'mw';
  if (!d.firstWager) return `${hand.gv}|${d.street}|raise|any|${into}`;
  const line =
    d.street === 'flop'
      ? d.lastPfRaiser === d.u
        ? 'agg'
        : 'non'
      : (d.wageredPrev ?? []).includes(d.u)
        ? 'agg'
        : 'non';
  return `${hand.gv}|${d.street}|${line}|${sizeBucket(d.amt / Math.max(d.pot, 1e-9))}|${into}`;
}
/** measured bettor strength histograms in the audited hands, by bettor type (person / horse); showdown bias corrected */
export function measureBettors(hands, tables) {
  const edges = tables.binEdges,
    nb = edges.length - 1,
    weakEdge = tables.weakEdge ?? 0.2;
  const cells = new Map();
  const r = rng(99);
  for (const h of hands) {
    if (h.bomb || h.rit || h.board.length < 5) continue;
    h.decisions.forEach((d, i) => {
      if (d.street === 'preflop' || !d.isRaise) return;
      const bt = h.byUid.get(d.u)?.isHorse ? 'horse' : 'person';
      const key = bettorKey(h, d) + '|' + bt;
      const c = cells.get(key) ?? { hist: new Array(nb).fill(0), shown: 0, bets: 0, laterFold: 0 };
      c.bets++;
      const later = h.decisions.slice(i + 1).some((x) => x.u === d.u && x.act === 'fold');
      const hole = h.shown.get(d.u);
      if (later || (!hole && h.shown.size > 0)) c.laterFold++;
      if (hole) {
        const b = h.board.slice(0, NBOARD[d.street]);
        const pool = holdingPool([...hole, ...b], hole.length, 800, r);
        c.hist[binOf(strengthVsPool(hole, pool, b), edges)]++;
        c.shown++;
      }
      cells.set(key, c);
    });
  }
  const out = new Map();
  for (const [key, c] of cells) {
    const tkey = key.split('|').slice(0, 5).join('|');
    const prior = tables.bettor?.[tkey]?.hist ?? new Array(nb).fill(1 / nb);
    let own = null;
    const s = c.hist.reduce((a, b) => a + b, 0);
    if (s > 0) {
      const base = c.hist.map((x) => x / s);
      const f = Math.max(0, Math.min(0.9, c.laterFold / Math.max(c.bets, 1)));
      const weak = base.map((x, i) => (edges[i] >= weakEdge ? x : 0));
      const ws = weak.reduce((a, b) => a + b, 0);
      const wn = ws > 0 ? weak.map((x) => x / ws) : base.map((_, i) => (i === nb - 1 ? 1 : 0));
      own = base.map((x, i) => (1 - f) * x + f * wn[i]);
    }
    const hist = own ? own.map((x, i) => (c.shown * x + K * prior[i]) / (c.shown + K)) : prior;
    out.set(key, {
      hist,
      shown: c.shown,
      bets: c.bets,
      laterFold: c.laterFold,
      air: hist[nb - 2] + hist[nb - 1],
    });
  }
  return out;
}
/** P(Horse hand at strength x beats a bettor drawn from hist), hist uniform within bins on the shared strength scale */
export function winProb(x, hist, edges) {
  let p = 0;
  for (let b = 0; b < hist.length; b++) {
    const lo = edges[b],
      hi = edges[b + 1];
    if (x <= lo) p += hist[b];
    else if (x < hi) p += (hist[b] * (hi - x)) / (hi - lo);
  }
  return p;
}
const integ = (a, b, g, steps = 80) => {
  let t = 0;
  const d = (b - a) / steps;
  for (let i = 0; i < steps; i++) t += g(a + (i + 0.5) * d) * d;
  return t;
};
/**
 * Node table for every Horse decision (tier A and B) in the audited hands. facing-bet nodes get the actual-range cost;
 * first-to-act nodes get bet frequency and success.
 */
export function rangeTier(hands, decisionRows, tables, pop, bettors, personHands) {
  const edges = tables.binEdges;
  const byHand = new Map(hands.map((h) => [h.id, h]));
  const nodes = new Map();
  const node = (k) => {
    let n = nodes.get(k);
    if (!n) {
      n = {
        key: k,
        n: 0,
        tierA: 0,
        fold: 0,
        call: 0,
        raise: 0,
        check: 0,
        bet: 0,
        betWon: 0,
        sumS: 0,
        sumBE: 0,
        sumP0: 0,
        aCost: 0,
        aMist: 0,
        examples: [],
        vsPerson: k.endsWith('vs person'),
        spots: [],
      };
      nodes.set(k, n);
    }
    return n;
  };
  for (const row of decisionRows) {
    const n = node(row.node);
    n.n++;
    if (row.tier === 'A') {
      n.tierA++;
      if (row.verdict === 'MISTAKE') {
        n.aMist++;
        n.aCost += row.cost_bb;
      }
    }
    const a = row.action;
    if (a === 'fold') n.fold++;
    else if (a === 'check') n.check++;
    else if (a === 'call') n.call++;
    else if (row.tocall_bb > 0 || row.street === 'preflop') {
      if (a === 'call' || (a === 'all_in' && !(row.size > 0 && row.tocall_bb === 0))) n.call++;
      else n.raise++;
    } else n.bet++;
    if (row.tocall_bb > 0 && row.size !== null) {
      n.sumS += row.size;
      n.sumBE += row.size / (1 + row.size);
      n.sumP0 += row.pot_bb - row.tocall_bb;
    }
    n.spots.push(row);
  }
  for (const n of nodes.values()) {
    const [street, ctx] = n.key.split('|');
    const facing = ctx.startsWith('facing');
    n.f = n.n ? n.fold / n.n : 0;
    n.meanS = facing && n.n ? n.sumS / n.n : null;
    n.BE = facing && n.n ? n.sumBE / n.n : null;
    n.theoretical = 0;
    n.overCost = 0;
    n.underCost = 0;
    n.bettorShown = 0;
    n.bettorAir = null;
    if (facing && street !== 'preflop') {
      let airSum = 0,
        airN = 0;
      const cont = [];
      for (const row of n.spots) {
        if (row.action === 'fold') continue;
        const h = byHand.get(row.hand_id);
        const hp = h.players.find((p) => p.name === row.horse);
        const hole = hp && h.shown.get(hp.uid);
        if (!hole || h.board.length < NBOARD[row.street]) continue;
        const b = h.board.slice(0, NBOARD[row.street]);
        cont.push(strengthVsPool(hole, holdingPool([...hole, ...b], hole.length, 600, rng(5)), b));
      }
      cont.sort((x, y) => x - y);
      n.contShown = cont.length;
      n.xc =
        cont.length >= 5 ? cont[Math.min(cont.length - 1, Math.floor(0.9 * cont.length))] : 1 - n.f;
      for (const row of n.spots) {
        const h = byHand.get(row.hand_id);
        const di = h.decisions.findIndex(
          (x) =>
            x.u === h.players.find((p) => p.name === row.horse)?.uid &&
            x.street === row.street &&
            Math.abs(x.pot / h.bb - row.pot_bb) < 1e-6 &&
            x.act === row.action
        );
        if (di < 0) continue;
        const d = h.decisions[di];
        const bi = h.decisions
          .slice(0, di)
          .map((x, j) => j)
          .reverse()
          .find(
            (j) =>
              h.decisions[j].u === d.facing &&
              h.decisions[j].isRaise &&
              h.decisions[j].street === d.street
          );
        if (bi === undefined) continue;
        const bd = h.decisions[bi];
        const bt = h.byUid.get(bd.u)?.isHorse ? 'horse' : 'person';
        const bcell = bettors.get(bettorKey(h, bd) + '|' + bt) ?? {
          hist: tables.bettor?.[bettorKey(h, bd)]?.hist,
          shown: 0,
          air: null,
        };
        if (!bcell.hist) continue;
        airSum += bcell.air ?? 0;
        airN++;
        n.bettorShown = Math.max(n.bettorShown, bcell.shown);
        const s = d.toCall / Math.max(d.pot - d.toCall, 1e-9);
        const P0 = (d.pot - d.toCall) / h.bb;
        const Rz = REALISE[d.street][d.oop ? 'oop' : 'ip'];
        // where the Horse stops continuing: the weak end (90th percentile) of the strengths of its shown continues at
        // this node when it has at least 5, else 1 - f (a random holding's strength is uniform on [0, 1]).
        const xc = n.xc;
        // over-fold: folded hands stronger than the price needs (x in [xc, x*]); under-fold: continued hands that lose at
        // the price (x in [x*, xc]); both with a random holding's uniform density.
        // flop: made-hand strength ignores draws, so no chip estimate (rates and theoretical exploitability only)
        if (d.street !== 'flop') {
          const fc = nodeFoldCost({ bettorHist: bcell.hist, edges, s, xc, R: Rz });
          n.overCost += P0 * fc.over;
          n.underCost += P0 * fc.under;
        }
        n.theoretical += P0 * (1 + s) * Math.max(0, n.f - s / (1 + s));
      }
      n.bettorAir = airN ? airSum / airN : null;
      const per = (x) => (x / Math.max(personHands, 1)) * 100;
      n.overPer100 = per(n.overCost);
      n.underPer100 = per(n.underCost);
      n.theoPer100 = per(n.theoretical);
      const meanP0 = n.n ? n.sumP0 / n.n : 0;
      n.verdict =
        street === 'flop'
          ? 'no chip estimate on the flop (draws)'
          : n.overCost / Math.max(n.n, 1) > 0.02 * meanP0 && n.overCost > n.underCost
            ? 'over-fold'
            : n.underCost / Math.max(n.n, 1) > 0.02 * meanP0 && n.underCost > n.overCost
              ? 'under-fold'
              : 'fine';
    } else if (!facing && street !== 'preflop') {
      // first to act / checked to: bets and how often they took the pot at once
      let won = 0,
        sumBE = 0,
        net = 0,
        nb2 = 0;
      for (const row of n.spots) {
        if (!(row.size > 0) || row.tocall_bb > 0) continue;
        nb2++;
        const h = byHand.get(row.hand_id);
        const hp = h.players.find((p) => p.name === row.horse);
        const di = h.decisions.findIndex(
          (x) => x.u === hp?.uid && x.street === row.street && x.isRaise && x.toCall === 0
        );
        if (di < 0) continue;
        const d = h.decisions[di];
        const rest = h.decisions.slice(di + 1).filter((x) => x.street === d.street);
        const allFold = rest.length > 0 && rest.every((x) => x.act === 'fold');
        if (allFold) {
          won++;
          net += d.pot / h.bb;
        }
        sumBE += row.size / (1 + row.size);
      }
      n.bets = nb2;
      n.betSuccess = nb2 ? won / nb2 : null;
      n.betBE = nb2 ? sumBE / nb2 : null;
      const margin = nb2
        ? Math.max(0.05, 2 * Math.sqrt((n.betSuccess * (1 - n.betSuccess)) / nb2))
        : 1;
      n.verdict = !nb2
        ? 'fine'
        : n.betSuccess > n.betBE + margin
          ? 'under-bluff (bets take the pot often: room to bet more)'
          : n.betSuccess < n.betBE - margin
            ? 'bets rarely take the pot (fine if they are value)'
            : 'fine';
      n.uncontestedWon = net;
    } else {
      n.verdict = n.aMist > 0 ? 'see tier A' : 'fine';
    }
    n.examples = n.spots
      .filter((x) => x.action === 'fold')
      .slice(0, 8)
      .map((x) => x.hand_id);
    delete n.spots;
  }
  return [...nodes.values()];
}

/**
 * Per unit of the pot before the bet: over = folded hands (strength xc..1, uniform density) that beat the bettor's actual
 * range at the price; under = continued hands (0..xc) that lose to it at the price.
 */
export function nodeFoldCost({ bettorHist, edges, s, xc, R = 1 }) {
  const ev = (x) => R * winProb(x, bettorHist, edges) * (1 + 2 * s) - s;
  return {
    over: integ(xc, 1, (x) => Math.max(0, ev(x))),
    under: integ(0, xc, (x) => Math.max(0, -ev(x))),
  };
}
