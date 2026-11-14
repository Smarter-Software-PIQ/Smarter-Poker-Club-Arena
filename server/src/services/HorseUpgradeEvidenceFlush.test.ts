import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HorseUpgradeEvidenceRow } from '../engine/HorseUpgradeEvidence.js';

const mocked = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn() }));
vi.mock('./supabase/client.js', () => ({ supabase: { rpc: mocked.rpc } }));
vi.mock('./errorReporter.js', () => ({ reportError: mocked.report }));

type Service = typeof import('./HorseUpgradeEvidenceFlush.js');
type Evidence = typeof import('../engine/HorseUpgradeEvidence.js');
type Telemetry = typeof import('../engine/BrainTelemetry.js');

const ack = (payload: string, status = 'recorded') => ({
  data: {
    version: 1,
    status,
    batchId: JSON.parse(payload).batchId,
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
  },
  error: null,
});
const refusal = (message: string, code = 'P0001') => ({ data: null, error: { message, code } });
const horse = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const row = (n: number, over: Partial<HorseUpgradeEvidenceRow> = {}): HorseUpgradeEvidenceRow => ({
  day: '2026-11-14',
  horseUserId: horse(n),
  gameVariant: 'nlh',
  lane: 'cash',
  upgradeId: 'upgrade_02_card_removal_blockers',
  decisions: 3,
  invoked: 1,
  ...over,
});

let service: Service;
let evidence: Evidence;
let telemetry: Telemetry;
const fires = (): Record<string, number> =>
  Object.fromEntries(telemetry.drainFires().map((r) => [r.feature, r.fires]));

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
  vi.stubEnv('GIT_COMMIT_SHA', 'c'.repeat(40));
  vi.stubEnv('BRAIN_TELEMETRY_ENABLED', 'true');
  mocked.rpc.mockReset();
  mocked.report.mockReset();
  mocked.rpc.mockImplementation((_name, args) => ({
    abortSignal: () => Promise.resolve(ack(args.p_payload)),
  }));
  service = await import('./HorseUpgradeEvidenceFlush.js');
  evidence = await import('../engine/HorseUpgradeEvidence.js');
  telemetry = await import('../engine/BrainTelemetry.js');
  telemetry.enableBrainTelemetry();
});
afterEach(async () => {
  await service.stopHorseUpgradeEvidenceFlush();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A publisher over an in-memory aggregate, with the sends scripted. */
function publisherWith(
  held: HorseUpgradeEvidenceRow[],
  send: (payload: string, call: number) => unknown
) {
  const sent: string[] = [];
  const restored: HorseUpgradeEvidenceRow[] = [];
  const noted: string[] = [];
  let ids = 0;
  const publisher = new service.HorseUpgradeEvidencePublisher({
    drain: () => held.splice(0),
    restore: (rows) => restored.push(...rows),
    sourceRelease: () => 'c'.repeat(40),
    send: async (payload) => {
      sent.push(payload);
      const answer = send(payload, sent.length);
      if (answer instanceof Error) throw answer;
      return answer as never;
    },
    noteFeature: (feature) => noted.push(feature),
    now: () => new Date('2026-11-14T12:00:00.000Z'),
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  return { publisher, sent, restored, noted, batches: () => sent.map((p) => JSON.parse(p)) };
}

describe('the per-Horse upgrade evidence publisher', () => {
  it('is idle with nothing to write and sends nothing', async () => {
    const t = publisherWith([], (p) => ack(p));
    expect(await t.publisher.flush()).toEqual({
      status: 'idle',
      recorded: 0,
      replayed: 0,
      rejected: 0,
    });
    expect(t.sent).toEqual([]);
  });

  it('writes one bounded batch in the writer header shape, rows in key order', async () => {
    const t = publisherWith(
      [row(2), row(1), row(1, { upgradeId: 'upgrade_01_range_posteriors' })],
      (p) => ack(p)
    );
    expect(await t.publisher.flush()).toMatchObject({ status: 'written', recorded: 1 });
    const [batch] = t.batches();
    expect(Object.keys(batch)).toEqual([
      'version',
      'batchId',
      'workerId',
      'sequence',
      'sourceRelease',
      'day',
      'collectedAt',
      'rows',
    ]);
    expect(batch).toMatchObject({
      version: 1,
      sequence: 1,
      sourceRelease: 'c'.repeat(40),
      day: '2026-11-14',
      collectedAt: '2026-11-14T12:00:00.000Z',
    });
    expect(batch.rows).toEqual([
      {
        horseUserId: horse(1),
        gameVariant: 'nlh',
        lane: 'cash',
        upgradeId: 'upgrade_01_range_posteriors',
        decisions: 3,
        invoked: 1,
      },
      {
        horseUserId: horse(1),
        gameVariant: 'nlh',
        lane: 'cash',
        upgradeId: 'upgrade_02_card_removal_blockers',
        decisions: 3,
        invoked: 1,
      },
      {
        horseUserId: horse(2),
        gameVariant: 'nlh',
        lane: 'cash',
        upgradeId: 'upgrade_02_card_removal_blockers',
        decisions: 3,
        invoked: 1,
      },
    ]);
    expect(t.publisher.pendingBatches()).toBe(0);
  });

  it('splits a full drain inside the row and byte bounds, one day per batch, every row written exactly once', async () => {
    const held = [
      ...Array.from({ length: 8192 }, (_, n) => row(n)),
      row(1, { day: '2026-11-13' }),
      row(2, { day: '2026-11-13' }),
    ];
    const t = publisherWith(held, (p) => ack(p));
    expect(await t.publisher.flush()).toMatchObject({ status: 'written', rejected: 0 });
    const batches = t.batches();
    expect(batches.length).toBeGreaterThanOrEqual(4);
    expect(batches.length).toBeLessThanOrEqual(service.HORSE_UPGRADE_EVIDENCE_TICK_MAX_BATCHES);
    for (const [i, batch] of batches.entries()) {
      expect(batch.rows.length).toBeGreaterThan(0);
      expect(batch.rows.length).toBeLessThanOrEqual(service.HORSE_UPGRADE_EVIDENCE_MAX_ROWS);
      expect(Buffer.byteLength(t.sent[i]!)).toBeLessThanOrEqual(
        service.HORSE_UPGRADE_EVIDENCE_MAX_BYTES
      );
    }
    expect(new Set(batches.map((b) => b.batchId)).size).toBe(batches.length);
    expect(batches.map((b) => b.sequence)).toEqual(
      [...batches.map((b) => b.sequence)].sort((a, b) => a - b)
    );
    expect(batches.filter((b) => b.day === '2026-11-13').map((b) => b.rows.length)).toEqual([2]);
    const written = batches.flatMap((b) =>
      b.rows.map((r: { horseUserId: string }) => `${b.day}|${r.horseUserId}`)
    );
    expect(written).toHaveLength(8194);
    expect(new Set(written).size).toBe(8194);
    expect(t.publisher.pendingBatches()).toBe(0);
  });

  it('writes at most the per-tick bound and continues from the queue on the next flush', async () => {
    const t = publisherWith(
      Array.from({ length: 8192 }, (_, n) => row(n)),
      (p) => ack(p)
    );
    expect(await t.publisher.flush(2)).toMatchObject({ status: 'written', recorded: 2 });
    expect(t.sent).toHaveLength(2);
    const left = t.publisher.pendingBatches();
    expect(left).toBeGreaterThan(0);
    expect(await t.publisher.flush()).toMatchObject({ status: 'written', recorded: left });
    expect(t.publisher.pendingBatches()).toBe(0);
  });

  it('keeps the exact bytes of an unconfirmed batch and resends them: a landed write comes back as a replay', async () => {
    const t = publisherWith([row(1)], (p, call) =>
      call === 1
        ? new Error('aborted')
        : call === 2
          ? { data: null, error: { message: 'gateway', code: '502' } }
          : ack(p, 'replayed')
    );
    expect(await t.publisher.flush()).toMatchObject({ status: 'unconfirmed' });
    expect(await t.publisher.flush()).toMatchObject({ status: 'unconfirmed' });
    expect(t.publisher.pendingBatches()).toBe(1);
    expect(await t.publisher.flush()).toMatchObject({
      status: 'written',
      replayed: 1,
      recorded: 0,
    });
    expect(new Set(t.sent).size).toBe(1);
    // never put back into the aggregate: a fresh batch id would add it twice
    expect(t.restored).toEqual([]);
    expect(t.noted).toEqual([
      'per_horse_evidence_write_unconfirmed_seen',
      'per_horse_evidence_write_unconfirmed_seen',
    ]);
  });

  it('treats a malformed or mismatched acknowledgement as unconfirmed', async () => {
    const answers = [
      { data: null, error: null },
      { data: [], error: null },
      (p: string) => ({ ...ack(p), data: { ...ack(p).data, version: 2 } }),
      (p: string) => ({ ...ack(p), data: { ...ack(p).data, status: 'accepted' } }),
      (p: string) => ({ ...ack(p), data: { ...ack(p).data, batchId: 'other' } }),
      (p: string) => ({ ...ack(p), data: { ...ack(p).data, payloadSha256: 'f'.repeat(64) } }),
    ];
    const t = publisherWith([row(1)], (p, call) => {
      const answer = answers[call - 1];
      return answer === undefined ? ack(p) : typeof answer === 'function' ? answer(p) : answer;
    });
    for (let i = 0; i < answers.length; i++)
      expect(await t.publisher.flush(), `answer ${i}`).toMatchObject({ status: 'unconfirmed' });
    expect(await t.publisher.flush()).toMatchObject({ status: 'written', recorded: 1 });
    expect(new Set(t.sent).size).toBe(1);
  });

  it.each([
    'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD',
    'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER',
    'HORSE_UPGRADE_EVIDENCE_EXPIRED',
    'HORSE_UPGRADE_EVIDENCE_INVALID_BOUNDS',
    'HORSE_UPGRADE_EVIDENCE_INVALID_ROW',
    'HORSE_UPGRADE_EVIDENCE_DUPLICATE_ROW',
    'HORSE_UPGRADE_EVIDENCE_BATCH_COLLISION',
  ])(
    'drops and counts a batch the writer refuses by its bytes (%s) and writes the next one',
    async (reason) => {
      const held = [row(1, { day: '2026-11-13' }), row(2)];
      const t = publisherWith(held, (p, call) => (call === 1 ? refusal(reason) : ack(p)));
      expect(await t.publisher.flush()).toEqual({
        status: 'written',
        recorded: 1,
        replayed: 0,
        rejected: 1,
      });
      expect(t.batches().map((b) => b.day)).toEqual(['2026-11-13', '2026-11-14']);
      expect(t.noted).toEqual(['per_horse_evidence_batch_rejected_seen']);
      expect(t.restored).toEqual([]);
      expect(t.publisher.pendingBatches()).toBe(0);
    }
  );

  it('does not drop a batch for a refusal that is not one of the writer reasons, or not a P0001', async () => {
    const t = publisherWith([row(1)], (p, call) =>
      call === 1
        ? refusal('HORSE_UPGRADE_EVIDENCE_SOMETHING_ELSE')
        : call === 2
          ? refusal('HORSE_UPGRADE_EVIDENCE_INVALID_ROW', '57014')
          : ack(p)
    );
    expect(await t.publisher.flush()).toMatchObject({ status: 'unconfirmed', rejected: 0 });
    expect(await t.publisher.flush()).toMatchObject({ status: 'unconfirmed', rejected: 0 });
    expect(await t.publisher.flush()).toMatchObject({ status: 'written', recorded: 1 });
  });

  it('abandons a batch still unconfirmed at the attempt cap, counts it, and writes what came after', async () => {
    const held = [row(1)];
    let fail = true;
    const t = publisherWith(held, (p) => (fail ? new Error('down') : ack(p)));
    for (let i = 1; i < service.HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS; i++)
      expect((await t.publisher.flush()).status, `attempt ${i}`).toBe('unconfirmed');
    held.push(row(2));
    expect((await t.publisher.flush()).status).toBe('abandoned');
    expect(t.sent).toHaveLength(service.HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS);
    expect(new Set(t.sent).size).toBe(1);
    expect(t.noted.filter((n) => n === 'per_horse_evidence_batch_abandoned_seen')).toHaveLength(1);
    expect(t.publisher.pendingBatches()).toBe(0);
    fail = false;
    expect(await t.publisher.flush()).toMatchObject({ status: 'written', recorded: 1 });
    expect(
      t
        .batches()
        .at(-1)!
        .rows.map((r: { horseUserId: string }) => r.horseUserId)
    ).toEqual([horse(2)]);
  });

  it.each([['PGRST202'], ['42883']])(
    'gives every queued row back when the function is not installed (%s), and asks again next time',
    async (code) => {
      const held = [row(1, { day: '2026-11-13' }), row(2), row(3)];
      const original = held.map((r) => ({ ...r }));
      let installed = false;
      const t = publisherWith(held, (p) =>
        installed ? ack(p) : { data: null, error: { message: 'Could not find the function', code } }
      );
      expect(await t.publisher.flush()).toEqual({
        status: 'function_missing',
        recorded: 0,
        replayed: 0,
        rejected: 0,
      });
      // one question per flush, not one per batch; nothing retained outside the aggregate
      expect(t.sent).toHaveLength(1);
      expect(t.publisher.pendingBatches()).toBe(0);
      expect([...t.restored].sort((a, b) => a.horseUserId.localeCompare(b.horseUserId))).toEqual(
        original
      );
      expect(t.noted).toEqual(['per_horse_evidence_function_missing_seen']);
      held.push(...t.restored.splice(0));
      installed = true;
      expect(await t.publisher.flush()).toMatchObject({ status: 'written', recorded: 2 });
      expect(
        t
          .batches()
          .slice(1)
          .flatMap((b) => b.rows)
      ).toHaveLength(3);
    }
  );

  it('adds rows exactly once when an unconfirmed attempt landed and the next answer is function-missing', async () => {
    // The writer as the database behaves: a batch id it has stored is answered `replayed`.
    const stored = new Map<string, Array<{ horseUserId: string; decisions: number }>>();
    const answers = ['landed-then-timeout', 'function-missing'];
    const held = Array.from({ length: 5000 }, (_, n) => row(n)); // a head batch and never-sent rows behind it
    const t = publisherWith(held, (p) => {
      const batch = JSON.parse(p);
      const mode = answers.shift() ?? 'installed';
      if (mode === 'function-missing')
        return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
      const replay = stored.has(batch.batchId);
      if (!replay) stored.set(batch.batchId, batch.rows);
      // attempt 1: the write commits and its acknowledgement is lost to the client abort
      if (mode === 'landed-then-timeout') return new Error('aborted');
      return ack(p, replay ? 'replayed' : 'recorded');
    });
    expect(await t.publisher.flush()).toMatchObject({ status: 'unconfirmed' });
    expect(await t.publisher.flush()).toMatchObject({ status: 'function_missing' });
    // the head that may have landed keeps its bytes and id; only the never-sent batch went back
    expect(t.publisher.pendingBatches()).toBe(1);
    const headRows = JSON.parse(t.sent[0]!).rows.length;
    expect(t.restored).toHaveLength(5000 - headRows);
    expect(t.sent[1]).toBe(t.sent[0]);
    held.push(...t.restored.splice(0));
    // the function exists now: the head is answered `replayed`, the restored rows are written fresh
    expect(await t.publisher.flush()).toMatchObject({
      status: 'written',
      replayed: 1,
      recorded: 0,
    });
    expect(t.sent[2]).toBe(t.sent[0]);
    expect(await t.publisher.flush()).toMatchObject({
      status: 'written',
      replayed: 0,
      recorded: 1,
    });
    const added = [...stored.values()].flat();
    expect(added).toHaveLength(5000);
    expect(new Set(added.map((r) => r.horseUserId)).size).toBe(5000);
    expect(added.reduce((n, r) => n + r.decisions, 0)).toBe(5000 * 3);
    expect(t.publisher.pendingBatches()).toBe(0);
  });

  it('a retained head that only ever hears function-missing is still dropped at the attempt cap', async () => {
    let call = 0;
    const t = publisherWith([row(1)], () =>
      ++call === 1
        ? new Error('aborted')
        : { data: null, error: { message: 'Could not find the function', code: '42883' } }
    );
    expect((await t.publisher.flush()).status).toBe('unconfirmed');
    for (let attempt = 2; attempt < service.HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS; attempt++)
      expect((await t.publisher.flush()).status, `attempt ${attempt}`).toBe('function_missing');
    expect(t.publisher.pendingBatches()).toBe(1);
    expect((await t.publisher.flush()).status).toBe('abandoned');
    expect(t.publisher.pendingBatches()).toBe(0);
    expect(t.restored).toEqual([]);
    expect(new Set(t.sent).size).toBe(1);
    expect(t.sent).toHaveLength(service.HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS);
    expect(t.noted.filter((n) => n === 'per_horse_evidence_batch_abandoned_seen')).toHaveLength(1);
  });

  it('names exactly the refusals the migration raises, so the two cannot drift', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const migrations = join(process.cwd(), '..', 'supabase', 'migrations');
    const file = readdirSync(migrations).filter((f) =>
      f.endsWith('_per_horse_upgrade_evidence_daily.sql')
    );
    expect(file).toHaveLength(1);
    const sql = readFileSync(join(migrations, file[0]!), 'utf8');
    const raised = new Set(
      [...sql.matchAll(/RAISE EXCEPTION '(HORSE_UPGRADE_EVIDENCE_[A-Z_]+)'/g)].map((m) => m[1])
    );
    const source = readFileSync(
      join(process.cwd(), 'src/services/HorseUpgradeEvidenceFlush.ts'),
      'utf8'
    );
    const block = /const DETERMINISTIC_REFUSALS = new Set\(\[([\s\S]*?)\]\);/.exec(source);
    const dropped = new Set(
      [...block![1]!.matchAll(/'(HORSE_UPGRADE_EVIDENCE_[A-Z_]+)'/g)].map((m) => m[1])
    );
    expect(raised.size).toBe(7);
    expect([...dropped].sort()).toEqual([...raised].sort());
    // and the writer raises nothing else by name
    expect([...sql.matchAll(/RAISE EXCEPTION '([^']+)'/g)].every((m) => raised.has(m[1]))).toBe(
      true
    );
  });

  it('joins a second flush to the one in flight instead of sending twice', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = publisherWith([row(1)], (p) => gate.then(() => ack(p)));
    const first = t.publisher.flush();
    const second = t.publisher.flush();
    release();
    expect(await first).toBe(await second);
    expect(t.sent).toHaveLength(1);
  });
});

describe('the per-Horse upgrade evidence flush service', () => {
  const payloads = () => mocked.rpc.mock.calls.map((c) => JSON.parse(c[1].p_payload));
  const decide = (n: number) =>
    evidence.noteHorseUpgradeDecision(horse(n), 'nlh', 'cash', ['upgrade02_card_removal_scored']);

  it('arms the aggregate at start and writes it to the writer function every 300 seconds', async () => {
    decide(1);
    expect(evidence.drainHorseUpgradeEvidence()).toEqual([]); // not armed yet
    service.startHorseUpgradeEvidenceFlush();
    service.startHorseUpgradeEvidenceFlush(); // idempotent: one timer
    decide(1);
    decide(1);
    expect(service.HORSE_UPGRADE_EVIDENCE_FLUSH_MS).toBe(300_000);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(mocked.rpc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.rpc).toHaveBeenCalledTimes(1);
    expect(mocked.rpc.mock.calls[0]![0]).toBe('fn_horse_upgrade_evidence_flush');
    const [batch] = payloads();
    expect(batch.sourceRelease).toBe('c'.repeat(40));
    expect(batch.rows).toContainEqual({
      horseUserId: horse(1),
      gameVariant: 'nlh',
      lane: 'cash',
      upgradeId: 'upgrade_02_card_removal_blockers',
      decisions: 2,
      invoked: 2,
    });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocked.rpc).toHaveBeenCalledTimes(1); // nothing new: idle, no write
    expect(mocked.report).not.toHaveBeenCalled();
  });

  it('a manifest that throws cannot fail the start: evidence stays unarmed, reported once, counted each time', async () => {
    vi.resetModules();
    vi.doMock('../engine/HorseUpgradeActivationManifest.js', async (original) => ({
      ...(await original<typeof import('../engine/HorseUpgradeActivationManifest.js')>()),
      computeHorseUpgradeActivationManifest: () => {
        throw new Error('authority file unreadable');
      },
    }));
    try {
      const broken = await import('./HorseUpgradeEvidenceFlush.js');
      const brokenEvidence = await import('../engine/HorseUpgradeEvidence.js');
      const brokenTelemetry = await import('../engine/BrainTelemetry.js');
      brokenTelemetry.enableBrainTelemetry();
      // the worker's and the leader's service start call this unguarded: it must return normally
      expect(() => broken.startHorseUpgradeEvidenceFlush()).not.toThrow();
      expect(() => broken.startHorseUpgradeEvidenceFlush()).not.toThrow();
      expect(brokenEvidence.horseUpgradeEvidenceArmed()).toBe(false);
      brokenEvidence.noteHorseUpgradeDecision(horse(1), 'nlh', 'cash', [
        'upgrade02_card_removal_scored',
      ]);
      await vi.advanceTimersByTimeAsync(900_000);
      expect(mocked.rpc).not.toHaveBeenCalled();
      expect(brokenEvidence.drainHorseUpgradeEvidence()).toEqual([]);
      expect(mocked.report.mock.calls.map((c) => [String(c[0]), c[1]])).toEqual([
        ['Error: authority file unreadable', 'HorseUpgradeEvidenceFlush.arming_failed'],
      ]);
      expect(
        brokenTelemetry
          .drainFires()
          .find((f) => f.feature === 'per_horse_evidence_arming_failed_seen')?.fires
      ).toBe(2);
      await expect(broken.stopHorseUpgradeEvidenceFlush()).resolves.toBeUndefined();
    } finally {
      vi.doUnmock('../engine/HorseUpgradeActivationManifest.js');
    }
  });

  it('does not start, arm or write when brain telemetry is disabled', async () => {
    vi.stubEnv('BRAIN_TELEMETRY_ENABLED', 'false');
    service.startHorseUpgradeEvidenceFlush();
    decide(1);
    await vi.advanceTimersByTimeAsync(600_000);
    await service.stopHorseUpgradeEvidenceFlush();
    expect(mocked.rpc).not.toHaveBeenCalled();
    expect(evidence.drainHorseUpgradeEvidence()).toEqual([]);
  });

  it('writes the partial interval at shutdown and stops the timer', async () => {
    service.startHorseUpgradeEvidenceFlush();
    decide(1);
    await service.stopHorseUpgradeEvidenceFlush();
    expect(mocked.rpc).toHaveBeenCalledTimes(1);
    decide(2);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(mocked.rpc).toHaveBeenCalledTimes(1);
    expect(service.horseUpgradeEvidencePendingBatches()).toBe(0);
    expect(mocked.report).not.toHaveBeenCalled();
  });

  it('at shutdown writes the retained batch first, then the interval behind it', async () => {
    service.startHorseUpgradeEvidenceFlush();
    decide(1);
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () => Promise.reject(new Error('aborted')),
    }));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(service.horseUpgradeEvidencePendingBatches()).toBe(1);
    decide(2);
    await service.stopHorseUpgradeEvidenceFlush();
    const sent = mocked.rpc.mock.calls.map((c) => c[1].p_payload);
    expect(sent).toHaveLength(3);
    expect(sent[1]).toBe(sent[0]); // the same bytes, not a new batch
    expect(
      JSON.parse(sent[2]).rows.every((r: { horseUserId: string }) => r.horseUserId === horse(2))
    ).toBe(true);
    expect(service.horseUpgradeEvidencePendingBatches()).toBe(0);
  });

  it('never rejects the stop: an unconfirmed shutdown write is reported by count and not retried', async () => {
    service.startHorseUpgradeEvidenceFlush();
    decide(1);
    mocked.rpc.mockImplementation(() => ({
      abortSignal: () => Promise.reject(new Error('aborted')),
    }));
    await expect(service.stopHorseUpgradeEvidenceFlush()).resolves.toBeUndefined();
    expect(mocked.rpc).toHaveBeenCalledTimes(1);
    expect(mocked.report.mock.calls.map((c) => c[1])).toEqual([
      'HorseUpgradeEvidenceFlush.shutdown_unwritten',
    ]);
    expect(String(mocked.report.mock.calls[0]![0])).toContain('1 batch(es) unwritten at shutdown');
  });

  it('starts no shutdown write that could end past the budget', async () => {
    service.startHorseUpgradeEvidenceFlush();
    for (let n = 0; n < 600; n++)
      for (const variant of ['nlh', 'plo4'])
        evidence.noteHorseUpgradeDecision(horse(n), variant, 'cash', []);
    // each write takes 4 s and succeeds: 15 s of budget and a 5 s timeout admit starts at 0, 4 and 8 s only
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () =>
        new Promise((resolve) => setTimeout(() => resolve(ack(args.p_payload)), 4_000)),
    }));
    const stopped = service.stopHorseUpgradeEvidenceFlush();
    await vi.advanceTimersByTimeAsync(300_000);
    await stopped;
    expect(mocked.rpc).toHaveBeenCalledTimes(3);
    expect(service.horseUpgradeEvidencePendingBatches()).toBeGreaterThan(0);
    expect(mocked.report.mock.calls.map((c) => c[1])).toEqual([
      'HorseUpgradeEvidenceFlush.shutdown_unwritten',
    ]);
  });

  it('a slow tick in flight cannot carry the stop past its budget: the stop resolves within 15,000 ms', async () => {
    service.startHorseUpgradeEvidenceFlush();
    for (let n = 0; n < 600; n++)
      for (const variant of ['nlh', 'plo4'])
        evidence.noteHorseUpgradeDecision(horse(n), variant, 'cash', []);
    // every write is slow and succeeds (4,900 ms, just inside its 5,000 ms abort)
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () =>
        new Promise((resolve) => setTimeout(() => resolve(ack(args.p_payload)), 4_900)),
    }));
    await vi.advanceTimersByTimeAsync(300_000); // the tick starts its first write
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocked.rpc).toHaveBeenCalledTimes(1);
    const stopCalledAt = Date.now();
    let stoppedAt = 0;
    const stopped = service.stopHorseUpgradeEvidenceFlush().then(() => (stoppedAt = Date.now()));
    await vi.advanceTimersByTimeAsync(600_000);
    await stopped;
    // writes begin 0, 4,900 and 9,800 ms into the tick; the one that would begin at 14,700 ms (13,700 ms
    // after the stop) could end at 18,700 ms, past the budget, so it never starts
    expect(mocked.rpc).toHaveBeenCalledTimes(3);
    expect(stoppedAt - stopCalledAt).toBe(13_700);
    expect(stoppedAt - stopCalledAt).toBeLessThanOrEqual(
      service.HORSE_UPGRADE_EVIDENCE_SHUTDOWN_BUDGET_MS
    );
    expect(service.horseUpgradeEvidencePendingBatches()).toBeGreaterThan(0);
    expect(mocked.report.mock.calls.map((c) => c[1])).toEqual([
      'HorseUpgradeEvidenceFlush.shutdown_unwritten',
    ]);
  });

  it('a write that hangs is cut by its own 5,000 ms abort signal, which is what the budget counts on', async () => {
    service.startHorseUpgradeEvidenceFlush();
    decide(1);
    const timeouts: number[] = [];
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    await service.stopHorseUpgradeEvidenceFlush();
    spy.mockRestore();
    expect(timeouts).toEqual([5_000]);
  });

  it('degrades quietly when the function is not installed: counted every tick, reported once, held under the cap', async () => {
    mocked.rpc.mockImplementation(() => ({
      abortSignal: () =>
        Promise.resolve({
          data: null,
          error: { message: 'Could not find the function', code: 'PGRST202' },
        }),
    }));
    service.startHorseUpgradeEvidenceFlush();
    decide(1);
    for (let tick = 0; tick < 5; tick++) {
      decide(1);
      await vi.advanceTimersByTimeAsync(300_000);
    }
    expect(mocked.rpc).toHaveBeenCalledTimes(5);
    expect(mocked.report.mock.calls.map((c) => c[1])).toEqual([
      'HorseUpgradeEvidenceFlush.function_missing',
    ]);
    expect(fires().per_horse_evidence_function_missing_seen).toBe(5);
    expect(service.horseUpgradeEvidencePendingBatches()).toBe(0);
    // nothing was lost: once the function exists the whole held count is written
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () => Promise.resolve(ack(args.p_payload)),
    }));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(payloads().at(-1).rows).toContainEqual(
      expect.objectContaining({
        upgradeId: 'upgrade_02_card_removal_blockers',
        decisions: 6,
        invoked: 6,
      })
    );
  });

  it('reports a refused batch and its counter reaches the fleet counters', async () => {
    mocked.rpc.mockImplementation(() => ({
      abortSignal: () => Promise.resolve(refusal('HORSE_UPGRADE_EVIDENCE_INVALID_ROW')),
    }));
    service.startHorseUpgradeEvidenceFlush();
    decide(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocked.report.mock.calls.map((c) => c[1])).toEqual([
      'HorseUpgradeEvidenceFlush.rejected',
    ]);
    expect(fires().per_horse_evidence_batch_rejected_seen).toBe(1);
    expect(service.horseUpgradeEvidencePendingBatches()).toBe(0);
  });
});
