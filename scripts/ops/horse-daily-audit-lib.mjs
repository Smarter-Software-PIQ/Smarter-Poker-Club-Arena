// scripts/ops/horse-daily-audit-lib.mjs
// Pure core of the read-only Horse daily audit runner (horse-daily-audit.mjs). No I/O here.
//
// One run covers the last 24 hours (or --since/--until). It reads the instants where a decision could have changed
// (every Horse option switch change in ca_horse_style_switch_audit and the first hand of every engine build in
// hand_history.engine_build), turns them into split instants, and runs four read-only tools over the range:
//   horse-hand-audit-holdem.mjs   (NLH, cash and tournaments, shown cards only)
//   horse-hand-audit-omaha.mjs    (PLO4/PLO5 cash, shown cards only)
//   horse-exploit-report.mjs      (--gate regression split at every switch change and build boundary; at most 4
//                                  splits a call, so more splits run as consecutive calls over overlapping ranges)
//   person-vs-horse-results.mjs   (people's results, split at the same instants, at most 8 a call)
//   horse-plo-overfold-gate.mjs   (every over-fold cell: PLO4, PLO5, Hold'em cash and tournaments, flop/turn/river,
//                                  heads-up and multiway, by size, facing a person's first bet, against the people
//                                  prior, people's own folds or minimum defence; says if the cell's fix is ON)
// and writes one dated folder with every tool's own output and a one-page SUMMARY.md.
import { cellTable, foldThroughTable } from './horse-plo-overfold-gate-lib.mjs';

export const RANGE_HOURS = 24;
/** Two boundaries closer than this are one (a cutover starts the engine and its standby minutes apart). */
export const MERGE_MINUTES = 15;
/** A boundary this close to the range's start or end has no window on one side worth comparing: left out. */
export const EDGE_MINUTES = 30;
export const EXPLOIT_MAX_SPLITS = 4;
export const PVH_MAX_SPLITS = 8;
export const GAMES = Object.freeze(['nlh', 'plo4', 'plo5']);

export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tsOf = (v) =>
  Date.parse(
    String(v)
      .replace(' ', 'T')
      .replace(/\+00(:00)?$/, 'Z')
  );

/** The read-only SELECTs of the boundaries. */
export function boundarySql(sinceMs, untilMs) {
  const a = `'${iso(sinceMs)}'::timestamptz`;
  const b = `'${iso(untilMs)}'::timestamptz`;
  return {
    switches: `SELECT changed_at, option, old_state, new_state FROM public.ca_horse_style_switch_audit WHERE changed_at >= ${a} AND changed_at < ${b} ORDER BY changed_at`,
    builds: `SELECT left(engine_build, 12) AS build, min(created_at) AS first_at, max(created_at) AS last_at, count(*) AS hands FROM public.hand_history WHERE created_at >= ${a} AND created_at < ${b} AND game_variant IN ('nlh', 'plo4', 'plo5') GROUP BY 1 ORDER BY 2`,
  };
}

/**
 * The split instants of a range: each switch change, and the first hand of every build whose first hand is inside
 * the range (the build that was already serving at the start is no boundary). Boundaries within MERGE_MINUTES are
 * one (the earliest, with every reason); within EDGE_MINUTES of either end they are left out (listed as such).
 */
export function planSplits(sinceMs, untilMs, { switches = [], builds = [] } = {}) {
  const raw = [];
  for (const s of switches) {
    const t = tsOf(s.changed_at);
    if (Number.isFinite(t))
      raw.push({
        t,
        why: `switch ${s.option} ${s.old_state ?? 'none'} -> ${s.new_state ?? 'cleared'}`,
      });
  }
  const firstBuild = builds.length ? Math.min(...builds.map((b) => tsOf(b.first_at))) : null;
  for (const b of builds) {
    const t = tsOf(b.first_at);
    if (!Number.isFinite(t) || t === firstBuild) continue;
    raw.push({ t, why: `engine build ${b.build} first hand (${b.hands} hands in range)` });
  }
  raw.sort((x, y) => x.t - y.t);
  const merged = [];
  for (const r of raw) {
    const last = merged.at(-1);
    if (last && r.t - last.t <= MERGE_MINUTES * 60_000) last.why.push(r.why);
    else merged.push({ t: r.t, why: [r.why] });
  }
  const edge = EDGE_MINUTES * 60_000;
  const splits = merged.filter((m) => m.t - sinceMs >= edge && untilMs - m.t >= edge);
  const leftOut = merged.filter((m) => !splits.includes(m));
  return {
    splits: splits.map((m) => ({ at: iso(Math.floor(m.t / 1000) * 1000), why: m.why })),
    leftOut: leftOut.map((m) => ({ at: iso(Math.floor(m.t / 1000) * 1000), why: m.why })),
  };
}

/**
 * Consecutive groups of at most `max` splits, each with its own range: from the split before the group (or the
 * range start) to the split after it (or the range end), so every split keeps its full window on both sides.
 */
export function splitGroups(sinceMs, untilMs, splits, max) {
  const at = splits.map((s) => Date.parse(s.at));
  if (!at.length) return [{ since: sinceMs, until: untilMs, splits: [] }];
  const out = [];
  for (let i = 0; i < at.length; i += max) {
    const group = at.slice(i, i + max);
    out.push({
      since: i === 0 ? sinceMs : at[i - 1],
      until: i + max < at.length ? at[i + max] : untilMs,
      splits: group,
    });
  }
  return out;
}

/** The tool runs of one daily audit: name, script, argv, output files. */
export function planRuns(sinceMs, untilMs, splits) {
  const range = ['--since', iso(sinceMs), '--until', iso(untilMs)];
  const runs = [
    {
      name: 'holdem-audit',
      script: 'horse-hand-audit-holdem.mjs',
      args: ['--mode', 'all', ...range, '--json'],
      out: 'holdem-audit.json',
    },
    {
      name: 'omaha-audit',
      script: 'horse-hand-audit-omaha.mjs',
      args: [...range, '--json', '--csv', 'omaha-audit-csv'],
      out: 'omaha-audit.json',
    },
    {
      name: 'plo-overfold',
      script: 'horse-plo-overfold-gate.mjs',
      args: [...range, '--json'],
      out: 'plo-overfold.json',
    },
  ];
  splitGroups(sinceMs, untilMs, splits, EXPLOIT_MAX_SPLITS).forEach((g, i) => {
    const r = ['--since', iso(g.since), '--until', iso(g.until)];
    runs.push({
      name: `exploit-report-${i + 1}`,
      script: 'horse-exploit-report.mjs',
      args: g.splits.length
        ? [...r, '--split-at', g.splits.map(iso).join(','), '--gate=regression', '--json']
        : [...r, '--gate=absolute', '--json'],
      out: `exploit-report-${i + 1}.json`,
    });
  });
  splitGroups(sinceMs, untilMs, splits, PVH_MAX_SPLITS).forEach((g, i) => {
    const r = ['--since', iso(g.since), '--until', iso(g.until)];
    runs.push({
      name: `person-vs-horse-${i + 1}`,
      script: 'person-vs-horse-results.mjs',
      args: g.splits.length
        ? [...r, '--split-at', g.splits.map(iso).join(','), '--gate', '--json']
        : [...r, '--json'],
      out: `person-vs-horse-${i + 1}.json`,
    });
  });
  return runs;
}

/** What a tool's exit code means (each tool: 64 usage, 70 failed read; the rest per tool). */
export function exitMeaning(name, code) {
  if (code === 64) return 'usage error';
  if (code === 70) return 'FAILED (read or run)';
  if (code === null || code === undefined) return 'did not run';
  if (name.startsWith('exploit-report'))
    return ['clean', 'FINDING (exploitable cell)', 'too few decisions'][code] ?? `exit ${code}`;
  if (name.startsWith('person-vs-horse'))
    return (
      ['clean', 'FINDING (people measurably better after a split)', 'too few hands'][code] ??
      `exit ${code}`
    );
  if (name === 'holdem-audit')
    return (
      ['clean', 'FINDING (a leak node measurably worse)', 'too few hands'][code] ?? `exit ${code}`
    );
  if (name === 'omaha-audit')
    return (
      ['clean', 'FINDING (a HARD leak versus people got worse)', 'too few hands'][code] ??
      `exit ${code}`
    );
  if (name === 'plo-overfold')
    return (
      [
        'clean',
        'FINDING (Horses fold above a ceiling facing people; see whether the fix is ON)',
        'too few decisions',
      ][code] ?? `exit ${code}`
    );
  return `exit ${code}`;
}

export const OVERFOLD_HEADING =
  "## Over-Fold Gate (PLO4, PLO5, Hold'em cash and tournaments; flop, turn, river; facing a person's first bet)";
const n1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(1) : '-');
const arr = (x) => (Array.isArray(x) ? x : []);
const pc1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '-');

/**
 * The top leaks: the NLH audit's ranked leaks (format, street, type, bb lost), the PLO audit's HARD leaks versus
 * people (street, position, type, bb, bb/100 people) and the exploit report's top realised-cost findings.
 */
export function topLeaks(results, k = 5) {
  const out = [];
  const hh = results['holdem-audit']?.json;
  for (const l of arr(hh?.leaks).slice(0, k))
    out.push(
      `NLH ${l.fc ?? ''} ${l.street ?? ''}: ${l.type ?? '?'} (n ${l.n ?? '-'}, ${n1(l.bb)} bb, ${n1(l.per100)} bb/100)`.replace(
        /\s+:/,
        ':'
      )
    );
  const om = results['omaha-audit']?.json;
  for (const l of arr(om?.leaks)
    .filter((x) => x.cls === 'HARD')
    .slice(0, k))
    out.push(
      `PLO ${l.street ?? ''} ${l.pos ?? ''}: ${l.type ?? '?'} (n ${l.n ?? '-'}, ${n1(l.bb)} bb, ${n1(l.per100)} bb/100 people)`.replace(
        /\s+:/,
        ':'
      )
    );
  for (const [name, r] of Object.entries(results))
    if (name.startsWith('exploit-report'))
      for (const f of arr(r.json?.findings)
        .filter((x) => x.priority <= 1)
        .slice(0, 3))
        out.push(`exploit: ${f.text}`);
  return out;
}

/** Regressions: every tool's own regression signal, each with an identity that is the same in another run. */
export function regressionRows(results) {
  const out = [];
  for (const [name, r] of Object.entries(results)) {
    const j = r.json;
    if (name === 'holdem-audit')
      for (const w of arr(j?.worse)) {
        const key = w.key ?? w.node ?? JSON.stringify(w).slice(0, 120);
        out.push({
          id: `nlh|${key}`,
          text: `NLH audit: ${key} worse than the earlier windows pooled${Number.isFinite(w.z) && Number.isFinite(w.zBar) ? ` (z ${w.z.toFixed(2)} against a bar of ${w.zBar.toFixed(2)} for ${w.tests} nodes compared)` : ''}`,
        });
      }
    if (name === 'omaha-audit')
      for (const w of arr(j?.split?.worse))
        out.push({
          id: `plo|${w.leak}`,
          text: `PLO audit: ${w.leak} ${n1(w.before)} -> ${n1(w.after)} bb/100`,
        });
    if (name.startsWith('exploit-report') && r.code === 1) {
      const gating = arr(j?.findings).filter((f) => f.gating);
      // one row per gating cell and split when the tool lists them (identity: cell and split), else the gate line
      const ids = gating.map((f) => `exploit|${f.key}|${f.splitAt ?? ''}`);
      out.push({
        id: ids.length ? ids.sort().join(' + ') : `exploit|${j?.gate?.line ?? name}`,
        ids,
        text: `exploit (${name}): ${j?.gate?.line ?? `gate finding (see ${r.out})`}`,
      });
    }
    // the over-fold gate: one finding per gating cell (identity: game, street, players and size, the same in every
    // run); read from the tool's JSON, so a run before (whose exit code was not stored) lists the same identities.
    // A cell over its ceiling WITH ITS FIX ON is breach-class: it is listed before every other regression.
    if (name === 'plo-overfold')
      for (const c of [...arr(j?.cells), ...arr(j?.foldThrough)].filter((x) => x.gating))
        out.push({
          id: c.fixClass === 'fix-on' ? `${c.key}|fix-on` : c.key,
          breachClass: c.fixClass === 'fix-on',
          text:
            c.fixClass === 'fix-on'
              ? `BREACH-CLASS (over-fold with the fix ON): ${c.line}`
              : c.line,
        });
    if (name.startsWith('person-vs-horse') && r.code === 1)
      out.push({
        id: `pvh|${name}`,
        noRepeat: true,
        text: `people vs Horses (${name}): people measurably better after a split (see ${r.out})`,
      });
  }
  out.sort((a, b) => (b.breachClass ? 1 : 0) - (a.breachClass ? 1 : 0));
  return out;
}

/** Owner-rule breach groups of the PLO audit, with every hand the tool lists. */
export function breachRows(results) {
  return arr(results['omaha-audit']?.json?.breaches).map((b) => ({
    breach: b.breach,
    n: b.n,
    vsPerson: b.vsPerson,
    costBb: b.costBb,
    hands: [...new Set(arr(b.hands).length ? arr(b.hands) : arr(b.examples))],
  }));
}

/**
 * What the run before listed (2026-11-26): two runs whose 24-hour ranges overlap read the same hands twice, and
 * the 13:33Z audit re-reported a breach hand the 05:00Z audit had already listed and explained.
 *   prev = { folder, sinceMs, untilMs, results, breachHands?: string[] } (breachHands: also from its decisions.csv).
 * A breach HAND is a repeat when the run before listed that hand. A regression FINDING is a repeat when the run
 * before listed the same finding AND its range overlaps this one (without an overlap the same node flagging again
 * is a second, independent measurement and is reported in full). People-vs-Horses findings are never repeats.
 */
export function previousListing(prev, sinceMs) {
  if (!prev || !prev.results) return null;
  const hands = new Set(arr(prev.breachHands));
  for (const b of breachRows(prev.results)) for (const h of b.hands) hands.add(h);
  const overlaps = Number.isFinite(prev.untilMs) && prev.untilMs > sinceMs;
  const findings = new Set();
  if (overlaps)
    for (const r of regressionRows(prev.results)) {
      if (r.noRepeat) continue;
      findings.add(r.id);
      for (const id of arr(r.ids)) findings.add(id);
    }
  return { folder: prev.folder, overlaps, hands, findings };
}

const repeatTag = (listing) => `repeat (already reported ${listing.folder})`;

/** Regression lines; `count` = those that are not repeats of the run before. */
export function regressionsMarked(results, listing = null) {
  const lines = [];
  let count = 0;
  for (const r of regressionRows(results)) {
    const ids = arr(r.ids).length ? r.ids : [r.id];
    const repeat = !!listing && !r.noRepeat && ids.every((id) => listing.findings.has(id));
    if (!repeat) count++;
    lines.push(repeat ? `${r.text} -- ${repeatTag(listing)}` : r.text);
  }
  return { lines, count };
}
export function regressions(results, listing = null) {
  return regressionsMarked(results, listing).lines;
}

/** Owner-rule breach lines; `count` = groups with at least one hand the run before did not list. */
export function ownerRuleBreachesMarked(results, listing = null) {
  const lines = [];
  let count = 0;
  for (const b of breachRows(results)) {
    const old = listing ? b.hands.filter((h) => listing.hands.has(h)) : [];
    const fresh = b.hands.filter((h) => !old.includes(h));
    // hands the tool did not list by id (an older output keeps 8 examples) are new unless every listed one is old
    const unlisted = Math.max(0, (b.n ?? 0) - b.hands.length);
    const allRepeat = old.length > 0 && fresh.length === 0 && unlisted === 0;
    if (!allRepeat) count++;
    const eg = (allRepeat ? old : fresh.length ? fresh : b.hands).slice(0, 3).join(', ');
    const mark = allRepeat
      ? ` -- ${repeatTag(listing)}`
      : old.length
        ? ` -- ${fresh.length + unlisted} new, ${old.length} ${repeatTag(listing)}: ${old.slice(0, 3).join(', ')}`
        : '';
    lines.push(
      `PLO ${b.breach}: ${b.n} (${b.vsPerson} versus a person, ${n1(b.costBb)} bb); e.g. ${eg}${mark}`
    );
  }
  for (const x of arr(results['omaha-audit']?.json?.notes))
    lines.push(
      `(counted apart, not a breach) PLO ${x.note}: ${x.n} (${x.vsPerson} versus a person); e.g. ${arr(x.examples).slice(0, 3).join(', ')}`
    );
  return { lines, count };
}
/** Owner-rule breaches the audits grade (PLO: non-nut raise on turn/river, a draw raised out of position). */
export function ownerRuleBreaches(results, listing = null) {
  return ownerRuleBreachesMarked(results, listing).lines;
}

/** The one-page summary. */
export function formatSummary({ sinceMs, untilMs, plan, runs, results, folder, previous = null }) {
  const listing = previousListing(previous, sinceMs);
  const L = [];
  L.push(`# Horse Daily Audit ${iso(sinceMs)} to ${iso(untilMs)}`);
  L.push('');
  L.push(`Folder: ${folder}. Read-only; every tool's own output is beside this file.`);
  L.push('');
  if (listing)
    L.push(
      `Run before: ${listing.folder}${listing.overlaps ? ' (its range overlaps this one)' : ' (no overlap with this range)'}. A breach hand or a finding it already listed is marked "repeat" and does not count again.`,
      ''
    );
  L.push('## Splits');
  L.push('');
  if (!plan.splits.length) L.push('No switch change or engine build boundary inside the range.');
  for (const s of plan.splits) L.push(`- ${s.at}: ${s.why.join('; ')}`);
  for (const s of plan.leftOut)
    L.push(`- (left out, within ${EDGE_MINUTES} min of an end) ${s.at}: ${s.why.join('; ')}`);
  L.push('');
  L.push('## Tools');
  L.push('');
  L.push('| tool | exit | meaning | seconds | output |');
  L.push('|---|---|---|---|---|');
  for (const r of runs) {
    const res = results[r.name] ?? {};
    L.push(
      `| ${r.name} | ${res.code ?? '-'} | ${exitMeaning(r.name, res.code)} | ${res.secs ?? '-'} | ${r.out} |`
    );
  }
  L.push('');
  const section = (title, rows, empty) => {
    L.push(`## ${title}`);
    L.push('');
    if (!rows.length) L.push(empty);
    for (const x of rows) L.push(`- ${x}`);
    L.push('');
  };
  section('Regressions', regressions(results, listing), 'None measured.');
  section(
    'Owner-Rule Breaches',
    ownerRuleBreaches(results, listing),
    'None graded in the PLO audit (the NLH audit grades no owner-rule class).'
  );
  L.push(OVERFOLD_HEADING);
  L.push('');
  const of = results['plo-overfold']?.json;
  if (!of || !Array.isArray(of.cells))
    L.push('Not measured (the tool failed or did not run: see Tools).');
  else {
    L.push(
      `${of.gate?.line ?? ''}. People prior: ${of.prior ?? 'none'}; ${of.ownerMap ?? 'no owner map'}; previous window from ${of.previousSince ?? '-'}; people's own folds from ${of.peopleSince ?? '-'}.`
    );
    L.push('');
    const over = [...of.cells, ...arr(of.foldThrough)].filter((c) => c.gating);
    const cls = (k) => over.filter((c) => (Array.isArray(k) ? k : [k]).includes(c.fixClass));
    const list = (title, rows) => {
      if (!rows.length) return;
      L.push(`**${title}**`, '');
      // the full line of each is under Regressions: here one short line a cell
      for (const c of rows)
        L.push(
          c.key?.startsWith('foldthru|')
            ? `- ${c.game} ${c.street} ${c.playersLabel} ${c.size}: a person's first bet into Horses folded through ${pc1(c.rate)} (n ${c.n}, 7 days) vs the pure-bluff break-even ${pc1(c.breakEven)}; ${c.owner ? `${c.owner} ${c.ownerState}` : c.ownerState}`
            : `- ${c.game} ${c.street} ${c.fieldLabel} ${c.size}: Horse folds ${pc1(c.rate)} (n ${c.n}; with the previous 3 days ${pc1(c.pooledRate)}, n ${c.pooledN}) vs ceiling ${pc1(c.ceiling)}; ${c.owner ? `${c.owner} ${c.ownerState}` : c.ownerState}`
        );
      L.push('');
    };
    list('Over its ceiling WITH ITS FIX ON (regression, breach-class)', cls('fix-on'));
    list('Over its ceiling, fix ON for part of the window (mixed)', cls('fix-on-partial'));
    list('Over its ceiling while its fix is OFF', cls(['fix-off', 'fix-unknown']));
    list(
      'Over its ceiling, no owner yet',
      over.filter((c) => !c.fixClass || c.fixClass === 'no-owner')
    );
    L.push(...cellTable(of.cells));
    const empty = of.cells.filter((c) => !(c.n > 0) && !(c.previousN > 0)).length;
    if (empty)
      L.push(
        '',
        `${empty} of ${of.cells.length} cells had no decision in either window (not shown).`
      );
    if (Array.isArray(of.foldThrough)) {
      L.push(
        '',
        `**Multiway fold-through** (a person's first bet into Horses, everyone folds, against the pure-bluff break-even s/(1+s); trailing 7 days from ${of.foldThroughSince ?? '-'}). Multiway gates here; the multiway rows above are information only.`,
        ''
      );
      L.push(...foldThroughTable(of.foldThrough));
    }
  }
  L.push('');
  section(
    'Top Leaks',
    topLeaks(results),
    'None listed (too few hands, or a tool failed: see Tools).'
  );
  const failed = runs.filter((r) => [64, 70, null, undefined].includes(results[r.name]?.code));
  if (failed.length)
    section(
      'Failed',
      failed.map((r) => `${r.name}: see ${r.name}.err`),
      ''
    );
  return L.join('\n');
}

/** The runner's exit code: 70 if a tool failed, else 1 on any regression or breach that is not a repeat, else 0. */
export function overallExit(runs, results, previous = null, sinceMs = NaN) {
  if (runs.some((r) => [64, 70, null, undefined].includes(results[r.name]?.code))) return 70;
  const listing = previousListing(previous, sinceMs);
  if (regressionsMarked(results, listing).count || ownerRuleBreachesMarked(results, listing).count)
    return 1;
  return 0;
}
