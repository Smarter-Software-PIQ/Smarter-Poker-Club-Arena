import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  admitPayload,
  requireBatch,
  receiptMatches,
  requireHealth,
  summarizeHands,
} from '../scripts/ci/verify-plo-lightning-lifecycle.mjs';
const sha = 'a'.repeat(40);
describe('finite PLO lifecycle production witness', () => {
  it('requires one exact pinned engine and refuses scope overrides', () => {
    expect(admitPayload({ engine_sha: sha })).toBe(sha);
    for (const p of [null, {}, { engine_sha: 'main' }, { engine_sha: sha, game: 'other' }])
      expect(() => admitPayload(p)).toThrow();
  });
  it('refuses a partial cashier failure inside successful HTTP and batch envelopes', () => {
    const body = { success: true, processed: 1, results: [{ user_id: 'p', success: false }] };
    expect(() => requireBatch({ status: 200, body }, 'p', 400)).toThrow();
    body.results[0].success = true;
    expect(() => requireBatch({ status: 200, body }, 'p', 400)).not.toThrow();
    expect(() => requireBatch({ status: 200, body }, 'someone-else', 400)).toThrow();
    expect(() => requireBatch({ status: 200, body }, 'p', 401)).toThrow();
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
