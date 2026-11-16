import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLegacyPacific, parseRange } from '../../scripts/ci/club-data-accounting-seed.mjs';

afterEach(() => vi.restoreAllMocks());

describe('finite original-source Pacific history driver', () => {
  it('attempts each day once and retains incomplete receipts without guessing totals', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const calls: { sql: string; params?: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('seed_log')) return { rowCount: 0, rows: [] };
        if (sql.includes('fn_ca_club_data_pacific_seed'))
          return { rowCount: 1, rows: [{ receipt: { complete: params?.[0] !== '2026-11-09' } }] };
        return { rowCount: 0, rows: [] };
      },
    };
    await expect(
      loadLegacyPacific(client, parseRange('2026-11-09', '2026-11-10'), true)
    ).rejects.toThrow('incomplete: 2026-11-09');
    expect(
      calls.filter((c) => c.sql.includes('fn_ca_club_data_pacific_seed')).map((c) => c.params)
    ).toEqual([
      ['2026-11-09', true],
      ['2026-11-10', true],
    ]);
    expect(calls.filter((c) => c.sql === 'COMMIT')).toHaveLength(2);
    expect(calls.some((c) => c.sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ')).toBe(true);
    expect(calls.some((c) => c.sql === "SET LOCAL statement_timeout = '240s'")).toBe(true);
  });

  it('a query failure rolls back and stops without retrying the unknown day', async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes('fn_ca_club_data_pacific_seed'))
          throw new Error('source statement cancelled');
        return { rowCount: 0, rows: [] };
      },
    };
    await expect(loadLegacyPacific(client, ['2026-11-09', '2026-11-10'], false)).rejects.toThrow(
      'cancelled'
    );
    expect(calls.filter((s) => s === 'ROLLBACK')).toHaveLength(1);
    expect(calls.filter((s) => s.includes('fn_ca_club_data_pacific_seed'))).toHaveLength(1);
  });

  it('retains already-loaded receipts and reports their unresolved evidence', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const client = {
      query: vi.fn(async (sql: string) =>
        sql.includes('seed_log') ? { rowCount: 1, rows: [{}] } : { rowCount: 1, rows: [{ n: 2 }] }
      ),
    };
    await expect(loadLegacyPacific(client, ['2026-11-09'], false)).rejects.toThrow(
      'incomplete: 2026-11-09'
    );
    expect(client.query.mock.calls.some(([s]) => s.includes('fn_ca_club_data_pacific_seed'))).toBe(
      false
    );
  });
});
