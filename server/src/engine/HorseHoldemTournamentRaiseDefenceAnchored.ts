/**
 * ═══ HOLD'EM TOURNAMENT RAISE DEFENCE, ANCHORED TO EQUILIBRIUM (2026-11-24, v2) ════════
 *
 * The answer of the three options (holdemTournamentHeadsUpBigBlindDefenceIsPriced, holdemTournamentBlindDefenceIsPriced,
 * holdemTournamentCommittedRaiseIsPriced) at the three nodes the solved tables cover:
 *   d_vs_open    a blind facing one non-all-in open (heads-up big blind, or a blind three or more handed);
 *   o_vs_3bet    the opener facing one non-all-in 3-bet;
 *   d_vs_4bet    the 3-bettor facing the opener's non-all-in 4-bet.
 * v1 answered with a pure max-EV response priced against the CURRENT Horse pool's measured fold-to-jam rates, which
 * are themselves the leak being fixed (openers folded 69-79% where 40-45% equity was asked): it shoved nearly every
 * hand at 15-25 big blinds, a line any opponent who calls correctly beats. v2 starts from the equilibrium.
 *
 * THE PRIOR. With no record of the opponent the Horse plays the solved equilibrium mix of its class at the spot
 * (HorseHoldemTournamentRaiseDefenceSolved: the tables, between grid points the weighted mix of the neighbours).
 * A mixed class is played by an explicit frequency the solution asks for: one draw from a seed hashed from the public
 * spot and the Horse's own cards (the same state always gives the same action), recorded in the receipt with the mix.
 *
 * THE OPPONENT MODEL. His range and his reply to the Horse's jam start at the solution's (the opener's open range
 * and his call of a jam; the 3-bettor's 3-bet range and his call; the 4-bettor's range and his call). They may move:
 *   - his fold to the Horse's jam (not his range width: the solved raise range at these depths is often a sliver of
 *     the hands, the least-losing ones where the solution rarely raises, and a measured width says nothing about
 *     which hands widen it) by the measured population rate (HorseHoldemTournamentRaiseDefencePriors.data), with the trust weight
 *     min(POPULATION_TRUST_MAX, n / (n + POPULATION_TRUST_K)) (at most a quarter of the way), HALVED when the population rate sits on the side of the Nash rate that is the
 *     leak these options fix (folding to a jam more than Nash; opening or 3-betting narrower than Nash, which would
 *     make the Horse defend tighter). POPULATION_TRUST_K = 4000 opportunities: the pool is mostly Horses whose rates
 *     this change moves, so a whole cell of it (n 1,000 to 3,000) moves the prior a fifth to two fifths of the way;
 *   - his fold to the jam and his raise width by the opponent's OWN record (HorseOpponentExploit read: his posterior mean of the statistic over the
 *     population's, times the prior), with weight n / (n + OWN_TRUST_K), OWN_TRUST_K = 20 decayed opportunities, so
 *     a real sample dominates: a real over-folder is still attacked, a wide caller respected.
 * A fold rate moves his reply by the strength order (STRENGTH_ORDER): calling less takes his weakest calls away,
 * calling more adds his strongest folds; a wider range adds, strongest first, the hands the solution has him NOT
 * raising (folding, or calling where he 3-bets), a narrower one drops his weakest raises. Nobody is treated differently for who he is.
 *
 * THE ANSWER. The expected value of each action is computed twice in chips, losses weighted by the bubble factor where
 * the engine's pay-jump layer says a pay jump is live (1 elsewhere): against the moved model with the live bubble
 * factor, and against the solution's model at chip EV. Delta = the difference. At the solved prior every action in the
 * class's equilibrium support is worth the same (the equilibrium's own indifference), so the support actions are
 * scored by their Delta and an action outside the support by its Delta minus its gap below the support (both
 * computed by the same code, so the approximations of this price cancel). The Horse plays the mix tilted by the
 * scores: each support action's share times exp(score / TILT_BB), renormalised; an action outside the support is
 * played (alone) only when its score beats every support action's by more than TILT_BB. With no move and no bubble
 * every Delta is 0 and the answer is the equilibrium mix exactly; a small move shifts the frequencies a little and
 * smoothly; a large, well-sampled one turns the answer into a best response. A non-all-in re-raise (the 3-bet, the 4-bet) has its value from the
 * table only, Delta 0 (its price does not move with the reads).
 *
 * THE PRICE (chips). P the pot now, C the call, Ah / Ar the chips the Horse / the raiser add all in, e_v the table
 * equity of the Horse's class against class v (combos counted after the Horse's cards), w_v his range weight:
 *   call (not all in): share_v x P - BF (1 - share_v) C, share_v the measured realisation of
 *     HorseHoldemTournamentRaiseDefenceSolved (out of position: its line; in position: one minus the other side's);
 *     a squeeze-jam from a player behind (the solved fixed-player share) takes the call away;
 *     a call that commits the Horse (HorseHoldemTournamentRaiseDefence.isCommitted) is priced as the all-in it is.
 *   jam: (1 - c_v) P + c_v ( e_v (P + Ah + Ar) - BF (1 - e_v) Ah ), c_v his call; a player behind wakes up with the
 *     solved fixed-player call share and the top of the strength order (the Horse is then all in against him).
 *   fold: 0.
 */
import type { Card } from '../types.js';
import { hashSeed } from './equity/SeededRandom.js';
import {
  HOLDEM_CLASSES,
  STRENGTH_ORDER,
  holdemClassComboCount,
  holdemClassOf,
  holdemTopRange,
} from './HorseHoldemTournamentAllInCall.js';
import {
  classVsClassEquity,
  equityVsRange,
  isCommitted,
} from './HorseHoldemTournamentRaiseDefence.js';
import {
  realisedShareOutOfPosition,
  solvedAction,
  solvedRangeOf,
  solvedNode,
  type SolvedNode,
  type SolvedQuery,
} from './HorseHoldemTournamentRaiseDefenceSolved.js';

export const HOLDEM_RAISE_DEFENCE_ANCHORED_VERSION =
  'holdem-tournament-raise-defence-anchored-v2' as const;
export const POPULATION_TRUST_K = 4000;
/** The most a population cell may move the prior (before the halving on the leak's side). */
export const POPULATION_TRUST_MAX = 0.25;
export const OWN_TRUST_K = 20;
/** The temperature of the tilt (big blinds): a support action's weight is its mix share times exp(Delta / TILT_BB). */
export const TILT_BB = 0.05;

export type AnchoredNode = 'd_vs_open' | 'o_vs_3bet' | 'd_vs_4bet';
export type AnchoredAction = 'fold' | 'call' | 'three_bet' | 'four_bet' | 'jam';

/** A measured rate with its opportunities. */
export interface MeasuredRate {
  p: number;
  n: number;
}

export interface AnchoredSpot {
  node: AnchoredNode;
  query: SolvedQuery;
  hero: readonly Card[];
  bb: number;
  pot: number;
  heroStack: number;
  heroBet: number;
  oppStack: number;
  oppBet: number;
  /** Players still to act behind the Horse (fixed players of the solved model). */
  behind: number;
  bubbleFactor: number;
  legal: { call: boolean; jam: boolean; raise: boolean };
  /** The population's fold to the Horse's jam at its price, and its range width (open / 3-bet share), measured. */
  population: { fold: MeasuredRate | null; width: MeasuredRate | null };
  /** The opponent's own record: his statistic over the population's, with its decayed opportunities. */
  own: { foldRatio: number | null; foldN: number; widthRatio: number | null; widthN: number };
  /** The public spot (for the seed of a mixed class's draw). */
  seedParts: ReadonlyArray<string | number>;
}

export interface AnchoredVerdict {
  action: AnchoredAction;
  actions: readonly AnchoredAction[];
  /** The equilibrium mix of the Horse's class over its legal actions (renormalised). */
  mix: number[];
  /** The mix played (after the shift), and the draw that picked the action from it. */
  played: number[];
  draw: number;
  /** EV (big blinds, relative to folding) against the moved model with the live bubble factor, and Delta. */
  ev: number[];
  delta: number[];
  /** The opponent model: his range width, his fold to the jam (solution / moved), the weights used. */
  oppWidth: number;
  oppWidthNash: number;
  foldToJam: number;
  foldToJamNash: number;
  populationWeight: { fold: number; width: number };
  ownWeight: { fold: number; width: number };
  committed: boolean;
  bubbleFactor: number;
  solvedGain: number;
  version: typeof HOLDEM_RAISE_DEFENCE_ANCHORED_VERSION;
}

const RANKS = 'AKQJT98765432';
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const cardKey = (c: Card): number => RANKS.indexOf(c.rank) * 4 + SUITS.indexOf(c.suit);
const COMBOS = HOLDEM_CLASSES.map((c) => holdemClassComboCount(c));
const CLASS_CARDS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = HOLDEM_CLASSES.map(
  (cls) => {
    const r1 = RANKS.indexOf(cls[0]);
    const r2 = RANKS.indexOf(cls[1]);
    const out: Array<readonly [number, number]> = [];
    if (cls.length === 2) {
      for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) out.push([r1 * 4 + a, r2 * 4 + b]);
    } else if (cls.endsWith('s')) {
      for (let s = 0; s < 4; s++) out.push([r1 * 4 + s, r2 * 4 + s]);
    } else {
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) if (a !== b) out.push([r1 * 4 + a, r2 * 4 + b]);
    }
    return out;
  }
);

const width = (r: Float64Array): number => {
  let w = 0;
  for (let i = 0; i < 169; i++) w += r[i] * COMBOS[i];
  return w / 1326;
};

/**
 * Move a range to a target width: add, strongest first, from `avail` (per class, the share he could still raise: the
 * solution's non-raising actions), or take away his weakest raises.
 */
export function moveWidth(r: Float64Array, target: number, avail: Float64Array): Float64Array {
  const out = Float64Array.from(r);
  let gap = (Math.max(0, Math.min(1, target)) - width(r)) * 1326;
  if (Math.abs(gap) < 1e-9) return out;
  const order = gap > 0 ? STRENGTH_ORDER : [...STRENGTH_ORDER].reverse();
  for (const i of order) {
    if (Math.abs(gap) < 1e-9) break;
    if (gap > 0) {
      const add = Math.min(Math.max(0, Math.min(avail[i], 1 - out[i])), gap / COMBOS[i]);
      if (add > 0) {
        out[i] += add;
        gap -= add * COMBOS[i];
      }
    } else {
      const take = Math.min(out[i], -gap / COMBOS[i]);
      if (take > 0) {
        out[i] -= take;
        gap += take * COMBOS[i];
      }
    }
  }
  return out;
}

/** His reply (call share per class, inside his range r) moved to a target fold share of his range. */
export function moveReply(c: Float64Array, r: Float64Array, targetFold: number): Float64Array {
  const out = Float64Array.from(c);
  const tot = width(r) * 1326;
  if (!(tot > 0)) return out;
  let called = 0;
  for (let i = 0; i < 169; i++) called += r[i] * out[i] * COMBOS[i];
  let gap = (1 - Math.max(0, Math.min(1, targetFold))) * tot - called;
  const order = gap > 0 ? STRENGTH_ORDER : [...STRENGTH_ORDER].reverse();
  for (const i of order) {
    if (Math.abs(gap) < 1e-9) break;
    const m = r[i] * COMBOS[i];
    if (!(m > 0)) continue;
    if (gap > 0) {
      const add = Math.min(1 - out[i], gap / m);
      if (add > 0) {
        out[i] += add;
        gap -= add * m;
      }
    } else {
      const take = Math.min(out[i], -gap / m);
      if (take > 0) {
        out[i] -= take;
        gap += take * m;
      }
    }
  }
  return out;
}

const foldShare = (c: Float64Array, r: Float64Array): number => {
  const tot = width(r) * 1326;
  if (!(tot > 0)) return 0;
  let called = 0;
  for (let i = 0; i < 169; i++) called += r[i] * c[i] * COMBOS[i];
  return 1 - called / tot;
};

/** The trust weights and the moved value of one statistic. */
function moved(
  nash: number,
  pop: MeasuredRate | null,
  leakSideIsAbove: boolean,
  ownRatio: number | null,
  ownN: number
): { value: number; wPop: number; wOwn: number } {
  let value = nash;
  let wPop = 0;
  if (pop && Number.isFinite(pop.p) && pop.n > 0) {
    wPop = Math.min(POPULATION_TRUST_MAX, pop.n / (pop.n + POPULATION_TRUST_K));
    if (leakSideIsAbove ? pop.p > nash : pop.p < nash) wPop /= 2;
    value = nash + wPop * (pop.p - nash);
  }
  let wOwn = 0;
  if (ownRatio !== null && Number.isFinite(ownRatio) && ownRatio > 0 && ownN > 0) {
    wOwn = ownN / (ownN + OWN_TRUST_K);
    const own = Math.max(0, Math.min(1, value * ownRatio));
    value = value + wOwn * (own - value);
  }
  return { value: Math.max(0, Math.min(1, value)), wPop, wOwn };
}

interface Model {
  range: Float64Array;
  reply: Float64Array;
}

/** The opponent's range and his call of the Horse's jam at this node, from the solution. */
function nashModel(
  node: AnchoredNode,
  q: SolvedQuery
): { model: Model; mine: SolvedNode; avail: Float64Array } | null {
  if (node === 'd_vs_open') {
    const root = solvedNode(q, 'o_root');
    const vj = solvedNode(q, 'o_vs_jam');
    const mine = solvedNode(q, 'd_vs_open');
    if (!root || !vj || !mine) return null;
    const open = solvedRangeOf(root, 'open');
    // An open the solution never makes at this depth: the opener's raise read as his jam range (he raised what he
    // would otherwise have jammed).
    return {
      model: {
        range: width(open) > 1e-6 ? open : solvedAction(root, 'jam'),
        reply: solvedAction(vj, 'call'),
      },
      mine,
      avail: solvedAction(root, 'fold'),
    };
  }
  if (node === 'o_vs_3bet') {
    const dv = solvedNode(q, 'd_vs_open');
    const vj = solvedNode(q, 'd_vs_jam_3bet');
    const mine = solvedNode(q, 'o_vs_3bet');
    if (!dv || !vj || !mine) return null;
    return {
      model: {
        range:
          width(solvedRangeOf(dv, 'three_bet')) > 1e-6
            ? solvedRangeOf(dv, 'three_bet')
            : solvedAction(dv, 'jam'),
        reply: solvedAction(vj, 'call'),
      },
      mine,
      avail: solvedAction(dv, 'fold').map((x, i) => x + solvedAction(dv, 'call')[i]),
    };
  }
  const root = solvedNode(q, 'o_root');
  const v3 = solvedNode(q, 'o_vs_3bet');
  const vj = solvedNode(q, 'o_vs_jam_4bet');
  const mine = solvedNode(q, 'd_vs_4bet');
  if (!root || !v3 || !vj || !mine) return null;
  const open = solvedRangeOf(root, 'open');
  const four = solvedRangeOf(v3, 'four_bet');
  const r4 = open.map((x, i) => x * four[i]);
  const jam4 = open.map((x, i) => x * solvedAction(v3, 'jam')[i]);
  return {
    model: { range: width(r4) > 1e-6 ? r4 : jam4, reply: solvedAction(vj, 'call') },
    mine,
    avail: open.map((x, i) => x * (solvedAction(v3, 'call')[i] + solvedAction(v3, 'fold')[i])),
  };
}

/** EV (chips, relative to folding) of the Horse's fold, call and jam against a model. */
function evs(
  s: AnchoredSpot,
  m: Model,
  heroClass: number,
  bf: number,
  fixed: readonly [number, number] | null,
  heroOutOfPosition: boolean
): { call: number | null; jam: number | null; committed: boolean } | null {
  const k0 = cardKey(s.hero[0]);
  const k1 = cardKey(s.hero[1]);
  const C = Math.max(0, s.oppBet - s.heroBet);
  const P = s.pot;
  const heroTotal = s.heroStack + s.heroBet;
  const oppTotal = s.oppStack + s.oppBet;
  const matched = Math.min(heroTotal, oppTotal);
  const Ah = Math.max(0, matched - s.heroBet);
  const Ar = Math.max(0, matched - s.oppBet);
  const committed = isCommitted({
    behindAfterCall: s.heroStack - C,
    potAfterCall: P + C,
    raiseTo: s.oppBet,
    chipsAtStreetStart: heroTotal,
  });
  const spr = Math.min(s.heroStack - C, s.oppStack) / (P + C);
  let den = 0;
  let callHu = 0;
  let callAllIn = 0;
  let jamHu = 0;
  for (let v = 0; v < 169; v++) {
    const rv = m.range[v];
    if (!(rv > 0)) continue;
    let n = 0;
    for (const [a, b] of CLASS_CARDS[v]) if (a !== k0 && a !== k1 && b !== k0 && b !== k1) n++;
    if (n === 0) continue;
    const w = rv * n;
    const e = classVsClassEquity(heroClass, v);
    const share = heroOutOfPosition
      ? realisedShareOutOfPosition(e, spr)
      : 1 - realisedShareOutOfPosition(1 - e, spr);
    const allIn = e * (P + Ar) - bf * (1 - e) * Ah;
    callHu += w * (share * P - bf * (1 - share) * C);
    callAllIn += w * allIn;
    const c = Math.max(0, Math.min(1, m.reply[v]));
    jamHu += w * ((1 - c) * P + c * allIn);
    den += w;
  }
  if (!(den > 0)) return null;
  callHu /= den;
  callAllIn /= den;
  jamHu /= den;
  // The fixed players behind (the solved model's): a squeeze-jam over the call, a wake-up call of the jam.
  const nBehind = Math.max(0, Math.round(s.behind));
  const Jo = fixed ? fixed[0] : 0;
  const Jc = fixed ? fixed[1] : 0;
  const squeeze = 1 - Math.pow(1 - Jo, nBehind);
  const wake = 1 - Math.pow(1 - Jc, nBehind);
  let wakeEv = 0;
  if (wake > 0) {
    const ew = equityVsRange(s.hero, holdemTopRange(Jc)) ?? 0.5;
    wakeEv = ew * (P + Ah) - bf * (1 - ew) * Ah;
  }
  const call = !s.legal.call
    ? null
    : committed
      ? (1 - wake) * callAllIn + wake * wakeEv
      : (1 - squeeze) * callHu - squeeze * bf * C;
  const jam = s.legal.jam ? (1 - wake) * jamHu + wake * wakeEv : null;
  return { call, jam, committed };
}

/** The anchored answer; null where the spot or the tables cannot price it. */
export function priceAnchoredDefence(s: AnchoredSpot): AnchoredVerdict | null {
  if (s.hero.length !== 2 || !(s.bb > 0) || !(s.pot > 0)) return null;
  const cls = holdemClassOf(s.hero[0], s.hero[1]);
  if (!cls) return null;
  const h = HOLDEM_CLASSES.indexOf(cls);
  if (h < 0) return null;
  const base = nashModel(s.node, s.query);
  if (!base) return null;
  const { model: nash, mine, avail } = base;
  const bf = Number.isFinite(s.bubbleFactor) && s.bubbleFactor >= 1 ? s.bubbleFactor : 1;
  // The moved model.
  const nashWidth = width(nash.range);
  const nashFold = foldShare(nash.reply, nash.range);
  const wv = moved(nashWidth, s.population.width, false, s.own.widthRatio, s.own.widthN);
  const range = moveWidth(nash.range, wv.value, avail);
  const fv = moved(
    foldShare(nash.reply, range),
    s.population.fold,
    true,
    s.own.foldRatio,
    s.own.foldN
  );
  const reply = moveReply(nash.reply, range, fv.value);
  const heroOop = s.node !== 'o_vs_3bet';
  const e0 = evs(s, nash, h, 1, mine.fixed, heroOop);
  const e1 = evs(s, { range, reply }, h, bf, mine.fixed, heroOop);
  if (!e0 || !e1) return null;
  // The Horse's legal actions at this node and its class's mix over them.
  const nodeActs = mine.actions as readonly AnchoredAction[];
  const raiseAct: AnchoredAction | null =
    s.node === 'd_vs_open' ? 'three_bet' : s.node === 'o_vs_3bet' ? 'four_bet' : null;
  const actions = nodeActs.filter(
    (a) =>
      a === 'fold' ||
      (a === 'call' && s.legal.call) ||
      (a === 'jam' && s.legal.jam) ||
      (a === raiseAct && s.legal.raise && mine.q[a as 'three_bet' | 'four_bet'] !== undefined)
  );
  const raw = actions.map((a) => mine.p[nodeActs.indexOf(a)][h]);
  const rs = raw.reduce((x, y) => x + y, 0);
  const mix = rs > 0 ? raw.map((x) => x / rs) : actions.map((a) => (a === 'fold' ? 1 : 0));
  const bb = s.bb;
  const evOf = (e: typeof e0, a: AnchoredAction): number | null => {
    if (a === 'fold') return 0;
    if (a === 'call') return e.call === null ? null : e.call / bb;
    if (a === 'jam') return e.jam === null ? null : e.jam / bb;
    // A non-all-in re-raise: the table's action value, from the start of the hand; relative to folding it adds
    // back the chips the Horse already had in.
    const q = mine.q[a as 'three_bet' | 'four_bet'];
    return q ? q[h] + s.heroBet / bb : null;
  };
  const ev0 = actions.map((a) => evOf(e0, a));
  const ev1 = actions.map((a) => evOf(e1, a));
  const delta = actions.map((a, i) => (a === raiseAct ? 0 : (ev1[i] ?? 0) - (ev0[i] ?? 0)));
  const support = mix.map((x) => x > 1e-9);
  let supBest = -Infinity;
  for (let i = 0; i < actions.length; i++)
    if (support[i] && ev0[i] !== null) supBest = Math.max(supBest, ev0[i]!);
  const score = actions.map((a, i) => {
    if (ev0[i] === null || ev1[i] === null) return -Infinity;
    if (support[i]) return delta[i];
    if (a === raiseAct) return -Infinity;
    return delta[i] - Math.max(0, supBest - ev0[i]!);
  });
  let supScore = -Infinity;
  for (let i = 0; i < actions.length; i++) if (support[i]) supScore = Math.max(supScore, score[i]);
  let outside = -1;
  for (let i = 0; i < actions.length; i++)
    if (!support[i] && score[i] > supScore + TILT_BB && (outside < 0 || score[i] > score[outside]))
      outside = i;
  let played: number[];
  if (outside >= 0 || !Number.isFinite(supScore)) {
    const bi = outside >= 0 ? outside : score.indexOf(Math.max(...score));
    played = actions.map((_, i) => (i === bi ? 1 : 0));
  } else {
    played = mix.map((x, i) => (support[i] ? x * Math.exp((score[i] - supScore) / TILT_BB) : 0));
    const ps = played.reduce((x, y) => x + y, 0);
    played = played.map((x) => x / ps);
  }
  const draw = hashSeed('holdemRaiseDefenceAnchored', ...s.seedParts, cls) / 4294967296;
  let acc = 0;
  let pick = actions.length - 1;
  for (let i = 0; i < actions.length; i++) {
    acc += played[i];
    if (draw < acc - 1e-12) {
      pick = i;
      break;
    }
  }
  while (pick > 0 && !(played[pick] > 0)) pick--;
  return {
    action: actions[pick],
    actions,
    mix,
    played,
    draw,
    ev: ev1.map((x) => (x === null ? NaN : x)),
    delta,
    oppWidth: width(range),
    oppWidthNash: nashWidth,
    foldToJam: foldShare(reply, range),
    foldToJamNash: nashFold,
    populationWeight: { fold: fv.wPop, width: wv.wPop },
    ownWeight: { fold: fv.wOwn, width: wv.wOwn },
    committed: e1.committed,
    bubbleFactor: bf,
    solvedGain: mine.gain,
    version: HOLDEM_RAISE_DEFENCE_ANCHORED_VERSION,
  };
}
