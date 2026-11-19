/**
 * vpipFloorLimpOnly test support (owner 2026-11-17 14:34 Chicago, finding
 * F-10): the six-seat floored cash table of the recorded PLO5 hand 59518335
 * (HorseOmahaUnderpair.fixture.json: seats, blinds, big blind ante, rake),
 * anonymised to seat numbers, with every seat at 200 big blinds, rebuilt for
 * any preflop line, any variant and any hole cards; and the sitting
 * simulator that extends the 300-hand sitting of
 * HorseOmahaVpipFloorByLimp.test.ts (the harness that produced the
 * VPIP_LIMP_BUFFER_HANDS numbers) to the judged window, the warning, the
 * ten-hand grace and the eviction of fn_nit_enforce (migration
 * 20261111003710), with the production spot mix.
 */
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import {
  HorseLogic,
  VPIP_FLOOR_LIMP_ONLY_VARIANTS,
  type HorseDecideOpts,
  type VpipFloorLimpOnlySelection,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import { readFileSync } from 'node:fs';

// Test data, read from disk rather than imported: a non-test module that
// imports JSON must be listed in tsconfig.emit.json (engine-build-resource-proof),
// and this file is test support, not engine runtime.
const RECORDED: unknown = JSON.parse(
  readFileSync(new URL('./HorseOmahaUnderpair.fixture.json', import.meta.url), 'utf8')
);

export type FloorVariant = 'plo4' | 'plo5' | 'plo6' | 'nlh' | 'plo8' | 'short_deck';
export const HOLE_COUNT: Record<FloorVariant, number> = {
  nlh: 2,
  plo4: 4,
  plo5: 5,
  plo6: 6,
  plo8: 4,
  short_deck: 2,
};
/** No-limit betting (hold'em and short deck); every other variant here is pot limit. */
const noLimit = (variant: FloorVariant): boolean => variant === 'nlh' || variant === 'short_deck';
/** The ranks dealt: short deck has no deuce to five. */
const ranksOf = (variant: FloorVariant): string =>
  variant === 'short_deck' ? '6789TJQKA' : '23456789TJQKA';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
export const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

export const LIVE = replayProfiles('cash').find((p) => p.live)!;

/**
 * The option switch states every journaled decision of release 28372c9a
 * carried (replayState.options and replayState.style, all "on"; audit
 * 01BNteGYgf originals/journal), as decide() options. Both arms of every
 * comparison start from this set; it is what production decided with.
 */
export const PRODUCTION_28372C9A: HorseDecideOpts = {
  holdemCallDownExcludesCurrentHand: true,
  holdemCallDownNeedsStyleEvidence: true,
  holdemGearShiftReach: true,
  holdemManiacSampleGate: true,
  holdemPersonaReRaiseMix: true,
  holdemRiverFullHouseValue: true,
  horseActionTimeIsPublicOnly: true,
  icmBustPaysPlace: true,
  omahaBareOverpairOopFlopCheck: true,
  omahaBigBetIsPotShare: true,
  omahaBigDrawAggression: true,
  omahaBluffCatcherFoldVsValueLeader: true,
  omahaCardImpact: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaFacingBetEv: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaOopReraisedPotStrongRange: true,
  omahaOopTurnCheckAfterFlopCall: true,
  omahaOverpairNoOopBarrelVsValueLeader: true,
  omahaPairedBoardFoldRespectsPrice: true,
  omahaPairedRiverNoThinLeadVsValueLeader: true,
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
  omahaPressureNeedsPostflopAggression: true,
  omahaReraiseRangeEarlyPosition: true,
  omahaReraiseRangeOutOfPosition: true,
  omahaReraisedPotFlopContinueNeedsEquityShape: true,
  omahaRiverMediumBetStrongHandCalls: true,
  omahaRiverNutBlockerBluffReachable: true,
  omahaStrategyInTournaments: true,
  omahaStreetPlan: true,
  omahaStrongHandSlowplayMix: true,
  omahaStrongHandValue: true,
  omahaTurnBetNeedsRiverPlan: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
  omahaVpipFloorByLimp: true,
  styleTightMultiSignal: true,
  styleTightPlayerExploit: true,
  styleBigBetHonesty: true,
  styleFoldBluff: true,
  styleFoldRatePreRepair: true,
  styleRaiseRespect: true,
  styleTightReRaiserRespect: true,
  styleValueBettorNotManiac: true,
  styleValueExtraction: true,
};

/** A voluntary preflop action before the Horse's: fold, call (the price), or a pot raise. */
export type Prior =
  | [seat: number, action: 'fold' | 'call' | 'pot']
  /** a raise to an exact total bet (the self-play table replays the amount a Horse chose) */
  | [seat: number, action: 'raise', to: number];

export interface Spot {
  /** The deciding Horse's seat: 1 UTG, 2 HJ, 3 CO, 4 button, 5 small blind, 6 big blind. */
  hero: number;
  prior: Prior[];
}

export interface Table {
  variant: FloorVariant;
  /** The table's VPIP floor, percent; 0 = no floor (the field is absent). */
  floor: number;
  window?: number;
  ownVpip?: { hands: number; vpip: number | null };
  straddleActive?: boolean;
}

const BB = 2;
const BEHIND = 400; // 200 big blinds

/** The fixture for `spot` at `table` with `hole` on the hero. */
export function buildFixture(spot: Spot, table: Table, hole: Card[]): ComplaintFixture {
  const base = JSON.parse(JSON.stringify(RECORDED)) as ComplaintFixture;
  const template = base.actions.find((a) => a.ord === 7)!.publicNode!;
  // seat -> [behind, bet, total, dead, folded]
  const st = new Map<
    number,
    { behind: number; bet: number; total: number; dead: number; folded: boolean }
  >();
  for (let s = 1; s <= 6; s++)
    st.set(s, { behind: BEHIND, bet: 0, total: 0, dead: 0, folded: false });
  const actions: ComplaintFixture['actions'] = [];
  const add = (
    seat: number,
    action: string,
    amount: number,
    origin: string,
    full = false,
    dead = false
  ) =>
    actions.push({
      ord: actions.length + 1,
      seat,
      stage: 'preflop',
      action,
      amount,
      origin,
      isFullRaise: full,
      dead,
    });
  const sb = st.get(5)!;
  sb.behind -= 1;
  sb.bet = 1;
  sb.total = 1;
  const bbs = st.get(6)!;
  bbs.behind -= 4;
  bbs.bet = 2;
  bbs.total = 4;
  bbs.dead = 2;
  add(5, 'sb', 1, 'forced');
  add(6, 'bb', 2, 'forced');
  add(6, 'ante', 2, 'forced', false, true);
  let currentBet = BB;
  let lastRaise = BB;
  const pot = () => [...st.values()].reduce((s, x) => s + x.total, 0);
  for (const entry of spot.prior) {
    const [seat, act] = entry;
    const exactTo = entry.length > 2 ? (entry as [number, 'raise', number])[2] : undefined;
    const p = st.get(seat)!;
    if (act === 'fold') {
      p.folded = true;
      add(seat, 'fold', 0, 'horse_policy');
    } else if (act === 'call') {
      const put = currentBet - p.bet;
      p.behind -= put;
      p.bet += put;
      p.total += put;
      add(seat, 'call', put, 'horse_policy');
    } else {
      const toCall = currentBet - p.bet;
      const to =
        act === 'raise'
          ? Number(exactTo)
          : noLimit(table.variant)
            ? currentBet + Math.max(lastRaise, 3 * BB)
            : currentBet + pot() + toCall;
      const put = to - p.bet;
      lastRaise = to - currentBet;
      currentBet = to;
      p.behind -= put;
      p.bet = to;
      p.total += put;
      add(seat, 'raise', to, 'horse_policy', true);
    }
  }
  const h = st.get(spot.hero)!;
  const toCall = Math.max(0, currentBet - h.bet);
  const potNow = pot();
  const maxTo = noLimit(table.variant)
    ? h.behind + h.bet
    : Math.min(h.behind + h.bet, currentBet + potNow + toCall);
  const pn = {
    ...template,
    pot: potNow,
    seats: [...st.entries()].map(([s, x]) => [
      s,
      x.behind,
      x.bet,
      x.total,
      x.dead,
      0,
      x.folded ? 1 : 0,
    ]),
    toCall,
    currentBet,
    minRaiseTo: Math.min(maxTo, currentBet + Math.max(lastRaise, BB)),
    maxRaiseTo: maxTo,
    legalActions: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'raise', 'all_in'],
    actorSeat: spot.hero,
    variant: table.variant,
    structure: noLimit(table.variant) ? 'no_limit' : 'pot_limit',
    vpipWindowHands: table.window ?? 30,
  } as typeof template;
  if (table.floor > 0) pn.vpipFloor = table.floor;
  else {
    delete pn.vpipFloor;
    delete pn.vpipWindowHands;
  }
  if (table.ownVpip !== undefined && table.floor > 0) pn.ownVpip = table.ownVpip;
  else delete pn.ownVpip;
  add(spot.hero, 'call', toCall, 'horse_policy');
  actions[actions.length - 1].publicNode = pn;
  base.variant = table.variant;
  base.hole = { [String(spot.hero)]: hole };
  base.actions = actions;
  return base;
}

export interface Decided {
  decision: HorseDecision;
  /** The random-number state after the decision (draw for draw identity). */
  next: number;
  toCall: number;
}

export function decideAt(
  spot: Spot,
  table: Table,
  hole: string | Card[],
  opts: HorseDecideOpts,
  seed: number,
  mutate?: (gs: Record<string, unknown>) => void
): Decided {
  HorseMind.reset();
  seedFastRandom(seed);
  // the public action-time stream is its own; seeded so a think time repeats
  seedHorseTimingRandom(seed);
  const fx = buildFixture(spot, table, typeof hole === 'string' ? cards(hole) : hole);
  const st = stateAt(fx, fx.actions[fx.actions.length - 1]);
  if (table.straddleActive) (st.gs as unknown as Record<string, unknown>).straddleActive = true;
  mutate?.(st.gs as unknown as Record<string, unknown>);
  const decision = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    mind: false,
    ...opts,
  });
  return { decision, next: fastRandom(), toCall: st.pn.toCall };
}

// ── the spot catalogue ────────────────────────────────────────────────────
const folds = (...s: number[]): Prior[] => s.map((x) => [x, 'fold'] as Prior);
export const SPOTS = {
  utgFirstIn: { hero: 1, prior: [] },
  hjFirstIn: { hero: 2, prior: folds(1) },
  coFirstIn: { hero: 3, prior: folds(1, 2) },
  btnFirstIn: { hero: 4, prior: folds(1, 2, 3) },
  hjLimped: { hero: 2, prior: [[1, 'call']] },
  coLimped: {
    hero: 3,
    prior: [
      [1, 'call'],
      [2, 'fold'],
    ],
  },
  btnLimped: {
    hero: 4,
    prior: [
      [1, 'call'],
      [2, 'fold'],
      [3, 'fold'],
    ],
  },
  sbFirstIn: { hero: 5, prior: folds(1, 2, 3, 4) },
  bbOption: { hero: 6, prior: [...folds(1, 2, 3, 4), [5, 'call']] },
  /** the recorded line of hand 59518335 decision 7: an open and two calls to the button */
  btnFacingOpenTwoCalls: {
    hero: 4,
    prior: [
      [1, 'pot'],
      [2, 'call'],
      [3, 'call'],
    ],
  },
  sbFacingButtonOpen: { hero: 5, prior: [...folds(1, 2, 3), [4, 'pot']] },
  bbFacingCutoffOpenAndCall: {
    hero: 6,
    prior: [...folds(1, 2), [3, 'pot'], [4, 'call'], [5, 'fold']],
  },
  /** the recorded line of decision 9: an open, two calls and the button's re-raise to the big blind */
  bbFacingReRaise: {
    hero: 6,
    prior: [
      [1, 'pot'],
      [2, 'call'],
      [3, 'call'],
      [4, 'pot'],
      [5, 'fold'],
    ],
  },
} satisfies Record<string, Spot>;
export type SpotName = keyof typeof SPOTS;

/** The hero limped first in (or completed) and the next live seat raised the pot. */
export function limpedThenRaised(spot: Spot): Spot {
  const prior = [...spot.prior, [spot.hero, 'call'] as Prior];
  const acted = new Set(prior.map(([s]) => s));
  const order = [1, 2, 3, 4, 5, 6];
  const behind = order.filter((s) => s > spot.hero && !acted.has(s));
  if (spot.hero === 6 || behind.length === 0) return { hero: spot.hero, prior };
  const raiser = behind.includes(6) ? 6 : behind[behind.length - 1];
  for (const s of behind) prior.push(s === raiser ? [s, 'pot'] : [s, 'fold']);
  // the limpers before the hero fold to the raise
  for (const [s, a] of spot.prior) if (a === 'call' && s !== spot.hero) prior.push([s, 'fold']);
  return { hero: spot.hero, prior };
}

/**
 * The production mix of a Horse's first preflop decision of a hand at the
 * 50% PLO5 Classic table, release 28372c9a and 3529e866 journal (6,363 first
 * decisions; audit F-10 raw/spot-mix.txt): unopened or limped 39.4%, small
 * blind unopened 2.1%, big blind option 1.1%, facing one raise 43.6%, facing a
 * re-raise 13.8%; and 89.1% of the Horses' unraised-pot limps were raised.
 * The split inside each class over seats is a declared model, not measured.
 */
export const PRODUCTION_MIX: ReadonlyArray<[SpotName, number]> = [
  ['utgFirstIn', 0.07],
  ['hjFirstIn', 0.06],
  ['coFirstIn', 0.06],
  ['btnFirstIn', 0.06],
  ['hjLimped', 0.05],
  ['coLimped', 0.045],
  ['btnLimped', 0.049],
  ['sbFirstIn', 0.021],
  ['bbOption', 0.011],
  ['btnFacingOpenTwoCalls', 0.15],
  ['sbFacingButtonOpen', 0.14],
  ['bbFacingCutoffOpenAndCall', 0.146],
  ['bbFacingReRaise', 0.138],
];
export const LIMP_RAISED_SHARE = 0.891;

/**
 * SITTING_MODE, the way an Action / Madness table is judged (fn_nit_policy:
 * ruleset_snapshot.vpip_rolling absent = false, vpip_grace_hands absent = 0;
 * fn_nit_sample with p_rolling false takes EVERY hand of the sitting;
 * fn_nit_check says maintain_vpip once the sitting holds `window` hands and
 * its VPIP is under the floor; fn_nit_enforce with grace_hands <= 0 returns
 * the seat for eviction at that boundary, no warning row). `sittingMode: true`
 * on sitting() and tableSitting() models exactly that: the Horse's own figure
 * and the judged figure are the whole sitting, judged at every boundary from
 * hand `window` on, and under the floor is an eviction on the spot. Production
 * 2026-11-19: 17 such tables, all window 10 and floor 40 (NLH, PLO4, PLO5,
 * PLO6, PLO8, short deck).
 */
export interface SittingStats {
  hands: number;
  vpipHands: number;
  judged: number;
  judgedUnder: number;
  warnings: number;
  /** warnings that cleared (a boundary at or over the floor) before the grace ran out */
  recoveries: number;
  evictedAtHand: number | null;
  /** entries the floored decision made where the same decision without the floor folds */
  floorEntries: number;
  floorRaises: number;
  /** calls of a raised pot the floored decision made where the unfloored decision folds (first
   *  decisions, and the decision facing the raise behind a limp) */
  floorRaisedPotCalls: number;
  /** chips (big blinds) put in by those floor-made entries */
  floorChipsBB: number;
  /** chips (big blinds) the hand's own unfloored decision put in later in a hand the floor entered */
  followOnChipsBB: number;
  windowCounts: number[];
}

/**
 * One Horse's sitting at a floored table: one hand at a time, the first
 * preflop decision drawn from `mix`, and, after a limp, the raise behind it
 * with LIMP_RAISED_SHARE. The Horse's own judged VPIP is the rolling `window`
 * of its dealt hands (fn_nit_sample), rounded to 0.1 as fn_nit_status returns
 * it. At each hand boundary, fn_nit_enforce: with a full window under the
 * floor a warning opens; at or over the floor it clears; still under once
 * `grace` dealt hands have passed since the warning, the seat is evicted and
 * the sitting ends.
 */
export function sitting(cfg: {
  variant: FloorVariant;
  floor: number;
  opts: HorseDecideOpts;
  hands: number;
  seed: number;
  window?: number;
  grace?: number;
  /** The Action / Madness mode (fn_nit_policy: vpip_rolling false, grace 0): see SITTING_MODE. */
  sittingMode?: boolean;
  mix?: ReadonlyArray<[SpotName, number]>;
}): SittingStats {
  const window = cfg.window ?? 30;
  const grace = cfg.grace ?? 10;
  const sample = (p: boolean[]) => (cfg.sittingMode === true ? p : p.slice(-window));
  const mix = cfg.mix ?? PRODUCTION_MIX;
  const total = mix.reduce((s, [, w]) => s + w, 0);
  let s = cfg.seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const RANKS = ranksOf(cfg.variant);
  const SUITS = 'cdhs';
  const deal = (): string => {
    const seen = new Set<string>();
    while (seen.size < HOLE_COUNT[cfg.variant])
      seen.add(RANKS[Math.floor(rnd() * RANKS.length)] + SUITS[Math.floor(rnd() * 4)]);
    return [...seen].join('');
  };
  const played: boolean[] = [];
  const out: SittingStats = {
    hands: 0,
    vpipHands: 0,
    judged: 0,
    judgedUnder: 0,
    warnings: 0,
    recoveries: 0,
    evictedAtHand: null,
    floorEntries: 0,
    floorRaises: 0,
    floorRaisedPotCalls: 0,
    floorChipsBB: 0,
    followOnChipsBB: 0,
    windowCounts: [],
  };
  let warnedAt: number | null = null;
  const entered = (d: HorseDecision) =>
    d.action === 'call' || d.action === 'raise' || d.action === 'all_in';
  const put = (d: Decided, heroBet: number) =>
    d.decision.action === 'call'
      ? d.toCall
      : d.decision.action === 'raise' || d.decision.action === 'all_in'
        ? Math.max(0, Number(d.decision.amount ?? 0) - heroBet)
        : 0;
  for (let h = 0; h < cfg.hands; h++) {
    const hole = deal();
    let r = rnd() * total;
    let name: SpotName = mix[mix.length - 1][0];
    for (const [n, w] of mix) {
      if (r < w) {
        name = n;
        break;
      }
      r -= w;
    }
    const spot = SPOTS[name] as Spot;
    const continueRoll = rnd();
    const recent = sample(played);
    const k = recent.filter(Boolean).length;
    const own =
      recent.length > 0
        ? { hands: recent.length, vpip: Math.round((1000 * k) / recent.length) / 10 }
        : { hands: 0, vpip: null };
    const floored: Table = { variant: cfg.variant, floor: cfg.floor, window, ownVpip: own };
    const unfloored: Table = { variant: cfg.variant, floor: 0 };
    const heroBetAt = (sp: Spot) => (sp.hero === 5 ? 1 : sp.hero === 6 ? 2 : 0);
    const a = decideAt(spot, floored, hole, cfg.opts, h + 1);
    let vpip = entered(a.decision);
    let forced = false;
    if (vpip) {
      const b = decideAt(spot, unfloored, hole, cfg.opts, h + 1);
      if (b.decision.action === 'fold') {
        forced = true;
        out.floorEntries++;
        if (a.decision.action !== 'call') out.floorRaises++;
        else if (spot.prior.some(([, x]) => x === 'pot' || x === 'raise'))
          out.floorRaisedPotCalls++;
        out.floorChipsBB += put(a, heroBetAt(spot)) / BB;
      }
    }
    // A limp (or completion) is raised behind with the measured share.
    const unraised = !spot.prior.some(([, x]) => x === 'pot' || x === 'raise');
    if (a.decision.action === 'call' && unraised && continueRoll < LIMP_RAISED_SHARE) {
      const next = limpedThenRaised(spot);
      if (next.prior.some(([, x]) => x === 'pot')) {
        const c = decideAt(next, floored, hole, cfg.opts, 100000 + h);
        const heroBet = heroBetAt(spot) + a.toCall;
        if (entered(c.decision)) {
          const cu = decideAt(next, unfloored, hole, cfg.opts, 100000 + h);
          if (cu.decision.action === 'fold') {
            out.floorChipsBB += put(c, heroBet) / BB;
            if (c.decision.action === 'call') out.floorRaisedPotCalls++;
            else out.floorRaises++;
          } else if (forced) out.followOnChipsBB += put(c, heroBet) / BB;
        }
        vpip = vpip || entered(c.decision);
      }
    }
    out.hands++;
    if (vpip) out.vpipHands++;
    played.push(vpip);
    // the hand boundary: fn_nit_enforce
    const win = sample(played);
    if (win.length >= window) {
      const kk = win.filter(Boolean).length;
      const pct = Math.round((1000 * kk) / win.length) / 10;
      out.judged++;
      out.windowCounts.push(kk);
      const under = pct < cfg.floor;
      if (under) out.judgedUnder++;
      if (under && cfg.sittingMode === true) {
        // no warning, no grace: stood up at this boundary (fn_nit_enforce, grace_hands <= 0)
        out.evictedAtHand = h + 1;
        break;
      }
      if (!under) {
        if (warnedAt !== null) out.recoveries++;
        warnedAt = null;
      } else if (warnedAt === null) {
        warnedAt = h;
        out.warnings++;
      } else if (h - warnedAt >= grace) {
        out.evictedAtHand = h + 1;
        break;
      }
    }
  }
  return out;
}

// ── measurement arms: the declared variant table, set for one run ──────────
/**
 * Runs `fn` with VPIP_FLOOR_LIMP_ONLY_VARIANTS replaced by `table` and puts the
 * declared table back. Measurement and tests only: it is how an arm asks "what
 * if this variant were governed, with this selection" of a variant the
 * declared table leaves out. Nothing in the engine calls it.
 */
export function withLimpOnlyVariants<T>(
  table: Partial<Record<string, VpipFloorLimpOnlySelection>>,
  fn: () => T
): T {
  const restore = setLimpOnlyVariants(table);
  try {
    return fn();
  } finally {
    restore();
  }
}

/** Replaces the declared table until the returned function is called (a test's beforeEach / afterEach). */
export function setLimpOnlyVariants(
  table: Partial<Record<string, VpipFloorLimpOnlySelection>>
): () => void {
  const live = VPIP_FLOOR_LIMP_ONLY_VARIANTS as Record<string, VpipFloorLimpOnlySelection>;
  const saved = { ...live };
  for (const k of Object.keys(live)) delete live[k];
  Object.assign(live, table);
  return () => {
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, saved);
  };
}

/** Every variant the F-10 evaluation measured, on the priced selection: the table the mechanism is proved on. */
export const MEASURED_VARIANTS_PRICED: Readonly<Record<FloorVariant, VpipFloorLimpOnlySelection>> =
  {
    nlh: 'priced',
    plo4: 'priced',
    plo5: 'priced',
    plo6: 'priced',
  };

// ── the arithmetic bound's inputs: unfloored entry rate per spot ───────────
export interface SpotRate {
  spot: SpotName;
  weight: number;
  raised: boolean;
  hands: number;
  entered: number;
}

/**
 * The same Horse at an UNFLOORED table: over `hands` random hands per spot of
 * `mix`, how often its own decision enters the pot (call, raise or all-in).
 * Facing a raise this is the only VPIP the limp-only ruling leaves a Horse.
 */
export function unflooredEntryRates(cfg: {
  variant: FloorVariant;
  opts: HorseDecideOpts;
  hands: number;
  seed: number;
  mix?: ReadonlyArray<[SpotName, number]>;
}): SpotRate[] {
  const mix = cfg.mix ?? PRODUCTION_MIX;
  let s = cfg.seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const RANKS = ranksOf(cfg.variant);
  const SUITS = 'cdhs';
  const deal = (): string => {
    const seen = new Set<string>();
    while (seen.size < HOLE_COUNT[cfg.variant])
      seen.add(RANKS[Math.floor(rnd() * RANKS.length)] + SUITS[Math.floor(rnd() * 4)]);
    return [...seen].join('');
  };
  return mix.map(([name, weight]) => {
    const spot = SPOTS[name] as Spot;
    let entered = 0;
    for (let h = 0; h < cfg.hands; h++) {
      const d = decideAt(spot, { variant: cfg.variant, floor: 0 }, deal(), cfg.opts, h + 1);
      if (
        d.decision.action === 'call' ||
        d.decision.action === 'raise' ||
        d.decision.action === 'all_in'
      )
        entered++;
    }
    return {
      spot: name,
      weight,
      raised: spot.prior.some(([, x]) => x === 'pot' || x === 'raise'),
      hands: cfg.hands,
      entered,
    };
  });
}

// ── a full table of Horses (six-max self-play, preflop only) ───────────────
export interface TableSittingStats {
  tableHands: number;
  /** Horse sittings begun: six, plus one for every eviction (a fresh Horse takes the chair) */
  horseSittings: number;
  horseHands: number;
  vpipHands: number;
  judged: number;
  judgedUnder: number;
  warnings: number;
  recoveries: number;
  evictions: number;
  evictedAtHands: number[];
  /** hands in which somebody raised preflop */
  raisedHands: number;
  /** a Horse's first decision of a hand, and how many of those faced a raise */
  firstDecisions: number;
  firstDecisionsFacingRaise: number;
  /** first decisions in an unraised pot with a price to call (the limp or the completion) */
  unraisedOpportunities: number;
  /** limps or completions in an unraised pot, and how many were raised behind */
  limps: number;
  limpsRaisedBehind: number;
  walks: number;
  floorEntries: number;
  floorRaises: number;
  floorRaisedPotCalls: number;
  floorChipsBB: number;
  /** VPIP of each finished or running Horse sitting of at least 30 hands */
  sittingVpips: number[];
  windowCounts: number[];
}

/**
 * Six Horses at one floored table, every one deciding with `opts`: the button
 * moves each hand, each hand is dealt from one deck, and the preflop round is
 * played out decision by decision through HorseLogic.decide (the amounts the
 * Horses choose are replayed exactly). Only preflop is played: VPIP, the
 * floor and the eviction read nothing later. Every seat starts every hand
 * with 200 big blinds. Each Horse carries its own rolling judged window and
 * its own warning; an evicted Horse is replaced by a fresh one (empty sample).
 * No reads (mind off), so every opponent is the population envelope.
 */
export function tableSitting(cfg: {
  variant: FloorVariant;
  floor: number;
  opts: HorseDecideOpts;
  hands: number;
  seed: number;
  window?: number;
  grace?: number;
  /** The Action / Madness mode (fn_nit_policy: vpip_rolling false, grace 0): see SITTING_MODE. */
  sittingMode?: boolean;
}): TableSittingStats {
  const window = cfg.window ?? 30;
  const grace = cfg.grace ?? 10;
  const sample = (p: boolean[]) => (cfg.sittingMode === true ? p : p.slice(-window));
  let s = cfg.seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const RANKS = ranksOf(cfg.variant);
  const SUITS = 'cdhs';
  const DECK: string[] = [];
  for (const r of RANKS) for (const u of SUITS) DECK.push(r + u);
  const out: TableSittingStats = {
    tableHands: 0,
    horseSittings: 6,
    horseHands: 0,
    vpipHands: 0,
    judged: 0,
    judgedUnder: 0,
    warnings: 0,
    recoveries: 0,
    evictions: 0,
    evictedAtHands: [],
    raisedHands: 0,
    firstDecisions: 0,
    firstDecisionsFacingRaise: 0,
    unraisedOpportunities: 0,
    limps: 0,
    limpsRaisedBehind: 0,
    walks: 0,
    floorEntries: 0,
    floorRaises: 0,
    floorRaisedPotCalls: 0,
    floorChipsBB: 0,
    sittingVpips: [],
    windowCounts: [],
  };
  // chair i holds one Horse sitting at a time
  const chairs = Array.from({ length: 6 }, () => ({
    played: [] as boolean[],
    warnedAt: null as number | null,
  }));
  const closeSitting = (c: { played: boolean[] }) => {
    if (c.played.length >= window)
      out.sittingVpips.push(c.played.filter(Boolean).length / c.played.length);
  };
  const entered = (a: string) => a === 'call' || a === 'raise' || a === 'all_in';
  for (let h = 0; h < cfg.hands; h++) {
    const deck = [...DECK];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const n = HOLE_COUNT[cfg.variant];
    // chair i sits in seat ((i + h) mod 6) + 1: the button moves every hand
    const chairOfSeat = (seat: number) => (((seat - 1 - h) % 6) + 6) % 6;
    const holeOf = (seat: number) => deck.slice((seat - 1) * n, seat * n).join('');
    const bet = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 1],
      [6, 2],
    ]);
    const total = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 1],
      [6, 4],
    ]);
    const behind = (seat: number) => BEHIND - total.get(seat)!;
    const folded = new Set<number>();
    const allIn = new Set<number>();
    const vpip = new Set<number>();
    const actedOnce = new Set<number>();
    const limpedUnraised = new Set<number>();
    const prior: Prior[] = [];
    let currentBet = BB;
    let lastRaise = BB;
    let raised = false;
    let pending = [1, 2, 3, 4, 5, 6];
    let step = 0;
    while (pending.length > 0) {
      const seat = pending.shift()!;
      const live = [1, 2, 3, 4, 5, 6].filter((x) => !folded.has(x));
      if (live.length === 1) break; // everybody else folded: no decision is asked
      if (folded.has(seat) || allIn.has(seat)) continue;
      const chair = chairs[chairOfSeat(seat)];
      const recent = sample(chair.played);
      const k = recent.filter(Boolean).length;
      const own =
        recent.length > 0
          ? { hands: recent.length, vpip: Math.round((1000 * k) / recent.length) / 10 }
          : { hands: 0, vpip: null };
      const spot: Spot = { hero: seat, prior: [...prior] };
      const seedOf = cfg.seed * 1000003 + h * 64 + step + 1;
      step++;
      const hole = holeOf(seat);
      const a = decideAt(
        spot,
        { variant: cfg.variant, floor: cfg.floor, window, ownVpip: own },
        hole,
        cfg.opts,
        seedOf
      );
      const toCall = currentBet - bet.get(seat)!;
      const potNow = [...total.values()].reduce((x, y) => x + y, 0);
      const stackTo = bet.get(seat)! + behind(seat);
      const maxTo = noLimit(cfg.variant)
        ? stackTo
        : Math.min(stackTo, currentBet + potNow + toCall);
      const minTo = Math.min(maxTo, currentBet + Math.max(lastRaise, BB));
      let action = a.decision.action as string;
      let to = 0;
      if (action === 'raise' || action === 'all_in' || action === 'bet') {
        to =
          action === 'all_in'
            ? maxTo
            : Math.min(maxTo, Math.max(minTo, Number(a.decision.amount ?? 0)));
        action = to > currentBet + 1e-9 ? 'raise' : toCall > 0 ? 'call' : 'check';
      } else if (action === 'call' && !(toCall > 0)) action = 'check';
      else if (action === 'check' && toCall > 0) action = 'fold';
      const first = !actedOnce.has(seat);
      if (first) {
        actedOnce.add(seat);
        out.firstDecisions++;
        if (raised) out.firstDecisionsFacingRaise++;
        else if (toCall > 0) out.unraisedOpportunities++;
      }
      if (entered(action)) {
        // what the same decision is at an unfloored table: the floor's part of this entry
        const u = decideAt(spot, { variant: cfg.variant, floor: 0 }, hole, cfg.opts, seedOf);
        if (u.decision.action === 'fold') {
          if (!vpip.has(seat)) out.floorEntries++;
          if (action === 'raise') out.floorRaises++;
          else if (raised) out.floorRaisedPotCalls++;
          out.floorChipsBB += (action === 'raise' ? to - bet.get(seat)! : toCall) / BB;
        }
        vpip.add(seat);
      }
      if (action === 'fold') {
        folded.add(seat);
        prior.push([seat, 'fold']);
      } else if (action === 'check') {
        // the big blind's free option: no action row is needed for the next seat's state
      } else if (action === 'call') {
        if (!raised) {
          out.limps++;
          limpedUnraised.add(seat);
        }
        total.set(seat, total.get(seat)! + toCall);
        bet.set(seat, currentBet);
        prior.push([seat, 'call']);
        if (!(behind(seat) > 0)) allIn.add(seat);
      } else {
        if (!raised) {
          out.limpsRaisedBehind += limpedUnraised.size;
          raised = true;
        }
        total.set(seat, total.get(seat)! + (to - bet.get(seat)!));
        lastRaise = Math.max(lastRaise, to - currentBet);
        currentBet = to;
        bet.set(seat, to);
        prior.push([seat, 'raise', to]);
        if (!(behind(seat) > 0)) allIn.add(seat);
        // everybody still in acts again, in order after the raiser
        pending = [1, 2, 3, 4, 5, 6]
          .map((_, i) => ((seat - 1 + 1 + i) % 6) + 1)
          .filter((x) => x !== seat && !folded.has(x) && !allIn.has(x));
      }
    }
    if (raised) out.raisedHands++;
    if (vpip.size === 0) out.walks++;
    out.tableHands++;
    // the hand boundary: every chair was dealt in; fn_nit_enforce per Horse
    for (let seat = 1; seat <= 6; seat++) {
      const chair = chairs[chairOfSeat(seat)];
      const v = vpip.has(seat);
      chair.played.push(v);
      out.horseHands++;
      if (v) out.vpipHands++;
      if (chair.played.length < window) continue;
      const win = sample(chair.played);
      const kk = win.filter(Boolean).length;
      const pct = Math.round((1000 * kk) / win.length) / 10;
      out.judged++;
      out.windowCounts.push(kk);
      const under = pct < cfg.floor;
      if (under) out.judgedUnder++;
      if (under && cfg.sittingMode === true) {
        // no warning, no grace: stood up at this boundary, a fresh Horse takes the chair
        out.evictions++;
        out.evictedAtHands.push(chair.played.length);
        closeSitting(chair);
        chair.played = [];
        chair.warnedAt = null;
        out.horseSittings++;
        continue;
      }
      if (!under) {
        if (chair.warnedAt !== null) out.recoveries++;
        chair.warnedAt = null;
      } else if (chair.warnedAt === null) {
        chair.warnedAt = chair.played.length;
        out.warnings++;
      } else if (chair.played.length - chair.warnedAt >= grace) {
        out.evictions++;
        out.evictedAtHands.push(chair.played.length);
        closeSitting(chair);
        chair.played = [];
        chair.warnedAt = null;
        out.horseSittings++;
      }
    }
  }
  for (const c of chairs) closeSitting(c);
  return out;
}
