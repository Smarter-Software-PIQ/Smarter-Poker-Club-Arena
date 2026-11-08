/**
 * Offline duplicate-deal ablation of each default-on bluff layer added since
 * #9841 (and the turn draw implied odds A/B) (2026-11-07 league-gap lane), through the #9841 harness
 * (RiverBluffBaselineLeague.ts). Arm A is current main as it plays; arm B
 * switches ONE layer off. Development measurement only: no database client
 * credential, no scheduled service, no production writer.
 *
 *   npx tsx src/scripts/riverLayerAblationLeague.ts --layer=multiway \
 *     --variants=plo5,plo6 --formats=cash --pools=standard,mixed \
 *     --pairs=plo5:1500,plo6:1200 --seats=6 --seed=20261109 --output=../scratch/x
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'river-layer-ablation-offline-placeholder';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--(layer|variants|formats|pools|pairs|seed|seats|output)=(.+)$/.exec(a);
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

const cross = (pre: string, xs: readonly string[], ys: readonly string[] = ['']): string[] =>
  xs.flatMap((x) => ys.map((y) => `${pre}${x}${y ? `_${y}` : ''}`));
const RIVER_SELECTIONS = ['junk', 'missedDraw', 'blocker', 'blockerAndDraw', 'freeroll'];
const RIVER_LINES = [
  'barrel',
  'initiative',
  'checkedThrough',
  'opponentGaveUp',
  'scare',
  'leadDraw',
  'leadBlank',
];
const FT_LINES = ['cbet', 'barrel', 'delayed', 'probe', 'stab'];
const FT_SELECTIONS = [
  'strongDraw',
  'pairDraw',
  'weakDraw',
  'backdoor',
  'overcards',
  'blocker',
  'junk',
];

/** Arm B per layer: that layer off, everything else as main plays it. The
 *  acting features are the receipts the layer writes when it changes the
 *  action (a bet it placed, or for the fast call-down read a bluff it cut). */
const LAYERS = {
  baseline: {
    arms: { a: {}, b: { riverBluffBaseline: false } },
    skillFeatures: cross('river_bluff_baseline_', RIVER_SELECTIONS),
    skillPrefixes: ['river_bluff_baseline_', 'river_lead_bluff_'],
  },
  lead: {
    arms: { a: {}, b: { riverLeadRange: false } },
    skillFeatures: cross('river_lead_bluff_', RIVER_LINES),
    skillPrefixes: ['river_lead_'],
  },
  multiway: {
    arms: { a: {}, b: { riverBluffMultiway: false } },
    skillFeatures: ['2way', '3way', '4way', '5way', '6way'].map(
      (w) => `river_bluff_multiway_selected_${w}`
    ),
    skillPrefixes: ['river_bluff_multiway_'],
  },
  flopTurn: {
    arms: { a: {}, b: { flopTurnBluffBaseline: false } },
    skillFeatures: cross('ft_bluff_baseline_', FT_LINES, FT_SELECTIONS),
    skillPrefixes: ['ft_bluff_baseline_'],
  },
  fastCalldown: {
    arms: { a: {}, b: { riverFastCalldown: false } },
    skillFeatures: ['river_fast_calldown_station', 'river_fast_calldown_station_multiway'],
    skillPrefixes: ['river_fast_calldown_'],
  },
  turnDraw: {
    arms: { a: {}, b: { turnDrawImpliedOdds: false } },
    skillFeatures: ['turn_draw_implied_odds'],
    skillPrefixes: ['turn_draw_implied_odds'],
  },
} as const;

const layerName = args.get('layer') ?? '';
if (!Object.hasOwn(LAYERS, layerName)) throw new Error(`--layer is one of ${Object.keys(LAYERS)}`);
const layer = LAYERS[layerName as keyof typeof LAYERS];

const { enableBrainTelemetry } = await import('../engine/BrainTelemetry.js');
const { runRiverBluffBaselineCell, RBLM_VARIANTS, RBLM_FORMATS, RBLM_POOLS } =
  await import('../benchmark/RiverBluffBaselineLeague.js');

const variants = list('variants', RBLM_VARIANTS.join(','));
const formats = list('formats', RBLM_FORMATS.join(','));
const pools = list('pools', RBLM_POOLS.join(','));
const seed = Number(args.get('seed') ?? 20261109);
const seats = Number(args.get('seats') ?? 6);
if (seats !== 2 && seats !== 6) throw new Error('--seats is 2 or 6');
const out = resolve(args.get('output') ?? `scratch/river-layer-${layerName}`);
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
        layer
      );
      const tag = seats === 2 ? 'hu_' : '';
      await writeFile(
        resolve(out, `${layerName}_${tag}${v}_${f}_${pool}.json`),
        JSON.stringify({ layer: layerName, ...r }, null, 2) + '\n'
      );
      console.log(
        `${layerName} ${seats}max ${v} ${f} ${pool} pairs=${n} bb100=${r.bb100.toFixed(2)} ` +
          `se=${r.stderr.toFixed(2)} ci=[${r.ci95[0].toFixed(2)},${r.ci95[1].toFixed(2)}] ` +
          `div=${r.divergentPairs} acted=${r.armA.skillHands} ` +
          `illegal=${r.illegalActions} trunc=${r.truncatedStreets} fb=${r.brainExceptionFallbacks} ` +
          `${(r.durationMs / 1000).toFixed(0)}s`
      );
    }
  }
}
// Imported engine modules keep timers alive; the measurement is complete.
process.exit(0);
