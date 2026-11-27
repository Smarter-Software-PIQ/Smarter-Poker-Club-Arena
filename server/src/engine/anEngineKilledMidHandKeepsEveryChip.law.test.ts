/**
 * AN ENGINE KILLED IN THE MIDDLE OF A HAND KEEPS EVERY CHIP (2026-11-27,
 * code review finding 11).
 *
 * When the engine process dies mid-hand, the next engine for that table runs
 * checkCrashRecovery(): it finds the incomplete hand snapshot, marks it
 * complete and deals a fresh hand. It does not resume the hand. Chips are
 * safe only because a seat's stack in table_seats moves at settlement and
 * nowhere else: the blinds, bets and all-ins of the voided hand live in the
 * dead process's memory and in the snapshot row, and neither is ever read
 * back as money.
 *
 * Nothing pinned that. This drives the real thing at every point a kill can
 * land, against an in-memory database that sits UNDER the real Supabase
 * helpers (loadSeatedPlayers, saveHandStateSnapshot, getActiveHandSnapshotFull,
 * completeHandSnapshot run unmodified against it):
 *
 *   - the real ServerTableEngine.dealHand builds the hand from the real
 *     roster read, the real HandController posts the blinds and takes the
 *     actions, and the engine's own saveSnapshot() writes the snapshot row;
 *   - the process is then "killed": that engine is dropped with whatever it
 *     held in memory, and settlement never runs (or, for the last point, its
 *     single atomic commit lands and the process dies before the snapshot is
 *     marked complete);
 *   - a NEW engine for the same table, holding a verified cash lease as
 *     GameServer starts it, runs the real checkCrashRecovery() in its
 *     production order (it asks fn_ca_resume_hand_submission for a retained
 *     settlement, which answers that none is retained, then reads the
 *     snapshot), reads the roster back through the real loadSeatedPlayers,
 *     and deals the next hand through the real dealHand and HandController.
 *
 * The laws asserted at every point:
 *   1. Conservation: for every player, the stack the new engine deals from
 *      equals their in-hand stack in the snapshot plus every chip they had
 *      committed to the voided hand (no chip created, none lost), and the
 *      table total is unchanged.
 *   2. Exactly once: those committed chips come back once, not twice (the
 *      recovered stack is the pre-hand stack, never pre-hand plus the bets),
 *      and running recovery a second time changes nothing.
 *   3. No settlement: recovery writes no seat, no stack and no hand result;
 *      besides its one read-only question about a retained submission, the
 *      only call it makes is completing the one snapshot row.
 *   4. Seats: every player is in the seat they were dealt in.
 *   5. The next hand starts: the new engine deals, posts exactly one small
 *      and one big blind from the recovered stacks, and the snapshot row it
 *      writes is the new hand.
 *
 * The one point that is not a void: settlement's commit
 * (fn_ca_commit_hand_settlement) is a single PostgreSQL transaction, so a
 * kill "inside" settlement lands either before it (the hand is voided like
 * any other) or after it (the hand is settled). For the second case the
 * commit is applied to the fake database exactly as the transaction would
 * (final stacks, guarded by each seat's stack before), the process dies
 * before completeHandSnapshot, and recovery must close the snapshot without
 * settling, refunding or moving anything a second time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type SeatRowFake = {
  id: string;
  table_id: string;
  joined_at: string;
  user_id: string;
  occupancy_id: string;
  stack: number;
  seat_number: number;
  time_bank_remaining: number;
  time_bank_uses_remaining: number;
  is_sitting_out: boolean;
  left_at: string | null;
  profile: Record<string, unknown>;
};

type SnapshotRowFake = {
  table_id: string;
  hand_number: number;
  state_json: any;
  config_json: any;
  dealer_seat: number;
  players_json: any[];
  stage: string;
  pending_deadlines: unknown[];
  disconnect_states: Record<string, unknown>;
  is_complete: boolean;
  updated_at: string;
};

/**
 * The in-memory database. It answers the exact query shapes the real helpers
 * send, and records every write and every RPC so a test can say what
 * recovery did and did not touch.
 */
const db = vi.hoisted(() => {
  const state = {
    seats: [] as SeatRowFake[],
    snapshots: [] as SnapshotRowFake[],
    log: [] as string[],
    clock: 0,
  };
  const now = () => new Date(Date.UTC(2026, 10, 27, 12, 0, 0) + ++state.clock * 1000).toISOString();

  type Filter = (row: Record<string, unknown>) => boolean;
  function query(table: string) {
    const filters: Filter[] = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    const rows = (): Record<string, unknown>[] => {
      const source: Record<string, unknown>[] =
        table === 'table_seats'
          ? (state.seats as unknown as Record<string, unknown>[])
          : table === 'hand_state_snapshots'
            ? (state.snapshots as unknown as Record<string, unknown>[])
            : [];
      let out = source.filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, asc } = order;
        out = [...out].sort((a, b) =>
          (a[col] as any) < (b[col] as any)
            ? asc
              ? -1
              : 1
            : (a[col] as any) > (b[col] as any)
              ? asc
                ? 1
                : -1
              : 0
        );
      }
      if (limit !== null) out = out.slice(0, limit);
      // Hand back copies: a caller must never hold a live reference to the database.
      return out.map((r) => JSON.parse(JSON.stringify(r)));
    };
    let pendingUpdate: Record<string, unknown> | null = null;
    const builder: any = {
      select: () => builder,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), builder),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), builder),
      order: (col: string, o?: { ascending?: boolean }) => (
        (order = { col, asc: o?.ascending !== false }),
        builder
      ),
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: async () => {
        const r = rows();
        return { data: r[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (pendingUpdate && table === 'table_seats') {
          // A write to a seat lands, so a stray stack write shows up as money, not only in the log.
          for (const seat of state.seats as unknown as Record<string, unknown>[]) {
            if (filters.every((f) => f(seat))) Object.assign(seat, pendingUpdate);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        if (table !== 'table_seats' && table !== 'hand_state_snapshots') {
          state.log.push(`read:${table}`);
        }
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };
    builder.update = (values: Record<string, unknown>) => {
      state.log.push(`update:${table}`);
      pendingUpdate = values;
      return builder;
    };
    for (const verb of ['insert', 'upsert', 'delete']) {
      builder[verb] = () => {
        state.log.push(`${verb}:${table}`);
        return builder;
      };
    }
    return builder;
  }

  const client = {
    from: (table: string) => query(table),
    rpc: async (name: string, p: Record<string, any>) => {
      state.log.push(`rpc:${name}`);
      if (name === 'save_hand_state_snapshot') {
        // ON CONFLICT (table_id) WHERE is_complete = FALSE DO UPDATE: one live row per table.
        const row = {
          table_id: p.p_table_id,
          hand_number: p.p_hand_number,
          state_json: JSON.parse(JSON.stringify(p.p_state_json)),
          config_json: JSON.parse(JSON.stringify(p.p_config_json)),
          dealer_seat: p.p_dealer_seat,
          players_json: JSON.parse(JSON.stringify(p.p_players_json)),
          stage: p.p_stage,
          pending_deadlines: p.p_pending_deadlines ?? [],
          disconnect_states: p.p_disconnect_states ?? {},
          is_complete: false,
          updated_at: now(),
        };
        const live = state.snapshots.findIndex(
          (s) => s.table_id === row.table_id && !s.is_complete
        );
        if (live >= 0) state.snapshots[live] = row;
        else state.snapshots.push(row);
        return { data: null, error: null };
      }
      if (name === 'fn_ca_resume_hand_submission') {
        // No settlement submission is retained for this table: the process
        // died before it submitted one, or the one it submitted committed whole.
        return { data: { found: false }, error: null };
      }
      if (name === 'complete_hand_snapshot') {
        for (const s of state.snapshots) {
          if (s.table_id === p.p_table_id && s.hand_number === p.p_hand_number && !s.is_complete) {
            s.is_complete = true;
            s.updated_at = now();
          }
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { state, client };
});

vi.mock('../services/supabase/client.js', () => ({
  supabase: db.client,
  maintenanceSupabase: db.client,
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), describeError: String }));

const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { loadSeatedPlayers } = await import('../services/supabase.js');

const SB = 50;
const BB = 100;
const START: Record<number, number> = { 1: 10_000, 3: 6_000, 5: 2_500 };

const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.running = false;
    e.preciseTimer?.dispose?.();
    e.engineTelemetry?.dispose?.();
    (e.constructor as any).releaseCurrentEngine?.(e.tableId, e);
  }
  db.state.seats = [];
  db.state.snapshots = [];
  db.state.log = [];
});

let tableSerial = 0;
function seatTable(stacks: Record<number, number> = START): string {
  const tableId = `00000000-0000-4000-8000-${String(++tableSerial).padStart(12, '0')}`;
  for (const [seatText, stack] of Object.entries(stacks)) {
    const seat = Number(seatText);
    db.state.seats.push({
      id: `00000000-0000-4000-8000-0000000000${String(seat).padStart(2, '0')}`,
      table_id: tableId,
      joined_at: '2026-11-27T10:00:00.123456+00:00',
      user_id: `u${seat}`,
      occupancy_id: `00000000-0000-4000-9000-0000000000${String(seat).padStart(2, '0')}`,
      stack,
      seat_number: seat,
      time_bank_remaining: 30,
      time_bank_uses_remaining: 3,
      is_sitting_out: false,
      left_at: null,
      profile: {
        id: `u${seat}`,
        display_name: `P${seat}`,
        username: `p${seat}`,
        is_horse: false,
        horse_profile: null,
        avatar_url: '',
        use_real_name: false,
        equipped_frame: '',
        equipped_aura: '',
      },
    });
  }
  return tableId;
}

/** A cash engine for `tableId`, configured the way start() leaves it, without a lease harness. */
function engineFor(tableId: string, handNumber: number) {
  const e = new ServerTableEngine(tableId) as any;
  engines.push(e);
  e.tableInfo = {
    id: tableId,
    game_variant: 'nlh',
    game_type: 'cash',
    tournament_id: null,
    small_blind: SB,
    big_blind: BB,
    ante: 0,
    max_players: 6,
    rake_percent: 5,
    rake_cap_bb: 3,
  };
  e.takePreparedHandNumber = () => handNumber;
  e.bombPotSchedPersistedJson = 'null';
  e.waitingForBB = new Set();
  e.persistEntryHold = () => {};
  return e;
}

/** Deal one hand through the real dealHand and HandController, as the dealing loop would. */
async function deal(e: any, handNumber: number) {
  const roster = await loadSeatedPlayers(e.tableId);
  e.seatedPlayers = roster;
  // The dealing loop deals funded seats only (ServerTableEngineDealing, candidates).
  const players = roster.filter((p: any) => p.stack > 0);
  const stop = new Error('controller built');
  e.fetchTimeBankExtras = () => {
    throw stop;
  };
  await expect(e.dealHand(players)).rejects.toBe(stop);
  const hc = e.handController;
  expect(hc, 'dealHand built the hand').toBeTruthy();
  const posted: Array<{ seat: number; kind: string; amount?: number }> = [];
  const completed: Array<{ rake: number; bbjFee: number }> = [];
  hc.onEvent((ev: any) => {
    if (ev.type === 'FORCED_BETS_POSTED') posted.push(...ev.postings);
    if (ev.type === 'HAND_COMPLETE') completed.push({ rake: ev.rake, bbjFee: ev.bbjFee });
  });
  hc.start();
  // The dealing path restores the completed-hand counter when the build stops
  // before start(); the hand that did start is this one.
  e.handCount = handNumber;
  e.currentHandDealerSeat = hc.getDealerSeat();
  return { hc, posted, completed, players };
}

/** The current actor takes `action`; the controller must accept it. */
function act(hc: any, action: string, amount?: number) {
  const seat = hc.getState().currentPlayerSeat;
  expect(hc.performAction(seat, action, amount), `seat ${seat} ${action}`).toBe(true);
  return seat;
}

const dbStacks = (tableId: string) =>
  Object.fromEntries(
    db.state.seats.filter((s) => s.table_id === tableId).map((s) => [s.user_id, s.stack])
  );
const total = (m: Record<string, number>) =>
  Math.round(Object.values(m).reduce((a, b) => a + b, 0) * 100) / 100;
const liveSnapshot = (tableId: string) =>
  db.state.snapshots.find((s) => s.table_id === tableId && !s.is_complete) ?? null;

/** The process dies: nothing the old engine held in memory survives, and it never acts again. */
function kill(e: any) {
  e.running = false;
  e.terminal = true;
  e.preciseTimer?.dispose?.();
  (e.constructor as any).releaseCurrentEngine(e.tableId, e);
}

/**
 * The successor engine as GameServer starts it on a cash table: running, the
 * process-local owner of the table, holding a verified cash lease. The lease
 * is what sends checkCrashRecovery through its production order (ask the
 * database for a retained settlement submission first, then the snapshot).
 */
async function recover(tableId: string): Promise<{ engine: any; recovered: boolean }> {
  const engine = engineFor(tableId, 502);
  engine.running = true;
  expect(engine.claimProcessOwnership(), 'the dead engine no longer owns the table').toBe(true);
  engine.getEngineLeaseAuthority = () => ({
    scope: 'cash',
    verified: true,
    generation: '00000000-0000-4000-8000-00000000beef',
    proofDeadlineMonotonicMs: Number.MAX_SAFE_INTEGER,
  });
  engine.hasCurrentEngineLeaseAuthority = () => true;
  const recovered = await engine.checkCrashRecovery();
  // Dealing below runs without the lease harness, like every other dealHand test.
  delete engine.getEngineLeaseAuthority;
  delete engine.hasCurrentEngineLeaseAuthority;
  return { engine, recovered };
}

type KillPoint = {
  name: string;
  /** Plays the hand up to the kill and returns what the dead engine had last written. */
  play: (hc: any, e: any) => Promise<void>;
  /** True when settlement's single commit landed before the kill. */
  settled?: boolean;
  /**
   * True when the controller had already paid the pot in memory, so the last
   * snapshot carries paid-out stacks: those are exactly what must NOT be
   * dealt from unless the commit landed.
   */
  completedInMemory?: boolean;
};

/** Seats: button 1 (10,000), small blind 3 (6,000), big blind 5 (2,500). */
const KILL_POINTS: KillPoint[] = [
  {
    name: 'preflop, right after the blinds are posted',
    play: async (_hc, e) => {
      await e.saveSnapshot();
    },
  },
  {
    name: 'preflop, after a raise and a call, with the big blind to act',
    play: async (hc, e) => {
      act(hc, 'raise', 300); // button
      act(hc, 'call'); // small blind
      await e.saveSnapshot();
    },
  },
  {
    name: 'on the flop, mid street, with a bet and a raise in front of the button',
    play: async (hc, e) => {
      act(hc, 'raise', 300);
      act(hc, 'call');
      act(hc, 'call');
      expect(hc.getState().stage).toBe('flop');
      act(hc, 'bet', 400); // small blind leads
      act(hc, 'raise', 1_200); // big blind raises
      await e.saveSnapshot();
    },
  },
  {
    name: 'during an all-in, after the last call and before the board is run out',
    play: async (hc, e) => {
      act(hc, 'raise', 300);
      act(hc, 'all_in'); // small blind shoves 6,000
      act(hc, 'call'); // big blind calls all-in for 2,500
      act(hc, 'call'); // button calls
      const st = hc.getState();
      expect(st.communityCards.length, 'the runout has not been dealt').toBe(0);
      expect(st.players.filter((p: any) => p.is_all_in).length).toBe(2);
      await e.saveSnapshot();
    },
  },
  {
    name: 'after the hand finished in memory, before the settlement commit landed',
    completedInMemory: true,
    play: async (hc, e) => {
      act(hc, 'raise', 300);
      act(hc, 'all_in');
      act(hc, 'call');
      act(hc, 'call');
      await e.saveSnapshot(); // the last write before the runout
      hc.continueRunout();
      expect(hc.getLifecyclePhase().handCompleted, 'the hand completed in memory').toBe(true);
      await e.saveSnapshot(); // the engine snapshots after the final action too
    },
  },
  {
    name: 'after the settlement commit landed, before the snapshot was marked complete',
    settled: true,
    completedInMemory: true,
    play: async (hc, e) => {
      act(hc, 'raise', 300); // button
      act(hc, 'fold'); // small blind
      act(hc, 'call'); // big blind
      expect(hc.getState().stage).toBe('flop');
      act(hc, 'check'); // big blind
      act(hc, 'bet', 500); // button
      await e.saveSnapshot();
      act(hc, 'fold'); // big blind: the button wins, the 500 comes back uncalled
      expect(hc.getLifecyclePhase().handCompleted).toBe(true);
      await e.saveSnapshot();
    },
  },
];

/**
 * fn_ca_commit_hand_settlement, as the fake database applies it: one
 * transaction that moves every dealt seat from its stack before to its final
 * stack, refused whole if any seat's stack is not what the hand was dealt
 * from.
 */
function commitSettlement(
  tableId: string,
  before: Record<string, number>,
  after: Record<string, number>
) {
  const seats = db.state.seats.filter((s) => s.table_id === tableId);
  for (const s of seats) {
    if (s.user_id in before && s.stack !== before[s.user_id]) {
      throw new Error(`commit refused: ${s.user_id} stack ${s.stack} is not ${before[s.user_id]}`);
    }
  }
  for (const s of seats) if (s.user_id in after) s.stack = after[s.user_id];
  db.state.log.push('rpc:fn_ca_commit_hand_settlement');
}

describe('an engine killed in the middle of a hand keeps every chip', () => {
  for (const point of KILL_POINTS) {
    it(`killed ${point.name}`, async () => {
      const tableId = seatTable();
      const before = dbStacks(tableId);
      const seatsBefore = Object.fromEntries(db.state.seats.map((s) => [s.user_id, s.seat_number]));

      // ── The engine that dies ────────────────────────────────────────────
      const dead = engineFor(tableId, 501);
      const { hc, posted, completed } = await deal(dead, 501);
      expect(posted.map((p) => [p.seat, p.kind, p.amount])).toEqual([
        [3, 'sb', SB],
        [5, 'bb', BB],
      ]);
      await point.play(hc, dead);

      let finalStacks: Record<string, number> | null = null;
      let houseTake = 0;
      if (point.settled) {
        // The controller's own account of the hand: the pot paid out, less
        // the rake and jackpot fee it reported. That is what the commit writes.
        expect(completed).toHaveLength(1);
        houseTake = completed[0].rake + completed[0].bbjFee;
        const st = hc.getState();
        finalStacks = Object.fromEntries(st.players.map((p: any) => [p.user_id, p.stack]));
        commitSettlement(tableId, before, finalStacks);
      } else if (!point.completedInMemory) {
        expect(completed, 'the hand was still live when the process died').toHaveLength(0);
      }
      kill(dead);

      // What the dead engine left behind: its last snapshot, never completed.
      const snap = liveSnapshot(tableId);
      expect(snap, 'the dead engine left an incomplete snapshot').not.toBeNull();
      expect(snap!.hand_number).toBe(501);
      const inHand = new Map<string, { stack: number; committed: number; seat: number }>(
        snap!.state_json.players.map((p: any) => [
          p.user_id,
          { stack: p.stack, committed: p.totalInvested, seat: p.seat },
        ])
      );
      // The snapshot's own player list says the same thing as its state.
      for (const p of snap!.players_json) expect(p.stack).toBe(inHand.get(p.user_id)!.stack);
      // A voided hand left chips on the felt; the snapshot is not money.
      const stakes = [...inHand.values()].reduce((a, p) => a + p.committed, 0);
      if (!point.completedInMemory) {
        expect(stakes, 'chips were committed to the hand when it died').toBeGreaterThanOrEqual(
          SB + BB
        );
      }
      const dbBeforeRecovery = dbStacks(tableId);
      expect(dbBeforeRecovery, 'nothing but a settlement commit moves a seat stack').toEqual(
        finalStacks ?? before
      );

      // ── The engine that recovers ────────────────────────────────────────
      db.state.log = [];
      const { engine: next, recovered: found } = await recover(tableId);
      expect(found, 'recovery found the dead hand').toBe(true);

      // 3. No settlement: one question about a retained submission, then the
      // only write is completing the one snapshot row.
      expect(db.state.log).toEqual([
        'rpc:fn_ca_resume_hand_submission',
        'rpc:complete_hand_snapshot',
      ]);
      expect(liveSnapshot(tableId), 'the voided hand is closed').toBeNull();
      expect(db.state.snapshots.filter((s) => s.table_id === tableId)).toHaveLength(1);
      expect(next.handCount, 'the counter continues from the voided hand').toBe(501);

      const roster = await loadSeatedPlayers(tableId);
      const recovered = Object.fromEntries(roster.map((p: any) => [p.user_id, p.stack]));

      if (point.settled) {
        // The hand is settled, once: the committed stacks stand, nothing refunded.
        expect(recovered).toEqual(finalStacks);
        expect(Math.round((total(recovered) + houseTake) * 100) / 100).toBe(total(before));
      } else {
        for (const [user, p] of inHand) {
          // 2. Exactly once: the voided hand's chips are back once, so the
          // seat holds its pre-hand stack, never pre-hand plus the bets.
          expect(recovered[user], `${user} is refunded once`).toBe(before[user]);
          if (point.completedInMemory) continue;
          // 1. Conservation, player by player: in-hand stack + committed chips.
          expect(recovered[user], `${user} stack after recovery`).toBe(
            Math.round((p.stack + p.committed) * 100) / 100
          );
        }
        if (point.completedInMemory) {
          // The pot the dead process paid in memory never reached a seat.
          const paid = Object.fromEntries([...inHand].map(([u, p]) => [u, p.stack]));
          expect(paid).not.toEqual(before);
          expect(total(paid)).toBeLessThanOrEqual(total(before));
        }
        expect(total(recovered)).toBe(total(before));
      }
      // 4. Seats: nobody moved.
      expect(Object.fromEntries(roster.map((p: any) => [p.user_id, p.seat_number]))).toEqual(
        seatsBefore
      );

      // 2. A second recovery (the new engine dies at once and a third boots) does nothing.
      kill(next);
      db.state.log = [];
      const { engine: third, recovered: again } = await recover(tableId);
      expect(again).toBe(false);
      expect(db.state.log).toEqual(['rpc:fn_ca_resume_hand_submission']);
      expect(dbStacks(tableId)).toEqual(recovered);

      // 5. The next hand starts from the recovered stacks, in the same seats.
      const nextHand = await deal(third, 502);
      expect(nextHand.posted.filter((p) => p.kind === 'sb')).toHaveLength(1);
      expect(nextHand.posted.filter((p) => p.kind === 'bb')).toHaveLength(1);
      const dealt = nextHand.hc.getState().players;
      expect(dealt.map((p: any) => [p.user_id, p.seat])).toEqual(
        roster.filter((p: any) => p.stack > 0).map((p: any) => [p.user_id, p.seat_number])
      );
      for (const p of dealt) {
        expect(p.stack + p.totalInvested, `${p.user_id} is dealt from the recovered stack`).toBe(
          recovered[p.user_id]
        );
      }
      await third.saveSnapshot();
      expect(liveSnapshot(tableId)?.hand_number).toBe(502);
    });
  }
});
