/**
 * SPARRING LEAGUE: PLO4 / PLO5 CASH HORSES AGAINST A STRONG AGGRESSIVE OPPONENT (2026-11-20)
 *
 * Owner, 3:05 PM Chicago Nov 20: "ANY GOOD THINKING PLAYER WITH A GOOD UNDERSTANDING OF PLO5 CAN CRUSH
 * THE HORSES". Grading a Horse change on the few real hands persons play is slow and noisy; this card
 * replays tens of thousands of deals offline so a candidate option can be read against a strong
 * aggressive opponent in minutes. It adds three things to the ExploiterLeague machinery it reuses
 * (seat 0 scripted, every other seat a production Horse inside a HorseMind sandbox, button rotating):
 *
 *  - SPARRING_PROFILES: a parameterised aggressive opponent (the "exploiter") whose public action
 *    frequencies follow the measured style of the persons who beat the PLO5 Horses (very wide entry,
 *    frequent 3-bets of Horse openers, moderate flop aggression, turn and river bets of 51-120% pot
 *    when checked to). Frequencies by street, line and size; hands chosen by equity (its own cards and
 *    the public board only). Aggregates only: no recorded hand is replayed or embedded.
 *  - SPARRING_PROBES: parameter-free best-response probes. Each plays the production Horse brain in
 *    seat 0 except at the one spot it attacks (pot-sized turn/river stabs when checked to, raising
 *    every c-bet, 3-betting every open, overfolding to raises, and the predictability probe that folds
 *    or attacks according to the Horses' own value share by line and size). Against the Horse mirror
 *    (the same brain, same seat, same deal, no deviation) the paired difference is exactly what the
 *    deviation earns: a probe whose edge is above 2 SE is a named exploit the Horses must close.
 *  - runSparringCell: one deal stream played once per ARM (a Horse option set), so two option sets
 *    face the same opponent on the same cards and the per-hand paired difference reads a candidate
 *    with a small standard error.
 *
 * Offline measurement only: no production caller, no database, no writer; never imported by engine
 * runtime code (SparringLeagueIsBenchmarkOnly.law.test.ts). No hole card is printed or stored; the
 * reports carry aggregates. PLO6 is out of scope (the cell refuses it). Horses are HORSES, never "bots".
 */
import type { Card, HandStage, HorseStyle } from '../types.js';
import type { HorseDecideOpts, HorseProfileMods } from '../engine/HorseLogic.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import { HorseMind } from '../engine/HorseMind.js';
import {
  restoreFastRandom,
  saveFastRandom,
  scoreOmahaHi,
  simulateEquity,
  variantInfo,
} from '../engine/HorseEval.js';
import { cardKey, referenceDeck } from './OmahaReference.js';
import { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } from './HorseLeagueHumanField.js';
import {
  EXPLOITER_POLICIES,
  EXPLOITER_SEAT,
  exploiterSpotHelpers as H,
  type ExploiterPolicy,
} from './ExploiterLeague.js';
import {
  playHand,
  type LeagueGameContext,
  type LeagueHandObserver,
  type LeagueHumanField,
  type LeagueSeatSpot,
} from './HorseLeague.js';

const BB = 2;
const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
type Street = (typeof STREETS)[number];
type Decision = { action: string; amount?: number };

export const SPARRING_VARIANTS = ['plo5', 'plo4'] as const;
export type SparringVariant = (typeof SPARRING_VARIANTS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Spot helpers (own cards + public state only)
// ─────────────────────────────────────────────────────────────────────────────

/** Equity against the live opponents dealt at random; leaves the deal's strategy stream untouched. */
function eqVsField(s: LeagueSeatSpot, iterations = 140): number {
  const st = saveFastRandom();
  try {
    return simulateEquity(
      s.cards,
      s.board,
      Math.max(1, Math.min(3, s.liveCount - 1)),
      variantInfo(s.variant),
      iterations
    );
  } finally {
    restoreFastRandom(st);
  }
}

/**
 * Each live opponent's preflop range as a percentile band of the dealt holdings (the Omaha sampler's
 * convention, 1 = best), read from its PUBLIC preflop actions only: the last raiser of n raises holds
 * the top 40% / 15% / 7%; a caller of a raise the top 55%; a limper or a checking big blind any hand.
 */
function oppBandsOf(s: LeagueSeatSpot): Array<[number, number]> {
  const live = new Map<string, { raises: number; called: boolean }>();
  let raisesSoFar = 0;
  const folded = new Set<string>();
  for (const a of s.history) {
    if (a.userId === s.userId) {
      if (
        a.stage === 'preflop' &&
        (a.action === 'raise' || a.action === 'bet' || a.action === 'all_in')
      )
        raisesSoFar++;
      continue;
    }
    if (a.action === 'fold') {
      folded.add(a.userId);
      continue;
    }
    const r = live.get(a.userId) ?? { raises: 0, called: false };
    if (a.stage === 'preflop') {
      if (a.action === 'raise' || a.action === 'bet' || a.action === 'all_in') {
        raisesSoFar++;
        r.raises = raisesSoFar;
      } else if (a.action === 'call' && raisesSoFar > 0) r.called = true;
    }
    live.set(a.userId, r);
  }
  const bands: Array<[number, number]> = [];
  for (const [id, r] of live) {
    if (folded.has(id)) continue;
    if (r.raises >= 3) bands.push([0.93, 1]);
    else if (r.raises === 2) bands.push([0.85, 1]);
    else if (r.raises === 1) bands.push([0.6, 1]);
    else if (r.called) bands.push([0.45, 1]);
    else bands.push([0, 1]);
  }
  return bands.slice(0, 3);
}

/** Equity against the live opponents' public preflop ranges (oppBandsOf); strategy stream untouched. */
function eqVsRanges(s: LeagueSeatSpot, iterations = 140): number {
  const bands = oppBandsOf(s);
  if (bands.length === 0) return eqVsField(s, iterations);
  const st = saveFastRandom();
  try {
    return simulateEquity(
      s.cards,
      s.board,
      bands.length,
      variantInfo(s.variant),
      iterations,
      bands
    );
  } finally {
    restoreFastRandom(st);
  }
}

/**
 * A deterministic uniform draw in [0, 1) from the public state and own cards. ExploiterLeague's hashRand
 * ends on a signed 32-bit xor, so its value lies in [-0.5, 0.5) and `hashRand() < p` holds for every
 * negative draw (a 45% branch fires about 72% of the time); this folds it back onto [0, 1).
 */
function rnd(s: LeagueSeatSpot, salt: number): number {
  const x = H.hashRand(s, salt);
  return x < 0 ? x + 1 : x;
}

/** Size of the single wager this seat faces, as a fraction of the pot before it (pot includes bets). */
function facingFrac(s: LeagueSeatSpot): number {
  const before = s.pot - s.toCall;
  return before > 0 ? s.toCall / before : 1;
}

export type SizeBand = 'small' | 'half' | 'twothirds' | 'pot';
export function sizeBand(frac: number): SizeBand {
  return frac < 0.4 ? 'small' : frac < 0.6 ? 'half' : frac < 0.85 ? 'twothirds' : 'pot';
}

/** Who led the betting on the previous street (or preflop): 'mine' | 'theirs' | 'none'. */
function initiative(s: LeagueSeatSpot): 'mine' | 'theirs' | 'none' {
  const cur = STREETS.indexOf(s.stage as Street);
  let last: string | null = null;
  for (const a of s.history) {
    if (STREETS.indexOf(a.stage as Street) >= cur) continue;
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') last = a.userId;
  }
  return last === null ? 'none' : last === s.userId ? 'mine' : 'theirs';
}

/** Line of the wager faced: 'cbet' when this street's bettor made the last wager of the previous
 *  streets (it held the initiative), else 'probe' (a lead or a stab). */
function facedLine(s: LeagueSeatSpot): 'cbet' | 'probe' {
  const cur = STREETS.indexOf(s.stage as Street);
  let prevAgg: string | null = null;
  let bettor: string | null = null;
  for (const a of s.history) {
    const w = a.action === 'bet' || a.action === 'raise' || a.action === 'all_in';
    if (!w) continue;
    const si = STREETS.indexOf(a.stage as Street);
    if (si < cur) prevAgg = a.userId;
    else if (si === cur && bettor === null) bettor = a.userId;
  }
  return bettor !== null && bettor === prevAgg ? 'cbet' : 'probe';
}

// ─────────────────────────────────────────────────────────────────────────────
// The parameterised aggressive opponent
// ─────────────────────────────────────────────────────────────────────────────

export interface SparringProfile {
  /** Share of hands played voluntarily preflop (raise or call), by preflop percentile. */
  vpip: number;
  /** Share of hands raised first in / over limpers. */
  pfr: number;
  /** Share of hands 3-bet facing a single raise. */
  threeBet: number;
  /** Share of hands 4-bet (pot) facing a 3-bet; the rest of the continue range calls. */
  fourBet: number;
  /** Share of hands that continue facing a 3-bet (call + 4-bet). */
  continueVs3Bet: number;
  /** Postflop, checked to or first in: bet every hand with equity at least valueEq[street]. */
  valueEq: Record<'flop' | 'turn' | 'river', number>;
  /** ... and bluff this share of the rest (draw-band hands weighted by drawWeight on flop/turn). */
  bluff: Record<'flop' | 'turn' | 'river', number>;
  drawWeight: number;
  /** Bet sizes as pot fractions [min, max]; the size is drawn uniformly per decision. */
  size: Record<'flop' | 'turn' | 'river', [number, number]>;
  /** Facing a wager: call when equity >= price + callMargin; raise (pot) when equity >= raiseEq. */
  callMargin: number;
  raiseEq: Record<'flop' | 'turn' | 'river', number>;
  /** Flop/turn, heads-up, facing a wager: float this share of the hands priced out but with equity
   *  at least floatEqShare of the price (to take the pot away later). */
  float: number;
  floatEqShare: number;
  /** Flop/turn, facing a c-bet heads-up: raise this share of the hands that would otherwise fold or call. */
  raiseCbetBluff: number;
  /** Read equity against the opponents' public preflop ranges (true) or against random hands (false). */
  rangeAware: boolean;
  /** Facing a wager, the extra equity demanded per unit of its pot fraction (big bets carry more value). */
  sizeMargin: number;
}

/**
 * aggro_reg: the measured public style of the persons who beat the PLO5 Horses (lane STYLE-STUDY D3-D6,
 * Nov 20, aggregates of public actions and offline card classes, never a recorded hand): opens 72-76%
 * first in, 3-bets 44-47% of single raises, 4-bets ~20% of 3-bets and almost never folds to one;
 * c-bets ~55-65% heads-up at 60-100% pot; turn and river bets after a check-through 30-57% at 60%+ pot;
 * its wagers are value-heavy (flop 68%, turn 70%, river 77% value; river "bluffs" are thin value at big
 * size); raises the flop 10-13% with near-nut hands and semi-bluffs. Equity thresholds were set so the
 * cell's own measured frequencies (SparringArmResult.stats) land on those rates.
 * aggro_passive_post: the same entry with small honest postflop bets and no bluffs, the control that
 * isolates what the postflop pressure is worth. A JSON profile (sparring.sh PROFILE=) overrides fields.
 */
export const SPARRING_PROFILES: Readonly<Record<string, SparringProfile>> = Object.freeze({
  aggro_reg: Object.freeze<SparringProfile>({
    vpip: 0.88,
    pfr: 0.74,
    threeBet: 0.45,
    fourBet: 0.2,
    continueVs3Bet: 0.98,
    valueEq: { flop: 0.55, turn: 0.58, river: 0.6 },
    bluff: { flop: 0.08, turn: 0.1, river: 0.1 },
    drawWeight: 2.2,
    size: { flop: [0.7, 1.0], turn: [0.6, 1.0], river: [0.6, 1.0] },
    callMargin: 0.04,
    raiseEq: { flop: 0.8, turn: 0.84, river: 0.9 },
    float: 0.2,
    floatEqShare: 0.6,
    raiseCbetBluff: 0.06,
    rangeAware: true,
    sizeMargin: 0.12,
  }),
  // Same entry, but no postflop pressure: the control that says how much of the damage the
  // turn/river pressure does (the persons' measured edge is pressure, not entry).
  aggro_passive_post: Object.freeze<SparringProfile>({
    vpip: 0.88,
    pfr: 0.74,
    threeBet: 0.45,
    fourBet: 0.2,
    continueVs3Bet: 0.98,
    valueEq: { flop: 0.72, turn: 0.74, river: 0.76 },
    bluff: { flop: 0, turn: 0, river: 0 },
    drawWeight: 1,
    size: { flop: [0.33, 0.5], turn: [0.33, 0.5], river: [0.33, 0.5] },
    callMargin: 0.04,
    raiseEq: { flop: 0.85, turn: 0.88, river: 0.92 },
    float: 0,
    floatEqShare: 0.6,
    raiseCbetBluff: 0,
    rangeAware: true,
    sizeMargin: 0.12,
  }),
});

function profileBetSize(s: LeagueSeatSpot, p: SparringProfile, st: 'flop' | 'turn' | 'river') {
  const [lo, hi] = p.size[st];
  return H.potWager(s, lo + (hi - lo) * rnd(s, 101));
}

/** The parameterised opponent as a seat policy (does not consult the Horse brain). */
export function sparringProfilePolicy(p: SparringProfile): ExploiterPolicy {
  return (s) => {
    if (s.stage === 'preflop') {
      const pct = H.prePct(s);
      const raises = H.streetRaises(s);
      if (raises === 0) {
        if (pct >= 1 - p.pfr) return H.potWager(s, 1);
        if (s.toCall <= 0) return H.check(s);
        return pct >= 1 - p.vpip ? H.call(s) : H.check(s);
      }
      if (raises === 1) {
        if (pct >= 1 - p.threeBet) return H.potWager(s, 1);
        return pct >= 1 - p.vpip ? H.call(s) : H.check(s);
      }
      if (raises === 2) {
        if (pct >= 1 - p.fourBet) return H.potWager(s, 1);
        return pct >= 1 - p.continueVs3Bet ? H.call(s) : H.check(s);
      }
      if (pct >= 1 - p.fourBet / 2) return H.wager(s, s.myBet + s.stack);
      return pct >= 1 - p.fourBet ? H.call(s) : H.check(s);
    }
    const st = s.stage as 'flop' | 'turn' | 'river';
    if (s.toCall <= 0) {
      // Betting frequencies are calibrated on equity against random holdings (the measured rates).
      const eq = eqVsField(s);
      if (eq >= p.valueEq[st]) return profileBetSize(s, p, st);
      const draw = st !== 'river' && eq >= 0.3 && eq < p.valueEq[st];
      const rate = Math.min(1, p.bluff[st] * (draw ? p.drawWeight : 1));
      return rnd(s, 7) < rate ? profileBetSize(s, p, st) : H.check(s);
    }
    // Facing a wager: equity against the opponents' public preflop ranges (a thinking player's read).
    const eq = p.rangeAware ? eqVsRanges(s) : eqVsField(s);
    const need = s.toCall / (s.pot + s.toCall);
    if (eq >= p.raiseEq[st]) return H.potWager(s, 1);
    const hu = s.liveCount === 2;
    if (
      hu &&
      st !== 'river' &&
      facedLine(s) === 'cbet' &&
      H.streetRaises(s) === 1 &&
      rnd(s, 13) < p.raiseCbetBluff
    )
      return H.potWager(s, 1);
    if (eq >= need + p.callMargin + p.sizeMargin * Math.min(1, facingFrac(s))) return H.call(s);
    if (hu && st !== 'river' && eq >= need * p.floatEqShare && rnd(s, 17) < p.float)
      return H.call(s);
    return H.check(s);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Best-response probes (Horse brain except at the attacked spot)
// ─────────────────────────────────────────────────────────────────────────────

/** Turn and river, checked to (or first to act): bet the pot with ANY hand. */
const probePotStabTurnRiver: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if ((s.stage !== 'turn' && s.stage !== 'river') || s.toCall > 0 || H.isWager(h)) return h;
  return H.potWager(s, 1);
};

/** Flop, facing a c-bet (the preflop raiser's bet): raise the pot every time. */
const probeRaiseEveryCbet: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if (s.stage !== 'flop' || s.toCall <= 0 || H.isWager(h)) return h;
  if (H.streetRaises(s) !== 1 || facedLine(s) !== 'cbet') return h;
  return H.potWager(s, 1);
};

/** Preflop, facing exactly one raise: 3-bet the pot every time. */
const probeThreeBetEveryOpen: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if (s.stage !== 'preflop' || H.isWager(h) || H.streetRaises(s) !== 1) return h;
  return H.potWager(s, 1);
};

/** Facing a raise of its own bet/raise (any street): fold everything but the top of its range. */
const probeOverfoldToRaises: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if (s.toCall <= 0 || h.action === 'fold' || !H.iActedThisStreet(s) || H.isWager(h)) return h;
  if (s.stage === 'preflop') return H.prePct(s) >= 0.97 ? h : H.check(s);
  return eqVsField(s) >= 0.8 ? h : H.check(s);
};

/** Facing a bet on the turn or river: never folds (does the Horse value-bet too thin / bluff too much?). */
const probeStationTurnRiver: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if ((s.stage !== 'turn' && s.stage !== 'river') || s.toCall <= 0 || h.action !== 'fold') return h;
  return H.call(s);
};

/** River, facing a bet: raises half the air the Horse folds, and its strongest calls (ExploiterLeague
 *  hx_river_raise with a uniform draw). */
const probeRiverRaise: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if (s.stage !== 'river' || s.toCall <= 0 || H.isWager(h)) return h;
  const eq = eqVsField(s);
  if (h.action === 'fold' && eq < 0.3 && rnd(s, 23) < 0.5) return H.potWager(s, 1);
  if (h.action !== 'fold' && eq >= 0.85) return H.potWager(s, 1);
  return h;
};

/** Flop and turn, after checking, facing a bet: check-raise strong hands and 45% of air (ExploiterLeague
 *  hx_check_raise with a uniform draw and the pot-limit raise). */
const probeCheckRaise: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if (s.stage !== 'flop' && s.stage !== 'turn') return h;
  if (s.toCall <= 0 || !H.iActedThisStreet(s) || H.streetRaises(s) !== 1 || H.isWager(h)) return h;
  const eq = eqVsField(s);
  if (eq >= 0.7 || (eq < 0.35 && rnd(s, 11) < 0.45)) return H.potWager(s, 1);
  return h;
};

// ─────────────────────────────────────────────────────────────────────────────
// Predictability (tell) probe: the Horses' own value share by line and size band
// ─────────────────────────────────────────────────────────────────────────────

/** Key of a Horse wager as the facing seat sees it: street | line | size band | players. */
export function tellKey(stage: string, line: string, band: SizeBand, live: number): string {
  return `${stage}|${line}|${band}|${live <= 2 ? 'hu' : 'multi'}`;
}

/** A Horse wager is "value" when its equity against the bettor's actual opponents' hands at the
 *  moment of the bet is at least this (measured offline on the simulator's own cards). */
export const TELL_VALUE_EQ = 0.6;

export interface TellCell {
  wagers: number;
  value: number;
}
export type TellTable = Record<string, TellCell>;

/**
 * The predictability probe for a measured TellTable: facing a single Horse wager whose key shows a
 * value share at or above `hi`, fold all but strong hands; at or below `lo`, raise the pot with any
 * hand it would continue with and float (call) the rest heads-up. Otherwise the Horse decision.
 */
export function tellProbe(table: TellTable, lo = 0.35, hi = 0.7, minN = 40): ExploiterPolicy {
  return (s, horse) => {
    const h = horse();
    if (s.stage === 'preflop' || s.toCall <= 0 || H.streetRaises(s) !== 1 || s.myBet > 0) return h;
    const cell = table[tellKey(s.stage, facedLine(s), sizeBand(facingFrac(s)), s.liveCount)];
    if (!cell || cell.wagers < minN) return h;
    const share = cell.value / cell.wagers;
    if (share >= hi) return eqVsField(s) >= 0.75 ? h : H.check(s);
    if (share <= lo) {
      if (h.action !== 'fold' || s.liveCount === 2) return H.potWager(s, 1);
    }
    return h;
  };
}

/**
 * The predictability probe with the sizing tell STYLE-STUDY D4 measured on real cards (Nov 20, aggregates):
 * Horse turn and river wagers of 85%+ pot are nuts or near-nut 83-87% of the time, so fold to them with
 * anything short of a strong hand; Horse flop wagers of 60%+ pot are the only bluffy Horse size (one pair
 * 30-32%, no pair 7-9%), so raise them heads-up with any hand the Horse brain would continue with.
 */
const probeTellD4: ExploiterPolicy = (s, horse) => {
  const h = horse();
  if (s.stage === 'preflop' || s.toCall <= 0 || H.streetRaises(s) !== 1 || s.myBet > 0) return h;
  const f = facingFrac(s);
  if ((s.stage === 'turn' || s.stage === 'river') && f >= 0.85)
    return eqVsField(s) >= 0.75 ? h : H.check(s);
  if (s.stage === 'flop' && f >= 0.6 && s.liveCount === 2 && h.action !== 'fold')
    return H.potWager(s, 1);
  return h;
};

export const SPARRING_PROBES = Object.freeze({
  pot_stab_turn_river: probePotStabTurnRiver,
  raise_every_cbet: probeRaiseEveryCbet,
  threebet_every_open: probeThreeBetEveryOpen,
  overfold_to_raises: probeOverfoldToRaises,
  station_turn_river: probeStationTurnRiver,
  barrel_air: EXPLOITER_POLICIES.hx_barrel_air,
  river_raise: probeRiverRaise,
  check_raise: probeCheckRaise,
  tell_d4: probeTellD4,
} satisfies Record<string, ExploiterPolicy>);
export type SparringProbeName = keyof typeof SPARRING_PROBES | 'tell';

export const SPARRING_PROBE_DESCRIPTIONS: Readonly<Record<SparringProbeName, string>> =
  Object.freeze({
    pot_stab_turn_river: 'Horse, but bets the pot with any hand on turn and river when checked to',
    raise_every_cbet: 'Horse, but raises the pot over every flop c-bet',
    threebet_every_open: 'Horse, but 3-bets the pot over every single raise',
    overfold_to_raises: 'Horse, but folds all but the top of its range when its bet is raised',
    station_turn_river: 'Horse, but never folds to a turn or river bet',
    barrel_air: 'Horse, but barrels 3/4 pot on turn and river with the air it would check',
    river_raise:
      'Horse, but raises the river with half the air it would fold and its strongest calls',
    check_raise: 'Horse, but check-raises flop and turn with strong hands and 45% of air',
    tell_d4:
      'Horse, but folds to Horse turn/river 85%+ pot wagers without a strong hand and raises Horse flop 60%+ pot wagers (STYLE-STUDY D4 sizing tell)',
    tell: 'Horse, but folds to Horse wagers in lines/sizes the Horses bet mostly for value and raises those mostly bluffs',
  });

// ─────────────────────────────────────────────────────────────────────────────
// The cell
// ─────────────────────────────────────────────────────────────────────────────

export interface SparringArm {
  label: string;
  /** HorseDecideOpts for every Horse seat (and for the probe's Horse brain in seat 0). */
  horseOpts: HorseDecideOpts;
}

export interface SparringCellSpec {
  name: string;
  policy: ExploiterPolicy;
  variant: SparringVariant;
  seats: number;
  stackBB: number;
  pairs: number;
  seed: number;
  arms: SparringArm[];
  /** Also play each arm's Horse mirror in seat 0 (probes: the edge is the exploit's own value). */
  mirror?: boolean;
  /** Big-blind ante in big blinds (live PLO5 Classic: 1). 0 = none. */
  bbAnte?: number;
  /** Collect the Horses' value share by line and size band (for tellProbe). */
  collectTells?: boolean;
  /** Keep each arm's per-hand seat-0 net (bb) and mirror net, so two runs of the same cell in two
   *  trees can be paired hand by hand (a code change, not a switch, between them). Numbers only. */
  keepPerHand?: boolean;
  /** Option set of the Horse brain a probe plays in seat 0 (and of its mirror). Default: arm 0's, in every
   *  arm, so a candidate arm changes only the opposing Horses and the paired change measures their
   *  defence, not the option's value in the probe's own hands. */
  seat0Opts?: HorseDecideOpts;
}

export interface SparringArmResult {
  label: string;
  /** Seat-0 net, bb/100 (the Horses' combined loss to it). */
  bb100: number;
  se: number;
  /** Seat-0 net minus the Horse mirror's net on the same deal (mirror only). */
  edgeBb100: number | null;
  edgeSe: number | null;
  /** Seat-0 net minus arm 0's seat-0 net on the same deal (arm 0: null). */
  vsArm0Bb100: number | null;
  vsArm0Se: number | null;
  /** Seat-0 net (bb per 100 hands) by where the hand ended and how. */
  chipFlow: Record<string, number>;
  /** Seat-0 bb per 100 hands of the deviation-vs-mirror edge by where the probe first left the Horse line. */
  deviationEdge: Record<string, { hands: number; edgeBb100: number }>;
  /** Seat-0 public frequencies (realism check). */
  stats: Record<string, number>;
  /** Horse answers to seat-0 wagers by street and size band: fold share. */
  horseFoldToBet: Record<string, { n: number; fold: number }>;
  tells?: TellTable;
  /** keepPerHand: seat-0 net and Horse-mirror net per hand, bb, in deal order. */
  perHand?: number[];
  perHandMirror?: number[];
  illegal: number;
  truncated: number;
  brainFallbacks: number;
}

export interface SparringCellResult {
  name: string;
  variant: SparringVariant;
  seats: number;
  stackBB: number;
  pairs: number;
  seed: number;
  arms: SparringArmResult[];
  durationMs: number;
}

const meanSe = (xs: number[]): { mean: number; se: number } => {
  const n = Math.max(1, xs.length);
  const m = xs.reduce((a, x) => a + x, 0) / n;
  const v = xs.reduce((a, x) => a + (x - m) * (x - m), 0) / Math.max(1, xs.length - 1);
  return { mean: m * 100, se: Math.sqrt(v / n) * 100 };
};

interface ArmState {
  arm: SparringArm;
  sbE: ReturnType<typeof HorseMind.createSandbox>;
  sbC: ReturnType<typeof HorseMind.createSandbox>;
  e: number[];
  c: number[];
  chip: Record<string, number>;
  dev: Record<string, { hands: number; edge: number }>;
  stats: Record<string, number>;
  fold: Record<string, { n: number; fold: number }>;
  tells: TellTable;
  counters: { illegal: number; truncated: number; brainFallback?: number };
}

function devTag(s: LeagueSeatSpot, d: Decision): string {
  const first = !s.history.some((a) => a.stage === s.stage && a.userId !== s.userId);
  const where = s.toCall > 0 ? 'facing' : first ? 'lead' : 'checkedto';
  return `${s.stage}|${s.liveCount <= 2 ? 'hu' : 'multi'}|${where}|init_${initiative(s)}|${d.action}`;
}

export async function runSparringCell(spec: SparringCellSpec): Promise<SparringCellResult> {
  const { variant, seats, stackBB, pairs, seed } = spec;
  if (!(SPARRING_VARIANTS as readonly string[]).includes(variant))
    throw new Error(`sparring: variant ${String(variant)} is out of scope (PLO4/PLO5 only)`);
  if (seats < 2 || seats > 9) throw new Error('seats must be 2..9');
  if (spec.arms.length < 1) throw new Error('at least one arm');
  const t0 = Date.now();
  const hybrid = HORSE_HYBRID_PROFILES.cash;
  const mods = { ...hybrid.mods } as HorseProfileMods;
  const ctx: LeagueGameContext =
    (spec.bbAnte ?? 0) > 0
      ? { gameMode: 'cash', format: 'cash', ante: (spec.bbAnte ?? 0) * BB, bigBlindAnte: true }
      : { gameMode: 'cash', format: 'cash', ante: 0 };
  const seat0Opts: HorseDecideOpts = spec.seat0Opts ?? spec.arms[0].horseOpts;
  const states: ArmState[] = spec.arms.map((arm) => ({
    arm,
    sbE: HorseMind.createSandbox(),
    sbC: HorseMind.createSandbox(),
    e: [],
    c: [],
    chip: {},
    dev: {},
    stats: {},
    fold: {},
    tells: {},
    counters: { illegal: 0, truncated: 0 },
  }));

  // Per-hand tracking (one hand is played at a time).
  let devFirst: string | null = null;
  let cur: ArmState = states[0];
  let lastAgg: { street: string; band: SizeBand } | null = null;
  let facing: { street: string; band: SizeBand } | null = null;
  let vpipThisHand = false;
  let pfrThisHand = false;
  let threeBetOpp = false;
  let threeBetMade = false;
  let tellPending: Array<{ key: string; seat: number; stage: HandStage }> = [];
  let streetWagerCount: Record<string, number> = {};
  // Seat of the last wager on earlier streets, and of the last wager on the current street.
  let prevAggSeat = -1;
  let curAggSeat = -1;
  let ended: { byFolds: boolean; lastStreet: string } = { byFolds: false, lastStreet: 'preflop' };
  let stageNow: string = 'preflop';
  const bump = (o: Record<string, number>, k: string, v = 1) => (o[k] = (o[k] ?? 0) + v);

  const observer = (st: ArmState): LeagueHandObserver => ({
    onAction: (e) => {
      if (e.stage !== stageNow) {
        if (curAggSeat >= 0) prevAggSeat = curAggSeat;
        curAggSeat = -1;
      }
      stageNow = e.stage;
      const aggressive = e.action === 'bet' || e.action === 'raise' || e.action === 'all_in';
      const sw = streetWagerCount[e.stage] ?? 0;
      if (e.seatIdx === EXPLOITER_SEAT) {
        const s = st.stats;
        if (e.stage === 'preflop') {
          if (sw === 1 && !threeBetOpp) {
            threeBetOpp = true;
            if (aggressive) threeBetMade = true;
          }
          if (e.action === 'call' || aggressive) vpipThisHand = true;
          if (aggressive) pfrThisHand = true;
        } else {
          bump(s, `${e.stage}_actions`);
          if (aggressive) bump(s, `${e.stage}_aggr`);
          if (e.toCall <= 0) {
            bump(s, `${e.stage}_checkedto_or_first`);
            if (aggressive) bump(s, `${e.stage}_bets`);
          }
        }
        if (aggressive) {
          const frac = e.pot + e.toCall > 0 ? (e.amount - e.toCall) / (e.pot + e.toCall) : 1;
          const band = sizeBand(e.toCall > 0 ? frac : e.amount / Math.max(1, e.pot));
          lastAgg = { street: e.stage, band };
          facing = { street: e.stage, band };
        } else facing = null;
      } else {
        if (facing && facing.street === e.stage && e.stage !== 'preflop') {
          const k = `${e.stage}|${facing.band}`;
          const f = (st.fold[k] ??= { n: 0, fold: 0 });
          f.n++;
          if (e.action === 'fold') f.fold++;
          if (aggressive) facing = null;
        }
        if (spec.collectTells && aggressive && sw === 0 && e.stage !== 'preflop' && e.toCall <= 0) {
          // A Horse's first wager of the street: key it the way the facing seat will see it.
          tellPending.push({
            key: `${e.stage}|${e.amount / Math.max(1, e.pot)}|${e.liveBefore}|${
              prevAggSeat === e.seatIdx ? 'cbet' : 'probe'
            }`,
            seat: e.seatIdx,
            stage: e.stage,
          });
        }
      }
      if (aggressive) {
        streetWagerCount[e.stage] = sw + 1;
        curAggSeat = e.seatIdx;
      }
    },
    onEnd: (e) => {
      ended = { byFolds: e.endedByFolds, lastStreet: stageNow };
      if (spec.collectTells && tellPending.length) {
        const rs = saveFastRandom();
        try {
          for (const t of tellPending) {
            const [stage, fracS, liveS, line] = t.key.split('|');
            const nb = stage === 'flop' ? 3 : stage === 'turn' ? 4 : 5;
            const board = e.board.slice(0, nb);
            const opps = e.cards.filter((c, i) => i !== t.seat && !e.folded[i] && c.length > 0);
            const eq = horseEqVsActual(e.cards[t.seat], opps, board);
            const k = tellKey(stage, line, sizeBand(Number(fracS)), Number(liveS));
            const cell = (st.tells[k] ??= { wagers: 0, value: 0 });
            cell.wagers++;
            if (eq >= TELL_VALUE_EQ) cell.value++;
          }
        } finally {
          restoreFastRandom(rs);
        }
      }
    },
  });

  const seatOf =
    (st: ArmState, pol: ExploiterPolicy, track: boolean): LeagueHumanField['seatPolicyOf'] =>
    (seat) =>
      seat === EXPLOITER_SEAT
        ? (spot) => {
            let h: Decision | null = null;
            const d = pol(spot, () => (h = spot.horseDecide(hybrid.style, mods, seat0Opts)));
            if (track && devFirst === null && h !== null) {
              const hd = h as Decision;
              if (hd.action !== d.action || (H.isWager(d) && hd.amount !== d.amount))
                devFirst = devTag(spot, d);
            }
            return d;
          }
        : undefined;
  const mirrorPolicy: ExploiterPolicy = (_s, horse) => horse();

  const rng = saveFastRandom();
  try {
    for (let p = 0; p < pairs; p++) {
      if (p > 0 && (p & 0x0f) === 0) await new Promise((res) => setImmediate(res));
      const handSeed = (seed ^ (p * 2654435761)) >>> 0 || 1;
      const dealerSeat = (p % seats) + 1;
      for (const st of states) {
        cur = st;
        const field: LeagueHumanField = {
          population: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
          isHuman: (s) => s === EXPLOITER_SEAT,
          seatPolicyOf: seatOf(st, spec.policy, true),
        };
        devFirst = null;
        lastAgg = null;
        facing = null;
        vpipThisHand = pfrThisHand = threeBetOpp = threeBetMade = false;
        tellPending = [];
        streetWagerCount = {};
        stageNow = 'preflop';
        prevAggSeat = -1;
        curAggSeat = -1;
        const e =
          playHand(
            handSeed,
            dealerSeat,
            () => st.arm.horseOpts,
            st.counters,
            st.sbE,
            variant,
            seats,
            stackBB,
            ctx,
            () => ({ ...hybrid.mods }) as HorseProfileMods,
            field,
            (): HorseStyle => hybrid.style,
            true,
            observer(st)
          )[EXPLOITER_SEAT] / BB;
        st.e.push(e);
        const s = st.stats;
        bump(s, 'hands');
        if (vpipThisHand) bump(s, 'vpip');
        if (pfrThisHand) bump(s, 'pfr');
        if (threeBetOpp) bump(s, 'threebet_opp');
        if (threeBetMade) bump(s, 'threebet');
        const la = lastAgg as { street: string; band: SizeBand } | null;
        const flowKey = `${ended.byFolds ? 'nosd' : 'showdown'}|end_${ended.lastStreet}|lastbet_${
          la ? `${la.street}_${la.band}` : 'none'
        }`;
        bump(st.chip, flowKey, e);
        const tag = devFirst as string | null;
        if (spec.mirror) {
          const control: LeagueHumanField = {
            population: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
            isHuman: (s2) => s2 === EXPLOITER_SEAT,
            seatPolicyOf: seatOf(st, mirrorPolicy, false),
          };
          const c =
            playHand(
              handSeed,
              dealerSeat,
              () => st.arm.horseOpts,
              st.counters,
              st.sbC,
              variant,
              seats,
              stackBB,
              ctx,
              () => ({ ...hybrid.mods }) as HorseProfileMods,
              control,
              (): HorseStyle => hybrid.style,
              true,
              undefined
            )[EXPLOITER_SEAT] / BB;
          st.c.push(c);
          if (tag !== null) {
            const t = (st.dev[tag] ??= { hands: 0, edge: 0 });
            t.hands++;
            t.edge += e - c;
          }
        }
      }
    }
  } finally {
    restoreFastRandom(rng);
  }
  void cur;
  const n = Math.max(1, pairs);
  const a0 = states[0].e;
  const arms: SparringArmResult[] = states.map((st, i) => {
    const m = meanSe(st.e);
    const edge = spec.mirror ? meanSe(st.e.map((x, k) => x - st.c[k])) : null;
    const vs = i === 0 ? null : meanSe(st.e.map((x, k) => x - a0[k]));
    const s = st.stats;
    const ratio = (a: string, b: string) => (s[b] ? (s[a] ?? 0) / s[b] : 0);
    return {
      label: st.arm.label,
      bb100: m.mean,
      se: m.se,
      edgeBb100: edge ? edge.mean : null,
      edgeSe: edge ? edge.se : null,
      vsArm0Bb100: vs ? vs.mean : null,
      vsArm0Se: vs ? vs.se : null,
      chipFlow: Object.fromEntries(
        Object.entries(st.chip)
          .map(([k, v]) => [k, (v / n) * 100] as const)
          .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
      ),
      deviationEdge: Object.fromEntries(
        Object.entries(st.dev)
          .map(([k, v]) => [k, { hands: v.hands, edgeBb100: (v.edge / n) * 100 }] as const)
          .sort((x, y) => Math.abs(y[1].edgeBb100) - Math.abs(x[1].edgeBb100))
      ),
      stats: {
        vpip: ratio('vpip', 'hands'),
        pfr: ratio('pfr', 'hands'),
        threeBet: ratio('threebet', 'threebet_opp'),
        flopAggression: ratio('flop_aggr', 'flop_actions'),
        turnAggression: ratio('turn_aggr', 'turn_actions'),
        riverAggression: ratio('river_aggr', 'river_actions'),
        flopBetWhenCheckedTo: ratio('flop_bets', 'flop_checkedto_or_first'),
        turnBetWhenCheckedTo: ratio('turn_bets', 'turn_checkedto_or_first'),
        riverBetWhenCheckedTo: ratio('river_bets', 'river_checkedto_or_first'),
      },
      horseFoldToBet: st.fold,
      ...(spec.collectTells ? { tells: st.tells } : {}),
      ...(spec.keepPerHand
        ? {
            perHand: st.e.map((x) => Math.round(x * 100) / 100),
            ...(spec.mirror ? { perHandMirror: st.c.map((x) => Math.round(x * 100) / 100) } : {}),
          }
        : {}),
      illegal: st.counters.illegal,
      truncated: st.counters.truncated,
      brainFallbacks: st.counters.brainFallback ?? 0,
    };
  });
  return {
    name: spec.name,
    variant,
    seats,
    stackBB,
    pairs,
    seed,
    arms,
    durationMs: Date.now() - t0,
  };
}

/** Exact-ish all-in equity of `hero` against the actual live opponents' hands (Monte Carlo runouts). */
function horseEqVsActual(hero: Card[], opps: Card[][], board: Card[]): number {
  if (opps.length === 0) return 1;
  return runoutEquity(hero, opps, board);
}

function runoutEquity(hero: Card[], opps: Card[][], board: Card[]): number {
  const used = new Set([...hero, ...opps.flat(), ...board].map(cardKey));
  const deck = referenceDeck().filter((c) => !used.has(cardKey(c)));
  const need = 5 - board.length;
  const score = (bd: Card[]) => {
    const me = scoreOmahaHi(hero, bd);
    let best = -1;
    let ties = 0;
    for (const o of opps) {
      const x = scoreOmahaHi(o, bd);
      if (x > best) {
        best = x;
        ties = 0;
      }
      if (x === best) ties++;
    }
    return me > best ? 1 : me === best ? 1 / (ties + 1) : 0;
  };
  if (need === 0) return score(board);
  if (need === 1) {
    let w = 0;
    for (const c of deck) w += score([...board, c]);
    return w / deck.length;
  }
  // flop: sample 120 turn/river pairs deterministically
  let w = 0;
  let k = 0;
  for (let i = 0; i < deck.length && k < 120; i += 3)
    for (let j = i + 1; j < deck.length && k < 120; j += 7) {
      w += score([...board, deck[i], deck[j]]);
      k++;
    }
  return k ? w / k : 0.5;
}
