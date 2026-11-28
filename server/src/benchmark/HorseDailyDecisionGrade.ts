/**
 * HORSE DAILY DECISION GRADE - where Horses lose chips to people, per spot
 * class, graded on real cards (2026-11-20).
 *
 * Pure. No network, no clock, no database: the CLI
 * (scripts/horse-daily-decision-grade.ts) fetches with bounded read-only
 * SELECTs and hands the rows here.
 *
 * WHAT IT READS. Since about 1:12 PM Chicago on 2026-11-20 every Horse's dealt
 * hole cards are kept for every hand in the private Horse dealt-cards table
 * (#11511; service-role read only, no client path; only the CLI names it). Before that only hands
 * that reached showdown carried cards. The report joins those cards to the
 * public action line of hand_history and to ca_hand_facts' realised nets.
 *
 * OWNER RULE (2026-11-13 23:42 Chicago). The exact mucked hole cards of a
 * person's hand folded with no chips in are never stored or reconstructed.
 * A person's cards reach this report from exactly two places, both filtered
 * inside the database so nothing else leaves it:
 *   1. a showdown: cards the person showed (hand_history.showdown, not mucked);
 *   2. ca_hand_facts.hole_cards of a person who PUT CHIPS IN (invested > 0)
 *      AND WENT ALL-IN in the hand. Those rows are stored already (the owner
 *      rule forbids only the cards of a hand folded with no chips in, and
 *      ca_hand_facts keeps none for such a hand); a person who put no chips in
 *      is never read, by the SQL (invested > 0) and again here (a row whose
 *      fact shows nothing invested, or that belongs to a Horse, is dropped).
 *      These cards are used ONLY to grade a Horse's FOLD or CALL heads-up
 *      facing that person's ALL-IN, and for nothing else (no class, no bet,
 *      no raise, no multiway spot, no check comparison).
 * Output is aggregate: no hole card and no hand id is printed; people appear
 * by table alias only.
 *
 * WHAT IS GRADED. Every Horse decision facing a person's wager (the street's
 * last bettor or raiser is a person), and every unopened Horse bet with a
 * person still live. DECLARED before the first run, sign: + = the Horse lost.
 *
 *   fold   forgone call EV on real cards, eq x (pot + toCall) - toCall in bb,
 *          eq = all-in equity against the real cards of every live opponent
 *          (InsuranceEquity: exact enumeration, the engine's own evaluator).
 *          Basis `fold_all_in_exact` when the call would end the betting (the
 *          Horse or every opponent all-in): pot odds against all-in equity.
 *          Heads-up facing a person's all-in, the person's cards come from the
 *          showdown or, failing that, from rule 2 above (chips in, all-in).
 *          Basis `fold_showdown_equity` otherwise, only when every live person
 *          showed at showdown: realisation 1, no later betting (an ASSUMPTION;
 *          the same one the PLO lead's LIVEGRADE declared). Preflop folds are
 *          graded only on the all-in basis.
 *   call   heads-up facing a person's all-in, with the person's cards known
 *          (showdown or rule 2): basis `call_all_in_exact`, the call's EV on
 *          real cards against folding, -(eq x (pot + toCall) - toCall). Any
 *          other call: the realised result, as a raise.
 *   raise  the realised result from the decision point in bb: the Horse's
 *          hand net plus what it had already put in before the decision
 *          (sunk), negated = the realised result against folding there.
 *   bet    (unopened) against CHECKING where the check is knowable: the check
 *          would close the street (every other live seat that can act has
 *          already checked), the hand's final five-card board is stored (no
 *          run-it-twice) and every live opponent's cards are known (a Horse's
 *          kept cards; a person's only from the showdown, never rule 2). The
 *          check's value is the Horse's real share of the pot on that board,
 *          eq x pot; loss = (eq x pot - realised result from the decision
 *          point). On the river the check ends the hand: basis
 *          `bet_vs_check_river_exact`. On the flop or turn the next street is
 *          the stored one and later betting is ASSUMED away (realisation 1):
 *          basis `bet_vs_check_showdown`. Otherwise the bet is graded against
 *          giving the pot up (basis `realised`) and kept in its own class
 *          ("bet vs give up"), never mixed with "bet vs check".
 *   anything else is UNGRADED with its reason. Nothing is guessed.
 *
 * A heads-up fold to a person's (non all-in) bet can never be graded (the
 * hand ends, nothing is shown, and rule 2 does not apply): the report counts
 * them, it does not estimate them. Graded non-all-in folds are therefore
 * multiway folds whose bettor later showed down, a selected sample.
 *
 * VARIANTS. NLH, PLO4, PLO5 and PLO6 are graded. PLO8 (hi-lo split pots: the
 * high-only equity above would misprice every decision) and every other
 * variant are left out EXPLICITLY: the report counts their hands with a
 * person dealt in, per variant, from a separate count statement.
 *
 * One hand can carry several decisions of one Horse, each graded on the same
 * hand result, so the standard error is clustered by hand. A class is flagged
 * only when its mean is beyond 1 SE and n >= 10 (and, when over 80% of the class
 * is against one person, only if it still flags without that person: otherwise
 * "one person", ONE_PERSON_SHARE); the same table is shown with
 * the most frequent person excluded (owner rule: results must hold without
 * the most frequent opponent).
 *
 * Tournament decisions are graded in chips / big blind, not in prize equity.
 * The person / Horse split is DATA IDENTIFICATION ONLY (CLAUDE.md 10.5):
 * nothing here feeds a strategy. NEVER call the Horses "bots".
 */
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  holdemPreflopScore,
  nextCardOutlook,
  nlhNutStatus,
  omahaDrawQuality,
  omahaMadeClass,
  omahaNutStatus,
  omahaPreflopPercentile,
  scoreHoldem,
  scoreOmahaHi,
  scoreOmahaHiPartial,
  variantInfo,
} from '../engine/HorseEval.js';
/**
 * All-in equity calculator, injected by the caller (the CLI passes the engine's
 * insuranceEquity). This module never imports a synchronous Monte Carlo
 * calculator itself, so it keeps the live-thread worker boundary
 * (SyncMonteCarloWorkerBoundary.guard.test.ts).
 */
export type EquityFn = (
  hero: Card[],
  opponents: Card[][],
  board: Card[],
  variant: string
) => { equity: number };
import { isReadOnlyStatement } from './RiverBluffLiveReport.js';

export const REPORT_SCHEMA = 'horse-daily-decision-grade/v1';
export const VARIANTS = ['nlh', 'plo4', 'plo5', 'plo6'] as const;
/** First instant every Horse's dealt cards are kept (first row of the table). */
export const ALL_HORSE_CARDS_KEPT_FROM = '2026-11-20T19:12:44Z';
export const FLAG_MIN_N = 10;
export const TOP_CLASSES = 15;

// ─────────────────────────────────────────────────────────────────────────────
// Input shapes (one row per hand, as renderHandsSql builds them)
// ─────────────────────────────────────────────────────────────────────────────

/** publicNode seat tuple (HorsePublicActionNode): [seat, behind, street wager, invested, dead invested,
 *  individual ante, flags], flags = folded 1 + all-in 2 + sitting out 4. */
export type SeatTuple = [number, number, number, number, number, number, number];

export interface RawAction {
  seat: number;
  stage: string;
  action: string;
  amount: number | null;
  origin: string | null;
  pot: number | null;
  toCall: number | null;
  currentBet: number | null;
  board: string | null;
  seats: SeatTuple[] | null;
}
export interface RawFact {
  uid: string;
  seat: number;
  net: number | null;
  net_bb: number | null;
  invested: number | null;
  horse: boolean;
  alias: string | null;
}
export interface RawHand {
  id: string;
  created_at: string;
  g: string;
  bb: number;
  tournament: boolean;
  ltg: boolean;
  bomb: boolean;
  build: string | null;
  acts: RawAction[] | null;
  facts: RawFact[] | null;
  horse_cards: Array<{ uid: string; seat: number; cards: string[] }> | null;
  /** user id -> cards, ONLY for seats that showed at showdown. */
  shown: Record<string, unknown> | null;
  /**
   * user id -> ca_hand_facts.hole_cards, ONLY for a person (not a Horse) who put chips in
   * (invested > 0) and went all-in in this hand. Used only for a heads-up fold or call
   * facing that person's all-in.
   */
  allin_cards?: Record<string, unknown> | null;
  /** hand_history.community_cards: the hand's final board (for a bet graded against checking). */
  final_board?: unknown;
  /** the hand ran the board more than once (no single final board) */
  rit?: boolean | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only SQL
// ─────────────────────────────────────────────────────────────────────────────

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** One bounded SELECT for [start, end): hands with a person dealt in. */
export function renderHandsSql(start: string, end: string, horseCardsTable: string): string {
  if (!TS.test(start) || !TS.test(end)) throw new Error('START and END must be UTC instants (…Z)');
  if (!/^[a-z_]+\.[a-z_]+$/.test(horseCardsTable))
    throw new Error('horseCardsTable must be schema.table');
  const sql = `select h.id, h.created_at, h.game_variant as g, h.big_blind as bb,
 (h.tournament_id is not null) as tournament,
 exists(select 1 from lightning_hand lh where lh.hand_history_id = h.id) as ltg,
 (h.bomb_pot is not null and jsonb_typeof(h.bomb_pot) <> 'null') or h.community_cards2 is not null as bomb,
 h.engine_build as build,
 (select jsonb_agg(jsonb_build_object('seat', a->'seat', 'stage', a->'stage', 'action', a->'action',
    'amount', a->'amount', 'origin', a->'origin', 'pot', a->'publicNode'->'pot',
    'toCall', a->'publicNode'->'toCall', 'currentBet', a->'publicNode'->'currentBet',
    'board', a->'publicNode'->'boards'->0, 'seats', a->'publicNode'->'seats') order by o)
    from jsonb_array_elements(h.actions) with ordinality t(a, o)) as acts,
 (select jsonb_agg(jsonb_build_object('uid', f.user_id, 'seat', f.seat, 'net', f.net, 'net_bb', f.net_bb,
    'invested', f.invested, 'horse', coalesce(p.is_horse, false), 'alias', p.username))
    from ca_hand_facts f left join profiles p on p.id = f.user_id where f.hand_id = h.id) as facts,
 (select jsonb_agg(jsonb_build_object('uid', c.user_id, 'seat', c.seat, 'cards', c.hole_cards))
    from ${horseCardsTable} c where c.hand_id = h.id) as horse_cards,
 (select jsonb_object_agg(s->>'user_id', h.hole_cards->(s->>'user_id'))
    from jsonb_array_elements(case when jsonb_typeof(h.showdown) = 'array' then h.showdown else '[]'::jsonb end) s
    where coalesce((s->>'mucked')::boolean, false) = false and h.hole_cards ? (s->>'user_id')) as shown,
 (select jsonb_object_agg(f.user_id, f.hole_cards)
    from ca_hand_facts f join profiles p on p.id = f.user_id
    where f.hand_id = h.id and p.is_horse is not true and f.invested > 0 and f.was_all_in is true
      and f.hole_cards is not null) as allin_cards,
 to_jsonb(h.community_cards) as final_board,
 coalesce(jsonb_typeof(h.rit_boards), 'null') <> 'null' as rit
from hand_history h
where h.created_at >= '${start}' and h.created_at < '${end}' and h.has_human is true
  and h.game_variant in (${VARIANTS.map((v) => `'${v}'`).join(', ')})`;
  if (!isReadOnlyStatement(sql)) throw new Error('rendered statement is not read-only');
  return sql;
}

/** Hands with a person dealt in, per variant this report does not grade (PLO8 and the rest). */
export function renderExcludedSql(start: string, end: string): string {
  if (!TS.test(start) || !TS.test(end)) throw new Error('START and END must be UTC instants (…Z)');
  const sql = `select h.game_variant as g, count(*)::int as n
from hand_history h
where h.created_at >= '${start}' and h.created_at < '${end}' and h.has_human is true
  and h.game_variant not in (${VARIANTS.map((v) => `'${v}'`).join(', ')})
group by h.game_variant`;
  if (!isReadOnlyStatement(sql)) throw new Error('rendered statement is not read-only');
  return sql;
}

/** The option rows now, and every audited change since `start`. */
export function renderSwitchSql(start: string): string {
  if (!TS.test(start)) throw new Error('START must be a UTC instant (…Z)');
  const sql = `select
 (select jsonb_agg(jsonb_build_object('option', s.option, 'state', s.state, 'updated_at', s.updated_at) order by s.option)
    from ca_horse_style_switch s) as rows,
 (select jsonb_agg(jsonb_build_object('option', a.option, 'old_state', a.old_state, 'new_state', a.new_state,
    'changed_at', a.changed_at) order by a.changed_at)
    from ca_horse_style_switch_audit a where a.changed_at >= '${start}') as audit`;
  if (!isReadOnlyStatement(sql)) throw new Error('rendered statement is not read-only');
  return sql;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time (owner rule: every time shown is Central, America/Chicago)
// ─────────────────────────────────────────────────────────────────────────────

const CHICAGO = 'America/Chicago';

function chicagoOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (
    Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) -
    Math.floor(utcMs / 1000) * 1000
  );
}

/** An instant from text: with Z or an offset as written, without one as Chicago wall time. */
export function parseInstant(text: string): number {
  const t = text.trim().replace(' ', 'T');
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const ms = Date.parse(t);
    if (!Number.isFinite(ms)) throw new Error(`${text} is not a time`);
    return ms;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m)
    throw new Error(
      `${text} is not a time (use 2026-11-20T13:12 for Chicago, or an explicit offset)`
    );
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let utc = wall - chicagoOffsetMs(wall);
  utc = wall - chicagoOffsetMs(utc);
  return utc;
}

export const utcIso = (ms: number): string =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export function chicagoStamp(ms: number): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: CHICAGO,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms)) + ' Chicago'
  );
}

export function chicagoDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** [start, end) in slices of `minutes` (the last may be shorter). */
export function timeSlices(
  startMs: number,
  endMs: number,
  minutes: number
): Array<[string, string]> {
  if (!(minutes >= 1 && minutes <= 240)) throw new Error('slice minutes must be in [1, 240]');
  if (!(endMs > startMs)) throw new Error('the window is empty');
  if (endMs - startMs > 8 * 86_400_000) throw new Error('the window is longer than 8 days');
  const out: Array<[string, string]> = [];
  for (let t = startMs; t < endMs; t += minutes * 60_000)
    out.push([utcIso(t), utcIso(Math.min(endMs, t + minutes * 60_000))]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards and classes (the engine's own helpers; nothing re-derived here)
// ─────────────────────────────────────────────────────────────────────────────

const SUIT: Record<string, CardSuit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANKS = new Set(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);

function oneCard(v: unknown): Card | null {
  let rank: string | undefined;
  let suit: string | undefined;
  if (typeof v === 'string') {
    const m = /^(10|[2-9TJQKA])([shdc])/i.exec(v.trim());
    if (!m) return null;
    rank = m[1];
    suit = m[2];
  } else if (v && typeof v === 'object') {
    rank = String((v as { rank?: unknown }).rank ?? '');
    suit = String((v as { suit?: unknown }).suit ?? '');
  }
  if (!rank || !suit) return null;
  rank = rank.toUpperCase() === '10' ? 'T' : rank.toUpperCase();
  const s = SUIT[suit[0].toLowerCase()];
  if (!RANKS.has(rank) || !s) return null;
  return { rank: rank as CardRank, suit: s };
}

/** Cards from ['As','Kd'], [{rank,suit}] or a packed board string 'AsTd6s'; null unless every card parses and is distinct. */
export function parseCards(value: unknown): Card[] | null {
  let items: unknown[];
  if (typeof value === 'string') items = value.match(/(10|[2-9TJQKAtjqka])[shdcSHDC]/g) ?? [];
  else if (Array.isArray(value)) items = value;
  else return null;
  const cards = items.map(oneCard);
  if (cards.some((c) => c === null)) return null;
  const done = cards as Card[];
  if (new Set(done.map((c) => c.rank + c.suit)).size !== done.length) return null;
  return done;
}

const isOmaha = (g: string) => g.startsWith('plo');
const CATEGORY = [
  '',
  'high card',
  'pair',
  'two pair',
  'trips',
  'straight',
  'flush',
  'full house',
  'quads',
  'straight flush',
];

function band(x: number): string {
  if (x >= 0.9) return 'preflop top 10%';
  if (x >= 0.7) return 'preflop 70-90%';
  if (x >= 0.4) return 'preflop 40-70%';
  return 'preflop bottom 40%';
}

/** Made-hand and draw class of a Horse's cards on this board, from the engine's classifiers. */
export function horseHandClass(variant: string, hole: Card[], board: Card[]): string {
  if (board.length < 3) {
    if (isOmaha(variant))
      return hole.length >= 4 ? band(omahaPreflopPercentile(hole, false)) : 'preflop unknown';
    return hole.length === 2
      ? band(holdemPreflopScore(hole[0], hole[1], false))
      : 'preflop unknown';
  }
  const river = board.length >= 5;
  if (isOmaha(variant)) {
    const made = omahaMadeClass(hole, board);
    let name: string = made.cls;
    if (made.cls === 'strong') {
      const nut = omahaNutStatus(hole, board);
      if (made.category === 6) name = nut.higherFlushRanks === 0 ? 'nut flush' : 'non-nut flush';
      else if (made.category === 5) name = nut.straightIsNut ? 'nut straight' : 'non-nut straight';
      else name = CATEGORY[made.category] ?? 'strong';
    }
    if (!river) {
      const d = omahaDrawQuality(hole, board, false);
      if (d.nutty) name += ' + nut draw';
      else if (d.nutFlushDraw || d.dominatedFlushDraw || d.straightOuts >= 8) name += ' + draw';
    }
    return name;
  }
  const nut = nlhNutStatus(hole, board, false);
  let name = CATEGORY[nut.cat] ?? 'unknown';
  if (nut.cat === 6) name = nut.higherFlushRanks === 0 ? 'nut flush' : 'non-nut flush';
  if (!river && nut.cat <= 2 && nextCardOutlook(hole, board, variantInfo(variant)).good.length >= 9)
    name += ' + draw';
  return name;
}

export function sizeBucket(fraction: number): string {
  if (!(fraction > 0)) return 'unknown size';
  if (fraction <= 0.34) return '<=33% pot';
  if (fraction <= 0.67) return '34-66% pot';
  if (fraction <= 1.01) return '67-100% pot';
  return '>100% pot';
}

// ─────────────────────────────────────────────────────────────────────────────
// Grading one hand
// ─────────────────────────────────────────────────────────────────────────────

export type Pool = 'Lightning' | 'table' | 'tournament';
export type Basis =
  | 'fold_all_in_exact'
  | 'fold_showdown_equity'
  | 'call_all_in_exact'
  | 'bet_vs_check_river_exact'
  | 'bet_vs_check_showdown'
  | 'realised';
export type Ungraded =
  | 'person_cards_not_shown'
  | 'preflop_fold_not_all_in'
  | 'no_horse_cards'
  | 'no_board'
  | 'no_result';

export interface GradedDecision {
  hand: string;
  game: string;
  pool: Pool;
  street: string;
  /** 'facing <size>' | 'facing raise' | 'facing open' | 'facing 3-bet+' | 'unopened <size>' */
  situation: string;
  action: 'fold' | 'call' | 'raise' | 'bet';
  cls: string;
  headsUp: boolean;
  /** aliases of the people this decision is against (the bettor, or the live people for an unopened bet) */
  persons: string[];
  /** bb, + = the Horse lost; null when ungraded */
  lossBb: number | null;
  basis: Basis | null;
  ungraded: Ungraded | null;
  /** where the person's cards came from, for a fold or call graded on them */
  personCards?: 'showdown' | 'chips_in_all_in' | null;
}

const EPS = 1e-9;
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const FOLDED = 1;
const ALL_IN = 2;
const SITTING_OUT = 4;

export function poolOf(h: Pick<RawHand, 'tournament' | 'ltg'>): Pool {
  return h.tournament ? 'tournament' : h.ltg ? 'Lightning' : 'table';
}

/** Every gradeable Horse decision of one hand. Bomb pots and unsupported variants yield none. */
export function gradeHand(h: RawHand, equity: EquityFn): GradedDecision[] {
  const out: GradedDecision[] = [];
  const facts = h.facts ?? [];
  const acts = h.acts ?? [];
  const bb = num(h.bb);
  if (h.bomb || !(VARIANTS as readonly string[]).includes(h.g) || !(bb > 0)) return out;
  if (acts.some((a) => a.action === 'bomb_ante')) return out;
  const bySeat = new Map<number, RawFact>(facts.map((f) => [f.seat, f]));
  if (!facts.some((f) => !f.horse) || !facts.some((f) => f.horse)) return out;

  // Horses' kept cards, and people's cards ONLY from a showdown.
  const cards = new Map<string, Card[]>();
  const personShown = new Set<string>();
  for (const c of h.horse_cards ?? []) {
    const parsed = parseCards(c.cards);
    if (parsed) cards.set(c.uid, parsed);
  }
  for (const [uid, shown] of Object.entries(h.shown ?? {})) {
    if (cards.has(uid)) continue;
    const parsed = parseCards(shown);
    if (parsed) {
      cards.set(uid, parsed);
      personShown.add(uid);
    }
  }
  // Owner rule: a person's stored cards are read only when that person put chips in and went
  // all-in; a Horse row or a fact with nothing invested is dropped even if the query returned it.
  const allInCards = new Map<string, Card[]>();
  for (const [uid, value] of Object.entries(h.allin_cards ?? {})) {
    const f = facts.find((x) => x.uid === uid);
    if (!f || f.horse || !(num(f.invested) > 0)) continue;
    const parsed = parseCards(value);
    if (parsed) allInCards.set(uid, parsed);
  }
  const finalBoard = h.rit ? null : parseCards(h.final_board ?? null);
  const pool = poolOf(h);
  let street = '';
  let lastAgg: { seat: number; fraction: number; order: number } | null = null;
  let aggs = 0;
  let acted = new Set<number>();

  for (const a of acts) {
    if (!a.seats || a.origin === 'forced' || a.pot == null) continue;
    if (a.stage !== street) {
      street = a.stage;
      lastAgg = null;
      aggs = 0;
      acted = new Set<number>();
    }
    const seats = new Map<number, SeatTuple>(a.seats.map((s) => [s[0], s]));
    const me = seats.get(a.seat);
    const fact = bySeat.get(a.seat);
    if (!me || !fact) continue;
    const toCall = num(a.toCall);
    const pot = num(a.pot);
    const amount = num(a.amount);
    const stack = num(me[1]);
    const added =
      a.action === 'call' || a.action === 'bet'
        ? amount
        : a.action === 'raise' || a.action === 'all_in'
          ? Math.max(0, amount - num(me[2]))
          : 0;
    const aggressive =
      a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && added > toCall + EPS);
    const live = [...seats.values()].filter(
      (s) => s[0] !== a.seat && (num(s[6]) & (FOLDED | SITTING_OUT)) === 0 && bySeat.has(s[0])
    );
    const livePersons = live.filter((s) => !bySeat.get(s[0])!.horse);
    const allInSeat = (s: SeatTuple) => (num(s[6]) & ALL_IN) !== 0 || num(s[1]) <= EPS;

    const facingPerson =
      toCall > EPS && lastAgg !== null && bySeat.get(lastAgg.seat)?.horse === false;
    const unopenedBet = toCall <= EPS && aggressive && livePersons.length > 0;
    if (
      fact.horse &&
      live.length > 0 &&
      (facingPerson || unopenedBet) &&
      ['fold', 'call', 'raise', 'bet', 'all_in'].includes(a.action)
    ) {
      const action: GradedDecision['action'] = unopenedBet
        ? 'bet'
        : a.action === 'all_in'
          ? aggressive
            ? 'raise'
            : 'call'
          : (a.action as 'fold' | 'call' | 'raise');
      let situation: string;
      if (unopenedBet) situation = `unopened ${sizeBucket(pot > 0 ? added / pot : 0)}`;
      else if (street === 'preflop')
        situation = lastAgg!.order <= 1 ? 'facing open' : 'facing 3-bet+';
      else
        situation = lastAgg!.order > 1 ? 'facing raise' : `facing ${sizeBucket(lastAgg!.fraction)}`;
      const alias = (s: number) => bySeat.get(s)?.alias ?? `seat ${s}`;
      const persons = facingPerson ? [alias(lastAgg!.seat)] : livePersons.map((s) => alias(s[0]));
      const hero = cards.get(fact.uid) ?? null;
      const board = parseCards(a.board ?? '') ?? [];
      const d: GradedDecision = {
        hand: h.id,
        game: h.g,
        pool,
        street,
        situation,
        action,
        cls: hero ? horseHandClass(h.g, hero, board) : 'cards not kept',
        headsUp: live.length === 1,
        persons,
        lossBb: null,
        basis: null,
        ungraded: null,
      };
      // Heads-up against the person whose wager this is, and that person is all-in: the only
      // spot where the person's stored (chips-in, all-in) cards may be read.
      const bettor = facingPerson ? (seats.get(lastAgg!.seat) ?? null) : null;
      const vsAllInHeadsUp =
        bettor !== null && live.length === 1 && live[0][0] === bettor[0] && allInSeat(bettor);
      const bettorCards = (): { cards: Card[]; from: 'showdown' | 'chips_in_all_in' } | null => {
        const uid = bettor ? bySeat.get(bettor[0])!.uid : '';
        const shown = cards.get(uid);
        if (shown) return { cards: shown, from: 'showdown' };
        const kept = vsAllInHeadsUp ? allInCards.get(uid) : undefined;
        return kept ? { cards: kept, from: 'chips_in_all_in' } : null;
      };
      // A call for less than the wager risks only the stack; the uncovered part goes back to the bettor.
      const pay = Math.min(toCall, stack);
      const potFor = pot - (toCall - pay);
      if (action === 'fold') {
        const opp = vsAllInHeadsUp
          ? [bettorCards()?.cards ?? null]
          : live.map((s) => cards.get(bySeat.get(s[0])!.uid) ?? null);
        const closes = toCall >= stack - EPS || live.every(allInSeat);
        if (!hero) d.ungraded = 'no_horse_cards';
        else if (opp.some((c) => c === null)) d.ungraded = 'person_cards_not_shown';
        else if (street === 'preflop' && !closes) d.ungraded = 'preflop_fold_not_all_in';
        else if (street !== 'preflop' && board.length < 3) d.ungraded = 'no_board';
        else {
          const eq = equity(hero, opp as Card[][], board, h.g).equity / 100;
          d.lossBb = (eq * (potFor + pay) - pay) / bb;
          d.basis = closes ? 'fold_all_in_exact' : 'fold_showdown_equity';
          if (vsAllInHeadsUp) d.personCards = bettorCards()!.from;
        }
      } else if (action === 'call' && vsAllInHeadsUp && hero && bettorCards() !== null) {
        if (street !== 'preflop' && board.length < 3) d.ungraded = 'no_board';
        else {
          const opp = bettorCards()!;
          const eq = equity(hero, [opp.cards], board, h.g).equity / 100;
          d.lossBb = -(eq * (potFor + pay) - pay) / bb;
          d.basis = 'call_all_in_exact';
          d.personCards = opp.from;
        }
      } else if (fact.net == null) d.ungraded = 'no_result';
      else {
        const realised = num(fact.net) + num(me[3]);
        d.lossBb = -realised / bb;
        d.basis = 'realised';
        if (action === 'bet' && hero && street !== 'preflop' && finalBoard?.length === 5) {
          // Checking is knowable only where it would close the street, the stored board
          // continues this one, and every live opponent's cards are known (people: showdown only).
          const closesStreet = live.every((s) => allInSeat(s) || acted.has(s[0]));
          const continues = board.every(
            (c, i) => finalBoard[i]?.rank === c.rank && finalBoard[i]?.suit === c.suit
          );
          const opp = live.map((s) => {
            const f = bySeat.get(s[0])!;
            return f.horse || personShown.has(f.uid) ? (cards.get(f.uid) ?? null) : null;
          });
          if (closesStreet && continues && board.length >= 3 && opp.every((c) => c !== null)) {
            const share = equity(hero, opp as Card[][], finalBoard, h.g).equity / 100;
            d.lossBb = (share * pot - realised) / bb;
            d.basis = street === 'river' ? 'bet_vs_check_river_exact' : 'bet_vs_check_showdown';
          }
        }
      }
      out.push(d);
    }
    acted.add(a.seat);
    if (aggressive) {
      aggs += 1;
      // Preflop the blinds are the first wager, so an open is order 1 and a re-raise order 2.
      lastAgg = { seat: a.seat, fraction: pot > 0 ? added / pot : 0, order: aggs };
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────────────

export interface Stat {
  n: number;
  clusters: number;
  total: number;
  mean: number;
  /** standard error of the mean, clustered; null below two clusters */
  se: number | null;
}

/** Mean with a cluster-robust standard error (one cluster per hand). */
export function clusteredStat(values: ReadonlyArray<{ cluster: string; x: number }>): Stat {
  const n = values.length;
  if (n === 0) return { n: 0, clusters: 0, total: 0, mean: 0, se: null };
  const sums = new Map<string, [number, number]>();
  let total = 0;
  for (const v of values) {
    total += v.x;
    const s = sums.get(v.cluster) ?? [0, 0];
    s[0] += v.x;
    s[1] += 1;
    sums.set(v.cluster, s);
  }
  const mean = total / n;
  const k = sums.size;
  if (k < 2) return { n, clusters: k, total, mean, se: null };
  let ss = 0;
  for (const [sum, count] of sums.values()) ss += (sum - mean * count) ** 2;
  return { n, clusters: k, total, mean, se: Math.sqrt((k / (k - 1)) * ss) / n };
}

export const flagged = (s: Stat): boolean =>
  s.n >= FLAG_MIN_N && s.se !== null && s.mean - s.se > 0;

export interface ClassRow extends Stat {
  key: string;
  flagged: boolean;
  /** share of this class's graded decisions that are against its own most frequent person */
  topPersonShare: number;
  /**
   * The class meets the flag test (mean > 1 SE, n >= FLAG_MIN_N) but more than
   * ONE_PERSON_SHARE of it is against one person, and without that person it does not:
   * reported as "one person", not flagged (2026-11-27; absent in reports written before).
   */
  onePerson?: boolean;
}

/**
 * Above this share of a class against its own most frequent person, the class is a read on
 * that person, not on the Horses: it flags only if it still flags without that person.
 * (2026-11-27: PLO5 "preflop facing open call" flagged four days running at 92% WooWoo; a
 * 7-day measurement found no leak, +0.98 +/- 1.28 bb per call.)
 */
export const ONE_PERSON_SHARE = 0.8;

/** A bet graded against checking and one graded against giving up are never one class. */
export const actionLabel = (d: GradedDecision): string =>
  d.action !== 'bet'
    ? d.action
    : d.basis === 'bet_vs_check_river_exact' || d.basis === 'bet_vs_check_showdown'
      ? 'bet vs check'
      : 'bet vs give up';

export const classKey = (d: GradedDecision): string =>
  `${d.game} ${d.pool} | ${d.street} | ${d.situation} | ${actionLabel(d)} | ${d.cls}`;

/** The coarse view for thin samples: game pool, street and action only. */
export const rollupKey = (d: GradedDecision): string =>
  `${d.game} ${d.pool} | ${d.street} | ${actionLabel(d)}`;

/** Graded decisions by spot class, largest total loss first. */
export function classTable(
  decisions: readonly GradedDecision[],
  keyOf: (d: GradedDecision) => string = classKey
): ClassRow[] {
  const groups = new Map<string, GradedDecision[]>();
  for (const d of decisions) {
    if (d.lossBb === null) continue;
    const k = keyOf(d);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }
  const rows: ClassRow[] = [];
  for (const [key, ds] of groups) {
    const stat = clusteredStat(ds.map((d) => ({ cluster: d.hand, x: d.lossBb as number })));
    const counts = new Map<string, number>();
    for (const d of ds) for (const p of d.persons) counts.set(p, (counts.get(p) ?? 0) + 1);
    let top: string | null = null;
    for (const [p, c] of counts) if (top === null || c > counts.get(top)!) top = p;
    const topPersonShare = top === null ? 0 : counts.get(top)! / ds.length;
    const raw = flagged(stat);
    // the same class with its own most frequent person excluded must flag too
    const onePerson =
      raw &&
      topPersonShare > ONE_PERSON_SHARE &&
      !flagged(
        clusteredStat(
          ds
            .filter((d) => !d.persons.includes(top!))
            .map((d) => ({ cluster: d.hand, x: d.lossBb as number }))
        )
      );
    rows.push({ key, ...stat, flagged: raw && !onePerson, topPersonShare, onePerson });
  }
  return rows.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/** The alias met most often across graded decisions, and its share of them. */
export function mostFrequentPerson(
  decisions: readonly GradedDecision[]
): { alias: string; n: number; share: number } | null {
  const counts = new Map<string, number>();
  let graded = 0;
  for (const d of decisions) {
    if (d.lossBb === null) continue;
    graded += 1;
    for (const p of new Set(d.persons)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const e of counts)
    if (!best || e[1] > best[1] || (e[1] === best[1] && e[0] < best[0])) best = e;
  return best ? { alias: best[0], n: best[1], share: best[1] / graded } : null;
}

export interface GameRow {
  game: string;
  pool: Pool;
  hands: number;
  persons: Stat;
  horses: Stat;
}

/** bb/100 of people and of Horses in the hands with a person, per game and pool (bomb pots left out). */
export function gameTable(hands: readonly RawHand[]): GameRow[] {
  const groups = new Map<
    string,
    {
      game: string;
      pool: Pool;
      hands: number;
      p: Array<{ cluster: string; x: number }>;
      h: Array<{ cluster: string; x: number }>;
    }
  >();
  for (const hand of hands) {
    if (hand.bomb || !hand.facts?.some((f) => !f.horse)) continue;
    const pool = poolOf(hand);
    const key = `${hand.g}|${pool}`;
    const g =
      groups.get(key) ?? groups.set(key, { game: hand.g, pool, hands: 0, p: [], h: [] }).get(key)!;
    g.hands += 1;
    for (const f of hand.facts) {
      const x =
        f.net_bb != null
          ? num(f.net_bb)
          : f.net != null && num(hand.bb) > 0
            ? num(f.net) / num(hand.bb)
            : null;
      if (x === null) continue;
      (f.horse ? g.h : g.p).push({ cluster: hand.id, x });
    }
  }
  return [...groups.values()]
    .map((g) => ({
      game: g.game,
      pool: g.pool,
      hands: g.hands,
      persons: clusteredStat(g.p),
      horses: clusteredStat(g.h),
    }))
    .sort((a, b) => a.pool.localeCompare(b.pool) || a.game.localeCompare(b.game));
}

// ─────────────────────────────────────────────────────────────────────────────
// The option set at the time
// ─────────────────────────────────────────────────────────────────────────────

export interface SwitchRow {
  option: string;
  state: string;
  updated_at: string;
}
export interface SwitchAudit {
  option: string;
  old_state: string | null;
  new_state: string | null;
  changed_at: string;
}
export interface OptionSet {
  /** state at the window's end */
  atEnd: Record<string, string>;
  /** state at the window's start, for options that changed inside it */
  atStartWhereDifferent: Record<string, string>;
  changes: SwitchAudit[];
  /** changes after the window's end, undone to reach `atEnd` */
  laterChanges: number;
}

/** The rows as read now, rolled back through the audit to the window. */
export function optionSetAt(
  rows: readonly SwitchRow[],
  audit: readonly SwitchAudit[],
  startMs: number,
  endMs: number
): OptionSet {
  const state = new Map<string, string>(rows.map((r) => [r.option, r.state]));
  const ordered = [...audit].sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at));
  const undo = (a: SwitchAudit) => {
    if (a.old_state == null) state.set(a.option, 'absent');
    else state.set(a.option, a.old_state);
  };
  let later = 0;
  let i = 0;
  for (; i < ordered.length && Date.parse(ordered[i].changed_at) >= endMs; i++) {
    undo(ordered[i]);
    later += 1;
  }
  const atEnd = Object.fromEntries([...state].sort((a, b) => a[0].localeCompare(b[0])));
  const changes: SwitchAudit[] = [];
  for (; i < ordered.length && Date.parse(ordered[i].changed_at) >= startMs; i++) {
    undo(ordered[i]);
    changes.push(ordered[i]);
  }
  const atStartWhereDifferent: Record<string, string> = {};
  for (const [option, s] of state) if (atEnd[option] !== s) atStartWhereDifferent[option] = s;
  return { atEnd, atStartWhereDifferent, changes: changes.reverse(), laterChanges: later };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

export interface Section {
  name: 'cash' | 'tournament';
  decisions: number;
  graded: number;
  ungraded: Record<string, number>;
  byBasis: Record<string, number>;
  headsUpFoldsUngraded: number;
  /** folds and calls graded heads-up against an all-in person on that person's stored (chips-in) cards */
  gradedOnChipsInCards: number;
  classes: ClassRow[];
  topPerson: { alias: string; n: number; share: number } | null;
  classesExcludingTopPerson: ClassRow[];
  rollup: ClassRow[];
  rollupExcludingTopPerson: ClassRow[];
}

export interface Report {
  schema: typeof REPORT_SCHEMA;
  command: string;
  start: string;
  end: string;
  hands: number;
  handsByBuild: Record<string, number>;
  bombPotsLeftOut: number;
  handsWithoutAllHorseCards: number;
  /** hands with a person dealt in, per variant left out of grading (PLO8 and the rest); null = not read */
  excludedVariants: Record<string, number> | null;
  sections: Section[];
  games: GameRow[];
  options: OptionSet | null;
  /** the public-information range grade (only when asked for; absent = not run) */
  range?: RangeSection | null;
}

function section(name: Section['name'], decisions: GradedDecision[]): Section {
  const graded = decisions.filter((d) => d.lossBb !== null);
  const ungraded: Record<string, number> = {};
  const byBasis: Record<string, number> = {};
  for (const d of decisions) {
    if (d.ungraded) ungraded[d.ungraded] = (ungraded[d.ungraded] ?? 0) + 1;
    if (d.basis) byBasis[d.basis] = (byBasis[d.basis] ?? 0) + 1;
  }
  const top = mostFrequentPerson(decisions);
  return {
    name,
    decisions: decisions.length,
    graded: graded.length,
    ungraded,
    byBasis,
    headsUpFoldsUngraded: decisions.filter(
      (d) => d.action === 'fold' && d.headsUp && d.ungraded === 'person_cards_not_shown'
    ).length,
    gradedOnChipsInCards: decisions.filter(
      (d) => d.lossBb !== null && d.personCards === 'chips_in_all_in'
    ).length,
    classes: classTable(decisions),
    topPerson: top,
    classesExcludingTopPerson: top
      ? classTable(decisions.filter((d) => !d.persons.includes(top.alias)))
      : [],
    rollup: classTable(decisions, rollupKey),
    rollupExcludingTopPerson: top
      ? classTable(
          decisions.filter((d) => !d.persons.includes(top.alias)),
          rollupKey
        )
      : [],
  };
}

export function buildReport(input: {
  command: string;
  startMs: number;
  endMs: number;
  hands: readonly RawHand[];
  switchRows?: readonly SwitchRow[] | null;
  switchAudit?: readonly SwitchAudit[] | null;
  /** rows of renderExcludedSql: { g, n } */
  excluded?: ReadonlyArray<{ g: string; n: number }> | null;
  equity: EquityFn;
  /** also run the range grade (a separate section; the real-card sections are unchanged) */
  rangeGrade?: boolean;
  rangeDraws?: number;
}): Report {
  const seen = new Set<string>();
  const hands = input.hands.filter((h) => {
    const t = Date.parse(h.created_at);
    if (seen.has(h.id) || !(t >= input.startMs && t < input.endMs)) return false;
    seen.add(h.id);
    return true;
  });
  const cash: GradedDecision[] = [];
  const tournament: GradedDecision[] = [];
  const builds: Record<string, number> = {};
  let bombs = 0;
  let missing = 0;
  const ranged: RangeGradedDecision[] = [];
  for (const h of hands) {
    const b = (h.build ?? 'not recorded').slice(0, 12);
    builds[b] = (builds[b] ?? 0) + 1;
    if (h.bomb) bombs += 1;
    const kept = new Set((h.horse_cards ?? []).map((c) => c.uid));
    if ((h.facts ?? []).some((f) => f.horse && !kept.has(f.uid))) missing += 1;
    const graded = gradeHand(h, input.equity);
    (h.tournament ? tournament : cash).push(...graded);
    if (input.rangeGrade) ranged.push(...rangeGradeHand(h, graded, input.rangeDraws));
  }
  return {
    schema: REPORT_SCHEMA,
    command: input.command,
    start: utcIso(input.startMs),
    end: utcIso(input.endMs),
    hands: hands.length,
    handsByBuild: builds,
    bombPotsLeftOut: bombs,
    handsWithoutAllHorseCards: missing,
    excludedVariants: input.excluded
      ? Object.fromEntries(
          input.excluded
            .filter((e) => !(VARIANTS as readonly string[]).includes(e.g))
            .map((e) => [e.g, num(e.n)] as [string, number])
            .sort((x, y) => x[0].localeCompare(y[0]))
        )
      : null,
    sections: [section('cash', cash), section('tournament', tournament)],
    games: gameTable(hands),
    options: input.switchRows
      ? optionSetAt(input.switchRows, input.switchAudit ?? [], input.startMs, input.endMs)
      : null,
    ...(input.rangeGrade ? { range: rangeSection(ranged) } : {}),
  };
}

export interface Change {
  section: string;
  key: string;
  kind: 'newly flagged' | 'no longer flagged' | 'still flagged';
  before: { n: number; mean: number; se: number | null } | null;
  now: { n: number; mean: number; se: number | null } | null;
}

/** What moved between two reports: the flagged classes of either, side by side. */
export function compareReports(previous: Report, current: Report): Change[] {
  const out: Change[] = [];
  for (const cur of current.sections) {
    const prev = previous.sections.find((s) => s.name === cur.name);
    const before = new Map((prev?.classes ?? []).map((c) => [c.key, c]));
    const now = new Map(cur.classes.map((c) => [c.key, c]));
    const pick = (c: ClassRow | undefined) => (c ? { n: c.n, mean: c.mean, se: c.se } : null);
    for (const key of new Set([...before.keys(), ...now.keys()])) {
      const b = before.get(key);
      const n = now.get(key);
      if (!b?.flagged && !n?.flagged) continue;
      out.push({
        section: cur.name,
        key,
        kind:
          b?.flagged && n?.flagged
            ? 'still flagged'
            : n?.flagged
              ? 'newly flagged'
              : 'no longer flagged',
        before: pick(b),
        now: pick(n),
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.section.localeCompare(b.section) ||
      a.kind.localeCompare(b.kind) ||
      a.key.localeCompare(b.key)
  );
}

const f1 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);
const f2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);
const se = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2));
const pct = (x: number) => `${Math.round(100 * x)}%`;

function classRows(rows: readonly ClassRow[], rollup = false): string[] {
  const head = rollup
    ? 'Game pool, street, action (every graded decision)'
    : 'Spot class (game pool, street, situation, action, Horse hand)';
  const out = [
    `| # | ${head} | n | hands | total bb | mean bb | SE | top person share | flagged |`,
    '|---|---|---|---|---|---|---|---|---|',
  ];
  const shown = rollup ? rows : rows.filter((r) => r.total > 0).slice(0, TOP_CLASSES);
  if (shown.length === 0)
    out.push(
      `| - | ${rollup ? 'no graded decision' : 'no class with a positive total loss'} | 0 | 0 | - | - | - | - | - |`
    );
  shown.forEach((r, i) =>
    out.push(
      `| ${i + 1} | ${r.key} | ${r.n} | ${r.clusters} | ${f1(r.total)} | ${f2(r.mean)} | ${se(r.se)} | ${pct(r.topPersonShare)} | ${r.flagged ? 'YES' : r.onePerson ? 'one person' : 'no'} |`
    )
  );
  return out;
}

const bb100 = (s: Stat) =>
  s.n === 0
    ? 'n 0'
    : `${f1(100 * s.mean)} ± ${s.se === null ? 'n/a' : (100 * s.se).toFixed(1)} (n ${s.n})`;

export function renderMarkdown(
  r: Report,
  changes: Change[] | null,
  previousLabel: string | null
): string {
  const L: string[] = [];
  const startMs = Date.parse(r.start);
  const endMs = Date.parse(r.end);
  L.push(`# Horse decision grade, ${chicagoDay(endMs)}`, '');
  L.push(
    `Window: ${chicagoStamp(startMs)} to ${chicagoStamp(endMs)} (${((endMs - startMs) / 3_600_000).toFixed(1)} h).`
  );
  L.push(`Command: \`${r.command}\``, '');
  L.push(
    `Hands with at least one person dealt in: **${r.hands}** (bomb pots left out of grading: ${r.bombPotsLeftOut}; hands where a Horse's dealt cards were not kept: ${r.handsWithoutAllHorseCards}).`
  );
  L.push(
    `Serving build by hand count: ${
      Object.entries(r.handsByBuild)
        .map(([b, n]) => `${b} ${n}`)
        .join(', ') || 'none'
    }.`
  );
  if (!r.excludedVariants) L.push('Variants left out of grading: not counted for this run.');
  else {
    const ex = r.excludedVariants;
    const others = Object.entries(ex).filter(([g]) => g !== 'plo8');
    L.push(
      `Left out of grading explicitly (hands with a person dealt in): PLO8 ${ex.plo8 ?? 0} (hi-lo split pots; high-only equity would misprice them)${
        others.length
          ? `; other variants: ${others.map(([g, n]) => `${g} ${n}`).join(', ')}`
          : '; no other variant'
      }.`
    );
  }
  if (startMs < Date.parse(ALL_HORSE_CARDS_KEPT_FROM))
    L.push(
      `NOTE: the window starts before ${chicagoStamp(Date.parse(ALL_HORSE_CARDS_KEPT_FROM))}; earlier hands carry Horse cards only where they reached showdown.`
    );
  L.push(
    '',
    "Sign: **+ = the Horse lost bb**. fold = forgone call EV on real cards (every live person showed at showdown, or heads-up facing a person's all-in, where that person's stored chips-in cards are used); call heads-up facing a person's all-in = the call's EV on real cards (`call_all_in_exact`); other calls and raises = realised result from the decision point; bet vs check = against checking where the check closes the street and the run-out and every live opponent's cards are known; bet vs give up = realised, against giving the pot up. SE is clustered by hand. A class is flagged only when mean > 1 SE and n >= 10, and, when over 80% of it is against one person, only if it still flags without that person (otherwise it shows \"one person\"). People appear by table alias; no card is printed.",
    ''
  );
  for (const s of r.sections) {
    L.push(
      `## ${s.name === 'cash' ? 'Cash games (Lightning pools and tables kept apart in every class)' : 'Tournaments (chips per big blind, not prize equity)'}`,
      ''
    );
    L.push(
      `Horse decisions against a person: ${s.decisions}; graded ${s.graded} (${
        Object.entries(s.byBasis)
          .map(([k, n]) => `${k} ${n}`)
          .join(', ') || 'none'
      }); ungraded ${s.decisions - s.graded} (${
        Object.entries(s.ungraded)
          .map(([k, n]) => `${k} ${n}`)
          .join(', ') || 'none'
      }).`
    );
    L.push(
      `Folds and calls graded heads-up against a person's all-in on that person's stored chips-in cards: ${s.gradedOnChipsInCards}. Heads-up folds to a person still ungradeable (a non all-in wager, nothing shown): ${s.headsUpFoldsUngraded}.`
    );
    const flaggedN = s.classes.filter((c) => c.flagged).length;
    const onePersonN = s.classes.filter((c) => c.onePerson).length;
    L.push(
      `Classes: ${s.classes.length}; flagged: ${flaggedN}; one person (over ${pct(ONE_PERSON_SHARE)} against one person and not flagged without that person): ${onePersonN}. Roll-up rows flagged: ${s.rollup.filter((c) => c.flagged).length} (most frequent person excluded: ${s.rollupExcludingTopPerson.filter((c) => c.flagged).length}).`,
      ''
    );
    L.push(
      `### Top ${TOP_CLASSES} losing spot classes by total bb`,
      '',
      ...classRows(s.classes),
      ''
    );
    if (s.topPerson) {
      L.push(
        `### The same, most frequent person excluded (${s.topPerson.alias}: ${s.topPerson.n} of ${s.graded} graded decisions, ${pct(s.topPerson.share)})`,
        '',
        ...classRows(s.classesExcludingTopPerson),
        ''
      );
    } else
      L.push(
        '### The same, most frequent person excluded',
        '',
        'No graded decision, so no person to exclude.',
        ''
      );
    L.push(
      '### Roll-up for thin samples: game pool, street and action',
      '',
      ...classRows(s.rollup, true),
      ''
    );
    if (s.topPerson)
      L.push(
        `### The roll-up, ${s.topPerson.alias} excluded`,
        '',
        ...classRows(s.rollupExcludingTopPerson, true),
        ''
      );
  }
  L.push('## bb/100 in hands with a person, Horses against people', '');
  L.push(
    '| Game | Pool | hands | people bb/100 ± SE (n hand-seats) | Horses bb/100 ± SE (n hand-seats) |',
    '|---|---|---|---|---|'
  );
  if (r.games.length === 0) L.push('| - | - | 0 | n 0 | n 0 |');
  for (const g of r.games)
    L.push(`| ${g.game} | ${g.pool} | ${g.hands} | ${bb100(g.persons)} | ${bb100(g.horses)} |`);
  L.push(
    '',
    'Nets are after rake, so both sides can be negative. Tournament rows are chips per big blind.',
    ''
  );
  L.push('## Option set at the time (ca_horse_style_switch and its audit)', '');
  if (!r.options) L.push('Not read for this run.', '');
  else {
    const on = Object.entries(r.options.atEnd)
      .filter(([, s]) => s === 'on')
      .map(([o]) => o);
    const other = Object.entries(r.options.atEnd).filter(([, s]) => s !== 'on');
    L.push(
      `At the window's end: ${on.length} on, ${other.length} not on (options without a row act on their code default).`,
      ''
    );
    L.push(`ON: ${on.join(', ') || 'none'}`, '');
    L.push(`NOT ON: ${other.map(([o, s]) => `${o} (${s})`).join(', ') || 'none'}`, '');
    if (r.options.changes.length === 0) L.push('No option changed inside the window.', '');
    else {
      L.push('Changed inside the window:', '');
      for (const c of r.options.changes)
        L.push(
          `- ${chicagoStamp(Date.parse(c.changed_at))}: ${c.option} ${c.old_state ?? 'no row'} -> ${c.new_state ?? 'no row'}`
        );
      L.push('');
    }
  }
  L.push('## Changed since the previous report', '');
  if (!changes) L.push('No previous report was found: this is the first one.', '');
  else if (changes.length === 0)
    L.push(`Against ${previousLabel}: no class is flagged in either report.`, '');
  else {
    L.push(
      `Against ${previousLabel}:`,
      '',
      '| Section | Class | Change | before n, mean ± SE | now n, mean ± SE |',
      '|---|---|---|---|---|'
    );
    const cell = (x: Change['before']) => (x ? `${x.n}, ${f2(x.mean)} ± ${se(x.se)}` : 'absent');
    for (const c of changes)
      L.push(`| ${c.section} | ${c.key} | ${c.kind} | ${cell(c.before)} | ${cell(c.now)} |`);
    L.push('');
  }
  L.push('## Limits', '');
  L.push(
    "- A fold to a non all-in wager is graded only when every live person showed at showdown, so heads-up folds to such a wager are never graded and graded ones are a selected (multiway, bettor went to showdown) sample. A person's stored chips-in cards are used only heads-up against that person's all-in."
  );
  L.push(
    '- `fold_showdown_equity` and `bet_vs_check_showdown` assume no betting after the decision (realisation 1); `bet_vs_check_river_exact` needs no assumption.'
  );
  L.push(
    '- "bet vs check" exists only where the hand reached a showdown with every live opponent shown (a selected sample: called bets); every other unopened bet is "bet vs give up". The check side is valued before rake, the realised side after rake.'
  );
  L.push(
    '- Decisions of one hand share its result; the SE is clustered by hand but classes are not independent of each other.'
  );
  L.push('- Horse-against-Horse hands are not in this report, and it proves nothing about them.');
  if (r.range) L.push('', ...renderRangeSection(r.range));
  return L.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// RANGE GRADE (2026-11-21): every decision priced on PUBLIC information only
// ─────────────────────────────────────────────────────────────────────────────
//
// Criteria declared before any number was computed:
// /Volumes/SmarterWork/agent-work/shared-capacity/hd-01Gw7aDs/range-grade/CRITERIA.md
// (sha256 d51698ab23168dbe87b3d8ffa7342afa7434d0c9a72ae0a21b2ae45db1d8db5c, 2026-11-21 08:55:21 CST).
//
// The real-card grade above can price a decision only where the person's cards
// were shown, and its "realised" basis measures the Horse's hand, not its
// decision. This section grades EVERY decision the same way: each live
// opponent (person or Horse) holds a RANGE built from the public action line
// and the board at the time; nobody's real cards are read, even when they were
// shown later. The decision is priced as EV against its passive alternative at
// realisation 1 (no betting after it). The SAME function run with the ranges
// replaced by the real cards (where the existing read-only route knows them)
// is the validation the range grade must pass before it is trusted.
// No equity calculator is imported: showdowns on a completed board are scored
// with the engine's pure hand scores (worker boundary kept).

export const RANGE_GRADE = {
  criteriaSha256: 'd51698ab23168dbe87b3d8ffa7342afa7434d0c9a72ae0a21b2ae45db1d8db5c',
  draws: 1500,
  referenceHoldings: 300,
  essMin: 30,
  /** a live opponent facing the Horse's bet or raise continues with prob 1 at pct >= threshold, else floor */
  continueThreshold: 0.4,
  continueFloor: 0.3,
  /** [threshold, floor] per earlier voluntary action of that opponent; a check does not narrow */
  weights: {
    preflop_call: [0.4, 0.1],
    preflop_open: [0.65, 0.05],
    preflop_reraise: [0.85, 0.03],
    bet: [0.6, 0.25],
    raise: [0.8, 0.15],
    call: [0.4, 0.3],
  },
  validation: { minN: 60, signAgreement: 0.7, signMinAbsBb: 1, seMultiple: 2, relTolerance: 0.25 },
} as const;

export type RangeActionKind = keyof typeof RANGE_GRADE.weights;
export type RangeFamily = 'postflop' | 'preflop_closing' | 'preflop_r1';
export type RangeUngraded = 'no_horse_cards' | 'no_board' | 'range_ess_low';

export interface RangeGradedDecision {
  /** the daily grade's decision, one to one (same order as gradeHand) */
  base: GradedDecision;
  family: RangeFamily;
  /** bb, + = the Horse lost; EV of the decision against public-information ranges */
  rangeLossBb: number | null;
  ungraded: RangeUngraded | null;
  ess: number | null;
  /** the same measure with every live opponent's REAL cards (validation only); null when any is unknown */
  realLossBb: number | null;
}

/** w for one earlier voluntary action of an opponent whose holding has strength percentile pct. */
export function rangeActionWeight(kind: RangeActionKind | 'check', pct: number): number {
  if (kind === 'check') return 1;
  const [threshold, floor] = RANGE_GRADE.weights[kind];
  return pct >= threshold ? 1 : floor;
}

/** Deterministic PRNG (mulberry32) seeded from text. */
export function seededRng(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DECK_RANKS: CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const DECK_SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const DECK: Card[] = DECK_RANKS.flatMap((rank) => DECK_SUITS.map((suit) => ({ rank, suit })));
const cardIndex = (c: Card): number => DECK_RANKS.indexOf(c.rank) * 4 + DECK_SUITS.indexOf(c.suit);
const holeCount = (g: string): number =>
  g === 'plo4' ? 4 : g === 'plo5' ? 5 : g === 'plo6' ? 6 : 2;

/** Strength used for the range filter: preflop the engine's preflop score, postflop its made-hand score. */
function strengthOf(g: string, hole: Card[], board: Card[]): number {
  if (board.length < 3)
    return isOmaha(g)
      ? omahaPreflopPercentile(hole, false)
      : holdemPreflopScore(hole[0], hole[1], false);
  if (isOmaha(g)) return scoreOmahaHiPartial(hole, board);
  const all = hole.concat(board);
  return scoreHoldem(all, all.length, false);
}

/** Showdown score on a completed five-card board. */
function showdownScore(g: string, hole: Card[], board5: Card[]): number {
  if (isOmaha(g)) return scoreOmahaHi(hole, board5);
  const all = hole.concat(board5);
  return scoreHoldem(all, all.length, false);
}

/** Draw `k` distinct cards not marked in `used` (marks them). */
function drawCards(rng: () => number, used: Uint8Array, k: number): Card[] {
  const out: Card[] = [];
  let guard = 0;
  while (out.length < k) {
    const i = Math.floor(rng() * 52);
    if (++guard > 100_000) throw new Error('deck exhausted');
    if (used[i]) continue;
    used[i] = 1;
    out.push(DECK[i]);
  }
  return out;
}

/** Percentile of a holding's strength against the fixed reference sample for this board (ties half). */
export class StrengthPercentile {
  private cache = new Map<string, Float64Array>();
  constructor(private readonly g: string) {}
  private reference(board: Card[]): Float64Array {
    const key = board.map((c) => c.rank + c.suit[0]).join('');
    let ref = this.cache.get(key);
    if (!ref) {
      const rng = seededRng(`range-reference|${this.g}|${key}`);
      const base = new Uint8Array(52);
      for (const c of board) base[cardIndex(c)] = 1;
      const xs: number[] = [];
      for (let i = 0; i < RANGE_GRADE.referenceHoldings; i++) {
        const used = base.slice();
        xs.push(strengthOf(this.g, drawCards(rng, used, holeCount(this.g)), board));
      }
      ref = Float64Array.from(xs.sort((a, b) => a - b));
      this.cache.set(key, ref);
    }
    return ref;
  }
  pct(hole: Card[], board: Card[]): number {
    const ref = this.reference(board);
    const s = strengthOf(this.g, hole, board);
    let below = 0;
    let ties = 0;
    for (const r of ref) {
      if (r < s) below += 1;
      else if (r === s) ties += 1;
    }
    return (below + 0.5 * ties) / ref.length;
  }
}

export interface RangeOpp {
  streetWager: number;
  behind: number;
  allIn: boolean;
  history: Array<{ kind: RangeActionKind | 'check'; board: Card[] }>;
  real: Card[] | null;
}

export interface RangeSpot {
  g: string;
  bb: number;
  action: GradedDecision['action'];
  hero: Card[];
  board: Card[];
  pot: number;
  pay: number;
  potFor: number;
  added: number;
  heroStreetWager: number;
  opps: RangeOpp[];
}

/**
 * EV-of-decision loss (bb, + = the Horse lost) by importance-weighted sampling.
 * mode 'range': each opponent's holding drawn uniformly and weighted by its public actions.
 * mode 'real': every opponent holds its real cards (weight 1); only the run-out is sampled.
 */
export function priceSpot(
  spot: RangeSpot,
  mode: 'range' | 'real',
  seed: string,
  draws: number = RANGE_GRADE.draws
): { lossBb: number; ess: number } {
  const rng = seededRng(`${seed}|${mode}`);
  const pctOf = new StrengthPercentile(spot.g);
  const base = new Uint8Array(52);
  for (const c of spot.hero) base[cardIndex(c)] = 1;
  for (const c of spot.board) base[cardIndex(c)] = 1;
  const aggressive = spot.action === 'bet' || spot.action === 'raise';
  const newWager = spot.heroStreetWager + spot.added;
  const extra = spot.opps.map((o) =>
    o.allIn ? 0 : Math.min(Math.max(0, newWager - o.streetWager), Math.max(0, o.behind))
  );
  let W = 0;
  let W2 = 0;
  let sCall = 0;
  let sAgg = 0;
  let sCheck = 0;
  for (let d = 0; d < draws; d++) {
    const used = base.slice();
    let w = 1;
    const holds: Card[][] = [];
    for (const o of spot.opps) {
      if (mode === 'real') {
        for (const c of o.real!) used[cardIndex(c)] = 1;
        holds.push(o.real!);
      } else {
        const hole = drawCards(rng, used, holeCount(spot.g));
        for (const h of o.history) w *= rangeActionWeight(h.kind, pctOf.pct(hole, h.board));
        holds.push(hole);
      }
    }
    const board5 = spot.board.concat(drawCards(rng, used, 5 - spot.board.length));
    const heroScore = showdownScore(spot.g, spot.hero, board5);
    const oppScores = holds.map((h) => showdownScore(spot.g, h, board5));
    const shareOf = (members: number[]): number => {
      let ties = 1;
      for (const i of members) {
        if (oppScores[i] > heroScore) return 0;
        if (oppScores[i] === heroScore) ties += 1;
      }
      return 1 / ties;
    };
    const all = holds.map((_, i) => i);
    const shareAll = shareOf(all);
    const evCall = shareAll * (spot.potFor + spot.pay) - spot.pay;
    let evAgg = 0;
    if (aggressive) {
      const forced = all.filter((i) => spot.opps[i].allIn || extra[i] <= EPS);
      const free = all.filter((i) => !forced.includes(i));
      const pCont = free.map((i) =>
        pctOf.pct(holds[i], spot.board) >= RANGE_GRADE.continueThreshold
          ? 1
          : RANGE_GRADE.continueFloor
      );
      for (let mask = 0; mask < 1 << free.length; mask++) {
        let p = 1;
        const members = [...forced];
        free.forEach((i, j) => {
          if (mask & (1 << j)) {
            p *= pCont[j];
            members.push(i);
          } else p *= 1 - pCont[j];
        });
        if (p <= 0) continue;
        if (members.length === 0) {
          evAgg += p * spot.pot;
          continue;
        }
        const matched = Math.max(...members.map((i) => spot.opps[i].streetWager + extra[i]));
        const heroPut = Math.max(0, Math.min(spot.added, matched - spot.heroStreetWager));
        const oppPut = members.reduce((t, i) => t + extra[i], 0);
        evAgg += p * (shareOf(members) * (spot.pot + heroPut + oppPut) - heroPut);
      }
    }
    W += w;
    W2 += w * w;
    sCall += w * evCall;
    sAgg += w * evAgg;
    sCheck += w * shareAll * spot.pot;
  }
  const eCall = sCall / W;
  const eAgg = sAgg / W;
  const eCheck = sCheck / W;
  const loss =
    spot.action === 'fold'
      ? eCall
      : spot.action === 'call'
        ? -eCall
        : spot.action === 'bet'
          ? eCheck - eAgg
          : Math.max(0, eCall) - eAgg;
  return { lossBb: loss / spot.bb, ess: W2 > 0 ? (W * W) / W2 : 0 };
}

/**
 * The range grade of every decision gradeHand finds in this hand, in the same order.
 * `base` is gradeHand's output for the hand (the caller passes it, so the two stay one to one).
 */
export function rangeGradeHand(
  h: RawHand,
  base: readonly GradedDecision[],
  draws: number = RANGE_GRADE.draws
): RangeGradedDecision[] {
  const out: RangeGradedDecision[] = [];
  const facts = h.facts ?? [];
  const acts = h.acts ?? [];
  const bb = num(h.bb);
  if (h.bomb || !(VARIANTS as readonly string[]).includes(h.g) || !(bb > 0)) return out;
  if (acts.some((a) => a.action === 'bomb_ante')) return out;
  const bySeat = new Map<number, RawFact>(facts.map((f) => [f.seat, f]));
  if (!facts.some((f) => !f.horse) || !facts.some((f) => f.horse)) return out;

  // Real cards, used ONLY for the validation column (the existing read-only route's own rules).
  const horseCards = new Map<string, Card[]>();
  for (const c of h.horse_cards ?? []) {
    const parsed = parseCards(c.cards);
    if (parsed) horseCards.set(c.uid, parsed);
  }
  const shownCards = new Map<string, Card[]>();
  for (const [uid, shown] of Object.entries(h.shown ?? {})) {
    if (horseCards.has(uid)) continue;
    const parsed = parseCards(shown);
    if (parsed) shownCards.set(uid, parsed);
  }
  const allInCards = new Map<string, Card[]>();
  for (const [uid, value] of Object.entries(h.allin_cards ?? {})) {
    const f = facts.find((x) => x.uid === uid);
    if (!f || f.horse || !(num(f.invested) > 0)) continue;
    const parsed = parseCards(value);
    if (parsed) allInCards.set(uid, parsed);
  }

  let street = '';
  let lastAgg: { seat: number } | null = null;
  let aggs = 0;
  const history = new Map<number, RangeOpp['history']>();
  let k = 0;
  for (const a of acts) {
    if (!a.seats || a.origin === 'forced' || a.pot == null) continue;
    if (a.stage !== street) {
      street = a.stage;
      lastAgg = null;
      aggs = 0;
    }
    const seats = new Map<number, SeatTuple>(a.seats.map((s) => [s[0], s]));
    const me = seats.get(a.seat);
    const fact = bySeat.get(a.seat);
    if (!me || !fact) continue;
    const toCall = num(a.toCall);
    const pot = num(a.pot);
    const amount = num(a.amount);
    const stack = num(me[1]);
    const added =
      a.action === 'call' || a.action === 'bet'
        ? amount
        : a.action === 'raise' || a.action === 'all_in'
          ? Math.max(0, amount - num(me[2]))
          : 0;
    const aggressive =
      a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && added > toCall + EPS);
    const live = [...seats.values()].filter(
      (s) => s[0] !== a.seat && (num(s[6]) & (FOLDED | SITTING_OUT)) === 0 && bySeat.has(s[0])
    );
    const livePersons = live.filter((s) => !bySeat.get(s[0])!.horse);
    const allInSeat = (s: SeatTuple) => (num(s[6]) & ALL_IN) !== 0 || num(s[1]) <= EPS;
    const facingPerson =
      toCall > EPS && lastAgg !== null && bySeat.get(lastAgg.seat)?.horse === false;
    const unopenedBet = toCall <= EPS && aggressive && livePersons.length > 0;
    const board = parseCards(a.board ?? '') ?? [];
    if (
      fact.horse &&
      live.length > 0 &&
      (facingPerson || unopenedBet) &&
      ['fold', 'call', 'raise', 'bet', 'all_in'].includes(a.action)
    ) {
      const b = base[k];
      if (!b) throw new Error('range grade out of step with gradeHand');
      k += 1;
      const action = b.action;
      const pay = Math.min(toCall, stack);
      const closes = toCall >= stack - EPS || live.every(allInSeat);
      const family: RangeFamily =
        street !== 'preflop'
          ? 'postflop'
          : ((action === 'fold' || action === 'call') && closes) ||
              ((action === 'raise' || action === 'bet') && added >= stack - EPS)
            ? 'preflop_closing'
            : 'preflop_r1';
      const d: RangeGradedDecision = {
        base: b,
        family,
        rangeLossBb: null,
        ungraded: null,
        ess: null,
        realLossBb: null,
      };
      const hero = horseCards.get(fact.uid) ?? null;
      if (!hero) d.ungraded = 'no_horse_cards';
      else if (street !== 'preflop' && board.length < 3) d.ungraded = 'no_board';
      else {
        const bettor = facingPerson ? (seats.get(lastAgg!.seat) ?? null) : null;
        const vsAllInHeadsUp =
          bettor !== null && live.length === 1 && live[0][0] === bettor[0] && allInSeat(bettor);
        const opps: RangeOpp[] = live.map((s) => {
          const f = bySeat.get(s[0])!;
          const real = f.horse
            ? (horseCards.get(f.uid) ?? null)
            : (shownCards.get(f.uid) ??
              (vsAllInHeadsUp && (action === 'fold' || action === 'call') && s[0] === bettor![0]
                ? (allInCards.get(f.uid) ?? null)
                : null));
          return {
            streetWager: num(s[2]),
            behind: num(s[1]),
            allIn: allInSeat(s),
            history: [...(history.get(s[0]) ?? [])],
            real,
          };
        });
        const spot: RangeSpot = {
          g: h.g,
          bb,
          action,
          hero,
          board,
          pot,
          pay,
          potFor: pot - (toCall - pay),
          added,
          heroStreetWager: num(me[2]),
          opps,
        };
        const seed = `${h.id}|${k}`;
        const ranged = priceSpot(spot, 'range', seed, draws);
        d.ess = ranged.ess;
        if (ranged.ess < RANGE_GRADE.essMin) d.ungraded = 'range_ess_low';
        else d.rangeLossBb = ranged.lossBb;
        if (opps.every((o) => o.real !== null) && d.rangeLossBb !== null)
          d.realLossBb = priceSpot(spot, 'real', seed, draws).lossBb;
      }
      out.push(d);
    }
    // The public action line of every seat, for the ranges of later decisions.
    const kind: RangeActionKind | 'check' | null =
      a.action === 'check'
        ? 'check'
        : aggressive
          ? street === 'preflop'
            ? aggs === 0
              ? 'preflop_open'
              : 'preflop_reraise'
            : aggs === 0
              ? 'bet'
              : 'raise'
          : a.action === 'call' || a.action === 'all_in'
            ? street === 'preflop'
              ? 'preflop_call'
              : 'call'
            : null;
    if (kind && kind !== 'check')
      (history.get(a.seat) ?? history.set(a.seat, []).get(a.seat)!).push({ kind, board });
    if (aggressive) {
      aggs += 1;
      lastAgg = { seat: a.seat };
    }
  }
  if (k !== base.length) throw new Error('range grade out of step with gradeHand');
  return out;
}

export interface RangeValidationCheck {
  n: number;
  nSign: number;
  signAgreement: number | null;
  meanRange: number;
  meanReal: number;
  diff: number;
  seDiff: number | null;
  meanAbsReal: number;
  v1: boolean;
  v2: boolean;
}
export interface RangeValidation {
  group: 'G1 postflop + preflop_closing' | 'G2 preflop_r1';
  all: RangeValidationCheck;
  topPerson: string | null;
  excludingTopPerson: RangeValidationCheck | null;
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
}

function validationCheck(ds: readonly RangeGradedDecision[]): RangeValidationCheck {
  const V = RANGE_GRADE.validation;
  const n = ds.length;
  const signRows = ds.filter((d) => Math.abs(d.realLossBb!) >= V.signMinAbsBb);
  const agree = signRows.filter((d) => Math.sign(d.rangeLossBb!) === Math.sign(d.realLossBb!));
  const meanRange = n ? ds.reduce((t, d) => t + d.rangeLossBb!, 0) / n : 0;
  const meanReal = n ? ds.reduce((t, d) => t + d.realLossBb!, 0) / n : 0;
  const meanAbsReal = n ? ds.reduce((t, d) => t + Math.abs(d.realLossBb!), 0) / n : 0;
  const diffStat = clusteredStat(
    ds.map((d) => ({ cluster: d.base.hand, x: d.rangeLossBb! - d.realLossBb! }))
  );
  const diff = meanRange - meanReal;
  const signAgreement = signRows.length ? agree.length / signRows.length : null;
  return {
    n,
    nSign: signRows.length,
    signAgreement,
    meanRange,
    meanReal,
    diff,
    seDiff: diffStat.se,
    meanAbsReal,
    v1: signAgreement !== null && signAgreement >= V.signAgreement,
    v2:
      diffStat.se !== null &&
      Math.abs(diff) <= V.seMultiple * diffStat.se &&
      Math.abs(diff) <= V.relTolerance * meanAbsReal,
  };
}

/** The declared validation bar, per group, on decisions where every live opponent's real cards are known. */
export function validateRangeGrade(decisions: readonly RangeGradedDecision[]): RangeValidation[] {
  const groups: Array<[RangeValidation['group'], (d: RangeGradedDecision) => boolean]> = [
    ['G1 postflop + preflop_closing', (d) => d.family !== 'preflop_r1'],
    ['G2 preflop_r1', (d) => d.family === 'preflop_r1'],
  ];
  return groups.map(([group, inGroup]) => {
    const ds = decisions.filter(
      (d) => inGroup(d) && d.rangeLossBb !== null && d.realLossBb !== null
    );
    const all = validationCheck(ds);
    const top = mostFrequentPerson(ds.map((d) => ({ ...d.base, lossBb: 0 })));
    const excl = top
      ? validationCheck(ds.filter((d) => !d.base.persons.includes(top.alias)))
      : null;
    const verdict: RangeValidation['verdict'] =
      all.n < RANGE_GRADE.validation.minN
        ? 'INCONCLUSIVE'
        : all.v1 && all.v2 && (excl === null || (excl.v1 && excl.v2))
          ? 'PASS'
          : 'FAIL';
    return { group, all, topPerson: top?.alias ?? null, excludingTopPerson: excl, verdict };
  });
}

export const rangeRollupKey = (d: GradedDecision): string =>
  `${d.game} ${d.pool} | ${d.street} | ${d.action === 'bet' ? 'bet vs check' : d.action}`;

export interface RangeSection {
  criteriaSha256: string;
  decisions: number;
  graded: number;
  byFamily: Record<string, number>;
  ungraded: Record<string, number>;
  /** the daily grade's person_cards_not_shown and realised rows, and how many the range grade now prices */
  coverage: {
    unshown: { rows: number; graded: number; byFamily: Record<string, number> };
    realised: { rows: number; graded: number; byFamily: Record<string, number> };
  };
  validation: RangeValidation[];
  topPerson: { alias: string; n: number; share: number } | null;
  /** roll-up rows (game pool | street | action) on the range grade, per group, with and without the top person */
  rollupG1: ClassRow[];
  rollupG1ExcludingTopPerson: ClassRow[];
  rollupG2: ClassRow[];
  rollupG2ExcludingTopPerson: ClassRow[];
  /** every range-graded decision of the group in one row, with and without the top person */
  overall: ClassRow[];
}

export function rangeSection(decisions: readonly RangeGradedDecision[]): RangeSection {
  const count = (
    xs: readonly RangeGradedDecision[],
    key: (d: RangeGradedDecision) => string | null
  ) => {
    const m: Record<string, number> = {};
    for (const d of xs) {
      const k = key(d);
      if (k) m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  const graded = decisions.filter((d) => d.rangeLossBb !== null);
  const cover = (pick: (d: RangeGradedDecision) => boolean) => {
    const rows = decisions.filter(pick);
    const g = rows.filter((d) => d.rangeLossBb !== null);
    return { rows: rows.length, graded: g.length, byFamily: count(g, (d) => d.family) };
  };
  const asGraded = (xs: readonly RangeGradedDecision[]): GradedDecision[] =>
    xs.map((d) => ({ ...d.base, lossBb: d.rangeLossBb, basis: null }));
  const all = asGraded(graded);
  const top = mostFrequentPerson(all);
  const g1 = asGraded(graded.filter((d) => d.family !== 'preflop_r1'));
  const g2 = asGraded(graded.filter((d) => d.family === 'preflop_r1'));
  const drop = (xs: GradedDecision[]) =>
    top ? xs.filter((d) => !d.persons.includes(top.alias)) : xs;
  return {
    criteriaSha256: RANGE_GRADE.criteriaSha256,
    decisions: decisions.length,
    graded: graded.length,
    byFamily: count(graded, (d) => d.family),
    ungraded: count(decisions, (d) => d.ungraded),
    coverage: {
      unshown: cover((d) => d.base.ungraded === 'person_cards_not_shown'),
      realised: cover((d) => d.base.basis === 'realised'),
    },
    validation: validateRangeGrade(decisions),
    topPerson: top,
    rollupG1: classTable(g1, rangeRollupKey),
    rollupG1ExcludingTopPerson: classTable(drop(g1), rangeRollupKey),
    rollupG2: classTable(g2, rangeRollupKey),
    rollupG2ExcludingTopPerson: classTable(drop(g2), rangeRollupKey),
    overall: [
      ...classTable(g1, () => 'ALL G1 (postflop + preflop_closing)'),
      ...classTable(drop(g1), () => 'ALL G1, most frequent person excluded'),
      ...classTable(g2, () => 'ALL G2 (preflop_r1)'),
      ...classTable(drop(g2), () => 'ALL G2, most frequent person excluded'),
    ],
  };
}

const mark2 = (r: ClassRow, groupTrusted = true): string =>
  !groupTrusted
    ? 'not graded'
    : r.onePerson
      ? 'one person'
      : r.se === null || r.n < FLAG_MIN_N
        ? ''
        : r.mean - 2 * r.se > 0
          ? 'FLAGGED >2 SE'
          : r.mean - r.se > 0
            ? 'FLAGGED >1 SE'
            : '';

/** The range-grade section, rendered after the real-card report (which it does not change). */
export function renderRangeSection(s: RangeSection): string[] {
  const L: string[] = [];
  const f = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);
  L.push(
    '## Range grade: every decision on public information (separate from the real-card grade above)',
    ''
  );
  L.push(
    `Criteria declared before the run (sha256 ${s.criteriaSha256.slice(0, 16)}…). Each live opponent holds a range built from the public action line and the board (no real card read); EV of the decision against its passive alternative at realisation 1. Sign: + = the Horse lost.`,
    ''
  );
  L.push(
    `Decisions: ${s.decisions}; range-graded ${s.graded} (${
      Object.entries(s.byFamily)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ') || 'none'
    }); ungraded ${
      Object.entries(s.ungraded)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ') || 'none'
    }.`
  );
  const c = s.coverage;
  L.push(
    `Coverage: person cards never shown ${c.unshown.graded} of ${c.unshown.rows} now graded (${
      Object.entries(c.unshown.byFamily)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ') || 'none'
    }); "result against a fold" rows ${c.realised.graded} of ${c.realised.rows} now priced as EV of the decision (${
      Object.entries(c.realised.byFamily)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ') || 'none'
    }).`,
    ''
  );
  L.push('### Validation against real cards (declared bar)', '');
  L.push(
    '| group | n | sign n (abs real >= 1 bb) | sign agreement | mean range | mean real | diff | SE diff | mean abs real | V1 | V2 | excl. top: n, sign, diff, V1, V2 | verdict |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|'
  );
  for (const v of s.validation) {
    const a = v.all;
    const e = v.excludingTopPerson;
    L.push(
      `| ${v.group} | ${a.n} | ${a.nSign} | ${a.signAgreement === null ? 'n/a' : pct(a.signAgreement)} | ${f(a.meanRange)} | ${f(a.meanReal)} | ${f(a.diff)} | ${se(a.seDiff)} | ${a.meanAbsReal.toFixed(2)} | ${a.v1 ? 'pass' : 'fail'} | ${a.v2 ? 'pass' : 'fail'} | ${e ? `${e.n}, ${e.signAgreement === null ? 'n/a' : pct(e.signAgreement)}, ${f(e.diff)}, ${e.v1 ? 'pass' : 'fail'}, ${e.v2 ? 'pass' : 'fail'}` : '-'} | **${v.verdict}** |`
    );
  }
  L.push('');
  const trusted = (g: string) =>
    s.validation.find((v) => v.group.startsWith(g))?.verdict === 'PASS';
  // A group that did not pass is NOT GRADED: say plainly which check missed and by how much,
  // and carry no flag for it below (2026-11-27: G2 was printed with FLAGGED marks under a
  // "not trusted" heading, and its miss was only readable by working the table).
  for (const v of s.validation) {
    if (v.verdict === 'PASS') continue;
    const V = RANGE_GRADE.validation;
    const name = v.group.split(' ')[0];
    const n =
      name === 'G2' ? (s.byFamily.preflop_r1 ?? 0) : s.graded - (s.byFamily.preflop_r1 ?? 0);
    const misses: string[] = [];
    const why = (c: RangeValidationCheck, who: string) => {
      if (!c.v1)
        misses.push(
          `${who}: sign agreement ${c.signAgreement === null ? 'n/a' : pct(c.signAgreement)} is below ${pct(V.signAgreement)}`
        );
      if (!c.v2) {
        const bound = Math.min(
          c.seDiff === null ? Infinity : V.seMultiple * c.seDiff,
          V.relTolerance * c.meanAbsReal
        );
        misses.push(
          `${who}: the range grade's mean is ${f(c.diff)} bb per decision off the real-card mean, beyond the bar of ${Number.isFinite(bound) ? bound.toFixed(2) : 'n/a'} bb (the smaller of ${V.seMultiple} SE = ${c.seDiff === null ? 'n/a' : (V.seMultiple * c.seDiff).toFixed(2)} and ${pct(V.relTolerance)} of mean abs real = ${(V.relTolerance * c.meanAbsReal).toFixed(2)}), on ${c.n} validation decisions`
        );
      }
    };
    if (v.verdict === 'INCONCLUSIVE')
      misses.push(`only ${v.all.n} validation decisions, below the declared ${V.minN}`);
    else {
      why(v.all, 'all validation decisions');
      if (v.excludingTopPerson) why(v.excludingTopPerson, `${v.topPerson} excluded`);
    }
    L.push(
      `**${v.group} is NOT GRADED in this report (${v.verdict}).** ${n} of its range-graded decisions carry no flag below. Missed: ${misses.join('; ')}. The bar is unchanged. Its only ground truth is a person's cards shown at showdown (folded and mucked cards are never stored), so the validation sample is selected toward holdings that went on; the criteria declare this, and with the cards that exist the grade cannot tell that selection apart from range error.`,
      ''
    );
  }
  const table = (title: string, rows: readonly ClassRow[], groupTrusted: boolean) => {
    L.push(`### ${title}`, '');
    L.push('| row | n | hands | mean bb | SE | mark |', '|---|---|---|---|---|---|');
    const shown = rows.filter((r) => r.n >= FLAG_MIN_N || r.mean > 0);
    if (!shown.length) L.push('| none | - | - | - | - | - |');
    for (const r of [...shown].sort((x, y) => y.mean - x.mean))
      L.push(
        `| ${r.key.replaceAll(' | ', ' / ')} | ${r.n} | ${r.clusters} | ${f(r.mean)} | ${se(r.se)} | ${mark2(r, groupTrusted)} |`
      );
    L.push('');
  };
  const top = s.topPerson ? `${s.topPerson.alias} (${s.topPerson.n} of ${s.graded})` : 'none';
  L.push(
    '### Overall',
    '',
    '| row | n | hands | mean bb | SE | mark |',
    '|---|---|---|---|---|---|'
  );
  for (const r of s.overall)
    L.push(
      `| ${r.key} | ${r.n} | ${r.clusters} | ${f(r.mean)} | ${se(r.se)} | ${mark2(r, trusted(r.key.startsWith('ALL G2') ? 'G2' : 'G1'))} |`
    );
  L.push('');
  const t1 = trusted('G1');
  const t2 = trusted('G2');
  const untrusted = ' - NOT GRADED: validation did not pass, no flag';
  table(`G1 roll-up (rows with n >= 10 or a positive mean)${t1 ? '' : untrusted}`, s.rollupG1, t1);
  table(`G1 roll-up, most frequent person excluded: ${top}`, s.rollupG1ExcludingTopPerson, t1);
  table(`G2 preflop realisation-1 roll-up${t2 ? '' : untrusted}`, s.rollupG2, t2);
  table(`G2 roll-up, most frequent person excluded: ${top}`, s.rollupG2ExcludingTopPerson, t2);
  return L;
}
