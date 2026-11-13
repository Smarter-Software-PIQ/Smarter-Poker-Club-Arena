// 2026-11-06: the Agent Dashboard read all 817 KINGS CLUB profiles in ONE
// `.in('id', ...)` request. The URL reached 32KB and the database gateway
// answered a plain 400 (25.0KB measured 200, 26.5KB measured 400), six times
// that day, so every player rendered without a name or avatar. These tests pin
// the batched reader at its boundaries and pin the call sites that used to
// send whole rosters in one request.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IN_BATCH_SIZE, idBatches, selectInBatches } from '../../src/lib/inBatches';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// A PostgREST URL carrying the roster select and an IN list of `count` UUIDs.
const urlLength = (count: number) =>
  'https://kuklfnapbkmacvwxktbh.supabase.co/rest/v1/profiles?select=id%2Cusername%2Cdisplay_name%2Calias%2Cdisplay_name_preference%2Cuse_real_name%2Cavatar_url%3Aarena_avatar_url&id=in.%28'
    .length +
  count * 39;

describe('idBatches', () => {
  it('splits at exactly the batch size and de-duplicates', () => {
    expect(idBatches([])).toEqual([]);
    expect(idBatches([uuid(1)]).map((b) => b.length)).toEqual([1]);
    const hundred = Array.from({ length: 100 }, (_, i) => uuid(i));
    expect(idBatches(hundred).map((b) => b.length)).toEqual([100]);
    expect(idBatches([...hundred, uuid(100)]).map((b) => b.length)).toEqual([100, 1]);
    expect(idBatches([...hundred, uuid(1), uuid(2)]).map((b) => b.length)).toEqual([100]);
    const roster = Array.from({ length: 817 }, (_, i) => uuid(i));
    const batches = idBatches(roster);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 17]);
    expect(batches.flat()).toEqual(roster);
  });

  it('keeps every request far below the measured gateway limit', () => {
    expect(urlLength(820)).toBeGreaterThan(26_500); // the request that failed
    expect(urlLength(IN_BATCH_SIZE)).toBeLessThan(6_000);
  });

  it('refuses a nonsensical batch size', () => {
    expect(() => idBatches([uuid(1)], 0)).toThrow();
    expect(() => idBatches([uuid(1)], 1.5)).toThrow();
  });
});

describe('selectInBatches', () => {
  it('reads an 817-member roster in nine requests of at most 100 ids and returns every row', async () => {
    const seen: number[] = [];
    const roster = Array.from({ length: 817 }, (_, i) => uuid(i));
    const { data, error } = await selectInBatches(roster, async (batch) => {
      seen.push(batch.length);
      return { data: batch.map((id) => ({ id })), error: null };
    });
    expect(error).toBeNull();
    expect(seen).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 17]);
    expect(data.map((row) => row.id)).toEqual(roster);
  });

  it('makes no request for an empty list', async () => {
    let calls = 0;
    const result = await selectInBatches([], async () => {
      calls++;
      return { data: [], error: null };
    });
    expect(calls).toBe(0);
    expect(result).toEqual({ data: [], error: null });
  });

  it('stops at the first failed batch and reports its error', async () => {
    let calls = 0;
    const failure = { code: '57014' };
    const roster = Array.from({ length: 250 }, (_, i) => uuid(i));
    const { data, error } = await selectInBatches(roster, async (batch) => {
      calls++;
      return calls === 2
        ? { data: null, error: failure }
        : { data: batch.map((id) => ({ id })), error: null };
    });
    expect(calls).toBe(2);
    expect(error).toBe(failure);
    expect(data).toHaveLength(100);
  });
});

describe('roster-sized profile lookups use the batched reader', () => {
  const sites: Array<[string, RegExp]> = [
    ['src/pages/AgentDashboardPage.tsx', /\.in\('id', allUserIds\)/],
    ['src/pages/AgentDashboardPage.tsx', /\.in\('user_id', allUserIds\)/],
    ['src/services/LeaderboardService.ts', /\.in\('id', userIds\)/],
    ['src/pages/UnionDashboardPage.tsx', /\.in\('id', agentUserIds\)/],
    ['src/services/AgentService.ts', /\.in\('id', \[\.\.\.allUserIds\]\)/],
    ['src/services/AgentService.ts', /\.in\('id', userIds\)/],
    ['src/components/agent/AgentCommissionDashboard.tsx', /\.in\('id', subAgentUserIds\)/],
    ['src/services/HandHistoryService.ts', /\.in\('id', unique\)/],
    ['src/components/gameplay/PlayerNotesPanel.tsx', /\.in\('id', tIds\)/],
    ['src/services/MembershipService.ts', /\.in\('id', userIds\)/],
  ];
  for (const [file, unbatched] of sites) {
    it(`${file} never sends ${unbatched.source} in one request`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(unbatched);
      expect(source).toMatch(/selectInBatches\(/);
    });
  }
});
