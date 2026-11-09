/**
 * A SPARSE CHECKOUT HOLDS WHAT ITS SCRIPTS LOAD (2026-11-09).
 *
 * #10114 taught server/scripts/engine-release-installed-migrations.py to load
 * server/standby/schema-evidence.py from the working tree. The Stage
 * `selection` job runs scripts/ci/select-daily-engine.py, which loads that
 * helper, from a sparse checkout of only `scripts/ci` and `server/scripts`.
 * The Nov 9 daily selection (Stage run 42562159686, control 41d47195) froze
 * `blocked` because the file was not on disk. Every test passed: each test
 * runs from a full checkout, where every file is present.
 *
 * This law reads every job that sparse-checks-out this repository, finds the
 * tracked scripts its `run` steps execute, follows what those scripts load
 * from the working tree (Python spec_from_file_location / runpy / with_name /
 * parents[N] / sys.executable subprocess; ESM relative imports), and asks
 * `git sparse-checkout check-rules` (git's own matcher, in the job's cone or
 * non-cone mode) whether each file is in that job's checkout.
 *
 * A file read through `git show <sha>:<path>` is read from git objects, not the
 * working tree, and is not a load. An exception names one file a script could
 * load only from a subcommand the job never runs; it must still be reachable
 * and still absent, so a stale exception fails too.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const WF = join(ROOT, '.github/workflows');
const SCRIPT = String.raw`[\w./-]+\.(?:py|mjs|js|cjs|sh)`;

/** workflow:job:file -> why the job never reaches the loader of `file`. */
const EXCEPTIONS: Record<string, string> = {
  'stage-engine-release.yml:detect:server/scripts/engine-release-activation-floor.py':
    'detect runs engine-release-seal.py only as `schedule-policy` and `restoration-needed`; ' +
    'the seal loads the activation-floor helper only from its certified-recovery and Nov 7 reservation commands.',
};

const tracked = (p: string) => !p.startsWith('/') && !p.includes('$') && existsSync(join(ROOT, p));
const norm = (p: string) => posix.normalize(p.replace(/^\.\//, ''));

/** Tracked scripts a shell or inline-Python step executes from the working tree. */
function executed(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    new RegExp(
      String.raw`(?:^|[\s;&|(])(?:python3?|node|bash|sh)(?:\s+-{1,2}[\w-]+)*\s+["']?((?:\./)?${SCRIPT})`,
      'gm'
    ),
    new RegExp(
      String.raw`spec_from_file_location\(\s*["'][^"']*["']\s*,\s*["']((?:\./)?${SCRIPT})["']`,
      'g'
    ),
    new RegExp(String.raw`run_path\(\s*["']((?:\./)?${SCRIPT})["']`, 'g'),
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.add(norm(m[1]));
  return [...out].filter(tracked);
}

/** Files one script loads from the working tree. */
function loads(file: string): string[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const dir = posix.dirname(file);
  const out = new Set<string>();
  if (file.endsWith('.py')) {
    for (const m of text.matchAll(/parents\[(\d+)\]\s*\/\s*["']([\w./-]+)["']/g)) {
      let base = file;
      for (let i = 0; i <= Number(m[1]); i++) base = posix.dirname(base);
      out.add(norm(posix.join(base === '.' ? '' : base, m[2])));
    }
    for (const m of text.matchAll(/with_name\(\s*["']([\w.-]+)["']\s*\)/g))
      out.add(norm(posix.join(dir, m[1])));
    for (const m of text.matchAll(
      new RegExp(String.raw`sys\.executable\s*,\s*["']-B["']\s*,\s*["'](${SCRIPT})["']`, 'g')
    ))
      out.add(norm(m[1]));
    for (const m of text.matchAll(
      new RegExp(
        String.raw`spec_from_file_location\(\s*["'][^"']*["']\s*,\s*["'](${SCRIPT})["']`,
        'g'
      )
    ))
      out.add(norm(m[1]));
  } else if (file.endsWith('.sh')) {
    for (const f of executed(text)) out.add(f);
  } else {
    for (const m of text.matchAll(
      /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm
    ))
      out.add(norm(posix.join(dir, m[1])));
  }
  return [...out].filter(tracked);
}

function closure(roots: string[]): string[] {
  const seen = new Set<string>();
  const todo = [...roots];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...loads(f));
  }
  return [...seen].sort();
}

/** Files git would NOT place in a checkout with these sparse rules. */
function absent(rules: string, cone: boolean, files: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'ca-sparse-rules-'));
  try {
    const rulesFile = join(dir, 'rules');
    writeFileSync(
      rulesFile,
      rules
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .join('\n') + '\n'
    );
    const inside = execFileSync(
      'git',
      ['sparse-checkout', 'check-rules', cone ? '--cone' : '--no-cone', '--rules-file', rulesFile],
      { cwd: ROOT, input: files.join('\n') + '\n', encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean);
    return files.filter((f) => !inside.includes(f));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Job = { workflow: string; job: string; rules: string; cone: boolean; roots: string[] };

function sparseJobs(): Job[] {
  const jobs: Job[] = [];
  for (const workflow of readdirSync(WF)
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()) {
    const doc = parse(readFileSync(join(WF, workflow), 'utf8')) ?? {};
    for (const [job, body] of Object.entries<any>(doc.jobs ?? {})) {
      const steps: any[] = body?.steps ?? [];
      const checkouts = steps.filter(
        (s) => /actions\/checkout/.test(s?.uses ?? '') && !s.with?.repository && !s.with?.path
      );
      const sparse = checkouts.find((s) => s.with?.['sparse-checkout']);
      if (!sparse) continue;
      const roots = new Set<string>();
      for (const s of steps) for (const f of executed(String(s?.run ?? ''))) roots.add(f);
      jobs.push({
        workflow,
        job,
        rules: String(sparse.with['sparse-checkout']),
        cone: sparse.with['sparse-checkout-cone-mode'] !== false,
        roots: [...roots].sort(),
      });
    }
  }
  return jobs;
}

const JOBS = sparseJobs();

describe('a sparse checkout holds what its scripts load', () => {
  it('finds the release-control sparse jobs, and each runs at least one tracked script', () => {
    const names = JOBS.map((j) => `${j.workflow}:${j.job}`);
    for (const required of [
      'stage-engine-release.yml:selection',
      'stage-engine-release.yml:detect',
      'backup-engine.yml:plan',
      'backup-engine.yml:refresh',
      'backup-engine.yml:certify',
    ])
      expect(names).toContain(required);
    const selection = JOBS.find(
      (j) => j.job === 'selection' && j.workflow === 'stage-engine-release.yml'
    )!;
    expect(closure(selection.roots)).toEqual(
      expect.arrayContaining([
        'scripts/ci/select-daily-engine.py',
        'server/scripts/engine-release-installed-migrations.py',
        'server/standby/schema-evidence.py',
      ])
    );
  });

  it.each(JOBS.map((j) => [`${j.workflow}:${j.job}`, j] as const))('%s', (_, j) => {
    const files = closure(j.roots);
    const missing = absent(j.rules, j.cone, files);
    const unexplained = missing.filter((f) => !EXCEPTIONS[`${j.workflow}:${j.job}:${f}`]);
    expect(
      unexplained,
      `${j.workflow}:${j.job} runs code that loads files its sparse checkout omits`
    ).toEqual([]);
  });

  it('every exception is still reachable and still absent', () => {
    for (const key of Object.keys(EXCEPTIONS)) {
      const [workflow, job, file] = key.split(':');
      const j = JOBS.find((x) => x.workflow === workflow && x.job === job);
      expect(j, key).toBeDefined();
      expect(closure(j!.roots), key).toContain(file);
      expect(absent(j!.rules, j!.cone, [file]), key).toEqual([file]);
    }
  });
});
