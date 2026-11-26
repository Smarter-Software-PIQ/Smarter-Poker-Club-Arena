// Exploit probes: one scripted seat (seat 0) against Horses, every Horse ON (arm a) or OFF (arm b), same deals.
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
import { readFileSync } from 'node:fs';
const { playHand } = await import('../../src/benchmark/HorseLeague.js');
const { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } = await import('../../src/benchmark/HorseLeagueHumanField.js');
const { HorseMind } = await import('../../src/engine/HorseMind.js');
const { HORSE_HYBRID_PROFILES } = await import('../../src/engine/HorseHybridProfile.js');
const { omahaPreflopPercentile } = await import('../../src/engine/HorseEval.js');
const OPTS_FILE = process.env.OPTS_FILE ?? '';
const [probe, variant, seatsS, stackS, nS, seedS, onS] = process.argv.slice(2);
const SEATS = Number(seatsS), STACK = Number(stackS), N = Number(nS), SEED = Number(seedS), BB = 2;
const BASE = (OPTS_FILE ? JSON.parse(readFileSync(OPTS_FILE, 'utf8')).opts : {});
const ON = onS ? JSON.parse(onS) : { omahaReraisedPotCallIsPriced: true, omahaReraisedPotReraiseIsPriced: true };
const hy = HORSE_HYBRID_PROFILES.cash;
const raisesOf = (s: any) => s.history.filter((a: any) => a.stage === 'preflop' && (a.action === 'raise' || a.action === 'bet' || (a.action === 'all_in' && (a.amount ?? 0) > s.currentBet - 1e-9 && (a.amount ?? 0) > s.bigBlind)));
const can = (s: any, a: string) => s.legalActions.includes(a);
const potRaise = (s: any) => (s.maxRaiseTo != null && can(s, 'raise') ? { action: 'raise', amount: s.maxRaiseTo } : can(s, 'all_in') ? { action: 'all_in' } : null);
const asNoRaise = (s: any, d: any) => (d.action === 'raise' || d.action === 'bet' || d.action === 'all_in' ? (s.toCall > 0 ? { action: 'call' } : { action: 'check' }) : d);
function policy(s: any) {
  const horse = () => s.horseDecide(hy.style, { ...hy.mods }, BASE);
  if (s.stage !== 'preflop') return horse();
  const rs = raisesOf(s); const me = s.userId; const last = rs.length ? rs[rs.length - 1].userId : null;
  if (probe === 'a') { if (rs.length === 1 && last !== me) return potRaise(s) ?? horse(); return horse(); }
  if (probe === 'b') { if (rs.length === 1 && last !== me) { if (omahaPreflopPercentile(s.cards, false) >= 0.96) return potRaise(s) ?? horse(); return asNoRaise(s, horse()); } return horse(); }
  if (probe === 'c') { if (rs.length === 2 && rs[0].userId === me && last !== me) return potRaise(s) ?? horse(); return horse(); }
  if (probe === 'd') { if (s.toCall > 0) return can(s, 'call') ? { action: 'call' } : can(s, 'all_in') ? { action: 'all_in' } : horse(); return asNoRaise(s, horse()); }
  throw new Error('probe ' + probe);
}
const field: any = { population: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID, isHuman: (i: number) => i === 0, seatPolicyOf: (i: number) => (i === 0 ? policy : undefined) };
const sbA = HorseMind.createSandbox(), sbB = HorseMind.createSandbox();
const ctx: any = { gameMode: 'cash', format: 'cash', ante: 0 };
const a: number[] = [], b: number[] = [];
const t0 = Date.now();
for (let c = 0; c < N; c++) {
  const handSeed = (SEED ^ (c * 2654435761)) >>> 0 || 1; const dealer = (c % SEATS) + 1;
  const na = playHand(handSeed, dealer, () => ({ ...BASE, ...ON }), { illegal: 0, truncated: 0 }, sbA, variant, SEATS, STACK, ctx, () => ({ ...hy.mods }), field, () => hy.style, true, undefined);
  const nb = playHand(handSeed, dealer, () => ({ ...BASE }), { illegal: 0, truncated: 0 }, sbB, variant, SEATS, STACK, ctx, () => ({ ...hy.mods }), field, () => hy.style, true, undefined);
  a.push(-na[0] / BB); b.push(-nb[0] / BB);
  if (c % 500 === 499) console.log(c + 1, ((Date.now() - t0) / (c + 1)).toFixed(0), 'ms/deal');
}
const st = (x: number[]) => { const m = x.reduce((p, q) => p + q, 0) / x.length; const v = x.reduce((p, q) => p + (q - m) ** 2, 0) / (x.length - 1); return [100 * m, 100 * Math.sqrt(v / x.length)]; };
const d = a.map((x, i) => x - b[i]);
const [ma, sa] = st(a), [mb, sbb] = st(b), [md, sd] = st(d);
// by quarter (adaptation)
const q = (x: number[], k: number) => st(x.slice(Math.floor(k * x.length / 4), Math.floor((k + 1) * x.length / 4)))[0].toFixed(1);
console.log('RESULT', JSON.stringify({ probe, variant, seats: SEATS, stackBB: STACK, deals: N, seed: SEED, horsesOn: [ma, sa], horsesOff: [mb, sbb], onMinusOff: [md, sd], onQuarters: [0, 1, 2, 3].map((k) => q(a, k)), offQuarters: [0, 1, 2, 3].map((k) => q(b, k)) }));
process.exit(0);
