import { runMatchup, humanFieldTwin } from '../src/benchmark/HorseLeague.js';
// V71: MTT six-handed at 15bb / 10bb with a 1bb big-blind ante (BB = 2 chips).
const tournament = (playersLeft: number, spotsPaid: number, stackBB: number, bba: boolean) => ({
  gameMode: 'tournament' as const,
  format: 'mtt' as const,
  ante: bba ? 2 : 0,
  ...(bba ? { bigBlindAnte: true } : {}),
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
    currentAnte: bba ? 2 : 0,
    anteType: bba ? ('big_blind' as const) : ('none' as const),
    nextSmallBlind: 2,
    nextBigBlind: 4,
    nextAnte: bba ? 4 : 0,
    nextBlindInMin: 10,
  },
});
const pairs = Number(process.argv[2] ?? 6000);
const seed = Number(process.argv[3] ?? 2026103171);
const human = process.argv[4] === 'human';
const only = process.argv[5]?.split(',');
const on = {};
const off = { v71AnteAwarePushFold: false };
const cards = [
  { name: 'mtt_v71_15bb_bba', stackBB: 15, context: tournament(180, 30, 15, true), a: on, b: off },
  { name: 'mtt_v71_10bb_bba', stackBB: 10, context: tournament(180, 30, 10, true), a: on, b: off },
  { name: 'mtt_v71_15bb_na', stackBB: 15, context: tournament(180, 30, 15, false), a: on, b: off },
  { name: 'mtt_v71_10bb_na', stackBB: 10, context: tournament(180, 30, 10, false), a: on, b: off },
] as const;
for (const card of cards) {
  if (only && !only.some((o) => card.name.includes(o))) continue;
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
