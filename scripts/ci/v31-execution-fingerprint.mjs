// THE V31 EXECUTION FINGERPRINT (2026-11-06, Phase 3 of the R8 plan).
//
// The decision closure (v31-decision-closure.mjs, ~8,900 files) names every
// file that can change a full-brain league result; it changed in 5 of 5
// recent releases, so binding a playbook to it alone strands every playbook
// within hours. The execution fingerprint names the much smaller set that
// decides what the PLAYBOOK itself does once the brain hands it a spot:
// eligibility, lookup, model inference, sampling, sizing and the receipt.
//
//   execution digest  sha256 over (path, blob) of every file reached from
//                     EXECUTION_ENTRIES by value imports and literal paths,
//                     stopping at the acknowledged BOUNDARY files (whose
//                     names, not contents, are part of the digest), plus
//                     EXECUTION_EXTRAS. Type-only imports are not followed.
//   completeness      the walk fails closed: an unresolved relative import,
//                     an unacknowledged dynamic import, a missing entry or a
//                     boundary file that is not reached refuses the digest.
//
// HorseLogic.ts is imported for types only and passes legalize in bound to
// the decision, so it is never part of the walk.
// What crosses the boundary (legalize, the RNG, the hand-class map, the
// mixture roll, the V53 hand-off reads) is behaviour, not files; the replay
// digest (server/src/scripts/gtoV31ReplayDigest.ts) runs the execution entry
// on a fixed corpus of recorded decision states and digests every output, so
// a boundary change that alters execution changes the replay digest.
//
// A playbook evaluated on commit A may be re-checked on commit B only when
// both digests are identical (the database refuses otherwise); the re-check
// then replays every certification test on B (strict: any loss retires it).
import { createHash } from 'node:crypto';
import { closureDigest, scanSource, treeBlobs } from './v31-decision-closure.mjs';
import { spawnSync } from 'node:child_process';

export const EXECUTION_FINGERPRINT_PROTOCOL = 'smarter-poker.v31-execution-fingerprint.v1';

/** The playbook's execution entry points. */
export const EXECUTION_ENTRIES = Object.freeze([
  'server/src/engine/HorseV31CertifiedPolicy.ts',
  'server/src/services/GtoPostflopV31Loader.ts',
]);
/** Inputs no source names: the native inference kernel and its build. */
export const EXECUTION_EXTRAS = Object.freeze([
  'server/native/public_hist215_wtl.cc',
  'server/scripts/build-public-hist215-native.mjs',
]);
/**
 * Files the execution calls into but does not own. The walk stops at each;
 * its behaviour on the recorded states is in the replay digest. Every entry
 * must still be reached (a stale boundary refuses).
 */
export const BOUNDARY = Object.freeze({
  'server/src/engine/HorseMind.ts': 'opponentRead for the V53 solver hand-off, only when the mind is on',
  'server/src/engine/HorseOpponentExploit.ts': 'V53 hand-off predicates over that read',
  'server/src/engine/HorseEval.ts': 'fastRandom, the seeded decision RNG the mixture roll consumes',
  'server/src/engine/BrainTelemetry.ts': 'noteFire counters; never decides',
  'server/src/engine/GtoCharts.ts': 'handClass, the hole-card class name used in the lookup key',
  'server/src/engine/GtoPostflop.ts': 'rollMix, depth buckets and the depth ceiling shared with V29/V30',
  'server/src/engine/HorseNlhOpenSize.ts': 'chipStepFor, the legal chip step in the execution-match rule',
  'server/src/services/supabase/client.ts': 'the database transport the loader reads cells through',
});
const LOADER_TRANSPORT = /^server\/src\/(services\/supabase\/|services\/RefreshLoop|lib\/|config\/)/;
const TYPE_ONLY = /\bimport\s+type\s+[^;]*?from\s+['"]([^'"]+)['"]/g;
const VALUE_IMPORT = /\b(?:import|export)\s+(?!type\b)[^;'"]*?from\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveFrom(blobs, from, spec) {
  const out = [];
  for (const part of `${from.split('/').slice(0, -1).join('/')}/${spec}`.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  const base = out.join('/');
  return [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`].find((p) => blobs.has(p)) ?? null;
}

function readBlob(repo, id) {
  const r = spawnSync('git', ['-C', repo, 'cat-file', 'blob', id], { maxBuffer: 1 << 28, timeout: 60000 });
  if (r.status !== 0) throw new Error('git cat-file failed for the execution fingerprint');
  return r.stdout.toString('utf8');
}

/** The execution set at one commit: { files, boundary, errors }. */
export function executionClosure(repo, sha) {
  const blobs = treeBlobs(repo, sha);
  const errors = [];
  const seen = new Set();
  const boundaryReached = new Set();
  const frontier = [];
  for (const entry of EXECUTION_ENTRIES) {
    if (blobs.has(entry)) frontier.push(entry);
    else errors.push(`missing entry ${entry}`);
  }
  while (frontier.length) {
    const path = frontier.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    if (!/\.(?:m?[jt]sx?)$/.test(path)) continue;
    const source = readBlob(repo, blobs.get(path));
    const scan = scanSource(blobs, path, source);
    errors.push(...scan.errors);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');
    const value = new Set();
    for (const m of code.matchAll(VALUE_IMPORT)) {
      const spec = m[1] ?? m[2];
      if (spec?.startsWith('.')) {
        const target = resolveFrom(blobs, path, spec);
        if (target) value.add(target);
      }
    }
    const typeOnly = new Set();
    for (const m of code.matchAll(TYPE_ONLY)) {
      const target = m[1].startsWith('.') ? resolveFrom(blobs, path, m[1]) : null;
      if (target && !value.has(target)) typeOnly.add(target);
    }
    for (const next of scan.follow) {
      if (typeOnly.has(next)) continue;
      if (Object.hasOwn(BOUNDARY, next)) {
        boundaryReached.add(next);
        continue;
      }
      if (LOADER_TRANSPORT.test(next) && path === 'server/src/services/GtoPostflopV31Loader.ts') {
        errors.push(`unacknowledged loader transport ${next}`);
        continue;
      }
      if (!seen.has(next)) frontier.push(next);
    }
  }
  for (const path of Object.keys(BOUNDARY))
    if (!boundaryReached.has(path)) errors.push(`stale boundary ${path}: no execution file reaches it`);
  const files = {};
  for (const path of [...seen, ...EXECUTION_EXTRAS].sort()) files[path] = blobs.get(path) ?? null;
  for (const extra of EXECUTION_EXTRAS) if (!blobs.has(extra)) errors.push(`missing extra ${extra}`);
  return { files, boundary: [...boundaryReached].sort(), errors: [...new Set(errors)].sort() };
}

/** The execution digest: file identities plus the boundary names, under the protocol. */
export function executionDigest(closure) {
  if (closure.errors.length) throw new Error(`The execution closure is not closed: ${closure.errors.slice(0, 5).join('; ')}`);
  return createHash('sha256')
    .update(`${EXECUTION_FINGERPRINT_PROTOCOL}\n${closureDigest(closure.files)}\n${closure.boundary.join('\n')}\n`)
    .digest('hex');
}

/** Pure comparison: which execution inputs differ between two commits. */
export function executionDifferences(a, b) {
  const paths = new Set([...Object.keys(a.files), ...Object.keys(b.files)]);
  const files = [...paths].sort().filter((p) => a.files[p] !== b.files[p]);
  const boundary = a.boundary.join('\n') === b.boundary.join('\n') ? [] : ['boundary list differs'];
  return [...files, ...boundary, ...b.errors.map((e) => `closure-error ${e}`)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [repo = '.', ...shas] = process.argv.slice(2);
  const out = {};
  for (const sha of shas) {
    const closure = executionClosure(repo, sha);
    out[sha] = {
      files: Object.keys(closure.files).length,
      boundary: closure.boundary,
      errors: closure.errors,
      digest: closure.errors.length ? null : executionDigest(closure),
    };
  }
  console.log(JSON.stringify(out, null, 1));
}
