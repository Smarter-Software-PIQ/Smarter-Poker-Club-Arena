/**
 * OMAHA STRONG HAND VALUE (2026-11-15, PLO Strategy lane; option
 * omahaStrongHandValue, default OFF, read `=== true`).
 *
 * Owner, 2026-11-15 12:16 Chicago: the mistakes and playbooks of the earlier
 * all-hands study are to be added where they are ready. The study
 * (horse-human-study-01a1af6b, review-v9, cut-off 2026-11-06) flags 336
 * PLO4/PLO5 cash river decisions, all but one with a full house, in six
 * patterns. Replayed through the brain of 2026-11-15 (lane archive
 * plo-handoff-review-01a1cbbd/playbook-binding-20261115/BINDING.md):
 *
 *  - a full house checked to on the river and checked (48): today every one
 *    bets, by a rule that bets half the pot with any full house that has a
 *    lower one under it, whatever the count of better hands and whoever is
 *    left to act;
 *  - a full house first to act on the river, or with players behind, and
 *    checked (145): 105 still check (the no-lead rule);
 *  - a full house facing a river bet and only called (55): 46 still call, 20
 *    of them a raise the river nut-raise rule turned into a call;
 *  - a full house facing a river bet and raised (84): 38 are calls today (the
 *    river nut-raise rule), 46 still raise with the nuts or a full house no
 *    bigger one beats;
 *  - a full house folded to a river bet (2): both call today.
 *
 * The owner's principles (2026-11-15): no blanket rule; the decision depends
 * on the hand, the player and the price; strong hands are pressed. This
 * module makes the three decisions those patterns turn on as expected-value
 * comparisons, for PLO4 / PLO5 cash, one board, high only, on the river, with
 * a STRONG HAND: a full house or better, or the nuts or an effective-nut hand
 * (omahaNutClassNow). A hand below a full house that is not nut class is
 * never touched, so the owner's ruling stands: no bet out of position and no
 * raise without the nuts when a straight or a flush on the board beats the
 * hand.
 *
 *  (a) VALUE BET. Nothing to call and today's answer is a check. Against each
 *      opponent still in the hand the check and every bet size the engine
 *      considers are priced with HorseOmahaCardImpact (his range from his
 *      line this hand and his measured tendencies; at each size the top of it
 *      raises, the next part calls, the rest folds). A size is a value bet
 *      when the hands that call and lose outweigh those that call or raise
 *      and win. The value bet of highest expected value is made when it is
 *      worth at least the check. Heads-up the numbers are the card-impact
 *      module's own. With two or more opponents they are combined (see
 *      MULTIWAY).
 *  (c) INDUCE CHECK. The same comparison when a player is still to act
 *      behind: the check is kept only when it is worth more than every value
 *      bet (he bets worse hands and bluffs at his measured rate and is
 *      called), or when no size is a value bet.
 *  (b) VALUE RAISE SIZE, NUT-CLASS HANDS ONLY. The owner's rulings stand:
 *      no river raise without the nuts (2026-11-14, hand 59401453) and, on
 *      the turn and the river facing a bet, "never a raise" without the nuts
 *      (2026-11-15 12:52 / 12:53, hand 59534208). So (b) applies only when
 *      the hand is nut class right now (omahaNutClassNow, the helper
 *      HorseOmahaOopChecks uses); a full house a bigger one beats keeps
 *      today's call or fold. The Horse faces one bettor, nobody else is in
 *      the hand, and today's answer is a call. EV(call) is HorseOmahaFacingBetEv's
 *      (exact count of the holdings that beat, tie and lose to the hand,
 *      against his value region and bluff share). EV(raise to each legal
 *      size): his bluffs fold; of his value region the strongest part
 *      continues, sized by the price the raise lays him and, when he is
 *      measured, his river call rate; the Horse wins the raise from the
 *      holdings it beats in that part (exact count) and loses its raise to
 *      those that beat it. The raise is made when it is a value raise (the
 *      continuing holdings it beats outnumber those that beat it) and worth
 *      more than the call by OMAHA_STRONG_HAND_RAISE_MARGIN of the pot, at
 *      the size of highest expected value.
 *
 * MULTIWAY (the minimal extension of the heads-up pricing; 115 of the 193
 * flagged checks had two or more opponents). Each opponent j is priced alone,
 * giving at each size the share of his range that continues with a better
 * hand (b_j) and with a worse one (l_j), his showdown share s_j, and the
 * value of a check when he may still bet. Two joint corrections come first,
 * because N players do not each answer as if alone: (1) against a bet the
 * field as a whole defends the minimum-defence share m = pot / (pot + B), so
 * each player continues with the share 1 - (1 - m)^(1/N) and not m; the hands
 * dropped are his weakest callers (worse hands first, a better hand stays);
 * (2) after a check at most one player bets first, so the gains the players
 * still to act add are scaled by P(at least one bets) / sum of their bet
 * rates. Then they are combined as independent:
 *   EV(bet B)  = prod(1 - b_j) x (pot + sum_j B x l_j / (1 - b_j))
 *                - (1 - prod(1 - b_j)) x B
 *   EV(check)  = pot x prod(s_j)
 *                + scale x sum over players still to act of
 *                  (his heads-up check value - pot x s_j) x prod_{k != j} s_k
 * A raise by a better hand costs the bet, no more (the Horse folds to it). A
 * size is a value bet when sum l_j > sum b_j. The independence of the ranges
 * is a stated simplification: joint card removal is not modelled.
 *
 * TOURNAMENTS are out: the comparison is in chips, and a tournament decision
 * is worth prize money (the study has no payout context for any of its
 * tournament decisions). The three PLO4 tournament entries stay unbound to
 * this option.
 *
 * Pure: no state beyond the card-impact module's memo, no random draw, no
 * telemetry, no opponent memory. The caller (HorseLogic) supplies the reads.
 *
 * LIMITS. River only. After a check the Horse only calls a bet (no
 * check-raise is priced), so the check is undervalued and the option leans
 * toward betting. The raise response is a model, not a measurement: the
 * continuing share is the minimum-defence share of his betting range, moved
 * by his measured river call rate. Facing a bet with another player in the
 * hand the raise is not considered. A bet today's brain already makes is not
 * re-priced.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { scoreOmahaHiPartial, variantInfo } from './HorseEval.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import {
  OMAHA_CARD_IMPACT_PRIOR,
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactLine,
  omahaCardImpactRead,
  type OmahaCardImpact,
} from './HorseOmahaCardImpact.js';
import {
  omahaEvHandCounts,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
  type OmahaFacingBetEvRead,
} from './HorseOmahaFacingBetEv.js';
import { omahaStrategyGameInScope } from './HorseOmahaStrategyGame.js';

export const OMAHA_STRONG_HAND_VALUE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** A value raise must be worth more than the call by this share of the pot. */
export const OMAHA_STRONG_HAND_RAISE_MARGIN = 0.04;
/** Raise sizes priced: this share of the way from the minimum raise to the largest legal one. */
export const OMAHA_STRONG_HAND_RAISE_STEPS: readonly number[] = [0, 0.5, 1];
/** The made-hand category of a full house (scoreOmahaHiPartial). */
const FULL_HOUSE = 7;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The option's game: PLO4/PLO5 cash, pot limit, high only, one board, the river. */
function inGame(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!omahaStrategyGameInScope(OMAHA_STRONG_HAND_VALUE_VARIANTS, gs)) return false;
  if (String(gs.stage ?? '') !== 'river') return false;
  const vi = variantInfo(variant);
  if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return false;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return false;
  if (
    (gs.boardCount ?? 1) > 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0
  )
    return false;
  if (gs.allInOrFold === true || gs.wagersCapped === true || gs.bombPot === true) return false;
  // Cash only, read as HorseLogic.isTournamentMode reads it.
  if (
    gs.gameMode ? gs.gameMode === 'tournament' : gs.tournament != null || (gs.bigBlind ?? 0) >= 10
  )
    return false;
  if ((gs.communityCards ?? []).length !== 5) return false;
  if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return false;
  if (hero.is_folded || hero.is_all_in || hero.is_sitting_out) return false;
  if (!fin(hero.stack) || !(hero.stack > 0)) return false;
  return fin(gs.pot) && gs.pot > 0;
}

/**
 * A strong hand: a full house or better, or the nuts or an effective-nut hand.
 * A straight or a flush that is not nut class is not one (the owner's ruling
 * on hands a straight or flush on the board beats stays with its own rules).
 */
export function omahaStrongHandNow(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    const score = scoreOmahaHiPartial(hero.cards, gs.communityCards ?? []);
    if (Math.floor(score / 0x100000) >= FULL_HOUSE) return true;
    return omahaNutClassNow(hero, gs);
  } catch {
    return false;
  }
}

// ─────────────────────── (a) value bet, (c) induce check ───────────────────────

export interface OmahaStrongHandCheckScope {
  /** every other player still in the hand; none is all in */
  opponents: SeatPlayer[];
  /** seats that have already checked this river */
  checked: Set<number>;
  /** every opponent has checked: a check by the Horse ends the hand */
  heroCloses: boolean;
}

/** The spot of (a) and (c): a strong hand on the river with nothing to call. Public information and the Horse's cards. */
export function omahaStrongHandCheckScope(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaStrongHandCheckScope | null {
  try {
    if (!inGame(hero, gs)) return null;
    const toCall = fin(gs.toCall)
      ? Math.max(0, gs.toCall)
      : Math.max(0, (gs.currentBet || 0) - (fin(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    const opponents = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    );
    if (opponents.length === 0) return null;
    // A player all in from an earlier street cannot answer a bet and must
    // still be beaten: that spot is not priced here.
    if (opponents.some((p) => p.is_all_in || !fin(p.stack) || !(p.stack > 0))) return null;
    if (!omahaStrongHandNow(hero, gs)) return null;
    const checked = new Set<number>();
    for (const a of gs.actionHistory ?? [])
      if (String(a.stage) === 'river' && String(a.action) === 'check' && a.seat !== hero.seat)
        checked.add(a.seat);
    return { opponents, checked, heroCloses: opponents.every((p) => checked.has(p.seat)) };
  } catch {
    return null;
  }
}

export interface OmahaStrongHandBetRow {
  action: 'bet' | 'all_in';
  amount: number;
  ev: number;
  /** summed over the opponents: the share of each range that continues with a worse / a better hand */
  worse: number;
  better: number;
  value: boolean;
}

export interface OmahaStrongHandCheckVerdict {
  action: 'check' | 'bet' | 'all_in';
  amount: number;
  /** value_bet: the check became this bet. induce_check: the check is kept because it is worth more than every value bet and a player behind can still bet. null: the check is kept for another reason (no size is a value bet). */
  changed: 'value_bet' | 'induce_check' | null;
  opponents: number;
  heroCloses: boolean;
  evCheck: number;
  /** the value bet of highest expected value, when one exists */
  best: OmahaStrongHandBetRow | null;
  rows: OmahaStrongHandBetRow[];
}

/**
 * (a) and (c): the check priced beside every bet size against every opponent.
 * `reads` maps an opponent seat to his measured read (absent or null: the
 * population prior). Null when a number cannot be computed.
 */
export function omahaStrongHandCheckedTo(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  scope: OmahaStrongHandCheckScope,
  reads: ReadonlyMap<number, OmahaReadConditional | null> = new Map(),
  /** omahaBetSizeByPublicState: the one bet size priced (the public size), or the all-in. */
  publicBet?: number | 'all_in'
): OmahaStrongHandCheckVerdict | null {
  const pot = gs.pot;
  // Sizes: the engine's pot fractions, legal against the deepest opponent
  // (with the public size on, that size alone).
  const deepest = scope.opponents.reduce((a, b) => (b.stack > a.stack ? b : a));
  const amounts =
    publicBet !== undefined
      ? [round2(publicBet === 'all_in' ? hero.stack : publicBet)]
      : omahaCardImpactAmounts(hero, deepest, gs);
  if (amounts.length === 0) return null;
  const impacts: OmahaCardImpact[] = [];
  const closes: boolean[] = [];
  const betRates: number[] = [];
  for (const opp of scope.opponents) {
    // He acts after a check unless he has already checked.
    const closed = scope.checked.has(opp.seat);
    const read = omahaCardImpactRead(reads.get(opp.seat) ?? null);
    const impact = omahaCardImpact({
      hole: hero.cards,
      board: gs.communityCards ?? [],
      dead: hero.knownDeadCards ?? [],
      pot,
      heroStack: hero.stack,
      oppStack: opp.stack,
      heroCloses: closed,
      line: omahaCardImpactLine(hero, opp, gs),
      read,
      amounts,
      seedSalt: opp.seat * 16 + hero.seat,
    });
    if (!impact) return null;
    impacts.push(impact);
    closes.push(closed);
    betRates.push(clamp(read.betCheckedTo, 0, 1));
  }
  const rows: OmahaStrongHandBetRow[] = [];
  let evCheck: number;
  if (impacts.length === 1) {
    // Heads-up: the card-impact module's own numbers.
    evCheck = impacts[0].options[0].ev;
    for (const o of impacts[0].options) {
      if (o.action === 'check') continue;
      const cont = o.call + o.raise;
      rows.push({
        action: o.action,
        amount: o.amount,
        ev: o.ev,
        worse: round2(cont * Math.max(0, 2 * o.continueEquity + o.continueBeats - 1)),
        better: round2(cont * o.continueBeats),
        value: o.value,
      });
    }
  } else {
    const s = impacts.map((i) => clamp(i.showdown, 0, 1));
    evCheck = pot * s.reduce((a, b) => a * b, 1);
    // At most one player bets first: the summed gains are scaled to the
    // chance that at least one of the players still to act bets.
    let noneBets = 1;
    let rateSum = 0;
    closes.forEach((closed, j) => {
      if (closed) return;
      noneBets *= 1 - betRates[j];
      rateSum += betRates[j];
    });
    const scale = rateSum > 0 ? Math.min(1, (1 - noneBets) / rateSum) : 0;
    impacts.forEach((impact, j) => {
      if (closes[j]) return;
      // What his bet after a check adds over checking it down, the others beaten.
      const gain = impact.options[0].ev - pot * s[j];
      let others = 1;
      s.forEach((x, k) => {
        if (k !== j) others *= x;
      });
      evCheck += scale * gain * others;
    });
    evCheck = round2(evCheck);
    const n = impacts.length;
    for (const amount of amounts) {
      const a = round2(Math.min(amount, hero.stack));
      // The field defends the minimum-defence share together: each player's
      // continuing share shrinks by this factor, weakest callers first.
      const mdf = pot / (pot + a);
      const joint = (1 - (1 - mdf) ** (1 / n)) / mdf;
      let noBetter = 1;
      let worseChips = 0;
      let worse = 0;
      let better = 0;
      let ok = true;
      impacts.forEach((impact, j) => {
        const o = impact.options.find(
          (x) => x.action !== 'check' && Math.abs(x.amount - a) < 0.006
        );
        if (!o) {
          ok = false;
          return;
        }
        const cont = o.call + o.raise;
        const b = clamp(Math.min(cont * o.continueBeats, cont * joint), 0, 0.999);
        const l = clamp(
          cont * Math.max(0, 2 * o.continueEquity + o.continueBeats - 1) - cont * (1 - joint),
          0,
          1
        );
        noBetter *= 1 - b;
        worseChips += (Math.min(a, scope.opponents[j].stack) * l) / (1 - b);
        worse += l;
        better += b;
      });
      if (!ok) continue;
      rows.push({
        action: a >= hero.stack - 0.005 ? 'all_in' : 'bet',
        amount: a,
        ev: round2(noBetter * (pot + worseChips) - (1 - noBetter) * a),
        worse: round2(worse),
        better: round2(better),
        value: worse > better,
      });
    }
  }
  let best: OmahaStrongHandBetRow | null = null;
  for (const r of rows) if (r.value && (best === null || r.ev > best.ev)) best = r;
  const base = { opponents: impacts.length, heroCloses: scope.heroCloses, evCheck, best, rows };
  // Strong hands are pressed: the value bet is made unless the check is worth more.
  if (best !== null && best.ev >= evCheck)
    return { ...base, action: best.action, amount: best.amount, changed: 'value_bet' };
  return {
    ...base,
    action: 'check',
    amount: 0,
    changed: best !== null && !scope.heroCloses ? 'induce_check' : null,
  };
}

// ───────────────────────────── (b) value raise ─────────────────────────────

export interface OmahaStrongHandRaiseRow {
  /** the street total the raise is made to */
  to: number;
  allIn: boolean;
  ev: number;
  /** the share of his betting range that continues, and of all holdings the region that does */
  continues: number;
  region: number;
  /** against the continuing holdings: the Horse wins / loses (exact count) */
  win: number;
  lose: number;
  value: boolean;
}

export interface OmahaStrongHandRaiseVerdict {
  raise: boolean;
  action: 'call' | 'raise' | 'all_in';
  /** the raise-to amount when raise is true */
  amount: number;
  evCall: number;
  margin: number;
  /** the share of all holdings that beat the hand (exact) */
  beaten: number;
  bluffShare: number;
  valueShare: number;
  best: OmahaStrongHandRaiseRow | null;
  rows: OmahaStrongHandRaiseRow[];
}

export interface OmahaStrongHandRaiseContext {
  /** the bettor's measured facing-bet read (his bluff share) */
  bettorRead?: OmahaFacingBetEvRead | null;
  /** the bettor's measured tendencies (his river call rate) */
  callRead?: OmahaReadConditional | null;
  /** the marginal rake on the pot, as a fraction */
  rake?: number;
  /** omahaBetSizeByPublicState: the one raise-to size priced (the public size), or the all-in. */
  publicRaiseTo?: number | 'all_in';
}

/**
 * (b): EV(raise to each legal size) beside EV(call), one bettor and nobody
 * else in the hand, a nut-class hand (omahaNutClassNow), the river. Null outside the spot or when
 * the hand cannot be counted. It does not look at today's decision.
 */
export function omahaStrongHandRaiseVerdict(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: OmahaStrongHandRaiseContext = {}
): OmahaStrongHandRaiseVerdict | null {
  try {
    if (!inGame(hero, gs)) return null;
    const spot = omahaFacingBetEvSpot(hero, gs);
    if (!spot || spot.street !== 'river') return null;
    if (spot.callers > 0 || spot.allIns > 0 || spot.behind > 0 || spot.allIn) return null;
    const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
    // A raise needs someone who can match it.
    if (!bettor || bettor.is_all_in || !fin(bettor.stack) || !(bettor.stack > 0.005)) return null;
    // Owner rulings 2026-11-14 (hand 59401453) and 2026-11-15 12:52/12:53
    // (hand 59534208): facing a bet, a raise only with the nuts.
    if (!omahaNutClassNow(hero, gs)) return null;
    const menu = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    const canRaise = menu === null || menu.includes('raise');
    const canShove = menu === null || menu.includes('all_in');
    if (!canRaise && !canShove) return null;
    const heroBet = fin(hero.bet) ? Math.max(0, hero.bet) : 0;
    const cur = gs.currentBet;
    const toCall = spot.paid;
    const heroAll = heroBet + hero.stack;
    if (!(heroAll > cur + 0.005)) return null;
    const potTo = heroBet + toCall + gs.pot + toCall;
    const maxTo = Math.min(fin(gs.maxRaiseTo) ? gs.maxRaiseTo : potTo, heroAll, cur + bettor.stack);
    const minTo = fin(gs.minRaiseTo) ? gs.minRaiseTo : cur * 2;
    const whole = (gs.bigBlind ?? 1) >= 1;
    const sizes: number[] = [];
    if (ctx.publicRaiseTo !== undefined) {
      // omahaBetSizeByPublicState: the public size is the size raised.
      const to = ctx.publicRaiseTo === 'all_in' ? round2(heroAll) : round2(ctx.publicRaiseTo);
      const shove = to >= heroAll - 0.005;
      if (shove ? canShove : canRaise) sizes.push(to);
    } else if (maxTo + 0.005 < minTo) {
      // Only the short all-in raise is left.
      if (canShove && heroAll <= maxTo + 0.005) sizes.push(round2(heroAll));
    } else
      for (const f of OMAHA_STRONG_HAND_RAISE_STEPS) {
        let to = minTo + f * (maxTo - minTo);
        to = round2(clamp(whole ? Math.round(to) : round2(to), minTo, maxTo));
        const shove = to >= heroAll - 0.005;
        if (shove ? !canShove : !canRaise) continue;
        if (!sizes.includes(to)) sizes.push(to);
      }
    if (sizes.length === 0) return null;

    const hole: Card[] = hero.cards;
    const board: Card[] = gs.communityCards ?? [];
    const dead: Card[] = hero.knownDeadCards ?? [];
    const verdict = omahaFacingBetEvVerdict(spot, hole, board, dead, ctx.bettorRead ?? null, {
      rake: ctx.rake,
    });
    const counts = omahaEvHandCounts(hole, board, dead, spot.valueShare);
    if (!verdict || !counts) return null;
    const q = verdict.bluffShare;
    const rake = clamp(fin(ctx.rake) ? ctx.rake : 0, 0, 0.2);
    const win = spot.winnable * (1 - rake);
    const read = omahaCardImpactRead(ctx.callRead ?? null);
    const rate = read.measured ? (read.riverCallRate ?? read.continueRate) : null;
    const reference = 1 / (1 + OMAHA_CARD_IMPACT_PRIOR.referenceBet);
    const rows: OmahaStrongHandRaiseRow[] = [];
    for (const to of sizes) {
      const put = to - heroBet;
      const his = Math.min(to - cur, bettor.stack);
      if (!(his > 0.005) || !(put > toCall + 0.005)) continue;
      // The share of his betting range that continues: the minimum-defence
      // share at the price the raise lays him, moved by his measured river
      // call rate. His bluffs fold first, so it comes out of his value region.
      const price = (win + toCall) / (win + toCall + his);
      const keep = rate === null ? price : clamp((rate * price) / reference, 0.05, 0.97);
      const continues = Math.min(1 - q, keep);
      const region = clamp((counts.valueShare * continues) / Math.max(1e-9, 1 - q), 0.001, 0.95);
      const top = counts.top(region);
      const lose = Math.max(0, 1 - top.win - top.tie);
      const called =
        top.win * (win + his * (1 - rake)) + top.tie * ((win + his - put) / 2) - lose * put;
      rows.push({
        to,
        allIn: to >= heroAll - 0.005,
        ev: round2((1 - continues) * win + continues * called),
        continues: round2(continues),
        region: round4(region),
        win: round4(top.win),
        lose: round4(lose),
        value: top.win > lose,
      });
    }
    let best: OmahaStrongHandRaiseRow | null = null;
    for (const r of rows) if (r.value && (best === null || r.ev > best.ev)) best = r;
    const margin = OMAHA_STRONG_HAND_RAISE_MARGIN * gs.pot;
    const raise = best !== null && verdict.call && best.ev - verdict.ev > margin;
    return {
      raise,
      action: raise ? (best!.allIn ? 'all_in' : 'raise') : 'call',
      amount: raise ? best!.to : 0,
      evCall: round2(verdict.ev),
      margin: round2(margin),
      beaten: round4(Math.max(0, 1 - counts.all.win - counts.all.tie)),
      bluffShare: round2(q),
      valueShare: round4(counts.valueShare),
      best,
      rows,
    };
  } catch {
    return null;
  }
}

// ───────────────────────────── the decision ─────────────────────────────

export interface OmahaStrongHandValueReads {
  /** an opponent's measured tendencies by seat (null: the population prior) */
  conditional: (seat: number) => OmahaReadConditional | null;
  /** the bettor's facing-bet read for a wager of this share of the pot */
  facingBet: (seat: number, potFrac: number) => OmahaFacingBetEvRead | null;
  /** the marginal rake on the pot, as a fraction */
  rake?: number;
  /**
   * omahaBetSizeByPublicState (wave two): the public size of a bet and of a
   * raise here (an amount, or the all-in). Present, it is the one size priced
   * (the public size replaces any other). Absent: every size as before.
   */
  publicBet?: number | 'all_in';
  publicRaiseTo?: number | 'all_in';
}

export interface OmahaStrongHandValueResult {
  decision: HorseDecision;
  /** the option priced this spot: its answer stands over the half-pot checked-to rule */
  priced: boolean;
  changed: 'value_bet' | 'value_raise' | 'induce_check' | null;
  check?: OmahaStrongHandCheckVerdict;
  raise?: OmahaStrongHandRaiseVerdict;
}

/**
 * The option's one entry: today's check priced against the value bets, or
 * today's call priced against the value raises. Every other decision is
 * returned as given.
 */
export function omahaStrongHandValueDecision(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  reads: OmahaStrongHandValueReads
): OmahaStrongHandValueResult {
  const same: OmahaStrongHandValueResult = { decision, priced: false, changed: null };
  try {
    if (decision.action === 'check') {
      const scope = omahaStrongHandCheckScope(hero, gs);
      if (!scope) return same;
      const map = new Map<number, OmahaReadConditional | null>();
      for (const o of scope.opponents) map.set(o.seat, reads.conditional(o.seat));
      const check = omahaStrongHandCheckedTo(hero, gs, scope, map, reads.publicBet);
      if (!check) return same;
      if (check.action === 'check')
        return { decision, priced: true, changed: check.changed, check };
      const next: HorseDecision = { ...decision, action: check.action };
      if (check.action === 'bet') next.amount = check.amount;
      else delete next.amount;
      return { decision: next, priced: true, changed: 'value_bet', check };
    }
    if (decision.action === 'call') {
      const spot = omahaFacingBetEvSpot(hero, gs);
      if (!spot) return same;
      const raise = omahaStrongHandRaiseVerdict(hero, gs, {
        bettorRead: reads.facingBet(spot.bettorSeat, spot.potFrac),
        callRead: reads.conditional(spot.bettorSeat),
        rake: reads.rake,
        ...(reads.publicRaiseTo !== undefined ? { publicRaiseTo: reads.publicRaiseTo } : {}),
      });
      if (!raise) return same;
      if (!raise.raise) return { decision, priced: true, changed: null, raise };
      const next: HorseDecision = { ...decision, action: raise.action };
      if (raise.action === 'raise') next.amount = raise.amount;
      else delete next.amount;
      delete next.continuationGuard;
      return { decision: next, priced: true, changed: 'value_raise', raise };
    }
    return same;
  } catch {
    return same;
  }
}
