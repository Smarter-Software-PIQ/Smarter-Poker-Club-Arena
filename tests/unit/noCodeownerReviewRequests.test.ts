import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner direction 2026-11-11: pull requests must not automatically request a
// human review. The main ruleset needs no code-owner review and no approvals,
// so CODEOWNERS entries only emailed the owner (review requested, merged).
export const assignedOwnerLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && /@\S/.test(line));

describe('CODEOWNERS requests no reviewers', () => {
  it('assigns no owner handle in any CODEOWNERS location', () => {
    for (const path of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
      if (!existsSync(path)) continue;
      expect(assignedOwnerLines(readFileSync(path, 'utf8')), path).toEqual([]);
    }
  });

  it('detects an owner assignment', () => {
    expect(assignedOwnerLines('# note @x\n/src/core/ @SmarterPoker\n')).toEqual([
      '/src/core/ @SmarterPoker',
    ]);
  });
});
