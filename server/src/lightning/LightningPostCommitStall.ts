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
 *   queued    predecessor_pending, table_busy, obligation_lock_busy (the
 *             envelope wrote nothing and says retry), or a thrown error that
 *             is a timeout or transport doubt, or F06_RETRY_CANONICAL_LANE.
 *             Retried within the budget; owned by the chain helper
 *             (processHandPostCommitObligations single flight).
 *   failed    anything else: a definite refusal. Alerted at once, per hand,
 *             exactly as before.
 *
 * and when the budget is spent while queued, it files ONE alert per episode,
 * keyed on the table and its oldest open hand, carrying that hand and its age.
 * The outbox row stays authoritative; the projection worker is the successor.
 */
import { isQueuedPostCommitReason } from '../services/supabase/postCommitReasons.js';
import type { LightningOldestPendingPostCommit } from './LightningHandBackend.js';

export type PostCommitAnswerKind = 'applied' | 'queued' | 'failed';

/**
 * A thrown error that says "the outcome is not known yet" rather than "no":
 * a statement or transport timeout, a dropped connection, a gateway answer,
 * or the tournament lane's explicit retry request.
 */
const TRANSIENT_ERROR =
  /statement timeout|canceling statement|57014|timed? ?out|timeout|F06_RETRY_CANONICAL_LANE|55P03|lock_not_available|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network|\b50[234]\b/i;

export function isTransientPostCommitError(message: string): boolean {
  return TRANSIENT_ERROR.test(message);
}

export function classifyPostCommitAnswer(
  answer: { ok?: boolean; reason?: string } | null | undefined
): PostCommitAnswerKind {
  if (answer?.ok === true) return 'applied';
  return isQueuedPostCommitReason(answer?.reason) ? 'queued' : 'failed';
}

/** Episodes older than this are forgotten (memory bound, not a re-alert timer). */
export const POST_COMMIT_STALL_EPISODE_TTL_MS = 6 * 60 * 60 * 1000;

export interface PostCommitStallEpisode {
  tableId: string;
  oldestHandId: string;
  openedAtMs: number;
}

/**
 * Which stall episodes have already been alerted, per table. A table has at
 * most one open episode; a new oldest open hand is a new episode.
 */
export class PostCommitStallEpisodes {
  private readonly byTable = new Map<string, PostCommitStallEpisode>();

  /** True exactly once per (table, oldest open hand): the caller files the alert. */
  open(tableId: string, oldestHandId: string, nowMs: number): boolean {
    this.prune(nowMs);
    const current = this.byTable.get(tableId);
    if (current && current.oldestHandId === oldestHandId) return false;
    this.byTable.set(tableId, { tableId, oldestHandId, openedAtMs: nowMs });
    return true;
  }

  /** The table's oldest open hand applied: its episode is over. */
  close(tableId: string, handId: string): void {
    const current = this.byTable.get(tableId);
    if (current && current.oldestHandId === handId) this.byTable.delete(tableId);
  }

  get size(): number {
    return this.byTable.size;
  }

  private prune(nowMs: number): void {
    for (const [table, episode] of this.byTable)
      if (nowMs - episode.openedAtMs > POST_COMMIT_STALL_EPISODE_TTL_MS) this.byTable.delete(table);
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
