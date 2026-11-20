/**
 * HORSE DAILY DECISION GRADE - where Horses lose chips to people, per spot
 * class, graded on real cards (2026-11-20).
 *
 * Pure. No network, no clock, no database: the CLI
 * (scripts/horse-daily-decision-grade.ts) fetches with bounded read-only
 * SELECTs and hands the rows here.
 *
 * WHAT IT READS. Since about 1:12 PM Chicago on 2026-11-20 every Horse's dealt
 * hole cards are kept for every hand in smarter_private.horse_dealt_hole_cards
 * (#11511; service-role read only, no client path). Before that only hands
 * that reached showdown carried cards. The report joins those cards to the
 * public action line of hand_history and to ca_hand_facts' realised nets.
 *
 * OWNER RULE (2026-11-13 23:42 Chicago). The exact mucked hole cards of a
 * person's hand folded with no chips in are never stored or reconstructed.
 * This report goes further: a person's cards are read ONLY where that person
 * showed them at showdown (hand_history.showdown, not mucked); the SQL filters
 * them inside the database, so nothing else leaves it. Output is aggregate:
 * no hole card and no hand id is printed; people appear by table alias only.
 *
 * WHAT IS GRADED. Every Horse decision facing a person's wager (the street's
 * last bettor or raiser is a person), and every unopened Horse bet with a
 * person still live. DECLARED before the first run, sign: + = the Horse lost.
 *
 *   fold   forgone call EV on real cards, eq x (pot + toCall) - toCall in bb,
 *          eq = all-in equity against the real cards of every live opponent
 *          (InsuranceEquity: exact enumeration, the engine's own evaluator).
 *          Knowable only when every live person showed at showdown. Basis
 *          `fold_all_in_exact` when the call would end the betting (the Horse
 *          or every opponent all-in): pot odds against all-in equity. Basis
 *          `fold_showdown_equity` otherwise: realisation 1, no later betting
 *          (an ASSUMPTION; the same one the PLO lead's LIVEGRADE declared).
 *          Preflop folds are graded only on the all-in basis.
 *   call, raise, bet
 *          the realised result from the decision point in bb: the Horse's
 *          hand net plus what it had already put in before the decision
 *          (sunk), negated. For a call or raise that is the realised result
 *          against folding there; for an unopened bet it is against giving
 *          the pot up, NOT against checking (a check's value needs cards the
 *          rule above does not allow in general).
 *   anything else is UNGRADED with its reason. Nothing is guessed.
 *
 * A heads-up fold to a person can never be graded under the showdown-only
 * rule (the hand ends, nothing is shown): the report counts them, it does not
 * estimate them. Graded folds are therefore multiway folds whose bettor later
 * showed down, a selected sample; the report says so.
 *
 * One hand can carry several decisions of one Horse, each graded on the same
 * hand result, so the standard error is clustered by hand. A class is flagged
 * only when its mean is beyond 1 SE and n >= 10; the same table is shown with
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
  variantInfo,
} from '../engine/HorseEval.js';
import { insuranceEquity } from '../engine/InsuranceEquity.js';
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only SQL
// ─────────────────────────────────────────────────────────────────────────────

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** One bounded SELECT for [start, end): hands with a person dealt in. */
export function renderHandsSql(start: string, end: string): string {
  if (!TS.test(start) || !TS.test(end)) throw new Error('START and END must be UTC instants (…Z)');
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
    from smarter_private.horse_dealt_hole_cards c where c.hand_id = h.id) as horse_cards,
 (select jsonb_object_agg(s->>'user_id', h.hole_cards->(s->>'user_id'))
    from jsonb_array_elements(case when jsonb_typeof(h.showdown) = 'array' then h.showdown else '[]'::jsonb end) s
    where coalesce((s->>'mucked')::boolean, false) = false and h.hole_cards ? (s->>'user_id')) as shown
from hand_history h
where h.created_at >= '${start}' and h.created_at < '${end}' and h.has_human is true
  and h.game_variant in (${VARIANTS.map((v) => `'${v}'`).join(', ')})`;
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
export type Basis = 'fold_all_in_exact' | 'fold_showdown_equity' | 'realised';
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
export function gradeHand(h: RawHand): GradedDecision[] {
  const out: GradedDecision[] = [];
  const facts = h.facts ?? [];
  const acts = h.acts ?? [];
  const bb = num(h.bb);
  if (h.bomb || !(VARIANTS as readonly string[]).includes(h.g) || !(bb > 0)) return out;
  if (acts.some((a) => a.action === 'bomb_ante')) return out;
  const bySeat = new Map<number, RawFact>(facts.map((f) => [f.seat, f]));
  if (!facts.some((f) => !f.horse) || !facts.some((f) => f.horse)) return out;

  const cards = new Map<string, Card[]>();
  for (const c of h.horse_cards ?? []) {
    const parsed = parseCards(c.cards);
    if (parsed) cards.set(c.uid, parsed);
  }
  for (const [uid, shown] of Object.entries(h.shown ?? {})) {
    if (cards.has(uid)) continue;
    const parsed = parseCards(shown);
    if (parsed) cards.set(uid, parsed);
  }
  const pool = poolOf(h);
  let street = '';
  let lastAgg: { seat: number; fraction: number; order: number } | null = null;
  let aggs = 0;

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
      if (action === 'fold') {
        const opp = live.map((s) => cards.get(bySeat.get(s[0])!.uid) ?? null);
        const closes =
          toCall >= stack - EPS ||
          live.every((s) => (num(s[6]) & ALL_IN) !== 0 || num(s[1]) <= EPS);
        if (!hero) d.ungraded = 'no_horse_cards';
        else if (opp.some((c) => c === null)) d.ungraded = 'person_cards_not_shown';
        else if (street === 'preflop' && !closes) d.ungraded = 'preflop_fold_not_all_in';
        else if (street !== 'preflop' && board.length < 3) d.ungraded = 'no_board';
        else {
          // A call for less than the wager risks only the stack; the uncovered part goes back to the bettor.
          const pay = Math.min(toCall, stack);
          const potFor = pot - (toCall - pay);
          const eq = insuranceEquity(hero, opp as Card[][], board, h.g).equity / 100;
          d.lossBb = (eq * (potFor + pay) - pay) / bb;
          d.basis = closes ? 'fold_all_in_exact' : 'fold_showdown_equity';
        }
      } else if (fact.net == null) d.ungraded = 'no_result';
      else {
        d.lossBb = -(num(fact.net) + num(me[3])) / bb;
        d.basis = 'realised';
      }
      out.push(d);
    }
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
}

export const classKey = (d: GradedDecision): string =>
  `${d.game} ${d.pool} | ${d.street} | ${d.situation} | ${d.action} | ${d.cls}`;

/** The coarse view for thin samples: game pool, street and action only. */
export const rollupKey = (d: GradedDecision): string =>
  `${d.game} ${d.pool} | ${d.street} | ${d.action}`;

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
    rows.push({
      key,
      ...stat,
      flagged: flagged(stat),
      topPersonShare: Math.max(0, ...counts.values()) / ds.length,
    });
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
  sections: Section[];
  games: GameRow[];
  options: OptionSet | null;
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
  for (const h of hands) {
    const b = (h.build ?? 'not recorded').slice(0, 12);
    builds[b] = (builds[b] ?? 0) + 1;
    if (h.bomb) bombs += 1;
    const kept = new Set((h.horse_cards ?? []).map((c) => c.uid));
    if ((h.facts ?? []).some((f) => f.horse && !kept.has(f.uid))) missing += 1;
    (h.tournament ? tournament : cash).push(...gradeHand(h));
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
    sections: [section('cash', cash), section('tournament', tournament)],
    games: gameTable(hands),
    options: input.switchRows
      ? optionSetAt(input.switchRows, input.switchAudit ?? [], input.startMs, input.endMs)
      : null,
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
      `| ${i + 1} | ${r.key} | ${r.n} | ${r.clusters} | ${f1(r.total)} | ${f2(r.mean)} | ${se(r.se)} | ${pct(r.topPersonShare)} | ${r.flagged ? 'YES' : 'no'} |`
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
  if (startMs < Date.parse(ALL_HORSE_CARDS_KEPT_FROM))
    L.push(
      `NOTE: the window starts before ${chicagoStamp(Date.parse(ALL_HORSE_CARDS_KEPT_FROM))}; earlier hands carry Horse cards only where they reached showdown.`
    );
  L.push(
    '',
    'Sign: **+ = the Horse lost bb**. fold = forgone call EV on real cards (only where every live person showed at showdown); call / raise / bet = realised result from the decision point. SE is clustered by hand. A class is flagged only when mean > 1 SE and n >= 10. People appear by table alias; no card is printed.',
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
      `Heads-up folds to a person, ungradeable under the showdown-only rule: ${s.headsUpFoldsUngraded}.`
    );
    const flaggedN = s.classes.filter((c) => c.flagged).length;
    L.push(
      `Classes: ${s.classes.length}; flagged: ${flaggedN}. Roll-up rows flagged: ${s.rollup.filter((c) => c.flagged).length} (most frequent person excluded: ${s.rollupExcludingTopPerson.filter((c) => c.flagged).length}).`,
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
    '- A fold is graded only when every live person showed at showdown, so heads-up folds to a person are never graded and graded folds are a selected (multiway, bettor went to showdown) sample.'
  );
  L.push(
    '- `fold_showdown_equity` assumes the call would have been the last wager (realisation 1).'
  );
  L.push('- An unopened bet is graded against giving the pot up, not against checking.');
  L.push(
    '- Decisions of one hand share its result; the SE is clustered by hand but classes are not independent of each other.'
  );
  L.push('- Horse-against-Horse hands are not in this report, and it proves nothing about them.');
  return L.join('\n') + '\n';
}
