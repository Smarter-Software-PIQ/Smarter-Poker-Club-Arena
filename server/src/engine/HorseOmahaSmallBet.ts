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
 *
 * One owner of the size (independent verifier D1/D2/D11, 2026-11-19): when this rule has placed a bet, it is the one owner of that
 * bet's size. A later size rule (the limped-pot minimum bet, the checked-to undersized-value bet) replaces it only through
 * omahaSmallBetComparesSize: its size priced beside the placed bet on this same model and curve, taken only when worth more by
 * the margin. The card-impact press that the paired-board value-leader guard (conflict sweep S4) would withhold by an opponent
 * label is handed here instead (`press`) and priced beside the check and the small bets: a price, not the label, decides it.
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
  /** 'small_bet': a check became a small bet; 'resized': a bet became a smaller one; 'press_bet': the card-impact press handed
   *  over by the paired-board guard (`press`) was priced best; null: the owner's decision stands */
  changed: 'small_bet' | 'resized' | 'press_bet' | null;
  /** why the owner's decision stands: priced and not beaten, nut class, all-in, or not priceable here */
  kept: 'priced' | 'nut_class' | 'all_in' | 'unpriced' | null;
  evOwner: number | null;
  best: OmahaCardImpactOption | null;
  margin: number;
}

/** One run of the card-impact model with the small-bet response curve, pricing `amounts` (shared by the verdict and the size
 *  comparison so both read the same sample and the same curve). */
function omahaSmallBetImpact(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  scope: NonNullable<ReturnType<typeof omahaCardImpactScope>>,
  impactRead: OmahaCardImpactRead,
  curve: OmahaCardImpactResponseCurve,
  amounts: number[]
) {
  return omahaCardImpact({
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
}

/**
 * The verdict. `read` is the pooled read of the opponent as the card-impact rule takes it (null: the model's priors). `press`
 * (default null) is the card-impact press bet the paired-board guard handed to this rule: priced as one more candidate beside the
 * small bets, whatever its size. With `press` null the verdict is exactly the small-bet verdict.
 */
export function omahaSmallBetVerdict(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  read: OmahaReadConditional | null,
  press: number | null = null
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
  const pressAmount =
    press !== null &&
    fin(press) &&
    press > 0 &&
    press < hero.stack - 0.005 &&
    Math.abs(press - ownerAmount) >= 0.006
      ? round2(press)
      : null;
  if (small.length === 0 && pressAmount === null) return keep('unpriced');
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
  if (pressAmount !== null && !amounts.some((x) => Math.abs(x - pressAmount) < 0.006))
    amounts.push(pressAmount);
  const impact = omahaSmallBetImpact(hero, gs, scope, impactRead, curve, amounts);
  if (!impact) return keep('unpriced');
  const owner =
    decision.action === 'check'
      ? impact.options[0]
      : impact.options.find(
          (o) => o.action !== 'check' && Math.abs(o.amount - ownerAmount) < 0.006
        );
  if (!owner) return keep('unpriced');
  let best: OmahaCardImpactOption | null = null;
  const isSmall = (amount: number): boolean => small.some((a) => Math.abs(a - amount) < 0.006);
  for (const o of impact.options) {
    if (
      o.action !== 'bet' ||
      !(isSmall(o.amount) || (pressAmount !== null && Math.abs(pressAmount - o.amount) < 0.006))
    )
      continue;
    if (!best || o.ev > best.ev) best = o;
  }
  const margin = round2(OMAHA_PRICED_SAMPLED_MARGIN * gs.pot);
  if (!best || !(best.ev >= owner.ev + margin))
    return { decision, changed: null, kept: 'priced', evOwner: owner.ev, best, margin };
  return {
    decision: { ...decision, action: 'bet', amount: best.amount },
    changed: !isSmall(best.amount)
      ? 'press_bet'
      : decision.action === 'check'
        ? 'small_bet'
        : 'resized',
    kept: null,
    evOwner: owner.ev,
    best,
    margin,
  };
}

/** The comparison a later size rule must win to replace the bet this rule placed. */
export interface OmahaSmallBetSizeComparison {
  evPlaced: number;
  evOther: number;
  margin: number;
  /** the other size is worth more than the placed bet by the margin */
  takeOther: boolean;
}

/**
 * A later size rule (the limped-pot minimum bet, the checked-to undersized-value bet) proposes `other` chips where this rule placed
 * a bet of `placed` chips: both are priced on the same card-impact sample with the same measured response curve, and the other size
 * replaces the placed bet only when it is worth more by OMAHA_PRICED_SAMPLED_MARGIN of the pot. Null when the spot cannot be
 * priced (out of the card-impact scope, no curve, the model returns nothing): the placed bet then stands. Pure.
 */
export function omahaSmallBetComparesSize(
  placed: number,
  other: number,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  read: OmahaReadConditional | null
): OmahaSmallBetSizeComparison | null {
  if (!fin(placed) || !(placed > 0) || !fin(other) || !(other > 0)) return null;
  const scope = omahaCardImpactScope(hero, gs);
  if (!scope) return null;
  const impactRead = omahaCardImpactRead(read);
  const curve = omahaSmallBetCurve(
    String(gs.gameVariant ?? '').toLowerCase(),
    scope.street,
    scope.opponent.is_horse === true,
    impactRead
  );
  if (!curve) return null;
  const a = round2(Math.min(placed, hero.stack));
  const b = round2(Math.min(other, hero.stack));
  const impact = omahaSmallBetImpact(hero, gs, scope, impactRead, curve, [a, b]);
  if (!impact) return null;
  const at = (x: number) =>
    impact.options.find((o) => o.action !== 'check' && Math.abs(o.amount - x) < 0.006);
  const p = at(a);
  const o = at(b);
  if (!p || !o) return null;
  const margin = round2(OMAHA_PRICED_SAMPLED_MARGIN * gs.pot);
  return { evPlaced: p.ev, evOther: o.ev, margin, takeOther: o.ev >= p.ev + margin };
}
