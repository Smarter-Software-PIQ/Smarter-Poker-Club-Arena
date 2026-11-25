/**
 * LAW: A HORSE DECISION ERROR IS WRITTEN WHERE THE WATCH LISTS READ IT (2026-11-24).
 *
 * Every live switch change uses "horse_error_log rows = 0" as a rollback
 * trigger (scripts/ops/shadow-read-report-lib.mjs). The table had never held a
 * row because nothing wrote it: a failed decision went to the engine log and
 * an in-memory counter only. These cases drive the REAL production wrapper
 * (ServerTableEngine.scheduleHorseAction's worker-fallback path) and the real
 * writer (services/HorseErrorLog.ts); only the database client is replaced, by
 * a table that accepts exactly production's horse_error_log columns.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandConfig, SeatPlayer } from '../types.js';

const PRODUCTION_COLUMNS: string[] = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../scripts/ci/supabase-columns-manifest.json'),
    'utf8'
  )
).columns.horse_error_log;

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  fail: false,
  tables: [] as string[],
}));
const worker = vi.hoisted(() => ({
  decideFast: vi.fn(),
  decideDeep: vi.fn(),
  commitDecisionEffects: vi.fn(async () => undefined),
  runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
}));
vi.mock('./horseDecision/index.js', async () => ({
  ...(await vi.importActual<typeof import('./horseDecision/index.js')>('./horseDecision/index.js')),
  getLiveHorseDecisionWorker: () => worker,
}));
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      db.tables.push(table);
      if (table !== 'horse_error_log') throw Error(`Unexpected database access: ${table}`);
      return {
        insert: (row: Record<string, unknown>) => ({
          abortSignal: async () => {
            if (db.fail) return { error: { message: 'insert refused' } };
            db.rows.push(row);
            return { error: null };
          },
        }),
      };
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', async () => ({
  ...(await vi.importActual<typeof import('../services/errorReporter.js')>(
    '../services/errorReporter.js'
  )),
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import { HorseDecisionExpiredError, markHorseDecisionRejection } from './horseDecision/index.js';
import {
  _resetHorseErrorLogForTests,
  HORSE_ERROR_LOG_WINDOW_MS,
  recordHorseError,
  redactCardTokens,
  startHorseErrorLog,
  stopHorseErrorLog,
} from '../services/HorseErrorLog.js';
import { disarmBrainTelemetryForTest, drainFires, enableBrainTelemetry } from './BrainTelemetry.js';

const TABLE = 'fa300000-0000-4000-8000-0000000000e1';

function harness(gameVariant = 'nlh') {
  const players = [200, 200, 200, 200].map((stack, i) => ({
    seat: i + 1,
    user_id: `fa400000-0000-4000-8000-0000000000e${i + 1}`,
    username: `Horse ${i + 1}`,
    stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const hc = new HandController(
    {
      tableId: TABLE,
      handNumber: 7,
      gameVariant,
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    1
  );
  hc.start();
  const live = (hc as unknown as { state: any }).state;
  const state = hc.getState();
  const seat = state.currentPlayerSeat!;
  // The deciding seat holds real cards; none may reach a row.
  live.players.find((p: SeatPlayer) => p.seat === seat).cards = [
    { rank: 'Q', suit: 'hearts' },
    { rank: 'J', suit: 'diamonds' },
  ];
  const enginePlayer = state.players.find((p) => p.seat === seat)!;
  const player = {
    seat_number: seat,
    user_id: enginePlayer.user_id,
    username: enginePlayer.username,
    stack: enginePlayer.stack,
    is_horse: true,
    horse_profile: {},
  };
  const engine = new ServerTableEngine(TABLE) as any;
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.handCount = 7;
  engine.tableInfo = {
    action_time_seconds: 15,
    big_blind: 2,
    small_blind: 1,
    game_variant: gameVariant,
  };
  engine.seatedPlayers = [player];
  engine.handController = hc;
  engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
  engine.timeBankEngine = {
    isAutoActivateEnabled: () => true,
    isArmed: () => false,
    getPlayerBank: () => null,
  };
  engine.getEngineLeaseAuthority = () => ({ verified: true, generation: '9' });
  engine.humansSeated = () => 0;
  engine.tableFormat = () => 'cash';
  engine.markProgress = vi.fn();
  const history = state.actionHistory.length;
  return {
    seat,
    horseId: enginePlayer.user_id,
    accepted: () => live.actionHistory.slice(history) as any[],
    async run() {
      engine.scheduleHorseAction(player, seat, enginePlayer, hc.getState());
      await vi.advanceTimersByTimeAsync(300);
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  db.rows.length = 0;
  db.tables.length = 0;
  db.fail = false;
  _resetHorseErrorLogForTests();
  startHorseErrorLog();
});
afterEach(() => {
  _resetHorseErrorLogForTests();
  disarmBrainTelemetryForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a Horse decision that falls back', () => {
  it('is one horse_error_log row with its public context, written by the production wrapper', async () => {
    const h = harness('nlh');
    worker.decideFast.mockRejectedValueOnce(new HorseDecisionExpiredError());
    await h.run();
    await settle();
    // The seat still took its liveness action, exactly as before.
    expect(h.accepted()).toHaveLength(1);
    expect(db.rows).toHaveLength(1);
    const row = db.rows[0]!;
    expect(Object.keys(row).every((c) => PRODUCTION_COLUMNS.includes(c))).toBe(true);
    expect(row).toMatchObject({ horse_id: h.horseId, error_type: 'decision_fallback' });
    expect(row.context).toMatchObject({
      reason: 'expired',
      fallback_reason: 'expired',
      table_id: TABLE,
      hand_number: 7,
      variant: 'nlh',
      mode: 'cash',
      street: 'preflop',
      action: h.accepted()[0].action,
      occurrences: 1,
    });
    expect(Array.isArray((row.context as any).options_on)).toBe(true);
    expect(typeof (row.context as any).build).toBe('string');
    // No card of the deciding seat, in any form.
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/hearts|diamonds|"rank"|"suit"|\bQh\b|\bJd\b/);
  });

  it('never stores a card a message printed', async () => {
    const h = harness('nlh');
    worker.decideFast.mockRejectedValueOnce(
      markHorseDecisionRejection(
        new Error('worker refused holding Qh Jd on board 10s 2c'),
        'validation_failed'
      )
    );
    await h.run();
    await settle();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.error_message).toBe(
      'worker refused holding [card] [card] on board [card] [card]'
    );
    expect((db.rows[0]!.context as any).reason).toBe('validation_failed');
    expect(String(db.rows[0]!.stack_trace)).not.toMatch(/\bQh\b|\bJd\b/);
    expect(redactCardTokens('{"rank":"A","suit":"spades"}')).toBe(
      '{"rank":"[card]","suit":"[card]"}'
    );
  });

  it('a storm is one row at once and one row for the rest of its minute, with the count', async () => {
    for (let i = 0; i < 5; i++) {
      const h = harness('plo5');
      worker.decideFast.mockRejectedValueOnce(new HorseDecisionExpiredError());
      await h.run();
    }
    await settle();
    expect(db.rows).toHaveLength(1);
    expect((db.rows[0]!.context as any).occurrences).toBe(1);
    await vi.advanceTimersByTimeAsync(HORSE_ERROR_LOG_WINDOW_MS);
    await settle();
    expect(db.rows).toHaveLength(2);
    expect(db.rows[1]).toMatchObject({ error_type: 'decision_fallback' });
    expect((db.rows[1]!.context as any).occurrences).toBe(4);
    // Every occurrence is accounted for: the watch list's sum is the truth.
    expect(db.rows.reduce((n, r) => n + Number((r.context as any).occurrences), 0)).toBe(5);
  });

  it('a row recorded before the engine starts the log is sent when it starts', async () => {
    _resetHorseErrorLogForTests();
    recordHorseError({
      type: 'worker_failed',
      reason: 'failed_before_boot',
      error: new Error('x'),
    });
    await settle();
    expect(db.rows).toHaveLength(0);
    startHorseErrorLog();
    await settle();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ error_type: 'worker_failed', horse_id: null });
  });

  it('a row the database refuses is counted, so a quiet log cannot hide a dead writer', async () => {
    enableBrainTelemetry();
    drainFires();
    db.fail = true;
    const h = harness('nlh');
    worker.decideFast.mockRejectedValueOnce(new HorseDecisionExpiredError());
    await h.run();
    await settle();
    expect(h.accepted()).toHaveLength(1);
    expect(drainFires()).toContainEqual({
      feature: 'horse_error_log_write_exception_seen',
      fires: 1,
    });
  });

  it('shutdown writes what an open minute held', async () => {
    recordHorseError({
      type: 'action_corrected',
      reason: 'controller_rejected',
      variant: 'nlh',
      mode: 'cash',
    });
    recordHorseError({
      type: 'action_corrected',
      reason: 'controller_rejected',
      variant: 'nlh',
      mode: 'cash',
    });
    await settle();
    expect(db.rows).toHaveLength(1);
    await stopHorseErrorLog(50);
    expect(db.rows).toHaveLength(2);
    expect((db.rows[1]!.context as any).occurrences).toBe(1);
  });
});

describe('the engine starts and stops the log', () => {
  const src = (p: string) => readFileSync(resolve(import.meta.dirname, '..', p), 'utf8');
  it('boot starts it and shutdown waits for it', () => {
    expect(src('index.ts')).toContain('startHorseErrorLog();');
    expect(src('GameServer.ts')).toContain('await stopHorseErrorLog();');
  });
  it('every legalizer correction on the turn path is also written', () => {
    const turns = src('engine/ServerTableEngineTurns.ts');
    expect(turns.match(/noteHorseLegalizerDegraded\(/g)).toHaveLength(1);
    expect(turns).toContain("type: 'action_corrected'");
    expect(turns).toContain("type: 'decision_fallback'");
    expect(src('lightning/LightningHorse.ts')).toContain("type: 'lightning_fallback'");
    expect(src('engine/horseDecision/lane.ts')).toContain("type: 'worker_failed'");
  });
});
