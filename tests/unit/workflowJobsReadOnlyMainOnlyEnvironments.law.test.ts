/**
 * SECRETS LIVE IN MAIN-ONLY ENVIRONMENTS (owner authorization 2026-11-11).
 *
 * A merge-group run executes the workflow files of the queued commit, which can
 * come from a fork pull request, with access to every REPOSITORY-scoped secret.
 * So no secret stays at repository scope: each job that reads one names an
 * environment whose deployment branch rule a merge-group ref
 * (refs/heads/gh-readonly-queue/main/...) can never match: `ci-main` (main
 * only) or one of the two existing signing environments. The retired
 * `ci-pull-request` environment was deleted with its secrets. A new job that reads a secret without one is
 * refused here, before it can re-open the hole.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), '.github', 'workflows');
const ALLOWED = new Set([
  'ci-main',
  'github-app-main',
  'HorseCorrectiveQualification',
  'money-trigger-recovery-trusted',
]);
// The GitHub App key is read only from github-app-main (or the Money trigger
// signing environment), never from ci-main, whose ~100 jobs do not need it.
// No job reads the App key from ci-main: it lives only in github-app-main and
// money-trigger-recovery-trusted. The one-shot move-github-app-key.yml that
// carried it across was deleted after the move (2026-11-11) and may not return.
const APP_KEY = 'AUTOPILOT_APP_PRIVATE_KEY';
const APP_KEY_MOVER = 'move-github-app-key.yml';
// The one-shot mover that copied repository scope into these environments was
// deleted with the repository-level copies (2026-11-11); none may come back.
const MOVER = 'copy-repository-secrets-to-environments.yml';

type Job = { environment?: unknown; uses?: string; secrets?: unknown };
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

function secretNames(node: unknown): string[] {
  const text = JSON.stringify(node ?? '');
  return [...new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].filter(
    (n) => n !== 'GITHUB_TOKEN'
  );
}

function envNames(env: unknown): string[] {
  const raw = typeof env === 'object' && env ? (env as { name?: unknown }).name : env;
  const text = String(raw ?? '');
  // In an expression only the values chosen by && / || are environment names.
  const chosen = [...text.matchAll(/(?:&&|\|\|)\s*'([^']*)'/g)].map((m) => m[1]);
  return text.startsWith('${{') ? chosen.filter(Boolean) : [text];
}

describe('every secret-reading job names a main-only environment', () => {
  it('the one-shot mover is gone', () => {
    expect(files).not.toContain(MOVER);
    expect(files).not.toContain(APP_KEY_MOVER);
  });
  for (const file of files) {
    const wf = parse(readFileSync(join(DIR, file), 'utf8')) as {
      on?: unknown;
      jobs?: Record<string, Job>;
    };
    for (const [name, job] of Object.entries(wf?.jobs ?? {})) {
      if (job.uses) continue; // a caller cannot name an environment; its callee does
      const used = secretNames(job);
      if (used.length === 0) continue;
      it(`${file}:${name} reads ${used.join(',')} only through an allowed environment`, () => {
        const envs = envNames(job.environment);
        expect(envs.length, 'job reads a secret with no environment').toBeGreaterThan(0);
        for (const e of envs) expect(ALLOWED.has(e), `environment ${e}`).toBe(true);
      });
    }
  }
});

describe('only the jobs that mint an App token can read the App key', () => {
  for (const file of files) {
    const wf = parse(readFileSync(join(DIR, file), 'utf8')) as { jobs?: Record<string, Job> };
    for (const [name, job] of Object.entries(wf?.jobs ?? {})) {
      const reads = secretNames(job).includes(APP_KEY);
      const envs = envNames(job.environment);
      if (envs.includes('github-app-main')) {
        it(`${file}:${name} names github-app-main because it mints an App token`, () => {
          expect(reads).toBe(true);
          expect(JSON.stringify(job)).toContain('actions/create-github-app-token');
        });
      }
      if (!reads) continue;
      it(`${file}:${name} reads the App key outside ci-main`, () => {
        expect(envs.length).toBe(1);
        expect(['github-app-main', 'money-trigger-recovery-trusted']).toContain(envs[0]);
      });
    }
  }
});

describe('nothing a merge group runs can read a secret', () => {
  for (const file of files) {
    const wf = parse(readFileSync(join(DIR, file), 'utf8')) as {
      on?: Record<string, unknown> | string | string[];
      jobs?: Record<string, Job>;
    };
    const on = wf?.on ?? {};
    const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on);
    if (!triggers.includes('merge_group')) continue;
    it(`${file} passes no secret into a merge-group job`, () => {
      for (const job of Object.values(wf.jobs ?? {})) {
        expect(job.secrets === 'inherit', 'secrets: inherit').toBe(false);
        if (job.uses) continue;
        const env = envNames(job.environment);
        // A merge-group job may name an environment only conditionally, and
        // never one that a queue ref could deploy to.
        for (const e of env) expect(e === '' || ALLOWED.has(e)).toBe(true);
      }
    });
  }
});

// No pull-request code may run beside a credential (2026-11-11). The two jobs
// that read the live catalog for a pull request run MAIN's workflow and script
// under pull_request_target with ci-main, reading the pull request as data.
// ci-pull-request is retired (2026-11-11): the environment and its secrets are
// deleted, and no job may name it again.
describe('no job names the retired ci-pull-request environment', () => {
  for (const file of files) {
    it(`${file} does not name ci-pull-request`, () => {
      expect(readFileSync(join(DIR, file), 'utf8')).not.toContain('ci-pull-request');
    });
  }
});

describe('the live-catalog pull-request checks run only trusted code', () => {
  for (const file of ['pr-engine-doors.yml', 'settlement-lane-doctrine.yml']) {
    it(`${file} runs main's workflow and checkout under pull_request_target`, () => {
      const text = readFileSync(join(DIR, file), 'utf8');
      const wf = parse(text) as { on?: Record<string, unknown> };
      expect(Object.keys(wf.on ?? {})).toContain('pull_request_target');
      expect(Object.keys(wf.on ?? {})).not.toContain('pull_request');
      expect(text).toContain('ref: ${{ github.event.repository.default_branch }}');
      expect(text).toContain('persist-credentials: false');
      expect(text).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request/);
      expect(text).not.toContain('ci-pull-request');
    });
  }
  it("pr-engine-doors reads the merge result as data, without symlinks, and runs main's script", () => {
    const text = readFileSync(join(DIR, 'pr-engine-doors.yml'), 'utf8');
    expect(text).toContain('git -C trusted archive refs/remotes/pr/merge');
    expect(text).toContain('find pr -type l -delete');
    expect(text).toContain('node ../trusted/scripts/ci/check-pr-engine-doors.mjs');
    expect(text).not.toContain('cache: npm');
  });
  it('pr-engine-doors runs only for same-repository pull requests and installs the locked pg', () => {
    const text = readFileSync(join(DIR, 'pr-engine-doors.yml'), 'utf8');
    const wf = parse(text) as { jobs: Record<string, { if?: string }> };
    expect(String(wf.jobs.doors.if)).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { version: string }>;
    };
    expect(text).toContain(`npm i pg@${lock.packages['node_modules/pg'].version} `);
    expect(text).not.toMatch(/npm i pg@8 /);
  });
});
