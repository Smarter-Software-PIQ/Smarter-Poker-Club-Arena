/** Bounded offline bridge; use installed root esbuild, write no bundle or cache. */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
try {
  const input = readFileSync(0, 'utf8');
  if (input.length > 65536) throw new Error('input_limit');
  const built = await build({
    entryPoints: [
      fileURLToPath(
        new URL('../../server/src/scripts/horseRiverTerminalPrices.ts', import.meta.url)
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64')
  );
  process.stdout.write(JSON.stringify(module.riverTerminalPrices(JSON.parse(input))));
} catch {
  process.stderr.write('river_terminal_request_refused\n');
  process.exitCode = 2;
}
