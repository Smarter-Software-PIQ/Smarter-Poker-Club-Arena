// tests/unit/horseOptionSwitchRecordsPr.test.ts
//
// A LIVE SWITCH WRITE BRINGS ITS OWN RECORDS PR (2026-11-24). On 2026-11-24 cashDefenceTrimColdCalls went
// live at audit #193 while its doc still said "default OFF" and docs/horse-option-switch-state.json still
// held audit max 189: the law that compares the two only sees what someone commits. These tests pin that
// the records change is computed from the live rows, produced after a verified write and never after a dry
// run or a refused write, and that it keeps the machine-read phrases other tools parse.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORITY_DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN,
  findAuthorityDocStateDrift,
  findUnjudgedLiveAuthorityDocs,
  parseAuthorityDocEvidence,
  formatSwitchStateSnapshot,
  parseAuthorityDocState,
  snapshotFromRows,
} from '../../scripts/ops/horse-option-switch-lib.mjs';
import {
  RECORDS_FINISH_COMMAND,
  buildRecordsChange,
  formatRecordsPr,
  insertAuthorityDocState,
  recordsWorkRoot,
  rewriteAuthorityDocState,
} from '../../scripts/ops/horse-option-switch-records.mjs';
import { runCli } from '../../scripts/ops/horse-option-switch.mjs';

const VALID_SHA = 'a'.repeat(64);
const SERVING_SHA = '1a0a6047e1acb1a037cd43b36d9907a00103c5e4';
const SAFE_NOW = new Date('2026-11-21T15:20:00Z');

const TRIM_DOC =
  '# cashDefenceTrimColdCalls\n\n' +
  "**State: default OFF in source (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`, switchable `off / shadow / on_shadow / on`); Evidence MET (2026-11-21).** Hold'em Strategy lane option.\n\n" +
  '## Rollback\n';
const V2_DOC =
  '# plo6FacingBetIsPricedV2\n\n**State: OFF; Evidence NOT MET against the REPLAY-6 verdict-only bar.** PLO6.\n';
const PLAIN_ON_DOC =
  '# holdemValueAndCallsArePriced\n\n**State: LIVE ON since audit #185.** Cash.\n';

const LIVE_ROWS = [
  {
    option: 'cashDefenceTrimColdCalls',
    state: 'on',
    updated_at: '2026-11-24 08:18:04.123+00',
    audit_id: 193,
    audit_max: 195,
  },
  {
    option: 'holdemValueAndCallsArePriced',
    state: 'on',
    updated_at: '2026-11-22T23:25:25Z',
    audit_id: 185,
    audit_max: 195,
  },
];

describe('the records PR is computed from the live rows', () => {
  const snapshot = snapshotFromRows(LIVE_ROWS, '2026-11-24T14:20:00Z');

  it('the snapshot text is byte-identical to formatSwitchStateSnapshot of the live rows', () => {
    const change = buildRecordsChange({ snapshot, docs: {}, currentStateText: '' });
    expect(change.stateFileText).toBe(formatSwitchStateSnapshot(snapshot));
    expect(change.stateFileChanged).toBe(true);
    const same = buildRecordsChange({
      snapshot,
      docs: {},
      currentStateText: formatSwitchStateSnapshot(snapshot),
    });
    expect(same.stateFileChanged).toBe(false);
  });

  // 2026-11-26: with main's snapshot already at the live audit max, `records --dry-run` still answered
  // "would be rewritten", because the snapshot stamps the time of each read. It could never say "matches",
  // and `records` would have opened a PR that changed one timestamp.
  it('the same rows read at a later time are no change; a changed row, audit max or hand-edited file is', () => {
    const committed = formatSwitchStateSnapshot(snapshot);
    const later = snapshotFromRows(LIVE_ROWS, '2026-11-26T00:10:00Z');
    expect(later.asOfUtc).not.toBe(snapshot.asOfUtc);
    const same = buildRecordsChange({ snapshot: later, docs: {}, currentStateText: committed });
    expect(same.stateFileChanged).toBe(false);
    expect(same.stateFileText).toBe(committed);

    const flipped = snapshotFromRows(
      LIVE_ROWS.map((r, i) =>
        i === 0 ? { ...r, state: 'off', audit_id: 196, audit_max: 196 } : { ...r, audit_max: 196 }
      ),
      '2026-11-26T00:10:00Z'
    );
    expect(
      buildRecordsChange({ snapshot: flipped, docs: {}, currentStateText: committed })
        .stateFileChanged
    ).toBe(true);
    const newerAudit = snapshotFromRows(
      LIVE_ROWS.map((r) => ({ ...r, audit_max: 199 })),
      '2026-11-26T00:10:00Z'
    );
    expect(
      buildRecordsChange({ snapshot: newerAudit, docs: {}, currentStateText: committed })
        .stateFileChanged
    ).toBe(true);
    // A file that is not what the tool writes (hand-edited, reordered or cut short) is rewritten.
    for (const text of [
      '',
      '{',
      committed.replace(/\n$/, ''),
      committed.replace('  "rows"', '"rows"'),
    ]) {
      const change = buildRecordsChange({ snapshot: later, docs: {}, currentStateText: text });
      expect(change.stateFileChanged).toBe(true);
      expect(change.stateFileText).toBe(formatSwitchStateSnapshot(later));
    }
  });

  it('"default OFF in source" is judged as off, so a live on row is drift (the 2026-11-24 case)', () => {
    expect(parseAuthorityDocState(TRIM_DOC)?.state).toBe('off');
    expect(
      findAuthorityDocStateDrift({ snapshot, docs: { cashDefenceTrimColdCalls: TRIM_DOC } })
    ).toEqual([
      expect.objectContaining({
        option: 'cashDefenceTrimColdCalls',
        docState: 'off',
        liveState: 'on',
      }),
    ]);
  });

  it('rewrites only the disagreeing doc, and the new State round-trips through parseAuthorityDocState', () => {
    const change = buildRecordsChange({
      snapshot,
      docs: {
        cashDefenceTrimColdCalls: TRIM_DOC,
        holdemValueAndCallsArePriced: PLAIN_ON_DOC,
        plo6FacingBetIsPricedV2: V2_DOC,
      },
    });
    expect(change.docChanges.map((c) => c.option)).toEqual(['cashDefenceTrimColdCalls']);
    const [c] = change.docChanges;
    expect(c.path).toBe('docs/horse-option-authority.d/cashDefenceTrimColdCalls.md');
    expect(parseAuthorityDocState(c.text)?.state).toBe('on');
    expect(c.to).toBe('LIVE ON since audit #193, 2026-11-24T08:18:04Z; Evidence MET (2026-11-21).');
    // Everything outside the State token is unchanged.
    expect(c.text.replace(/\*\*State:[^*]+\*\*/, '')).toBe(
      TRIM_DOC.replace(/\*\*State:[^*]+\*\*/, '')
    );
    expect(
      findAuthorityDocStateDrift({ snapshot, docs: { cashDefenceTrimColdCalls: c.text } })
    ).toEqual([]);
  });

  it('keeps the literal Evidence MET / Evidence NOT MET phrase the scoreboard parses', () => {
    const on = rewriteAuthorityDocState(V2_DOC, 'on', { auditId: 200, changedAt: null });
    expect(on).toContain(
      '**State: LIVE ON since audit #200; Evidence NOT MET against the REPLAY-6 verdict-only bar.**'
    );
    const off = rewriteAuthorityDocState(TRIM_DOC, 'off', { auditId: 201, changedAt: null });
    expect(parseAuthorityDocState(off)?.state).toBe('off');
    expect(off).toContain('Evidence MET (2026-11-21)');
    expect(rewriteAuthorityDocState('# no state here\n', 'on')).toBeNull();
  });

  it('every live state round-trips, and a cleared row reads as off', () => {
    for (const s of ['on', 'off', 'shadow', 'on_shadow']) {
      expect(parseAuthorityDocState(rewriteAuthorityDocState(PLAIN_ON_DOC, s))?.state).toBe(s);
    }
    expect(parseAuthorityDocState(rewriteAuthorityDocState(PLAIN_ON_DOC, 'default'))?.state).toBe(
      'off'
    );
  });

  it('never guesses: a release-default-ON option with no row is left for a person', () => {
    const empty = snapshotFromRows([], '2026-11-24T14:20:00Z');
    const change = buildRecordsChange({
      snapshot: empty,
      docs: { holdemValueAndCallsArePriced: PLAIN_ON_DOC },
      releaseDefaultOn: new Set(['holdemValueAndCallsArePriced']),
    });
    expect(change.docChanges).toEqual([]);
    expect(change.unresolved).toEqual([
      expect.objectContaining({ option: 'holdemValueAndCallsArePriced' }),
    ]);
    const { body } = formatRecordsPr({ change, snapshot: empty, trigger: 't' });
    expect(body).toContain('NOT CHANGED, needs a person: holdemValueAndCallsArePriced');
  });

  // 2026-11-24: omahaPricedRaiseNeverMakesNonNutRaise went live (audits #197, #198) through a private
  // wrapper. Its doc had no State token and still read "stays OFF"; buildRecordsChange reported nothing,
  // so a records PR built from it failed the law "every option with a live row has a doc State the drift
  // check can read" without saying why.
  const NO_STATE_DOC =
    '# omahaPricedRaiseNeverMakesNonNutRaise: Authority For The Live Switch\n\n' +
    'Built 2026-11-22 by PLO-OWNER lead-5. Evidence NOT MET: stays OFF. This file does not authorize switching the option on.\n\n' +
    '## What It Does\n';
  const NON_NUT_ROW = {
    option: 'omahaPricedRaiseNeverMakesNonNutRaise',
    state: 'on',
    updated_at: '2026-11-24 18:09:58.496+00',
    audit_id: 198,
    audit_max: 198,
  };

  it('a newly live option whose doc has no State token gains one in its status paragraph', () => {
    const snap = snapshotFromRows([NON_NUT_ROW], '2026-11-25T23:38:00Z');
    const docs = { omahaPricedRaiseNeverMakesNonNutRaise: NO_STATE_DOC };
    expect(findUnjudgedLiveAuthorityDocs({ snapshot: snap, docs })).toHaveLength(1);
    const change = buildRecordsChange({ snapshot: snap, docs });
    expect(change.unresolved).toEqual([]);
    expect(change.docChanges).toHaveLength(1);
    const [c] = change.docChanges;
    expect(c.from).toBe('(no State token)');
    expect(c.to).toBe('LIVE ON since audit #198, 2026-11-24T18:09:58Z.');
    expect(parseAuthorityDocState(c.text)?.state).toBe('on');
    // The law's two readings of the rewritten doc: judged, and in step with the live row.
    const after = { omahaPricedRaiseNeverMakesNonNutRaise: c.text };
    expect(findUnjudgedLiveAuthorityDocs({ snapshot: snap, docs: after })).toEqual([]);
    expect(findAuthorityDocStateDrift({ snapshot: snap, docs: after })).toEqual([]);
    // The token sits in the status paragraph and the evidence claim is still the doc's own.
    expect(c.text.split('\n')[2].startsWith('**State: LIVE ON since audit #198')).toBe(true);
    expect(parseAuthorityDocEvidence(c.text)).toBe('not_met');
    expect(c.text).toContain('Evidence NOT MET: stays OFF.');
    const { body } = formatRecordsPr({ change, snapshot: snap, trigger: 't' });
    expect(body).toContain('State "(no State token)" -> "LIVE ON since audit #198');
  });

  it('a doc on the closed pre-token list is left alone, as the law leaves it', () => {
    const name = AUTHORITY_DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN[0];
    const snap = snapshotFromRows([{ ...NON_NUT_ROW, option: name }], '2026-11-25T23:38:00Z');
    const change = buildRecordsChange({ snapshot: snap, docs: { [name]: NO_STATE_DOC } });
    expect(change.docChanges).toEqual([]);
    expect(change.unresolved).toEqual([]);
  });

  it('never guesses where a State token goes: no title, no opening paragraph or an unreadable State is left for a person', () => {
    const snap = snapshotFromRows([NON_NUT_ROW], '2026-11-25T23:38:00Z');
    expect(insertAuthorityDocState('no title here\n', 'on')).toBeNull();
    expect(insertAuthorityDocState('# t\n\n- a list first\n', 'on')).toBeNull();
    expect(insertAuthorityDocState('# t\n\n## a heading first\n', 'on')).toBeNull();
    expect(insertAuthorityDocState('# t\n\n**State: OFF.** has one\n', 'on')).toBeNull();
    for (const text of ['# t\n\n| a | table |\n', '# t\n\n**State: pending review.** odd\n']) {
      const change = buildRecordsChange({
        snapshot: snap,
        docs: { omahaPricedRaiseNeverMakesNonNutRaise: text },
      });
      expect(change.docChanges).toEqual([]);
      expect(change.unresolved).toEqual([
        expect.objectContaining({ option: 'omahaPricedRaiseNeverMakesNonNutRaise' }),
      ]);
      const { body } = formatRecordsPr({ change, snapshot: snap, trigger: 't' });
      expect(body).toContain('NOT CHANGED, needs a person: omahaPricedRaiseNeverMakesNonNutRaise');
    }
  });

  it('the PR names the options it records and says it writes nothing live', () => {
    const change = buildRecordsChange({ snapshot, docs: { cashDefenceTrimColdCalls: TRIM_DOC } });
    const { title, body } = formatRecordsPr({
      change,
      snapshot,
      trigger: 'set x -> on (audit #193)',
    });
    expect(title).toBe('docs(horses): record the live switch state of cashDefenceTrimColdCalls');
    expect(body).toContain('audit max 195');
    expect(body).toContain('No switch, settings or database write.');
    expect([...`${title}${body}`].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });
});

function mockDeps(opts: { refusal?: string | null } = {}) {
  const executedSql: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let rows: Array<Record<string, unknown>> = [
    { option: 'styleTightPlayerExploit', state: 'on', updated_at: '2026-11-21T10:00:00Z' },
  ];
  let note = '';
  const queryDb = vi.fn((sql: string) => {
    executedSql.push(sql);
    if (sql.includes('FROM public.ca_horse_style_switch s ORDER BY')) {
      return rows.map((r) => ({ ...r, audit_id: 175, audit_max: 175 }));
    }
    if (sql.includes('FROM public.ca_horse_style_switch ORDER BY')) return rows;
    if (sql.includes('FROM public.ca_horse_style_switch_audit ORDER BY')) return [];
    if (sql.includes('FROM public.ca_horse_option_registry_serving')) {
      return [
        {
          release_sha: SERVING_SHA,
          registry: { styleTightPlayerExploit: ['off', 'shadow', 'on_shadow', 'on'] },
          seen_at: '2026-11-21T15:19:45Z',
        },
      ];
    }
    if (sql.includes('fn_ca_horse_option_registry_refusal'))
      return [{ refusal: opts.refusal ?? null }];
    if (sql.includes('fn_platform_frozen()')) {
      return [{ platform_frozen: false, has_break_table: true, has_windows_table: false }];
    }
    if (sql.includes('FROM public.engine_maintenance_break')) return [];
    if (sql.includes('FROM public.ca_horse_option_switch_evidence')) {
      return [{ id: 42, option: 'styleTightPlayerExploit', evidence_sha256: VALID_SHA }];
    }
    if (sql.includes('fn_ca_horse_option_switch_set')) {
      const m = sql.match(
        /fn_ca_horse_option_switch_set\('[^']+',\s*'([^']+)',\s*'[^']+',\s*'((?:[^']|'')*)'\)/
      );
      note = (m?.[2] ?? '').replace(/''/g, "'");
      rows = [
        { option: 'styleTightPlayerExploit', state: m?.[1], updated_at: '2026-11-21T15:20:01Z' },
      ];
      return [{ result: { option: 'styleTightPlayerExploit', state: m?.[1] } }];
    }
    if (sql.includes('latest_audit_id')) {
      return [
        {
          option: 'styleTightPlayerExploit',
          state: rows[0].state,
          updated_at: '2026-11-21T15:20:01Z',
          note,
          latest_audit_id: 175,
        },
      ];
    }
    return [];
  });
  const openRecordsPr = vi.fn(async (arg: { snapshot: { auditMax: number | null } }) => ({
    prUrl: 'https://github.com/example/pull/1',
    branch: 'agent/horse-switch-records/x',
    seenAuditMax: arg.snapshot.auditMax,
  }));
  return {
    deps: {
      queryDb,
      fetchHealth: vi.fn(async () => ({
        status: 'ok',
        liveness: 'ok',
        releaseSha: SERVING_SHA,
        maintenance: {
          active: false,
          phase: 'idle',
          durableConfirmed: false,
          readyForRestart: false,
        },
        liveHorseDecision: { phase: 'ready', upgradeManifest: { sourceRevision: SERVING_SHA } },
      })),
      readFile: vi.fn(() => JSON.stringify({ version: 1, windows: [] })),
      // A switch-on needs a cited file whose status paragraph states "Evidence MET".
      readFileBuffer: vi.fn(() =>
        Buffer.from(
          '# styleTightPlayerExploit\n\n**State: OFF**. Evidence MET (replay row below).\n'
        )
      ),
      appendLogLine: vi.fn(),
      writeStateFile: vi.fn(),
      openRecordsPr,
      now: () => SAFE_NOW,
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s),
    },
    executedSql,
    openRecordsPr,
    stdout,
    stderr,
  };
}

const SET_ARGS = [
  'set',
  'styleTightPlayerExploit',
  'on_shadow',
  '--reason',
  'records test',
  '--authority',
  'docs/horse-option-authority.d/styleTightPlayerExploit.md',
  '--evidence-sha',
  VALID_SHA,
  '--changed-by',
  'Horse SWITCH lane (Antigravity 151f9a34)',
];

describe('set opens the records PR after a verified write, and only then', () => {
  it('a dry run opens no records PR', async () => {
    const m = mockDeps();
    const res = await runCli([...SET_ARGS, '--dry-run'], m.deps);
    expect(res.exitCode).toBe(0);
    expect(m.openRecordsPr).not.toHaveBeenCalled();
  });

  it('a refused write opens no records PR', async () => {
    const m = mockDeps({ refusal: 'not registered in the serving build' });
    const res = await runCli(SET_ARGS, m.deps);
    expect(res.data.executed).toBe(false);
    expect(m.executedSql.some((s) => s.includes('fn_ca_horse_option_switch_set'))).toBe(false);
    expect(m.openRecordsPr).not.toHaveBeenCalled();
  });

  it('a verified write opens it from the live rows read after the write', async () => {
    const m = mockDeps();
    const res = await runCli(SET_ARGS, m.deps);
    expect(res.exitCode).toBe(0);
    expect(res.data.executed).toBe(true);
    expect(m.openRecordsPr).toHaveBeenCalledTimes(1);
    const setIdx = m.executedSql.findIndex((s) => s.includes('fn_ca_horse_option_switch_set'));
    const snapIdx = m.executedSql.findIndex((s) =>
      s.includes('FROM public.ca_horse_style_switch s ORDER BY')
    );
    expect(snapIdx).toBeGreaterThan(setIdx);
    expect(res.data.records).toEqual(
      expect.objectContaining({ ok: true, prUrl: 'https://github.com/example/pull/1' })
    );
    expect(m.stdout.join('\n')).toContain('records PR: https://github.com/example/pull/1');
  });

  it('a records failure never undoes the write and prints the finishing command', async () => {
    const m = mockDeps();
    m.deps.openRecordsPr = vi.fn(async () => {
      throw new Error('push refused');
    });
    const res = await runCli(SET_ARGS, m.deps);
    expect(res.exitCode).toBe(0);
    expect(res.data.executed).toBe(true);
    expect(res.data.records).toEqual({ ok: false, error: 'push refused' });
    expect(m.executedSql.filter((s) => s.includes('fn_ca_horse_option_switch_set'))).toHaveLength(
      1
    );
    expect(m.stdout.join('\n')).toContain(`finish with: ${RECORDS_FINISH_COMMAND}`);
  });

  it('--no-records-pr skips it and says how to finish', async () => {
    const m = mockDeps();
    const res = await runCli([...SET_ARGS, '--no-records-pr'], m.deps);
    expect(res.data.executed).toBe(true);
    expect(m.openRecordsPr).not.toHaveBeenCalled();
    expect(m.stdout.join('\n')).toContain(`run ${RECORDS_FINISH_COMMAND}`);
  });

  it('`records` runs on demand for a write made by any wrapper, and its dry run writes nothing', async () => {
    const m = mockDeps();
    const res = await runCli(['records'], m.deps);
    expect(res.exitCode).toBe(0);
    expect(m.openRecordsPr).toHaveBeenCalledTimes(1);
    expect(m.executedSql.every((s) => !s.includes('fn_ca_horse_option_switch_set'))).toBe(true);

    const d = mockDeps();
    (d.deps as Record<string, unknown>).readAuthorityDocs = () => ({
      cashDefenceTrimColdCalls: TRIM_DOC,
    });
    const dry = await runCli(['records', '--dry-run', '--json'], d.deps);
    expect(dry.exitCode).toBe(0);
    expect(d.openRecordsPr).not.toHaveBeenCalled();
    expect(dry.data.dryRun).toBe(true);
  });
});

// 2026-11-26: the records worktree defaulted to the system temp folder, which on the operations Mac is the
// internal disk agents never write to, and its commit skipped the repository's hooks.
describe('the records worktree goes where agents may write, and its commit runs the hooks', () => {
  it('uses CA_RECORDS_ROOT when set, the external volume that holds the checkout on the Mac, and refuses otherwise', () => {
    expect(
      recordsWorkRoot({
        env: { CA_RECORDS_ROOT: '/x/y' },
        platform: 'darwin',
        repoRoot: '/Users/a/repo',
      })
    ).toBe('/x/y');
    expect(
      recordsWorkRoot({
        env: {},
        platform: 'darwin',
        repoRoot: '/Volumes/SmarterWork/agent-work/extreme-capacity/lane/wt',
      })
    ).toBe('/Volumes/SmarterWork/agent-work/extreme-capacity/lane');
    expect(() =>
      recordsWorkRoot({
        env: {},
        platform: 'darwin',
        repoRoot: '/Users/smarter.poker/Documents/club-arena',
      })
    ).toThrow(/CA_RECORDS_ROOT/);
    expect(() => recordsWorkRoot({ env: {}, platform: 'darwin', repoRoot: '/Volumes/wt' })).toThrow(
      /CA_RECORDS_ROOT/
    );
    expect(
      typeof recordsWorkRoot({ env: {}, platform: 'linux', repoRoot: '/home/runner/repo' })
    ).toBe('string');
  });

  it('never bypasses the commit hooks', () => {
    const src = readFileSync(
      resolve(__dirname, '../../scripts/ops/horse-option-switch-records.mjs'),
      'utf8'
    );
    expect(src).not.toMatch(/--no-verify/);
    expect(src).not.toMatch(/\|\|\s*tmpdir\(\)/);
  });
});
