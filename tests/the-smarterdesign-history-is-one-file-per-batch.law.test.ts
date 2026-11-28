/**
 * LAW: THE #SMARTERDESIGN HISTORY IS ONE FILE PER BATCH (2026-11-28).
 *
 * Until 2026-11-28 the batch history was one shared file,
 * docs/club-operations/SMARTERDESIGN-HISTORY.md, and every batch appended to
 * its end. Every merge to main therefore made every other open #SmarterDesign
 * lane conflict on its last line, and each resolution cost a full CI rerun,
 * which serialised merges. The content now lives one file per batch in
 * docs/club-operations/smarterdesign-history.d/YYYY-MM-DD-<batch>.md (the rule
 * docs/changelog/README.md already applies to changelogs), and
 * scripts/smarterdesign-history.mjs prints it in order.
 *
 * This law keeps the directory well formed so the printed history stays
 * readable, and keeps the shared file from coming back through a merge.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const DIR = 'docs/club-operations/smarterdesign-history.d';
const PRINTER = 'scripts/smarterdesign-history.mjs';
const RETIRED = 'docs/club-operations/SMARTERDESIGN-HISTORY.md';

const load = () =>
  import(/* @vite-ignore */ pathToFileURL(resolve(ROOT, PRINTER)).href) as Promise<{
    validEntryName: (name: string) => boolean;
    historyEntries: (root?: string) => string[];
    mergedHistory: (root?: string) => string;
  }>;

const names = () => readdirSync(join(ROOT, DIR)).filter((n) => n !== 'README.md');

describe('the #SmarterDesign history is one file per batch', () => {
  it('the directory exists, carries its README and holds the history', () => {
    expect(existsSync(join(ROOT, DIR, 'README.md'))).toBe(true);
    /* The split of the retired file alone made nineteen; an empty directory
       is never a readable history. */
    expect(names().length).toBeGreaterThan(15);
  });

  it('every file is named YYYY-MM-DD-<batch>.md with a real date', async () => {
    const { validEntryName } = await load();
    expect(
      names().filter((n) => !validEntryName(n)),
      `Files in ${DIR}/ are named YYYY-MM-DD-<batch>.md: a real calendar date, then the ` +
        'batch slug in lowercase letters, digits and hyphens (eg 2026-11-29-p7-friends-and-vip.md).'
    ).toEqual([]);
    expect(validEntryName('2026-02-30-x.md')).toBe(false);
    expect(validEntryName('2026-11-28-Batch_7.md')).toBe(false);
    expect(validEntryName('2026-11-28-u1-union-pages.md')).toBe(true);
  });

  it('every file opens with its batch heading at level two and carries no conflict markers', () => {
    for (const name of names()) {
      const body = readFileSync(join(ROOT, DIR, name), 'utf8');
      expect(body.split('\n')[0], `${DIR}/${name} must start with "## <batch heading>"`).toMatch(
        /^## \S/
      );
      expect(body, `${DIR}/${name} ends with one newline`).toMatch(/[^\n]\n$/);
      expect(body, `${DIR}/${name} has a merge conflict left in it`).not.toMatch(
        /^(?:<{7}|={7}|>{7})(?: |$)/m
      );
      expect(
        body.match(/^# /m),
        `${DIR}/${name} has a level-one heading; the printer owns the title`
      ).toBeNull();
    }
  });

  it('the printer prints every file once, in date then name order, under one title', async () => {
    const { historyEntries, mergedHistory } = await load();
    const order = historyEntries(ROOT);
    expect(order).toEqual([...names()].sort());
    const printed = mergedHistory(ROOT);
    expect(printed.startsWith('# #SmarterDesign Batch History\n')).toBe(true);
    let at = 0;
    for (const name of order) {
      const heading = readFileSync(join(ROOT, DIR, name), 'utf8').split('\n')[0];
      const next = printed.indexOf(`<!-- ${name} -->\n\n${heading}`, at);
      expect(next, `${name} is missing from the printed history, or out of order`).toBeGreaterThan(
        at - 1
      );
      at = next + 1;
    }
  });

  it('a change that only adds a history file still runs this law', async () => {
    const { readersOf } = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/run-docs-readers.mjs')).href
    );
    const self = 'tests/the-smarterdesign-history-is-one-file-per-batch.law.test.ts';
    expect(readersOf(ROOT, [`${DIR}/2026-11-29-new-batch.md`], [self])).toEqual([self]);
  });

  it('the retired shared file stays retired', () => {
    expect(
      existsSync(join(ROOT, RETIRED)),
      `${RETIRED} was split into ${DIR}/ on 2026-11-28. If a merge brought it back, run ` +
        '`node scripts/smarterdesign-history.mjs --rescue <batch-slug>` during the merge: it ' +
        "moves your branch's lines into a new dated file and takes main's deletion."
    ).toBe(false);
  });
});
