/**
 * A HELD ORIGINAL THAT NEVER STARTED DOES NOT HOLD THE RESTART (2026-11-06)
 *
 * The serving engine (71087373) counts a table that reserved its next hand an
 * instant before the break paused it as `cards_in_air`, for ever: the hand can
 * never start while the break holds it, and that build has no rule that parks
 * it (#9615 is that rule, and it can only go live through this certificate).
 * Satellite 30 (table 72417d9c, permit b7c07f7c, hand 55620681) and Satellite
 * 25 (aed78e3f, hand 55430351) held such hands with no snapshot, no hand
 * history and no evidence, and every release backed out on cards_in_air.
 *
 * The law:
 * 1. cards_in_air is admitted ONLY by the drained-boundary witness
 *    (engine-release-inflight-hands.py --drained-predecessor) answering 0, with
 *    the engine own handsInFlightTotal present and zero.
 * 2. Any other witness answer (a hand moving, unknown, missing) refuses.
 * 3. cards_in_air never enters BOUNDED_ONLY, and the plain database in-flight
 *    branch still never admits it; a reader that never names the witness
 *    refuses; every non-bounded reason mixed with it still refuses.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const TRANSACTION = readFileSync(join(ROOT, 'server/scripts/engine-release-transaction.sh'), 'utf8');
const entryRead = TRANSACTION.slice(
  TRANSACTION.indexOf('legacy_entry_read() {'),
  TRANSACTION.indexOf('legacy_entry_trace() {')
);
const certificateHelper = TRANSACTION.slice(
  TRANSACTION.indexOf('maintenance_certificate() {'),
  TRANSACTION.indexOf("\n# Entry to the exact predecessor's checkpoint")
);

/** Plain in-flight helper: answers `rc` to everything but the weekly read. */
function helper(name: string, rc: number, drainedRc?: number): string {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  const path = join(dir, 'engine-release-inflight-hands.py');
  const drained =
    drainedRc === undefined
      ? ''
      : `for a in "$@"; do if [ "$a" = --drained-predecessor ]; then echo '[witness] drained ${drainedRc}'; exit ${drainedRc}; fi; done\n`;
  writeFileSync(
    path,
    `#!/bin/sh\nif [ "\${3:-}" = --weekly-payout-only ]; then echo weekly-ok; exit 0; fi\n${drained}echo '[engine-release-inflight-hands] answer ${rc}'\nexit ${rc}\n`
  );
  chmodSync(path, 0o755);
  return path;
}

function certificate({
  reasons,
  hands = 0,
  inflightRc = 0,
  witness,
}: {
  reasons: Record<string, unknown>;
  hands?: number | 'absent';
  inflightRc?: number;
  /** drained-boundary answer; undefined leaves HELD_ORIGINAL_WITNESS unset */
  witness?: number;
}) {
  const unparked = Object.values(reasons).reduce<number>(
    (sum, n) => sum + (typeof n === 'number' ? n : 1),
    0
  );
  const body = JSON.stringify({
    running: true,
    weeklyPayout: null,
    releaseSha: 'b'.repeat(40),
    ...(hands === 'absent' ? {} : { handsInFlightTotal: hands }),
    maintenance: {
      reason: 'Deployment Recovery',
      active: true,
      phase: 'counting_down',
      durableConfirmed: true,
      readyForRestart: false,
      unparkedTables: unparked,
      unparkedReasons: reasons,
      remainingMs: 296_000,
    },
  });
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PROBE_BODY: body,
    MOCK_INFLIGHT: helper('inflight', inflightRc),
  };
  const witnessLine =
    witness === undefined ? '' : `HELD_ORIGINAL_WITNESS="${helper('witness', 1, witness)}"\n`;
  return spawnSync(
    'bash',
    [
      '-c',
      `set -u
MIN_BREAK_REMAINING_MS=285000
ENV_FILE=/dev/null
INFLIGHT_HANDS="$MOCK_INFLIGHT"
${witnessLine}${entryRead}
curl() { printf '%s\\n%s' "$PROBE_BODY" "200"; }
${certificateHelper}
maintenance_certificate`,
    ],
    { encoding: 'utf8', timeout: 10_000, env }
  );
}

describe('1. cards_in_air from held originals is admitted only by the drained-boundary witness', () => {
  it('admits the production shape (Satellites 25 and 30) when the witness proves nothing is moving', () => {
    const result = certificate({ reasons: { cards_in_air: 2 }, witness: 0 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('296000\n');
    expect(result.stderr).toContain('[witness] drained 0');
    expect(result.stderr).toContain('admitting the cutover past cards_in_air held originals');
  });

  it('admits it beside the bounded preparation reasons, still through the witness', () => {
    const result = certificate({
      reasons: { cards_in_air: 1, f06_preparation_stuck: 3 },
      witness: 0,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('[witness] drained 0');
  });
});

describe('2. a hand that may be moving, or an unreadable witness, keeps the gate shut', () => {
  it.each([1, 3, 2, 126, 127])('refuses when the witness answers %i', (rc) => {
    const result = certificate({ reasons: { cards_in_air: 2 }, witness: rc });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('cards_in_air keeps the gate shut');
  });

  it('refuses when the engine reports a hand in flight, whatever the witness says', () => {
    for (const hands of [1, 'absent'] as const) {
      const result = certificate({ reasons: { cards_in_air: 2 }, hands, witness: 0 });
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain('[witness] drained');
    }
  });

  it('a reader that never names the witness refuses, even when the plain database branch would answer 0', () => {
    const result = certificate({ reasons: { cards_in_air: 2 }, inflightRc: 0 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('the database confirms no hand is in the air');
  });
});

describe('3. nothing else is widened', () => {
  it.each([
    { cards_in_air: 1, stopped_bank_custody_stuck: 1 },
    { cards_in_air: 1, stopped_bank_custody_unconfirmed: 1 },
    { cards_in_air: 1, bank_park_write_incomplete: 1 },
    { cards_in_air: 1, a_reason_a_future_engine_invents: 1 },
    { cards_in_air: 'many' },
    { cards_in_air: -1 },
  ])('refuses %j even with the witness at 0', (reasons) => {
    const result = certificate({ reasons, witness: 0 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('[witness] drained');
  });

  it('cards_in_air is not in the bounded set and the database branch still cannot admit it', () => {
    const literal = TRANSACTION.match(/^BOUNDED_ONLY=\{(.*)\}$/m);
    expect(literal).toBeTruthy();
    expect(literal![1]).not.toContain('cards_in_air');
    expect(TRANSACTION).toContain(
      'legacy_entry_read "$HELD_ORIGINAL_WITNESS" --env-file "$ENV_FILE" --drained-predecessor >&2'
    );
    expect(TRANSACTION).toContain('HELD_ORIGINAL_WITNESS="$CONTROL_DIR/engine-release-inflight-hands.py"');
    const branch = TRANSACTION.slice(
      TRANSACTION.indexOf('    5)\n'),
      TRANSACTION.indexOf('    *) return 1 ;;', TRANSACTION.indexOf('    5)\n'))
    );
    expect(branch.match(/return 0/g)).toHaveLength(1);
    expect(branch).not.toMatch(/FORCE|SKIP|BYPASS|OVERRIDE/);
  });
});
