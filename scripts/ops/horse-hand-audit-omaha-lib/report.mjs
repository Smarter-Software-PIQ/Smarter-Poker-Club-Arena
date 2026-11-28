// Markdown tables and CSV writers for the Omaha hand audit.
const f1 = (x) =>
  x === null || x === undefined || Number.isNaN(x)
    ? ''
    : (Math.round(x * 10) / 10).toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
const f0 = (x) => (x === null || x === undefined ? '' : Math.round(x).toLocaleString('en-US'));
const pc = (x) => (x === null || x === undefined ? '' : (x * 100).toFixed(1));
const table = (head, rows) =>
  [
    '| ' + head.join(' | ') + ' |',
    '|' + head.map(() => '---').join('|') + '|',
    ...rows.map((r) => '| ' + r.join(' | ') + ' |'),
  ].join('\n');
export function csv(rows, cols) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return (
    [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n'
  );
}
export const DECISION_COLS = [
  'hand_id',
  'time',
  'day',
  'game',
  'stake',
  'street',
  'node',
  'action',
  'tier',
  'verdict',
  'cost_bb',
  'mclass',
  'mtype',
  'opp_person',
  'facing_person',
  'build',
  'regime',
  'horse',
  'pos',
  'into',
  'size',
  'pot_bb',
  'tocall_bb',
  'eq',
  'eq_se',
  'eq_hind',
  'hind_cost_bb',
  'best',
  'taken',
  'ev_taken_bb',
  'ev_best_bb',
  'gain_bb',
  'tol_bb',
  'breach',
  'note',
  'nut_class',
  'nuts',
  'outs',
  'made',
  'hero_pf_q',
  'specs',
  'options',
  'size_band',
];
export const HAND_COLS = [
  'hand_id',
  'time',
  'day',
  'game',
  'stake',
  'build',
  'regime',
  'players',
  'n_people',
  'people',
  'person_lines',
  'person_net_bb',
  'horse_net_bb',
  'rake_bb',
  'pot_bb',
  'bomb',
  'rit',
  'showdown',
  'allin_adjusted',
  'adj_street',
  'person_luck_bb',
  'horse_luck_bb',
  'tierA',
  'tierB',
  'mistakes',
  'mistake_bb',
];
export const NODE_COLS = [
  'key',
  'n',
  'tierA',
  'contShown',
  'xc',
  'fold',
  'call',
  'raise',
  'check',
  'bet',
  'f',
  'meanS',
  'BE',
  'bettorAir',
  'bettorShown',
  'overCost',
  'underCost',
  'theoretical',
  'overPer100',
  'underPer100',
  'theoPer100',
  'bets',
  'betSuccess',
  'betBE',
  'uncontestedWon',
  'aMist',
  'aCost',
  'verdict',
];
export function markdownTables(S, { leakTop = 25, strengthTop = 12, nodeTop = 25 } = {}) {
  const o = [];
  o.push(
    '### Coverage by game\n' +
      table(
        [
          'Game',
          'Hands',
          'Person-hands',
          'Hands with a showdown',
          'Horse decisions',
          'Tier A (cards shown)',
          'Tier B (range)',
        ],
        S.coverage.byGame.map((g) => [
          g.game,
          f0(g.hands),
          f0(g.personHands),
          f0(g.showdown),
          f0(g.decisions),
          f0(g.tierA),
          f0(g.tierB),
        ])
      )
  );
  o.push(
    '### Coverage by day (America/Chicago)\n' +
      table(
        ['Day', 'Game', 'Hands', 'Person-hands', 'Tier A', 'Tier B'],
        S.coverage.byDay.map((d) => [
          d.day,
          d.game,
          f0(d.hands),
          f0(d.personHands),
          f0(d.tierA),
          f0(d.tierB),
        ])
      )
  );
  o.push(
    '### Person share of person-hands\n' +
      table(
        ['Person', 'Person-hands', 'Share %'],
        S.coverage.byPerson.map((p) => [p.person, f0(p.personHands), pc(p.share)])
      )
  );
  o.push(
    '### Tier A by street\n' +
      table(
        [
          'Street',
          'Graded',
          'Correct',
          'Mistakes',
          'HARD mistakes',
          'HARD bb lost',
          'OPPORTUNITY mistakes',
          'OPPORTUNITY bb (upper bound)',
          'bb won by correct calls/bets/raises',
        ],
        S.byStreet.map((s) => [
          s.street,
          f0(s.n),
          f0(s.correct),
          f0(s.mistakes),
          f0(s.hard),
          f1(s.hardBb),
          f0(s.opp),
          f1(s.oppBb),
          f1(s.wonBb),
        ])
      )
  );
  o.push(
    '### Tier A by street and action taken\n' +
      table(
        [
          'Street',
          'Action',
          'Graded',
          'Correct',
          'Mistakes',
          'HARD',
          'HARD bb lost',
          'OPPORTUNITY bb',
          'bb won (correct)',
        ],
        S.byStreetAction.map((s) => [
          s.street,
          s.action,
          f0(s.n),
          f0(s.correct),
          f0(s.mistakes),
          f0(s.hard),
          f1(s.hardBb),
          f1(s.oppBb),
          f1(s.wonBb),
        ])
      )
  );
  const leak = (rows) =>
    table(
      [
        '#',
        'Class',
        'Mistake type',
        'Street',
        'Pos',
        'HU/MW',
        'n',
        'bb lost',
        'bb/100 person-hands',
        'Hindsight bb',
        'What it is',
        'Example hands',
      ],
      rows.map((l, i) => [
        i + 1,
        l.cls,
        l.type,
        l.street,
        l.pos,
        l.into,
        l.n,
        f1(l.bb),
        f1(l.per100),
        f1(l.hindBb),
        l.desc,
        l.examples
          .slice(0, 6)
          .map((x) => x.slice(0, 8))
          .join(' '),
      ])
    );
  o.push(
    '### Ranked HARD leaks versus people (tier A)\n' +
      leak(S.leaks.filter((l) => l.cls === 'HARD').slice(0, leakTop))
  );
  o.push(
    '### Ranked OPPORTUNITY gaps versus people (tier A, one-street model, upper bound)\n' +
      leak(S.leaks.filter((l) => l.cls === 'OPPORTUNITY').slice(0, 15))
  );
  o.push(
    '### What the Horses do well versus people (tier A correct calls, bets and raises; edge over the best passive option)\n' +
      table(
        ['#', 'Action', 'Street', 'Pos', 'HU/MW', 'n', 'bb edge', 'bb/100', 'Example hands'],
        S.strengths.slice(0, strengthTop).map((s, i) => [
          i + 1,
          s.action,
          s.street,
          s.pos,
          s.into,
          s.n,
          f1(s.bb),
          f1(s.per100),
          s.examples
            .slice(0, 5)
            .map((x) => x.slice(0, 8))
            .join(' '),
        ])
      )
  );
  o.push(
    '### Owner-ruling checks (tier A)\n' +
      table(
        ['Rule', 'Cases', 'With a person', 'Graded cost bb', 'Examples'],
        S.breaches.map((b) => [
          b.breach,
          b.n,
          b.vsPerson,
          f1(b.costBb),
          b.examples
            .slice(0, 6)
            .map((x) => x.slice(0, 8))
            .join(' '),
        ])
      )
  );
  if ((S.notes ?? []).length)
    o.push(
      '### Counted apart, not breaches (tier A)\n' +
        table(
          ['What', 'Cases', 'With a person', 'Graded cost bb', 'Examples'],
          S.notes.map((b) => [
            b.note,
            b.n,
            b.vsPerson,
            f1(b.costBb),
            b.examples
              .slice(0, 6)
              .map((x) => x.slice(0, 8))
              .join(' '),
          ])
        )
    );
  const fn = S.nodes.filter((n) => n.key.includes('|facing') && !n.key.startsWith('preflop'));
  o.push(
    '### Tier B facing-bet nodes versus people, by estimated chips lost to over-folding (actual bettor ranges)\n' +
      table(
        [
          'Node',
          'n',
          'Fold %',
          'Break-even s/(1+s) %',
          'Bettor air share % (shown)',
          'Bettor hands shown in window',
          'Over-fold bb (est.)',
          'bb/100',
          'Under-fold bb (est., overlaps tier A)',
          'Theoretical exploitability bb/100',
          'Verdict',
        ],
        fn
          .filter((n) => n.vsPerson)
          .sort((a, b) => b.overCost - a.overCost)
          .slice(0, nodeTop)
          .map((n) => [
            n.key,
            n.n,
            pc(n.f),
            pc(n.BE),
            pc(n.bettorAir),
            n.bettorShown,
            f1(n.overCost),
            f1(n.overPer100),
            f1(n.underCost),
            f1(n.theoPer100),
            n.verdict,
          ])
      )
  );
  o.push(
    '### Tier B facing-bet nodes Horse versus Horse inside these hands (for comparison)\n' +
      table(
        [
          'Node',
          'n',
          'Fold %',
          'BE %',
          'Air %',
          'Over-fold bb (est.)',
          'Theoretical bb/100',
          'Verdict',
        ],
        fn
          .filter((n) => !n.vsPerson)
          .sort((a, b) => b.overCost - a.overCost)
          .slice(0, 12)
          .map((n) => [
            n.key,
            n.n,
            pc(n.f),
            pc(n.BE),
            pc(n.bettorAir),
            f1(n.overCost),
            f1(n.theoPer100),
            n.verdict,
          ])
      )
  );
  const bn = S.nodes.filter((n) => n.key.includes('checked to / first'));
  o.push(
    '### Tier B first-to-act nodes (Horse bets: how often they took the pot at once)\n' +
      table(
        [
          'Node',
          'Decisions',
          'Bets',
          'Bet %',
          'Took the pot at once %',
          'Break-even %',
          'Uncontested bb won',
          'Verdict',
        ],
        bn
          .sort((a, b) => b.n - a.n)
          .slice(0, 16)
          .map((n) => [
            n.key,
            n.n,
            n.bets,
            pc(n.bets / Math.max(n.n, 1)),
            pc(n.betSuccess),
            pc(n.betBE),
            f1(n.uncontestedWon),
            n.verdict,
          ])
      )
  );
  const rr = (rows, label) =>
    table(
      [
        label,
        'Hands',
        'Person-hands',
        'Person net bb',
        'Person bb/100',
        'Person all-in-adjusted bb',
        'Adj bb/100 (SE)',
        'Horses net bb',
        'Horses adj bb',
        'Rake+BBJ bb',
        'All-ins adjusted',
      ],
      rows.map((r) => [
        r.key,
        f0(r.hands),
        f0(r.personHands),
        f1(r.personNet),
        f1(r.per100),
        f1(r.personAdj),
        `${f1(r.adjPer100)} (${f1(r.se100)})`,
        f1(r.horseNet),
        f1(r.horseAdj),
        f1(r.rake),
        f0(r.allIns),
      ])
    );
  o.push(
    '### Results (tier C), total and by game\n' +
      rr([{ key: 'all', ...S.results.total }, ...S.results.byGame], 'Scope')
  );
  o.push('### Results by stake\n' + rr(S.results.byStake, 'Stake'));
  o.push('### Results by day (America/Chicago)\n' + rr(S.results.byDay, 'Day'));
  o.push(
    '### Results by engine build (first hand time)\n' +
      rr(
        S.results.byBuild.map((b) => ({ ...b, key: `${b.key} (${b.first.slice(5, 16)})` })),
        'Build'
      )
  );
  o.push('### Results by switch regime\n' + rr(S.results.byRegime, 'Regime'));
  o.push(
    '### Results by person and preflop line\n' +
      table(
        [
          'Person',
          'Person-hands',
          'Net bb',
          'bb/100',
          'Adj bb',
          'Adj bb/100',
          'Best line (net bb, hands)',
          'Worst line (net bb, hands)',
        ],
        S.results.byPerson.map((p) => [
          p.key,
          f0(p.personHands),
          f1(p.net),
          f1(p.per100),
          f1(p.adj),
          f1(p.adjPer100),
          p.lines[0] ? `${p.lines[0].line} (${f1(p.lines[0].net)}, ${p.lines[0].personHands})` : '',
          p.lines.length > 1
            ? `${p.lines.at(-1).line} (${f1(p.lines.at(-1).net)}, ${p.lines.at(-1).personHands})`
            : '',
        ])
      )
  );
  o.push(
    "### Results by the person's preflop line (all people)\n" +
      table(
        ['Line', 'Person-hands', 'Net bb', 'bb/100', 'Adj bb', 'Adj bb/100'],
        S.results.byLine.map((p) => [
          p.key,
          f0(p.personHands),
          f1(p.net),
          f1(p.per100),
          f1(p.adj),
          f1(p.adjPer100),
        ])
      )
  );
  o.push(
    '### Tier A HARD mistakes by regime\n' +
      table(
        ['Regime', 'Tier A decisions', 'HARD mistakes', 'HARD bb', 'HARD bb per graded decision'],
        S.regimeRates.map((r) => [r.regime, r.n, r.hard, f1(r.hardBb), f1(r.hardPerDecision)])
      )
  );
  return o.join('\n\n');
}
