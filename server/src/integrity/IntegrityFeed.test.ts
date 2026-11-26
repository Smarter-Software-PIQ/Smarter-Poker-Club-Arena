import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrityFeed } from './IntegrityFeed.js';
import type { HandHistoryRow } from './HandEventAdapter.js';

const feeds: IntegrityFeed[] = [];

function makeFeed(opts?: ConstructorParameters<typeof IntegrityFeed>[0]): IntegrityFeed {
  const feed = new IntegrityFeed(opts);
  feeds.push(feed);
  return feed;
}

function makeBotAndCollusionRow(index: number): HandHistoryRow {
  const baseMs = 1_700_000_000_000 + index * 10_000;
  return {
    id: `hand-${index}`,
    table_id: 'table-1',
    hand_number: index,
    pot_size: 200,
    started_at: new Date(baseMs).toISOString(),
    ended_at: new Date(baseMs + 5_000).toISOString(),
    players: [
      { user_id: 'bot-1', seat_number: 1, stack: 1000 },
      { user_id: 'dump-loser', seat_number: 2, stack: 1000 },
      { user_id: 'dump-winner', seat_number: 3, stack: 1000 },
    ],
    actions: [
      {
        user_id: 'bot-1',
        action: 'call',
        amount: 20,
        street: 'preflop',
        timestamp: baseMs + 1_000,
      },
      {
        user_id: 'dump-loser',
        action: 'bet',
        amount: 100,
        street: 'preflop',
        timestamp: baseMs + 1_500,
      },
      {
        user_id: 'bot-1',
        action: 'call',
        amount: 100,
        street: 'preflop',
        timestamp: baseMs + 2_000,
      },
      {
        user_id: 'dump-winner',
        action: 'raise',
        amount: 200,
        street: 'preflop',
        timestamp: baseMs + 2_500,
      },
      {
        user_id: 'dump-loser',
        action: 'fold',
        amount: 0,
        street: 'preflop',
        timestamp: baseMs + 3_000,
      },
      {
        user_id: 'bot-1',
        action: 'fold',
        amount: 0,
        street: 'preflop',
        timestamp: baseMs + 3_500,
      },
    ],
    winners: [{ user_id: 'dump-winner', amount: 220 }],
  };
}

afterEach(() => {
  for (const f of feeds.splice(0)) f.dispose();
  vi.restoreAllMocks();
});

describe('IntegrityFeed ring buffer and off-hot-path async analysis (incident 1e532243)', () => {
  it('retains the newest maxHands in exact oldest-to-newest order across wrap-around', () => {
    const feed = makeFeed({ maxHands: 5, analyzeEvery: 100, logger: { warn: vi.fn() } });
    for (let i = 1; i <= 12; i++) {
      feed.ingestRow(makeBotAndCollusionRow(i));
    }
    expect(feed.size()).toBe(5);
    expect(feed.totalIngested()).toBe(12);
    expect(feed.snapshotHands().map((h) => h.handId)).toEqual([
      'hand-8',
      'hand-9',
      'hand-10',
      'hand-11',
      'hand-12',
    ]);
  });

  it('never executes synchronous full-batch analysis inside ingestRow() on the settlement call stack', async () => {
    const warn = vi.fn();
    const feed = makeFeed({
      maxHands: 50,
      analyzeEvery: 25,
      analyzeChunkSize: 10,
      logger: { warn },
    });
    const syncAnalyzeSpy = vi.spyOn(feed, 'analyze');

    for (let i = 1; i <= 25; i++) {
      feed.ingestRow(makeBotAndCollusionRow(i));
    }
    // Synchronously right after crossing analyzeEvery: zero blocking scan, zero sync warnings.
    expect(syncAnalyzeSpy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    // Yield across setImmediate chunks so the detached background scan finishes.
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('[IntegrityFeed]');
  });

  it('produces identical bot and collusion flags in chunked analyzeAsync() as synchronous analyze()', async () => {
    const warn = vi.fn();
    const feed = makeFeed({
      maxHands: 40,
      analyzeEvery: 1000,
      analyzeChunkSize: 7,
      logger: { warn },
    });
    for (let i = 1; i <= 30; i++) {
      feed.ingestRow(makeBotAndCollusionRow(i));
    }

    const syncFlags = feed.analyze();
    const asyncFlags = await feed.analyzeAsync(7);
    expect(syncFlags.length).toBeGreaterThan(0);
    expect(asyncFlags).toEqual(syncFlags);
  });

  it('coalesces rapid analyzeEvery triggers without overlapping concurrent scans', async () => {
    const warn = vi.fn();
    const feed = makeFeed({
      maxHands: 60,
      analyzeEvery: 10,
      analyzeChunkSize: 5,
      logger: { warn },
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const orig = feed.analyzeAsync.bind(feed);
    vi.spyOn(feed, 'analyzeAsync').mockImplementation(async (chunkSize?: number) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await orig(chunkSize);
      } finally {
        inFlight--;
      }
    });

    // Cross analyzeEvery 5 times synchronously in one burst.
    for (let i = 1; i <= 50; i++) {
      feed.ingestRow(makeBotAndCollusionRow(i));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 80));

    expect(maxInFlight).toBe(1);
    // Initial scheduled scan + at most one coalesced follow-up pass, never 5 stacked scans.
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
