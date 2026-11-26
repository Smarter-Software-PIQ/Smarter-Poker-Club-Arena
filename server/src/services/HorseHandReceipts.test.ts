import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  reply: { error: null } as unknown,
  raise: vi.fn(),
  resolve: vi.fn(),
  throttled: vi.fn(),
}));

vi.mock('./supabase/client.js', () => ({
  supabase: {
    from: () => ({
      upsert: () => ({
        abortSignal: async () => {
          if (h.reply instanceof Error) throw h.reply;
          return h.reply;
        },
      }),
    }),
  },
}));
vi.mock('./errorReporter.js', () => ({ reportThrottled: h.throttled, reportError: vi.fn() }));

import {
  HORSE_HAND_RECEIPTS_ALERT,
  HORSE_HAND_RECEIPTS_ALERT_COMPONENT,
  __resetHorseHandReceiptsTally,
  setHorseHandReceiptsAlertSink,
  horseHandReceiptFailureText,
  horseHandReceiptsSnapshot,
  writeHorseHandReceipts,
} from './HorseHandReceipts.js';

const HAND = '11111111-2222-3333-4444-555555555555';
const COUNTS = { 'holdemTournamentAllInCallIsPriced:fold>all_in': 2 };

beforeEach(() => {
  __resetHorseHandReceiptsTally();
  setHorseHandReceiptsAlertSink({ raise: h.raise, resolve: h.resolve });
  h.reply = { error: null };
  h.raise.mockClear();
  h.resolve.mockClear();
  h.throttled.mockClear();
});

describe('horseHandReceiptsSnapshot', () => {
  it('starts at zero with no failure', () => {
    expect(horseHandReceiptsSnapshot()).toEqual({
      handsAttempted: 0,
      rowsWritten: 0,
      writesFailed: 0,
      lastFailureAt: null,
      lastError: null,
      lastWrittenAt: null,
    });
  });

  it('counts a written hand and its rows, and a hand with nothing to write not at all', async () => {
    expect(await writeHorseHandReceipts(HAND, COUNTS)).toBe(1);
    expect(await writeHorseHandReceipts(HAND, {})).toBe(0);
    expect(await writeHorseHandReceipts(HAND, null)).toBe(0);
    const s = horseHandReceiptsSnapshot();
    expect(s).toMatchObject({
      handsAttempted: 1,
      rowsWritten: 1,
      writesFailed: 0,
      lastError: null,
    });
    expect(s.lastWrittenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is a copy: changing it changes nothing', async () => {
    const s = horseHandReceiptsSnapshot();
    s.writesFailed = 99;
    expect(horseHandReceiptsSnapshot().writesFailed).toBe(0);
  });

  it('records a failure with its time and closed class', async () => {
    h.reply = {
      error: { code: '42P01', message: 'relation "ca_horse_hand_receipts" does not exist' },
    };
    expect(await writeHorseHandReceipts(HAND, COUNTS)).toBe(0);
    const s = horseHandReceiptsSnapshot();
    expect(s).toMatchObject({
      handsAttempted: 1,
      rowsWritten: 0,
      writesFailed: 1,
      lastError: 'table_missing:42P01',
    });
    expect(s.lastFailureAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('the alert', () => {
  it('raises once on the first failure, not on every failure, and resolves on the next write', async () => {
    h.reply = new Error('fetch failed');
    await writeHorseHandReceipts(HAND, COUNTS);
    await writeHorseHandReceipts(HAND, COUNTS);
    expect(h.raise).toHaveBeenCalledTimes(1);
    expect(h.raise.mock.calls[0][0]).toMatchObject({
      alertname: HORSE_HAND_RECEIPTS_ALERT,
      component: HORSE_HAND_RECEIPTS_ALERT_COMPONENT,
      severity: 'warning',
      labels: { failure: 'network' },
    });
    expect(h.resolve).not.toHaveBeenCalled();
    h.reply = { error: null };
    await writeHorseHandReceipts(HAND, COUNTS);
    await writeHorseHandReceipts(HAND, COUNTS);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.resolve.mock.calls[0].slice(0, 2)).toEqual([
      HORSE_HAND_RECEIPTS_ALERT,
      HORSE_HAND_RECEIPTS_ALERT_COMPONENT,
    ]);
    // a new failure after recovery raises again
    h.reply = new Error('fetch failed');
    await writeHorseHandReceipts(HAND, COUNTS);
    expect(h.raise).toHaveBeenCalledTimes(2);
    expect(horseHandReceiptsSnapshot()).toMatchObject({
      handsAttempted: 5,
      rowsWritten: 2,
      writesFailed: 3,
    });
  });

  it('the first success of a process closes an alert a previous process left open', async () => {
    await writeHorseHandReceipts(HAND, COUNTS);
    await writeHorseHandReceipts(HAND, COUNTS);
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it('an alert path that throws or rejects never reaches the writer', async () => {
    h.raise.mockImplementationOnce(() => {
      throw new Error('journal broken');
    });
    h.reply = new Error('fetch failed');
    await expect(writeHorseHandReceipts(HAND, COUNTS)).resolves.toBe(0);
    h.resolve.mockImplementationOnce(() => {
      throw new Error('journal broken');
    });
    h.reply = { error: null };
    await expect(writeHorseHandReceipts(HAND, COUNTS)).resolves.toBe(1);
  });
});

describe('horseHandReceiptFailureText', () => {
  it.each([
    [
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
      'timeout',
    ],
    [{ code: '42P01', message: 'relation does not exist' }, 'table_missing:42P01'],
    [
      {
        code: 'PGRST205',
        message: "Could not find the table 'public.ca_horse_hand_receipts' in the schema cache",
      },
      'table_missing:PGRST205',
    ],
    [{ code: '23514', message: 'new row violates check constraint' }, 'refused:23514'],
    [new Error('fetch failed'), 'network'],
    [new Error('something else'), 'error'],
    [null, 'error'],
    [undefined, 'error'],
    ['a bare string', 'error'],
  ])('%s -> %s', (error, text) => {
    expect(horseHandReceiptFailureText(error)).toBe(text);
  });

  it('never copies a code that is not a database code, nor any part of the message', () => {
    expect(horseHandReceiptFailureText({ code: 'AsKd7', message: 'AsKd' })).toBe('error');
    expect(horseHandReceiptFailureText({ code: '12345678-1234', message: 'x' })).toBe('error');
    const t = horseHandReceiptFailureText({
      code: '23514',
      message: 'Failing row contains (11111111-2222-3333-4444-555555555555, AsKd, eyJhbGciOi)',
    });
    expect(t).toBe('refused:23514');
  });
});
