/**
 * HOW AN OPENER ANSWERS A 3-BET (2026-11-24, PLO-LEAD-6; measurement plus a reader for the default-off planned-fold
 * scaling of the out-of-position 3-bet range).
 *
 * The exact opponent profile keeps how often an opener folds to a 3-bet (foldTo3Bet / foldTo3BetOpp). It keeps
 * nothing about how the rest of his answers split between a call and a 4-bet, and nothing about his position against
 * the 3-bettor. The out-of-position 3-bet rule (HorseOopReraiseRangeHolds) needs exactly that: a planned fold to a
 * 4-bet costs only as often as THIS opener 4-bets. League probes of 2026-11-24 (#11917) measured the cost of pricing
 * every opener with the population's split: -25 bb/100 heads-up against an opener who never 4-bets light.
 *
 * One node per position, `openFacesThreeBet`: he made the first raise of the preflop street (the open), the very next
 * raise was another player's (a 3-bet), and he then acted before any further raise: fold, call or raise. At most one
 * opportunity per player per hand. Kept in two cells by his position against the 3-bettor after the flop:
 *
 *   inPosition     he acts after the 3-bettor on every later street
 *   outOfPosition  he acts before the 3-bettor
 *
 * POSITION FROM THE PUBLIC LOG ONLY. The small blind and the big blind are the players who posted them (`sb` / `bb`
 * entries that are not dead blinds); a log without both posts takes them from the order of the first voluntary
 * preflop actions (heads-up the first to act is the small blind; with three or more players the last two first
 * actors are the blinds: every dealt player has acted by the time the opener answers a 3-bet). After the flop the
 * small blind acts first, then the big blind, then the others in preflop order; heads-up the big blind acts first.
 * The opener is in position when he acts later than the 3-bettor.
 *
 * Admission is the pooled counters' own (learnablePublicAction: voluntary, attributed, never forced); a raise is a
 * bet, a raise or a full-raise all-in (the exploit counters' definition); any other continuing action is a call.
 *
 * STORAGE AND DECAY: the conventions of the opportunity-gated preflop counters (HorseOmahaReraiseResponse): a cell
 * ages only on a hand that gave it an opportunity, by EXPLOIT_DECAY (half-life 30). Kept beside the 27 counters, not
 * among them: horse_exact_profiles.opener_response jsonb, written by the accepted-hand learner
 * (fn_horse_opener_response_increments / _add are the SQL twins of openerResponseHandIncrements /
 * addOpenerResponseEvidence), per exact row (player x game x format x table size), carried by the pooled exact row
 * into the decision's own state and its read frame (v21). Carried for nlh, plo4 and plo5.
 *
 * PUBLIC ACTIONS ONLY. Pure: no I/O, no random draws. Nothing here is keyed on who the player is.
 */
import {
  EXPLOIT_DECAY,
  learnablePublicAction,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';

export const OPENER_RESPONSE_NODES = ['inPosition', 'outOfPosition'] as const;
export type OpenerResponseNode = (typeof OPENER_RESPONSE_NODES)[number];
export const OPENER_RESPONSE_FIELDS = ['opp', 'fold', 'call', 'raise'] as const;
export interface OpenerResponseCell {
  /** decayed opportunities: times he opened, was 3-bet and acted */
  opp: number;
  fold: number;
  call: number;
  raise: number;
}
export type OpenerResponseCounters = Record<OpenerResponseNode, OpenerResponseCell>;

const cell = (): OpenerResponseCell => ({ opp: 0, fold: 0, call: 0, raise: 0 });
export function emptyOpenerResponse(): OpenerResponseCounters {
  return { inPosition: cell(), outOfPosition: cell() };
}

/** A public log entry as the learner reads it: the exploit action plus the blind post's dead flag. */
export type OpenerResponseAction = ExploitHandAction & { dead?: unknown };

const aggressive = (a: ExploitHandAction): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

/**
 * True when `opener` acts after `threeBettor` on every street after the flop, from the public log read so far:
 * `sb` / `bb` the posters (null when the log has no such post), `order` the players in the order of their first
 * voluntary preflop action.
 */
export function openerActsLater(
  opener: string,
  threeBettor: string,
  sb: string | null,
  bb: string | null,
  order: readonly string[]
): boolean {
  let small = sb;
  let big = bb;
  const players = new Set(order);
  if (small !== null && big !== null) {
    players.add(small);
    players.add(big);
  } else {
    const n = order.length;
    if (n === 2) {
      small = order[0];
      big = order[1];
    } else if (n >= 3) {
      small = order[n - 2];
      big = order[n - 1];
    } else {
      small = null;
      big = null;
    }
  }
  const rank = (id: string): number => {
    if (players.size === 2) return id === small ? 1 : 0;
    if (id === small) return 0;
    if (id === big) return 1;
    const others = order.filter((x) => x !== small && x !== big);
    return 2 + others.indexOf(id);
  };
  return rank(opener) > rank(threeBettor);
}

/** The raw (undecayed) increments one completed hand contributes, for the opener who answered a 3-bet (if any). */
export function openerResponseHandIncrements(
  actions: readonly OpenerResponseAction[] | null | undefined
): Map<string, OpenerResponseCounters> {
  const out = new Map<string, OpenerResponseCounters>();
  if (!Array.isArray(actions)) return out;
  let raises = 0;
  let opener: string | null = null;
  let threeBettor: string | null = null;
  let sb: string | null = null;
  let bb: string | null = null;
  const order: string[] = [];
  for (const a of actions) {
    if (!a || typeof a.userId !== 'string' || !a.userId) continue;
    if (a.stage !== 'preflop') continue;
    if ((a.action === 'sb' || a.action === 'bb') && a.dead !== true) {
      if (a.action === 'sb' && sb === null) sb = a.userId;
      if (a.action === 'bb' && bb === null) bb = a.userId;
      continue;
    }
    if (!learnablePublicAction(a)) continue;
    const id = a.userId;
    if (!order.includes(id)) order.push(id);
    const aggr = aggressive(a);
    if (raises === 2 && id === opener && threeBettor !== null) {
      const node: OpenerResponseNode = openerActsLater(id, threeBettor, sb, bb, order)
        ? 'inPosition'
        : 'outOfPosition';
      const r = emptyOpenerResponse();
      r[node].opp = 1;
      if (a.action === 'fold') r[node].fold = 1;
      else if (aggr) r[node].raise = 1;
      else r[node].call = 1;
      out.set(id, r);
      break;
    }
    if (aggr) {
      raises++;
      if (raises === 1) opener = id;
      else if (raises === 2) {
        if (id === opener) break;
        threeBettor = id;
      } else break;
    }
  }
  return out;
}

/** Age `row` and add one hand's increments: a cell ages only on a hand that gave it an opportunity. */
export function openerResponseDecayAndAdd(
  row: OpenerResponseCounters,
  inc: OpenerResponseCounters
): void {
  for (const node of OPENER_RESPONSE_NODES) {
    if (!(inc[node].opp > 0)) continue;
    for (const f of OPENER_RESPONSE_FIELDS)
      row[node][f] = row[node][f] * EXPLOIT_DECAY + inc[node][f];
  }
}

const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  plainObject(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
/** Exact shape; every number finite and non-negative; the three answers never exceed the opportunities. */
export function validOpenerResponse(r: unknown): r is OpenerResponseCounters {
  if (!exactKeys(r, OPENER_RESPONSE_NODES)) return false;
  for (const node of OPENER_RESPONSE_NODES) {
    const c = r[node];
    if (!exactKeys(c, OPENER_RESPONSE_FIELDS)) return false;
    for (const f of OPENER_RESPONSE_FIELDS) {
      const v = c[f];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
    }
    const { opp, fold, call, raise } = c as unknown as OpenerResponseCell;
    if (fold + call + raise > opp + 1e-9) return false;
  }
  return true;
}

export function copyOpenerResponse(r: OpenerResponseCounters): OpenerResponseCounters {
  const out = emptyOpenerResponse();
  for (const node of OPENER_RESPONSE_NODES)
    for (const f of OPENER_RESPONSE_FIELDS) out[node][f] = r[node][f];
  return out;
}

/**
 * `base` with one hand's increments: a hand that gave him no opportunity leaves the record exactly as it was (null
 * stays null). Never mutates its inputs.
 */
export function addOpenerResponseEvidence(
  base: OpenerResponseCounters | null | undefined,
  inc: OpenerResponseCounters | null | undefined
): OpenerResponseCounters | null {
  if (!inc || !OPENER_RESPONSE_NODES.some((n) => inc[n].opp > 0)) return base ?? null;
  const out = base ? copyOpenerResponse(base) : emptyOpenerResponse();
  openerResponseDecayAndAdd(out, inc);
  return out;
}

/** The games whose rows carry the record into a decision: the games the out-of-position 3-bet rule prices. */
export const OPENER_RESPONSE_CARRIED_VARIANTS = ['nlh', 'plo4', 'plo5'] as const;
export function openerResponseCarriedFor(variant: string | null | undefined): boolean {
  return (OPENER_RESPONSE_CARRIED_VARIANTS as readonly string[]).includes(
    (variant ?? '').toLowerCase()
  );
}

/** The read-frame row (v21): [opp, fold, call, raise] of each cell, in OPENER_RESPONSE_NODES order. */
export const OPENER_RESPONSE_ROW_LENGTH = 8;
export function openerResponseRow(r: OpenerResponseCounters): number[] {
  return OPENER_RESPONSE_NODES.flatMap((n) => OPENER_RESPONSE_FIELDS.map((f) => r[n][f]));
}
export function openerResponseFromRow(row: readonly number[]): OpenerResponseCounters | null {
  if (!Array.isArray(row) || row.length !== OPENER_RESPONSE_ROW_LENGTH) return null;
  const out = emptyOpenerResponse();
  OPENER_RESPONSE_NODES.forEach((n, i) =>
    OPENER_RESPONSE_FIELDS.forEach((f, j) => {
      out[n][f] = row[i * OPENER_RESPONSE_FIELDS.length + j];
    })
  );
  return validOpenerResponse(out) ? out : null;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE READER: how often THIS opener 4-bets a 3-bet, anchored (the Prior anchor law)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * BASELINE: the 4-bet share of an opener's answers to a 3-bet that the no-record prior is anchored to. 0.10 is an
 * equilibrium-scale rate (solver ranges of a 100 bb opener facing a 3-bet out of position 4-bet roughly a tenth of
 * the time; the cash population of 2026-11-17..24, people and Horses pooled, measured 2-9% in NLH and PLO4 and 10-24%
 * in PLO5, #11917 OPENER_ANSWERS_PRIOR). With no record the reader returns this baseline, so the planned-fold guard
 * binds in full (exactly the behaviour without the reader). POPULATION WEIGHT: 0. The population rate does not move
 * the baseline: in NLH and PLO4 the field 4-bets less than the baseline, and letting it pull the anchor down would
 * relax the guard against openers nobody has measured (the exploitable side). OWN RECORD: his decayed counts against
 * the baseline worth OPENER_RESPONSE_PRIOR_MASS opportunities; at 30 answers his own record carries 83% of the rate.
 */
export const OPENER_FOUR_BET_BASELINE = 0.1;
export const OPENER_RESPONSE_PRIOR_MASS = 6;

export interface OpenerFourBetRead {
  /** posterior 4-bet share of his answers to a 3-bet */
  raise: number;
  /** posterior fold share (his own counts against the baseline's fold share; for the receipt) */
  fold: number;
  /** decayed answers behind it (0: the baseline alone) */
  answers: number;
  node: OpenerResponseNode;
  source: 'measured' | 'baseline';
}

/**
 * His 4-bet rate at one cell: (raises + m x baseline) / (answers + m). Null record, malformed record or no answer at
 * the cell: the baseline, labelled `baseline`. `foldBaseline` is the fold share the fold posterior is shrunk to.
 */
export function openerFourBetRead(
  row: OpenerResponseCounters | null | undefined,
  node: OpenerResponseNode,
  foldBaseline: number
): OpenerFourBetRead {
  const m = OPENER_RESPONSE_PRIOR_MASS;
  const fb = Number.isFinite(foldBaseline) ? Math.min(1, Math.max(0, foldBaseline)) : 0.5;
  const c = row && validOpenerResponse(row) ? row[node] : null;
  const answered = c ? c.fold + c.call + c.raise : 0;
  if (!c || !(answered > 0))
    return { raise: OPENER_FOUR_BET_BASELINE, fold: fb, answers: 0, node, source: 'baseline' };
  return {
    raise: (c.raise + m * OPENER_FOUR_BET_BASELINE) / (answered + m),
    fold: (c.fold + m * fb) / (answered + m),
    answers: answered,
    node,
    source: 'measured',
  };
}

/**
 * How hard the planned-fold guard binds against this opener, 0..1: his posterior 4-bet rate over the baseline,
 * capped at 1. 1 with no record (the guard as it is); toward 0 for an opener whose own record shows he does not
 * 4-bet a 3-bet.
 */
export function plannedFoldGuardWeight(read: OpenerFourBetRead): number {
  const w = read.raise / OPENER_FOUR_BET_BASELINE;
  return Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 1;
}
