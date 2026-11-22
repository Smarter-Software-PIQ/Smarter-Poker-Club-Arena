/**
 * B3 MATH CORE TURN & RIVER: OPPONENT-LIFETIME-BACKED FACING-BET PRICING
 * (lane core-repair, PLO-OWNER lead-4, CORE-LEAD4-B3-TURN-RIVER-SPEC.md, default OFF behind
 * omahaMathCorePlo5Turn / omahaMathCorePlo5River).
 *
 * Pure, deterministic, identity-free (zero user IDs, zero person/Horse flags, zero wall-clock reads,
 * zero unshown cards). Uses high-volume public action counts already live in OpponentHud:
 *   - cumulative tail of size-resolved first wagers (>= 0.85 * frac over fw1 bins)
 *   - barrel frequency when the street aggressor also made the previous street's last wager
 *   - empirical-Bayes shrinkage toward the conservative baseline rate p_base
 *   - station / nit guard by construction: f_lo <= p_base => excessMass = 0 => 0 flips
 *   - capped turn continuation (zero phantom river barrel fold credit) via lifetimeRiverShare
 *   - river all-in commit guard: K_allin = 25 (RIVER-CORE law)
 *   - current nuts invariant: never folds the current nuts facing a wager
 */
import { type CoreState } from './OmahaMathCore.js';
import { omahaBest, resetOmahaBestMemo } from './OmahaMathCoreEval.js';
import { seededRng } from './OmahaMathCoreEquity.js';
import { holdsCurrentNuts } from './OmahaMathCoreNutsFloor.js';

export const OMAHA_MATH_CORE_TURN_RIVER_VERSION = 'core-turn-river-hud-v1';

/** Exact copy of HUD_FW_EDGES ('fw1'); law-tested for exact equality without coupling omahaMathCore to opponentHud. */
export const OMAHA_MATH_CORE_TR_FW_EDGES: readonly number[] = Object.freeze([
  0.2, 0.232, 0.269, 0.312, 0.362, 0.42, 0.487, 0.565, 0.656, 0.761, 0.882, 1.024, 1.187,
]);

/** Relative lower edge of cumulative tail (all wagers >= 0.85 * frac count toward tail mass). */
export const OMAHA_MATH_CORE_TR_SIZE_EDGE_FRAC = 0.85;

/** Measured pseudo-opportunities k per street & player count (STAB-DEFENCE method of moments, 84,425 decisions). */
export const OMAHA_MATH_CORE_TR_PRIOR_OPPS: Readonly<Record<string, number>> = Object.freeze({
  'turn|hu': 43,
  'river|hu': 33,
  'turn|mw': 62,
  'river|mw': 45,
});

/** Conservative baseline wager frequency p_base: opponents with f_lo <= p_base yield 0 excess mass (station/nit guard). */
export const OMAHA_MATH_CORE_TR_BASELINE_RATE: Readonly<Record<string, number>> = Object.freeze({
  'turn|hu': 0.3,
  'river|hu': 0.28,
  'turn|mw': 0.24,
  'river|mw': 0.22,
});

/** Frequency lower-bound sigma multiplier for f_lo (plain call then applies K_ev = 5 on pool SE; river commit applies K_allin = 25 on full quadrature SE). */
export const OMAHA_MATH_CORE_TR_FREQ_K = 2;

/** River all-in stack-commit EV margin in SE (RIVER-CORE law). */
export const OMAHA_MATH_CORE_TR_RIVER_ALLIN_K = 25;

/** Deterministic pool size per street. */
export const OMAHA_MATH_CORE_TR_POOL = Object.freeze({ turn: 600, river: 4000 });

export interface TurnRiverFirstWagerRecord {
  /** total unopened decisions on this street and player count */
  opps: number;
  /** total first wagers on this street and player count */
  bets: number;
  /** 14 exact geometric size bins ('fw1') summing to bets */
  bins: readonly number[];
  /** optional family population prior rate (capped conservatively at p_base) */
  priorRate?: number | null;
}

export interface TurnRiverBarrelRecord {
  opps: number;
  bets: number;
}

/**
 * Seat-only provider boundary: the core never sees user IDs or person/Horse labels.
 * The HUD adapter outside omahaMathCore resolves seat -> public HUD packet counts.
 */
export interface OmahaMathCoreTurnRiverProvider {
  /** True when a live lifetime HUD packet for this game family is installed for the decision in flight. */
  active?(game: 'plo4' | 'plo5'): boolean;
  firstWager(
    table: unknown,
    seat: number,
    game: 'plo4' | 'plo5',
    street: 'turn' | 'river',
    players: 'hu' | 'mw',
    line?: 'stab' | 'lead'
  ): TurnRiverFirstWagerRecord | null;
  barrel?(
    table: unknown,
    seat: number,
    game: 'plo4' | 'plo5',
    street: 'turn' | 'river',
    players: 'hu' | 'mw'
  ): TurnRiverBarrelRecord | null;
}

let TR_PROVIDER: OmahaMathCoreTurnRiverProvider | null = null;
export function setOmahaMathCoreTurnRiverProvider(p: OmahaMathCoreTurnRiverProvider | null): void {
  TR_PROVIDER = p ?? null;
}
export function omahaMathCoreTurnRiverProvider(): OmahaMathCoreTurnRiverProvider | null {
  return TR_PROVIDER;
}

function okCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/**
 * Cumulative tail count: sums all fw1 bins whose upper edge >= 0.85 * frac (plus overflow bin 13).
 * Counting the full tail eliminates thin-slice dilution when a player mixes sizing across adjacent bins.
 */
export function cumulativeTailBets(bins: readonly number[], frac: number): number {
  const nBins = OMAHA_MATH_CORE_TR_FW_EDGES.length + 1;
  if (!Array.isArray(bins) || bins.length < nBins) return 0;
  const f = Number.isFinite(frac) && frac > 0 ? frac : 0;
  const thr = OMAHA_MATH_CORE_TR_SIZE_EDGE_FRAC * f;
  let sum = 0;
  for (let i = 0; i < OMAHA_MATH_CORE_TR_FW_EDGES.length; i++) {
    if (OMAHA_MATH_CORE_TR_FW_EDGES[i] >= thr && okCount(bins[i])) sum += bins[i];
  }
  const last = bins[OMAHA_MATH_CORE_TR_FW_EDGES.length];
  if (okCount(last)) sum += last;
  return sum;
}

export interface TurnRiverTailFrequencyResult {
  opps: number;
  tailBets: number;
  kPrior: number;
  p0: number;
  pBase: number;
  f: number;
  fSe: number;
  fLo: number;
  excessMass: number;
  usedBarrel: boolean;
}

/**
 * Empirical-Bayes shrunk tail wager frequency and excess-aggression mass above p_base.
 * Barrel sharpening activates only when prevAggressor=true and the barrel lower bound strictly sharpens fLo.
 */
export function turnRiverTailFrequency(
  rec: TurnRiverFirstWagerRecord,
  barrel: TurnRiverBarrelRecord | null | undefined,
  frac: number,
  street: 'turn' | 'river',
  players: 'hu' | 'mw',
  prevAggressor: boolean,
  kFreq: number = OMAHA_MATH_CORE_TR_FREQ_K
): TurnRiverTailFrequencyResult {
  const key = `${street}|${players}`;
  const kPrior = OMAHA_MATH_CORE_TR_PRIOR_OPPS[key] ?? 40;
  const pBase = OMAHA_MATH_CORE_TR_BASELINE_RATE[key] ?? 0.28;
  const p0 =
    typeof rec.priorRate === 'number' && Number.isFinite(rec.priorRate)
      ? Math.min(pBase, Math.max(0, rec.priorRate))
      : pBase;
  const n1 = okCount(rec.opps) ? rec.opps : 0;
  const rawTail = cumulativeTailBets(rec.bins, frac);
  const h1 = Math.min(n1, rawTail);
  const f1 = (h1 + kPrior * p0) / (n1 + kPrior);
  const se1 = Math.sqrt(Math.max(0, f1 * (1 - f1)) / (n1 + kPrior));
  const fLo1 = Math.max(0, f1 - kFreq * se1);

  let opps = n1;
  let tailBets = h1;
  let f = f1;
  let fSe = se1;
  let fLo = fLo1;
  let usedBarrel = false;

  if (prevAggressor && barrel && okCount(barrel.opps) && barrel.opps > 0 && okCount(barrel.bets)) {
    const tailShare = okCount(rec.bets) && rec.bets > 0 ? Math.min(1, rawTail / rec.bets) : 0;
    const n2 = barrel.opps;
    const h2 = Math.min(n2, Math.min(barrel.opps, barrel.bets) * tailShare);
    const f2 = (h2 + kPrior * p0) / (n2 + kPrior);
    const se2 = Math.sqrt(Math.max(0, f2 * (1 - f2)) / (n2 + kPrior));
    const fLo2 = Math.max(0, f2 - kFreq * se2);
    if (fLo2 > fLo1) {
      opps = n2;
      tailBets = h2;
      f = f2;
      fSe = se2;
      fLo = fLo2;
      usedBarrel = true;
    }
  }

  const excessMass = fLo > pBase && fLo > 0 ? (fLo - pBase) / fLo : 0;
  return { opps, tailBets, kPrior, p0, pBase, f, fSe, fLo, excessMass, usedBarrel };
}

/** Worst-for-hero equity on a complete board against the mass-m prefix of (beats, ties, loses). */
function prefixEquity(m: number, beats: number, ties: number): number {
  if (!(m > 0)) return 0;
  const t = Math.max(0, Math.min(ties, m - beats));
  const w = Math.max(0, m - beats - ties);
  return (w + 0.5 * t) / m;
}

/**
 * Conservative river continuation share after a capped turn call: opponent bets every hand that beats Hero
 * plus up to s/(1+s) bluffs, bounded by the upper confidence bound of his lifetime river bet frequency.
 * Hero gets zero phantom river barrel fold credit (capped: true).
 */
export function lifetimeRiverShare(equity: number, sigma: number, budget: number): number {
  const e = Math.max(0, Math.min(1, equity));
  if (!(sigma > 0)) return e;
  const v = 1 - e;
  const bluffs = Math.max(0, Math.min((v * sigma) / (1 + sigma), Math.max(0, budget) - v));
  return Math.max(0, 1 - v - bluffs);
}

export interface TurnRiverCallReceipt {
  version: string;
  applies: boolean;
  reason: string;
  call: boolean;
  capped: boolean;
  commitsStack: boolean;
  street?: 'turn' | 'river';
  opps?: number;
  tailBets?: number;
  usedBarrel?: boolean;
  f?: number;
  fSe?: number;
  fLo?: number;
  pBase?: number;
  excessMass: number;
  share?: number;
  shareLo?: number;
  riverBudget?: number | null;
  finalPot?: number;
  callChips?: number;
  evCall?: number;
  evCallSe?: number;
  evCallLo?: number;
  kApplied?: number;
  pool?: number;
}

const decline = (reason: string): TurnRiverCallReceipt => ({
  version: OMAHA_MATH_CORE_TURN_RIVER_VERSION,
  applies: false,
  reason,
  call: false,
  capped: false,
  commitsStack: false,
  excessMass: 0,
});

export function priceTurnRiverLifetimeCall(input: {
  state: CoreState;
  counts: TurnRiverFirstWagerRecord | null;
  barrel?: TurnRiverBarrelRecord | null;
  riverCounts?: TurnRiverFirstWagerRecord | null;
  net: (finalPot: number) => number;
  k?: number;
  kFreq?: number;
}): TurnRiverCallReceipt {
  const { state, counts, barrel, riverCounts, net } = input;
  const street = state.street;
  if (street !== 'turn' && street !== 'river') return decline('not turn or river');
  const holeLen = Number(String(state.variant).slice(-1));
  const boardLen = street === 'turn' ? 4 : 5;
  if (state.hole.length !== holeLen || state.board.length !== boardLen)
    return decline('card counts');
  if (!(state.toCall > 0.005)) return decline('nothing to call');
  const stack = Math.max(0, state.heroStack);
  if (!(stack > 0)) return decline('no chips');

  const callChips = Math.min(state.toCall, stack);
  const uncalled = Math.max(0, state.toCall - callChips);
  const finalPot = state.pot - uncalled + callChips;
  const commitsStack = callChips >= stack - 0.005;

  // Current nuts invariant: never fold the current nuts facing any wager, regardless of opponent record
  if (holdsCurrentNuts(state.hole, state.board)) {
    const ev = net(finalPot) - callChips;
    return {
      version: OMAHA_MATH_CORE_TURN_RIVER_VERSION,
      applies: true,
      reason: 'current nuts call invariant',
      call: true,
      capped: street === 'turn',
      commitsStack,
      street,
      excessMass: 0,
      share: 1,
      shareLo: 1,
      finalPot,
      callChips,
      evCall: ev,
      evCallSe: 0,
      evCallLo: ev,
      kApplied: 0,
    };
  }

  if (state.aggressorSeat === null || state.line === null)
    return decline('no wager on this street');
  if (state.line === 'raise' || state.line === 'check_raise')
    return decline('a raise, not the first wager of the street');
  const live = state.opponents.filter((o) => !o.folded);
  if (live.length !== 1 || live[0].seat !== state.aggressorSeat)
    return decline('more than one live opponent');
  const agg = live[0];
  if (!counts || !okCount(counts.opps) || !(counts.opps > 0))
    return decline('no lifetime first-wager record');

  const K = typeof input.k === 'number' && Number.isFinite(input.k) && input.k > 0 ? input.k : 5;
  const kFreq =
    typeof input.kFreq === 'number' && Number.isFinite(input.kFreq) && input.kFreq > 0
      ? input.kFreq
      : OMAHA_MATH_CORE_TR_FREQ_K;

  const freq = turnRiverTailFrequency(
    counts,
    barrel,
    state.wagerFrac,
    street,
    'hu',
    agg.prevAggressor,
    kFreq
  );

  const base: TurnRiverCallReceipt = {
    version: OMAHA_MATH_CORE_TURN_RIVER_VERSION,
    applies: true,
    reason: 'priced',
    call: false,
    capped: street === 'turn',
    commitsStack,
    street,
    opps: freq.opps,
    tailBets: freq.tailBets,
    usedBarrel: freq.usedBarrel,
    f: freq.f,
    fSe: freq.fSe,
    fLo: freq.fLo,
    pBase: freq.pBase,
    excessMass: freq.excessMass,
    finalPot,
    callChips,
  };

  // Station / nit guard by construction: zero excess aggression above p_base => zero flips
  if (!(freq.excessMass > 0)) {
    return { ...base, reason: 'no excess aggression above baseline (station/nit guard)' };
  }

  // Deterministic pool of opposing holdings (card removal against hero & board)
  resetOmahaBestMemo();
  const used = new Uint8Array(52);
  for (const c of state.hole) used[c] = 1;
  for (const c of state.board) used[c] = 1;
  const unseen: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) unseen.push(c);
  const N = OMAHA_MATH_CORE_TR_POOL[street];
  const rng = seededRng(`${state.seed}|tr-hud`);
  const deck = unseen.slice();
  const U = deck.length;
  const hold = new Int8Array(N * holeLen);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < holeLen; i++) {
      const x = i + Math.floor(rng() * (U - i));
      const t = deck[i];
      deck[i] = deck[x];
      deck[x] = t;
      hold[j * holeLen + i] = deck[i];
    }
  }
  const h = new Array<number>(holeLen);
  const mOf = (fr: number) => Math.max(0, Math.min(N, fr * N));

  let shareAt: (fr: number) => number;
  let riverBudget: number | null = null;
  if (street === 'river') {
    const heroScore = omahaBest(state.hole, holeLen, state.board, 5);
    let beats = 0;
    let ties = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < holeLen; i++) h[i] = hold[j * holeLen + i];
      const s = omahaBest(h, holeLen, state.board, 5);
      if (s > heroScore) beats++;
      else if (s === heroScore) ties++;
    }
    shareAt = (fr) => prefixEquity(mOf(fr), beats, ties);
  } else {
    const R = U;
    const heroR = new Float64Array(R);
    const b5 = [...state.board, 0];
    for (let r = 0; r < R; r++) {
      b5[4] = unseen[r];
      heroR[r] = omahaBest(state.hole, holeLen, b5, 5);
    }
    const out = new Int8Array(N * R).fill(-1);
    const eqJ = new Float64Array(N);
    const mine = new Uint8Array(52);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < holeLen; i++) {
        h[i] = hold[j * holeLen + i];
        mine[h[i]] = 1;
      }
      let sum = 0;
      let cnt = 0;
      for (let r = 0; r < R; r++) {
        if (mine[unseen[r]]) continue;
        b5[4] = unseen[r];
        const s = omahaBest(h, holeLen, b5, 5);
        const o = heroR[r] > s ? 2 : heroR[r] === s ? 1 : 0;
        out[j * R + r] = o;
        sum += o;
        cnt++;
      }
      eqJ[j] = cnt > 0 ? sum / (2 * cnt) : 0;
      for (let i = 0; i < holeLen; i++) mine[h[i]] = 0;
    }
    const order = Array.from({ length: N }, (_, j) => j).sort((a, c) => eqJ[a] - eqJ[c] || a - c);
    const heroBehind = stack - callChips;
    const hisBehind = Math.max(0, agg.stack) + uncalled;
    const bet = agg.allIn ? 0 : Math.max(0, Math.min(finalPot, heroBehind, hisBehind));
    const sigma = finalPot > 0 ? bet / finalPot : 0;
    const kr = OMAHA_MATH_CORE_TR_PRIOR_OPPS['river|hu'];
    const rn = riverCounts && okCount(riverCounts.opps) ? riverCounts.opps : 0;
    const rb = riverCounts && okCount(riverCounts.bets) ? Math.min(riverCounts.bets, rn) : 0;
    const rf = (rb + kr) / (rn + kr);
    riverBudget = Math.min(1, rf + kFreq * Math.sqrt(Math.max(0, rf * (1 - rf)) / (rn + kr)));
    const budget = riverBudget;
    shareAt = (fr) => {
      if (!(mOf(fr) > 0)) return 0;
      const m = Math.max(1, Math.min(N, Math.floor(mOf(fr))));
      let tot = 0;
      let wsum = 0;
      for (let r = 0; r < R; r++) {
        let s2 = 0;
        let cnt = 0;
        for (let q = 0; q < m; q++) {
          const o = out[order[q] * R + r];
          if (o < 0) continue;
          s2 += o;
          cnt++;
        }
        if (cnt === 0) continue;
        tot += cnt * lifetimeRiverShare(s2 / (2 * cnt), sigma, budget);
        wsum += cnt;
      }
      return wsum > 0 ? tot / wsum : 0;
    };
  }

  const netPot = net(finalPot);
  const sAtF = shareAt(freq.f);
  const sAtFLo = shareAt(freq.fLo);
  const sMinus1 = shareAt(Math.max(0, freq.f - freq.fSe));
  const mLo = Math.max(1, mOf(freq.fLo));
  const sePool = Math.sqrt(Math.max(0, sAtFLo * (1 - sAtFLo)) / mLo);
  const seFull = Math.hypot(Math.max(0, sAtF - sMinus1), sePool);

  // River stack-committing calls require K_allin = 25 on full quadrature SE (RIVER-CORE law);
  // plain calls evaluate worst-case equity at fLo (already kFreq SE below f) minus K * sePool (no double-penalty of fSe).
  const isRiverCommit = street === 'river' && commitsStack;
  const kApplied = isRiverCommit ? OMAHA_MATH_CORE_TR_RIVER_ALLIN_K : K;
  const shareLo = isRiverCommit
    ? Math.max(0, Math.min(sAtFLo, sAtF - kApplied * seFull))
    : Math.max(0, sAtFLo - kApplied * sePool);
  const evCall = sAtFLo * netPot - callChips;
  const evCallSe = (isRiverCommit ? seFull : sePool) * netPot;
  const evCallLo = shareLo * netPot - callChips;
  const proven = shareLo > 0 && evCallLo > 0;
  resetOmahaBestMemo();

  return {
    ...base,
    share: sAtF,
    shareLo,
    riverBudget,
    evCall,
    evCallSe,
    evCallLo,
    kApplied,
    pool: N,
    call: proven,
    reason: proven
      ? 'call proven at opponent-lifetime tail bound'
      : commitsStack && street === 'river'
        ? 'river stack commit did not clear K_allin=25'
        : 'call not proven at opponent-lifetime tail bound',
  };
}
