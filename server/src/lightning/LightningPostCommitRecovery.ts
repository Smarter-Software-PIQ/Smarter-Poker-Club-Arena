/**
 * PENDING POST-COMMIT OBLIGATIONS ARE DRAINED AT STARTUP AND BEFORE A FREEZE
 * (Phase 6, 2026-10-31).
 *
 * LightningHandHost.drainPostCommit retries a committed hand's post-commit
 * envelope for POST_COMMIT_BUDGET_MS and then gives up, filing
 * LightningHandHost.post_commit_obligations_pending. On 2026-10-30/31 that
 * fired 33 times and the obligations stayed pending until the engine
 * restarted: nothing came back for them. A restart (or a host that lost its
 * lease mid-drain) leaves exactly those rows behind, and a maintenance freeze
 * stops every money-moving write for five minutes on top of them.
 *
 * So the leader drains every pending envelope:
 *   - once at startup, before the hosts begin dealing new hands; and
 *   - at the break announcement, i.e. BEFORE the freeze, so nothing committed
 *     is left waiting through it.
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
