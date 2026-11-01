import { runMatchup, humanFieldTwin } from '../src/benchmark/HorseLeague.js';
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
const pairs = Number(process.argv[2] ?? 6000);
const seed = Number(process.argv[3] ?? 2026103172);
const human = process.argv[4] === 'human';
const on = {};
const off = { v72DefenceByOpener: false };
const only = process.argv[5]?.split(',');
const cards = [
  { name: 'nlh_v72_100bb', a: on, b: off },
  { name: 'nlh_v72_40bb', stackBB: 40, a: on, b: off },
  { name: 'nlh_v72_200bb', stackBB: 200, a: on, b: off },
  { name: 'mtt_v72_40bb', stackBB: 40, context: tournament(180, 30, 40), a: on, b: off },
  { name: 'mtt_v72_25bb', stackBB: 25, context: tournament(180, 30, 25), a: on, b: off },
] as const;
for (const card of cards) {
  if (only && !only.some((o) => card.name.includes(o))) continue;
  if (human && 'mirrorOnly' in card) continue;
  const m = human ? humanFieldTwin(card as never) : (card as never);
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
