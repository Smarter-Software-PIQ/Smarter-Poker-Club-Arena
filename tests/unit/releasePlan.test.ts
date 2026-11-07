/**
 * scripts/ops/release-plan.mjs against stubbed readers: no GitHub, no engine,
 * no database. Each case builds a small main history, a /health answer, a set
 * of certificates and (optionally) a schema_migrations answer, and checks the
 * verdict, its exit code and the first-parent walk.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleReleasePlan,
  decide,
  declaredWindowMigrations,
  renderMarkdown,
  EXIT_CODES,
  VERDICTS,
} from '../../scripts/ops/release-plan.mjs';

const REPO = 'owner/repo';
const API = `https://api.github.com/repos/${REPO}`;
const HEALTH = 'https://engine.example/health';
const sha = (n: number) => n.toString(16).padStart(40, '0');

type Commit = { sha: string; parent: string | null; files: string[]; subject?: string };

/** main as a first-parent chain, newest first. */
function chain(spec: Array<[number, string[]]>): Commit[] {
  return spec.map(([n, files], i) => ({
    sha: sha(n),
    parent: i + 1 < spec.length ? sha(spec[i + 1][0]) : null,
    files,
    subject: `commit ${n}`,
  }));
}

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function stubFetch(opts: {
  commits: Commit[];
  health?: unknown | 'down';
  certs?: Record<string, string>;
  statusesHttp?: number;
  runs?: unknown[];
  calls?: string[];
}) {
  const byid = new Map(opts.commits.map((c) => [c.sha, c]));
  const index = (s: string) => opts.commits.findIndex((c) => c.sha === s);
  return async (url: string) => {
    opts.calls?.push(url);
    if (url === HEALTH) {
      if (opts.health === 'down') return json({}, 503);
      return json(opts.health ?? {});
    }
    if (url === `${API}/branches/main`) return json({ commit: { sha: opts.commits[0].sha } });
    let m = /\/commits\?sha=([0-9a-f]{40})/.exec(url);
    if (m) {
      const from = index(m[1]);
      return json(
        opts.commits.slice(from).map((c) => ({
          sha: c.sha,
          parents: c.parent ? [{ sha: c.parent }] : [],
          commit: { message: c.subject, committer: { date: '2026-11-07T00:00:00Z' } },
        }))
      );
    }
    m = /\/commits\/([0-9a-f]{40})\/statuses/.exec(url);
    if (m) {
      if (opts.statusesHttp) return json({ message: 'forbidden' }, opts.statusesHttp);
      const state = opts.certs?.[m[1]];
      return json(
        state
          ? [
              { context: 'other/check', state: 'success' },
              { context: 'backup-engine/certified', state, updated_at: '2026-11-07T01:00:00Z' },
            ]
          : [{ context: 'other/check', state: 'success' }]
      );
    }
    m = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})/.exec(url);
    if (m) {
      const [base, head] = [index(m[1]), index(m[2])];
      if (base === -1)
        return json({ status: 'diverged', ahead_by: 0, behind_by: 0, commits: [], files: [] });
      const between = opts.commits.slice(head, base); // newest..oldest, excluding base
      const files = [...new Set(between.flatMap((c) => c.files))].map((filename) => ({ filename }));
      return json({
        status: between.length === 0 ? 'identical' : 'ahead',
        ahead_by: between.length,
        behind_by: 0,
        commits: [...between]
          .reverse()
          .map((c) => ({ sha: c.sha, commit: { message: c.subject } })),
        files,
      });
    }
    m = /\/commits\/([0-9a-f]{40})$/.exec(url);
    if (m) {
      const c = byid.get(m[1])!;
      return json({ sha: c.sha, files: c.files.map((filename) => ({ filename })) });
    }
    if (/\/actions\/workflows\/backup-engine\.yml\/runs/.test(url))
      return json({ workflow_runs: opts.runs ?? [] });
    throw new Error(`unexpected GET ${url}`);
  };
}

function health(releaseSha: string) {
  return {
    releaseSha,
    version: '1.2.3',
    instanceId: 'engine-01-abc',
    status: 'ok',
    maintenance: { phase: 'idle', schedule: { mode: 'daily', hour: 4 }, readyForRestart: false },
    handsInFlightTotal: 12,
    humansSeatedTotal: 3,
  };
}

const pgWith = (rows: Array<{ version: string; name: string }>) => async () => ({
  connect: async () => {},
  query: async () => ({ rows }),
  end: async () => {},
});

const GOOD_WINDOW = [
  '-- @install-window: daily-maintenance',
  'BEGIN;',
  "SET LOCAL lock_timeout = '1s';",
  'ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS plan_probe text;',
  'COMMIT;',
  '',
].join('\n');
const BAD_WINDOW = [
  '-- @install-window: daily-maintenance',
  'BEGIN;',
  'SELECT pg_sleep(2);',
  'ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS plan_probe text;',
  'COMMIT;',
  '',
].join('\n');

function migrationsDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'release-plan-migrations-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

const base = (over: Record<string, unknown> = {}) => ({
  repo: REPO,
  token: 't',
  healthUrl: HEALTH,
  migrationsDir: migrationsDir({}),
  databaseUrl: 'postgres://u:p@db.example:5432/postgres?sslmode=require',
  createPgClient: pgWith([]),
  now: () => new Date('2026-11-07T20:00:00-06:00'),
  ...over,
});

describe('release-plan: the first-parent walk and the certified candidate', () => {
  // main: 5 (docs) -> 4 (server, cert failure) -> 3 (server, cert success) -> 2 (server, cert success) -> 1 (serving)
  const commits = chain([
    [5, ['docs/x.md']],
    [4, ['server/src/GameServer.ts']],
    [3, ['server/src/HandController.ts']],
    [2, ['server/src/Other.ts']],
    [1, ['server/src/Old.ts']],
  ]);

  it('READY: picks the newest certified commit newer than production and reports every commit walked', async () => {
    const dir = migrationsDir({ '20261107000000_window_probe.sql': GOOD_WINDOW });
    const plan = await assembleReleasePlan(
      base({
        migrationsDir: dir,
        fetch: stubFetch({
          commits,
          health: health(sha(1)),
          certs: {
            [sha(4)]: 'failure',
            [sha(3)]: 'success',
            [sha(2)]: 'success',
            [sha(1)]: 'success',
          },
        }),
      })
    );
    rmSync(dir, { recursive: true, force: true });
    expect(plan.decision.verdict).toBe(VERDICTS.READY);
    expect(plan.decision.exitCode).toBe(0);
    expect(plan.decision.candidate).toBe(sha(3));
    expect(plan.walk.walked.map((w: any) => [w.sha, w.certified])).toEqual([
      [sha(5), 'missing'],
      [sha(4), 'failure'],
      [sha(3), 'success'],
    ]);
    expect(plan.engineCommitsSinceServing.map((c: any) => c.sha)).toEqual([sha(2), sha(3), sha(4)]);
    expect(plan.queue.queued.map((q: any) => q.file)).toEqual(['20261107000000_window_probe.sql']);
    expect(renderMarkdown(plan)).toContain('### Evening release plan: READY');
  });

  it('NOTHING_OWED: production serves the newest engine code even when later docs commits exist', async () => {
    const servingNewest = chain([
      [5, ['docs/x.md']],
      [4, ['src/pages/Home.tsx']],
      [3, ['server/src/HandController.ts']],
    ]);
    const plan = await assembleReleasePlan(
      base({
        fetch: stubFetch({
          commits: servingNewest,
          health: health(sha(3)),
          certs: { [sha(3)]: 'success' },
        }),
      })
    );
    expect(plan.decision.verdict).toBe(VERDICTS.NOTHING_OWED);
    expect(plan.decision.exitCode).toBe(0);
    expect(plan.decision.engineOwed).toBe(false);
    expect(plan.walk.reachedServing).toBe(true);
  });

  it('NOTHING_OWED: serving the main tip itself', async () => {
    const plan = await assembleReleasePlan(
      base({
        fetch: stubFetch({ commits, health: health(sha(5)), certs: { [sha(5)]: 'success' } }),
      })
    );
    expect(plan.decision.verdict).toBe(VERDICTS.NOTHING_OWED);
    expect(plan.sinceServing.status).toBe('identical');
  });

  it('NOT_READY: engine commits since production, but nothing newer than it is certified', async () => {
    const plan = await assembleReleasePlan(
      base({
        fetch: stubFetch({
          commits,
          health: health(sha(1)),
          certs: { [sha(4)]: 'failure', [sha(3)]: 'pending', [sha(1)]: 'success' },
        }),
      })
    );
    expect(plan.decision.verdict).toBe(VERDICTS.NOT_READY);
    expect(plan.decision.exitCode).toBe(1);
    expect(plan.decision.candidate).toBeNull();
    expect(plan.walk.walked.at(-1).isServing).toBe(true);
    expect(plan.decision.blockers[0]).toMatch(/none newer than it is Backup-certified/);
  });

  it('NOT_READY: a certified candidate that carries no engine change over production is not a cutover', async () => {
    // 5 (server, uncertified) -> 4 (docs, certified) -> 1 (serving)
    const docsCertified = chain([
      [5, ['server/src/GameServer.ts']],
      [4, ['docs/x.md']],
      [1, ['server/src/Old.ts']],
    ]);
    const plan = await assembleReleasePlan(
      base({
        fetch: stubFetch({
          commits: docsCertified,
          health: health(sha(1)),
          certs: { [sha(4)]: 'success' },
        }),
      })
    );
    expect(plan.decision.verdict).toBe(VERDICTS.NOT_READY);
    expect(plan.decision.blockers[0]).toMatch(/carries no server\/\*\* change/);
  });

  it('NOT_READY: a queued window migration that the static rules refuse, even with a certified candidate', async () => {
    const dir = migrationsDir({ '20261107000001_sleeps.sql': BAD_WINDOW });
    const plan = await assembleReleasePlan(
      base({
        migrationsDir: dir,
        fetch: stubFetch({ commits, health: health(sha(1)), certs: { [sha(3)]: 'success' } }),
      })
    );
    rmSync(dir, { recursive: true, force: true });
    expect(plan.decision.verdict).toBe(VERDICTS.NOT_READY);
    expect(plan.decision.exitCode).toBe(1);
    expect(plan.decision.blockers[0]).toMatch(/20261107000001_sleeps\.sql.*never sleeps/);
  });

  it('a window migration already in schema_migrations is recorded, not queued', async () => {
    const dir = migrationsDir({ '20261107000000_window_probe.sql': GOOD_WINDOW });
    const plan = await assembleReleasePlan(
      base({
        migrationsDir: dir,
        createPgClient: pgWith([{ version: '20261107000000', name: 'window_probe' }]),
        fetch: stubFetch({ commits, health: health(sha(1)), certs: { [sha(3)]: 'success' } }),
      })
    );
    rmSync(dir, { recursive: true, force: true });
    expect(plan.queue.queued).toEqual([]);
    expect(plan.queue.recorded).toEqual(['20261107000000_window_probe.sql']);
    expect(plan.decision.verdict).toBe(VERDICTS.READY);
  });
});

describe('release-plan: UNKNOWN is its own outcome (CLAUDE.md 10.86)', () => {
  const commits = chain([
    [3, ['server/src/HandController.ts']],
    [1, ['server/src/Old.ts']],
  ]);

  it('statuses refused with 403: the certificate walk is UNKNOWN, never "missing"', async () => {
    const plan = await assembleReleasePlan(
      base({ fetch: stubFetch({ commits, health: health(sha(1)), statusesHttp: 403 }) })
    );
    expect(plan.decision.verdict).toBe(VERDICTS.UNKNOWN);
    expect(plan.decision.exitCode).toBe(3);
    expect(plan.walk.state).toBe('UNKNOWN');
    expect(plan.walk.reason).toMatch(/HTTP 403/);
    expect(plan.decision.blockers).toEqual([]);
  });

  it('DATABASE_URL unset with a declared window file: the queue is UNKNOWN, not "0 queued"', async () => {
    const dir = migrationsDir({ '20261107000000_window_probe.sql': GOOD_WINDOW });
    const plan = await assembleReleasePlan(
      base({
        migrationsDir: dir,
        databaseUrl: '',
        fetch: stubFetch({ commits, health: health(sha(1)), certs: { [sha(3)]: 'success' } }),
      })
    );
    rmSync(dir, { recursive: true, force: true });
    expect(plan.queue.state).toBe('UNKNOWN');
    expect(plan.queue.reason).toMatch(/DATABASE_URL is not set/);
    expect(plan.decision.verdict).toBe(VERDICTS.UNKNOWN);
    expect(plan.decision.exitCode).toBe(3);
  });

  it('DATABASE_URL unset with nothing declared needs no database and can still be READY', async () => {
    const plan = await assembleReleasePlan(
      base({
        databaseUrl: '',
        fetch: stubFetch({ commits, health: health(sha(1)), certs: { [sha(3)]: 'success' } }),
      })
    );
    expect(plan.queue.state).toBe('read');
    expect(plan.decision.verdict).toBe(VERDICTS.READY);
  });

  it('/health unreadable: UNKNOWN, with the main tip and walk still reported', async () => {
    const plan = await assembleReleasePlan(
      base({ fetch: stubFetch({ commits, health: 'down', certs: { [sha(3)]: 'success' } }) })
    );
    expect(plan.production.state).toBe('UNKNOWN');
    expect(plan.decision.verdict).toBe(VERDICTS.UNKNOWN);
    expect(plan.mainTip.sha).toBe(sha(3));
  });

  it('a served SHA outside main history is UNKNOWN, not owed and not current', async () => {
    const plan = await assembleReleasePlan(
      base({
        fetch: stubFetch({ commits, health: health(sha(99)), certs: { [sha(3)]: 'success' } }),
      })
    );
    expect(plan.decision.verdict).toBe(VERDICTS.UNKNOWN);
    expect(plan.decision.unknowns.join('\n')).toMatch(/not an ancestor of main/);
  });

  it('a definitive blocker outranks an unreadable source', () => {
    const decision = decide({
      production: { state: 'read', releaseSha: sha(1) },
      mainTip: { state: 'read', sha: sha(3) },
      walk: { state: 'UNKNOWN', reason: 'HTTP 403', walked: [], candidate: null },
      sinceServing: null,
      candidateDiff: null,
      backupLane: { state: 'read' },
      declared: [{ file: '20261107000001_sleeps.sql', valid: false, refusal: 'never sleeps' }],
      queue: { state: 'UNKNOWN', reason: 'DATABASE_URL is not set' },
    });
    expect(decision.verdict).toBe(VERDICTS.NOT_READY);
    expect(decision.unknowns.length).toBeGreaterThan(0);
  });
});

describe('release-plan: exit codes and static helpers', () => {
  it('three distinct exit codes, UNKNOWN never shares one with a green verdict', () => {
    expect(EXIT_CODES).toEqual({ READY: 0, NOTHING_OWED: 0, NOT_READY: 1, UNKNOWN: 3 });
  });

  it('declaredWindowMigrations validates each declared file statically and honours SUPERSEDED BY', () => {
    const dir = migrationsDir({
      '20261107000000_good.sql': GOOD_WINDOW,
      '20261107000001_bad.sql': BAD_WINDOW,
      '20261107000002_old.sql': `-- SUPERSEDED BY 20261107000000\n${GOOD_WINDOW}`,
      '20261107000003_ordinary.sql': 'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    });
    const declared = declaredWindowMigrations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(declared.map((d) => [d.file, d.valid, d.superseded])).toEqual([
      ['20261107000000_good.sql', true, null],
      ['20261107000001_bad.sql', false, null],
      ['20261107000002_old.sql', null, '20261107000000'],
    ]);
  });
});
