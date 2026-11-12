import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  comparableGames,
  horseListCap,
  planHorseQueues,
  queuePatienceMs,
  variantFamily,
} from './HorseGameQueue.js';

const NOW = 1_800_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const base = {
  excludedGameIds: new Set<string>(),
  humanWaitingGameIds: new Set<string>(),
  seatedByGame: new Map<string, Set<string>>([['g1', new Set(['s1', 's2'])]]),
  nowMs: NOW,
};
const fullG1 = [{ gameId: 'g1', maxPlayers: 2, seated: 2 }];
const ask = { gameId: 'g1', waitTarget: 3, pool: ['h1', 'h2', 'h3', 's1'] };

describe('horses stand in line on a full game (Dan 2026-11-06)', () => {
  it('adds ONE horse per game per cycle, never one seated in the game', () => {
    const plan = planHorseQueues({ ...base, asks: [ask], tables: fullG1, rows: [] });
    expect(plan.add).toHaveLength(1);
    expect(['h1', 'h2', 'h3']).toContain(plan.add[0].user_id);
    expect(plan.cancel).toEqual([]);
  });

  it('a game with an open chair KEEPS its line and adds nobody: the list feeds the chair (owner 2026-11-07)', () => {
    const rows = [{ id: 'r1', game_id: 'g1', user_id: 'h1', created_at: iso(60_000) }];
    const plan = planHorseQueues({
      ...base,
      asks: [ask],
      tables: [...fullG1, { gameId: 'g1', maxPlayers: 6, seated: 5 }],
      rows,
    });
    expect(plan.add).toEqual([]);
    expect(plan.cancel).toEqual([]);
  });

  it('a human waiting, Lightning, or a disabled game carries no horse line', () => {
    const rows = [{ id: 'r1', game_id: 'g1', user_id: 'h1', created_at: iso(60_000) }];
    for (const extra of [
      { humanWaitingGameIds: new Set(['g1']) },
      { excludedGameIds: new Set(['g1']) },
    ]) {
      const plan = planHorseQueues({ ...base, ...extra, asks: [ask], tables: fullG1, rows });
      expect(plan.add).toEqual([]);
      expect(plan.cancel).toEqual(['r1']);
    }
  });

  it('trims a line past its target newest first, so the head holds still', () => {
    const rows = [
      { id: 'old', game_id: 'g1', user_id: 'h1', created_at: iso(120_000) },
      { id: 'new', game_id: 'g1', user_id: 'h2', created_at: iso(60_000) },
    ];
    const plan = planHorseQueues({
      ...base,
      asks: [{ ...ask, waitTarget: 1 }],
      tables: fullG1,
      rows,
    });
    expect(plan.cancel).toEqual(['new']);
  });

  it('a horse gives up after its patience, and drops a line it would not list with the others', () => {
    const rows = [
      { id: 'stale', game_id: 'g1', user_id: 'h1', created_at: iso(queuePatienceMs('stale')) },
      { id: 'a', game_id: 'g1', user_id: 'h2', created_at: iso(60_000) },
      { id: 'b', game_id: 'g2', user_id: 'h2', created_at: iso(30_000) },
    ];
    const plan = planHorseQueues({ ...base, asks: [ask], tables: fullG1, rows });
    expect(plan.cancel).toContain('stale');
    expect(plan.cancel).toContain('b');
    expect(plan.add.every((a) => a.user_id !== 'h2')).toBe(true);
  });

  it('leaves a game it did not see this cycle alone', () => {
    const rows = [{ id: 'r9', game_id: 'gX', user_id: 'h9', created_at: iso(60_000) }];
    const plan = planHorseQueues({ ...base, asks: [], tables: fullG1, rows });
    expect(plan.cancel).toEqual([]);
  });

  it('keeps a full game line when this fleet walk produced no ask', () => {
    const rows = [{ id: 'r1', game_id: 'g1', user_id: 'h1', created_at: iso(60_000) }];
    expect(planHorseQueues({ ...base, asks: [], tables: fullG1, rows })).toEqual({
      cancel: [],
      add: [],
    });
  });

  it('patience runs 25 to 55 minutes', () => {
    for (let i = 0; i < 200; i++) {
      const p = queuePatienceMs(`row-${i}`);
      expect(p).toBeGreaterThanOrEqual(25 * 60_000);
      expect(p).toBeLessThanOrEqual(55 * 60_000);
    }
  });

  it('a horse that gives up on one line puts its name down at another game first', () => {
    const rows = [
      { id: 'gone', game_id: 'g2', user_id: 'h9', created_at: iso(queuePatienceMs('gone')) },
    ];
    const plan = planHorseQueues({
      ...base,
      asks: [{ gameId: 'g1', waitTarget: 2, pool: ['h1', 'h2', 'h3', 'h9'] }],
      tables: [...fullG1, { gameId: 'g2', maxPlayers: 2, seated: 2 }],
      rows,
    });
    expect(plan.cancel).toEqual(['gone']);
    expect(plan.add).toEqual([{ game_id: 'g1', user_id: 'h9' }]);
  });

  it('never straight back into the line it just left', () => {
    const rows = [
      { id: 'gone', game_id: 'g1', user_id: 'h9', created_at: iso(queuePatienceMs('gone')) },
    ];
    const plan = planHorseQueues({
      ...base,
      asks: [{ gameId: 'g1', waitTarget: 2, pool: ['h9'] }],
      tables: fullG1,
      rows,
    });
    expect(plan.add).toEqual([]);
  });
});

describe('several lists at once (owner 2026-11-07)', () => {
  const info = new Map([
    ['g1', { variant: 'nlh', bigBlind: 0.5 }],
    ['g2', { variant: 'nlh', bigBlind: 1 }],
    ['g3', { variant: 'nlh', bigBlind: 0.25 }],
    ['g4', { variant: 'nlh', bigBlind: 2 }],
    ['gP', { variant: 'plo4', bigBlind: 0.5 }],
    ['gQ', { variant: 'plo5', bigBlind: 1 }],
  ]);
  const full = (g: string) => ({ gameId: g, maxPlayers: 2, seated: 2 });
  /** A full game whose tables ask for a line of three, from nobody new. */
  const keep = (g: string) => ({ gameId: g, waitTarget: 3, pool: [] as string[] });
  const capThree = (() => {
    for (let i = 0; i < 100; i++) if (horseListCap(`hz${i}`) === 3) return `hz${i}`;
    throw new Error('no cap-3 horse');
  })();
  const capTwo = (() => {
    for (let i = 0; i < 100; i++) if (horseListCap(`hy${i}`) === 2) return `hy${i}`;
    throw new Error('no cap-2 horse');
  })();

  it('a horse lists for two or three games, never more', () => {
    const caps = new Set<number>();
    for (let i = 0; i < 200; i++) caps.add(horseListCap(`h${i}`));
    expect([...caps].sort()).toEqual([2, 3]);
  });

  it('comparable means the same variant family at nearby stakes', () => {
    expect(comparableGames(info.get('g1'), info.get('g2'))).toBe(true);
    expect(comparableGames(info.get('g1'), info.get('g3'))).toBe(true);
    expect(comparableGames(info.get('g3'), info.get('g2'))).toBe(false); // 4x apart
    expect(comparableGames(info.get('g1'), info.get('gP'))).toBe(false); // NLH vs PLO
    expect(comparableGames(info.get('gP'), info.get('gQ'))).toBe(true); // PLO4 + PLO5
    expect(comparableGames(info.get('g1'), undefined)).toBe(false);
    expect(variantFamily('plo6')).toBe('omaha');
    expect(variantFamily('flo8')).toBe('flo8');
  });

  it('a horse already on one list joins a comparable second one', () => {
    const rows = [{ id: 'r1', game_id: 'g1', user_id: capTwo, created_at: iso(60_000) }];
    const plan = planHorseQueues({
      ...base,
      seatedByGame: new Map(),
      gameInfo: info,
      asks: [keep('g1'), { gameId: 'g2', waitTarget: 2, pool: [capTwo] }],
      tables: [full('g1'), full('g2')],
      rows,
    });
    expect(plan.cancel).toEqual([]);
    expect(plan.add).toEqual([{ game_id: 'g2', user_id: capTwo }]);
  });

  it('never an incomparable game, and never past its cap', () => {
    const rows = [
      { id: 'a', game_id: 'g1', user_id: capTwo, created_at: iso(90_000) },
      { id: 'b', game_id: 'g2', user_id: capTwo, created_at: iso(60_000) },
    ];
    const plan = planHorseQueues({
      ...base,
      seatedByGame: new Map(),
      gameInfo: info,
      asks: [
        keep('g1'),
        keep('g2'),
        { gameId: 'g3', waitTarget: 2, pool: [capTwo] },
        { gameId: 'gP', waitTarget: 2, pool: [capTwo] },
      ],
      tables: [full('g1'), full('g2'), full('g3'), full('gP')],
      rows,
    });
    expect(plan.cancel).toEqual([]);
    expect(plan.add).toEqual([]);
  });

  it('a row for a game not near EVERY other list of the horse goes, the oldest lists kept', () => {
    const rows = [
      { id: 'a', game_id: 'g1', user_id: capThree, created_at: iso(120_000) },
      { id: 'b', game_id: 'g2', user_id: capThree, created_at: iso(90_000) },
      { id: 'c', game_id: 'g3', user_id: capThree, created_at: iso(80_000) },
    ];
    const plan = planHorseQueues({
      ...base,
      seatedByGame: new Map(),
      gameInfo: info,
      asks: [keep('g1'), keep('g2'), keep('g3')],
      tables: [full('g1'), full('g2'), full('g3')],
      rows,
    });
    // g3 (0.25) is not near g2 (1): the newest, incomparable row is the one that goes.
    expect(plan.cancel).toEqual(['c']);
  });

  it('seated anywhere, it leaves its OTHER lists at once; the seated game is left for the tick', () => {
    const rows = [
      { id: 'here', game_id: 'g1', user_id: capThree, created_at: iso(120_000) },
      { id: 'there', game_id: 'g2', user_id: capThree, created_at: iso(90_000) },
      { id: 'other', game_id: 'g3', user_id: 'h7', created_at: iso(90_000) },
    ];
    const plan = planHorseQueues({
      ...base,
      seatedByGame: new Map([['g1', new Set([capThree])]]),
      seatedAnywhere: new Set([capThree, 'h7']),
      gameInfo: info,
      asks: [keep('g1'), { gameId: 'g2', waitTarget: 3, pool: [capThree, 'h7'] }, keep('g3')],
      tables: [full('g1'), full('g2'), full('g3')],
      rows,
    });
    expect(plan.cancel.sort()).toEqual(['other', 'there']);
    // A seated horse joins no list.
    expect(plan.add).toEqual([]);
  });

  it('leaving a list only changes list rows: the sync writes cash_game_waitlist and never a seat', () => {
    const src = readFileSync(join(__dirname, 'HorseFleetManager.ts'), 'utf8');
    const start = src.indexOf('private async syncHorseGameQueues(');
    const body = src.slice(start, src.indexOf('private async pruneHorseWaitlist(', start));
    expect(body).toContain('gameInfo,');
    expect(body).toContain('seatedAnywhere,');
    expect(body).not.toMatch(/leaveTable|table_seats|atomicCashout|cash_seat_moves/);
    expect(
      body.match(/\.from\('([a-z_]+)'\)/g)?.every((m) => m.includes('cash_game_waitlist'))
    ).toBe(true);
    // The seats this cycle just took count as seated (horseTables).
    expect(src).toMatch(/readIsCurrent,\s*horseTables,\s*book\s*\);/);
  });
});
