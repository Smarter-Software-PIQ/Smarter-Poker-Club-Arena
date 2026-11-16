/**
 * OMAHA STREET PLAN (owner 2026-11-15 11:43; option omahaStreetPlan, default
 * OFF, read `=== true`). First layer.
 *
 * The owner's order, in substance: a Horse must think about the next street
 * before it puts chips in: what it does if the player folds, calls or raises,
 * and what it does on each kind of next card; it must understand ranges, have
 * a plan, and protect and grow its stack.
 *
 * What the engine did before: every street was decided alone from an equity
 * bar. The commitment logic that exists (stack-to-pot shifts, the committed
 * call branch, V88) reads the money already in; none of it asks, before the
 * bet, what the Horse will do on the next card.
 *
 * What this file does (pure functions; no engine random number, no telemetry,
 * no opponent hole card): for a heads-up PLO4/PLO5 TURN decision with nothing
 * to call it prices each candidate line (check, each bet size offered) as
 *
 *   line -> opponent response (fold / call / raise, shares from the range
 *   model and the measured tendencies, a population prior otherwise)
 *        -> every unseen river card, exactly (no sampling of cards)
 *        -> the Horse's planned river action (bet / check-call / check-fold,
 *           or call / fold facing a lead) and its value in chips,
 *
 * and returns the expected chips of each line measured from the moment of
 * the decision, with the plan: what the Horse intends against a raise and on
 * every river card, summarised by card bucket (pairs the board / brings a
 * flush / brings a straight / brick, and good / neutral / bad for the Horse).
 * A river on which the plan folds is worth what bet-then-fold is worth, so a
 * bet that commits the stack without a plan for most rivers prices itself.
 *
 * THREE INTERFACES the sibling layers fill (their designs were not written
 * when this was built; each has a simple fallback here, marked FALLBACK):
 *   - range of the opponent given the line: OmahaPlanRangeModel
 *     (FALLBACK planFallbackKeepShare: the top share of a fixed sample of
 *     hands by turn strength);
 *   - card impact of a next card: omahaPlanCardBucket (FALLBACK: board
 *     texture and the Horse's exact equity change against the range);
 *   - facing-bet verdict for a hypothetical bet: OmahaPlanInput.callVeto
 *     (FALLBACK: call when the exact equity against the betting range beats
 *     the price; HorseLogic passes the big-bet call folds as the veto).
 *
 * Determinism: the opponent hands are a fixed sample drawn by a private
 * generator keyed by the Horse's own cards and the board. The engine's seeded
 * random stream is neither read nor advanced, so the same state gives the
 * same plan on every call, on any street of the hand, on any worker. That is
 * how a plan persists: the next street rebuilds the previous street's state
 * from the public action history and recomputes the same plan.
 *
 * LATER LAYERS (same owner order; each its own default-off option, read
 * `=== true`, below the first layer in this file): the FLOP
 * (omahaStreetPlanFlop: a heads-up flop bet priced as a two-street line with
 * the turn by card class and the turn layer's line model on each class), the
 * TURN THREE-WAY (omahaStreetPlanThreeWay: exactly two opponents, independent
 * ranges, both must fold or the Horse must beat every caller) and the
 * PREFLOP stack-to-pot plan (omahaPreflopStackPlan: a call that creates a
 * low stack-to-pot pot is priced as the stack it commits; call to fold only).
 */
import type { Card } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { SeatPlayer } from '../types.js';
import { omahaBoardShape, omahaPreflopPercentile, scoreOmahaHi, variantInfo } from './HorseEval.js';
import { omahaCardImpactAmounts } from './HorseOmahaCardImpact.js';
import { omahaReraisedEquity, preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import {
  IP_REALIZATION_MARGIN,
  OOP_PRIOR_BAND_FOUR_BET,
  OOP_PRIOR_BAND_THREE_BET,
  OOP_REALIZATION_MARGIN,
  omahaOopCoordinated,
  omahaPostflopOrder,
} from './HorseOmahaOopReraisedPot.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { omahaHandRiverScore, omahaTurnRiverTables } from './HorseOmahaRiverTables.js';
import { omahaCashOnlyExcludes } from './HorseOmahaTournamentScope.js';
import {
  omahaStrategyGameInScope,
  omahaStrategyConstant,
  omahaStrategyHoleCount,
  omahaStrategyHoleCountServed,
} from './HorseOmahaStrategyGame.js';

export const OMAHA_STREET_PLAN_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** A line that puts at least this share of the hand's starting stack in is a commitment. */
export const OMAHA_STREET_PLAN_COMMIT_SHARE = 0.5;
/** A commitment needs a plan that continues (bets or calls) on at least this share of next cards. */
export const OMAHA_STREET_PLAN_CONTINUE_SHARE = 0.65;
/** A line replaces the engine's only when it is worth this share of the pot more. */
export const OMAHA_STREET_PLAN_MARGIN_POT_SHARE = 0.02;
/** Opponent hands in the fixed sample before the range filter. */
export const OMAHA_STREET_PLAN_SAMPLE = 160;

/** Population priors (FALLBACK until the shared range model supplies shares). */
export const OMAHA_STREET_PLAN_PRIOR = {
  /** share of the price-implied folds (bet / (pot + bet)) the population really folds */
  foldOfAlpha: 0.8,
  /** share of his range that raises a turn bet */
  turnRaise: 0.08,
  /** share of his range that bets the turn when checked to, and bluffs per value bet */
  turnBet: 0.35,
  turnBluffPerValue: 0.4,
  /** share of his range that bets the river when checked to / leads it, and bluffs per value bet */
  riverBet: 0.3,
  riverLead: 0.15,
  riverBluffPerValue: 0.33,
  /** bet size the plan assumes, as a share of the pot (all in when little is left) */
  betOfPot: 0.75,
  shoveWhenLeftUnderPot: 0.25,
} as const;

export type OmahaPlanOppLine = 'aggressor' | 'called_raise' | 'called_bet' | 'checked';

/** Multipliers on the priors from MEASURED tendencies; 1 is the population. */
export interface OmahaPlanTendency {
  foldToBet: number;
  aggression: number;
  riverCall: number;
  /** measured value-heavy bettor: half the bluffs */
  valueLeader: boolean;
}

/** The shared range model's seam: the share of all hands the opponent still holds after his line. */
export interface OmahaPlanRangeModel {
  keepShare(line: OmahaPlanOppLine): number;
}
/** FALLBACK range model. */
export const planFallbackKeepShare: OmahaPlanRangeModel = {
  keepShare: (line) =>
    line === 'aggressor' || line === 'called_raise' ? 0.35 : line === 'called_bet' ? 0.55 : 0.8,
};

export interface OmahaPlanInput {
  hole: Card[];
  /** four cards: the turn */
  board: Card[];
  dead?: Card[];
  pot: number;
  heroStack: number;
  oppStack: number;
  /** chips the Horse has put in this hand before the decision */
  heroInvested: number;
  heroInPosition: boolean;
  /** candidate bet amounts in chips; the check is always priced */
  bets: number[];
  oppLine: OmahaPlanOppLine;
  tendency?: OmahaPlanTendency | null;
  range?: OmahaPlanRangeModel;
  /** facing-bet verdict seam: true when the Horse's own rules fold this river to a bet of `bet` into `pot` (pot before the bet) */
  callVeto?: (river: Card, pot: number, bet: number, turnBet: number) => boolean;
  samples?: number;
}

export type OmahaPlanTexture = 'pairs_board' | 'flush' | 'straight' | 'brick';
export type OmahaPlanImpact = 'good' | 'neutral' | 'bad';

export interface OmahaPlanBucket {
  texture: OmahaPlanTexture;
  /** exact count of unseen cards in the bucket, and its probability */
  cards: number;
  share: number;
  /** what the Horse does first to act or checked to: majority, and the share of the bucket's cards that bet */
  first: 'bet' | 'check';
  betShare: number;
  /** what it does facing a bet: majority, and the share of the bucket's cards that call */
  facingBet: 'call' | 'fold';
  callShare: number;
  impact: Record<OmahaPlanImpact, number>;
}

export interface OmahaPlanLine {
  kind: 'check' | 'bet';
  amount: number;
  /** expected chips from the decision on (a fold now is 0) */
  ev: number;
  /** share of the hand's starting stack in after this line's wager */
  commitShare: number;
  /** share of next cards on which the plan bets or calls a bet */
  continueShare: number;
  /** opponent response shares */
  oppFold: number;
  oppCall: number;
  oppRaise: number;
  /** the Horse's answer to a raise (bet lines) or to a bet after its check */
  vsAggression: 'call' | 'fold' | 'none';
  /** equity against the range that continues, with one card to come */
  equityVsContinuing: number;
  buckets: OmahaPlanBucket[];
  /** per unseen card: bit 0 bets when first / checked to, bit 1 calls a bet */
  cardPlan: number[];
  /** the bet the plan expects to face on each card (0: none) */
  cardBet: number[];
}

export interface OmahaStreetPlan {
  version: 1;
  street: 'turn';
  lines: OmahaPlanLine[];
  /** index into lines of the best expected value */
  best: number;
  cards: Card[];
  sampled: number;
  kept: number;
}

const key = (c: Card): string => `${c.rank}${c.suit[0]}`;

/** Every card the Horse cannot see. */
export function omahaPlanUnseen(hole: Card[], board: Card[], dead: Card[] = []): Card[] {
  const removed = new Set([...hole, ...board, ...dead].map(key));
  const out: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) out.push(card);
    }
  return out;
}

/** Private generator: FNV-1a of the Horse's cards and the board, then xorshift32. */
function planGenerator(hole: Card[], board: Card[]): () => number {
  let h = 0x811c9dc5;
  const text = [...hole.map(key).sort(), '|', ...board.map(key)].join('');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let s = h || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Card-impact seam (FALLBACK): the texture a next card brings to the board. */
export function omahaPlanCardBucket(board: Card[], card: Card): OmahaPlanTexture {
  if (board.some((c) => c.rank === card.rank)) return 'pairs_board';
  const before = omahaBoardShape(board);
  const after = omahaBoardShape([...board, card]);
  const suited = board.filter((c) => c.suit === card.suit).length;
  if (suited === 2 || (!before.flushPossible && after.flushPossible)) return 'flush';
  if (!before.straightPossible && after.straightPossible) return 'straight';
  // a fourth card to a straight the board already allowed is a straight card too
  const ranks = (cs: Card[]) => new Set(cs.map((c) => c.rank)).size;
  if (
    after.straightPossible &&
    ranks([...board, card]) > ranks(board) &&
    straightWindows(board, card)
  )
    return 'straight';
  return 'brick';
}
const RV: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};
/** the card adds a new three-rank straight window to the board */
function straightWindows(board: Card[], card: Card): boolean {
  const count = (cs: Card[]): number => {
    const set = new Set<number>();
    for (const c of cs) {
      set.add(RV[c.rank]);
      if (c.rank === 'A') set.add(1);
    }
    let n = 0;
    for (let lo = 1; lo <= 10; lo++) {
      let hit = 0;
      for (let r = lo; r < lo + 5; r++) if (set.has(r)) hit++;
      if (hit >= 3) n++;
    }
    return n;
  };
  return count([...board, card]) > count(board);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The plan. Null when the input is outside the first layer (not a four-card
 * board, no chips behind, no pot).
 */
export function omahaStreetPlan(input: OmahaPlanInput): OmahaStreetPlan | null {
  const { hole, board } = input;
  if (board.length !== 4 || !omahaStrategyHoleCountServed(hole.length)) return null;
  const pot = input.pot;
  const eff = Math.min(input.heroStack, input.oppStack);
  if (!(pot > 0) || !(eff > 0)) return null;
  const P = OMAHA_STREET_PLAN_PRIOR;
  const t = input.tendency ?? null;
  const foldMul = t ? t.foldToBet : 1;
  const aggr = t ? t.aggression : 1;
  const callMul = t ? t.riverCall : 1;
  const bluffMul = (t?.valueLeader ? 0.5 : 1) * aggr;

  const unseen = omahaPlanUnseen(hole, board, input.dead);
  const R = unseen.length;
  const M = Math.max(40, Math.min(400, Math.floor(input.samples ?? OMAHA_STREET_PLAN_SAMPLE)));
  const rnd = planGenerator(hole, board);
  const H = hole.length;

  // The fixed sample of opponent hands, as indices into `unseen`.
  const hands: number[][] = [];
  const idx = unseen.map((_, i) => i);
  for (let m = 0; m < M; m++) {
    for (let k = 0; k < H; k++) {
      const j = k + Math.floor(rnd() * (R - k));
      const tmp = idx[k];
      idx[k] = idx[j];
      idx[j] = tmp;
    }
    hands.push(idx.slice(0, H));
  }

  // Exact showdown rank of every sampled hand and of the Horse on every river.
  const ranks = new Float64Array(M * R).fill(-1);
  const heroRank = new Float64Array(R);
  const full: Card[] = [...board, board[0]];
  for (let r = 0; r < R; r++) {
    full[4] = unseen[r];
    heroRank[r] = scoreOmahaHi(hole, full);
  }
  // The decision's shared exact count (HorseOmahaRiverTables): each sampled
  // hand's river score is its best pair there, the value scoreOmahaHi gives.
  const tables = omahaTurnRiverTables(hole, board, input.dead ?? []);
  const shared = tables !== null && tables.n === R ? tables : null;
  for (let m = 0; m < M; m++) {
    const cards = hands[m].map((i) => unseen[i]);
    const own = hands[m];
    for (let r = 0; r < R; r++) {
      if (own.includes(r)) continue;
      full[4] = unseen[r];
      ranks[m * R + r] =
        shared !== null ? omahaHandRiverScore(shared, own, r) : scoreOmahaHi(cards, full);
    }
  }
  // Per river: the sampled hands that can hold it, best first.
  const order: Int32Array[] = [];
  const strength = new Float64Array(M);
  const seenRivers = new Int32Array(M);
  for (let r = 0; r < R; r++) {
    const live: number[] = [];
    for (let m = 0; m < M; m++) if (ranks[m * R + r] >= 0) live.push(m);
    live.sort((a, b) => ranks[b * R + r] - ranks[a * R + r] || a - b);
    order.push(Int32Array.from(live));
    const n = live.length;
    for (let k = 0; k < n; ) {
      let e = k;
      while (e < n && ranks[live[e] * R + r] === ranks[live[k] * R + r]) e++;
      const pct = 1 - (k + e) / 2 / n;
      for (let q = k; q < e; q++) {
        strength[live[q]] += pct;
        seenRivers[live[q]]++;
      }
      k = e;
    }
  }
  for (let m = 0; m < M; m++) strength[m] = seenRivers[m] > 0 ? strength[m] / seenRivers[m] : 0;

  // RANGE GIVEN THE LINE: the top share by turn strength (mean river percentile).
  const keepShare = clamp((input.range ?? planFallbackKeepShare).keepShare(input.oppLine), 0.05, 1);
  const byStrength = Array.from({ length: M }, (_, m) => m).sort(
    (a, b) => strength[b] - strength[a] || a - b
  );
  const kept = byStrength.slice(0, Math.max(8, Math.round(M * keepShare)));
  const N = kept.length;
  const mask = (members: number[]): Uint8Array => {
    const s = new Uint8Array(M);
    for (const m of members) s[m] = 1;
    return s;
  };

  /** the Horse's equity with one card to come against a set of hands */
  const turnEquity = (members: number[]): number => {
    let w = 0;
    let n = 0;
    for (const m of members)
      for (let r = 0; r < R; r++) {
        const v = ranks[m * R + r];
        if (v < 0) continue;
        n++;
        w += heroRank[r] > v ? 1 : heroRank[r] === v ? 0.5 : 0;
      }
    return n > 0 ? w / n : 0.5;
  };

  const sizeOf = (p: number, left: number): number => {
    if (!(left > 0)) return 0;
    const b = Math.min(left, P.betOfPot * p);
    return left - b < P.shoveWhenLeftUnderPot * p ? left : b;
  };
  const callShare = (bet: number, p: number): number =>
    clamp((1 - P.foldOfAlpha * foldMul * (bet / (p + bet))) * callMul, 0.1, 0.95);

  const list = new Float64Array(M);
  interface RiverOut {
    ev: number;
    plan: number[];
    bets: number[];
    eq: number[];
  }
  /** The river, exactly, on every unseen card: pot `p`, `left` behind, against `sel`. */
  const riverValue = (p: number, left: number, sel: Uint8Array, turnBet: number): RiverOut => {
    const out: RiverOut = { ev: 0, plan: [], bets: [], eq: [] };
    const ip = input.heroInPosition;
    for (let r = 0; r < R; r++) {
      const hr = heroRank[r];
      let n = 0;
      for (const m of order[r]) if (sel[m]) list[n++] = ranks[m * R + r];
      const win = (a: number, b: number): number => {
        let w = 0;
        for (let k = a; k < b; k++) w += hr > list[k] ? 1 : hr === list[k] ? 0.5 : 0;
        return w;
      };
      if (n === 0) {
        out.ev += p / 2;
        out.plan.push(0);
        out.bets.push(0);
        out.eq.push(0.5);
        continue;
      }
      const all = win(0, n);
      out.eq.push(all / n);
      const b = sizeOf(p, left);
      if (!(b > 0)) {
        out.ev += (all / n) * p;
        out.plan.push(0);
        out.bets.push(0);
        continue;
      }
      // He bets (after the Horse's check, or as a lead): value from the top, bluffs from the bottom.
      const nV = Math.min(n, Math.round(n * clamp((ip ? P.riverLead : P.riverBet) * aggr, 0, 0.9)));
      const nB = Math.min(n - nV, Math.round(nV * P.riverBluffPerValue * bluffMul));
      const betN = nV + nB;
      let facing = 0;
      let calls = 0;
      if (betN > 0) {
        const eqBet = (win(0, nV) + win(n - nB, n)) / betN;
        const callEv = eqBet * (p + 2 * b) - b;
        if (callEv > 0 && !(input.callVeto?.(unseen[r], p, b, turnBet) ?? false)) {
          facing = callEv;
          calls = 2;
        }
      }
      const restN = n - betN;
      const showdown = (win(nV, n - nB) / n) * p;
      // The Horse bets: out of position into his whole range, in position into the hands that checked.
      const a0 = ip ? nV : 0;
      const pool = ip ? restN : n;
      const nC = Math.min(pool, Math.round(pool * callShare(b, p)));
      const betEv = ((pool - nC) / n) * p + (win(a0, a0 + nC) / n) * (p + 2 * b) - (nC / n) * b;
      let ev: number;
      let first = 0;
      if (ip) {
        const rest = Math.max(showdown, betEv);
        first = betEv > showdown ? 1 : 0;
        ev = (betN / n) * facing + rest;
      } else {
        const checkEv = (betN / n) * facing + showdown;
        first = betEv > checkEv ? 1 : 0;
        ev = Math.max(checkEv, betEv);
      }
      out.ev += ev;
      out.plan.push(first | calls);
      out.bets.push(betN > 0 ? b : 0);
    }
    out.ev /= R;
    return out;
  };

  const invested = Math.max(0, input.heroInvested);
  const started = invested + input.heroStack;
  const baseEq = turnEquity(kept);

  const summarise = (
    kind: 'check' | 'bet',
    amount: number,
    ev: number,
    river: RiverOut,
    eqBefore: number,
    shares: { fold: number; call: number; raise: number },
    vsAggression: 'call' | 'fold' | 'none'
  ): OmahaPlanLine => {
    const groups = new Map<OmahaPlanTexture, OmahaPlanBucket>();
    let cont = 0;
    for (let r = 0; r < R; r++) {
      const texture = omahaPlanCardBucket(board, unseen[r]);
      let g = groups.get(texture);
      if (!g) {
        g = {
          texture,
          cards: 0,
          share: 0,
          first: 'check',
          betShare: 0,
          facingBet: 'fold',
          callShare: 0,
          impact: { good: 0, neutral: 0, bad: 0 },
        };
        groups.set(texture, g);
      }
      g.cards++;
      const code = river.plan[r];
      if (code & 1) g.betShare++;
      if (code & 2) g.callShare++;
      if (code !== 0) cont++;
      const d = river.eq[r] - eqBefore;
      g.impact[d > 0.1 ? 'good' : d < -0.1 ? 'bad' : 'neutral']++;
    }
    const buckets = (['pairs_board', 'flush', 'straight', 'brick'] as const)
      .map((tx) => groups.get(tx))
      .filter((g): g is OmahaPlanBucket => !!g)
      .map((g) => ({
        ...g,
        share: g.cards / R,
        betShare: g.betShare / g.cards,
        callShare: g.callShare / g.cards,
        first: (g.betShare / g.cards > 0.5 ? 'bet' : 'check') as 'bet' | 'check',
        facingBet: (g.callShare / g.cards >= 0.5 ? 'call' : 'fold') as 'call' | 'fold',
      }));
    return {
      kind,
      amount,
      ev,
      commitShare: started > 0 ? (invested + amount) / started : 0,
      continueShare: cont / R,
      oppFold: shares.fold,
      oppCall: shares.call,
      oppRaise: shares.raise,
      vsAggression,
      equityVsContinuing: eqBefore,
      buckets,
      cardPlan: river.plan,
      cardBet: river.bets,
    };
  };

  const lines: OmahaPlanLine[] = [];

  // CHECK.
  if (input.heroInPosition) {
    const river = riverValue(pot, eff, mask(kept), 0);
    lines.push(
      summarise('check', 0, river.ev, river, baseEq, { fold: 0, call: 1, raise: 0 }, 'none')
    );
  } else {
    const b = sizeOf(pot, eff);
    const nV = Math.min(N, Math.round(N * clamp(P.turnBet * aggr, 0, 0.9)));
    const nB = Math.min(N - nV, Math.round(nV * P.turnBluffPerValue * bluffMul));
    const bettors = [...kept.slice(0, nV), ...kept.slice(N - nB)];
    const checkers = kept.slice(nV, N - nB);
    const through = riverValue(pot, eff, mask(checkers), 0);
    let facing = 0;
    let vs: 'call' | 'fold' | 'none' = 'none';
    if (bettors.length > 0 && b > 0) {
      const called = -b + riverValue(pot + 2 * b, eff - b, mask(bettors), 0).ev;
      vs = called > 0 ? 'call' : 'fold';
      facing = Math.max(0, called);
    }
    const ev = (bettors.length / N) * facing + (checkers.length / N) * through.ev;
    lines.push(
      summarise(
        'check',
        0,
        ev,
        through,
        turnEquity(checkers),
        { fold: 0, call: checkers.length / N, raise: bettors.length / N },
        vs
      )
    );
  }

  // EACH BET.
  for (const raw of input.bets) {
    const bet = Math.min(raw, eff);
    if (!(bet > 0)) continue;
    const left = eff - bet;
    const extra = Math.min(left, pot + 2 * bet);
    const nR = extra > 0 ? Math.min(N, Math.round(N * clamp(P.turnRaise * aggr, 0, 0.5))) : 0;
    const nF = Math.min(
      N - nR,
      Math.round(N * clamp(P.foldOfAlpha * foldMul * (bet / (pot + bet)), 0, 0.9))
    );
    const raisers = kept.slice(0, nR);
    const callers = kept.slice(nR, N - nF);
    let raiseEv = -bet;
    let vs: 'call' | 'fold' | 'none' = 'none';
    if (nR > 0) {
      const callEv = turnEquity(raisers) * (pot + 2 * bet + 2 * extra) - extra;
      vs = callEv > 0 ? 'call' : 'fold';
      raiseEv += Math.max(0, callEv);
    }
    const river = riverValue(pot + 2 * bet, left, mask(callers), bet);
    const ev = (nF / N) * pot + (nR / N) * raiseEv + (callers.length / N) * (-bet + river.ev);
    lines.push(
      summarise(
        'bet',
        bet,
        ev,
        river,
        turnEquity(callers),
        { fold: nF / N, call: callers.length / N, raise: nR / N },
        vs
      )
    );
  }

  let best = 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].ev > lines[best].ev) best = i;
  return { version: 1, street: 'turn', lines, best, cards: unseen, sampled: M, kept: N };
}

/** A commitment with no plan: the stack share is in and too few next cards continue. */
export function omahaPlanLineUncommitted(line: OmahaPlanLine): boolean {
  return (
    line.kind === 'bet' &&
    line.commitShare >= OMAHA_STREET_PLAN_COMMIT_SHARE &&
    line.continueShare < OMAHA_STREET_PLAN_CONTINUE_SHARE
  );
}

/** The bounded diagnostic record of a plan (no card of any player, no opponent identity). */
export interface OmahaStreetPlanRecord {
  /** omahaBetSizeByPublicState: the public size the plan priced (absent when it priced the engine's bet). */
  publicSize?: number;
  version: 1;
  street: 'turn';
  chosen: 'check' | 'bet';
  amount: number;
  ev: { check: number; bet: number };
  commitShare: number;
  continueShare: number;
  vsAggression: 'call' | 'fold' | 'none';
  /** the measured tendency multipliers the plan used (fold to bet, aggression, river call, value leader 0/1); null: the population prior */
  tendency: [number, number, number, 0 | 1] | null;
  buckets: {
    texture: OmahaPlanTexture;
    share: number;
    first: 'bet' | 'check';
    facingBet: 'call' | 'fold';
  }[];
}
const r2 = (v: number): number => Math.round(v * 100) / 100;
export function omahaStreetPlanRecord(
  plan: OmahaStreetPlan,
  chosen: OmahaPlanLine,
  bet: OmahaPlanLine,
  tendency: OmahaPlanTendency | null = null
): OmahaStreetPlanRecord {
  return {
    version: 1,
    street: 'turn',
    chosen: chosen.kind,
    amount: r2(chosen.amount),
    ev: { check: r2(plan.lines[0].ev), bet: r2(bet.ev) },
    commitShare: r2(chosen.commitShare),
    continueShare: r2(chosen.continueShare),
    vsAggression: chosen.vsAggression,
    tendency: tendency
      ? [tendency.foldToBet, tendency.aggression, tendency.riverCall, tendency.valueLeader ? 1 : 0]
      : null,
    buckets: chosen.buckets.map((b) => ({
      texture: b.texture,
      share: r2(b.share),
      first: b.first,
      facingBet: b.facingBet,
    })),
  };
}

const live = (hero: SeatPlayer, gs: HorseGameStateV2): SeatPlayer[] =>
  (gs.players ?? []).filter((p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out);

/** The public domain of the first layer: PLO4/PLO5 cash, pot limit, one board, high only, heads-up. */
export function omahaStreetPlanDomain(hero: SeatPlayer, gs: HorseGameStateV2): SeatPlayer | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!omahaStrategyGameInScope(OMAHA_STREET_PLAN_VARIANTS, gs)) return null;
    // Cash only; omahaStrategyInTournaments opens its public tournament scope.
    if (
      gs.gameMode !== undefined &&
      gs.gameMode !== 'cash' &&
      !(gs.gameMode === 'tournament' && !omahaCashOnlyExcludes(hero, gs))
    )
      return null;
    if (gs.bettingStructure !== undefined && gs.bettingStructure !== 'pot_limit') return null;
    if ((gs.boardCount ?? 1) !== 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.bombPot === true) return null;
    const hiLo = gs.variantRules ? gs.variantRules.splitLow8OrBetter : variantInfo(variant).isHiLo;
    if (hiLo) return null;
    const opp = live(hero, gs);
    if (opp.length !== 1 || opp[0].is_all_in || !(opp[0].stack > 0)) return null;
    if (!Array.isArray(hero.cards) || hero.cards.length !== omahaStrategyHoleCount(gs)) return null;
    return opp[0];
  } catch {
    return null;
  }
}

/** The turn spot where a bet may become a check under the plan (what the receipt validator admits). */
export function omahaStreetPlanTurnSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (String(gs.stage ?? '') !== 'turn' || (gs.communityCards ?? []).length !== 4) return false;
    if (Number(gs.toCall ?? 0) > 0 || Number(gs.currentBet ?? 0) > (hero.bet ?? 0)) return false;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return false;
    return omahaStreetPlanDomain(hero, gs) !== null;
  } catch {
    return false;
  }
}

/** A tendency multiplier as the plan uses and records it: three decimals inside 0.5 to 1.5. */
export const omahaPlanMultiplier = (v: number): number =>
  Math.round(clamp(Number.isFinite(v) ? v : 1, 0.5, 1.5) * 1000) / 1000;

/**
 * The bet a recorded plan priced: the public size it names
 * (omahaBetSizeByPublicState: the public size is the one size bet, so the plan
 * priced it, the flop layer alone), else the request's bet. A recorded size
 * must be a legal-looking own bet: finite, positive, at most the seat's chips.
 */
function omahaRecordedPricedBet(
  hero: SeatPlayer,
  bet: number | undefined,
  record: unknown
): { bet: number | undefined; onlyThisSize: boolean } {
  const p = (record as { publicSize?: unknown } | null | undefined)?.publicSize;
  if (p === undefined) return { bet, onlyThisSize: false };
  if (typeof p !== 'number' || !Number.isFinite(p) || !(p > 0) || p > hero.stack + 0.005)
    return { bet: undefined, onlyThisSize: false };
  return { bet: p, onlyThisSize: true };
}

/**
 * What the worker receipt validator re-runs: a turn bet of `bet` became a
 * check under the plan recorded on the decision. The request carries no
 * opponent read, so the recorded multipliers are used (they must be the
 * plan's own: three decimals inside 0.5 to 1.5), and the facing-bet veto is
 * unknown, so it is taken at its strongest (every river vetoed), which only
 * lowers the bet line: every check the engine makes is admitted, and a check
 * the plan cannot produce on this request is refused.
 */
export function omahaStreetPlanAdmitsCheck(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  bet: number | undefined,
  record: unknown
): boolean {
  try {
    if (!omahaStreetPlanTurnSpot(hero, gs)) return false;
    const opp = omahaStreetPlanDomain(hero, gs);
    bet = omahaRecordedPricedBet(hero, bet, record).bet;
    if (!opp || !Number.isFinite(bet) || !((bet as number) > 0)) return false;
    const rec = record as Partial<OmahaStreetPlanRecord> | null | undefined;
    if (!rec || rec.version !== 1 || rec.chosen !== 'check') return false;
    let tendency: OmahaPlanTendency | null = null;
    if (rec.tendency != null) {
      const t = rec.tendency;
      if (!Array.isArray(t) || t.length !== 4 || (t[3] !== 0 && t[3] !== 1)) return false;
      for (let i = 0; i < 3; i++)
        if (typeof t[i] !== 'number' || omahaPlanMultiplier(t[i]) !== t[i]) return false;
      tendency = { foldToBet: t[0], aggression: t[1], riverCall: t[2], valueLeader: t[3] === 1 };
    }
    const plan = omahaStreetPlan({
      hole: hero.cards,
      board: gs.communityCards ?? [],
      dead: hero.knownDeadCards ?? [],
      pot: gs.pot,
      heroStack: hero.stack,
      oppStack: opp.stack,
      heroInvested: Number.isFinite(hero.totalInvested) ? (hero.totalInvested ?? 0) : 0,
      heroInPosition: omahaPlanHeroInPosition(opp, gs, 'turn'),
      bets: [bet as number],
      oppLine: omahaPlanOppLine(hero, opp, gs, 'flop'),
      tendency,
      callVeto: () => true,
    });
    if (!plan || !plan.lines[1]) return false;
    return (
      plan.lines[0].ev >
      plan.lines[1].ev + omahaStrategyConstant('streetPlanMarginPotShare', gs) * gs.pot
    );
  } catch {
    return false;
  }
}

/**
 * What the Horse owes. The league's game state carries no toCall field, so it
 * is derived from the current bet when absent (the sibling facing-bet layer
 * found the same gap).
 */
export function omahaPlanToCall(hero: SeatPlayer, gs: HorseGameStateV2): number {
  const stated = Number(gs.toCall);
  if (gs.toCall != null && Number.isFinite(stated)) return Math.max(0, stated);
  const owed = Number(gs.currentBet ?? 0) - Number(hero.bet ?? 0);
  return Number.isFinite(owed) ? Math.max(0, owed) : 0;
}

interface Act {
  stage?: string;
  seat?: number;
  action?: string;
  amount?: number;
}
const acts = (gs: HorseGameStateV2, stage: string): Act[] =>
  ((gs.actionHistory ?? []) as Act[]).filter((a) => String(a.stage) === stage);
const AGGR = new Set(['bet', 'raise', 'all_in']);

/** The opponent's line on a street, read from the public actions. */
export function omahaPlanOppLine(
  hero: SeatPlayer,
  opp: SeatPlayer,
  gs: HorseGameStateV2,
  stage: string
): OmahaPlanOppLine {
  const list = acts(gs, stage);
  let lastAggr: Act | null = null;
  let heroAggr = 0;
  for (const a of list)
    if (AGGR.has(String(a.action))) {
      lastAggr = a;
      if (a.seat === hero.seat) heroAggr++;
    }
  if (!lastAggr) return 'checked';
  if (lastAggr.seat === opp.seat) return 'aggressor';
  const first = list.find((a) => AGGR.has(String(a.action)));
  return heroAggr >= 2 || (first && first.seat === opp.seat) ? 'called_raise' : 'called_bet';
}

/** True when the opponent has already acted on this street (the Horse closes the action). */
export function omahaPlanHeroInPosition(
  opp: SeatPlayer,
  gs: HorseGameStateV2,
  stage: string
): boolean {
  return acts(gs, stage).some((a) => a.seat === opp.seat);
}

/**
 * THE PLAN PERSISTS BY RECOMPUTATION. On the river, facing a bet after the
 * Horse's own turn bet was called, this rebuilds the turn decision from the
 * public action history (pot, stacks, position, the opponent's flop line) so
 * the caller can recompute the plan the turn bet was made under. `turn` is
 * the turn decision node itself as the Horse saw it (its own seat, the
 * opponent's and the game state before the bet), which the caller needs to
 * rebuild the plan's facing-bet seam (callVeto) exactly as the turn built it.
 * Null when the hand did not go: Horse bets the turn, opponent calls, Horse
 * has put nothing in on the river, opponent bets.
 */
export function omahaPlanTurnStateFromRiver(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): {
  opp: SeatPlayer;
  input: Omit<OmahaPlanInput, 'tendency' | 'callVeto'>;
  river: Card;
  faced: number;
  turn: { hero: SeatPlayer; opp: SeatPlayer; gs: HorseGameStateV2 };
} | null {
  try {
    const board = gs.communityCards ?? [];
    if (String(gs.stage ?? '') !== 'river' || board.length !== 5) return null;
    const opp = omahaStreetPlanDomainRiver(hero, gs);
    if (!opp) return null;
    // an all-in for more than the Horse has is faced for the Horse's stack
    const faced = Math.min(omahaPlanToCall(hero, gs), hero.stack);
    if (!(faced > 0) || (hero.bet ?? 0) > 0) return null;
    if (acts(gs, 'river').some((a) => a.seat === hero.seat && AGGR.has(String(a.action))))
      return null;
    const turn = acts(gs, 'turn').filter((a) => a.action !== 'check');
    if (turn.length !== 2) return null;
    const [mine, his] = turn;
    if (mine.seat !== hero.seat || mine.action !== 'bet' || !(Number(mine.amount) > 0)) return null;
    if (his.seat !== opp.seat || his.action !== 'call') return null;
    const bet = Number(mine.amount);
    const oppIn = Math.max(0, Number(opp.bet ?? 0));
    // chips are rebuilt to the cent so the recomputed plan is the turn's plan bit for bit
    const cent = (v: number): number => Math.round(v * 100) / 100;
    const pot = cent(Number(gs.pot) - oppIn - 2 * bet);
    if (!(pot > 0)) return null;
    const turnGs = {
      ...gs,
      actionHistory: (gs.actionHistory ?? []).filter((a) => String((a as Act).stage) !== 'river'),
    } as HorseGameStateV2;
    // The turn node before the bet: chips back in the stacks, the bet and the
    // call taken out of the history, four board cards, nothing to call.
    const heroAtTurn: SeatPlayer = {
      ...hero,
      stack: cent(hero.stack + bet),
      bet: 0,
      totalInvested: cent(Math.max(0, Number(hero.totalInvested ?? 0) - bet)),
    };
    const oppAtTurn: SeatPlayer = {
      ...opp,
      stack: cent(opp.stack + oppIn + bet),
      bet: 0,
      totalInvested: cent(Math.max(0, Number(opp.totalInvested ?? 0) - oppIn - bet)),
      is_all_in: false,
    };
    const gsAtTurn = {
      ...gs,
      stage: 'turn',
      communityCards: board.slice(0, 4),
      pot,
      currentBet: 0,
      toCall: 0,
      players: (gs.players ?? []).map((p) =>
        p.seat === hero.seat ? heroAtTurn : p.seat === opp.seat ? oppAtTurn : p
      ),
      actionHistory: (turnGs.actionHistory ?? []).filter((a) => a !== mine && a !== his),
    } as unknown as HorseGameStateV2;
    return {
      opp,
      river: board[4],
      faced,
      turn: { hero: heroAtTurn, opp: oppAtTurn, gs: gsAtTurn },
      input: {
        hole: hero.cards,
        board: board.slice(0, 4),
        dead: hero.knownDeadCards ?? [],
        pot,
        heroStack: cent(hero.stack + bet),
        oppStack: cent(opp.stack + oppIn + bet),
        heroInvested: cent(Math.max(0, Number(hero.totalInvested ?? 0) - bet)),
        heroInPosition:
          acts(turnGs, 'turn').findIndex((a) => a.seat === opp.seat) <
          acts(turnGs, 'turn').findIndex((a) => a.seat === hero.seat),
        bets: [bet],
        oppLine: omahaPlanOppLine(hero, opp, turnGs, 'flop'),
      },
    };
  } catch {
    return null;
  }
}
/** the domain on the river, where the bettor may be all in */
function omahaStreetPlanDomainRiver(hero: SeatPlayer, gs: HorseGameStateV2): SeatPlayer | null {
  const opp = live(hero, gs);
  if (opp.length !== 1) return null;
  const relaxed = {
    ...gs,
    players: (gs.players ?? []).map((p) =>
      p.seat === opp[0].seat ? { ...p, is_all_in: false, stack: Math.max(p.stack, 0.01) } : p
    ),
  } as HorseGameStateV2;
  return omahaStreetPlanDomain(hero, relaxed) ? opp[0] : null;
}

/** What the recomputed turn plan says about the river card that came, facing the bet that came. */
export function omahaPlanRiverVerdict(
  plan: OmahaStreetPlan,
  river: Card,
  faced: number
): 'call' | 'fold' | 'unplanned' {
  const line = plan.lines.find((l) => l.kind === 'bet');
  if (!line) return 'unplanned';
  const i = plan.cards.findIndex((c) => c.rank === river.rank && c.suit === river.suit);
  if (i < 0) return 'unplanned';
  // New information: a bet larger than the one the plan priced is not the planned spot.
  if (!(line.cardBet[i] > 0) || faced > line.cardBet[i] * 1.1 + 0.01) return 'unplanned';
  return line.cardPlan[i] & 2 ? 'call' : 'fold';
}

// ═══════════════════════════════════════════════════════════════════════════
// SECOND LAYER: THE FLOP (owner 2026-11-15 11:43; option omahaStreetPlanFlop,
// default OFF, read `=== true`).
//
// A heads-up PLO4/PLO5 FLOP bet with nothing to call is priced against the
// check as a two-street line:
//
//   line -> opponent response (fold / call / raise: the same population
//   priors and measured tendency multipliers as the turn layer)
//        -> the turn card, by CLASS: every unseen card is put in its texture
//           class (omahaPlanCardBucket: pairs the board / brings a flush /
//           brings a straight / brick) and each class is represented by
//           OMAHA_FLOP_PLAN_TURN_CARDS cards in all, spread over the class
//           and weighted by the class's exact share of unseen cards; each
//           representative is classed good / neutral / bad for the Horse by
//           its equity change against the range that continues (the turn
//           layer's own rule, ±0.1)
//        -> the planned TURN action on that card (the turn layer's line
//           model: check, or bet the plan's size, against the opponent's
//           fold / call / raise and his bet after a check), with the river
//           on OMAHA_FLOP_PLAN_RIVER_CARDS sampled river cards per turn card
//           priced by the turn layer's river model (value bets from the top,
//           bluffs from the bottom, the Horse's call against his bet).
//
// The opponent's range is his PREFLOP line: a fixed pool of hands, the top
// OMAHA_FLOP_PLAN_PREFLOP_KEEP share by preflop percentile kept, the first
// OMAHA_FLOP_PLAN_SAMPLE of those used; within it his flop response is by
// flop strength (mean showdown percentile over the sampled runouts).
//
// The verdict (omahaFlopPlanChoice): a bet line that COMMITS (stack-to-pot
// after the call at or under OMAHA_FLOP_PLAN_COMMIT_SPR) with a hand that
// folds to the raise the model expects, or that continues on fewer than
// OMAHA_STREET_PLAN_CONTINUE_SHARE of turn cards, is not made. Of the rest,
// the bet stands only when its line is worth more than the check line by
// OMAHA_FLOP_PLAN_MARGIN_POT_SHARE of the pot; a smaller size of the
// engine's own menu (omahaCardImpactAmounts' sizes) replaces the engine's
// size only when it is worth more by the same margin. Otherwise the check.
// It never makes a bet larger and never creates a raise.
//
// Deterministic (the private generator, keyed by the cards and the board);
// the engine's random stream is neither read nor advanced. Bounded: about
// (SAMPLE + 1) x TURN_CARDS x RIVER_CARDS exact hand ranks per decision.
// ═══════════════════════════════════════════════════════════════════════════

/** Opponent hands in the range sample of the flop layer. */
export const OMAHA_FLOP_PLAN_SAMPLE = 40;
/** The pool the preflop range is cut from, as a multiple of the sample. */
export const OMAHA_FLOP_PLAN_POOL = 4;
/** Turn cards that represent the turn classes, in all. */
export const OMAHA_FLOP_PLAN_TURN_CARDS = 8;
/** River cards sampled under each representative turn card. */
export const OMAHA_FLOP_PLAN_RIVER_CARDS = 8;
/** The flop bet stands when its line is worth more than the check line by this share of the pot. */
export const OMAHA_FLOP_PLAN_MARGIN_POT_SHARE = 0.02;
/** A bet line whose stack-to-pot ratio after the call is at or under this commits the stack. */
export const OMAHA_FLOP_PLAN_COMMIT_SPR = 1.5;
/** Share of the pool, by preflop percentile, the opponent's preflop line keeps (FALLBACK range). */
export const OMAHA_FLOP_PLAN_PREFLOP_KEEP: Readonly<Record<OmahaPlanOppLine, number>> = {
  aggressor: 0.35,
  called_raise: 0.5,
  called_bet: 0.5,
  checked: 0.85,
};
/** Flop priors (population; measured tendencies scale them as on the turn). */
export const OMAHA_FLOP_PLAN_PRIOR = {
  /** share of his range that raises a flop bet */
  flopRaise: 0.1,
  /** share of his range that bets the flop when checked to, and bluffs per value bet */
  flopBet: 0.4,
  flopBluffPerValue: 0.5,
} as const;

export interface OmahaFlopPlanInput {
  hole: Card[];
  /** three cards: the flop */
  board: Card[];
  dead?: Card[];
  pot: number;
  heroStack: number;
  oppStack: number;
  heroInvested: number;
  heroInPosition: boolean;
  /** candidate bet amounts in chips; bets[0] is the engine's; the check is always priced */
  bets: number[];
  /** the opponent's preflop line */
  oppLine: OmahaPlanOppLine;
  tendency?: OmahaPlanTendency | null;
}

export type OmahaFlopTurnPlan = 'bet' | 'check_call' | 'check_fold';

export interface OmahaFlopPlanClass {
  texture: OmahaPlanTexture;
  impact: OmahaPlanImpact;
  /** the share of unseen turn cards this representative stands for */
  share: number;
  plan: OmahaFlopTurnPlan;
}

export interface OmahaFlopPlanLine {
  kind: 'check' | 'bet';
  amount: number;
  ev: number;
  commitShare: number;
  /** stack-to-pot ratio once the line's bet is called (the check: before the turn) */
  sprAfterCall: number;
  /** share of turn cards on which the plan bets or calls a bet */
  continueShare: number;
  oppFold: number;
  oppCall: number;
  oppRaise: number;
  vsAggression: 'call' | 'fold' | 'none';
  equityVsContinuing: number;
  classes: OmahaFlopPlanClass[];
}

export interface OmahaFlopPlan {
  version: 1;
  street: 'flop';
  lines: OmahaFlopPlanLine[];
  sampled: number;
  turnCards: number;
  riverCards: number;
}

interface FlopPlanCore {
  M: number;
  K: number;
  S: number;
  KS: number;
  weight: number[];
  repTexture: OmahaPlanTexture[];
  heroRank: Float64Array;
  ranks: Float64Array;
  order: Int32Array[];
  byTurn: Int32Array[];
  range: number[];
}
/**
 * The part of the flop plan that depends only on the cards and the
 * opponent's preflop line (the range sample, the turn classes, the sampled
 * runouts and every exact hand rank on them): computed once per key and
 * kept for the next call with the same key (one entry; the same decision
 * asks again for other sizes, the owner-ruled final and the validator ask
 * again for the same cards). Deterministic: the key fixes every number.
 */
let flopCoreMemo: { key: string; core: FlopPlanCore | null } | null = null;
function flopPlanCore(
  hole: Card[],
  board: Card[],
  dead: Card[] | undefined,
  oppLine: OmahaPlanOppLine
): FlopPlanCore | null {
  const memoKey = [
    hole.map(key).join(''),
    board.map(key).join(''),
    (dead ?? []).map(key).sort().join(''),
    oppLine,
  ].join('|');
  if (flopCoreMemo !== null && flopCoreMemo.key === memoKey) return flopCoreMemo.core;
  const core = flopPlanCoreBuild(hole, board, dead, oppLine);
  flopCoreMemo = { key: memoKey, core };
  return core;
}
function flopPlanCoreBuild(
  hole: Card[],
  board: Card[],
  dead: Card[] | undefined,
  oppLine: OmahaPlanOppLine
): FlopPlanCore | null {
  const H = hole.length;
  const unseen = omahaPlanUnseen(hole, board, dead);
  const R = unseen.length;
  if (R < H + 3) return null;
  const rnd = planGenerator(hole, board);

  // RANGE BY THE PREFLOP LINE: a fixed pool, the top share by preflop percentile.
  const want = OMAHA_FLOP_PLAN_SAMPLE;
  const pool: number[][] = [];
  const idx = unseen.map((_, i) => i);
  for (let m = 0; m < want * OMAHA_FLOP_PLAN_POOL; m++) {
    for (let k = 0; k < H; k++) {
      const j = k + Math.floor(rnd() * (R - k));
      const tmp = idx[k];
      idx[k] = idx[j];
      idx[j] = tmp;
    }
    pool.push(idx.slice(0, H));
  }
  const pre = pool.map((h) =>
    omahaPreflopPercentile(
      h.map((i) => unseen[i]),
      false
    )
  );
  const keepShare = clamp(OMAHA_FLOP_PLAN_PREFLOP_KEEP[oppLine] ?? 0.5, 0.05, 1);
  const byPre = pool.map((_, i) => i).sort((a, b) => pre[b] - pre[a] || a - b);
  const chosen = byPre
    .slice(0, Math.max(want, Math.round(pool.length * keepShare)))
    .sort((a, b) => a - b)
    .slice(0, want);
  const hands = chosen.map((i) => pool[i]);
  const M = hands.length;

  // TURN CLASSES: texture groups, representatives spread over each, weighted.
  const groups = new Map<OmahaPlanTexture, number[]>();
  for (let r = 0; r < R; r++) {
    const tx = omahaPlanCardBucket(board, unseen[r]);
    const g = groups.get(tx);
    if (g) g.push(r);
    else groups.set(tx, [r]);
  }
  const reps: number[] = [];
  const weight: number[] = [];
  const repTexture: OmahaPlanTexture[] = [];
  for (const tx of ['pairs_board', 'flush', 'straight', 'brick'] as const) {
    const g = groups.get(tx);
    if (!g) continue;
    const k = Math.max(
      1,
      Math.min(g.length, Math.round((OMAHA_FLOP_PLAN_TURN_CARDS * g.length) / R))
    );
    for (let j = 0; j < k; j++) {
      reps.push(g[Math.floor(((j + 0.5) * g.length) / k)]);
      weight.push(g.length / k / R);
      repTexture.push(tx);
    }
  }
  const K = reps.length;
  const S = Math.min(OMAHA_FLOP_PLAN_RIVER_CARDS, R - 1);
  const rivers: number[][] = reps.map((tc) => {
    const rest: number[] = [];
    for (let r = 0; r < R; r++) if (r !== tc) rest.push(r);
    const off = rnd();
    const out: number[] = [];
    for (let j = 0; j < S; j++) out.push(rest[Math.floor(((j + off) * rest.length) / S)]);
    return out;
  });

  // Exact showdown ranks on every sampled runout.
  const KS = K * S;
  const heroRank = new Float64Array(KS);
  const ranks = new Float64Array(M * KS).fill(-1);
  const full: Card[] = [...board, board[0], board[0]];
  for (let k = 0; k < K; k++) {
    full[3] = unseen[reps[k]];
    for (let s = 0; s < S; s++) {
      full[4] = unseen[rivers[k][s]];
      heroRank[k * S + s] = scoreOmahaHi(hole, full);
    }
  }
  for (let m = 0; m < M; m++) {
    const cards = hands[m].map((i) => unseen[i]);
    const own = hands[m];
    for (let k = 0; k < K; k++) {
      if (own.includes(reps[k])) continue;
      full[3] = unseen[reps[k]];
      for (let s = 0; s < S; s++) {
        if (own.includes(rivers[k][s])) continue;
        full[4] = unseen[rivers[k][s]];
        ranks[m * KS + k * S + s] = scoreOmahaHi(cards, full);
      }
    }
  }
  // Per runout: the hands that can hold it, best first; percentiles.
  const order: Int32Array[] = [];
  const pctAt = new Float64Array(M * KS).fill(-1);
  for (let c = 0; c < KS; c++) {
    const live: number[] = [];
    for (let m = 0; m < M; m++) if (ranks[m * KS + c] >= 0) live.push(m);
    live.sort((a, b) => ranks[b * KS + c] - ranks[a * KS + c] || a - b);
    order.push(Int32Array.from(live));
    const n = live.length;
    for (let q = 0; q < n; ) {
      let e = q;
      while (e < n && ranks[live[e] * KS + c] === ranks[live[q] * KS + c]) e++;
      const p = 1 - (q + e) / 2 / n;
      for (let z = q; z < e; z++) pctAt[live[z] * KS + c] = p;
      q = e;
    }
  }
  const flopStrength = new Float64Array(M);
  const turnStrength = new Float64Array(M * K).fill(-1);
  for (let m = 0; m < M; m++) {
    let tot = 0;
    let wt = 0;
    for (let k = 0; k < K; k++) {
      let a = 0;
      let n = 0;
      for (let s = 0; s < S; s++) {
        const v = pctAt[m * KS + k * S + s];
        if (v < 0) continue;
        a += v;
        n++;
      }
      if (n > 0) {
        turnStrength[m * K + k] = a / n;
        tot += weight[k] * (a / n);
        wt += weight[k];
      }
    }
    flopStrength[m] = wt > 0 ? tot / wt : 0;
  }
  const byTurn: Int32Array[] = [];
  for (let k = 0; k < K; k++) {
    const live: number[] = [];
    for (let m = 0; m < M; m++) if (turnStrength[m * K + k] >= 0) live.push(m);
    live.sort((a, b) => turnStrength[b * K + k] - turnStrength[a * K + k] || a - b);
    byTurn.push(Int32Array.from(live));
  }
  const range = Array.from({ length: M }, (_, m) => m).sort(
    (a, b) => flopStrength[b] - flopStrength[a] || a - b
  );
  return { M, K, S, KS, weight, repTexture, heroRank, ranks, order, byTurn, range };
}

/** The plan of the flop layer; null outside it (not a three-card board, no chips, no pot). */
export function omahaStreetPlanFlop(input: OmahaFlopPlanInput): OmahaFlopPlan | null {
  const { hole, board } = input;
  if (board.length !== 3 || !omahaStrategyHoleCountServed(hole.length)) return null;
  const pot = input.pot;
  const eff = Math.min(input.heroStack, input.oppStack);
  if (!(pot > 0) || !(eff > 0)) return null;
  const P = OMAHA_STREET_PLAN_PRIOR;
  const F = OMAHA_FLOP_PLAN_PRIOR;
  const t = input.tendency ?? null;
  const foldMul = t ? t.foldToBet : 1;
  const aggr = t ? t.aggression : 1;
  const callMul = t ? t.riverCall : 1;
  const bluffMul = (t?.valueLeader ? 0.5 : 1) * aggr;

  const core = flopPlanCore(hole, board, input.dead, input.oppLine);
  if (!core) return null;
  const { M, K, S, KS, weight, repTexture, heroRank, ranks, order, byTurn, range } = core;
  const N = range.length;
  const mask = (members: readonly number[]): Uint8Array => {
    const out = new Uint8Array(M);
    for (const m of members) out[m] = 1;
    return out;
  };

  const sizeOf = (p: number, left: number): number => {
    if (!(left > 0)) return 0;
    const b = Math.min(left, P.betOfPot * p);
    return left - b < P.shoveWhenLeftUnderPot * p ? left : b;
  };
  const callShare = (bet: number, p: number): number =>
    clamp((1 - P.foldOfAlpha * foldMul * (bet / (p + bet))) * callMul, 0.1, 0.95);

  /** the Horse's equity at runout c against a set */
  const eqAt = (c: number, sel: Uint8Array): number => {
    const hr = heroRank[c];
    let w = 0;
    let n = 0;
    for (const m of order[c]) {
      if (!sel[m]) continue;
      const v = ranks[m * KS + c];
      n++;
      w += hr > v ? 1 : hr === v ? 0.5 : 0;
    }
    return n > 0 ? w / n : 0.5;
  };
  /** equity with one card to come on turn card k */
  const eqTurn = (k: number, sel: Uint8Array): number => {
    let a = 0;
    for (let s = 0; s < S; s++) a += eqAt(k * S + s, sel);
    return a / S;
  };
  /** equity with two cards to come */
  const eqFlop = (sel: Uint8Array): number => {
    let a = 0;
    for (let k = 0; k < K; k++) a += weight[k] * eqTurn(k, sel);
    return a;
  };

  const list = new Float64Array(M);
  /** The turn layer's river model on one runout. */
  const riverOne = (c: number, p: number, left: number, sel: Uint8Array, ip: boolean): number => {
    const hr = heroRank[c];
    let n = 0;
    for (const m of order[c]) if (sel[m]) list[n++] = ranks[m * KS + c];
    if (n === 0) return p / 2;
    const win = (a: number, b: number): number => {
      let w = 0;
      for (let q = a; q < b; q++) w += hr > list[q] ? 1 : hr === list[q] ? 0.5 : 0;
      return w;
    };
    const all = win(0, n);
    const b = sizeOf(p, left);
    if (!(b > 0)) return (all / n) * p;
    const nV = Math.min(n, Math.round(n * clamp((ip ? P.riverLead : P.riverBet) * aggr, 0, 0.9)));
    const nB = Math.min(n - nV, Math.round(nV * P.riverBluffPerValue * bluffMul));
    const betN = nV + nB;
    let facing = 0;
    if (betN > 0) {
      const eqBet = (win(0, nV) + win(n - nB, n)) / betN;
      facing = Math.max(0, eqBet * (p + 2 * b) - b);
    }
    const showdown = (win(nV, n - nB) / n) * p;
    const a0 = ip ? nV : 0;
    const poolN = ip ? n - betN : n;
    const nC = Math.min(poolN, Math.round(poolN * callShare(b, p)));
    const betEv = ((poolN - nC) / n) * p + (win(a0, a0 + nC) / n) * (p + 2 * b) - (nC / n) * b;
    return ip
      ? (betN / n) * facing + Math.max(showdown, betEv)
      : Math.max((betN / n) * facing + showdown, betEv);
  };
  const riverAvg = (k: number, p: number, left: number, sel: Uint8Array, ip: boolean): number => {
    let a = 0;
    for (let s = 0; s < S; s++) a += riverOne(k * S + s, p, left, sel, ip);
    return a / S;
  };

  interface TurnOut {
    ev: number;
    first: 'bet' | 'check';
    calls: boolean;
    eq: number;
  }
  /** The turn layer's line model on turn card k: pot p, `left` behind, against `members`. */
  const turnNode = (
    k: number,
    p: number,
    left: number,
    members: Uint8Array,
    ip: boolean
  ): TurnOut => {
    const live: number[] = [];
    for (const m of byTurn[k]) if (members[m]) live.push(m);
    const n = live.length;
    if (n === 0) return { ev: p / 2, first: 'check', calls: false, eq: 0.5 };
    const sel = mask(live);
    const eq = eqTurn(k, sel);
    const b = sizeOf(p, left);
    if (!(b > 0)) return { ev: eq * p, first: 'check', calls: true, eq };
    // his bet when the Horse checks (out of position) or his lead (in position)
    const nV = Math.min(n, Math.round(n * clamp(P.turnBet * aggr, 0, 0.9)));
    const nB = Math.min(n - nV, Math.round(nV * P.turnBluffPerValue * bluffMul));
    const bettors = [...live.slice(0, nV), ...live.slice(n - nB)];
    const checkers = live.slice(nV, n - nB);
    let facing = 0;
    let calls = false;
    if (bettors.length > 0) {
      const called = -b + riverAvg(k, p + 2 * b, left - b, mask(bettors), ip);
      calls = called > 0;
      facing = Math.max(0, called);
    }
    const checkSel = mask(checkers);
    const through = checkers.length > 0 ? riverAvg(k, p, left, checkSel, ip) : 0;
    /** the Horse's bet of b against `against`, best first */
    const betLine = (against: number[]): number => {
      const na = against.length;
      if (na === 0) return 0;
      const rest = left - b;
      const extra = Math.min(rest, p + 2 * b);
      const nR = extra > 0 ? Math.min(na, Math.round(na * clamp(P.turnRaise * aggr, 0, 0.5))) : 0;
      const nF = Math.min(
        na - nR,
        Math.round(na * clamp(P.foldOfAlpha * foldMul * (b / (p + b)), 0, 0.9))
      );
      const raisers = against.slice(0, nR);
      const callers = against.slice(nR, na - nF);
      let raiseEv = -b;
      if (nR > 0)
        raiseEv += Math.max(0, eqTurn(k, mask(raisers)) * (p + 2 * b + 2 * extra) - extra);
      const called = callers.length > 0 ? -b + riverAvg(k, p + 2 * b, rest, mask(callers), ip) : 0;
      return (nF / na) * p + (nR / na) * raiseEv + (callers.length / na) * called;
    };
    if (ip) {
      const vsCheckers = checkers.length > 0 ? betLine(checkers) : 0;
      const bets = checkers.length > 0 && vsCheckers > through;
      const ev =
        (bettors.length / n) * facing + (checkers.length / n) * (bets ? vsCheckers : through);
      return { ev, first: bets ? 'bet' : 'check', calls, eq };
    }
    const checkEv = (bettors.length / n) * facing + (checkers.length / n) * through;
    const betEv = betLine(live);
    return betEv > checkEv
      ? { ev: betEv, first: 'bet', calls, eq }
      : { ev: checkEv, first: 'check', calls, eq };
  };
  /** The turn, by class: weighted value and the plan per representative. */
  const turnValue = (
    p: number,
    left: number,
    members: readonly number[],
    ip: boolean
  ): { ev: number; nodes: TurnOut[] } => {
    const sel = mask(members);
    const nodes: TurnOut[] = [];
    let ev = 0;
    for (let k = 0; k < K; k++) {
      const node = turnNode(k, p, left, sel, ip);
      nodes.push(node);
      ev += weight[k] * node.ev;
    }
    return { ev, nodes };
  };

  const invested = Math.max(0, input.heroInvested);
  const started = invested + input.heroStack;
  const summarise = (
    kind: 'check' | 'bet',
    amount: number,
    ev: number,
    nodes: TurnOut[],
    eqBefore: number,
    shares: { fold: number; call: number; raise: number },
    vsAggression: 'call' | 'fold' | 'none',
    sprAfterCall: number
  ): OmahaFlopPlanLine => {
    let cont = 0;
    const classes: OmahaFlopPlanClass[] = nodes.map((node, k) => {
      const plan: OmahaFlopTurnPlan =
        node.first === 'bet' ? 'bet' : node.calls ? 'check_call' : 'check_fold';
      if (plan !== 'check_fold') cont += weight[k];
      const d = node.eq - eqBefore;
      return {
        texture: repTexture[k],
        impact: d > 0.1 ? 'good' : d < -0.1 ? 'bad' : 'neutral',
        share: weight[k],
        plan,
      };
    });
    return {
      kind,
      amount,
      ev,
      commitShare: started > 0 ? (invested + amount) / started : 0,
      sprAfterCall,
      continueShare: cont,
      oppFold: shares.fold,
      oppCall: shares.call,
      oppRaise: shares.raise,
      vsAggression,
      equityVsContinuing: eqBefore,
      classes,
    };
  };

  const lines: OmahaFlopPlanLine[] = [];
  const ip = input.heroInPosition;
  // CHECK.
  if (ip) {
    const tv = turnValue(pot, eff, range, true);
    lines.push(
      summarise(
        'check',
        0,
        tv.ev,
        tv.nodes,
        eqFlop(mask(range)),
        { fold: 0, call: 1, raise: 0 },
        'none',
        eff / pot
      )
    );
  } else {
    const b = sizeOf(pot, eff);
    const nV = Math.min(N, Math.round(N * clamp(F.flopBet * aggr, 0, 0.9)));
    const nB = Math.min(N - nV, Math.round(nV * F.flopBluffPerValue * bluffMul));
    const bettors = [...range.slice(0, nV), ...range.slice(N - nB)];
    const checkers = range.slice(nV, N - nB);
    const through = turnValue(pot, eff, checkers, false);
    let facing = 0;
    let vs: 'call' | 'fold' | 'none' = 'none';
    if (bettors.length > 0 && b > 0) {
      const called = -b + turnValue(pot + 2 * b, eff - b, bettors, false).ev;
      vs = called > 0 ? 'call' : 'fold';
      facing = Math.max(0, called);
    }
    const ev = (bettors.length / N) * facing + (checkers.length / N) * through.ev;
    lines.push(
      summarise(
        'check',
        0,
        ev,
        through.nodes,
        eqFlop(mask(checkers)),
        { fold: 0, call: checkers.length / N, raise: bettors.length / N },
        vs,
        eff / pot
      )
    );
  }
  // EACH BET.
  for (const raw of input.bets) {
    const bet = Math.min(raw, eff);
    if (!(bet > 0)) continue;
    const left = eff - bet;
    const extra = Math.min(left, pot + 2 * bet);
    const nR = extra > 0 ? Math.min(N, Math.round(N * clamp(F.flopRaise * aggr, 0, 0.5))) : 0;
    const nF = Math.min(
      N - nR,
      Math.round(N * clamp(P.foldOfAlpha * foldMul * (bet / (pot + bet)), 0, 0.9))
    );
    const raisers = range.slice(0, nR);
    const callers = range.slice(nR, N - nF);
    let raiseEv = -bet;
    let vs: 'call' | 'fold' | 'none' = 'none';
    if (nR > 0) {
      const callEv = eqFlop(mask(raisers)) * (pot + 2 * bet + 2 * extra) - extra;
      vs = callEv > 0 ? 'call' : 'fold';
      raiseEv += Math.max(0, callEv);
    }
    const tv = turnValue(pot + 2 * bet, left, callers, ip);
    const ev = (nF / N) * pot + (nR / N) * raiseEv + (callers.length / N) * (-bet + tv.ev);
    lines.push(
      summarise(
        'bet',
        bet,
        ev,
        tv.nodes,
        eqFlop(mask(callers)),
        { fold: nF / N, call: callers.length / N, raise: nR / N },
        vs,
        left / (pot + 2 * bet)
      )
    );
  }
  return {
    version: 1,
    street: 'flop',
    lines,
    sampled: M,
    turnCards: K,
    riverCards: S,
  };
}

/** A flop bet line that commits the stack with a hand that cannot stand a raise or a bad turn. */
export function omahaFlopPlanUncommitted(line: OmahaFlopPlanLine): boolean {
  return (
    line.kind === 'bet' &&
    line.sprAfterCall <= OMAHA_FLOP_PLAN_COMMIT_SPR + 1e-9 &&
    ((line.oppRaise > 0 && line.vsAggression === 'fold') ||
      line.continueShare < OMAHA_STREET_PLAN_CONTINUE_SHARE)
  );
}

/**
 * The flop verdict: the index of the line to play (0: the check; 1: the
 * engine's bet; 2+: a smaller size) and why. See the layer's comment.
 */
export function omahaFlopPlanChoice(
  plan: OmahaFlopPlan,
  marginChips: number
): { index: number; reason: 'kept' | 'resized' | 'checked' | 'commit_avoided' } {
  const lines = plan.lines;
  const check = lines[0];
  const engine = lines[1];
  if (!check || !engine) return { index: 1, reason: 'kept' };
  const engineOut = omahaFlopPlanUncommitted(engine);
  let best = -1;
  for (let i = 1; i < lines.length; i++) {
    if (omahaFlopPlanUncommitted(lines[i])) continue;
    if (best < 0 || lines[i].ev > lines[best].ev) best = i;
  }
  if (best > 1 && !engineOut && lines[best].ev <= engine.ev + marginChips) best = 1;
  if (best >= 1 && lines[best].ev > check.ev + marginChips)
    return { index: best, reason: best === 1 ? 'kept' : 'resized' };
  return { index: 0, reason: engineOut ? 'commit_avoided' : 'checked' };
}

/** The bounded diagnostic record of a flop plan (no card of any player, no opponent identity). */
export interface OmahaFlopPlanRecord {
  /** omahaBetSizeByPublicState: the public size the plan priced (absent when it priced the engine's bet). */
  publicSize?: number;
  version: 1;
  street: 'flop';
  chosen: 'check' | 'bet';
  amount: number;
  /** the engine's bet amount the plan was asked about */
  engineBet: number;
  ev: { check: number; bet: number };
  commitShare: number;
  sprAfterCall: number;
  continueShare: number;
  vsAggression: 'call' | 'fold' | 'none';
  tendency: [number, number, number, 0 | 1] | null;
  classes: {
    texture: OmahaPlanTexture;
    impact: OmahaPlanImpact;
    share: number;
    plan: OmahaFlopTurnPlan;
  }[];
}
export function omahaFlopPlanRecord(
  plan: OmahaFlopPlan,
  chosen: OmahaFlopPlanLine,
  tendency: OmahaPlanTendency | null = null
): OmahaFlopPlanRecord {
  const engine = plan.lines[1] ?? plan.lines[0];
  return {
    version: 1,
    street: 'flop',
    chosen: chosen.kind,
    amount: r2(chosen.amount),
    engineBet: r2(engine.amount),
    ev: { check: r2(plan.lines[0].ev), bet: r2(engine.ev) },
    commitShare: r2(chosen.commitShare),
    sprAfterCall: r2(chosen.sprAfterCall),
    continueShare: r2(chosen.continueShare),
    vsAggression: chosen.vsAggression,
    tendency: tendency
      ? [tendency.foldToBet, tendency.aggression, tendency.riverCall, tendency.valueLeader ? 1 : 0]
      : null,
    classes: chosen.classes.map((c) => ({
      texture: c.texture,
      impact: c.impact,
      share: r2(c.share),
      plan: c.plan,
    })),
  };
}

/** The flop spot of the second layer: heads-up, the flop, nothing to call, a check legal. */
export function omahaStreetPlanFlopSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (String(gs.stage ?? '') !== 'flop' || (gs.communityCards ?? []).length !== 3) return false;
    if (omahaPlanToCall(hero, gs) > 0.005) return false;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return false;
    return omahaStreetPlanDomain(hero, gs) !== null;
  } catch {
    return false;
  }
}

/**
 * The bet amounts the flop layer prices: the engine's own first, then every
 * smaller size of the engine's menu (omahaCardImpactAmounts' pot fractions,
 * legal, deduplicated) that is not all in.
 */
export function omahaFlopPlanSizes(
  hero: SeatPlayer,
  opp: SeatPlayer,
  gs: HorseGameStateV2,
  engineBet: number
): number[] {
  const out = [engineBet];
  for (const a of omahaCardImpactAmounts(hero, opp, gs))
    if (a < engineBet - 0.005 && a < hero.stack - 0.005 && !out.includes(a)) out.push(a);
  return out;
}

/** The flop plan's input at a decision node (the one place it is built from a game state). */
export function omahaFlopPlanInputAt(
  hero: SeatPlayer,
  opp: SeatPlayer,
  gs: HorseGameStateV2,
  engineBet: number,
  tendency: OmahaPlanTendency | null,
  onlyThisSize = false
): OmahaFlopPlanInput {
  return {
    hole: hero.cards,
    board: gs.communityCards ?? [],
    dead: hero.knownDeadCards ?? [],
    pot: gs.pot,
    heroStack: hero.stack,
    oppStack: opp.stack,
    heroInvested: Number.isFinite(hero.totalInvested) ? (hero.totalInvested ?? 0) : 0,
    heroInPosition: omahaPlanHeroInPosition(opp, gs, 'flop'),
    // omahaBetSizeByPublicState: the public size is the one size bet, so it alone is priced.
    bets: onlyThisSize ? [engineBet] : omahaFlopPlanSizes(hero, opp, gs, engineBet),
    oppLine: omahaPlanOppLine(hero, opp, gs, 'preflop'),
    tendency,
  };
}

/** A recorded tendency as the plan uses it, or undefined when the record's tendency is malformed. */
function recordedTendency(t: unknown): OmahaPlanTendency | null | undefined {
  if (t == null) return null;
  if (!Array.isArray(t) || t.length !== 4 || (t[3] !== 0 && t[3] !== 1)) return undefined;
  for (let i = 0; i < 3; i++)
    if (typeof t[i] !== 'number' || omahaPlanMultiplier(t[i]) !== t[i]) return undefined;
  return { foldToBet: t[0], aggression: t[1], riverCall: t[2], valueLeader: t[3] === 1 };
}

/**
 * What the worker receipt validator re-runs: a flop bet of `bet` became a
 * check under the flop plan recorded on the decision. The plan has no
 * facing-bet seam, so re-run on the request with the recorded multipliers it
 * gives the decision's own verdict: a check it cannot produce is refused.
 */
export function omahaStreetPlanFlopAdmitsCheck(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  bet: number | undefined,
  record: unknown
): boolean {
  try {
    if (!omahaStreetPlanFlopSpot(hero, gs)) return false;
    const opp = omahaStreetPlanDomain(hero, gs);
    const priced = omahaRecordedPricedBet(hero, bet, record);
    bet = priced.bet;
    if (!opp || !Number.isFinite(bet) || !((bet as number) > 0)) return false;
    const rec = record as Partial<OmahaFlopPlanRecord> | null | undefined;
    if (!rec || rec.version !== 1 || rec.street !== 'flop' || rec.chosen !== 'check') return false;
    const tendency = recordedTendency(rec.tendency);
    if (tendency === undefined) return false;
    const plan = omahaStreetPlanFlop(
      omahaFlopPlanInputAt(hero, opp, gs, bet as number, tendency, priced.onlyThisSize)
    );
    if (!plan) return false;
    return (
      omahaFlopPlanChoice(plan, omahaStrategyConstant('streetPlanFlopMarginPotShare', gs) * gs.pot)
        .index === 0
    );
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TURN, THREE-WAY (owner 2026-11-15 11:43; option omahaStreetPlanThreeWay,
// default OFF, read `=== true`).
//
// The turn layer for exactly two live opponents. Each opponent has his OWN
// range (an independent fixed sample, filtered by his own flop line, and his
// own measured tendency multipliers) and responds to a turn bet on his own:
// fold / call / raise by the turn layer's priors. The bettor wins the pot at
// once only when BOTH fold; otherwise he must beat every caller at showdown.
// Every unseen river card is priced exactly. The Horse's share against both
// callers on a river is the product of its shares against each (the two
// ranges are independent; card overlap between the two opponents is ignored).
// After a raise the Horse prices calling the raiser heads-up (the other
// opponent folds). Facing a bet after its own check out of position it
// prices calling the bettor heads-up.
//
// LIMITS. No river betting is modelled three-way: a river is a showdown (a
// river on which the Horse is beaten is worth only the turn money it put in).
// Side pots are not modelled: the bet is capped at the larger opponent stack.
//
// The verdict is the turn layer's: the bet becomes a check when the check
// line is worth more by streetPlanMarginPotShare of the pot.
// ═══════════════════════════════════════════════════════════════════════════

/** Hands in each opponent's independent sample. */
export const OMAHA_STREET_PLAN_THREE_WAY_SAMPLE = 64;

export interface OmahaThreeWayOpp {
  stack: number;
  /** his flop line */
  line: OmahaPlanOppLine;
  tendency?: OmahaPlanTendency | null;
}

export interface OmahaThreeWayPlanInput {
  hole: Card[];
  /** four cards: the turn */
  board: Card[];
  dead?: Card[];
  pot: number;
  heroStack: number;
  heroInvested: number;
  /** both opponents have acted on the turn (the Horse closes the action) */
  heroLast: boolean;
  bets: number[];
  opps: [OmahaThreeWayOpp, OmahaThreeWayOpp];
  range?: OmahaPlanRangeModel;
}

export interface OmahaThreeWayPlanLine {
  kind: 'check' | 'bet';
  amount: number;
  ev: number;
  commitShare: number;
  /** both opponents fold to the bet */
  bothFold: number;
  /** at least one raises */
  anyRaise: number;
  /** the Horse's share against both callers with one card to come */
  equityVsBoth: number;
}

export interface OmahaThreeWayPlan {
  version: 1;
  street: 'turn';
  layer: 'three_way';
  lines: OmahaThreeWayPlanLine[];
  sampled: number;
}

interface ThreeWaySideCore {
  hands: number[][];
  ranks: Float64Array;
  /** sample members, best first by turn strength */
  kept: number[];
}
interface ThreeWayCore {
  R: number;
  heroRank: Float64Array;
  sides: ThreeWaySideCore[];
}
/** The card-only part of the three-way plan (samples and exact ranks), one entry, as the flop core. */
let threeWayCoreMemo: { key: string; core: ThreeWayCore | null } | null = null;
function threeWayPlanCore(
  hole: Card[],
  board: Card[],
  dead: Card[] | undefined,
  lines: [OmahaPlanOppLine, OmahaPlanOppLine],
  range: OmahaPlanRangeModel | undefined
): ThreeWayCore | null {
  const memoKey = [
    hole.map(key).join(''),
    board.map(key).join(''),
    (dead ?? []).map(key).sort().join(''),
    lines.join(','),
  ].join('|');
  if (range === undefined && threeWayCoreMemo !== null && threeWayCoreMemo.key === memoKey)
    return threeWayCoreMemo.core;
  const core = threeWayPlanCoreBuild(hole, board, dead, lines, range);
  if (range === undefined) threeWayCoreMemo = { key: memoKey, core };
  return core;
}
function threeWayPlanCoreBuild(
  hole: Card[],
  board: Card[],
  dead: Card[] | undefined,
  lines: [OmahaPlanOppLine, OmahaPlanOppLine],
  range: OmahaPlanRangeModel | undefined
): ThreeWayCore | null {
  const unseen = omahaPlanUnseen(hole, board, dead);
  const R = unseen.length;
  const H = hole.length;
  if (R < 2 * H + 1) return null;
  const M = OMAHA_STREET_PLAN_THREE_WAY_SAMPLE;
  const rnd = planGenerator(hole, board);
  const idx = unseen.map((_, i) => i);
  // The decision's shared exact count (HorseOmahaRiverTables), as the turn layer.
  const tables = omahaTurnRiverTables(hole, board, dead ?? []);
  const shared = tables !== null && tables.n === R ? tables : null;
  const heroRank = new Float64Array(R);
  const full: Card[] = [...board, board[0]];
  for (let r = 0; r < R; r++) {
    full[4] = unseen[r];
    heroRank[r] = scoreOmahaHi(hole, full);
  }
  const sides: ThreeWaySideCore[] = lines.map((line) => {
    const hands: number[][] = [];
    for (let m = 0; m < M; m++) {
      for (let k = 0; k < H; k++) {
        const j = k + Math.floor(rnd() * (R - k));
        const tmp = idx[k];
        idx[k] = idx[j];
        idx[j] = tmp;
      }
      hands.push(idx.slice(0, H));
    }
    const ranks = new Float64Array(M * R).fill(-1);
    for (let m = 0; m < M; m++) {
      const cards = hands[m].map((i) => unseen[i]);
      const own = hands[m];
      for (let r = 0; r < R; r++) {
        if (own.includes(r)) continue;
        full[4] = unseen[r];
        ranks[m * R + r] =
          shared !== null ? omahaHandRiverScore(shared, own, r) : scoreOmahaHi(cards, full);
      }
    }
    // turn strength: mean river percentile
    const strength = new Float64Array(M);
    const seen = new Int32Array(M);
    for (let r = 0; r < R; r++) {
      const live: number[] = [];
      for (let m = 0; m < M; m++) if (ranks[m * R + r] >= 0) live.push(m);
      live.sort((a, b) => ranks[b * R + r] - ranks[a * R + r] || a - b);
      const n = live.length;
      for (let q = 0; q < n; ) {
        let e = q;
        while (e < n && ranks[live[e] * R + r] === ranks[live[q] * R + r]) e++;
        const p = 1 - (q + e) / 2 / n;
        for (let z = q; z < e; z++) {
          strength[live[z]] += p;
          seen[live[z]]++;
        }
        q = e;
      }
    }
    for (let m = 0; m < M; m++) strength[m] = seen[m] > 0 ? strength[m] / seen[m] : 0;
    const keep = clamp((range ?? planFallbackKeepShare).keepShare(line), 0.05, 1);
    const kept = Array.from({ length: M }, (_, m) => m)
      .sort((a, b) => strength[b] - strength[a] || a - b)
      .slice(0, Math.max(8, Math.round(M * keep)));
    return { hands, ranks, kept };
  });
  return { R, heroRank, sides };
}

export function omahaStreetPlanThreeWay(input: OmahaThreeWayPlanInput): OmahaThreeWayPlan | null {
  const { hole, board } = input;
  if (board.length !== 4 || !omahaStrategyHoleCountServed(hole.length)) return null;
  if (input.opps.length !== 2) return null;
  const pot = input.pot;
  if (!(pot > 0) || !(input.heroStack > 0)) return null;
  const P = OMAHA_STREET_PLAN_PRIOR;
  const core = threeWayPlanCore(
    hole,
    board,
    input.dead,
    [input.opps[0].line, input.opps[1].line],
    input.range
  );
  if (!core) return null;
  const { R, heroRank } = core;
  interface Side extends ThreeWaySideCore {
    foldMul: number;
    aggr: number;
  }
  const sides: Side[] = core.sides.map((c, i) => {
    const t = input.opps[i].tendency ?? null;
    return { ...c, foldMul: t ? t.foldToBet : 1, aggr: t ? t.aggression : 1 };
  });
  const M = OMAHA_STREET_PLAN_THREE_WAY_SAMPLE;
  /** per river: the Horse's share against a set of one side's hands (ties half) */
  const shareOn = (side: Side, members: readonly number[]): Float64Array => {
    const out = new Float64Array(R);
    for (let r = 0; r < R; r++) {
      const hr = heroRank[r];
      let w = 0;
      let n = 0;
      for (const m of members) {
        const v = side.ranks[m * R + r];
        if (v < 0) continue;
        n++;
        w += hr > v ? 1 : hr === v ? 0.5 : 0;
      }
      out[r] = n > 0 ? w / n : 0.5;
    }
    return out;
  };
  const mean = (xs: Float64Array): number => {
    let a = 0;
    for (let r = 0; r < R; r++) a += xs[r];
    return R > 0 ? a / R : 0;
  };
  const both = (a: Float64Array, b: Float64Array): number => {
    let s = 0;
    for (let r = 0; r < R; r++) s += a[r] * b[r];
    return R > 0 ? s / R : 0;
  };
  const effMax = Math.min(input.heroStack, Math.max(input.opps[0].stack, input.opps[1].stack));
  const invested = Math.max(0, input.heroInvested);
  const started = invested + input.heroStack;
  const lines: OmahaThreeWayPlanLine[] = [];

  // CHECK.
  {
    const full0 = shareOn(sides[0], sides[0].kept);
    const full1 = shareOn(sides[1], sides[1].kept);
    if (input.heroLast) {
      lines.push({
        kind: 'check',
        amount: 0,
        ev: both(full0, full1) * pot,
        commitShare: started > 0 ? invested / started : 0,
        bothFold: 0,
        anyRaise: 0,
        equityVsBoth: both(full0, full1),
      });
    } else {
      // each may bet after the check: his top value share and bluffs from the bottom
      const b = Math.min(effMax, P.betOfPot * pot);
      const parts = sides.map((side) => {
        const n = side.kept.length;
        const nV = Math.min(n, Math.round(n * clamp(P.turnBet * side.aggr, 0, 0.9)));
        const nB = Math.min(n - nV, Math.round(nV * P.turnBluffPerValue * side.aggr));
        const bettors = [...side.kept.slice(0, nV), ...side.kept.slice(n - nB)];
        const checkers = side.kept.slice(nV, n - nB);
        const callEv = bettors.length > 0 ? mean(shareOn(side, bettors)) * (pot + 2 * b) - b : 0;
        return {
          q: n > 0 ? bettors.length / n : 0,
          facing: Math.max(0, callEv),
          checkers: checkers.length > 0 ? checkers : side.kept,
        };
      });
      const none = (1 - parts[0].q) * (1 - parts[1].q);
      const through =
        both(shareOn(sides[0], parts[0].checkers), shareOn(sides[1], parts[1].checkers)) * pot;
      const qs = parts[0].q + parts[1].q;
      const facing =
        qs > 0 ? (parts[0].q * parts[0].facing + parts[1].q * parts[1].facing) / qs : 0;
      lines.push({
        kind: 'check',
        amount: 0,
        ev: none * through + (1 - none) * facing,
        commitShare: started > 0 ? invested / started : 0,
        bothFold: 0,
        anyRaise: 1 - none,
        equityVsBoth: both(full0, full1),
      });
    }
  }
  // EACH BET.
  for (const raw of input.bets) {
    const bet = Math.min(raw, effMax);
    if (!(bet > 0)) continue;
    const resp = sides.map((side, i) => {
      const n = side.kept.length;
      const left = Math.max(0, input.opps[i].stack - bet);
      const extra = Math.min(Math.max(0, input.heroStack - bet), left, pot + 3 * bet);
      const nR =
        extra > 0 ? Math.min(n, Math.round(n * clamp(P.turnRaise * side.aggr, 0, 0.5))) : 0;
      const nF = Math.min(
        n - nR,
        Math.round(n * clamp(P.foldOfAlpha * side.foldMul * (bet / (pot + bet)), 0, 0.9))
      );
      const raisers = side.kept.slice(0, nR);
      const callers = side.kept.slice(nR, n - nF);
      const raiseCall =
        nR > 0 ? mean(shareOn(side, raisers)) * (pot + 3 * bet + 2 * extra) - extra : 0;
      return {
        f: n > 0 ? nF / n : 0,
        c: n > 0 ? callers.length / n : 0,
        r: n > 0 ? nR / n : 0,
        raiseEv: -bet + Math.max(0, raiseCall),
        callers: shareOn(side, callers.length > 0 ? callers : side.kept),
      };
    });
    const [a, b] = resp;
    const anyRaise = 1 - (1 - a.r) * (1 - b.r);
    const raiseEv = a.r + b.r > 0 ? (a.r * a.raiseEv + b.r * b.raiseEv) / (a.r + b.r) : -bet;
    const fa = a.r < 1 ? a.f / (1 - a.r) : 0;
    const ca = a.r < 1 ? a.c / (1 - a.r) : 0;
    const fb = b.r < 1 ? b.f / (1 - b.r) : 0;
    const cb = b.r < 1 ? b.c / (1 - b.r) : 0;
    const noRaise =
      fa * fb * pot +
      ca * fb * (-bet + mean(a.callers) * (pot + 2 * bet)) +
      fa * cb * (-bet + mean(b.callers) * (pot + 2 * bet)) +
      ca * cb * (-bet + both(a.callers, b.callers) * (pot + 3 * bet));
    lines.push({
      kind: 'bet',
      amount: bet,
      ev: anyRaise * raiseEv + (1 - anyRaise) * noRaise,
      commitShare: started > 0 ? (invested + bet) / started : 0,
      bothFold: (1 - anyRaise) * fa * fb,
      anyRaise,
      equityVsBoth: both(a.callers, b.callers),
    });
  }
  return { version: 1, street: 'turn', layer: 'three_way', lines, sampled: M };
}

/** The bounded diagnostic record of a three-way turn plan (no card, no identity). */
export interface OmahaThreeWayPlanRecord {
  /** omahaBetSizeByPublicState: the public size the plan priced (absent when it priced the engine's bet). */
  publicSize?: number;
  version: 1;
  street: 'turn';
  layer: 'three_way';
  chosen: 'check' | 'bet';
  amount: number;
  ev: { check: number; bet: number };
  bothFold: number;
  anyRaise: number;
  /** each opponent's measured multipliers, in seat order; null: the population prior */
  tendency: [[number, number, number, 0 | 1] | null, [number, number, number, 0 | 1] | null];
}
const tendencyTuple = (
  t: OmahaPlanTendency | null | undefined
): [number, number, number, 0 | 1] | null =>
  t ? [t.foldToBet, t.aggression, t.riverCall, t.valueLeader ? 1 : 0] : null;
export function omahaThreeWayPlanRecord(
  plan: OmahaThreeWayPlan,
  chosen: OmahaThreeWayPlanLine,
  bet: OmahaThreeWayPlanLine,
  tendencies: [OmahaPlanTendency | null, OmahaPlanTendency | null]
): OmahaThreeWayPlanRecord {
  return {
    version: 1,
    street: 'turn',
    layer: 'three_way',
    chosen: chosen.kind,
    amount: r2(chosen.amount),
    ev: { check: r2(plan.lines[0].ev), bet: r2(bet.ev) },
    bothFold: r2(bet.bothFold),
    anyRaise: r2(bet.anyRaise),
    tendency: [tendencyTuple(tendencies[0]), tendencyTuple(tendencies[1])],
  };
}

/** The public domain of the three-way turn: as the first layer's, with exactly two live opponents. */
export function omahaStreetPlanThreeWayDomain(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): [SeatPlayer, SeatPlayer] | null {
  try {
    const opps = live(hero, gs);
    if (opps.length !== 2) return null;
    if (opps.some((p) => p.is_all_in || !(p.stack > 0))) return null;
    // the first layer's gate, asked once per opponent as if heads-up
    for (const o of opps) {
      const alone = {
        ...gs,
        players: (gs.players ?? []).filter(
          (p) => p.seat === hero.seat || p.seat === o.seat || p.is_folded || p.is_sitting_out
        ),
      } as HorseGameStateV2;
      if (omahaStreetPlanDomain(hero, alone) === null) return null;
    }
    const sorted = [...opps].sort((a, b) => a.seat - b.seat);
    return [sorted[0], sorted[1]];
  } catch {
    return null;
  }
}

/** The three-way turn spot: the turn, nothing to call, a check legal, two live opponents. */
export function omahaStreetPlanThreeWaySpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (String(gs.stage ?? '') !== 'turn' || (gs.communityCards ?? []).length !== 4) return false;
    if (omahaPlanToCall(hero, gs) > 0.005) return false;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return false;
    return omahaStreetPlanThreeWayDomain(hero, gs) !== null;
  } catch {
    return false;
  }
}

/** The three-way plan's input at a decision node. */
export function omahaThreeWayPlanInputAt(
  hero: SeatPlayer,
  opps: [SeatPlayer, SeatPlayer],
  gs: HorseGameStateV2,
  bet: number,
  tendencies: [OmahaPlanTendency | null, OmahaPlanTendency | null]
): OmahaThreeWayPlanInput {
  return {
    hole: hero.cards,
    board: gs.communityCards ?? [],
    dead: hero.knownDeadCards ?? [],
    pot: gs.pot,
    heroStack: hero.stack,
    heroInvested: Number.isFinite(hero.totalInvested) ? (hero.totalInvested ?? 0) : 0,
    heroLast: opps.every((o) => omahaPlanHeroInPosition(o, gs, 'turn')),
    bets: [bet],
    opps: [
      {
        stack: opps[0].stack,
        line: omahaPlanOppLine(hero, opps[0], gs, 'flop'),
        tendency: tendencies[0],
      },
      {
        stack: opps[1].stack,
        line: omahaPlanOppLine(hero, opps[1], gs, 'flop'),
        tendency: tendencies[1],
      },
    ],
  };
}

/** What the receipt validator re-runs for a three-way turn bet that became a check (recorded multipliers). */
export function omahaStreetPlanThreeWayAdmitsCheck(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  bet: number | undefined,
  record: unknown
): boolean {
  try {
    if (!omahaStreetPlanThreeWaySpot(hero, gs)) return false;
    const opps = omahaStreetPlanThreeWayDomain(hero, gs);
    bet = omahaRecordedPricedBet(hero, bet, record).bet;
    if (!opps || !Number.isFinite(bet) || !((bet as number) > 0)) return false;
    const rec = record as Partial<OmahaThreeWayPlanRecord> | null | undefined;
    if (!rec || rec.version !== 1 || rec.layer !== 'three_way' || rec.chosen !== 'check')
      return false;
    if (!Array.isArray(rec.tendency) || rec.tendency.length !== 2) return false;
    const t0 = recordedTendency(rec.tendency[0]);
    const t1 = recordedTendency(rec.tendency[1]);
    if (t0 === undefined || t1 === undefined) return false;
    const plan = omahaStreetPlanThreeWay(
      omahaThreeWayPlanInputAt(hero, opps, gs, bet as number, [t0, t1])
    );
    if (!plan || !plan.lines[1]) return false;
    return (
      plan.lines[0].ev >
      plan.lines[1].ev + omahaStrategyConstant('streetPlanMarginPotShare', gs) * gs.pot
    );
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PREFLOP: THE STACK-TO-POT PLAN (owner 2026-11-15 11:43; option
// omahaPreflopStackPlan, default OFF, read `=== true`).
//
// Before the Horse CALLS a preflop raise (an open, a 3-bet or more) heads-up
// against the raiser, it computes the stack-to-pot ratio the call creates
// (the smaller of what is behind for it and for the raiser, over the pot
// after the call). Only when that ratio is under OMAHA_PREFLOP_STACK_PLAN_LOW_SPR
// (a pot whose stacks go in on most flops) is the call priced as the stack it
// commits:
//
//   EV(call) = (equity - charge) x (pot after the call + 2 x behind)
//              - (call + behind),             EV(fold) = 0,
//
// with the equity against the raiser's range (HorseOmahaReraisedPot's
// sampler; the range is the band the mind reads for him, the line-implied
// prior otherwise: an open 0.40-1, a 3-bet 0.62-1, a 4-bet 0.86-1) and the
// charge from the hand's PLAYABILITY in that pot:
//   - realisation: the engine's charge (OOP_REALIZATION_MARGIN out of
//     position, IP_REALIZATION_MARGIN in position) scaled by ratio / LOW_SPR
//     (the less play is left, the less is lost to it), halved for a
//     nut-making hand;
//   - stack-off: a hand that makes mostly one pair (not coordinated by
//     omahaOopCoordinated and without a suited ace: it cannot make the nut
//     straight or the nut flush) is paid off by better and stacks off behind:
//     OMAHA_PREFLOP_STACK_PLAN_DOMINATION, scaled by min(1, ratio).
// The call becomes a fold when EV(call) < 0. Never widens a range; only a
// call becomes a fold. A call that is itself all in is not touched (no later
// street: the price is the engine's). Runs before the day's 3-bet / 4-bet
// options (omahaReraiseRange*, omahaOopReraisedPotStrongRange), which keep
// precedence over the calls they make. No engine random number.
// ═══════════════════════════════════════════════════════════════════════════

export const OMAHA_PREFLOP_STACK_PLAN_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** A call that leaves a stack-to-pot ratio under this is priced as the stack it commits. */
export const OMAHA_PREFLOP_STACK_PLAN_LOW_SPR = 3;
/** The stack-off charge of a hand that makes mostly one pair, in equity. */
export const OMAHA_PREFLOP_STACK_PLAN_DOMINATION = 0.06;
/** Samples of the equity estimate. */
export const OMAHA_PREFLOP_STACK_PLAN_SAMPLES = 300;
/** The line-implied prior band of an open raise (HorseMind.bandFor's own value). */
export const OMAHA_PREFLOP_STACK_PLAN_OPEN_BAND: readonly [number, number] = [0.4, 1];

export interface OmahaPreflopStackPlanInput {
  hole: readonly Card[];
  dead: readonly Card[];
  toCall: number;
  /** the Horse's stack before the call */
  stack: number;
  /** the raiser's stack behind his bet */
  raiserStack: number;
  /** the pot before the call, every wager on the table included */
  pot: number;
  preflopRaises: number;
  outOfPosition: boolean;
  band: readonly [number, number] | null;
  /** the last raiser's seat (for the caller's read of his band) */
  raiserSeat?: number;
}

export interface OmahaPreflopStackPlanVerdict {
  fold: boolean;
  spr: number;
  playability: 'nut_maker' | 'one_pair_maker';
  equity: number;
  charge: number;
  evCall: number;
}

export function omahaPreflopStackPlan(
  i: OmahaPreflopStackPlanInput
): OmahaPreflopStackPlanVerdict | null {
  if (!omahaStrategyHoleCountServed(i.hole.length) || i.hole.length > 5) return null;
  if (!(i.toCall > 0.005) || !(i.pot > 0) || !(i.stack > 0) || i.preflopRaises < 1) return null;
  const call = Math.min(i.toCall, i.stack);
  if (i.stack <= call + 0.005) return null;
  const potAfter = i.pot + call;
  const behind = Math.max(0, Math.min(i.stack - call, i.raiserStack));
  const spr = behind / potAfter;
  if (!(spr < OMAHA_PREFLOP_STACK_PLAN_LOW_SPR)) return null;
  const hole = [...i.hole];
  const suitedAce = hole.some(
    (c) => c.rank === 'A' && hole.filter((d) => d.suit === c.suit).length >= 2
  );
  const nutMaker = omahaOopCoordinated(hole) !== null || suitedAce;
  const prior =
    i.preflopRaises >= 3
      ? OOP_PRIOR_BAND_FOUR_BET
      : i.preflopRaises === 2
        ? OOP_PRIOR_BAND_THREE_BET
        : OMAHA_PREFLOP_STACK_PLAN_OPEN_BAND;
  const [lo, hi] = i.band ?? prior;
  const equity = omahaReraisedEquity(
    hole,
    [],
    i.dead,
    (h) => {
      const p = omahaPreflopPercentile([...h], false);
      return p >= lo && p <= hi;
    },
    OMAHA_PREFLOP_STACK_PLAN_SAMPLES
  );
  if (equity === null) return null;
  const realisation =
    (i.outOfPosition ? OOP_REALIZATION_MARGIN : IP_REALIZATION_MARGIN) *
    (spr / OMAHA_PREFLOP_STACK_PLAN_LOW_SPR) *
    (nutMaker ? 0.5 : 1);
  const stackOff = nutMaker ? 0 : OMAHA_PREFLOP_STACK_PLAN_DOMINATION * Math.min(1, spr);
  const charge = realisation + stackOff;
  const evCall = (equity - charge) * (potAfter + 2 * behind) - (call + behind);
  return {
    fold: evCall < 0,
    spr,
    playability: nutMaker ? 'nut_maker' : 'one_pair_maker',
    equity,
    charge,
    evCall,
  };
}

interface PreflopAct {
  stage?: string;
  seat?: number;
  action?: string;
  isFullRaise?: boolean;
}

/**
 * The public spot of the preflop stack plan: PLO4/PLO5 (cash, or a
 * tournament hand inside the day's tournament scope), pot limit, one board,
 * high only, no bomb pot, not all-in-or-fold; preflop, a raise to call and a
 * fold legal; the last raiser is live and not all in and is the only
 * opponent who has put chips in voluntarily. Null outside it.
 */
export function omahaPreflopStackPlanSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaPreflopStackPlanInput | null {
  try {
    if (!omahaStrategyGameInScope(OMAHA_PREFLOP_STACK_PLAN_VARIANTS, gs)) return null;
    if (String(gs.stage ?? '') !== 'preflop') return null;
    if (gs.gameMode !== undefined && gs.gameMode !== 'cash' && omahaCashOnlyExcludes(hero, gs))
      return null;
    if (gs.bettingStructure !== undefined && gs.bettingStructure !== 'pot_limit') return null;
    if ((gs.boardCount ?? 1) !== 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.bombPot === true || gs.allInOrFold === true) return null;
    const hiLo = gs.variantRules
      ? gs.variantRules.splitLow8OrBetter
      : variantInfo(String(gs.gameVariant ?? '')).isHiLo;
    if (hiLo) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
    if (!Array.isArray(hero.cards) || hero.cards.length !== omahaStrategyHoleCount(gs)) return null;
    const toCall = omahaPlanToCall(hero, gs);
    if (!(toCall > 0.005)) return null;
    const history = (gs.actionHistory ?? []) as PreflopAct[];
    const preflopRaises = preflopRaiseCount(history as never);
    if (preflopRaises < 1) return null;
    let raiserSeat: number | undefined;
    for (let k = history.length - 1; k >= 0; k--) {
      const a = history[k];
      if (a.stage !== 'preflop' || a.seat === hero.seat) continue;
      if (a.action === 'raise' || a.action === 'bet' || a.action === 'all_in') {
        raiserSeat = a.seat;
        break;
      }
    }
    if (raiserSeat === undefined) return null;
    const raiser = (gs.players ?? []).find((p) => p.seat === raiserSeat);
    if (!raiser || raiser.is_folded || raiser.is_all_in || !(raiser.stack > 0)) return null;
    // the raiser is the only opponent with chips in voluntarily
    const voluntary = new Set<number>();
    for (const a of history)
      if (
        a.stage === 'preflop' &&
        a.seat !== hero.seat &&
        a.seat !== undefined &&
        ['call', 'raise', 'bet', 'all_in'].includes(String(a.action))
      )
        voluntary.add(a.seat);
    for (const s of voluntary) {
      if (s === raiserSeat) continue;
      const p = (gs.players ?? []).find((x) => x.seat === s);
      if (p && !p.is_folded) return null;
    }
    return {
      hole: hero.cards,
      dead: hero.knownDeadCards ?? [],
      toCall,
      stack: hero.stack,
      raiserStack: raiser.stack,
      pot: gs.pot,
      preflopRaises,
      outOfPosition:
        omahaPostflopOrder(hero.seat, gs.dealerSeat) <
        omahaPostflopOrder(raiser.seat, gs.dealerSeat),
      band: null,
      raiserSeat,
    };
  } catch {
    return null;
  }
}
