/**
 * ONE ALERT PER TABLE PER STALL EPISODE (incident 075013fd, 2026-11-18).
 *
 * A Lightning host table has many hands in their post-commit step at once
 * (a fast fold frees its players before the envelope runs). When the table's
 * oldest envelope was slow, every later hand's drain spent its budget queued
 * behind it and filed its own critical LightningHandHost.
 * post_commit_obligations_pending alert: 1,736 deliveries for what was, per
 * table, one stuck hand. A hand queued behind a predecessor is not a failed
 * hand; the oldest open envelope is the one fact worth paging on.
 *
 * So the drain classifies every answer:
 *
 *   applied   ok === true.
 *   failed    a CLOSED LIST of definite refusals: the envelope does not
 *             exist or carries no obligations (not_found,
 *             legacy_no_obligations), or the envelope itself refused its
 *             payload (hash mismatch, an invalid obligation, a chip
 *             obligation on a diamond hand, a missing receipt). Retrying
 *             cannot change these. Alerted at once, per hand.
 *   queued    EVERYTHING ELSE: predecessor_pending, table_busy,
 *             obligation_lock_busy, and any error that is not on the list
 *             (timeouts, deadlocks, serialization failures, connection
 *             exhaustion, gateway errors, a failed predecessor scan). Under
 *             overload those are exactly what every hand sees at once, so
 *             they are retried within the budget and join the table's stall
 *             episode rather than paging per hand.
 *
 * When the budget is spent while queued, the hand reports to the table's
 * stall episode. A table has at most one open episode: the first stalled
 * hand opens it and files the ONE alert (the oldest open hand, its age);
 * later stalls only update it (current oldest, stalled hands, max age), even
 * as a slowly draining backlog advances its oldest hand. The episode closes
 * when a hand of the table applies without ever being queued (nothing older
 * was pending), or after EPISODE_QUIET_MS with no stall reported.
 * The outbox row stays authoritative; the projection worker is the successor.
 */
import { isQueuedPostCommitReason } from '../services/supabase/postCommitReasons.js';
import type { LightningOldestPendingPostCommit } from './LightningHandBackend.js';

export type PostCommitAnswerKind = 'applied' | 'queued' | 'failed';

/** Answers the envelope gives for a hand that will never apply by retrying. */
export const POST_COMMIT_DEFINITE_REASONS: ReadonlySet<string> = new Set([
  'not_found',
  'legacy_no_obligations',
]);

/**
 * The envelope's own refusals of its payload (RAISE EXCEPTION texts in
 * fn_ca_process_hand_post_commit_obligations and its validations). Retrying
 * the same immutable payload raises the same refusal.
 */
const DEFINITE_ERROR = new RegExp(
  [
    'payload hash mismatch',
    'invalid (rake|BBJ contribution|promo|insurance|pending-add-on|time-bank audit) (obligation|payload)',
    'diamond_hand_has_chip_obligations',
    'rake hand number exceeds downstream integer contract',
    'BBJ obligation club not found',
    'requires a stable hand identity',
    'promo obligation refused for hand',
    'pending add-on \\S+ (is not frozen|does not belong)',
    'produced no receipt for hand',
    'incomplete resolution receipt',
    'completion receipt was lost',
    'posthand_escrow_(original_proof_unknown|refusal_receipt_lost)',
    'Invalid insurance payment identity or amounts',
    'Insurance table does not belong to supplied club',
    'Insurance identity reused with a different payment payload',
  ].join('|'),
  'i'
);

export function isDefinitePostCommitError(message: string): boolean {
  return DEFINITE_ERROR.test(message);
}

export function classifyPostCommitAnswer(
  answer: { ok?: boolean; reason?: string } | null | undefined
): PostCommitAnswerKind {
  if (answer?.ok === true) return 'applied';
  if (isQueuedPostCommitReason(answer?.reason)) return 'queued';
  return typeof answer?.reason === 'string' && POST_COMMIT_DEFINITE_REASONS.has(answer.reason)
    ? 'failed'
    : 'queued';
}

export function classifyPostCommitError(message: string): PostCommitAnswerKind {
  return isDefinitePostCommitError(message) ? 'failed' : 'queued';
}

/** An episode with no stall reported for this long is over. */
export const POST_COMMIT_STALL_EPISODE_QUIET_MS = 15 * 60 * 1000;

export interface PostCommitStallEpisode {
  tableId: string;
  /** The oldest open hand when the episode opened (its alert names it). */
  firstOldestHandId: string;
  currentOldestHandId: string;
  stalledHands: number;
  maxOldestAgeMs: number | null;
  openedAtMs: number;
  lastStallAtMs: number;
}

/**
 * The open stall episode of each table. One per table, whatever its oldest
 * hand: a backlog that drains slowly advances its oldest hand many times and
 * is still one episode.
 */
export class PostCommitStallEpisodes {
  private readonly byTable = new Map<string, PostCommitStallEpisode>();

  /**
   * A hand of `tableId` spent its budget queued behind `oldestHandId`. True
   * when this opens the table's episode: the caller files the one alert.
   */
  stalled(
    tableId: string,
    oldestHandId: string,
    oldestAgeMs: number | null,
    nowMs: number
  ): { opened: boolean; episode: PostCommitStallEpisode } {
    this.prune(nowMs);
    const current = this.byTable.get(tableId);
    if (current) {
      current.currentOldestHandId = oldestHandId;
      current.stalledHands += 1;
      current.lastStallAtMs = nowMs;
      if (oldestAgeMs !== null)
        current.maxOldestAgeMs = Math.max(current.maxOldestAgeMs ?? 0, oldestAgeMs);
      return { opened: false, episode: { ...current } };
    }
    const episode: PostCommitStallEpisode = {
      tableId,
      firstOldestHandId: oldestHandId,
      currentOldestHandId: oldestHandId,
      stalledHands: 1,
      maxOldestAgeMs: oldestAgeMs,
      openedAtMs: nowMs,
      lastStallAtMs: nowMs,
    };
    this.byTable.set(tableId, episode);
    return { opened: true, episode: { ...episode } };
  }

  /**
   * A hand of `tableId` applied. Only a hand that was never queued proves
   * nothing older was pending at the table; that ends the episode.
   */
  applied(tableId: string, wasQueued: boolean): void {
    if (!wasQueued) this.byTable.delete(tableId);
  }

  episode(tableId: string): PostCommitStallEpisode | null {
    const e = this.byTable.get(tableId);
    return e ? { ...e } : null;
  }

  get size(): number {
    return this.byTable.size;
  }

  private prune(nowMs: number): void {
    for (const [table, episode] of this.byTable)
      if (nowMs - episode.lastStallAtMs > POST_COMMIT_STALL_EPISODE_QUIET_MS)
        this.byTable.delete(table);
  }
}

/** The process's registry: every LightningHandHost of every table shares it. */
export const processPostCommitStallEpisodes = new PostCommitStallEpisodes();

/** The age of the oldest open hand, in ms, when its commit time is known. */
export function oldestPendingAgeMs(
  oldest: LightningOldestPendingPostCommit | null | undefined,
  nowMs: number
): number | null {
  if (!oldest?.committedAt) return null;
  const at = Date.parse(oldest.committedAt);
  return Number.isFinite(at) ? Math.max(0, nowMs - at) : null;
}
