/**
 * HOLD'EM PERSONA PREFLOP PROBE, command line (see
 * src/benchmark/HoldemPersonaPreflopProbe.ts). Option holdemPersonaPreflop off
 * and on, same deals, per archetype, opportunity-weighted.
 *
 *     cd server && npx tsx scripts/holdem-persona-preflop-probe.ts
 *     SEATS=9 MODE=cash DEPTH=100 HANDS=700 SEED=20261115 npx tsx scripts/holdem-persona-preflop-probe.ts
 *     JSON=1 ...   # the report as JSON
 *
 * HANDS is per table per seat rotation: the default 700 is 630,000 hands per
 * arm nine-handed. No database and no solver store are read.
 */
import {
  formatPersonaPreflopReport,
  measurePersonaPreflop,
} from '../src/benchmark/HoldemPersonaPreflopProbe.js';

const mode = process.env.MODE === 'tournament' ? 'tournament' : 'cash';
const depthRaw = process.env.DEPTH ?? '100';
const depthBB = depthRaw.includes('-')
  ? ([Number(depthRaw.split('-')[0]), Number(depthRaw.split('-')[1])] as const)
  : Number(depthRaw);
const report = measurePersonaPreflop({
  seats: Number(process.env.SEATS ?? 9),
  mode,
  depthBB,
  handsPerRotation: Number(process.env.HANDS ?? 700),
  seed: Number(process.env.SEED ?? 20261115),
});
console.log(process.env.JSON === '1' ? JSON.stringify(report) : formatPersonaPreflopReport(report));
process.exit(0);
