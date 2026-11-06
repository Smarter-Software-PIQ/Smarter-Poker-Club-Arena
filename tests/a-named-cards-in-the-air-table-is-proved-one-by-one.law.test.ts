/**
 * A NAMED CARDS-IN-THE-AIR TABLE IS PROVED ONE BY ONE, AND A BREAK THAT
 * CANNOT CLEAR ITS BLOCKER IS NOT ASKED FOR (2026-11-06).
 *
 * #9630 admitted the cards_in_air census claim through the fleet-wide
 * database proof (zero incomplete snapshots written in 600 s). The engine now
 * names each cards_in_air table (maintenance.unparkedTableIds), so the gate
 * also proves EACH one: the helper is called with --tables, and a held
 * original's hand must have no snapshot at all. Names that do not account for
 * every counted table refuse before the database is asked. An engine that
 * publishes no names keeps the fleet-wide proof alone.
 *
 * And before an off-cycle Deployment Recovery window is requested, the
 * transaction reads maintenance.restartPrecheck.persistent: anything a break
 * cannot clear means the window would pause every table and admit nobody, so
 * it is not asked for (release 42139090188-1 did exactly that at 01:22Z).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const TRANSACTION = readFileSync(
  join(ROOT, 'server/scripts/engine-release-transaction.sh'),
  'utf8'
);
const entryRead = TRANSACTION.slice(
  TRANSACTION.indexOf('legacy_entry_read() {'),
  TRANSACTION.indexOf('legacy_entry_trace() {')
);
const certificateHelper = TRANSACTION.slice(
  TRANSACTION.indexOf('maintenance_certificate() {'),
  TRANSACTION.indexOf("\n# Entry to the exact predecessor's checkpoint")
);
const T1 = '72417d9c-f9ff-417b-b902-26016d4a2571';
const T2 = 'aed78e3f-850b-4929-bb1d-1503449b41ce';

function inflightHelper(rc: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'inflight-named-'));
  const path = join(dir, 'engine-release-inflight-hands.py');
  writeFileSync(
    path,
    `#!/bin/sh\nif [ "\${3:-}" = --weekly-payout-only ]; then exit 0; fi\necho "[mock] answer ${rc} args: $*" >&2\nexit ${rc}\n`
  );
  chmodSync(path, 0o755);
  return path;
}

function certificate(maintenance: Record<string, unknown>, inflightRc = 0) {
  const body = JSON.stringify({
    running: true,
    weeklyPayout: null,
    releaseSha: 'b'.repeat(40),
    handsInFlightTotal: 0,
    maintenance: {
      reason: 'Deployment Recovery',
      active: true,
      phase: 'counting_down',
      durableConfirmed: true,
      readyForRestart: false,
      remainingMs: 296_000,
      ...maintenance,
    },
  });
  return spawnSync(
    'bash',
    [
      '-c',
      `set -u
MIN_BREAK_REMAINING_MS=285000
ENV_FILE=/dev/null
INFLIGHT_HANDS="$MOCK_INFLIGHT"
${entryRead}
curl() { printf '%s\\n%s' "$PROBE_BODY" "200"; }
${certificateHelper}
# Daily time admission has its own law; these cases isolate custody proof.
daily_cutover_clock() { return 0; }
maintenance_certificate`,
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, PROBE_BODY: body, MOCK_INFLIGHT: inflightHelper(inflightRc) },
    }
  );
}

describe('1. named cards_in_air tables are proved one by one', () => {
  it('passes every named table, with a held original hand, to the database proof', () => {
    const r = certificate({
      unparkedTables: 2,
      unparkedReasons: { cards_in_air: 2 },
      unparkedTableIds: [
        { tableId: T1, reason: 'cards_in_air', permitId: 'p', handNumber: '55620681' },
        { tableId: T2, reason: 'cards_in_air' },
      ],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(
      `args: --env-file /dev/null --max-age-seconds 600 --tables ${T1}:55620681,${T2}`
    );
    expect(r.stdout).toMatch(/^[0-9]+\n$/);
  });
  it('refuses when the database refuses a named table', () => {
    const r = certificate(
      {
        unparkedTables: 1,
        unparkedReasons: { cards_in_air: 1 },
        unparkedTableIds: [{ tableId: T1, reason: 'cards_in_air' }],
      },
      1
    );
    expect(r.status).not.toBe(0);
  });
  it('refuses, without asking the database, when the names do not account for every table', () => {
    const r = certificate({
      unparkedTables: 2,
      unparkedReasons: { cards_in_air: 2 },
      unparkedTableIds: [{ tableId: T1, reason: 'cards_in_air' }],
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('the names do not account for every one');
    expect(r.stderr).not.toContain('[mock] answer');
  });
  it('refuses a malformed table id or hand number', () => {
    for (const entry of [
      { tableId: 'not-a-table', reason: 'cards_in_air' },
      { tableId: T1, reason: 'cards_in_air', handNumber: '55;drop' },
    ]) {
      const r = certificate({
        unparkedTables: 1,
        unparkedReasons: { cards_in_air: 1 },
        unparkedTableIds: [entry],
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).not.toContain('[mock] answer');
    }
  });
  it('an engine that publishes no names keeps the fleet-wide proof alone', () => {
    const r = certificate({ unparkedTables: 1, unparkedReasons: { cards_in_air: 1 } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('args: --env-file /dev/null --max-age-seconds 600');
    expect(r.stderr).not.toContain('--tables');
  });
  it('a bounded F06 class alone never gets --tables', () => {
    const r = certificate({
      unparkedTables: 1,
      unparkedReasons: { f06_preparation_unresolved: 1 },
      unparkedTableIds: [{ tableId: T1, reason: 'f06_preparation_unresolved' }],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('--tables');
  });
});

describe('2. a window no break can use is not requested', () => {
  const fn = TRANSACTION.slice(TRANSACTION.indexOf('request_recovery_window() {'));
  const precheck = fn.slice(
    fn.indexOf('  persistent="$(printf'),
    fn.indexOf('\' 2>/dev/null)" || persistent=unreadable')
  );
  const script = precheck.slice(precheck.indexOf("python3 -c '") + "python3 -c '".length);
  const run = (maintenance: unknown) =>
    spawnSync('python3', ['-c', script], {
      encoding: 'utf8',
      input: JSON.stringify({ running: true, maintenance }),
    }).stdout.trim();

  it('names a persistent blocker', () => {
    expect(run({ restartPrecheck: { persistent: { frozen_hand: 2 }, tables: [] } })).toBe(
      'frozen_hand=2'
    );
  });
  it('an engine with nothing persistent asks as before', () => {
    expect(run({ restartPrecheck: { persistent: {}, tables: [] } })).toBe('');
  });
  it('an older engine without the precheck asks as before', () => {
    expect(run({})).toBe('');
  });
  it('a malformed precheck is unreadable, and unreadable does not ask', () => {
    expect(run({ restartPrecheck: { persistent: 'x' } })).toBe('unreadable');
  });
  it('the precheck runs before the reservation that announces the window', () => {
    expect(fn.indexOf('  persistent="$(printf')).toBeGreaterThan(0);
    expect(fn.indexOf('  persistent="$(printf')).toBeLessThan(
      fn.indexOf('reserve-recovery-window')
    );
    expect(fn).toContain('Not asking."\n    fi\n    return 0\n  fi');
  });
});
