import { runMatchup, humanFieldTwin } from '../src/benchmark/HorseLeague.js';
const tournament = (playersLeft: number, spotsPaid: number, stackBB: number) => ({
  gameMode: 'tournament' as const, format: 'mtt' as const, ante: 0,
  tournament: { schemaVersion: 1 as const, contextStatus: 'complete' as const, contextIssues: [], playersLeft, spotsPaid, entrants: 300, avgStackChips: stackBB * 2, medianStackChips: stackBB * 2, seatsPerTable: 6, nearBubble: false, inMoney: false, payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2], currentSmallBlind: 1, currentBigBlind: 2, currentAnte: 0, anteType: 'none' as const, nextSmallBlind: 2, nextBigBlind: 4, nextAnte: 0, nextBlindInMin: 10 },
});
const pairs = Number(process.argv[2] ?? 8000);
const seed = Number(process.argv[3] ?? 2026110683);
const mode = process.argv[4] ?? 'mirror'; // mirror | human | hybrid
const on = {}; // V83 on by default
const off = { v83AggressionNeedsBluffs: false };
const cards = [
  { name: 'nlh_v83_100bb', a: on, b: off },
  { name: 'nlh_v83_hu_80bb', seats: 2, stackBB: 80, a: on, b: off },
  { name: 'nlh_v83_40bb', stackBB: 40, a: on, b: off },
  { name: 'mtt_v83_40bb', stackBB: 40, context: tournament(180, 30, 40), a: on, b: off },
];
for (const card of cards) {
  if (mode === 'human' && card.seats === 2) continue;
  const base = { ...card, moodClock: 'deal_seed' as const, ...(mode === 'hybrid' ? { hybridBaseline: true } : {}) };
  const m = mode === 'human' ? humanFieldTwin(base as never) : (base as never);
  const r = await runMatchup(m, pairs, seed);
  console.log(JSON.stringify({ mode, name: (m as { name: string }).name, hands: r.hands, bb100: +r.bb100.toFixed(3), stderr: +r.stderr.toFixed(3), divergentPairs: r.divergentPairs, inert: r.inert, illegal: r.illegalActions, truncated: r.truncatedStreets, minutes: +(r.durationMs / 60000).toFixed(1) }));
}
process.exit(0);
