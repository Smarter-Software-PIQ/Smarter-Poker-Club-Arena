// League mirror ON vs OFF (duplicate pairs, same seeds): a = live rows + the two options, b = live rows.
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
import { readFileSync } from 'node:fs';
const { runMatchup } = await import('../../src/benchmark/HorseLeague.js');
const OPTS_FILE = process.env.OPTS_FILE ?? '';
const [variant, seatsS, stackS, pairsS, seedS, onS] = process.argv.slice(2);
const BASE = (OPTS_FILE ? JSON.parse(readFileSync(OPTS_FILE, 'utf8')).opts : {});
const ON = onS ? JSON.parse(onS) : { omahaReraisedPotCallIsPriced: true, omahaReraisedPotReraiseIsPriced: true };
const m: any = { name: 'dev_' + variant + '_' + seatsS + '_' + stackS + '_reraised_pot_priced', variant, seats: Number(seatsS), stackBB: Number(stackS), pairs: Number(pairsS), hybridBaseline: true, a: { ...BASE, ...ON }, b: { ...BASE } };
const r = await runMatchup(m, Number(pairsS), Number(seedS));
console.log('RESULT', JSON.stringify({ variant, seats: m.seats, stackBB: m.stackBB, pairs: Number(pairsS), seed: Number(seedS), hands: r.hands, bb100: r.bb100, stderr: r.stderr, divergentPairs: r.divergentPairs, illegal: r.illegalActions, fallbacks: r.brainExceptionFallbacks, ms: r.durationMs }));
process.exit(0);
