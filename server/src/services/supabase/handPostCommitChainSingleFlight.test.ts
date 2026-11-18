/**
 * ONE CHAIN HELPER PER TABLE PER PROCESS (incident 075013fd, 2026-11-18).
 *
 * A Lightning host table has many hands in their post-commit step at once.
 * Each one that met predecessor_pending used to walk the table's earlier
 * envelopes itself, so N concurrent callers re-ran one chain N times against
 * the same per-table lock. The fake database below answers exactly as
 * fn_ca_process_hand_post_commit_obligations does after 20261118073646:
 * completed first, then predecessor_pending (naming the oldest open hand),
 * then table_busy while another session holds the table, then apply.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('./client.js', () => ({ supabase: mocks }));
vi.mock('../errorReporter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../errorReporter.js')>()),
  reportError: vi.fn(),
}));
import {
  isQueuedPostCommitReason,
  postCommitChainHelpersInFlight,
  processHandPostCommitObligations,
} from './handProjection.js';

const TABLE = '00000000-0000-0000-0000-0000000000a1';
const hand = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

/** One table of `count` committed hands; hand 1 may be held by another session. */
function fakeTable(count: number) {
  const done = new Set<string>();
  const applied: string[] = [];
  const db = { heldByAnotherSession: false, scans: 0, rpcs: 0, hand1Delay: 0 };
  const number = (id: string) => Number(id.slice(-12));
  const oldestOpen = (below: number) =>
    Array.from({ length: count }, (_, i) => hand(i + 1)).find(
      (id) => number(id) < below && !done.has(id)
    );
  mocks.rpc.mockImplementation(async (_fn: string, { p_hand_id: id }: { p_hand_id: string }) => {
    db.rpcs++;
    if (done.has(id)) return { data: { ok: true, already_completed: true, hand_id: id }, error: null };
    const n = number(id);
    const oldest = oldestOpen(n);
    if (oldest)
      return {
        data: {
          ok: false,
          reason: 'predecessor_pending',
          retryable: true,
          hand_id: id,
          table_id: TABLE,
          hand_number: n,
          oldest_pending_hand_id: oldest,
          oldest_pending_hand_number: number(oldest),
          oldest_pending_committed_at: '2026-11-18T05:00:00Z',
        },
        error: null,
      };
    if (db.heldByAnotherSession)
      return {
        data: { ok: false, reason: 'table_busy', retryable: true, hand_id: id, table_id: TABLE },
        error: null,
      };
    if (n === 1 && db.hand1Delay) await new Promise((r) => setTimeout(r, db.hand1Delay));
    done.add(id);
    applied.push(id);
    return { data: { ok: true, hand_id: id, hand_number: n }, error: null };
  });
  mocks.from.mockImplementation(() => {
    const filters: Record<string, unknown> = {};
    const query: any = {};
    for (const m of ['select', 'not', 'is', 'order']) query[m] = vi.fn().mockReturnValue(query);
    query.eq = vi.fn((k: string, v: unknown) => ((filters[k] = v), query));
    query.lt = vi.fn((k: string, v: unknown) => ((filters[k] = v), query));
    query.limit = vi.fn(async (limit: number) => {
      db.scans++;
      const below = filters.hand_number as number;
      const rows = Array.from({ length: count }, (_, i) => hand(i + 1))
        .filter((id) => number(id) < below && !done.has(id))
        .slice(0, limit)
        .map((hand_id) => ({ hand_id }));
      return { data: rows, error: null };
    });
    query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    return query;
  });
  return { db, done, applied };
}

beforeEach(() => vi.resetAllMocks());

describe('one chain helper per table per process', () => {
  it('twenty concurrent successors behind a held head walk the chain once, and back off', async () => {
    const { db, applied } = fakeTable(21);
    db.heldByAnotherSession = true;
    const answers = await Promise.all(
      Array.from({ length: 20 }, (_, i) => processHandPostCommitObligations(hand(i + 2)))
    );
    // Every successor is queued behind hand 1, and says so.
    expect(answers.every((a) => a.ok === false && a.reason === 'predecessor_pending')).toBe(true);
    expect(new Set(answers.map((a) => a.oldest_pending_hand_id))).toEqual(new Set([hand(1)]));
    // ONE scan, ONE attempt at the head (table_busy), then nobody re-asks.
    expect(db.scans).toBe(1);
    expect(db.rpcs).toBe(20 + 1);
    expect(applied).toEqual([]);
    expect(postCommitChainHelpersInFlight()).toBe(0);
  });

  it('when the head frees, the one helper advances it and every joiner asks only for its own hand', async () => {
    const { db, applied } = fakeTable(6);
    db.hand1Delay = 20;
    const answers = await Promise.all(
      [2, 3, 4, 5, 6].map((n) => processHandPostCommitObligations(hand(n)))
    );
    // Hand 1 applied exactly once, by one walk; never by five.
    expect(applied.filter((id) => id === hand(1))).toHaveLength(1);
    expect(applied[0]).toBe(hand(1));
    expect(db.scans).toBe(1);
    // Strict order: nothing was applied ahead of an open predecessor.
    const order = applied.map((id) => Number(id.slice(-12)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The walker's own hand and every hand the walk reached are done; the
    // rest answer predecessor_pending (retryable), never an error.
    for (const a of answers)
      expect(a.ok === true || isQueuedPostCommitReason(a.reason)).toBe(true);
    expect(postCommitChainHelpersInFlight()).toBe(0);
  });

  it("a joiner does not wait on a walk that is not bound to end within its own budget", async () => {
    const { db } = fakeTable(4);
    db.hand1Delay = 200;
    let joinedAt = 0;
    let joinerDoneAt = 0;
    const [, joiner] = await Promise.all([
      // The worker's walk: no budget, so not bound to end at any time.
      processHandPostCommitObligations(hand(3)),
      new Promise((r) => setTimeout(r, 5)).then(async () => {
        joinedAt = Date.now();
        const out = await processHandPostCommitObligations(hand(4), { waitAtMostMs: 20 });
        joinerDoneAt = Date.now();
        return out;
      }),
    ]);
    // The joiner came back with its own queued answer at once, never walking.
    expect(joiner).toMatchObject({ ok: false, reason: 'predecessor_pending' });
    expect(joinerDoneAt - joinedAt).toBeLessThan(100);
    expect(db.scans).toBe(1);
  });

  it('a joiner waits on a walk bound to end within its budget', async () => {
    const { db, applied } = fakeTable(4);
    db.hand1Delay = 30;
    const [walker, joiner] = await Promise.all([
      processHandPostCommitObligations(hand(3), { waitAtMostMs: 1_000 }),
      new Promise((r) => setTimeout(r, 5)).then(() =>
        processHandPostCommitObligations(hand(4), { waitAtMostMs: 5_000 })
      ),
    ]);
    expect(walker.ok).toBe(true);
    expect(joiner.ok === true || joiner.reason === 'predecessor_pending').toBe(true);
    expect(applied.slice(0, 3)).toEqual([hand(1), hand(2), hand(3)]);
    expect(db.scans).toBe(1);
  });

  it('a walker whose host lost its lease stops walking', async () => {
    const { db, applied } = fakeTable(5);
    const answer = await processHandPostCommitObligations(hand(5), { shouldContinue: () => false });
    expect(answer).toMatchObject({ ok: false, reason: 'predecessor_pending' });
    expect(applied).toEqual([]);
    expect(db.rpcs).toBe(1);
    expect(postCommitChainHelpersInFlight()).toBe(0);
  });

  it('table_busy is retryable and never starts a walk', async () => {
    const { db } = fakeTable(1);
    db.heldByAnotherSession = true;
    expect(await processHandPostCommitObligations(hand(1))).toMatchObject({
      ok: false,
      reason: 'table_busy',
      retryable: true,
    });
    expect(db.scans).toBe(0);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(isQueuedPostCommitReason('table_busy')).toBe(true);
    expect(isQueuedPostCommitReason('obligation_lock_busy')).toBe(true);
    expect(isQueuedPostCommitReason('predecessor_pending')).toBe(true);
    expect(isQueuedPostCommitReason('not_found')).toBe(false);
  });

  it('a walk that fails is not repeated by its joiners, and its error reaches only the walker', async () => {
    fakeTable(4);
    const scanError = { message: 'scan failed' };
    mocks.from.mockImplementation(() => {
      const query: any = {};
      for (const m of ['select', 'eq', 'lt', 'not', 'is', 'order'])
        query[m] = vi.fn().mockReturnValue(query);
      query.limit = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { data: null, error: scanError };
      });
      return query;
    });
    const results = await Promise.allSettled([3, 4].map((n) => processHandPostCommitObligations(hand(n))));
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const joined = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
    expect(joined.value).toMatchObject({ ok: false, reason: 'predecessor_pending' });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(postCommitChainHelpersInFlight()).toBe(0);
  });
});
