/**
 * LAW: A STUCK SPAWN CLAIM REPAIRS ITSELF (owner 2026-11-05).
 *
 * A claim left with no tournament by a spawn that died between claim and
 * insert used to burn its occurrence forever (Saturday 2026-11-07's Midway
 * Morning Free Buy). The spawner's poll now links such a claim to the
 * tournament it did create, or releases it so the occurrence spawns.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ORPHAN_SPAWN_GRACE_MS,
  orphanClaimDecision,
  orphanMatchWindow,
  sweepOrphanSpawnClaims,
} from './orphanSpawnClaims.js';

type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown };

function fakeDb(claims: unknown[], matches: Record<string, { id: string }[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    const add = (name: string) => (col: string, val?: unknown) => {
      call.filters.push([name, col, val]);
      return chain;
    };
    for (const f of ['eq', 'is', 'lt', 'gte', 'lte']) chain[f] = add(f);
    chain.select = () => chain;
    chain.order = () => chain;
    chain.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return chain;
    };
    chain.delete = () => {
      call.op = 'delete';
      return chain;
    };
    const answer = () => {
      if (call.op !== 'select') return { error: null };
      if (table === 'tournament_schedule_spawns') return { data: claims, error: null };
      const sid = call.filters.find((f) => f[1] === 'schedule_id')?.[2] as string;
      return { data: matches[sid] ?? [], error: null };
    };
    chain.limit = () => Promise.resolve(answer());
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer()).then(res, rej);
    return chain;
  };
  return { db: { from } as never, calls };
}

describe('a stuck spawn claim repairs itself', () => {
  it('links one match, releases none, leaves several alone', () => {
    expect(orphanClaimDecision(['t1'])).toEqual({ kind: 'link', tournamentId: 't1' });
    expect(orphanClaimDecision([])).toEqual({ kind: 'release' });
    expect(orphanClaimDecision(['a', 'b'])).toEqual({ kind: 'ambiguous', count: 2 });
    expect(orphanMatchWindow('nope')).toBeNull();
    expect(orphanMatchWindow('2026-11-04T16:13:26Z')).toEqual({
      from: '2026-11-04T16:12:26.000Z',
      to: '2026-11-04T16:23:26.000Z',
    });
  });

  it('reads only claims older than the grace, and every write still needs tournament_id NULL', async () => {
    const now = new Date('2026-11-05T17:00:00Z');
    const { db, calls } = fakeDb(
      [
        { spawn_key: 's1:2026-11-07:08:30', schedule_id: 's1', created_at: '2026-11-04T16:13:26Z' },
        { spawn_key: 's2:2026-11-06:12:00', schedule_id: 's2', created_at: '2026-11-04T05:47:22Z' },
        { spawn_key: 's3:2026-11-06:12:00', schedule_id: 's3', created_at: '2026-11-04T05:47:22Z' },
      ],
      { s2: [{ id: 'tour-2' }], s3: [{ id: 'x' }, { id: 'y' }] }
    );
    const reports: string[] = [];
    const out = await sweepOrphanSpawnClaims(
      db,
      now,
      (_e, src) => reports.push(src),
      () => {}
    );
    expect(out).toEqual({ linked: 1, released: 1, ambiguous: 1, failed: 0 });
    const read = calls[0];
    expect(read.filters).toContainEqual(['is', 'tournament_id', null]);
    expect(read.filters).toContainEqual([
      'lt',
      'created_at',
      new Date(now.getTime() - ORPHAN_SPAWN_GRACE_MS).toISOString(),
    ]);
    const writes = calls.filter((c) => c.op !== 'select');
    expect(writes.map((w) => w.op).sort()).toEqual(['delete', 'update']);
    for (const w of writes) expect(w.filters).toContainEqual(['is', 'tournament_id', null]);
    expect(writes.find((w) => w.op === 'update')?.payload).toEqual({ tournament_id: 'tour-2' });
    expect(writes.find((w) => w.op === 'delete')?.filters).toContainEqual([
      'eq',
      'spawn_key',
      's1:2026-11-07:08:30',
    ]);
    expect(reports).toEqual(['ScheduledTournaments.orphan_claim_ambiguous']);
  });

  it('the spawner poll runs the sweep on its own cadence', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./ScheduledTournamentService.ts', import.meta.url)),
      'utf8'
    );
    const poll = src.slice(
      src.indexOf('private async poll('),
      src.indexOf('private async syncFixedBoard(')
    );
    expect(poll).toMatch(
      /Date\.now\(\) - this\.orphanClaimsSweptAt >= ORPHAN_SPAWN_SWEEP_MS[\s\S]{0,200}sweepOrphanSpawnClaims\(supabase, new Date\(\), reportError\)/
    );
  });
});
