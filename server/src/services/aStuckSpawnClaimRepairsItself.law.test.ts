/**
 * LAW: A STUCK SPAWN CLAIM REPAIRS ITSELF, AND AGE ALONE NEVER CLEARS ONE
 * (owner 2026-11-05).
 *
 * A claim left with no tournament by a spawn that died between claim and
 * insert used to burn its occurrence forever (Saturday 2026-11-07's Midway
 * Morning Free Buy). The spawner's poll now links such a claim to the
 * tournament it did create, or releases it so the occurrence spawns - but only
 * after a second sighting proves no creation operation still owns it, and
 * never for a disabled schedule.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ORPHAN_SPAWN_GRACE_MS,
  ORPHAN_SPAWN_SWEEP_MS,
  orphanClaimDecision,
  orphanMatchWindow,
  sweepOrphanSpawnClaims,
} from './orphanSpawnClaims.js';

type Filter = [string, string, unknown];
type Call = { table: string; op: string; filters: Filter[]; payload?: unknown };
type World = {
  claims: {
    spawn_key: string;
    schedule_id: string;
    created_at: string;
    tournament_id: string | null;
  }[];
  tournaments: { id: string; schedule_id: string; created_at: string }[];
  schedules: { id: string; active: boolean }[];
  scheduleReadFails?: boolean;
};

/** A minimal PostgREST stand-in that actually applies the writes it is sent. */
function fakeDb(world: World) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    const add = (name: string) => (col: string, val?: unknown) => {
      call.filters.push([name, col, val]);
      return chain;
    };
    for (const f of ['eq', 'is', 'lt', 'gte', 'lte', 'in']) chain[f] = add(f);
    chain.select = () => chain;
    chain.order = () => chain;
    chain.update = (payload: unknown) => ((call.op = 'update'), (call.payload = payload), chain);
    chain.delete = () => ((call.op = 'delete'), chain);
    const val = (col: string) => call.filters.find((f) => f[1] === col)?.[2];
    const answer = () => {
      if (table === 'tournament_schedule_spawns') {
        const key = val('spawn_key') as string | undefined;
        if (call.op === 'select') {
          const cutoff = val('created_at') as string;
          return {
            data: world.claims.filter((c) => c.tournament_id === null && c.created_at < cutoff),
            error: null,
          };
        }
        const target = world.claims.find((c) => c.spawn_key === key && c.tournament_id === null);
        if (target && call.op === 'delete') world.claims.splice(world.claims.indexOf(target), 1);
        if (target && call.op === 'update') {
          target.tournament_id = (call.payload as { tournament_id: string }).tournament_id;
        }
        return { error: null };
      }
      if (table === 'tournament_schedules') {
        if (world.scheduleReadFails) return { data: null, error: { message: 'down' } };
        const ids = val('id') as string[];
        return { data: world.schedules.filter((s) => ids.includes(s.id)), error: null };
      }
      const sid = val('schedule_id');
      const from = call.filters.find((f) => f[0] === 'gte')?.[2] as string;
      const to = call.filters.find((f) => f[0] === 'lte')?.[2] as string;
      return {
        data: world.tournaments.filter(
          (t) =>
            t.schedule_id === sid &&
            Date.parse(t.created_at) >= Date.parse(from) &&
            Date.parse(t.created_at) <= Date.parse(to)
        ),
        error: null,
      };
    };
    chain.limit = () => Promise.resolve(answer());
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer()).then(res, rej);
    return chain;
  };
  return { db: { from } as never, calls };
}

const T0 = Date.parse('2026-11-05T17:00:00Z');
const claimAt = new Date(T0 - 2 * ORPHAN_SPAWN_GRACE_MS).toISOString();
const quiet = () => {};

async function twoSweeps(world: World) {
  const { db, calls } = fakeDb(world);
  const seen = new Map<string, number>();
  const reports: string[] = [];
  const report = (_e: Error, src: string) => reports.push(src);
  const first = await sweepOrphanSpawnClaims(db, new Date(T0), report, seen, quiet);
  const second = await sweepOrphanSpawnClaims(
    db,
    new Date(T0 + ORPHAN_SPAWN_SWEEP_MS),
    report,
    seen,
    quiet
  );
  return { first, second, calls, reports, seen };
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

  it('a spawn that died after its claim and before its insert is released, on the second sighting only', async () => {
    const world: World = {
      claims: [
        {
          spawn_key: 's1:2026-11-07:08:30',
          schedule_id: 's1',
          created_at: claimAt,
          tournament_id: null,
        },
      ],
      tournaments: [],
      schedules: [{ id: 's1', active: true }],
    };
    const { first, second, calls } = await twoSweeps(world);
    expect(first).toMatchObject({ waiting: 1, released: 0 });
    expect(second).toMatchObject({ released: 1, waiting: 0 });
    expect(world.claims).toEqual([]);
    const del = calls.find((c) => c.op === 'delete');
    expect(del?.filters).toContainEqual(['is', 'tournament_id', null]);
    // The read only ever selects claims with no tournament older than the grace,
    // so a claim linked to a cancelled event is never a candidate.
    const read = calls.find((c) => c.table === 'tournament_schedule_spawns' && c.op === 'select');
    expect(read?.filters).toContainEqual(['is', 'tournament_id', null]);
    expect(read?.filters).toContainEqual([
      'lt',
      'created_at',
      new Date(T0 - ORPHAN_SPAWN_GRACE_MS).toISOString(),
    ]);
  });

  it('a spawn whose insert landed but whose back-link was lost is linked, never released, so nothing doubles', async () => {
    const world: World = {
      claims: [
        {
          spawn_key: 's2:2026-11-06:12:00',
          schedule_id: 's2',
          created_at: claimAt,
          tournament_id: null,
        },
      ],
      tournaments: [
        {
          id: 'tour-2',
          schedule_id: 's2',
          created_at: new Date(Date.parse(claimAt) + 2000).toISOString(),
        },
      ],
      schedules: [{ id: 's2', active: false }],
    };
    const { second, calls } = await twoSweeps(world);
    expect(second).toMatchObject({ linked: 1, released: 0 });
    expect(world.claims[0].tournament_id).toBe('tour-2');
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('a claim a spawn finishes between sightings is left alone and forgotten', async () => {
    const world: World = {
      claims: [
        {
          spawn_key: 's3:2026-11-06:12:00',
          schedule_id: 's3',
          created_at: claimAt,
          tournament_id: null,
        },
      ],
      tournaments: [],
      schedules: [{ id: 's3', active: true }],
    };
    const { db, calls } = fakeDb(world);
    const seen = new Map<string, number>();
    await sweepOrphanSpawnClaims(db, new Date(T0), quiet, seen, quiet);
    world.claims[0].tournament_id = 'late-but-fine';
    const out = await sweepOrphanSpawnClaims(
      db,
      new Date(T0 + ORPHAN_SPAWN_SWEEP_MS),
      quiet,
      seen,
      quiet
    );
    expect(out).toMatchObject({ released: 0, linked: 0, waiting: 0 });
    expect(seen.size).toBe(0);
    expect(calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('a second sighting sooner than a sweep interval still waits', async () => {
    const world: World = {
      claims: [{ spawn_key: 's4:x', schedule_id: 's4', created_at: claimAt, tournament_id: null }],
      tournaments: [],
      schedules: [{ id: 's4', active: true }],
    };
    const { db } = fakeDb(world);
    const seen = new Map<string, number>();
    await sweepOrphanSpawnClaims(db, new Date(T0), quiet, seen, quiet);
    const out = await sweepOrphanSpawnClaims(
      db,
      new Date(T0 + ORPHAN_SPAWN_SWEEP_MS - 1),
      quiet,
      seen,
      quiet
    );
    expect(out).toMatchObject({ waiting: 1, released: 0 });
    expect(world.claims).toHaveLength(1);
  });

  it('a disabled, deleted or unreadable schedule never has its claim released', async () => {
    for (const world of [
      { schedules: [{ id: 's5', active: false }] },
      { schedules: [] },
      { schedules: [{ id: 's5', active: true }], scheduleReadFails: true },
    ] as Partial<World>[]) {
      const w: World = {
        claims: [
          { spawn_key: 's5:x', schedule_id: 's5', created_at: claimAt, tournament_id: null },
        ],
        tournaments: [],
        schedules: [],
        ...world,
      };
      const { second } = await twoSweeps(w);
      expect(second).toMatchObject({ released: 0, inactive: 1 });
      expect(w.claims).toHaveLength(1);
    }
  });

  it('several matching tournaments are left for review and reported', async () => {
    const at = (ms: number) => new Date(Date.parse(claimAt) + ms).toISOString();
    const world: World = {
      claims: [{ spawn_key: 's6:x', schedule_id: 's6', created_at: claimAt, tournament_id: null }],
      tournaments: [
        { id: 'x', schedule_id: 's6', created_at: at(1000) },
        { id: 'y', schedule_id: 's6', created_at: at(2000) },
      ],
      schedules: [{ id: 's6', active: true }],
    };
    const { second, reports } = await twoSweeps(world);
    expect(second).toMatchObject({ ambiguous: 1, released: 0, linked: 0 });
    expect(reports).toEqual(['ScheduledTournaments.orphan_claim_ambiguous']);
    expect(world.claims[0].tournament_id).toBeNull();
  });

  it('the spawner poll runs the sweep on its own cadence with its own memory', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./ScheduledTournamentService.ts', import.meta.url)),
      'utf8'
    );
    const poll = src.slice(
      src.indexOf('private async poll('),
      src.indexOf('private async syncFixedBoard(')
    );
    expect(poll).toMatch(
      /Date\.now\(\) - this\.orphanClaimsSweptAt >= ORPHAN_SPAWN_SWEEP_MS[\s\S]{0,260}sweepOrphanSpawnClaims\(\s*supabase,\s*new Date\(\),\s*reportError,\s*this\.orphanClaimsSeen\s*\)/
    );
  });
});
