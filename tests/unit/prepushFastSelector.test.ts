import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  classifyFastPath,
  exactCompanionServerTests,
  isValidRepoRelativePath,
  selectFastNonEnginePrepush,
} from '../../scripts/ci/prepush-fast-selector.mjs';

const ROOT = resolve(__dirname, '../..');
const SELECTOR_CLI = join(ROOT, 'scripts/ci/prepush-fast-selector.mjs');

const tempDirs: string[] = [];
function makeTempTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prepush-fast-selector-'));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('scripts/ci/prepush-fast-selector.mjs', () => {
  describe('isValidRepoRelativePath', () => {
    it('accepts clean repo-relative POSIX paths', () => {
      for (const p of [
        'scripts/ops/horse-fleet-status.mjs',
        'tests/unit/example.test.ts',
        'docs/laws.d/example.md',
        'server/src/benchmark/HorseLeagueCard.ts',
        'server/src/scripts/horseLeagueCard.ts',
      ]) {
        expect(isValidRepoRelativePath(p), p).toBe(true);
      }
    });

    it('rejects empty, absolute, traversal, NUL, backslash, or padded paths', () => {
      for (const bad of [
        '',
        ' ',
        ' docs/a.md',
        'docs/a.md ',
        '/etc/passwd',
        'docs/dir/',
        '../docs/a.md',
        'scripts/ops/../engine/HorseLogic.ts',
        'scripts/ops/./tool.mjs',
        'scripts/ops//tool.mjs',
        'docs/a\0b.md',
        'docs/a\nb.md',
        'docs\\a.md',
      ]) {
        expect(isValidRepoRelativePath(bad), JSON.stringify(bad)).toBe(false);
      }
    });
  });

  describe('classifyFastPath allowlist and fail-closed exclusions', () => {
    it.each([
      ['scripts/ops/horse-fleet-status.mjs', 'ops'],
      ['scripts/ops/horse_census_audit.py', 'ops'],
      ['scripts/ops/audit-merged-worktrees.sh', 'ops'],
      ['scripts/ops/HORSE-HUMAN-STUDY.md', 'ops'],
      ['scripts/ops/HORSE-HUMAN-PLAYBOOK-ENTRIES.json', 'ops'],
      ['scripts/ops/human-horse-capture/release-inventory.tsv', 'ops'],
      ['tests/unit/horseSwitchCli.test.ts', 'unit-tests'],
      ['tests/unit/nested/helper.test.mjs', 'unit-tests'],
      ['tests/unit/someRule.law.test.ts', 'unit-tests'],
      ['docs/laws.d/example.md', 'docs'],
      ['docs/changelog/2026-11-21-example.md', 'docs'],
      ['docs/notes/guide.md', 'docs'],
      ['server/src/benchmark/HorseLeagueCard.ts', 'benchmark'],
      ['server/src/benchmark/HorseLeagueCard.test.ts', 'benchmark'],
      ['server/src/benchmark/ALeagueCardDependsOnlyOnItsOwnSeed.law.test.ts', 'benchmark'],
      ['server/src/benchmark/FeatureAblationQualificationPlans.json', 'benchmark'],
      ['server/src/scripts/horseLeagueCard.ts', 'benchmark'],
      ['server/src/scripts/horseLeagueCard.test.ts', 'benchmark'],
    ] as const)('allows strictly non-engine path %s as %s', (path, category) => {
      expect(classifyFastPath(path)).toBe(category);
    });

    it.each([
      // Runtime server paths
      'server/src/engine/HorseLogic.ts',
      'server/src/engine/ServerTableEngine.ts',
      'server/src/lightning/LightningManager.ts',
      'server/src/services/supabase/handHistory.ts',
      'server/src/tournament/TournamentEngine.ts',
      'server/src/index.ts',
      'server/src/scripts/gtoV31Evaluate.ts',
      'server/src/testing/horseRegression/frame.test.mjs',
      'server/release/plan.json',
      'server/Dockerfile',
      'server/package.json',
      'server/tsconfig.json',
      // Client runtime paths
      'src/App.tsx',
      'src/services/WalletService.ts',
      'public/index.html',
      // Migrations & SQL (including SQL inside scripts/ops!)
      'supabase/migrations/20261121000000_example.sql',
      'supabase/accounting/fn.sql',
      'scripts/ops/build-cashier-totals-index-concurrently.sql',
      'scripts/ops/human-horse-capture/priors.sql.template',
      // Workflows, CI, release, hooks, self-modification
      '.github/workflows/ci.yml',
      '.github/workflows/auto-deploy-hetzner.yml',
      'scripts/ci/prepush-fast-selector.mjs',
      'scripts/ci/classify-ci-changes.mjs',
      'scripts/release/deploy.sh',
      'scripts/agent-push.sh',
      '.husky/pre-push',
      // Canonical agent policy files
      'docs/agent-policy/OWNER-POLICY.md',
      'docs/agent-policy/policy-manifest.json',
      'docs/agent-policy/agent-policy.mjs',
      // Package & build manifests
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'vitest.config.ts',
      // PG / E2E / top-level law tests
      'tests/unit/charlesRuleBigWin.pg.test.ts',
      'tests/unit/some.e2e.test.ts',
      'tests/unit/some.spec.ts',
      'tests/e2e/table.spec.ts',
      'tests/the-guards-are-wired.law.test.ts',
      // Unknown extension in scripts/ops
      'scripts/ops/unknown.bin',
    ])('fails closed (returns null) for %s', (path) => {
      expect(classifyFastPath(path), path).toBeNull();
    });
  });

  describe('selectFastNonEnginePrepush', () => {
    it('selects fast mode for strictly isolated ops + unit-tests + docs diffs', () => {
      const verdict = selectFastNonEnginePrepush([
        'scripts/ops/horse-fleet-status.mjs',
        'tests/unit/horseFleetStatus.test.ts',
        'docs/laws.d/example.md',
      ]);
      expect(verdict.fast).toBe(true);
      expect(verdict.reason).toBe('strictly_isolated_nonengine_paths');
      expect(verdict.categories).toEqual(['docs', 'ops', 'unit-tests']);
      expect(verdict.blockedPaths).toEqual([]);
      expect(verdict.needsServerTsc).toBe(false);
      expect(verdict.needsLawRegistry).toBe(true);
    });

    it('selects fast mode and exact companion server tests for benchmark-only diffs', () => {
      const tree = makeTempTree({
        'server/src/benchmark/CardHelper.ts': 'export const score = 1;\n',
        'server/src/benchmark/CardHelper.test.ts': '// companion test\n',
        'server/src/benchmark/CardHelper.law.test.ts': '// companion law\n',
        'server/src/benchmark/HorseLeagueCard.test.ts': '// league card test\n',
        'server/src/scripts/horseLeagueCard.ts': 'export const run = () => 1;\n',
      });
      const verdict = selectFastNonEnginePrepush(
        ['server/src/benchmark/CardHelper.ts', 'server/src/scripts/horseLeagueCard.ts'],
        { root: tree }
      );
      expect(verdict.fast).toBe(true);
      expect(verdict.categories).toEqual(['benchmark']);
      expect(verdict.needsServerTsc).toBe(true);
      expect(verdict.needsLawRegistry).toBe(true);
      expect(verdict.needsPhantomTableCheck).toBe(false);
      expect(verdict.exactServerTests).toEqual([
        'src/benchmark/CardHelper.law.test.ts',
        'src/benchmark/CardHelper.test.ts',
        'src/benchmark/HorseLeagueCard.test.ts',
      ]);
    });

    it('enables phantom-table check when a changed benchmark file calls .from() or .rpc()', () => {
      const tree = makeTempTree({
        'server/src/benchmark/DbReader.ts': "export const q = (sb: any) => sb.from('tables');\n",
      });
      const verdict = selectFastNonEnginePrepush(['server/src/benchmark/DbReader.ts'], {
        root: tree,
      });
      expect(verdict.fast).toBe(true);
      expect(verdict.needsPhantomTableCheck).toBe(true);
    });

    it('fails closed when even 1 path is outside the allowlist in a mixed diff', () => {
      for (const blocker of [
        'server/src/engine/HorseLogic.ts',
        'server/src/lightning/LightningManager.ts',
        'server/src/services/WalletService.ts',
        'server/src/tournament/TournamentEngine.ts',
        'server/src/index.ts',
        'src/App.tsx',
        'supabase/migrations/20261121000000_x.sql',
        '.github/workflows/ci.yml',
        'scripts/release/cutover.sh',
        'server/release/bundle.json',
        'scripts/ci/prepush-fast-selector.mjs',
        'docs/agent-policy/OWNER-POLICY.md',
        'package.json',
        'scripts/ops/build-cashier-totals-index-concurrently.sql',
        'tests/unit/charlesRuleBigWin.pg.test.ts',
      ]) {
        const verdict = selectFastNonEnginePrepush([
          'scripts/ops/horse-fleet-status.mjs',
          'docs/laws.d/example.md',
          'server/src/benchmark/HorseLeagueCard.ts',
          blocker,
        ]);
        expect(verdict.fast, blocker).toBe(false);
        expect(verdict.reason, blocker).toBe('path_outside_nonengine_allowlist');
        expect(verdict.blockedPaths, blocker).toEqual([blocker]);
      }
    });

    it('fails closed on empty, non-array, or malformed inputs', () => {
      expect(selectFastNonEnginePrepush([]).fast).toBe(false);
      expect(selectFastNonEnginePrepush(null as unknown as string[]).fast).toBe(false);
      expect(selectFastNonEnginePrepush(['scripts/ops/ok.mjs', '../bad.md']).fast).toBe(false);
    });

    it('exactCompanionServerTests returns only existing companion tests when root is provided', () => {
      const tree = makeTempTree({
        'server/src/benchmark/Alpha.ts': 'export const a = 1;\n',
        'server/src/benchmark/Alpha.test.ts': '// test\n',
      });
      expect(exactCompanionServerTests('server/src/benchmark/Alpha.ts', tree)).toEqual([
        'src/benchmark/Alpha.test.ts',
      ]);
      expect(exactCompanionServerTests('server/src/benchmark/Missing.ts', tree)).toEqual([]);
    });
  });

  describe('CLI entrypoint', () => {
    it('--is-fast exits 0 for isolated non-engine paths and 1 for mixed/runtime/empty diffs', () => {
      const fast = spawnSync(process.execPath, [SELECTOR_CLI, '--is-fast', '--stdin'], {
        input: 'scripts/ops/horse-fleet-status.mjs\nserver/src/benchmark/HorseLeagueCard.ts\n',
        encoding: 'utf8',
      });
      expect(fast.status, fast.stderr).toBe(0);

      const mixed = spawnSync(process.execPath, [SELECTOR_CLI, '--is-fast', '--stdin'], {
        input: 'scripts/ops/horse-fleet-status.mjs\nserver/src/engine/HorseLogic.ts\n',
        encoding: 'utf8',
      });
      expect(mixed.status).toBe(1);

      const empty = spawnSync(process.execPath, [SELECTOR_CLI, '--is-fast', '--stdin'], {
        input: '',
        encoding: 'utf8',
      });
      expect(empty.status).toBe(1);
    });

    it('--shell-vars emits exact structured lines and fails closed on unknown flags', () => {
      const tree = makeTempTree({
        'server/src/scripts/horseLeagueCard.ts': 'export const x = 1;\n',
        'server/src/benchmark/HorseLeagueCard.test.ts': '// test\n',
      });
      const ok = spawnSync(
        process.execPath,
        [SELECTOR_CLI, '--shell-vars', '--root', tree, '--stdin'],
        {
          input: 'server/src/scripts/horseLeagueCard.ts\n',
          encoding: 'utf8',
        }
      );
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain('FAST=yes\n');
      expect(ok.stdout).toContain('CATEGORIES=benchmark\n');
      expect(ok.stdout).toContain('NEEDS_SERVER_TSC=yes\n');
      expect(ok.stdout).toContain('NEEDS_LAW_REGISTRY=yes\n');
      expect(ok.stdout).toContain('EXACT_SRV_TEST=src/benchmark/HorseLeagueCard.test.ts\n');

      const badFlag = spawnSync(process.execPath, [SELECTOR_CLI, '--unknown-flag'], {
        encoding: 'utf8',
      });
      expect(badFlag.status).toBe(1);
    });
  });
});
