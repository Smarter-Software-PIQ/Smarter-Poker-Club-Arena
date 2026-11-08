/**
 * The decision-closure freeze (2026-11-08). A held-out feature qualification
 * binds the exact bytes it measured: a closure-bound plan holds exactly the
 * decision closure (HorseDecisionClosure.ts), which authenticateIncrementalPlan
 * and admitHorseFeatureAuthority both recompute and re-hash, plus
 * server/package-lock.json. Between plan registration and
 * the release that carries the selection, any change to one of them turns the
 * qualification into policy_digest_mismatch and spends a one-shot held-out
 * partition for nothing.
 *
 * While docs/evidence/feature-activation/closure-freeze.json is active, this
 * test fails any tree whose bound files differ from the frozen hashes, or whose
 * bound set differs from the frozen list (so a new or deleted file cannot slip
 * in). Lifting the freeze is a pull request that sets active:false or deletes
 * the manifest. See PUBLISHING.md "Decision-closure freeze".
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { featureAuthorityClosure, runningFeatureSourcePaths } from './HorseFeatureAuthority.js';
import { HORSE_REFERENCE_DECISION_SOURCE_FILES } from './HorseReferenceDecisionSources.js';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = path.resolve(serverRoot, '..');
const MANIFEST = 'docs/evidence/feature-activation/closure-freeze.json';

/** Exactly what a closure-bound plan binds (HorseDecisionClosure.ts) plus the
 * dependency lock; server/scripts/closure-freeze-files.mjs calls the same function. */
function boundFiles(): string[] {
  const closure = featureAuthorityClosure((rel) => readFileSync(path.join(serverRoot, rel)));
  return [...closure.map((p) => 'server/' + p), 'server/package-lock.json'].sort();
}
const sha256 = (rel: string) =>
  createHash('sha256')
    .update(readFileSync(path.join(repoRoot, rel)))
    .digest('hex');

describe('the decision-closure freeze', () => {
  const manifestPath = path.join(repoRoot, MANIFEST);
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

  it('the bound set contains every file runtime admission requires', () => {
    const bound = new Set(boundFiles());
    for (const p of [...HORSE_REFERENCE_DECISION_SOURCE_FILES, ...runningFeatureSourcePaths()])
      expect(bound.has('server/' + p), p).toBe(true);
  });

  it('a manifest is well formed whether active or lifted', () => {
    if (!manifest) return;
    expect(manifest.schema).toBe('horse-decision-closure-freeze-v1');
    expect(typeof manifest.active).toBe('boolean');
    expect(manifest.frozenAt).toMatch(/^[0-9a-f]{40}$/);
    expect(String(manifest.reason).length).toBeGreaterThan(20);
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.fileCount).toBe(manifest.files.length);
    for (const f of manifest.files) expect(f.sha256, f.path).toMatch(/^[0-9a-f]{64}$/);
  });

  it('while active, no bound file is added, removed or changed', () => {
    if (!manifest || manifest.active !== true) return;
    const frozen = manifest.files.map((f: { path: string }) => f.path);
    const current = boundFiles();
    const added = current.filter((p) => !frozen.includes(p));
    const removed = frozen.filter((p: string) => !current.includes(p));
    const changed = manifest.files
      .filter((f: { path: string }) => current.includes(f.path))
      .filter((f: { path: string; sha256: string }) => sha256(f.path) !== f.sha256)
      .map((f: { path: string }) => f.path);
    expect(
      { added, removed, changed },
      `FROZEN (${MANIFEST}, plan ${manifest.planId}): ${manifest.reason} ` +
        'Hold this change until the freeze is lifted; see PUBLISHING.md "Decision-closure freeze".'
    ).toEqual({ added: [], removed: [], changed: [] });
  });
});
