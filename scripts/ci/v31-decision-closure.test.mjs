// Closure compatibility over real git histories built in a scratch repository.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { closureCompatible, closureDifferences, decisionClosure, CLOSURE_EXTRAS } from './v31-decision-closure.mjs';

function repo() {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'v31-closure-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  const write = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  const commit = (files, message) => { for (const [p, t] of Object.entries(files)) write(p, t); git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD'); };
  return { dir, git, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const BASE = {
  'server/scripts/gto-v31-evaluate-worker.mjs': "import {run} from './finite.mjs';\nconst u=new URL('../src/scripts/gtoV31Evaluate.ts',import.meta.url);\n",
  'server/scripts/finite.mjs': 'export const run=1;\n',
  'server/src/scripts/gtoV31Evaluate.ts': "import { brain } from '../engine/brain.js';\nexport const e=brain;\n",
  'server/src/engine/brain.ts': "export { policy } from './policy.js';\nexport const brain=1;\n",
  'server/src/engine/policy.ts': 'export const policy=1;\n',
  'server/src/engine/horseDecision/lane.ts': "import '../brain.js';\nexport const lane=1;\n",
  'server/src/engine/horseDecision/client.ts': "const m=await import('./worker.js');\n",
  'server/src/engine/horseDecision/worker.ts': 'export const w=1;\n',
  'server/src/scripts/reloadPublic215Stores.ts': "import { x } from 'node:fs';\n",
  'server/src/unrelated.ts': 'export const u=1;\n',
  'server/package.json': '{}\n', 'server/package-lock.json': '{"v":1}\n', 'server/tsconfig.json': '{}\n',
  'server/native/public_hist215_wtl.cc': 'int x;\n', 'server/scripts/build-public-hist215-native.mjs': '\n',
  'docs/notes.md': 'a\n',
};

test('the closure follows static, dynamic, side-effect and import.meta.url edges plus the explicit extras', () => {
  const r = repo();
  try {
    const c0 = r.commit(BASE, 'base');
    const files = decisionClosure(r.dir, c0);
    for (const path of ['server/scripts/finite.mjs', 'server/src/scripts/gtoV31Evaluate.ts', 'server/src/engine/policy.ts',
      'server/src/engine/horseDecision/worker.ts', ...CLOSURE_EXTRAS.filter((x) => x in BASE)]) assert.equal(typeof files[path], 'string', path);
    assert.equal(files['server/src/unrelated.ts'], undefined);
    assert.equal(files['server/tsconfig.emit.json'], null);
  } finally { r.cleanup(); }
});

test('compatibility is byte identity of the whole closure, across a real history', () => {
  const r = repo();
  try {
    const c0 = r.commit(BASE, 'base');
    const c1 = r.commit({ 'server/src/unrelated.ts': 'export const u=2;\n', 'docs/notes.md': 'b\n' }, 'unrelated');
    const c2 = r.commit({ 'server/src/engine/policy.ts': 'export const policy=2;\n' }, 'deep brain change');
    const c3 = r.commit({ 'server/src/engine/policy.ts': 'export const policy=1;\n' }, 'revert');
    const c4 = r.commit({ 'server/package-lock.json': '{"v":2}\n' }, 'dependency lock');
    const c5 = r.commit({ 'server/package-lock.json': '{"v":1}\n', 'server/src/engine/horseDecision/lane.ts':
      "import '../brain.js';\nimport '../../unrelated.js';\nexport const lane=1;\n" }, 'new import');
    const c6 = r.commit({ 'server/native/public_hist215_wtl.cc': 'int y;\n', 'server/src/engine/horseDecision/lane.ts': BASE['server/src/engine/horseDecision/lane.ts'] }, 'kernel');
    assert.equal(closureCompatible(r.dir, c0, c1).compatible, true);
    const deep = closureCompatible(r.dir, c0, c2);
    assert.deepEqual([deep.compatible, deep.differences], [false, ['server/src/engine/policy.ts']]);
    assert.equal(closureCompatible(r.dir, c0, c3).compatible, true, 'identical bytes are compatible regardless of history');
    assert.deepEqual(closureCompatible(r.dir, c0, c4).differences, ['server/package-lock.json']);
    assert.deepEqual(closureCompatible(r.dir, c0, c5).differences,
      ['server/src/engine/horseDecision/lane.ts', 'server/src/unrelated.ts']);
    assert.deepEqual(closureCompatible(r.dir, c0, c6).differences, ['server/native/public_hist215_wtl.cc']);
    assert.equal(closureCompatible(r.dir, c2, c0).compatible, false, 'symmetric');
    assert.equal(closureCompatible(r.dir, c1, c1).pin.digest, closureCompatible(r.dir, c0, c1).serving.digest);
  } finally { r.cleanup(); }
});

test('a serving engine that predates the entries is incompatible; a pin that lacks them is refused', () => {
  const r = repo();
  try {
    const old = r.commit({ 'server/src/engine/brain.ts': 'export const brain=0;\n', 'server/package-lock.json': '{"v":1}\n' }, 'old');
    const c0 = r.commit(BASE, 'base');
    const result = closureCompatible(r.dir, c0, old);
    assert.equal(result.compatible, false);
    assert.ok(result.differences.includes('server/scripts/gto-v31-evaluate-worker.mjs'));
    assert.throws(() => closureCompatible(r.dir, old, c0), /lacks the V31 evaluation and decision entries/);
    assert.throws(() => closureCompatible(r.dir, 'abc', c0));
    assert.deepEqual(closureDifferences({ a: '1' }, { a: '1', b: null }), ['b']);
  } finally { r.cleanup(); }
});
