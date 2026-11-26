// League self-play (every seat the production brain, every card the engine's own simulated players):
// realisation of flop equity in re-raised preflop pots, and preflop answer rates. Measurement only.
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const { playHand } = await import('../../src/benchmark/HorseLeague.js');
const { HorseMind } = await import('../../src/engine/HorseMind.js');
const { HORSE_HYBRID_PROFILES } = await import('../../src/engine/HorseHybridProfile.js');
const { scoreOmahaHi } = await import('../../src/engine/HorseEval.js');
const OPTS_FILE = process.env.OPTS_FILE ?? '';
const [variant, seatsS, stackS, nS, seedS, out, extraS] = process.argv.slice(2);
const SEATS = Number(seatsS), STACK = Number(stackS), N = Number(nS), SEED = Number(seedS);
const BASE = (OPTS_FILE ? JSON.parse(readFileSync(OPTS_FILE, 'utf8')).opts : {});
const EXTRA = extraS ? JSON.parse(extraS) : {};
const hy = HORSE_HYBRID_PROFILES.cash;
const BB = 2;
writeFileSync(out, '');
const sb = HorseMind.createSandbox();
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SU = ['clubs', 'diamonds', 'hearts', 'spades']; const RK = '23456789TJQKA';
function equities(hands: any[][], seed: number, iters = 600): number[] {
  const used = new Set(hands.flat().map((c) => c.rank + c.suit));
  const deck: any[] = []; for (const s of SU) for (const r of RK) if (!used.has(r + s)) deck.push({ rank: r, suit: s });
  const r = rng(seed); const eq = hands.map(() => 0);
  for (let it = 0; it < iters; it++) {
    for (let j = 0; j < 5; j++) { const x = j + Math.floor(r() * (deck.length - j)); [deck[j], deck[x]] = [deck[x], deck[j]]; }
    const b = deck.slice(0, 5); const sc = hands.map((h) => scoreOmahaHi(h, b)); const m = Math.max(...sc); const w = sc.filter((v) => v === m).length;
    sc.forEach((v, i) => { if (v === m) eq[i] += 1 / w; });
  }
  return eq.map((e) => e / iters);
}
const t0 = Date.now(); let kept = 0;
for (let c = 0; c < N; c++) {
  const handSeed = (SEED ^ (c * 2654435761)) >>> 0 || 1;
  const dealer = (c % SEATS) + 1;
  const idx = (s: number) => (s - 1 + SEATS) % SEATS;
  const sbI = SEATS === 2 ? idx(dealer) : idx(dealer + 1), bbI = SEATS === 2 ? idx(dealer + 1) : idx(dealer + 2);
  const contrib = new Array(SEATS).fill(0); const street = new Array(SEATS).fill(0);
  contrib[sbI] += BB / 2; street[sbI] = BB / 2; contrib[bbI] += BB; street[bbI] = BB;
  let stage = 'preflop'; const pre: any[] = []; let flopPot = 0; let preContrib: number[] = [];
  const order: number[] = []; // postflop action order seen on flop
  const flopActors: number[] = [];
  const observer: any = {
    onAction: (e: any) => {
      if (e.stage !== stage) { if (stage === 'preflop') { preContrib = [...contrib]; flopPot = contrib.reduce((a, b) => a + b, 0); } stage = e.stage; street.fill(0); }
      let add = 0;
      if (e.action === 'call') add = e.amount; else if (e.action === 'raise' || e.action === 'bet' || e.action === 'all_in') add = Math.max(0, e.amount - street[e.seatIdx]);
      contrib[e.seatIdx] += add; street[e.seatIdx] += add;
      if (e.stage === 'preflop') pre.push([e.seatIdx, e.action, Math.round(e.amount * 100) / 100, Math.round(e.toCall * 100) / 100, Math.round(e.pot * 100) / 100, e.liveBefore]);
      if (e.stage === 'flop' && !flopActors.includes(e.seatIdx)) flopActors.push(e.seatIdx);
    },
    onEnd: (e: any) => {
      if (stage === 'preflop') { preContrib = [...contrib]; flopPot = contrib.reduce((a, b) => a + b, 0); }
      const raises = pre.filter((a) => a[1] === 'raise' || a[1] === 'bet' || (a[1] === 'all_in' && a[2] > 0)).length;
      const rec: any = { c, dealer, sbI, bbI, pre, net: e.net.map((x: number) => Math.round(x * 100) / 100), folded: e.folded, raises };
      const seers = e.folded.map((f: boolean, i: number) => (!f || flopActors.includes(i)) ? i : -1).filter((i: number) => i >= 0);
      // players who saw the flop: not folded preflop
      const preFolded = new Set(pre.filter((a) => a[1] === 'fold').map((a) => a[0]));
      const sawFlop = [...Array(SEATS).keys()].filter((i) => !preFolded.has(i));
      if (raises >= 2 && sawFlop.length >= 2) {
        const eqs = equities(sawFlop.map((i) => e.cards[i]), handSeed ^ 0xabc);
        rec.flop = { seers: sawFlop, eq: eqs.map((x) => Math.round(x * 10000) / 10000), pot: Math.round(flopPot * 100) / 100, pre: sawFlop.map((i) => preContrib[i]), firstToAct: flopActors };
        rec.cards = sawFlop.map((i) => e.cards[i].map((x: any) => x.rank + x.suit[0]).join(''));
        rec.board = e.board.map((x: any) => x.rank + x.suit[0]).join('');
        { const sc = sawFlop.map((i) => scoreOmahaHi(e.cards[i], e.board)); const m = Math.max(...sc); const w = sc.filter((v) => v === m).length; rec.flop.share = sc.map((v) => (v === m ? Math.round(10000 / w) / 10000 : 0)); }
        kept++;
      }
      appendFileSync(out, JSON.stringify(rec) + '\n');
    },
  };
  playHand(handSeed, dealer, () => ({ ...BASE, ...EXTRA }), { illegal: 0, truncated: 0 }, sb, variant, SEATS, STACK, { gameMode: 'cash', format: 'cash', ante: 0 } as any, () => ({ ...hy.mods }), undefined, () => hy.style, true, observer);
  if (c % 20 === 19) console.log(c + 1, 'hands', kept, 'kept', ((Date.now() - t0) / (c + 1)).toFixed(0), 'ms/hand');
}
console.log("DONE", N, kept, Date.now() - t0); process.exit(0);
