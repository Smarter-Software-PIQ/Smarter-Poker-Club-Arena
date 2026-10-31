/**
 * PENDING POST-COMMIT OBLIGATIONS ARE DRAINED ONCE AT STARTUP, AND COUNTED
 * AND ALERTED AT A BREAK ANNOUNCEMENT (Phase 6, 2026-10-31).
 *
 * LightningHandHost.drainPostCommit retries a committed hand's post-commit
 * envelope for POST_COMMIT_BUDGET_MS and then gives up, filing
 * LightningHandHost.post_commit_obligations_pending. On 2026-10-30/31 that
 * fired 33 times and the obligations stayed pending until the engine
 * restarted: nothing came back for them. A restart (or a host that lost its
 * lease mid-drain) leaves exactly those rows behind, and a maintenance freeze
 * stops every money-moving write for five minutes on top of them.
 *
 * So the leader drains every pending envelope once at startup, before the
 * hosts begin dealing new hands. That is the only drain: operator policy
 * (2026-10-31) allows no new recurring repair loop, so at the break
 * announcement the leader only COUNTS what is still pending
 * (readPendingPostCommitCount), publishes it on /health and /metrics, and
 * GameServer alerts when it is non-zero. The operator decides what to run.
 *
 * Idempotent by construction: fn_ca_process_hand_post_commit_obligations is
 * row-locked and receipt-protected, so a hand a live host is draining at the
 * same moment converges exactly once (processHandPostCommitObligations says
 * so in its own contract). Bounded: at most MAX_HANDS per pass, oldest first,
 * inside BUDGET_MS, and only hands committed at least MIN_AGE_MS ago so a
 * pass never races a host's own first attempt. Never throws.
 */
import { supabase } from '../services/supabase/client.js';
import { processHandPostCommitObligations } from '../services/supabase/handProjection.js';
import { describeError, reportError } from '../services/errorReporter.js';

export const POST_COMMIT_RECOVERY_MAX_HANDS = 500;
export const POST_COMMIT_RECOVERY_BUDGET_MS = 60_000;
export const POST_COMMIT_RECOVERY_MIN_AGE_MS = 15_000;

export interface PostCommitRecoveryDeps {
  /** Pending envelopes committed before `before`, oldest first, at most `limit`. */
  listPending(before: Date, limit: number): Promise<string[]>;
  process(handId: string): Promise<{ ok?: boolean; reason?: string }>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface PostCommitRecoveryResult {
  trigger: string;
  found: number;
  completed: number;
  stillPending: number;
  failed: number;
  outOfBudget: boolean;
  listFailed: boolean;
}

export async function drainPendingPostCommitObligations(
  trigger: string,
  deps: PostCommitRecoveryDeps,
  options: { maxHands?: number; budgetMs?: number; minAgeMs?: number } = {}
): Promise<PostCommitRecoveryResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const started = now();
  const budgetMs = options.budgetMs ?? POST_COMMIT_RECOVERY_BUDGET_MS;
  const result: PostCommitRecoveryResult = {
    trigger,
    found: 0,
    completed: 0,
    stillPending: 0,
    failed: 0,
    outOfBudget: false,
    listFailed: false,
  };
  let pending: string[];
  try {
    pending = await deps.listPending(
      new Date(started - (options.minAgeMs ?? POST_COMMIT_RECOVERY_MIN_AGE_MS)),
      options.maxHands ?? POST_COMMIT_RECOVERY_MAX_HANDS
    );
  } catch (error) {
    result.listFailed = true;
    log(`[PostCommitRecovery] ${trigger}: pending envelopes unreadable: ${describeError(error)}`);
    return result;
  }
  // One pass asks each hand once; duplicates in a page are asked once.
  const unique = [...new Set(pending)];
  result.found = unique.length;
  for (const handId of unique) {
    if (now() - started >= budgetMs) {
      result.outOfBudget = true;
      result.stillPending += 1;
      continue;
    }
    try {
      const out = await deps.process(handId);
      if (out?.ok === true) result.completed += 1;
      else result.stillPending += 1;
    } catch {
      result.failed += 1;
    }
  }
  if (result.found > 0 || result.listFailed)
    log(
      `[PostCommitRecovery] ${trigger}: ${result.completed} of ${result.found} pending ` +
        `post-commit envelope(s) completed, ${result.stillPending} still pending, ` +
        `${result.failed} failed${result.outOfBudget ? ' (pass budget spent)' : ''}`
    );
  return result;
}

/** The production reader: oldest committed envelopes not yet completed. */
export async function listPendingPostCommitEnvelopes(
  before: Date,
  limit: number
): Promise<string[]> {
  const { data, error } = await supabase
    .from('hand_atomic_commits')
    .select('hand_id')
    .not('post_commit_payload', 'is', null)
    .is('post_commit_completed_at', null)
    .lt('committed_at', before.toISOString())
    .order('committed_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`pending post-commit scan failed: ${describeError(error)}`);
  if (!Array.isArray(data)) throw new Error('pending post-commit scan returned no rows array');
  return data
    .map((row: { hand_id?: unknown }) => row.hand_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** One pass at a time per process: a second trigger joins the first. */
let inFlight: Promise<PostCommitRecoveryResult> | null = null;
export function recoverPendingPostCommitObligations(
  trigger: string
): Promise<PostCommitRecoveryResult> {
  if (inFlight) return inFlight;
  inFlight = drainPendingPostCommitObligations(trigger, {
    listPending: listPendingPostCommitEnvelopes,
    process: processHandPostCommitObligations,
  })
    .catch((error) => {
      reportError(error, 'PostCommitRecovery.pass_failed', { trigger });
      return {
        trigger,
        found: 0,
        completed: 0,
        stillPending: 0,
        failed: 0,
        outOfBudget: false,
        listFailed: true,
      };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * DETECTION, NOT REPAIR (operator policy, 2026-10-31). How many committed
 * envelopes older than MIN_AGE_MS are still pending, read with the same
 * bounded scan as the drain (at most POST_COMMIT_PENDING_COUNT_CAP + 1 ids,
 * so `capped` means "at least this many"). Never processes anything; never
 * throws: an unreadable scan is count null.
 */
export const POST_COMMIT_PENDING_COUNT_CAP = 1_000;

export interface PendingPostCommitObservation {
  trigger: string;
  /** Pending envelopes, or null when the scan could not be read. */
  count: number | null;
  /** The scan hit its cap: there are at least `count`. */
  capped: boolean;
  observedAtMs: number;
}

let lastObservation: PendingPostCommitObservation | null = null;

/** The latest count, for /health and /metrics. Null until the first read. */
export function pendingPostCommitObservation(): PendingPostCommitObservation | null {
  return lastObservation;
}

export async function observePendingPostCommitObligations(
  trigger: string,
  deps: Pick<PostCommitRecoveryDeps, 'listPending' | 'now' | 'log'>,
  options: { minAgeMs?: number; cap?: number } = {}
): Promise<PendingPostCommitObservation> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const cap = options.cap ?? POST_COMMIT_PENDING_COUNT_CAP;
  const observedAtMs = now();
  let observation: PendingPostCommitObservation;
  try {
    const ids = await deps.listPending(
      new Date(observedAtMs - (options.minAgeMs ?? POST_COMMIT_RECOVERY_MIN_AGE_MS)),
      cap + 1
    );
    const unique = new Set(ids).size;
    observation = { trigger, count: Math.min(unique, cap), capped: unique > cap, observedAtMs };
  } catch (error) {
    log(`[PostCommitRecovery] ${trigger}: pending envelopes uncountable: ${describeError(error)}`);
    observation = { trigger, count: null, capped: false, observedAtMs };
  }
  lastObservation = observation;
  return observation;
}

/** The production count: the same reader the startup drain uses. */
export function readPendingPostCommitCount(trigger: string): Promise<PendingPostCommitObservation> {
  return observePendingPostCommitObligations(trigger, { listPending: listPendingPostCommitEnvelopes });
}

/** /metrics lines for the latest count; none until a count has been read. */
export function pendingPostCommitPrometheusLines(
  observation: PendingPostCommitObservation | null = lastObservation
): string[] {
  if (!observation || observation.count === null) return [];
  return [
    '# HELP poker_lightning_post_commit_pending Committed hands whose post-commit envelope is still pending (older than 15s) at the last count (startup, break announcement); detection only, nothing drains on a timer',
    '# TYPE poker_lightning_post_commit_pending gauge',
    `poker_lightning_post_commit_pending{trigger="${observation.trigger}",capped="${observation.capped ? 1 : 0}"} ${observation.count}`,
    '# HELP poker_lightning_post_commit_pending_observed_at_seconds When that count was read',
    '# TYPE poker_lightning_post_commit_pending_observed_at_seconds gauge',
    `poker_lightning_post_commit_pending_observed_at_seconds ${Math.floor(observation.observedAtMs / 1000)}`,
  ];
}

/** Test seam: forget the latest count. */
export function resetPendingPostCommitObservationForTests(): void {
  lastObservation = null;
}
