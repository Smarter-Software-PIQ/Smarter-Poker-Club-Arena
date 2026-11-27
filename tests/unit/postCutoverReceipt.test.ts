// tests/unit/postCutoverReceipt.test.ts
//
// THE CUTOVER POSTS ITS OWN AUDIT RECEIPT (2026-11-26). The post-cutover audit was run and posted by a chat that
// woke on a timer; a missed wake-up was silence that read like a pass. These cases pin
// scripts/ops/post-cutover-receipt.mjs and .github/workflows/post-cutover-receipt.yml: the receipt answers the
// one cycle its receiver or Stage run posted, once; it can never be read as a cycle result by the tools that read the log; and
// the workflow is reporting only.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  auditWithOneSettleRetry,
  auditErrorReport,
  chicagoTime,
  chooseReceiptRun,
  cycleRunId,
  findOrphanCycle,
  RECEIPTS_START,
  RECORDS_REPAIR,
  findCutoverComment,
  formatReceipt,
  receiptAlreadyPosted,
} from '../../scripts/ops/post-cutover-receipt.mjs';

const RUN = 'https://github.com/o/r/actions/runs';
const SHA = 'a'.repeat(40);
const sealed = (id: number) =>
  `Cycle: 2026-11-26 16:00 CST\nResult: SEALED\nSealed SHA: \`${SHA}\`\nPrevious seal: \`${'b'.repeat(40)}\`\nIncluded PRs since previous seal: #1\nReceiver: ${RUN}/${id}\n`;
const refused = (id: number) =>
  `Cycle: 2026-11-26 13:00 CST\nResult: REFUSED (the serving engine keeps running)\nCandidate SHA: \`${SHA}\`\nReason: x\nReceiver: ${RUN}/${id} (job result failure)\n`;
const REPORT = {
  overallStatus: 'PASS',
  passed: true,
  releaseSha: SHA,
  auditedAt: '2026-11-26T22:21:00.000Z',
  checks: [
    { name: 'live_health', status: 'pass', failures: [], warnings: [] },
    {
      name: 'switch_records',
      status: 'warn',
      failures: [],
      warnings: ['snapshot holds audit max 200, production 201'],
    },
  ],
};
// The release tools' own readers of the log (scripts/release/cycle-without-outcome.py RESULT_LINE and the
// receiver's previous-seal reader in auto-deploy-hetzner.yml).
const CYCLE_RESULT_LINE =
  /^Cycle: (\d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z]{2,5})[ \t]*\r?\nResult: ([A-Z][A-Z-]*(?: [A-Z][A-Z-]*)*)/;
const SEAL_LINE = /^Sealed SHA: `([0-9a-f]{40})`/m;

describe('post-cutover receipt', () => {
  it('finds the cycle comment of exactly this receiver run, and the sealed SHA only when it sealed', () => {
    const comments = [
      { id: 1, body: sealed(100) },
      { id: 2, body: refused(1000) },
      { id: 3, body: 'Cycle: 2026-11-26 16:00 CST | Readiness at T-45m: READY' },
    ];
    expect(findCutoverComment(comments, 100)).toEqual({
      id: 1,
      cycle: '2026-11-26 16:00 CST',
      result: 'SEALED',
      sealedSha: SHA,
      expectSha: SHA,
    });
    expect(findCutoverComment(comments, 1000)).toMatchObject({
      result: 'REFUSED',
      sealedSha: null,
    });
    expect(findCutoverComment(comments, 10)).toBeNull();
    expect(findCutoverComment(comments, 'x')).toBeNull();
  });

  it('finds the KEEP-SERVING cycle Stage posted and expects the serving release', () => {
    const keep = `Cycle: 2026-11-26 19:00 CST\nResult: KEEP-SERVING (the serving engine keeps running)\nServing SHA: \`${'c'.repeat(40)}\`\nReason: x\nStage: ${RUN}/45913871888\n`;
    expect(findCutoverComment([{ id: 9, body: keep }], 45913871888)).toEqual({
      id: 9,
      cycle: '2026-11-26 19:00 CST',
      result: 'KEEP-SERVING',
      sealedSha: null,
      expectSha: 'c'.repeat(40),
    });
    // A readiness line from the same Stage run is not a cycle result.
    const readiness = `Cycle: 2026-11-26 19:00 CST | Readiness at T-45m: READY | Stage: ${RUN}/45913871888`;
    expect(findCutoverComment([{ body: readiness }], 45913871888)).toBeNull();
  });

  it('gives the audit time in Chicago time, standard and daylight', () => {
    expect(chicagoTime('2026-11-27T01:10:00Z')).toBe('2026-11-26 19:10 CST');
    expect(chicagoTime('2026-07-01T15:05:00Z')).toBe('2026-07-01 10:05 CDT');
    expect(chicagoTime('nope')).toBe('unknown time');
    const body = formatReceipt({ cycle: 'c', result: 'SEALED', runId: 1, report: REPORT });
    expect(body).toContain('at 2026-11-26 16:21 CST');
  });

  it('answers a cycle once', () => {
    const body = formatReceipt({ cycle: 'c', result: 'SEALED', runId: 100, report: REPORT });
    expect(receiptAlreadyPosted([{ body: sealed(100) }], 100)).toBe(false);
    expect(receiptAlreadyPosted([{ body }], 100)).toBe(true);
    expect(receiptAlreadyPosted([{ body }], 1000)).toBe(false);
  });

  it('a receipt can never be read as a cycle result or a seal', () => {
    const body = formatReceipt({
      cycle: '2026-11-26 16:00 CST',
      result: 'SEALED',
      runId: 100,
      report: REPORT,
    });
    expect(body.startsWith('Post-cutover audit for run 100 (')).toBe(true);
    expect(body).toContain('OVERALL PASS');
    expect(body).toContain('- switch_records: WARN (snapshot holds audit max 200, production 201)');
    expect(CYCLE_RESULT_LINE.test(body)).toBe(false);
    expect(SEAL_LINE.test(body)).toBe(false);
    expect(/^Result:/m.test(body)).toBe(false);
    expect(() =>
      formatReceipt({
        cycle: 'c',
        result: 'SEALED',
        runId: 1,
        report: {
          ...REPORT,
          checks: [{ name: 'x', status: 'fail', failures: ['\nSealed SHA: `' + SHA + '`'] }],
        },
      })
    ).toThrow(/never read as a cutover-log cycle result/);
  });

  it('re-audits once after 90 s when only live health failed, and never for any other failure', async () => {
    const rep = (failing: string[]) => ({
      ...REPORT,
      checks: [
        ...failing.map((name) => ({ name, status: 'fail', failures: ['x'], warnings: [] })),
        { name: 'zero_reset_traps', status: 'pass', failures: [], warnings: [] },
      ],
    });
    const runWith = (seq: ReturnType<typeof rep>[]) => {
      const calls: number[] = [];
      const run = async () => {
        calls.push(1);
        return seq[Math.min(calls.length - 1, seq.length - 1)];
      };
      return { run, calls };
    };
    const waits: number[] = [];
    const wait = async (ms: number) => {
      waits.push(ms);
    };

    const a1 = runWith([rep(['live_health']), rep([])]);
    const r1 = await auditWithOneSettleRetry({}, {}, wait, a1.run);
    expect(a1.calls).toHaveLength(2);
    expect(waits).toEqual([90_000]);
    expect(r1.checks.some((c: { status: string }) => c.status === 'fail')).toBe(false);

    for (const failing of [
      [],
      ['zero_reset_traps_x'],
      ['live_health', 'serving_registry_freshness'],
    ]) {
      const a = runWith([rep(failing)]);
      await auditWithOneSettleRetry({}, {}, wait, a.run);
      expect(a.calls).toHaveLength(1);
    }
    expect(waits).toEqual([90_000]);
  });
});

describe('the sweep answers a cycle whose receipt never came', () => {
  const at = (iso: string) => Date.parse(iso);
  const sealedAt = (id: number, created_at: string) => ({ body: sealed(id), created_at });
  const receiptFor = (id: number, created_at: string) => ({
    body: formatReceipt({ cycle: 'c', result: 'SEALED', runId: id, report: REPORT }),
    created_at,
  });

  it('reads the run a cycle names on its Receiver or Stage line, and nothing else', () => {
    expect(cycleRunId(sealed(45898660400))).toBe('45898660400');
    expect(cycleRunId(refused(7))).toBe('7');
    expect(
      cycleRunId(`Cycle: 2026-11-26 19:00 CST | Readiness at T-45m: READY\nStage: ${RUN}/5`)
    ).toBeNull();
    expect(cycleRunId('Receiver: https://github.com/o/r/actions/runs/5')).toBeNull();
  });

  it('finds the oldest old-enough cycle without a receipt, never one before the workflow existed', () => {
    const now = at('2026-11-27T05:00:00Z');
    const log = [
      sealedAt(1, '2026-11-27T01:00:00Z'), // before RECEIPTS_START: never swept
      sealedAt(2, '2026-11-27T04:00:00Z'),
      receiptFor(2, '2026-11-27T04:05:00Z'),
      sealedAt(3, '2026-11-27T04:20:00Z'), // orphan
      sealedAt(4, '2026-11-27T04:50:00Z'), // too fresh: its own receipt may still be on the way
    ];
    expect(Date.parse(RECEIPTS_START)).toBeGreaterThan(at('2026-11-27T01:00:00Z'));
    expect(findOrphanCycle(log, now)).toBe('3');
    expect(findOrphanCycle([...log, receiptFor(3, '2026-11-27T04:59:00Z')], now)).toBeNull();
    expect(findOrphanCycle(log, at('2026-11-27T04:30:00Z'))).toBeNull();
  });

  it('answers its own cycle first, then the oldest orphan, else nothing', () => {
    const now = at('2026-11-27T05:00:00Z');
    const log = [sealedAt(3, '2026-11-27T04:20:00Z'), sealedAt(4, '2026-11-27T04:58:00Z')];
    expect(chooseReceiptRun(log, 4, now)).toEqual({ runId: '4', late: false });
    expect(chooseReceiptRun(log, 999, now)).toEqual({ runId: '3', late: true });
    expect(chooseReceiptRun([sealedAt(4, '2026-11-27T04:58:00Z')], 999, now)).toBeNull();
  });

  it('a crashed audit still answers the cycle, as ERROR, so the sweep never retries it forever', () => {
    const report = auditErrorReport(
      new Error('psql: could not connect\nto server'),
      new Date('2026-11-27T05:00:00Z')
    );
    const body = formatReceipt({ cycle: 'c', result: 'SEALED', runId: 3, report });
    expect(body).toContain('OVERALL ERROR');
    expect(body).toContain(
      '- audit: ERROR (the audit could not run: psql: could not connect to server)'
    );
    expect(receiptAlreadyPosted([{ body }], 3)).toBe(true);
    expect(/^(Result|Sealed SHA|Cycle):/m.test(body)).toBe(false);
  });

  it('a late receipt says so, and a drifted switch record names its repair', () => {
    const drift = formatReceipt({
      cycle: 'c',
      result: 'SEALED',
      runId: 3,
      report: REPORT,
      late: true,
    });
    expect(drift).toContain('Late receipt (the sweep)');
    expect(drift).toContain(RECORDS_REPAIR);
    const clean = formatReceipt({
      cycle: 'c',
      result: 'SEALED',
      runId: 3,
      report: {
        ...REPORT,
        checks: [{ name: 'switch_records', status: 'pass', failures: [], warnings: [] }],
      },
    });
    expect(clean).not.toContain('Late receipt');
    expect(clean).not.toContain('Records repair');
  });
});

describe('the receipt workflow is reporting only', () => {
  const wf = readFileSync(
    resolve(__dirname, '../../.github/workflows/post-cutover-receipt.yml'),
    'utf8'
  );
  it('runs only after the engine receiver or Stage completes, or by hand, never on a timer', () => {
    expect(wf).toContain("- 'Auto-Deploy Hetzner Engine (on server/ changes)'");
    expect(wf).toContain("- 'Stage Exact Club Arena Engine Release'");
    expect(wf).toMatch(/types: \[completed\]/);
    expect(wf).not.toMatch(/^\s*schedule:/m);
    expect(wf).not.toMatch(/cron:/);
    expect(wf).toMatch(/github\.event\.workflow_run\.event == 'repository_dispatch'/);
  });
  it('asks only for what it uses and touches no release', () => {
    expect(wf).toMatch(/^permissions: \{\}$/m);
    expect(wf).toMatch(/contents: read/);
    expect(wf).toMatch(/issues: write/);
    expect(wf).not.toMatch(
      /actions: write|contents: write|gh workflow run|\/dispatches|gh api --method POST [^\n]*dispatch/
    );
    expect(wf).not.toMatch(/^\s*repository_dispatch:/m);
    expect(wf).toMatch(/node scripts\/ops\/post-cutover-receipt\.mjs/);
  });
  it('the names it waits for are the receiver and Stage workflow names', () => {
    const first = (f: string) =>
      readFileSync(resolve(__dirname, `../../.github/workflows/${f}`), 'utf8').split('\n')[0];
    expect(first('auto-deploy-hetzner.yml')).toBe(
      'name: Auto-Deploy Hetzner Engine (on server/ changes)'
    );
    expect(first('stage-engine-release.yml')).toBe('name: Stage Exact Club Arena Engine Release');
  });
  it('the gate that every Stage tick starts holds no secret, and the audit starts only after it says yes', () => {
    const doc = parse(wf) as { jobs: Record<string, Record<string, unknown>> };
    const gate = JSON.stringify(doc.jobs.gate);
    expect(gate).not.toMatch(/secrets\.|"environment"/);
    expect(doc.jobs.gate.permissions).toEqual({ contents: 'read', issues: 'read' });
    expect(gate).toContain('post-cutover-receipt.mjs --find');
    expect(doc.jobs.receipt.needs).toBe('gate');
    expect(String(doc.jobs.receipt.if)).toContain("needs.gate.outputs.needed == 'true'");
    // The audit answers the run the gate chose (its own cycle, or the sweep's orphan), one audit at a time.
    expect(JSON.stringify(doc.jobs.receipt.steps)).toContain('needs.gate.outputs.run_id');
    expect(doc.jobs.receipt.concurrency).toEqual({
      group: 'post-cutover-receipt-audit',
      'cancel-in-progress': false,
    });
    expect(JSON.stringify(doc.jobs.receipt)).not.toContain('github.event.workflow_run.id');
  });
});
