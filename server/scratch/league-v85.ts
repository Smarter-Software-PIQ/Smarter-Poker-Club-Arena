import { runMatchup, humanFieldTwin } from '../src/benchmark/HorseLeague.js';
import { HORSE_HYBRID_PROFILES } from '../src/engine/HorseHybridProfile.js';
// V85 cash action (on) against the prior ranges and sizes (off), every hero
// on the source-assigned hybrid cash profile the fleet plays.
const mods = { ...HORSE_HYBRID_PROFILES.cash.mods };
const pairs = Number(process.argv[2] ?? 6000);
const seed = Number(process.argv[3] ?? 2026111001);
const human = process.argv[4] === 'human';
const only = process.argv[5]?.split(',');
const on = {};
const off = { v85CashAction: false };
const base = { a: on, b: off, modsA: mods, modsB: mods };
const cards = [
  { name: 'nlh_v85_100bb', ...base },
  { name: 'nlh_v85_40bb', stackBB: 40, ...base },
  { name: 'nlh_v85_200bb', stackBB: 200, ...base },
  { name: 'nlh_v85_9max_100bb', seats: 9, mirrorOnly: true, ...base },
  { name: 'nlh_v85_3max_100bb', seats: 3, mirrorOnly: true, ...base },
  { name: 'nlh_v85_hu_100bb', seats: 2, mirrorOnly: true, ...base },
] as const;
for (const card of cards) {
  if (only && !only.some((o) => card.name.includes(o))) continue;
  if (human && 'mirrorOnly' in card) continue;
  const { mirrorOnly: _m, ...plain } = card as Record<string, unknown>;
  const m = human ? humanFieldTwin(plain as never) : (plain as never);
  const r = await runMatchup(m, pairs, seed);
  console.log(
    JSON.stringify({
      name: (m as { name: string }).name,
      hands: r.hands,
      bb100: +r.bb100.toFixed(2),
      stderr: +r.stderr.toFixed(2),
      divergentPairs: r.divergentPairs,
      inert: r.inert,
      illegal: r.illegalActions,
      truncated: r.truncatedStreets,
      minutes: +(r.durationMs / 60000).toFixed(1),
    })
  );
}
process.exit(0);
