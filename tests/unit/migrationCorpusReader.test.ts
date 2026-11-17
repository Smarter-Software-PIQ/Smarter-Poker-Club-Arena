import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const reader = resolve(__dirname, '../../scripts/ci/read-migration-corpus.mjs');
const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'migration-corpus-reader-'));
  directories.push(directory);
  return directory;
}
function read(directory: string, names: string[]) {
  return JSON.parse(
    execFileSync(process.execPath, [reader, directory], {
      input: JSON.stringify(names),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  );
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('the bounded corpus reader preserves current working-tree evidence', () => {
  it('returns every requested file in caller order with exact UTF8 text, including empty files', () => {
    const directory = fixture();
    const names = Array.from({ length: 65 }, (_, index) => `${index}.sql`).reverse();
    for (const [index, name] of names.entries()) {
      writeFileSync(
        join(directory, name),
        index === 0 ? '' : `-- ${name}\r\nSELECT 'é\\n"';\u0000\n`
      );
    }
    expect(read(directory, names)).toEqual(
      names.map((name) => ({ name, sql: readFileSync(join(directory, name), 'utf8') }))
    );
  });

  it('reads uncommitted edits and new files without a persisted snapshot', () => {
    const directory = fixture();
    writeFileSync(join(directory, 'one.sql'), 'SELECT 1;');
    expect(read(directory, ['one.sql'])).toEqual([{ name: 'one.sql', sql: 'SELECT 1;' }]);
    writeFileSync(join(directory, 'one.sql'), 'SELECT 2;');
    writeFileSync(join(directory, 'two.sql'), 'SELECT 3;');
    expect(read(directory, ['one.sql', 'two.sql'])).toEqual([
      { name: 'one.sql', sql: 'SELECT 2;' },
      { name: 'two.sql', sql: 'SELECT 3;' },
    ]);
  });

  it('fails the entire read when any requested source cannot be read', () => {
    const directory = fixture();
    writeFileSync(join(directory, 'one.sql'), 'SELECT 1;');
    expect(() => read(directory, ['one.sql', 'missing.sql'])).toThrow();
    expect(() => read(directory, ['../outside.sql'])).toThrow();
  });
});
