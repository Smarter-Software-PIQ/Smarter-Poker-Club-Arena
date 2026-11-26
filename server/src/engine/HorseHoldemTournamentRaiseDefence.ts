/**
 * ═══ HOLD'EM TOURNAMENT RAISE DEFENCE IS PRICED (2026-11-24) ════════════
 *
 * One priced model behind three options (default OFF, each read `=== true`):
 *   holdemTournamentHeadsUpBigBlindDefenceIsPriced  heads-up big blind facing the small blind's non-all-in open;
 *   holdemTournamentBlindDefenceIsPriced       three or more dealt, a blind facing one non-all-in open;
 *   holdemTournamentCommittedRaiseIsPriced          the Horse already raised and faces a non-all-in re-raise, or
 *                                                   any non-all-in raise that commits the Horse.
 * Evidence (read-only sweep NLH-TOURNAMENT-SWEEP, 2026-11-24): the heads-up big blind under 20 big blinds folded
 * 82% to a small open (any two cards break even near 36%) and never called; both blinds at 10-15 big blinds folded
 * 74% to small late steals (break even near 47%); a non-all-in 3-bet got 56-62% folds and a raise to just under
 * all in 76%, where a jam at the same price got 58%. Root cause on main (re-read 2026-11-24 at 0c78ed79): the
 * short-stack preflop node of HorsePreflop (the push/fold zone: stackBB <= 12, red/orange M up to 22 big blinds,
 * the short-handed <= 15 big blind zone) answers ANY faced raise with "jam on real strength" against a fixed bar
 * (0.72, 0.85 against two raises) and otherwise folds: a non-all-in raise is never called and nothing prices it;
 * the heads-up priced defences start at 20 big blinds (HU_BB_MIN_STACK_BB); the all-in call price
 * (holdemTournamentAllInCallIsPriced) answers only a jam or a call that puts the Horse all in.
 *
 * THE DECISION. Fold, call or shove (all in), whichever has the highest expected value in chips, losses weighted by
 * the bubble factor where the engine's pay-jump layer says a pay jump is live (HorseLogic.payJumpBubbleFactor;
 * 1 elsewhere: heads-up of an event, PKO, satellite or unknown context play chip EV). No random number is drawn
 * anywhere in this file: the equities come from a fixed 169 x 169 table (HorseHoldemPreflopClassEquity.data.ts,
 * generated offline), the ranges from a fixed table of measured frequencies
 * (HorseHoldemTournamentRaiseDefencePriors.data.ts) and the public action. Two actions within TIE_EPS_BB of each
 * other are broken by the fixed order fold, call, shove (the earlier one is kept): the same state always gives the
 * same action. A non-all-in re-raise is never priced or returned: inside the scope the answer is one of the three.
 *
 *   EV(fold)  = 0 (chips already in are gone either way).
 *   EV(call)  = (1 - s) [ (1 - o) ( r P - BF (1 - r) C ) + o ( r3 (P + Co) - BF (1 - r3) C ) ] - s C
 *     r = realisation(SPR, position) x equity vs his range; s / o the measured squeeze / overcall shares of the
 *     players still behind (a squeeze is priced as the call lost); r3 the three-way share: realisation x the product
 *     of the two heads-up equities (the overcaller's range the top squeeze + overcall width), Co his call;
 *     a call that leaves the Horse committed (chips behind after calling <= COMMIT_BEHIND_SHARE of the pot, or the
 *     raise >= COMMIT_RAISE_SHARE of the Horse's chips) is priced as the all-in it is: the raiser's whole range, no
 *     fold, every chip in: e (P + Ar) - BF (1 - e) Ah  (exactly the all-in call price of a jam of that size).
 *   EV(shove) = (1 - q) [ f P + (1 - f) ( ec (P + Ar) - BF (1 - ec) Ah ) ] + q [ ew (P + Aw) - BF (1 - ew) Ah ]
 * P the pot now (every chip in the middle), C the call, Ah / Ar the chips the Horse / the raiser add when all in,
 * f the raiser's fold to the shove (0 when the raiser is himself committed by the same rule), ec the equity
 * against the strongest (1 - f) of his range, q the chance a player still behind wakes up (each with the top
 * OVERCALL_SHARE of the re-jam width for his depth, the all-in call module's own numbers), ew the equity against the
 * widest such player.
 *
 * THE RANGES. The raiser's range is the top W of hands in the Nash caller order (STRENGTH_ORDER of
 * HorseHoldemTournamentAllInCall): the shape the shown hands support (see the priors file: the non-all-in open is
 * spread over the whole voluntary first-in range, so W = the measured open share plus the measured open-jam share
 * for his seat and depth). An opener: W = open + openJam (by players behind, heads-up apart). A cold 3-bettor:
 * W = threeBet + threeBetJam. A 4-bettor: his open width times (fourBet + fourBetJam). His fold to the shove:
 * openFoldToJam (heads-up apart) / threeBetFoldToJam at the price the shove lays him (the required equity of his
 * call; a 4-bettor's fold to a 5-bet jam is not measured and is taken as 0).
 * Where the raiser's own record is credibly outside the population (HorseOpponentExploit read, engaged), the width
 * is scaled by his first-in raise share over the population's and the fold by his fold to a 3-bet over the
 * population's (the caller passes the two ratios). Nobody is treated differently for who he is.
 *
 * REALISATION (call branch only; not measured, stated): a base by stack-to-pot ratio after the call, out of
 * position 0.95 at SPR 1 falling to 0.80 at SPR 3 and 0.70 at SPR 8 (the 0.7 of huBbDefendsUnreadToPrice at 20-50
 * big blinds), in position 1.00 / 0.92 / 0.85, linear between and flat outside; plus a slope x (equity - the fair
 * share: 0.5 heads-up, 1/3 three-way), the slope rising from 0.3 at SPR 1 to 0.6 at SPR 3 and beyond (a weak hand realises less of its equity than
 * a strong one, and the less so the closer the stacks are to all in), kept within [0.4, 1.1].
 */
import type { Card } from '../types.js';
import {
  HOLDEM_PREFLOP_CLASS_EQUITY_U16_BASE64,
  HOLDEM_PREFLOP_CLASS_EQUITY_VERSION,
} from './HorseHoldemPreflopClassEquity.data.js';
import {
  HOLDEM_TOURNAMENT_RAISE_DEFENCE_DEPTH_EDGES,
  HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS,
  HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS_VERSION,
  type PriorCell,
} from './HorseHoldemTournamentRaiseDefencePriors.data.js';
import {
  HOLDEM_CLASSES,
  OVERCALL_SHARE,
  holdemClassComboCount,
  holdemClassOf,
  holdemRangeWidth,
  holdemTopOfRange,
  holdemTopRange,
  rejamWidth,
  type HoldemClassRange,
} from './HorseHoldemTournamentAllInCall.js';

export const HOLDEM_TOURNAMENT_RAISE_DEFENCE_MODEL_VERSION =
  'holdem-tournament-raise-defence-v1' as const;
/** Effective depth (big blinds, the shorter of the Horse and the raiser, chips at the start of the street) a blind defence is priced to. */
export const RAISE_DEFENCE_BLIND_MAX_BB = 25;
/** Effective depth a re-raise after the Horse's own raise is priced to (a committing raise: any depth). */
export const RAISE_DEFENCE_RERAISE_MAX_BB = 40;
/** Committed: chips behind after the call at most this share of the pot after the call ... */
export const COMMIT_BEHIND_SHARE = 0.25;
/** ... or the raise (street total) at least this share of the chips the player had at the start of the street. */
export const COMMIT_RAISE_SHARE = 0.8;
/** Two actions closer than this (big blinds) are a tie, broken by the fixed order fold, call, shove. */
export const TIE_EPS_BB = 0.01;
export const RAISE_DEFENCE_ACTION_ORDER = ['fold', 'call', 'shove'] as const;
export type RaiseDefenceAction = (typeof RAISE_DEFENCE_ACTION_ORDER)[number];
/** Measured-read scales are kept inside these bounds. */
export const READ_SCALE_MIN = 0.5;
export const READ_SCALE_MAX = 2.5;

// ── The equity table ───────────────────────────────────────────────────────
const EQ: Uint16Array = (() => {
  const bytes = Buffer.from(HOLDEM_PREFLOP_CLASS_EQUITY_U16_BASE64, 'base64');
  const out = new Uint16Array(169 * 169);
  for (let i = 0; i < out.length; i++) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return out;
})();
if (EQ.length !== 169 * 169) throw new Error('holdem preflop class equity table: wrong size');
export const RAISE_DEFENCE_EQUITY_VERSION = HOLDEM_PREFLOP_CLASS_EQUITY_VERSION;
export const RAISE_DEFENCE_PRIORS_VERSION = HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS_VERSION;

/** The table equity of class h against class v (0..1). */
export function classVsClassEquity(h: number, v: number): number {
  return EQ[h * 169 + v] / 65535;
}

const RANKS = 'AKQJT98765432';
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const cardKey = (c: Card): number => RANKS.indexOf(c.rank) * 4 + SUITS.indexOf(c.suit);
/** The deck ids of every combo of each class. */
const CLASS_COMBOS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = HOLDEM_CLASSES.map(
  (cls) => {
    const r1 = RANKS.indexOf(cls[0]);
    const r2 = RANKS.indexOf(cls[1]);
    const out: Array<readonly [number, number]> = [];
    if (cls.length === 2) {
      for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) out.push([r1 * 4 + a, r2 * 4 + b]);
    } else if (cls.endsWith('s')) {
      for (let s = 0; s < 4; s++) out.push([r1 * 4 + s, r2 * 4 + s]);
    } else {
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) if (a !== b) out.push([r1 * 4 + a, r2 * 4 + b]);
    }
    return out;
  }
);

/**
 * The Horse's equity against a range: the table equity of its class against each class, weighted by the range
 * weight times the combos of that class its two cards leave possible (exact card removal by combo count). Null
 * when the range holds no possible combo or the cards are not two known cards.
 */
export function equityVsRange(hero: readonly Card[], range: HoldemClassRange): number | null {
  if (hero.length !== 2) return null;
  const cls = holdemClassOf(hero[0], hero[1]);
  if (!cls) return null;
  const h = HOLDEM_CLASSES.indexOf(cls);
  const k0 = cardKey(hero[0]);
  const k1 = cardKey(hero[1]);
  if (h < 0 || k0 < 0 || k1 < 0 || k0 === k1) return null;
  let num = 0;
  let den = 0;
  for (let v = 0; v < 169; v++) {
    const w = range[v];
    if (!(w > 0)) continue;
    let n = 0;
    for (const [a, b] of CLASS_COMBOS[v]) if (a !== k0 && a !== k1 && b !== k0 && b !== k1) n++;
    if (n === 0) continue;
    num += w * n * classVsClassEquity(h, v);
    den += w * n;
  }
  return den > 0 ? num / den : null;
}

// ── The priors ─────────────────────────────────────────────────────────────
const EDGES = HOLDEM_TOURNAMENT_RAISE_DEFENCE_DEPTH_EDGES;
/** Bucket centres (big blinds) for linear interpolation: <10, 10-15, 15-20, 20-30, 30-50, 50+. */
const CENTRES: readonly number[] = [5, 12.5, 17.5, 25, 40, 75];
if (CENTRES.length !== EDGES.length + 1) throw new Error('raise defence priors: bucket count');

/** A prior cell row read at a depth: linear between bucket centres, flat beyond the ends. */
export function priorAt(cells: readonly PriorCell[], depthBB: number): number {
  const d = Number.isFinite(depthBB) ? depthBB : CENTRES[0];
  if (d <= CENTRES[0]) return cells[0].p;
  for (let i = 1; i < CENTRES.length; i++) {
    if (d <= CENTRES[i]) {
      const t = (d - CENTRES[i - 1]) / (CENTRES[i] - CENTRES[i - 1]);
      return cells[i - 1].p + t * (cells[i].p - cells[i - 1].p);
    }
  }
  return cells[cells.length - 1].p;
}

/** The behind group of a first-in raiser: 'hu' with two dealt, else his players behind (1 = SB ... '5+'). */
export function openerGroup(dealt: number, raiserBehind: number): string {
  if (dealt <= 2) return 'hu';
  const b = Math.max(1, Math.round(raiserBehind));
  return b >= 5 ? '5+' : String(b);
}

const clampScale = (x: number | null | undefined): number =>
  Number.isFinite(x) && (x as number) > 0
    ? Math.max(READ_SCALE_MIN, Math.min(READ_SCALE_MAX, x as number))
    : 1;

export type RaiserRole = 'open' | 'three_bet' | 'four_bet';

export interface RaiserModel {
  role: RaiserRole;
  /** Share of all hands (0..1) in his range. */
  width: number;
  range: HoldemClassRange;
  /** His measured fold to an all-in re-raise by the price of his call (null: not measured, taken as 0). */
  foldCells: readonly PriorCell[] | null;
  /** His own record over the population's (1 without an engaged read). */
  foldScale: number;
}

/** Price bucket centres (the caller's required equity): <30%, 30-35, 35-40, 40-45, 45%+. */
const PRICE_CENTRES: readonly number[] = [0.25, 0.325, 0.375, 0.425, 0.5];

/** His fold to the shove at the price the shove lays him (linear between bucket centres), within [0, 1]. */
export function foldToShoveAt(model: RaiserModel, requiredEquity: number): number {
  const cells = model.foldCells;
  if (!cells) return 0;
  const x = Number.isFinite(requiredEquity) ? requiredEquity : PRICE_CENTRES[2];
  let f: number;
  if (x <= PRICE_CENTRES[0]) f = cells[0].p;
  else if (x >= PRICE_CENTRES[PRICE_CENTRES.length - 1]) f = cells[cells.length - 1].p;
  else {
    let i = 1;
    while (x > PRICE_CENTRES[i]) i++;
    const t = (x - PRICE_CENTRES[i - 1]) / (PRICE_CENTRES[i] - PRICE_CENTRES[i - 1]);
    f = cells[i - 1].p + t * (cells[i].p - cells[i - 1].p);
  }
  return Math.max(0, Math.min(1, f * model.foldScale));
}

/**
 * The raiser's range and fold to a shove from the priors at his depth, scaled by his own measured record where
 * the caller supplies one (widthScale: his first-in raise share over the population's; foldScale: his fold to a
 * 3-bet over the population's).
 */
export function raiserModel(args: {
  role: RaiserRole;
  depthBB: number;
  dealt: number;
  /** For an opener (and a 4-bettor's open): his players behind when he opened. */
  raiserBehind: number;
  widthScale?: number | null;
  foldScale?: number | null;
}): RaiserModel {
  const P = HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS;
  const d = args.depthBB;
  const g = openerGroup(args.dealt, args.raiserBehind);
  const openWidth = priorAt(P.open[g], d) + priorAt(P.openJam[g], d);
  let width: number;
  let foldCells: readonly PriorCell[] | null;
  if (args.role === 'open') {
    width = openWidth;
    foldCells = P.openFoldToJam[args.dealt <= 2 ? 'hu' : 'ring'];
  } else if (args.role === 'three_bet') {
    width = priorAt(P.threeBet, d) + priorAt(P.threeBetJam, d);
    foldCells = P.threeBetFoldToJam;
  } else {
    width = openWidth * (priorAt(P.fourBet, d) + priorAt(P.fourBetJam, d));
    foldCells = null;
  }
  width = Math.max(0.01, Math.min(1, width * clampScale(args.widthScale)));
  return {
    role: args.role,
    width,
    range: holdemTopRange(width),
    foldCells,
    foldScale: clampScale(args.foldScale),
  };
}

// ── The price ──────────────────────────────────────────────────────────────
/** Call-branch realisation by stack-to-pot ratio after the call, position and the hand's equity (file header). */
export function realisation(
  spr: number,
  inPosition: boolean,
  equity: number,
  fairShare = 0.5
): number {
  const base = realisationBase(spr, inPosition);
  const x = Number.isFinite(spr) ? Math.max(0, spr) : 8;
  const slope = x <= 1 ? 0.3 : x >= 3 ? 0.6 : 0.3 + ((x - 1) / 2) * 0.3;
  return Math.max(0.4, Math.min(1.1, base + slope * (equity - fairShare)));
}

function realisationBase(spr: number, inPosition: boolean): number {
  const pts: ReadonlyArray<readonly [number, number]> = inPosition
    ? [
        [1, 1.0],
        [3, 0.92],
        [8, 0.85],
      ]
    : [
        [1, 0.95],
        [3, 0.8],
        [8, 0.7],
      ];
  const x = Number.isFinite(spr) ? Math.max(0, spr) : pts[2][0];
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
    }
  return pts[pts.length - 1][1];
}

/** Committed by the stated rule: chips behind after calling are a small share of the pot, or the raise is most of the stack. */
export function isCommitted(args: {
  behindAfterCall: number;
  potAfterCall: number;
  raiseTo: number;
  chipsAtStreetStart: number;
}): boolean {
  return (
    args.behindAfterCall <= COMMIT_BEHIND_SHARE * args.potAfterCall + 1e-9 ||
    args.raiseTo >= COMMIT_RAISE_SHARE * args.chipsAtStreetStart - 1e-9
  );
}

export interface BehindPlayer {
  /** Chips he has at the start of the street (stack + street bet). */
  total: number;
  bet: number;
}

export interface RaiseDefenceSpot {
  hero: readonly Card[];
  bb: number;
  /** Every chip in the middle now (street bets and dead money). */
  pot: number;
  heroStack: number;
  heroBet: number;
  raiserStack: number;
  raiserBet: number;
  heroInPosition: boolean;
  raiser: RaiserModel;
  behind: readonly BehindPlayer[];
  bubbleFactor: number;
  canCall: boolean;
  canShove: boolean;
}

export interface RaiseDefenceVerdict {
  action: RaiseDefenceAction;
  /** Expected values in big blinds. */
  evFold: 0;
  evCall: number | null;
  evShove: number | null;
  committed: boolean;
  raiserCommitted: boolean;
  /** The Horse's equity against the raiser's whole range, against his calling range, against a wake-up. */
  equity: number;
  equityCalled: number;
  equityWake: number | null;
  wakeProbability: number;
  squeezeProbability: number;
  overcallProbability: number;
  realisation: number | null;
  foldToShove: number;
  raiserWidth: number;
  bubbleFactor: number;
  modelVersion: typeof HOLDEM_TOURNAMENT_RAISE_DEFENCE_MODEL_VERSION;
}

/** The three expected values and the chosen action; null when the spot cannot be priced. */
export function priceRaiseDefence(s: RaiseDefenceSpot): RaiseDefenceVerdict | null {
  const bb = s.bb;
  if (!(bb > 0) || !(s.pot > 0) || !(s.heroStack > 0)) return null;
  const bf = Number.isFinite(s.bubbleFactor) && s.bubbleFactor >= 1 ? s.bubbleFactor : 1;
  const C = Math.max(0, s.raiserBet - s.heroBet);
  if (!(C > 0) || C >= s.heroStack) return null;
  const P = s.pot;
  const heroTotal = s.heroStack + s.heroBet;
  const raiserTotal = s.raiserStack + s.raiserBet;
  const eq = equityVsRange(s.hero, s.raiser.range);
  if (eq === null) return null;
  // All in: what each adds.
  const matched = Math.min(heroTotal, raiserTotal);
  const Ah = Math.max(0, matched - s.heroBet);
  const Ar = Math.max(0, matched - s.raiserBet);
  const committed = isCommitted({
    behindAfterCall: s.heroStack - C,
    potAfterCall: P + C,
    raiseTo: s.raiserBet,
    chipsAtStreetStart: heroTotal,
  });
  // The raiser is committed by his own raise (the same rule, read on his chips: what he has behind against the pot
  // once the Horse has called, or a raise of most of his chips): facing the shove he never folds.
  const raiserCommitted = isCommitted({
    behindAfterCall: s.raiserStack,
    potAfterCall: P + C,
    raiseTo: s.raiserBet,
    chipsAtStreetStart: raiserTotal,
  });
  // His fold to the shove, read at the price the shove lays him.
  const f = raiserCommitted || !(Ar > 0) ? 0 : foldToShoveAt(s.raiser, Ar / (P + Ah + Ar));
  const callingRange = f > 0 ? holdemTopOfRange(s.raiser.range, 1 - f) : s.raiser.range;
  const eqCalled = (f > 0 ? equityVsRange(s.hero, callingRange) : eq) ?? eq;
  // Players still to act behind the Horse: after a call (measured squeeze and overcall shares) ...
  const PR = HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS;
  let noSqueeze = 1;
  let noOvercall = 1;
  let overcaller: { width: number; call: number } | null = null;
  for (const p of s.behind) {
    const depth = Math.min(p.total, heroTotal) / bb;
    const sq = Math.max(0, Math.min(1, priorAt(PR.squeeze, depth)));
    const oc = Math.max(0, Math.min(1, priorAt(PR.overcall, depth)));
    noSqueeze *= 1 - sq;
    noOvercall *= 1 - oc;
    if (!overcaller || oc > overcaller.width)
      overcaller = { width: Math.min(1, sq + oc), call: Math.max(0, s.raiserBet - p.bet) };
  }
  const squeezeP = 1 - noSqueeze;
  const overcallP = 1 - noOvercall;
  // ... and after a shove (a wake-up).
  let nobody = 1;
  let widest: { width: number; total: number; bet: number } | null = null;
  for (const p of s.behind) {
    const depth = Math.min(p.total, heroTotal) / bb;
    const w = Math.max(0, Math.min(1, rejamWidth(depth) * OVERCALL_SHARE));
    nobody *= 1 - w;
    if (!widest || w > widest.width) widest = { width: w, total: p.total, bet: p.bet };
  }
  const q = 1 - nobody;
  let eqWake: number | null = null;
  let evWake = 0;
  if (widest && q > 0) {
    eqWake = equityVsRange(s.hero, holdemTopRange(widest.width));
    const mW = Math.min(heroTotal, widest.total);
    const AhW = Math.max(0, mW - s.heroBet);
    const AwW = Math.max(0, mW - widest.bet);
    if (eqWake !== null) evWake = eqWake * (P + AwW) - bf * (1 - eqWake) * AhW;
  }
  const allInEv = (e: number) => e * (P + Ar) - bf * (1 - e) * Ah;
  let evShove: number | null = null;
  if (s.canShove) {
    const headsUp = f * P + (1 - f) * allInEv(eqCalled);
    evShove = (1 - q) * headsUp + q * evWake;
  }
  let evCall: number | null = null;
  let r: number | null = null;
  if (s.canCall) {
    if (committed) {
      evCall = (1 - q) * allInEv(eq) + q * evWake;
    } else {
      const spr = Math.min(s.heroStack - C, s.raiserStack) / (P + C);
      r = realisation(spr, s.heroInPosition, eq);
      const re = Math.max(0, Math.min(1, r * eq));
      const evHeadsUp = re * P - bf * (1 - re) * C;
      let evThreeWay = evHeadsUp;
      if (overcaller && overcallP > 0) {
        const eo = equityVsRange(s.hero, holdemTopRange(Math.max(0.01, overcaller.width)));
        if (eo !== null) {
          const pot3 = P + C + overcaller.call;
          const e3 = eq * eo;
          const r3 = realisation(Math.min(s.heroStack - C, s.raiserStack) / pot3, false, e3, 1 / 3);
          const re3 = Math.max(0, Math.min(1, r3 * e3));
          evThreeWay = re3 * (P + overcaller.call) - bf * (1 - re3) * C;
        }
      }
      evCall =
        (1 - squeezeP) * ((1 - overcallP) * evHeadsUp + overcallP * evThreeWay) - squeezeP * C;
    }
  }
  const evs: Record<RaiseDefenceAction, number | null> = { fold: 0, call: evCall, shove: evShove };
  let action: RaiseDefenceAction = 'fold';
  for (const a of RAISE_DEFENCE_ACTION_ORDER) {
    const v = evs[a];
    if (v === null) continue;
    if (v > (evs[action] as number) + TIE_EPS_BB * bb) action = a;
  }
  return {
    action,
    evFold: 0,
    evCall: evCall === null ? null : evCall / bb,
    evShove: evShove === null ? null : evShove / bb,
    committed,
    raiserCommitted,
    equity: eq,
    equityCalled: eqCalled,
    equityWake: eqWake,
    wakeProbability: q,
    squeezeProbability: squeezeP,
    overcallProbability: overcallP,
    realisation: r,
    foldToShove: f,
    raiserWidth: holdemRangeWidth(s.raiser.range),
    bubbleFactor: bf,
    modelVersion: HOLDEM_TOURNAMENT_RAISE_DEFENCE_MODEL_VERSION,
  };
}

/** Combos of a class (re-exported for the measurement scripts and tests). */
export { holdemClassComboCount };
