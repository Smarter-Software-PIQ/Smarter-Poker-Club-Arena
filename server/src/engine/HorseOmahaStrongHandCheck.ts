/**
 * OMAHA STRONG-HAND CHECK IS PRICED (EMERG lane STAB-DEFENCE-2, PLO-OWNER lead-2, 2026-11-20; option
 * omahaStrongHandCheckIsPriced, default OFF, read `=== true`; scopable per game with horse.omahaGameScope).
 *
 * THE MEASUREMENT (archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/SPARRING.md, STAB-DEFENCE.md). An opponent who
 * bets the pot on the turn and river with any hand whenever the Horse checks wins: the Horse folds three quarters of
 * the time, because the hands it checks are the hands it did not bet. The checking range is weak at its source: every
 * strong hand bets.
 *
 * WHAT IT DOES. In a PLO4/PLO5 cash turn or river decision (one board, high only, no bomb pot), heads-up, with nothing
 * to call and the opponent still to act on the street (the Horse acts first), when the node's final answer is a bet the
 * model counts as a value bet: that bet is priced beside the check.
 *
 *   EV(bet B)  = fold x pot + call x (e x (pot + 2B) - B) - raise x B, all after rake: his answer by bet size from the
 *     MEASURED response curve (river: HorseOmahaRiverFirstToActBet; turn: the same measurement's turn rows below); e =
 *     the Horse's equity against the hands that continue, the lower of the card-impact model's figure and its
 *     production calibration (the exact current river nuts keep the model's figure).
 *   EV(check)  = the card-impact model's value of checking out of position, after rake: he bets a share s of the
 *     time (his best hands and a non-value share q of his bets), the Horse calls or folds by price; otherwise the
 *     hand is checked through. s = the population's measured first-wager frequency for the game and street
 *     (HorseOmahaStabDefence table), moved toward the opponent's own lifetime PUBLIC record by n / (n + k) (k measured
 *     per street); q = the non-value share that frequency allows (HorseOmahaStabDefence.omahaStabDefenceShare: a bettor
 *     cannot bet more value than he holds). With no record both are the population's exactly.
 *   Error      = the measured fold share's binomial error times the chips that ride on it, the sample error of e and
 *     of the showdown share on the model's effective range, the binomial error of s on his record, the model's
 *     rounding.
 *
 * THE MIX. The check is taken with probability clamp(1/2 + (EV(check) - EV(bet)) / (2 x Error), 0, 1): always when
 * the check wins by more than the comparison's own error, never when it loses by more, in proportion between. The
 * draw is a hash of the Horse's cards, the board, the seats and the pot (no random stream is read; the same decision
 * always gives the same answer). No fixed percentage: the frequency is the comparison's.
 *
 * No hand class, position rule or size rule; nothing keyed to an account, a person or a Horse; one formula for every
 * opponent. It changes only a bet into a check; it never folds, never raises, never acts facing a wager, multiway, on
 * the flop, in PLO6, PLO8, hold'em, tournaments, bomb pots or multi-board hands. LIMITS: the model's (no check-raise
 * is priced, which under-values the check; on the turn no river betting is priced in either branch). Ranges: the
 * card-impact line weights of this branch (not the math core's v3 / v4 tables, which are not in this tree).
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaCardImpact,
  omahaCardImpactLine,
  omahaCardImpactScope,
  type OmahaCardImpactRead,
  type OmahaCardImpactResponseCurve,
} from './HorseOmahaCardImpact.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { omahaCheckedToContinueCalibrated } from './HorseOmahaCheckedToBet.js';
import {
  omahaRiverFirstToActResponseOf,
  type OmahaRiverFirstToActPoint,
} from './HorseOmahaRiverFirstToActBet.js';
import { omahaEvPriorBluffShare } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_STAB_DEFENCE_TABLE,
  omahaStabDefenceCell,
  omahaStabDefencePriorOpps,
  omahaStabDefenceShare,
  type OmahaStabDefenceRecord,
} from './HorseOmahaStabDefence.js';
import { hasRiverNuts } from './HorseRiverNuts.js';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (n: number) => Math.round(n * 100) / 100;
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const MODEL_ROUNDING = 0.005;
/** The stab the model prices after a check, as a share of the pot (HorseOmahaCardImpact OMAHA_CARD_IMPACT_PRIOR.betSize). */
export const OMAHA_STRONG_HAND_CHECK_STAB_SIZE = 0.66;

/**
 * OFFENCE-BUILD measurement (work/m5.py, const-fit.json sha256 below): TURN, heads-up, the bettor acted first, first
 * answer of the opponent; PLO4/PLO5 cash hands with a person seated, fit window before 2026-11-18 00:00Z; every player
 * pooled, responders capped at 20% of a cell; pot-share bands at centres 0.27, 0.42, 0.65, 1.0.
 */
export const OMAHA_STRONG_HAND_CHECK_TURN_SOURCE_SHA256 =
  '879e64901c138e88d94af1ab606dd8d8b0a72c9aa5cec046aacad1ff4b9c2836';
export const OMAHA_STRONG_HAND_CHECK_TURN_RESPONSE: readonly OmahaRiverFirstToActPoint[] =
  Object.freeze([
    { share: 0.27, cont: 0.8417, raise: 0.125, foldSe: 0.0333, n: 120 },
    { share: 0.42, cont: 0.7765, raise: 0.125, foldSe: 0.0256, n: 264 },
    { share: 0.65, cont: 0.6092, raise: 0.0862, foldSe: 0.037, n: 174 },
    { share: 1.0, cont: 0.4843, raise: 0.0881, foldSe: 0.028, n: 318 },
  ]);

function foldSeAt(curve: readonly OmahaRiverFirstToActPoint[], share: number): number {
  let best = curve[0];
  for (const p of curve) if (Math.abs(p.share - share) < Math.abs(best.share - share)) best = p;
  return best.foldSe;
}

/** A unit draw from public decision state and the Horse's own cards (FNV-1a); no random stream is read. */
export function omahaStrongHandCheckDraw(hero: SeatPlayer, gs: HorseGameStateV2, salt: number): number {
  const card = (c: Card) => `${c.rank}${String(c.suit)[0]}`;
  const text = [
    (hero.cards ?? []).map(card).join(''),
    (gs.communityCards ?? []).map(card).join(''),
    hero.seat,
    salt,
    Math.round((gs.pot ?? 0) * 100),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export interface OmahaStrongHandCheckSpot {
  street: 'turn' | 'river';
  opponent: SeatPlayer;
}

/** The spot, or null. Public information only. */
export function omahaStrongHandCheckSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaStrongHandCheckSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return null;
    const scope = omahaCardImpactScope(hero, gs);
    if (!scope || scope.heroCloses) return null;
    const acted = (gs.actionHistory ?? []).some(
      (a) => String(a.stage) === scope.street && a.seat === scope.opponent.seat
    );
    if (acted) return null;
    return { street: scope.street, opponent: scope.opponent };
  } catch {
    return null;
  }
}

/** His stab frequency after a check and the non-value share of those bets: the population's, moved by his record. */
export function omahaStrongHandCheckStab(
  variant: string,
  street: 'turn' | 'river',
  record: OmahaStabDefenceRecord | null | undefined
): { s: number; q: number; sPop: number; qPop: number; se: number; weight: number } | null {
  const row = OMAHA_STAB_DEFENCE_TABLE[omahaStabDefenceCell(variant, street, 1)];
  if (!row) return null;
  const q0 = omahaEvPriorBluffShare(street, OMAHA_STRONG_HAND_CHECK_STAB_SIZE, false);
  const pop = omahaStabDefenceShare(q0, null, variant, street, 1);
  const own = omahaStabDefenceShare(q0, record ?? null, variant, street, 1);
  if (!pop || !own) return null;
  const k = omahaStabDefencePriorOpps(street, 1);
  const n = own.weight > 0 && record ? Math.max(0, record.opps) : 0;
  return {
    s: own.f,
    q: own.q,
    sPop: pop.f,
    qPop: pop.q,
    se: Math.sqrt((own.f * (1 - own.f)) / (n + k)),
    weight: own.weight,
  };
}

export interface OmahaStrongHandCheckVerdict {
  action: 'check' | 'bet';
  evCheck: number;
  evBet: number;
  error: number;
  /** the probability of the check from the comparison */
  mix: number;
  draw: number;
  s: number;
  q: number;
  weight: number;
  value: boolean;
}

/** The comparison for the bet `amount`; null when a number cannot be computed. */
export function omahaStrongHandCheck(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  spot: OmahaStrongHandCheckSpot,
  amount: number,
  rake: number,
  record: OmahaStabDefenceRecord | null | undefined,
  /** tests only */
  drawOverride?: number
): OmahaStrongHandCheckVerdict | null {
  const pot = gs.pot;
  if (!fin(pot) || !(pot > 0) || !fin(amount) || !(amount > 0)) return null;
  const r = fin(rake) ? clamp(rake, 0, 0.2) : 0;
  const opp = spot.opponent;
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  const stab = omahaStrongHandCheckStab(variant, spot.street, record);
  if (!stab) return null;
  const curve =
    spot.street === 'river'
      ? omahaRiverFirstToActResponseOf(opp, gs)
      : OMAHA_STRONG_HAND_CHECK_TURN_RESPONSE;
  if (curve.length === 0) return null;
  const responseAt: OmahaCardImpactResponseCurve = curve.map((p) => ({
    share: p.share,
    cont: p.cont,
    raise: p.raise,
  }));
  const a = round2(Math.min(amount, hero.stack));
  const run = (s: number, q: number) => {
    const read: OmahaCardImpactRead = {
      measured: false,
      continueRate: null,
      riverCallRate: null,
      betCheckedTo: clamp(s, 0, 1),
      bluffShare: clamp(q, 0, 1),
    };
    return omahaCardImpact({
      hole: hero.cards,
      board: gs.communityCards ?? [],
      dead: hero.knownDeadCards ?? [],
      pot,
      heroStack: hero.stack,
      oppStack: opp.stack,
      heroCloses: false,
      line: omahaCardImpactLine(hero, opp, gs),
      read,
      amounts: [a],
      seedSalt: opp.seat * 16 + hero.seat,
      responseAt,
    });
  };
  const impact = run(stab.s, stab.q);
  if (!impact) return null;
  const check = impact.options.find((o) => o.action === 'check');
  const bet = impact.options.find((o) => o.action !== 'check');
  if (!check || !bet || !fin(check.ev) || !fin(bet.ev)) return null;
  const evCheck = check.ev * (1 - r);
  const eff = Math.max(1, impact.opp.effective);
  const sd = clamp(impact.showdown, 0, 1);
  const B = Math.min(a, opp.stack);
  const fold = clamp(bet.fold, 0, 1);
  const call = clamp(bet.call, 0, 1);
  const raise = clamp(bet.raise, 0, 1);
  const raw = clamp(bet.continueEquity, 0, 1);
  const cal = omahaCheckedToContinueCalibrated(raw, Math.max(1, eff * (call + raise)));
  const nuts = spot.street === 'river' && hasRiverNuts(hero, gs, false);
  const e = nuts ? raw : Math.min(raw, cal.share);
  const evBet = fold * pot * (1 - r) + call * (e * (pot + 2 * B) * (1 - r) - a) - raise * a;
  const ride = Math.abs(pot * (1 - r) - (e * (pot + 2 * B) * (1 - r) - a));
  const fse = foldSeAt(curve, a / pot);
  const eVar = (raw * (1 - raw)) / Math.max(1, eff * Math.max(call + raise, 0.01)) + cal.variance;
  // The stab frequency's own error rides on how much the check's value moves with it (measured by pricing the
  // check at the population's frequency too; nothing to add while he is priced as the population).
  let stabVar = 0;
  if (stab.weight > 0 && Math.abs(stab.s - stab.sPop) > 1e-6) {
    const base = run(stab.sPop, stab.qPop)?.options.find((o) => o.action === 'check');
    if (base && fin(base.ev))
      stabVar = (((check.ev - base.ev) * (1 - r)) / (stab.s - stab.sPop)) ** 2 * stab.se ** 2;
  }
  const variance =
    (fse * ride) ** 2 +
    (call * (pot + 2 * B) * (1 - r)) ** 2 * eVar +
    pot * pot * ((sd * (1 - sd)) / eff + MODEL_ROUNDING ** 2) +
    stabVar +
    3 * (MODEL_ROUNDING * (pot + 2 * B)) ** 2;
  const error = Math.sqrt(variance);
  if (!fin(error) || !(error > 0)) return null;
  const mix = clamp(0.5 + (evCheck - evBet) / (2 * error), 0, 1);
  const draw = fin(drawOverride) ? drawOverride : omahaStrongHandCheckDraw(hero, gs, opp.seat);
  return {
    action: bet.value === true && draw < mix ? 'check' : 'bet',
    evCheck: round2(evCheck),
    evBet: round2(evBet),
    error: round2(error),
    mix,
    draw,
    s: stab.s,
    q: stab.q,
    weight: stab.weight,
    value: bet.value === true,
  };
}

export interface OmahaStrongHandCheckResult {
  decision: HorseDecision;
  priced: boolean;
  changed: boolean;
  verdict?: OmahaStrongHandCheckVerdict;
}

/**
 * The option's one entry. `on` is the option (read `=== true` by the caller); `recordOf` returns the opponent's
 * lifetime public first-wager record for the street or null (the population). Every decision that is not a bet in the
 * spot is returned as given (the same object).
 */
export function omahaStrongHandCheckRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  rake: number,
  recordOf: (opponent: SeatPlayer, street: 'turn' | 'river') => OmahaStabDefenceRecord | null
): OmahaStrongHandCheckResult {
  const same: OmahaStrongHandCheckResult = { decision, priced: false, changed: false };
  if (!on || (decision.action !== 'bet' && decision.action !== 'all_in')) return same;
  try {
    const spot = omahaStrongHandCheckSpot(hero, gs);
    if (!spot) return same;
    const amount = fin(decision.amount) ? (decision.amount as number) : hero.stack;
    let record: OmahaStabDefenceRecord | null = null;
    try {
      record = recordOf(spot.opponent, spot.street);
    } catch {
      record = null;
    }
    const verdict = omahaStrongHandCheck(hero, gs, spot, amount, rake, record);
    if (!verdict) return same;
    if (verdict.action !== 'check') return { decision, priced: true, changed: false, verdict };
    const checked: HorseDecision = { ...decision, action: 'check' };
    delete checked.amount;
    return { decision: checked, priced: true, changed: true, verdict };
  } catch {
    return same;
  }
}
