/**
 * Scores a counterfactual replay of Horse decisions against the audits' own verdicts, joined BY DECISION NODE
 * (src/benchmark/AuditedDecisionReplay.ts explains the node, the two audit formats and the outcomes).
 *
 * Run from server/ (local evidence files only; nothing is read from a database):
 *   npx tsx scripts/audited-decision-replay.ts \
 *     [--audit2 <PLO5-...-DECISIONS.csv> --audit2-hands <audit2 hands.jsonl>] \
 *     [--woowoo <decision-audit/decisions-full.csv> --woowoo-findings <spec/decision-to-finding.csv>] \
 *     [--plo6 <PLO6 audit decisions.csv> --plo6-meta <its meta.jsonl> --plo6-hands <its hands.jsonl>] \
 *     [--placed <nodes.jsonl>] \
 *     (--replay <replay.jsonl> [--base off] [--json <report.json>] [--line <arm>]
 *        [--allow-unchanged <arm>[,<arm>]] [--row <arm> --set <set name> [--scorer-commit <sha>]]
 *      | --emit-nodes <nodes.jsonl>)
 *
 * --placed reads audited decisions already placed at their node (scripts/hvh48-audit-nodes.py writes them for the
 * HVH48 audits; one JSON line each, see placedDecisions), scored verdict-only.
 * --emit-nodes writes the audited nodes ({hand, seat, street, k, source, recorded, verdict}) for a replay harness
 * to re-decide; the harness writes one JSON line per node: {hand, seat, street, k, arms: {off: {action, amount,
 * legal, refusal, receipts}, <arm>: {...}}}. --line prints the authority-file replay line for one arm.
 * --plo6 reads the PLO6 audit set (HVH48 auditor C: decisions.csv, meta.jsonl, hands.jsonl; plo6Decisions has
 * the layout and the verdict mapping); it is scored verdict-only, reads no card, and its emitted nodes also carry
 * the audit's decision id and the action's index in the hand's actions array (id, actionIndex) for the harness.
 * Exit 1 when an audit2 or plo6 row cannot be placed at a node or a replay node repeats. A base arm that does not
 * reproduce the recorded action is counted and listed (never matched to a neighbour).
 *
 * THE REPLAY MUST BE THE ARMS IT NAMES (2026-11-19). The harness declares the option-switch set it handed the brain,
 * per arm on one line {"meta": {"arms": {"<arm>": {"options": {"<option>": "on" | "off"}, "sanitized": {...}}}}}
 * or per row as arms.<arm>.options. Exit 2, with the reason and NO score, when
 *   - a declared set is refused by today's option registry (a journaled option that is off-only or unregistered
 *     today makes the whole set invalid: nothing is switched and the arm is inert),
 *   - an arm is identical to the base arm on every compared row and was not declared so (--allow-unchanged), or
 *   - --row is asked from arms whose option set is not declared.
 * --row prints the machine-read Replay row(s) of the option's authority file (docs/horse-option-authority.d/README.md)
 * for one arm; the scorer commit is read from git (the last commit of the two scorer files, which must be clean)
 * unless --scorer-commit names it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  audit2Decisions,
  nodeKey,
  parseReplayFile,
  placedDecisions,
  plo6Decisions,
  replayBarLine,
  replayBarRows,
  replayRefusals,
  replayValidity,
  scoreReplay,
  wooWooDecisions,
  type AdapterResult,
  type AuditSource,
  type AuditedDecision,
} from '../src/benchmark/AuditedDecisionReplay.js';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const read = (p: string) => readFileSync(p, 'utf8');
const list = (name: string): string[] =>
  (opt(name) ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** The commit the scorer ran at: the last commit of its two files, refused when either has uncommitted changes. */
function scorerCommit(): string {
  const given = opt('scorer-commit');
  if (given) return given;
  const server = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = ['scripts/audited-decision-replay.ts', 'src/benchmark/AuditedDecisionReplay.ts'];
  const git = (...a: string[]) => execFileSync('git', a, { cwd: server, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--', ...files))
    throw new Error(
      '--row: the scorer files have uncommitted changes, so no commit names this scorer (commit them or pass --scorer-commit)'
    );
  return git('log', '-1', '--format=%H', '--', ...files).slice(0, 11);
}

const audits: { source: AuditSource; decisions: AuditedDecision[] }[] = [];
let problems = 0;
const take = (source: AuditSource, r: AdapterResult) => {
  audits.push({ source, decisions: r.decisions });
  console.log(
    `${source}: ${r.decisions.length} audited decisions placed at a node, ${r.unplaced.length} not placed${r.ambiguous ? `, ${r.ambiguous} placed ambiguously (first in order)` : ''}`
  );
  for (const u of r.unplaced.slice(0, 20))
    console.log(
      `  not placed: row ${u.row}${source === 'plo6' ? ` decision ${u.name}` : ''} hand ${u.hand} ${u.street}: ${u.reason}`
    );
  if (r.unplaced.length && source !== 'woowoo') problems++;
};
const a2 = opt('audit2');
if (a2) {
  const hands = opt('audit2-hands');
  if (!hands) throw new Error('--audit2 needs --audit2-hands');
  take('audit2', audit2Decisions(read(a2), read(hands)));
}
const ww = opt('woowoo');
if (ww) {
  const f = opt('woowoo-findings');
  if (!f) throw new Error('--woowoo needs --woowoo-findings');
  take('woowoo', wooWooDecisions(read(ww), read(f)));
}
const p6 = opt('plo6');
if (p6) {
  const metaFile = opt('plo6-meta');
  const hands = opt('plo6-hands');
  if (!metaFile || !hands) throw new Error('--plo6 needs --plo6-meta and --plo6-hands');
  take('plo6', plo6Decisions(read(p6), read(metaFile), read(hands)));
}
const pl = opt('placed');
if (pl) take('placed', placedDecisions(read(pl)));
if (audits.length === 0) throw new Error('give --audit2, --woowoo, --plo6 and/or --placed');

const emit = opt('emit-nodes');
if (emit) {
  const lines = audits.flatMap((a) =>
    a.decisions.map((d) =>
      JSON.stringify({
        ...d.node,
        ...(d.at ?? {}),
        key: nodeKey(d.node),
        source: d.source,
        recorded: d.recorded,
        verdict: d.verdict,
      })
    )
  );
  writeFileSync(emit, lines.join('\n') + '\n');
  console.log(`wrote ${lines.length} nodes to ${emit}`);
} else {
  const rp = opt('replay');
  if (!rp) throw new Error('give --replay <replay.jsonl> or --emit-nodes <out>');
  const base = opt('base') ?? 'off';
  const rowArm = opt('row');
  const file = parseReplayFile(read(rp));
  const validity = replayValidity(file, base);
  for (const v of validity) {
    const set =
      v.rowsWithOptions === 0
        ? 'option set NOT DECLARED (off-only / unregistered check not made)'
        : `option set declared on ${v.rowsWithOptions} of ${v.rows} rows, ${v.invalidRows} refused by today's registry`;
    const versus = v.isBase
      ? 'base arm'
      : `on vs base: ${v.switchedOn.join(', ') || '(none named)'}${v.switchedOff.length ? `; off vs base: ${v.switchedOff.join(', ')}` : ''}; differs from base on ${v.differingRows} of ${v.comparedRows} rows`;
    const sanitized = Object.entries(v.sanitized)
      .map(([k, n]) => `${k} x${n}`)
      .join(', ');
    console.log(
      `arm ${v.arm}: ${v.rows} rows; ${set}; ${versus}${sanitized ? `; sanitized by the harness: ${sanitized}` : ''}`
    );
  }
  const refusals = replayRefusals(validity, {
    allowUnchanged: list('allow-unchanged'),
    requireOptionsFor: rowArm ? [base, rowArm] : [],
  });
  if (refusals.length) {
    for (const r of refusals) console.error(`REFUSED: ${r}`);
    console.error(
      `REFUSED: ${refusals.length} reason(s); this replay is not scored and no line, row or report is written.`
    );
    process.exit(2);
  }
  const report = scoreReplay(audits, file.rows, base);
  console.log(
    `replay ${rp}: ${report.replayRows} rows, ${report.replayRowsWithoutAudit} without an audited decision, ${report.duplicateReplayNodes.length} duplicate nodes; base arm "${report.base}"`
  );
  if (report.duplicateReplayNodes.length) problems++;
  const unaudited = Object.entries(report.changedWithoutAudit).filter(([, n]) => n > 0);
  if (unaudited.length)
    console.log(
      `changed at nodes no audit judged (not scored): ${unaudited.map(([a, n]) => `${a} ${n}`).join(', ')}`
    );
  for (const s of report.sources) {
    const agree = s.judgeAgreesWithAudit
      ? `; ported judge agrees with the audit verdict on ${s.judgeAgreesWithAudit.agree} of ${s.judgeAgreesWithAudit.judged}`
      : '';
    console.log(
      `\n${s.source} [${s.method}] audited ${s.audited} (bad ${s.auditedBad}); replayed ${s.replayed}, not replayed ${s.notReplayed}; base reproduces recorded ${s.baseReproducesRecorded}${agree}`
    );
    if (s.baseDiffers.length)
      console.log(
        `  base differs from the recorded action at ${s.baseDiffers.length} nodes (audit2: both arms judged as replayed; verdict-only: unjudged), first: ${s.baseDiffers.slice(0, 20).join(' ')}`
      );
    for (const a of s.arms) {
      const ev =
        s.method === 'audit-judge'
          ? ` | EV ${a.evSumBb >= 0 ? '+' : ''}${a.evSumBb} bb on ${a.evPriced} (mean ${a.evMeanBb}, se ${a.evSeBb ?? 'n/a'})`
          : '';
      console.log(
        `  ${a.arm.padEnd(34)} changed ${a.changed} (up ${a.moreAggressive}, down ${a.morePassive}) resized ${a.resized} illegal ${a.illegal} refused ${a.refused} errors ${a.errors} | fixed ${a.fixed} newly wrong ${a.newlyWrong} still wrong ${a.stillWrong} ok->ok ${a.okToOk} unjudged ${a.changedUnjudged} | unchanged ${a.unchanged} (bad unchanged ${a.unchangedBad})${ev}`
      );
      for (const [r, c] of Object.entries(a.perReceipt))
        if (c.changed || c.unchangedBad)
          console.log(
            `      ${r}: changed ${c.changed}, fixed ${c.fixed}, newly wrong ${c.newlyWrong}, still wrong ${c.stillWrong}${s.method === 'audit-judge' ? `, EV ${c.evSumBb} bb on ${c.evPriced}` : ''}`
          );
    }
  }
  const line = opt('line');
  if (line) console.log(`\nAuthority replay line (${line}): ${replayBarLine(report, line)}`);
  if (rowArm) {
    const set = opt('set');
    if (!set) throw new Error('--row needs --set <name of the audited decision set>');
    console.log(`\nAuthority Replay row(s) (${rowArm}), copy unedited:`);
    for (const row of replayBarRows(report, rowArm, { set, scorer: scorerCommit() }))
      console.log(row);
  }
  const json = opt('json');
  if (json) writeFileSync(json, JSON.stringify(report, null, 1) + '\n');
}
process.exitCode = problems ? 1 : 0;
