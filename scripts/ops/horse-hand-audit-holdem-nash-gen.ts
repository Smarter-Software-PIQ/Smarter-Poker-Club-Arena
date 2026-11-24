/**
 * Regenerates scripts/ops/horse-hand-audit-holdem-nash.json, the equilibrium push/fold tables the Hold'em hand audit
 * reads a tournament jam with: the Nash V2 jam and first-caller thresholds (bubble factor 1, dead ante 0/1/2 bb,
 * 1..9 players behind) and the engine's strength order. The unit test fails when the JSON and the engine disagree.
 * Usage: npx tsx scripts/ops/horse-hand-audit-holdem-nash-gen.ts
 */
import { writeFileSync } from 'node:fs';
import { NASH_PUSH_FOLD_V2 } from '../../server/src/engine/HorseNashPushFoldV2.data.js';
import { nashV2CallUpTo, nashV2JamUpTo } from '../../server/src/engine/HorseNashPushFoldV2.js';
import { STRENGTH_ORDER } from '../../server/src/engine/HorseHoldemTournamentAllInCall.js';

export function buildNashJson() {
  const classes = NASH_PUSH_FOLD_V2.classes;
  const upTo: Record<string, number[]> = {};
  const callUpTo: Record<string, number[]> = {};
  for (let b = 1; b <= 9; b++)
    for (const a of [0, 1, 2]) {
      upTo[`${b}|${a}`] = classes.map((c) => nashV2JamUpTo(c, b, a, 1) ?? 0);
      for (const k of ['open', 'sb', 'bb'] as const)
        callUpTo[`${b}|${k}|${a}`] = classes.map((c) => nashV2CallUpTo(c, b, k, a, 1) ?? 0);
    }
  const gridMax = NASH_PUSH_FOLD_V2.depthGrid[NASH_PUSH_FOLD_V2.depthGrid.length - 1];
  return {
    source:
      'server/src/engine/HorseNashPushFoldV2.data.ts (bubble 1), STRENGTH_ORDER of HorseHoldemTournamentAllInCall.ts',
    classes,
    gridStep: 0.5,
    gridMax,
    antes: [0, 1, 2],
    upTo,
    callUpTo,
    strengthOrder: [...STRENGTH_ORDER],
  };
}

if (process.argv[1] && process.argv[1].endsWith('horse-hand-audit-holdem-nash-gen.ts')) {
  writeFileSync(
    new URL('./horse-hand-audit-holdem-nash.json', import.meta.url),
    JSON.stringify(buildNashJson())
  );
  console.log('wrote scripts/ops/horse-hand-audit-holdem-nash.json');
}
