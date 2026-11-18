import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Bound simultaneous opens rather than serializing thousands of independent
// small reads. Every requested working-tree file is still read on every call.
export const MIGRATION_READ_CONCURRENCY = 16;

export async function readMigrationCorpus(directory, names) {
  if (
    !Array.isArray(names) ||
    names.some(
      (name) => typeof name !== 'string' || basename(name) !== name || !name.endsWith('.sql')
    )
  ) {
    throw new Error('migration corpus requires SQL file basenames');
  }
  const rows = new Array(names.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(MIGRATION_READ_CONCURRENCY, names.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= names.length) return;
        const name = names[index];
        rows[index] = { name, sql: await readFile(join(directory, name), 'utf8') };
      }
    })
  );
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const input = [];
    for await (const chunk of process.stdin) input.push(chunk);
    const names = JSON.parse(Buffer.concat(input).toString('utf8'));
    const rows = await readMigrationCorpus(process.argv[2], names);
    process.stdout.write(JSON.stringify(rows));
  } catch (error) {
    console.error(`Cannot read complete migration corpus: ${error.message}`);
    process.exitCode = 1;
  }
}
