/**
 * A REPEAT JOIN KEEPS ITS PLACE (2026-11-22).
 *
 * cash_game_waitlist_one_open allows one open row per (game, player), and
 * open means 'waiting' or 'notified'. The fleet's queue read asked for
 * 'waiting' rows only, so a horse whose name the tick had just called looked
 * like it was on no list; the planner put it down for that game again and the
 * database refused the whole batch insert (23505), taking every other game's
 * arrival in that batch with it. 67 refusals in the 24 hours to 02:21 UTC on
 * 2026-11-23, all from this insert, all 60 players horses.
 *
 * A person's door (fn_cash_game_join) already answers a repeat join with the
 * place they hold. The fleet now gives the same answer: the repeat arrival is
 * dropped, the existing row (its place in line included) is untouched, and
 * every cancel and every other arrival is exactly what the planner decided.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  keepHeldPlaces,
  OPEN_LIST_STATUSES,
  planHorseQueues,
  type HorseQueuePlan,
  type OpenListRow,
} from './HorseGameQueue.js';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..', '..', '..');
const FLEET = readFileSync(join(HERE, 'HorseFleetManager.ts'), 'utf8');

const NOW = 1_800_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('LAW: a repeat join keeps its place', () => {
  it('a horse whose name was called is not put down for that game again', () => {
    const plan: HorseQueuePlan = {
      cancel: [],
      add: [
        { game_id: 'g1', user_id: 'h1' },
        { game_id: 'g2', user_id: 'h2' },
      ],
    };
    const open: OpenListRow[] = [{ id: 'r1', game_id: 'g1', user_id: 'h1', status: 'notified' }];
    const kept = keepHeldPlaces(plan, open);
    // The repeat arrival is dropped; the other game's arrival still lands.
    expect(kept.add).toEqual([{ game_id: 'g2', user_id: 'h2' }]);
    expect(kept.cancel).toEqual([]);
  });

  it('a called name on ANOTHER game does not stop the horse joining this one', () => {
    const plan: HorseQueuePlan = { cancel: [], add: [{ game_id: 'g2', user_id: 'h1' }] };
    const open: OpenListRow[] = [{ id: 'r1', game_id: 'g1', user_id: 'h1', status: 'notified' }];
    expect(keepHeldPlaces(plan, open)).toEqual(plan);
  });

  it('a waiting row the plan cancels frees the place; one it keeps holds it', () => {
    const open: OpenListRow[] = [
      { id: 'w1', game_id: 'g1', user_id: 'h1', status: 'waiting' },
      { id: 'w2', game_id: 'g2', user_id: 'h2', status: 'waiting' },
    ];
    const plan: HorseQueuePlan = {
      cancel: ['w1'],
      add: [
        { game_id: 'g1', user_id: 'h1' },
        { game_id: 'g2', user_id: 'h2' },
      ],
    };
    // w1 is cancelled before the insert runs, so h1 may stand in g1's line
    // again; w2 still stands, so a second h2 row for g2 would be refused.
    expect(keepHeldPlaces(plan, open)).toEqual({
      cancel: ['w1'],
      add: [{ game_id: 'g1', user_id: 'h1' }],
    });
  });

  it('a closed row (seated, expired, cancelled) holds no place', () => {
    const plan: HorseQueuePlan = { cancel: [], add: [{ game_id: 'g1', user_id: 'h1' }] };
    for (const status of ['seated', 'expired', 'cancelled']) {
      expect(keepHeldPlaces(plan, [{ id: 'x', game_id: 'g1', user_id: 'h1', status }])).toEqual(
        plan
      );
    }
  });

  it('the planner the fleet runs still puts the called horse down, and the batch keeps every other game', () => {
    // Two full games, one horse each in the asking pool. h1's name on g1 was
    // called (notified), so the waiting-only rows the planner reads hold
    // nothing for it - the exact state behind every refusal measured.
    const plan = planHorseQueues({
      asks: [
        { gameId: 'g1', waitTarget: 2, pool: ['h1'] },
        { gameId: 'g2', waitTarget: 2, pool: ['h2'] },
      ],
      tables: [
        { gameId: 'g1', maxPlayers: 2, seated: 2 },
        { gameId: 'g2', maxPlayers: 2, seated: 2 },
      ],
      rows: [],
      excludedGameIds: new Set(),
      humanWaitingGameIds: new Set(),
      seatedByGame: new Map([
        ['g1', new Set(['s1', 's2'])],
        ['g2', new Set(['s3', 's4'])],
      ]),
      nowMs: NOW,
    });
    expect(plan.add).toEqual([
      { game_id: 'g1', user_id: 'h1' },
      { game_id: 'g2', user_id: 'h2' },
    ]);
    const kept = keepHeldPlaces(plan, [
      { id: 'n1', game_id: 'g1', user_id: 'h1', status: 'notified' },
    ]);
    expect(kept.add).toEqual([{ game_id: 'g2', user_id: 'h2' }]);
  });

  it('nothing about who is in line or in what order changes when nobody holds a place', () => {
    const rows = [
      { id: 'a', game_id: 'g1', user_id: 'h1', created_at: iso(60_000) },
      { id: 'b', game_id: 'g1', user_id: 'h2', created_at: iso(30_000) },
    ];
    const input = {
      asks: [{ gameId: 'g1', waitTarget: 3, pool: ['h1', 'h2', 'h3'] }],
      tables: [{ gameId: 'g1', maxPlayers: 2, seated: 2 }],
      rows,
      excludedGameIds: new Set<string>(),
      humanWaitingGameIds: new Set<string>(),
      seatedByGame: new Map([['g1', new Set(['s1', 's2'])]]),
      nowMs: NOW,
    };
    const plan = planHorseQueues(input);
    const open: OpenListRow[] = rows.map((r) => ({ ...r, status: 'waiting' }));
    expect(keepHeldPlaces(plan, open)).toEqual(plan);
  });

  it('the fleet reads every open place and the planner still sees only waiting rows', () => {
    const start = FLEET.indexOf('private async syncHorseGameQueues(');
    expect(start).toBeGreaterThan(0);
    const sync = FLEET.slice(start, FLEET.indexOf('\n  }\n', start));
    const read = sync.slice(
      sync.indexOf('fetchAllRows<'),
      sync.indexOf("label: 'HorseFleet.horseGameQueues'")
    );
    expect(read).toContain(".select('id, game_id, user_id, created_at, status')");
    expect(read).toContain(".in('status', [...OPEN_LIST_STATUSES])");
    expect(read).not.toContain(".eq('status', 'waiting')");
    expect(sync).toContain("const rows = openRows.filter((r) => r.status === 'waiting');");
    // The plan that reaches the insert has been through keepHeldPlaces.
    expect(sync).toMatch(/const plan = keepHeldPlaces\(\s*planHorseQueues\(\{/);
    expect(sync).toMatch(/\}\),\s*openRows\s*\);/);
    const planAt = sync.indexOf('const plan = keepHeldPlaces(');
    const insertAt = sync.indexOf('.insert(plan.add.map(');
    expect(planAt).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(planAt);
  });

  it("the fleet's open statuses are the index's open statuses", () => {
    const dir = join(ROOT, 'supabase', 'migrations');
    const defs = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .flatMap((sql) => [
        ...sql.matchAll(
          /CREATE UNIQUE INDEX[^;]*cash_game_waitlist_one_open[^;]*WHERE\s+status\s+IN\s*\(([^)]*)\)/gi
        ),
      ]);
    expect(defs.length).toBeGreaterThan(0);
    const statuses = [...defs[defs.length - 1][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...statuses].sort()).toEqual([...OPEN_LIST_STATUSES].sort());
  });
});
