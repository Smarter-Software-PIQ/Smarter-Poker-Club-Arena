/**
 * HOLD'EM PERSONA RE-RAISE PROBE, command line (see
 * src/benchmark/HoldemPersonaReRaiseProbe.ts). Option holdemPersonaReRaiseMix
 * on and off on the same code, opportunity-weighted, per archetype.
 *
 *     cd server && npx tsx scripts/holdem-persona-reraise-probe.ts
 *     SEATS=9 MODE=cash DEPTH=100 HANDS=700 SEED=20261114 npx tsx scripts/holdem-persona-reraise-probe.ts
 *     MODE=tournament DEPTH=20-40 ...   # the stacks the 26-35bb reshove needs
 *     JSON=1 ...                        # the report as JSON
 *
 * HANDS is per table per seat rotation: the default 700 is 630,000 hands per
 * arm nine-handed. No database and no solver store are read.
 */
import {
  formatPersonaReRaiseReport,
  measurePersonaReRaise,
} from '../src/benchmark/HoldemPersonaReRaiseProbe.js';

const mode = process.env.MODE === 'tournament' ? 'tournament' : 'cash';
const depthRaw = process.env.DEPTH ?? (mode === 'cash' ? '100' : '20-40');
const depthBB = depthRaw.includes('-')
  ? ([Number(depthRaw.split('-')[0]), Number(depthRaw.split('-')[1])] as const)
  : Number(depthRaw);
const report = measurePersonaReRaise({
  seats: Number(process.env.SEATS ?? 9),
  mode,
  depthBB,
  handsPerRotation: Number(process.env.HANDS ?? 700),
  seed: Number(process.env.SEED ?? 20261114),
});
console.log(process.env.JSON === '1' ? JSON.stringify(report) : formatPersonaReRaiseReport(report));
process.exit(0);
