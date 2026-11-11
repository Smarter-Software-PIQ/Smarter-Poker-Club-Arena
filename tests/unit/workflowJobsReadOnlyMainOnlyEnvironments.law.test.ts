/**
 * SECRETS LIVE IN MAIN-ONLY ENVIRONMENTS (owner authorization 2026-11-11).
 *
 * A merge-group run executes the workflow files of the queued commit, which can
 * come from a fork pull request, with access to every REPOSITORY-scoped secret.
 * So no secret stays at repository scope: each job that reads one names an
 * environment whose deployment branch rule a merge-group ref
 * (refs/heads/gh-readonly-queue/main/...) can never match: `ci-main` (main
 * only), `ci-pull-request` (refs/pull/<n>/merge only), or one of the two
 * existing signing environments. A new job that reads a secret without one is
 * refused here, before it can re-open the hole.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), '.github', 'workflows');
const ALLOWED = new Set([
  'ci-main',
  'ci-pull-request',
  'HorseCorrectiveQualification',
  'money-trigger-recovery-trusted',
]);
// The one-shot mover reads repository scope by design; it is deleted once the
// repository-level copies are removed.
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
  for (const file of files) {
    if (file === MOVER) continue;
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
