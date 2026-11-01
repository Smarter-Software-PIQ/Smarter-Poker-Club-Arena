import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../../server/', import.meta.url));

// Resolve server/vitest.config.ts through the installed runner without starting
// test workers; source-contract selection retains this check on config edits.
function resolvedForks(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['VITEST_MAX_THREADS', 'VITEST_MIN_THREADS', 'VITEST_MAX_FORKS', 'VITEST_MIN_FORKS'])
    delete env[key];
  Object.assign(env, overrides);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createVitest } from 'vitest/node';
    const ctx = await createVitest('test', { watch: false });
    try {
      console.log(JSON.stringify({ pool: ctx.config.pool, forks: ctx.config.poolOptions?.forks ?? null }));
    } finally { await ctx.close(); }
  `], { cwd: server, env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test('server fork pool honors the existing requested thread budget', () => {
  const resolved = resolvedForks({ VITEST_MAX_THREADS: '2' });
  assert.equal(resolved.pool, 'forks');
  assert.equal(resolved.forks?.maxForks, 2);
  assert.equal(resolved.forks?.minForks, 1);
});

test('absent or invalid legacy requests preserve the server default fork budget', () => {
  const baseline = resolvedForks();
  for (const request of ['', '0', '-1', '2x', '1.5', '9007199254740992'])
    assert.deepEqual(resolvedForks({ VITEST_MAX_THREADS: request }), baseline, request);
});

test('native fork environment retains precedence over the legacy request', () => {
  const resolved = resolvedForks({ VITEST_MAX_THREADS: '2', VITEST_MAX_FORKS: '3', VITEST_MIN_FORKS: '2' });
  assert.equal(resolved.forks?.maxForks, 3);
  assert.equal(resolved.forks?.minForks, 2);
});
