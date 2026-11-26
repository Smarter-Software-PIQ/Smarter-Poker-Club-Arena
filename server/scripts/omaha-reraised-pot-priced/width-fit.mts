// Width at which sampled equity against a top-W range is unbiased against the actual holdings (self-play, engine's own players).
import { readFileSync } from 'node:fs';
const { omahaReraisedEquity } = await import('../../src/engine/HorseOmahaReraisedPot.js');
const { omahaPreflopPercentile } = await import('../../src/engine/HorseEval.js');
const SU: any = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string) => { const o: any[] = []; for (let i = 0; i < s.length; i += 2) o.push({ rank: s[i], suit: SU[s[i + 1]] }); return o; };
const f = process.argv[2]; const LIM = Number(process.argv[3] ?? 300);
const grid = [0.08, 0.12, 0.18, 0.25, 0.35, 0.5];
const acc: Record<string, { n: number; act: number; vs: number[] }> = {};
for (const line of readFileSync(f, 'utf8').split('\n')) {
  if (!line) continue; const r = JSON.parse(line); if (!r.flop || r.flop.seers.length !== 2) continue;
  const raisers = r.pre.filter((a: any) => a[1] === 'raise' || a[1] === 'bet' || (a[1] === 'all_in' && a[3] < a[2])).map((a: any) => a[0]);
  const lastR = raisers[raisers.length - 1]; const lvl = r.raises >= 3 ? '4b' : '3b';
  for (const [k, s] of r.flop.seers.entries()) {
    const other = 1 - k; const oppIsRaiser = r.flop.seers[other] === lastR;
    const key = (oppIsRaiser ? 'raiser' : 'caller') + ':' + lvl;
    const a = (acc[key] ??= { n: 0, act: 0, vs: grid.map(() => 0) });
    if (a.n >= LIM) continue;
    const hole = cards(r.cards[k]);
    a.n++; a.act += r.flop.eq[k];
    grid.forEach((w, gi) => { const lo = 1 - w; const e = omahaReraisedEquity(hole, [], [], (h: any) => omahaPreflopPercentile([...h], false) >= lo, 150); a.vs[gi] += e ?? 0; });
  }
}
for (const [k, a] of Object.entries(acc)) console.log(k, 'n', a.n, 'eq vs actual', (a.act / a.n).toFixed(3), grid.map((w, i) => w + ':' + (a.vs[i] / a.n).toFixed(3)).join(' '));
process.exit(0);
