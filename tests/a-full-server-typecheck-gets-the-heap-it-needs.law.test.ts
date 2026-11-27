/**
 * LAW: a full server typecheck gets the heap it needs (2026-11-26, Horse SWITCH lane).
 *
 * A TypeScript program over all of server/src now peaks near Node's default heap on the hosted runner. #12130
 * gave the type-aware engine promise lint 6 GB after it aborted with "heap out of memory". The opponent-memory
 * typecheck in the accounting shard compiles the same program and was missed: from 2026-11-27 00:38Z it aborted
 * the same way on most runs (exit 134), failing PRs that never touched the server. The server shards' own
 * typecheck compiles it too and was next.
 *
 * Every workflow step that runs `tsc` from server/ on a tsconfig whose program includes src/**\/* therefore
 * carries NODE_OPTIONS --max-old-space-size of at least 6144 (step, job or workflow env). A new step of that
 * shape cannot ship without it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const WF = join(ROOT, '.github', 'workflows');
const MIN_HEAP_MB = 6144;

type Step = {
  name?: string;
  run?: unknown;
  env?: Record<string, string>;
  'working-directory'?: string;
};
type Job = {
  steps?: Step[];
  env?: Record<string, string>;
  defaults?: { run?: { 'working-directory'?: string } };
};

/** The include list of a server tsconfig, following `extends` within server/. */
function includes(tsconfig: string): string[] {
  const doc = JSON.parse(readFileSync(join(ROOT, 'server', tsconfig), 'utf8')) as {
    include?: string[];
    extends?: string;
  };
  if (doc.include) return doc.include;
  if (doc.extends && doc.extends.startsWith('./')) return includes(doc.extends.slice(2));
  return [];
}

function heapOf(...envs: Array<Record<string, string> | undefined>): number {
  for (const env of envs) {
    const m = /--max-old-space-size=(\d+)/.exec(String(env?.NODE_OPTIONS ?? ''));
    if (m) return Number(m[1]);
  }
  return 0;
}

const found: Array<{ where: string; heap: number }> = [];
for (const f of readdirSync(WF).filter((x) => /\.ya?ml$/.test(x))) {
  const doc = parse(readFileSync(join(WF, f), 'utf8')) as {
    env?: Record<string, string>;
    jobs?: Record<string, Job>;
  };
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== 'string') continue;
      const wd = step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? '.';
      if (wd !== 'server') continue;
      for (const line of step.run.split('\n')) {
        if (!/(?:^|\s)(?:npx\s+)?tsc(?:\s|$)/.test(line)) continue;
        const project = /(?:-p|--project)\s+(\S+)/.exec(line)?.[1] ?? 'tsconfig.json';
        if (!includes(project).includes('src/**/*')) continue;
        found.push({
          where: `${f} ${jobName} "${step.name ?? '(unnamed)'}" (${project})`,
          heap: heapOf(step.env, job.env, doc.env),
        });
      }
    }
  }
}

describe('a full server typecheck gets the heap it needs', () => {
  it('finds the full server typechecks it guards', () => {
    expect(found.map((x) => x.where).join('\n')).toContain('tsconfig.opponent-memory.json');
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  for (const { where, heap } of found) {
    it(`${where} runs with at least ${MIN_HEAP_MB} MB of heap`, () => {
      expect(heap, where).toBeGreaterThanOrEqual(MIN_HEAP_MB);
    });
  }
});
