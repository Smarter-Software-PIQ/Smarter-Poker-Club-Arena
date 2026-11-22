/**
 * LAW: a runtime engine source imports JSON only when the engine image compile emits it.
 *
 * The engine image compiles with `tsconfig.emit.json` (`noResolve`, `noCheck`): it emits the TypeScript files of
 * `tsconfig.runtime.json` and ONLY the JSON files its own `files` list names. The full typechecked build
 * (`tsc -p tsconfig.runtime.json`, `resolveJsonModule`) follows every JSON import instead. So a runtime source
 * (any `server/src` TypeScript file that is not `*.test.ts`, `*.spec.ts` or under `__tests__`, which includes
 * `*.fixtures.ts` and `*.test-support.ts`) that imports a JSON file the emit list does not name builds green
 * locally and in the typechecked build, and then the image ships without the file: the engine cannot boot it.
 *
 * On 2026-11-20 #11511 merged AHoldemTournamentAllInCallIsPriced.fixtures.ts importing a fixture JSON; the hosted
 * engine-build-resource-proof failed ("runtime emission differs from the full typechecked CI build",
 * runtime-output-difference.json) and the next two PLO branches inherited the red. That proof needs Docker and
 * runs only in CI, so the local pre-push gate never saw it. This law is the same condition, read from the source,
 * so the server suite of the local gate refuses it: tables are read at run time from `src/` with readFileSync
 * (OmahaMathCoreTables.ts), or the JSON file is added to `tsconfig.emit.json` on purpose.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const srcRoot = join(serverRoot, 'src');

/** The runtime build excludes exactly these (tsconfig.runtime.json + server/.dockerignore). */
const isRuntimeSource = (relFromSrc: string): boolean => {
  if (!/\.(ts|mts|cts|tsx)$/.test(relFromSrc) || relFromSrc.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.(ts|mts|cts|tsx)$/.test(relFromSrc)) return false;
  if (/\.test-support\./.test(relFromSrc)) return false;
  if (relFromSrc.startsWith('testing/') || relFromSrc.startsWith('engine/testing/')) return false;
  if (
    relFromSrc.startsWith('benchmark/fixtures/') ||
    /^benchmark\/Sparring[^/]*\.ts$/.test(relFromSrc) ||
    relFromSrc === 'benchmark/sparringRun.ts'
  ) {
    return false;
  }
  return true;
};

function runtimeSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist')
        continue;
      runtimeSources(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const full = join(dir, entry.name);
      const rel = posix(relative(srcRoot, full));
      if (isRuntimeSource(rel)) out.push(full);
    }
  }
  return out;
}

/** Every module specifier ending in .json: static import or export, import(), typeof import(), require(). */
function jsonSpecifiersOf(text: string): string[] {
  const info = ts.preProcessFile(text, true, true);
  return info.importedFiles.map((f) => f.fileName).filter((name) => /\.json$/i.test(name));
}

const posix = (path: string): string => path.split(sep).join('/');

describe('LAW: a runtime engine source imports JSON only when the engine image compile emits it', () => {
  it('the detector sees every import form and ignores comments and strings', () => {
    const text = [
      "import a from './a.json' with { type: 'json' };",
      "import b from './b.json';",
      "export { default as c } from './c.json';",
      "type D = typeof import('./d.json');",
      "const e = await import('./e.json');",
      "const f = require('./f.json');",
      "// import g from './g.json';",
      "/* import h from './h.json'; */",
      "const i = new URL('./i.json', import.meta.url);",
      "const j = './j.json';",
    ].join('\n');
    expect(jsonSpecifiersOf(text).sort()).toEqual([
      './a.json',
      './b.json',
      './c.json',
      './d.json',
      './e.json',
      './f.json',
    ]);
  });

  it('the JSON files the runtime sources import are exactly the JSON files tsconfig.emit.json emits', () => {
    const emit = JSON.parse(readFileSync(join(serverRoot, 'tsconfig.emit.json'), 'utf8')) as {
      files?: string[];
    };
    const emitted = [...(emit.files ?? [])].filter((f) => /\.json$/i.test(f)).sort();
    const imported = new Map<string, string[]>();
    for (const file of runtimeSources(srcRoot)) {
      for (const spec of jsonSpecifiersOf(readFileSync(file, 'utf8'))) {
        const target = spec.startsWith('.')
          ? posix(relative(serverRoot, resolve(dirname(file), spec)))
          : `(package) ${spec}`;
        const by = imported.get(target) ?? [];
        by.push(posix(relative(serverRoot, file)));
        imported.set(target, by);
      }
    }
    const unemitted = [...imported.keys()]
      .filter((target) => !emitted.includes(target))
      .sort()
      .map((target) => `${target} <- ${imported.get(target)!.join(', ')}`);
    expect(
      unemitted,
      'a runtime source imports a JSON file the engine image does not emit: read it at run time with readFileSync ' +
        '(as OmahaMathCoreTables.ts does), move the import into a *.test.ts file, or add the file to ' +
        'server/tsconfig.emit.json "files" on purpose'
    ).toEqual([]);
    expect(
      emitted.filter((f) => !imported.has(f)),
      'tsconfig.emit.json emits a JSON file no runtime source imports: remove it from "files"'
    ).toEqual([]);
  });
});
