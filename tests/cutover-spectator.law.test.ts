import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  correlateSpectator,
  spectatorOutcome,
} from '../scripts/ci/correlate-cutover-spectator.mjs';
import {
  classifySpectatorAdmission,
  notObservedRecord,
  occupiedCashTableForBreak,
  readNotObserved,
} from '../scripts/ci/cutover-spectator-admission.mjs';

const run = '123-1';
const receipt = {
  runId: run,
  result: 'sealed',
  sha: 'a'.repeat(40),
  instanceId: '1-abcd1234',
  completionRuntime: { instanceId: '1-abcd1234' },
  startedAt: '2026-11-10T10:00:15Z',
};
const started = Date.parse(receipt.startedAt);
const witness = {
  runId: run,
  target: receipt.sha,
  predecessor: 'b'.repeat(40),
  beforeInstance: '1-eeeeeeee',
  afterInstance: receipt.instanceId,
  sameAuthenticatedSpectator: true,
  tableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  armedAt: started - 5000,
  armedPhase: 'idle',
  freeze: started - 1000,
  thaw: started + 1000,
  restoredAt: started + 2000,
  handNumber: 100,
  committedAt: new Date(started + 5000).toISOString(),
};

describe('authenticated cutover spectator', () => {
  it('binds the same fixture and its committed hand to the original sealed instance and freeze', () => {
    expect(correlateSpectator(receipt, witness, run)).toMatchObject({
      fixtureCleanupVerified: true,
    });
  });
  it.each([
    { runId: '123-2' },
    { afterInstance: witness.beforeInstance },
    { armedAt: started },
    { thaw: started - 1 },
    { restoredAt: started - 1 },
    { committedAt: receipt.startedAt },
    { sameAuthenticatedSpectator: false },
    { armedPhase: 'counting_down' },
    { armedPhase: undefined },
    // Armed in the last hand is admitted; armed at or after the freeze never is.
    { armedPhase: 'last_hand', armedAt: started - 1000 },
  ])('refuses broken provenance %o', (delta) => {
    expect(() => correlateSpectator(receipt, { ...witness, ...delta }, run)).toThrow();
  });
  it('does not let either observer gate the production owner or change its workflow conclusion', () => {
    const { jobs } = parse(readFileSync('.github/workflows/auto-deploy-hetzner.yml', 'utf8'));
    expect(jobs['cutover-spectator'].needs).toBe('preflight');
    expect(jobs['cutover-spectator']['continue-on-error']).toBe(true);
    expect(jobs['correlate-cutover-spectator']['continue-on-error']).toBe(true);
    for (const [name, job] of Object.entries(jobs) as [string, { needs?: string | string[] }][]) {
      if (name !== 'correlate-cutover-spectator')
        expect([job.needs].flat()).not.toContain('cutover-spectator');
      expect([job.needs].flat()).not.toContain('correlate-cutover-spectator');
    }
  });

  const target = receipt.sha;
  const predecessor = witness.predecessor;
  const health = (releaseSha: unknown, maintenance: unknown) => ({ releaseSha, maintenance });

  it('admits a spectator while the predecessor deals or is inside its announced last hand', () => {
    expect(
      classifySpectatorAdmission(health(predecessor, { active: false, phase: 'idle' }), {
        target,
        predecessor,
      })
    ).toEqual({ outcome: 'observe', phase: 'idle', predecessor });
    // 2026-11-14: the announcement landed before the browser opened its table.
    expect(
      classifySpectatorAdmission(health(predecessor, { active: true, phase: 'last_hand' }), {
        target,
      })
    ).toEqual({ outcome: 'observe', phase: 'last_hand', predecessor });
    expect(correlateSpectator(receipt, { ...witness, armedPhase: 'last_hand' }, run)).toMatchObject(
      { armedPhase: 'last_hand', fixtureCleanupVerified: true }
    );
  });

  it.each([
    [health(predecessor, { active: true, phase: 'counting_down' })],
    [health(predecessor, { active: true, phase: 'finalizing' })],
    [health(predecessor, { active: true })],
    [health(target, { active: false, phase: 'idle' })],
    [health(target, { active: true, phase: 'counting_down' })],
  ])('names a spectator that arrived after the freeze began NOT OBSERVED (late): %o', (h) => {
    const verdict = classifySpectatorAdmission(h, { target, predecessor });
    expect(verdict.outcome).toBe('not-observed-late');
    expect((verdict as { reason: string }).reason.length).toBeGreaterThan(0);
  });

  it.each([
    [null],
    [health(undefined, { active: false })],
    [health('abc', { active: false })],
    [health(predecessor, null)],
    [health(predecessor, {})],
    [health(predecessor, { active: 'false' })],
    [health('c'.repeat(40), { active: false })],
  ])('keeps an unreadable or foreign engine as could-not-tell, never observe or late: %o', (h) => {
    expect(classifySpectatorAdmission(h, { target, predecessor }).outcome).toBe('unknown');
  });

  it('refuses to classify without one full candidate SHA distinct from the predecessor', () => {
    const idle = health(predecessor, { active: false });
    expect(classifySpectatorAdmission(idle, {}).outcome).toBe('unknown');
    expect(classifySpectatorAdmission(idle, { target: 'abc' }).outcome).toBe('unknown');
    expect(classifySpectatorAdmission(idle, { target: predecessor, predecessor }).outcome).toBe(
      'unknown'
    );
  });

  it('takes only an occupied cash table that has dealt once tables park for the break', () => {
    const table = { gameFormat: 'cash', seated: 6, dealable: 5, handCount: 40, paused: true };
    expect(occupiedCashTableForBreak(table)).toBe(true);
    for (const delta of [
      { gameFormat: 'mtt' },
      { gameFormat: null },
      { seated: 1 },
      { dealable: 1 },
      { handCount: 0 },
      { dealable: undefined },
    ])
      expect(occupiedCashTableForBreak({ ...table, ...delta })).toBe(false);
    expect(occupiedCashTableForBreak(null)).toBe(false);
  });

  const lateRecord = notObservedRecord({
    runId: run,
    target,
    reason: 'the freeze had already begun (counting_down) before the spectator was attached',
    health: health(predecessor, { active: true, phase: 'counting_down' }),
    at: started,
  });

  it('never seals a spectator that did not witness the replacement', () => {
    const late = spectatorOutcome({
      receipt: JSON.stringify(receipt),
      witness: '',
      notObserved: JSON.stringify(lateRecord),
      runId: run,
    });
    expect(late).toEqual({ outcome: 'not-observed', record: lateRecord });
    expect(late).not.toHaveProperty('sealed');
    // Neither a witness nor a record is a failure, not a quiet third green.
    expect(() =>
      spectatorOutcome({
        receipt: JSON.stringify(receipt),
        witness: '',
        notObserved: '',
        runId: run,
      })
    ).toThrow();
    // Another attempt's record, or a malformed one, is not this attempt's outcome.
    for (const notObserved of [
      JSON.stringify({ ...lateRecord, runId: '123-2' }),
      JSON.stringify({ ...lateRecord, outcome: 'sealed' }),
      JSON.stringify({ ...lateRecord, reason: '' }),
      '{',
    ])
      expect(() =>
        spectatorOutcome({ receipt: JSON.stringify(receipt), witness: '', notObserved, runId: run })
      ).toThrow();
    expect(readNotObserved(JSON.stringify(lateRecord), 'not-a-run')).toBeNull();
    // A witness beside a late record contradicts itself and seals nothing.
    expect(() =>
      spectatorOutcome({
        receipt: JSON.stringify(receipt),
        witness: JSON.stringify(witness),
        notObserved: JSON.stringify(lateRecord),
        runId: run,
      })
    ).toThrow();
    expect(
      spectatorOutcome({
        receipt: JSON.stringify(receipt),
        witness: JSON.stringify(witness),
        notObserved: '',
        runId: run,
      }).outcome
    ).toBe('sealed');
  });

  it('uploads a sealed-spectator artifact only for the sealed outcome and never waits on the observer', () => {
    const { jobs } = parse(readFileSync('.github/workflows/auto-deploy-hetzner.yml', 'utf8'));
    const spectator = jobs['cutover-spectator'];
    const steps = spectator.steps as { name?: string; id?: string; if?: string; run?: string }[];
    const predecessor = steps.find((step) => step.id === 'predecessor')!;
    expect(predecessor.run).toBe('node scripts/ci/cutover-spectator-admission.mjs');
    // No fixture and no browser for a spectator that is already too late.
    for (const id of ['account', 'observe'])
      expect(steps.find((step) => step.id === id)!.if).toBe(
        "steps.predecessor.outputs.admitted == 'true'"
      );
    const retired = steps.find((step) => step.id === 'retired')!;
    expect(retired.if).toBe("always() && steps.account.outcome != 'skipped'");
    expect(retired.run!.indexOf('production-e2e-account.mjs cleanup')).toBeLessThan(
      retired.run!.indexOf('witness=')
    );
    expect(retired.run).toMatch(
      /if \[ -f cutover-spectator\.json \]; then echo "witness=.*\n\s*elif \[ -f cutover-spectator-not-observed\.json \]; then echo "not_observed=/
    );
    const correlate = jobs['correlate-cutover-spectator'].steps as {
      id?: string;
      if?: string;
      run?: string;
      with?: { name?: string; path?: string };
    }[];
    const uploads = correlate.filter((step) => step.with?.name);
    expect(uploads.map((step) => [step.if, step.with!.name, step.with!.path])).toEqual([
      [
        "steps.correlate.outputs.outcome == 'sealed'",
        'sealed-spectator-${{ github.run_id }}-${{ github.run_attempt }}',
        'sealed-spectator.json',
      ],
      [
        "steps.correlate.outputs.outcome == 'not-observed'",
        'spectator-not-observed-${{ github.run_id }}-${{ github.run_attempt }}',
        'spectator-not-observed.json',
      ],
    ]);
    const run = correlate.find((step) => step.id === 'correlate')!.run!;
    // Only exit 0 may name the sealed file; exit 3 names the other one.
    expect(run.match(/sealed-spectator\.json/g)).toHaveLength(1);
    expect(run).toMatch(
      /if \[ "\$code" -eq 0 \]; then\s+mv correlated\.json sealed-spectator\.json\s+echo "outcome=sealed"/
    );
    expect(run).toMatch(
      /elif \[ "\$code" -eq 3 \]; then[\s\S]*mv correlated\.json spectator-not-observed\.json/
    );
    // The release owner starts no later because of this change.
    expect(jobs.deploy.needs).toEqual(['preflight', 'engine-doors']);
  });

  it('lets only the spectator case open during the last hand, and keeps its freeze proofs', () => {
    const spec = readFileSync('tests/e2e/production-live-table-realtime.spec.ts', 'utf8');
    expect(spec.match(/admitLastHand: true/g)).toHaveLength(1);
    const start = spec.indexOf("test('an authenticated spectator spans");
    const body = spec.slice(start, spec.indexOf("'cutover-spectator.json'", start));
    expect(body).toContain('admitLastHand: true');
    expect(body).toContain(
      'classifySpectatorAdmission(health, { target, predecessor: EXPECTED_ENGINE_SHA })'
    );
    expect(body).toContain(
      'expect(journal.transportIdsOpenAt(freeze)).toEqual([initial.socketId]);'
    );
    expect(body).toContain(".gte('break_started_at', new Date(armedAt).toISOString())");
    // The late path writes its own file and skips; it cannot reach the witness.
    expect(body.indexOf('await notObserved(')).toBeLessThan(
      body.indexOf('const { tableId, initial')
    );
    expect(body).toMatch(/await notObserved\([^)]*\);\s+return;/);
  });
});
