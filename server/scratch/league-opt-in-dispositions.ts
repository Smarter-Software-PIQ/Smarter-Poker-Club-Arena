// 2026-11-06 opt-in dispositions: rerun each opt-in arm against the current
// production baseline (Hybrid dials via hybridBaseline, V61-V81 defaults).
// Usage: npx tsx scratch/league-opt-in-dispositions.ts <card> <pairs> <seed>
import { readFileSync } from 'node:fs';
import { setGtoCharts, gtoChartCount } from '../src/engine/GtoCharts.js';
import { replaceGtoPostflop, gtoPostflopCount } from '../src/engine/GtoPostflop.js';
import { assertCompleteGtoChartCorpus } from '../src/gto/GtoChartCorpus.js';
import {
  runMatchup,
  LEAGUE_MATCHUPS,
  UNMEASURABLE_MATCHUPS,
  type LeagueMatchup,
} from '../src/benchmark/HorseLeague.js';

const tournament = (playersLeft: number, spotsPaid: number, stackBB: number) => ({
  gameMode: 'tournament' as const,
  format: 'mtt' as const,
  ante: 0,
  tournament: {
    schemaVersion: 1 as const,
    contextStatus: 'complete' as const,
    contextIssues: [],
    playersLeft,
    spotsPaid,
    entrants: 300,
    avgStackChips: stackBB * 2,
    medianStackChips: stackBB * 2,
    seatsPerTable: 6,
    nearBubble: false,
    inMoney: false,
    payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
    currentSmallBlind: 1,
    currentBigBlind: 2,
    currentAnte: 0,
    anteType: 'none' as const,
    nextSmallBlind: 2,
    nextBigBlind: 4,
    nextAnte: 0,
    nextBlindInMin: 10,
  },
});

const extra: LeagueMatchup[] = [
  { name: 'v62_200bb', stackBB: 200, pairs: 0, a: { v62RiverBettorPolarity: true }, b: {} },
  { name: 'v62_100bb', pairs: 0, a: { v62RiverBettorPolarity: true }, b: {} },
  { name: 'v62_40bb', stackBB: 40, pairs: 0, a: { v62RiverBettorPolarity: true }, b: {} },
  {
    name: 'mtt_flat_bump_0.06_100bb',
    pairs: 0,
    context: tournament(180, 30, 100),
    a: { tournamentFlatBump: 0.06 },
    b: {},
  },
  {
    name: 'mtt_flat_bump_0.06_40bb',
    stackBB: 40,
    pairs: 0,
    context: tournament(180, 30, 40),
    a: { tournamentFlatBump: 0.06 },
    b: {},
  },
] as LeagueMatchup[];

// GTO_ROWS: a directory holding chart_store.json and postflop_store.json
// (phase6c-store-rows-v1, SELECT-exported), hydrated through the production
// store modules exactly as the nightly worker's loaders do. Without it the
// brain plays its heuristic fallback, which is not the production baseline.
let gto = 'none';
if (process.env.GTO_ROWS) {
  const charts = JSON.parse(readFileSync(`${process.env.GTO_ROWS}/chart_store.json`, 'utf8'));
  assertCompleteGtoChartCorpus(charts.rows);
  setGtoCharts(charts.rows);
  const pf = JSON.parse(readFileSync(`${process.env.GTO_ROWS}/postflop_store.json`, 'utf8'));
  if (pf.boundary.before.count !== pf.rows.length || pf.boundary.after.count !== pf.rows.length)
    throw new Error('postflop snapshot incomplete');
  replaceGtoPostflop(pf.rows, pf.boundary.after.latestBuiltAt);
  gto = `charts:${gtoChartCount()} postflop:${gtoPostflopCount()}`;
}
const name = process.argv[2];
const pairs = Number(process.argv[3] ?? 20000);
const seed = Number(process.argv[4] ?? 2026110601);
const base =
  extra.find((m) => m.name === name) ??
  LEAGUE_MATCHUPS.find((m) => m.name === name) ??
  (UNMEASURABLE_MATCHUPS.find((m) => m.name === name) as LeagueMatchup | undefined);
if (!base) throw new Error(`unknown card ${name}`);
const legacy = process.env.LEGACY_BASELINE === '1';
const card: LeagueMatchup = legacy ? { ...base } : { ...base, hybridBaseline: true };
const r = await runMatchup(card, pairs, seed);
console.log(
  JSON.stringify({
    name,
    baseline: legacy ? 'legacy-balanced' : 'hybrid',
    gto,
    seed,
    pairs,
    hands: r.hands,
    bb100: +r.bb100.toFixed(3),
    stderr: +r.stderr.toFixed(3),
    divergentPairs: r.divergentPairs,
    inert: r.inert,
    illegal: r.illegalActions,
    truncated: r.truncatedStreets,
    minutes: +(r.durationMs / 60000).toFixed(1),
  })
);
process.exit(0);
