/**
 * Rebuild FIXED_LIMIT_POPULATION_ENVELOPE (HorseOpponentExploit.ts, option fixedLimitPopulationCells) from an
 * exported slice of recorded Horse-only fixed-limit CASH hands. Measurement only; public actions only.
 *
 *   node --import tsx src/scripts/fixedLimitPopulationEnvelope.ts SLICES_DIR HORSES.json OUT_DIR [CENSUS.json]
 *
 * SLICES_DIR: *.jsonl.gz files, one hand per line, in recorded order by file name then line:
 *   {"id","variant","created_at","n","uids":[...],"actions":[{"userId","stage","action","amount","origin","isFullRaise"}]}
 *   read from public.hand_history with game_variant in ('flh','flo8'), tournament_id is null, has_human = false,
 *   in a read-only transaction (the lane's tools/fl-population-export.py). No hole cards and no showdown are read.
 * HORSES.json: an object whose horses field lists the profiles.id values where is_horse = true; a hand with any other seat is skipped.
 * OUT_DIR receives measurement.json (every cell, statistic, band rule and count) and envelope.ts.txt (the rows).
 * CENSUS.json (optional): the anonymous census fixture for AFixedLimitPopulationCells.law.test.ts - per cell, every
 *   Horse's final decayed counters (EXPLOIT_COUNTER_FIELDS then EXPLOIT_LONG_FIELDS, built as the in-process learner
 *   builds them), no identities.
 */
import { createReadStream, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  envelopeSource,
  measureFixedLimitPopulation,
  type FixedLimitPopulationHand,
} from '../benchmark/FixedLimitPopulationEnvelope.js';
import { EXPLOIT_COUNTER_FIELDS, EXPLOIT_LONG_FIELDS } from '../engine/HorseOpponentExploit.js';

async function main(): Promise<void> {
  const [slicesDir, horsesPath, outDir, censusPath] = process.argv.slice(2);
  if (!slicesDir || !horsesPath || !outDir)
    throw new Error('usage: SLICES_DIR HORSES.json OUT_DIR [CENSUS.json]');
  const horses = new Set<string>(JSON.parse(readFileSync(horsesPath, 'utf8')).horses);
  const files = readdirSync(slicesDir)
    .filter((f) => f.endsWith('.jsonl.gz'))
    .sort();
  const hands: FixedLimitPopulationHand[] = [];
  let first: string | null = null;
  let last: string | null = null;
  for (const f of files) {
    const rl = createInterface({
      input: createReadStream(join(slicesDir, f)).pipe(createGunzip()),
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const h = JSON.parse(line);
      first ??= h.created_at;
      last = h.created_at;
      hands.push({
        id: h.id,
        variant: h.variant,
        n: h.n,
        uids: h.uids ?? [],
        actions: h.actions ?? null,
      });
    }
  }
  const m = measureFixedLimitPopulation(hands, (id) => horses.has(id));
  mkdirSync(outDir, { recursive: true });
  const report = {
    slices: files.length,
    firstHandAt: first,
    lastHandAt: last,
    handsRead: m.handsRead,
    handsUsed: m.handsUsed,
    handsSkipped: m.handsSkipped,
    cells: m.cells,
  };
  writeFileSync(join(outDir, 'measurement.json'), JSON.stringify(report, null, 1));
  let source = '';
  try {
    source = envelopeSource(m.cells);
  } catch (e) {
    source = `UNBUILT: ${(e as Error).message}`;
  }
  writeFileSync(join(outDir, 'envelope.ts.txt'), source + '\n');
  if (censusPath) {
    const census: Record<string, number[][]> = {};
    for (const [cell, rows] of [...m.decayed.entries()].sort(([a], [b]) => a.localeCompare(b)))
      census[cell] = [...rows.values()]
        .map((r) =>
          [...EXPLOIT_COUNTER_FIELDS, ...EXPLOIT_LONG_FIELDS].map(
            (k) => Math.round(((r[k] as number | undefined) ?? 0) * 1e4) / 1e4
          )
        )
        .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
    writeFileSync(
      censusPath,
      JSON.stringify({
        source: 'fixed-limit Horse-only cash hands, public actions only',
        firstHandAt: first,
        lastHandAt: last,
        fields: [...EXPLOIT_COUNTER_FIELDS, ...EXPLOIT_LONG_FIELDS],
        cells: census,
      })
    );
  }
  process.stdout.write(
    JSON.stringify({
      handsRead: m.handsRead,
      handsUsed: m.handsUsed,
      skipped: m.handsSkipped,
      first,
      last,
    }) + '\n'
  );
}
main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
