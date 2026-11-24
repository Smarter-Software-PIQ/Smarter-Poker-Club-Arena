import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Parallel grep lanes when ripgrep is absent: a scan is bound by per-file latency, not bytes. */
export const NATIVE_GREP_LANES = Math.max(1, Math.min(8, availableParallelism()));

// Every *.sql under `directory`, links followed (a directory link once), as paths spelled from `directory`.
function sqlFilesUnder(base, directory) {
  const files = [];
  const seen = new Set();
  const walk = (absolute, spelled) => {
    const real = realpathSync(absolute);
    if (seen.has(real)) return;
    seen.add(real);
    for (const name of readdirSync(absolute)) {
      const path = join(absolute, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path, join(spelled, name));
      else if (stat.isFile() && name.endsWith('.sql')) files.push(join(spelled, name));
    }
  };
  walk(base, directory);
  return files.sort();
}

// Read every SQL file, including ignored/untracked files and symlink targets.
// Hosted Ubuntu need not carry ripgrep. Only a missing executable admits the
// portable native grep path; permission, timeout and read errors stay failures.
//
// THE NATIVE PATH READS IN PARALLEL (2026-11-24). It was one `grep -R` over
// 7,202 files: 62.6 s warm on the shared SSD under load, past the 25 s budget
// its callers give it, so `the window rules` law failed with spawnSync grep
// ETIMEDOUT while nothing was wrong. ripgrep is fast because it reads files on
// several threads; the fallback now does the same with NATIVE_GREP_LANES grep
// processes over the same complete file list (9.4 s, same 55 matches). Every
// file is still read, and any read error still fails the whole selection.
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
  let files;
  try {
    const base = resolve(common.cwd || process.cwd(), directory);
    if (!statSync(base).isDirectory()) throw new Error('migration scan input is not a directory');
    files = sqlFilesUnder(base, directory);
  } catch (error) {
    return { error, status: 2, stdout: '', stderr: String(error) };
  }
  if (files.length === 0) return { status: 1, stdout: '', stderr: '' };
  // A batch with no match exits 1, which is not a failure; 2 or worse makes the
  // batch exit 255, which stops xargs and fails the selection (status 124).
  //
  // EACH BATCH WRITES ITS OWN FILE (2026-11-24). The lanes first shared one
  // stdout pipe. grep block-buffers a pipe, so a batch whose names outgrew one
  // buffer wrote them in pieces that interleaved with another lane's mid-line:
  // hosted CI read "h20260927163617_...sql", a name that does not exist, and
  // lost the file the "h" came from. Names now travel only through a file per
  // batch (mktemp, never a PID), read back whole after every lane has exited.
  const batch = Math.max(1, Math.ceil(files.length / (NATIVE_GREP_LANES * 4)));
  let lanes;
  try {
    lanes = mkdtempSync(join(tmpdir(), 'native-grep-lanes-'));
  } catch (error) {
    return { error, status: 2, stdout: '', stderr: String(error) };
  }
  let fallback;
  let names = '';
  try {
    fallback = runner(
      'xargs',
      [
        '-0',
        '-P',
        String(NATIVE_GREP_LANES),
        '-n',
        String(batch),
        'sh',
        '-c',
        `p=$0; d=$1; shift; o=$(mktemp "$d/batch.XXXXXX") || exit 255; grep -al ${fixed ? '-F' : '-E'} -- "$p" "$@" > "$o"; s=$?; [ "$s" -le 1 ] || exit 255`,
        pattern,
        lanes,
      ],
      { ...common, input: files.join('\0') }
    );
    if (!fallback.error && fallback.status === 0)
      for (const name of readdirSync(lanes)) names += readFileSync(join(lanes, name), 'utf8');
  } finally {
    rmSync(lanes, { recursive: true, force: true });
  }
  if (fallback.error) return fallback;
  if (fallback.status !== 0) return { ...fallback, status: 2 };
  // Anything on the shared pipe is not a name this scan can trust.
  if (fallback.stdout) return { ...fallback, status: 2 };
  const matched = names.split('\n').filter(Boolean).sort();
  const selection = {
    ...fallback,
    stdout: matched.length ? `${matched.join('\n')}\n` : '',
    status: matched.length ? 0 : 1,
  };
  // BSD grep can return1 with a read-error diagnostic. Preserve that error
  // as failure even in callers that permit1 to mean no matching declaration.
  return selection.stderr ? { ...selection, status: 2 } : selection;
}
