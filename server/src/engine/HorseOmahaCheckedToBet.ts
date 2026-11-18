/**
 * OMAHA CHECKED-TO BET IS PRICED (2026-11-18, WooWoo audit repair programme,
 * lane CHECKED-TO-BET; option omahaCheckedToBetIsPriced, default OFF, read
 * `=== true`).
 *
 * The measurement (audit archive woowoo-48h-audit-01BNteGYgf,
 * repairs/FLOP-DEFENCE/ATTRIBUTION.md section 3): when every opponent has
 * checked and the Horse closes the action it almost never bets a medium, weak
 * or empty hand. One human folded 140 of 177 times (79%) to a river bet
 * heads-up after checking, and the Horses checked back air or a weak pair in
 * 35 of 43 such spots; with two or more opponents they bet such hands 0 of 93
 * times; on the turn after a checked-through flop he folded 11 of 22.
 *
 * What this file does. PLO4/PLO5 cash, one board, high only, no bomb pot, not
 * Lightning (HorseOmahaPricedWiring.omahaPricedInScope), on the river (any
 * number of opponents) or the turn (one opponent), when every live opponent
 * has checked this street, nobody is all in, and today's answer is a check:
 * the check is priced beside every bet size the engine considers
 * (HorseOmahaCardImpact.omahaCardImpactAmounts) and replaced by the bet of
 * highest expected value when that bet is worth more than the check by more
 * than the comparison's own standard error. There is no hand-class, position
 * or size rule and nothing is keyed to an account: the inputs are the Horse's
 * exact cards, each opponent's range from his line this hand, his measured
 * rate of continuing against a bet, the pot, the stacks and the rake.
 *
 * THE NUMBERS. Against each opponent the card-impact model
 * (HorseOmahaCardImpact.omahaCardImpact: 800 hands sampled from a private
 * stream seeded by the cards, weighted by his line, this street's check
 * included, so the range is his CHECKING range) answers, for a bet B:
 *   c  the share of that range that continues: his measured continue rate
 *      (river: his river call rate; turn: one minus his fold-to-bet rate; a
 *      posterior mean that shrinks to the Horse-population mean of the game
 *      and table size by the opportunity count, HorseOmahaPricedRules.
 *      omahaPricedRead), observed at the reference bet of 0.6 pot and moved
 *      to this size in proportion to the pot odds (the model's own scaling);
 *      with no read at all the pot-odds share itself, against which a bet
 *      with no equity is worth exactly nothing;
 *   the calling range: the top c of his checking range by strength, of which
 *      the top min(0.1, c) raises (the model's raise share);
 *   e  the Horse's equity against the hands that continue; s its showdown
 *      share against the whole checking range.
 * One opponent:
 *   EV(bet B) = [f x pot + call x (e x (pot + 2B)) - call x B + raise branch]
 *               less the rake on the chips won      (f = 1 - c)
 *     (the raise branch is the model's: facing the raise the Horse takes the
 *     better of folding, -B, and calling it);
 *   river: EV(check) = s x pot x (1 - rake);
 *   turn:  EV(check) = the model's value of checking when he may still bet:
 *     he bets the next street at his measured bet rate (value and bluff
 *     shares of the model, 0.66 pot), the Horse calls when the call is worth
 *     more than folding, and otherwise realizes its equity; less the rake.
 * Two or more opponents (river): each answers independently (the stated
 * simplification of HorseOmahaStrongHandValue: joint card removal is not
 * modelled), so every opponent folds with probability prod f_j, the JOINT
 * probability the brief of this lane asks for; every set of callers is
 * enumerated, the Horse wins against a set with probability prod e_j, and a
 * raise by anyone costs the bet (the Horse folds to it):
 *   EV(bet B) = prod f_j x pot x (1 - rake)
 *               + sum over caller sets C of P(C) x [prod_{j in C} e_j
 *                 x (pot + B + sum_{j in C} min(B, stack_j)) x (1 - rake) - B]
 *               - P(somebody raises) x B
 *   EV(check) = prod s_j x pot x (1 - rake).
 *
 * THE MARGIN is the standard error of EV(bet) - EV(check), nothing chosen:
 *  - the read: each opponent's continue rate is a rate from n opportunities
 *    and k = 6 prior pseudo-opportunities (HorseOpponentExploit), standard
 *    deviation sqrt(m(1 - m) / (n + k + 1)), scaled to the size like the rate
 *    itself, times the chips that ride on his answer (pot + B: the pot won
 *    when he folds against the bet lost when he calls with better) and the
 *    chance that the others fold;
 *  - the sample: the binomial error of s and of e on the effective size of
 *    the weighted sample (and of the called share);
 *  - the rounding of the model's reported shares (to 0.01).
 * So an opponent with few opportunities needs a larger gap, and one who is
 * measured to call (a calling station) gives EV(bet) below EV(check) for a
 * hand that cannot win when called: the check is kept.
 *
 * LIMITS, stated. A model, not a solver. The flop is not priced (two cards
 * to come and two streets of betting do not fit this arithmetic). The turn
 * is priced heads-up only, and its called branch takes the Horse's equity
 * against the calling range as realized (no river betting after a called
 * turn bet is modelled), which leans toward the bet for a hand with equity.
 * The continue rate is the pooled read until the per-street read
 * (HorseMind.omahaStreetReadOf) is delivered to decisions through
 * HorseOmahaPricedWiring.omahaPricedSetStreetRatesSource; on the turn the
 * pooled fold-to-bet rate covers every street. "After checking" is not a
 * cell of either read: the rate is his fold to any bet he faced. The size
 * scaling of the continue rate is the model's, not a measurement at each
 * size. With a player still to act behind the Horse the option does not act.
 *
 * Pure: no state beyond the card-impact module's memo, no random draw from
 * the brain's stream, no telemetry, no opponent memory (the caller supplies
 * the reads).
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactLine,
  OMAHA_CARD_IMPACT_PRIOR,
  type OmahaCardImpact,
  type OmahaCardImpactOption,
} from './HorseOmahaCardImpact.js';
import { EXPLOIT_PRIOR_STRENGTH } from './HorseOpponentExploit.js';
import {
  OMAHA_PRICED_NO_READ,
  omahaPricedCardImpactRead,
  type OmahaPricedRead,
} from './HorseOmahaPricedRules.js';
import { omahaPricedInScope } from './HorseOmahaPricedWiring.js';

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** The card-impact model reports its shares rounded to this step. */
const MODEL_ROUNDING = 0.005;

/** One opponent's read as the comparison takes it. */
export interface OmahaCheckedToRead {
  /** the one priced read (pooled, or the per-street read once delivered) */
  read: OmahaPricedRead;
  /** decayed river opportunities behind his river call rate; null when unknown */
  riverOpportunities: number | null;
}

export interface OmahaCheckedToScope {
  street: 'turn' | 'river';
  /** every other player in the hand: each has checked this street, none is all in */
  opponents: SeatPlayer[];
}

/** The option's spot: public information and the Horse's own cards. Null outside it. */
export function omahaCheckedToBetScope(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaCheckedToScope | null {
  try {
    if (!omahaPricedInScope(hero, gs)) return null;
    const street = String(gs.stage ?? '');
    if (street !== 'turn' && street !== 'river') return null;
    if ((gs.communityCards ?? []).length !== (street === 'turn' ? 4 : 5)) return null;
    if (gs.allInOrFold === true || gs.wagersCapped === true) return null;
    if (hero.is_folded || hero.is_all_in || hero.is_sitting_out) return null;
    if (!fin(hero.stack) || !(hero.stack > 0) || !fin(gs.pot) || !(gs.pot > 0)) return null;
    const toCall = fin(gs.toCall)
      ? Math.max(0, gs.toCall)
      : Math.max(0, (gs.currentBet || 0) - (fin(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    const opponents = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    );
    if (opponents.length === 0) return null;
    if (street === 'turn' && opponents.length !== 1) return null;
    if (opponents.some((p) => p.is_all_in || !fin(p.stack) || !(p.stack > 0))) return null;
    const checked = new Set<number>();
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== street) continue;
      const act = String(a.action);
      // Any wager on this street: the action was not checked to the Horse.
      if (act === 'bet' || act === 'raise' || act === 'all_in') return null;
      if (act === 'check' && a.seat !== hero.seat) checked.add(a.seat);
    }
    if (!opponents.every((p) => checked.has(p.seat))) return null;
    return { street, opponents };
  } catch {
    return null;
  }
}

export interface OmahaCheckedToRow {
  action: 'bet' | 'all_in';
  amount: number;
  /** expected chips of the bet, after the rake */
  ev: number;
  /** the probability that every opponent folds */
  allFold: number;
  /** the standard error of ev - evCheck */
  error: number;
  /** the hands that continue and lose outweigh those that continue and win */
  value: boolean;
}

export interface OmahaCheckedToVerdict {
  action: 'check' | 'bet' | 'all_in';
  amount: number;
  street: 'turn' | 'river';
  opponents: number;
  /** expected chips of the check, after the rake */
  evCheck: number;
  /** the Horse's showdown share against the checking ranges (the product over the opponents) */
  showdown: number;
  /** the bet chosen, or with the check kept the bet of largest gap over its error */
  best: OmahaCheckedToRow | null;
  rows: OmahaCheckedToRow[];
  /** where the continue rates came from: every opponent's source, the weakest named */
  source: 'street' | 'pooled' | 'prior';
}

interface Leg {
  opp: SeatPlayer;
  impact: OmahaCardImpact;
  /** decayed opportunities behind the continue rate used */
  n: number;
  /** his continue rate at the reference size; null: no read (the pot-odds share) */
  rate: number | null;
}

/**
 * The comparison. `readOf` answers an opponent seat's read (null: none);
 * `rake` is the marginal rake on the pot as a fraction. Null when a number
 * cannot be computed.
 */
export function omahaCheckedToBet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  scope: OmahaCheckedToScope,
  readOf: (seat: number) => OmahaCheckedToRead | null,
  rake: number
): OmahaCheckedToVerdict | null {
  const pot = gs.pot;
  const river = scope.street === 'river';
  const r = fin(rake) ? clamp(rake, 0, 0.2) : 0;
  const deepest = scope.opponents.reduce((a, b) => (b.stack > a.stack ? b : a));
  const amounts = omahaCardImpactAmounts(hero, deepest, gs);
  if (amounts.length === 0) return null;
  const legs: Leg[] = [];
  let source: OmahaCheckedToVerdict['source'] = 'street';
  for (const opp of scope.opponents) {
    const given = readOf(opp.seat);
    const read = given?.read ?? OMAHA_PRICED_NO_READ;
    if (read.source === 'prior' || (read.source === 'pooled' && source === 'street'))
      source = read.source;
    const impact = omahaCardImpact({
      hole: hero.cards,
      board: gs.communityCards ?? [],
      dead: hero.knownDeadCards ?? [],
      pot,
      heroStack: hero.stack,
      oppStack: opp.stack,
      // River: the check ends the hand. Turn: he may still bet the river.
      heroCloses: river,
      line: omahaCardImpactLine(hero, opp, gs),
      read: omahaPricedCardImpactRead(read, scope.street),
      amounts,
      seedSalt: opp.seat * 16 + hero.seat,
    });
    if (!impact) return null;
    // The rate the model used, as it reads it (HorseOmahaCardImpact keepOf).
    const cont = read.foldToBet === null ? null : 1 - read.foldToBet;
    const rate = cont === null ? null : river ? (read.riverCall ?? cont) : cont;
    const n =
      rate === null
        ? 0
        : river && read.riverCall !== null && fin(given?.riverOpportunities)
          ? Math.max(0, given!.riverOpportunities as number)
          : Math.max(0, read.opportunities);
    legs.push({ opp, impact, n, rate });
  }
  const showdown = legs.reduce((a, l) => a * clamp(l.impact.showdown, 0, 1), 1);
  const evCheck = river ? pot * showdown * (1 - r) : legs[0].impact.options[0].ev * (1 - r);
  // The sample error of the check: the showdown share of each leg.
  let checkVar = 0;
  for (const l of legs) {
    const s = clamp(l.impact.showdown, 0, 1);
    const others = s > 0 ? showdown / s : 0;
    const eff = Math.max(1, l.impact.opp.effective);
    checkVar += (pot * others) ** 2 * ((s * (1 - s)) / eff + MODEL_ROUNDING ** 2);
  }
  const refOdds = 1 / (1 + OMAHA_CARD_IMPACT_PRIOR.referenceBet);
  const rows: OmahaCheckedToRow[] = [];
  for (const amount of amounts) {
    const a = round2(Math.min(amount, hero.stack));
    const opts: OmahaCardImpactOption[] = [];
    for (const l of legs) {
      const o = l.impact.options.find(
        (x) => x.action !== 'check' && Math.abs(x.amount - a) < 0.006
      );
      if (o) opts.push(o);
    }
    if (opts.length !== legs.length) continue;
    const folds = opts.map((o) => clamp(o.fold, 0, 1));
    const allFold = folds.reduce((x, y) => x * y, 1);
    let ev: number;
    let value: boolean;
    if (legs.length === 1) {
      const o = opts[0];
      const cont = o.call + o.raise;
      const won =
        o.fold * pot + cont * o.continueEquity * (pot + 2 * Math.min(a, legs[0].opp.stack));
      ev = o.ev - r * won;
      value = o.value;
    } else {
      // Every set of callers; a raise by anyone costs the bet.
      const n = legs.length;
      let sum = allFold * pot * (1 - r);
      let noRaise = 1;
      for (const o of opts) noRaise *= 1 - clamp(o.raise, 0, 1);
      let accounted = allFold;
      for (let mask = 1; mask < 1 << n; mask++) {
        let p = 1;
        let win = 1;
        let chips = pot + a;
        for (let j = 0; j < n; j++) {
          const o = opts[j];
          if (mask & (1 << j)) {
            const call = clamp(o.call, 0, 1);
            p *= call;
            // Equity against his callers: at least the equity against all the hands that
            // continue (the raisers are the top of them), which is the figure used.
            win *= clamp(o.continueEquity, 0, 1);
            chips += Math.min(a, legs[j].opp.stack);
          } else p *= folds[j];
        }
        accounted += p;
        sum += p * (win * chips * (1 - r) - a);
      }
      // What is left is the chance that somebody raises.
      sum -= Math.max(0, Math.min(1 - noRaise + 1e-9, 1 - accounted)) * a;
      ev = sum;
      let worse = 0;
      let better = 0;
      for (const o of opts) {
        const cont = o.call + o.raise;
        worse += cont * Math.max(0, 2 * o.continueEquity + o.continueBeats - 1);
        better += cont * o.continueBeats;
      }
      value = worse > better;
    }
    // The standard error of ev - evCheck.
    let variance = checkVar;
    legs.forEach((l, j) => {
      const o = opts[j];
      const B = Math.min(a, l.opp.stack);
      const odds = pot / (pot + B);
      const m = l.rate === null ? odds : clamp(l.rate, 0, 1);
      const scale = l.rate === null ? 1 : odds / refOdds;
      const sd = Math.sqrt((m * (1 - m)) / (l.n + EXPLOIT_PRIOR_STRENGTH + 1)) * scale;
      const othersFold =
        folds[j] > 0 ? allFold / folds[j] : folds.reduce((x, y, k) => (k === j ? x : x * y), 1);
      variance += (sd * (pot + B) * othersFold) ** 2;
      const cont = clamp(o.call + o.raise, 0, 1);
      const e = clamp(o.continueEquity, 0, 1);
      const eff = Math.max(1, l.impact.opp.effective);
      variance += ((pot + 2 * B) * othersFold) ** 2 * ((cont * e * (1 - e)) / eff);
      variance += 3 * (MODEL_ROUNDING * (pot + 2 * B)) ** 2;
    });
    rows.push({
      action: a >= hero.stack - 0.005 ? 'all_in' : 'bet',
      amount: a,
      ev: round2(ev),
      allFold: round2(allFold),
      error: round2(Math.sqrt(variance)),
      value,
    });
  }
  if (rows.length === 0) return null;
  const check = round2(evCheck);
  let chosen: OmahaCheckedToRow | null = null;
  let nearest: OmahaCheckedToRow | null = null;
  for (const row of rows) {
    if (row.ev - check > row.error && (chosen === null || row.ev > chosen.ev)) chosen = row;
    if (nearest === null || row.ev - check - row.error > nearest.ev - check - nearest.error)
      nearest = row;
  }
  return {
    action: chosen ? chosen.action : 'check',
    amount: chosen ? chosen.amount : 0,
    street: scope.street,
    opponents: legs.length,
    evCheck: check,
    showdown: round2(showdown),
    best: chosen ?? nearest,
    rows,
    source,
  };
}

export interface OmahaCheckedToResult {
  decision: HorseDecision;
  /** the comparison was made */
  priced: boolean;
  changed: 'bet' | null;
  /** the bet is not a value bet: better hands continue more than worse ones (a declared bluff) */
  bluff: boolean;
  verdict?: OmahaCheckedToVerdict;
}

/** The option's one entry: today's check priced beside the bets. Every other decision is returned as given. */
export function omahaCheckedToBetDecision(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  readOf: (seat: number) => OmahaCheckedToRead | null,
  rake: number
): OmahaCheckedToResult {
  const same: OmahaCheckedToResult = { decision, priced: false, changed: null, bluff: false };
  if (decision.action !== 'check') return same;
  const scope = omahaCheckedToBetScope(hero, gs);
  if (!scope) return same;
  const verdict = omahaCheckedToBet(hero, gs, scope, readOf, rake);
  if (!verdict) return same;
  if (verdict.action === 'check' || verdict.best === null)
    return { decision, priced: true, changed: null, bluff: false, verdict };
  const next: HorseDecision = { ...decision, action: verdict.action };
  if (verdict.action === 'bet') next.amount = verdict.amount;
  else delete next.amount;
  return { decision: next, priced: true, changed: 'bet', bluff: !verdict.best.value, verdict };
}
