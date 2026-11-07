import { describe, it, expect } from 'vitest';
import { planHorseQueues, queuePatienceMs } from './HorseGameQueue.js';

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

  it('never queues behind an open seat: a game with any open seat clears its line', () => {
    const rows = [{ id: 'r1', game_id: 'g1', user_id: 'h1', created_at: iso(60_000) }];
    const plan = planHorseQueues({
      ...base,
      asks: [ask],
      tables: [...fullG1, { gameId: 'g1', maxPlayers: 6, seated: 5 }],
      rows,
    });
    expect(plan.add).toEqual([]);
    expect(plan.cancel).toEqual(['r1']);
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

  it('a horse gives up after its patience, and is in one line at a time', () => {
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
