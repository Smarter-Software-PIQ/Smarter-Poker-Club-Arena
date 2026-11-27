// Omaha-high evaluator (exactly two hole cards + three board cards), holding sampler, range-weighted equity.
// Cards are integers rank*4+suit (rank 0 = deuce .. 12 = ace). No package dependencies.
export const RANKS = '23456789TJQKA';
const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
export function cardFromParts(rank, suit) {
  let r = String(rank);
  if (r === '10') r = 'T';
  const ri = RANKS.indexOf(r.toUpperCase());
  const si = SUIT_NAMES.indexOf(String(suit).toLowerCase());
  if (ri < 0 || si < 0) return null;
  return ri * 4 + si;
}
/** '6spades', '10hearts', 'Qd', {rank, suit} */
export function parseCard(c) {
  if (c && typeof c === 'object') return cardFromParts(c.rank, c.suit);
  const s = String(c);
  const m = /^(10|[2-9TJQKA])(.+)$/i.exec(s);
  if (!m) return null;
  let suit = m[2].toLowerCase();
  if (suit.length === 1) suit = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[suit];
  return cardFromParts(m[1], suit);
}
export const cardStr = (c) => RANKS[c >> 2] + 'cdhs'[c & 3];

const PC = new Uint8Array(8192);
for (let i = 1; i < 8192; i++) PC[i] = PC[i >> 1] + (i & 1);
const SH = 1 << 20;
const CNT = new Int8Array(13);
/** 5-card score: higher is better. category * 2^20 + tie-break. */
export function eval5(a, b, c, d, e) {
  const bits =
    (1 << (a >> 2)) | (1 << (b >> 2)) | (1 << (c >> 2)) | (1 << (d >> 2)) | (1 << (e >> 2));
  const s = a & 3;
  const flush = (b & 3) === s && (c & 3) === s && (d & 3) === s && (e & 3) === s;
  if (PC[bits] === 5) {
    const low = bits & -bits;
    let st = -1;
    if (bits === low * 31) st = 31 - Math.clz32(bits);
    else if (bits === 0x100f) st = 3;
    if (st >= 0) return (flush ? 8 : 4) * SH + st;
    return (flush ? 5 : 0) * SH + bits;
  }
  CNT.fill(0);
  CNT[a >> 2]++;
  CNT[b >> 2]++;
  CNT[c >> 2]++;
  CNT[d >> 2]++;
  CNT[e >> 2]++;
  let quad = -1,
    trip = -1,
    p1 = -1,
    p2 = -1,
    kick = 0;
  for (let r = 12; r >= 0; r--) {
    const n = CNT[r];
    if (n === 4) quad = r;
    else if (n === 3) trip = r;
    else if (n === 2) {
      if (p1 < 0) p1 = r;
      else p2 = r;
    } else if (n === 1) kick = (kick << 4) | r;
  }
  if (quad >= 0) return 7 * SH + (quad << 4) + kick;
  if (trip >= 0 && p1 >= 0) return 6 * SH + (trip << 4) + p1;
  if (trip >= 0) return 3 * SH + (trip << 8) + kick;
  if (p2 >= 0) return 2 * SH + (p1 << 8) + (p2 << 4) + kick;
  return 1 * SH + (p1 << 12) + kick;
}
export const category = (score) => Math.floor(score / SH);
const pairsOf = (n) => {
  const o = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) o.push([i, j]);
  return o;
};
const triplesOf = (n) => {
  const o = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) o.push([i, j, k]);
  return o;
};
const PAIRS = [null, null, pairsOf(2), pairsOf(3), pairsOf(4), pairsOf(5), pairsOf(6)];
const TRIPLES = [null, null, null, triplesOf(3), triplesOf(4), triplesOf(5)];
/** best Omaha-high score: exactly 2 from hole, 3 from board (board 3..5 cards) */
export function omaha(hole, board) {
  const hp = PAIRS[hole.length],
    bt = TRIPLES[board.length];
  let best = -1;
  for (let i = 0; i < hp.length; i++) {
    const x = hole[hp[i][0]],
      y = hole[hp[i][1]];
    for (let j = 0; j < bt.length; j++) {
      const t = bt[j];
      const v = eval5(x, y, board[t[0]], board[t[1]], board[t[2]]);
      if (v > best) best = v;
    }
  }
  return best;
}
/** seeded PRNG (mulberry32) so every run of the audit is reproducible */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function deckWithout(dead) {
  const s = new Set(dead);
  const o = [];
  for (let c = 0; c < 52; c++) if (!s.has(c)) o.push(c);
  return o;
}
function drawK(deck, k, rnd, out) {
  // partial Fisher-Yates on a copy-free index walk
  const n = deck.length;
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (n - i));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
    out[i] = deck[i];
  }
  return out;
}
/**
 * A pool of M random holdings of size n from the cards not in `dead` (the Horse's shown cards and the board).
 * Every opponent range is a weighting of this one pool.
 */
export function holdingPool(dead, n, M, rnd) {
  const deck = deckWithout(dead);
  const pool = [];
  for (let m = 0; m < M; m++) pool.push(drawK(deck, n, rnd, new Array(n)).slice());
  return pool;
}
/** strength of each pool holding on `board`: share of the pool that strictly beats it (0 = nuts in the pool) */
export function poolStrength(pool, board) {
  const sc = pool.map((h) => omaha(h, board));
  const sorted = Float64Array.from(sc).sort();
  const M = sc.length;
  return sc.map((v) => {
    // count strictly greater
    let lo = 0,
      hi = M;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return (M - lo) / M;
  });
}
/** exact strength of a holding on a board versus the pool (share of pool holdings that beat it) */
export function strengthVsPool(hole, pool, board) {
  const v = omaha(hole, board);
  let n = 0;
  for (const h of pool) if (omaha(h, board) > v) n++;
  return n / pool.length;
}
/** weights from a strength histogram over bin edges: w_i = hist[bin_i] / share of pool in bin */
export function histWeights(strengths, hist, edges) {
  const nb = edges.length - 1;
  const binOf = (p) => {
    for (let b = 0; b < nb; b++) if (p < edges[b + 1]) return b;
    return nb - 1;
  };
  const bins = strengths.map(binOf);
  const cnt = new Array(nb).fill(0);
  for (const b of bins) cnt[b]++;
  return bins.map((b) => (cnt[b] > 0 ? hist[b] / cnt[b] : 0));
}
/** keep only the strongest `share` of a weighted range (by strength on its board); used for "continues versus a raise" */
export function truncateStrongest(weights, strengths, share) {
  const idx = weights
    .map((w, i) => i)
    .filter((i) => weights[i] > 0)
    .sort((x, y) => strengths[x] - strengths[y]);
  const tot = idx.reduce((s, i) => s + weights[i], 0);
  const out = new Array(weights.length).fill(0);
  let acc = 0;
  const lim = Math.max(1e-9, share) * tot;
  for (const i of idx) {
    if (acc >= lim) break;
    const take = Math.min(weights[i], lim - acc);
    out[i] = take;
    acc += take;
  }
  return out;
}
function cumulative(w) {
  const c = new Float64Array(w.length);
  let s = 0;
  for (let i = 0; i < w.length; i++) {
    s += w[i];
    c[i] = s;
  }
  return { c, s };
}
function pick(cum, rnd) {
  const x = rnd() * cum.s;
  let lo = 0,
    hi = cum.c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum.c[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/**
 * Equity of `hero` against opponents, each a weighting of `pool` (or a fixed known hand), on `board`, by joint
 * sampling: one holding per opponent drawn from its weights (card clashes redrawn), then one random runout.
 * Returns {eq, se, n}. Ties split.
 */
export function rangeEquity(hero, board, opps, pool, N, rnd) {
  const cums = opps.map((o) => (o.known ? null : cumulative(o.weights)));
  if (cums.some((c) => c && c.s <= 0)) return null;
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  let won = 0,
    won2 = 0,
    n = 0;
  const full = board.slice();
  for (let it = 0; it < N; it++) {
    used.fill(0);
    for (const c of hero) used[c] = 1;
    for (const c of board) used[c] = 1;
    const hs = [];
    let ok = true;
    for (let j = 0; j < opps.length && ok; j++) {
      if (opps[j].known) {
        const h = opps[j].known;
        for (const c of h) {
          if (used[c]) ok = false;
          used[c] = 1;
        }
        hs.push(h);
        continue;
      }
      let tries = 0,
        h;
      for (;;) {
        h = pool[pick(cums[j], rnd)];
        if (!h.some((c) => used[c])) break;
        if (++tries > 40) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      for (const c of h) used[c] = 1;
      hs.push(h);
    }
    if (!ok) continue;
    for (let k = 0; k < need; k++) {
      let c;
      do c = Math.floor(rnd() * 52);
      while (used[c]);
      used[c] = 1;
      full[board.length + k] = c;
    }
    const b = full.length === 5 ? full : full.slice(0, 5);
    const mine = omaha(hero, b);
    let best = mine,
      ties = 1,
      beaten = false;
    for (const h of hs) {
      const v = omaha(h, b);
      if (v > best) {
        beaten = true;
        break;
      }
      if (v === mine) ties++;
    }
    const share = beaten ? 0 : 1 / ties;
    won += share;
    won2 += share * share;
    n++;
  }
  if (n === 0) return null;
  const eq = won / n;
  return { eq, se: Math.sqrt(Math.max(0, won2 / n - eq * eq) / n), n };
}
/** made-hand helpers for mistake typing */
export function isNutsExact(hole, board) {
  // no two unseen cards make a better Omaha hand with three board cards (ties count as nuts)
  const v = omaha(hole, board);
  const deck = deckWithout([...hole, ...board]);
  const bt = TRIPLES[board.length];
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++)
      for (const t of bt)
        if (eval5(deck[i], deck[j], board[t[0]], board[t[1]], board[t[2]]) > v) return false;
  return true;
}
/**
 * Bigger full houses an opponent's two cards could make over the hero's full house (0 when the hero holds no full
 * house, or quads / a straight flush). A port of the engine's omahaBoatsAbove (server/src/engine/HorseEval.ts): every
 * two-RANK holding still physically available against every three-card board subset; quads are NOT counted (the
 * engine's decision on record: a top full house beaten only by quads stays nut class).
 */
export function boatsAbove(hole, board) {
  if (!hole || hole.length < 2 || !board || board.length < 3) return 0;
  const strength = (ranks) => {
    const n = new Map();
    for (const r of ranks) n.set(r, (n.get(r) || 0) + 1);
    let four = 0,
      three = 0,
      two = 0,
      kicker = 0;
    for (const [r, k] of n) {
      if (k === 4) four = r;
      else if (k === 3) three = Math.max(three, r);
      else if (k === 2) two = Math.max(two, r);
      else kicker = Math.max(kicker, r);
    }
    if (four) return 2_000_000 + four * 100 + kicker;
    if (three && two) return 1_000_000 + three * 100 + two;
    return 0;
  };
  const R = (c) => (c >> 2) + 2;
  const br = board.map(R);
  const bt = TRIPLES[board.length].map((t) => [br[t[0]], br[t[1]], br[t[2]]]);
  const best = (a, b) => {
    let top = 0;
    for (const t of bt) top = Math.max(top, strength([a, b, ...t]));
    return top;
  };
  const hr = hole.map(R);
  let hero = 0;
  for (let i = 0; i < hr.length; i++)
    for (let j = i + 1; j < hr.length; j++) hero = Math.max(hero, best(hr[i], hr[j]));
  if (hero < 1_000_000 || hero >= 2_000_000) return 0;
  const seen = new Map();
  for (const r of hr.concat(br)) seen.set(r, (seen.get(r) || 0) + 1);
  const live = (r) => 4 - (seen.get(r) || 0);
  let boats = 0;
  for (let a = 2; a <= 14; a++)
    for (let b = a; b <= 14; b++) {
      if (a === b ? live(a) < 2 : live(a) < 1 || live(b) < 1) continue;
      const opp = best(a, b);
      if (opp > hero && opp < 2_000_000) boats++;
    }
  return boats;
}
/**
 * The engine's nut class on a flop, turn or river board (omahaNutClassNow, HorseOmahaMadeHandDefense.ts, and
 * omahaRiverRaiseLicense, HorseOmahaRiverNutRaise.ts), so the audit's owner-rule check "a hand that is not nut
 * class never raises the turn or river" asks the engine's own question:
 *   'nuts'      - the exact nuts (isNutsExact), or
 *   'effective' - a full house or better no bigger full house beats (quads over it do not count); the nut flush
 *                 on an unpaired board; the nut straight on an unpaired board with no possible flush;
 *   null        - neither.
 * The engine also removes the Horse's known dead cards (cards folded face up) from the exact-nuts count; the audit
 * has none, so it can only be stricter there, never looser.
 */
export function nutClass(hole, board) {
  if (!board || board.length < 3) return null;
  if (isNutsExact(hole, board)) return 'nuts';
  const sc = omaha(hole, board);
  const cat = category(sc);
  const paired = new Set(board.map((c) => c >> 2)).size < board.length;
  if (cat >= 6) return boatsAbove(hole, board) === 0 ? 'effective' : null;
  const suitN = [0, 0, 0, 0];
  for (const c of board) suitN[c & 3]++;
  if (cat === 5) {
    if (paired) return null;
    for (let suit = 0; suit < 4; suit++) {
      if (suitN[suit] < 3) continue;
      const mine = hole.filter((c) => (c & 3) === suit).map((c) => c >> 2);
      if (mine.length < 2) continue;
      const top = Math.max(...mine);
      const seen = new Set([...board.filter((c) => (c & 3) === suit).map((c) => c >> 2), ...mine]);
      for (let r = top + 1; r <= 12; r++) if (!seen.has(r)) return null;
      return 'effective';
    }
    return null;
  }
  if (cat === 4) {
    if (paired || suitN.some((n) => n >= 3)) return null;
    const heroTop = (sc & (SH - 1)) + 2; // 5 (the wheel) .. 14
    const ranks = new Set(board.map((c) => (c >> 2) + 2));
    for (let top = 14; top >= 5; top--) {
      let on = 0;
      for (let k = 0; k < 5; k++) if (ranks.has(top - k === 1 ? 14 : top - k)) on++;
      if (on >= 3) return top <= heroTop ? 'effective' : null;
    }
    return 'effective';
  }
  return null;
}
/**
 * The engine's ONE definition of the combo draw that may raise in position (comboDrawForRaise is a port of
 * omahaComboDrawForRaise, HorseOmahaBigDrawAggression.ts; owner 2026-11-15 12:30 "only in position when its combo
 * draws"): on a flop or turn board, a hand below two pair with five or more next cards that make a flush, together
 * with eight or more straight outs counted by rank under the two-card rule (omahaStraightOutRanks,
 * HorseOmahaCardImpact.ts; a card that also completes the flush counts). The engine keeps a turn raise with it in
 * position (omahaTurnComboDrawRaisePermitted), so the audit's owner-rule check must too.
 */
export function straightOutRanks(holeMask, boardMask) {
  const made = (bm) => {
    for (let top = 14; top >= 5; top--) {
      let w = 0;
      for (let k = 0; k < 5; k++) w |= 1 << (top - k === 1 ? 1 : top - k);
      const missing = w & ~bm;
      let m = 0;
      for (let b = missing; b; b &= b - 1) m++;
      if (m > 2 || (missing & ~holeMask) !== 0) continue;
      let h = 0;
      for (let b = holeMask & w; b; b &= b - 1) h++;
      if (h >= 2) return true;
    }
    return false;
  };
  const out = [];
  if (made(boardMask)) return out;
  for (let r = 2; r <= 14; r++) {
    const bit = (1 << r) | (r === 14 ? 2 : 0);
    if (boardMask & (1 << r)) continue;
    if (made(boardMask | bit)) out.push(r);
  }
  return out;
}
/** rank mask: bit r = rank value r (2..14), the ace also bit 1 */
export function rankMask(cards) {
  let m = 0;
  for (const c of cards) {
    const v = (c >> 2) + 2;
    m |= 1 << v;
    if (v === 14) m |= 2;
  }
  return m;
}
export function comboDrawForRaise(hole, board) {
  if (board.length !== 3 && board.length !== 4) return false;
  // engine catOf >= 3 (its scale starts at 1) = two pair or better; this evaluator's scale starts at 0
  if (category(omaha(hole, board)) >= 2) return false;
  const deck = deckWithout([...hole, ...board]);
  let flushOuts = 0;
  for (const c of deck) if (category(omaha(hole, [...board, c])) === 5) flushOuts++;
  if (flushOuts < 5) return false;
  const ranks = new Set(straightOutRanks(rankMask(hole), rankMask(board)));
  let straight = 0;
  for (const c of deck) if (ranks.has((c >> 2) + 2)) straight++;
  return straight >= 8;
}
/**
 * The engine's draw for the owner rule "draws are never raised out of position" (drawForRaiseBar is a port of the
 * draw test in omahaDrawRaiseBar, HorseOmahaBigDrawAggression.ts): on a flop or turn board, a hand below two pair
 * with five or more next cards that make a flush, or eight or more next cards that make a straight (drawOuts: a card
 * that makes a flush counts as a flush out, not a straight out). One pair with a 4-out gutshot is a made hand, not a
 * draw (lead ruling 2026-11-27 on hand 8332e6c2).
 */
export function drawForRaiseBar(hole, board) {
  if (board.length !== 3 && board.length !== 4) return false;
  if (category(omaha(hole, board)) >= 2) return false;
  let flushOuts = 0;
  let straightOuts = 0;
  for (const c of deckWithout([...hole, ...board])) {
    const k = category(omaha(hole, [...board, c]));
    if (k === 5) flushOuts++;
    else if (k === 4) straightOuts++;
  }
  return flushOuts >= 5 || straightOuts >= 8;
}
/** cards that improve the hand to a straight or better on the next card (outs), for "draw" typing */
export function outsToStraightPlus(hole, board) {
  if (board.length >= 5) return 0;
  const cur = omaha(hole, board);
  if (category(cur) >= 4) return 0;
  const deck = deckWithout([...hole, ...board]);
  let n = 0;
  for (const c of deck) if (category(omaha(hole, [...board, c])) >= 4) n++;
  return n;
}
/**
 * Preflop holding score (ordering only): high cards, pairs, suitedness (suited aces count most), connectedness.
 * Used to turn a measured action frequency ("top X% of holdings") into a range. It is a heuristic and is labelled so.
 */
export function preflopScore(h) {
  const rs = h.map((c) => c >> 2),
    ss = h.map((c) => c & 3);
  let s = 0;
  const rc = new Array(13).fill(0);
  for (const r of rs) rc[r]++;
  for (let r = 0; r < 13; r++) {
    if (rc[r] === 2) s += 8 + r * 1.6;
    else if (rc[r] >= 3) s += 2 + r * 0.5 - 6;
  }
  for (const r of rs) s += r * 0.45;
  const sc = [0, 0, 0, 0];
  for (const x of ss) sc[x]++;
  let suitedSuits = 0;
  for (let su = 0; su < 4; su++) {
    if (sc[su] >= 2) {
      suitedSuits++;
      const top = Math.max(...h.filter((c) => (c & 3) === su).map((c) => c >> 2));
      s += 3 + top * 0.5 + (top === 12 ? 4 : 0) - (sc[su] >= 3 ? 2.5 * (sc[su] - 2) : 0);
    }
  }
  if (suitedSuits >= 2) s += 2;
  const u = new Set(rs);
  if (u.has(12)) u.add(-1);
  let bestWin = 0,
    bestTop = 0;
  for (let lo = -1; lo <= 8; lo++) {
    let k = 0;
    for (const r of u) if (r >= lo && r <= lo + 4) k++;
    if (k > bestWin || (k === bestWin && lo > bestTop)) {
      bestWin = k;
      bestTop = lo;
    }
  }
  s += (bestWin - 1) * 3 + (bestWin >= 3 ? bestTop * 0.3 : 0);
  return s;
}
