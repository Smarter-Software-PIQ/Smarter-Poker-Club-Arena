/**
 * LAW: THE LOCAL GATE RUNS THE TITLE CASE CHECK ON EVERY TREE THE CHECK READS (2026-11-20).
 *
 * scripts/ci/check-title-case.mjs walks src/ AND server/src (receipt labels and every string the server says are
 * copy). .husky/pre-push ran it only when the push touched src/, package.json, the guards or .husky/, so a push
 * that touched only server/src skipped it: on 2026-11-20 #11515 passed a full local gate and was then refused by
 * hosted CI for three engine receipt labels (OmahaMathCore.ts, OmahaMathCorePreflop.ts,
 * OmahaMathCoreRangeTrack.ts). The guard's trigger now includes server/src/, and this law holds the two in step:
 * every source root the check walks is a trigger of the pre-push guard.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** The path pattern of copy_case_guard() in .husky/pre-push: the grep -qE that decides whether the guard runs. */
function guardTrigger(hook: string): RegExp {
  const body = /copy_case_guard\(\) \{([\s\S]*?)\n\}/.exec(hook);
  if (!body) throw new Error('.husky/pre-push has no copy_case_guard()');
  const pattern = /grep -qE '([^']+)'/.exec(body[1]!);
  if (!pattern) throw new Error('copy_case_guard() has no grep -qE trigger');
  return new RegExp(pattern[1]!);
}

describe('LAW: the local gate runs the title case check on every tree the check reads', () => {
  const hook = read('.husky/pre-push');
  const trigger = guardTrigger(hook);

  it('the pre-push hook runs check-title-case through copy_case_guard', () => {
    expect(hook).toMatch(/^copy_case_guard scripts\/ci\/check-title-case\.mjs$/m);
  });

  it('check-title-case walks src/ and server/src', () => {
    const check = read('scripts/ci/check-title-case.mjs');
    expect(check).toMatch(/join\(ROOT, 'server\/src'\)/);
  });

  it('a push that touches only server/src runs the guard, as does one that touches only src/', () => {
    for (const path of [
      'server/src/engine/omahaMathCore/OmahaMathCore.ts',
      'server/src/engine/HorseLogic.ts',
      'src/components/Example.tsx',
      'package.json',
      '.husky/pre-push',
    ])
      expect(trigger.test(path), path).toBe(true);
  });

  it('a prose-only push still does not run it', () => {
    for (const path of ['docs/laws.d/example.md', 'supabase/migrations/20261120000000_example.sql'])
      expect(trigger.test(path), path).toBe(false);
  });
});
