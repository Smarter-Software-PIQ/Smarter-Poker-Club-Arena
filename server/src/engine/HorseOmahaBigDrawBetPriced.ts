/**
 * R4: omahaBigDrawBetIsPricedOnHisResponse (PLO-OWNER lane REPLACEMENTS-5, 2026-11-21).
 *
 * Default OFF (strict `=== true`), PLO4/PLO5 cash only (`omahaPricedInScope`), flop and turn only,
 * checked-to decisions (`decision.action === 'check'`, `toCall <= 0.005`) holding a big draw
 * (`omahaBigDraw`).
 *
 * Replaces the checked-to bet half of `#17` (`omahaBigDrawAggression`), dropping the categorical
 * out-of-position bar (`!inPosition -> never bet`) and replacing the legacy decayed pooled
 * `HorseMind.omahaReadConditionalOf` fold read with ONE lifetime HUD source (`OpponentHud.hudStat`,
 * public actions only, shrinkage `n / (n + k)`, zero cliff, zero person-vs-Horse key):
 *   - fold to big bet:  `<s>.fb.bg.{hu|mw}`
 *   - raise-back:       `<s>.rBet.{hu|mw}`
 *   - post-check stab:  `<s>.stab.{hu|mw}` (when Hero is OOP)
 *
 * Prove-it-to-bet guard: the big-draw bet stands only when `evBet - evCheck > sampleSe + readSpread`
 * and `evBet > 0`; otherwise the check stands. Deterministic, legal actions only, never reads
 * unshown hole cards.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { noteFire, telemetryOn } from './BrainTelemetry.js';
import { omahaPricedInScope } from './HorseOmahaPricedWiring.js';
import {
  OMAHA_BIG_DRAW_OOP_REALISATION,
  OMAHA_BIG_DRAW_SAMPLES,
  omahaBigDraw,
  omahaBigDrawEquities,
  omahaHeroInPosition,
  type OmahaBigDraw,
} from './HorseOmahaBigDrawAggression.js';
import { HUD_DEFAULT_K, hudStat } from './opponentHud/OpponentHud.js';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown): number => (fin(v) ? Math.max(0, v) : 0);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface BigDrawBetResponsePriorRow {
  readonly fbBgHu: number;
  readonly fbBgMw: number;
  readonly rBetHu: number;
  readonly rBetMw: number;
  readonly stabHu: number;
  readonly stabMw: number;
}

/**
 * Measured population fallback priors for flop/turn big-bet response statistics (33,689 public
 * PLO4/PLO5 cash hands, fitHudPriors at e65149c76498). Used ONLY when no HUD packet supplies the
 * cell's own population prior.
 */
export const OMAHA_BIG_DRAW_BET_RESPONSE_PRIORS: Readonly<
  Record<'plo4' | 'plo5', Readonly<Record<'flop' | 'turn', BigDrawBetResponsePriorRow>>>
> = Object.freeze({
  plo4: Object.freeze({
    flop: Object.freeze({
      fbBgHu: 0.58,
      fbBgMw: 0.72,
      rBetHu: 0.12,
      rBetMw: 0.08,
      stabHu: 0.45,
      stabMw: 0.29,
    }),
    turn: Object.freeze({
      fbBgHu: 0.74,
      fbBgMw: 0.83,
      rBetHu: 0.08,
      rBetMw: 0.05,
      stabHu: 0.5,
      stabMw: 0.27,
    }),
  }),
  plo5: Object.freeze({
    flop: Object.freeze({
      fbBgHu: 0.57,
      fbBgMw: 0.72,
      rBetHu: 0.13,
      rBetMw: 0.08,
      stabHu: 0.46,
      stabMw: 0.3,
    }),
    turn: Object.freeze({
      fbBgHu: 0.66,
      fbBgMw: 0.81,
      rBetHu: 0.09,
      rBetMw: 0.05,
      stabHu: 0.51,
      stabMw: 0.26,
    }),
  }),
});

export interface OmahaBigDrawBetResponseVerdict {
  draw: OmahaBigDraw;
  wager: { action: 'bet' | 'all_in'; amount?: number } | null;
  withheld:
    | 'multiway'
    | 'not_nut_end'
    | 'no_wager'
    | 'final_check'
    | 'no_equity'
    | 'proof_bar'
    | null;
  evBet: number;
  evCheck: number;
  gap: number;
  sampleSe: number;
  readSpread: number;
  proof: number;
  foldEquity: number;
  raiseBack: number;
  inPosition: boolean;
}

/** True when R4 owns checked-to big-draw bets in this decision. */
export function omahaBigDrawBetResponseInScope(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  if (opts.omahaBigDrawBetIsPricedOnHisResponse !== true) return false;
  const stage = String(gs.stage ?? '');
  if (stage !== 'flop' && stage !== 'turn') return false;
  if (gs.wagersCapped === true) return false;
  const toCall = fin(gs.toCall)
    ? Math.max(0, gs.toCall)
    : Math.max(0, pos(gs.currentBet) - pos(player.bet));
  if (toCall > 0.005) return false;
  return omahaPricedInScope(player, gs, opts);
}

/**
 * Pure checked-to flop/turn big-draw bet evaluator on lifetime HUD fold, raise-back, and stab cells.
 * Drops the OOP categorical bar and requires `evBet - evCheck > sampleSe + readSpread` & `evBet > 0`.
 */
export function omahaBigDrawBetOnHisResponseVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  extra?: {
    publicTo?: number | 'all_in';
    finalCheckVetoes?: (wager: { action: 'bet' | 'all_in'; amount?: number }) => boolean;
  }
): OmahaBigDrawBetResponseVerdict | null {
  const stage = String(gs.stage ?? '');
  if (stage !== 'flop' && stage !== 'turn') return null;
  if (gs.wagersCapped === true) return null;
  const pot = pos(gs.pot);
  const stack = pos(player.stack);
  const heroBet = pos(player.bet);
  const currentBet = pos(gs.currentBet);
  const toCall = fin(gs.toCall) ? Math.max(0, gs.toCall) : Math.max(0, currentBet - heroBet);
  if (pot <= 0 || stack <= 0 || toCall > 0.005) return null;

  const opponents = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
  );
  if (opponents.length === 0) return null;
  if (opponents.some((p) => p.is_all_in === true || pos(p.stack) <= 0)) return null;

  const hole = player.cards ?? [];
  const board = gs.communityCards ?? [];
  const dead = player.knownDeadCards ?? [];
  const draw = omahaBigDraw(hole, board, dead);
  if (draw === null) return null;

  const inPosition = omahaHeroInPosition(
    player.seat,
    gs.dealerSeat,
    opponents.map((p) => p.seat)
  );
  const held = (
    withheld: NonNullable<OmahaBigDrawBetResponseVerdict['withheld']>,
    nums?: Partial<OmahaBigDrawBetResponseVerdict>
  ): OmahaBigDrawBetResponseVerdict => ({
    draw,
    wager: null,
    withheld,
    evBet: 0,
    evCheck: 0,
    gap: 0,
    sampleSe: 0,
    readSpread: 0,
    proof: 0,
    foldEquity: 0,
    raiseBack: 0,
    inPosition,
    ...nums,
  });

  if (opponents.length >= 3) return held('multiway');
  if (opponents.length === 2 && !draw.nutEnd) return held('not_nut_end');

  const potCapTo = currentBet + pot + toCall;
  const maxRaiseTo = fin(gs.maxRaiseTo) ? gs.maxRaiseTo : Math.min(heroBet + stack, potCapTo);
  const minRaiseTo = fin(gs.minRaiseTo)
    ? gs.minRaiseTo
    : Math.min(
        maxRaiseTo,
        currentBet + Math.max(gs.bigBlind || 0, gs.lastRaise || 0, gs.minRaise || 0)
      );
  const legalActions: readonly string[] = Array.isArray(gs.legalActions)
    ? gs.legalActions
    : [
        'check',
        ...(maxRaiseTo > currentBet + 0.005 && stack > 0.005 ? ['bet'] : []),
        ...(stack > 0 && heroBet + stack <= potCapTo + 0.005 ? ['all_in'] : []),
      ];
  const legal = (a: string): boolean => legalActions.includes(a);
  if (!(maxRaiseTo > currentBet + 0.005) || maxRaiseTo < minRaiseTo) return held('no_wager');
  if (!legal('bet') && !legal('all_in')) return held('no_wager');

  const total = heroBet + stack;
  const cover = Math.max(...opponents.map((o) => pos(o.stack) + pos(o.bet)));
  let to = Math.min(maxRaiseTo, total);
  let jam: boolean;
  if (extra?.publicTo !== undefined) {
    to = extra.publicTo === 'all_in' ? total : Math.min(total, pos(extra.publicTo));
    jam = to >= total - 0.005;
  } else {
    const costPot = to - heroBet;
    const xPot = Math.max(0, Math.min(to, cover) - currentBet);
    const behind = total - to;
    const potAfter = pot + costPot + xPot;
    jam = to >= total - 0.005 || behind <= (stage === 'flop' ? 1 : 0.5) * potAfter + 0.005;
  }
  if (jam) to = total;
  if (jam && !legal('all_in')) {
    if (!legal('bet')) return held('no_wager');
    to = Math.min(maxRaiseTo, total);
    jam = false;
  } else if (!jam && !legal('bet')) return held('no_wager');

  const matched = Math.min(to, cover);
  if (!(matched > currentBet + 0.005)) return held('no_wager');
  const cost = matched - heroBet;
  const x = matched - currentBet;
  const allIn = jam && legal('all_in') && to >= total - 0.005;
  const wager: { action: 'bet' | 'all_in'; amount?: number } = allIn
    ? { action: 'all_in' }
    : { action: 'bet', amount: round2(Math.max(minRaiseTo, to)) };

  if (extra?.finalCheckVetoes && extra.finalCheckVetoes(wager)) return held('final_check');

  const equities = omahaBigDrawEquities(hole, board, dead);
  if (equities === null) return held('no_equity');

  const family: 'plo4' | 'plo5' = hole.length === 5 ? 'plo5' : 'plo4';
  const sk = stage === 'flop' ? 'f' : 't';
  const hu = opponents.length === 1;
  const pl = hu ? 'hu' : 'mw';
  const pri = OMAHA_BIG_DRAW_BET_RESPONSE_PRIORS[family][stage];
  const mind = opts.mind !== false;
  const tele = telemetryOn(opts);

  let foldEquity = 1;
  let noRaiseJoint = 1;
  let noStabJoint = 1;
  let foldThinN = Infinity;
  let foldThinK = HUD_DEFAULT_K;
  let foldThinP = hu ? pri.fbBgHu : pri.fbBgMw;
  let raiseThinN = Infinity;
  let raiseThinK = HUD_DEFAULT_K;
  let raiseThinP = hu ? pri.rBetHu : pri.rBetMw;

  for (const opp of opponents) {
    const id = String(opp.user_id ?? '');
    let fb = hu ? pri.fbBgHu : pri.fbBgMw;
    let rBet = hu ? pri.rBetHu : pri.rBetMw;
    let stab = hu ? pri.stabHu : pri.stabMw;
    let fn = 0;
    let fk = HUD_DEFAULT_K;
    let rn = 0;
    let rk = HUD_DEFAULT_K;

    if (mind && id) {
      const sFb = hudStat(id, family, `${sk}.fb.bg.${pl}`, undefined, tele);
      const sRb = hudStat(id, family, `${sk}.rBet.${pl}`, undefined, false);
      const sSt = hudStat(id, family, `${sk}.stab.${pl}`, undefined, false);
      if (sFb.p !== null) fb = sFb.p;
      if (sRb.p !== null) rBet = sRb.p;
      if (sSt.p !== null) stab = sSt.p;
      fn = sFb.n;
      fk = sFb.k;
      rn = sRb.n;
      rk = sRb.k;
    }

    const fbC = clamp(fb, 0.02, 0.95);
    const rbC = clamp(rBet, 0, Math.max(0, 1 - fbC));
    const stC = clamp(stab, 0, 0.95);

    foldEquity *= fbC;
    noRaiseJoint *= 1 - rbC;
    noStabJoint *= 1 - stC;

    if (fn < foldThinN) {
      foldThinN = fn;
      foldThinK = fk;
      foldThinP = fbC;
    }
    if (rn < raiseThinN) {
      raiseThinN = rn;
      raiseThinK = rk;
      raiseThinP = rbC;
    }
  }

  const eff = Math.min(stack, cover - heroBet);
  const raiseBack = allIn || cost >= eff - 0.005 ? 0 : Math.min(1 - foldEquity, 1 - noRaiseJoint);
  const callShare = Math.max(0, 1 - foldEquity - raiseBack);
  const realBet = allIn || inPosition ? 1 : OMAHA_BIG_DRAW_OOP_REALISATION;
  const evCallBranch = realBet * equities.bet * (pot + cost + x) - cost;
  const tRaise = Math.min(pot + 3 * cost, eff);
  const evRaiseBranch = Math.max(-cost, equities.raise * (pot + 2 * tRaise) - tRaise);
  const evBet = round2(foldEquity * pot + callShare * evCallBranch + raiseBack * evRaiseBranch);

  let evCheck: number;
  if (inPosition) {
    evCheck = round2(equities.all * pot);
  } else {
    const stabJoint = 1 - noStabJoint;
    const dStab = Math.min(0.55 * pot, eff);
    const evVsStab = Math.max(
      0,
      OMAHA_BIG_DRAW_OOP_REALISATION * equities.bet * (pot + 2 * dStab) - dStab
    );
    evCheck = round2(
      (1 - stabJoint) * OMAHA_BIG_DRAW_OOP_REALISATION * equities.all * pot + stabJoint * evVsStab
    );
  }

  const sampleSe = (0.5 / Math.sqrt(OMAHA_BIG_DRAW_SAMPLES)) * (pot + cost + x);
  const sdFold = Math.sqrt(
    (foldThinP * (1 - foldThinP)) / ((Number.isFinite(foldThinN) ? foldThinN : 0) + foldThinK + 1)
  );
  const sdRaise = Math.sqrt(
    (raiseThinP * (1 - raiseThinP)) /
      ((Number.isFinite(raiseThinN) ? raiseThinN : 0) + raiseThinK + 1)
  );
  const readSpread = sdFold * pot + sdRaise * cost;
  const proof = sampleSe + readSpread;
  const gap = round2(evBet - evCheck);
  const nums = {
    evBet,
    evCheck,
    gap,
    sampleSe,
    readSpread,
    proof,
    foldEquity: round2(foldEquity),
    raiseBack: round2(raiseBack),
  };

  if (!(evBet > evCheck + proof) || !(evBet > 0)) return held('proof_bar', nums);
  return {
    draw,
    wager,
    withheld: null,
    inPosition,
    ...nums,
  };
}

/**
 * R4 rule application on a checked-to flop/turn check: returns the priced bet when the draw passes
 * the prove-it-to-bet bar, or keeps the check otherwise. Returns null when option is off or out of
 * scope (legacy path acts unchanged).
 */
export function omahaBigDrawBetOnHisResponseRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  extra?: {
    publicTo?: number | 'all_in';
    finalCheckVetoes?: (wager: { action: 'bet' | 'all_in'; amount?: number }) => boolean;
  }
): HorseDecision | null {
  if (!omahaBigDrawBetResponseInScope(player, gs, opts)) return null;
  if (decision.action !== 'check') return null;
  const tele = telemetryOn(opts);
  try {
    const v = omahaBigDrawBetOnHisResponseVerdict(player, gs, opts, extra);
    if (v === null) return decision;
    if (v.wager === null) {
      if (tele && v.withheld === 'final_check')
        noteFire('omaha_big_draw_bet_on_his_response_final_check_unpriced');
      else if (tele) noteFire('omaha_big_draw_bet_on_his_response_withheld');
      return decision;
    }
    if (tele) noteFire('omaha_big_draw_bet_on_his_response_bet');
    const wagered: HorseDecision = { ...decision, action: v.wager.action };
    if (v.wager.amount === undefined) delete wagered.amount;
    else wagered.amount = v.wager.amount;
    return wagered;
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}
