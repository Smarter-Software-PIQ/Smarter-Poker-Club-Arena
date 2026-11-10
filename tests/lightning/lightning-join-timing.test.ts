import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import {
  JOIN_TIMEOUT_MS,
  LIGHTNING_JOIN_MARKS,
  __lightningJoinTimingForTests as t,
  bindLightningJoinRoom,
  cancelLightningJoin,
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
let clock: number;

beforeEach(() => {
  sent = [];
  clock = 1_000;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  t.setSender((p) => sent.push(p));
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
        '../../supabase/migrations/20261110213810_lightning_joins_are_timed_from_the_click_to_the_painted_card.sql'
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

  it('sends nothing for a refused, abandoned or replaced join', () => {
    startLightningJoin(CLUSTER);
    markLightningJoin('confirm');
    cancelLightningJoin();
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    // Abandoned on the question: no timeout either.
    startLightningJoin(CLUSTER);
    markLightningJoin('dialog_shown');
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    // A new press replaces an unsent join and its timer.
    startLightningJoin(CLUSTER);
    markLightningJoin('confirm');
    startLightningJoin(CLUSTER);
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    expect(sent).toHaveLength(0);
  });

  it('reports a confirmed join that never paints, once, as a timeout', () => {
    startLightningJoin(CLUSTER);
    markLightningJoin('confirm');
    markLightningJoin('seated');
    bindLightningJoinRoom(ROOM);
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ outcome: 'timeout' });
    markLightningJoinRoom(ROOM, 'cards_painted');
    expect(sent).toHaveLength(1);
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

describe('the join paths are wired', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  it('marks the entry door, the buy-in doors and the room', () => {
    const entry = src('src/pages/LightningEntryPage.tsx');
    expect(entry).toContain("startLightningJoin(clusterId, 'buy_in')");
    expect(entry).toContain("markLightningJoin('dialog_shown')");
    expect(entry).toContain("markLightningJoin('confirm')");
    expect(entry).toContain('mark: markLightningJoin');
    expect(entry).toContain('warmLightningRoom()');
    const buy = src('src/lightning/lightningJoinBuyIn.ts');
    expect(buy).toContain("args.mark?.('hold_answered')");
    expect(buy).toContain("args.mark?.('purchase_answered')");
    const page = src('src/pages/TablePage.tsx');
    expect(page).toContain("markLightningJoinRoom(tableId, 'cards_painted')");
    expect(page).toContain('useLightningJoinTiming({');
  });
});
