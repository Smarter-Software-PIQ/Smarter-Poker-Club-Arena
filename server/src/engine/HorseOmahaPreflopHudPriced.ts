/**
 * B4: PRICED SIX-MAX OMAHA PREFLOP READ ON LIFETIME HUD CELLS (2026-11-21, PLO-OWNER lead-4;
 * option omahaPreflopReadIsPricedFromLifetime, default OFF, requires omahaOpponentLifetimeHud === true).
 *
 * Retires the preflop half of `plo_opponent_presumed_aggressive` (~52.3% of daily fires) for
 * 3–6 dealt PLO4/PLO5 cash (tables + Lightning), high only, single board, non-bomb-pot, non-AoF:
 *   1. Enables `opponentLifetimeHudPreflopSixMax` in `HorseMind.setDecisionReadOptions`, so every
 *      6-max preflop `HorseMind.opponentRead` reads the opponent's lifetime public HUD counters
 *      (`hudExploitCounters`) instead of `presumedAggressorRead` (zero presumption fires).
 *   2. At the `maniac_pressure_preflop` site (`HorseLogic.ts`), whenever retiring the presumption
 *      removes a maniac-pressure width (`widened === true`), prices the raise against call/fold
 *      directly from the opponents' six-max (`sh`) lifetime HUD cells (`hudStatIn(..., 'sh')` plus
 *      exact `pf.lr` for limpers facing iso and exact `pf.bvo` for blinds facing open) with
 *      continuous `n / (n + k)` shrinkage, zero sample cliff, zero person-vs-Horse key, and zero
 *      unshown hole cards.
 *   3. Uses single-raised-pot realization when `raises === 0` (unopened/limped) and
 *      `omahaReraisedCallRealization` when `raises >= 1` (3-bet/4-bet pots); single-pass
 *      common-random-numbers equity via `omahaReraisedEquity` (100 samples, p50 < 2 ms).
 *   4. Strictly silent (`null` -> keeps legacy width) when `pf.lr` / `pf.bvo` is missing on
 *      limped/unopened blinds, or when `raises >= 2` is owned by
 *      `omahaPreflopReraiseDefencePricedInPosition` / `omahaFourBetFoldPricedCall`.
 *
 * Pure over the installed HUD packet: no database, no clock, no random draw from the brain's stream.
 */
import type { Card } from '../types.js';
import { omahaPreflopPercentile } from './HorseEval.js';
import { omahaReraisedEquity, omahaReraisedEquityAgainst } from './HorseOmahaReraisedPot.js';
import { omahaReraisedCallRealization } from './HorseOmahaOopReraisedPot.js';
import { hudPreflopExactCounts, hudStat, HUD_DEFAULT_K } from './opponentHud/OpponentHud.js';
import type { HudFamily, HudTableSize } from './opponentHud/OpponentHudProfile.js';

export interface SixMaxPreflopPlayer {
  seat: number;
  user_id: string;
  cards?: Card[];
  knownDeadCards?: Card[];
  stack?: number;
  bet?: number;
  is_folded?: boolean;
  is_all_in?: boolean;
  is_sitting_out?: boolean;
}

export interface SixMaxPreflopAction {
  stage?: string;
  seat: number;
  userId?: string;
  action: string;
  amount?: number;
  isFullRaise?: boolean;
}

export interface SixMaxPreflopGameState {
  stage?: unknown;
  gameVariant?: unknown;
  gameMode?: unknown;
  tournament?: unknown;
  variantRules?: { splitLow8OrBetter?: boolean } | null;
  bombPot?: boolean;
  allInOrFold?: boolean;
  boardCount?: number;
  communityCards2?: readonly unknown[] | null;
  communityCards3?: readonly unknown[] | null;
  bigBlind?: number;
  pot?: number;
  currentBet?: number;
  toCall?: number;
  dealerSeat?: number;
  players?: readonly SixMaxPreflopPlayer[];
  actionHistory?: readonly SixMaxPreflopAction[];
  legalActions?: readonly string[] | null;
}

export const HUD_PREFLOP_SIXMAX_EQUITY_SAMPLES = 100;

/** Prove-it-to-widen EV margin (fraction of current pot) required before HUD widens a preflop action. */
export const HUD_PREFLOP_WIDEN_MIN_MARGIN_POT = 0.02;

export interface HudThreeBetRealization {
  /** Continuous realization penalty (0–0.05 IP, 0–0.10 OOP) from shrunk HUD aggression. */
  realization: number;
  /** True when shrunk preflop 3-bet/PFR or postflop betCheckedTo indicates an aggressive 3-bettor. */
  aggressiveThreeBettor: boolean;
}

export interface PreflopResponseTriplet {
  fold: number;
  call: number;
  raise: number;
}

/** Population prior for limper facing an isolation raise (`pf.lr`, six-max PLO4/PLO5 cash). */
export const HUD_PF_LR_PRIOR: Readonly<PreflopResponseTriplet> = Object.freeze({
  fold: 0.25,
  call: 0.68,
  raise: 0.07,
});

/** Population prior for blind facing a single open/iso raise (`pf.bvo`, six-max PLO4/PLO5 cash). */
export const HUD_PF_BVO_PRIOR: Readonly<PreflopResponseTriplet> = Object.freeze({
  fold: 0.42,
  call: 0.48,
  raise: 0.1,
});

export interface SixMaxPreflopHudVerdict {
  action: 'fold' | 'call' | 'raise';
  evFold: number | null;
  evCall: number | null;
  evRaise: number | null;
  foldAll: number;
  pReraise: number;
}

export interface SixMaxPreflopScopeOpts {
  omahaOpponentLifetimeHud?: boolean;
  omahaPreflopReadIsPricedFromLifetime?: boolean;
  omahaPreflopReraiseDefencePricedInPosition?: boolean;
  omahaPreflopReraiseDefenceOnLifetimeHud?: boolean;
  omahaFourBetFoldPricedCall?: boolean;
  mind?: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function normalizePreflopTriplet(
  fold: number,
  call: number,
  raise: number
): PreflopResponseTriplet {
  const f = Number.isFinite(fold) ? Math.max(0, fold) : 0;
  const c = Number.isFinite(call) ? Math.max(0, call) : 0;
  const r = Number.isFinite(raise) ? Math.max(0, raise) : 0;
  const s = f + c + r;
  if (!(s > 0)) return { fold: 0.5, call: 0.4, raise: 0.1 };
  return { fold: f / s, call: c / s, raise: r / s };
}

/**
 * Continuous `n / (n + k)` shrinkage of exact `pf.lr` or `pf.bvo` counts toward `prior`.
 * Returns `null` when the exact counter is absent from the installed HUD packet (strict silence).
 */
export function shrunkPreflopExactTriplet(
  userId: string,
  family: HudFamily,
  stat: 'pf.lr' | 'pf.bvo',
  size: HudTableSize,
  prior: Readonly<PreflopResponseTriplet> = stat === 'pf.lr' ? HUD_PF_LR_PRIOR : HUD_PF_BVO_PRIOR,
  k: number = HUD_DEFAULT_K
): PreflopResponseTriplet | null {
  const xc = hudPreflopExactCounts(userId, family, stat, size);
  if (xc === null) return null;
  const f = Math.max(0, Number.isFinite(xc.fold) ? xc.fold : 0);
  const c = Math.max(0, Number.isFinite(xc.call) ? xc.call : 0);
  const r = Math.max(0, Number.isFinite(xc.raise) ? xc.raise : 0);
  const n = f + c + r;
  const kk = Math.max(1, k);
  const pr = normalizePreflopTriplet(prior.fold, prior.call, prior.raise);
  return normalizePreflopTriplet(
    (f + kk * pr.fold) / (n + kk),
    (c + kk * pr.call) / (n + kk),
    (r + kk * pr.raise) / (n + kk)
  );
}

const hudNum = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

const postflopOrder = (seat: number, dealerSeat: number | undefined): number => {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
};

/**
 * Continuous six-max (`sh`) shrunk rate for a single HUD stat (`n / (n + k)` toward prior).
 * Falls back to the overall shrunk rate when the `sh` split has zero opps, or `null` if unread.
 */
function readShRate(
  userId: string,
  family: HudFamily,
  stat: string,
  fallback: number
): number | null {
  const base = hudStat(userId, family, stat, null, false);
  const priorOrBase = base.prior ?? base.p ?? fallback;
  if (typeof priorOrBase !== 'number' || !Number.isFinite(priorOrBase)) return null;
  const split = hudPreflopExactCounts(userId, family, stat, 'sh');
  if (split && Number.isFinite(split.opps) && split.opps > 0) {
    const n = split.opps;
    const h = clamp(Number.isFinite(split.hits) ? split.hits : 0, 0, n);
    const prior =
      typeof base.prior === 'number' && Number.isFinite(base.prior) ? base.prior : priorOrBase;
    return clamp((h + HUD_DEFAULT_K * prior) / (n + HUD_DEFAULT_K), 0.01, 0.99);
  }
  const v = base.p ?? base.prior;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return clamp(v, 0.01, 0.99);
}

/**
 * Continuous 3-bet realization margin for `HorseLogic.ts` V53 (`raises === 2`) when B4 retires
 * `presumedAggressorRead` on 6-max preflop. Scales smoothly from `pf.3bet`, `pf.pfr` (`sh`) and
 * postflop `f.betCk` with zero sample cliff, so passive-postflop / aggressive-preflop 3-bettors
 * never collapse realization from `0.05/0.10` to `0.00`.
 */
export function hudThreeBetRealizationMargin(
  userId: string,
  family: HudFamily,
  inPosition: boolean
): HudThreeBetRealization {
  const threeBet = readShRate(userId, family, 'pf.3bet', 0.08) ?? 0.08;
  const pfr = readShRate(userId, family, 'pf.pfr', 0.18) ?? 0.18;
  const betCkBase = hudStat(userId, family, 'f.betCk', null, false);
  const betCkRaw = betCkBase.p ?? betCkBase.prior ?? 0.38;
  const betCk = clamp(Number.isFinite(betCkRaw) ? betCkRaw : 0.38, 0.01, 0.99);
  const intensity = clamp(
    Math.max((threeBet - 0.1) / 0.12, (pfr - 0.28) / 0.14, (betCk - 0.42) / 0.15),
    0,
    1
  );
  const realization = inPosition ? 0.05 * intensity : 0.1 * intensity;
  const aggressiveThreeBettor = threeBet >= 0.11 || pfr >= 0.28 || betCk >= 0.45;
  return { realization, aggressiveThreeBettor };
}

/**
 * Prove-it-to-widen check: a HUD preflop widening (`raise` or `call`) stands only when the priced
 * verdict strictly beats the passive baseline by at least `marginPot * pot`.
 * For `threebet` (3-betting a wide opener at `raises === 1`), proves raising is strictly `+EV`
 * (`> marginPot * pot`) and not materially worse than calling (`evRaise >= evCall - 0.05 * pot`),
 * avoiding MC tie-vetoes on value 3-bets against genuinely wide openers.
 */
export function omahaPreflopHudWideningProved(
  verdict: SixMaxPreflopHudVerdict | null,
  pot: number,
  target: 'raise' | 'call' | 'threebet',
  marginPot: number = HUD_PREFLOP_WIDEN_MIN_MARGIN_POT
): boolean {
  if (!verdict || !(pot > 0) || !Number.isFinite(pot)) return false;
  const margin = Math.max(0, marginPot) * pot;
  if (target === 'raise') {
    if (verdict.action !== 'raise' || verdict.evRaise === null) return false;
    const baseline = Math.max(verdict.evFold ?? -Infinity, verdict.evCall ?? -Infinity);
    if (!Number.isFinite(baseline)) return verdict.evRaise > margin;
    return verdict.evRaise > baseline + margin;
  }
  if (target === 'threebet') {
    if (verdict.evRaise === null) return false;
    const foldEv = verdict.evFold ?? 0;
    if (!(verdict.evRaise > foldEv + margin)) return false;
    if (verdict.evCall !== null && verdict.evRaise < verdict.evCall - 0.05 * pot) return false;
    return true;
  }
  if (verdict.evCall === null) return false;
  const foldEv = verdict.evFold ?? 0;
  return verdict.evCall > foldEv + margin;
}

/**
 * Exact scope gate for B4 (`omahaPreflopReadIsPricedFromLifetime`):
 * PLO4/PLO5 cash (tables + Lightning), high only, single board, non-bomb-pot, non-AoF,
 * PREFLOP only, 3–6 dealt seats (`sh`). Strictly excludes HU (`dealt === 2`) and tournaments.
 */
export function isOmahaPreflopHudPricedInScope(
  player: SixMaxPreflopPlayer,
  gs: SixMaxPreflopGameState,
  opts: SixMaxPreflopScopeOpts
): boolean {
  if (
    opts.omahaOpponentLifetimeHud !== true ||
    opts.omahaPreflopReadIsPricedFromLifetime !== true ||
    opts.mind === false
  )
    return false;
  if (String((gs as { stage?: unknown }).stage ?? 'preflop') !== 'preflop') return false;
  const fam = String(gs.gameVariant ?? '').toLowerCase();
  if (fam !== 'plo4' && fam !== 'plo5') return false;
  if (gs.gameMode === 'tournament' || gs.tournament) return false;
  if (gs.variantRules?.splitLow8OrBetter) return false;
  if (gs.bombPot === true || gs.allInOrFold === true) return false;
  if (
    Number(gs.boardCount ?? 1) > 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0
  )
    return false;
  const hole = player.cards ?? [];
  if (hole.length !== Number(fam.at(-1))) return false;
  const dealt = (gs.players ?? []).filter((p) => !p.is_sitting_out || p.is_all_in).length;
  return dealt >= 3 && dealt <= 6;
}

/**
 * Single-raised-pot equity realization (distinct from 3-bet-pot `omahaReraisedCallRealization`):
 * raising into an unopened or limped pot has far shallower realization penalty than cold-calling
 * an out-of-position 3-bet pot.
 */
function srpRealization(inPosition: boolean, extraCallers: number): number {
  const base = inPosition ? 0.96 : 0.84;
  return clamp(base - 0.06 * Math.max(0, extraCallers), 0.62, 1);
}

const topWidthPredicate = (w: number): ((h: readonly Card[]) => boolean) => {
  const lo = 1 - clamp(w, 0.02, 1);
  return (h: readonly Card[]) => omahaPreflopPercentile([...h], false) >= lo;
};

/**
 * Prices the 6-max preflop decision directly on `sh` lifetime HUD cells (`hudStatIn(..., 'sh')`,
 * exact `pf.lr`, exact `pf.bvo`) with continuous `n / (n + k)` shrinkage and single-pass CRN
 * equity sampling. Returns `null` when out of scope, unpriceable, missing exact `pf.lr`/`pf.bvo`
 * on limped/unopened blinds, or when `raises >= 2` is owned by the dedicated re-raise pricing rules.
 */
export function priceOmahaPreflopHudSixMax(
  player: SixMaxPreflopPlayer,
  gs: SixMaxPreflopGameState,
  lastRaiserSeat: number,
  opts: SixMaxPreflopScopeOpts,
  samples: number = HUD_PREFLOP_SIXMAX_EQUITY_SAMPLES
): SixMaxPreflopHudVerdict | null {
  if (!isOmahaPreflopHudPricedInScope(player, gs, opts)) return null;
  const fam = String(gs.gameVariant ?? '').toLowerCase() as HudFamily;
  const hole = player.cards ?? [];
  const dead = player.knownDeadCards ?? [];
  const heroBet = hudNum(player.bet);
  const currentBet = hudNum(gs.currentBet);
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, currentBet - heroBet);
  const pot = hudNum(gs.pot);
  const stack = hudNum(player.stack);
  if (!(pot > 0) || !(stack > 0)) return null;

  const live = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out && !p.is_all_in
  );
  if (live.length === 0) return null;

  const history = (gs.actionHistory ?? []).filter((a) => a.stage === 'preflop');
  const raises = history.filter(
    (a) =>
      a.action === 'raise' ||
      a.action === 'bet' ||
      (a.action === 'all_in' && a.isFullRaise !== false)
  ).length;
  // Law 12: never double-price 3-bet/4-bet defence spots owned by dedicated priced rules (incl. R3)
  if (
    raises >= 2 &&
    (opts.omahaPreflopReraiseDefencePricedInPosition === true ||
      opts.omahaPreflopReraiseDefenceOnLifetimeHud === true ||
      opts.omahaFourBetFoldPricedCall === true)
  ) {
    return null;
  }

  const voluntarySeats = new Set(
    history
      .filter(
        (a) =>
          a.action === 'call' || a.action === 'raise' || a.action === 'bet' || a.action === 'all_in'
      )
      .map((a) => a.seat)
  );
  const limperSeats = new Set(
    raises === 0 ? history.filter((a) => a.action === 'call').map((a) => a.seat) : []
  );

  const unitBB = Math.max(1e-9, hudNum(gs.bigBlind) || 1);
  let unread = false;
  const shRate = (userId: string, stat: string, fallback: number): number => {
    const v = readShRate(userId, fam, stat, fallback);
    if (v === null) {
      unread = true;
      return fallback;
    }
    return v;
  };

  interface OppModel {
    player: SixMaxPreflopPlayer;
    isRaiser: boolean;
    isLimper: boolean;
    isCaller: boolean;
    isBlindBehind: boolean;
    vpip: number;
    pfr: number;
    threeBet: number;
    f3bet: number;
    vsRaise: PreflopResponseTriplet;
  }

  const models: OppModel[] = [];
  for (const p of live) {
    const isRaiser = p.seat === lastRaiserSeat;
    const isLimper = raises === 0 && limperSeats.has(p.seat);
    const isCaller = raises >= 1 && !isRaiser && voluntarySeats.has(p.seat);
    const isBehind = !isRaiser && !isLimper && !isCaller && !voluntarySeats.has(p.seat);
    const isBlindBehind = isBehind && hudNum(p.bet) > 0 && hudNum(p.bet) <= unitBB * 1.05;

    const vpip = shRate(p.user_id, 'pf.vpip', 0.42);
    const pfr = shRate(p.user_id, 'pf.pfr', 0.18);
    const threeBet = shRate(p.user_id, 'pf.3bet', 0.08);
    const f3bet = shRate(p.user_id, 'pf.f3bet', 0.45);
    if (unread) return null;

    let vsRaise: PreflopResponseTriplet;
    if (isLimper) {
      // Law 11: limpers require exact pf.lr (strict silence when absent)
      const lr = shrunkPreflopExactTriplet(p.user_id, fam, 'pf.lr', 'sh');
      if (lr === null) return null;
      vsRaise = lr;
    } else if (raises === 0 && isBlindBehind) {
      // Law 11: behind blinds in unopened/limped pots require exact pf.bvo (strict silence when absent)
      const bvo = shrunkPreflopExactTriplet(p.user_id, fam, 'pf.bvo', 'sh');
      if (bvo === null) return null;
      vsRaise = bvo;
    } else if (isRaiser) {
      const f = clamp(f3bet, 0.05, 0.95);
      const r4 = clamp(shRate(p.user_id, 'pf.4bet', 0.08), 0.01, 1 - f);
      vsRaise = normalizePreflopTriplet(f, Math.max(0.02, 1 - f - r4), r4);
    } else {
      const r = clamp(threeBet, 0.01, 0.5);
      const c = clamp(vpip - r, 0.02, 0.85);
      vsRaise = normalizePreflopTriplet(Math.max(0.05, 1 - c - r), c, r);
    }
    models.push({
      player: p,
      isRaiser,
      isLimper,
      isCaller,
      isBlindBehind,
      vpip,
      pfr,
      threeBet,
      f3bet,
      vsRaise,
    });
  }

  const order = (seat: number) => postflopOrder(seat, gs.dealerSeat);
  const inPosition = live.every((p) => order(p.seat) < order(player.seat));
  const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  const canCall = legal === null || legal.includes('call') || legal.includes('check');
  const canRaise = legal === null || legal.includes('raise') || legal.includes('bet');
  const raiseTo = Math.min(heroBet + stack, currentBet + pot + toCall);
  const maxOppStack = Math.max(...live.map((p) => hudNum(p.stack)));

  const realizeFor = (
    potAfter: number,
    behindStack: number,
    extraCallers: number,
    is3BetPot: boolean
  ): number => {
    if (!is3BetPot) return srpRealization(inPosition, extraCallers);
    return omahaReraisedCallRealization(
      inPosition,
      behindStack / Math.max(1e-9, potAfter),
      Math.max(0, extraCallers)
    );
  };

  // Single-pass common-random-numbers 1-opponent equity pool for low latency & smooth monotonicity
  const crnPool: Array<{ pct: number; res: number }> = [];
  let crnBaseWidth = 0;
  const subSamples = Math.max(40, Math.floor(samples / 2));

  const sampleSingle = (width: number): number | null => {
    const w = clamp(width, 0.02, 1);
    const lo = 1 - w;
    if (crnBaseWidth >= w - 1e-9 && crnPool.length > 0) {
      let sum = 0;
      let cnt = 0;
      for (const s of crnPool) {
        if (s.pct >= lo) {
          sum += s.res;
          cnt++;
        }
      }
      if (cnt >= 12) return sum / cnt;
    }
    const collect = crnPool.length === 0 || w > crnBaseWidth;
    const drawn: Array<{ pct: number; res: number }> = [];
    const eq = omahaReraisedEquity(
      hole,
      [],
      dead,
      (h) => omahaPreflopPercentile([...h], false) >= lo,
      collect ? samples : subSamples,
      collect
        ? (opp, res) => {
            drawn.push({ pct: omahaPreflopPercentile([...opp], false), res });
          }
        : undefined
    );
    if (collect && eq !== null && drawn.length > 0) {
      crnPool.length = 0;
      crnPool.push(...drawn);
      crnBaseWidth = w;
    }
    return eq;
  };

  const evFold = toCall > 0.005 ? 0 : null;

  // EV(call / check)
  let evCall: number | null = null;
  if (canCall || toCall <= 0.005) {
    const callCost = toCall <= 0.005 ? 0 : Math.min(toCall, stack);
    const activeModels = models.filter((m) => m.isRaiser || m.isLimper || m.isCaller);
    const eqCall =
      activeModels.length <= 1
        ? sampleSingle(
            activeModels.length === 1
              ? activeModels[0]!.isRaiser
                ? activeModels[0]!.pfr
                : activeModels[0]!.vpip
              : (models[0]?.vpip ?? 0.42)
          )
        : omahaReraisedEquityAgainst(
            hole,
            dead,
            activeModels.slice(0, 2).map((m) => topWidthPredicate(m.isRaiser ? m.pfr : m.vpip)),
            samples
          );
    if (eqCall === null || !Number.isFinite(eqCall)) return null;
    const potAfter = pot + callCost;
    const behind = Math.max(0, Math.min(stack - callCost, maxOppStack));
    // Calling an open (raises <= 1) is a single-raised pot; only raises >= 2 is a 3-bet+ pot.
    evCall =
      realizeFor(potAfter, behind, Math.max(0, activeModels.length - 1), raises >= 2) *
        eqCall *
        potAfter -
      callCost;
  }

  // EV(raise)
  let evRaise: number | null = null;
  let foldAll = 0;
  let pReraise = 0;
  if (canRaise && raiseTo > heroBet + toCall + 0.005) {
    const invest = Math.min(raiseTo - heroBet, stack);
    const toLevel = heroBet + invest;
    let pFoldAll = 1;
    let pNoReraise = 1;
    let expectedCallers = 0;
    let primaryCaller: OppModel | null = null;
    let bestCall = -1;
    let primaryReraiser: OppModel | null = null;
    let bestReraise = -1;

    for (const m of models) {
      pFoldAll *= m.vsRaise.fold;
      // Non-independent cap on sequential behind 3-bets so 4 passive players behind don't stack to 45%
      const rEff =
        m.isRaiser || m.isBlindBehind || m.isLimper ? m.vsRaise.raise : m.vsRaise.raise * 0.7;
      pNoReraise *= 1 - clamp(rEff, 0, 0.9);
      expectedCallers += m.vsRaise.call;
      if (m.vsRaise.call > bestCall) {
        bestCall = m.vsRaise.call;
        primaryCaller = m;
      }
      if (rEff > bestReraise) {
        bestReraise = rEff;
        primaryReraiser = m;
      }
    }
    foldAll = clamp(pFoldAll, 0, 1);
    pReraise = clamp(1 - pNoReraise, 0, 1 - foldAll);
    const pCall = Math.max(0, 1 - foldAll - pReraise);

    let evWhenCalled = -invest;
    if (pCall > 1e-6 && primaryCaller) {
      const contWidth = primaryCaller.isRaiser
        ? clamp(primaryCaller.pfr * Math.max(0.1, 1 - primaryCaller.vsRaise.fold), 0.03, 1)
        : clamp(Math.max(primaryCaller.vsRaise.call, primaryCaller.vpip * 0.65), 0.05, 1);
      const eqCalled = sampleSingle(contWidth);
      if (eqCalled === null || !Number.isFinite(eqCalled)) return null;
      const callersCond = clamp(expectedCallers / Math.max(1e-6, 1 - foldAll), 1, 2.5);
      const matchAmt = Math.max(
        0,
        Math.min(toLevel - hudNum(primaryCaller.player.bet), hudNum(primaryCaller.player.stack))
      );
      const potAfter = pot + invest + callersCond * matchAmt;
      const behind = Math.max(
        0,
        Math.min(stack - invest, Math.max(0, hudNum(primaryCaller.player.stack) - matchAmt))
      );
      evWhenCalled =
        realizeFor(potAfter, behind, Math.max(0, callersCond - 1), raises >= 1) *
          eqCalled *
          potAfter -
        invest;
    }

    let evWhenReraised = -invest;
    if (pReraise > 1e-6 && primaryReraiser) {
      const rWidth = clamp(
        primaryReraiser.isRaiser
          ? Math.min(primaryReraiser.pfr * 0.45, 0.25)
          : primaryReraiser.threeBet,
        0.03,
        0.5
      );
      const eqRr = sampleSingle(rWidth);
      if (eqRr === null || !Number.isFinite(eqRr)) return null;
      const oppMatch = Math.max(
        0,
        Math.min(toLevel - hudNum(primaryReraiser.player.bet), hudNum(primaryReraiser.player.stack))
      );
      const oppRem = Math.max(0, hudNum(primaryReraiser.player.stack) - oppMatch);
      const heroRem = Math.max(0, stack - invest);
      const extra = Math.min(heroRem, oppRem, pot + invest + oppMatch);
      const potRr = pot + invest + oppMatch + 2 * extra;
      const behindRr = Math.max(0, Math.min(heroRem - extra, oppRem - extra));
      const evCallRr =
        omahaReraisedCallRealization(inPosition, behindRr / Math.max(1e-9, potRr), 0) *
          eqRr *
          potRr -
        (invest + extra);
      evWhenReraised = Math.max(-invest, evCallRr);
    }

    evRaise = foldAll * pot + pCall * evWhenCalled + pReraise * evWhenReraised;
  }

  const best: [SixMaxPreflopHudVerdict['action'], number][] = [];
  if (evFold !== null) best.push(['fold', evFold]);
  if (evCall !== null) best.push(['call', evCall]);
  if (evRaise !== null) best.push(['raise', evRaise]);
  if (best.length === 0) return null;
  best.sort((a, b) => b[1] - a[1]);
  return { action: best[0]![0], evFold, evCall, evRaise, foldAll, pReraise };
}
