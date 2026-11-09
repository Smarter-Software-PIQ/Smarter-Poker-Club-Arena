/**
 * The file set the decision-closure freeze holds, computed from source.
 *
 * A closure-bound feature plan (sourceBinding 'horse-decision-closure-v1')
 * binds exactly featureAuthorityClosure() plus server/package-lock.json, and
 * both the qualification provider and runtime admission recompute that set
 * from the bytes in front of them. So the bytes a selection is admitted on are
 * exactly this set. Shared with the freeze law test through the same function,
 * so the two can never disagree. Run under tsx (it imports the TypeScript walker).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Repository-relative paths, sorted. serverRoot is the server/ directory. */
export async function closureFreezeFiles(serverRoot) {
  const { featureAuthorityClosure } = await import('../src/engine/HorseFeatureAuthority.ts');
  const closure = featureAuthorityClosure((rel) => readFileSync(path.join(serverRoot, rel)));
  return [...closure.map((p) => 'server/' + p), 'server/package-lock.json'].sort();
}

export const sha256File = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');
