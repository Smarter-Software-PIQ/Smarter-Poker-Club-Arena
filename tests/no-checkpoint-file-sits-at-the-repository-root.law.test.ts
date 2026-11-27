/**
 * LAW - NO CHECKPOINT FILE SITS AT THE REPOSITORY ROOT
 *
 * On 2026-11-27 the root held 84 CHECKPOINT*.md files, one per finished lane
 * (CHECKPOINT-auto-top-up.md, CHECKPOINT-kings-club.md, ...). No test, script
 * or workflow read any of them; changelogs and handoffs named them as the
 * record of a lane's local evidence. They were moved with history to
 * docs/archive/checkpoints/, and this law keeps the root from collecting them
 * again: a lane's checkpoint is written under docs/archive/checkpoints/ (or in
 * the lane's own evidence folder), never at the root, where 84 of them buried
 * the files an agent is meant to read first.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function tracked(pathspec: string): string[] {
  return execFileSync('git', ['ls-files', '--', pathspec], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

describe('LAW: no checkpoint file sits at the repository root', () => {
  it('no tracked root file is named CHECKPOINT*', () => {
    const rootFiles = tracked(':(glob)*').filter((f) => !f.includes('/'));
    expect(rootFiles.length).toBeGreaterThan(10);
    const checkpoints = rootFiles.filter((f) => /^checkpoint/i.test(f));
    expect(
      checkpoints,
      'write a lane checkpoint under docs/archive/checkpoints/, not at the repository root'
    ).toEqual([]);
  });

  it('the archived checkpoints are where the root ones went', () => {
    const archived = tracked('docs/archive/checkpoints');
    expect(archived).toContain('docs/archive/checkpoints/CHECKPOINT.md');
    expect(archived.filter((f) => /\/CHECKPOINT-[^/]+\.md$/.test(f)).length).toBeGreaterThan(80);
  });
});
