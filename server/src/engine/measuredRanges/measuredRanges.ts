/**
 * Measured opponent ranges and responses for PLO4/PLO5 cash (table + Lightning).
 * PUBLIC INFORMATION ONLY (lead decision 8:15 PM Chicago Nov 19): every table is
 * provenance public_actions (action log) or showdown_only (action log + hole cards
 * the showdown revealed). No mucked or non-showdown hole card feeds this file.
 * Lane RANGES, emergency 2026-11-19. Data: every PLO4/PLO5 cash hand with a person,
 * Nov 1 to Nov 19 6:49 PM Chicago (read-only pull), aggregated buckets only.
 *
 * - classifyOmahaHolding(hole, board): the exact bucket the tables were built with
 *   (Omaha: exactly 2 hole + 3 board). A sampler can draw a holding and accept or
 *   reject it against a measured cell's class mix.
 * - lookupRange / lookupResponse / lookupRealization: back off from the most
 *   specific key to pooled keys until n >= minN. Never throws; returns null when
 *   nothing qualifies, so a caller always has a fallback path.
 * - personFoldRate: per-person fold rate facing a bet, shrunk toward population:
 *   (k + 20 * pop) / (n + 20).
 */
export type Street = 'flop' | 'turn' | 'river';
export type Line =
  | 'cbet'
  | 'barrel'
  | 'stab'
  | 'probe'
  | 'donk'
  | 'raise'
  | 'check_raise'
  | 'jam'
  | 'all';
export type Band = 'small' | 'half' | 'twothirds' | 'pot' | 'allin' | 'all';
export type MadeClass =
  | 'quads_sf'
  | 'full_house'
  | 'nut_flush'
  | 'flush'
  | 'nut_straight'
  | 'straight'
  | 'set'
  | 'trips'
  | 'two_pair'
  | 'top_pair_plus'
  | 'weak_pair'
  | 'high';
export type DrawClass = 'combo' | 'nfd' | 'fd' | 'wrap' | 'oesd' | 'gut' | 'none';
export type Tier =
  | 'nutted'
  | 'strong'
  | 'medium'
  | 'medium_draw'
  | 'strong_draw'
  | 'draw'
  | 'weak'
  | 'air';
export type Provenance = 'public_actions' | 'showdown_only';
/** Estimated bettor range for one spot (estimator: ESTIMATOR-DECLARATION.txt). */
export interface RangeCell {
  provenance: 'showdown_only';
  provenanceNote?: string;
  n: number;
  nCalled: number;
  nShown: number;
  nGaveUp: number;
  nWonUnshown: number;
  /** Non-value share among shown hands only (naive). */
  shownNonValue: number;
  /** Declared selection-corrected estimate and its 95% interval. */
  nonValueShare: number;
  nonValueCI95: [number, number];
  tierShare: Partial<Record<Tier, number>>;
  shownTiers: Partial<Record<Tier, number>>;
}
export interface ResponseCell {
  provenance: 'public_actions';
  provenanceNote?: string;
  n: number;
  fold: number;
  call: number;
  raise: number;
  foldCI95: [number | null, number | null];
}
export interface RealizationCell {
  n: number;
  meanEquityAtCall: number;
  meanPotShareWon: number;
  realization: number | null;
}
export interface PersonFacing {
  n: number;
  fold: number;
  call: number;
  raise: number;
  popFold: number | null;
  foldShrunk: number | null;
}
export interface PersonRow {
  provenance?: 'public_actions';
  betOpportunities?: Record<string, Record<string, number>>;
  name: string | null;
  nPostflopBets: number;
  nFacingBets: number;
  nPreflopActions: number;
  betsByStreetLineBand: Record<string, number>;
  facing: Record<string, PersonFacing>;
  preflop: Record<string, Record<string, number>>;
}
export interface MeasuredRanges {
  version: string;
  generatedChicago: string;
  definitions: Record<string, string>;
  ranges: Record<string, RangeCell>;
  responses: Record<string, ResponseCell>;
  /** Not shipped in the public table (it needs unshown cards); kept for API stability. */
  realization?: Record<string, RealizationCell>;
  preflop: Record<string, Record<string, number | string>>;
  betFrequency?: Record<
    string,
    {
      provenance: 'public_actions';
      n: number;
      betRate: number;
      betBands: Partial<Record<Band | 'na', number>>;
    }
  >;
  persons: Record<string, PersonRow>;
  vpip?: Record<string, { hands: number; vpip: number; pfr: number }>;
  preflopFacingRaise?: Record<string, { n: number; fold: number; call: number; raise: number }>;
}
export interface SpotKey {
  game: 'plo4' | 'plo5';
  mode: 'table' | 'lightning';
  street: Street;
  line: Line;
  band: Band;
  players: 'hu' | 'mw';
  opp: 'horse_present' | 'persons_only' | 'any';
  bettor: 'person' | 'horse';
}
export const VALUE_CLASSES: ReadonlySet<MadeClass> = new Set<MadeClass>([
  'quads_sf',
  'full_house',
  'nut_flush',
  'flush',
  'nut_straight',
  'straight',
  'set',
  'trips',
  'two_pair',
  'top_pair_plus',
]);
export const SHRINK_M = 20;

/** Band of a wager: bet = added/pot; raise = (added - toCall)/(pot + toCall). */
export function sizeBand(fraction: number, allIn: boolean): Band {
  if (allIn) return 'allin';
  return fraction <= 0.4
    ? 'small'
    : fraction <= 0.6
      ? 'half'
      : fraction <= 0.8
        ? 'twothirds'
        : 'pot';
}

// Back-off order: drop opp, then mode, then band, then game, then line, then players.
function* backoff(k: SpotKey): Generator<string> {
  const opps = k.opp === 'any' ? ['any'] : [k.opp, 'any'];
  const modes = [k.mode, 'all'];
  const bands = k.band === 'all' ? ['all'] : [k.band, 'all'];
  const games = [k.game, 'pooled'];
  const lines = k.line === 'all' ? ['all'] : [k.line, 'all'];
  const players = [k.players, 'all'];
  for (const pl of players)
    for (const ln of lines)
      for (const g of games)
        for (const b of bands)
          for (const m of modes)
            for (const o of opps) yield [g, m, k.street, ln, b, pl, o].join('|');
}
/** minShown: the fewest shown hands a cell needs (its composition rests on them). */
export function lookupRange(
  t: MeasuredRanges,
  k: SpotKey,
  minShown = 20
): { key: string; cell: RangeCell } | null {
  try {
    for (const base of backoff(k)) {
      const cell = t.ranges[`${base}|${k.bettor}`];
      if (cell && cell.nShown >= minShown) return { key: `${base}|${k.bettor}`, cell };
    }
  } catch {
    /* never throw into a decision */
  }
  return null;
}
export function lookupResponse(
  t: MeasuredRanges,
  k: SpotKey,
  responder: 'person' | 'horse',
  minN = 30
): { key: string; cell: ResponseCell } | null {
  try {
    for (const base of backoff(k)) {
      const key = `${base}|${k.bettor}|${responder}`;
      const cell = t.responses[key];
      if (cell && cell.n >= minN) return { key, cell };
    }
  } catch {
    /* never throw */
  }
  return null;
}
export function lookupRealization(
  t: MeasuredRanges,
  k: Pick<SpotKey, 'game' | 'mode' | 'street' | 'players'>,
  caller: 'person' | 'horse',
  vsBettor: 'person' | 'horse',
  minN = 30
): { key: string; cell: RealizationCell } | null {
  try {
    for (const pl of [k.players, 'all'])
      for (const g of [k.game, 'pooled'])
        for (const m of [k.mode, 'all']) {
          const key = [g, m, k.street, pl, caller, `vs_${vsBettor}`].join('|');
          const cell = t.realization?.[key];
          if (cell && cell.n >= minN && cell.realization !== null) return { key, cell };
        }
  } catch {
    /* never throw */
  }
  return null;
}
/** Person's fold rate facing a bet by `bettor`, shrunk toward the population cell. */
export function personFoldRate(
  t: MeasuredRanges,
  userId: string,
  k: Pick<SpotKey, 'game' | 'street' | 'band' | 'players' | 'bettor'>,
  populationFold: number
): { rate: number; n: number; source: 'person_shrunk' | 'population' } {
  const row = t.persons?.[userId];
  const cell = row?.facing?.[[k.game, k.street, k.band, k.players, `vs_${k.bettor}`].join('|')];
  if (!cell || cell.n <= 0) return { rate: populationFold, n: 0, source: 'population' };
  return {
    rate: (cell.fold + SHRINK_M * populationFold) / (cell.n + SHRINK_M),
    n: cell.n,
    source: 'person_shrunk',
  };
}

// ---------- classifier (twin of the Python extractor's classify/tier) ----------
type C = { r: number; s: string };
const RV: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};
function card(c: { rank: string; suit: string }): C {
  return { r: RV[String(c.rank).toUpperCase()], s: String(c.suit)[0].toLowerCase() };
}
function straightHi(rs: number[]): number {
  const s = new Set(rs);
  if (s.has(14)) s.add(1);
  for (let h = 14; h >= 5; h--) {
    let ok = true;
    for (let i = 0; i < 5; i++)
      if (!s.has(h - i)) {
        ok = false;
        break;
      }
    if (ok) return h;
  }
  return 0;
}
function eval5(c: C[]): number[] {
  const rs = c.map((x) => x.r).sort((a, b) => b - a);
  const fl = new Set(c.map((x) => x.s)).size === 1;
  const cnt = new Map<number, number>();
  for (const r of rs) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  const grp = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const sh = cnt.size === 5 ? straightHi(rs) : 0;
  if (sh && fl) return [8, sh];
  if (grp[0][1] === 4) return [7, grp[0][0], grp[1][0]];
  if (grp[0][1] === 3 && grp[1][1] === 2) return [6, grp[0][0], grp[1][0]];
  if (fl) return [5, ...rs];
  if (sh) return [4, sh];
  if (grp[0][1] === 3) return [3, ...grp.map((g) => g[0])];
  if (grp[0][1] === 2 && grp[1][1] === 2) return [2, ...grp.map((g) => g[0])];
  if (grp[0][1] === 2) return [1, ...grp.map((g) => g[0])];
  return [0, ...rs];
}
function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}
function combos<T>(a: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (i: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let j = i; j < a.length; j++) {
      acc.push(a[j]);
      rec(j + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}
export function classifyOmahaHolding(
  holeCards: ReadonlyArray<{ rank: string; suit: string }>,
  boardCards: ReadonlyArray<{ rank: string; suit: string }>
): { made: MadeClass; draw: DrawClass; tier: Tier; value: boolean } {
  const hole = holeCards.map(card);
  const board = boardCards.map(card);
  let v: number[] | null = null;
  let h2: C[] = [];
  let b3: C[] = [];
  for (const hh of combos(hole, 2))
    for (const bb of combos(board, 3)) {
      const e = eval5([...hh, ...bb]);
      if (!v || cmp(e, v) > 0) {
        v = e;
        h2 = hh;
        b3 = bb;
      }
    }
  const cat = v![0];
  const brs = board.map((x) => x.r);
  const top = Math.max(...brs);
  const bcnt = new Map<number, number>();
  for (const r of brs) bcnt.set(r, (bcnt.get(r) ?? 0) + 1);
  let made: MadeClass;
  if (cat >= 7) made = 'quads_sf';
  else if (cat === 6) made = 'full_house';
  else if (cat === 5) {
    const s = h2[0].s;
    const seen = new Set(board.filter((x) => x.s === s).map((x) => x.r));
    let hi = 14;
    while (seen.has(hi)) hi--;
    made = hole.some((x) => x.r === hi && x.s === s) ? 'nut_flush' : 'flush';
  } else if (cat === 4) {
    let mx = 0;
    for (const b of combos(brs, 3))
      for (let a = 2; a <= 14; a++)
        for (let c = a; c <= 14; c++) {
          const rs = [...b, a, c];
          if (new Set(rs).size === 5) mx = Math.max(mx, straightHi(rs));
        }
    made = v![1] >= mx ? 'nut_straight' : 'straight';
  } else if (cat === 3) {
    const t = v![1];
    made = hole.filter((x) => x.r === t).length >= 2 && bcnt.get(t) === 1 ? 'set' : 'trips';
  } else {
    const all = new Map<number, number>();
    for (const x of [...h2, ...b3]) all.set(x.r, (all.get(x.r) ?? 0) + 1);
    const pairs = [...all.entries()].filter(([, c]) => c >= 2).map(([r]) => r);
    const hp = pairs.filter((r) => (bcnt.get(r) ?? 0) < 2);
    if (cat === 2 && hp.length >= 2) made = 'two_pair';
    else if (hp.length) made = Math.max(...hp) >= top ? 'top_pair_plus' : 'weak_pair';
    else made = 'high';
  }
  let draw: DrawClass = 'none';
  if (board.length < 5 && cat < 5) {
    let fd = false;
    let nfd = false;
    for (const s of ['s', 'h', 'd', 'c']) {
      const bs = board.filter((x) => x.s === s);
      const hs = hole.filter((x) => x.s === s);
      if (bs.length === 2 && hs.length >= 2) {
        fd = true;
        const seen = new Set(bs.map((x) => x.r));
        let hi = 14;
        while (seen.has(hi)) hi--;
        if (hs.some((x) => x.r === hi)) nfd = true;
      }
    }
    let sd = 0;
    if (cat < 4) {
      const hrs = hole.map((x) => x.r);
      for (let r = 2; r <= 14; r++) {
        const nb = [...brs, r];
        let ok = false;
        // the new card (last index) must be among the three board cards used
        const idx = nb.map((_, i) => i);
        outer: for (const [a, c] of combos(hrs, 2))
          for (const bi of combos(idx, 3)) {
            if (!bi.includes(nb.length - 1) && !bi.some((i) => nb[i] === r)) continue;
            const rs = [a, c, ...bi.map((i) => nb[i])];
            if (new Set(rs).size === 5 && straightHi(rs)) {
              ok = true;
              break outer;
            }
          }
        if (ok) sd++;
      }
    }
    draw =
      fd && sd >= 2
        ? 'combo'
        : nfd
          ? 'nfd'
          : fd
            ? 'fd'
            : sd >= 3
              ? 'wrap'
              : sd === 2
                ? 'oesd'
                : sd === 1
                  ? 'gut'
                  : 'none';
  }
  const tier: Tier =
    made === 'quads_sf' || made === 'full_house' || made === 'nut_flush' || made === 'nut_straight'
      ? 'nutted'
      : made === 'flush' || made === 'straight' || made === 'set' || made === 'trips'
        ? 'strong'
        : made === 'two_pair' || made === 'top_pair_plus'
          ? draw === 'none' || draw === 'gut'
            ? 'medium'
            : 'medium_draw'
          : draw === 'combo' || draw === 'nfd' || draw === 'wrap'
            ? 'strong_draw'
            : draw === 'fd' || draw === 'oesd'
              ? 'draw'
              : made === 'weak_pair'
                ? 'weak'
                : 'air';
  return { made, draw, tier, value: VALUE_CLASSES.has(made) };
}
