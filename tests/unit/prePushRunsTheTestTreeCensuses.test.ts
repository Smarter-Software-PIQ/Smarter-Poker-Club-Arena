/**
 * THE PRE-PUSH HOOK RUNS THE TWO CENSUSES OF THE TEST TREE (2026-11-14).
 *
 * The hook selects a contract test when the test NAMES a changed file. Two
 * contracts read every file under tests/ and name none: the law registry and
 * the source-window rule. A push that added a test selected neither, and both
 * failed first in hosted CI (#10924, #10933), fifteen minutes later.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sliceBetween } from '../helpers/sourceWindow';

const HOOK = readFileSync(resolve(__dirname, '../../.husky/pre-push'), 'utf8');

describe('pre-push', () => {
  const block = sliceBetween(
    HOOK,
    '# CENSUSES OF THE TEST TREE',
    '# A changed test can also be found as a source contract'
  );

  it('adds both censuses when a test or a law registry entry changed', () => {
    expect(block).toContain("grep -qE '^(tests/.*\\.test\\.(ts|tsx)|docs/laws\\.d/.*\\.md)$'");
    expect(block).toContain('tests/law-registry.law.test.ts');
    expect(block).toContain('tests/unit/noFixedSizeSourceWindows.test.ts');
    expect(block).toContain('CHANGED_TESTS="$CHANGED_TESTS $t"');
  });

  it('does so before the changed tests are de-duplicated and run', () => {
    const census = HOOK.indexOf('# CENSUSES OF THE TEST TREE');
    expect(census).toBeGreaterThan(-1);
    expect(census).toBeLessThan(
      HOOK.indexOf("CHANGED_TESTS=$(printf '%s\\n' $CHANGED_TESTS | sort -u)")
    );
  });
});
