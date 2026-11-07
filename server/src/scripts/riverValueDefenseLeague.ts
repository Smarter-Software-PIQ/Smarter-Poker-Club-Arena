/**
 * Offline duplicate-deal measurement of two unselected river skills
 * (RiverValueDefenseLeague.ts). Development measurement only: no database
 * client credential, no scheduled service, no production writer. Each finished
 * cell is written to --output/<skill>_<seats>_<variant>_<format>_<pool>.json.
 *
 *   npx tsx src/scripts/riverValueDefenseLeague.ts --skill=riverPositionDefense \
 *     --variants=nlh,plo4 --formats=cash --pools=standard,aggressors \
 *     --pairs=nlh:2000,plo4:800 --seats=2 --seed=20261107 --output=../scratch/rvdl
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'river-value-defense-offline-placeholder';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--(skill|variants|formats|pools|pairs|seed|seats|output)=(.+)$/.exec(a);
  if (!m || args.has(m[1])) throw new Error(`Unknown or duplicate argument: ${a}`);
  args.set(m[1], m[2]);
}
const list = (k: string, d: string) => (args.get(k) ?? d).split(',').filter(Boolean);
const pairs = new Map(
  list('pairs', '').map((kv) => {
    const [v, n] = kv.split(':');
    return [v, Number(n)] as const;
  })
);

const { enableBrainTelemetry } = await import('../engine/BrainTelemetry.js');
const { RBLM_VARIANTS, RBLM_FORMATS } = await import('../benchmark/RiverBluffBaselineLeague.js');
const { runRiverValueDefenseCell, RVDL_SKILLS, RVDL_POOLS } =
  await import('../benchmark/RiverValueDefenseLeague.js');

const skill = args.get('skill') ?? '';
if (!(RVDL_SKILLS as readonly string[]).includes(skill)) throw new Error(`--skill ${skill}`);
const seed = Number(args.get('seed') ?? 20261107);
const seats = Number(args.get('seats') ?? 6);
if (seats !== 2 && seats !== 6) throw new Error('--seats is 2 or 6');
const out = resolve(args.get('output') ?? 'scratch/river-value-defense');
await mkdir(out, { recursive: true });
enableBrainTelemetry();
for (const v of list('variants', RBLM_VARIANTS.join(','))) {
  if (!(RBLM_VARIANTS as readonly string[]).includes(v)) throw new Error(`variant ${v}`);
  for (const f of list('formats', RBLM_FORMATS.join(','))) {
    if (!(RBLM_FORMATS as readonly string[]).includes(f)) throw new Error(`format ${f}`);
    for (const pool of list('pools', RVDL_POOLS.join(','))) {
      if (!(RVDL_POOLS as readonly string[]).includes(pool)) throw new Error(`pool ${pool}`);
      const n = pairs.get(v) ?? 500;
      const r = await runRiverValueDefenseCell(
        skill as (typeof RVDL_SKILLS)[number],
        v as (typeof RBLM_VARIANTS)[number],
        f as (typeof RBLM_FORMATS)[number],
        pool as (typeof RVDL_POOLS)[number],
        n,
        seed,
        seats as 2 | 6
      );
      await writeFile(
        resolve(out, `${skill}_${seats}max_${v}_${f}_${pool}.json`),
        JSON.stringify(r, null, 2) + '\n'
      );
      console.log(
        `${skill} ${seats}max ${v} ${f} ${pool} pairs=${n} bb100=${r.bb100.toFixed(2)} se=${r.stderr.toFixed(2)} ` +
          `div=${r.divergentPairs} eval=${r.armA.evaluated} acted=${r.armA.acted} ` +
          `illegal=${r.illegalActions} ${(r.durationMs / 1000).toFixed(0)}s`
      );
    }
  }
}
process.exit(0);
