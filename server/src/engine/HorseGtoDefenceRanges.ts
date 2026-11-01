/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V72 GTO DEFENCE BY OPENER POSITION — Hold'em facing one open (2026-10-31)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-10-31: "LETS GET THIS MOVING ONTO THE NEXT PHASES ... AUDIT AND
 * IMPROVE ... BASED ON GTO".
 *
 * V70 fixed the OPEN (each seat's own order and width). This is the answer to
 * that open: a single raise, nobody in yet, no-limit two-card hold'em, three
 * or more dealt in. The audit (docs/changelog/2026-10-31-v72-defence-by-
 * opener-position.md) found:
 *
 *  - the defence keyed on five position buckets (THREEBET_VS / CALL_VS and
 *    the V34 big-blind floor), so a big blind defended a hijack open exactly
 *    like an under-the-gun open, a cutoff open exactly like a button open,
 *    and a nine-handed UTG open like a six-handed one;
 *  - the call and 3-bet bluff ranges read the generic high-card ladder, so
 *    the big blind folded suited connectors and small suited kings it should
 *    defend while calling offsuit broadways a solver folds;
 *  - the defence ignored the open SIZE: a 3x open and a 2.5x open were met
 *    with the identical range.
 *
 * WHAT CHANGES. The defender is classed as the big blind, the small blind or
 * an in-position caller; the OPENER is indexed exactly as V70 indexes a seat
 * (dealt-in players still to act behind it, blinds included: SB 1, BTN 2,
 * CO 3, HJ 4, LJ 5, UTG+2 6, UTG+1 7, nine-handed UTG 8). Per (defender,
 * opener) the module supplies:
 *
 *  - a CONTINUE order (call or 3-bet) blended between a reference chart
 *    against a late open and one against an early open, mapped onto the
 *    holdemPreflopScore scale by combo share (V70's scoreAtShare), and the
 *    continue bar from a target width;
 *  - a VALUE 3-bet bar on the legacy ladder (value 3-bets are the top of the
 *    deck, which the ladder ranks well) from a target width;
 *  - a per-class BLUFF 3-bet probability from a reference bluff chart scaled
 *    so the bluffs fill the spot's bluff width exactly (half the solver's:
 *    V72_BLUFF_TRIM, measured against the human-calibrated field).
 *
 * Widths scale with the open size (a bigger open is defended narrower, the
 * big blind most of all because it is the one priced in) and come from
 * separate cash (no ante) and ante (big-blind-ante tournament, ante cash)
 * tables. Style, ICM premium, depth, exploit reads, V53 pressure, V57
 * tournament aggression and V60 cash pressure stay where they were, as
 * deviations from this base (see HorsePreflop).
 *
 * SOURCE. Widths are the standard solver-derived 6-max 100bb cash defence
 * against a 2.5x open (GTO Wizard NL500 simplified shape: big blind ~60% vs
 * BTN, ~49% vs CO, ~36% vs a 6-max UTG; small blind 3-bet-or-fold ~16% vs
 * BTN; button vs CO ~18% with ~9.5% 3-bets) extended to the full ring, and
 * the big-blind-ante MTT chip-EV shape against a 2.2x open (big blind ~72%
 * vs BTN, ~44% vs nine-handed UTG). As with V70, no facing-open solver
 * artifact exists in this repository, so these are reference charts, not a
 * hydrated solver read. The charts supply ORDER; the widths are the tables.
 *
 * Hold'em only. Never keyed on who the opponents are.
 */

import type { Card } from '../types.js';
import { HAND_CLASSES, holdemClass, parseChart, scoreAtShare } from './HorseGtoOpeningRanges.js';
import { holdemPreflopScore } from './HorseEval.js';

export type DefenderGroup = 'bb' | 'sb' | 'ip';

const COMBOS: Record<string, number> = Object.fromEntries(
  HAND_CLASSES.map((h) => [h.cls, h.combos])
);

/** Opener index (players behind) of the late anchor charts. */
const LATE_ANCHOR = 2;
/** Opener index of the early anchor charts (the 6-max UTG / 9-max LJ). */
const EARLY_ANCHOR = 5;

/**
 * Continue charts: the solver's call-or-3-bet frequency per class. They are
 * written generously at the edge, as V70's are, because they supply order.
 */
export const DEFEND_CONTINUE_CHARTS: Readonly<
  Record<DefenderGroup, { late: Record<string, number>; early: Record<string, number> }>
> = {
  bb: {
    // Big blind vs a button open (~62%): every pair and suited hand bar the
    // weakest few, offsuit aces and kings, connected offsuit cards.
    late: parseChart(
      '22+,A2s+,K2s+,Q2s+,J2s+,T2s+,93s+,92s:0.5,84s+,82s-83s:0.5,73s+,72s:0.4,62s+,52s+,42s+,32s,' +
        'A2o+,K5o+,K2o-K4o:0.7,Q8o+,Q5o-Q7o:0.7,Q2o-Q4o:0.3,J8o+,J6o-J7o:0.6,J5o:0.3,T8o+,T6o-T7o:0.6,' +
        '97o+,96o:0.5,86o+,85o:0.4,75o+,74o:0.3,65o,64o:0.4,54o,53o:0.3,43o:0.2'
    ),
    // Big blind vs an early open (~35%): pairs, suited aces and broadways,
    // suited connectors and gappers, the strong offsuit broadways only.
    early: parseChart(
      '22+,A2s+,K6s+,K2s-K5s:0.6,Q8s+,Q5s-Q7s:0.5,J8s+,J7s:0.5,T7s+,97s+,96s:0.4,86s+,85s:0.3,' +
        '75s+,74s:0.2,64s+,53s+,43s:0.5,ATo+,A9o:0.5,A8o:0.2,KJo+,KTo:0.6,QJo:0.8,QTo:0.4,JTo:0.6,T9o:0.2'
    ),
  },
  sb: {
    // Small blind vs a button open (~17%): 3-bet-or-fold, a few flats.
    late: parseChart(
      '66+,22-55:0.5,A2s+,K9s+,K5s-K8s:0.5,Q9s+,Q8s:0.5,J9s+,T9s,T8s:0.5,98s,87s:0.6,76s:0.6,' +
        '65s:0.5,54s:0.4,ATo+,A9o:0.4,A5o:0.3,KTo+,QJo,QTo:0.5,JTo:0.5'
    ),
    // Small blind vs an early open (~9%).
    early: parseChart(
      '88+,22-77:0.4,AJs+,ATs:0.8,A2s-A5s:0.6,A6s-A9s:0.2,KTs+,QTs+,JTs,T9s:0.4,98s:0.2,AQo+,AJo:0.4,KQo:0.6'
    ),
  },
  ip: {
    // Button vs a cutoff open (~18%).
    late: parseChart(
      '22+,A2s+,K8s+,K5s-K7s:0.5,Q9s+,Q8s:0.4,J9s+,J8s:0.4,T8s+,97s+,86s+,75s:0.8,76s,65s,54s:0.6,' +
        'ATo+,A9o:0.4,A5o:0.3,KTo+,QTo+,JTo,T9o:0.2'
    ),
    // In position vs an early open (~11%).
    early: parseChart(
      '77+,22-66:0.7,A9s+,A2s-A5s:0.7,A6s-A8s:0.3,KTs+,K9s:0.4,QTs+,Q9s:0.3,JTs,J9s:0.4,T9s:0.8,' +
        '98s:0.5,87s:0.4,76s:0.3,AJo+,ATo:0.4,KQo,KJo:0.4,QJo:0.2'
    ),
  },
};

/**
 * Bluff 3-bet charts: relative weights. Scaled per spot so the bluffs fill
 * the target bluff width; a weight is the class's share of that budget.
 */
export const DEFEND_BLUFF_CHARTS: Readonly<
  Record<DefenderGroup, { late: Record<string, number>; early: Record<string, number> }>
> = {
  bb: {
    late: parseChart(
      'A2s-A5s,A6s-A9s:0.4,K5s-K9s:0.6,K2s-K4s:0.4,Q6s-Q9s:0.4,J7s-J9s:0.4,T7s-T8s:0.4,96s-97s:0.3,' +
        '85s-86s:0.3,75s:0.3,64s-65s:0.4,53s-54s:0.4,A5o-A9o:0.15,K9o-KTo:0.2,Q9o-QJo:0.2,J9o-JTo:0.15'
    ),
    early: parseChart(
      'A2s-A5s,K9s:0.4,K5s-K8s:0.3,Q9s:0.3,J9s:0.3,T8s:0.3,97s:0.2,86s:0.2,76s:0.3,65s:0.4,54s:0.4'
    ),
  },
  sb: {
    late: parseChart(
      'A2s-A9s,K5s-K9s:0.8,Q8s-Q9s:0.7,J8s-J9s:0.6,T8s-T9s:0.6,97s-98s:0.5,86s-87s:0.5,76s:0.5,' +
        '65s:0.5,54s:0.4,A8o-ATo:0.4,A5o:0.3,KTo-KJo:0.4,QTo-QJo:0.4,JTo:0.3'
    ),
    early: parseChart(
      'A2s-A5s,K9s:0.5,KTs:0.3,Q9s-QTs:0.3,J9s:0.3,T9s:0.4,98s:0.3,87s:0.3,76s:0.3,65s:0.3'
    ),
  },
  ip: {
    late: parseChart(
      'A2s-A5s,A6s-A9s:0.3,K8s-K9s:0.5,Q9s:0.4,J9s:0.4,T8s:0.4,97s:0.3,86s:0.3,76s:0.3,65s:0.3,' +
        '54s:0.3,A9o-ATo:0.2,KJo:0.2,QJo:0.15'
    ),
    early: parseChart('A2s-A5s,K9s:0.3,KTs:0.2,98s:0.2,87s:0.2,76s:0.2,65s:0.2'),
  },
};

/** Target widths (percent of 1,326): total continue and total 3-bet. */
interface Width {
  cont: number;
  threeBet: number;
}

/**
 * Big blind and small blind targets by opener index, cash (no ante) and
 * ante, for a balanced horse at tightness 1.0 against the reference open
 * size. Opener 1 is the small blind (blind against blind, big blind only).
 */
export const DEFEND_TARGET: Readonly<
  Record<'cash' | 'ante', Readonly<Record<'bb' | 'sb', Readonly<Record<number, Width>>>>>
> = {
  cash: {
    bb: {
      1: { cont: 60, threeBet: 15 },
      2: { cont: 60, threeBet: 13 },
      3: { cont: 49, threeBet: 10.5 },
      4: { cont: 42, threeBet: 8.5 },
      5: { cont: 36, threeBet: 7 },
      6: { cont: 33, threeBet: 6.5 },
      7: { cont: 31, threeBet: 6 },
      8: { cont: 29, threeBet: 5.5 },
    },
    sb: {
      2: { cont: 16, threeBet: 13 },
      3: { cont: 13, threeBet: 11 },
      4: { cont: 11, threeBet: 9.5 },
      5: { cont: 9.5, threeBet: 8.5 },
      6: { cont: 8.5, threeBet: 7.5 },
      7: { cont: 7.5, threeBet: 6.5 },
      8: { cont: 7, threeBet: 6 },
    },
  },
  ante: {
    bb: {
      1: { cont: 65, threeBet: 14 },
      2: { cont: 72, threeBet: 12 },
      3: { cont: 64, threeBet: 10.5 },
      4: { cont: 57, threeBet: 9 },
      5: { cont: 52, threeBet: 8 },
      6: { cont: 49, threeBet: 7 },
      7: { cont: 46, threeBet: 6.5 },
      8: { cont: 44, threeBet: 6 },
    },
    sb: {
      2: { cont: 22, threeBet: 13 },
      3: { cont: 18, threeBet: 11 },
      4: { cont: 15, threeBet: 9.5 },
      5: { cont: 13, threeBet: 8.5 },
      6: { cont: 12, threeBet: 7.5 },
      7: { cont: 11, threeBet: 7 },
      8: { cont: 10, threeBet: 6.5 },
    },
  },
};

/**
 * In-position (non-blind) defender, two players behind (the button), by
 * opener index. Each extra player behind the defender takes 2 points of
 * continue and 0.4 of 3-bet away (more players to wake up behind).
 */
export const DEFEND_TARGET_IP: Readonly<Record<'cash' | 'ante', Readonly<Record<number, Width>>>> =
  {
    cash: {
      3: { cont: 18, threeBet: 9.5 },
      4: { cont: 15, threeBet: 8 },
      5: { cont: 13, threeBet: 6.5 },
      6: { cont: 11.5, threeBet: 5.5 },
      7: { cont: 10.5, threeBet: 5 },
      8: { cont: 10, threeBet: 4.5 },
    },
    ante: {
      3: { cont: 22, threeBet: 9.5 },
      4: { cont: 18, threeBet: 8 },
      5: { cont: 16, threeBet: 7 },
      6: { cont: 14, threeBet: 6 },
      7: { cont: 13, threeBet: 5.5 },
      8: { cont: 12, threeBet: 5 },
    },
  };

/** Share of the 3-bet width that is value, by the blend weight toward early. */
const VALUE_FRACTION: Readonly<Record<DefenderGroup, { late: number; early: number }>> = {
  bb: { late: 0.5, early: 0.65 },
  sb: { late: 0.5, early: 0.65 },
  ip: { late: 0.55, early: 0.7 },
};

/**
 * Largest open (raised-to, big blinds) the reference base answers. Past it
 * the raise is not an open these charts describe and the legacy defence
 * keeps it.
 */
export const V72_MAX_OPEN_BB = 6;

/**
 * The share of the solver's bluff 3-bet width the horses use. Measured
 * against the human-calibrated field (five seeds, 6000 pairs each, 100bb /
 * 40bb): the full chart ran -4.1 / -1.4 bb/100, half of it -1.8 / +0.7, none
 * of it +0.4 / +2.2. That population calls 3-bets far more than a solver's
 * opener, so the shape is kept (the same classes, at proportionally the same
 * frequencies) and the width is halved, which puts the total 3-bet back at
 * the old totals (big blind vs BTN ~11%).
 */
export const V72_BLUFF_TRIM = 0.5;

/** Reference open size (big blinds) the targets were written against. */
export function referenceOpenBB(openerBehind: number, ante: boolean): number {
  if (openerBehind <= 1) return ante ? 2.8 : 3.0;
  return ante ? 2.2 : 2.5;
}

/** Blend weight toward the early anchor for an opener index. */
function earlyWeight(openerBehind: number): number {
  return Math.max(0, Math.min(1, (openerBehind - LATE_ANCHOR) / (EARLY_ANCHOR - LATE_ANCHOR)));
}

function clampIndex(k: number): number {
  return Math.max(1, Math.min(8, Math.round(k)));
}

export interface DefenceSpot {
  defender: DefenderGroup;
  /** Dealt-in players behind the opener (V70 index; SB 1 .. 9-max UTG 8). */
  openerBehind: number;
  /** Dealt-in players behind the defender (BB 0, SB 1, BTN 2, ...). */
  defenderBehind: number;
  ante: boolean;
  /** The open, raised-to, in big blinds. */
  openToBB: number;
}

/** Target widths (percent) for a spot, after the open-size scaling. */
export function defenceTargets(spot: DefenceSpot): { cont: number; value: number; bluff: number } {
  const key = spot.ante ? 'ante' : 'cash';
  const k = clampIndex(spot.openerBehind);
  let w: Width;
  if (spot.defender === 'ip') {
    const base = DEFEND_TARGET_IP[key][Math.max(3, k)];
    const extra = Math.max(0, spot.defenderBehind - 2);
    const threeBet = Math.max(2, base.threeBet - 0.4 * extra);
    w = { cont: Math.max(threeBet + 1.5, base.cont - 2 * extra), threeBet };
  } else {
    const table = DEFEND_TARGET[key][spot.defender];
    w = table[spot.defender === 'sb' ? Math.max(2, k) : k];
  }
  // A bigger open is defended narrower, a min-raise wider, gently: the
  // human-calibrated field opens 3.75x with the range it opens 2.5x, and the
  // full pot-odds scaling (exponent 0.75, floor 0.55) ran -7.8 bb/100 against
  // it at 100bb over three seeds where none ran -2.4. The big blind is the
  // seat the price matters to most; the 3-bet moves least.
  const ref = referenceOpenBB(k, spot.ante);
  const ratio = ref / Math.max(1.5, spot.openToBB);
  const contExp = spot.defender === 'bb' ? 0.35 : 0.3;
  const contF = Math.max(0.8, Math.min(1.2, Math.pow(ratio, contExp)));
  const tbF = Math.max(0.85, Math.min(1.1, Math.pow(ratio, 0.15)));
  const threeBet = w.threeBet * tbF;
  const vw = earlyWeight(k);
  const vf = VALUE_FRACTION[spot.defender];
  const valueFrac = vf.late + (vf.early - vf.late) * vw;
  const value = threeBet * valueFrac;
  const solverBluff = threeBet * (1 - valueFrac);
  const bluff = solverBluff * V72_BLUFF_TRIM;
  // The blinds' and in-position seats' trimmed bluffs fold rather than flat
  // (3-bet-or-fold hands); the big blind's call them, as the solver's do.
  const trimmed = spot.defender === 'bb' ? 0 : solverBluff - bluff;
  const cont = Math.max(value + bluff + 1, w.cont * contF - trimmed);
  return { cont, value, bluff };
}

function legacyScore(cls: string): number {
  const suited = cls[2] === 's';
  return holdemPreflopScore(
    { rank: cls[0], suit: 'spades' } as Card,
    { rank: cls[1], suit: suited ? 'spades' : 'hearts' } as Card,
    false
  );
}

const CONT_STRENGTH = new Map<string, Record<string, number>>();
const CONT_ORDER = new Map<string, string[]>();

/** The blended continue order for (defender, opener index). */
export function defenceContinueOrder(defender: DefenderGroup, openerBehind: number): string[] {
  const k = clampIndex(openerBehind);
  const key = `${defender}|${k}`;
  const hit = CONT_ORDER.get(key);
  if (hit) return hit;
  const charts = DEFEND_CONTINUE_CHARTS[defender];
  const w = earlyWeight(k);
  const freq = (cls: string) => (1 - w) * (charts.late[cls] ?? 0) + w * (charts.early[cls] ?? 0);
  // Ties: the nearer anchor alone, then the other, then the legacy ladder.
  const near = w <= 0.5 ? charts.late : charts.early;
  const far = w <= 0.5 ? charts.early : charts.late;
  const order = HAND_CLASSES.map((h) => h.cls).sort((x, y) => {
    const d0 = freq(y) - freq(x);
    if (Math.abs(d0) > 1e-9) return d0;
    const d1 = (near[y] ?? 0) - (near[x] ?? 0);
    if (Math.abs(d1) > 1e-9) return d1;
    const d2 = (far[y] ?? 0) - (far[x] ?? 0);
    if (Math.abs(d2) > 1e-9) return d2;
    return legacyScore(y) - legacyScore(x);
  });
  const map: Record<string, number> = {};
  let cum = 0;
  for (const cls of order) {
    map[cls] = scoreAtShare((cum + COMBOS[cls] / 2) / 1326);
    cum += COMBOS[cls];
  }
  CONT_ORDER.set(key, order);
  CONT_STRENGTH.set(key, map);
  return order;
}

function continueStrengthMap(
  defender: DefenderGroup,
  openerBehind: number
): Record<string, number> {
  defenceContinueOrder(defender, openerBehind);
  return CONT_STRENGTH.get(`${defender}|${clampIndex(openerBehind)}`)!;
}

/** Blended bluff weight for a class (0..1, before the budget scaling). */
function bluffWeight(defender: DefenderGroup, openerBehind: number, cls: string): number {
  const charts = DEFEND_BLUFF_CHARTS[defender];
  const w = earlyWeight(clampIndex(openerBehind));
  return (1 - w) * (charts.late[cls] ?? 0) + w * (charts.early[cls] ?? 0);
}

const BLUFF_MASS = new Map<string, number>();
function bluffMass(defender: DefenderGroup, openerBehind: number, valueBar: number): number {
  const k = clampIndex(openerBehind);
  // Value hands never bluff: the mass counts only classes under the value bar.
  const key = `${defender}|${k}|${valueBar.toFixed(4)}`;
  const hit = BLUFF_MASS.get(key);
  if (hit !== undefined) return hit;
  let m = 0;
  for (const h of HAND_CLASSES) {
    if (legacyScore(h.cls) >= valueBar) continue;
    m += bluffWeight(defender, k, h.cls) * h.combos;
  }
  BLUFF_MASS.set(key, m);
  return m;
}

export interface GtoDefence {
  /** The hand on the continue order, on the holdemPreflopScore scale (no jitter). */
  continueStrength: number;
  /** Continue bar: hands at or above it call or 3-bet. */
  continueBar: number;
  /** Value 3-bet bar on the legacy ladder (compare the legacy strength). */
  valueBar: number;
  /** Probability this class 3-bets as a bluff for a balanced horse. */
  bluffProb: number;
}

/** The defence of these cards in this spot. Null when not a hold'em hand. */
export function gtoDefence(c1: Card, c2: Card, spot: DefenceSpot): GtoDefence | null {
  const cls = holdemClass(c1, c2);
  if (!cls) return null;
  const t = defenceTargets(spot);
  const continueBar = scoreAtShare(t.cont / 100);
  const valueBar = scoreAtShare(t.value / 100);
  const mass = bluffMass(spot.defender, spot.openerBehind, valueBar);
  const scale = mass > 0 ? ((t.bluff / 100) * 1326) / mass : 0;
  const bluffProb = Math.min(1, bluffWeight(spot.defender, spot.openerBehind, cls) * scale);
  const strength = continueStrengthMap(spot.defender, spot.openerBehind)[cls];
  if (strength === undefined) return null;
  return { continueStrength: strength, continueBar, valueBar, bluffProb };
}
