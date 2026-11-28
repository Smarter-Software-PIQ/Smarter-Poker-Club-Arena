#!/usr/bin/env node
/**
 * #SmarterDesign - the batch history, one file per batch (2026-11-28).
 *
 *   node scripts/smarterdesign-history.mjs
 *        print the whole history in order (date, then file name)
 *   node scripts/smarterdesign-history.mjs --rescue <batch-slug>
 *        during a `git merge origin/main` that stops on the retired
 *        SMARTERDESIGN-HISTORY.md, move what THIS branch added to that file
 *        into smarterdesign-history.d/<today>-<batch-slug>.md and take main's
 *        deletion of the old file. Read the new file before you commit.
 *
 * WHY. Until 2026-11-28 the history was one shared file every batch appended
 * to, so every merge to main made every other open lane conflict on its last
 * line, and each resolution cost a full CI rerun. Two lanes that add two files
 * cannot conflict (the same rule as docs/changelog/README.md). Held by
 * tests/the-smarterdesign-history-is-one-file-per-batch.law.test.ts.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORY_DIR = 'docs/club-operations/smarterdesign-history.d';
export const RETIRED_HISTORY = 'docs/club-operations/SMARTERDESIGN-HISTORY.md';
/** YYYY-MM-DD-<batch>.md, the batch slug lowercase letters, digits and hyphens. */
export const ENTRY_RE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/** A file name whose date is a real calendar date. */
export function validEntryName(name) {
  const m = ENTRY_RE.exec(name);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The entries in print order: by date, then by file name (the name starts with the date). */
export function historyEntries(root = ROOT) {
  return readdirSync(join(root, HISTORY_DIR))
    .filter((n) => n !== 'README.md')
    .sort();
}

export function mergedHistory(root = ROOT) {
  const out = [
    '# #SmarterDesign Batch History',
    '',
    `Printed from \`${HISTORY_DIR}/\` by \`node scripts/smarterdesign-history.mjs\`. History, not`,
    'the current state: print that with `node scripts/smarterdesign-inventory.mjs`.',
    '',
  ];
  for (const name of historyEntries(root)) {
    const body = readFileSync(join(root, HISTORY_DIR, name), 'utf8').trimEnd();
    out.push(`<!-- ${name} -->`, '', body, '');
  }
  return out.join('\n');
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** What this branch added to the retired shared file, as one new batch file. */
function rescue(slug) {
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    console.error('usage: node scripts/smarterdesign-history.mjs --rescue <batch-slug>');
    console.error('  the slug is lowercase letters, digits and hyphens, eg p7-friends-and-vip');
    return 2;
  }
  let theirs;
  try {
    theirs = git('rev-parse', '-q', '--verify', 'MERGE_HEAD').trim();
  } catch {
    console.error('No merge in progress. Run `git merge origin/main` first; this moves your');
    console.error(`${RETIRED_HISTORY} lines while that merge stops on the deleted file.`);
    return 2;
  }
  const base = git('merge-base', 'HEAD', theirs).trim();
  const diff = git('diff', '--unified=0', '--no-color', base, 'HEAD', '--', RETIRED_HISTORY);
  const added = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
  while (added.length && !added[0].trim()) added.shift();
  if (!added.length) {
    console.log(`This branch added nothing to ${RETIRED_HISTORY}; taking main's deletion.`);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const rel = `${HISTORY_DIR}/${today}-${slug}.md`;
    if (existsSync(join(ROOT, rel))) {
      console.error(`${rel} already exists; choose another slug.`);
      return 2;
    }
    if (!/^## /.test(added[0])) {
      console.log(
        `NOTE: your first added line is not a "## " heading; fix ${rel} before committing.`
      );
    }
    writeFileSync(join(ROOT, rel), `${added.join('\n').trimEnd()}\n`);
    git('add', '--', rel);
    console.log(`wrote ${rel} from the ${added.length} line(s) this branch added. Read it.`);
  }
  if (existsSync(join(ROOT, RETIRED_HISTORY))) git('rm', '-q', '--', RETIRED_HISTORY);
  else git('rm', '-q', '--cached', '--ignore-unmatch', '--', RETIRED_HISTORY);
  console.log(`removed ${RETIRED_HISTORY} (main's deletion taken).`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--rescue') process.exit(rescue(args[1]));
  process.stdout.write(mergedHistory());
}
