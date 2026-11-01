import { describe, expect, it } from 'vitest';
import { orderHorseTournamentCandidates } from './HorseTournamentCandidateOrder.js';
const pool = Array.from({ length: 100 }, (_, i) => ({ id: `horse-${i}`, value: i }));
describe('each tournament draws an independent Horse queue', () => {
  it('retains every candidate once without mutating the pool', () => {
    const before = pool.map((x) => x.id);
    const result = orderHorseTournamentCandidates(pool, 'event-a', 20);
    expect(result.map((x) => x.id).sort()).toEqual([...before].sort());
    expect(new Set(result.map((x) => x.id)).size).toBe(pool.length);
    expect(pool.map((x) => x.id)).toEqual(before);
    expect(result.every((x) => pool.includes(x))).toBe(true);
  });
  it('retries and different input page orders retain the same event selection', () => {
    expect(orderHorseTournamentCandidates([...pool].reverse(), 'event-a', 20)).toEqual(
      orderHorseTournamentCandidates(pool, 'event-a', 20)
    );
  });
  it('does not reduce events to rotations of the same contiguous cohort', () => {
    const cohorts = Array.from({ length: 300 }, (_, i) =>
      orderHorseTournamentCandidates(pool, `random-event-${i}`, 20)
        .slice(0, 30)
        .map((x) => x.id)
        .sort()
        .join(',')
    );
    // A rotation of 100 candidates has at most 100 different 30-Horse
    // cohorts. These 300 event seeds must preserve their independent mixes.
    expect(new Set(cohorts).size).toBe(300);
  });
  it('varies selection across events and hours', () => {
    const base = orderHorseTournamentCandidates(pool, 'event-a', 20).slice(0, 30);
    expect(orderHorseTournamentCandidates(pool, 'event-b', 20).slice(0, 30)).not.toEqual(base);
    expect(orderHorseTournamentCandidates(pool, 'event-a', 21).slice(0, 30)).not.toEqual(base);
  });
  it('an empty pool is empty and a missing event identity is refused', () => {
    expect(orderHorseTournamentCandidates([], 'event-a', 20)).toEqual([]);
    expect(() => orderHorseTournamentCandidates(pool, '', 20)).toThrow('identity is required');
  });
});
