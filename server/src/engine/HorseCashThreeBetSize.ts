import { chipStepFor } from './HorseNlhOpenSize.js';

/** Cash NLH only. The caller owns action/range selection and legal stack caps.
 * Value, bluff and squeeze raises share this card-blind size distribution.
 * At ordinary depth: 3-3.5x IP / 4-4.5x OOP, with 8BB / 10BB floors versus
 * small opens. Each cold-caller adds one open. Short stacks use smaller bands;
 * deep stacks add half an open. These are source policy, not solved-EV claims.
 * Shared cash sizing deliberately does not accept a style or hand-strength dial.
 */
export function cashNlhThreeBetRaiseTo(args: {
  inPosition: boolean;
  depthBB: number;
  openTo: number;
  bigBlind: number;
  callers: number;
  rand: () => number;
}): number {
  const short = args.depthBB <= 40;
  const deep = args.depthBB > 150 ? 0.5 : 0;
  const ip = args.inPosition;
  const baseLo = short ? (ip ? 2.7 : 3.2) : ip ? 3 : 4;
  const baseHi = short ? (ip ? 3.1 : 3.8) : ip ? 3.5 : 4.5;
  const floorBB = short ? (ip ? 6.5 : 8) : ip ? 8 : 10;
  const callers = Math.max(0, Math.floor(args.callers));
  const lo = Math.max((baseLo + deep) * args.openTo, floorBB * args.bigBlind);
  const hi = Math.max((baseHi + deep) * args.openTo, lo + 0.5 * args.bigBlind);
  const raw = args.rand();
  const u = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
  const target = lo + (hi - lo) * u + callers * args.openTo;
  // The final legalizer floors to this grid. Draw on it first so a coarse
  // whole-chip table cannot turn a 3x floor into a smaller final raise.
  const step = chipStepFor(args.bigBlind);
  const floor = Math.ceil((lo + callers * args.openTo) / step - 1e-9) * step;
  return Math.round(Math.max(floor, Math.round(target / step) * step) * 100) / 100;
}
