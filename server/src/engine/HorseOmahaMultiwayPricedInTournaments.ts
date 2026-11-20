/**
 * OMAHA MULTIWAY IS PRICED IN TOURNAMENTS (HORSE DECISIONS lane, builder
 * F-FIX, 2026-11-19; option omahaMultiwayIsPricedInTournaments, default OFF,
 * read `=== true` by HorseLogic).
 *
 * Owner order 2026-11-17 11:49 America/Chicago: no blanket rule may decide a
 * Horse decision; every decision comes from the math, the Horse's hand, the
 * opponents' perceived ranges, equity and expected value. The size of a bet
 * never decides by itself.
 *
 * THE LEAKS (auditor F, archive plo-handoff-review-01a1cbbd/hvh48-audit-
 * 01TLQer7J/F-plo-tournament/REPORT.md, PLO4/5/6/8 tournaments against
 * people, 2026-11-17..19):
 *  - class 2, preflop multiway call-offs with dead equity (6 CLEAR, 3 LIKELY,
 *    19.5 bb; hands 26481a02, ab7eb573, 3333550b, 83b75804, 6dade3bd,
 *    88e6c8f3). The V25 PLO commitment zone (HorsePreflop.decidePreflopV7Core,
 *    ploCommitZone) reads a hold'em-style percentile bar, relieved by price
 *    and chips in, and charges a multiway pot only 0.04 per caller capped at
 *    0.08; PLO8 quartering is not priced at all.
 *  - class 3, postflop multiway bets that lose to checking (3 CLEAR, 3
 *    LIKELY; b070b36b, f9962d3c, 583495d0). The own-bet value tests of
 *    omahaBigDrawAggression, omahaStrongHandValueRule and omahaStreetPlanRules
 *    do not divide the Horse's equity across the opponents who continue.
 *
 * WHAT IT DECIDES (Omaha tournaments only: PLO4, PLO5, PLO6, PLO8 pot limit,
 * one board; cash, fixed limit and every other game are untouched).
 *
 * 1. PREFLOP CALL-OFF. The Horse calls (a call, or an all-in that puts in no
 *    more than the call) facing a bet (review N2: a raise or an all-in raise
 *    is worth its fold equity, which this price does not see, so it is left
 *    to the rules that price raises), two or more opponents are already in the pot (players still to act
 *    are not counted, which only overstates the call's equity), and the call
 *    leaves no more than the pot after it behind (stack-to-pot after the call
 *    at most 1: from there the equity is realised in full, so no realisation
 *    guess enters). The call is priced:
 *
 *      share = the Horse's expected share of the pot against one holding
 *              from each opponent's range, jointly (card removal between all
 *              hands), over random boards; PLO8 splits each board hi/lo,
 *              ties split, so scoops, halves and quarters are all priced.
 *      EV    = share x pot - (1 - share) x call x bf
 *
 *    with bf the engine's own pay-jump bubble factor
 *    (HorseLogic.payJumpBubbleFactor; 1 where the engine plays chip EV:
 *    no pay jump live, a PKO, a satellite, no trusted context). The
 *    continue stands unless EV is below zero by more than the sample's own
 *    standard error, then it is a fold. A fold is never made a call (one
 *    direction: the leak was the call-off).
 *
 * 2. MULTIWAY OWN BET. Flop, turn or river, nothing to call, a bet or raise
 *    (or all in), two or more live opponents. The bet is priced beside the
 *    check on the same sampled deals (common random numbers):
 *
 *      EV(check) = mean of share(all opponents) x pot
 *      EV(bet)   = mean over deals of: every opponent folds -> pot; else
 *                  share(continuing opponents) x (pot + matched + calls)
 *                  - matched
 *
 *    An opponent continues when his holding is in his continuing range on
 *    this board (below); an opponent all in from an earlier street always
 *    contests and adds nothing. The bet stands unless it is worth less than
 *    the check by more than OMAHA_MW_TOURNEY_BET_NOISE of the pot (the
 *    margin the multiway discipline uses), then it is a check. A check is
 *    never made a bet here (omahaMultiwayCheckedToBetIsPriced owns that cell
 *    in cash).
 *
 * RANGES. Each opponent's preflop range is the top `width` of hands by the
 * engine's own preflop percentile (omahaPreflopPercentile, hi-lo for PLO8),
 * the width read from his most aggressive preflop action this hand
 * (OMAHA_MW_TOURNEY_WIDTH: the population widths the auditor fitted; no
 * individual read yet). Postflop his CONTINUING range facing a bet is the
 * part of that range that holds two pair or better, a pair using a hole card
 * at or above the second board rank, or (flop and turn) a flush draw, eight
 * or more straight outs, or in PLO8 a made low or a nut-low draw. The class
 * line is the auditor's; it does not read the bet's size (the size enters
 * the expected value only). On the turn and the river his range also keeps
 * his line: on each earlier street on which he called, bet or raised, his
 * holding was in that street's continuing class or one of the floats
 * (OMAHA_MW_TOURNEY_FLOAT of the rest).
 *
 * Pure: no state, no telemetry, no draw from the brain's random stream (a
 * private generator seeded from the cards).
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaDrawQuality,
  omahaPreflopPercentile,
  scoreOmahaHi,
  scoreOmahaHiPartial,
  scoreOmahaLow,
  scoreOmahaLowPartial,
  variantInfo,
} from './HorseEval.js';
import { shortAllInSpot } from './HorseShortAllInCallFloor.js';
import { tournamentCrumbsSpot } from './HorseTournamentCrumbsCallFloor.js';

/** The games of the option: pot-limit Omaha with four, five or six cards, and PLO8. */
export const OMAHA_MW_TOURNEY_VARIANTS: ReadonlySet<string> = new Set([
  'plo4',
  'plo5',
  'plo6',
  'plo8',
]);

/** Deals sampled for one decision. */
export const OMAHA_MW_TOURNEY_SAMPLES = 600;

/**
 * Preflop range widths by an opponent's most aggressive action this hand
 * (share of all holdings, by the engine's preflop percentile). The auditor's
 * population widths (REPORT.md, Method): limp 60%, call 40%, open 32%, short
 * shove 45%, 3-bet 12%, 4-bet or more 5%, a blind that has not put more in
 * 100%; a cold call of a re-raise is between the 3-bet and the call (15%).
 */
export const OMAHA_MW_TOURNEY_WIDTH = Object.freeze({
  blind: 1,
  limp: 0.6,
  callOpen: 0.4,
  callReraise: 0.15,
  open: 0.32,
  threeBet: 0.12,
  fourBet: 0.05,
  shortShove: 0.45,
});

/** An all in for at most this many big blinds (his whole hand) is a short shove. */
export const OMAHA_MW_TOURNEY_SHORT_SHOVE_BB = 15;

/**
 * Of the holdings outside his continuing class, the share an opponent still
 * calls or bets with on an earlier street (floats and bluffs; the auditor's
 * base rates were 15% floats and 25% bluffs, this is their middle).
 */
export const OMAHA_MW_TOURNEY_FLOAT = 0.2;

/** The share of the pot by which a priced check must beat the bet (noise of the comparison). */
export const OMAHA_MW_TOURNEY_BET_NOISE = 0.02;

const EPS = 0.005;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const RANK_VALUE: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const cardKey = (c: Card): string => `${c.rank}:${c.suit}`;
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function isTournament(gs: HorseGameStateV2): boolean {
  if (gs.gameMode) return gs.gameMode === 'tournament';
  return gs.tournament != null;
}

function seedOf(cards: readonly Card[], salt: number): number {
  let h = 2166136261 ^ salt;
  for (const c of cards)
    for (const ch of cardKey(c)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
  return h >>> 0 || 1;
}

function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unseenDeck(seen: readonly Card[]): Card[] {
  const s = new Set(seen.map(cardKey));
  const out: Card[] = [];
  for (const rank of RANKS)
    for (const suit of SUITS) {
      const c = { rank, suit } as Card;
      if (!s.has(cardKey(c))) out.push(c);
    }
  return out;
}

/** The game facts the option reads, or null outside its games. */
export function omahaMwTourneyGame(
  gs: HorseGameStateV2
): { variant: string; hiLo: boolean; holeCount: number } | null {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_MW_TOURNEY_VARIANTS.has(variant)) return null;
  if (!isTournament(gs)) return null;
  const vi = variantInfo(variant);
  if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
  if (
    (gs.boardCount ?? 1) > 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0 ||
    gs.bombPot === true
  )
    return null;
  const hiLo = gs.variantRules ? gs.variantRules.splitLow8OrBetter === true : vi.isHiLo;
  return { variant, hiLo, holeCount: vi.holeCount };
}

/** The Horse's share of one pot (ties split; hi-lo halves split, a half with no low goes high). */
export function omahaMwPotShare(
  hero: readonly Card[],
  opps: readonly (readonly Card[])[],
  board: readonly Card[],
  hiLo: boolean
): number {
  const mine = scoreOmahaHi([...hero], [...board]);
  let best = mine;
  let tied = 1;
  for (const o of opps) {
    const s = scoreOmahaHi([...o], [...board]);
    if (s > best) {
      best = s;
      tied = 1;
    } else if (s === best) tied++;
  }
  const hi = mine === best ? 1 / tied : 0;
  if (!hiLo) return hi;
  const myLow = scoreOmahaLow([...hero], [...board]);
  let bestLow = myLow;
  let tiedLow = 1;
  for (const o of opps) {
    const l = scoreOmahaLow([...o], [...board]);
    if (l < bestLow) {
      bestLow = l;
      tiedLow = 1;
    } else if (l === bestLow) tiedLow++;
  }
  if (bestLow === Infinity) return hi;
  const lo = myLow === bestLow ? 1 / tiedLow : 0;
  return 0.5 * hi + 0.5 * lo;
}

export interface OmahaMwOpponent {
  seat: number;
  /** share of all holdings his preflop range holds */
  width: number;
  allIn: boolean;
  /** chips behind (for the call of a bet) */
  stack: number;
  /** earlier postflop streets of this hand on which he called, bet or raised (board length 3 or 4) */
  continuedOn: number[];
}

/**
 * Each live opponent's preflop width from his most aggressive preflop action
 * this hand. `inPotOnly`: preflop, only the opponents already in the pot (a
 * voluntary action, all in, or a blind that has acted); a player still to
 * act is left out.
 */
export function omahaMwOpponents(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  inPotOnly: boolean
): OmahaMwOpponent[] {
  const bb = fin(gs.bigBlind) && gs.bigBlind > 0 ? gs.bigBlind : 1;
  const W = OMAHA_MW_TOURNEY_WIDTH;
  const width = new Map<number, number>();
  const acted = new Set<number>();
  let raises = 0;
  const currentBet = fin(gs.currentBet) ? gs.currentBet : 0;
  const players = gs.players ?? [];
  for (const a of gs.actionHistory ?? []) {
    if (String(a.stage) !== 'preflop' || !fin(a.seat)) continue;
    const act = String(a.action);
    acted.add(a.seat);
    let w: number | null = null;
    if (act === 'raise' || act === 'bet') {
      raises++;
      w = raises === 1 ? W.open : raises === 2 ? W.threeBet : W.fourBet;
    } else if (act === 'all_in') {
      const p = players.find((x) => x.seat === a.seat);
      const total = p ? Math.max(fin(p.totalInvested) ? p.totalInvested : 0, p.bet ?? 0) : 0;
      // an all in that set the price is aggression; one under the price is a call
      const aggressive =
        a.isFullRaise === true || (p !== undefined && (p.bet ?? 0) >= currentBet - EPS);
      if (aggressive) {
        raises++;
        w =
          total / bb <= OMAHA_MW_TOURNEY_SHORT_SHOVE_BB
            ? W.shortShove
            : raises === 1
              ? W.open
              : raises === 2
                ? W.threeBet
                : W.fourBet;
      } else w = raises === 0 ? W.limp : raises === 1 ? W.callOpen : W.callReraise;
    } else if (act === 'call') {
      w = raises === 0 ? W.limp : raises === 1 ? W.callOpen : W.callReraise;
    } else if (act === 'check') {
      w = W.blind;
    }
    if (w !== null) width.set(a.seat, Math.min(width.get(a.seat) ?? 1, w));
  }
  const stageLen: Record<string, number> = { flop: 3, turn: 4 };
  const nowLen = { flop: 3, turn: 4, river: 5 }[String(gs.stage ?? '') as 'flop'] ?? 0;
  const continued = new Map<number, Set<number>>();
  for (const a of gs.actionHistory ?? []) {
    const len = stageLen[String(a.stage)];
    if (len === undefined || len >= nowLen || !fin(a.seat)) continue;
    const act = String(a.action);
    if (act !== 'call' && act !== 'bet' && act !== 'raise' && act !== 'all_in') continue;
    if (!continued.has(a.seat)) continued.set(a.seat, new Set());
    continued.get(a.seat)!.add(len);
  }
  const out: OmahaMwOpponent[] = [];
  for (const p of players) {
    if (p.seat === hero.seat || p.user_id === hero.user_id) continue;
    if (p.is_folded || p.is_sitting_out) continue;
    const allIn = p.is_all_in === true;
    if (inPotOnly && !acted.has(p.seat) && !allIn) continue;
    out.push({
      seat: p.seat,
      width: width.get(p.seat) ?? W.blind,
      allIn,
      stack: fin(p.stack) ? Math.max(0, p.stack) : 0,
      continuedOn: [...(continued.get(p.seat) ?? [])].sort(),
    });
  }
  return out;
}

/** True when a holding continues facing a bet on this board (the continuing class; see the header). */
export function omahaMwContinues(
  h: readonly Card[],
  board: readonly Card[],
  hiLo: boolean
): boolean {
  const hole = [...h];
  const b = [...board];
  const cat = Math.floor(scoreOmahaHiPartial(hole, b) / 0x100000);
  if (cat >= 3) return true;
  if (cat === 2) {
    const boardRanks = [...new Set(b.map((c) => RANK_VALUE[c.rank] ?? 0))].sort((x, y) => y - x);
    const second = boardRanks[1] ?? boardRanks[0] ?? 0;
    const holeRanks = hole.map((c) => RANK_VALUE[c.rank] ?? 0);
    const counts = new Map<number, number>();
    for (const r of holeRanks) counts.set(r, (counts.get(r) ?? 0) + 1);
    let pairRank = 0;
    for (const r of holeRanks) if (boardRanks.includes(r)) pairRank = Math.max(pairRank, r);
    for (const [r, n] of counts) if (n >= 2) pairRank = Math.max(pairRank, r);
    if (pairRank >= second && pairRank > 0) return true;
  }
  if (hiLo && b.length >= 3 && scoreOmahaLowPartial(hole, b) !== Infinity) return true;
  if (b.length === 3 || b.length === 4) {
    const d = omahaDrawQuality(hole, b, hiLo);
    if (d.nutFlushDraw || d.dominatedFlushDraw || d.straightOuts >= 8) return true;
    if (hiLo && d.nutLowDraw) return true;
  }
  return false;
}

/**
 * Deal `samples` times one holding per opponent from his range (rejection,
 * card removal across every hand) and the rest of the board; hand each deal
 * to `visit`. Returns the number of deals made (0: too few could be drawn).
 */
export function omahaMwDeals(
  hero: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[],
  inRange: readonly ((h: readonly Card[]) => boolean)[],
  samples: number,
  salt: number,
  visit: (opps: Card[][], run: Card[]) => void
): number {
  const size = hero.length;
  const need = 5 - board.length;
  const deck = unseenDeck([...hero, ...board, ...dead]);
  if (inRange.length === 0 || deck.length < size * inRange.length + need) return 0;
  const rnd = generator(seedOf([...hero, ...board], salt ^ (0x9e3779b9 * inRange.length)));
  const draw = (n: number, from: Card[]): Card[] => {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (from.length - i));
      const t = from[i];
      from[i] = from[j];
      from[j] = t;
    }
    return from.splice(0, n);
  };
  let got = 0;
  let tries = 0;
  const budget = samples * 200 * inRange.length;
  while (got < samples && tries < budget) {
    const d = deck.slice();
    const opps: Card[][] = [];
    for (const ok of inRange) {
      let found: Card[] | null = null;
      for (let k = 0; k < 200 && tries < budget && found === null; k++) {
        tries++;
        const probe = d.slice();
        const h = draw(size, probe);
        if (ok(h)) {
          found = h;
          d.length = 0;
          d.push(...probe);
        }
      }
      if (found === null) break;
      opps.push(found);
    }
    if (opps.length !== inRange.length) continue;
    visit(opps, [...board, ...draw(need, d)]);
    got++;
  }
  return got >= samples / 2 ? got : 0;
}

/** A fixed number in [0, 1) for a holding: decides which of the holdings outside a class are floats. */
function holdingDraw(h: readonly Card[], salt: number): number {
  return generator(
    seedOf(
      [...h].sort((a, b) => (cardKey(a) < cardKey(b) ? -1 : 1)),
      salt
    )
  )();
}

/**
 * His range: the top `width` of holdings by the preflop percentile, and on
 * each earlier postflop street on which he called, bet or raised, a holding
 * in his continuing class on that street's board or one of the floats
 * (OMAHA_MW_TOURNEY_FLOAT of the rest).
 */
function rangeOf(
  o: Pick<OmahaMwOpponent, 'width' | 'continuedOn'>,
  board: readonly Card[],
  hiLo: boolean
): (h: readonly Card[]) => boolean {
  const lo = 1 - Math.max(0.02, Math.min(1, o.width));
  const lines = o.continuedOn.filter((len) => len < board.length);
  return (h) => {
    if (lo > 1e-9 && omahaPreflopPercentile([...h], hiLo) < lo) return false;
    for (const len of lines)
      if (
        !omahaMwContinues(h, board.slice(0, len), hiLo) &&
        holdingDraw(h, 0xf10a7 + len) >= OMAHA_MW_TOURNEY_FLOAT
      )
        return false;
    return true;
  };
}

export interface OmahaMwCallOffVerdict {
  action: 'fold' | 'keep';
  share: number;
  /** standard error of the share */
  se: number;
  call: number;
  pot: number;
  bubbleFactor: number;
  /** share x pot - (1 - share) x call x bf, in chips */
  ev: number;
  /** the share the call needs: bf x call / (pot + bf x call) */
  required: number;
  widths: number[];
}

/** The preflop call-off spot, or null outside it (see the header, part 1). */
export function omahaMwCallOffSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  decision: HorseDecision
): { call: number; pot: number; opponents: OmahaMwOpponent[]; hiLo: boolean } | null {
  if (String(gs.stage ?? '') !== 'preflop') return null;
  const game = omahaMwTourneyGame(gs);
  if (!game) return null;
  // Review N2 (2026-11-19): only the call is priced here. A raise or an all-in that raises is worth its
  // fold equity and its extra chips, which this call price does not see, so it is left to the rules that
  // price raises; an all-in is priced only when it puts in no more than the call (an all-in call).
  const act = String(decision.action);
  if (act !== 'call' && act !== 'all_in') return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
  if (!Array.isArray(hero.cards) || hero.cards.length !== game.holeCount) return null;
  const stack = fin(hero.stack) ? Math.max(0, hero.stack) : 0;
  const heroBet = fin(hero.bet) ? Math.max(0, hero.bet) : 0;
  const toCall = fin(gs.toCall)
    ? Math.max(0, gs.toCall)
    : Math.max(0, (fin(gs.currentBet) ? gs.currentBet : 0) - heroBet);
  if (!(toCall > EPS) || !(stack > 0)) return null;
  if (act === 'all_in' && stack > toCall + EPS) return null;
  const pot = fin(gs.pot) ? Math.max(0, gs.pot) : 0;
  if (!(pot > 0)) return null;
  const call = Math.min(toCall, stack);
  // the call leaves no more than the pot behind: its equity is realised in full
  if (stack - call > pot + call + EPS) return null;
  const opponents = omahaMwOpponents(hero, gs, true);
  if (opponents.length < 2) return null;
  return { call, pot, opponents, hiLo: game.hiLo };
}

/** The priced call-off, or null when it cannot be priced. `bubbleFactor` null or below 1 reads as 1. */
export function omahaMwCallOffVerdict(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  decision: HorseDecision,
  bubbleFactor: number | null
): OmahaMwCallOffVerdict | null {
  const spot = omahaMwCallOffSpot(hero, gs, decision);
  if (!spot) return null;
  const ranges = spot.opponents.map((o) => rangeOf(o, [], spot.hiLo));
  let sum = 0;
  let sq = 0;
  const n = omahaMwDeals(
    hero.cards,
    [],
    hero.knownDeadCards ?? [],
    ranges,
    OMAHA_MW_TOURNEY_SAMPLES,
    0x51ca11,
    (opps, run) => {
      const s = omahaMwPotShare(hero.cards, opps, run, spot.hiLo);
      sum += s;
      sq += s * s;
    }
  );
  if (n === 0) return null;
  const share = sum / n;
  const se = Math.sqrt(Math.max(0, sq / n - share * share) / n);
  const bf = fin(bubbleFactor) && bubbleFactor > 1 ? bubbleFactor : 1;
  const ev = share * spot.pot - (1 - share) * spot.call * bf;
  const required = (bf * spot.call) / (spot.pot + bf * spot.call);
  // folded only when the call is priced below zero by more than the sample's own error
  const evHigh = (share + se) * spot.pot - (1 - share - se) * spot.call * bf;
  return {
    action: evHigh < 0 ? 'fold' : 'keep',
    share: Math.round(share * 10000) / 10000,
    se: Math.round(se * 10000) / 10000,
    call: spot.call,
    pot: spot.pot,
    bubbleFactor: bf,
    ev: Math.round(ev * 100) / 100,
    required: Math.round(required * 10000) / 10000,
    widths: spot.opponents.map((o) => o.width),
  };
}

export interface OmahaMwBetVerdict {
  action: 'check' | 'keep';
  evCheck: number;
  evBet: number;
  bet: number;
  opponents: number;
  /** share of deals in which every opponent folds */
  allFold: number;
  margin: number;
}

/** The multiway own-bet spot, or null outside it (see the header, part 2). */
export function omahaMwBetSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  decision: HorseDecision
): { bet: number; pot: number; opponents: OmahaMwOpponent[]; hiLo: boolean } | null {
  const stage = String(gs.stage ?? '');
  const boardLen = { flop: 3, turn: 4, river: 5 }[stage as 'flop' | 'turn' | 'river'];
  if (boardLen === undefined) return null;
  const game = omahaMwTourneyGame(gs);
  if (!game) return null;
  if ((gs.communityCards ?? []).length !== boardLen) return null;
  const act = String(decision.action);
  if (act !== 'bet' && act !== 'raise' && act !== 'all_in') return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
  if (!Array.isArray(hero.cards) || hero.cards.length !== game.holeCount) return null;
  const stack = fin(hero.stack) ? Math.max(0, hero.stack) : 0;
  const heroBet = fin(hero.bet) ? Math.max(0, hero.bet) : 0;
  const toCall = fin(gs.toCall)
    ? Math.max(0, gs.toCall)
    : Math.max(0, (fin(gs.currentBet) ? gs.currentBet : 0) - heroBet);
  if (toCall > EPS || !(stack > 0)) return null;
  const pot = fin(gs.pot) ? Math.max(0, gs.pot) : 0;
  if (!(pot > 0)) return null;
  const bet =
    act === 'all_in'
      ? stack
      : fin(decision.amount)
        ? Math.min(stack, Math.max(0, decision.amount - heroBet))
        : 0;
  if (!(bet > EPS)) return null;
  const opponents = omahaMwOpponents(hero, gs, false);
  if (opponents.length < 2) return null;
  return { bet, pot, opponents, hiLo: game.hiLo };
}

/** The priced multiway bet against the check, or null when it cannot be priced. */
export function omahaMwBetVerdict(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  decision: HorseDecision
): OmahaMwBetVerdict | null {
  const spot = omahaMwBetSpot(hero, gs, decision);
  if (!spot) return null;
  const board = gs.communityCards ?? [];
  const ranges = spot.opponents.map((o) => rangeOf(o, board, spot.hiLo));
  const B = spot.bet;
  let check = 0;
  let bet = 0;
  let allFold = 0;
  const n = omahaMwDeals(
    hero.cards,
    board,
    hero.knownDeadCards ?? [],
    ranges,
    OMAHA_MW_TOURNEY_SAMPLES,
    0xbe7c4e,
    (opps, run) => {
      check += omahaMwPotShare(hero.cards, opps, run, spot.hiLo) * spot.pot;
      const contest: Card[][] = [];
      let matched = 0;
      let calls = 0;
      let callers = 0;
      spot.opponents.forEach((o, j) => {
        if (o.allIn) {
          contest.push(opps[j]);
          return;
        }
        if (!omahaMwContinues(opps[j], board, spot.hiLo)) return;
        contest.push(opps[j]);
        const c = Math.min(B, o.stack);
        calls += c;
        matched = Math.max(matched, c);
        callers++;
      });
      if (contest.length === 0) {
        bet += spot.pot;
        allFold++;
        return;
      }
      if (callers === 0) {
        // only earlier all-ins contest: the bet is not matched and comes back
        bet += omahaMwPotShare(hero.cards, contest, run, spot.hiLo) * spot.pot;
        return;
      }
      bet +=
        omahaMwPotShare(hero.cards, contest, run, spot.hiLo) * (spot.pot + matched + calls) -
        matched;
    }
  );
  if (n === 0) return null;
  const evCheck = check / n;
  const evBet = bet / n;
  const margin = OMAHA_MW_TOURNEY_BET_NOISE * spot.pot;
  return {
    action: evBet < evCheck - margin ? 'check' : 'keep',
    evCheck: Math.round(evCheck * 100) / 100,
    evBet: Math.round(evBet * 100) / 100,
    bet: B,
    opponents: spot.opponents.length,
    allFold: Math.round((allFold / n) * 10000) / 10000,
    margin: Math.round(margin * 100) / 100,
  };
}

/**
 * Where the rule may turn `decision` around: 'call_off' (preflop, the call-off spot, and neither the short
 * all-in floor nor the crumbs floor owns it), 'bet' (postflop, the multiway own-bet spot), else null. Pure,
 * reads only the request. The rule (HorseLogic.omahaMultiwayIsPricedInTournamentsRule) prices only here, and
 * the receipt validator admits its conversions only here (omahaMwTourneyAdmits), so the two cannot drift.
 */
export function omahaMwTourneyRuleSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  decision: HorseDecision
): 'call_off' | 'bet' | null {
  if (String(gs.stage ?? '') === 'preflop') {
    if (!omahaMwCallOffSpot(hero, gs, decision)) return null;
    if (shortAllInSpot(hero, gs) !== null || tournamentCrumbsSpot(hero, gs) !== null) return null;
    return 'call_off';
  }
  return omahaMwBetSpot(hero, gs, decision) ? 'bet' : null;
}

/**
 * The receipt validator's admission of the rule's two conversions (review N1, 2026-11-19), read only under
 * the decision's own option (HorseDecisionReceiptContext.omahaMultiwayPricedInTournaments):
 *  - preflop, a call (the node may have entered as a raise or an all-in that an owner inside it made the
 *    call) -> the fold, where the call-off spot re-derived on the request holds for the call;
 *  - postflop, a bet, raise or all-in facing no bet -> the check, where the multiway own-bet spot
 *    re-derived on the request holds for that wager.
 * The verdict itself is not re-run: the node may resize a bet before the rule prices it (the public size),
 * and the call-off price reads the engine's pay-jump bubble factor. A fold and a check put no chip in.
 */
export function omahaMwTourneyAdmits(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  previous: { action: string; amount?: number | null },
  after: string
): boolean {
  try {
    if (after === 'fold')
      return (
        String(gs.stage ?? '') === 'preflop' &&
        ['call', 'raise', 'all_in'].includes(previous.action) &&
        omahaMwTourneyRuleSpot(hero, gs, { action: 'call', thinkTime: 0 }) === 'call_off'
      );
    if (after === 'check')
      return (
        String(gs.stage ?? '') !== 'preflop' &&
        ['bet', 'raise', 'all_in'].includes(previous.action) &&
        omahaMwTourneyRuleSpot(hero, gs, {
          action: previous.action as HorseDecision['action'],
          ...(fin(previous.amount) ? { amount: previous.amount } : {}),
          thinkTime: 0,
        }) === 'bet'
      );
    return false;
  } catch {
    return false;
  }
}
