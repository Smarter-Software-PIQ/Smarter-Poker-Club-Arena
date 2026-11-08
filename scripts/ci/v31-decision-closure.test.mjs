// Closure compatibility over real git histories built in a scratch repository.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { closureCompatible, closureDifferences, decisionClosure, CLOSURE_EXTRAS, DYNAMIC_SITES } from './v31-decision-closure.mjs';
import { fileURLToPath } from 'node:url';

function repo() {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'v31-closure-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_AUTHOR_NAME: 't',
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
  'server/src/benchmark/HorseLeagueComputeProcess.ts': "import '../engine/brain.js';\n",
  'server/src/benchmark/HorseLeagueComputeWorker.ts': 'export const c=1;\n',
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
    const { files, errors } = decisionClosure(r.dir, c0);
    assert.deepEqual(errors, []);
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

test('an unresolved specifier or an unacknowledged dynamic path refuses the closure', () => {
  for (const [label, lane, error] of [
    ['dynamic import', "const name = process.env.X;\nawait import(name);\nexport const lane=1;\n", /^dynamic server\/src\/engine\/horseDecision\/lane\.ts: await import\(name\)/],
    ['template worker URL', "const v='a';\nnew URL(`./policy${v}.js`, import.meta.url);\n", /^dynamic .*new URL\(`\.\/policy/],
    ['runtime file read', "import { readFileSync } from 'node:fs';\nreadFileSync(process.argv[2]);\n", /^dynamic .*readFileSync\(process\.argv\[2\]\)/],
    ['missing module', "import '../missing.js';\n", /^unresolved server\/src\/engine\/horseDecision\/lane\.ts: \.\.\/missing\.js/],
  ]) {
    const r = repo();
    try {
      const good = r.commit(BASE, 'base');
      const bad = r.commit({ 'server/src/engine/horseDecision/lane.ts': lane }, label);
      const { errors } = decisionClosure(r.dir, bad);
      assert.equal(errors.length, 1, `${label}: ${errors}`);
      assert.match(errors[0], error, label);
      assert.throws(() => closureCompatible(r.dir, bad, good), /not closed/, label);
      const serving = closureCompatible(r.dir, good, bad);
      assert.equal(serving.compatible, false, label);
      assert.ok(serving.differences.some((d) => d.startsWith('closure-error ')), label);
    } finally { r.cleanup(); }
  }
});

test('imports outside server/ are followed, and literal sources/data a closure file names are included', () => {
  const r = repo();
  try {
    const c0 = r.commit({ ...BASE,
      'server/src/engine/policy.ts': "import { rake } from '../../../src/config/rake.js';\nexport const SOURCES=['src/engine/digested.ts','evidence/x.json'];\nexport const policy=rake;\n",
      'src/config/rake.ts': 'export const rake=1;\n', 'server/src/engine/digested.ts': 'export const d=1;\n',
      'evidence/x.json': '{}\n' }, 'outside');
    const { files, errors } = decisionClosure(r.dir, c0);
    assert.deepEqual(errors, []);
    for (const path of ['src/config/rake.ts', 'server/src/engine/digested.ts', 'evidence/x.json']) assert.equal(typeof files[path], 'string', path);
    const c1 = r.commit({ 'src/config/rake.ts': 'export const rake=2;\n' }, 'client rake change');
    assert.deepEqual(closureCompatible(r.dir, c0, c1).differences, ['src/config/rake.ts']);
  } finally { r.cleanup(); }
});

// The real repository at a pinned protected-main commit (fetched by the contract job).
const PINNED = 'ee9fd8eded24d2f832cbe9de865e2d8932fa648f';
const ROOT = spawnSync('git', ['-C', dirname(fileURLToPath(import.meta.url)), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
test('the real decision closure at a pinned main commit holds the decision code the import walk alone missed', () => {
  const have = spawnSync('git', ['-C', ROOT, 'cat-file', '-e', `${PINNED}^{commit}`]).status === 0;
  assert.ok(have, `pinned commit ${PINNED} must be fetched (git fetch --depth=1 origin ${PINNED})`);
  const { files, errors } = decisionClosure(ROOT, PINNED);
  assert.deepEqual(errors, []);
  for (const path of [
    'server/src/engine/horseDecision/worker.ts', 'server/src/engine/horseDecision/workerRuntime.ts',
    'server/src/engine/horseDecision/mindMirror.ts', 'server/src/engine/horseDecision/observerReads.ts',
    'server/src/benchmark/HorseLeagueComputeProcess.ts', 'server/src/benchmark/HorseLeagueComputeWorker.ts',
    'server/src/services/GtoPostflopLoader.ts', 'server/src/services/GtoChartLoader.ts',
    'server/src/services/HorseMindHydrator.ts', 'server/src/services/HorseExploitHydrator.ts',
    'server/src/services/horseCorrectiveReview/kernelComposition.ts', 'server/src/services/horseDecisionJournal/worker.ts',
    'server/src/engine/HorsePhase8PolicyDigest.ts', 'server/src/engine/HorseQualifiedAuthority.ts',
    'server/src/engine/HorseFeatureAuthority.ts', 'server/src/gto/SolverPolicyArtifactLoader.ts',
    'server/release-evidence/README.md', 'src/config/RakeConfig.ts', 'package-lock.json', 'server/package-lock.json',
    'server/native/public_hist215_wtl.cc',
  ]) assert.equal(typeof files[path], 'string', path);
  assert.ok(Object.keys(files).length > 8000);
  // Every acknowledged site names a file that exists at the pin (no stale acknowledgements hide drift).
  for (const site of DYNAMIC_SITES) assert.equal(typeof files[site.file], 'string', site.file);
});
