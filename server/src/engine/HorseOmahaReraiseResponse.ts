/**
 * HOW A RE-RAISER ANSWERS BEING RE-RAISED (2026-11-18, WooWoo 48-hour audit,
 * CALL-VS-RAISE analysis; measurement, read only by the default-OFF option
 * omahaReraisedCallVsRaisePriced).
 *
 * The exact opponent profile keeps how often a player re-raises (threeBet /
 * threeBetOpp) and how an OPENER answers a re-raise (foldTo3Bet). It keeps
 * nothing about a RE-RAISER whose own re-raise is raised again, which is the
 * number a priced raise needs: P(fold), P(call), P(re-raise) of the player a
 * Horse would 4-bet or 5-bet. This module keeps it, in two nodes:
 *
 *   threeBetFacesFourBet   he made the second raise of the preflop street (a
 *                          3-bet), exactly one more raise followed by another
 *                          player (a 4-bet), and he acted: fold, call or raise
 *   fourBetFacesFiveBet    he made the third raise or a later one (a 4-bet or
 *                          more), exactly one more raise followed, and he acted
 *
 * At most one opportunity per player per node per hand. A response is counted
 * only when the raise he faces is the very next raise after his own (when two
 * raises come back to him the spot is a different one and is not counted).
 * Admission is the pooled counters' own (learnablePublicAction: voluntary,
 * attributed, never forced). A raise is a bet, a raise or a full-raise all-in
 * (the exploit counters' definition); any other continuing action is a call.
 *
 * STORAGE AND DECAY: the conventions of the existing opportunity-gated preflop
 * counters (threeBet, foldTo3Bet; HorseOpponentExploit
 * decayAndAddOpportunityScoped): a node ages only on a hand that gave it an
 * opportunity, by EXPLOIT_DECAY (half-life EXPLOIT_HALF_LIFE_HANDS = 30). Kept
 * beside the 27 counters, not among them, so the 27-field wire shapes keep
 * their bytes (the pattern of long_counters, shown_river and the street record):
 * horse_exact_profiles.reraise_response jsonb, written by the accepted-hand
 * learner (fn_horse_reraise_response_increments / _add are the SQL twins of
 * reraiseResponseHandIncrements / addReraiseResponseEvidence), carried by the
 * pooled exact row into the decision's own state and its read frame (v19).
 *
 * PUBLIC ACTIONS ONLY. Pure: no I/O, no random draws.
 */
import {
  EXPLOIT_DECAY,
  learnablePublicAction,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';

export const RERAISE_RESPONSE_NODES = ['threeBetFacesFourBet', 'fourBetFacesFiveBet'] as const;
export type ReraiseResponseNode = (typeof RERAISE_RESPONSE_NODES)[number];
export const RERAISE_RESPONSE_FIELDS = ['opp', 'fold', 'call', 'raise'] as const;
export interface ReraiseResponseCell {
  /** decayed opportunities: times he faced the next raise after his own and acted */
  opp: number;
  fold: number;
  call: number;
  raise: number;
}
export type ReraiseResponseCounters = Record<ReraiseResponseNode, ReraiseResponseCell>;

const cell = (): ReraiseResponseCell => ({ opp: 0, fold: 0, call: 0, raise: 0 });
export function emptyReraiseResponse(): ReraiseResponseCounters {
  return { threeBetFacesFourBet: cell(), fourBetFacesFiveBet: cell() };
}

/** The node of a player whose own raise was the `level`-th raise of the street (2 = a 3-bet). */
export function reraiseResponseNodeOf(level: number): ReraiseResponseNode | null {
  if (!Number.isFinite(level) || level < 2) return null;
  return level === 2 ? 'threeBetFacesFourBet' : 'fourBetFacesFiveBet';
}

const aggressive = (a: ExploitHandAction): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

/**
 * The raw (undecayed) increments one completed hand contributes, per player who
 * had an opportunity. Players without one are absent.
 */
export function reraiseResponseHandIncrements(
  actions: readonly ExploitHandAction[] | null | undefined
): Map<string, ReraiseResponseCounters> {
  const out = new Map<string, ReraiseResponseCounters>();
  if (!Array.isArray(actions)) return out;
  let raises = 0;
  /** the level of each player's own latest raise, until his next action consumes it */
  const own = new Map<string, number>();
  const seen = new Set<string>();
  for (const a of actions) {
    if (!a || typeof a.userId !== 'string' || !a.userId) continue;
    if (!learnablePublicAction(a)) continue;
    if (a.stage !== 'preflop') continue;
    const id = a.userId;
    const aggr = aggressive(a);
    const mine = own.get(id);
    if (mine !== undefined) {
      own.delete(id);
      const node = reraiseResponseNodeOf(mine);
      if (node && raises === mine + 1 && !seen.has(`${node}:${id}`)) {
        seen.add(`${node}:${id}`);
        let r = out.get(id);
        if (!r) out.set(id, (r = emptyReraiseResponse()));
        r[node].opp++;
        if (a.action === 'fold') r[node].fold++;
        else if (aggr) r[node].raise++;
        else r[node].call++;
      }
    }
    if (aggr) {
      raises++;
      own.set(id, raises);
    }
  }
  return out;
}

/** Age `row` and add one hand's increments: a node ages only on a hand that gave it an opportunity. */
export function reraiseResponseDecayAndAdd(
  row: ReraiseResponseCounters,
  inc: ReraiseResponseCounters
): void {
  for (const node of RERAISE_RESPONSE_NODES) {
    if (!(inc[node].opp > 0)) continue;
    for (const f of RERAISE_RESPONSE_FIELDS)
      row[node][f] = row[node][f] * EXPLOIT_DECAY + inc[node][f];
  }
}

const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  plainObject(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
/** Exact shape; every number finite and non-negative; the three answers never exceed the opportunities. */
export function validReraiseResponse(r: unknown): r is ReraiseResponseCounters {
  if (!exactKeys(r, RERAISE_RESPONSE_NODES)) return false;
  for (const node of RERAISE_RESPONSE_NODES) {
    const c = r[node];
    if (!exactKeys(c, RERAISE_RESPONSE_FIELDS)) return false;
    for (const f of RERAISE_RESPONSE_FIELDS) {
      const v = c[f];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
    }
    const { opp, fold, call, raise } = c as unknown as ReraiseResponseCell;
    if (fold + call + raise > opp + 1e-9) return false;
  }
  return true;
}

export function copyReraiseResponse(r: ReraiseResponseCounters): ReraiseResponseCounters {
  const out = emptyReraiseResponse();
  for (const node of RERAISE_RESPONSE_NODES)
    for (const f of RERAISE_RESPONSE_FIELDS) out[node][f] = r[node][f];
  return out;
}

/**
 * `base` with one hand's increments: a hand that gave him no opportunity leaves
 * the record exactly as it was (null stays null). Never mutates its inputs.
 */
export function addReraiseResponseEvidence(
  base: ReraiseResponseCounters | null | undefined,
  inc: ReraiseResponseCounters | null | undefined
): ReraiseResponseCounters | null {
  if (!inc || !RERAISE_RESPONSE_NODES.some((n) => inc[n].opp > 0)) return base ?? null;
  const out = base ? copyReraiseResponse(base) : emptyReraiseResponse();
  reraiseResponseDecayAndAdd(out, inc);
  return out;
}

/** The record is carried for Omaha rows only (the only games whose decisions can read it). */
export function reraiseResponseCarriedFor(variant: string | null | undefined): boolean {
  const v = (variant ?? '').toLowerCase();
  return v.startsWith('plo') || v === 'flo8' || v.includes('omaha');
}

/** The read-frame row (v19): [opp, fold, call, raise] of each node, in RERAISE_RESPONSE_NODES order. */
export const RERAISE_RESPONSE_ROW_LENGTH = 8;
export function reraiseResponseRow(r: ReraiseResponseCounters): number[] {
  return RERAISE_RESPONSE_NODES.flatMap((n) => RERAISE_RESPONSE_FIELDS.map((f) => r[n][f]));
}
export function reraiseResponseFromRow(row: readonly number[]): ReraiseResponseCounters | null {
  if (!Array.isArray(row) || row.length !== RERAISE_RESPONSE_ROW_LENGTH) return null;
  const out = emptyReraiseResponse();
  RERAISE_RESPONSE_NODES.forEach((n, i) =>
    RERAISE_RESPONSE_FIELDS.forEach((f, j) => {
      out[n][f] = row[i * RERAISE_RESPONSE_FIELDS.length + j];
    })
  );
  return validReraiseResponse(out) ? out : null;
}

/** P(fold), P(call), P(re-raise); they sum to 1. */
export interface ReraiseResponseRates {
  fold: number;
  call: number;
  raise: number;
}
export interface ReraiseResponsePosterior extends ReraiseResponseRates {
  /** his decayed opportunities behind the rates (0: the prior alone) */
  opportunities: number;
  /** his own decayed counts, as carried */
  counts: ReraiseResponseRates;
  source: 'measured' | 'population';
}
/**
 * His response rates at one node: the posterior mean of his own counts against
 * a population prior worth `priorMass` opportunities,
 * (count + priorMass x prior) / (opportunities + priorMass). With no record, or
 * no opportunity at the node, the prior itself, labelled `population`. Null
 * when the prior is not three probabilities that sum to 1.
 */
export function reraiseResponsePosterior(
  row: ReraiseResponseCounters | null | undefined,
  node: ReraiseResponseNode,
  prior: ReraiseResponseRates,
  priorMass: number
): ReraiseResponsePosterior | null {
  const ps = [prior?.fold, prior?.call, prior?.raise];
  if (ps.some((p) => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1)) return null;
  if (Math.abs(ps[0] + ps[1] + ps[2] - 1) > 1e-6) return null;
  if (!(priorMass > 0) || !Number.isFinite(priorMass)) return null;
  const c = row && validReraiseResponse(row) ? row[node] : null;
  if (!c || !(c.opp > 0))
    return {
      fold: prior.fold,
      call: prior.call,
      raise: prior.raise,
      opportunities: 0,
      counts: { fold: 0, call: 0, raise: 0 },
      source: 'population',
    };
  // A decayed row may hold a little less than its opportunities in answers
  // (never more: validReraiseResponse); the remainder is spread by the prior.
  const answered = c.fold + c.call + c.raise;
  const n = answered + priorMass;
  return {
    fold: (c.fold + priorMass * prior.fold) / n,
    call: (c.call + priorMass * prior.call) / n,
    raise: (c.raise + priorMass * prior.raise) / n,
    opportunities: c.opp,
    counts: { fold: c.fold, call: c.call, raise: c.raise },
    source: 'measured',
  };
}
