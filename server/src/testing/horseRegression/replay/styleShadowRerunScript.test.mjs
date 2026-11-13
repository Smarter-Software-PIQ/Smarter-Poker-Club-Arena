/**
 * Review bd7a5cc2: the offline style re-run writes rows (table ids, hands) only outside the repository, after every
 * symlink on either side is resolved (finding 1), and it hands a DEEP second look the earlier FAST decisions of its
 * producer and hand (finding 4).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  originalFastCandidates,
  outputIsOutsideRepo,
} from '../../../../scripts/style-shadow-rerun.mjs';

const base = mkdtempSync(join(tmpdir(), 'style-rerun-out-'));
const repo = join(base, 'repo');
const elsewhere = join(base, 'elsewhere');
mkdirSync(join(repo, 'server'), { recursive: true });
mkdirSync(elsewhere);
symlinkSync(repo, join(base, 'link-to-repo'));
symlinkSync(join(repo, 'server'), join(elsewhere, 'link-to-server'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('style re-run output stays outside the repository', () => {
  it('refuses the repository itself and any path inside it, existing or not', () => {
    expect(outputIsOutsideRepo(repo, repo)).toBe(false);
    expect(outputIsOutsideRepo(join(repo, 'server', 'rerun-out'), repo)).toBe(false);
    expect(outputIsOutsideRepo(join(repo, 'a', 'b', 'c'), repo)).toBe(false);
  });

  it('refuses a symlinked path that lands inside the repository (the reproduced bypass)', () => {
    // tmpdir() is itself behind a symlink on macOS (/var -> /private/var), as /tmp was in the review's reproduction
    expect(outputIsOutsideRepo(join(base, 'link-to-repo', 'server', 'rerun-out'), repo)).toBe(
      false
    );
    expect(outputIsOutsideRepo(join(elsewhere, 'link-to-server', 'out'), repo)).toBe(false);
    // the root given through a symlink is resolved as well
    expect(outputIsOutsideRepo(join(repo, 'out'), join(base, 'link-to-repo'))).toBe(false);
  });

  it('accepts a real outside directory, existing or not, including a sibling whose name starts with ..', () => {
    expect(outputIsOutsideRepo(join(elsewhere, 'rerun-out'), repo)).toBe(true);
    expect(outputIsOutsideRepo(elsewhere, repo)).toBe(true);
    expect(outputIsOutsideRepo(join(repo, '..repo-out'), repo)).toBe(false);
  });
});

describe('a DEEP second look gets the earlier FAST decisions of its producer and hand', () => {
  const fast = (sequence) => ({
    producerId: 'p',
    handKey: 'h',
    sequence,
    body: '{"snapshot":{"type":"DECIDE_FAST"}}',
  });
  const byHand = new Map([['p\u0000h', [fast(1), fast(2), fast(5)]]]);
  it('only earlier FAST records, only for DEEP, at most 256', () => {
    const deep = {
      producerId: 'p',
      handKey: 'h',
      sequence: 3,
      body: '{"snapshot":{"type":"DECIDE_DEEP"}}',
    };
    expect(originalFastCandidates(deep, byHand).map((r) => r.sequence)).toEqual([1, 2]);
    expect(originalFastCandidates({ ...fast(3) }, byHand)).toEqual([]);
    const many = new Map([['p\u0000h', Array.from({ length: 300 }, (_, i) => fast(i))]]);
    const got = originalFastCandidates({ ...deep, sequence: 1000 }, many);
    expect(got).toHaveLength(256);
    expect(got[0].sequence).toBe(44);
  });
});
