// Aggregates graded decisions, hand results and range-tier nodes into the summary the report and the exit code use.
const per100 = (x, n) => (n > 0 ? (x / n) * 100 : 0);
const grp = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
export function gainOf(r) {
  if (r.tier !== 'A' || r.verdict !== 'CORRECT') return 0;
  if (!['call', 'bet', 'raise'].includes(r.act_taken)) return 0;
  return Math.max(0, r.gain_bb ?? 0);
}
const DESCRIBE = {
  'missed bet (fold equity)':
    'checked where a bet priced higher on the measured fold rate of that field (one-street model, upper bound)',
  'missed raise for value':
    'called where a pot raise priced higher against the bettor range continuing at the measured rate',
  'missed value bet': 'checked a hand that is ahead of the calling range',
  'bet too small': 'bet smaller than the best-priced size',
  'bet too big': 'bet bigger than the best-priced size',
  'called too light':
    'called a bet with less equity against the measured bettor range than the price',
  'paid off (river call)':
    'called a river bet under the price against the measured range, and the bettor showed the better hand',
  'raised a non-nut hand on turn/river':
    'raised a turn or river bet with a hand that is not the nuts and the raise priced below the alternatives',
  'raised a draw out of position':
    'raised out of position with one pair or less and a draw, priced below calling or folding',
  'raise without price': 'raised where calling or folding priced higher',
  'bluffed without price':
    'bet with low equity when called where the measured fold rate did not pay for it',
  'bet too thin (check better)': 'bet a medium hand where checking priced higher',
  'slow-played into a free card':
    'checked the current nuts on the flop or turn where betting priced higher',
  'preflop: call of a 3-bet or 4-bet out of position':
    'called a 3-bet or 4-bet out of position with too little equity against the measured range width',
  'preflop: call of a 3-bet or 4-bet in position':
    'called a 3-bet or 4-bet in position with too little equity against the measured range width',
  'preflop: 3-bet that cannot continue':
    '3-bet a hand whose price against the continuing range is below calling or folding',
  'preflop: 4-bet without price':
    '4-bet a hand whose price against the continuing range is below calling or folding',
  'preflop: cold-call too wide':
    'cold-called an open with too little equity against the opener width',
  'preflop: limp-behind': 'limped behind where folding or raising priced higher',
  'preflop: open-limp / complete':
    'limped first in (or completed the small blind) where folding or raising priced higher',
  'preflop: missed squeeze': 'flatted an open with callers in where a raise priced higher',
};
export function aggregate({ hands, decisions, nodes, splitAt = null }) {
  const personHands = sum(hands, (h) => h.n_people);
  const A = decisions.filter((r) => r.tier === 'A');
  const B = decisions.filter((r) => r.tier === 'B');
  const out = {
    personHands,
    hands: hands.length,
    decisions: decisions.length,
    tierA: A.length,
    tierB: B.length,
  };
  // coverage
  out.coverage = {
    byGame: [...grp(hands, (h) => h.game)].map(([g, hs]) => ({
      game: g,
      hands: hs.length,
      personHands: sum(hs, (h) => h.n_people),
      showdown: hs.filter((h) => h.showdown).length,
      decisions: decisions.filter((r) => r.game === g).length,
      tierA: A.filter((r) => r.game === g).length,
      tierB: B.filter((r) => r.game === g).length,
    })),
    byDay: [...grp(hands, (h) => h.day + '|' + h.game)].sort().map(([k, hs]) => ({
      day: k.split('|')[0],
      game: k.split('|')[1],
      hands: hs.length,
      personHands: sum(hs, (h) => h.n_people),
      tierA: A.filter((r) => r.day + '|' + r.game === k).length,
      tierB: B.filter((r) => r.day + '|' + r.game === k).length,
    })),
    byPerson: [
      ...grp(
        hands.flatMap((h) => h.perPerson.map((p) => ({ ...p, game: h.game }))),
        (p) => p.name
      ),
    ]
      .map(([n, ps]) => ({
        person: n,
        personHands: ps.length,
        share: ps.length / Math.max(personHands, 1),
      }))
      .sort((a, b) => b.personHands - a.personHands),
    tierAByStreet: [...grp(A, (r) => r.street)].map(([s, rs]) => ({ street: s, n: rs.length })),
  };
  // per street x decision type
  out.byStreetAction = [...grp(A, (r) => `${r.street}|${r.act_taken}`)]
    .map(([k, rs]) => {
      const [street, action] = k.split('|');
      const m = rs.filter((r) => r.verdict === 'MISTAKE');
      return {
        street,
        action,
        n: rs.length,
        correct: rs.length - m.length,
        mistakes: m.length,
        hard: m.filter((r) => r.mclass === 'HARD').length,
        hardBb: sum(
          m.filter((r) => r.mclass === 'HARD'),
          (r) => r.cost_bb
        ),
        oppBb: sum(
          m.filter((r) => r.mclass === 'OPPORTUNITY'),
          (r) => r.cost_bb
        ),
        wonBb: sum(rs, gainOf),
      };
    })
    .sort(
      (a, b) =>
        ['preflop', 'flop', 'turn', 'river'].indexOf(a.street) -
          ['preflop', 'flop', 'turn', 'river'].indexOf(b.street) || a.action.localeCompare(b.action)
    );
  out.byStreet = ['preflop', 'flop', 'turn', 'river'].map((s) => {
    const rs = A.filter((r) => r.street === s);
    const m = rs.filter((r) => r.verdict === 'MISTAKE');
    return {
      street: s,
      n: rs.length,
      correct: rs.length - m.length,
      mistakes: m.length,
      hard: m.filter((r) => r.mclass === 'HARD').length,
      hardBb: sum(
        m.filter((r) => r.mclass === 'HARD'),
        (r) => r.cost_bb
      ),
      opp: m.filter((r) => r.mclass === 'OPPORTUNITY').length,
      oppBb: sum(
        m.filter((r) => r.mclass === 'OPPORTUNITY'),
        (r) => r.cost_bb
      ),
      wonBb: sum(rs, gainOf),
      hindN: rs.filter((r) => r.hind_cost_bb !== null && r.hind_cost_bb !== undefined).length,
    };
  });
  // leaks versus people
  const leakKey = (r) =>
    r.tier === 'A' && r.verdict === 'MISTAKE' && r.opp_person === 'y'
      ? `${r.mclass}|${r.mtype}|${r.street}|${r.pos}|${r.into}`
      : null;
  out.leaks = [...grp(decisions, leakKey)]
    .map(([k, rs]) => {
      const [cls, type, street, pos, into] = k.split('|');
      const bb = sum(rs, (r) => r.cost_bb);
      return {
        cls,
        type,
        street,
        pos,
        into,
        n: rs.length,
        bb,
        per100: per100(bb, personHands),
        hindBb: sum(rs, (r) => r.hind_cost_bb),
        desc: DESCRIBE[type] ?? type,
        examples: rs
          .slice()
          .sort((a, b) => b.cost_bb - a.cost_bb)
          .slice(0, 8)
          .map((r) => r.hand_id),
      };
    })
    .sort((a, b) => b.bb - a.bb);
  out.strengths = [
    ...grp(
      A.filter((r) => r.opp_person === 'y' && gainOf(r) > 0),
      (r) => `${r.act_taken}|${r.street}|${r.pos}|${r.into}`
    ),
  ]
    .map(([k, rs]) => {
      const [action, street, pos, into] = k.split('|');
      const bb = sum(rs, gainOf);
      return {
        action,
        street,
        pos,
        into,
        n: rs.length,
        bb,
        per100: per100(bb, personHands),
        examples: rs
          .slice()
          .sort((a, b) => gainOf(b) - gainOf(a))
          .slice(0, 6)
          .map((r) => r.hand_id),
      };
    })
    .sort((a, b) => b.bb - a.bb);
  out.breaches = [
    ...grp(
      A.filter((r) => r.breach),
      (r) => r.breach
    ),
  ].map(([k, rs]) => ({
    breach: k,
    n: rs.length,
    vsPerson: rs.filter((r) => r.opp_person === 'y').length,
    costBb: sum(rs, (r) => r.cost_bb),
    examples: rs.slice(0, 8).map((r) => r.hand_id),
    // every hand, so the daily audit can tell a hand an earlier overlapping run already listed
    hands: [...new Set(rs.map((r) => r.hand_id))],
  }));
  // graded apart, not breaches: e.g. a turn/river raise with a nut-class hand that is not the exact nuts
  out.notes = [
    ...grp(
      A.filter((r) => r.note),
      (r) => r.note
    ),
  ].map(([k, rs]) => ({
    note: k,
    n: rs.length,
    vsPerson: rs.filter((r) => r.opp_person === 'y').length,
    costBb: sum(rs, (r) => r.cost_bb),
    examples: rs.slice(0, 8).map((r) => r.hand_id),
  }));
  // results
  const res = (hs) => {
    const net = sum(hs, (h) => h.person_net_bb),
      luck = sum(hs, (h) => h.person_luck_bb),
      ph = sum(hs, (h) => h.n_people);
    const xs = hs.map((h) => h.person_net_bb - h.person_luck_bb);
    const mean = xs.length ? sum(xs, (x) => x) / xs.length : 0;
    const sd = xs.length > 1 ? Math.sqrt(sum(xs, (x) => (x - mean) ** 2) / (xs.length - 1)) : 0;
    return {
      hands: hs.length,
      personHands: ph,
      personNet: net,
      personAdj: net - luck,
      per100: per100(net, ph),
      adjPer100: per100(net - luck, ph),
      se100: xs.length ? (sd / Math.sqrt(xs.length)) * 100 : 0,
      horseNet: sum(hs, (h) => h.horse_net_bb),
      horseAdj: sum(hs, (h) => h.horse_net_bb - h.horse_luck_bb),
      rake: sum(hs, (h) => h.rake_bb),
      allIns: hs.filter((h) => h.allin_adjusted).length,
    };
  };
  out.results = {
    total: res(hands),
    byGame: [...grp(hands, (h) => h.game)].map(([k, hs]) => ({ key: k, ...res(hs) })),
    byStake: [...grp(hands, (h) => `${h.game} bb ${h.stake}`)]
      .map(([k, hs]) => ({ key: k, ...res(hs) }))
      .sort((a, b) => b.hands - a.hands),
    byDay: [...grp(hands, (h) => h.day)].sort().map(([k, hs]) => ({ key: k, ...res(hs) })),
    byBuild: [...grp(hands, (h) => h.build)]
      .map(([k, hs]) => ({ key: k, first: hs[0].time, ...res(hs) }))
      .sort((a, b) => a.first.localeCompare(b.first)),
    byRegime: [...grp(hands, (h) => h.regime)].sort().map(([k, hs]) => ({ key: k, ...res(hs) })),
  };
  const pp = hands.flatMap((h) => h.perPerson.map((p) => ({ ...p, game: h.game })));
  const pres = (ps) => ({
    personHands: ps.length,
    net: sum(ps, (p) => p.net),
    adj: sum(ps, (p) => p.net - p.luck),
    per100: per100(
      sum(ps, (p) => p.net),
      ps.length
    ),
    adjPer100: per100(
      sum(ps, (p) => p.net - p.luck),
      ps.length
    ),
  });
  out.results.byPerson = [...grp(pp, (p) => p.name)]
    .map(([k, ps]) => ({
      key: k,
      ...pres(ps),
      lines: [...grp(ps, (p) => p.line)]
        .map(([l, qs]) => ({ line: l, ...pres(qs) }))
        .sort((a, b) => b.net - a.net),
    }))
    .sort((a, b) => b.personHands - a.personHands);
  out.results.byLine = [...grp(pp, (p) => p.line)]
    .map(([k, ps]) => ({ key: k, ...pres(ps) }))
    .sort((a, b) => b.net - a.net);
  // regimes: tier A mistake rates
  out.regimeRates = [...grp(A, (r) => r.regime)].sort().map(([k, rs]) => ({
    regime: k,
    n: rs.length,
    hard: rs.filter((r) => r.mclass === 'HARD').length,
    hardBb: sum(
      rs.filter((r) => r.mclass === 'HARD'),
      (r) => r.cost_bb
    ),
    hardPerDecision:
      sum(
        rs.filter((r) => r.mclass === 'HARD'),
        (r) => r.cost_bb
      ) / Math.max(rs.length, 1),
  }));
  out.nodes = nodes;
  out.rangeTotals = {
    overVsPerson: sum(
      nodes.filter((n) => n.vsPerson),
      (n) => n.overCost
    ),
    underVsPerson: sum(
      nodes.filter((n) => n.vsPerson),
      (n) => n.underCost
    ),
    theoVsPerson: sum(
      nodes.filter((n) => n.vsPerson),
      (n) => n.theoretical
    ),
    overAll: sum(nodes, (n) => n.overCost),
    theoAll: sum(nodes, (n) => n.theoretical),
  };
  // split comparison for the exit code
  if (splitAt) {
    const t = Date.parse(splitAt);
    const before = decisions.filter((r) => Date.parse(r.time) < t),
      after = decisions.filter((r) => Date.parse(r.time) >= t);
    const phB = sum(
        hands.filter((h) => Date.parse(h.time) < t),
        (h) => h.n_people
      ),
      phA = sum(
        hands.filter((h) => Date.parse(h.time) >= t),
        (h) => h.n_people
      );
    const lk = (rs) =>
      grp(
        rs.filter(
          (r) =>
            r.tier === 'A' && r.verdict === 'MISTAKE' && r.mclass === 'HARD' && r.opp_person === 'y'
        ),
        (r) => `${r.mtype}|${r.street}`
      );
    const mb = lk(before),
      ma = lk(after);
    out.split = { at: splitAt, personHandsBefore: phB, personHandsAfter: phA, worse: [] };
    for (const [k, rs] of ma) {
      const a = per100(
          sum(rs, (r) => r.cost_bb),
          phA
        ),
        b = per100(
          sum(mb.get(k) ?? [], (r) => r.cost_bb),
          phB
        );
      // worse: at least 5 cases after, and more than 5 bb/100 and 50% above the comparison window
      if (rs.length >= 5 && a > b + 5 && a > 1.5 * b)
        out.split.worse.push({ leak: k, before: b, after: a, nAfter: rs.length });
    }
  }
  return out;
}
