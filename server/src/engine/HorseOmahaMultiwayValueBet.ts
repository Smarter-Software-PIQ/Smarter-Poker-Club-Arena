/**
 * THE PRICED MULTIWAY VALUE BET (option omahaMultiwayValueBetIsPriced, default OFF, read `=== true`; PLO-OWNER
 * lead-6 2026-11-24, multiway/MULTIWAY-AUDIT-AND-PLAN.md item M3). PLO4 / PLO5 cash (table and Lightning, one board,
 * high only, no bomb pot), flop / turn / river, nothing to call, two or more live opponents, and the decision the
 * chain reached is a CHECK.
 *
 * WHY. Measured on shown hands: PLO5 turn nuts are checked 21-25% of the time multiway against 0% heads-up, and
 * straight-or-better 37% (3-way) and 52% (4+-way) against 15% heads-up; strong hands get MORE passive multiway.
 *
 * PRICE. Against every live opponent at once, on the same cards (HorseOmahaPricedJointSample):
 *   EV(check) = the Horse's showdown pot share against the field's whole range x the pot;
 *   EV(bet b) = P(all fold) x pot + sum over j >= 1 of P(j call) x [share against j callers' measured calling
 *               range x (pot + (j + 1) b)(1 - rake) - b],
 * with P(all fold) the measured share of multiway first wagers of this size to which every player folded, and the
 * players who call independent at the per-player rate that gives it. Sizes tried: a third, a half and three
 * quarters of the pot (within the legal range and the stack). The best bet replaces the check when it is worth more
 * than the check by the margin of the facing-bet verdicts (2% of the pot), and only as a VALUE bet: the hand's
 * showdown share against one caller's measured calling range is at least one half (a bet that wins only by folds is
 * a bluff, which this option never makes; multiway bluffs are item M7, not built). Raises over the Horse's bet and later
 * streets are not priced (both sides of the comparison see the same later streets; a raise over a value bet is
 * answered by the facing-bet price). It never turns a bet into a check and never touches a hand facing a wager.
 * Identity-free: the field is the measured pooled range; nobody is keyed.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { noteFire } from './BrainTelemetry.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import {
  OMAHA_MEASURED_BIN_EDGES,
  OMAHA_MEASURED_BINS,
  omahaMeasuredCallerHist,
  omahaMeasuredBucketOf,
  omahaMeasuredFieldAllFold,
  omahaMeasuredWeakShare,
  type OmahaMeasuredStreet,
} from './HorseOmahaMeasuredBettorRange.js';
import { omahaPricedJointRows } from './HorseOmahaPricedJointSample.js';

export const OMAHA_MULTIWAY_VALUE_BET_SIZES: readonly number[] = [1 / 3, 0.5, 0.75];
/** The margin the bet must clear over the check, share of the pot (OMAHA_FACING_BET_EV_MARGIN). */
export const OMAHA_MULTIWAY_VALUE_BET_MARGIN = 0.02;

/** The range of a player who has not shown strength on this street: holdings uniform by strength. */
const UNIFORM: readonly number[] = Array.from(
  { length: OMAHA_MEASURED_BINS },
  (_, b) => OMAHA_MEASURED_BIN_EDGES[b + 1] - OMAHA_MEASURED_BIN_EDGES[b]
);

function binomial(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

export interface OmahaMultiwayValueBetVerdict {
  amount: number | null;
  evCheck: number;
  evBet: number;
  size: number | null;
  /** the hand's showdown share against one caller's measured calling range at the chosen size */
  valueShare: number | null;
}

/** A value bet: the hand wins at least this share against one caller's range when called. */
export const OMAHA_MULTIWAY_VALUE_BET_AHEAD = 0.5;

/** The priced bet against the check, or null outside the spot or with nothing to price. */
export function omahaMultiwayValueBetVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  rake: number
): OmahaMultiwayValueBetVerdict | null {
  if (!omahaNoCategoricalRulesInScope(player, gs)) return null;
  if (gs.bettingStructure === 'fixed_limit') return null;
  const street = String(gs.stage ?? '') as OmahaMeasuredStreet;
  if (street !== 'flop' && street !== 'turn' && street !== 'river') return null;
  const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - heroBet);
  if (toCall > 0.005) return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('bet')) return null;
  const live = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_all_in && !p.is_sitting_out
  );
  const k = live.length;
  if (k < 2 || k > 4) return null;
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  const hole = player.cards ?? [];
  const board = gs.communityCards ?? [];
  const dead = player.knownDeadCards ?? [];
  const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
  const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
  if (!(pot > 0) || !(stack > 0)) return null;
  const keep = 1 - Math.max(0, Math.min(0.2, Number.isFinite(rake) ? rake : 0));
  const shareMemo = new Map<string, number | null>();
  /** the hand's pot share against j callers of a wager of this size (memoised per size bucket) */
  const shareAgainst = (frac: number, callers: readonly number[], j: number): number | null => {
    const mk = `${omahaMeasuredBucketOf(frac)}|${j}`;
    if (shareMemo.has(mk)) return shareMemo.get(mk) as number | null;
    const rows = omahaPricedJointRows(hole, board, dead, callers, {
      always: Array.from({ length: j - 1 }, () => callers),
      behind: 0,
      continueRate: 0,
      behindHist: null,
    });
    const w = omahaMeasuredWeakShare(callers);
    const out = rows ? (1 - w) * rows.value + w * rows.weak : null;
    shareMemo.set(mk, out);
    return out;
  };
  let evCheck: number | null = null;
  const lo = Number.isFinite(gs.minRaiseTo)
    ? Math.max(0, gs.minRaiseTo as number)
    : Math.max(0, gs.bigBlind ?? 0);
  const hi = Math.min(stack, Number.isFinite(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : pot);
  let best: OmahaMultiwayValueBetVerdict = {
    amount: null,
    evCheck: 0,
    evBet: -Infinity,
    size: null,
    valueShare: null,
  };
  for (const size of OMAHA_MULTIWAY_VALUE_BET_SIZES) {
    const amount = Math.round(Math.max(lo, Math.min(hi, size * pot)) * 100) / 100;
    if (!(amount > 0) || amount > stack + 1e-9 || amount < lo - 1e-9) continue;
    const frac = amount / pot;
    const allFold = omahaMeasuredFieldAllFold(variant, street, frac, k);
    const callers = omahaMeasuredCallerHist(variant, street, frac, 'mw');
    if (allFold === null || !callers) continue;
    // a value bet only: ahead of one caller's range when called (checked first: most hands stop here)
    const one = shareAgainst(frac, callers, 1);
    if (one === null || one < OMAHA_MULTIWAY_VALUE_BET_AHEAD) continue;
    if (evCheck === null) {
      // the check: the whole field shows down its whole range
      const all = omahaPricedJointRows(hole, board, dead, UNIFORM, {
        always: Array.from({ length: k - 1 }, () => UNIFORM),
        behind: 0,
        continueRate: 0,
        behindHist: null,
      });
      if (!all) return null;
      const wU = omahaMeasuredWeakShare(UNIFORM);
      evCheck = ((1 - wU) * all.value + wU * all.weak) * pot * keep;
    }
    const c = 1 - Math.pow(Math.max(1e-6, Math.min(1, allFold)), 1 / k);
    let ev = allFold * pot;
    for (let j = 1; j <= k; j++) {
      const pj = binomial(k, j) * Math.pow(c, j) * Math.pow(1 - c, k - j);
      if (!(pj > 0)) continue;
      const share = shareAgainst(frac, callers, j);
      if (share === null) return null;
      ev += pj * (share * (pot + (j + 1) * amount) * keep - amount);
    }
    if (ev > best.evBet) best = { amount, evCheck, evBet: ev, size: frac, valueShare: one };
  }
  if (evCheck === null) return { ...best, evCheck: 0, amount: null };
  if (best.amount === null || !(best.evBet > evCheck + OMAHA_MULTIWAY_VALUE_BET_MARGIN * pot))
    return { ...best, amount: null };
  return best;
}

/** The rule: a final check in the spot becomes the priced bet where it is worth more by the margin. */
export function omahaMultiwayValueBetRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: { telemetry: boolean; rake: number }
): HorseDecision {
  if (decision.action !== 'check') return decision;
  try {
    const v = omahaMultiwayValueBetVerdict(player, gs, ctx.rake);
    if (!v) return decision;
    if (v.amount === null) {
      if (ctx.telemetry) noteFire('omaha_multiway_value_bet_check_kept');
      return decision;
    }
    if (ctx.telemetry) noteFire('omaha_multiway_value_bet_priced_bet');
    return { ...decision, action: 'bet', amount: v.amount };
  } catch {
    if (ctx.telemetry) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}
