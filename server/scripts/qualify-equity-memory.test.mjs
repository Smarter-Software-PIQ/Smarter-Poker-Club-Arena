import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const sourceUrl = new URL('./qualify-equity-memory.mjs', import.meta.url);
const require = createRequire(import.meta.url);

test(
  'one refused calculation preserves evidence and fails the actual qualification CLI',
  { timeout: 45000 },
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'equity-qualification-refusal-'));
    try {
      let source = readFileSync(sourceUrl, 'utf8');
      const anchor = '  await pool.ready();';
      assert.equal(source.split(anchor).length, 2, 'inject at exactly one ready boundary');
      source = source
        .replace("from 'esbuild'", `from ${JSON.stringify(require.resolve('esbuild'))}`)
        .replaceAll(
          'new URL(path, import.meta.url)',
          `new URL(path, ${JSON.stringify(sourceUrl.href)})`
        )
        .replace(
          anchor,
          `${anchor}
  const originalEstimate = pool.estimateEquity.bind(pool);
  let injected = false;
  pool.estimateEquity = (...args) => {
    if (!injected) {
      injected = true;
      const error = new Error('isolated qualification refusal fixture');
      error.name = 'EquityWorkerTimeoutError';
      return Promise.reject(error);
    }
    return originalEstimate(...args);
  };`
        );
      const fixture = join(folder, 'one-refusal.mjs');
      writeFileSync(fixture, source);
      const result = spawnSync(process.execPath, [fixture, '10'], {
        encoding: 'utf8',
        timeout: 40000,
        maxBuffer: 1024 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /qualification refused calculations/);
      const report = JSON.parse(result.stdout);
      assert.equal(report.refused, 1);
      assert(report.completed > 0, 'the other real-worker requests must complete');
      assert.equal(report.final.phase, 'stopped');
      assert.equal(report.final.queueDepth, 0);
      assert.equal(report.memoryPlateau, 'not_established_by_execution_success');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
);
