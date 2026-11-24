import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EMIT_HEAP_CEILING_MIB,
  HEADROOM_MARGIN_MIB,
  boundFromDockerfile,
  peakFromTraceGc,
} from './engine-emit-heap-headroom.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the Dockerfile heap is the one compiler RUN heap in server/Dockerfile, not the serving NODE_OPTIONS', () => {
  const dockerfile = readFileSync(join(root, 'server/Dockerfile'), 'utf8');
  const bound = boundFromDockerfile(dockerfile);
  assert.ok(Number.isInteger(bound) && bound > HEADROOM_MARGIN_MIB);
  assert.match(
    dockerfile,
    new RegExp(`^RUN .*--max-old-space-size=${bound} .*tsconfig\\.emit\\.json`, 'm')
  );
  assert.throws(() =>
    boundFromDockerfile('FROM x\nENV NODE_OPTIONS="--max-old-space-size=12288"\n')
  );
  assert.throws(() =>
    boundFromDockerfile(
      'RUN node --max-old-space-size=1024 a\nRUN node --max-old-space-size=2048 b\n'
    )
  );
  assert.equal(HEADROOM_MARGIN_MIB, 100);
});

test('the ceiling is fixed at 924 MiB, below the Dockerfile heap by at least the margin, whatever that heap is', () => {
  // A raised compiler heap (#11934) must not raise what the emit may need.
  assert.equal(EMIT_HEAP_CEILING_MIB, 924);
  const bound = boundFromDockerfile(readFileSync(join(root, 'server/Dockerfile'), 'utf8'));
  assert.ok(EMIT_HEAP_CEILING_MIB <= bound - HEADROOM_MARGIN_MIB);
});

test('the observed peak is the largest heap before a collection', () => {
  const trace = [
    '[1:0x1]   100 ms: Scavenge 12.5 (14.0) -> 11.9 (15.0) MB, 0.5 / 0.0 ms  (average mu = 1.000) allocation failure;',
    '[1:0x1]  9000 ms: Mark-Compact 873.4 (901.2) -> 790.1 (880.0) MB, pooled: 0 MB, 410.2 / 0.0 ms  (average mu = 0.4)',
    '[1:0x1]  9500 ms: Mark-Compact (reduce) 820.0 (850.0) -> 800.0 (840.0) MB, 300 ms',
  ].join('\n');
  assert.equal(peakFromTraceGc(trace), 873.4);
  assert.equal(peakFromTraceGc('no collections'), 0);
});

test('the runtime program is compiled as isolated modules, so the emit never consults the checker for constants', () => {
  // Without isolatedModules the noCheck emit type-checks every property access
  // to inline const enum values and keeps about 210 MiB of checker state.
  const runtime = JSON.parse(readFileSync(join(root, 'server/tsconfig.runtime.json'), 'utf8'));
  assert.equal(runtime.compilerOptions.isolatedModules, true);
  const emit = JSON.parse(readFileSync(join(root, 'server/tsconfig.emit.json'), 'utf8'));
  assert.equal(emit.extends, './tsconfig.runtime.json');
  assert.notEqual(emit.compilerOptions.isolatedModules, false);
});
