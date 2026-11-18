/**
 * ONE ALERT PER TABLE PER STALL EPISODE (incident 075013fd, 2026-11-18).
 *
 * The herd: many Lightning hands at one host table commit, then all queue
 * behind one slow predecessor's post-commit envelope. Before, every hand's
 * drain spent its budget and filed its own critical alert (1,736 deliveries
 * in the incident). Now a queued hand is not a failed hand: the hosts file
 * ONE alert for the table's stall, naming the oldest open hand and its age.
 * A real refusal is still alerted at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the post-commit stall fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the post-commit stall fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: vi.fn(),
  describeError: (e: unknown) => String((e as Error)?.message ?? e),
}));
const alerts = vi.hoisted(() => ({ raised: [] as Array<{ source: string; message: string; details: any }> }));
vi.mock('../services/financialAlerts.js', () => ({
  raiseFinancialAlert: vi.fn(async (_sev: string, source: string, message: string, details: any) => {
    alerts.raised.push({ source, message, details });
  }),
}));
const { mulberry32 } = await import('../engine/HandFuzzer.js');
const kit = await import('../testing/lightningHostTestKit.js');
const {
  PostCommitStallEpisodes,
  POST_COMMIT_STALL_EPISODE_QUIET_MS,
  classifyPostCommitAnswer,
  classifyPostCommitError,
  oldestPendingAgeMs,
} = await import('./LightningPostCommitStall.js');
const { buildHost, formedHand, flush, playOut, uid } = kit;

const foldAll = (_u: string, legal: string[]) => (legal.includes('fold') ? 'fold' : null);
const SOURCE = 'LightningHandHost.post_commit_obligations_pending';
const HEAD = uid(1);
const COMMITTED = '2026-11-18T05:00:00.000Z';

beforeEach(() => {
  alerts.raised = [];
});
afterEach(() => {
  vi.useRealTimers();
});

/** A clock every host shares; each sleep moves it, as the incident's real clock did. */
function sharedClock(startMs: number) {
  const clock = { nowMs: startMs };
  return {
    clock,
    deps: {
      now: () => clock.nowMs,
      sleep: async (ms: number) => {
        clock.nowMs += ms;
      },
    },
  };
}

async function runHost(
  seed: number,
  postCommit: (id: string) => Promise<any>,
  deps: Record<string, unknown>,
  oldestPendingPostCommit?: () => Promise<any>
) {
  const t = buildHost(formedHand(2, 9100 + seed), [100, 100], { deps: deps as any });
  (t.backend.postCommit as any).mockImplementation(async (id: string) => {
    t.calls.postCommit.push(id);
    return postCommit(id);
  });
  if (oldestPendingPostCommit) (t.backend as any).oldestPendingPostCommit = oldestPendingPostCommit;
  await t.host.start();
  await playOut(t.host, mulberry32(seed), foldAll);
  await flush(60);
  return t;
}

describe('the herd: many hands behind one slow predecessor', () => {
  it('thirty hosts queued behind one open hand file exactly one alert, naming it and its age', async () => {
    const stalls = new PostCommitStallEpisodes();
    const { clock, deps } = sharedClock(Date.parse('2026-11-18T05:10:00.000Z'));
    const queued = async (id: string) => ({
      ok: false,
      // The head's own callers meet the table mutex; everyone else the barrier.
      reason: id === HEAD ? 'table_busy' : 'predecessor_pending',
      oldest: { handId: HEAD, handNumber: 1001, committedAt: COMMITTED },
    });
    const hosts = [];
    for (let i = 0; i < 30; i++)
      hosts.push(
        await runHost(i, queued, { ...deps, postCommitBudgetMs: 2_000, postCommitStalls: stalls })
      );
    for (const t of hosts) expect(t.host.lifecycle).toBe('complete');
    expect(alerts.raised).toHaveLength(1);
    const [alert] = alerts.raised;
    expect(alert.source).toBe(SOURCE);
    expect(alert.details).toMatchObject({
      table_id: kit.HOST_TABLE,
      outcome: 'stalled',
      episode_key: `${kit.HOST_TABLE}:${HEAD}`,
      oldest_pending_hand_id: HEAD,
      oldest_pending_hand_number: 1001,
      oldest_pending_committed_at: COMMITTED,
    });
    expect(alert.details.oldest_pending_age_ms).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(alert.message).toContain(`stalled behind post-commit envelope ${HEAD}`);
    expect(clock.nowMs).toBeGreaterThan(0);
  });

  it('the episode is keyed on the oldest open hand read fresh, so legacy answers do not split it', async () => {
    const stalls = new PostCommitStallEpisodes();
    const { deps } = sharedClock(5_000_000);
    // An envelope older than 20261118073646: no oldest named, and a timeout thrown.
    const legacy = async () => {
      throw new Error('post-commit obligations RPC failed: canceling statement due to statement timeout');
    };
    const oldest = async () => ({ handId: HEAD, handNumber: 1001, committedAt: COMMITTED });
    for (let i = 0; i < 5; i++)
      await runHost(40 + i, legacy, { ...deps, postCommitBudgetMs: 1_000, postCommitStalls: stalls }, oldest);
    expect(alerts.raised).toHaveLength(1);
    expect(alerts.raised[0].details).toMatchObject({
      outcome: 'stalled',
      oldest_pending_hand_id: HEAD,
      last_reason: expect.stringContaining('statement timeout'),
    });
  });

  it('a slowly draining backlog is one episode however often its oldest hand advances', async () => {
    const stalls = new PostCommitStallEpisodes();
    const { clock, deps } = sharedClock(Date.parse('2026-11-18T05:10:00.000Z'));
    // Each host stalls behind the then-oldest hand; the backlog drains one
    // hand per host, so the oldest advances twelve times.
    let head = 1;
    for (let i = 0; i < 12; i++) {
      const oldest = { handId: uid(100 + head), handNumber: 1000 + head, committedAt: COMMITTED };
      await runHost(
        200 + i,
        async () => ({ ok: false, reason: 'predecessor_pending', oldest }),
        { ...deps, postCommitBudgetMs: 1_000, postCommitStalls: stalls }
      );
      head++;
    }
    expect(alerts.raised).toHaveLength(1);
    const episode = stalls.episode(kit.HOST_TABLE)!;
    expect(episode).toMatchObject({
      firstOldestHandId: uid(101),
      currentOldestHandId: uid(112),
      stalledHands: 12,
    });
    expect(alerts.raised[0].details).toMatchObject({
      first_seen_oldest_hand_id: uid(101),
      stalled_hands: 1,
    });
    // A hand that applies without ever being queued ends it: the next stall pages again.
    await runHost(300, async () => ({ ok: true }), { ...deps, postCommitStalls: stalls });
    expect(stalls.episode(kit.HOST_TABLE)).toBeNull();
    await runHost(
      301,
      async () => ({ ok: false, reason: 'table_busy', oldest: { handId: uid(150), handNumber: 1050, committedAt: COMMITTED } }),
      { ...deps, postCommitBudgetMs: 1_000, postCommitStalls: stalls }
    );
    expect(alerts.raised).toHaveLength(2);
    expect(clock.nowMs).toBeGreaterThan(0);
  });

  it('a hand that applied after queueing does not end the episode; quiet time does', () => {
    const stalls = new PostCommitStallEpisodes();
    expect(stalls.stalled('T', 'h1', 10, 0).opened).toBe(true);
    expect(stalls.stalled('T', 'h2', 50, 1).opened).toBe(false);
    stalls.applied('T', true);
    expect(stalls.stalled('T', 'h3', 20, 2)).toMatchObject({
      opened: false,
      episode: { firstOldestHandId: 'h1', currentOldestHandId: 'h3', stalledHands: 3, maxOldestAgeMs: 50 },
    });
    expect(stalls.stalled('U', 'h1', null, 3).opened).toBe(true);
    expect(stalls.stalled('T', 'h4', null, 3 + POST_COMMIT_STALL_EPISODE_QUIET_MS).opened).toBe(true);
    stalls.applied('T', false);
    expect(stalls.episode('T')).toBeNull();
  });
});

describe('a queued hand is retried; a refused hand is alerted at once', () => {
  it('queued answers that clear inside the budget file nothing', async () => {
    const stalls = new PostCommitStallEpisodes();
    const script = ['table_busy', 'predecessor_pending', 'obligation_lock_busy', 'ok'];
    const t = await runHost(
      60,
      async () => {
        const next = script.shift()!;
        return next === 'ok' ? { ok: true } : { ok: false, reason: next };
      },
      { postCommitStalls: stalls }
    );
    expect(t.calls.postCommit).toHaveLength(4);
    expect(alerts.raised).toEqual([]);
  });

  it('a definite refusal alerts on its first answer, for this hand', async () => {
    const stalls = new PostCommitStallEpisodes();
    const t = await runHost(61, async () => ({ ok: false, reason: 'not_found' }), {
      postCommitStalls: stalls,
    });
    expect(t.calls.postCommit).toHaveLength(1);
    expect(alerts.raised).toHaveLength(1);
    expect(alerts.raised[0].details).toMatchObject({
      outcome: 'refused',
      last_reason: 'not_found',
      hand_id: uid(7777),
      attempts: 1,
    });
    expect(stalls.size).toBe(0);
  });

  it('a burst of overload errors across many hands is one stall, not a page per hand', async () => {
    const stalls = new PostCommitStallEpisodes();
    const { deps } = sharedClock(9_000_000);
    const errors = ['deadlock detected (40P01)', 'sorry, too many clients already', 'Connection terminated unexpectedly', 'upstream returned 522'];
    for (let i = 0; i < 8; i++)
      await runHost(
        400 + i,
        async () => {
          throw new Error(`post-commit obligations RPC failed: ${errors[i % errors.length]}`);
        },
        { ...deps, postCommitBudgetMs: 1_000, postCommitStalls: stalls }
      );
    expect(alerts.raised).toHaveLength(1);
    expect(alerts.raised[0].details.outcome).toBe('stalled');
  });

  it('the envelope refusing its own payload alerts at once', async () => {
    const t = await runHost(
      62,
      async () => {
        throw new Error('post-commit obligations RPC failed: post-commit obligation payload hash mismatch');
      },
      { postCommitStalls: new PostCommitStallEpisodes() }
    );
    expect(t.calls.postCommit).toHaveLength(1);
    expect(alerts.raised).toHaveLength(1);
    expect(alerts.raised[0].details.outcome).toBe('refused');
  });
});

describe('classification', () => {
  it('only a closed list of answers is definite; every other answer is queued', () => {
    expect(classifyPostCommitAnswer({ ok: true })).toBe('applied');
    for (const reason of ['predecessor_pending', 'table_busy', 'obligation_lock_busy', 'refused', 'something_new', undefined])
      expect(classifyPostCommitAnswer({ ok: false, reason })).toBe('queued');
    for (const reason of ['not_found', 'legacy_no_obligations'])
      expect(classifyPostCommitAnswer({ ok: false, reason })).toBe('failed');
  });
  it('overload and transport errors are queued; only the envelope refusing its payload is definite', () => {
    for (const m of [
      'canceling statement due to statement timeout',
      'deadlock detected (40P01)',
      'could not serialize access due to concurrent update (40001)',
      'sorry, too many clients already (53300)',
      'remaining connection slots are reserved for non-replication superuser connections',
      'Connection terminated unexpectedly',
      'upstream returned 522',
      'post-commit predecessor scan failed: timeout',
      'TypeError: fetch failed',
      'F06_RETRY_CANONICAL_LANE',
      'a message nobody has seen before',
      // #11266: the insurance bank try-lock is busy (55P03): a retry, never a refusal.
      'insurance bank 00000000-0000-0000-0000-000000000001 is busy deciding another payout or debit (hand h)',
      'insurance payout exceeds the union insurance bank for hand h (union_wallets_insurance_wallet_nonneg)',
    ])
      expect(classifyPostCommitError(m)).toBe('queued');
    for (const m of [
      'post-commit obligation payload hash mismatch for hand x',
      'invalid rake obligation for hand x',
      'invalid time-bank audit payload for hand x',
      'diamond_hand_has_chip_obligations',
      'pending add-on "a" does not belong to table t (hand h)',
      'BBJ contribution requires a stable hand identity and positive whole-cent amount',
      'promo obligation refused for hand x: {}',
      'Invalid insurance payment identity or amounts',
      'Insurance identity reused with a different payment payload',
    ])
      expect(classifyPostCommitError(m)).toBe('failed');
  });
  it('ages the oldest hand from its commit time', () => {
    expect(oldestPendingAgeMs({ handId: 'h', handNumber: 1, committedAt: COMMITTED }, Date.parse(COMMITTED) + 6_410_000)).toBe(6_410_000);
    expect(oldestPendingAgeMs({ handId: 'h', handNumber: 1, committedAt: null }, 0)).toBeNull();
    expect(oldestPendingAgeMs(null, 0)).toBeNull();
  });
});
