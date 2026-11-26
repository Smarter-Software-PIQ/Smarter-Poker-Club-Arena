/**
 * ===========================================================================
 *  LAW: A LOST HORSE OPTION RECEIPT IS VISIBLE FROM OUTSIDE THE ENGINE
 * ===========================================================================
 *
 * Per-hand option receipts (#12032) are written fire-and-forget after the
 * hand is saved (server/src/services/HorseHandReceipts.ts). A failed write
 * used to be one throttled line in the engine console, which nobody can read
 * without a shell on the engine; on 2026-11-26 the coordinator had to rule a
 * silent failure out by counting hands. This law pins:
 *
 *   1. A FAILED WRITE IS COUNTED AND NEVER THROWS. A refused, thrown or
 *      timed-out write increments `writesFailed`, records the time and a
 *      failure class, and resolves to 0; the hand save never sees it.
 *   2. IT REACHES PRODUCTION ALERTS THROUGH THE EXISTING PATH. The first
 *      failure raises HorseHandReceiptsNotWritten with raiseEngineAlert
 *      (engineAlerts.ts, the engine's one alert mouth), once, and the next
 *      successful write resolves it. index.ts injects that call
 *      (setHorseHandReceiptsAlertSink); the writer is on the Horse decision
 *      closure and imports no alert module.
 *   3. THE PUBLIC HEALTH PAYLOAD CARRIES THE TALLY. GameServer's /health
 *      object publishes `horseHandReceipts: horseHandReceiptsSnapshot()`.
 *   4. THE TALLY TEXT CAN NEVER CONTAIN A CARD, A USER ID OR A TOKEN. The
 *      failure text is a fixed word and at most a database error code; the
 *      database's message (which can quote a failing row) is never copied.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const h = vi.hoisted(() => ({
  reply: { error: null } as unknown,
  raise: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('../server/src/services/supabase/client.js', () => ({
  supabase: {
    from: () => ({
      upsert: () => ({
        abortSignal: async () => {
          if (h.reply === 'hang') return new Promise(() => undefined);
          if (h.reply instanceof Error) throw h.reply;
          return h.reply;
        },
      }),
    }),
  },
}));
vi.mock('../server/src/services/errorReporter.js', () => ({
  reportThrottled: vi.fn(),
  reportError: vi.fn(),
}));

import {
  HORSE_HAND_RECEIPTS_ALERT,
  HORSE_HAND_RECEIPT_FAILURE_KINDS,
  __resetHorseHandReceiptsTally,
  setHorseHandReceiptsAlertSink,
  horseHandReceiptFailureText,
  horseHandReceiptsSnapshot,
  writeHorseHandReceipts,
} from '../server/src/services/HorseHandReceipts';

const ROOT = resolve(__dirname, '..');
const HAND = '11111111-2222-3333-4444-555555555555';
const COUNTS = { 'cashDefenceTrimColdCalls:call>fold': 1 };
/** Rank then lower-case suit, the platform's card text (As, Td, 9c). */
const CARD = /[2-9TJQKA][shdc]/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

beforeEach(() => {
  __resetHorseHandReceiptsTally();
  setHorseHandReceiptsAlertSink({ raise: h.raise, resolve: h.resolve });
  h.reply = { error: null };
  h.raise.mockClear();
  h.resolve.mockClear();
});

describe('LAW: a lost Horse option receipt is visible from outside the engine', () => {
  it.each([
    ['refused', { error: { code: '23514', message: 'Failing row contains (AsKd)' } }],
    ['thrown', new Error('fetch failed')],
    ['timed out', Object.assign(new Error('aborted'), { name: 'TimeoutError' })],
  ])(
    'a %s write increments the failure tally, raises the alert once and never throws',
    async (_n, reply) => {
      h.reply = reply;
      await expect(writeHorseHandReceipts(HAND, COUNTS)).resolves.toBe(0);
      await expect(writeHorseHandReceipts(HAND, COUNTS)).resolves.toBe(0);
      const s = horseHandReceiptsSnapshot();
      expect(s.writesFailed).toBe(2);
      expect(s.rowsWritten).toBe(0);
      expect(s.lastFailureAt).not.toBeNull();
      expect(h.raise).toHaveBeenCalledTimes(1);
      expect(h.raise.mock.calls[0][0]).toMatchObject({ alertname: HORSE_HAND_RECEIPTS_ALERT });
      h.reply = { error: null };
      await expect(writeHorseHandReceipts(HAND, COUNTS)).resolves.toBe(1);
      expect(h.resolve).toHaveBeenCalledTimes(1);
    }
  );

  it('the main process wires the alert to raiseEngineAlert, and the writer imports no alert module', () => {
    const src = readFileSync(resolve(ROOT, 'server/src/services/HorseHandReceipts.ts'), 'utf8');
    // Type-only: HorseHandReceipts.ts is on the Horse decision closure, which holds no engine alert file.
    expect(src).toMatch(/import type \{ EngineAlertInput \} from '\.\/engineAlerts\.js';/);
    expect(src).not.toMatch(/^import \{[^}]*\} from '\.\/engineAlerts\.js';/m);
    expect(src).not.toMatch(/\bfetch\(|api\/alerts|webhook/i);
    const index = readFileSync(resolve(ROOT, 'server/src/index.ts'), 'utf8');
    expect(index).toMatch(
      /import \{ setHorseHandReceiptsAlertSink \} from '\.\/services\/HorseHandReceipts\.js';/
    );
    const at = index.indexOf('setHorseHandReceiptsAlertSink({');
    expect(at).toBeGreaterThan(0);
    const wiring = index.slice(at, at + 300);
    expect(wiring).toMatch(/raise: \(alert\) => void raiseEngineAlert\(alert\)/);
    expect(wiring).toMatch(/void resolveEngineAlert\(alertname, component, summary\)/);
  });

  it('with no alert sink (a worker thread) a failure is still counted and never throws', async () => {
    setHorseHandReceiptsAlertSink(null);
    h.reply = new Error('fetch failed');
    await expect(writeHorseHandReceipts(HAND, COUNTS)).resolves.toBe(0);
    expect(horseHandReceiptsSnapshot().writesFailed).toBe(1);
  });

  it('the public health payload carries the snapshot', () => {
    const gs = readFileSync(resolve(ROOT, 'server/src/GameServer.ts'), 'utf8');
    expect(gs).toMatch(
      /import \{ horseHandReceiptsSnapshot \} from '\.\/services\/HorseHandReceipts\.js';/
    );
    const at = gs.indexOf('horseHandReceipts: horseHandReceiptsSnapshot(),');
    expect(at).toBeGreaterThan(0);
    // It sits in the same object as the other published Horse health fields.
    const near = gs.slice(at - 1500, at + 1500);
    expect(near).toContain('horseWatchcounters: peekBrainWatchcounters(),');
    expect(near).toContain('horseUpgradeManifest: computeHorseUpgradeActivationManifest(),');
  });

  it('the snapshot is plain numbers, ISO times and the closed failure text', async () => {
    h.reply = { error: { code: '42P01', message: 'relation does not exist' } };
    await writeHorseHandReceipts(HAND, COUNTS);
    const s = horseHandReceiptsSnapshot();
    expect(Object.keys(s).sort()).toEqual(
      [
        'handsAttempted',
        'lastError',
        'lastFailureAt',
        'lastWrittenAt',
        'rowsWritten',
        'writesFailed',
      ].sort()
    );
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('the tally text can never contain a card, a user id or a token', async () => {
    const hostile = [
      'AsKd Th9c on board 2s3h4d',
      `user ${HAND} token eyJhbGciOiJIUzI1NiJ9.payload.sig`,
      'Failing row contains (AsKd, 11111111-2222-3333-4444-555555555555)',
    ];
    const codes = [undefined, '23514', '42P01', 'PGRST205', 'AsKd1', 'AS KD', HAND, 'eyJhb'];
    const names = [undefined, 'Error', 'TimeoutError', 'AbortError'];
    for (const message of hostile)
      for (const code of codes)
        for (const name of names) {
          const text = horseHandReceiptFailureText({ message, code, name });
          const [kind, dbCode] = text.split(':');
          expect(HORSE_HAND_RECEIPT_FAILURE_KINDS as readonly string[]).toContain(kind);
          if (dbCode !== undefined) expect(dbCode).toMatch(/^(?:\d{2}[0-9A-Z]{3}|PGRST\d{3})$/);
          expect(text).not.toMatch(CARD);
          expect(text).not.toMatch(UUID);
          expect(text).not.toContain('eyJ');
          h.reply = { error: { message, code, name } };
          await writeHorseHandReceipts(HAND, COUNTS);
          const snap = JSON.stringify(horseHandReceiptsSnapshot());
          expect(snap).not.toMatch(CARD);
          expect(snap).not.toMatch(UUID);
          expect(snap).not.toContain('eyJ');
        }
  });
});
