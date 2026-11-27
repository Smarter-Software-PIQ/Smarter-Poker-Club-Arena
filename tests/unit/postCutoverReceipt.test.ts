// tests/unit/postCutoverReceipt.test.ts
//
// THE CUTOVER POSTS ITS OWN AUDIT RECEIPT (2026-11-26). The post-cutover audit was run and posted by a chat that
// woke on a timer; a missed wake-up was silence that read like a pass. These cases pin
// scripts/ops/post-cutover-receipt.mjs and .github/workflows/post-cutover-receipt.yml: the receipt answers the
// one cycle its receiver posted, once; it can never be read as a cycle result by the tools that read the log; and
// the workflow is reporting only.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditWithOneSettleRetry,
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
    });
    expect(findCutoverComment(comments, 1000)).toMatchObject({
      result: 'REFUSED',
      sealedSha: null,
    });
    expect(findCutoverComment(comments, 10)).toBeNull();
    expect(findCutoverComment(comments, 'x')).toBeNull();
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
    expect(body.startsWith('Post-cutover audit for receiver run 100')).toBe(true);
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

describe('the receipt workflow is reporting only', () => {
  const wf = readFileSync(
    resolve(__dirname, '../../.github/workflows/post-cutover-receipt.yml'),
    'utf8'
  );
  it('runs only after the engine receiver completes, or by hand, never on a timer', () => {
    expect(wf).toMatch(/workflows: \['Auto-Deploy Hetzner Engine \(on server\/ changes\)'\]/);
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
  it('the name it waits for is the receiver workflow name', () => {
    const receiver = readFileSync(
      resolve(__dirname, '../../.github/workflows/auto-deploy-hetzner.yml'),
      'utf8'
    );
    expect(receiver.split('\n')[0]).toBe('name: Auto-Deploy Hetzner Engine (on server/ changes)');
  });
});
