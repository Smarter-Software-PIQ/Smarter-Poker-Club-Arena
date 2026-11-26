// Self-play preflop rates and range percentiles (engine's own simulated players only).
import { readFileSync } from 'node:fs';
const { omahaPreflopPercentile } = await import('../../src/engine/HorseEval.js');
const SU: any = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string) => { const o: any[] = []; for (let i = 0; i < s.length; i += 2) o.push({ rank: s[i], suit: SU[s[i + 1]] }); return o; };
for (const f of process.argv.slice(2)) {
  const seats = Number(f.split('/').pop()!.split('-')[1]);
  const st: Record<string, number> = {};
  const inc = (k: string, v = 1) => (st[k] = (st[k] ?? 0) + v);
  const pct: Record<string, number[]> = {};
  const addP = (k: string, v: number) => (pct[k] ??= []).push(v);
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue; const r = JSON.parse(line);
    let raises = 0; const raiserAt: number[] = []; const lastAct: Record<number, string> = {}; const role: Record<number, string> = {};
    let callersOfLevel: number[] = [];
    for (const [s, a, amt, toCall] of r.pre) {
      const isR = a === 'raise' || a === 'bet' || (a === 'all_in' && amt > 0 && toCall < amt);
      // node: facing exactly k raises
      const k = raises;
      if (k >= 1) {
        const mine = raiserAt.includes(s);
        const lastIsMe = raiserAt[raiserAt.length - 1] === s;
        if (!lastIsMe) {
          const node = k === 1 ? 'face1' : k === 2 ? (raiserAt[0] === s ? 'open_face3' : callersOfLevel.includes(s) ? 'caller_face3' : 'cold_face3') : (raiserAt[raiserAt.length - 2] === s ? 'threebettor_face4' : 'other_face4+');
          inc(node + ':n'); inc(node + ':' + (isR ? 'raise' : a === 'fold' ? 'fold' : 'call'));
          // players behind a re-raise and a call: facing k>=2 with a caller already in at this level
          if (k >= 2 && !mine && callersOfLevel.length > 0 && !lastIsMe) { inc('behind_after_call:n'); inc('behind_after_call:' + (isR ? 'raise' : a === 'fold' ? 'fold' : 'call')); }
        }
      }
      if (isR) { raises++; raiserAt.push(s); callersOfLevel = []; }
      else if (a === 'call' && raises >= 1) callersOfLevel.push(s);
      lastAct[s] = a;
    }
    if (r.flop && r.cards) {
      const lastR = raiserAt[raiserAt.length - 1];
      r.flop.seers.forEach((s: number, k: number) => {
        const p = omahaPreflopPercentile(cards(r.cards[k]), false);
        const lvl = r.raises >= 3 ? '4b+' : '3b';
        addP((s === lastR ? 'raiser' : 'caller') + ':' + lvl, p);
      });
    }
  }
  console.log('==', f.split('/').pop());
  const nodes = [...new Set(Object.keys(st).map((k) => k.split(':')[0]))];
  for (const nd of nodes) { const n = st[nd + ':n']; console.log(nd.padEnd(18), 'n', n, 'fold', ((st[nd + ':fold'] ?? 0) / n).toFixed(3), 'call', ((st[nd + ':call'] ?? 0) / n).toFixed(3), 'raise', ((st[nd + ':raise'] ?? 0) / n).toFixed(3)); }
  for (const [k, v] of Object.entries(pct)) { const m = v.reduce((a, b) => a + b, 0) / v.length; console.log('pct', k.padEnd(12), 'n', v.length, 'mean', m.toFixed(3), 'implied top width', (2 * (1 - m)).toFixed(3)); }
}
process.exit(0);
