/**
 * LAW: server/Dockerfile builds and loads its native hist215 addon on every
 * server-touching pull request (shift-left Docker & native smoke check).
 *
 * Ensures a Dockerfile, native N-API (`public_hist215_wtl.cc` /
 * `legacy-census.cc`), or compiled runtime packaging defect is caught before
 * merge instead of failing post-merge during Engine release prequalification.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

describe('server/Dockerfile shift-left build and hist215 native smoke check', () => {
  it('exists as a valid shell script with offline container smoke assertions', () => {
    const scriptPath = join(ROOT, 'scripts/ci/server-dockerfile-smoke.sh');
    expect(existsSync(scriptPath)).toBe(true);
    const bashCheck = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
    expect(bashCheck.status, bashCheck.stderr).toBe(0);
    const src = readFileSync(scriptPath, 'utf8');
    expect(src).toContain('--network=none');
    expect(src).toContain('public_hist215_wtl.node');
    expect(src).toContain('exactRootWTL');
    expect(src).toContain('legacy-census.node');
    expect(src).toContain('server/Dockerfile');
    expect(src).toContain('--cache-from');
    expect(src).toContain('--cache-to');
  });

  it('runs on server-touching PRs in ci.yml with fail-closed server aggregate gating', () => {
    const ci = parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
    const job = ci.jobs.server_dockerfile_smoke;
    expect(job, 'server_dockerfile_smoke job missing from ci.yml').toBeTruthy();
    expect(job.needs).toBe('changes');
    expect(job['continue-on-error']).toBeUndefined();
    expect(job.if).toContain('!cancelled()');
    expect(job.if).toContain("needs.changes.outputs.head_current != 'false'");
    expect(job.if).toContain("needs.changes.result != 'success'");
    expect(job.if).toContain("needs.changes.outputs.server == 'true'");
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(10);

    const smokeStep = job.steps.find(
      (s: { run?: string }) =>
        typeof s.run === 'string' && s.run.includes('bash scripts/ci/server-dockerfile-smoke.sh')
    );
    expect(smokeStep, 'server-dockerfile-smoke.sh step missing').toBeTruthy();
    expect(smokeStep['continue-on-error']).toBeUndefined();

    // Required Server Engine rollup must depend on server_dockerfile_smoke and fail closed.
    expect(ci.jobs.server.needs).toContain('server_dockerfile_smoke');
    const gate = ci.jobs.server.steps.find(
      (s: { env?: Record<string, string> }) =>
        s.env?.DOCKER_SMOKE_RESULT === '${{ needs.server_dockerfile_smoke.result }}'
    );
    expect(gate, 'server aggregate gate for server_dockerfile_smoke missing').toBeTruthy();
    expect(gate.run).toContain('exit 1');
  });
});
