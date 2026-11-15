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
 */
import type { Card } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { SeatPlayer } from '../types.js';
import { omahaBoardShape, scoreOmahaHi, variantInfo } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';

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
  if (board.length !== 4 || (hole.length !== 4 && hole.length !== 5)) return null;
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
  for (let m = 0; m < M; m++) {
    const cards = hands[m].map((i) => unseen[i]);
    const own = hands[m];
    for (let r = 0; r < R; r++) {
      if (own.includes(r)) continue;
      full[4] = unseen[r];
      ranks[m * R + r] = scoreOmahaHi(cards, full);
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
    if (!OMAHA_STREET_PLAN_VARIANTS.has(variant)) return null;
    if (gs.gameMode !== undefined && gs.gameMode !== 'cash') return null;
    if (gs.bettingStructure !== undefined && gs.bettingStructure !== 'pot_limit') return null;
    if ((gs.boardCount ?? 1) !== 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.bombPot === true) return null;
    const hiLo = gs.variantRules ? gs.variantRules.splitLow8OrBetter : variantInfo(variant).isHiLo;
    if (hiLo) return null;
    const opp = live(hero, gs);
    if (opp.length !== 1 || opp[0].is_all_in || !(opp[0].stack > 0)) return null;
    if (!Array.isArray(hero.cards) || (hero.cards.length !== 4 && hero.cards.length !== 5))
      return null;
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
    return plan.lines[0].ev > plan.lines[1].ev + OMAHA_STREET_PLAN_MARGIN_POT_SHARE * gs.pot;
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
