/**
 * omahaBigBetSizeIsPriced (PLO-OWNER lead-4 lane LEAKS-RULES, 2026-11-21; default OFF, read `=== true`).
 *
 * Priced, lifetime-HUD replacement for `#18` (`omahaBigBetIsPotShare`) in PLO4/PLO5 cash (high-only, single board,
 * not tournament / bomb pot / all-in-or-fold / fixed limit). Zero person-vs-Horse key, zero unshown cards, zero
 * fixed 20 BB chip cliff or discrete 0.70 pot-share step:
 *
 *  1. Facing a turn or river wager (`applyOmahaBigBetSizeRange`): replaces both the 20 BB chip mark and the 0.70
 *     pot-share tier cliff with a continuous `pricedBetStrength` (`pStrong` in `[0.50, 0.94]`) derived from the
 *     smooth pot-share curve `frac / (frac + 0.55)`, line street/raise count, and the bettor's lifetime public HUD
 *     showdown big-bet value share (`sd.strongBig.{t|r}`, `sd.strong.{t|r}`) and bet frequency (`{t|r}.betCk`) via
 *     `hudStat` (`n / (n + k)` shrinkage). Also sets `tierByPotShare = true` so the 20 BB mark never steps the tier.
 *
 *  2. Limped-pot small bet sizing (`omahaPricedLimpedPotSize`): replaces the blanket `max(2 BB, 40% pot)` floor
 *     with an expected-value comparison between the proposed bet `amt` and the legal candidate `target` using
 *     exact/sampled equity (`omahaEvHandCounts` on turn/river, `omahaFlopEvCounts` on flop), each live opponent's
 *     lifetime public HUD fold-to-bet (`{f|t|r}.fb.{sm|bg}.{hu|mw}`) and raise-vs-bet (`{f|t|r}.rBet.{hu|mw}`)
 *     interpolated smoothly by pot share, realization, and rake drag. Resizes only when `EV(target) > EV(amt) + 0.02 * pot`.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import { variantInfo, type OppPostflopRead } from './HorseEval.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaEvHandCounts } from './HorseOmahaFacingBetEv.js';
import { omahaFlopEvCounts } from './HorseOmahaFlopFacingBetEv.js';
import { hudStat } from './opponentHud/OpponentHud.js';
import type { HudFamily } from './opponentHud/OpponentHudProfile.js';

export const OMAHA_BIG_BET_SIZE_OPTION = 'omahaBigBetSizeIsPriced' as const;
export const OMAHA_BIG_BET_SIZE_MARGIN_FRAC = 0.02;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

function hudFamilyOf(holeCount: number): HudFamily | null {
  return holeCount === 4 ? 'plo4' : holeCount === 5 ? 'plo5' : null;
}

/**
 * Strict scope check: PLO4/PLO5 cash, high-only, single board, pot-limit/no-limit, not tournament, not bomb pot,
 * not all-in-or-fold, not capped. Returns `{ family, holeCount }` when in scope, else `null`.
 */
export function omahaBigBetSizeScope(
  player: SeatPlayer,
  gs: HorseGameStateV2
): { family: HudFamily; holeCount: 4 | 5 } | null {
  if (!player || !gs) return null;
  if (gs.bettingStructure === 'fixed_limit' || gs.allInOrFold === true || gs.wagersCapped === true)
    return null;
  if (gs.bombPot === true) return null;
  if (gs.gameMode === 'tournament' || Boolean(gs.tournament)) return null;
  if (
    (gs.boardCount ?? 1) > 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0
  )
    return null;
  const vi = variantInfo(gs.gameVariant);
  if (!vi.isOmaha || vi.isFixedLimit) return null;
  const isHiLo = gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo;
  if (isHiLo) return null;
  if (vi.holeCount !== 4 && vi.holeCount !== 5) return null;
  const family = hudFamilyOf(vi.holeCount);
  if (!family) return null;
  return { family, holeCount: vi.holeCount };
}

export interface OmahaPricedBigBetStrengthParams {
  frac: number;
  street: 'turn' | 'river';
  holeCount: 4 | 5;
  streets: number;
  raised: boolean;
  opponentId?: string | null;
  /** Emit HUD read receipts when reading lifetime profile. */
  receipt?: boolean;
}

/**
 * Pure continuous aggressor value-share (`pStrong` in `[0.50, 0.94]`) for a turn or river bettor.
 * Smooth in pot share `frac` (no 20 BB chip cliff, no 0.70 pot-share step) and continuously adjusted
 * by the bettor's public lifetime HUD showdown strength (`sd.strongBig.{t|r}`, `sd.strong.{t|r}`)
 * and bet rate (`{t|r}.betCk`) using `n / (n + k)` shrinkage.
 */
export function omahaPricedBigBetStrength(params: OmahaPricedBigBetStrengthParams): number {
  const frac = fin(params.frac) && params.frac > 0 ? params.frac : 0.5;
  const fracFactor = clamp(frac / (frac + 0.55), 0, 1);
  const streets = clamp(Math.round(fin(params.streets) ? params.streets : 1), 1, 3);
  const lineBoost = (streets - 1) * 0.045 + (params.raised ? 0.05 : 0);

  const st = params.street === 'river' ? 'r' : 't';
  const strongBigPrior = params.street === 'river' ? 0.76 : 0.72;
  const strongPrior = params.street === 'river' ? 0.72 : 0.68;
  const betCkPrior = params.street === 'river' ? 0.34 : 0.36;

  let showdownShift = 0;
  let freqShift = 0;

  if (params.opponentId) {
    const family = params.holeCount === 5 ? 'plo5' : 'plo4';
    const receipt = params.receipt === true;
    const bigRead = hudStat(
      params.opponentId,
      family,
      `sd.strongBig.${st}`,
      strongBigPrior,
      receipt
    );
    const anyRead = hudStat(params.opponentId, family, `sd.strong.${st}`, strongPrior, receipt);
    const betRead = hudStat(params.opponentId, family, `${st}.betCk`, betCkPrior, receipt);

    // Weight big-bet showdown read more heavily as bet pot-share grows; smoothly blended with overall street showdown.
    const bigWeight = clamp(frac / (frac + 0.6), 0.25, 0.85);
    const pBig = bigRead.p ?? strongBigPrior;
    const pAny = anyRead.p ?? strongPrior;
    const targetPrior = bigWeight * strongBigPrior + (1 - bigWeight) * strongPrior;
    const blendedStrong = bigWeight * pBig + (1 - bigWeight) * pAny;
    showdownShift = clamp((blendedStrong - targetPrior) * 0.25, -0.12, 0.12);

    const pBet = betRead.p ?? betCkPrior;
    // Higher betting frequency -> wider/bluffier range -> lower pStrong; tighter bettor -> higher pStrong.
    freqShift = clamp(-(pBet - betCkPrior) * 0.2, -0.1, 0.1);
  }

  const base = (params.street === 'river' ? 0.6 : 0.58) + (params.holeCount === 5 ? 0.03 : 0);
  return round4(clamp(base + 0.24 * fracFactor + lineBoost + showdownShift + freqShift, 0.5, 0.94));
}

/**
 * Replaces the 20 BB / 0.70 pot-share tier cliff on `oppReads` for turn and river decisions in scope.
 * Returns true if at least one opponent read received a continuous `pricedBetStrength`.
 */
export function applyOmahaBigBetSizeRange(
  oppReads: Array<OppPostflopRead | null> | null | undefined,
  opponents: ReadonlyArray<{ user_id?: string | null }>,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  tele: boolean
): boolean {
  if (!oppReads || oppReads.length === 0) return false;
  const stage = String(gs.stage ?? '');
  if (stage !== 'turn' && stage !== 'river') return false;
  const scope = omahaBigBetSizeScope(player, gs);
  if (!scope) return false;

  let applied = false;
  for (let i = 0; i < oppReads.length; i++) {
    const r = oppReads[i];
    if (!r || (r.streets == null && !r.raised && !(r.aggrW > 0))) continue;
    if (r.lastStage !== stage) continue;
    const frac = fin(r.lastFrac) && r.lastFrac > 0 ? r.lastFrac : null;
    if (frac === null) continue;
    const oppId = opponents[i]?.user_id ?? null;
    r.tierByPotShare = true;
    r.pricedBetStrength = omahaPricedBigBetStrength({
      frac,
      street: stage,
      holeCount: scope.holeCount,
      streets: r.streets ?? 1,
      raised: r.raised === true,
      opponentId: oppId,
      receipt: tele,
    });
    applied = true;
  }
  return applied;
}

interface OpponentBetResponse {
  foldSm: number;
  foldBg: number;
  raiseRate: number;
}

function readOpponentBetResponses(
  opponents: ReadonlyArray<SeatPlayer>,
  family: HudFamily,
  stage: 'flop' | 'turn' | 'river',
  tele: boolean
): OpponentBetResponse[] {
  const st = stage === 'flop' ? 'f' : stage === 'turn' ? 't' : 'r';
  const mw = opponents.length <= 1 ? 'hu' : 'mw';
  const smPrior = mw === 'hu' ? 0.28 : 0.36;
  const bgPrior = mw === 'hu' ? 0.48 : 0.56;
  const raisePrior = mw === 'hu' ? 0.1 : 0.08;

  return opponents.map((opp) => {
    const uid = opp.user_id ?? '';
    const fSm = uid
      ? (hudStat(uid, family, `${st}.fb.sm.${mw}`, smPrior, tele).p ?? smPrior)
      : smPrior;
    const fBg = uid
      ? (hudStat(uid, family, `${st}.fb.bg.${mw}`, bgPrior, tele).p ?? bgPrior)
      : bgPrior;
    const rBet = uid
      ? (hudStat(uid, family, `${st}.rBet.${mw}`, raisePrior, tele).p ?? raisePrior)
      : raisePrior;
    // Guarantee non-decreasing fold with bet size so pricing stays monotone.
    const foldSm = clamp(fSm, 0.04, 0.85);
    const foldBg = clamp(Math.max(foldSm, fBg), foldSm, 0.9);
    const raiseRate = clamp(rBet, 0, Math.max(0, 1 - foldBg));
    return { foldSm, foldBg, raiseRate };
  });
}

function heroEquityVsContinue(
  hole: SeatPlayer['cards'],
  board: HorseGameStateV2['communityCards'],
  dead: SeatPlayer['knownDeadCards'],
  stage: 'flop' | 'turn' | 'river',
  continueShare: number
): number | null {
  if (!Array.isArray(hole) || !Array.isArray(board)) return null;
  const deadCards = Array.isArray(dead) ? dead : [];
  if (stage === 'flop') {
    if (board.length !== 3) return null;
    const counts = omahaFlopEvCounts(hole, board, deadCards, continueShare);
    if (!counts) return null;
    return clamp(counts.value.win + 0.5 * counts.value.tie, 0, 1);
  }
  if ((stage === 'turn' && board.length !== 4) || (stage === 'river' && board.length !== 5))
    return null;
  const counts = omahaEvHandCounts(hole, board, deadCards, continueShare);
  if (!counts) return null;
  return clamp(counts.value.win + 0.5 * counts.value.tie, 0, 1);
}

/**
 * Computes net chip EV of betting `size` into `pot` against `responses` on `stage` (net of `rake`).
 * Pure helper exposed for unit/law testing.
 */
export function priceBetSizeEv(params: {
  size: number;
  pot: number;
  rake: number;
  stage: 'flop' | 'turn' | 'river';
  responses: readonly OpponentBetResponse[];
  equityAt: (continueShare: number) => number | null;
}): number | null {
  const { size, pot, rake, stage, responses, equityAt } = params;
  if (!(size > 0) || !(pot > 0) || responses.length === 0) return null;
  const frac = size / pot;
  // Smooth interpolation weight across small (~0.25 pot) to big (~0.75 pot) bets: zero step cliff.
  const t = clamp((frac - 0.25) / 0.5, 0, 1);
  let pAllFold = 1;
  let sumFold = 0;
  let sumRaise = 0;
  for (const r of responses) {
    const f = clamp((1 - t) * r.foldSm + t * r.foldBg, 0.02, 0.92);
    pAllFold *= f;
    sumFold += f;
    sumRaise += Math.min(r.raiseRate, 1 - f);
  }
  const avgFold = sumFold / responses.length;
  const continueShare = clamp(1 - avgFold, 0.12, 0.92);
  const eqRaw = equityAt(continueShare);
  if (eqRaw === null) return null;
  // Multiway continuing equity discount when multiple live opponents can continue.
  const nCallers = Math.max(1, responses.length * (1 - avgFold));
  const eq = nCallers > 1 ? Math.pow(eqRaw, Math.min(1.6, 0.7 + 0.3 * nCallers)) : eqRaw;
  const realize = stage === 'river' ? 1 : stage === 'turn' ? 0.85 : 0.78;
  const rakeKeep = clamp(1 - (fin(rake) ? rake : 0), 0.8, 1);
  const evFold = pot * rakeKeep;
  const evCall = eq * realize * (pot + 2 * size) * rakeKeep - size;
  const raiseRisk = Math.min(0.6, sumRaise) * 0.25 * size * (1 - eq);
  return pAllFold * evFold + (1 - pAllFold) * (evCall - raiseRisk);
}

export interface OmahaPricedLimpedPotResult {
  decision: HorseDecision;
  outcome: 'resized' | 'kept' | 'none';
}

/**
 * Priced replacement for the blanket limped-pot minimum bet floor (`omahaLimpedPotMinBetFloor`).
 * Compares EV of the proposed small bet `amt` vs the legal `target = snap(clamp(max(2*bb, 0.40*pot), minR, maxR))`.
 * Resizes ONLY when `EV(target) > EV(amt) + 0.02 * pot`; otherwise keeps `decision`.
 */
export function omahaPricedLimpedPotSize(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  rake: number,
  tele: boolean
): OmahaPricedLimpedPotResult {
  const none: OmahaPricedLimpedPotResult = { decision, outcome: 'none' };
  if (decision.action !== 'bet') return none;
  const stage = String(gs.stage ?? '');
  if (stage !== 'flop' && stage !== 'turn' && stage !== 'river') return none;
  const scope = omahaBigBetSizeScope(player, gs);
  if (!scope) return none;

  const bb = fin(gs.bigBlind) && gs.bigBlind > 0 ? gs.bigBlind : 0;
  const pot = fin(gs.pot) ? gs.pot : 0;
  const stack = fin(player.stack) ? player.stack : 0;
  const amt = fin(decision.amount) ? decision.amount : 0;
  const floor = bb * 2;
  if (!(bb > 0) || !(pot >= bb * 4 - 0.005) || !(amt > 0) || !(amt < floor - 0.005)) return none;

  const vi = variantInfo(gs.gameVariant);
  const minR = fin(gs.minRaiseTo) && gs.minRaiseTo > 0 ? gs.minRaiseTo : bb;
  const maxR =
    fin(gs.maxRaiseTo) && gs.maxRaiseTo > 0
      ? Math.min(gs.maxRaiseTo, stack)
      : Math.min(vi.isPotLimit ? pot : stack, stack);
  if (!(maxR >= floor - 0.005) || !(stack > floor + 0.005)) return none;

  const rawTarget = Math.min(maxR, Math.max(minR, round2(Math.max(floor, pot * 0.4))));
  const step = bb >= 1 ? 1 : 0.01;
  const target = round2(Math.min(maxR, Math.max(minR, Math.round(rawTarget / step) * step)));
  if (!(target > amt + 0.005)) return none;

  const liveOpps = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out && p.is_all_in !== true
  );
  if (liveOpps.length === 0) return none;

  try {
    const responses = readOpponentBetResponses(liveOpps, scope.family, stage, tele);
    const equityAt = (share: number): number | null =>
      heroEquityVsContinue(player.cards, gs.communityCards, player.knownDeadCards, stage, share);
    const evCurrent = priceBetSizeEv({ size: amt, pot, rake, stage, responses, equityAt });
    const evTarget = priceBetSizeEv({ size: target, pot, rake, stage, responses, equityAt });
    if (evCurrent === null || evTarget === null) return none;

    const margin = OMAHA_BIG_BET_SIZE_MARGIN_FRAC * pot;
    if (evTarget > evCurrent + margin) {
      return { decision: { ...decision, amount: target }, outcome: 'resized' };
    }
    return { decision, outcome: 'kept' };
  } catch {
    return none;
  }
}
