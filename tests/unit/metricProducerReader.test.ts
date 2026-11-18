import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { producerHaystack } from '../../scripts/ci/rule-metric-producers.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'metric-producer-reader-'));
  roots.push(root);
  return root;
}
function write(root: string, name: string, value: string) {
  const path = join(root, name);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, value);
}
// Independent pre-change traversal, so batching cannot silently narrow source.
function serial(root: string, dirs: string[]) {
  const parts: string[] = [];
  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          ['node_modules', 'dist', 'build', '.git', 'coverage', 'test-results', 'ci'].includes(
            entry.name
          )
        )
          continue;
        walk(path);
      } else if (
        /\.(ts|tsx|mts|cts|js|mjs|cjs|sh|sql|py)$/.test(entry.name) &&
        !/\.test\.|\.spec\./.test(entry.name)
      ) {
        try {
          if (statSync(path).size > 4_000_000) continue;
          parts.push(readFileSync(path, 'utf8'));
        } catch {
          /* unavailable bytes cannot establish a producer */
        }
      }
    }
  }
  for (const dir of dirs) walk(resolve(root, dir));
  return parts.join('\n');
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the bounded producer reader preserves source evidence', () => {
  it('matches the previous traversal, exclusions, limits, symlinks and exact source order', () => {
    const root = fixture();
    for (const [index, extension] of [
      'ts',
      'tsx',
      'mts',
      'cts',
      'js',
      'mjs',
      'cjs',
      'sh',
      'sql',
      'py',
    ].entries()) {
      write(root, `server/src/${index}.${extension}`, `emit('metric_${index}');\r\né\u0000`);
    }
    for (const directory of [
      'node_modules',
      'dist',
      'build',
      '.git',
      'coverage',
      'test-results',
      'ci',
      '.hidden',
    ]) {
      write(root, `server/src/${directory}/emit.ts`, `excluded_${directory}`);
    }
    write(root, 'server/src/.github/emit.ts', 'included_dot_github');
    write(root, 'server/src/empty.ts', '');
    write(root, 'server/src/example.test.ts', 'excluded_test');
    write(root, 'server/src/example.spec.ts', 'excluded_spec');
    write(root, 'server/src/example.json', 'excluded_json');
    write(root, 'server/src/large.ts', 'x'.repeat(4_000_001));
    write(root, 'server/src/boundary.ts', 'y'.repeat(4_000_000));
    symlinkSync(join(root, 'missing'), join(root, 'server/src/missing.ts'));
    symlinkSync(join(root, 'server/src/0.ts'), join(root, 'server/src/link.ts'));
    const dirs = ['missing', 'server/src', 'server/src'];
    expect(producerHaystack(root, dirs)).toBe(serial(root, dirs));
  });

  it('rereads edits, new files and removed producers without a persistent snapshot', () => {
    const root = fixture();
    write(root, 'server/src/one.ts', 'first');
    expect(producerHaystack(root)).toBe('first');
    write(root, 'server/src/one.ts', 'second');
    write(root, 'server/scripts/two.sh', 'third');
    expect(producerHaystack(root)).toBe('second\nthird');
    rmSync(join(root, 'server/src/one.ts'));
    expect(producerHaystack(root)).toBe('third');
    expect(producerHaystack(root, ['missing'])).toBe('');
  });
});
