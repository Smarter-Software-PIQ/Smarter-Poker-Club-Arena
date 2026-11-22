/**
 * omahaMathCore PREFLOP opponent model (lane PREFLOP-EV, lead session_01TLQer8, Nov 19 2026).
 *
 * Supplies the core's preflop EV loop (OmahaMathCore.ts decideOmahaMathCore) with, for PLO4/PLO5/PLO6
 * cash (table and Lightning share this one path), 2-9 handed:
 *   - rangeOf: each live opponent's range = a BAND of the pool's strength order (top-x%), where every
 *     x comes from PUBLIC action frequencies of the nodes he passed through this hand
 *     (open = raise share unopened at his position; limp = the band between his raise share and his
 *     raise+limp share; call of a raise = the band below his re-raise share; 3/4/5-bet = re-raise share
 *     inside his previous band).
 *   - foldOf: measured fold rate facing a raise at THIS size band (b50 <= 0.6 pot, b75 <= 0.85, pot,
 *     all-in), by level (open / iso over limps / 3-bet / 4-bet+), the responder's prior action (fresh /
 *     limped / called / raised), heads-up vs multiway, mode, game, with an explicit back-off chain.
 *     Also returns the measured re-raise share.
 *   IDENTITY-FREE (lane CORE-POOLED, owner 9:52 AM Nov 20): preflopTables.v2-pooled.json pools EVERY
 *   player (no person/Horse field, no vs-kind field, no per-user rows); the same cell answers for every
 *   opponent (OmahaMathCoreIdentityFree.law.test.ts).
 *   - continueOf: the strongest (1 - fold) share of his range.
 *   - realization: measured preflop realization of the Horse's equity by mode x IP/OOP x players at
 *     the flop x SPR (empirical-Bayes shrunk). All-in = 1 (no later decision).
 *
 * PROVENANCE (lead decision ~8:15 PM Chicago: public information only): the frequency table is built
 * from public preflop actions only (no hole cards). The realization table divides chips won by the
 * equity of the Horse's OWN cards against opponents' public-frequency bands; no opponent hole card is
 * read. Both tables carry a provenance block; a law test asserts it.
 *
 * No categorical gate, chart or random term: every number in a decision is a table cell
 * named in the source string with its key and n, or a combinatoric of the cards. Pure and total:
 * never throws (a missing cell means "no measurement": full band / no fold credit, said in the source).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullRange, topOf, type Pool, type RangeSpec } from './OmahaMathCoreEquity.js';
import type { CoreOpponent, CoreState } from './OmahaMathCore.js';

// The table is read from the source tree at load, not imported: the engine image is compiled by
// tsconfig.emit.json (noResolve, explicit files) under a 1 GB heap, where importing these tables is either not
// emitted (the file is missing from dist and the import fails at boot) or exhausts the compiler's heap. The
// image holds src/ beside dist/ (Dockerfile COPY src/; the hashed policy sources are read the same way), so
// the server root is three levels above this module in both trees. Where the module's own URL is not a file
// URL (the root test suite runs under happy-dom), the table is found from the working directory: the server
// root, or the repository root above it.
function omahaMathCoreTable(name: string): unknown {
  const at = `src/engine/omahaMathCore/${name}`;
  const here = String(import.meta.url);
  const candidates = [
    ...(here.startsWith('file:') ? [fileURLToPath(new URL(`../../../${at}`, here).href)] : []),
    join(process.cwd(), at),
    join(process.cwd(), 'server', at),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      `omahaMathCore: table ${name} is not beside the engine (${candidates.join(', ')})`
    );
  return JSON.parse(readFileSync(found, 'utf8'));
}
const pfTablesJson: unknown = omahaMathCoreTable('preflopTables.v2-pooled.json');
const pfRealJson: unknown = omahaMathCoreTable('preflopRealization.v2-pooled.json');
const pfStrengthJson: unknown = omahaMathCoreTable('preflopStrength.v1.json');

export const PREFLOP_MODEL_VERSION = 'preflop-ev-model-v1';
const MIN_N = 30;

type Freq = { n: number; fold: number; call: number; raise: number };
interface PfTables {
  version: string;
  provenance: Record<string, unknown>;
  resp: Record<string, Freq>;
  unopened: Record<string, Freq>;
  facing: Record<string, Freq>;
}
interface PfReal {
  version: string;
  provenance: Record<string, unknown>;
  shrunk: Record<string, { r: number; path: string }>;
}
export const PF_TABLES = pfTablesJson as unknown as PfTables;
export const PF_REAL = pfRealJson as unknown as PfReal;
interface PfStrength {
  version: string;
  provenance: string;
  games: Record<
    string,
    { T: number[]; D: number[]; n: number; holdoutR2: number; holdoutSpearman: number }
  >;
}
export const PF_STRENGTH = pfStrengthJson as unknown as PfStrength;
/** Owner order 8:26 PM Chicago: the preflop component serves PLO4 and PLO5 only. */
export const PREFLOP_GAMES: readonly string[] = ['plo4', 'plo5'];

/**
 * Preflop strength of a holding = its equity against one random holding of the same size, from an
 * additive two-card model (Omaha plays exactly two hole cards): sum over the C(n,2) hole-card pairs of
 * T[high][low][suited] plus rank-multiplicity and suit-overload terms, least-squares fit offline to
 * Monte Carlo equity of random holdings (holdout R2 0.87 PLO4 / 0.83 PLO5, near the 600-sample noise
 * ceiling). A strength ORDER for top-x% ranges, never a gate. Cards: rank = c >> 2, suit = c & 3.
 */
export function preflopStrength(game: string, cards: ArrayLike<number>): number | null {
  const m = PF_STRENGTH.games?.[game];
  if (!m) return null;
  let v = 0;
  const rc = new Array(13).fill(0);
  const sc = [0, 0, 0, 0];
  for (let i = 0; i < cards.length; i++) {
    const a = cards[i];
    rc[a >> 2]++;
    sc[a & 3]++;
    for (let j = i + 1; j < cards.length; j++) {
      const b = cards[j];
      const ra = a >> 2;
      const rb = b >> 2;
      const hi = ra > rb ? ra : rb;
      const lo = ra > rb ? rb : ra;
      v += m.T[(hi * 13 + lo) * 2 + ((a & 3) === (b & 3) ? 1 : 0)];
    }
  }
  let pairs = 0;
  let trips = 0;
  let quads = 0;
  for (const k of rc) {
    if (k === 2) pairs++;
    else if (k === 3) trips++;
    else if (k >= 4) quads++;
  }
  const ms = Math.max(...sc);
  const s2 = sc.filter((k) => k === 2).length;
  const s3 = sc.filter((k) => k >= 3).length;
  const D = m.D;
  v +=
    D[0] * pairs +
    D[1] * trips +
    D[2] * quads +
    (ms === 3 ? D[3] : 0) +
    (ms === 4 ? D[4] : 0) +
    (ms >= 5 ? D[5] : 0) +
    D[6] * s2 +
    D[7] * s3 +
    D[8];
  return v;
}

/** Re-rank a preflop pool by preflopStrength (replaces the few-runout percentile order, which is mostly noise preflop). */
export function reorderPoolPreflop(pool: Pool, game: string): boolean {
  if (!PF_STRENGTH.games?.[game]) return false;
  const hc = pool.holeCount;
  const st = new Float64Array(pool.size);
  for (let i = 0; i < pool.size; i++) {
    const v = preflopStrength(game, pool.cards.subarray(i * hc, i * hc + hc));
    if (v === null || !Number.isFinite(v)) return false;
    st[i] = v;
  }
  pool.strength.set(st);
  const order = Array.from({ length: pool.size }, (_, i) => i).sort(
    (x, y) => st[y] - st[x] || x - y
  );
  pool.order.set(order);
  return true;
}

/** One public preflop action this hand (optional on CoreState; the model falls back to preflopLevel without it). */
export interface PreflopPublicAction {
  seat: number;
  action: 'fold' | 'check' | 'call' | 'raise';
  /** raises before this action (0 unopened) */
  level: number;
  /** limpers before this action (level 0 only) */
  limpers: number;
  position: string | null;
}
type StateWithActions = CoreState & { preflopActions?: PreflopPublicAction[] };

export type HeroRaiseLevel = 'open' | '3bet' | '4bet+';
export interface FoldResult {
  p: number;
  /** measured re-raise share of the same cell (not used as fold credit) */
  reraise: number;
  source: string;
}
export interface PreflopOpponentModel {
  rangeOf: Map<number, RangeSpec>;
  foldOf: (o: CoreOpponent, level: HeroRaiseLevel, toSize: number) => FoldResult;
  continueOf: (
    o: CoreOpponent,
    level: HeroRaiseLevel,
    toSize: number,
    range: RangeSpec
  ) => RangeSpec;
  realization: { value: number; source: string };
  /** realization for a specific line (pot after the action, effective stack behind, players to the flop) */
  realizationFor: (
    potAfter: number,
    effBehind: number,
    players: number,
    allIn: boolean
  ) => { value: number; source: string };
  bands: Map<number, { lo: number; hi: number; source: string }>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

function firstCell(tab: Record<string, Freq>, keys: string[]): { c: Freq; key: string } | null {
  for (const key of keys) {
    const c = tab[key];
    if (c && c.n >= MIN_N && Number.isFinite(c.fold)) return { c, key };
  }
  return null;
}
function gamesOf(g: string): string[] {
  return [g, 'pooled'];
}
function modesOf(m: string): string[] {
  return [m, 'all'];
}

/** Public frequency cell of a preflop node at a position (level 0: unopened/limped; else facing level). */
export function nodeFreq(k: {
  game: string;
  mode: string;
  position: string | null;
  level: number;
  limped: boolean;
}): { c: Freq; key: string } | null {
  const keys: string[] = [];
  const pos = k.position ?? 'all';
  for (const p of [pos, 'all'])
    for (const g of gamesOf(k.game))
      for (const m of modesOf(k.mode)) {
        if (k.level === 0) keys.push(`${g}|${m}|${p}|${k.limped ? 'limped' : 'unopened'}`);
        else
          keys.push(
            `${g}|${m}|${p}|${k.level === 1 ? 'facing_open' : k.level === 2 ? 'facing_3bet' : 'facing_4bet+'}`
          );
      }
  return firstCell(k.level === 0 ? PF_TABLES.unopened : PF_TABLES.facing, keys);
}

/** Band [lo, hi) of the strength order an opponent's public line leaves him (0 = strongest). */
export function bandOf(
  state: CoreState,
  o: CoreOpponent
): { lo: number; hi: number; source: string } {
  const acts = (state as StateWithActions).preflopActions?.filter((a) => a.seat === o.seat) ?? null;
  const steps: { level: number; limped: boolean; action: PreflopPublicAction['action'] }[] = [];
  if (acts && acts.length) {
    for (const a of acts) steps.push({ level: a.level, limped: a.limpers > 0, action: a.action });
  } else {
    // fallback from the coarse level the core carries
    const L = o.preflopLevel;
    if (L === 'open') steps.push({ level: 0, limped: false, action: 'raise' });
    else if (L === '3bet') steps.push({ level: 1, limped: false, action: 'raise' });
    else if (L === '4bet')
      steps.push(
        { level: 0, limped: false, action: 'raise' },
        { level: 2, limped: false, action: 'raise' }
      );
    else if (L === '5bet+')
      steps.push(
        { level: 1, limped: false, action: 'raise' },
        { level: 3, limped: false, action: 'raise' }
      );
    else if (L === 'call')
      steps.push({
        level: Math.min(state.preflopRaises, 3),
        limped: false,
        action: o.position === 'BB' && state.preflopRaises === 0 ? 'check' : 'call',
      });
  }
  let lo = 0;
  let hi = 1;
  const src: string[] = [];
  for (const s of steps) {
    if (s.action === 'fold') continue;
    const cell = nodeFreq({
      game: state.variant,
      mode: state.mode,
      position: o.position,
      level: s.level,
      limped: s.limped,
    });
    if (!cell) {
      src.push(`L${s.level}:${s.action} no measured cell`);
      continue;
    }
    const f = cell.c;
    const per = '';
    const w = hi - lo;
    const r = clamp01(f.raise);
    const c = clamp01(f.call);
    if (s.action === 'raise') hi = lo + Math.max(0.01, r) * w;
    else if (s.action === 'call') {
      const nlo = lo + r * w;
      hi = Math.min(hi, lo + Math.min(1, r + Math.max(0.01, c)) * w);
      lo = nlo;
    } else if (s.action === 'check') lo = lo + r * w;
    src.push(`L${s.level}:${s.action} r=${r3(r)} c=${r3(c)}[${cell.key} n=${cell.c.n}]${per}`);
  }
  if (!(hi > lo)) hi = Math.min(1, lo + 0.01);
  return { lo, hi, source: src.length ? src.join(' > ') : 'no voluntary action: full range' };
}

function bandRange(
  pool: Pool,
  b: { lo: number; hi: number; source: string },
  label: string
): RangeSpec {
  const a = Math.min(pool.size - 1, Math.max(0, Math.floor(b.lo * pool.size)));
  const z = Math.min(pool.size, Math.max(a + 1, Math.ceil(b.hi * pool.size)));
  if (a === 0 && z === pool.size) return fullRange(pool, `${label} full [${b.source}]`);
  return {
    parts: [{ idx: pool.order.slice(a, z), weight: 1 }],
    label: `${label} Top ${r3(b.lo)}-${r3(b.hi)} [${b.source}]`,
  };
}

function sizeBandOf(frac: number, allIn: boolean): string {
  if (allIn) return 'allin';
  return frac <= 0.6 ? 'b50' : frac <= 0.85 ? 'b75' : 'pot';
}

function priorOf(state: CoreState, o: CoreOpponent): string {
  const acts =
    (state as StateWithActions).preflopActions?.filter(
      (a) => a.seat === o.seat && a.action !== 'fold'
    ) ?? [];
  const last = acts[acts.length - 1];
  if (last) return last.action === 'raise' ? 'raised' : last.level === 0 ? 'limped' : 'called';
  if (o.preflopLevel === 'none') return 'fresh';
  if (o.preflopLevel === 'call') return state.preflopRaises === 0 ? 'limped' : 'called';
  return 'raised';
}

/** Size-aware measured fold rate of a responder facing the hero's preflop raise (every player pooled). */
export function preflopFold(
  state: CoreState,
  o: CoreOpponent,
  level: HeroRaiseLevel,
  toSize: number
): FoldResult {
  if (o.allIn) return { p: 0, reraise: 0, source: 'all-in: cannot fold' };
  const P = state.pot;
  const toCall = Math.max(0, state.toCall);
  const added = toSize - state.heroBet;
  const frac = (added - toCall) / Math.max(1e-9, P + toCall);
  const allIn = toSize >= state.heroBet + state.heroStack - 0.005;
  const band = sizeBandOf(frac, allIn);
  const lv = level === 'open' ? 'facing_open' : level === '3bet' ? 'facing_3bet' : 'facing_4bet+';
  const limpers = state.opponents.some((x) => !x.folded && x.preflopLevel === 'call');
  const iso = level === 'open' && state.preflopRaises === 0 && limpers ? 'iso' : 'std';
  const prior = priorOf(state, o);
  const live = state.opponents.filter((x) => !x.folded).length;
  const nb = live <= 1 ? 'hu' : 'mw';
  const keys: string[] = [];
  // back-off: band first (exact size), then prior, iso, players, mode, game
  for (const g of gamesOf(state.variant))
    for (const m of modesOf(state.mode))
      for (const n of [nb, 'all'])
        for (const i of [iso, 'any'])
          for (const pr of [prior, 'any'])
            for (const b of [band, 'all']) keys.push(`${g}|${m}|${lv}|${pr}|${i}|${b}|${n}`);
  const hit = firstCell(PF_TABLES.resp, keys);
  if (!hit) return { p: 0, reraise: 0, source: `no measured cell (${lv} ${band}): no fold credit` };
  const p = clamp01(hit.c.fold);
  const rr = clamp01(hit.c.raise);
  const src = `${hit.key} (n=${hit.c.n})`;
  return { p, reraise: rr, source: src };
}

function sprBand(spr: number): string {
  return spr < 1.5 ? 'spr<1.5' : spr < 4 ? 'spr1.5-4' : spr < 10 ? 'spr4-10' : 'spr10+';
}

const POST_ORDER = ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'MP', 'LJ', 'HJ', 'CO', 'BTN'];
function heroIp(state: CoreState): boolean {
  const hp = state.heroPosition ? POST_ORDER.indexOf(state.heroPosition) : -1;
  if (hp < 0) return state.ip;
  for (const o of state.opponents) {
    if (o.folded) continue;
    const op = o.position ? POST_ORDER.indexOf(o.position) : -1;
    if (op < 0) return state.ip;
    if (op > hp) return false;
  }
  return true;
}

export function preflopRealization(
  state: CoreState,
  potAfter: number,
  effBehind: number,
  players: number,
  allIn: boolean
): { value: number; source: string } {
  if (allIn || effBehind <= 0.005) return { value: 1, source: 'all-in: no later decision' };
  const ip = heroIp(state) ? 'ip' : 'oop';
  const n = players <= 2 ? '2' : '3+';
  const spr = effBehind / Math.max(1e-9, potAfter);
  const key = `${state.mode}|${ip}|${n}|${sprBand(spr)}`;
  const c = PF_REAL.shrunk?.[key];
  if (!c || !Number.isFinite(c.r) || c.r <= 0)
    return { value: 1, source: `no measured realization (${key}): none applied` };
  return {
    value: c.r,
    source: `preflop realization ${key} spr=${r3(spr)} r=${c.r} [${PF_REAL.version}]`,
  };
}

/** The component MATHCORE calls when street === 'preflop'. Never throws. */
export function preflopOpponentModel(state: CoreState, pool: Pool): PreflopOpponentModel {
  if (!PREFLOP_GAMES.includes(state.variant)) return outOfScope(state, pool);
  const rangeOf = new Map<number, RangeSpec>();
  const bands = new Map<number, { lo: number; hi: number; source: string }>();
  const live = state.opponents.filter((o) => !o.folded);
  for (const o of live) {
    let b: { lo: number; hi: number; source: string };
    try {
      b = bandOf(state, o);
    } catch (e) {
      b = { lo: 0, hi: 1, source: `band error (${(e as Error).message}): full range` };
    }
    bands.set(o.seat, b);
    rangeOf.set(o.seat, bandRange(pool, b, `s${o.seat}`));
  }
  const foldOf = (o: CoreOpponent, level: HeroRaiseLevel, toSize: number): FoldResult => {
    try {
      return preflopFold(state, o, level, toSize);
    } catch (e) {
      return { p: 0, reraise: 0, source: `fold error (${(e as Error).message}): no fold credit` };
    }
  };
  const continueOf = (
    o: CoreOpponent,
    level: HeroRaiseLevel,
    toSize: number,
    range: RangeSpec
  ): RangeSpec => {
    const f = foldOf(o, level, toSize);
    return topOf(pool, range, 1 - f.p, `continue ${r3(1 - f.p)} of ${range.label}`);
  };
  const realizationFor = (potAfter: number, effBehind: number, players: number, allIn: boolean) => {
    try {
      return preflopRealization(state, potAfter, effBehind, players, allIn);
    } catch (e) {
      return { value: 1, source: `realization error (${(e as Error).message}): none applied` };
    }
  };
  // default (the call / check line): pot after the call, effective stack behind vs the deepest live opponent he plays against
  const toCall = Math.max(0, Math.min(state.toCall, state.heroStack));
  const behindHero = state.heroStack - toCall;
  const effBehind = Math.min(behindHero, Math.max(0, ...live.map((o) => o.stack)));
  const realization = realizationFor(
    state.pot + toCall,
    effBehind,
    live.length + 1,
    behindHero <= 0.005
  );
  return { rangeOf, foldOf, continueOf, realization, realizationFor, bands };
}

/** The holdings of `range` between the strongest `fromShare` and `toShare` of its mass (a call band inside a range). */
export function sliceOf(
  pool: Pool,
  range: RangeSpec,
  fromShare: number,
  toShare: number,
  label: string
): RangeSpec {
  const a = Math.max(0, Math.min(1, fromShare));
  const b = Math.max(a + 0.02, Math.min(1, toShare));
  const w = new Float64Array(pool.size);
  for (const part of range.parts) {
    if (part.idx.length === 0) continue;
    const each = part.weight / part.idx.length;
    for (const i of part.idx) w[i] += each;
  }
  let total = 0;
  for (let i = 0; i < pool.size; i++) total += w[i];
  if (!(total > 0)) return fullRange(pool, `${label} [empty range: pool]`);
  const keep: number[] = [];
  let acc = 0;
  for (const i of pool.order) {
    if (w[i] <= 0) continue;
    const mid = (acc + w[i] / 2) / total;
    acc += w[i];
    if (mid >= a && mid < b) keep.push(i);
  }
  if (keep.length === 0) return topOf(pool, range, b, label);
  return { parts: [{ idx: Int32Array.from(keep), weight: 1 }], label };
}

function outOfScope(state: CoreState, pool: Pool): PreflopOpponentModel {
  const why = `${state.variant}: outside the preflop component (owner 8:26 PM: PLO4 + PLO5 only)`;
  const rangeOf = new Map<number, RangeSpec>();
  const bands = new Map<number, { lo: number; hi: number; source: string }>();
  for (const o of state.opponents)
    if (!o.folded) {
      rangeOf.set(o.seat, fullRange(pool, why));
      bands.set(o.seat, { lo: 0, hi: 1, source: why });
    }
  return {
    rangeOf,
    bands,
    foldOf: () => ({ p: 0, reraise: 0, source: why }),
    continueOf: (_o, _l, _t, range) => range,
    realization: { value: 1, source: why },
    realizationFor: () => ({ value: 1, source: why }),
  };
}

/**
 * How a player still to act responds when the hero only calls / limps / completes (no new raise):
 * the public frequencies at his node (level 0 with limpers, or facing the current raise level), every player pooled.
 */
export function behindResponse(
  state: CoreState,
  o: CoreOpponent
): { fold: number; call: number; raise: number; source: string } {
  if (!PREFLOP_GAMES.includes(state.variant))
    return { fold: 0, call: 1, raise: 0, source: 'out of scope' };
  const level = Math.min(state.preflopRaises, 3);
  const cell = nodeFreq({
    game: state.variant,
    mode: state.mode,
    position: o.position,
    level,
    limped: level === 0,
  });
  if (!cell)
    return {
      fold: 0,
      call: 1,
      raise: 0,
      source: `no measured cell L${level}: calls, never raises`,
    };
  const f = cell.c;
  const per = '';
  const t = Math.max(1e-9, f.fold + f.call + f.raise);
  return {
    fold: f.fold / t,
    call: f.call / t,
    raise: f.raise / t,
    source: `${cell.key} (n=${cell.c.n})${per}`,
  };
}
