/**
 * HVH2D-EXE-002 coverage (2026-11-12, the verifier's follow-up to #10640).
 *
 * A Lightning hand's row is built by LightningHandHost.handRow and settled by
 * fn_lightning_settle_hand, which commits it through the same door as a
 * physical hand (fn_ca_commit_hand_settlement), so the exact-memory trigger
 * fires on it and skips it when public_memory_domain is not valid. It never
 * passes through logHandHistory, so #10640's count never saw it. The
 * production backend's settle is the storage boundary; it counts the accepted
 * hand once, under mode lightning.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lane: vi.fn(), rpc: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { rpc: mocks.rpc },
  DB_TIMEOUT_MS: 15_000,
}));
vi.mock('../services/lightningLaneSession.js', async () => {
  const real = await vi.importActual<typeof import('../services/lightningLaneSession.js')>(
    '../services/lightningLaneSession.js'
  );
  return { ...real, lightningLaneCall: mocks.lane };
});
const { createSupabaseLightningHandBackend } = await import('./LightningHandBackend.js');
const {
  HAND_MEMORY_DOMAIN_LEARNER_SCOPES,
  HAND_MEMORY_DOMAIN_MISSING_REASONS,
  HAND_MEMORY_DOMAIN_SHOWDOWN,
  handMemoryDomainLoggedTotal,
  handMemoryDomainMissingTotal,
} = await import('../observability/engineInstruments.js');

const hand = '027ab7d1-b13c-4a9d-a7c3-4616f3d39e29';
const showdown = [{ user_id: 'u1', seat: 1, reveal_order: 1, mucked: false, hand_name: 'Pair' }];
const validDomain = { version: 1, speed: 'lightning', ante: 'none' };
const settleArgs = (handRow: Record<string, unknown>) => ({
  handId: hand,
  requestId: 'b13cc1cf-8efc-4147-a262-cb2c640bf701',
  hostTableId: '121f80d2-5290-42e5-a32b-4d3a702e2772',
  leaseInstance: 'engine-1',
  leaseGeneration: '6f2c3a3e-8c55-4a6e-9a0d-1f1e2d3c4b5a',
  results: [],
  rake: 0,
  bbj: 0,
  handRow: { tournament_id: null, game_variant: 'nlh', showdown, ...handRow },
});
const total = (counter: typeof handMemoryDomainLoggedTotal) =>
  counter.snapshot().reduce((sum, s) => sum + s.value, 0);
const accepted = { data: { ok: true, hand_history_id: hand }, error: null };

beforeEach(() => {
  mocks.lane.mockReset();
  mocks.rpc.mockReset();
  mocks.lane.mockResolvedValue(null);
});

describe('a Lightning hand settled without its public memory domain is counted', () => {
  it('lightning is a seeded mode: every series exists at zero before the first hand', () => {
    for (const reached_showdown of HAND_MEMORY_DOMAIN_SHOWDOWN) {
      for (const learner_scope of HAND_MEMORY_DOMAIN_LEARNER_SCOPES)
        expect(
          handMemoryDomainLoggedTotal
            .snapshot()
            .some(
              (s) =>
                s.labels.mode === 'lightning' &&
                s.labels.reached_showdown === reached_showdown &&
                s.labels.learner_scope === learner_scope
            )
        ).toBe(true);
      for (const reason of HAND_MEMORY_DOMAIN_MISSING_REASONS)
        expect(
          handMemoryDomainMissingTotal
            .snapshot()
            .some(
              (s) =>
                s.labels.mode === 'lightning' &&
                s.labels.reached_showdown === reached_showdown &&
                s.labels.reason === reason
            )
        ).toBe(true);
    }
  });

  it('an accepted hand with a valid domain is logged under lightning with no omission', async () => {
    const labels = { mode: 'lightning', reached_showdown: 'true', learner_scope: 'supported' };
    const logged = handMemoryDomainLoggedTotal.get(labels);
    const loggedAll = total(handMemoryDomainLoggedTotal);
    const missingAll = total(handMemoryDomainMissingTotal);
    mocks.rpc.mockResolvedValue(accepted);
    const out = await createSupabaseLightningHandBackend().settle(
      settleArgs({ public_memory_domain: validDomain }) as never
    );
    expect(out.ok).toBe(true);
    expect(handMemoryDomainLoggedTotal.get(labels) - logged).toBe(1);
    expect(total(handMemoryDomainLoggedTotal) - loggedAll).toBe(1);
    expect(total(handMemoryDomainMissingTotal)).toBe(missingAll);
  });

  it.each([
    ['a null domain', 'absent', null],
    [
      'a domain the validity check refuses',
      'invalid',
      { version: 1, speed: 'turbo', ante: 'none' },
    ],
  ] as const)(
    '%s is counted as %s, and the row sent is unchanged',
    async (_name, reason, domain) => {
      const labels = { mode: 'lightning', reached_showdown: 'true' };
      const logged = handMemoryDomainLoggedTotal.get({ ...labels, learner_scope: 'supported' });
      const missing = handMemoryDomainMissingTotal.get({ ...labels, reason });
      const missingAll = total(handMemoryDomainMissingTotal);
      mocks.rpc.mockResolvedValue(accepted);
      const args = settleArgs({ public_memory_domain: domain });
      await createSupabaseLightningHandBackend().settle(args as never);
      expect(mocks.rpc.mock.calls[0][1].p_hand_row).toEqual(args.handRow);
      expect(
        handMemoryDomainLoggedTotal.get({ ...labels, learner_scope: 'supported' }) - logged
      ).toBe(1);
      expect(handMemoryDomainMissingTotal.get({ ...labels, reason }) - missing).toBe(1);
      expect(total(handMemoryDomainMissingTotal) - missingAll).toBe(1);
    }
  );

  it('a variant the trigger never learns is exempt, as on a physical table', async () => {
    const labels = { mode: 'lightning', reached_showdown: 'false' };
    const logged = handMemoryDomainLoggedTotal.get({
      ...labels,
      learner_scope: 'unsupported_variant',
    });
    const exempt = handMemoryDomainMissingTotal.get({ ...labels, reason: 'unsupported_variant' });
    mocks.rpc.mockResolvedValue(accepted);
    await createSupabaseLightningHandBackend().settle(
      settleArgs({ public_memory_domain: null, game_variant: 'ofc', showdown: null }) as never
    );
    expect(
      handMemoryDomainLoggedTotal.get({ ...labels, learner_scope: 'unsupported_variant' }) - logged
    ).toBe(1);
    expect(
      handMemoryDomainMissingTotal.get({ ...labels, reason: 'unsupported_variant' }) - exempt
    ).toBe(1);
  });

  it.each([
    ['a refusal', { data: { ok: false, reason: 'host_lease_lost' }, error: null }],
    ['a transport error', { data: null, error: { message: 'upstream connect error' } }],
    ['an answer without a hand id', { data: { ok: true }, error: null }],
  ] as const)('%s is not an accepted hand and counts nothing', async (_name, reply) => {
    const loggedAll = total(handMemoryDomainLoggedTotal);
    const missingAll = total(handMemoryDomainMissingTotal);
    mocks.rpc.mockResolvedValue(reply);
    const out = await createSupabaseLightningHandBackend().settle(
      settleArgs({ public_memory_domain: null }) as never
    );
    expect(out.ok).toBe(false);
    expect(total(handMemoryDomainLoggedTotal)).toBe(loggedAll);
    expect(total(handMemoryDomainMissingTotal)).toBe(missingAll);
  });

  it('the attempt whose answer was lost and the retry that is accepted count one hand', async () => {
    const loggedAll = total(handMemoryDomainLoggedTotal);
    const missingAll = total(handMemoryDomainMissingTotal);
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'upstream connect error' } })
      .mockResolvedValueOnce(accepted);
    const backend = createSupabaseLightningHandBackend();
    const args = settleArgs({ public_memory_domain: null });
    expect((await backend.settle(args as never)).ok).toBe(false);
    expect((await backend.settle(args as never)).ok).toBe(true);
    expect(total(handMemoryDomainLoggedTotal) - loggedAll).toBe(1);
    expect(total(handMemoryDomainMissingTotal) - missingAll).toBe(1);
  });
});
