/**
 * Solved-flop library lookup (HV31 FLOP-3 item B4). DORMANT.
 *
 * Instead of a learned model, a flop decision can be answered with the solver's own
 * strategy for the solved flop nearest to the live flop, mapped onto the live board by
 * rank and suit isomorphism. This module is pure and synchronous: no database, no file
 * system, no network and no awaiting per decision. A library is indexed once by
 * `loadSolvedFlopLibrary` (no production code path calls it, and no library data
 * exists in production).
 *
 * The lookup answers only when ALL of these hold:
 *   - the flag is on (`SOLVED_FLOP_LIBRARY_ENABLED=1`; default off),
 *   - a library is loaded for the table type,
 *   - a library board of the same structure (pair type and positional suit pattern)
 *     lies within the library's maximum distance,
 *   - the library has the requested node.
 * Otherwise it returns null and the caller keeps its existing path unchanged.
 *
 * Structure, distance, nearest-board choice and the hand mapping mirror
 * flop3/B4/src/b4_lib.py (HV31 solver workspace) one to one; the pinned vectors in
 * SolvedFlopLibrary.vectors.json were produced by that file and are checked by the tests.
 */

export const SOLVED_FLOP_RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
export const SOLVED_FLOP_NODES = ['F.cbet', 'F.vs_b33', 'F.vs_b75', 'F.vs_xr'] as const;
export type SolvedFlopNode = (typeof SOLVED_FLOP_NODES)[number];
export type FeatureKey = 'r0' | 'r1' | 'r2' | 'g01' | 'g12' | 'nstr';
export type DistanceWeights = Partial<Record<FeatureKey, number>>;

/** Canonical 1326 hand order (pio_upi.COMBO_CARDS): for b in 0..51, a in 0..b-1: (deck[a], deck[b]); deck is rank-major with suits c d h s. */
const DECK: string[] = [];
for (const r of SOLVED_FLOP_RANKS) for (const s of SUITS) DECK.push(r + s);
export const COMBO_CARDS: ReadonlyArray<readonly [string, string]> = (() => {
  const out: Array<readonly [string, string]> = [];
  for (let b = 0; b < 52; b++) for (let a = 0; a < b; a++) out.push([DECK[a], DECK[b]] as const);
  return out;
})();
const CIDX = new Map<string, number>();
COMBO_CARDS.forEach(([a, b], i) => {
  CIDX.set(a + b, i);
  CIDX.set(b + a, i);
});
export function comboIndex(c1: string, c2: string): number {
  const i = CIDX.get(c1 + c2);
  if (i === undefined) throw new Error(`not a hand: ${c1}${c2}`);
  return i;
}

const rk = (c: string): number => SOLVED_FLOP_RANKS.indexOf(c[0]);
export function boardCards(board: string): string[] {
  if (!/^([2-9TJQKA][cdhs]){3}$/.test(board)) throw new Error(`not a flop: ${board}`);
  const cs = [board.slice(0, 2), board.slice(2, 4), board.slice(4, 6)];
  if (new Set(cs).size !== 3) throw new Error(`repeated card: ${board}`);
  return cs;
}

/** Rank descending; ties (paired boards) put the pair card that shares its suit with the third card first, then suit letter. */
export function orderedBoard(board: string): string[] {
  const cs = boardCards(board);
  const key = (c: string): [number, number, string] => {
    const shares = cs.some((x) => x !== c && x[0] !== c[0] && x[1] === c[1]);
    return [-rk(c), shares ? 0 : 1, c[1]];
  };
  return [...cs].sort((x, y) => {
    const a = key(x);
    const b = key(y);
    return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
  });
}

/** Pair type (u, hp, lp, t) and positional suit pattern (r, m, t01, t02, t12), e.g. 'u.t01'. */
export function boardStructure(board: string): string {
  const o = orderedBoard(board);
  const r = o.map(rk);
  const pt = r[0] === r[2] ? 't' : r[0] === r[1] ? 'hp' : r[1] === r[2] ? 'lp' : 'u';
  const lab = new Map<string, number>();
  const sl = o.map((c) => {
    if (!lab.has(c[1])) lab.set(c[1], lab.size);
    return lab.get(c[1])!;
  });
  const names: Record<string, string> = {
    '012': 'r',
    '000': 'm',
    '001': 't01',
    '010': 't02',
    '011': 't12',
  };
  return `${pt}.${names[sl.join('')]}`;
}

/** Pairs {p, q} of distinct non-board ranks giving at least four distinct ranks inside one five-rank window (ace high and low). */
export function straightCount(ranks: number[]): number {
  const br = new Set(ranks);
  let n = 0;
  for (let p = 0; p < 13; p++) {
    for (let q = p + 1; q < 13; q++) {
      if (br.has(p) || br.has(q)) continue;
      const v = new Set([...br, p, q]);
      if (v.has(12)) v.add(-1);
      for (let lo = -1; lo < 9; lo++) {
        let k = 0;
        for (let x = lo; x < lo + 5; x++) if (v.has(x)) k++;
        if (k >= 4) {
          n++;
          break;
        }
      }
    }
  }
  return n;
}

export function boardFeatures(board: string): Record<FeatureKey, number> {
  const r = orderedBoard(board).map(rk);
  return {
    r0: r[0],
    r1: r[1],
    r2: r[2],
    g01: r[0] - r[1],
    g12: r[1] - r[2],
    nstr: straightCount(r),
  };
}

export function boardDistance(a: string, b: string, w: DistanceWeights): number {
  if (boardStructure(a) !== boardStructure(b)) return Number.POSITIVE_INFINITY;
  const fa = boardFeatures(a);
  const fb = boardFeatures(b);
  let d = 0;
  for (const k of Object.keys(w) as FeatureKey[]) d += (w[k] ?? 0) * Math.abs(fa[k] - fb[k]);
  return d;
}

export function suitMap(a: string, b: string): Record<string, string> {
  const oa = orderedBoard(a);
  const ob = orderedBoard(b);
  const m: Record<string, string> = {};
  oa.forEach((x, i) => {
    const y = ob[i][1];
    if (m[x[1]] !== undefined && m[x[1]] !== y) throw new Error(`suit pattern differs: ${a} ${b}`);
    m[x[1]] = y;
  });
  const used = new Set(Object.values(m));
  const restA = [...SUITS].filter((s) => m[s] === undefined);
  const restB = [...SUITS].filter((s) => !used.has(s));
  restA.forEach((s, i) => (m[s] = restB[i]));
  return m;
}

/**
 * Order-preserving rank map from live board a to library board b (b4_lib.rank_map). Board ranks map to the
 * corresponding board ranks. Each interval between board ranks (and above the top card or below the bottom card,
 * bounded by the ends of the deck) holds m non-board ranks of a and n of b:
 *   m >= 2: endpoint aligned, k -> round(k (n-1)/(m-1));
 *   m == 1: next to the upper bound -> highest of b's interval, next to the lower bound -> lowest, else the middle;
 *   n == 0: the nearest non-board rank of b to the interpolated position (ties to the lower rank).
 */
export function rankMap(a: string, b: string): number[] {
  const ra = [...new Set(boardCards(a).map(rk))].sort((x, y) => x - y);
  const rb = [...new Set(boardCards(b).map(rk))].sort((x, y) => x - y);
  if (ra.length !== rb.length) throw new Error(`pair type differs: ${a} ${b}`);
  const m = new Array<number>(13).fill(-1);
  ra.forEach((x, i) => (m[x] = rb[i]));
  const A = [-1, ...ra, 13];
  const B = [-1, ...rb, 13];
  const rbSet = new Set(rb);
  const nonb = [...Array(13).keys()].filter((x) => !rbSet.has(x));
  for (let i = 0; i < A.length - 1; i++) {
    const us: number[] = [];
    for (let x = A[i] + 1; x < A[i + 1]; x++) us.push(x);
    const vs: number[] = [];
    for (let x = B[i] + 1; x < B[i + 1]; x++) vs.push(x);
    us.forEach((u, k) => {
      if (vs.length === 0) {
        const t = B[i] + ((B[i + 1] - B[i]) * (k + 1)) / (us.length + 1);
        let best = nonb[0];
        for (const y of nonb) {
          const dy = Math.abs(y - t);
          const db = Math.abs(best - t);
          if (dy < db || (dy === db && y < best)) best = y;
        }
        m[u] = best;
        return;
      }
      let j: number;
      if (us.length >= 2) j = Math.floor((k * (vs.length - 1)) / (us.length - 1) + 0.5);
      else if (u + 1 === A[i + 1]) j = vs.length - 1;
      else if (u - 1 === A[i]) j = 0;
      else j = Math.floor(vs.length / 2);
      m[u] = vs[j];
    });
  }
  return m;
}

export interface MappedHand {
  index: number;
  rule: 'direct' | 'split';
}

/**
 * Live hand (canonical index, not blocked on live board a) -> library hand on board b. Blocking rule: a live hand
 * never maps onto a library board card (board ranks map to board ranks with a bijective suit map, non-board ranks to
 * non-board ranks); when two distinct non-board ranks merge, the lower card moves to the nearest other non-board
 * rank of b, lower side first ('split').
 */
export function mapHand(
  h: number,
  a: string,
  b: string,
  rm = rankMap(a, b),
  sm = suitMap(a, b)
): MappedHand {
  let [c1, c2] = COMBO_CARDS[h];
  let x = rk(c1);
  let y = rk(c2);
  if (x < y) {
    [c1, c2] = [c2, c1];
    [x, y] = [y, x];
  }
  const bset = new Set(boardCards(b));
  const m1 = SOLVED_FLOP_RANKS[rm[x]] + sm[c1[1]];
  let m2 = SOLVED_FLOP_RANKS[rm[y]] + sm[c2[1]];
  let rule: MappedHand['rule'] = 'direct';
  if (x !== y && rm[x] === rm[y]) {
    const brank = new Set([...bset].map(rk));
    const top = rm[x];
    const cand = [...Array(13).keys()]
      .filter((z) => !brank.has(z) && z !== top)
      .sort(
        (p, q) => (p < top ? 0 : 1) - (q < top ? 0 : 1) || Math.abs(p - top) - Math.abs(q - top)
      );
    m2 = SOLVED_FLOP_RANKS[cand[0]] + sm[c2[1]];
    rule = 'split';
  }
  if (m1 === m2 || bset.has(m1) || bset.has(m2))
    throw new Error(`mapping collision ${COMBO_CARDS[h].join('')} ${a}->${b}`);
  return { index: comboIndex(m1, m2), rule };
}

// ---------------- library data ----------------

/** One node of one solved board: actions in solver order and frequencies quantised to 1/65535, row-major [hand][action]; an all-zero row = undefined hand. */
export interface SolvedFlopNodeData {
  actions: string[];
  q: Uint16Array; // length 1326 * actions.length
  rangeMean: number[]; // range-weighted mean row (last fallback), sums to 1
}
export interface SolvedFlopBoardData {
  board: string;
  nodes: Partial<Record<SolvedFlopNode, SolvedFlopNodeData>>;
}
export interface SolvedFlopLibraryData {
  tableType: string; // e.g. 'cash|6max|srp|BTN-vs-BB|80|rake0.10cap250|tree=W45-P2|acc0.001' (b4_export.TABLE_TYPE)
  weights: DistanceWeights;
  maxDistance: number;
  boards: SolvedFlopBoardData[];
}
interface IndexedEntry {
  board: string;
  f: Record<FeatureKey, number>;
  data: SolvedFlopBoardData;
}
interface IndexedLibrary extends SolvedFlopLibraryData {
  byStructure: Map<string, IndexedEntry[]>;
  bytes: number;
}

const libraries = new Map<string, IndexedLibrary>();

export function solvedFlopLibraryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SOLVED_FLOP_LIBRARY_ENABLED === '1';
}

/**
 * Library binary format v1: "SFL1" + uint32 LE header length + UTF-8 JSON header + uint16 LE payload.
 * Header: { tableType, weights, maxDistance, boards: [{ board, nodes: [{ name, actions, offset, rangeMean }] }] };
 * offset counts uint16 values from the start of the payload. Gzip is applied outside (node:zlib) when stored.
 */
export function encodeSolvedFlopLibrary(lib: SolvedFlopLibraryData): Buffer {
  const parts: Uint16Array[] = [];
  let off = 0;
  const header = {
    tableType: lib.tableType,
    weights: lib.weights,
    maxDistance: lib.maxDistance,
    boards: lib.boards.map((b) => ({
      board: b.board,
      nodes: (Object.keys(b.nodes) as SolvedFlopNode[]).map((name) => {
        const n = b.nodes[name]!;
        const e = { name, actions: n.actions, offset: off, rangeMean: n.rangeMean };
        parts.push(n.q);
        off += n.q.length;
        return e;
      }),
    })),
  };
  const hj = Buffer.from(JSON.stringify(header), 'utf8');
  const out = Buffer.alloc(8 + hj.length + off * 2);
  out.write('SFL1', 0, 'latin1');
  out.writeUInt32LE(hj.length, 4);
  hj.copy(out, 8);
  let p = 8 + hj.length;
  for (const q of parts) for (let i = 0; i < q.length; i++, p += 2) out.writeUInt16LE(q[i], p);
  return out;
}

export function decodeSolvedFlopLibrary(buf: Buffer): SolvedFlopLibraryData {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'SFL1')
    throw new Error('not a solved-flop library v1');
  const hl = buf.readUInt32LE(4);
  const header = JSON.parse(buf.toString('utf8', 8, 8 + hl)) as {
    tableType: string;
    weights: DistanceWeights;
    maxDistance: number;
    boards: Array<{
      board: string;
      nodes: Array<{
        name: SolvedFlopNode;
        actions: string[];
        offset: number;
        rangeMean: number[];
      }>;
    }>;
  };
  const base = 8 + hl;
  const boards: SolvedFlopBoardData[] = header.boards.map((b) => {
    boardCards(b.board);
    const nodes: SolvedFlopBoardData['nodes'] = {};
    for (const n of b.nodes) {
      if (!(SOLVED_FLOP_NODES as readonly string[]).includes(n.name))
        throw new Error(`unknown node ${n.name}`);
      const len = 1326 * n.actions.length;
      if (base + (n.offset + len) * 2 > buf.length)
        throw new Error(`truncated payload on ${b.board}`);
      const q = new Uint16Array(len);
      for (let i = 0; i < len; i++) q[i] = buf.readUInt16LE(base + (n.offset + i) * 2);
      nodes[n.name] = { actions: n.actions, q, rangeMean: n.rangeMean };
    }
    return { board: b.board, nodes };
  });
  return {
    tableType: header.tableType,
    weights: header.weights,
    maxDistance: header.maxDistance,
    boards,
  };
}

/** Index a library for lookups (replaces any library of the same table type). Returns its in-memory payload bytes. Throws on malformed data, so a bad file fails at load time and never inside a decision. */
export function loadSolvedFlopLibrary(lib: SolvedFlopLibraryData): number {
  if (!(typeof lib.maxDistance === 'number' && lib.maxDistance >= 0))
    throw new Error('bad maxDistance');
  const featureKeys = new Set<string>(['r0', 'r1', 'r2', 'g01', 'g12', 'nstr']);
  for (const [k, v] of Object.entries(lib.weights)) {
    if (!featureKeys.has(k) || !(typeof v === 'number' && Number.isFinite(v) && v >= 0))
      throw new Error(`bad distance weight ${k}`);
  }
  const byStructure = new Map<string, IndexedEntry[]>();
  let bytes = 0;
  const seen = new Set<string>();
  for (const b of lib.boards) {
    const st = boardStructure(b.board);
    const key = orderedBoard(b.board).join('');
    if (seen.has(key)) throw new Error(`duplicate library board ${b.board}`);
    seen.add(key);
    for (const [name, n] of Object.entries(b.nodes)) {
      if (!(SOLVED_FLOP_NODES as readonly string[]).includes(name))
        throw new Error(`unknown node ${name} on ${b.board}`);
      if (
        !n ||
        n.actions.length === 0 ||
        !(n.q instanceof Uint16Array) ||
        n.q.length !== 1326 * n.actions.length
      )
        throw new Error(`bad node payload on ${b.board}`);
      if (
        n.rangeMean.length !== n.actions.length ||
        n.rangeMean.some((v) => !(Number.isFinite(v) && v >= 0)) ||
        !(n.rangeMean.reduce((x, y) => x + y, 0) > 0)
      )
        throw new Error(`bad rangeMean on ${b.board}`);
      bytes += n.q.byteLength;
    }
    if (!byStructure.has(st)) byStructure.set(st, []);
    byStructure.get(st)!.push({ board: b.board, f: boardFeatures(b.board), data: b });
  }
  for (const list of byStructure.values())
    list.sort((x, y) => (x.board < y.board ? -1 : x.board > y.board ? 1 : 0));
  libraries.set(lib.tableType, { ...lib, byStructure, bytes });
  return bytes;
}

export function clearSolvedFlopLibraries(): void {
  libraries.clear();
}
export function solvedFlopLibraryBytes(tableType: string): number {
  return libraries.get(tableType)?.bytes ?? 0;
}

/** k nearest library boards of the same structure; ties broken by the board string (deterministic). */
export function nearestLibraryBoards(
  tableType: string,
  live: string,
  k = 1
): Array<{ board: string; distance: number }> {
  const lib = libraries.get(tableType);
  if (!lib) return [];
  const list = lib.byStructure.get(boardStructure(live));
  if (!list) return [];
  const fa = boardFeatures(live);
  const scored = list.map((e) => {
    let d = 0;
    for (const key of Object.keys(lib.weights) as FeatureKey[])
      d += (lib.weights[key] ?? 0) * Math.abs(fa[key] - e.f[key]);
    return { board: e.board, distance: d };
  });
  scored.sort(
    (x, y) => x.distance - y.distance || (x.board < y.board ? -1 : x.board > y.board ? 1 : 0)
  );
  return scored.slice(0, k);
}

export interface SolvedFlopAnswer {
  actions: string[];
  frequencies: number[];
  libraryBoard: string;
  distance: number;
  rule: 'direct' | 'split' | 'neighbour' | 'mean';
}

const NEIGHBOUR_CAP = 6;

function rowAt(n: SolvedFlopNodeData, j: number): number[] | null {
  const A = n.actions.length;
  let s = 0;
  const r: number[] = [];
  for (let i = 0; i < A; i++) {
    const v = n.q[j * A + i];
    r.push(v);
    s += v;
  }
  if (s <= 0) return null;
  return r.map((v) => v / s);
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Answer one flop decision by nearest-board lookup, or null (the caller keeps its existing path).
 * flop: the three flop cards as one string (e.g. 'Kc9h5s'); hole: the actor's two cards (e.g. ['Ah', 'Kd']).
 * Never throws: any unexpected failure inside the lookup is answered with null, so the caller's existing path decides.
 */
export function solvedFlopLookup(input: {
  tableType: string;
  flop: string;
  node: SolvedFlopNode;
  hole: readonly [string, string];
  env?: NodeJS.ProcessEnv;
}): SolvedFlopAnswer | null {
  if (!solvedFlopLibraryEnabled(input.env)) return null;
  try {
    return lookupEnabled(input);
  } catch {
    return null;
  }
}

function lookupEnabled(input: {
  tableType: string;
  flop: string;
  node: SolvedFlopNode;
  hole: readonly [string, string];
}): SolvedFlopAnswer | null {
  const lib = libraries.get(input.tableType);
  if (!lib) return null;
  const live = input.flop;
  try {
    boardCards(live);
  } catch {
    return null;
  }
  const [nn] = nearestLibraryBoards(input.tableType, live, 1);
  if (!nn || !(nn.distance <= lib.maxDistance)) return null;
  const entry = lib.byStructure.get(boardStructure(live))!.find((e) => e.board === nn.board)!;
  const node = entry.data.nodes[input.node];
  if (!node) return null;
  const liveSet = new Set(boardCards(live));
  const [h1, h2] = input.hole;
  if (h1 === h2 || liveSet.has(h1) || liveSet.has(h2) || !CIDX.has(h1 + h2)) return null;
  const mapped = mapHand(comboIndex(h1, h2), live, nn.board);
  const direct = rowAt(node, mapped.index);
  if (direct)
    return {
      actions: node.actions,
      frequencies: direct,
      libraryBoard: nn.board,
      distance: nn.distance,
      rule: mapped.rule,
    };
  // Neighbour rule: nearest defined library hand keeping each card's board-rank membership, pairedness and suits (summed rank shift <= 6).
  const [m1, m2] = COMBO_CARDS[mapped.index];
  const bset = new Set(boardCards(nn.board));
  const brank = new Set([...bset].map(rk));
  let best: { key: number[]; j: number } | null = null;
  for (let d1 = -NEIGHBOUR_CAP; d1 <= NEIGHBOUR_CAP; d1++) {
    for (let d2 = -NEIGHBOUR_CAP; d2 <= NEIGHBOUR_CAP; d2++) {
      const t = Math.abs(d1) + Math.abs(d2);
      if (t === 0 || t > NEIGHBOUR_CAP) continue;
      const r1 = rk(m1) + d1;
      const r2 = rk(m2) + d2;
      if (r1 < 0 || r1 > 12 || r2 < 0 || r2 > 12) continue;
      if (
        brank.has(r1) !== brank.has(rk(m1)) ||
        brank.has(r2) !== brank.has(rk(m2)) ||
        (r1 === r2) !== (rk(m1) === rk(m2))
      )
        continue;
      if ((brank.has(rk(m1)) && d1 !== 0) || (brank.has(rk(m2)) && d2 !== 0)) continue;
      const n1 = SOLVED_FLOP_RANKS[r1] + m1[1];
      const n2 = SOLVED_FLOP_RANKS[r2] + m2[1];
      if (n1 === n2 || bset.has(n1) || bset.has(n2)) continue;
      const j = comboIndex(n1, n2);
      if (!rowAt(node, j)) continue;
      const key = [t, Math.abs(d1), d1, d2];
      if (!best || lexLess(key, best.key)) best = { key, j };
    }
  }
  if (best)
    return {
      actions: node.actions,
      frequencies: rowAt(node, best.j)!,
      libraryBoard: nn.board,
      distance: nn.distance,
      rule: 'neighbour',
    };
  return {
    actions: node.actions,
    frequencies: [...node.rangeMean],
    libraryBoard: nn.board,
    distance: nn.distance,
    rule: 'mean',
  };
}
