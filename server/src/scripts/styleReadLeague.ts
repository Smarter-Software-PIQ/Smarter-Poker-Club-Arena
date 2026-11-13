/**
 * Offline style-read league (StyleReadLeagueField.ts through ExploiterLeague's cell): each label-shaped opponent
 * against production horses, horses with the style options OFF and then ON, same seed and deals. Development
 * measurement only: no database credential, no scheduler, no writer except the --output JSON.
 *   npx tsx src/scripts/styleReadLeague.ts --pairs=300 --seed=20261113 --output=scratch/style-league
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'style-league-offline-placeholder';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const { runExploiterCell } = await import('../benchmark/ExploiterLeague.js');
const { HorseMind } = await import('../engine/HorseMind.js');
// harness-only: the style learner records inside the league sandbox (size buckets, in-format aggression)
HorseMind.enableHarnessStyleLearning();
const BT = await import('../engine/BrainTelemetry.js');
BT.enableBrainTelemetry();
const { styleLeagueField } = await import('../benchmark/StyleReadLeagueField.js');
const pairs = Number(args.get('pairs') ?? 300);
const seed = Number(args.get('seed') ?? 20261113);
const out = resolve(args.get('output') ?? 'scratch/style-league');
const only = args.get('opponents')?.split(',');
await mkdir(out, { recursive: true });
const ON = { styleValueBettorNotManiac: true, styleBigBetHonesty: true, styleRaiseRespect: true, styleValueExtraction: true, styleFoldBluff: true, styleFoldRatePreRepair: true };
const rows: unknown[] = [];
for (const name of Object.keys(styleLeagueField())) {
  if (only && !only.includes(name)) continue;
  // telemetry on in both arms so the receipts behind telemetryOn (cap, honesty, raise respect) are counted too
  for (const [arm, horseOpts] of [['off', { telemetry: true }], ['on', { ...ON, telemetry: true }]] as const) {
    const policy = styleLeagueField()[name];
    HorseMind.clearHarnessStyleMemory();
    BT.drainFires();
    const r = await runExploiterCell({ exploiter: 'reg_tag', variant: 'nlh', seats: 6, stackBB: 100, pairs, seed, memory: 'on', horseOpts, policy });
    const fires: Record<string, number> = {};
    for (const f of BT.drainFires()) if (f.feature.startsWith('style_') && !f.feature.startsWith('style_label')) fires[f.feature] = f.fires;
    const row = { opponent: name, arm, fires, pairs, seed, opponentBb100: r.exploiterBb100, opponentSe: r.exploiterSe, edgeBb100: r.edgeBb100, edgeSe: r.edgeSe, illegal: r.illegalActions, ms: r.durationMs };
    rows.push(row);
    console.log(JSON.stringify(row));
    await writeFile(`${out}/${name}_${arm}.json`, JSON.stringify(r, null, 1));
  }
}
await writeFile(`${out}/summary.json`, JSON.stringify(rows, null, 1));
