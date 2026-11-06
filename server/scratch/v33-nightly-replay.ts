// Replays one nightly league row with the nightly worker's exact seed and card.
// Usage: npx tsx scratch/v33-nightly-replay.ts <card> <runDate> [pairs]
import { readFileSync } from 'node:fs';
import { setGtoCharts, gtoChartCount } from '../src/engine/GtoCharts.js';
import { replaceGtoPostflop, gtoPostflopCount } from '../src/engine/GtoPostflop.js';
import { runMatchup, LEAGUE_MATCHUPS } from '../src/benchmark/HorseLeague.js';
if (process.env.GTO_ROWS) {
  const charts = JSON.parse(readFileSync(`${process.env.GTO_ROWS}/chart_store.json`, 'utf8'));
  setGtoCharts(charts.rows);
  const pf = JSON.parse(readFileSync(`${process.env.GTO_ROWS}/postflop_store.json`, 'utf8'));
  replaceGtoPostflop(pf.rows, pf.boundary.after.latestBuiltAt);
}
const hash32 = (s: string) => {
  let h = 17;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const name = process.argv[2];
const date = process.argv[3];
const m = LEAGUE_MATCHUPS.find((x) => x.name === name)!;
const pairs = Number(process.argv[4] ?? m.pairs ?? 4000);
const runSeed = (Date.parse(date) / 86_400_000) >>> 0;
const r = await runMatchup(m, pairs, runSeed ^ hash32(m.name));
console.log(
  JSON.stringify({
    name,
    date,
    gto: `${gtoChartCount()}/${gtoPostflopCount()}`,
    pairs,
    hands: r.hands,
    bb100: +r.bb100.toFixed(2),
    stderr: +r.stderr.toFixed(2),
    div: r.divergentPairs,
    ms: r.durationMs,
  })
);
process.exit(0);
