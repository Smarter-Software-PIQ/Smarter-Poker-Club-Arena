/**
 * LAW: a file URL is decoded before it is used as a path.
 *
 * WHY (2026-11-07). The work drive remounted as `/Volumes/SmarterWork 1`, and
 * every push from a worktree on it died in the pre-push hook with
 *
 *   ENOENT: no such file or directory, scandir '/Volumes/SmarterWork%201/.../src'
 *
 * `new URL('../../', import.meta.url).pathname` is the URL's ENCODED path: a
 * space is `%20`, so it names a directory that does not exist. Worse than the
 * crash were the silent cases: `check-ui-dollar` scanned "0 files" and passed,
 * and `check-title-case` compared `process.argv[1]` with an encoded URL, decided
 * it was not the main module, did nothing and exited 0. The same blindness
 * hid in every `import.meta.url === \`file://${process.argv[1]}\`` main check.
 *
 * The fix is the standard library's: `fileURLToPath(...)` turns a file URL into
 * a path, and `pathToFileURL(path).href` turns a path into a URL. This law
 * sweeps every tracked script and test for the hand-rolled conversions so they
 * cannot return.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SELF = 'tests/a-file-url-is-decoded-before-it-is-a-path.law.test.ts';

const ANTI_PATTERNS: Array<[string, RegExp]> = [
  // new URL(<anything>, import.meta.url).pathname  /  new URL(import.meta.url).pathname,
  // also when the call spans lines.
  [
    'URL.pathname used as a path (use fileURLToPath)',
    /new\s+URL\(\s*(?:[^()]|\([^()]*\))*?import\.meta\.url\s*,?\s*\)\s*\.pathname/g,
  ],
  // `file://${somePath}` - an unencoded path pasted into a URL (use pathToFileURL(p).href).
  ['hand-built file:// URL (use pathToFileURL)', /`file:\/\/\$\{/g],
  // import.meta.url.replace('file://', '') and friends.
  [
    'import.meta.url stripped by hand (use fileURLToPath)',
    /import\.meta\.url\s*\.\s*(?:replace|slice|substring|substr)\s*\(/g,
  ],
];

// One reviewed exception, pinned by exact text. The line compares the URL of a
// stdin-evaluated module with its fixed `[eval1]` suffix; it never reaches the
// filesystem, and the file is a byte-for-byte engine release asset.
const ALLOWED = new Set([
  'server/scripts/legacy-engine-checkpoint.mjs::new URL(import.meta.url).pathname',
]);

function findings(source: string): string[] {
  const out: string[] = [];
  for (const [, re] of ANTI_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) out.push(m[0].replace(/\s+/g, ' '));
  }
  return out;
}

const tracked = execFileSync(
  'git',
  ['ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs', '*.jsx', '*.ts', '*.tsx', '*.mts', '*.cts'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }
)
  .split('\0')
  .filter((f) => f && f !== SELF && !f.includes('node_modules/'));

describe('a file URL is decoded before it is a path', () => {
  it('the sweep recognises every hand-rolled conversion and accepts the standard ones', () => {
    const q = '`';
    const bad = [
      "const ROOT = new URL('../../', import.meta.url).pathname;",
      'const here = new URL(import.meta.url).pathname;',
      "readFileSync(new URL(\n  '../x.sql',\n  import.meta.url\n).pathname, 'utf8');",
      `if (import.meta.url === ${q}file://\${process.argv[1]}${q}) main();`,
      "const p = import.meta.url.replace('file://', '');",
    ];
    for (const sample of bad) expect(findings(sample), sample).not.toEqual([]);
    const good = [
      "const ROOT = fileURLToPath(new URL('../../', import.meta.url));",
      'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();',
      "readFileSync(new URL('./a.json', import.meta.url), 'utf8');",
      "const u = new URL(req.url, 'http://x').pathname;",
    ];
    for (const sample of good) expect(findings(sample), sample).toEqual([]);
  });

  it('the standard conversions survive a path with a space; the hand-rolled ones do not', () => {
    const dir = '/Volumes/SmarterWork 1/agent-work/wt/scripts/ci/';
    const url = pathToFileURL(dir + 'check.mjs');
    expect(fileURLToPath(new URL('../../', url))).toBe('/Volumes/SmarterWork 1/agent-work/wt/');
    expect(new URL('../../', url).pathname).not.toBe('/Volumes/SmarterWork 1/agent-work/wt/');
    expect(url.href).not.toBe(`file://${dir}check.mjs`);
  });

  it('no tracked script or test converts between file URLs and paths by hand', () => {
    expect(tracked.length).toBeGreaterThan(1000);
    const offenders: string[] = [];
    const allowedSeen = new Set<string>();
    for (const file of tracked) {
      let source: string;
      try {
        source = readFileSync(resolve(ROOT, file), 'utf8');
      } catch {
        continue; // deleted in the working tree but still in the index
      }
      for (const hit of findings(source)) {
        const key = `${file}::${hit}`;
        if (ALLOWED.has(key)) allowedSeen.add(key);
        else offenders.push(key);
      }
    }
    expect(offenders, 'use fileURLToPath(url) / pathToFileURL(path).href').toEqual([]);
    // An exception that no longer matches anything is stale: remove it.
    expect([...ALLOWED].filter((k) => !allowedSeen.has(k))).toEqual([]);
  });
});
