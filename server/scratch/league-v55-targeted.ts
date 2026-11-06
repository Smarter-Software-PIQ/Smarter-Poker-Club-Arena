// 2026-11-06 V55 targeted evaluation: spot-conditioned duplicate pairs against
// the human-calibrated Omaha development field (HorseLeagueSpotConditioned.ts).
// Usage: npx tsx scratch/league-v55-targeted.ts <plo4|plo5|plo6> <pairs> <seed> [stackBB]
import { runSpotConditionedMatchup } from '../src/benchmark/HorseLeagueSpotConditioned.js';
import { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } from '../src/benchmark/HorseLeague.js';
const variant = process.argv[2] ?? 'plo4';
const pairs = Number(process.argv[3] ?? 2000);
const seed = Number(process.argv[4] ?? 2026110641);
const stackBB = Number(process.argv[5] ?? 100);
const r = runSpotConditionedMatchup(
  {
    name: `${variant}_v55_river_trips_flat_human_omaha_dev_${stackBB}bb`,
    variant,
    stackBB,
    a: { v55OmahaRiverTripsFlat: true },
    b: {},
    opponentPopulation: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
    condition: 'omaha_river_trips',
  },
  pairs,
  seed
);
console.log(JSON.stringify({ ...r, seed, stackBB }));
process.exit(0);
