/**
 * omahaSmallBetIsPriced (PLO Strategy lane 2026-11-18, default OFF): small bets priced, not filtered.
 *
 * Owner orders (2026-11-17, verbatim): "there should not be any blanket rules ... they must all be done by math, gto, players
 * hand or preceived range of hands as well as the opponents range of hand, equity, EV etc." and "THE SIZE OF THE BET SHOULD NOT
 * MAKE OR BREAK THE DECISION".
 *
 * At a PLO4/PLO5 cash heads-up turn or river decision with nothing to call, where the owner chose a check or a bet, the bets of
 * 10%, 20% and 25% of the pot (OMAHA_SMALL_BET_SIZES, a candidate set, not a threshold) are priced beside the owner's choice on the
 * card-impact model (HorseOmahaCardImpact.omahaCardImpact, the one owner of the bet-response model), with the opponent's fold,
 * call and raise shares at EVERY size shaped by the measured response of his kind (a person or a Horse) by pot share
 * (HorseOmahaSmallBetConstants.ts) around the model's own level at the reference bet (omahaSmallBetCurve). The best small bet replaces the owner's choice only
 * when it is worth more by OMAHA_PRICED_SAMPLED_MARGIN of the pot. It never turns a bet into a check, never makes a nut-class bet
 * smaller, never touches an all-in, and the size enters only as an input to his response and to the price.
 *
 * Unpriced spots (the flop, multiway, the model returns nothing) keep the owner's decision (reason 'unpriced'). Pure: no fires,
 * no writes, no random draws (the card-impact sample is seeded by the cards and seats).
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactKeep,
  omahaCardImpactLine,
  omahaCardImpactRead,
  omahaCardImpactResponseOf,
  omahaCardImpactScope,
  type OmahaCardImpactOption,
  type OmahaCardImpactRead,
  type OmahaCardImpactResponseCurve,
} from './HorseOmahaCardImpact.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { OMAHA_PRICED_SAMPLED_MARGIN } from './HorseOmahaPricedRules.js';
import {
  OMAHA_SMALL_BET_READ_REFERENCE_SHARE,
  OMAHA_SMALL_BET_RESPONSE,
  OMAHA_SMALL_BET_SIZES,
} from './HorseOmahaSmallBetConstants.js';

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const logit = (p: number): number => {
  const q = clamp(p, 1e-4, 1 - 1e-4);
  return Math.log(q / (1 - q));
};
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * His response curve at this decision. LEVEL from the model, SHAPE from the measurement: at the reference bet
 * (OMAHA_SMALL_BET_READ_REFERENCE_SHARE of the pot) he continues exactly as the card-impact model has him continue there
 * (omahaCardImpactKeep: the pot odds, scaled by his own measured continue rate when he is measured), and at any other share the
 * log-odds of continuing move by what the measured curve of his kind (a person or a Horse) moves between that share and the
 * reference. Of the hands that continue, the measured share of his kind at that size raises. The curve starts at a share of 0
 * where every hand continues, so no size below the measured buckets is credited with a larger bucket's fold share. Continuous
 * in everything; no sample threshold. Null outside the table.
 */
export function omahaSmallBetCurve(
  variant: string,
  street: 'turn' | 'river',
  opponentIsHorse: boolean,
  read: OmahaCardImpactRead
): OmahaCardImpactResponseCurve | null {
  const points =
    OMAHA_SMALL_BET_RESPONSE[`${variant}|${street}|${opponentIsHorse ? 'horse' : 'person'}`];
  if (!points || points.length === 0) return null;
  const measured: OmahaCardImpactResponseCurve = [
    { share: 0, cont: 1, raise: points[0].cont > 0 ? points[0].raise / points[0].cont : 0 },
    ...points
      .filter((p) => p.share > 0)
      .map((p) => ({ share: p.share, cont: p.cont, raise: p.cont > 0 ? p.raise / p.cont : 0 })),
  ];
  const R = OMAHA_SMALL_BET_READ_REFERENCE_SHARE;
  const keepRef = omahaCardImpactKeep(read, 1 / (1 + R), street === 'river');
  const lRef = logit(omahaCardImpactResponseOf(measured, R).cont);
  const shares = [...new Set([...measured.map((p) => p.share), R])].sort((x, y) => x - y);
  return shares.map((share) => {
    const m = omahaCardImpactResponseOf(measured, share);
    const cont = share === 0 ? 1 : sigmoid(logit(keepRef) + logit(m.cont) - lRef);
    return { share, cont, raise: clamp(m.raise, 0, 1) * cont };
  });
}

/** The small amounts at this spot, legal and clamped as the card-impact sizes are. */
export function omahaSmallBetAmounts(hero: SeatPlayer, gs: HorseGameStateV2): number[] {
  const menu = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  if (menu !== null && !menu.includes('bet')) return [];
  const pot = gs.pot;
  const min = fin(gs.minRaiseTo) ? (gs.minRaiseTo as number) : (gs.bigBlind ?? 1);
  const max = Math.min(fin(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : pot, hero.stack);
  const whole = (gs.bigBlind ?? 1) >= 1;
  const out: number[] = [];
  for (const f of OMAHA_SMALL_BET_SIZES) {
    let a = f * pot;
    a = whole ? Math.round(a) : round2(a);
    a = round2(clamp(a, Math.min(min, max), max));
    if (!(a > 0) || a >= hero.stack - 0.005) continue;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

export interface OmahaSmallBetVerdict {
  /** the decision to play: the owner's, or the small bet */
  decision: HorseDecision;
  /** 'small_bet': a check became a small bet; 'resized': a bet became a smaller one; null: the owner's decision stands */
  changed: 'small_bet' | 'resized' | null;
  /** why the owner's decision stands: priced and not beaten, nut class, all-in, or not priceable here */
  kept: 'priced' | 'nut_class' | 'all_in' | 'unpriced' | null;
  evOwner: number | null;
  best: OmahaCardImpactOption | null;
  margin: number;
}

/**
 * The verdict. `read` is the pooled read of the opponent as the card-impact rule takes it (null: the model's priors).
 */
export function omahaSmallBetVerdict(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  read: OmahaReadConditional | null
): OmahaSmallBetVerdict {
  const keep = (kept: OmahaSmallBetVerdict['kept'], evOwner: number | null = null) => ({
    decision,
    changed: null,
    kept,
    evOwner,
    best: null,
    margin: 0,
  });
  if (decision.action === 'all_in') return keep('all_in');
  if (decision.action !== 'check' && decision.action !== 'bet') return keep('unpriced');
  const scope = omahaCardImpactScope(hero, gs);
  if (!scope) return keep('unpriced');
  if (decision.action === 'bet' && omahaNutClassNow(hero, gs)) return keep('nut_class');
  const ownerAmount =
    decision.action === 'bet' && fin(decision.amount)
      ? round2(Math.min(decision.amount, hero.stack))
      : 0;
  if (decision.action === 'bet' && !(ownerAmount > 0)) return keep('unpriced');
  const small = omahaSmallBetAmounts(hero, gs).filter(
    (a) => decision.action === 'check' || a < ownerAmount - 0.005
  );
  if (small.length === 0) return keep('unpriced');
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  const impactRead = omahaCardImpactRead(read);
  const curve = omahaSmallBetCurve(
    variant,
    scope.street,
    scope.opponent.is_horse === true,
    impactRead
  );
  if (!curve) return keep('unpriced');
  const base = omahaCardImpactAmounts(hero, scope.opponent, gs);
  const amounts = [...(ownerAmount > 0 ? [ownerAmount] : []), ...base];
  for (const a of small) if (!amounts.some((x) => Math.abs(x - a) < 0.006)) amounts.push(a);
  const impact = omahaCardImpact({
    hole: hero.cards,
    board: gs.communityCards ?? [],
    dead: hero.knownDeadCards ?? [],
    pot: gs.pot,
    heroStack: hero.stack,
    oppStack: scope.opponent.stack,
    heroCloses: scope.heroCloses,
    line: omahaCardImpactLine(hero, scope.opponent, gs),
    read: impactRead,
    amounts,
    seedSalt: scope.opponent.seat * 16 + hero.seat,
    responseAt: curve,
  });
  if (!impact) return keep('unpriced');
  const owner =
    decision.action === 'check'
      ? impact.options[0]
      : impact.options.find(
          (o) => o.action !== 'check' && Math.abs(o.amount - ownerAmount) < 0.006
        );
  if (!owner) return keep('unpriced');
  let best: OmahaCardImpactOption | null = null;
  for (const o of impact.options) {
    if (o.action !== 'bet' || !small.some((a) => Math.abs(a - o.amount) < 0.006)) continue;
    if (!best || o.ev > best.ev) best = o;
  }
  const margin = round2(OMAHA_PRICED_SAMPLED_MARGIN * gs.pot);
  if (!best || !(best.ev >= owner.ev + margin))
    return { decision, changed: null, kept: 'priced', evOwner: owner.ev, best, margin };
  return {
    decision: { ...decision, action: 'bet', amount: best.amount },
    changed: decision.action === 'check' ? 'small_bet' : 'resized',
    kept: null,
    evOwner: owner.ev,
    best,
    margin,
  };
}
