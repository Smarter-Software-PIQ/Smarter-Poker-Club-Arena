/**
 * LAW: non-release server scripts excluded from CONTROL_INPUTS projection()
 * are never referenced by any engine release surface, and unknown scripts
 * under server/scripts/ fail closed (remain hashed).
 *
 * Background (O9, 2026-11-22):
 * Edits to offline HUD/horse/benchmark/probe/generator scripts under
 * server/scripts/ (specifically opponent-hud-build.ts, opponent-hud-asof.ts,
 * opponent-hud-dump.ts) twice falsely disqualified certified engine candidates
 * with RC=3 ("qualification inputs differ from selected control") even though
 * no release workflow, Dockerfile, standby script, CI selector, or engine
 * release script invokes them.
 *
 * This law pins three invariants:
 *   1. server/scripts stays in CONTROL_INPUTS so every new or unknown script
 *      defaults to INCLUDED (fail-closed), and all top-level literal constants
 *      remain ast.literal_eval-parseable (PR #11732 compatibility).
 *   2. Zero files currently matched by NON_RELEASE_SERVER_SCRIPT_PREFIXES or
 *      NON_RELEASE_SERVER_SCRIPT_EXACT are referenced anywhere across the
 *      engine release surfaces (workflows, server/Dockerfile, server/standby/**,
 *      scripts/ci release helpers, and server/scripts engine release scripts).
 *   3. Must-keep runtime/release scripts are never matched by the exclusion
 *      predicate, and tests/operations/engine-prequalification.test.py passes.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '..');
const PREQUAL_REL = 'scripts/ci/read-engine-prequalification.py';
const PREQUAL_PATH = join(ROOT, PREQUAL_REL);

interface ParsedConstants {
  CONTROL_INPUTS: string[];
  CONTROL_INPUT_TEST_EXCLUDED_DIRS: string[];
  PURE_TEST_FILE_SUFFIXES: string[];
  NON_RELEASE_SERVER_SCRIPT_PREFIXES: string[];
  NON_RELEASE_SERVER_SCRIPT_EXACT: string[];
  stripLineRanges: Array<[number, number]>;
}

function parsePrequalConstantsViaAst(): ParsedConstants {
  const py = [
    'import ast, json, pathlib, sys',
    'src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")',
    'tree = ast.parse(src)',
    'wanted = {',
    '    "CONTROL_INPUTS",',
    '    "CONTROL_INPUT_TEST_EXCLUDED_DIRS",',
    '    "PURE_TEST_FILE_SUFFIXES",',
    '    "NON_RELEASE_SERVER_SCRIPT_PREFIXES",',
    '    "NON_RELEASE_SERVER_SCRIPT_EXACT",',
    '}',
    'found = {}',
    'ranges = []',
    'for node in tree.body:',
    '    if isinstance(node, ast.Assign):',
    '        for target in node.targets:',
    '            if isinstance(target, ast.Name) and target.id in wanted:',
    '                found[target.id] = list(ast.literal_eval(node.value))',
    '                if target.id in ("NON_RELEASE_SERVER_SCRIPT_PREFIXES", "NON_RELEASE_SERVER_SCRIPT_EXACT"):',
    '                    ranges.append([node.lineno, node.end_lineno])',
    'missing = sorted(wanted - set(found))',
    'assert not missing, f"missing AST literal constants: {missing}"',
    'found["stripLineRanges"] = ranges',
    'print(json.dumps(found))',
  ].join('\n');

  const res = spawnSync('python3', ['-B', '-c', py, PREQUAL_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(res.status, res.stderr || res.stdout).toBe(0);
  return JSON.parse(res.stdout) as ParsedConstants;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

function listMatchingPrefixFiles(dirRel: string, prefixes: string[]): string[] {
  const dir = join(ROOT, dirRel);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (prefixes.some((prefix) => entry.name.startsWith(prefix))) {
      out.push(`${dirRel}/${entry.name}`);
    }
  }
  return out.sort();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLineRanges(source: string, ranges: Array<[number, number]>): string {
  const lines = source.split('\n');
  return lines
    .map((line, index) => {
      const lineNo = index + 1;
      const inRange = ranges.some(([start, end]) => lineNo >= start && lineNo <= end);
      return inRange ? '' : line;
    })
    .join('\n');
}

function isNonReleaseScript(relPath: string, prefixes: string[], exact: string[]): boolean {
  if (!relPath.startsWith('server/scripts/')) return false;
  if (exact.includes(relPath)) return true;
  return prefixes.some((prefix) => relPath.startsWith(prefix) && relPath.length > prefix.length);
}

describe('non-release server scripts excluded from CONTROL_INPUTS never enter release surfaces (O9)', () => {
  const constants = parsePrequalConstantsViaAst();
  const allServerScripts = walkFiles(join(ROOT, 'server/scripts'));
  const excludedScripts = allServerScripts.filter((relPath) =>
    isNonReleaseScript(
      relPath,
      constants.NON_RELEASE_SERVER_SCRIPT_PREFIXES,
      constants.NON_RELEASE_SERVER_SCRIPT_EXACT
    )
  );

  it('keeps server/scripts, manifest, and workflows in CONTROL_INPUTS and preserves AST-parseable literal constants', () => {
    expect(constants.CONTROL_INPUTS).toContain('server/scripts');
    expect(constants.CONTROL_INPUTS).toContain('server/src/maintenance');
    expect(constants.CONTROL_INPUTS).toContain('scripts/ci/recorded-migrations.manifest.json');
    expect(constants.CONTROL_INPUTS).toContain(
      '.github/workflows/engine-release-prequalification.yml'
    );
    expect(constants.CONTROL_INPUTS).toContain('.github/workflows/stage-engine-release.yml');
    expect(constants.CONTROL_INPUTS).toContain('.github/workflows/auto-deploy-hetzner.yml');
    expect(constants.CONTROL_INPUTS).toContain('.github/workflows/backup-engine.yml');

    expect(constants.CONTROL_INPUT_TEST_EXCLUDED_DIRS).toEqual([
      'server/scripts/',
      'server/src/maintenance/',
    ]);
    expect(constants.PURE_TEST_FILE_SUFFIXES.length).toBeGreaterThan(0);

    for (const prefix of constants.NON_RELEASE_SERVER_SCRIPT_PREFIXES) {
      expect(
        prefix.startsWith('server/scripts/'),
        `prefix must stay under server/scripts/: ${prefix}`
      ).toBe(true);
      const matched = allServerScripts.filter(
        (p) => p.startsWith(prefix) && p.length > prefix.length
      );
      expect(matched.length, `prefix matched no tracked files: ${prefix}`).toBeGreaterThan(0);
    }
    for (const exactPath of constants.NON_RELEASE_SERVER_SCRIPT_EXACT) {
      expect(
        exactPath.startsWith('server/scripts/'),
        `exact path must stay under server/scripts/: ${exactPath}`
      ).toBe(true);
      expect(existsSync(join(ROOT, exactPath)), `exact excluded path missing: ${exactPath}`).toBe(
        true
      );
    }
    expect(excludedScripts).toContain('server/scripts/opponent-hud-asof.ts');
    expect(excludedScripts).toContain('server/scripts/opponent-hud-build.ts');
    expect(excludedScripts).toContain('server/scripts/opponent-hud-dump.ts');
  });

  it('never excludes any release, runtime, qualification, or unknown server/scripts file', () => {
    const mustKeepPrefixes = [
      'server/scripts/engine-',
      'server/scripts/build-engine-',
      'server/scripts/install-',
      'server/scripts/launch-',
      'server/scripts/observe-',
      'server/scripts/retain-',
      'server/scripts/collect-monitoring-',
      'server/scripts/legacy-',
      'server/scripts/main-inspector-',
      'server/scripts/phase',
      'server/scripts/qualify-',
      'server/scripts/prewarm-',
      'server/scripts/quarantine-',
      'server/scripts/reconcile-',
      'server/scripts/retained-',
      'server/scripts/retire-',
      'server/scripts/verify-recovery-',
      'server/scripts/build-public-hist215-',
      'server/scripts/privateRecordGateway',
    ];
    const mustKeepExact = [
      'server/scripts/runtime-settings-publish.ts',
      'server/scripts/switch-list-fresh-at-merge.ts',
      'server/scripts/brand-new-unknown-script.ts',
    ];

    const mustKeepFiles = new Set<string>(mustKeepExact);
    for (const file of allServerScripts) {
      if (mustKeepPrefixes.some((prefix) => file.startsWith(prefix))) {
        mustKeepFiles.add(file);
      }
    }
    expect(mustKeepFiles.size).toBeGreaterThan(20);

    const wronglyExcluded = [...mustKeepFiles].filter((file) =>
      isNonReleaseScript(
        file,
        constants.NON_RELEASE_SERVER_SCRIPT_PREFIXES,
        constants.NON_RELEASE_SERVER_SCRIPT_EXACT
      )
    );
    expect(wronglyExcluded).toEqual([]);
  });

  it('proves ZERO excluded scripts are referenced by any engine release surface', () => {
    const releaseSurfaces = new Set<string>([
      '.github/workflows/auto-deploy-hetzner.yml',
      '.github/workflows/stage-engine-release.yml',
      '.github/workflows/backup-engine.yml',
      '.github/workflows/engine-release-prequalification.yml',
      'server/Dockerfile',
    ]);

    for (const file of walkFiles(join(ROOT, 'server/standby'))) {
      releaseSurfaces.add(file);
    }
    for (const file of listMatchingPrefixFiles('scripts/ci', [
      'select-daily-engine',
      'read-engine-prequalification',
      'prestage-engine-image',
      'check-engine-doors-exist',
      'window-migration-doors',
    ])) {
      releaseSurfaces.add(file);
    }
    for (const file of listMatchingPrefixFiles('server/scripts', [
      'engine-',
      'build-engine-',
      'install-engine-',
      'launch-engine-',
      'observe-engine-',
      'retain-engine-',
      'collect-monitoring-',
      'legacy-engine-checkpoint',
      'prewarm-engine-',
      'verify-recovery-',
    ])) {
      releaseSurfaces.add(file);
    }

    expect(releaseSurfaces.size).toBeGreaterThan(25);

    const violations: string[] = [];
    for (const surface of [...releaseSurfaces].sort()) {
      const fullPath = join(ROOT, surface);
      expect(
        existsSync(fullPath) && statSync(fullPath).isFile(),
        `missing release surface: ${surface}`
      ).toBe(true);
      let content = readFileSync(fullPath, 'utf8');
      if (surface === PREQUAL_REL) {
        content = stripLineRanges(content, constants.stripLineRanges);
      }
      for (const excluded of excludedScripts) {
        const serverRel = excluded.replace(/^server\//, '');
        const base = basename(excluded);
        const tokenRe = new RegExp(`(?<![A-Za-z0-9._-])${escapeRegex(base)}(?![A-Za-z0-9._-])`);
        if (content.includes(excluded) || content.includes(serverRel) || tokenRe.test(content)) {
          violations.push(`${surface} references excluded script ${excluded}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('passes the Python engine-prequalification regression suite including O9 projection checks', () => {
    const res = spawnSync('python3', ['-B', 'tests/operations/engine-prequalification.test.py'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(res.status, res.stderr || res.stdout).toBe(0);
  }, 30000);
});
