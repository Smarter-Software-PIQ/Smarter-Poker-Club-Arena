import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ts from './IncrementalPressureQualification.js';
// @ts-expect-error plain ESM script without declarations
import * as mjs from '../../scripts/feature-ablation-github-read.mjs';

// Every job of a held-out run is unrecoverable once the run exists, so a
// transient GitHub answer used to burn the whole family before a hand was
// dealt. These cases fix what is waited out and what is still refused, for the
// provider (TypeScript) and the assemble/custody scripts (plain ESM) alike.
type Step = { status?: number; headers?: Record<string, string>; body?: string; throws?: boolean };
function harness(steps: Step[], deadlineFromStart: number) {
  let clock = 1_000_000_000_000;
  const sleeps: number[] = [];
  let calls = 0;
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    log: () => {},
    fetch: async () => {
      const step = steps[Math.min(calls++, steps.length - 1)];
      if (step.throws) throw new TypeError('fetch failed');
      return new Response(step.body ?? '{}', {
        status: step.status ?? 200,
        headers: step.headers ?? {},
      });
    },
  };
  return { deps, deadline: clock + deadlineFromStart, sleeps, calls: () => calls, start: clock };
}
const MIN = 60_000;
const implementations = [
  ['provider (TypeScript)', ts.readGithubWithRetry],
  ['scripts (ESM)', mjs.readGithubWithRetry],
] as const;

describe.each(implementations)('%s qualification reads', (_name, read) => {
  const call = (h: ReturnType<typeof harness>) =>
    read('https://api.github.com/repos/o/r/actions/runs/1', { headers: {} }, h.deadline, h.deps);

  it('waits out a 5xx and returns the later success', async () => {
    const h = harness([{ status: 502 }, { status: 503 }, { status: 200 }], 10 * MIN);
    const r = await call(h);
    expect(r.status).toBe(200);
    expect(h.sleeps).toEqual([2000, 4000]);
  });

  it('waits out a network failure', async () => {
    const h = harness([{ throws: true }, { status: 200 }], 10 * MIN);
    expect((await call(h)).status).toBe(200);
    expect(h.sleeps).toEqual([2000]);
  });

  it('waits for the primary rate-limit reset on a 403', async () => {
    const h = harness([], 0);
    const resetAt = Math.floor((h.start + 30 * MIN) / 1000);
    const g = harness(
      [
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) },
        },
        { status: 200 },
      ],
      75 * MIN
    );
    expect((await call(g)).status).toBe(200);
    expect(g.sleeps).toHaveLength(1);
    expect(g.sleeps[0]).toBeGreaterThanOrEqual(30 * MIN);
    expect(g.sleeps[0]).toBeLessThanOrEqual(30 * MIN + 2000);
  });

  it('honours Retry-After on a 429', async () => {
    const h = harness(
      [{ status: 429, headers: { 'retry-after': '7' } }, { status: 200 }],
      10 * MIN
    );
    expect((await call(h)).status).toBe(200);
    expect(h.sleeps).toEqual([7250]);
  });

  it('waits on the legacy abuse-detection wording too', async () => {
    const h = harness(
      [
        { status: 403, body: '{"message":"You have triggered an abuse detection mechanism"}' },
        { status: 200 },
      ],
      10 * MIN
    );
    expect((await call(h)).status).toBe(200);
    expect(h.sleeps).toEqual([60_000]);
  });

  it('waits at least a minute on a secondary rate limit without headers', async () => {
    const h = harness(
      [
        { status: 403, body: '{"message":"You have exceeded a secondary rate limit"}' },
        { status: 200 },
      ],
      10 * MIN
    );
    expect((await call(h)).status).toBe(200);
    expect(h.sleeps).toEqual([60_000]);
  });

  it.each([401, 404, 409, 422])('returns a %i at once for the caller to refuse', async (status) => {
    const h = harness([{ status }], 10 * MIN);
    expect((await call(h)).status).toBe(status);
    expect(h.sleeps).toEqual([]);
    expect(h.calls()).toBe(1);
  });

  it('returns a 403 without a rate-limit signal at once', async () => {
    const h = harness(
      [{ status: 403, body: '{"message":"Resource not accessible by integration"}' }],
      10 * MIN
    );
    expect((await call(h)).status).toBe(403);
    expect(h.sleeps).toEqual([]);
  });

  it('never waits past the deadline, and returns the last transient answer', async () => {
    const h = harness([{ status: 503 }], 3 * MIN);
    const r = await call(h);
    expect(r.status).toBe(503);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3 * MIN);
    expect(h.sleeps.every((ms) => ms <= 60_000)).toBe(true);
  });

  it('does not wait for a reset beyond the deadline', async () => {
    const h = harness([], 0);
    const resetAt = Math.floor((h.start + 50 * MIN) / 1000);
    const g = harness(
      [
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) },
        },
      ],
      10 * MIN
    );
    expect((await call(g)).status).toBe(403);
    expect(g.sleeps).toEqual([]);
  });

  it('rethrows a network failure that outlasts the deadline', async () => {
    const h = harness([{ throws: true }], 5_000);
    await expect(call(h)).rejects.toThrow('fetch failed');
  });
});

const jsonImplementations = [
  ['provider (TypeScript)', ts.readGithubJsonWithRetry],
  ['scripts (ESM)', mjs.readGithubJsonWithRetry],
] as const;

describe.each(jsonImplementations)('%s JSON reads', (_name, readJson) => {
  const call = (h: ReturnType<typeof harness>) =>
    readJson(
      'https://api.github.com/repos/o/r/actions/runs/1',
      { headers: {} },
      h.deadline,
      h.deps
    );

  it('waits out a body truncated after the headers, then returns the parsed value', async () => {
    const h = harness(
      [
        { status: 200, body: '{"id": 1, "na' },
        { status: 200, body: '{"id": 1}' },
      ],
      10 * MIN
    );
    const r = await call(h);
    expect(r.response.status).toBe(200);
    expect(r.value).toEqual({ id: 1 });
    expect(h.sleeps).toEqual([2000]);
  });

  it('returns a refusal unread, with no value, for the caller', async () => {
    const h = harness([{ status: 404, body: 'not json' }], 10 * MIN);
    const r = await call(h);
    expect(r.response.status).toBe(404);
    expect(r.value).toBeUndefined();
    expect(h.sleeps).toEqual([]);
  });

  it('rethrows a body that stays unreadable past the deadline', async () => {
    const h = harness([{ status: 200, body: '{"broken' }], 5_000);
    await expect(call(h)).rejects.toThrow();
  });
});

describe('the two readers stay one policy', () => {
  it('share the same budgets and limits', () => {
    expect(mjs.QUALIFICATION_READ_BUDGET_MS).toEqual(ts.QUALIFICATION_READ_BUDGET_MS);
    expect(mjs.QUALIFICATION_READ_MAX_BACKOFF_MS).toBe(ts.QUALIFICATION_READ_MAX_BACKOFF_MS);
    expect(mjs.QUALIFICATION_SECONDARY_LIMIT_WAIT_MS).toBe(
      ts.QUALIFICATION_SECONDARY_LIMIT_WAIT_MS
    );
  });

  it('fit inside each job limit of the qualification workflow', () => {
    const wf = readFileSync(
      fileURLToPath(
        new URL(
          '../../../.github/workflows/horse-feature-ablation-qualification.yml',
          import.meta.url
        )
      ),
      'utf8'
    );
    const limit = (job: string) =>
      Number(new RegExp(`\\n  ${job}:[\\s\\S]*?timeout-minutes: (\\d+)`).exec(wf)![1]) * MIN;
    const b = ts.QUALIFICATION_READ_BUDGET_MS;
    expect(b.plan).toBeLessThanOrEqual(limit('plan') / 2);
    expect(b.assemble).toBeLessThanOrEqual(limit('assemble') * 0.7);
    // prepare and Execute each get the cell budget inside one cell job
    expect(2 * b.cell).toBeLessThanOrEqual(limit('cell') * 0.7);
  });

  it('leave no raw GitHub fetch on the qualification path', () => {
    for (const [file, allowed] of [
      ['./IncrementalPressureQualification.ts', 1],
      ['../../scripts/feature-ablation-assemble.mjs', 0],
      ['../../scripts/feature-ablation-artifact-custody.mjs', 0],
    ] as const) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect((source.match(/\bfetch\(/g) ?? []).length, file).toBe(allowed);
    }
  });
});
