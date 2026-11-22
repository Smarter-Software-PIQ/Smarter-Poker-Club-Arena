/**
 * LAW: THE SPARRING LEAGUE IS BENCHMARK-ONLY (2026-11-20)
 *
 * The sparring opponent (SparringLeague.ts) plays a measured aggressive style and the probes attack the
 * Horses on purpose. They exist to grade Horse changes offline; no live decision may ever consult them.
 * This law reads every runtime source under server/src and fails if any file outside src/benchmark
 * imports the sparring modules, and fails if any benchmark file other than the runner and the tests
 * imports them (so nothing that a nightly card or a service might load picks them up by accident).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const SPARRING =
  /from\s+['"][^'"]*\/(SparringLeague|sparringRun)(\.js)?['"]|import\(\s*['"][^'"]*\/(SparringLeague|sparringRun)(\.js)?['"]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe('the sparring league is benchmark-only', () => {
  const files = walk(SRC).map((p) => ({ p, rel: relative(SRC, p).split(sep).join('/') }));

  it('no engine, service or other runtime source imports it', () => {
    const offenders = files
      .filter((f) => !f.rel.startsWith('benchmark/'))
      .filter((f) => SPARRING.test(readFileSync(f.p, 'utf8')))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('inside src/benchmark only the runner and tests import it', () => {
    const offenders = files
      .filter((f) => f.rel.startsWith('benchmark/'))
      .filter((f) => !/\.test\.ts$/.test(f.rel) && f.rel !== 'benchmark/sparringRun.ts')
      .filter((f) => SPARRING.test(readFileSync(f.p, 'utf8')))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('the scan sees the engine (guards against an empty walk)', () => {
    expect(files.some((f) => f.rel === 'engine/HorseLogic.ts')).toBe(true);
    expect(files.some((f) => f.rel === 'benchmark/SparringLeague.ts')).toBe(true);
  });
});
