/**
 * THE LIGHTNING PRE-ACTION RECORD (2026-11-10). Hand 58348210's big-blind
 * Check/Fold failure could not be proven because nothing recorded what the
 * engine did with a pre-action. These tests pin that every outcome at the
 * pre-action door leaves its row, including both big-blind cases Dan hit, and
 * that the recorder can never reach into the action path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the Lightning host fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the Lightning host fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

const { mulberry32 } = await import('../engine/HandFuzzer.js');
const kit = await import('../testing/lightningHostTestKit.js');
const { buildHost, formedHand, flush, playOut, uid } = kit;
const rec = await import('./LightningPreActionRecord.js');
type Ev = import('./LightningPreActionRecord.js').LightningPreActionEvent;

afterEach(() => {
  vi.restoreAllMocks();
});

const passive = (_u: string, legal: string[]) => (legal.includes('check') ? 'check' : 'call');

function recorded(seed: number, n = 4) {
  const formed = formedHand(n, seed);
  const events: Ev[] = [];
  const t = buildHost(formed, Array(n).fill(100), {
    deps: { recordPreAction: (e) => events.push(e) },
  });
  const mine = (playerId: string) =>
    events.filter((e) => e.playerId === playerId).map((e) => `${e.kind}:${e.action}:${e.detail}`);
  return { formed, t, events, mine };
}

function firstToAct(t: ReturnType<typeof buildHost>) {
  const st = t.host.peekState()!;
  return st.players.find((p) => p.seat === st.currentPlayerSeat)!;
}

describe('the pre-action record: one row for every outcome at the door', () => {
  it('big blind: an armed Check/Fold is set, then released by the raise that prices it', async () => {
    const { formed, t, events, mine } = recorded(5100);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    const set = events.find((e) => e.playerId === bb && e.kind === 'set')!;
    expect(set).toMatchObject({ action: 'auto_check_fold', handId: formed.handId, toCall: 0 });
    expect(set.stage).toBe('preflop');
    expect(t.host.handlePlayerAction(firstToAct(t).user_id, 'raise', 6).success).toBe(true);
    await flush();
    expect(mine(bb)).toEqual([
      'set:auto_check_fold:null',
      'released:auto_check_fold:armed_check_fold_priced_by_bet',
    ]);
    const released = events.find((e) => e.playerId === bb && e.kind === 'released')!;
    expect(released.toCall).toBeGreaterThan(0);
    await playOut(t.host, mulberry32(5100), passive);
    await flush();
    // Its public fold, in turn order, closes the record.
    expect(mine(bb)).toEqual([
      'set:auto_check_fold:null',
      'released:auto_check_fold:armed_check_fold_priced_by_bet',
      'executed:fast_fold:held_fold_published',
    ]);
  });

  it('big blind: an auto_fold on a free seat is held, released by the raise, then published at the turn', async () => {
    const { formed, t, mine } = recorded(5101);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_fold', undefined, formed.handId).success).toBe(true);
    expect(mine(bb)).toEqual(['pending:auto_fold:held_until_turn']);
    expect(t.host.handlePlayerAction(firstToAct(t).user_id, 'raise', 6).success).toBe(true);
    await flush();
    expect(mine(bb)).toEqual([
      'pending:auto_fold:held_until_turn',
      'released:fast_fold:held_fold_priced_by_bet',
    ]);
    await playOut(t.host, mulberry32(5101), passive);
    await flush();
    expect(mine(bb)).toEqual([
      'pending:auto_fold:held_until_turn',
      'released:fast_fold:held_fold_priced_by_bet',
      'executed:fast_fold:held_fold_published',
    ]);
  });

  it('small blind: a Check/Fold armed while owing chips is released at the arm', async () => {
    const { formed, t, mine } = recorded(5102);
    await t.host.start();
    await flush();
    const sb = formed.sb;
    expect(t.host.setPreAction(sb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    expect(mine(sb)).toEqual(['released:auto_check_fold:on_arm']);
  });

  it('refusals name their reason: stale hand, invalid, after release, no active hand', async () => {
    const { formed, t, events, mine } = recorded(5103);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    const stale = uid(510399);
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, stale).code).toBe('STALE_HAND');
    expect(t.host.setPreAction(bb, 'auto_bogus', undefined, formed.handId).success).toBe(false);
    const staleRow = events.find((e) => e.detail === 'stale_hand')!;
    expect(staleRow).toMatchObject({
      kind: 'refused',
      handId: formed.handId,
      requestedHandId: stale,
    });
    expect(mine(bb)).toEqual([
      'refused:auto_check_fold:stale_hand',
      'refused:auto_bogus:invalid_action',
    ]);
    // Released, then asking again: the door says the player has left.
    const sb = formed.sb;
    expect(t.host.setPreAction(sb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    expect(t.host.setPreAction(sb, 'auto_call', undefined, formed.handId).success).toBe(false);
    expect(mine(sb)).toEqual(['released:auto_check_fold:on_arm', 'refused:auto_call:left_hand']);
  });

  it('a free Check/Fold executes as a check at the turn, is re-armed, and is cleared at the hand end', async () => {
    const { formed, t, mine } = recorded(5104, 3);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    // Everyone else just calls or checks: the BB's arm checks on each street it reaches.
    await playOut(t.host, mulberry32(5104), (userId, legal) => {
      expect(userId).not.toBe(bb);
      return passive(userId, legal);
    });
    await flush();
    const rows = mine(bb);
    expect(rows[0]).toBe('set:auto_check_fold:null');
    expect(rows).toContain('executed:auto_check_fold:check');
    expect(rows).toContain('rearmed:auto_check_fold:after_free_check');
    // A carried arm still held when the hand ends is cleared by the hand end.
    expect(rows[rows.length - 1]).toBe('cleared:auto_check_fold:hand_end');
  });

  it('a player clearing an arm, and a bet invalidating an armed Check, are both recorded', async () => {
    const { formed, t, mine } = recorded(5105, 4);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    expect(t.host.setPreAction(bb, 'clear').success).toBe(true);
    expect(t.host.setPreAction(bb, 'auto_check', undefined, formed.handId).success).toBe(true);
    expect(t.host.handlePlayerAction(firstToAct(t).user_id, 'raise', 6).success).toBe(true);
    await flush();
    expect(mine(bb)).toEqual([
      'set:auto_check_fold:null',
      'cleared:auto_check_fold:by_player',
      'set:auto_check:null',
      'cleared:auto_check:invalidated_by_bet',
    ]);
  });

  it('an arm cleared by the player pressing Lightning Fold is recorded as cleared by the fold request', async () => {
    const { formed, t, mine } = recorded(5106, 4);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_call_any', undefined, formed.handId).success).toBe(true);
    expect(t.host.handlePlayerAction(firstToAct(t).user_id, 'raise', 6).success).toBe(true);
    const out = t.host.handlePlayerAction(
      bb,
      'fast_fold',
      undefined,
      `lightning-hand:${formed.handId}`
    );
    expect(out.success).toBe(true);
    expect(mine(bb)).toEqual(['set:auto_call_any:null', 'cleared:auto_call_any:fold_requested']);
  });

  it('every row names the room, the hand, the street and the turn it happened on', async () => {
    const { formed, t, events } = recorded(5108);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    const seqBefore = t.host.peekState()!.actionHistory.length;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    expect(t.host.handlePlayerAction(firstToAct(t).user_id, 'raise', 6).success).toBe(true);
    await flush();
    const [set, released] = events.filter((e) => e.playerId === bb);
    expect(set).toMatchObject({
      kind: 'set',
      roomId: t.host.roomOf(bb),
      handId: formed.handId,
      stage: 'preflop',
      actionSeq: seqBefore,
    });
    expect(set.roomId).toBeTruthy();
    // The raise that priced it is one more action on the same hand.
    expect(released).toMatchObject({ kind: 'released', actionSeq: seqBefore + 1 });
    // Nothing private: no cards and no credentials ride on a row.
    for (const e of events) expect(JSON.stringify(e)).not.toMatch(/cards|token|secret|password/i);
  });

  it('an arm held across a socket drop, a reconnect and a resync is recorded as held each time', async () => {
    const { formed, t, mine } = recorded(5109);
    await t.host.start();
    await flush();
    const bb = formed.bb;
    expect(t.host.setPreAction(bb, 'auto_check_fold', undefined, formed.handId).success).toBe(true);
    t.host.notePresence(bb, false);
    t.host.notePresence(bb, true);
    t.host.rePushHoleCards(bb);
    // A reconnect with nothing armed records nothing.
    t.host.notePresence(formed.sb, false);
    expect(mine(formed.sb)).toEqual([]);
    expect(t.host.handlePlayerAction(firstToAct(t).user_id, 'raise', 6).success).toBe(true);
    await flush();
    expect(mine(bb)).toEqual([
      'set:auto_check_fold:null',
      'held:auto_check_fold:socket_dropped',
      'held:auto_check_fold:socket_connected',
      'held:auto_check_fold:resync',
      'released:auto_check_fold:armed_check_fold_priced_by_bet',
    ]);
  });

  it('a recorder that throws never reaches the action path', async () => {
    const formed = formedHand(4, 5107);
    const t = buildHost(formed, [100, 100, 100, 100], {
      deps: {
        recordPreAction: () => {
          throw Error('recorder down');
        },
      },
    });
    await t.host.start();
    await flush();
    expect(
      t.host.setPreAction(formed.bb, 'auto_check_fold', undefined, formed.handId).success
    ).toBe(true);
    expect(t.host.handlePlayerAction(firstToAct(t).user_id, 'raise', 6).success).toBe(true);
    expect(t.host.isWatching(formed.bb)).toBe(false);
  });
});

describe('the recorder: batched, idempotent on retry, bounded, never throws', () => {
  const ev = (i: number): Ev => ({
    kind: 'set',
    playerId: uid(900000 + i),
    handId: uid(800000),
    clusterId: uid(700000),
    action: 'auto_check_fold',
    detail: null,
    toCall: 0.5,
    stage: 'preflop',
    atMs: 1_800_000_000_000 + i,
  });

  it('sends batches with stable event ids and retries an unknown outcome as the same rows', async () => {
    const calls: Array<{ fn: string; rows: Array<{ event_id: string }> }> = [];
    let fail = 1;
    const r = new rec.LightningPreActionRecorder({
      flushMs: 60_000,
      batchSize: 2,
      logger: { log() {}, warn() {}, error() {} },
      rpc: async (fn, args) => {
        calls.push({ fn, rows: args.p_events as Array<{ event_id: string }> });
        if (fail-- > 0) return { data: null, error: { message: 'connection reset' } };
        return { data: 2, error: null };
      },
    });
    for (let i = 0; i < 3; i++) r.record(ev(i));
    await r.flush();
    expect(calls).toHaveLength(1);
    await r.flush();
    expect(calls.map((c) => c.rows.length)).toEqual([2, 2, 1]);
    expect(calls[1].rows.map((x) => x.event_id)).toEqual(calls[0].rows.map((x) => x.event_id));
    expect(calls.every((c) => c.fn === 'fn_lightning_preaction_record')).toBe(true);
    expect(r.sent).toBe(3);
    r.stop();
  });

  it('a missing database function drops the buffer and stays quiet', async () => {
    let n = 0;
    const r = new rec.LightningPreActionRecorder({
      flushMs: 60_000,
      logger: { log() {}, warn() {}, error() {} },
      rpc: async () => {
        n++;
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      },
    });
    r.record(ev(1));
    await r.flush();
    r.record(ev(2));
    await r.flush();
    expect(n).toBe(1);
    expect(r.pending).toBe(0);
    r.stop();
  });

  it('keeps at most the bound, drops the oldest, and ignores rows it cannot key', () => {
    const r = new rec.LightningPreActionRecorder({
      flushMs: 60_000,
      maxBuffered: 3,
      rpc: async () => ({ data: 0, error: null }),
    });
    for (let i = 0; i < 5; i++) r.record(ev(i));
    r.record({ ...ev(9), playerId: 'not-a-uuid' });
    expect(r.pending).toBe(3);
    expect(r.dropped).toBe(2);
    r.stop();
  });
});
