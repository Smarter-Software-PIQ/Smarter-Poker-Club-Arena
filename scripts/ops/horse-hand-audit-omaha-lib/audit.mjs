// Runs the three tiers over parsed hands and aggregates them.
import { parseHand, sizeBucket } from './hand.mjs';
import { measurePopulation } from './pop.mjs';
import { gradeDecision, oppSpec, DEFAULTS } from './grade.mjs';
import { allInAdjust } from './results.mjs';

export const REGIMES = [
  { id: 'R1', label: 'rules on, flop EV verdict on', from: '2000-01-01T00:00:00Z' },
  { id: 'R2', label: 'PLO rules off', from: '2026-11-22T03:13:56Z' },
  { id: 'R3', label: 'rules restored, flop EV verdict on', from: '2026-11-22T22:12:30Z' },
  { id: 'R4', label: 'flop EV verdict off', from: '2026-11-24T07:08:52Z' },
];
export const tsOf = (s) =>
  new Date(
    String(s)
      .replace(' ', 'T')
      .replace(/\+00(:00)?$/, 'Z')
  ).getTime();
export function regimeOf(ms) {
  let r = REGIMES[0];
  for (const x of REGIMES) if (ms >= Date.parse(x.from)) r = x;
  return r.id;
}
export const chicagoDay = (ms) =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const NONVOL = new Set(['forced']);
function personLine(hand, u) {
  let line = 'fold/check';
  for (const d of hand.decisions) {
    if (d.u !== u || d.street !== 'preflop') continue;
    if (d.isRaise) line = d.k === 0 ? 'open-raise' : d.k === 1 ? '3-bet' : '4-bet+';
    else if (d.act === 'call' && !['open-raise', '3-bet', '4-bet+'].includes(line))
      line = d.k >= 2 ? 'called 3-bet+' : d.k === 1 ? 'called open' : 'limp';
    else if (d.act === 'call' && d.k >= 2 && line === 'open-raise') line = 'open, called 3-bet';
    else if (d.act === 'call' && d.k >= 3 && line === '3-bet') line = '3-bet, called 4-bet';
  }
  return line;
}
export function nodeKey(hand, d) {
  const into = d.live <= 2 ? 'hu' : 'mw';
  const pos = d.oop ? 'OOP' : 'IP';
  if (d.street === 'preflop') {
    const fac = d.facing ? (hand.byUid.get(d.facing)?.isHorse ? 'horse' : 'person') : 'blinds';
    return `preflop|${['unopened', 'facing open', 'facing 3-bet', 'facing 4-bet+'][Math.min(d.k, 3)]}|${pos}|${into}|vs ${fac}`;
  }
  if (d.toCall > 0) {
    const bettor = hand.byUid.get(d.facing);
    const fac = bettor && !bettor.isHorse ? 'person' : 'horse';
    const s = d.toCall / Math.max(d.pot - d.toCall, 1e-9);
    const line = d.nStreetRaises > 1 ? 'raise' : 'bet';
    return `${d.street}|facing ${line}|${pos}|${sizeBucket(s)}|${into}|vs ${fac}`;
  }
  const vsP = d.liveUids.some((x) => x !== d.u && !hand.byUid.get(x)?.isHorse);
  return `${d.street}|checked to / first|${pos}|-|${into}|vs ${vsP ? 'person' : 'horse'}`;
}
export function runAudit(
  rawRows,
  { tables, peopleOnly = true, games = ['plo4', 'plo5'], opts = DEFAULTS, onProgress } = {}
) {
  const seenIds = new Set();
  const hands = [];
  for (const r of rawRows) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    const h = parseHand(r);
    if (!games.includes(h.gv)) continue;
    if (peopleOnly && !(h.hasPerson && h.hasHorse)) continue;
    h.ms = tsOf(h.t);
    hands.push(h);
  }
  hands.sort((a, b) => a.ms - b.ms);
  const pop = measurePopulation(hands);
  const decisions = [];
  const handRows = [];
  let done = 0;
  for (const h of hands) {
    const people = h.players.filter((p) => !p.isHorse);
    const horses = h.players.filter((p) => p.isHorse);
    const adj = allInAdjust(h);
    const day = chicagoDay(h.ms),
      regime = regimeOf(h.ms);
    const hr = {
      hand_id: h.id,
      time: new Date(h.ms).toISOString(),
      day,
      game: h.gv,
      stake: h.bb,
      build: h.build,
      regime,
      players: h.players.length,
      people: people.map((p) => p.name).join('+'),
      n_people: people.length,
      person_lines: people.map((p) => personLine(h, p.uid)).join('+'),
      person_net_bb: people.reduce((s, p) => s + p.net, 0) / h.bb,
      horse_net_bb: horses.reduce((s, p) => s + p.net, 0) / h.bb,
      rake_bb: (h.rake + h.bbj) / h.bb,
      pot_bb: h.pot / h.bb,
      bomb: h.bomb,
      rit: h.rit,
      showdown: h.shown.size > 0,
      allin_adjusted: !!adj,
      adj_street: adj?.street ?? '',
      person_luck_bb: adj ? people.reduce((s, p) => s + (adj.luck.get(p.uid) ?? 0), 0) / h.bb : 0,
      horse_luck_bb: adj ? horses.reduce((s, p) => s + (adj.luck.get(p.uid) ?? 0), 0) / h.bb : 0,
      tierA: 0,
      tierB: 0,
      mistakes: 0,
      mistake_bb: 0,
      perPerson: people.map((p) => ({
        name: p.name,
        uid: p.uid,
        net: p.net / h.bb,
        luck: adj ? (adj.luck.get(p.uid) ?? 0) / h.bb : 0,
        line: personLine(h, p.uid),
      })),
    };
    for (let di = 0; di < h.decisions.length; di++) {
      const d = h.decisions[di];
      const pl = h.byUid.get(d.u);
      if (!pl?.isHorse || NONVOL.has(d.origin)) continue;
      const oppPerson = d.liveUids.some((x) => x !== d.u && !h.byUid.get(x)?.isHorse);
      const facingPerson = d.facing ? !h.byUid.get(d.facing)?.isHorse : null;
      const s =
        d.toCall > 0
          ? d.toCall / Math.max(d.pot - d.toCall, 1e-9)
          : d.isRaise
            ? (d.amt - d.myCom) / Math.max(d.pot, 1e-9)
            : null;
      const row = {
        hand_id: h.id,
        time: hr.time,
        day,
        game: h.gv,
        stake: h.bb,
        street: d.street,
        node: nodeKey(h, d),
        action: d.act,
        tier: 'B',
        verdict: '',
        cost_bb: null,
        opp_person: oppPerson ? 'y' : 'n',
        facing_person: facingPerson === null ? '' : facingPerson ? 'y' : 'n',
        build: h.build,
        regime,
        horse: pl.name,
        pos: d.oop ? 'OOP' : 'IP',
        into: d.live <= 2 ? 'hu' : 'mw',
        k: d.k,
        size: s,
        pot_bb: d.pot / h.bb,
        tocall_bb: d.toCall / h.bb,
        origin: d.origin,
        air: null,
      };
      if (d.toCall > 0 && d.street !== 'preflop' && d.facing) {
        const sp = oppSpec(h, d.facing, di, pop);
        const cell = sp.kind === 'hist' ? tables[sp.table]?.[sp.key] : null;
        if (cell) row.air = cell.hist[6] + cell.hist[7];
      }
      if (!h.bomb && !h.rit && h.shown.has(d.u)) {
        const g = gradeDecision(h, di, tables, pop, opts);
        if (g) {
          Object.assign(row, {
            tier: 'A',
            verdict: g.verdict,
            cost_bb: g.verdict === 'MISTAKE' ? g.cost : 0,
            raw_gap_bb: g.cost,
            best: g.best,
            taken: g.taken,
            eq: g.eq,
            eq_se: g.eqSe,
            eq_hind: g.eqHind,
            hind_cost_bb: g.hcost,
            gain_bb: g.gain,
            mtype: g.mtype ?? '',
            mclass: g.mclass ?? '',
            breach: g.breach.join(';'),
            note: g.notes.join(';'),
            nut_class: g.nutClass ?? '',
            ev_taken_bb: g.evTaken,
            ev_best_bb: g.evBest,
            tol_bb: g.tol,
            specs: g.specs.join(';'),
            nuts: g.nuts,
            outs: g.outs,
            made: g.madeCat,
            hero_pf_q: g.heroPf,
            act_taken: g.actTaken,
            options: g.options.map((o) => `${o.a}:${o.ev.toFixed(2)}`).join(' '),
            size_band: g.sizeBand ? `${g.sizeBand.min.toFixed(2)}-${g.sizeBand.max.toFixed(2)}` : '',
          });
          hr.tierA++;
          if (g.verdict === 'MISTAKE') {
            hr.mistakes++;
            hr.mistake_bb += g.cost;
          }
        }
      }
      if (row.tier === 'B') {
        row.verdict = 'RANGE';
        hr.tierB++;
      }
      decisions.push(row);
    }
    handRows.push(hr);
    done++;
    if (onProgress && done % 200 === 0) onProgress(done, hands.length);
  }
  return { hands: handRows, decisions, pop, nHands: hands.length };
}
