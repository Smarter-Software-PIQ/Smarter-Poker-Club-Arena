import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

// Read every SQL file, including ignored/untracked files and symlink targets.
// Hosted Ubuntu need not carry ripgrep. Only a missing executable admits the
// portable native grep path; permission, timeout and read errors stay failures.
export function nativeMigrationSelection(pattern, directory, options = {}) {
  const { fixed = false, runner = spawnSync, ...execution } = options;
  const common = { encoding: 'utf8', timeout: 25000, ...execution };
  const result = runner(
    'rg',
    [
      '--files-with-matches',
      '--no-ignore',
      '--follow',
      '--text',
      '--glob',
      '*.sql',
      ...(fixed ? ['--fixed-strings'] : []),
      '--',
      pattern,
      directory,
    ],
    common
  );
  if (result.error?.code !== 'ENOENT') return result;
  try {
    if (!statSync(resolve(common.cwd || process.cwd(), directory)).isDirectory())
      throw new Error('migration scan input is not a directory');
  } catch (error) {
    return { error, status: 2, stdout: '', stderr: String(error) };
  }
  const fallback = runner(
    'grep',
    [
      '-Ral',
      ...(process.platform === 'darwin' ? ['-S'] : []),
      fixed ? '-F' : '-E',
      '--include=*.sql',
      '--',
      pattern,
      directory,
    ],
    common
  );
  // BSD grep can return1 with a read-error diagnostic. Preserve that error
  // as failure even in callers that permit1 to mean no matching declaration.
  return fallback.stderr && fallback.status !== null ? { ...fallback, status: 2 } : fallback;
}
