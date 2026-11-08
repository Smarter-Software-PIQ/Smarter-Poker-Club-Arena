/**
 * Offline duplicate-deal measurement of the read calibration flags
 * (2026-11-07, HorseMind DecisionReadOptions) through the RiverBluffBaseline
 * cell harness (one hero horse, five field seats; HorseLeague.playHand deals
 * and settles). Arm A turns the flag on; arm B is current main. The mixed
 * pool seats horses, the human-calibrated population, a station and an
 * over-folder, so the hero's reads of them have something to be right or
 * wrong about. Development measurement only: no database client credential,
 * no scheduled service, no production writer, no promotion authority.
 *
 *   node --import tsx src/scripts/readCalibrationLeague.ts --flag=readPostflopFoldRate \
 *     --variants=nlh --formats=cash --pools=mixed,standard --pairs=nlh:2000 \
 *     --seats=6 --seed=20261108 --output=../scratch/x
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'read-calibration-offline-placeholder';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--(flag|variants|formats|pools|pairs|seed|seats|output)=(.+)$/.exec(a);
  if (!m || args.has(m[1])) throw new Error(`Unknown or duplicate argument: ${a}`);
  args.set(m[1], m[2]);
}
const list = (k: string, d: string) => (args.get(k) ?? d).split(',').filter(Boolean);
const perVariant = new Map(
  list('pairs', '').map((kv) => {
    const [v, n] = kv.split(':');
    return [v, Number(n)] as const;
  })
);
const FLAGS = {
  readPostflopFoldRate: { a: { readPostflopFoldRate: true }, b: {} },
  readShrinkResponse: { a: { readShrinkResponse: true }, b: {} },
  readBreakEvenBluff: { a: { readBreakEvenBluff: true }, b: {} },
  readScopedShrink: { a: { readScopedShrink: true }, b: {} },
} as const;
const flagName = args.get('flag') ?? '';
if (!Object.hasOwn(FLAGS, flagName)) throw new Error(`--flag is one of ${Object.keys(FLAGS)}`);
const arms = FLAGS[flagName as keyof typeof FLAGS];

const { enableBrainTelemetry } = await import('../engine/BrainTelemetry.js');
const { runRiverBluffBaselineCell, RBLM_VARIANTS, RBLM_FORMATS, RBLM_POOLS } =
  await import('../benchmark/RiverBluffBaselineLeague.js');

const variants = list('variants', 'nlh');
const formats = list('formats', RBLM_FORMATS.join(','));
const pools = list('pools', RBLM_POOLS.join(','));
const seed = Number(args.get('seed') ?? 20261108);
const seats = Number(args.get('seats') ?? 6);
if (seats !== 2 && seats !== 6) throw new Error('--seats is 2 or 6');
const out = resolve(args.get('output') ?? `scratch/read-calibration-${flagName}`);
await mkdir(out, { recursive: true });
enableBrainTelemetry();
for (const v of variants) {
  if (!(RBLM_VARIANTS as readonly string[]).includes(v)) throw new Error(`variant ${v}`);
  for (const f of formats) {
    for (const pool of pools) {
      const n = perVariant.get(v) ?? 500;
      const r = await runRiverBluffBaselineCell(
        v as (typeof RBLM_VARIANTS)[number],
        f as (typeof RBLM_FORMATS)[number],
        pool as (typeof RBLM_POOLS)[number],
        n,
        seed,
        seats as 2 | 6,
        { arms }
      );
      const tag = seats === 2 ? 'hu_' : '';
      await writeFile(
        resolve(out, `${flagName}_${tag}${v}_${f}_${pool}.json`),
        JSON.stringify({ flag: flagName, ...r }, null, 2) + '\n'
      );
      console.log(
        `${flagName} ${seats}max ${v} ${f} ${pool} pairs=${n} bb100=${r.bb100.toFixed(2)} ` +
          `se=${r.stderr.toFixed(2)} div=${r.divergentPairs} ${(r.durationMs / 1000).toFixed(0)}s`
      );
    }
  }
}
// Imported engine modules keep timers alive; the measurement is complete.
process.exit(0);
