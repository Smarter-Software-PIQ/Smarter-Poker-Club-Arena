/**
 * LAW: NO CSS BEAT DEFAULT-MODE GROUP OUTGROWS A SHARD (2026-11-23)
 *
 * Playwright treats each top-level `test.describe` with `mode: 'default'` as an
 * indivisible sharding unit. When `cold observer and phone geometry` held 69
 * tests inside one top-level default-mode block while a general CSS Beat shard
 * averaged ~67 tests, any PR that shifted test counts by a few cases pushed the
 * 69-test block across a shard boundary and left an adjacent shard with 0 tests,
 * failing `scripts/ci/playwright-flaky-summary.mjs` ("the report lists no tests").
 *
 * Keep every cold default-mode family in its own bounded top-level `test.describe`
 * block (well under half a shard) so Playwright always distributes tests across
 * all 10 shards of both CSS Beat partitions without weakening the empty-report
 * guard.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const TABLE_PROPORTIONS = readFileSync(
  resolve(ROOT, 'tests/e2e/table-proportions.spec.ts'),
  'utf8'
);
const CI_YML = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
const FLAKY_SUMMARY = readFileSync(
  resolve(ROOT, 'scripts/ci/playwright-flaky-summary.mjs'),
  'utf8'
);

interface TopLevelDescribeBlock {
  title: string;
  body: string;
  isDefaultMode: boolean;
}

function extractTopLevelDescribes(source: string): TopLevelDescribeBlock[] {
  const starts: Array<{ index: number; title: string }> = [];
  const pattern = /^test\.describe\(\s*(['"`])([^'"`]+)\1/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    starts.push({ index: match.index, title: match[2] });
  }
  return starts.map((entry, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].index : source.length;
    const body = source.slice(entry.index, end);
    const isDefaultMode = /test\.describe\.configure\(\{\s*mode:\s*['"]default['"]\s*\}\)/.test(
      body
    );
    return { title: entry.title, body, isDefaultMode };
  });
}

describe('no CSS Beat default-mode group outgrows a shard', () => {
  const blocks = extractTopLevelDescribes(TABLE_PROPORTIONS);
  const defaultBlocks = blocks.filter((b) => b.isDefaultMode);

  it('splits the cold observer and phone geometry families into separate bounded top-level default-mode groups', () => {
    expect(defaultBlocks.length).toBeGreaterThanOrEqual(7);

    const families = [
      { name: 'observer canvas', marker: 'observer canvas' },
      { name: 'add-on notice containment', marker: 'registerAddOnNoticeContainmentCases()' },
      {
        name: 'observer avatar artwork allocations',
        marker: 'registerObserverAvatarSizingCases()',
      },
      {
        name: 'top-chair rail cases',
        marker: "registerObserverAvatarSizingCases('top-chair-rail')",
      },
      { name: 'scaled phone full ring', marker: 'scaled phone full ring stays longer' },
    ];

    for (const block of defaultBlocks) {
      const matched = families.filter((f) => block.body.includes(f.marker));
      expect(
        matched.length,
        `top-level default-mode group "${block.title}" combines multiple cold families (${matched.map((m) => m.name).join(', ')}); keep each family in its own top-level describe so Playwright never hands an empty shard`
      ).toBeLessThanOrEqual(1);
    }

    for (const family of families) {
      const owners = defaultBlocks.filter((b) => b.body.includes(family.marker));
      expect(
        owners.length,
        `expected exactly one bounded top-level default-mode group to own ${family.name}`
      ).toBe(1);
    }
  });

  it('keeps the empty-report guard intact in playwright-flaky-summary.mjs and 10 shards in ci.yml', () => {
    expect(FLAKY_SUMMARY).toContain(
      "if (tests.length === 0) throw new Error('the report lists no tests')"
    );
    expect(CI_YML).toContain('--shard=${{ matrix.shard }}/10');
  });
});
