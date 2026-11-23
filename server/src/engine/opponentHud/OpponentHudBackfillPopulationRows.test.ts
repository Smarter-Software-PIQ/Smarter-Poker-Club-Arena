/**
 * OPPONENT HUD BACKFILL, LOAD HARDENING (2026-11-22, PLO-OWNER lead-5; review of the 24-hour audit, P2-4):
 * a rebuild that applied no hand writes no population row (never a '*' row with wm_ms -1), and a page the database
 * client gave up on (supabase_timeout) is retried within the same bounds as a statement timeout.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SharedBackfillPacer,
  backfillPopulationRows,
  isTransientBackfillError,
  pageAllOpponentHudHandsConcurrent,
} from './OpponentHudBackfillPlan.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('opponent HUD backfill: the population rows of a rebuild', () => {
  const priors = { plo4: { family: { a: 1 }, stakes: {} }, plo5: { family: { b: 2 }, stakes: {} } };
  const families = ['plo4', 'plo5'] as const;

  it('a rebuild that applied no hand writes no population row: never wm_ms -1 over the stored sync point', () => {
    expect(backfillPopulationRows({ families, hands: 0, lastHandAtMs: -1, priors })).toEqual([]);
    // no hand counted, whatever the watermark says; and no watermark, whatever the count says
    expect(
      backfillPopulationRows({ families, hands: 0, lastHandAtMs: 1_800_000_000_000, priors })
    ).toEqual([]);
    expect(backfillPopulationRows({ families, hands: 3, lastHandAtMs: -1, priors })).toEqual([]);
    expect(
      backfillPopulationRows({ families, hands: 3, lastHandAtMs: Number.NaN, priors })
    ).toEqual([]);
  });

  it('a rebuild that applied hands writes one row per family, stamped with its newest hand', () => {
    const rows = backfillPopulationRows({
      families,
      hands: 2,
      lastHandAtMs: 1_800_000_000_000.4,
      priors,
    });
    expect(rows).toEqual([
      {
        user_id: '*',
        family: 'plo4',
        version: 1,
        hands: 0,
        wm_ms: 1_800_000_000_000,
        profile: priors.plo4,
        rebuild: true,
      },
      {
        user_id: '*',
        family: 'plo5',
        version: 1,
        hands: 0,
        wm_ms: 1_800_000_000_000,
        profile: priors.plo5,
        rebuild: true,
      },
    ]);
    expect(rows.every((r) => r.wm_ms > 0)).toBe(true);
  });

  it('the build script writes its population rows only through that rule', () => {
    const src = read('../../../scripts/opponent-hud-build.ts');
    expect(src).toMatch(/backfillPopulationRows\(\{/);
    expect(src).toMatch(/rows\.push\(\.\.\.populationRows\)/);
    // no population row is built in the script itself
    expect(src).not.toMatch(/user_id:\s*'\*'/);
    expect(src).not.toMatch(/wm_ms:\s*Math\.round\(lastHandAt\)/);
  });
});

describe('opponent HUD backfill: the database client giving up on a page (supabase_timeout) is retried, not fatal', () => {
  const HOUR = 3600_000;
  const since = '2026-10-19T00:00:00.000Z';
  const until = '2026-10-19T16:00:00.000Z';
  type Row = { id: string; created_at: string };
  // four 4-hour windows, 1,200 hands in each (three pages of 500 / 500 / 200)
  const all: Row[] = [];
  for (let w = 0; w < 4; w++)
    for (let i = 0; i < 1200; i++)
      all.push({
        id: `40000000-0000-4000-8000-${String(w * 10_000 + i).padStart(12, '0')}`,
        created_at: new Date(Date.parse(since) + w * 4 * HOUR + (i + 1) * 1000).toISOString(),
      });
  const pageOf = (c: { afterAt: string; afterId: string; until: string; limit: number }): Row[] => {
    const out: Row[] = [];
    for (const r of all) {
      if (out.length >= c.limit) break;
      const after = r.created_at > c.afterAt || (r.created_at === c.afterAt && r.id > c.afterId);
      if (after && r.created_at <= c.until) out.push(r);
    }
    return out;
  };
  /** what the build script throws for a failed page: its prefix and the client's own error text */
  const clientTimeout = () => new Error('hands page failed: Error: supabase_timeout');
  const secondPageOfWindowThree = '2026-10-19T08:08:20.000Z';
  async function run(
    failing: (c: { afterAt: string; limit: number }, attempt: number) => boolean,
    pacer = new SharedBackfillPacer({ maxConcurrency: 4, basePauseMs: 200, slowMs: 2000 })
  ) {
    const ids: string[] = [];
    const retries: {
      windowIndex: number;
      prevLimit: number;
      nextLimit: number;
      delayMs: number;
    }[] = [];
    const limitsAtFailingPage: number[] = [];
    const sleeps: number[] = [];
    const res = await pageAllOpponentHudHandsConcurrent<Row>({
      since,
      until,
      concurrency: 4,
      windowMs: 4 * HOUR,
      pacer,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchPage: async (c) => {
        if (c.afterAt === secondPageOfWindowThree) {
          limitsAtFailingPage.push(c.limit);
          if (failing(c, limitsAtFailingPage.length)) throw clientTimeout();
        }
        await new Promise((r) => setTimeout(r, 0));
        return pageOf(c);
      },
      onItem: (r) => ids.push(r.id),
      onRetry: ({ windowIndex, prevLimit, nextLimit, delayMs }) =>
        retries.push({ windowIndex, prevLimit, nextLimit, delayMs }),
    });
    return { res, ids, retries, limitsAtFailingPage, sleeps, pacer };
  }

  it('classifies the client deadline as transient, and still nothing else new', () => {
    expect(isTransientBackfillError(clientTimeout())).toBe(true);
    expect(isTransientBackfillError(new Error('supabase_timeout'))).toBe(true);
    expect(isTransientBackfillError(new Error('hands page failed: permission denied'))).toBe(false);
    expect(isTransientBackfillError(new Error('hands page failed: invalid input syntax'))).toBe(
      false
    );
  });

  it('one supabase_timeout on one page is retried on half the rows, the shared pacer drops a reader, and the totals are identical', async () => {
    const clean = await run(() => false);
    expect(clean.res).toMatchObject({ windows: 4, rows: 4800, retries: 0 });
    expect(clean.ids).toEqual(all.map((r) => r.id));

    const pacer = new SharedBackfillPacer({ maxConcurrency: 4, basePauseMs: 200, slowMs: 2000 });
    let readersAtRetry = -1;
    const hit = await run((_c, attempt) => {
      if (attempt === 1) return true;
      // the retry of the page: by now the shared pacer has taken one reader away from the whole run
      readersAtRetry = pacer.getEffectiveConcurrency();
      return false;
    }, pacer);
    expect(hit.res).toMatchObject({ windows: 4, rows: 4800, retries: 1 });
    // the same hands, in the same order, each once
    expect(hit.ids).toEqual(clean.ids);
    expect(new Set(hit.ids).size).toBe(4800);
    expect(hit.limitsAtFailingPage).toEqual([500, 250]);
    expect(hit.retries).toEqual([
      { windowIndex: 2, prevLimit: 500, nextLimit: 250, delayMs: 1000 },
    ]);
    expect(hit.sleeps).toContain(1000); // the backoff before the retry
    expect(readersAtRetry).toBe(3);
    expect(clean.pacer.getEffectiveConcurrency()).toBe(4);
  });

  it('a page whose every attempt times out fails the run after the cap (1 read + 4 retries), with nothing half-applied after it', async () => {
    const ids: string[] = [];
    const limits: number[] = [];
    const delays: number[] = [];
    await expect(
      pageAllOpponentHudHandsConcurrent<Row>({
        since,
        until,
        concurrency: 4,
        windowMs: 4 * HOUR,
        now: () => 0,
        sleep: async () => {},
        fetchPage: async (c) => {
          if (c.afterAt === secondPageOfWindowThree) {
            limits.push(c.limit);
            throw clientTimeout();
          }
          await new Promise((r) => setTimeout(r, 0));
          return pageOf(c);
        },
        onItem: (r) => ids.push(r.id),
        onRetry: ({ delayMs }) => delays.push(delayMs),
      })
    ).rejects.toThrow(/supabase_timeout/);
    expect(limits).toEqual([500, 250, 125, 62, 31]);
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    // windows are handed over in order: nothing of the failed window or a later one was applied
    expect(ids.every((id) => id < '40000000-0000-4000-8000-000000020000')).toBe(true);
  });
});
