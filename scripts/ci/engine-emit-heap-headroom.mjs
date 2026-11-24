#!/usr/bin/env node
// The engine image emit must fit its bounded heap with room to spare.
//
// server/Dockerfile compiles the engine with one RUN line,
// `node --max-old-space-size=<bound> ... tsc --project tsconfig.emit.json`,
// inside the bounded image builder. On 2026-11-24 main needed about 1001 MiB
// of that 1024 MiB bound and the next ~100 KB of engine source pushed the emit
// over it, so every engine pull request died in the release build. The cause
// was not the source: without isolatedModules the emit asked the checker for
// the constant value of every property access (const enum inlining), which
// type-checked those expressions and kept about 210 MiB of types and node
// links. tsconfig.runtime.json now sets isolatedModules and the emit needs
// about 790 MiB.
//
// This check runs the exact emit with the heap the Dockerfile grants minus a
// fixed margin. If it cannot finish there, headroom under the bound has fallen
// below the margin and the build fails here, in a pull request, before any
// release build runs out of memory. It names the largest program files and the
// observed peak so the next change can be cut at its cause instead of raising
// the bound.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEADROOM_MARGIN_MIB = 100;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const server = join(root, 'server');

/** The compiler heap the image build grants: the only RUN line that sets one. */
export function boundFromDockerfile(text) {
  const heaps = [...text.matchAll(/^RUN .*--max-old-space-size=(\d+)/gm)].map((m) => Number(m[1]));
  if (heaps.length !== 1 || !Number.isInteger(heaps[0]) || heaps[0] <= 0) {
    throw new Error(
      `server/Dockerfile must size exactly one compiler RUN heap, found ${JSON.stringify(heaps)}`
    );
  }
  return heaps[0];
}

/** Largest pre-collection heap V8 reported in --trace-gc output, in MiB. */
export function peakFromTraceGc(text) {
  let peak = 0;
  for (const m of text.matchAll(
    /(?:Mark-Compact|Scavenge|Mark-sweep)[^\n]*?\s(\d+(?:\.\d+)?)\s*\(\d+(?:\.\d+)?\)\s*->/g
  )) {
    peak = Math.max(peak, Number(m[1]));
  }
  return peak;
}

function largestProgramFiles(count) {
  const require = createRequire(join(server, 'package.json'));
  const ts = require('typescript');
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(server, 'tsconfig.emit.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    }
  );
  const rows = [];
  for (const file of parsed.fileNames) {
    if (!file.endsWith('.ts')) continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      false
    );
    let nodes = 0;
    const walk = (node) => {
      nodes += 1;
      ts.forEachChild(node, walk);
    };
    walk(source);
    rows.push({ file: relative(root, file), nodes });
  }
  const total = rows.reduce((sum, row) => sum + row.nodes, 0);
  return {
    total,
    files: rows.length,
    largest: rows.sort((a, b) => b.nodes - a.nodes).slice(0, count),
  };
}

function main() {
  const bound = boundFromDockerfile(readFileSync(join(server, 'Dockerfile'), 'utf8'));
  const limit = bound - HEADROOM_MARGIN_MIB;
  const outDir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'engine-emit-headroom-'));
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${limit}`,
      '--trace-gc',
      join(server, 'node_modules/typescript/bin/tsc'),
      '--project',
      'tsconfig.emit.json',
      '--outDir',
      outDir,
      '--extendedDiagnostics',
    ],
    { cwd: server, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  rmSync(outDir, { recursive: true, force: true });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const peak = peakFromTraceGc(output);
  const used = /^Memory used:\s+(\d+)K$/m.exec(output)?.[1];
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const facts = `bound ${bound} MiB, checked at ${limit} MiB (margin ${HEADROOM_MARGIN_MIB} MiB), observed peak heap ${peak.toFixed(0)} MiB${used ? `, heap at exit ${Math.round(Number(used) / 1024)} MiB` : ''}, ${seconds} s`;
  if (result.status === 0) {
    console.log(`ENGINE_EMIT_HEAP_HEADROOM ok: ${facts}`);
    console.log(`ENGINE_EMIT_HEAP_PEAK_MIB=${peak.toFixed(0)}`);
    return;
  }
  const { total, files, largest } = largestProgramFiles(15);
  console.error(
    [
      `ENGINE_EMIT_HEAP_HEADROOM failed: the engine image emit (tsc --project server/tsconfig.emit.json) did not finish inside ${limit} MiB of heap,`,
      `so less than ${HEADROOM_MARGIN_MIB} MiB is left under the ${bound} MiB compiler bound in server/Dockerfile. ${facts}; exit ${result.status ?? result.signal}.`,
      'Cut what the emit needs (a non-runtime file in the program, a construct that makes the emit consult the checker); raising the bound is a release-control change.',
      `Program: ${files} TypeScript files, ${total} syntax nodes. Largest by syntax nodes:`,
      ...largest.map((row) => `  ${String(row.nodes).padStart(8)}  ${row.file}`),
      '--- last compiler output ---',
      output
        .split('\n')
        .filter((line) => !/^\[\d+:/.test(line) && !/^\s*\d+: 0x/.test(line))
        .slice(-25)
        .join('\n'),
    ].join('\n')
  );
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
