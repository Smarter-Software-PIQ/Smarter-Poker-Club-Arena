import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/utils/clientErrorSink', () => ({ signedInAccessToken: () => null }));

import {
  JOIN_TIMEOUT_MS,
  LIGHTNING_JOIN_MARKS,
  __lightningJoinTimingForTests as t,
  abandonUnseatedLightningJoin,
  bindLightningJoinRoom,
  confirmLightningJoin,
  endLightningJoin,
  lightningJoinReasonCode,
  markLightningJoin,
  markLightningJoinRejoined,
  markLightningJoinRoom,
  startLightningJoin,
  type LightningJoinTimingPayload,
} from '../../src/lightning/lightningJoinTiming';

/**
 * LIGHTNING JOINS ARE TIMED FROM THE CLICK TO THE PAINTED CARDS (2026-11-10).
 * One join, one report, its marks on one clock, and nothing for a join that
 * never bought a seat.
 */
const CLUSTER = '40000000-0000-4000-8000-000000000001';
const ROOM = '40000000-0000-4000-8000-000000000002';
const OTHER_ROOM = '40000000-0000-4000-8000-000000000003';

let sent: LightningJoinTimingPayload[];
let keepalives: boolean[];
let clock: number;

beforeEach(() => {
  sent = [];
  keepalives = [];
  clock = 1_000;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  t.setSender((p, keepalive) => {
    sent.push(p);
    keepalives.push(keepalive);
  });
});
afterEach(() => {
  t.reset();
  t.setSender(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const at = (ms: number) => {
  clock = 1_000 + ms;
};

describe('a timed Lightning join', () => {
  it('reports one buy-in join, click to painted cards, with every mark on one clock', () => {
    startLightningJoin(CLUSTER, 'buy_in');
    at(210);
    markLightningJoin('rejoin_checked');
    at(640);
    markLightningJoin('dialog_shown');
    at(3640);
    markLightningJoin('confirm');
    at(3900);
    markLightningJoin('hold_answered');
    at(4400);
    markLightningJoin('purchase_answered');
    at(4600);
    markLightningJoin('seated');
    bindLightningJoinRoom(ROOM);
    at(4700);
    markLightningJoinRoom(ROOM, 'room_open');
    // Another room's events are someone else's join.
    markLightningJoinRoom(OTHER_ROOM, 'first_hand');
    at(5100);
    markLightningJoinRoom(ROOM, 'socket_connected');
    markLightningJoinRoom(ROOM, 'socket_connected');
    at(5300);
    markLightningJoinRoom(ROOM, 'first_snapshot');
    at(8300);
    markLightningJoinRoom(ROOM, 'first_hand');
    expect(sent).toHaveLength(0);
    at(8380);
    markLightningJoinRoom(ROOM, 'cards_painted');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'buy_in',
      outcome: 'painted',
      reason: null,
      cluster_id: CLUSTER,
      hidden: false,
    });
    expect(sent[0].marks).toEqual({
      click: 0,
      rejoin_checked: 210,
      dialog_shown: 640,
      confirm: 3640,
      hold_answered: 3900,
      purchase_answered: 4400,
      seated: 4600,
      room_open: 4700,
      socket_connected: 5100,
      first_snapshot: 5300,
      first_hand: 8300,
      cards_painted: 8380,
    });
    // Sent once: a later hand of the same room adds nothing.
    markLightningJoinRoom(ROOM, 'cards_painted');
    expect(sent).toHaveLength(1);
    expect(t.active()).toBeNull();
  });

  it('only names marks the database accepts', () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../supabase/migrations/20261110225742_every_lightning_join_ending_is_recorded_with_its_leg_and_rea.sql'
      ),
      'utf8'
    );
    for (const mark of LIGHTNING_JOIN_MARKS) expect(migration).toContain(`'${mark}'`);
  });

  it('lets an unbound join be claimed by the first room, but only after a seat was bought', () => {
    startLightningJoin(CLUSTER);
    markLightningJoin('confirm');
    // No seat yet: a room cannot claim it.
    markLightningJoinRoom(ROOM, 'room_open');
    expect(t.active()?.room).toBeNull();
    markLightningJoin('seated');
    at(500);
    markLightningJoinRoom(ROOM, 'room_open');
    markLightningJoinRoom(OTHER_ROOM, 'room_open');
    expect(t.active()?.room).toBe(ROOM);
    expect(t.active()?.marks.room_open).toBe(500);
  });

  it('records a rejoin as one', () => {
    startLightningJoin(CLUSTER);
    at(150);
    markLightningJoin('rejoin_checked');
    markLightningJoinRejoined(ROOM);
    at(900);
    markLightningJoinRoom(ROOM, 'cards_painted');
    expect(sent[0]).toMatchObject({ kind: 'rejoin', outcome: 'painted' });
    expect(sent[0].marks).toMatchObject({
      click: 0,
      rejoin_checked: 150,
      seated: 150,
      cards_painted: 900,
    });
  });

  it('reports a refused, failed or abandoned join once, with its reason', () => {
    startLightningJoin(CLUSTER);
    endLightningJoin('refused', 'SIGN_IN_REQUIRED');
    startLightningJoin(CLUSTER);
    at(300);
    markLightningJoin('dialog_shown');
    abandonUnseatedLightningJoin('DIALOG_CLOSED');
    startLightningJoin(CLUSTER);
    markLightningJoin('confirm');
    endLightningJoin('failed', 'BUYIN_UNCONFIRMED');
    // Nothing more once it ended: no timer fires afterwards.
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    endLightningJoin('failed', 'LATE');
    expect(sent.map((p) => `${p.outcome}:${p.reason}`)).toEqual([
      'refused:SIGN_IN_REQUIRED',
      'abandoned:DIALOG_CLOSED',
      'failed:BUYIN_UNCONFIRMED',
    ]);
    expect(sent[1].marks).toEqual({ click: 0, dialog_shown: 300 });
  });

  it('leaves a confirmed or seated join running when the question closes or the page is left', () => {
    startLightningJoin(CLUSTER);
    markLightningJoin('confirm');
    abandonUnseatedLightningJoin('DIALOG_CLOSED');
    expect(t.active()).not.toBeNull();
    startLightningJoin(CLUSTER);
    markLightningJoinRejoined(ROOM);
    abandonUnseatedLightningJoin('LEFT_PAGE');
    expect(t.active()?.room).toBe(ROOM);
    // The second press replaced the first, which ends as abandoned.
    expect(sent.map((p) => `${p.outcome}:${p.reason}`)).toEqual(['abandoned:REPLACED']);
  });

  it('ends an unconfirmed join as abandoned and a confirmed one as a timeout', () => {
    startLightningJoin(CLUSTER);
    markLightningJoin('dialog_shown');
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    startLightningJoin(CLUSTER);
    markLightningJoin('confirm');
    markLightningJoin('seated');
    bindLightningJoinRoom(ROOM);
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    markLightningJoinRoom(ROOM, 'cards_painted');
    expect(sent.map((p) => `${p.outcome}:${p.reason}`)).toEqual([
      'abandoned:QUESTION_IDLE',
      'timeout:NO_PAINT',
    ]);
  });

  it('sends a join the closing page leaves behind with keepalive', () => {
    startLightningJoin(CLUSTER);
    markLightningJoin('seated');
    window.dispatchEvent(new Event('pagehide'));
    expect(sent.map((p) => `${p.outcome}:${p.reason}`)).toEqual(['abandoned:PAGE_CLOSED']);
    expect(keepalives).toEqual([true]);
  });

  it('keeps only a door code as a reason, never text, ids or amounts', () => {
    expect(lightningJoinReasonCode(new Error('PLATFORM_FROZEN'), 'X_FALLBACK')).toBe(
      'PLATFORM_FROZEN'
    );
    expect(lightningJoinReasonCode({ message: 'INSUFFICIENT_CHIPS:40' }, 'X_FALLBACK')).toBe(
      'INSUFFICIENT_CHIPS'
    );
    expect(
      lightningJoinReasonCode({ message: 'GAME_BARRED:120', code: '23514' }, 'X_FALLBACK')
    ).toBe('GAME_BARRED');
    expect(
      lightningJoinReasonCode(
        { message: 'duplicate key value violates', code: '23505' },
        'X_FALLBACK'
      )
    ).toBe('PG_23505');
    expect(lightningJoinReasonCode(new Error('Player dan@x.com has 40 chips'), 'X_FALLBACK')).toBe(
      'X_FALLBACK'
    );
    expect(lightningJoinReasonCode(null, 'X_FALLBACK')).toBe('X_FALLBACK');
  });

  it('flags a join whose tab was hidden: its paint waited for the player', () => {
    startLightningJoin(CLUSTER);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    hidden.mockRestore();
    markLightningJoin('seated');
    markLightningJoinRoom(ROOM, 'cards_painted');
    expect(sent[0].hidden).toBe(true);
  });
});

describe('a Confirm after a refusal is its own attempt', () => {
  const firstAttempt = () => {
    startLightningJoin(CLUSTER, 'buy_in');
    at(200);
    markLightningJoin('rejoin_checked');
    at(600);
    markLightningJoin('dialog_shown');
    at(3600);
    confirmLightningJoin(CLUSTER);
    at(3900);
    markLightningJoin('hold_answered');
    at(4400);
    markLightningJoin('purchase_answered');
    endLightningJoin('refused', 'INSUFFICIENT_CHIPS');
  };

  it("a first Confirm is the running join's confirm mark, not a new attempt", () => {
    startLightningJoin(CLUSTER, 'buy_in');
    at(3600);
    confirmLightningJoin(CLUSTER);
    expect(sent).toHaveLength(0);
    expect(t.active()?.marks).toEqual({ click: 0, confirm: 3600 });
  });

  it('refuse, then retry and succeed: two reports, the retry timed from its own press', () => {
    firstAttempt();
    expect(sent).toHaveLength(1);
    const first = JSON.parse(JSON.stringify(sent[0]));
    at(9000);
    confirmLightningJoin(CLUSTER);
    at(9250);
    markLightningJoin('hold_answered');
    at(9700);
    markLightningJoin('purchase_answered');
    at(9900);
    markLightningJoin('seated');
    bindLightningJoinRoom(ROOM);
    at(10000);
    markLightningJoinRoom(ROOM, 'room_open');
    at(12500);
    markLightningJoinRoom(ROOM, 'cards_painted');
    expect(sent).toHaveLength(2);
    // The refused attempt's report is exactly as it was sent, once.
    expect(sent[0]).toEqual(first);
    expect(sent[0]).toMatchObject({ outcome: 'refused', reason: 'INSUFFICIENT_CHIPS' });
    expect(sent[0].marks).toEqual({
      click: 0,
      rejoin_checked: 200,
      dialog_shown: 600,
      confirm: 3600,
      hold_answered: 3900,
      purchase_answered: 4400,
    });
    // The retry: its zero is the retry press, and it has no click.
    expect(sent[1]).toMatchObject({ kind: 'buy_in', outcome: 'painted', reason: null });
    expect(sent[1].marks).toEqual({
      confirm: 0,
      hold_answered: 250,
      purchase_answered: 700,
      seated: 900,
      room_open: 1000,
      cards_painted: 3500,
    });
  });

  it('refuse, then retry and be refused again: one report per attempt', () => {
    firstAttempt();
    at(9000);
    confirmLightningJoin(CLUSTER);
    at(9300);
    markLightningJoin('hold_answered');
    endLightningJoin('refused', 'SEAT_TAKEN');
    expect(sent.map((p) => [p.outcome, p.reason])).toEqual([
      ['refused', 'INSUFFICIENT_CHIPS'],
      ['refused', 'SEAT_TAKEN'],
    ]);
    expect(sent[1].marks).toEqual({ confirm: 0, hold_answered: 300 });
    expect(t.active()).toBeNull();
  });

  it('refuse, then close the question: the refusal stays the only report', () => {
    firstAttempt();
    at(9000);
    abandonUnseatedLightningJoin('DIALOG_CLOSED');
    abandonUnseatedLightningJoin('LEFT_PAGE');
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ outcome: 'refused', reason: 'INSUFFICIENT_CHIPS' });
  });

  it('a retry that never paints ends once, as a timeout after its own press', () => {
    firstAttempt();
    at(9000);
    confirmLightningJoin(CLUSTER);
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ outcome: 'timeout', reason: 'NO_PAINT' });
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    expect(sent).toHaveLength(2);
  });
});

describe('the join paths are wired', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  it('marks the entry door, the buy-in doors and the room', () => {
    const entry = src('src/pages/LightningEntryPage.tsx');
    expect(entry).toContain("startLightningJoin(clusterId, 'buy_in')");
    expect(entry).toContain("markLightningJoin('dialog_shown')");
    expect(entry).toContain('confirmLightningJoin(clusterId)');
    expect(entry).toContain('mark: markLightningJoin');
    expect(entry).toContain('warmLightningRoom()');
    expect(entry).toContain("endLightningJoin('refused', 'SIGN_IN_REQUIRED')");
    expect(entry).toContain("abandonUnseatedLightningJoin('DIALOG_CLOSED')");
    expect(entry).toContain("abandonUnseatedLightningJoin('LEFT_PAGE')");
    expect(entry).toContain("result.kind === 'rejected' ? 'refused' : 'failed', result.code");
    const buy = src('src/lightning/lightningJoinBuyIn.ts');
    expect(buy).toContain("args.mark?.('hold_answered')");
    expect(buy).toContain("args.mark?.('purchase_answered')");
    const page = src('src/pages/TablePage.tsx');
    expect(page).toContain("markLightningJoinRoom(tableId, 'cards_painted')");
    expect(page).toContain('useLightningJoinTiming({');
  });
});
