/**
 * LAW: THE PROJECTION DRAIN YIELDS TO AN ENVELOPE THIS PROCESS IS APPLYING
 *
 * fn_project_hand_side_effects ran 1.45 times per committed hand on
 * production (2026-11-27 02:46:44Z to 02:50:33Z: 838 hands, 1,212 calls at a
 * 95 ms mean). 148 of the extra calls were the designed rake/BBJ banking pass
 * (one per hand with a stored obligation). The other 227 were a race: the
 * engine that committed a hand applies its post-commit envelope itself right
 * away, and the continuously running drain read the new outbox row in the
 * same instant and sent the hand's projection beside it. When the projection
 * took 'hand-post-commit:<table>' first it applied the envelope inside its own
 * call, answered predecessor_pending
 * (post_commit_completed_in_this_transaction) and owed a second full call.
 *
 * The drain now skips, with no round trip, a row whose envelope this process
 * has claimed (from the commit reply until processHandPostCommitObligations
 * settles, bounded by LOCAL_ENVELOPE_CLAIM_TTL_MS), and the release wakes it.
 *
 * These cases run the real worker and the real processHandPostCommitObligations
 * against a model of the two SQL functions' answers and count the RPCs each
 * hand costs. They pin: one projection call for a hand this process settles
 * (two for a raked hand, the designed banking pass), none while its envelope
 * is in flight, the wake on release, the release on a failed call, and an
 * expired claim never holding a row (the drain stays the crash successor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { hand_id: string; table_id: string; hand_number: number };
type Reply = { data: unknown; error: unknown };

const db = {
  outbox: new Map<string, Row>(),
  envelopeDone: new Set<string>(),
  raked: new Set<string>(),
  rakeStored: new Set<string>(),
};
const projectCalls: string[] = [];
const postCommitCalls: string[] = [];
const postCommitGates = new Map<string, Promise<void>>();
let postCommitFails = false;

function applyEnvelope(id: string): void {
  db.envelopeDone.add(id);
  if (db.raked.has(id)) db.rakeStored.add(id);
}

/* fn_project_hand_side_effects, reduced to the answers it gives in order. */
function project(id: string): Reply {
  if (!db.outbox.has(id)) return { data: { ok: false, reason: 'not_pending' }, error: null };
  if (db.rakeStored.has(id)) {
    db.rakeStored.delete(id);
    return {
      data: {
        ok: false,
        reason: 'predecessor_pending',
        detail: 'cash_rake_banked_in_this_transaction',
      },
      error: null,
    };
  }
  if (!db.envelopeDone.has(id)) {
    applyEnvelope(id);
    return {
      data: {
        ok: false,
        reason: 'predecessor_pending',
        detail: 'post_commit_completed_in_this_transaction',
      },
      error: null,
    };
  }
  db.outbox.delete(id);
  return { data: { ok: true, hand_id: id }, error: null };
}

/* fn_ca_process_hand_post_commit_obligations: applies once, then answers completed. */
async function postCommit(id: string): Promise<Reply> {
  await postCommitGates.get(id);
  if (postCommitFails) throw new Error('transport reset');
  const already = db.envelopeDone.has(id);
  if (!already) applyEnvelope(id);
  return { data: { ok: true, already_completed: already, hand_id: id }, error: null };
}

function builder(reply: Promise<Reply>) {
  const b = {
    setHeader: () => b,
    abortSignal: () => b,
    then: <A, B>(
      ok?: ((v: Reply) => A | PromiseLike<A>) | null,
      err?: ((e: unknown) => B | PromiseLike<B>) | null
    ) => reply.then(ok, err),
  };
  return b;
}

vi.mock('./client.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'hand_projection_outbox') throw new Error(`unexpected read of ${table}`);
      let after = 0;
      let ascending = true;
      const query = {
        select: () => query,
        gt: (_c: string, v: number) => ((after = v), query),
        lte: () => query,
        order: (_c: string, o: { ascending: boolean }) => ((ascending = o.ascending), query),
        abortSignal: () => query,
        limit: (n: number) => {
          const rows = [...db.outbox.values()]
            .filter((r) => r.hand_number > after)
            .sort((a, b) => (ascending ? 1 : -1) * (a.hand_number - b.hand_number))
            .slice(0, n);
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return query;
    },
    rpc: (fn: string, args: { p_hand_id: string }) => {
      if (fn === 'fn_project_hand_side_effects') {
        projectCalls.push(args.p_hand_id);
        return builder(Promise.resolve(project(args.p_hand_id)));
      }
      if (fn === 'fn_ca_process_hand_post_commit_obligations') {
        postCommitCalls.push(args.p_hand_id);
        return builder(postCommit(args.p_hand_id));
      }
      if (fn === 'ca_record_stats_projection_failure')
        return builder(Promise.resolve({ data: null, error: null }));
      throw new Error(`unexpected rpc ${fn}`);
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: async () => 'ok',
  },
}));

vi.mock('../errorReporter.js', () => ({
  describeError: (error: unknown) => String(error),
  reportError: () => undefined,
}));

// Keep the 5 s safety poll out of the counts; every wake here is explicit.
process.env.HAND_PROJECTION_POLL_MS = '60000';
const worker = await import('./handProjection.js');

let hand = 1_000;
function commit(opts: { raked?: boolean; table?: string } = {}): string {
  hand++;
  const id = `hand-${hand}`;
  db.outbox.set(id, { hand_id: id, table_id: opts.table ?? `table-${hand}`, hand_number: hand });
  if (opts.raked) db.raked.add(id);
  return id;
}
const count = (calls: string[], id: string) => calls.filter((c) => c === id).length;
function gate(id: string): () => void {
  let open!: () => void;
  postCommitGates.set(
    id,
    new Promise<void>((resolve) => {
      open = resolve;
    })
  );
  return open;
}

beforeEach(async () => {
  await worker.stopHandProjectionWorker();
  db.outbox.clear();
  db.envelopeDone.clear();
  db.raked.clear();
  db.rakeStored.clear();
  projectCalls.length = 0;
  postCommitCalls.length = 0;
  postCommitGates.clear();
  postCommitFails = false;
  worker.startHandProjectionWorker();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await worker.stopHandProjectionWorker();
});

describe('the projection drain yields to an envelope this process is applying', () => {
  it('a hand nobody here settles, raced by the drain, costs two projection calls (the cost removed below)', async () => {
    const id = commit();
    await worker.wakeHandProjection('local');
    await vi.waitFor(() => expect(db.outbox.has(id)).toBe(false), { timeout: 5_000 });
    expect(count(projectCalls, id)).toBe(2);
  });

  it('a hand whose envelope this process applies costs one projection call and none while it is in flight', async () => {
    const id = commit();
    worker.claimLocalPostCommitEnvelope(id); // handHistory.ts, at the commit reply
    const open = gate(id);
    const envelope = worker.processHandPostCommitObligations(id);
    const yieldsBefore = worker.handProjectionLocalEnvelopeYields();
    const wakesBefore = worker.handProjectionWakeCounts().local_envelope;

    const pass = await worker.wakeHandProjection('local');
    expect(count(projectCalls, id)).toBe(0);
    expect(pass.deferred).toBe(1);
    expect(worker.handProjectionLocalEnvelopeYields()).toBe(yieldsBefore + 1);

    open();
    await expect(envelope).resolves.toMatchObject({ ok: true, already_completed: false });
    await vi.waitFor(() => expect(db.outbox.has(id)).toBe(false), { timeout: 5_000 });
    expect(count(projectCalls, id)).toBe(1);
    expect(count(postCommitCalls, id)).toBe(1);
    expect(worker.handProjectionWakeCounts().local_envelope).toBe(wakesBefore + 1);
    expect(worker.localPostCommitEnvelopeClaims()).toBe(0);
  });

  it('a raked hand settled here costs two calls (the designed banking pass), not three', async () => {
    const remote = commit({ raked: true });
    await worker.wakeHandProjection('local');
    await vi.waitFor(() => expect(db.outbox.has(remote)).toBe(false), { timeout: 5_000 });
    expect(count(projectCalls, remote)).toBe(3);

    const local = commit({ raked: true });
    worker.claimLocalPostCommitEnvelope(local);
    const open = gate(local);
    const envelope = worker.processHandPostCommitObligations(local);
    await worker.wakeHandProjection('local');
    open();
    await envelope;
    await vi.waitFor(() => expect(db.outbox.has(local)).toBe(false), { timeout: 5_000 });
    expect(count(projectCalls, local)).toBe(2);
  });

  it("the table's later rows wait behind the yielded row and keep their order", async () => {
    const first = commit({ table: 'shared' });
    const second = commit({ table: 'shared' });
    db.envelopeDone.add(second);
    worker.claimLocalPostCommitEnvelope(first);
    const open = gate(first);
    const envelope = worker.processHandPostCommitObligations(first);
    await worker.wakeHandProjection('local');
    expect(projectCalls).toEqual([]);
    open();
    await envelope;
    await vi.waitFor(() => expect(db.outbox.size).toBe(0), { timeout: 5_000 });
    expect(projectCalls).toEqual([first, second]);
  });

  it('a failed envelope call still releases its claim and hands the row back to the drain', async () => {
    const id = commit();
    worker.claimLocalPostCommitEnvelope(id);
    const open = gate(id);
    postCommitFails = true;
    const envelope = worker.processHandPostCommitObligations(id);
    await worker.wakeHandProjection('local');
    expect(count(projectCalls, id)).toBe(0);
    open();
    await expect(envelope).rejects.toThrow();
    expect(worker.localPostCommitEnvelopeClaims()).toBe(0);
    await vi.waitFor(() => expect(db.outbox.has(id)).toBe(false), { timeout: 5_000 });
  });

  it('an expired claim never holds a row: the drain remains the crash successor', async () => {
    const id = commit();
    worker.claimLocalPostCommitEnvelope(id); // an engine that stopped before its envelope
    await worker.wakeHandProjection('local');
    expect(count(projectCalls, id)).toBe(0);

    const realNow = Date.now.bind(Date);
    const skew = worker.LOCAL_ENVELOPE_CLAIM_TTL_MS + 1;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    await worker.wakeHandProjection('local');
    await vi.waitFor(() => expect(db.outbox.has(id)).toBe(false), { timeout: 5_000 });
    expect(count(projectCalls, id)).toBeGreaterThan(0);
  });
});
