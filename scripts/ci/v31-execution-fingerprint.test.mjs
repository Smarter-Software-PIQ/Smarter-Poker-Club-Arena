// The V31 execution fingerprint over real git histories built in a scratch repository.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDARY, EXECUTION_ENTRIES, EXECUTION_EXTRAS, executionClosure, executionDifferences, executionDigest }
  from './v31-execution-fingerprint.mjs';

function repo() {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'v31-execution-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  const write = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  const commit = (files, message) => { for (const [p, t] of Object.entries(files)) write(p, t); git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD'); };
  return { dir, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const E = 'server/src/engine/';
const boundaryImports = Object.keys(BOUNDARY)
  .filter((p) => p.startsWith(E))
  .map((p, i) => `import { b${i} } from './${p.slice(E.length).replace(/\.ts$/, '.js')}';`)
  .join('\n');
const BASE = {
  [`${E}HorseV31CertifiedPolicy.ts`]: `import type { T } from './HorseLogic.js';\n${boundaryImports}\nimport { lookup } from './GtoPostflopV31.js';\nexport const decide = lookup;\n`,
  [`${E}GtoPostflopV31.ts`]: "import { f } from './GtoPublicHist215Features.js';\nexport const lookup = f;\n",
  [`${E}GtoPublicHist215Features.ts`]: 'export const f = 1;\n',
  [`${E}HorseLogic.ts`]: 'export type T = 1;\n',
  'server/src/services/GtoPostflopV31Loader.ts': "import { supabase } from './supabase/client.js';\nimport { lookup } from '../engine/GtoPostflopV31.js';\nexport const l = [supabase, lookup];\n",
  'server/src/services/supabase/client.ts': 'export const supabase = 1;\n',
  'server/native/public_hist215_wtl.cc': 'int x;\n',
  'server/scripts/build-public-hist215-native.mjs': '\n',
  'docs/notes.md': 'a\n',
};
for (const p of Object.keys(BOUNDARY)) if (p.startsWith(E)) BASE[p] = `export const b = 1;\nexport const b0 = 1, b1 = 1, b2 = 1, b3 = 1, b4 = 1, b5 = 1, b6 = 1, b7 = 1;\n`;

test('the execution set follows value imports, stops at the boundary and skips type-only imports', () => {
  const r = repo();
  try {
    const c0 = r.commit(BASE, 'base');
    const closure = executionClosure(r.dir, c0);
    assert.deepEqual(closure.errors, []);
    for (const path of [...EXECUTION_ENTRIES, `${E}GtoPostflopV31.ts`, `${E}GtoPublicHist215Features.ts`, ...EXECUTION_EXTRAS])
      assert.equal(typeof closure.files[path], 'string', path);
    for (const path of [`${E}HorseLogic.ts`, ...Object.keys(BOUNDARY)]) assert.equal(closure.files[path], undefined, path);
    assert.deepEqual(closure.boundary, Object.keys(BOUNDARY).sort());
    assert.match(executionDigest(closure), /^[0-9a-f]{64}$/);
  } finally { r.cleanup(); }
});

test('boundary and unrelated edits keep the digest; any execution edit changes it', () => {
  const r = repo();
  try {
    const c0 = r.commit(BASE, 'base');
    const d0 = executionDigest(executionClosure(r.dir, c0));
    const c1 = r.commit({ [`${E}HorseMind.ts`]: 'export const b = 2;\nexport const b0 = 2, b1 = 2, b2 = 2, b3 = 2, b4 = 2, b5 = 2, b6 = 2, b7 = 2;\n',
      [`${E}HorseLogic.ts`]: 'export type T = 2;\n', 'docs/notes.md': 'b\n' }, 'outside');
    assert.equal(executionDigest(executionClosure(r.dir, c1)), d0);
    const c2 = r.commit({ [`${E}GtoPublicHist215Features.ts`]: 'export const f = 2;\n' }, 'feature');
    const closure2 = executionClosure(r.dir, c2);
    assert.notEqual(executionDigest(closure2), d0);
    assert.deepEqual(executionDifferences(executionClosure(r.dir, c1), closure2), [`${E}GtoPublicHist215Features.ts`]);
    const c3 = r.commit({ 'server/native/public_hist215_wtl.cc': 'int y;\n' }, 'kernel');
    assert.notEqual(executionDigest(executionClosure(r.dir, c3)), executionDigest(closure2));
  } finally { r.cleanup(); }
});

test('a type import that becomes a value import joins the execution set', () => {
  const r = repo();
  try {
    const c0 = r.commit({ ...BASE, [`${E}Sizing.ts`]: 'export type S = 1;\nexport const s = 1;\n',
      [`${E}GtoPostflopV31.ts`]: "import type { S } from './Sizing.js';\nimport { f } from './GtoPublicHist215Features.js';\nexport const lookup = f;\n" }, 'type');
    assert.equal(executionClosure(r.dir, c0).files[`${E}Sizing.ts`], undefined);
    const c1 = r.commit({ [`${E}GtoPostflopV31.ts`]: "import { s } from './Sizing.js';\nimport { f } from './GtoPublicHist215Features.js';\nexport const lookup = [s, f];\n" }, 'value');
    assert.equal(typeof executionClosure(r.dir, c1).files[`${E}Sizing.ts`], 'string');
  } finally { r.cleanup(); }
});

test('fail closed: unresolved, dynamic, missing entry and stale boundary refuse the digest', () => {
  const r = repo();
  try {
    r.commit(BASE, 'base');
    const unresolved = r.commit({ [`${E}GtoPostflopV31.ts`]: "import { g } from './Gone.js';\nexport const lookup = g;\n" }, 'unresolved');
    assert.match(executionClosure(r.dir, unresolved).errors.join('\n'), /unresolved/);
    assert.throws(() => executionDigest(executionClosure(r.dir, unresolved)), /not closed/);
    const dynamic = r.commit({ [`${E}GtoPostflopV31.ts`]: "const name = 'x';\nexport const lookup = await import(name);\n" }, 'dynamic');
    assert.match(executionClosure(r.dir, dynamic).errors.join('\n'), /dynamic/);
    const stale = r.commit({ [`${E}HorseV31CertifiedPolicy.ts`]: "import { lookup } from './GtoPostflopV31.js';\nexport const decide = lookup;\n",
      [`${E}GtoPostflopV31.ts`]: "import { f } from './GtoPublicHist215Features.js';\nexport const lookup = f;\n" }, 'stale');
    assert.match(executionClosure(r.dir, stale).errors.join('\n'), /stale boundary/);
  } finally { r.cleanup(); }
});

test('the real engine: the execution set is closed and small', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const closure = executionClosure(root, head);
  assert.deepEqual(closure.errors, []);
  assert.equal(typeof closure.files['server/src/engine/HorseV31CertifiedPolicy.ts'], 'string');
  assert.equal(closure.files['server/src/engine/HorseLogic.ts'], undefined);
  assert.equal(closure.files['server/src/engine/HorseMind.ts'], undefined);
  assert.ok(Object.keys(closure.files).length < 40, `${Object.keys(closure.files).length} execution files`);
  assert.match(executionDigest(closure), /^[0-9a-f]{64}$/);
});
