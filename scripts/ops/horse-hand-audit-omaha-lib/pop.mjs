// Measured population rates from the hands being audited (every player, people and Horses; identity-free).
// They give the fold equity of bets and raises and the preflop range widths. Cells are shrunk toward a coarser cell.
import { sizeBucket } from './hand.mjs';
const SHRINK = 30;
export function measurePopulation(hands) {
  const c = new Map();
  const add = (k, hit) => {
    const x = c.get(k) ?? { n: 0, k: 0 };
    x.n++;
    if (hit) x.k++;
    c.set(k, x);
  };
  for (const h of hands) {
    if (h.bomb || h.rit) continue;
    const ds = h.decisions;
    // street openings: does the first player to act check, and when he does, does the street check through
    for (const st of ['flop', 'turn', 'river']) {
      const sd = ds.filter((x) => x.street === st);
      if (!sd.length) continue;
      const into = sd[0].live <= 2 ? 'hu' : 'mw';
      add(`firstcheck|${h.gv}|${st}|${into}`, sd[0].act === 'check');
      if (sd[0].act === 'check')
        add(
          `cthru|${h.gv}|${st}|${into}`,
          sd.every((x) => x.act === 'check')
        );
    }
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      if (d.street === 'preflop') {
        const k = Math.min(d.k, 3);
        if (d.toCall > 0 || k > 0) {
          add(`pf|${h.gv}|${k}|raise`, d.isRaise);
          add(`pf|${h.gv}|${k}|cont`, d.act !== 'fold');
        }
      }
      if (!d.isRaise) continue;
      // responders up to the next raise: did every one fold?
      const seen = new Set();
      let any = false,
        resp = 0;
      // responder type: 'p' when a person is among the players still to respond, else 'h' (grading only; the audit
      // prices a wager against the field it actually faced)
      const rt = d.liveUids.some((x) => x !== d.u && h.byUid.get(x) && !h.byUid.get(x).isHorse)
        ? 'p'
        : 'h';
      for (let j = i + 1; j < ds.length; j++) {
        const e = ds[j];
        if (e.street !== d.street) break;
        if (e.u === d.u || seen.has(e.u)) break;
        seen.add(e.u);
        resp++;
        if (e.act !== 'fold') {
          any = true;
          break;
        }
      }
      if (!resp) continue;
      const into = d.live <= 2 ? 'hu' : 'mw';
      if (d.street === 'preflop') add(`pffold|${h.gv}|${Math.min(d.k, 3)}|${into}|${rt}`, !any);
      else if (d.firstWager)
        add(
          `fold|${h.gv}|${d.street}|${sizeBucket(d.amt / Math.max(d.pot, 1e-9))}|${into}|${rt}`,
          !any
        );
      else add(`rfold|${h.gv}|${d.street}|${into}|${rt}`, !any);
    }
  }
  return c;
}
export function rate(pop, key, parentKey, dflt) {
  const x = pop.get(key) ?? { n: 0, k: 0 };
  let prior = dflt;
  if (parentKey) {
    const p = [...pop]
      .filter(([k]) => k.startsWith(parentKey))
      .reduce((a, [, v]) => ({ n: a.n + v.n, k: a.k + v.k }), { n: 0, k: 0 });
    if (p.n > 0) prior = (p.k + SHRINK * dflt) / (p.n + SHRINK);
  }
  return (x.k + SHRINK * prior) / (x.n + SHRINK);
}
// the cell for the responder type is shrunk toward the same cell over both types
export const foldToBet = (pop, gv, st, bucket, into, rt) =>
  rate(pop, `fold|${gv}|${st}|${bucket}|${into}|${rt}`, `fold|${gv}|${st}|${bucket}|${into}|`, 0.4);
export const foldToRaise = (pop, gv, st, into, rt) =>
  rate(pop, `rfold|${gv}|${st}|${into}|${rt}`, `rfold|${gv}|${st}|${into}|`, 0.3);
export const pfFoldToRaise = (pop, gv, k, into, rt) =>
  rate(
    pop,
    `pffold|${gv}|${Math.min(k, 3)}|${into}|${rt}`,
    `pffold|${gv}|${Math.min(k, 3)}|${into}|`,
    0.3
  );
export const pfRaiseRate = (pop, gv, k) => rate(pop, `pf|${gv}|${Math.min(k, 3)}|raise`, null, 0.1);
export const pfContRate = (pop, gv, k) => rate(pop, `pf|${gv}|${Math.min(k, 3)}|cont`, null, 0.4);
export const firstCheck = (pop, gv, st, into) =>
  rate(pop, `firstcheck|${gv}|${st}|${into}`, `firstcheck|${gv}|${st}|`, 0.5);
export const checkThrough = (pop, gv, st, into) =>
  rate(pop, `cthru|${gv}|${st}|${into}`, `cthru|${gv}|${st}|`, 0.5);
