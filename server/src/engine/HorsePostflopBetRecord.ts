/**
 * HOW HE ANSWERS A POSTFLOP BET, AND WHAT HIS CALLED BETS SHOWED (2026-11-25, PLO-OWNER lead-7; measurement for the
 * default-off Hold'em options that price his raise and his bluff share).
 *
 * Two public records per exact row (player x game x format x table size), NLH only, in one column
 * (horse_exact_profiles.postflop_bets):
 *
 *   raiseToBet[street]           street = flop | turn | river. An opportunity: he acts on a street where another
 *                                player has wagered and he has not wagered yet on that street (at most one per player
 *                                per street). `raise`: that action was a bet, a raise or a full-raise all-in.
 *   shownBet[street][size]       street = turn | river; size = his wager over the pot before it: small (< 0.5),
 *                                medium (< 0.66), large (<= 1), overbet (the shown-river buckets). His FIRST wager on
 *                                that street, made when nobody had wagered on it yet, and then called by another
 *                                player before any raise: `called`. `shown`: the public showdown list names him and
 *                                his hand was not mucked. `air`: shown, and the shown hand name is "high card" (no
 *                                pair on the final board; a board pair or one pair counts as value, so air is never
 *                                over-counted). A mucked or folded hand is never read and no hole card is read.
 *
 * Admission is the pooled counters' (learnablePublicAction: voluntary, attributed, never forced) for every action that
 * decides a cell; the pot the size bucket divides by is every action's chips in log order, exactly as
 * fn_horse_shown_river_increments sums it.
 *
 * STORAGE AND DECAY: a cell ages only on a hand that gave it an opportunity (raiseToBet: `opp` > 0; shownBet:
 * `called` > 0), by EXPLOIT_DECAY (half-life 30), then takes that hand's counts; a hand with no opportunity leaves the
 * record exactly as it was (null stays null). fn_horse_postflop_bets_increments / _add are the SQL twins of
 * postflopBetHandIncrements / addPostflopBetEvidence. Carried by the pooled exact row into the decision's own state
 * and its read frame.
 *
 * PUBLIC INFORMATION ONLY (the action log and the public showdown list). Pure: no I/O, no random draws. Nothing here
 * is keyed on who the player is.
 */
import {
  EXPLOIT_DECAY,
  learnablePublicAction,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';

export const POSTFLOP_RAISE_STREETS = ['flop', 'turn', 'river'] as const;
export type PostflopRaiseStreet = (typeof POSTFLOP_RAISE_STREETS)[number];
export const POSTFLOP_SHOWN_STREETS = ['turn', 'river'] as const;
export type PostflopShownStreet = (typeof POSTFLOP_SHOWN_STREETS)[number];
export const POSTFLOP_SIZE_BUCKETS = ['small', 'medium', 'large', 'overbet'] as const;
export type PostflopSizeBucket = (typeof POSTFLOP_SIZE_BUCKETS)[number];

export interface RaiseToBetCell {
  /** decayed opportunities: he acted facing another player's wager on this street, not having wagered on it */
  opp: number;
  /** ... and raised */
  raise: number;
}
export interface ShownBetCell {
  /** decayed: his first wager of the street (nobody had wagered) was called before any raise */
  called: number;
  /** ... and he showed (named in the showdown list, not mucked) */
  shown: number;
  /** ... and the shown hand was "high card" */
  air: number;
}
export interface PostflopBetCounters {
  raiseToBet: Record<PostflopRaiseStreet, RaiseToBetCell>;
  shownBet: Record<PostflopShownStreet, Record<PostflopSizeBucket, ShownBetCell>>;
}

const raiseCell = (): RaiseToBetCell => ({ opp: 0, raise: 0 });
const shownCell = (): ShownBetCell => ({ called: 0, shown: 0, air: 0 });
const shownStreet = (): Record<PostflopSizeBucket, ShownBetCell> => ({
  small: shownCell(),
  medium: shownCell(),
  large: shownCell(),
  overbet: shownCell(),
});
export function emptyPostflopBets(): PostflopBetCounters {
  return {
    raiseToBet: { flop: raiseCell(), turn: raiseCell(), river: raiseCell() },
    shownBet: { turn: shownStreet(), river: shownStreet() },
  };
}

/** The shown-river size bucket of a wager `inc` into a pot `pot` (> 0). */
export function postflopSizeBucket(inc: number, pot: number): PostflopSizeBucket {
  const frac = inc / pot;
  return frac < 0.5 ? 'small' : frac < 0.66 ? 'medium' : frac <= 1 ? 'large' : 'overbet';
}

/** A public log entry as the learner reads it. */
export type PostflopBetAction = ExploitHandAction & { amount?: unknown };
export interface PostflopShowdownEntry {
  user_id?: unknown;
  mucked?: unknown;
  hand_name?: unknown;
}

const aggressive = (a: ExploitHandAction): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);
const isWager = (a: { action: string }): boolean =>
  a.action === 'bet' || a.action === 'raise' || a.action === 'all_in';

/** The raw (undecayed) increments one completed hand contributes, per player who had an opportunity. */
export function postflopBetHandIncrements(
  actions: readonly PostflopBetAction[] | null | undefined,
  showdown: readonly PostflopShowdownEntry[] | null | undefined
): Map<string, PostflopBetCounters> {
  const out = new Map<string, PostflopBetCounters>();
  if (!Array.isArray(actions)) return out;
  const rowOf = (id: string): PostflopBetCounters => {
    let r = out.get(id);
    if (!r) {
      r = emptyPostflopBets();
      out.set(id, r);
    }
    return r;
  };
  let stage: string | null | undefined = undefined;
  let fresh = true;
  let streetIn = new Map<string, number>();
  let pot = 0;
  let wageredBy: string | null = null; // the last voluntary wager of the street (null: none yet)
  let wagered = new Set<string>();
  let seen = new Set<string>();
  // open bet of the street waiting for a call: [player, street, bucket]
  let open: { id: string; street: PostflopShownStreet; bucket: PostflopSizeBucket } | null = null;
  const called: Array<{ id: string; street: PostflopShownStreet; bucket: PostflopSizeBucket }> = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const st = typeof a.stage === 'string' ? a.stage : null;
    if (fresh || st !== stage) {
      stage = st;
      fresh = false;
      streetIn = new Map();
      wageredBy = null;
      wagered = new Set();
      open = null;
    }
    const uid = typeof a.userId === 'string' ? a.userId : null;
    const sid = uid ?? '';
    const prev = streetIn.get(sid) ?? 0;
    const amt =
      typeof a.amount === 'number' && Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
    const act = typeof a.action === 'string' ? a.action : '';
    const wager = isWager({ action: act });
    const inc = act === 'fold' || act === 'check' ? 0 : wager ? Math.max(0, amt - prev) : amt;
    const postflop = st === 'flop' || st === 'turn' || st === 'river';
    if (postflop && uid && learnablePublicAction(a)) {
      const ag = aggressive(a);
      // raiseToBet: facing another player's wager on this street, not having wagered on it yet
      if (wageredBy !== null && wageredBy !== uid && !wagered.has(uid)) {
        const k = `${st}:${uid}`;
        if (!seen.has(k)) {
          seen.add(k);
          const c = rowOf(uid).raiseToBet[st as PostflopRaiseStreet];
          c.opp = 1;
          c.raise = ag ? 1 : 0;
        }
      }
      // shownBet: the street's first wager (turn / river), then its first answer
      if (open && uid !== open.id) {
        if (ag) open = null;
        else if (act === 'call' || (act === 'all_in' && !ag)) {
          called.push(open);
          open = null;
        }
      }
      if (ag && wageredBy === null && (st === 'turn' || st === 'river') && inc > 0 && pot > 0)
        open = { id: uid, street: st, bucket: postflopSizeBucket(inc, pot) };
      if (ag) {
        wageredBy = uid;
        wagered.add(uid);
      }
    }
    pot += inc;
    streetIn.set(sid, prev + inc);
  }
  const shownBy = new Map<string, PostflopShowdownEntry>();
  if (Array.isArray(showdown))
    for (const e of showdown)
      if (e && typeof e === 'object' && typeof e.user_id === 'string' && !shownBy.has(e.user_id))
        shownBy.set(e.user_id, e);
  for (const b of called) {
    const c = rowOf(b.id).shownBet[b.street][b.bucket];
    c.called = 1;
    const sd = shownBy.get(b.id);
    const shown = !!sd && sd.mucked !== true;
    c.shown = shown ? 1 : 0;
    c.air =
      shown && typeof sd!.hand_name === 'string' && sd!.hand_name.toLowerCase() === 'high card'
        ? 1
        : 0;
  }
  return out;
}

/** Age `row` and add one hand's increments: a cell ages only on a hand that gave it an opportunity. */
export function postflopBetDecayAndAdd(row: PostflopBetCounters, inc: PostflopBetCounters): void {
  for (const s of POSTFLOP_RAISE_STREETS) {
    const d = inc.raiseToBet[s];
    if (!(d.opp > 0)) continue;
    const r = row.raiseToBet[s];
    r.opp = r.opp * EXPLOIT_DECAY + d.opp;
    r.raise = r.raise * EXPLOIT_DECAY + d.raise;
  }
  for (const s of POSTFLOP_SHOWN_STREETS)
    for (const b of POSTFLOP_SIZE_BUCKETS) {
      const d = inc.shownBet[s][b];
      if (!(d.called > 0)) continue;
      const r = row.shownBet[s][b];
      r.called = r.called * EXPLOIT_DECAY + d.called;
      r.shown = r.shown * EXPLOIT_DECAY + d.shown;
      r.air = r.air * EXPLOIT_DECAY + d.air;
    }
}

function hasEvidence(inc: PostflopBetCounters): boolean {
  return (
    POSTFLOP_RAISE_STREETS.some((s) => inc.raiseToBet[s].opp > 0) ||
    POSTFLOP_SHOWN_STREETS.some((s) =>
      POSTFLOP_SIZE_BUCKETS.some((b) => inc.shownBet[s][b].called > 0)
    )
  );
}

const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  plainObject(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const goodNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Exact shape; every number finite and non-negative; raise <= opp; air <= shown <= called. */
export function validPostflopBets(r: unknown): r is PostflopBetCounters {
  if (!exactKeys(r, ['raiseToBet', 'shownBet'])) return false;
  if (!exactKeys(r.raiseToBet, POSTFLOP_RAISE_STREETS)) return false;
  for (const s of POSTFLOP_RAISE_STREETS) {
    const c = (r.raiseToBet as Record<string, unknown>)[s];
    if (!exactKeys(c, ['opp', 'raise'])) return false;
    if (!goodNumber(c.opp) || !goodNumber(c.raise) || c.raise > c.opp + 1e-9) return false;
  }
  if (!exactKeys(r.shownBet, POSTFLOP_SHOWN_STREETS)) return false;
  for (const s of POSTFLOP_SHOWN_STREETS) {
    const st = (r.shownBet as Record<string, unknown>)[s];
    if (!exactKeys(st, POSTFLOP_SIZE_BUCKETS)) return false;
    for (const b of POSTFLOP_SIZE_BUCKETS) {
      const c = st[b];
      if (!exactKeys(c, ['called', 'shown', 'air'])) return false;
      if (!goodNumber(c.called) || !goodNumber(c.shown) || !goodNumber(c.air)) return false;
      if (c.shown > c.called + 1e-9 || c.air > c.shown + 1e-9) return false;
    }
  }
  return true;
}

export function copyPostflopBets(r: PostflopBetCounters): PostflopBetCounters {
  const out = emptyPostflopBets();
  for (const s of POSTFLOP_RAISE_STREETS) out.raiseToBet[s] = { ...r.raiseToBet[s] };
  for (const s of POSTFLOP_SHOWN_STREETS)
    for (const b of POSTFLOP_SIZE_BUCKETS) out.shownBet[s][b] = { ...r.shownBet[s][b] };
  return out;
}

/** `base` with one hand's increments; a hand with no opportunity leaves it exactly as it was (null stays null). */
export function addPostflopBetEvidence(
  base: PostflopBetCounters | null | undefined,
  inc: PostflopBetCounters | null | undefined
): PostflopBetCounters | null {
  if (!inc || !hasEvidence(inc)) return base ?? null;
  const out = base ? copyPostflopBets(base) : emptyPostflopBets();
  postflopBetDecayAndAdd(out, inc);
  return out;
}

/** The games whose rows carry the record into a decision. */
export const POSTFLOP_BETS_CARRIED_VARIANTS = ['nlh'] as const;
export function postflopBetsCarriedFor(variant: string | null | undefined): boolean {
  return (POSTFLOP_BETS_CARRIED_VARIANTS as readonly string[]).includes(
    (variant ?? '').toLowerCase()
  );
}

/** The read-frame row: raiseToBet [opp, raise] x 3 streets, then shownBet [called, shown, air] x 2 x 4. */
export const POSTFLOP_BETS_ROW_LENGTH = 3 * 2 + 2 * 4 * 3;
export function postflopBetsRow(r: PostflopBetCounters): number[] {
  const out: number[] = [];
  for (const s of POSTFLOP_RAISE_STREETS) out.push(r.raiseToBet[s].opp, r.raiseToBet[s].raise);
  for (const s of POSTFLOP_SHOWN_STREETS)
    for (const b of POSTFLOP_SIZE_BUCKETS) {
      const c = r.shownBet[s][b];
      out.push(c.called, c.shown, c.air);
    }
  return out;
}
export function postflopBetsFromRow(row: readonly number[]): PostflopBetCounters | null {
  if (!Array.isArray(row) || row.length !== POSTFLOP_BETS_ROW_LENGTH) return null;
  const out = emptyPostflopBets();
  let i = 0;
  for (const s of POSTFLOP_RAISE_STREETS) {
    out.raiseToBet[s] = { opp: row[i], raise: row[i + 1] };
    i += 2;
  }
  for (const s of POSTFLOP_SHOWN_STREETS)
    for (const b of POSTFLOP_SIZE_BUCKETS) {
      out.shownBet[s][b] = { called: row[i], shown: row[i + 1], air: row[i + 2] };
      i += 3;
    }
  return validPostflopBets(out) ? out : null;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE READERS (the Prior anchor law: own record first, anchored to equilibrium, never the population)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pseudo-opportunities the anchor carries against his record (his record dominates as n grows: n / (n + K)). */
export const POSTFLOP_RECORD_PSEUDO = 20;

/**
 * His raise share facing a bet on `street`, shrunk to `anchor` (the caller's equilibrium raise share for the spot):
 * (raises + K anchor) / (opp + K). With no record: the anchor.
 */
export function raiseToBetShare(
  r: PostflopBetCounters | null | undefined,
  street: PostflopRaiseStreet,
  anchor: number
): { share: number; n: number } {
  const c = r?.raiseToBet[street];
  const n = c ? c.opp : 0;
  const s = c ? Math.min(c.raise, c.opp) : 0;
  const k = POSTFLOP_RECORD_PSEUDO;
  return { share: (s + k * anchor) / (n + k), n };
}

/**
 * His shown-bet air share on `street` at `size` (air of shown), with the shown count behind it. Null when nothing was
 * shown. The caller anchors it (balanced share for the size) and decides what sample it needs.
 */
export function shownBetAir(
  r: PostflopBetCounters | null | undefined,
  street: PostflopShownStreet,
  size: PostflopSizeBucket
): { air: number; shown: number } | null {
  const c = r?.shownBet[street][size];
  if (!c || !(c.shown > 0)) return null;
  return { air: Math.min(1, c.air / c.shown), shown: c.shown };
}
