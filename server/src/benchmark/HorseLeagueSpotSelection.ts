/**
 * SPOT-SEEDED LEAGUE SESSIONS (2026-11-19, Horse Switch lane).
 *
 * A low-reach rule (omahaUnderpairNoMultiwayFlopContinue: 130 / 89 divergent
 * pairs in BLANKET-LOO-1b, under the 200 floor) spends almost all of a card's
 * CPU on deals that never reach its spot. LeagueMatchup.spot keeps only the
 * deals whose PUBLIC state reaches a declared spot, so the same CPU buys many
 * more divergent pairs at that spot.
 *
 * How a deal is selected (recorded verbatim in LeagueResult.spotSelection):
 *   1. candidate deal c is dealt exactly as pair c of an unselected card
 *      (handSeed, dealer seat and hand clock are those of pair index c);
 *   2. a PROBE plays it once with arm B at every Horse seat ('either': and once
 *      with arm A) on a FRESH HorseMind sandbox with memory learning off and a
 *      throwaway counter, so whether candidate c is kept is a function of c
 *      alone; the pass sandboxes never see a probe. The probe stops as soon as
 *      the answer is known (leagueSpotProbe), and a board that fails the board
 *      condition is not played at all;
 *   3. the deal is kept when, in a probe, some subject seat (any Horse seat of a
 *      mirror card; the hero of a human-field card) acts on the declared street
 *      facing a public state that satisfies the predicate (street, live players
 *      when it acts, the earlier actions of that street by other seats as an
 *      ordered subsequence, the board of that street paired or not). Hole cards
 *      are never read;
 *   4. 'filter' probes `pairs` candidates and plays the kept ones; 'redeal'
 *      probes candidates until `pairs` are kept (at most pairs x
 *      maxCandidatesPerPair candidates; `exhausted` says it gave up);
 *   5. every kept deal is then played as a normal duplicate pair: BOTH arms (both
 *      passes) are dealt the same deal, dealer and hand clock. The arms can still
 *      diverge before the spot; the pair is kept and counted all the same.
 *
 * WHAT IT MEASURES: the spot, not overall win rate. A selected result is the
 * arms' difference over deals that reach the spot under the probe arm; it says
 * nothing about bb/100 over all deals, and it must never be pooled with, or
 * read as, an unselected card.
 */
import { createHash } from 'node:crypto';
import { omahaUnderpairNoDraw } from '../engine/HorseOmahaUnderpair.js';
import type { Card } from '../types.js';

export const LEAGUE_SPOT_STREETS = ['flop', 'turn', 'river'] as const;
export type LeagueSpotStreet = (typeof LEAGUE_SPOT_STREETS)[number];
export const LEAGUE_SPOT_ACTIONS = ['check', 'bet', 'call', 'raise', 'all_in', 'fold'] as const;
export const LEAGUE_SPOT_NOTE =
  'Selected-spot result: it measures the declared spot (deals whose public state reaches it under the probe arm), not overall win rate. Never pool it with, or read it as, an unselected card.';

export interface LeagueSpotPredicate {
  street: LeagueSpotStreet;
  /** Live players when the subject acts (the subject included), at least / at most. */
  minLive?: number;
  maxLive?: number;
  /** Earlier actions of this street by other seats, an ordered subsequence; an item may list alternatives. */
  actionsBefore?: ReadonlyArray<string | readonly string[]>;
  /** The board as dealt by this street has no two cards of one rank. */
  unpairedBoard?: boolean;
  /** The board as dealt by this street has two cards of one rank. */
  pairedBoard?: boolean;
  /**
   * OPTIONAL, NOT PUBLIC: the subject's own hole cards with this street's board
   * must be in a named class (LEAGUE_SPOT_SUBJECT_CLASSES, the engine's own
   * classifier). A deal-class condition in the manner of
   * HorseLeagueSpotConditioned.ts: only subject seats holding the class count,
   * and a deal where none does is not probed at all. Recorded with the rule.
   */
  subjectHoleClass?: LeagueSpotSubjectClass;
}

/** Named hole-card classes a spot may require of its subject (engine classifiers, read only). */
export const LEAGUE_SPOT_SUBJECT_CLASSES = Object.freeze({
  /** omahaUnderpairNoDraw: exactly one pair below the top card of an unpaired flop, no flush draw, no nut straight draw. */
  omaha_underpair_no_draw_flop: (hole: readonly Card[], board: readonly Card[]) =>
    omahaUnderpairNoDraw(hole, board.slice(0, 3)),
});
export type LeagueSpotSubjectClass = keyof typeof LEAGUE_SPOT_SUBJECT_CLASSES;

export interface LeagueSpotPassObservation {
  candidate: number;
  pass: 'probe_a' | 'probe_b' | 'pass1' | 'pass2';
  handSeed: number;
  dealerSeat: number;
  cards: Card[][];
  board: Card[];
}

export interface LeagueSpotSelection {
  /** The rule's name, recorded with the result. */
  name: string;
  predicate: LeagueSpotPredicate;
  mode: 'filter' | 'redeal';
  /** 'b' (default): the probe plays arm B; 'either': kept when arm A or arm B reaches the spot. */
  probe?: 'b' | 'either';
  /** redeal only: candidates per requested pair before giving up (default 50). */
  maxCandidatesPerPair?: number;
  /** Tests only: sees every probe and pass of every candidate it plays. Never recorded. */
  observe?: (o: LeagueSpotPassObservation) => void;
}

export interface LeagueSpotEvent {
  seatIdx: number;
  stage: string;
  action: string;
  liveBefore: number;
}
export interface LeagueSpotProbeHand {
  events: LeagueSpotEvent[];
  board: Card[];
  cards: Card[][];
  /** Set by leagueSpotProbe: whether the spot was reached (its subject-class rule included). */
  reached?: boolean;
}

export interface LeagueSpotSelectionRecord {
  name: string;
  rule: LeagueSpotPredicate;
  mode: 'filter' | 'redeal';
  probe: 'b' | 'either';
  subject: 'any_horse_seat' | 'hero';
  candidatesDealt: number;
  kept: number;
  keptRate: number;
  maxCandidates: number;
  exhausted: boolean;
  /** The candidate (pair) indices kept, in play order. */
  keptCandidates: number[];
  /** sha256 of the canonical {name, rule, mode, probe, subject, maxCandidatesPerPair}. */
  ruleDigest: string;
  note: typeof LEAGUE_SPOT_NOTE;
}

const STREET_CARDS: Record<LeagueSpotStreet, number> = { flop: 3, turn: 4, river: 5 };

export function validateLeagueSpotSelection(sel: LeagueSpotSelection): void {
  if (!sel || typeof sel.name !== 'string' || !sel.name.trim())
    throw new Error('spot selection: a name is required');
  const p = sel.predicate;
  if (!p || !(LEAGUE_SPOT_STREETS as readonly string[]).includes(p.street))
    throw new Error('spot selection: street must be flop, turn or river');
  if (sel.mode !== 'filter' && sel.mode !== 'redeal')
    throw new Error('spot selection: mode must be filter or redeal');
  if (sel.probe !== undefined && sel.probe !== 'b' && sel.probe !== 'either')
    throw new Error('spot selection: probe must be b or either');
  for (const k of ['minLive', 'maxLive'] as const)
    if (p[k] !== undefined && (!Number.isSafeInteger(p[k]) || p[k]! < 1))
      throw new Error(`spot selection: ${k} must be a positive integer`);
  if (p.unpairedBoard && p.pairedBoard)
    throw new Error('spot selection: a board cannot be paired and unpaired');
  if (
    p.subjectHoleClass !== undefined &&
    !Object.hasOwn(LEAGUE_SPOT_SUBJECT_CLASSES, p.subjectHoleClass)
  )
    throw new Error(`spot selection: unknown subject hole class ${String(p.subjectHoleClass)}`);
  for (const item of p.actionsBefore ?? [])
    for (const a of typeof item === 'string' ? [item] : item)
      if (!(LEAGUE_SPOT_ACTIONS as readonly string[]).includes(a))
        throw new Error(`spot selection: unknown action ${a}`);
  if (
    sel.maxCandidatesPerPair !== undefined &&
    (!Number.isSafeInteger(sel.maxCandidatesPerPair) || sel.maxCandidatesPerPair < 1)
  )
    throw new Error('spot selection: maxCandidatesPerPair must be a positive integer');
}

const STAGE_ORDER: Record<string, number> = { preflop: 0, flop: 1, turn: 2, river: 3 };
const stageOrder = (stage: string) => STAGE_ORDER[stage] ?? 4;

/** Thrown by a probe's observer once the outcome is known; caught by leagueSpotProbe only. */
class LeagueSpotDecided extends Error {
  constructor(readonly hit: boolean) {
    super('league spot probe decided');
  }
}

/**
 * Probe one deal. `dealt` is the deal as playHand deals it (HorseLeague
 * leagueDealtCards): a board that fails the board condition is a miss with no
 * hand played. Otherwise `play(observer)` plays the hand and the observer stops
 * it as soon as the outcome is known: a subject acting on the street where the
 * predicate holds (hit); the street passed, fewer live players than minLive,
 * or (a single subject) the subject folded or all-in before the street (miss).
 * Every stop is a sound early answer: none of those outcomes can change later
 * in the hand. The observer is read-only until it stops the hand; the probe's
 * hand is never scored.
 */
export function leagueSpotProbe(
  p: LeagueSpotPredicate,
  dealt: { holes: Card[][]; board: Card[] },
  isSubject: (seatIdx: number) => boolean,
  singleSubject: boolean,
  play: (observer: {
    onAction: (e: { seatIdx: number; stage: string; action: string; liveBefore: number }) => void;
  }) => void
): LeagueSpotProbeHand {
  const events: LeagueSpotEvent[] = [];
  let reached = false;
  const hand = (): LeagueSpotProbeHand => ({
    events,
    board: [...dealt.board],
    cards: dealt.holes.map((c) => [...c]),
    reached,
  });
  const street = dealt.board.slice(0, STREET_CARDS[p.street]);
  if ((p.unpairedBoard && boardPaired(street)) || (p.pairedBoard && !boardPaired(street)))
    return hand();
  if (p.subjectHoleClass !== undefined) {
    const inClass = LEAGUE_SPOT_SUBJECT_CLASSES[p.subjectHoleClass];
    const base = isSubject;
    const holders = new Set(
      dealt.holes.flatMap((h, s) => (base(s) && inClass(h, street) ? [s] : []))
    );
    if (!holders.size) return hand();
    isSubject = (s) => holders.has(s);
  }
  const at = stageOrder(p.street);
  try {
    play({
      onAction: (e) => {
        events.push({
          seatIdx: e.seatIdx,
          stage: e.stage,
          action: e.action,
          liveBefore: e.liveBefore,
        });
        const now = stageOrder(e.stage);
        if (now === at && isSubject(e.seatIdx) && leagueSpotReached(p, hand(), isSubject)) {
          reached = true;
          throw new LeagueSpotDecided(true);
        }
        if (now > at) throw new LeagueSpotDecided(false);
        const liveAfter = e.liveBefore - (e.action === 'fold' ? 1 : 0);
        if (p.minLive !== undefined && liveAfter < p.minLive) throw new LeagueSpotDecided(false);
        if (
          singleSubject &&
          isSubject(e.seatIdx) &&
          (e.action === 'fold' || (e.action === 'all_in' && now < at))
        )
          throw new LeagueSpotDecided(false);
      },
    });
  } catch (err) {
    if (!(err instanceof LeagueSpotDecided)) throw err;
  }
  reached = reached || leagueSpotReached(p, hand(), isSubject);
  return hand();
}

function boardPaired(board: readonly Card[]): boolean {
  const ranks = board.map((c) => c.rank);
  return new Set(ranks).size !== ranks.length;
}

/** True when some subject seat acts on the street facing a public state the predicate holds for. */
export function leagueSpotReached(
  p: LeagueSpotPredicate,
  hand: LeagueSpotProbeHand,
  isSubject: (seatIdx: number) => boolean
): boolean {
  const n = STREET_CARDS[p.street];
  if (hand.board.length < n) return false;
  const board = hand.board.slice(0, n);
  if (p.unpairedBoard && boardPaired(board)) return false;
  if (p.pairedBoard && !boardPaired(board)) return false;
  const street = hand.events.filter((e) => e.stage === p.street);
  for (let i = 0; i < street.length; i++) {
    const e = street[i]!;
    if (!isSubject(e.seatIdx)) continue;
    if (p.minLive !== undefined && e.liveBefore < p.minLive) continue;
    if (p.maxLive !== undefined && e.liveBefore > p.maxLive) continue;
    const before = street.slice(0, i).filter((x) => x.seatIdx !== e.seatIdx);
    let j = 0;
    const want = p.actionsBefore ?? [];
    for (const x of before) {
      if (j >= want.length) break;
      const item = want[j]!;
      if (typeof item === 'string' ? x.action === item : item.includes(x.action)) j++;
    }
    if (j === want.length) return true;
  }
  return false;
}

export interface LeagueSpotDeals {
  kept: number[];
  candidatesDealt: number;
  maxCandidates: number;
  exhausted: boolean;
}

/** Probe candidates in order and keep the ones that reach the spot. */
export async function selectLeagueSpotDeals(
  sel: LeagueSpotSelection,
  pairs: number,
  probe: (candidate: number, arm: 'a' | 'b') => LeagueSpotProbeHand,
  isSubject: (seatIdx: number) => boolean,
  shouldContinue: () => boolean
): Promise<LeagueSpotDeals> {
  validateLeagueSpotSelection(sel);
  const maxCandidates = sel.mode === 'filter' ? pairs : pairs * (sel.maxCandidatesPerPair ?? 50);
  const kept: number[] = [];
  let c = 0;
  for (; c < maxCandidates && kept.length < pairs; c++) {
    if (!shouldContinue()) break;
    if (c > 0 && (c & 0x0f) === 0) await new Promise((res) => setImmediate(res));
    const reached = (h: LeagueSpotProbeHand) =>
      h.reached ?? leagueSpotReached(sel.predicate, h, isSubject);
    let hit = reached(probe(c, 'b'));
    if (!hit && sel.probe === 'either') hit = reached(probe(c, 'a'));
    if (hit) kept.push(c);
  }
  return {
    kept,
    candidatesDealt: c,
    maxCandidates,
    exhausted: sel.mode === 'redeal' && kept.length < pairs && c >= maxCandidates,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value as object)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

export function leagueSpotSelectionRecord(
  sel: LeagueSpotSelection,
  deals: LeagueSpotDeals,
  subject: 'any_horse_seat' | 'hero'
): LeagueSpotSelectionRecord {
  const probe = sel.probe ?? 'b';
  const rule = JSON.parse(JSON.stringify(sel.predicate)) as LeagueSpotPredicate;
  return {
    name: sel.name,
    rule,
    mode: sel.mode,
    probe,
    subject,
    candidatesDealt: deals.candidatesDealt,
    kept: deals.kept.length,
    keptRate: deals.candidatesDealt ? deals.kept.length / deals.candidatesDealt : 0,
    maxCandidates: deals.maxCandidates,
    exhausted: deals.exhausted,
    keptCandidates: [...deals.kept],
    ruleDigest: createHash('sha256')
      .update(
        canonical({
          name: sel.name,
          rule,
          mode: sel.mode,
          probe,
          subject,
          maxCandidatesPerPair: sel.maxCandidatesPerPair,
        })
      )
      .digest('hex'),
    note: LEAGUE_SPOT_NOTE,
  };
}
