// The V31 decision closure: every file that decides a full-brain league result
// or the serving Horse decision, read from an exact git commit (never from a
// working tree). Two commits are qualification-compatible only when their
// closures name the same files with byte-identical blobs.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SHA = /^[0-9a-f]{40}$/;
/** Evaluation entry plus the runtime decision and explicit-load entries. */
export const CLOSURE_ENTRIES = Object.freeze([
  'server/scripts/gto-v31-evaluate-worker.mjs',
  'server/src/engine/horseDecision/lane.ts',
  'server/src/engine/horseDecision/client.ts',
  'server/src/scripts/reloadPublic215Stores.ts',
]);
/** Inputs no import names: locked dependencies, compiler settings and the native kernel. */
export const CLOSURE_EXTRAS = Object.freeze([
  'server/package.json',
  'server/package-lock.json',
  'server/tsconfig.json',
  'server/tsconfig.emit.json',
  'server/tsconfig.runtime.json',
  'server/native/public_hist215_wtl.cc',
  'server/scripts/build-public-hist215-native.mjs',
]);
const IMPORTS = /(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url|import\s+['"]([^'"]+)['"]/g;

function git(repo, args, input) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 60000, input });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed for the decision closure`);
  return result.stdout;
}

/** path -> blob id of every file under server/ at the commit. */
export function serverBlobs(repo, sha) {
  if (!SHA.test(sha ?? '')) throw new Error('A full engine commit is required');
  const blobs = new Map();
  for (const line of git(repo, ['ls-tree', '-r', '--full-tree', sha, '--', 'server']).split('\n')) {
    const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (match) blobs.set(match[2], match[1]);
  }
  return blobs;
}

/** One `git cat-file --batch` per traversal level: [[path, source], ...]. */
function readBlobs(repo, pairs) {
  if (!pairs.length) return [];
  const result = spawnSync('git', ['-C', repo, 'cat-file', '--batch'], {
    input: pairs.map(([, id]) => id).join('\n') + '\n', maxBuffer: 1 << 30, timeout: 120000,
  });
  if (result.status !== 0) throw new Error('git cat-file failed for the decision closure');
  const out = result.stdout;
  const sources = [];
  let offset = 0;
  for (const [path, id] of pairs) {
    const newline = out.indexOf(10, offset);
    const header = out.subarray(offset, newline).toString('utf8').split(' ');
    if (header[0] !== id || header[1] !== 'blob') throw new Error('Unexpected git object in the decision closure');
    const size = Number(header[2]);
    sources.push([path, out.subarray(newline + 1, newline + 1 + size).toString('utf8')]);
    offset = newline + 1 + size + 1;
  }
  return sources;
}

function normalize(from, spec) {
  const out = [];
  for (const part of `${from.split('/').slice(0, -1).join('/')}/${spec}`.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function resolveSpec(blobs, from, spec) {
  const base = normalize(from, spec);
  return [base, base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.mts'), `${base}.ts`, `${base}.js`,
    `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`].find((path) => blobs.has(path));
}

/** The closure at one commit: sorted paths and their blob ids (null = absent extra). */
export function decisionClosure(repo, sha) {
  const blobs = serverBlobs(repo, sha);
  const seen = new Set();
  // A missing entry is recorded as absent (an older serving engine), never skipped.
  let frontier = CLOSURE_ENTRIES.filter((entry) => blobs.has(entry));
  while (frontier.length) {
    const fresh = [...new Set(frontier)].filter((path) => !seen.has(path));
    for (const path of fresh) seen.add(path);
    const sources = readBlobs(repo, fresh.filter((path) => /\.(?:m?[jt]s)$/.test(path)).map((path) => [path, blobs.get(path)]));
    frontier = [];
    for (const [path, source] of sources) {
      for (const match of source.matchAll(IMPORTS)) {
        const spec = match[1] || match[2] || match[3] || match[4] || match[5];
        if (!spec || !spec.startsWith('.')) continue;
        const resolved = resolveSpec(blobs, path, spec);
        if (resolved && !seen.has(resolved)) frontier.push(resolved);
      }
    }
  }
  const files = {};
  for (const path of [...seen, ...CLOSURE_ENTRIES, ...CLOSURE_EXTRAS].sort()) files[path] = blobs.get(path) ?? null;
  return files;
}

export function closureComplete(files) {
  return CLOSURE_ENTRIES.every((entry) => typeof files?.[entry] === 'string');
}

export function closureDigest(files) {
  const lines = Object.keys(files).sort().map((path) => `${path}\t${files[path] ?? 'absent'}\n`).join('');
  return createHash('sha256').update(lines).digest('hex');
}

/** Pure comparison of two closures: every path on either side must hold the same blob. */
export function closureDifferences(pinFiles, servingFiles) {
  const paths = new Set([...Object.keys(pinFiles), ...Object.keys(servingFiles)]);
  // A path missing on one side reads as undefined, never equal to a blob id or null.
  return [...paths].sort().filter((path) => pinFiles[path] !== servingFiles[path]);
}

/**
 * Byte identity of the full decision closure between the pinned (evaluated)
 * commit and the serving commit. The pin's closure and the serving commit's
 * own closure are both computed, so an import added or removed on either side
 * is a difference, as is any changed byte or dependency lock.
 */
export function closureCompatible(repo, pinSha, servingSha) {
  const pin = decisionClosure(repo, pinSha);
  if (!closureComplete(pin)) throw new Error('The pinned engine commit lacks the V31 evaluation and decision entries');
  const serving = pinSha === servingSha ? pin : decisionClosure(repo, servingSha);
  const differences = closureDifferences(pin, serving);
  return {
    compatible: differences.length === 0,
    pin: { commit: pinSha, files: Object.keys(pin).length, digest: closureDigest(pin) },
    serving: { commit: servingSha, files: Object.keys(serving).length, digest: closureDigest(serving) },
    differences: differences.slice(0, 50),
    differenceCount: differences.length,
  };
}
