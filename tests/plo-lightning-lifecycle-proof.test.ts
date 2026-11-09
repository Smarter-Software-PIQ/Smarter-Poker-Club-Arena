import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  admitPayload,
  requireCleanupSource,
  requestGuardedCleanup,
  requireBatch,
  receiptMatches,
  requireHealth,
  summarizeHands,
  requireFundingClub,
  requireFeederAdmission,
  HOUSE,
} from '../scripts/ci/verify-plo-lightning-lifecycle.mjs';
const sha = 'a'.repeat(40);
describe('finite PLO lifecycle production witness', () => {
  it('requires one exact pinned engine and refuses scope overrides', () => {
    expect(admitPayload({ engine_sha: sha })).toBe(sha);
    for (const p of [null, {}, { engine_sha: 'main' }, { engine_sha: sha, game: 'other' }])
      expect(() => admitPayload(p)).toThrow();
  });
  it('recovers only the original protected proof actors with reconciled funding, never an unknown purchase', () => {
    const runId = '42701523531';
    const run = {
      id: Number(runId),
      event: 'repository_dispatch',
      head_branch: 'main',
      path: '.github/workflows/post-deploy-e2e.yml',
      status: 'completed',
      head_sha: sha,
    };
    const original = {
      gameId: 'c79d8ec2-2281-411d-b4e1-42b5610849e2',
      engineSha: sha,
      cleanup: { completed: false },
      funding: { confirmed: true, opId: 'one' },
      ownedFundingLegs: [{ idempotency_key: 'club_bank_send:one', amount: 400 }],
      accounts: {
        player: '11111111-1111-4111-8111-111111111111',
        cashier: '22222222-2222-4222-8222-222222222222',
      },
    };
    expect(admitPayload({ engine_sha: sha, cleanup_run_id: runId })).toBe(sha);
    expect(() => admitPayload({ engine_sha: sha, cleanup_run_id: 'main' })).toThrow();
    expect(requireCleanupSource(run, original, sha, runId)).toEqual(
      Object.values(original.accounts)
    );
    for (const bad of [
      { ...run, id: 1 },
      { ...run, event: 'pull_request' },
      { ...run, head_branch: 'other' },
      { ...run, status: 'in_progress' },
      { ...run, path: 'other.yml' },
    ])
      expect(() => requireCleanupSource(bad, original, sha, runId)).toThrow();
    for (const bad of [
      { ...original, gameId: 'other' },
      { ...original, cleanup: { completed: false, retainedUnknownFinancialIntent: true } },
      { ...original, funding: { confirmed: false } },
      {
        ...original,
        accounts: { player: original.accounts.player, cashier: original.accounts.player },
      },
    ])
      expect(() => requireCleanupSource(run, bad, sha, runId)).toThrow();
  });
  it('sends guarded recovery through maintained server headers for both server key generations', async () => {
    for (const key of ['sb_secret_current', 'legacy.fixture.jwt']) {
      const requests: any[] = [];
      const response = await requestGuardedCleanup(
        { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: key },
        'owned-actor',
        async (url: string, options: any) => {
          requests.push({ url, options });
          return {
            status: 200,
            json: async () => ({ success: true, disposition: 'retained_ledger_actor' }),
          };
        }
      );
      expect(response.body.success).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(
        'https://fixture.invalid/rest/v1/rpc/cleanup_reserved_certification_account'
      );
      expect(requests[0].options.method).toBe('POST');
      expect(requests[0].options.headers).toMatchObject({
        apikey: key,
        'x-smarter-data-actor': 'service',
        'x-smarter-data-protocol': '1',
      });
      expect(requests[0].options.headers.Authorization).toBe(
        key.startsWith('sb_secret_') ? undefined : `Bearer ${key}`
      );
      expect(JSON.parse(requests[0].options.body)).toEqual({ p_user_id: 'owned-actor' });
    }
  });
  it('refuses a partial cashier failure inside successful HTTP and batch envelopes', () => {
    const body = { success: true, processed: 1, results: [{ user_id: 'p', success: false }] };
    expect(() => requireBatch({ status: 200, body }, 'p', 400)).toThrow();
    body.results[0].success = true;
    expect(() => requireBatch({ status: 200, body }, 'p', 400)).not.toThrow();
    expect(() => requireBatch({ status: 200, body }, 'someone-else', 400)).toThrow();
    expect(() => requireBatch({ status: 200, body }, 'p', 401)).toThrow();
  });
  it('funds the designated member-club wallet rather than the union bank wallet', () => {
    const club = { id: 'member', union_id: HOUSE, asset: 'chips', status: 'active' };
    const link = { club_id: 'member', union_id: HOUSE };
    expect(requireFundingClub(club, link)).toBe('member');
    expect(() => requireFundingClub({ ...club, id: HOUSE }, { ...link, club_id: HOUSE })).toThrow();
    expect(() => requireFundingClub(club, null)).toThrow();
    expect(() => requireFundingClub(club, { ...link, union_id: 'another-union' })).toThrow();
    expect(() => requireFundingClub({ ...club, status: 'closed' }, link)).toThrow();
  });
  it('retains the actual admission refusal instead of waiting for a purchase sheet', () => {
    expect(() =>
      requireFeederAdmission({
        status: 400,
        body: { code: '23514', message: 'INSUFFICIENT_CHIPS:100.00' },
      })
    ).toThrow('INSUFFICIENT_CHIPS:100.00');
    expect(() =>
      requireFeederAdmission({ status: 200, body: { ok: true, action: 'waitlisted' } })
    ).toThrow();
    expect(() =>
      requireFeederAdmission({
        status: 200,
        body: { ok: true, action: 'seat', table_id: 'a'.repeat(36) },
      })
    ).not.toThrow();
  });
  it('requires exact owned confirmed buy-in intent including auto-rebuy and club', () => {
    const p = {
      p_user_id: 'p',
      p_table_id: 't',
      p_seat_number: 2,
      p_amount: 400,
      p_auto_rebuy: false,
      p_club_id: null,
    };
    const request = {
      door: 'atomic_table_buyin',
      user_id: 'p',
      table_id: 't',
      seat_number: 2,
      amount: 400,
      auto_rebuy: false,
      club_id: null,
    };
    expect(receiptMatches({ status: 'confirmed', request }, p)).toBe(true);
    for (const r of [
      { ...request, auto_rebuy: true },
      { ...request, amount: 800 },
      { ...request, user_id: 'other' },
    ])
      expect(receiptMatches({ status: 'confirmed', request: r }, p)).toBe(false);
    expect(receiptMatches({ status: 'pending', request }, p)).toBe(false);
  });
  it('refuses changed instances, missing identity and unfinished or malformed thaw', () => {
    const h = {
      releaseSha: sha,
      instanceId: 'one',
      running: true,
      liveness: 'ok',
      maintenance: { phase: 'idle', active: false, resumeWaves: { done: 8, total: 8 } },
    };
    expect(() => requireHealth(h, sha, 'one')).not.toThrow();
    expect(() => requireHealth(h, sha, 'two')).toThrow();
    expect(() => requireHealth({ ...h, instanceId: undefined }, sha)).toThrow();
    for (const resumeWaves of [
      { done: 3, total: 8 },
      { done: -1, total: -1 },
    ])
      expect(() =>
        requireHealth({ ...h, maintenance: { ...h.maintenance, resumeWaves } }, sha)
      ).toThrow();
  });
  it('retains gameplay evidence without opponent cards', () => {
    const result = summarizeHands(
      [
        {
          id: 'h',
          players: [
            { userId: 'p', cards: ['As', 'Ah'] },
            { userId: 'q', cards: ['Ks', 'Kh'] },
          ],
        },
      ],
      'p'
    );
    expect(result[0]).toMatchObject({ playerCount: 2, includesTestPlayer: true });
    expect(JSON.stringify(result)).not.toContain('cards');
    expect(JSON.stringify(result)).not.toContain('As');
  });
  it('runs only explicit fixed-target dispatch after installed cleanup safety and never uploads private account files', () => {
    const w = parse(readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8'));
    const j = w.jobs['plo-lightning-lifecycle-proof'];
    expect(w.on.repository_dispatch.types).toContain('run-plo-lightning-lifecycle-proof');
    expect(j.needs).toBe('certification-cleanup-safety');
    expect(j.if).toContain("github.event.action == 'run-plo-lightning-lifecycle-proof'");
    expect(j.concurrency['cancel-in-progress']).toBe(false);
    const artifact = j.steps.find((s) => s.uses === 'actions/upload-artifact@v4');
    expect(artifact.with.path).toContain('result.json');
    expect(artifact.with.path).not.toContain('private');
    expect(artifact.with.path).not.toContain('**');
  });
});
