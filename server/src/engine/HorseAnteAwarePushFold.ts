/**
 * ═══ V71 ANTE-AWARE PUSH/FOLD (2026-10-31) ═══════════════════════════════
 *
 * Dan, 2026-10-31: "AUDIT AND IMPROVE THE HORSES OPENING RANGES IN BOTH
 * TOURNAMENTS AND CASH GAMES ... BASED ON GTO ... MAKE ANY AND ALL
 * IMPROVEMENTS, AND MAKE SURE THEY ARE FULLY ACTIVATED AND LIVE".
 *
 * The V27 push/fold charts (memory_charts_gold) carry identical Tournament
 * and Cash cells: they are the no-ante game. From level 5 every NLH MTT here
 * plays a big-blind ante equal to the big blind, which puts 2.5bb in the pot
 * instead of 1.5bb, and the jam-or-fold ranges that price that pot are far
 * wider (15bb button: 26.6% charted, 36% with the ante). The charts also have
 * five positions, so a nine-handed UTG with eight players behind jammed the
 * six-handed UTG chart (five behind), and with no chart loaded the offline
 * fallback jammed on the old strength ladder instead.
 *
 * This module answers the folded-to jam from one table for every seat:
 * HorseNashPushFold.data.ts, the chip-EV Nash equilibrium of the
 * jam-or-fold game (first caller only, exact hero/caller card removal),
 * solved per dealt-in players behind (1 = the small blind against the big
 * blind, 8 = a nine-handed UTG) and per dead ante of 0, 1 and 2 big blinds.
 * Generator, model and validation: server/scripts/nash-push-fold/ and
 * docs/changelog/2026-10-31-v71-ante-aware-push-fold.md. With no ante it
 * reproduces the solver charts (button 15bb 27.3 vs 26.6, small blind 10bb
 * 58.4 vs 58.3), which is how the table is checked.
 *
 * Each hand carries "jams up to X bb" (the classic chart form, 0.5bb grid);
 * between grid points the jam is mixed linearly across the half-blind gap,
 * and between ante levels the threshold is interpolated. Nothing here reads
 * who a player is: the inputs are the hand, the seat count, the depth and the
 * dead money.
 */
import { NASH_PUSH_FOLD, type NashPushFoldData } from './HorseNashPushFold.data.js';

/** V71 owns the folded-to jam at this depth and shallower (the V27 zone). */
export const V71_PUSH_FOLD_MAX_BB = 15;

const DATA: NashPushFoldData = NASH_PUSH_FOLD;
const ANTE_LEVELS = [0, 1, 2] as const;
const MAX_BEHIND = 8;
const GRID_STEP = 0.5;

const CLASS_INDEX: ReadonlyMap<string, number> = (() => {
  if (!Array.isArray(DATA.classes) || DATA.classes.length !== 169) {
    throw new Error('v71_nash_table_classes');
  }
  const m = new Map<string, number>();
  DATA.classes.forEach((c, i) => m.set(c, i));
  for (let n = 1; n <= MAX_BEHIND; n++)
    for (const a of ANTE_LEVELS) {
      const t = DATA.tables[`${n}|${a}`];
      if (!t || t.pushUpTo.length !== 169 || t.jamPct.length !== DATA.depthGrid.length) {
        throw new Error(`v71_nash_table_shape:${n}|${a}`);
      }
    }
  return m;
})();

const GRID_MAX = DATA.depthGrid[DATA.depthGrid.length - 1];

function comboCount(cls: string): number {
  return cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12;
}

function seatKey(behind: number): number {
  return Math.max(1, Math.min(MAX_BEHIND, Math.round(behind)));
}

/**
 * The deepest stack (big blinds, blind included) at which `hand` still jams
 * from a seat with `behind` dealt-in players to act after it, given `anteBB`
 * big blinds of dead ante in the pot. Interpolated between the 0/1/2bb ante
 * solutions; above 2bb it reads the 2bb one. Null for an unknown hand.
 */
export function nashJamUpTo(hand: string, behind: number, anteBB: number): number | null {
  const k = CLASS_INDEX.get(hand);
  if (k === undefined || !(behind >= 1)) return null;
  const n = seatKey(behind);
  const a = Math.max(0, Math.min(2, Number.isFinite(anteBB) ? anteBB : 0));
  const lo = Math.floor(a);
  const hi = Math.min(2, lo + 1);
  const tLo = DATA.tables[`${n}|${lo}`].pushUpTo[k];
  if (hi === lo) return tLo;
  const tHi = DATA.tables[`${n}|${hi}`].pushUpTo[k];
  return tLo + (tHi - tLo) * (a - lo);
}

/**
 * Probability the folded-to seat jams `hand` at `depthBB`. 1 at or under the
 * hand's threshold, 0 half a blind past it, linear between (the equilibrium
 * boundary lies inside that grid gap). A hand that jams at the top of the
 * solved grid always jams.
 */
export function nashJamProbability(args: {
  hand: string | null;
  behind: number;
  depthBB: number;
  anteBB: number;
}): number | null {
  if (!args.hand || !(args.depthBB > 0)) return null;
  const upTo = nashJamUpTo(args.hand, args.behind, args.anteBB);
  if (upTo === null) return null;
  if (upTo >= GRID_MAX) return 1;
  return Math.max(0, Math.min(1, (upTo + GRID_STEP - args.depthBB) / GRID_STEP));
}

/** Combo-weighted jam share (0..100) at a depth, for tests and the audit. */
export function nashJamWidth(behind: number, depthBB: number, anteBB: number): number {
  let jam = 0;
  for (const cls of DATA.classes) {
    const p = nashJamProbability({ hand: cls, behind, depthBB, anteBB }) ?? 0;
    jam += p * comboCount(cls);
  }
  return (100 * jam) / 1326;
}

/** The solved equilibrium width on the grid itself (before the threshold form). */
export function nashSolvedWidth(behind: number, depthBB: number, ante: 0 | 1 | 2): number | null {
  const i = DATA.depthGrid.indexOf(depthBB);
  if (i === -1) return null;
  return DATA.tables[`${seatKey(behind)}|${ante}`].jamPct[i];
}
