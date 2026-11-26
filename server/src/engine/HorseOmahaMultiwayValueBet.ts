/**
 * THE PRICED MULTIWAY VALUE BET (option omahaMultiwayValueBetIsPriced, default OFF, read `=== true`; PLO-OWNER
 * lead-6 2026-11-24, multiway/MULTIWAY-AUDIT-AND-PLAN.md item M3; rebuilt 2026-11-24 v2). PLO4 / PLO5 cash (table and
 * Lightning, one board, high only, no bomb pot), flop / turn / river, nothing to call, two to four live opponents who
 * have ALL checked this street (the Horse is last to act), and the decision the chain reached is a CHECK. A player
 * still to act is not capped by a check; his range is not measured, so that spot is not priced (real-card grade of the
 * rebuild: bets with no one behind +6.3 +/- 0.9 bb, with one or two behind +2.6 +/- 1.4 and +0.6 +/- 4.9).
 *
 * WHY. Measured on shown hands: PLO5 turn nuts are checked 21-25% of the time multiway against 0% heads-up, and
 * straight-or-better 37% (3-way) and 52% (4+-way) against 15% heads-up; strong hands get MORE passive multiway.
 *
 * PRICE (v2). Against every live opponent at once, on the same cards (HorseOmahaPricedJointSample):
 *   EV(check) = the Horse's showdown pot share against the k players' MEASURED CHECKED range (the strength of
 *               players who checked a multiway street nobody wagered, showdown-bias corrected: tables `checker`)
 *               x the pot;
 *   EV(bet b) = A x pot + sum over j >= 1 of P(j call) x [R_j x (-b) + (1 - R_j) x (share against j callers'
 *               measured calling range without its nut bin x (pot + (j + 1) b)(1 - rake) - b)],
 * A = the field's all-fold share: the measured share of multiway first wagers of this size that every player folded,
 * anchored to equilibrium (never above b / (pot + b), the most a sound field gives up to a bet of b); callers
 * independent at the per-player rate that gives A; R_j = 1 - (1 - r)^j, r = the caller range's nut-bin mass: a
 * caller with the nuts raises, and the Horse, not holding them, gives up the bet. Sizes tried: a third, a half and
 * three quarters of the pot (within the legal range and the stack). The best bet replaces the check when it is worth
 * more than the check by the margin of the facing-bet verdicts (2% of the pot), and only as a VALUE bet: the callers
 * put chips in behind on balance, sum over j of P(j call) x (share_j x (j + 1) - 1) > 0 (a bet that wins only by
 * folds is a bluff, which this option never makes; multiway bluffs are item M7, not built). Later streets are not
 * priced. It never turns a bet into a check and never touches a hand facing a wager. Identity-free: the field is
 * the measured pooled range; nobody is keyed.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { noteFire } from './BrainTelemetry.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import {
  omahaMeasuredCallerHist,
  omahaMeasuredBucketOf,
  omahaMeasuredCheckerHist,
  omahaMeasuredFieldAllFold,
  omahaMeasuredWeakShare,
  type OmahaMeasuredStreet,
} from './HorseOmahaMeasuredBettorRange.js';
import { omahaPricedJointRows } from './HorseOmahaPricedJointSample.js';

export const OMAHA_MULTIWAY_VALUE_BET_SIZES: readonly number[] = [1 / 3, 0.5, 0.75];
/** The margin the bet must clear over the check, share of the pot (OMAHA_FACING_BET_EV_MARGIN). */
export const OMAHA_MULTIWAY_VALUE_BET_MARGIN = 0.02;

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
  /** what the callers put in behind on balance at the chosen size, per chip bet: sum_j P(j | called) (share_j (j+1) - 1) */
  valueShare: number | null;
}

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
  // every live opponent has checked this street: the checked range is measured; a player still to act is not capped
  // by a check and his range is not measured here, so the spot is not priced (the check stands)
  const history = gs.actionHistory;
  if (!Array.isArray(history)) return null;
  const acted = new Set(history.filter((a) => a && a.stage === street).map((a) => a.seat));
  if (live.some((p) => !acted.has(p.seat))) return null;
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  const hole = player.cards ?? [];
  const board = gs.communityCards ?? [];
  const dead = player.knownDeadCards ?? [];
  const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
  const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
  if (!(pot > 0) || !(stack > 0)) return null;
  const checked = omahaMeasuredCheckerHist(variant, street, k);
  if (!checked) return null;
  const keep = 1 - Math.max(0, Math.min(0.2, Number.isFinite(rake) ? rake : 0));
  /** the hand's pot share against n players all drawn from this range */
  const shareVs = (hist: readonly number[], n: number): number | null => {
    const rows = omahaPricedJointRows(hole, board, dead, hist, {
      always: Array.from({ length: n - 1 }, () => hist),
      behind: 0,
      continueRate: 0,
      behindHist: null,
    });
    if (!rows) return null;
    const w = omahaMeasuredWeakShare(hist);
    return (1 - w) * rows.value + w * rows.weak;
  };
  const shareMemo = new Map<string, number | null>();
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
    const measuredAllFold = omahaMeasuredFieldAllFold(variant, street, frac, k);
    const callers0 = omahaMeasuredCallerHist(variant, street, frac, 'mw');
    if (measuredAllFold === null || !callers0) continue;
    // a caller holding the nuts (the strongest bin) raises: the calls the bet is priced against are the rest
    const r = Math.max(0, Math.min(1, callers0[0]));
    if (!(r < 1)) continue;
    const callers = callers0.map((x, b) => (b === 0 ? 0 : x / (1 - r)));
    // anchored to equilibrium: a sound field gives up at most b / (pot + b) to a bet of b
    const allFold = Math.min(measuredAllFold, amount / (pot + amount));
    const c = 1 - Math.pow(Math.max(1e-6, Math.min(1, allFold)), 1 / k);
    const bk = omahaMeasuredBucketOf(frac);
    let ev = allFold * pot;
    let value = 0;
    let called = 0;
    let priced = true;
    for (let j = 1; j <= k; j++) {
      const pj = binomial(k, j) * Math.pow(c, j) * Math.pow(1 - c, k - j);
      if (!(pj > 0)) continue;
      const mk = `${bk}|${j}`;
      if (!shareMemo.has(mk)) shareMemo.set(mk, shareVs(callers, j));
      const share = shareMemo.get(mk) as number | null;
      if (share === null) {
        priced = false;
        break;
      }
      const raised = 1 - Math.pow(1 - r, j);
      ev +=
        pj * (raised * -amount + (1 - raised) * (share * (pot + (j + 1) * amount) * keep - amount));
      value += pj * (share * (j + 1) - 1);
      called += pj;
    }
    if (!priced || !(called > 0)) continue;
    // a value bet only: the callers put chips in behind on balance
    if (!(value > 0)) continue;
    if (evCheck === null) {
      const s = shareVs(checked, k);
      if (s === null) return null;
      evCheck = s * pot * keep;
    }
    if (ev > best.evBet)
      best = { amount, evCheck, evBet: ev, size: frac, valueShare: value / called };
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
