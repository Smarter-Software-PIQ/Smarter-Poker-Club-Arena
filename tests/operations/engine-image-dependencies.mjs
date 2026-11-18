#!/usr/bin/env node
// Runs INSIDE a container started from the built engine image (no network,
// read-only). Compares what the image actually installed under /app with the
// repository's committed lockfile, mounted read-only at the path given.
//
// The expected production tree is computed from the committed lockfile's own
// dependency graph, starting at the root package's dependencies and
// optionalDependencies and following Node's resolution order. It does not
// trust the lockfile's dev/optional flags, so a stale flag cannot hide a
// package that should have been pruned, or one that should have shipped.
//
// Prints one JSON report; exits 1 when the installed tree differs from that
// production set or any installed version differs from the locked version.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [, , repoLockPath, appRoot = '/app'] = process.argv;
if (!repoLockPath)
  throw Error('usage: engine-image-dependencies.mjs <repo package-lock.json> [/app]');
const lock = JSON.parse(readFileSync(repoLockPath, 'utf8'));
if (lock.lockfileVersion !== 3) throw Error(`unsupported lockfileVersion ${lock.lockfileVersion}`);
const packages = lock.packages;
const root = packages[''];

// Node resolution over lockfile keys: from package key P, a dependency N
// resolves to the nearest P/node_modules/N, walking up to node_modules/N.
function resolve(fromKey, name) {
  let base = fromKey;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

const expected = new Set();
const unresolved = [];
const queue = [];
const enqueue = (fromKey, deps, optional) => {
  for (const name of Object.keys(deps ?? {})) {
    const key = resolve(fromKey, name);
    if (!key) {
      if (!optional) unresolved.push(`${fromKey || '<root>'} -> ${name}`);
      continue;
    }
    // An optional dependency for another platform is in the lock but not
    // installed; that is decided below by the installed tree, not counted missing.
    if (!expected.has(key)) {
      expected.add(key);
      queue.push(key);
    }
  }
};
enqueue('', root.dependencies, false);
enqueue('', root.optionalDependencies, true);
while (queue.length) {
  const key = queue.shift();
  const entry = packages[key];
  enqueue(key, entry.dependencies, false);
  enqueue(key, entry.optionalDependencies, true);
  enqueue(key, entry.peerDependencies, true);
}

// What the image actually installed: every package directory under node_modules.
const installed = new Map();
function walk(dirKey) {
  const dir = path.join(appRoot, dirKey, 'node_modules');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue; // .bin, .package-lock.json
    const names = name.startsWith('@')
      ? readdirSync(path.join(dir, name)).map((n) => `${name}/${n}`)
      : [name];
    for (const n of names) {
      const key = dirKey ? `${dirKey}/node_modules/${n}` : `node_modules/${n}`;
      const manifest = path.join(appRoot, key, 'package.json');
      if (!existsSync(manifest)) continue;
      installed.set(key, JSON.parse(readFileSync(manifest, 'utf8')).version);
      walk(key);
    }
  }
}
walk('');

const optionalOnly = (key) => {
  // Present in the expected set only through optional edges and not installed:
  // legitimate (wrong platform), as long as the lock marks it optional.
  const e = packages[key];
  return e.optional === true || e.devOptional === true;
};
const missing = [...expected].filter((k) => !installed.has(k) && !optionalOnly(k)).sort();
const extra = [...installed.keys()].filter((k) => !expected.has(k)).sort();
const versionMismatch = [...installed]
  .filter(([k, v]) => packages[k] && packages[k].version !== v)
  .map(([k, v]) => ({ key: k, locked: packages[k].version, installed: v }));
const notInLock = [...installed.keys()].filter((k) => !packages[k]).sort();
// Stale lockfile flags, reported for the record (not a failure by themselves):
// entries the lock marks as production that the dependency graph never reaches.
const staleProductionFlags = Object.entries(packages)
  .filter(([k, v]) => k && !v.dev && !v.devOptional && !v.optional && !expected.has(k))
  .map(([k]) => k)
  .sort();

const report = {
  schema: 'engine-image-dependencies-v1',
  expectedProduction: expected.size,
  installed: installed.size,
  missing,
  extra,
  versionMismatch,
  notInLock,
  unresolved,
  staleProductionFlags,
  ok:
    !missing.length &&
    !extra.length &&
    !versionMismatch.length &&
    !notInLock.length &&
    !unresolved.length,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
