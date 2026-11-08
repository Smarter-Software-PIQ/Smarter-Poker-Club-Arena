/**
 * THE ACCOUNTING JOB NAMES ITS OWN INPUTS (2026-11-08).
 *
 * #10004 changed scripts/ci/test-horse-hand-review-atomic.py, a harness only
 * accounting_postgres runs, and every accounting shard was skipped. The
 * classifier now reads the accounting_postgres block of ci.yml: every file it
 * names admits the job (the `server` flag), and an unreadable workflow fails
 * open for any scripts/ci|dev/test-* change.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  accountingJobInputs,
  classifyChangedPaths,
} from '../../scripts/ci/classify-ci-changes.mjs';

const root = resolve(__dirname, '../..');
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const start = ci.search(/^ {2}accounting_postgres:\s*$/m);
const rest = ci.slice(start + 1);
const block = rest.slice(0, rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m));
const named = [
  ...new Set(
    block.match(
      /(?:scripts|tests|server\/scripts|operations)\/[A-Za-z0-9_./-]+\.(?:py|sh|mjs|sql|ts|js|json)/g
    ) || []
  ),
];

describe('the accounting job names its own inputs', () => {
  it('reads a real, non-empty input list from ci.yml', () => {
    expect(start).toBeGreaterThan(0);
    expect(named.length).toBeGreaterThan(100);
  });

  it('admits the job for the harness #10004 changed', () => {
    expect(named).toContain('scripts/ci/test-horse-hand-review-atomic.py');
    expect(classifyChangedPaths(['scripts/ci/test-horse-hand-review-atomic.py']).server).toBe(true);
  });

  it('admits the job for every file the accounting block names', () => {
    const missed = named.filter((p) => classifyChangedPaths([p]).server !== true);
    expect(missed).toEqual([]);
  });

  it('admits nothing new for a file the block does not name', () => {
    expect(accountingJobInputs()?.('docs/laws.d/anything.md')).toBe(false);
    expect(classifyChangedPaths(['docs/changelog/x.md']).server).toBe(false);
  });

  it('fails open when ci.yml cannot be read', () => {
    expect(accountingJobInputs(mkdtempSync(join(tmpdir(), 'no-ci-')))).toBeNull();
  });
});
