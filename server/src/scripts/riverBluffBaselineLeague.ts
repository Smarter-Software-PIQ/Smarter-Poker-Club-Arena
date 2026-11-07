/**
 * Offline duplicate-deal measurement of the baseline river bluff range
 * (RiverBluffBaselineLeague.ts). Development measurement only: no database
 * client credential, no scheduled service, no production writer. Each finished
 * cell is written to --output/<variant>_<format>_<pool>.json as it completes.
 *
 *   npx tsx src/scripts/riverBluffBaselineLeague.ts --variants=nlh,plo4 \
 *     --formats=cash,tournament --pools=standard,stations,folders,mixed \
 *     --pairs=nlh:6000,plo4:2000 --standard-pairs=nlh:3000,plo4:1000 \
 *     --seed=20261107 --output=../docs/horse-measure/2026-11-07/results/river-bluff-baseline
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'river-bluff-baseline-offline-placeholder';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--(variants|formats|pools|pairs|standard-pairs|seed|seats|output)=(.+)$/.exec(a);
  if (!m || args.has(m[1])) throw new Error(`Unknown or duplicate argument: ${a}`);
  args.set(m[1], m[2]);
}
const list = (k: string, d: string) => (args.get(k) ?? d).split(',').filter(Boolean);
const perVariant = (k: string): Map<string, number> =>
  new Map(
    list(k, '').map((kv) => {
      const [v, n] = kv.split(':');
      return [v, Number(n)];
    })
  );

const { enableBrainTelemetry } = await import('../engine/BrainTelemetry.js');
const { runRiverBluffBaselineCell, RBLM_VARIANTS, RBLM_FORMATS, RBLM_POOLS } =
  await import('../benchmark/RiverBluffBaselineLeague.js');

const variants = list('variants', RBLM_VARIANTS.join(','));
const formats = list('formats', RBLM_FORMATS.join(','));
const pools = list('pools', RBLM_POOLS.join(','));
const pairs = perVariant('pairs');
const standardPairs = perVariant('standard-pairs');
const seed = Number(args.get('seed') ?? 20261107);
const seats = Number(args.get('seats') ?? 6);
if (seats !== 2 && seats !== 6) throw new Error('--seats is 2 or 6');
const out = resolve(args.get('output') ?? 'scratch/river-bluff-baseline');
await mkdir(out, { recursive: true });
enableBrainTelemetry();
for (const v of variants) {
  if (!(RBLM_VARIANTS as readonly string[]).includes(v)) throw new Error(`variant ${v}`);
  for (const f of formats) {
    for (const pool of pools) {
      const n =
        (pool === 'standard' || pool === 'mixed' ? standardPairs.get(v) : undefined) ??
        pairs.get(v) ??
        1000;
      const r = await runRiverBluffBaselineCell(
        v as (typeof RBLM_VARIANTS)[number],
        f as (typeof RBLM_FORMATS)[number],
        pool as (typeof RBLM_POOLS)[number],
        n,
        seed,
        seats as 2 | 6
      );
      const tag = seats === 2 ? 'hu_' : '';
      await writeFile(
        resolve(out, `${tag}${v}_${f}_${pool}.json`),
        JSON.stringify(r, null, 2) + '\n'
      );
      console.log(
        `${seats}max ${v} ${f} ${pool} pairs=${n} bb100=${r.bb100.toFixed(2)} se=${r.stderr.toFixed(2)} ` +
          `div=${r.divergentPairs} bluffs=${r.armA.baselineBluffs} folded=${r.armA.baselineBluffsFolded} ` +
          `${(r.durationMs / 1000).toFixed(0)}s`
      );
    }
  }
}
// Imported engine modules keep timers alive; the measurement is complete.
process.exit(0);
