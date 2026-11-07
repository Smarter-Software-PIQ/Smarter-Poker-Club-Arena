/** Finite, isolated qualification. No network, database, forced GC or production input. */
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = (path) => {
  const build = buildSync({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    define: { 'import.meta.url': JSON.stringify(new URL(path, import.meta.url).href) },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return new URL(
    'data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].contents).toString('base64')
  );
};
const { EquityWorkerPool } = await import(bundle('../src/engine/equity/EquityWorkerPool.ts'));
const workerUrl = bundle('../src/engine/equity/equityWorker.ts');
const seconds = Number(process.argv[2] ?? 120);
assert(Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600);
let index = 0;
const pool = new EquityWorkerPool({
  size: 14,
  workerFactory: () => new Worker(workerUrl, { workerData: { equityMemoryIndex: index++ } }),
  readyTimeoutMs: 10000,
});
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const deck = ['clubs', 'diamonds', 'hearts', 'spades'].flatMap((suit) =>
  ranks.map((rank) => ({ rank, suit }))
);
const delay = monitorEventLoopDelay({ resolution: 20 });
const samples = [];
let completed = 0,
  refused = 0,
  rounds = 0;
const started = performance.now();
const keepAlive = setTimeout(
  () => {
    console.error('Isolated equity qualification exceeded its total execution budget');
    process.exit(1);
  },
  (seconds + 30) * 1000
);
try {
  await pool.ready();
  delay.enable();
  while (performance.now() - started < seconds * 1000) {
    const jobs = Array.from({ length: pool.status().configuredWorkers }, (_, i) => {
      const width = [2, 4, 5, 6][(rounds + i) % 4];
      const hands = [deck.slice(0, width), deck.slice(13, 13 + width)];
      const board = [deck[28], deck[32], deck[38]];
      return (
        i % 3 === 0
          ? pool.estimateInsurance(hands, board, width === 2 ? 'NLH' : `PLO${width}`)
          : pool.estimateEquity(hands, board, [], 1000, {
              exact: true,
              omaha: width > 2,
              hiLo: width > 2 && i % 2 === 0,
            })
      ).then(
        (result) => {
          assert.equal(result.length, 2);
          completed++;
        },
        (error) => {
          assert.equal(error.name, 'EquityWorkerTimeoutError');
          refused++;
        }
      );
    });
    await Promise.all(jobs);
    const status = pool.status();
    assert.equal(status.queueDepth, 0);
    assert.equal(status.queuedBytes, 0);
    assert.equal(status.executionTimeouts, 0);
    assert.equal(status.retiringWorkers, 0);
    rounds++;
    if (samples.length === 0 || performance.now() - samples.at(-1).elapsedMs >= 5000)
      samples.push({
        elapsedMs: Math.round(performance.now() - started),
        rssBytes: process.memoryUsage().rss,
        mainMemory: process.memoryUsage(),
        workerMemory: status.workerMemory,
      });
  }
} finally {
  delay.disable();
  await pool.shutdown();
  clearTimeout(keepAlive);
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      durationMs: Math.round(performance.now() - started),
      rounds,
      completed,
      refused,
      eventLoopP99Ms: delay.percentile(99) / 1e6,
      samples,
      final: pool.status(),
      memoryPlateau: 'not_established_by_execution_success',
      limitation:
        'Finite mixed-calculator qualification only; not whole-engine load, production plateau, or Linux capacity proof.',
    },
    null,
    2
  )
);

// Preserve the report before refusing any dropped calculation.
assert(completed > 0, 'qualification must execute actual calculations');
assert.equal(refused, 0, 'qualification refused calculations');
assert.equal(pool.status().phase, 'stopped');
