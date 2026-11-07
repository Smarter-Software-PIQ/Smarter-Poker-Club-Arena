/**
 * Offline duplicate-deal measurement of the three dormant river bluff skills
 * (Item 25, 2026-11-07) on top of the default-on river layers, through the
 * #9841 harness (RiverBluffBaselineLeague.ts). Arm A switches the skill on;
 * arm B is current main as it plays (every default-on layer on, the skill
 * off). Development measurement only: no database client credential, no
 * scheduled service, no production writer, and no promotion authority.
 *
 *   npx tsx src/scripts/riverBluffSkillLeague.ts --skill=v54RiverBluff \
 *     --variants=nlh,plo4 --formats=cash,tournament --pools=standard,mixed \
 *     --pairs=nlh:2000,plo4:800 --seats=2 --seed=20261108 --output=../scratch/x
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'river-bluff-skill-offline-placeholder';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--(skill|variants|formats|pools|pairs|seed|seats|output)=(.+)$/.exec(a);
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

/** The arms per skill. multiwayRiverBluffCheckRaise is measured as its
 *  maintained target composition: riverBluffCheckRaise held on in both arms
 *  (HorseFeatureAuthority multiway_river_bluff_checkraise). */
const SKILLS = {
  v54RiverBluff: {
    arms: { a: { v54RiverBluff: true }, b: {} },
    skillFeatures: ['v54_river_bluff'],
    skillPrefixes: ['v54_river_bluff', 'river_bluff_baseline'],
  },
  riverBluffCheckRaise: {
    arms: { a: { riverBluffCheckRaise: true }, b: {} },
    skillFeatures: ['river_bluff_checkraise_selected'],
    skillPrefixes: ['river_bluff_checkraise'],
  },
  multiwayRiverBluffCheckRaise: {
    arms: {
      a: { riverBluffCheckRaise: true, multiwayRiverBluffCheckRaise: true },
      b: { riverBluffCheckRaise: true },
    },
    skillFeatures: ['river_bluff_checkraise_selected'],
    skillPrefixes: ['river_bluff_checkraise'],
  },
} as const;

const skillName = args.get('skill') ?? '';
if (!Object.hasOwn(SKILLS, skillName)) throw new Error(`--skill is one of ${Object.keys(SKILLS)}`);
const skill = SKILLS[skillName as keyof typeof SKILLS];

const { enableBrainTelemetry } = await import('../engine/BrainTelemetry.js');
const { runRiverBluffBaselineCell, RBLM_VARIANTS, RBLM_FORMATS, RBLM_POOLS } =
  await import('../benchmark/RiverBluffBaselineLeague.js');

const variants = list('variants', RBLM_VARIANTS.join(','));
const formats = list('formats', RBLM_FORMATS.join(','));
const pools = list('pools', RBLM_POOLS.join(','));
const seed = Number(args.get('seed') ?? 20261108);
const seats = Number(args.get('seats') ?? 6);
if (seats !== 2 && seats !== 6) throw new Error('--seats is 2 or 6');
const out = resolve(args.get('output') ?? `scratch/river-bluff-skill-${skillName}`);
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
        skill
      );
      const tag = seats === 2 ? 'hu_' : '';
      await writeFile(
        resolve(out, `${skillName}_${tag}${v}_${f}_${pool}.json`),
        JSON.stringify({ skill: skillName, ...r }, null, 2) + '\n'
      );
      console.log(
        `${skillName} ${seats}max ${v} ${f} ${pool} pairs=${n} bb100=${r.bb100.toFixed(2)} ` +
          `se=${r.stderr.toFixed(2)} div=${r.divergentPairs} acted=${r.armA.skillHands} ` +
          `folded=${r.armA.skillFolded} fires=${JSON.stringify(r.armA.skillFires)} ` +
          `${(r.durationMs / 1000).toFixed(0)}s`
      );
    }
  }
}
// Imported engine modules keep timers alive; the measurement is complete.
process.exit(0);
