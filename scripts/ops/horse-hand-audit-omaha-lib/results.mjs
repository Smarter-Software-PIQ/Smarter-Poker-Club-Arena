// Tier C: per-hand results and the all-in luck adjustment (shown hands only).
import { omaha, deckWithout, rng } from './omaha.mjs';
import { NBOARD } from './grade.mjs';
const MONEY = new Set(['call', 'bet', 'raise', 'all_in']);
/**
 * When every player still in at the end had his cards shown and the last chips went in before the river, the expected
 * share of each pot (exact runouts when there are at most 1,200, else 1,500 seeded random runouts), scaled by
 * (sum won / sum of pots) for the rake, replaces the actual result. Returns null when not applicable.
 */
export function allInAdjust(hand) {
  const live = hand.players.filter((p) => !p.folded);
  if (live.length < 2 || hand.rit || hand.bomb) return null;
  if (!live.every((p) => hand.shown.has(p.uid))) return null;
  let lastStreet = 'preflop';
  for (const d of hand.decisions)
    if (MONEY.has(d.act) && (d.toCall > 0 || d.isRaise)) lastStreet = d.street;
  if (lastStreet === 'river') return null;
  // all in: nobody acted on a later street (no checks after the money went in)
  const order = ['preflop', 'flop', 'turn', 'river'];
  if (hand.decisions.some((d) => order.indexOf(d.street) > order.indexOf(lastStreet))) return null;
  // must have reached showdown with money all in: at least one live player had no chips left
  const nb = NBOARD[lastStreet];
  if (hand.board.length < 5) return null;
  const board = hand.board.slice(0, nb);
  const holes = new Map(live.map((p) => [p.uid, hand.shown.get(p.uid)]));
  const dead = [...board];
  for (const h of holes.values()) dead.push(...h);
  const deck = deckWithout(dead);
  const need = 5 - nb;
  let runs = [];
  const choose = (n, k) => {
    let o = 1;
    for (let i = 1; i <= k; i++) o = (o * (n - k + i)) / i;
    return Math.round(o);
  };
  if (need === 0) runs = [[]];
  else if (choose(deck.length, need) <= 1200) {
    const rec = (start, acc) => {
      if (acc.length === need) {
        runs.push(acc.slice());
        return;
      }
      for (let i = start; i < deck.length; i++) {
        acc.push(deck[i]);
        rec(i + 1, acc);
        acc.pop();
      }
    };
    rec(0, []);
  } else {
    const r = rng(7);
    for (let i = 0; i < 1500; i++) {
      const d2 = deck.slice();
      const o = [];
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(r() * (d2.length - k));
        [d2[k], d2[j]] = [d2[j], d2[k]];
        o.push(d2[k]);
      }
      runs.push(o);
    }
  }
  const pots = hand.pots.length
    ? hand.pots
    : [{ amount: hand.pot, eligible: live.map((p) => p.uid) }];
  const exp = new Map(live.map((p) => [p.uid, 0]));
  for (const ro of runs) {
    const b = [...board, ...ro];
    const v = new Map([...holes].map(([u, h]) => [u, omaha(h, b)]));
    for (const p of pots) {
      const el = (p.eligible ?? []).filter((u) => v.has(u));
      if (!el.length) continue;
      const m = Math.max(...el.map((u) => v.get(u)));
      const w = el.filter((u) => v.get(u) === m);
      for (const u of w) exp.set(u, exp.get(u) + p.amount / w.length);
    }
  }
  const potSum = pots.reduce((s, p) => s + p.amount, 0);
  const wonSum = hand.players.reduce((s, p) => s + p.won, 0);
  const scale = potSum > 0 ? wonSum / potSum : 1;
  const luck = new Map();
  for (const p of live) luck.set(p.uid, p.won - (exp.get(p.uid) / runs.length) * scale);
  return { street: lastStreet, luck, runs: runs.length };
}
