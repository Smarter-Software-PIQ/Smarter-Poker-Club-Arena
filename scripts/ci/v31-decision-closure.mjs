// The V31 decision closure: every repository file that decides a full-brain
// league result or the serving Horse decision, read from an exact git commit
// (never from a working tree). Two commits are qualification-compatible only
// when their closures name the same files with byte-identical blobs.
//
// FAIL CLOSED. Besides literal relative imports, the walk follows literal
// `new URL(..., import.meta.url)` targets, explicit worker/process entries,
// and every string literal in a closure file that names an existing
// repository file (policy digests and authorities read their sources and
// evidence that way). Any relative specifier that resolves to nothing, and any
// dynamic, non-literal module/worker/file path, is a closure ERROR that refuses
// compatibility, unless DYNAMIC_SITES acknowledges that exact site with a
// justification (and, where it reads repository content, what it includes).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SHA = /^[0-9a-f]{40}$/;
/** Evaluation entry, runtime decision lane/client, explicit load, and the thread/process entries they spawn. */
export const CLOSURE_ENTRIES = Object.freeze([
  'server/scripts/gto-v31-evaluate-worker.mjs',
  'server/src/engine/horseDecision/lane.ts',
  'server/src/engine/horseDecision/client.ts',
  'server/src/scripts/reloadPublic215Stores.ts',
  'server/src/engine/horseDecision/worker.ts',
  'server/src/benchmark/HorseLeagueComputeProcess.ts',
  'server/src/benchmark/HorseLeagueComputeWorker.ts',
]);
/** Inputs no source names: locked dependencies, compiler settings, the native kernel and shipped evidence. */
export const CLOSURE_EXTRAS = Object.freeze([
  'server/package.json',
  'server/package-lock.json',
  'server/tsconfig.json',
  'server/tsconfig.emit.json',
  'server/tsconfig.runtime.json',
  'server/native/public_hist215_wtl.cc',
  'server/scripts/build-public-hist215-native.mjs',
]);
/** Whole directories read at runtime by computed names (every file is in the closure). */
export const CLOSURE_DIRECTORIES = Object.freeze([
  // HorseQualifiedAuthority reads `../../release-evidence/${relativePath}` (the shipped evidence copy).
  'server/release-evidence/',
]);
/**
 * Acknowledged dynamic sites: `file` + a substring of the site's source line.
 * Every one names why it cannot change a decision or what it reads, which is
 * in the closure through CLOSURE_ENTRIES, CLOSURE_DIRECTORIES or the literal
 * scan of the same file.
 */
export const DYNAMIC_SITES = Object.freeze([
  { file: 'server/scripts/finite-evaluation-worker-entry.mjs', match: 'await import(workerData.entry)',
    reason: 'imports the launcher-supplied entry; gto-v31-evaluate-worker.mjs passes the literal ../src/scripts/gtoV31Evaluate.ts, which is followed' },
  { file: 'server/src/engine/horseDecision/client.ts', match: 'new Worker(new URL(entry, import.meta.url)',
    reason: "entry is the literal './worker.ts' or './worker.js'; worker.ts is a CLOSURE_ENTRY" },
  { file: 'server/src/benchmark/HorseLeagueComputeWorkerClient.ts', match: 'new URL(`./HorseLeagueComputeProcess${extension}`',
    reason: 'HorseLeagueComputeProcess.ts is a CLOSURE_ENTRY (.js is its compiled form)' },
  { file: 'server/src/benchmark/HorseLeagueComputeWorkerClient.ts', match: 'fork(',
    reason: 'forks the HorseLeagueComputeProcess entry above' },
  { file: 'server/src/services/HorseDecisionJournal.ts', match: 'new Worker(journalWriterEntry()',
    reason: "journalWriterEntry is the literal './horseDecisionJournal/worker.ts|.js', included by the literal scan" },
  { file: 'server/src/services/HorseDecisionJournal.ts', match: 'new URL(',
    reason: 'journalWriterEntry: a literal ternary of the journal writer worker, included by the literal scan' },
  { file: 'server/src/engine/HorsePhase8PolicyDigest.ts', match: 'new URL(`../../${path}`',
    reason: 'digests its literal HORSE_PHASE8_POLICY_SOURCE_FILES (server-relative), included by the literal scan' },
  { file: 'server/src/engine/HorsePhase10Authority.ts', match: 'new URL(`../../${path}`',
    reason: 'reads its literal server-relative sources, included by the literal scan' },
  { file: 'server/src/engine/HorsePhase11PolicyDigest.ts', match: 'new URL(`../../${path}`',
    reason: 'digests its literal server-relative sources, included by the literal scan' },
  { file: 'server/src/engine/HorsePhase12PolicyDigest.ts', match: 'new URL(`../../${path}`',
    reason: 'digests its literal server-relative sources, included by the literal scan' },
  { file: 'server/src/engine/HorsePhase13PolicyDigest.ts', match: 'new URL(`../../${path}`',
    reason: 'digests its literal server-relative sources, included by the literal scan' },
  { file: 'server/src/engine/HorseCatastropheGuardPolicyDigest.ts', match: 'new URL(`../../${path}`',
    reason: 'digests its literal server-relative sources, included by the literal scan' },
  { file: 'server/src/engine/HorseFeatureAuthority.ts', match: 'new URL(`../../${p}`',
    reason: 'reads its literal server-relative sources, included by the literal scan' },
  { file: 'server/src/engine/HorseQualifiedAuthority.ts', match: 'new URL(`../../${RELEASE_EVIDENCE_DIRECTORY}${relativePath}`',
    reason: 'reads shipped evidence; server/release-evidence/ is a CLOSURE_DIRECTORY' },
  { file: 'server/src/engine/HorseQualifiedAuthority.ts', match: 'new URL(`../../../${relativePath}`',
    reason: 'source/test fallback to the repository copy of the same evidence; the engine image has no repository root, and the shipped copy is byte-identical (aSelectedPackShipsItsEvidence law)' },
  { file: 'server/src/engine/HorseQualifiedAuthority.ts', match: 'readFileSync(',
    reason: 'the two evidence readers above' },
  { file: 'server/src/services/horseCorrectiveReview/kernelPolicyDigest.ts', match: "new URL('../../../' + path",
    reason: 'digests its literal CORRECTIVE_KERNEL_POLICY_SOURCE_FILES (server-relative), included by the literal scan' },
  { file: 'server/src/benchmark/HorseTournamentFlagQualification.ts', match: 'readFileSync(resolve(root,',
    reason: 'reads literal repository paths (lock files, workflow, plan), included by the literal scan' },
  { file: 'server/src/gto/SolverPolicyArtifactLoader.ts', match: "readFileSync(filePath, 'utf8')",
    reason: 'explicit operator-supplied artifact file; never called by the evaluator or the live decision lane' },
  { file: 'server/scripts/build-public-hist215-native.mjs', match: 'readFileSync(path)',
    reason: 'hashes the native kernel source and its build output; the source is a CLOSURE_EXTRA' },
  // Offline tools whose BYTES are digested by HorseTournamentCatastropheGuardAuthority (a literal
  // source list), so they are in the closure as data; their own file reads never run in a decision.
  ...['? readdirSync(dir)', "readFileSync(file, 'utf8')", 'readFileSync(path.join(dir,', 'readFileSync(from)',
    'readFileSync(path.join(sourceRepo, file))', 'readdirSync(runsDir)',
    "await import(pathToFileURL(path.join(path.dirname(entry), 'index.mjs')).href)"].map((match) => ({
    file: 'server/scripts/phase8-strength-assemble.mjs', match,
    reason: 'offline assembler digested as a source file by the catastrophe-guard authority; not executed by a decision' })),
  ...["readFile(resolve(serverRoot, 'package-lock.json'))", 'readFile(resolve(serverRoot, path))'].map((match) => ({
    file: 'server/src/scripts/horseTournamentEvaluate.ts', match,
    reason: 'offline evaluator digested as a source file by the catastrophe-guard authority; it hashes literal sources included by the literal scan' })),
]);
/** Runtime state (journals, /proc, operator directories): never repository content. */
export const RUNTIME_STATE_FILES = Object.freeze([
  'server/src/observability/processMemory.ts',
  'server/src/services/horseDecisionJournal/config.ts',
  'server/src/services/horseDecisionJournal/store.ts',
  'server/src/services/supabase/client.ts',
  'server/src/services/supabase/enginePgSession.ts',
  'server/src/scripts/reloadPublic215Stores.ts',
]);

const IMPORTS = /(?:import|export)[^'"`;]*?from\s*(['"])([^'"]+)\1|import\(\s*(['"])([^'"]+)\3\s*\)|require\(\s*(['"])([^'"]+)\5\s*\)|new URL\(\s*(['"])([^'"]+)\7\s*,\s*import\.meta\.url|import\s+(['"])([^'"]+)\9/g;
const LITERAL_PATHS = /['"`]((?:\.{1,2}\/)*[A-Za-z0-9_@.][\w@.\/-]*\.(?:ts|tsx|mts|js|mjs|cjs|json|cc|h|sql|yml|yaml|bin))['"`]/g;
const DYNAMIC = [
  /import\(\s*(?!['"])/, /require\(\s*(?!['"])/, /new URL\(\s*(?!['"]).*import\.meta\.url|new URL\(\s*`[^`]*\$\{/,
  /new URL\(\s*$/, /new Worker\(\s*(?!new URL\(\s*['"])/, /\bfork\(/, /\b(?:readFileSync|readFile|createReadStream|readdirSync)\(/,
];

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30, timeout: 120000 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed for the decision closure`);
  return result.stdout;
}

/** path -> blob id of every file in the repository at the commit. */
export function treeBlobs(repo, sha) {
  if (!SHA.test(sha ?? '')) throw new Error('A full engine commit is required');
  const blobs = new Map();
  for (const line of git(repo, ['ls-tree', '-r', '--full-tree', sha]).split('\n')) {
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
    if (part === '..') { if (!out.length) return null; out.pop(); } else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function resolveSpec(blobs, from, spec) {
  const base = normalize(from, spec);
  if (base === null) return undefined;
  return [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base.replace(/\.mjs$/, '.mts'), `${base}.ts`,
    `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`].find((path) => blobs.has(path));
}

/** Build outputs a literal names but git never holds; each is produced from a closure file. */
export const BUILD_OUTPUTS = Object.freeze({
  'server/native/build/public_hist215_wtl.node': 'compiled from server/native/public_hist215_wtl.cc (CLOSURE_EXTRAS)',
});

/** A specifier ending in '/' names a directory root (resolve(root, literal) reads are scanned as literals). */
function isDirectory(blobs, dir) {
  if (dir === null) return false;
  if (dir === '') return true;
  for (const key of blobs.keys()) if (key.startsWith(`${dir}/`)) return true;
  return false;
}

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

/** Scan one closure file: followed specifiers, included literal paths, unresolved specifiers and dynamic sites. */
export function scanSource(blobs, path, source) {
  const code = stripComments(source);
  const follow = new Set();
  const errors = [];
  for (const m of code.matchAll(IMPORTS)) {
    const spec = m[2] ?? m[4] ?? m[6] ?? m[8] ?? m[10];
    if (!spec || !spec.startsWith('.')) continue;
    const resolved = resolveSpec(blobs, path, spec);
    if (resolved) follow.add(resolved);
    else if (spec.endsWith('/') && isDirectory(blobs, normalize(path, spec))) continue;
    else if (!Object.hasOwn(BUILD_OUTPUTS, normalize(path, spec) ?? '')) errors.push(`unresolved ${path}: ${spec}`);
  }
  for (const m of code.matchAll(LITERAL_PATHS)) {
    const literal = m[1];
    for (const candidate of literal.startsWith('.') ? [normalize(path, literal)] : [`server/${literal}`, literal])
      if (candidate && blobs.has(candidate)) follow.add(candidate);
  }
  if (!RUNTIME_STATE_FILES.includes(path)) {
    for (const line of code.split('\n')) {
      if (!DYNAMIC.some((pattern) => pattern.test(line))) continue;
      if (!DYNAMIC_SITES.some((site) => site.file === path && line.includes(site.match)))
        errors.push(`dynamic ${path}: ${line.trim().slice(0, 160)}`);
    }
  }
  return { follow: [...follow], errors };
}

/**
 * The closure at one commit: { files: {path: blob|null}, errors: [...] }.
 * A missing entry is recorded as absent (an older serving engine).
 */
export function decisionClosure(repo, sha) {
  const blobs = treeBlobs(repo, sha);
  const seen = new Set();
  const errors = [];
  let frontier = [...CLOSURE_ENTRIES.filter((entry) => blobs.has(entry)),
    ...[...blobs.keys()].filter((path) => CLOSURE_DIRECTORIES.some((dir) => path.startsWith(dir)))];
  while (frontier.length) {
    const fresh = [...new Set(frontier)].filter((path) => !seen.has(path));
    for (const path of fresh) seen.add(path);
    const sources = readBlobs(repo, fresh.filter((path) => /\.(?:m?[jt]sx?|cjs)$/.test(path) && !path.endsWith('.d.ts'))
      .map((path) => [path, blobs.get(path)]));
    frontier = [];
    for (const [path, source] of sources) {
      const scan = scanSource(blobs, path, source);
      errors.push(...scan.errors);
      frontier.push(...scan.follow.filter((next) => !seen.has(next)));
    }
  }
  const files = {};
  for (const path of [...seen, ...CLOSURE_ENTRIES, ...CLOSURE_EXTRAS].sort()) files[path] = blobs.get(path) ?? null;
  return { files, errors: errors.sort() };
}

export function closureComplete(closure) {
  return CLOSURE_ENTRIES.every((entry) => typeof closure?.files?.[entry] === 'string');
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
 * commit and the serving commit. Both closures are computed, so an import
 * added or removed on either side is a difference. A pin whose closure has an
 * unacknowledged dynamic or unresolved path is refused; a serving commit with
 * one is incompatible.
 */
export function closureCompatible(repo, pinSha, servingSha) {
  const pin = decisionClosure(repo, pinSha);
  if (!closureComplete(pin)) throw new Error('The pinned engine commit lacks the V31 evaluation and decision entries');
  if (pin.errors.length)
    throw new Error(`The pinned engine closure is not closed: ${pin.errors.slice(0, 5).join('; ')}`);
  const serving = pinSha === servingSha ? pin : decisionClosure(repo, servingSha);
  const differences = [...closureDifferences(pin.files, serving.files), ...serving.errors.map((e) => `closure-error ${e}`)];
  return {
    compatible: differences.length === 0,
    pin: { commit: pinSha, files: Object.keys(pin.files).length, digest: closureDigest(pin.files) },
    serving: { commit: servingSha, files: Object.keys(serving.files).length, digest: closureDigest(serving.files) },
    differences: differences.slice(0, 50),
    differenceCount: differences.length,
  };
}
