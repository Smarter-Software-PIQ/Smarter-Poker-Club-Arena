import { runMatchup, humanFieldTwin } from '../src/benchmark/HorseLeague.js';
const pairs = Number(process.argv[2] ?? 50000);
const seed = Number(process.argv[3] ?? 2026110684);
const mode = process.argv[4] ?? 'mirror';
const card = { name: 'nlh_v83_hu_80bb', seats: 2, stackBB: 80, moodClock: 'deal_seed' as const, a: {}, b: { v83AggressionNeedsBluffs: false }, ...(mode === 'hybrid' ? { hybridBaseline: true } : {}) };
const m = mode === 'human' ? humanFieldTwin(card as never) : (card as never);
const r = await runMatchup(m, pairs, seed);
console.log(JSON.stringify({ mode, name: (m as { name: string }).name, hands: r.hands, bb100: +r.bb100.toFixed(3), stderr: +r.stderr.toFixed(3), divergentPairs: r.divergentPairs, inert: r.inert, illegal: r.illegalActions, truncated: r.truncatedStreets, minutes: +(r.durationMs / 60000).toFixed(1) }));
process.exit(0);
