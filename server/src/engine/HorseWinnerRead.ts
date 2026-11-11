/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PROVEN WINNER IS RESPECTED (2026-10-24)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan: track the players who are beating the horses and switch the fleet to a
 * counter-strategy against them, so the horses are not taken advantage of.
 *
 * WHAT A WINNER IS. A player whose result, measured over every hand they play
 * (public information: what they put in and what they took out), is credibly
 * positive: the decayed mean net per hand, less WINNER_Z standard errors of
 * that same sample, is still above zero. No horse flag is consulted - a person
 * sitting at the table can see who keeps winning, and that is all this sees.
 * Poker results are noisy (a single hand swings tens of big blinds), so the
 * error term is measured from the player's own swings and a read needs
 * WINNER_MIN_HANDS of effective sample before it can engage at all.
 *
 * WHAT CHANGES AGAINST ONE. Only the two levers a strong player punishes:
 * every horse bluffs them less (WINNER_BLUFF_MOD) and stops value-betting
 * thin into them (WINNER_VALUE_THIN_MOD). Every read of HOW they play stays:
 * a winning maniac is still called down as a maniac. Switching the reads off
 * against winners was measured as the wrong counter - it would have undone
 * the maniac adjustments exactly when the maniac is the one winning.
 *
 * Learned from every completed hand on every worker shard (the owner and each
 * mirror), deduplicated by hand key, bounded in memory, never persisted.
 */
import type { ExploitProfile } from './HorseMind.js';

/** Results decay with this half-life (hands), so a player who stops winning stops being read as one. */
export const WINNER_HALF_LIFE_HANDS = 1000;
/** Effective hands before a winner read can engage. */
export const WINNER_MIN_HANDS = 300;
/**
 * Standard errors the mean must clear (99% one-sided: a break-even player is
 * misread as a winner about one time in a hundred, and the cost of that
 * misread is only fewer bluffs at them). With a 1,000-hand half-life the
 * effective sample settles near 2,800 hands, so at a typical 9bb per-hand
 * swing a player must be winning about 40bb/100 to be read as a winner: a real
 * edge over the horses, not a heater.
 */
export const WINNER_Z = 2.326;
/** Bluff frequency against a proven winner (multiplies, never raises). */
export const WINNER_BLUFF_MOD = 0.6;
/** Thin value against a proven winner (capped at neutral). */
export const WINNER_VALUE_THIN_MOD = 0.85;
/** Thin-value floor against a high-VPIP / high-stab LAG winner ("Bully-Breaker"):
 *  LAG winners accumulate chips by stealing uncontested pots and stabbing wide,
 *  never by playing tight ranges - throttling bluffs or thin value hands them free equity. */
export const WINNER_LAG_VALUE_THIN_FLOOR = 1.12;
/** Net per hand is clipped to this many big blinds, so one cooler cannot make a winner. */
export const WINNER_CLIP_BB = 100;

const DECAY = Math.pow(0.5, 1 / WINNER_HALF_LIFE_HANDS);
const MAX_PLAYERS = 50_000;
const MAX_HANDS_SEEN = 40_000;

export const WINNER_READ_SCOPES = [
  'holdem:cash',
  'holdem:tournament',
  'omaha:cash',
  'omaha:tournament',
  'sixplus:cash',
  'sixplus:tournament',
] as const;

export type WinnerReadScope = (typeof WINNER_READ_SCOPES)[number];

export function winnerReadScopeOf(
  variant?: string | null,
  format: string = 'cash'
): WinnerReadScope {
  const v = (variant || 'nlh').toLowerCase();
  const family =
    v.includes('short') || v === '6+' || v.includes('sixplus')
      ? 'sixplus'
      : v.startsWith('plo') || v === 'flo8' || v.includes('omaha')
        ? 'omaha'
        : 'holdem';
  const f = (format || 'cash').toLowerCase();
  const mode =
    f === 'tournament' || f === 'mtt' || f === 'sng' || f === 'spins' ? 'tournament' : 'cash';
  return `${family}:${mode}`;
}

export interface HorseWinnerReadRow {
  /** sum of weights */
  w: number;
  /** sum of squared weights (effective sample = w^2 / w2) */
  w2: number;
  /** weighted sum of net (bb) */
  s: number;
  /** weighted sum of net^2 */
  q: number;
}

export interface HorseWinnerReadState {
  rows: Map<string, HorseWinnerReadRow>;
  seen: Set<string>;
}

export const createWinnerReadState = (): HorseWinnerReadState => ({
  rows: new Map(),
  seen: new Set(),
});
let state = createWinnerReadState();

function resolveWinnerRow(userId: string, scope?: string | null): HorseWinnerReadRow | undefined {
  if (!scope) return state.rows.get(userId);
  const exact = state.rows.get(`${scope}|${userId}`);
  if (exact) return exact;
  for (const candidate of WINNER_READ_SCOPES) {
    if (state.rows.has(`${candidate}|${userId}`)) return undefined;
  }
  return state.rows.get(userId);
}

function upsertWinnerRow(key: string, x: number): void {
  const row = state.rows.get(key) ?? { w: 0, w2: 0, s: 0, q: 0 };
  state.rows.delete(key);
  row.w = row.w * DECAY + 1;
  row.w2 = row.w2 * DECAY * DECAY + 1;
  row.s = row.s * DECAY + x;
  row.q = row.q * DECAY + x * x;
  state.rows.set(key, row);
}

function rememberSeenHandKey(key: string): void {
  state.seen.add(key);
  while (state.seen.size > MAX_HANDS_SEEN) state.seen.delete(state.seen.values().next().value!);
}

/** Synchronous private boundary, restored even when a decision throws. */
export function runWithWinnerReadState<T>(isolated: HorseWinnerReadState, fn: () => T): T {
  const live = state;
  state = isolated;
  try {
    return fn();
  } finally {
    state = live;
  }
}

/** Read evidence only: dedupe and unrelated players never enter a frame. */
export function snapshotWinnerReads(
  ids: readonly string[],
  scope?: string | null
): HorseWinnerReadState {
  if (ids.length > 10 || new Set(ids).size !== ids.length)
    throw Error('Invalid Horse winner read boundary');
  const snapshot = createWinnerReadState();
  for (const id of ids) {
    const row = resolveWinnerRow(id, scope);
    if (row) snapshot.rows.set(id, { ...row });
  }
  return snapshot;
}

/** Detached copy of boot-hydrated winner rows for pooled worker floor bootstrap. */
export function exportWinnerReadSnapshot(): HorseWinnerReadState {
  const snapshot = createWinnerReadState();
  for (const [k, row] of state.rows) {
    snapshot.rows.set(k, { ...row });
  }
  for (const k of state.seen) {
    snapshot.seen.add(k);
  }
  return snapshot;
}

export interface WinnerResult {
  user_id: string;
  /** chips: what this player took out of the pot less what they put in */
  net: number;
}

/** Learn one completed hand. Idempotent per hand key (and any canonical/UUID aliases). */
export function observeHandResults(
  handKey: string,
  results: ReadonlyArray<WinnerResult> | null | undefined,
  bigBlind: number,
  scope?: string | null,
  aliasHandKeys?: readonly string[]
): boolean {
  if (!handKey || !results?.length || !(bigBlind > 0) || state.seen.has(handKey)) return false;
  if (
    aliasHandKeys?.some(
      (alias) => typeof alias === 'string' && alias.length > 0 && state.seen.has(alias)
    )
  ) {
    return false;
  }
  rememberSeenHandKey(handKey);
  if (aliasHandKeys) {
    for (const alias of aliasHandKeys) {
      if (typeof alias === 'string' && alias.length > 0) rememberSeenHandKey(alias);
    }
  }
  for (const r of results) {
    if (!r || typeof r.user_id !== 'string' || !Number.isFinite(r.net)) continue;
    const x = Math.max(-WINNER_CLIP_BB, Math.min(WINNER_CLIP_BB, r.net / bigBlind));
    if (scope) {
      upsertWinnerRow(`${scope}|${r.user_id}`, x);
      if (!scope.endsWith(':tournament')) {
        upsertWinnerRow(r.user_id, x);
      }
    } else {
      upsertWinnerRow(r.user_id, x);
    }
  }
  while (state.rows.size > MAX_PLAYERS) state.rows.delete(state.rows.keys().next().value!);
  return true;
}

export interface WinnerReadout {
  effectiveHands: number;
  /** decayed mean net, bb per hand */
  meanBB: number;
  /** standard error of that mean */
  seBB: number;
  proven: boolean;
}

export function winnerReadout(userId: string, scope?: string | null): WinnerReadout | null {
  const row = resolveWinnerRow(userId, scope);
  if (!row || row.w <= 0) return null;
  const mean = row.s / row.w;
  const variance = Math.max(0, row.q / row.w - mean * mean);
  const effectiveHands = row.w2 > 0 ? (row.w * row.w) / row.w2 : 0;
  const se = effectiveHands > 1 ? Math.sqrt(variance / (effectiveHands - 1)) : Infinity;
  const proven = effectiveHands >= WINNER_MIN_HANDS && mean - WINNER_Z * se > 0;
  return { effectiveHands, meanBB: mean, seBB: se, proven };
}

export function isProvenWinner(userId: string, scope?: string | null): boolean {
  return winnerReadout(userId, scope)?.proven === true;
}

/** The counter-strategy: fewer bluffs, no thin value against disciplined TAG winners;
 *  against high-VPIP / high-stab LAG winners (`isLagBully`), keep full bluff playback
 *  and expand thin value so wide stabs and loose calldowns are punished. */
export function respectWinner(
  profile: ExploitProfile,
  userId: string,
  isLagBully = false,
  scope?: string | null
): ExploitProfile {
  if (!isProvenWinner(userId, scope)) return profile;
  if (isLagBully) {
    return {
      bluffMod: profile.bluffMod,
      callDownMod: profile.callDownMod,
      valueThinMod: Math.max(profile.valueThinMod, WINNER_LAG_VALUE_THIN_FLOOR),
    };
  }
  return {
    bluffMod: profile.bluffMod * WINNER_BLUFF_MOD,
    callDownMod: profile.callDownMod,
    valueThinMod: Math.min(profile.valueThinMod, WINNER_VALUE_THIN_MOD),
  };
}

/** Test hook. */
export function resetWinnerReads(): void {
  state.rows.clear();
  state.seen.clear();
}
