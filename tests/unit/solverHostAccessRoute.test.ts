import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const script = join(root, 'operations/ops-mac/solver-host.sh');

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: '',
  });
}

describe('solver PCs have one access route', () => {
  it('refuses a run without arguments as bad usage', () => {
    expect(run([]).status).toBe(2);
  });

  it('refuses a missing controller key before touching the network', () => {
    const r = run(['check'], { SOLVER_HOST_KEY: '/nonexistent/key' });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('controller key not found');
  });

  it('refuses missing pinned host keys', () => {
    const r = run(['check'], {
      SOLVER_HOST_KEY: script,
      SOLVER_HOST_KNOWN_HOSTS: '/nonexistent/pins',
    });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('pinned host keys not found');
  });

  it('pins host keys strictly and connects through root', () => {
    const text = readFileSync(script, 'utf8');
    expect(text).toContain('StrictHostKeyChecking=yes');
    expect(text).toContain('BatchMode=yes');
    expect(text).toMatch(/sudo -n ssh/);
    expect(text).not.toMatch(/StrictHostKeyChecking=no/);
  });

  it('is installed by setup and documented as the only reachability reading', () => {
    expect(readFileSync(join(root, 'operations/ops-mac/setup.sh'), 'utf8')).toContain(
      'solver-host.sh'
    );
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'operations/ops-mac/README.md']) {
      expect(readFileSync(join(root, f), 'utf8')).toContain('solver-host.sh');
    }
  });
});
