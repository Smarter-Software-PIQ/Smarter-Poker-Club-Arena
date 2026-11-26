/**
 * LAW: an engine promise is never dropped by accident (2026-11-26).
 *
 * server/src/index.ts treats an unhandledRejection as fatal on purpose (the
 * 2026-08-15 note above `fatal`): the engine drains for a supervisor restart,
 * and every hand in flight on every table is voided. That policy is only safe
 * while no promise in the engine can be dropped without anyone deciding to.
 *
 * On 2026-11-26 a type-aware scan found 42 dropped promises and one async
 * listener handed to a caller that ignores it. Every one was safe that day
 * (broadcastCurrentState never rejects, the lifecycle fences are awaited by
 * their starters, the driver drains use allSettled, the router catches its
 * own errors), but nothing stopped the next one. Each is now marked `void`
 * or documented, and the build refuses a new one.
 *
 * This law pins the gate: the config, its two rules, the npm script and the
 * CI step that runs it whenever engine source changes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('an engine promise is never dropped by accident', () => {
  it('the engine promise config turns on both rules as errors over server/src', () => {
    const cfg = read('server/eslint.promises.config.mjs');
    expect(cfg).toMatch(/'@typescript-eslint\/no-floating-promises':\s*'error'/);
    expect(cfg).toMatch(/'@typescript-eslint\/no-misused-promises':\s*\[\s*'error'/);
    expect(cfg).toContain("files: ['src/**/*.ts']");
    expect(cfg).toContain("project: ['./tsconfig.json']");
  });

  it('the npm script runs that config from the server package', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['lint:engine-promises']).toBe(
      'cd server && eslint --no-config-lookup -c eslint.promises.config.mjs src'
    );
  });

  it('CI runs the gate with the server dependencies installed', () => {
    const ci = read('.github/workflows/ci.yml');
    const at = ci.indexOf('- name: Engine promises are never dropped by accident');
    expect(at).toBeGreaterThan(-1);
    // The step runs to the next step of the same job.
    const next = ci.indexOf('\n      - name:', at + 1);
    const step = ci.slice(at, next === -1 ? undefined : next);
    expect(step).toContain('npm ci --prefix server --ignore-scripts');
    expect(step).toContain('npm run -s lint:engine-promises');
    expect(step).not.toMatch(/continue-on-error|\|\|\s*true/);
    // Type-aware over all of server/src, it needs more than Node's default
    // 2 GB heap on the runner; without this it aborts and blocks every
    // engine pull request.
    const heap = /NODE_OPTIONS:\s*--max-old-space-size=(\d+)/.exec(step);
    expect(heap, 'the step sets its own heap').not.toBeNull();
    expect(Number(heap![1])).toBeGreaterThanOrEqual(4096);
  });

  it('the process still treats an unhandled rejection as fatal', () => {
    const index = read('server/src/index.ts');
    expect(index).toContain(
      "process.on('unhandledRejection', (err) => fatal(err, 'GameServer.Unhandled_rejection'));"
    );
  });

  it('the request listener still catches its own errors', () => {
    const router = read('server/src/router.ts');
    expect(router).toMatch(/return async \(req, res\) => \{\s*try \{\s*await route\(req, res\);/);
    expect(router).toContain("reportError(err, 'Router.Unhandled_request_error');");
  });
});
