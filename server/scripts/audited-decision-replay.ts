/**
 * Scores a counterfactual replay of Horse decisions against the audits' own verdicts, joined BY DECISION NODE
 * (src/benchmark/AuditedDecisionReplay.ts explains the node, the two audit formats and the outcomes).
 *
 * Run from server/ (local evidence files only; nothing is read from a database):
 *   npx tsx scripts/audited-decision-replay.ts \
 *     [--audit2 <PLO5-...-DECISIONS.csv> --audit2-hands <audit2 hands.jsonl>] \
 *     [--woowoo <decision-audit/decisions-full.csv> --woowoo-findings <spec/decision-to-finding.csv>] \
 *     (--replay <replay.jsonl> [--base off] [--json <report.json>] [--line <arm>] | --emit-nodes <nodes.jsonl>)
 *
 * --emit-nodes writes the audited nodes ({hand, seat, street, k, source, recorded, verdict}) for a replay harness
 * to re-decide; the harness writes one JSON line per node: {hand, seat, street, k, arms: {off: {action, amount,
 * legal, refusal, receipts}, <arm>: {...}}}. --line prints the authority-file replay line for one arm.
 * Exit 1 when an audit2 row cannot be placed at a node or a replay node repeats. A base arm that does not
 * reproduce the recorded action is counted and listed (never matched to a neighbour).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  audit2Decisions,
  nodeKey,
  parseReplayJsonl,
  replayBarLine,
  scoreReplay,
  wooWooDecisions,
  type AdapterResult,
  type AuditedDecision,
} from '../src/benchmark/AuditedDecisionReplay.js';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const read = (p: string) => readFileSync(p, 'utf8');

const audits: { source: 'audit2' | 'woowoo'; decisions: AuditedDecision[] }[] = [];
let problems = 0;
const take = (source: 'audit2' | 'woowoo', r: AdapterResult) => {
  audits.push({ source, decisions: r.decisions });
  console.log(
    `${source}: ${r.decisions.length} audited decisions placed at a node, ${r.unplaced.length} not placed${r.ambiguous ? `, ${r.ambiguous} placed ambiguously (first in order)` : ''}`
  );
  for (const u of r.unplaced.slice(0, 20))
    console.log(`  not placed: row ${u.row} hand ${u.hand} ${u.street}: ${u.reason}`);
  if (r.unplaced.length && source === 'audit2') problems++;
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
if (audits.length === 0) throw new Error('give --audit2 and/or --woowoo');

const emit = opt('emit-nodes');
if (emit) {
  const lines = audits.flatMap((a) =>
    a.decisions.map((d) =>
      JSON.stringify({
        ...d.node,
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
  const report = scoreReplay(audits, parseReplayJsonl(read(rp)), opt('base') ?? 'off');
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
        `  ${a.arm.padEnd(34)} changed ${a.changed} (up ${a.moreAggressive}, down ${a.morePassive}) resized ${a.resized} illegal ${a.illegal} refused ${a.refused} errors ${a.errors} | fixed ${a.fixed} newly wrong ${a.newlyWrong} still wrong ${a.stillWrong} ok->ok ${a.okToOk} unjudged ${a.changedUnjudged} | bad unchanged ${a.unchangedBad}${ev}`
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
  const json = opt('json');
  if (json) writeFileSync(json, JSON.stringify(report, null, 1) + '\n');
}
process.exitCode = problems ? 1 : 0;
