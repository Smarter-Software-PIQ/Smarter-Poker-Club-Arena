/**
 * LAW: the pull request builds what ships (2026-11-27, release custody).
 *
 * After a merge, `engine-release-prequalification.yml` ("Compile and test the exact server tree") decides
 * whether a commit can ever be a cutover candidate. On 2026-11-27 four commits merged between 04:16 and
 * 05:07 Chicago passed the required `Server Engine` check, then failed prequalification with "heap out of
 * memory" in `npm run build`, a command the pull request never ran. Nothing was selectable at 06:30 and the
 * 07:00 cycle kept serving.
 *
 * Every command the prequalification's compile-and-test step runs (apart from installing) is therefore also
 * run by the required `Server Engine` job, from server/, with at least the same heap. A command added to the
 * prequalification without its pull-request twin fails here, so a commit cannot reach main untested by it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => parse(readFileSync(join(ROOT, p), 'utf8'));

type Step = {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  'working-directory'?: string;
};
type Job = { name?: string; steps: Step[]; defaults?: { run?: { 'working-directory'?: string } } };

const heap = (env?: Record<string, string>) =>
  Number(/--max-old-space-size=(\d+)/.exec(env?.NODE_OPTIONS ?? '')?.[1] ?? 0);

/** Commands of a run script, with shell scaffolding dropped and the shard variable's name made neutral. */
function commands(run: string): string[] {
  return run
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line !== '' && !/^(set |\[\[|if |fi$|then$|else$)/.test(line))
    .map((line) => line.replace(/\$\{?(RELEASE_TEST_SHARD|SERVER_TEST_SHARD)\}?/g, '$SHARD'));
}

const prequal = read('.github/workflows/engine-release-prequalification.yml').jobs.qualify as Job;
const qualifyStep = prequal.steps.find((s) => s.name === 'Compile and test the exact server tree')!;
const ci = read('.github/workflows/ci.yml');
const serverJob = Object.values(ci.jobs as Record<string, Job>).find((job) =>
  String(job.name ?? '').startsWith('Server Engine shard')
)!;

describe('the pull request builds what ships', () => {
  it('finds both steps', () => {
    expect(qualifyStep, 'prequalification compile step').toBeTruthy();
    expect(serverJob, 'Server Engine job').toBeTruthy();
    expect(serverJob.defaults?.run?.['working-directory']).toBe('server');
  });

  it('runs every prequalification command in the required Server Engine job, with at least its heap', () => {
    const wanted = commands(String(qualifyStep.run)).filter((c) => !/^npm ci\b/.test(c));
    expect(wanted).toContain('npm run build');
    const prequalHeap = heap(qualifyStep.env);
    expect(prequalHeap).toBeGreaterThan(0);
    for (const command of wanted) {
      const twin = serverJob.steps.find(
        (step) =>
          typeof step.run === 'string' &&
          (step['working-directory'] ?? 'server') === 'server' &&
          commands(step.run).includes(command)
      );
      expect(twin, `Server Engine does not run: ${command}`).toBeTruthy();
      if (command === 'npm run build') expect(heap(twin!.env)).toBeGreaterThanOrEqual(prequalHeap);
    }
  });

  it('the shard split is the same on both sides', () => {
    const shard = (s: string) => /--shard="\$SHARD\/(\d+)"/.exec(s)?.[1];
    const pre = commands(String(qualifyStep.run)).find((c) => c.includes('--shard='))!;
    const pr = serverJob.steps
      .flatMap((s) => commands(String(s.run ?? '')))
      .find((c) => c.includes('--shard='))!;
    expect(shard(pre)).toBe(shard(pr));
    expect(pr).toBe(pre);
  });
});
