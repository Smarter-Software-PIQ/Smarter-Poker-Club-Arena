/**
 * omahaMathCore component wiring (lane COREWIRE, lead session 01TLQer8, Nov 19 2026).
 *
 * Thin adapters between the core's EV loop (OmahaMathCore.ts, lane MATHCORE) and the
 * delivered components. No component's maths is rewritten here; each adapter only maps
 * the core's public state onto the component's interface. One implementation per term:
 *
 * - response to a wager (fold / raise): RANGES public population cell (responseTo with no
 *   user) -> PLAYBOOK board-texture fold cell -> OPPMODEL per-opponent posterior (the one
 *   person read; RANGES' (k+20pop)/(n+20) person shrink is not used: OPPMODEL won out of
 *   sample) -> PLAYBOOK blockers (hero wagers only; XR-BLUFF's blockerShift is NOT also
 *   applied: one blocker term).
 * - bet rate: RANGES population -> OPPMODEL posterior.
 * - opponent ranges postflop: RANGEADV trackRanges (whole public history, Bayes on measured
 *   node frequencies; bettor non-value share = each cell's shownNonValue, lead decision),
 *   cached per hand-street; the core's current-street rules are the fallback.
 * - postflop check / call / bet / raise EV: VALUE planValue (check node, raised branch,
 *   multi-street continuation, size menu), field response from HVH-MULTI
 *   continuationOutcomes (measured fold correlation), XR-BLUFF exploit-back, and the call
 *   with players still to act from HVH-MULTI callEvWithPlayersBehind (squeeze). The core's
 *   own one-step loop is the fallback when planValue answers null.
 * - preflop: PREFLOP-EV (strength order, public bands, size-aware fold / re-raise).
 *
 * PLO4 / PLO5 only: every adapter answers null for any other variant or hole count.
 */
import type { HorseGameStateV2 } from '../HorseLogic.js';
import { omahaBest } from './OmahaMathCoreEval.js';
import { seededRng, type Pool, type RangeSpec } from './OmahaMathCoreEquity.js';
import { sizeBand, type Band, type Line } from './MeasuredRanges.js';
import {
  TABLE,
  betRate,
  responseTo,
  wagerNonValue,
  type Actor,
  type Mode,
} from './OmahaMathCoreTables.js';
import {
  OPPONENT_MODEL_SNAPSHOT,
  opponentBetRate,
  opponentResponse,
} from './OmahaMathCoreOpponent.js';
import { textureFold } from './OmahaMathCorePlaybookTexture.js';
import { blockerAdjustedFold } from './OmahaMathCorePlaybookBlockers.js';
import {
  toRangeSpec,
  trackRanges,
  type NodeFreq,
  type PostStreet,
  type PublicStreetAction,
} from './OmahaMathCoreRangeTrack.js';
import { bandOf, type PreflopPublicAction } from './OmahaMathCorePreflop.js';
import {
  VALUE_SIZE_MENU,
  equityCurveFromHoldings,
  planValue,
  type ValueReceipt,
  type ValueResponse,
  type ValueSpot,
} from './OmahaMathCoreValue.js';
import { xrBluffCtx, type XrLine } from './OmahaMathCoreBluff.js';
import { callEvWithPlayersBehind, continuationOutcomes, type Responder } from './MultiwayTerms.js';
import type { CoreActionEv, CoreOpponent, CoreState } from './OmahaMathCore.js';

export const OMAHA_MATH_CORE_WIRE_VERSION = 'omaha-math-core-wire-v1';

/**
 * Selection by the lower confidence bound (PROVE-2 root cause 1, winner's curse): candidates are ranked by
 * EV minus one standard error of their EV (equity sampling and the measured cells' binomial error, as each
 * candidate reports it), so a candidate whose edge is inside its own noise does not win the argmax.
 */
export function selectionScore(a: { ev: number; se: number | null }): number {
  return a.ev - (a.se !== null && Number.isFinite(a.se) ? Math.max(0, a.se) : 0);
}

/**
 * Provenance law: preflopRealization.v1.json (lane PREFLOP-EV) is built from the Horses' own hole cards
 * over hands where those cards were never shown at the table. That is neither public_actions nor
 * showdown_only, so the core does not read it (preflop realization = 1) until the lead admits it. The
 * two PREFLOP-EV tests that assert realization-dependent choices run only when this is true.
 */
export const PREFLOP_REALIZATION_ADMITTED = false;

/**
 * Test hook: the core's one-step fallback path (planValue off) is where lane DRAWS' later-street term
 * applies (never on top of a planValue candidate: VALUE already prices the later streets). DRAWS' core
 * law tests run on that path. Production never calls this.
 */
let WIRED_VALUE_ON = true;
export function setWiredValueForTests(on: boolean): void {
  WIRED_VALUE_ON = on;
}

const POST: readonly PostStreet[] = ['flop', 'turn', 'river'];
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function wireInScope(state: Pick<CoreState, 'variant' | 'hole'>): boolean {
  return (
    (state.variant === 'plo4' && state.hole.length === 4) ||
    (state.variant === 'plo5' && state.hole.length === 5)
  );
}

// ───────────────────────────── responses and bet rates ─────────────────────────────

export type ResponseKey = Parameters<typeof responseTo>[0];
export type BetRateKey = Parameters<typeof betRate>[0];
export interface WiredResponse {
  fold: number;
  raise: number;
  n: number;
  /**
   * observations of this exact street and line (no back-off across street or line): what a raise's fold
   * credit needs (XR-BLUFF finding 3 / VALUE RAISE_FOLD_CREDIT_MIN_N); 0 when the cell was borrowed
   */
  exactN: number;
  source: string;
}

/** Population cell -> board texture -> per-opponent posterior. Null when no population cell qualifies. */
export function wiredResponse(board: readonly number[], k: ResponseKey): WiredResponse | null {
  const pop = responseTo({ ...k, user: null });
  if (!pop) return null;
  let fold = clamp01(pop.fold);
  let raise = clamp01(pop.raise);
  let source = pop.source;
  // the population key is game|mode|street|line|band|players|opp|bettor (MeasuredRanges back-off)
  const key = (/(\S+\|\S+) \(n=/.exec(pop.source)?.[1] ?? '').split('|');
  const exactN = key[2] === k.street && key[3] === k.line ? pop.n : 0;
  if (board.length >= 3 && k.band !== 'all') {
    const t = textureFold({
      street: k.street,
      board,
      band: k.band,
      players: k.players,
      responder: k.responder,
      p: fold,
    });
    if (Number.isFinite(t.p) && Math.abs(t.p - fold) > 1e-9) {
      // the texture moves the fold share; the raise share keeps its share of what does not fold
      const keep = fold < 1 ? (1 - t.p) / (1 - fold) : 1;
      raise = clamp01(raise * keep);
      fold = clamp01(t.p);
    }
    source = `${source}; ${t.source}`;
  }
  const post = opponentResponse(
    k.user,
    k.responder,
    {
      game: k.game,
      mode: k.mode,
      street: k.street,
      line: k.line,
      band: k.band,
      players: k.players,
      vs: k.bettor,
    },
    { fold, raise, call: Math.max(0, 1 - fold - raise), n: pop.n, source }
  );
  if (post && Number.isFinite(post.fold) && Number.isFinite(post.raise)) {
    fold = clamp01(post.fold);
    raise = Math.min(clamp01(post.raise), 1 - fold);
    source = post.source;
  }
  return { fold, raise, n: pop.n, exactN, source };
}

/** The response to the HERO's wager: wiredResponse plus the hero's blockers (PLAYBOOK, exact card removal). */
export function wiredHeroResponse(
  hero: readonly number[],
  board: readonly number[],
  seed: string,
  k: ResponseKey
): WiredResponse | null {
  const c = wiredResponse(board, k);
  if (!c || board.length < 3) return c;
  const b = blockerAdjustedFold(hero, board, hero.length, { lo: 0, hi: 1 }, c.fold, `${seed}|blk`);
  if (!Number.isFinite(b.p) || Math.abs(b.p - c.fold) < 1e-9) return c;
  const keep = c.fold < 1 ? (1 - b.p) / (1 - c.fold) : 1;
  return {
    fold: clamp01(b.p),
    raise: Math.min(clamp01(c.raise * keep), 1 - clamp01(b.p)),
    n: c.n,
    exactN: c.exactN,
    source: `${c.source}; ${b.source}`,
  };
}

/**
 * A Horse responder on this core defends to the price: it folds s / (1 + s) of its range to a wager of
 * pot share s (lane MATHCORE 9bacaeaf5ea: the table's Horse cells measure the pre-core brain, which
 * over-folded; pricing core Horses with them makes cores bluff each other without end, PROVE self-play).
 * The raise share stays the measured one.
 */
export function horseDefenceFold(
  frac: number,
  measured: { fold: number; raise: number; source: string } | null
): { p: number; r: number; source: string } {
  const sc = Math.max(0, frac) / (1 + Math.max(0, frac));
  return {
    p: sc,
    r: measured ? Math.max(0, Math.min(1 - sc, measured.raise)) : 0,
    source: `self-consistent Horse defence: fold s/(1+s) = ${r2(sc)} at s = ${r2(frac)}${measured ? ` (old Horse cell ${r2(measured.fold)}: ${measured.source})` : ''}`,
  };
}

export function wiredBetRate(
  k: BetRateKey
): { b: number; n: number; source: string; size: number } | null {
  const pop = betRate({ ...k, user: null });
  if (!pop) return null;
  const post = opponentBetRate(
    k.user,
    k.actor,
    { game: k.game, street: k.street },
    { p: pop.b, n: pop.n, source: pop.source }
  );
  return post && Number.isFinite(post.p)
    ? { b: clamp01(post.p), n: pop.n, source: post.source, size: pop.size }
    : pop;
}

// ───────────────────────────── public history (for RANGEADV and PREFLOP-EV) ─────────────────────────────

const ACTS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);

/**
 * The hand's public action line in the components' shapes: postflop actions with their
 * pot share (pot before each action reconstructed backwards from the current pot) and
 * preflop actions with their raise level and limpers. Public information only.
 */
export function publicHistoryOf(
  gs: HorseGameStateV2,
  positions: ReadonlyMap<number, string>
): { history: PublicStreetAction[]; preflopActions: PreflopPublicAction[] } {
  const acts = (gs.actionHistory ?? []).filter((a) => ACTS.has(a.action));
  const streets = ['preflop', 'flop', 'turn', 'river'];
  const adds = new Array<number>(acts.length).fill(0);
  const facing = new Array<boolean>(acts.length).fill(false);
  const kind = new Array<'check' | 'call' | 'bet' | 'raise' | 'fold'>(acts.length).fill('check');
  const toCallBefore = new Array<number>(acts.length).fill(0);
  const levelBefore = new Array<number>(acts.length).fill(0);
  const raisesBefore = new Array<number>(acts.length).fill(0);
  const limpersBefore = new Array<number>(acts.length).fill(0);
  let curStreet = '';
  let totals = new Map<number, number>();
  let level = 0;
  let raises = 0;
  let limpers = 0;
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    const st = String(a.stage);
    if (st !== curStreet) {
      curStreet = st;
      totals = new Map();
      // preflop: the blinds are a level already (a call of the big blind is a limp, not a bet)
      level = st === 'preflop' ? Math.max(0, gs.bigBlind || 0) : 0;
      raises = 0;
      limpers = 0;
    }
    const prevT = totals.get(a.seat) ?? 0;
    const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
    facing[i] = level > prevT + 0.005;
    toCallBefore[i] = Math.max(0, level - prevT);
    levelBefore[i] = level;
    raisesBefore[i] = raises;
    limpersBefore[i] = limpers;
    if (a.action === 'check') kind[i] = 'check';
    else if (a.action === 'fold') kind[i] = 'fold';
    else if (a.action === 'call') {
      adds[i] = amt;
      totals.set(a.seat, prevT + amt);
      kind[i] = 'call';
      if (st === 'preflop' && raises === 0) limpers++;
    } else {
      const now = Math.max(prevT, amt);
      adds[i] = now - prevT;
      totals.set(a.seat, now);
      if (now > level + 0.005) {
        kind[i] = st === 'preflop' ? 'raise' : level > 0.005 ? 'raise' : 'bet';
        level = now;
        raises++;
      } else {
        kind[i] = 'call';
        if (st === 'preflop' && raises === 0) limpers++;
      }
    }
  }
  // pot before each action, backwards from the pot now (every chip in the middle)
  const potBefore = new Array<number>(acts.length).fill(0);
  let pot = Math.max(0, gs.pot || 0);
  for (let i = acts.length - 1; i >= 0; i--) {
    pot -= adds[i];
    potBefore[i] = Math.max(0, pot);
  }
  const dealt = gs.dealtSeatIds?.length ?? gs.players.filter((p) => !p.is_sitting_out).length;
  let liveNow = dealt;
  const history: PublicStreetAction[] = [];
  const preflopActions: PreflopPublicAction[] = [];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    const st = String(a.stage);
    if (st === 'preflop') {
      preflopActions.push({
        seat: a.seat,
        action: (kind[i] === 'bet' ? 'raise' : kind[i]) as PreflopPublicAction['action'],
        level: raisesBefore[i],
        limpers: raisesBefore[i] === 0 ? limpersBefore[i] : 0,
        position: positions.get(a.seat) ?? null,
      });
    } else if (streets.includes(st)) {
      const k = kind[i];
      let frac = 0;
      if (k === 'bet') frac = adds[i] / Math.max(1e-9, potBefore[i]);
      else if (k === 'raise')
        frac = (adds[i] - toCallBefore[i]) / Math.max(1e-9, potBefore[i] + toCallBefore[i]);
      history.push({
        street: st as PostStreet,
        seat: a.seat,
        action: k,
        frac: Math.max(0, frac),
        facing: facing[i],
        allIn: a.action === 'all_in',
        players: liveNow,
      });
    }
    if (kind[i] === 'fold') liveNow = Math.max(1, liveNow - 1);
  }
  return { history, preflopActions };
}

// ───────────────────────────── RANGEADV: tracked ranges, cached per hand-street ─────────────────────────────

const TRACK_CACHE = new Map<string, unknown>();

export interface WiredTrack {
  pool: Pool;
  rangeOf: Map<number, RangeSpec>;
  ms: number;
}

export function wiredTrack(
  state: CoreState & { history?: PublicStreetAction[] },
  now: () => number,
  sizeCap?: number
): WiredTrack | null {
  if (state.street === 'preflop' || !wireInScope(state) || !state.history) return null;
  const live = state.opponents.filter((o) => !o.folded);
  if (live.length === 0) return null;
  const bySeat = new Map(state.opponents.map((o) => [o.seat, o]));
  const game = state.variant;
  const mode = state.mode;
  const actorOf = (o: CoreOpponent): Actor => (o.person ? 'person' : 'horse');
  const freq = (
    seat: number,
    street: PostStreet,
    facingW: boolean,
    frac: number,
    allIn: boolean,
    players: number
  ): (NodeFreq & { nonValue?: number }) | null => {
    const o = bySeat.get(seat);
    if (!o) return null;
    const actor = actorOf(o);
    const pl: 'hu' | 'mw' = players <= 2 ? 'hu' : 'mw';
    const band: Band = sizeBand(Math.max(0, frac), allIn);
    const user = o.person ? o.user : null;
    if (!facingW) {
      const br = wiredBetRate({ game, mode, street, line: 'all', players: pl, actor, user });
      if (!br) return null;
      const nv = wagerNonValue({
        game,
        mode,
        street,
        line: 'all',
        band,
        players: pl,
        bettor: actor,
      });
      return {
        wager: br.b,
        fold: 0,
        nonValue: nv ? nv.nv : undefined,
        source: `${br.source}${nv ? `; ${nv.source}` : ''}`,
      };
    }
    // the kind of the player whose wager he faced is not in the street action: the population
    // cell of Horse wagers is used (the core's wagers and most persons' spots are vs Horses)
    const r = wiredResponse(
      state.board.slice(0, street === 'flop' ? 3 : street === 'turn' ? 4 : 5),
      {
        game,
        mode,
        street,
        line: 'all',
        band,
        players: pl,
        bettor: 'horse',
        responder: actor,
        user,
      }
    );
    if (!r) return null;
    const nv = wagerNonValue({
      game,
      mode,
      street,
      line: 'raise',
      band,
      players: pl,
      bettor: actor,
    });
    return {
      wager: r.raise,
      fold: r.fold,
      nonValue: nv ? nv.nv : undefined,
      source: `${r.source}${nv ? `; ${nv.source}` : ''}`,
    };
  };
  const th = trackRanges({
    variant: game,
    hole: state.hole,
    board: state.board,
    seats: live.map((o) => o.seat),
    heroSeat: state.heroSeat,
    preflopBand: (seat) => {
      const o = bySeat.get(seat);
      if (!o) return null;
      try {
        return bandOf(state, o);
      } catch {
        return null;
      }
    },
    history: state.history,
    freq,
    // hand-street key: the same cards and board give the same pool and preflop strengths
    seed: `${state.hole.join('.')}|${state.board.join('.')}`,
    // latency (lane COREWIRE, measured): pool 360 and 80 refine runs keep the first, uncached call of a
    // hand-street inside the core's box; later decisions on the street hit the cache
    size: sizeCap ?? 360,
    pfRefineRuns: 80,
    now,
    cache: TRACK_CACHE,
  });
  if (!th) return null;
  const rangeOf = new Map<number, RangeSpec>();
  for (const o of live) {
    const t = th.ranges.get(o.seat);
    if (t) rangeOf.set(o.seat, toRangeSpec(t, `s${o.seat} ${o.person ? 'person' : 'horse'}`));
  }
  return { pool: th.pool, rangeOf, ms: th.ms };
}

// ───────────────────────────── VALUE + HVH-MULTI + XR-BLUFF: postflop EV ─────────────────────────────

/** Hero equity against every pool holding on shared completions (exact on the turn and river). */
export function heroEquityVector(
  hole: readonly number[],
  board: readonly number[],
  pool: Pool,
  seed: string,
  deadline: number,
  now: () => number
): { eq: Float64Array; runs: number } {
  const hc = pool.holeCount;
  const used = new Uint8Array(52);
  for (const c of hole) used[c] = 1;
  for (const c of board) used[c] = 1;
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const runouts: number[][] = [];
  const missing = 5 - board.length;
  if (missing === 0) runouts.push([]);
  else if (missing === 1) {
    // turn: 20 of the rivers (a seeded subset; every river when fewer), a fixed count for determinism
    const rng = seededRng(`${seed}|eqvec`);
    const d = deck.slice();
    for (let k = 0; k < Math.min(20, d.length); k++) {
      const j = k + Math.floor(rng() * (d.length - k));
      [d[k], d[j]] = [d[j], d[k]];
      runouts.push([d[k]]);
    }
  } else {
    const rng = seededRng(`${seed}|eqvec`);
    for (let r = 0; r < 24; r++) {
      const i = Math.floor(rng() * deck.length);
      let j = Math.floor(rng() * (deck.length - 1));
      if (j >= i) j++;
      runouts.push([deck[i], deck[j]]);
    }
  }
  const win = new Float64Array(pool.size);
  const cnt = new Float64Array(pool.size);
  const full = new Int8Array(5);
  const heroArr = Int8Array.from(hole);
  for (let k = 0; k < board.length; k++) full[k] = board[k];
  let runs = 0;
  for (const ro of runouts) {
    if (runs >= 12 && now() > deadline) break;
    for (let k = 0; k < ro.length; k++) full[board.length + k] = ro[k];
    const hs = omahaBest(heroArr, hole.length, full, 5);
    for (let i = 0; i < pool.size; i++) {
      const h = pool.cards.subarray(i * hc, i * hc + hc);
      let clash = false;
      for (let k = 0; k < hc && !clash; k++) for (const c of ro) if (h[k] === c) clash = true;
      if (clash) continue;
      const os = omahaBest(h, hc, full, 5);
      win[i] += hs > os ? 1 : hs === os ? 0.5 : 0;
      cnt[i] += 1;
    }
    runs++;
  }
  const eq = new Float64Array(pool.size);
  for (let i = 0; i < pool.size; i++) eq[i] = cnt[i] > 0 ? win[i] / cnt[i] : 0.5;
  return { eq, runs };
}

function flatten(pool: Pool, r: RangeSpec, into: Float64Array): void {
  let total = 0;
  for (const p of r.parts) total += p.weight;
  if (!(total > 0)) return;
  for (const p of r.parts) {
    if (p.idx.length === 0) continue;
    const each = p.weight / total / p.idx.length;
    for (const i of p.idx) into[i] += each;
  }
}

export interface WireValueCtx {
  state: CoreState;
  pool: Pool;
  live: CoreOpponent[];
  behind: CoreOpponent[];
  front: CoreOpponent[];
  rangeOf: Map<number, RangeSpec>;
  /** the core's equity engine (exact joint draws) on ranges */
  eq: (ranges: RangeSpec[]) => { equity: number; se: number };
  topOf: (range: RangeSpec, share: number, label: string) => RangeSpec;
  rakeNet: (final: number) => number;
  onUnit: (to: number, minTo: number, maxTo: number, unit: number) => number;
  legalHas: (a: string) => boolean;
  deadline: number;
  now: () => number;
}

export interface WireValueResult {
  evs: CoreActionEv[];
  receipt: {
    version: string;
    value: string;
    choice: ValueReceipt['choice'];
    indifferent: number[];
    eqRuns: number;
    mwPower: number;
    call: string | null;
    /** ms: equity vector, exact anchor, planValue (and its response cells) */
    ms: { vector: number; anchor: number; plan: number };
  };
}

/** Postflop EV of check / call / every wager size from VALUE planValue (null: the core keeps its own loop). */
export function wiredValue(c: WireValueCtx): WireValueResult | null {
  const s = c.state;
  if (!WIRED_VALUE_ON) return null;
  if (s.street === 'preflop' || !wireInScope(s) || c.live.length === 0) return null;
  const street = s.street;
  const st0 = POST.indexOf(street);
  const game = s.variant;
  const mode: Mode = s.mode;
  const actorOf = (o: CoreOpponent): Actor => (o.person ? 'person' : 'horse');
  const stack = Math.max(0, s.heroStack);
  const toCall = Math.max(0, Math.min(s.toCall, stack));
  const playersNow: 'hu' | 'mw' = c.live.length === 1 ? 'hu' : 'mw';

  // equity against the strongest share of the field: one per-holding vector, anchored to the exact engine
  const tV = c.now();
  const vec = heroEquityVector(s.hole, s.board, c.pool, s.seed, c.deadline, c.now);
  const tA = c.now();
  const w = new Float64Array(c.pool.size);
  for (const o of c.live) flatten(c.pool, c.rangeOf.get(o.seat)!, w);
  const curve = equityCurveFromHoldings(c.pool.order, w, vec.eq);
  const exact = c.eq(c.live.map((o) => c.rangeOf.get(o.seat)!));
  const tP = c.now();
  const hu1 = clamp01(curve(1));
  let k = 1;
  if (c.live.length > 1 && hu1 > 0.01 && hu1 < 0.99 && exact.equity > 0.001 && exact.equity < 0.999)
    k = Math.min(c.live.length, Math.max(1, Math.log(exact.equity) / Math.log(hu1)));
  const equityAtShare = (share: number) => Math.pow(clamp01(curve(share)), k);
  const equitySe = Math.max(exact.se, Math.abs(equityAtShare(1) - exact.equity));

  const lineAt = (off: number, line: 'bet' | 'raise' | 'check_raise'): Line => {
    if (off > 0) return 'barrel';
    if (line === 'check_raise') return 'check_raise';
    if (line === 'raise' || toCall > 0.005)
      return s.heroWagerLine === 'check_raise' ? 'check_raise' : 'raise';
    return s.heroWagerLine;
  };
  // planValue asks the same cells many times (sizes x streets): memoised per decision
  const respMemo = new Map<string, ValueResponse | null>();
  const response = (
    frac: number,
    allIn: boolean,
    off: number,
    line: 'bet' | 'raise' | 'check_raise'
  ): ValueResponse | null => {
    const mk = `${allIn ? 'A' : r3(frac)}|${off}|${lineAt(off, line)}`;
    if (respMemo.has(mk)) return respMemo.get(mk)!;
    const raw = responseUncached(frac, allIn, off, line);
    const v = raw ? isotonic(raw, frac, allIn, off, line) : raw;
    respMemo.set(mk, v);
    return v;
  };
  // PROVE-2 root cause 1: the size-band cells are measured separately, so the field's fold share is not
  // monotone in the size and the argmax harvests the noise. The bands are pooled adjacent-violators style
  // (weights = their counts) into a non-decreasing fold curve; a size's fold share moves by its band's
  // correction. One curve per (street offset, line).
  const BAND_REP: readonly [Band, number, boolean][] = [
    ['small', 1 / 3, false],
    ['half', 0.5, false],
    ['twothirds', 0.7, false],
    ['pot', 1, false],
    ['allin', 1, true],
  ];
  const isoMemo = new Map<string, Map<Band, number> | null>();
  const isotonic = (
    raw: ValueResponse,
    frac: number,
    allIn: boolean,
    off: number,
    line: 'bet' | 'raise' | 'check_raise'
  ): ValueResponse => {
    const ik = `${off}|${lineAt(off, line)}`;
    let corr = isoMemo.get(ik);
    if (corr === undefined) {
      const pts = BAND_REP.map(([b, f, a]) => ({ b, r: responseUncached(f, a, off, line) }));
      if (pts.some((p) => !p.r)) corr = null;
      else {
        // pool adjacent violators: blocks of (sum w*fold, sum w, members)
        const blocks: { s: number; w: number; m: Band[] }[] = [];
        for (const p of pts) {
          const w = Math.max(1, p.r!.n ?? 1);
          blocks.push({ s: w * p.r!.fold, w, m: [p.b] });
          while (blocks.length > 1) {
            const z = blocks[blocks.length - 1];
            const y = blocks[blocks.length - 2];
            if (y.s / y.w <= z.s / z.w + 1e-12) break;
            blocks.splice(blocks.length - 2, 2, {
              s: y.s + z.s,
              w: y.w + z.w,
              m: [...y.m, ...z.m],
            });
          }
        }
        corr = new Map();
        for (const bl of blocks)
          for (const b of bl.m) {
            const p = pts.find((x) => x.b === b)!;
            corr.set(b, bl.s / bl.w - p.r!.fold);
          }
      }
      isoMemo.set(ik, corr);
    }
    if (!corr) return raw;
    const d = corr.get(sizeBand(frac, allIn)) ?? 0;
    if (Math.abs(d) < 1e-9) return raw;
    const fold = clamp01(raw.fold + d);
    return {
      ...raw,
      fold,
      raise: Math.min(raw.raise, 1 - fold),
      source: `${raw.source}; monotone fold curve ${d > 0 ? '+' : ''}${r3(d)}`,
    };
  };
  const responseUncached = (
    frac: number,
    allIn: boolean,
    off: number,
    line: 'bet' | 'raise' | 'check_raise'
  ): ValueResponse | null => {
    const stI = Math.min(2, st0 + off);
    const stName = POST[stI];
    const resp: Responder[] = [];
    let measured = 0;
    let nMin = Infinity;
    for (const o of c.live) {
      if (o.allIn) continue;
      const key: ResponseKey = {
        game,
        mode,
        street: stName,
        line: lineAt(off, line),
        band: sizeBand(frac, allIn),
        players: playersNow,
        bettor: 'horse',
        responder: actorOf(o),
        user: o.person ? o.user : null,
      };
      let r =
        off === 0 ? wiredHeroResponse(s.hole, s.board, s.seed, key) : wiredResponse(s.board, key);
      if (!o.person) {
        const h = horseDefenceFold(allIn ? Math.max(frac, 1) : frac, r);
        r = { fold: h.p, raise: h.r, n: r ? r.n : 0, exactN: r ? r.exactN : 0, source: h.source };
      }
      if (r) {
        measured++;
        // a raise line's fold credit rests on the exact street/line cell only (VALUE: n >= 30 or none)
        const isRaiseLine = key.line === 'raise' || key.line === 'check_raise';
        nMin = Math.min(nMin, isRaiseLine ? r.exactN : r.n);
      }
      resp.push({
        seat: o.seat,
        actor: actorOf(o),
        fold: r ? r.fold : 0,
        raise: r ? r.raise : 0,
        callChips: 0,
        source: r ? r.source : 'no measured cell: no fold credit',
      });
    }
    if (resp.length === 0)
      return { fold: 0, raise: 0, callers: 0, source: 'every opponent all-in' };
    if (measured === 0) return null;
    const out = continuationOutcomes(resp, 'horse');
    if (!out) return null;
    const cont = Math.max(1e-9, 1 - out.pAllFold - out.pRaise);
    let callers = 0;
    for (const oc of out.outcomes) callers += oc.p * oc.callers.length;
    return {
      fold: out.pAllFold,
      raise: out.pRaise,
      callers: Math.max(1, callers / cont),
      n: Number.isFinite(nMin) ? nMin : undefined,
      source: `${out.source}; ${resp.map((r) => `s${r.seat}: ${r.source}`).join(' | ')}`,
    };
  };
  const betBandFrac: Record<string, number> = {
    small: 1 / 3,
    half: 0.5,
    twothirds: 0.7,
    pot: 1,
    allin: 1,
  };
  const wagerWhenChecked = (off: number) => {
    const stI = Math.min(2, st0 + off);
    const stName = POST[stI];
    // this street: only opponents still to act after the hero's check can wager
    const who =
      off === 0
        ? c.live.filter(
            (o) => !o.allIn && (o.streetAction === 'none' || !s.ip) && o.streetAction !== 'check'
          )
        : c.live.filter((o) => !o.allIn);
    if (who.length === 0) return null;
    let pNone = 1;
    let fracSum = 0;
    let fracW = 0;
    let nv: number | undefined;
    const srcs: string[] = [];
    for (const o of who) {
      // PROVE-2 root cause 3: the opponent's wager after the hero's check is his measured rate for that
      // line (this street: a probe after the hero's earlier aggression, a stab otherwise, his barrel when he
      // was the aggressor; later streets: his barrel or probe the same way), not his all-lines rate
      const heroWasAggressor = s.heroWagerLine === 'cbet' || s.heroWagerLine === 'barrel';
      const wl: Line =
        off === 0
          ? o.prevAggressor
            ? street === 'flop'
              ? 'cbet'
              : 'barrel'
            : heroWasAggressor
              ? 'probe'
              : 'stab'
          : 'probe';
      const br = wiredBetRate({
        game,
        mode,
        street: stName,
        line: wl,
        players: playersNow,
        actor: actorOf(o),
        user: o.person ? o.user : null,
      });
      if (!br) continue;
      pNone *= 1 - br.b;
      srcs.push(`s${o.seat}: ${r3(br.b)} ${br.source}`);
      // measured size mix of such wagers (public bet bands)
      const bands =
        br.size > 0 ? { frac: br.size } : sizeMixOf(game, mode, stName, playersNow, actorOf(o));
      if (bands) {
        fracSum += br.b * bands.frac;
        fracW += br.b;
      }
      const v = wagerNonValue({
        game,
        mode,
        street: stName,
        line: 'all',
        band: bands ? sizeBand(bands.frac, false) : 'all',
        players: playersNow,
        bettor: actorOf(o),
      });
      if (v) nv = nv === undefined ? v.nv : Math.max(nv, v.nv);
    }
    if (srcs.length === 0) return null;
    const p = 1 - pNone;
    const frac = fracW > 0 ? fracSum / fracW : betBandFrac.half;
    return {
      p,
      frac,
      valueShare: nv === undefined ? undefined : 1 - nv,
      source: srcs.join(' | '),
    };
  };
  const oppStack = Math.max(0, ...c.live.map((o) => o.stack));
  const checkCloses = toCall <= 0.005 && c.live.every((o) => o.streetAction === 'check' || o.allIn);
  const opp = c.live.length === 1 ? c.live[0] : null;
  const bluffCtx =
    xrBluffCtx({
      variant: game,
      holeCount: s.hole.length,
      blockers: null, // one blocker term: PLAYBOOK's, already inside the response cells
      opponent: opp ? opp.user : null,
      measured: (line: XrLine) => {
        const r = response(
          Math.max(0.25, s.wagerFrac || 0.5),
          false,
          0,
          line === 'bet' ? 'bet' : line
        );
        return r ? { fold: r.fold, raise: r.raise } : null;
      },
      priorWeight: OPPONENT_MODEL_SNAPSHOT.params.response.m,
    }) ?? undefined;
  const spot: ValueSpot = {
    variant: game,
    street,
    pot: s.pot,
    toCall,
    heroStack: stack,
    oppStack,
    nOpp: c.live.length,
    ip: s.ip,
    checkCloses,
    rakeNet: c.rakeNet,
    response,
    wagerWhenChecked,
    equityAtShare,
    equitySe,
    sizes: VALUE_SIZE_MENU,
    seed: s.seed,
    bluffCtx,
  };
  const vr = planValue(spot);
  const tE = c.now();
  if (!vr) return null;

  const evs: CoreActionEv[] = [];
  const maxTo = s.maxRaiseTo ?? s.heroBet + stack;
  const minTo = s.minRaiseTo ?? s.currentBet + s.bigBlind;
  const allInTo = s.heroBet + stack;
  const seen = new Set<string>();
  let callNote: string | null = null;
  for (const cd of vr.candidates) {
    // the core prices the fold itself (0)
    if (cd.kind === 'fold') continue;
    if (cd.kind === 'check') {
      if (toCall > 0.005 || !c.legalHas('check')) continue;
      evs.push({
        action: 'check',
        amount: null,
        adds: 0,
        ev: cd.ev,
        equity: equityAtShare(1),
        se: cd.se,
        foldProb: 0,
        foldSource: `value: ${cd.plan}`,
        range: null,
        future: null,
      });
    } else if (cd.kind === 'call') {
      if (toCall <= 0.005) continue;
      const callAllIn = s.heroStack <= s.toCall + 0.005;
      if (!(c.legalHas('call') || (callAllIn && c.legalHas('all_in')))) continue;
      let ev = cd.ev;
      let src = `value: ${cd.plan}`;
      if (c.behind.length > 0 && !callAllIn) {
        // players still to act: HVH-MULTI squeeze pricing (the call vs every continuing set)
        const behind: Responder[] = c.behind.map((o) => {
          const r =
            c.state.aggressorSeat !== null && s.line && s.band
              ? wiredResponse(s.board, {
                  game,
                  mode,
                  street,
                  line: s.line,
                  band: s.band,
                  players: playersNow,
                  bettor: actorOf(c.live.find((x) => x.seat === s.aggressorSeat) ?? o),
                  responder: actorOf(o),
                  user: o.person ? o.user : null,
                })
              : null;
          return {
            seat: o.seat,
            actor: actorOf(o),
            fold: r ? r.fold : 0,
            raise: r ? r.raise : 0,
            callChips: Math.max(0, Math.min(o.stack + o.bet, s.currentBet) - o.bet),
            source: r ? r.source : 'no measured cell: no fold credit',
          };
        });
        const cache = new Map<string, number>();
        const frontSeats = c.front.map((o) => o.seat);
        const eqVs = (seats: number[]) => {
          const key = [...seats].sort((a, b) => a - b).join(',');
          let v = cache.get(key);
          if (v === undefined) {
            const rs = seats.map((seat) => {
              const r0 = c.rangeOf.get(seat)!;
              const b = behind.find((x) => x.seat === seat);
              return b ? c.topOf(r0, 1 - b.fold, `continue ${r2(1 - b.fold)} of ${r0.label}`) : r0;
            });
            v = rs.length ? c.eq(rs).equity : 1;
            cache.set(key, v);
          }
          return v;
        };
        const mw = callEvWithPlayersBehind({
          pot: s.pot,
          toCall,
          behind,
          front: frontSeats,
          equityVs: eqVs,
          potNet: c.rakeNet,
          realization: 1,
          bettor: actorOf(c.live.find((x) => x.seat === s.aggressorSeat) ?? c.live[0]),
        });
        if (mw) {
          ev = mw.ev;
          src = `players behind: ${mw.source}`;
        }
      }
      callNote = src;
      evs.push({
        action: callAllIn ? 'all_in' : 'call',
        amount: callAllIn ? r2(s.heroBet + stack) : r2(toCall),
        adds: toCall,
        ev,
        equity: equityAtShare(1),
        se: cd.se,
        foldProb: 0,
        foldSource: src,
        range: null,
        future: null,
      });
    } else {
      if (!(stack > toCall + 0.005)) continue;
      // nobody left to call a wager (every opponent all-in)
      if (c.live.every((o) => o.allIn)) continue;
      // an all-in above the pot-limit cap is not a legal size: VALUE's pot-or-smaller sizes stand for it
      if (cd.allIn && allInTo > maxTo + 0.005) continue;
      let to = cd.allIn ? allInTo : r2(s.heroBet + cd.adds);
      if (!cd.allIn) to = c.onUnit(to, minTo, maxTo, s.chipUnit);
      if (to > allInTo + 0.005) to = allInTo;
      const allIn = to >= allInTo - 0.005;
      const action: CoreActionEv['action'] = allIn
        ? 'all_in'
        : s.currentBet > 0.005
          ? 'raise'
          : 'bet';
      if (
        !c.legalHas(action) &&
        !(action === 'bet' && c.legalHas('raise')) &&
        !(action === 'raise' && c.legalHas('bet'))
      )
        continue;
      const adds = Math.min(stack, to - s.heroBet);
      const key = `${action}|${r2(to)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const restated = Math.abs(adds - cd.adds) > Math.max(0.011, s.chipUnit);
      evs.push({
        action,
        amount: action === 'bet' ? r2(adds) : r2(to),
        adds,
        ev: cd.ev,
        equity: equityAtShare(1 - cd.fold),
        se: cd.se,
        foldProb: cd.fold,
        foldSource:
          `value ${cd.allIn ? 'all-in' : r3(cd.frac ?? 0)} pot: fold ${r3(cd.fold)} raise ${r3(cd.raise)} call ${r3(cd.call)}; ${cd.plan}${restated ? `; priced at ${r2(cd.adds)} chips, legal size ${r2(adds)}` : ''}; ${cd.source}`.slice(
            0,
            1500
          ),
        range: null,
        future: null,
      });
    }
  }
  if (evs.length === 0) return null;
  return {
    evs,
    receipt: {
      version: OMAHA_MATH_CORE_WIRE_VERSION,
      value: vr.version,
      choice: vr.choice,
      indifferent: vr.indifferent,
      eqRuns: vec.runs,
      mwPower: r3(k),
      call: callNote,
      ms: { vector: r2(tA - tV), anchor: r2(tP - tA), plan: r2(tE - tP) },
    },
  };
}

/** Measured size of a line's wagers: the public bet-band mix of betFrequency, as a mean pot share. */
const SIZE_MIX_CACHE = new Map<string, { frac: number; source: string } | null>();
function sizeMixOf(
  game: 'plo4' | 'plo5',
  mode: Mode,
  street: PostStreet,
  players: 'hu' | 'mw',
  actor: Actor
): { frac: number; source: string } | null {
  const key = `${game}|${mode}|${street}|${players}|${actor}`;
  if (SIZE_MIX_CACHE.has(key)) return SIZE_MIX_CACHE.get(key)!;
  const rep: Record<string, number> = { small: 1 / 3, half: 0.5, twothirds: 0.7, pot: 1, allin: 1 };
  let out: { frac: number; source: string } | null = null;
  const t = sizeMixTable();
  for (const pl of [players, 'all'])
    for (const g of [game, 'pooled'])
      for (const m of [mode, 'all']) {
        if (out) break;
        for (const o of ['horse_present', 'any']) {
          const k = [g, m, street, 'all', pl, o, actor].join('|');
          const c = t[k];
          if (!c || !c.betBands) continue;
          let n = 0;
          let s = 0;
          for (const [b, x] of Object.entries(c.betBands)) {
            if (!(b in rep)) continue;
            n += x;
            s += x * rep[b];
          }
          if (n >= 30) {
            out = { frac: s / n, source: `${k} bet bands (n=${n})` };
            break;
          }
        }
      }
  SIZE_MIX_CACHE.set(key, out);
  return out;
}
function sizeMixTable(): Record<string, { betBands?: Record<string, number> }> {
  return (
    (TABLE as unknown as { betFrequency?: Record<string, { betBands?: Record<string, number> }> })
      .betFrequency ?? {}
  );
}
