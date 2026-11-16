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
  ACCOUNTING_HARNESS_READS,
  accountingJobInputs,
  classifyChangedPaths,
} from '../../scripts/ci/classify-ci-changes.mjs';
import { generatedAccountingHarnessReads } from '../../scripts/ci/accounting-harness-reads.mjs';

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

  // 2026-11-15: #10888 changed the cashier release contract and its fixture;
  // neither is named in the block, the change admitted no job, and the promo
  // proof that reads both (started by the exact-intent harness) broke on main.
  describe('what a harness reads admits the job that runs it', () => {
    it('the committed list equals what the harnesses read today', () => {
      expect(readFileSync(join(root, ACCOUNTING_HARNESS_READS), 'utf8')).toBe(
        generatedAccountingHarnessReads(root)
      );
    }, 180_000);

    it('admits the accounting job, not the unit suite, for the #10888 files', () => {
      for (const path of [
        'scripts/verification-harness/cashier-release-contract.sql',
        'scripts/ci/fixtures/world-hub-cashier-migrations-20261114.json',
        'scripts/ci/test-promo-downline-limit-postgres.py',
      ]) {
        expect(classifyChangedPaths([path]).server, path).toBe(true);
      }
      // The routing laws keep the unit suite out of accounting-only changes.
      for (const path of [
        'scripts/verification-harness/cashier-release-contract.sql',
        'scripts/ci/test-promo-downline-limit-postgres.py',
      ]) {
        expect(classifyChangedPaths([path]).tests, path).toBe(false);
      }
    });

    it('follows a harness one named harness starts; a directory or a routing law admits nothing', () => {
      expect(named).not.toContain('scripts/ci/test-promo-downline-limit-postgres.py');
      expect(
        classifyChangedPaths(['scripts/ci/fixtures/chip-wallet-choice/setup.sql']).server
      ).toBe(true);
      // A neighbour no harness names, in a directory a harness lists.
      expect(
        classifyChangedPaths(['scripts/ci/fixtures/chip-wallet-choice/not-read-by-any-harness.md'])
          .server
      ).toBe(false);
      // tests/ci-tells-the-truth-faster.law.test.ts names this tool to keep it out.
      expect(classifyChangedPaths(['scripts/dev/diamond-test-shots.mjs']).server).toBe(false);
    });

    it('the list itself admits the job, and an unrelated file still admits nothing', () => {
      expect(classifyChangedPaths([ACCOUNTING_HARNESS_READS]).server).toBe(true);
      expect(classifyChangedPaths(['docs/changelog/x.md']).server).toBe(false);
      expect(accountingJobInputs()?.('src/App.tsx')).toBe(false);
    });
  });
});
