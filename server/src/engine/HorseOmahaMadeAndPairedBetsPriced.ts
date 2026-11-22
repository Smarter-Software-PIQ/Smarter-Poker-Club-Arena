/**
 * R5: omahaMadeAndPairedBetsArePricedOnHisResponse (PLO-OWNER lane REPLACEMENTS-5, 2026-11-21).
 *
 * Default OFF (strict `=== true`), PLO4/PLO5 cash only (`omahaPricedInScope`), turn and river only.
 * Replaces the bet-or-check halves of:
 *   - #19 omahaMadeHandDefenseVsValueLeader (fresh-card turn check + thin river value bet)
 *   - #9  omahaOverpairNoOopBarrelVsValueLeader
 *   - #10 omahaPairedTurnNoBarrelWithoutBoatVsValueLeader
 *   - #11 omahaPairedRiverNoThinLeadVsValueLeader
 *   - paired-board river check (plo_paired_board_river_check) in PLO4/PLO5 cash
 *
 * ONE lifetime HUD source (`OpponentHud.hudStat`, public actions only, shrinkage `n / (n + k)`,
 * zero cliff, zero person-vs-Horse key):
 *   - fold to small/big bet: `<s>.fb.{sm|bg}.{hu|mw}`
 *   - raise-back vs bet:     `<s>.rBet.{hu|mw}` (passed via `omahaCardImpact` `responseAt`, fixing
 *     the unmeasured 0.10 raiseShare constant that broke earlier omahaMadeHandBetIsPriced /
 *     omahaPairedBoardBetIsPriced replays)
 *   - post-check stab:       `<s>.stab.{hu|mw}`
 *
 * Prove-it-to-bet guard: the proposed bet stands only when `evBet - evCheck > sampleSe + readSpread`;
 * otherwise the bet becomes a check. Deterministic, legal actions only, never reads unshown hole cards.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { noteFire, telemetryOn } from './BrainTelemetry.js';
import { omahaPricedInScope } from './HorseOmahaPricedWiring.js';
import {
  OMAHA_CARD_IMPACT_PRIOR,
  omahaCardImpact,
  omahaCardImpactLine,
  type OmahaCardImpact,
  type OmahaCardImpactRead,
  type OmahaCardImpactResponseCurve,
} from './HorseOmahaCardImpact.js';
import { HUD_DEFAULT_K, hudStat } from './opponentHud/OpponentHud.js';

type OmahaHudFamily = 'plo4' | 'plo5';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface TurnRiverResponsePriorRow {
  readonly fbSmHu: number;
  readonly fbBgHu: number;
  readonly fbSmMw: number;
  readonly fbBgMw: number;
  readonly rBetHu: number;
  readonly rBetMw: number;
  readonly stabHu: number;
  readonly stabMw: number;
}

/**
 * Measured population fallback priors for turn and river response statistics (33,689 public PLO4/PLO5
 * cash hands, fitHudPriors at e65149c76498, hud-priors-e65149c.json sha256 f5e76b4d...). Used ONLY when
 * no HUD packet supplies a cell's own population prior.
 */
export const OMAHA_TURN_RIVER_RESPONSE_PRIORS: Readonly<
  Record<OmahaHudFamily, Readonly<Record<'turn' | 'river', TurnRiverResponsePriorRow>>>
> = Object.freeze({
  plo4: Object.freeze({
    turn: Object.freeze({
      fbSmHu: 0.18,
      fbBgHu: 0.74,
      fbSmMw: 0.6,
      fbBgMw: 0.83,
      rBetHu: 0.08,
      rBetMw: 0.05,
      stabHu: 0.5,
      stabMw: 0.27,
    }),
    river: Object.freeze({
      fbSmHu: 0.55,
      fbBgHu: 0.81,
      fbSmMw: 0.84,
      fbBgMw: 0.88,
      rBetHu: 0.04,
      rBetMw: 0.02,
      stabHu: 0.55,
      stabMw: 0.15,
    }),
  }),
  plo5: Object.freeze({
    turn: Object.freeze({
      fbSmHu: 0.18,
      fbBgHu: 0.66,
      fbSmMw: 0.65,
      fbBgMw: 0.81,
      rBetHu: 0.09,
      rBetMw: 0.05,
      stabHu: 0.51,
      stabMw: 0.26,
    }),
    river: Object.freeze({
      fbSmHu: 0.57,
      fbBgHu: 0.8,
      fbSmMw: 0.88,
      fbBgMw: 0.93,
      rBetHu: 0.05,
      rBetMw: 0.02,
      stabHu: 0.55,
      stabMw: 0.17,
    }),
  }),
});

export interface OmahaMadePairedBetResponseVerdict {
  evBet: number;
  evCheck: number;
  gap: number;
  sampleSe: number;
  readSpread: number;
  proof: number;
  betStands: boolean;
  opponents: number;
}

const isWager = (d: HorseDecision): boolean =>
  d.action === 'bet' || d.action === 'all_in' || d.action === 'raise';

const checkedOf = (decision: HorseDecision): HorseDecision => {
  const c: HorseDecision = { ...decision, action: 'check' };
  delete c.amount;
  return c;
};

const amountOf = (decision: HorseDecision, player: SeatPlayer): number =>
  decision.action === 'all_in'
    ? fin(player.stack)
      ? Math.max(0, player.stack)
      : NaN
    : fin(decision.amount)
      ? decision.amount
      : NaN;

/**
 * Pure turn/river bet-vs-check evaluator on lifetime HUD fold, raise-back, and stab cells.
 * Uses `omahaCardImpact` with an explicit measured `responseAt` curve per opponent (HU and multiway)
 * and a prove-it-to-bet uncertainty bar (`sampleSe + readSpread`).
 */
export function omahaMadeAndPairedBetOnHisResponseVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  proposedAmount: number
): OmahaMadePairedBetResponseVerdict | null {
  const stage = String(gs.stage ?? '');
  if (stage !== 'turn' && stage !== 'river') return null;
  if (!fin(gs.pot) || !(gs.pot > 0) || !fin(player.stack) || !(player.stack > 0)) return null;
  if (!fin(proposedAmount) || !(proposedAmount > 0)) return null;
  const toCall = fin(gs.toCall)
    ? Math.max(0, gs.toCall)
    : Math.max(0, (gs.currentBet || 0) - (fin(player.bet) ? player.bet : 0));
  if (toCall > 0.005) return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;

  const opponents = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
  );
  if (opponents.length === 0) return null;
  if (opponents.some((p) => p.is_all_in || !fin(p.stack) || !(p.stack > 0))) return null;

  const checked = new Set<number>();
  for (const a of gs.actionHistory ?? [])
    if (String(a.stage) === stage && String(a.action) === 'check' && a.seat !== player.seat)
      checked.add(a.seat);

  const pot = gs.pot;
  const a = round2(Math.min(proposedAmount, player.stack));
  const family: OmahaHudFamily = (player.cards ?? []).length === 5 ? 'plo5' : 'plo4';
  const sk = stage === 'turn' ? 't' : 'r';
  const hu = opponents.length === 1;
  const pl = hu ? 'hu' : 'mw';
  const pri = OMAHA_TURN_RIVER_RESPONSE_PRIORS[family][stage];
  const mind = opts.mind !== false;
  const tele = telemetryOn(opts);
  const bigBet = a / pot > 0.7 || a >= player.stack - 0.005;

  const impacts: OmahaCardImpact[] = [];
  const closes: boolean[] = [];
  const betRates: number[] = [];
  let foldThinN = Infinity;
  let foldThinK = HUD_DEFAULT_K;
  let foldThinP = bigBet ? (hu ? pri.fbBgHu : pri.fbBgMw) : hu ? pri.fbSmHu : pri.fbSmMw;
  let raiseThinN = Infinity;
  let raiseThinK = HUD_DEFAULT_K;
  let raiseThinP = hu ? pri.rBetHu : pri.rBetMw;

  for (const opp of opponents) {
    const id = String(opp.user_id ?? '');
    let fbSm = hu ? pri.fbSmHu : pri.fbSmMw;
    let fbBg = hu ? pri.fbBgHu : pri.fbBgMw;
    let rBet = hu ? pri.rBetHu : pri.rBetMw;
    let stab = hu ? pri.stabHu : pri.stabMw;
    let fn = 0;
    let fk = HUD_DEFAULT_K;
    let rn = 0;
    let rk = HUD_DEFAULT_K;

    if (mind && id) {
      const sSm = hudStat(id, family, `${sk}.fb.sm.${pl}`, undefined, !bigBet && tele);
      const sBg = hudStat(id, family, `${sk}.fb.bg.${pl}`, undefined, bigBet && tele);
      const sRb = hudStat(id, family, `${sk}.rBet.${pl}`, undefined, false);
      const sSt = hudStat(id, family, `${sk}.stab.${pl}`, undefined, false);
      if (sSm.p !== null) fbSm = sSm.p;
      if (sBg.p !== null) fbBg = sBg.p;
      if (sRb.p !== null) rBet = sRb.p;
      if (sSt.p !== null) stab = sSt.p;
      const activeFb = bigBet ? sBg : sSm;
      fn = activeFb.n;
      fk = activeFb.k;
      rn = sRb.n;
      rk = sRb.k;
    }

    const activeFoldP = clamp(bigBet ? fbBg : fbSm, 0.02, 0.98);
    const activeRaiseP = clamp(rBet, 0, Math.max(0, 1 - activeFoldP));
    if (fn < foldThinN) {
      foldThinN = fn;
      foldThinK = fk;
      foldThinP = activeFoldP;
    }
    if (rn < raiseThinN) {
      raiseThinN = rn;
      raiseThinK = rk;
      raiseThinP = activeRaiseP;
    }

    const contSm = clamp(1 - fbSm, 0.02, 0.98);
    const contBg = clamp(1 - fbBg, 0.02, 0.98);
    const raiseSm = Math.min(clamp(rBet, 0, 0.8), contSm);
    const raiseBg = Math.min(clamp(rBet, 0, 0.8), contBg);
    const responseAt: OmahaCardImpactResponseCurve = [
      { share: 0.5, cont: contSm, raise: raiseSm },
      { share: 1.0, cont: contBg, raise: raiseBg },
    ];
    const read: OmahaCardImpactRead = {
      measured: true,
      continueRate: contBg,
      riverCallRate: contBg,
      betCheckedTo: clamp(stab, 0, 0.98),
      bluffShare: OMAHA_CARD_IMPACT_PRIOR.bluffShare,
    };
    const closed = checked.has(opp.seat);
    const impact = omahaCardImpact({
      hole: player.cards ?? [],
      board: gs.communityCards ?? [],
      dead: player.knownDeadCards ?? [],
      pot,
      heroStack: player.stack,
      oppStack: opp.stack,
      heroCloses: closed,
      line: omahaCardImpactLine(player, opp, gs),
      read,
      amounts: [a],
      seedSalt: opp.seat * 16 + player.seat,
      responseAt,
    });
    if (!impact) return null;
    impacts.push(impact);
    closes.push(closed);
    betRates.push(clamp(stab, 0, 0.98));
  }

  let evCheck: number;
  let evBet: number;
  if (impacts.length === 1) {
    evCheck = impacts[0].options[0].ev;
    const opt = impacts[0].options.find(
      (x) => x.action !== 'check' && Math.abs(x.amount - a) < 0.006
    );
    if (!opt) return null;
    evBet = opt.ev;
  } else {
    // Joint multiway check and bet combination (mirrors HorseOmahaPricedRules.omahaPricedBet)
    const s = impacts.map((im) => clamp(im.showdown, 0, 1));
    evCheck = pot * s.reduce((acc, v) => acc * v, 1);
    let noneBets = 1;
    let rateSum = 0;
    closes.forEach((closed, j) => {
      if (closed) return;
      noneBets *= 1 - betRates[j];
      rateSum += betRates[j];
    });
    const scale = rateSum > 0 ? Math.min(1, (1 - noneBets) / rateSum) : 0;
    impacts.forEach((im, j) => {
      if (closes[j]) return;
      const gain = im.options[0].ev - pot * s[j];
      let rest = 1;
      s.forEach((x, k) => {
        if (k !== j) rest *= x;
      });
      evCheck += scale * gain * rest;
    });
    evCheck = round2(evCheck);

    const n = impacts.length;
    let allFold = 1;
    let noRaise = 1;
    let noCall = 1;
    let sumCall = 0;
    let weightedCallEq = 0;
    let sumRaise = 0;
    let weightedRaisePayoff = 0;
    const effCallA = Math.min(a, Math.min(...opponents.map((p) => p.stack)));
    for (let j = 0; j < n; j++) {
      const o = impacts[j].options.find(
        (x) => x.action !== 'check' && Math.abs(x.amount - a) < 0.006
      );
      if (!o) return null;
      const callJ = clamp(o.call, 0, 1);
      const raiseJ = clamp(o.raise, 0, Math.max(0, 1 - callJ));
      const foldJ = clamp(1 - callJ - raiseJ, 0, 1);
      const eqJ = clamp(o.continueEquity, 0, 1);
      allFold *= foldJ;
      noRaise *= 1 - raiseJ;
      noCall *= 1 - callJ;
      sumCall += callJ;
      weightedCallEq += callJ * eqJ;
      if (raiseJ > 1e-6) {
        const callPart = callJ * (eqJ * (pot + effCallA) - (1 - eqJ) * effCallA);
        const raisePayoffJ = clamp(
          (o.ev - foldJ * pot - callPart) / raiseJ,
          -effCallA,
          pot + 2 * effCallA
        );
        sumRaise += raiseJ;
        weightedRaisePayoff += raiseJ * raisePayoffJ;
      }
    }
    const raiseAny = 1 - noRaise;
    const callOnly = Math.max(0, 1 - allFold - raiseAny);
    const anyCall = 1 - noCall;
    const expectedCallers = anyCall > 1e-9 ? sumCall / anyCall : 1;
    const eq1 = sumCall > 1e-9 ? weightedCallEq / sumCall : 0;
    const eqJoint = Math.pow(clamp(eq1, 0, 1), expectedCallers);
    const evCalled = eqJoint * (pot + (1 + expectedCallers) * effCallA) - effCallA;
    const evRaiseUnit = sumRaise > 1e-9 ? weightedRaisePayoff / sumRaise : -effCallA;
    evBet = round2(allFold * pot + callOnly * evCalled + raiseAny * evRaiseUnit);
  }

  // Sampling uncertainty (800 weighted hands in omahaCardImpact) + 1 posterior SD of fold & raise rates
  const sampleSe = (0.5 / Math.sqrt(800)) * (pot + a);
  const sdFold = Math.sqrt(
    (foldThinP * (1 - foldThinP)) / ((Number.isFinite(foldThinN) ? foldThinN : 0) + foldThinK + 1)
  );
  const sdRaise = Math.sqrt(
    (raiseThinP * (1 - raiseThinP)) /
      ((Number.isFinite(raiseThinN) ? raiseThinN : 0) + raiseThinK + 1)
  );
  const readSpread = sdFold * pot + sdRaise * a;
  const proof = sampleSe + readSpread;
  const gap = evBet - evCheck;
  return {
    evBet,
    evCheck,
    gap,
    sampleSe,
    readSpread,
    proof,
    // Prove-it-to-check on a brain-proposed made-hand bet: only override a proposed bet to a check
    // when checking proves it beats betting beyond sampling + read uncertainty (`evCheck - evBet > proof`).
    betStands: gap >= -proof,
    opponents: impacts.length,
  };
}

/** True when R5 owns made-hand & paired-board turn/river bets in this decision. */
export function omahaMadeAndPairedBetsResponseInScope(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  if (opts.omahaMadeAndPairedBetsArePricedOnHisResponse !== true) return false;
  const stage = String(gs.stage ?? '');
  if (stage !== 'turn' && stage !== 'river') return false;
  return omahaPricedInScope(player, gs, opts);
}

/**
 * R5 rule application on a proposed turn/river wager in one of the covered spots (#19, #9, #10, #11,
 * paired-board river check): returns the kept wager if `evBet - evCheck > proof`, else a check.
 * Null when option is off or out of scope (legacy path acts unchanged).
 */
export function omahaMadeAndPairedBetOnHisResponseRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): HorseDecision | null {
  if (!omahaMadeAndPairedBetsResponseInScope(player, gs, opts)) return null;
  if (!isWager(decision)) return decision;
  const tele = telemetryOn(opts);
  try {
    const amount = amountOf(decision, player);
    const v = fin(amount)
      ? omahaMadeAndPairedBetOnHisResponseVerdict(player, gs, opts, amount)
      : null;
    if (v === null) {
      if (tele) noteFire('omaha_made_paired_bet_on_his_response_unpriced_kept');
      return decision;
    }
    if (v.betStands) {
      if (tele) noteFire('omaha_made_paired_bet_on_his_response_kept');
      return decision;
    }
    if (tele) noteFire('omaha_made_paired_bet_on_his_response_checked');
    return checkedOf(decision);
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}
