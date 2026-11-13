import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COMBO_CARDS,
  boardFeatures,
  boardStructure,
  boardDistance,
  clearSolvedFlopLibraries,
  comboIndex,
  decodeSolvedFlopLibrary,
  encodeSolvedFlopLibrary,
  loadSolvedFlopLibrary,
  mapHand,
  nearestLibraryBoards,
  orderedBoard,
  rankMap,
  solvedFlopLibraryBytes,
  solvedFlopLookup,
  suitMap,
  type SolvedFlopBoardData,
  type SolvedFlopLibraryData,
} from './SolvedFlopLibrary.js';
import { solvedFlopAdviceOr } from './solvedFlopHook.js';

const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('./SolvedFlopLibrary.vectors.json', import.meta.url)), 'utf8')) as {
  weights: Record<string, number>;
  boards: Record<string, { ordered: string[]; structure: string; features: Record<string, number> }>;
  pairs: Array<{ live: string; library: string; rank_map: number[]; suit_map: Record<string, string>; mapped: Record<string, [number, string]>; distance: number | null }>;
  nearest_library: string[];
  nearest: Record<string, Array<[number, string]>>;
};
const TT = 'test|cash|6max|srp|BTN-vs-BB';
const ON = { SOLVED_FLOP_LIBRARY_ENABLED: '1' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;
const ACTS = { 'F.cbet': ['b450', 'b198', 'c'], 'F.vs_b33': ['b594', 'c', 'f'], 'F.vs_b75': ['c', 'f'], 'F.vs_xr': ['c', 'f'] } as const;

/** Synthetic board data: every hand not blocked on the board gets a distinct, recognisable row (hand index encoded in the first action). */
function syntheticBoard(board: string, undefinedHands: Set<number> = new Set()): SolvedFlopBoardData {
  const blocked = new Set(board.match(/../g)!);
  const nodes: SolvedFlopBoardData['nodes'] = {};
  for (const [name, actions] of Object.entries(ACTS) as Array<[keyof typeof ACTS, readonly string[]]>) {
    const A = actions.length;
    const q = new Uint16Array(1326 * A);
    COMBO_CARDS.forEach(([a, b], h) => {
      if (blocked.has(a) || blocked.has(b) || undefinedHands.has(h)) return;
      q[h * A] = h + 1;
      q[h * A + 1] = 65535 - (h + 1);
    });
    nodes[name] = { actions: [...actions], q, rangeMean: actions.map(() => 1 / A) };
  }
  return { board, nodes };
}
function lib(boards: SolvedFlopBoardData[], maxDistance = 1e9): SolvedFlopLibraryData {
  return { tableType: TT, weights: vectors.weights, maxDistance, boards };
}
const handOf = (row: number[]): number => Math.round(row[0] * 65535) - 1;

beforeEach(() => clearSolvedFlopLibraries());

describe('canonical hand order', () => {
  it('matches pio_upi.COMBO_CARDS', () => {
    expect(COMBO_CARDS.length).toBe(1326);
    expect(COMBO_CARDS[0]).toEqual(['2c', '2d']);
    expect(COMBO_CARDS[4]).toEqual(['2d', '2s']);
    expect(COMBO_CARDS[1325]).toEqual(['Ah', 'As']);
    expect(comboIndex('As', 'Ah')).toBe(1325);
  });
});

describe('pinned vectors from the planner implementation (b4_lib.py)', () => {
  it('board order, structure and features', () => {
    for (const [b, v] of Object.entries(vectors.boards)) {
      expect(orderedBoard(b)).toEqual(v.ordered);
      expect(boardStructure(b)).toBe(v.structure);
      expect(boardFeatures(b)).toEqual(v.features);
    }
  });
  it('rank map, suit map, mapped hands and distance', () => {
    let n = 0;
    for (const p of vectors.pairs) {
      expect(rankMap(p.live, p.library)).toEqual(p.rank_map);
      expect(suitMap(p.live, p.library)).toEqual(p.suit_map);
      for (const [h, [j, rule]] of Object.entries(p.mapped)) {
        expect(mapHand(Number(h), p.live, p.library)).toEqual({ index: j, rule });
        n++;
      }
      const d = boardDistance(p.live, p.library, vectors.weights);
      if (p.distance === null) expect(d).toBe(Number.POSITIVE_INFINITY);
      else expect(d).toBeCloseTo(p.distance, 9);
    }
    expect(n).toBeGreaterThan(500);
  });
  it('nearest-board choice', () => {
    loadSolvedFlopLibrary(lib(vectors.nearest_library.map((b) => syntheticBoard(b))));
    for (const [live, want] of Object.entries(vectors.nearest)) {
      const got = nearestLibraryBoards(TT, live, 3);
      expect(got.map((g) => g.board)).toEqual(want.map((w) => w[1]));
      got.forEach((g, i) => expect(g.distance).toBeCloseTo(want[i][0], 6));
    }
  });
});

describe('suit-isomorphic boards map exactly', () => {
  const cases: Array<[string, string, Record<string, string>]> = [
    ['Qc6h5s', 'Qd6s5h', { c: 'd', h: 's', s: 'h', d: 'c' }],
    ['Jh8h4c', 'Js8s4d', { h: 's', c: 'd', d: 'c', s: 'h' }],
    ['Ks7s2s', 'Kd7d2d', { s: 'd', c: 'c', d: 'h', h: 's' }],
    ['KhKd2h', 'KsKc2s', { h: 's', d: 'c', c: 'd', s: 'h' }],
  ];
  it.each(cases)('%s -> %s', (a, b, perm) => {
    expect(boardDistance(a, b, vectors.weights)).toBe(0);
    expect(rankMap(a, b)).toEqual([...Array(13).keys()]);
    const sm = suitMap(a, b);
    const blocked = new Set(a.match(/../g)!);
    const libOnly = (a.match(/../g)!.every((c) => sm[c[1]] !== undefined));
    expect(libOnly).toBe(true);
    for (let h = 0; h < 1326; h++) {
      const [c1, c2] = COMBO_CARDS[h];
      if (blocked.has(c1) || blocked.has(c2)) continue;
      const m = mapHand(h, a, b);
      expect(m.rule).toBe('direct');
      // the image is the same hand with suits permuted by the board isomorphism
      const img = new Set(COMBO_CARDS[m.index]);
      expect(img.has(c1[0] + sm[c1[1]]) && img.has(c2[0] + sm[c2[1]])).toBe(true);
    }
    // every board card of a maps to the corresponding board card of b, so suit pattern positions agree
    for (const c of a.match(/../g)!) expect(b.includes(c[0] + sm[c[1]])).toBe(true);
    void perm;
  });
  it('lookup on an isomorphic board returns the library row of the isomorphic hand', () => {
    loadSolvedFlopLibrary(lib([syntheticBoard('Qd6s5h')]));
    const ans = solvedFlopLookup({ tableType: TT, flop: 'Qc6h5s', node: 'F.cbet', hole: ['Ah', 'Kc'], env: ON })!;
    expect(ans.distance).toBe(0);
    expect(ans.rule).toBe('direct');
    expect(ans.libraryBoard).toBe('Qd6s5h');
    expect(handOf(ans.frequencies)).toBe(comboIndex('As', 'Kd'));
    expect(ans.actions).toEqual(['b450', 'b198', 'c']);
    expect(ans.frequencies.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });
});

describe('distance choice', () => {
  it('never crosses structure (pair type or positional suit pattern)', () => {
    expect(boardDistance('Qc6h5s', 'Qc6c5s', vectors.weights)).toBe(Number.POSITIVE_INFINITY);
    expect(boardDistance('Qc6c5s', 'Qc6h5c', vectors.weights)).toBe(Number.POSITIVE_INFINITY);
    expect(boardDistance('KhKd2h', 'Kh2d2h', vectors.weights)).toBe(Number.POSITIVE_INFINITY);
    loadSolvedFlopLibrary(lib([syntheticBoard('Qc6c5s'), syntheticBoard('Kc9h5s')]));
    expect(nearestLibraryBoards(TT, 'Qd6h5d', 1)).toEqual([]); // t02: no same-structure board
    expect(nearestLibraryBoards(TT, 'Kd9h4s', 1)[0].board).toBe('Kc9h5s');
  });
  it('prefers the nearer board and breaks ties by board string', () => {
    loadSolvedFlopLibrary(lib([syntheticBoard('Kc9h5s'), syntheticBoard('Qc6h5s'), syntheticBoard('Kc9h4s')]));
    const r = nearestLibraryBoards(TT, 'Kd9s5h', 3);
    expect(r[0]).toEqual({ board: 'Kc9h5s', distance: 0 });
    expect(r[1].distance).toBeGreaterThan(0);
    expect(r[1].distance).toBeLessThan(r[2].distance);
  });
});

describe('dormant by default; falls back to the existing path', () => {
  it('flag off: null even with a library loaded', () => {
    loadSolvedFlopLibrary(lib([syntheticBoard('Kc9h5s')]));
    expect(solvedFlopLookup({ tableType: TT, flop: 'Kc9h5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: OFF })).toBeNull();
    expect(solvedFlopLookup({ tableType: TT, flop: 'Kc9h5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: { SOLVED_FLOP_LIBRARY_ENABLED: 'true' } })).toBeNull();
  });
  it('flag on but no library, other table type, out of distance, or no same structure: null', () => {
    expect(solvedFlopLookup({ tableType: TT, flop: 'Kc9h5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON })).toBeNull();
    loadSolvedFlopLibrary(lib([syntheticBoard('Kc9h5s')], 10));
    expect(solvedFlopLookup({ tableType: 'other', flop: 'Kc9h5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON })).toBeNull();
    expect(solvedFlopLookup({ tableType: TT, flop: '4c3h2s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON })).toBeNull();
    expect(solvedFlopLookup({ tableType: TT, flop: 'Kc9c5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON })).toBeNull();
    expect(solvedFlopLookup({ tableType: TT, flop: 'Kc9h5s', node: 'F.cbet', hole: ['Kc', 'Ad'], env: ON })).toBeNull(); // blocked hole card
    expect(solvedFlopLookup({ tableType: TT, flop: 'Kc9h5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON })).not.toBeNull();
  });
  it('the hook returns the existing path untouched when the lookup does not answer', () => {
    const existing = { source: 'existing' };
    let calls = 0;
    const out = solvedFlopAdviceOr({ tableType: TT, flop: 'Kc9h5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: OFF }, () => {
      calls++;
      return existing;
    });
    expect(out).toBe(existing);
    expect(calls).toBe(1);
  });
  it('the hook serves the lookup only when it answers', () => {
    loadSolvedFlopLibrary(lib([syntheticBoard('Kc9h5s')]));
    let calls = 0;
    const out = solvedFlopAdviceOr({ tableType: TT, flop: 'Kc9h5s', node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON }, () => {
      calls++;
      return null;
    });
    expect(calls).toBe(0);
    expect(out).toMatchObject({ source: 'solved_flop_library', libraryBoard: 'Kc9h5s' });
  });
});

describe('undefined rows: neighbour then range mean', () => {
  it('uses the nearest defined hand, else the range-weighted mean row', () => {
    const live = 'Kc9h5s';
    const target = comboIndex('Ah', 'Ad');
    loadSolvedFlopLibrary(lib([syntheticBoard(live, new Set([target]))]));
    const a = solvedFlopLookup({ tableType: TT, flop: live, node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON })!;
    expect(a.rule).toBe('neighbour');
    expect(COMBO_CARDS[handOf(a.frequencies)].map((c) => c[0])).toEqual(['Q', 'Q']); // AA -> nearest defined pair below, same suits
    clearSolvedFlopLibraries();
    const all = new Set([...Array(1326).keys()]);
    loadSolvedFlopLibrary(lib([syntheticBoard(live, all)]));
    const b = solvedFlopLookup({ tableType: TT, flop: live, node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON })!;
    expect(b.rule).toBe('mean');
    expect(b.frequencies).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });
});

describe('format, cost and memory budget', () => {
  it('encode/decode round trip is exact', () => {
    const data = lib([syntheticBoard('Kc9h5s'), syntheticBoard('QhQd2h')]);
    const back = decodeSolvedFlopLibrary(encodeSolvedFlopLibrary(data));
    expect(back.tableType).toBe(TT);
    expect(back.boards.map((b) => b.board)).toEqual(['Kc9h5s', 'QhQd2h']);
    expect(Array.from(back.boards[1].nodes['F.vs_b33']!.q)).toEqual(Array.from(data.boards[1].nodes['F.vs_b33']!.q));
    expect(() => decodeSolvedFlopLibrary(Buffer.from('nope'))).toThrow();
  });
  it('payload is 26,520 bytes per board (four nodes, ten actions); all 1,755 classes fit a 64 MB budget', () => {
    const bytes = loadSolvedFlopLibrary(lib([syntheticBoard('Kc9h5s'), syntheticBoard('Qc6h5s')]));
    expect(bytes).toBe(2 * 1326 * 10 * 2);
    expect(solvedFlopLibraryBytes(TT)).toBe(bytes);
    expect((1755 * bytes) / 2).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
  it('a lookup is synchronous and the module does no I/O', () => {
    loadSolvedFlopLibrary(lib([syntheticBoard('Kc9h5s')]));
    const r = solvedFlopLookup({ tableType: TT, flop: 'Kd9s4h', node: 'F.vs_xr', hole: ['Ah', 'Ad'], env: ON });
    expect(r).not.toBeInstanceOf(Promise);
    const src = readFileSync(fileURLToPath(new URL('./SolvedFlopLibrary.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/\bawait\b|\bfetch\(|supabase|node:fs|readFileSync/);
  });
  it('a lookup against a 286-board structure (every rainbow unpaired rank set) averages under 5 ms', () => {
    const ranks = '23456789TJQKA';
    const boards: SolvedFlopBoardData[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 13 && boards.length < 286; i++)
      for (let j = 0; j < i; j++)
        for (let k = 0; k < j; k++) {
          const b = `${ranks[i]}c${ranks[j]}h${ranks[k]}s`;
          if (!seen.has(b)) {
            seen.add(b);
            boards.push(syntheticBoard(b));
          }
        }
    loadSolvedFlopLibrary(lib(boards));
    const t0 = performance.now();
    for (let n = 0; n < 200; n++) solvedFlopLookup({ tableType: TT, flop: 'Kd8s4h', node: 'F.cbet', hole: ['Ah', 'Ad'], env: ON });
    expect((performance.now() - t0) / 200).toBeLessThan(5);
  });
});
