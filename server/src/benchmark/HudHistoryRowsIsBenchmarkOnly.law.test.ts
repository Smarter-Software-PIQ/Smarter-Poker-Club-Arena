/**
 * LAW: THE SIMULATED-HAND ROW CONVERTER IS BENCHMARK-ONLY (2026-11-21, lane OPPONENT-HUD)
 *
 * HudHistoryRows.ts manufactures hand_history-shaped rows from simulated hands so the bench can test the opponent HUD
 * with real profiles. Simulated rows must never reach a live profile, a live decision or the database: no source
 * outside src/benchmark may import it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const IMPORT =
  /from\s+['"][^'"]*\/HudHistoryRows(\.js)?['"]|import\(\s*['"][^'"]*\/HudHistoryRows(\.js)?['"]/;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe('the simulated-hand row converter is benchmark-only', () => {
  const files = walk(SRC).map((p) => ({ p, rel: relative(SRC, p).split(sep).join('/') }));
  it('no runtime source imports it', () => {
    const offenders = files
      .filter((f) => !f.rel.startsWith('benchmark/'))
      .filter((f) => IMPORT.test(readFileSync(f.p, 'utf8')))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
  it('the scan sees the engine and the converter (guards against an empty walk)', () => {
    expect(files.some((f) => f.rel === 'engine/HorseLogic.ts')).toBe(true);
    expect(files.some((f) => f.rel === 'services/OpponentHudStore.ts')).toBe(true);
    expect(files.some((f) => f.rel === 'benchmark/HudHistoryRows.ts')).toBe(true);
  });
});
