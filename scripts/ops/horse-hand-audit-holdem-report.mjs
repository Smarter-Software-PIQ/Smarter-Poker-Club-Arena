/**
 * Report, CSV and window comparison for the Horse Hold'em hand audit (scripts/ops/horse-hand-audit-holdem.mjs).
 */
import { cardStr } from './horse-hand-audit-holdem-eval.mjs';
import {
  EVENTS,
  PRIORS_VERSION,
  STREETS,
  TOL_BB,
  TOL_POT,
  dayOf,
  fmtClass,
  nodeKey,
  nodeOf,
  regimeOf,
} from './horse-hand-audit-holdem-lib.mjs';

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : 0);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
export const actOf = (d) =>
  d.C > 0
    ? d.kind === 'fold'
      ? 'fold'
      : d.kind === 'call'
        ? 'call'
        : 'raise'
    : d.kind === 'check'
      ? 'check'
      : d.kind === 'bet'
        ? 'bet'
        : 'raise';
export const personFacing = (H, d) => d.opp.some((o) => !H.seats.get(o.seat)?.horse);

/** Which existing (default-OFF unless stated) branch addresses a leak, by format class, type and street. */
export function fixFor(fc, type, street) {
  const t = String(type);
  if (fc === 'cash') {
    if (
      street !== 'preflop' &&
      /over-fold|folded too strong|called too light|paid off|calls below/.test(t)
    )
      return "Hold'em flop/turn/river priced chooser (holdemLateStreetIsPriced + holdemFlopIsPriced, local branch, default OFF)";
    if (
      street !== 'preflop' &&
      /bluff-raised|raise without value|raised a draw|stacked off/.test(t)
    )
      return 'raise-needs-value (holdemTurnRiverRaiseNeedsValue, default OFF): turn/river only';
    if (
      street !== 'preflop' &&
      /missed value|missed thin|bet size|random or unpriced|thin value|over-bluff|missed profitable|slow-play/.test(
        t
      )
    )
      return 'priced chooser opening side (local branch, default OFF)';
    if (/3-bet|4-bet/.test(t)) return 'out-of-position 3-bet range (wt-oop-reraise, default OFF)';
    if (/cold-call/.test(t))
      return 'cashDefenceTrimColdCalls (ON since 2026-11-24T08:17:54Z), partly';
    return 'nothing';
  }
  if (street === 'preflop' && /non-all-in raise|3-bet|4-bet|over-fold/.test(t))
    return 'tournament raise defence (PR #11913, default OFF)';
  if (street === 'preflop' && /push\/fold/.test(t))
    return 'holdemTournamentAllInCallIsPriced (ON) prices calls of a jam only';
  if (street !== 'preflop')
    return 'nothing (the priced chooser is cash-only; holdemLateStreetIsPricedInTournaments not built)';
  return 'nothing';
}

function spotOf(H, d, withStack) {
  const n = nodeOf(H, d);
  return `${n.node} ${n.pos} ${n.line !== '-' ? n.line + ' ' : ''}${n.size !== '-' ? 'vs ' + n.size + ' ' : ''}${n.hu}${withStack ? ' ' + n.stack : ''}`;
}

export function oneLine(H, row) {
  const d = row.d;
  const potBb = r1(d.P / H.bb);
  const who = row.horse || 'Horse';
  if (row.tier === 'exact') {
    const cards = row.hole ? row.hole.map(cardStr).join('') : '';
    return `${who} ${cards}${row.cls ? ' (' + row.cls + ')' : ''} ${d.street} ${actOf(d)}${d.C > 0 ? ' facing ' + r1(d.C / H.bb) + 'bb' : ''}${d.kind === 'bet' || d.kind === 'raise' ? ' to ' + r1(d.to / H.bb) + 'bb' : ''} into ${potBb}bb; best ${row.best}; eq vs range ${pct(row.eq)}${row.hindEq !== null && row.hindEq !== undefined ? ', vs shown ' + pct(row.hindEq) : ''}; cost ${r1(row.cost)}bb`;
  }
  return `${who} ${d.street} ${actOf(d)}${d.C > 0 ? ' facing ' + r1(d.C / H.bb) + 'bb' : ''} into ${potBb}bb (node ${row.type}, cards unshown); est ${r1(row.cost)}bb`;
}

export function buildSummary(res, meta = {}) {
  const { hands, exact, rangeRows, nodes, handRows } = res;
  const byHand = new Map(hands.map((H) => [H.id, H]));
  const fcHands = { cash: 0, tournament: 0 };
  const fmtHands = {};
  const personHands = { cash: 0, tournament: 0 };
  const dayHands = {};
  for (const hr of handRows) {
    const fc = fmtClass(hr.H.fmt);
    fcHands[fc]++;
    fmtHands[hr.H.fmt] = (fmtHands[hr.H.fmt] || 0) + 1;
    personHands[fc] += hr.persons.length;
    const k = `${fc} ${dayOf(hr.H.ts)}`;
    dayHands[k] = (dayHands[k] || 0) + 1;
  }
  const per100 = (fc, bb) => (fcHands[fc] ? (100 * bb) / fcHands[fc] : 0);
  const streetTable = { cash: {}, tournament: {} };
  for (const fc of ['cash', 'tournament']) for (const st of STREETS) streetTable[fc][st] = {};
  const tierCount = {};
  const addSt = (row) => {
    const H = byHand.get(row.hand);
    const fc = fmtClass(H.fmt);
    const tk = `${H.fmt} ${row.tier}`;
    tierCount[tk] = (tierCount[tk] || 0) + 1;
    const a = actOf(row.d);
    const cell = (streetTable[fc][row.d.street][a] ||= {
      exN: 0,
      exOk: 0,
      exBad: 0,
      exLost: 0,
      exWon: 0,
      hindBad: 0,
      exP: 0,
      exPBad: 0,
      exPLost: 0,
      rgN: 0,
      rgLeak: 0,
      rgLost: 0,
      rgWon: 0,
      rgTheory: 0,
    });
    const vsP = personFacing(H, row.d);
    if (row.tier === 'exact') {
      cell.exN++;
      if (vsP) cell.exP++;
      if (row.verdict === 'CORRECT') {
        cell.exOk++;
        cell.exWon += row.gain;
      } else {
        cell.exBad++;
        cell.exLost += row.cost;
        if (vsP) {
          cell.exPBad++;
          cell.exPLost += row.cost;
        }
      }
      if (row.hindVerdict === 'MISTAKE') cell.hindBad++;
    } else {
      cell.rgN++;
      if (row.cost > 0) {
        cell.rgLeak++;
        cell.rgLost += row.cost;
      }
      cell.rgWon += row.gain;
      cell.rgTheory += row.theory || 0;
    }
  };
  for (const r of exact) addSt(r);
  for (const r of rangeRows) addSt(r);
  // leaks versus people (actual cost)
  const leakGroups = new Map();
  for (const row of [...exact, ...rangeRows]) {
    const H = byHand.get(row.hand);
    if (!personFacing(H, row.d) || !(row.cost > 0)) continue;
    const fc = fmtClass(H.fmt);
    const spot = spotOf(H, row.d, row.tier === 'range' || H.tour);
    const key = [fc, row.tier, row.type, row.d.street, spot].join(' | ');
    const g = leakGroups.get(key) || {
      fc,
      tier: row.tier,
      type: row.type,
      street: row.d.street,
      spot,
      n: 0,
      bb: 0,
      ex: [],
    };
    g.n++;
    g.bb += row.cost;
    if (g.ex.length < 10) g.ex.push({ id: row.hand, line: oneLine(H, row), cost: row.cost });
    leakGroups.set(key, g);
  }
  const leaks = [...leakGroups.values()]
    .map((g) => ({ ...g, per100: per100(g.fc, g.bb), fix: fixFor(g.fc, g.type, g.street) }))
    .sort((a, b) => b.per100 - a.per100);
  // coarse leak ranking: mistake type x street (both tiers), versus people
  const coarse = new Map();
  for (const g of leaks) {
    const k = [g.fc, g.type, g.street].join(' | ');
    const c = coarse.get(k) || {
      fc: g.fc,
      type: g.type,
      street: g.street,
      n: 0,
      bb: 0,
      tiers: new Set(),
      spots: [],
      ex: [],
    };
    c.n += g.n;
    c.bb += g.bb;
    c.tiers.add(g.tier);
    c.spots.push([g.spot, g.bb]);
    for (const e of g.ex) if (c.ex.length < 10) c.ex.push(e);
    coarse.set(k, c);
  }
  const leaksCoarse = [...coarse.values()]
    .map((c) => ({
      ...c,
      tiers: [...c.tiers].join('+'),
      per100: per100(c.fc, c.bb),
      fix: fixFor(c.fc, c.type, c.street),
      topSpots: c.spots.sort((a, b) => b[1] - a[1]).slice(0, 3),
    }))
    .sort((a, b) => b.per100 - a.per100);
  // strengths versus people
  const strG = new Map();
  for (const row of [...exact, ...rangeRows]) {
    const H = byHand.get(row.hand);
    if (!personFacing(H, row.d) || !(row.gain > 0)) continue;
    const fc = fmtClass(H.fmt);
    const spot = `${actOf(row.d)} at ${spotOf(H, row.d, false)}`;
    const key = [fc, row.tier, row.d.street, spot].join(' | ');
    const g = strG.get(key) || {
      fc,
      tier: row.tier,
      street: row.d.street,
      spot,
      n: 0,
      bb: 0,
      ex: [],
    };
    g.n++;
    g.bb += row.gain;
    if (g.ex.length < 8) g.ex.push(row.hand);
    strG.set(key, g);
  }
  const strengths = [...strG.values()]
    .map((g) => ({ ...g, per100: per100(g.fc, g.bb) }))
    .sort((a, b) => b.per100 - a.per100);
  // theoretical exploitability vs actual
  const theory = [];
  for (const v of nodes.values()) {
    if (!(v.theory > 0) || !v.parent) continue; // postflop parents (street x node x size x HU/MW x stack x bettor kind)
    const nf = v.fold + v.call + v.raise;
    theory.push({
      fc: v.n0.fc,
      key: v.key,
      opp: v.n0.opp,
      n: nf,
      f: v.f,
      be: v.beAvg,
      beta: v.beta,
      evbc: v.evbc,
      verdict: v.verdict,
      per100: per100(v.n0.fc, v.theory * nf),
      actualPer100: per100(v.n0.fc, Math.max(0, v.edge) * nf),
      ex: v.ex.slice(0, 6),
    });
  }
  theory.sort((a, b) => b.per100 - a.per100);
  // results
  const agg = (map, key, hr) => {
    const v = map.get(key) || {
      hands: 0,
      personHands: 0,
      pNet: 0,
      pAdj: 0,
      hNet: 0,
      hAdj: 0,
      sd: 0,
      mistakes: 0,
      cost: 0,
      exactN: 0,
      rangeCost: 0,
      allin: 0,
    };
    v.hands++;
    v.personHands += hr.persons.length;
    v.pNet += hr.pNet;
    v.pAdj += hr.pAdj;
    v.hNet += hr.hNet;
    v.hAdj += hr.hAdj;
    v.sd += hr.showdown ? 1 : 0;
    v.allin += hr.allInAdj ? 1 : 0;
    v.exactN += hr.exact.length;
    for (const e of hr.exact)
      if (e.verdict === 'MISTAKE') {
        v.mistakes++;
        v.cost += e.cost;
      }
    for (const e of hr.range) v.rangeCost += e.cost;
    map.set(key, v);
  };
  const byFmt = new Map();
  const byStake = new Map();
  const byDay = new Map();
  const byRegime = new Map();
  const byBuild = new Map();
  const people = new Map();
  for (const hr of handRows) {
    const H = hr.H;
    const fc = fmtClass(H.fmt);
    agg(byFmt, H.fmt, hr);
    agg(
      byStake,
      fc === 'cash' ? `cash ${r2(H.sbv)}/${r2(H.bb)}` : `${H.fmt} buy-in ${r2(H.tbuy)}`,
      hr
    );
    agg(byDay, `${fc} ${dayOf(H.ts)}`, hr);
    agg(byRegime, `${fc} ${regimeOf(H.ts, H.tour)}`, hr);
    agg(byBuild, `${fc} ${H.build}`, hr);
    for (const p of hr.persons) {
      const k = `${fc} | ${p.name || p.uid.slice(0, 8)}`;
      const v = people.get(k) || {
        fc,
        name: p.name || p.uid.slice(0, 8),
        hands: 0,
        net: 0,
        adj: 0,
        sdNet: 0,
        nsdNet: 0,
        lines: new Map(),
      };
      const net = hr.nets.get(p.seat) / H.bb;
      v.hands++;
      v.net += net;
      v.adj += hr.luck ? net - (hr.luck.get(p.seat) || 0) / H.bb : net;
      if (H.sd.has(p.seat) && H.sd.size >= 2) v.sdNet += net;
      else v.nsdNet += net;
      if (net > 0) {
        const ln = personLine(H, p.seat);
        const cur = v.lines.get(ln) || [0, 0];
        v.lines.set(ln, [cur[0] + net, cur[1] + 1]);
      }
      people.set(k, v);
    }
  }
  return {
    fcHands,
    fmtHands,
    personHands,
    dayHands,
    tierCount,
    streetTable,
    leaks,
    leaksCoarse,
    strengths,
    theory,
    people,
    byFmt,
    byStake,
    byDay,
    byRegime,
    byBuild,
    meta,
  };
}

function personLine(H, seat) {
  const parts = [];
  for (const st of STREETS) {
    const ds = H.decisions.filter((d) => d.seat === seat && d.street === st);
    if (!ds.length) continue;
    parts.push(
      `${st[0].toUpperCase()}:${ds.map((d) => ({ fold: 'F', check: 'X', call: 'C', bet: 'B', raise: 'R' })[d.kind] || '?').join('')}`
    );
  }
  return parts.join(' ') + (H.sd.has(seat) && H.sd.size >= 2 ? ' sd' : ' nsd');
}

export function compareWindows(curNodes, cmpNodes, { minN = 30, z = 2 } = {}) {
  const worse = [];
  for (const [k, v] of curNodes) {
    if (!['over-fold', 'calls below the price', 'over-bluff'].includes(v.verdict)) continue;
    const c = cmpNodes.get(k);
    if (!c) continue;
    const bet = v.verdict === 'over-bluff';
    const nv = bet ? v.bet : v.fold + v.call + v.raise;
    const nc = bet ? c.bet : c.fold + c.call + c.raise;
    if (nv < minN || nc < minN) continue;
    const pv = bet ? v.worked / v.bet : v.fold / nv;
    const pc = bet ? c.worked / c.bet : c.fold / nc;
    const p = (pv * nv + pc * nc) / (nv + nc);
    const se = Math.sqrt(p * (1 - p) * (1 / nv + 1 / nc)) || 1;
    const zz = (pv - pc) / se;
    const worseDir = v.verdict === 'over-fold' ? zz >= z : zz <= -z;
    if (worseDir)
      worse.push({ key: k, verdict: v.verdict, now: pv, before: pc, nNow: nv, nBefore: nc, z: zz });
  }
  return worse;
}

const csvCell = (x) => {
  const s = x === null || x === undefined ? '' : String(x);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const DECISION_COLUMNS = [
  'hand_id',
  'time',
  'day',
  'format',
  'stake_or_buyin',
  'stack_bb',
  'street',
  'node',
  'action',
  'tier',
  'verdict',
  'cost_bb',
  'gain_bb',
  'theory_cost_bb',
  'mistake_type',
  'opp_person',
  'build',
  'regime',
  'horse',
  'position',
  'hu',
  'pot_bb',
  'to_call_bb',
  'bet_to_bb',
  'best_action',
  'ev_taken_bb',
  'ev_best_bb',
  'equity_vs_range',
  'hindsight_equity',
  'hindsight_verdict',
  'hindsight_cost_bb',
  'hand_class',
  'icm_note',
];
export function decisionRows(res) {
  const byHand = new Map(res.hands.map((H) => [H.id, H]));
  const rows = [...res.exact, ...res.rangeRows].sort((a, b) =>
    a.hand === b.hand ? a.d.i - b.d.i : byHand.get(a.hand).ts - byHand.get(b.hand).ts
  );
  return rows.map((r) => {
    const H = byHand.get(r.hand);
    const d = r.d;
    const n = nodeOf(H, d);
    const st = H.stage || {};
    const icm =
      H.tour && !st.inMoney && (st.nearBubble || st.handForHand)
        ? 'bubble pressure: chip-EV may mislead'
        : H.tour && st.finalTable
          ? 'final table: chip-EV may mislead'
          : '';
    return [
      H.id,
      new Date(H.ts).toISOString(),
      dayOf(H.ts),
      H.fmt,
      H.fmt === 'cash' ? `${r2(H.sbv)}/${r2(H.bb)}` : r2(H.tbuy),
      r1((d.stack + d.streetBet) / H.bb),
      d.street,
      nodeKey(n),
      actOf(d),
      r.tier,
      r.verdict,
      r2(r.cost),
      r2(r.gain),
      r.theory ? r2(r.theory) : '',
      r.type,
      personFacing(H, d) ? 'y' : 'n',
      H.build,
      regimeOf(H.ts, H.tour),
      r.horse,
      n.pos,
      n.hu,
      r1(d.P / H.bb),
      r1(d.C / H.bb),
      d.kind === 'bet' || d.kind === 'raise' ? r1(d.to / H.bb) : '',
      r.best ?? '',
      r.evTaken !== undefined ? r2(r.evTaken) : '',
      r.evBest !== undefined ? r2(r.evBest) : '',
      r.eq !== undefined ? r2(r.eq) : '',
      r.hindEq !== null && r.hindEq !== undefined ? r2(r.hindEq) : '',
      r.hindVerdict ?? '',
      r.hindCost ? r2(r.hindCost) : '',
      r.cls ?? '',
      icm,
    ];
  });
}
export function decisionsCsv(res) {
  return (
    [DECISION_COLUMNS.join(','), ...decisionRows(res).map((r) => r.map(csvCell).join(','))].join(
      '\n'
    ) + '\n'
  );
}
export const HAND_COLUMNS = [
  'hand_id',
  'time',
  'day',
  'format',
  'stake_or_buyin',
  'tournament',
  'build',
  'regime',
  'players',
  'people',
  'person_names',
  'person_net_bb',
  'person_allin_adjusted_bb',
  'horse_net_bb',
  'horse_allin_adjusted_bb',
  'allin_adjusted',
  'allin_street',
  'showdown',
  'horse_decisions_exact',
  'horse_decisions_range',
  'exact_mistakes',
  'exact_cost_bb',
  'range_cost_bb',
  'conservation_gap_bb',
];
export function handsCsv(res) {
  const lines = [HAND_COLUMNS.join(',')];
  res.handRows.forEach((hr, i) => {
    const H = hr.H;
    lines.push(
      [
        H.id,
        new Date(H.ts).toISOString(),
        dayOf(H.ts),
        H.fmt,
        H.fmt === 'cash' ? `${r2(H.sbv)}/${r2(H.bb)}` : r2(H.tbuy),
        H.tname || '',
        H.build,
        regimeOf(H.ts, H.tour),
        H.seats.size,
        hr.persons.length,
        hr.persons.map((p) => p.name || p.uid.slice(0, 8)).join(' '),
        r2(hr.pNet),
        r2(hr.pAdj),
        r2(hr.hNet),
        r2(hr.hAdj),
        hr.allInAdj ? 'y' : 'n',
        hr.allInStreet,
        hr.showdown ? 'y' : 'n',
        hr.exact.length,
        hr.range.length,
        hr.exact.filter((e) => e.verdict === 'MISTAKE').length,
        r2(hr.exact.reduce((a, e) => a + e.cost, 0)),
        r2(hr.range.reduce((a, e) => a + e.cost, 0)),
        r2(res.conservation[i]),
      ]
        .map(csvCell)
        .join(',')
    );
  });
  return lines.join('\n') + '\n';
}

/** People's tournament entries: entries, cashes, wins, expected cashes (paid/field), finish percentile. */
export function entriesSummary(entries) {
  const by = new Map();
  for (const raw of entries || []) {
    const e = raw.entry ?? raw;
    const fmt =
      String(e.tt || '').toUpperCase() === 'SPIN'
        ? 'spin'
        : String(e.tt || '').toUpperCase() === 'SNG'
          ? Number(e.tmax) === 2
            ? 'hu'
            : 'sng'
          : e.taof
            ? 'mtt-aof'
            : 'mtt';
    const v = by.get(fmt) || {
      entries: 0,
      finished: 0,
      cashes: 0,
      wins: 0,
      expCash: 0,
      buyins: 0,
      prizes: 0,
      pctSum: 0,
      pctN: 0,
    };
    v.entries++;
    v.buyins += Number(e.buy) || 0;
    v.prizes += Number(e.prize) || 0;
    if (Number(e.prize) > 0) v.cashes++;
    if (Number(e.pos) === 1) v.wins++;
    if (Number(e.field) > 0) v.expCash += (Number(e.paid) || 0) / Number(e.field);
    if (Number(e.pos) > 0 && Number(e.field) > 1) {
      v.finished++;
      v.pctSum += (Number(e.pos) - 1) / (Number(e.field) - 1);
      v.pctN++;
    }
    by.set(fmt, v);
  }
  return by;
}

export function formatMarkdown(sum, opts = {}) {
  const L = [];
  const {
    fcHands,
    fmtHands,
    personHands,
    dayHands,
    tierCount,
    streetTable,
    leaks,
    leaksCoarse,
    strengths,
    theory,
    people,
    byFmt,
    byStake,
    byDay,
    byRegime,
    byBuild,
    meta,
  } = sum;
  L.push('## Coverage');
  L.push(
    `Window ${meta.since ?? '?'} to ${meta.until ?? '?'}. Hands with a person: cash ${fcHands.cash} (person-hands ${personHands.cash}), tournament ${fcHands.tournament} (person-hands ${personHands.tournament}).`
  );
  L.push(
    `By format: ${Object.entries(fmtHands)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}. By day (America/Chicago): ${Object.entries(dayHands)
      .sort()
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}.`
  );
  L.push(
    `Horse decisions graded, by format and tier: ${Object.entries(tierCount)
      .sort()
      .map(([k, v]) => `${k} ${v}`)
      .join(
        ', '
      )}. Priors ${PRIORS_VERSION}; tolerance max(${TOL_BB} bb, ${TOL_POT * 100}% of pot), size-only max(1 bb, 15% of pot).`
  );
  L.push('');
  for (const fc of ['cash', 'tournament']) {
    L.push(
      `## ${fc === 'cash' ? 'Cash' : 'Tournaments, SNG, Spin, heads-up'}: Horse decisions per street and action`
    );
    L.push(
      '| Street | Action | Exact n | Correct | Mistakes | bb lost | bb won (vs passive) | of which vs people: n / mistakes / bb lost | Hindsight mistakes | Range n | In leak nodes | est bb lost (actual) | est bb won | theoretical bb (pure bluffs) |'
    );
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const tot = {
      exN: 0,
      exOk: 0,
      exBad: 0,
      exLost: 0,
      exWon: 0,
      hindBad: 0,
      exP: 0,
      exPBad: 0,
      exPLost: 0,
      rgN: 0,
      rgLeak: 0,
      rgLost: 0,
      rgWon: 0,
      rgTheory: 0,
    };
    for (const st of STREETS)
      for (const [a, c] of Object.entries(streetTable[fc][st])) {
        for (const k of Object.keys(tot)) tot[k] += c[k];
        L.push(
          `| ${st} | ${a} | ${c.exN} | ${c.exOk} | ${c.exBad} | ${r1(c.exLost)} | ${r1(c.exWon)} | ${c.exP} / ${c.exPBad} / ${r1(c.exPLost)} | ${c.hindBad} | ${c.rgN} | ${c.rgLeak} | ${r1(c.rgLost)} | ${r1(c.rgWon)} | ${r1(c.rgTheory)} |`
        );
      }
    L.push(
      `| all | all | ${tot.exN} | ${tot.exOk} | ${tot.exBad} | ${r1(tot.exLost)} | ${r1(tot.exWon)} | ${tot.exP} / ${tot.exPBad} / ${r1(tot.exPLost)} | ${tot.hindBad} | ${tot.rgN} | ${tot.rgLeak} | ${r1(tot.rgLost)} | ${r1(tot.rgWon)} | ${r1(tot.rgTheory)} |`
    );
    L.push('');
    L.push(
      `### Ranked leaks versus people (${fc}): mistake type x street, chips actually lost, per 100 hands of the format`
    );
    L.push(
      '| # | Mistake | Street | Tiers | n | bb lost | per 100 | Top spots (bb) | Existing fix | Examples |'
    );
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    leaksCoarse
      .filter((g) => g.fc === fc)
      .slice(0, opts.top ?? 15)
      .forEach((g, i) => {
        L.push(
          `| ${i + 1} | ${g.type} | ${g.street} | ${g.tiers} | ${g.n} | ${r1(g.bb)} | ${r2(g.per100)} | ${g.topSpots.map(([s, b]) => `${s} (${r1(b)})`).join('; ')} | ${g.fix} | ${g.ex
            .slice(0, 6)
            .map((e) => e.id.slice(0, 8))
            .join(' ')} |`
        );
      });
    L.push('');
    L.push(`#### Example hands for the top leaks (${fc})`);
    leaksCoarse
      .filter((g) => g.fc === fc)
      .slice(0, opts.topExamples ?? 10)
      .forEach((g, i) => {
        L.push(`${i + 1}. ${g.type} (${g.street}):`);
        for (const e of g.ex.slice(0, 8)) L.push(`   - ${e.id}: ${e.line}`);
      });
    L.push('');
    L.push(
      `### Theoretical exploitability (${fc}): what pure bluffs could take, against what the bettors' real ranges cost`
    );
    L.push(
      '| # | Node | Bettor | n | Fold | Bluffer break-even | Measured bluff share | Bluff-catcher call EV bb | Verdict | Theoretical per 100 | Actual per 100 |'
    );
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    theory
      .filter((g) => g.fc === fc)
      .slice(0, opts.top ?? 15)
      .forEach((g, i) => {
        L.push(
          `| ${i + 1} | ${g.key} | ${g.opp} | ${g.n} | ${pct(g.f)} | ${pct(g.be)} | ${g.beta === undefined ? '-' : pct(g.beta)} | ${g.evbc === undefined ? '-' : r2(g.evbc)} | ${g.verdict} | ${r2(g.per100)} | ${r2(g.actualPer100)} |`
        );
      });
    L.push('');
    L.push(`### What the Horses do well versus people (${fc})`);
    L.push('| # | Tier | Street | Spot | n | bb won | per 100 | Examples |');
    L.push('|---|---|---|---|---|---|---|---|');
    strengths
      .filter((g) => g.fc === fc)
      .slice(0, opts.topStrengths ?? 10)
      .forEach((g, i) => {
        L.push(
          `| ${i + 1} | ${g.tier} | ${g.street} | ${g.spot} | ${g.n} | ${r1(g.bb)} | ${r2(g.per100)} | ${g.ex
            .slice(0, 5)
            .map((e) => e.slice(0, 8))
            .join(' ')} |`
        );
      });
    L.push('');
  }
  const resTable = (title, map) => {
    L.push(`### ${title}`);
    L.push(
      '| Key | Hands | Person-hands | People net bb | People all-in adjusted bb | Horses net bb (all Horse seats) | Showdowns | All-in adjusted hands | Exact decisions | Exact mistakes | Exact cost bb | Range est cost bb |'
    );
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [k, v] of [...map.entries()].sort())
      L.push(
        `| ${k} | ${v.hands} | ${v.personHands} | ${r1(v.pNet)} | ${r1(v.pAdj)} | ${r1(v.hNet)} | ${v.sd} | ${v.allin} | ${v.exactN} | ${v.mistakes} | ${r1(v.cost)} | ${r1(v.rangeCost)} |`
      );
    L.push('');
  };
  L.push('## Results (chips in big blinds; tournaments in tournament chips / bb)');
  resTable('By format', byFmt);
  resTable('By stake / buy-in', byStake);
  resTable('By day (America/Chicago)', byDay);
  resTable('By regime', byRegime);
  resTable('By engine build', byBuild);
  L.push('### By person');
  L.push(
    '| Format | Person | Hands | Net bb | All-in adjusted bb | Showdown bb | Non-showdown bb | Biggest winning line (bb, hands) |'
  );
  L.push('|---|---|---|---|---|---|---|---|');
  for (const v of [...people.values()].sort((a, b) => b.net - a.net)) {
    const best = [...v.lines.entries()].sort((a, b) => b[1][0] - a[1][0])[0];
    L.push(
      `| ${v.fc} | ${v.name} | ${v.hands} | ${r1(v.net)} | ${r1(v.adj)} | ${r1(v.sdNet)} | ${r1(v.nsdNet)} | ${best ? `${best[0]} ${r1(best[1][0])} (${best[1][1]})` : '-'} |`
    );
  }
  L.push('');
  if (opts.entries) {
    L.push(
      '### People in tournaments: entries and prizes (tournament_players; chips or Diamonds, not money)'
    );
    L.push(
      '| Format | Entries | Placed | Cashes | Expected cashes (paid/field) | Wins | Buy-ins | Prizes | Mean finish percentile (0 = first) |'
    );
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const [k, v] of opts.entries)
      L.push(
        `| ${k} | ${v.entries} | ${v.finished} | ${v.cashes} | ${r1(v.expCash)} | ${v.wins} | ${r1(v.buyins)} | ${r1(v.prizes)} | ${v.pctN ? r2(v.pctSum / v.pctN) : '-'} |`
      );
    L.push('');
  }
  if (opts.worse) {
    L.push('## Leak nodes worse than the comparison window');
    if (!opts.worse.length) L.push('None.');
    for (const w of opts.worse)
      L.push(
        `- ${w.key}: ${w.verdict}, now ${pct(w.now)} (n ${w.nNow}) vs before ${pct(w.before)} (n ${w.nBefore}), z ${r2(w.z)}`
      );
    L.push('');
  }
  L.push(
    `Events: ${EVENTS.map((e) => `${e.key} on ${e.on}${e.off ? ' off ' + e.off : ''}`).join('; ')}.`
  );
  return L.join('\n');
}
