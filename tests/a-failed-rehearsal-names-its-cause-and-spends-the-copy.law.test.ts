/**
 * A FAILED REHEARSAL NAMES ITS CAUSE AND SPENDS THE COPY (O30, 2026-11-26).
 *
 * On 2026-11-26 three Backup certifications in a row were refused with
 * `rollback_rehearsal_failed_to_132ef19f0770` (runs 45827343954, 45827378798,
 * 45845308550). The first was a real failure: after the rollback the copy never
 * thawed. Its verdict line, which names the failed step, was sent to /dev/null.
 * The copy was left inside that trial's break, and the next two runs reused it
 * and spent 1200 s each waiting for play that could not start.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const STANDBY_PATH = join(ROOT, 'server/standby/standby-engine.sh');
const STANDBY = readFileSync(STANDBY_PATH, 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/backup-engine.yml'), 'utf8');

function bash(script: string) {
  return spawnSync(
    'bash',
    ['-c', `set -Eeuo pipefail\nsource ${JSON.stringify(STANDBY_PATH)}\n${script}`],
    { encoding: 'utf8' }
  );
}

function detail(direction: string, out: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'rehearsal-')), 'out');
  writeFileSync(file, out);
  const r = bash(`rehearsal_failure_detail ${direction} "$(cat ${JSON.stringify(file)})"`);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

describe('a failed rehearsal names its cause', () => {
  it('reads the reasons of the last swap verdict the trial printed', () => {
    const out = [
      'noise before',
      '{"trial":"swap","verdict":"fail","at":"2026-11-26T14:48:52Z","from":"aaa","to":"bbb","seats":41,"secondsFrozenTotal":null,"reasons":"frozen_seat_boundary_failed,to_did_not_deal_after_thaw"}',
    ].join('\n');
    expect(detail('rollback', out)).toMatchObject({
      direction: 'rollback',
      cause: 'frozen_seat_boundary_failed,to_did_not_deal_after_thaw',
      from: 'aaa',
      to: 'bbb',
      seats: 41,
    });
  });

  it('reads an early single reason, the shape the two reused-copy refusals had', () => {
    const out =
      '{"trial":"swap","verdict":"fail","at":"2026-11-26T15:33:20Z","reason":"from_never_dealt"}';
    expect(detail('rollback', out)).toMatchObject({ cause: 'from_never_dealt' });
  });

  it('says no_verdict when the trial ended before writing one, never a named cause', () => {
    expect(detail('forward', '')).toEqual({ direction: 'forward', cause: 'no_verdict' });
    expect(
      detail('forward', '{"trial":"break","verdict":"fail","reason":"never_live"}').cause
    ).toBe('no_verdict');
  });

  it('keeps an unparsable verdict line as evidence', () => {
    const d = detail('rollback', '{"trial":"swap","verdict":"fail","seats":,}');
    expect(d.cause).toBe('unparsed');
    expect(d.unparsed).toContain('"trial":"swap"');
  });

  it('certify keeps the trial output, logs the detail and writes it into the certificate', () => {
    expect(STANDBY).not.toMatch(/certified_player_swap "\$\w+" "\$\w+" >\/dev\/null/);
    // Never $(certified_player_swap ...): a subshell would lose SWAP_ADOPTION_SECONDS.
    expect(STANDBY).not.toMatch(/\$\(certified_player_swap/);
    expect(STANDBY).toContain('if certified_player_swap "$sha" "$serving" >"$swap_out"; then');
    expect(STANDBY).toContain('if certified_player_swap "$serving" "$sha" >"$swap_out"; then');
    expect(STANDBY).toContain(
      'rehearsal_failure=$(rehearsal_failure_detail rollback "$(cat "$swap_out")")'
    );
    expect(STANDBY).toContain(
      'rehearsal_failure=$(rehearsal_failure_detail forward "$(cat "$swap_out")")'
    );
    expect(STANDBY).toContain('log "certify $sha: rehearsal failure detail $rehearsal_failure"');
    expect(STANDBY).toContain('"rehearsalFailure": json.loads(sys.argv[9]),');
    // The refusal tokens other readers match on are unchanged.
    expect(STANDBY).toContain('record "rollback_rehearsal_failed_to_${serving:0:12}"');
    expect(STANDBY).toContain('record "swap_rehearsal_failed_from_${serving:0:12}"');
  });
});

describe('a failed rehearsal spends the copy', () => {
  function spend() {
    const dir = mkdtempSync(join(tmpdir(), 'spent-copy-'));
    const db = join(dir, 'database.json');
    writeFileSync(
      db,
      JSON.stringify({
        restoredAt: '2026-11-26T13:56:00Z',
        restoreValidated: true,
        restoreErrors: 0,
        schemaEvidenceValidated: true,
        ownersSha256: 'x',
      })
    );
    const r = bash(
      `STATE_DIR=${JSON.stringify(dir)}\nmark_copy_spent ${'a'.repeat(40)} '{"direction":"rollback","cause":"frozen_seat_boundary_failed"}'`
    );
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(readFileSync(db, 'utf8'));
  }

  it('marks the copy unvalidated and records who spent it and why', () => {
    const doc = spend();
    expect(doc.restoreValidated).toBe(false);
    expect(doc.restoredAt).toBe('2026-11-26T13:56:00Z');
    expect(doc.spentBy.sha).toBe('a'.repeat(40));
    expect(doc.spentBy.rehearsalFailure.cause).toBe('frozen_seat_boundary_failed');
  });

  it('an unvalidated copy is one the next run restores and no run may reuse', () => {
    // The workflow's copy stamp reads an unvalidated copy as never restored.
    expect(WORKFLOW).toMatch(
      /d\.get\(\\"restoreValidated\\"\) is True[^\n]*else \\"1970-01-01T00:00:00Z\\"/
    );
    expect(WORKFLOW).toContain(`[ "$stamp" != 1970-01-01T00:00:00Z ] || copy_evidence_sha=''`);
    // assert_valid_copy, which every cmd_run calls first, refuses it.
    expect(STANDBY).toContain(
      "assert database.get('restoreValidated') is True and database.get('restoreErrors') == 0"
    );
    // A restore writes database.json afresh, so the mark does not outlive it.
    expect(STANDBY).toMatch(/printf '\{"restoredAt":"%s"[^\n]*"restoreValidated":false/);
  });

  it('certify spends the copy on either failed direction and says so if it cannot', () => {
    expect(STANDBY).toContain(
      `mark_copy_spent "$sha" "$rehearsal_failure" || record 'copy_could_not_be_marked_spent'`
    );
    expect(STANDBY).toContain('local player_reconnect=false rehearsal_failure=null');
  });
});

describe('a failed rehearsal keeps the hung engine log', () => {
  it('prints the filtered, masked tail of the engine still running', () => {
    const r =
      bash(`docker() { printf '%s\\n' 'boot ok' 'maintenance: adopted break token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnop' 'thaw/release unproven; keeping every table paused MaintenanceThawError: maintenance_thaw_checkpoint_limit_reached_without_release' 'hand 12 dealt' 'leader key Ab3dEf9hIj2kLm5nOp7qRs1tUv4wXy6zAB8C' 'leader release ${'a'.repeat(40)}'; }
rehearsal_engine_log`);
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toEqual([
      'rehearsal engine: maintenance: adopted break token=<masked>',
      'rehearsal engine: thaw/release unproven; keeping every table paused MaintenanceThawError: maintenance_thaw_checkpoint_limit_reached_without_release',
      'rehearsal engine: leader key <masked>',
      `rehearsal engine: leader release ${'a'.repeat(40)}`,
    ]);
  });

  it('certify calls it on a failed swap and says so when the log cannot be read', () => {
    expect(STANDBY).toContain(
      `rehearsal_engine_log >&2 || log "certify $sha: the rehearsal engine's log could not be read"`
    );
  });
});

describe('the player witness lasts as long as the rehearsal it watches', () => {
  const PROBE = readFileSync(join(ROOT, 'server/standby/player-reconnect.mjs'), 'utf8');
  const TRIALS = readFileSync(join(ROOT, 'server/standby/standby-trials.sh'), 'utf8');

  it('its one budget is the thaw deadline plus the dealing wait of trial_swap', () => {
    const thaw = Number(
      /wait_frozen_seats "\$seat_owner" "\$\(\(t0 \+ (\d+)\)\)"/.exec(TRIALS)?.[1]
    );
    const deal = Number(/\(\( now - start < (\d+) \)\) \|\| return 1/.exec(TRIALS)?.[1]);
    expect(thaw).toBe(1800);
    expect(deal).toBe(1200);
    expect(PROBE).toContain(`export const WITNESS_BUDGET_MS = (${thaw} + ${deal}) * 1000;`);
    expect(PROBE).toContain('const deadline = Date.now() + WITNESS_BUDGET_MS;');
  });

  it('no phase of the witness has a cap shorter than that budget', () => {
    expect(PROBE).not.toMatch(/12 \* 60_000|600000|480000/);
    expect(PROBE).toContain('Math.max(0, deadline - Date.now())');
  });
});
