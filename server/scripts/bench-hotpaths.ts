/**
 * 200-TABLE MAIN-THREAD CPU & ALLOCATION MICRO-BENCHMARK
 *
 *     cd server && npx tsx scripts/bench-hotpaths.ts [--tables=200] [--ticks=25] [--quick] [--json]
 *
 * Non-intrusive, zero-network, zero-DB harness for measuring engine main-thread
 * hot-path CPU time, V8 heap vs off-heap Buffer retention, and event-loop lag
 * before/after performance work (incident 1e532243 Phases 4–5). Safe to run
 * locally on the Mac or on isolated `ca-backup` (Node v22).
 *
 * Benchmarks four hot paths at realistic 200-table scale:
 *   1. TableStateHub fan-out: eager `publish()` vs `publishLazy()` (95% unwatched).
 *   2. F06 batch retention: `JSON.stringify` + `JSON.parse` round-trip vs
 *      pre-captured `{ handStarted, publicState }` metadata (zero main-thread parse).
 *   3. `mainHistoryCache` retention: V8 heap strings vs off-heap `Buffer`s
 *      (200 tables x 9 seats), plus decode-on-read throughput.
 *   4. `buildHorseDecisionKey` chunked canonical SHA-256 hashing across 200
 *      realistic horse decision envelopes.
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import {
  TableStateHub,
  type GameStateSnapshot,
  type HubSubscriber,
} from '../src/transport/TableStateHub.js';
import { buildHorseDecisionKey } from '../src/engine/horseDecision/protocol.js';

type DecisionKeyInput = Parameters<typeof buildHorseDecisionKey>[0];

interface BenchOptions {
  tables: number;
  ticks: number;
  watchedRatio: number;
  historyEntryKb: number;
  json: boolean;
}

function parseOptions(argv: readonly string[]): BenchOptions {
  const quick = argv.includes('--quick');
  const json = argv.includes('--json');
  const numFlag = (prefix: string, fallback: number): number => {
    const raw = argv.find((arg) => arg.startsWith(`${prefix}=`));
    if (!raw) return fallback;
    const parsed = Number(raw.slice(prefix.length + 1));
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  return {
    tables: numFlag('--tables', quick ? 50 : 200),
    ticks: numFlag('--ticks', quick ? 8 : 25),
    watchedRatio: 0.05,
    historyEntryKb: numFlag('--entry-kb', quick ? 8 : 24),
    json,
  };
}

function makeTableId(index: number): string {
  return `00000000-0000-4000-9000-${index.toString(16).padStart(12, '0')}`;
}

function makePlayerId(tableIndex: number, seat: number): string {
  const n = tableIndex * 16 + seat;
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function buildSnapshot(tableIndex: number, tick: number): GameStateSnapshot {
  const seats = 9;
  const players = Array.from({ length: seats }, (_, seat) => ({
    seat: seat + 1,
    userId: makePlayerId(tableIndex, seat),
    username: `horse_${tableIndex}_${seat}`,
    stack: 10000 - tick * 25 - seat * 100,
    bet: seat === tick % seats ? 150 : 0,
    folded: seat > 4 && tick > 3,
    allIn: false,
    sittingOut: false,
    isHorse: true,
    timeBankSeconds: 30,
  }));
  return {
    tableId: makeTableId(tableIndex),
    handNumber: 1000 + tick,
    stage: tick % 4 === 0 ? 'preflop' : tick % 4 === 1 ? 'flop' : tick % 4 === 2 ? 'turn' : 'river',
    pot: 300 + tick * 75,
    currentBet: 150,
    minRaise: 300,
    bigBlind: 100,
    smallBlind: 50,
    dealerSeat: (tick % seats) + 1,
    activeSeat: ((tick + 1) % seats) + 1,
    communityCards:
      tick % 4 === 0
        ? []
        : [
            { rank: 'A', suit: 'spades' },
            { rank: 'K', suit: 'hearts' },
            { rank: '7', suit: 'clubs' },
          ].slice(0, Math.min(5, (tick % 4) + 2)),
    players,
    actionHistory: Array.from({ length: 12 }, (_, idx) => ({
      seat: (idx % seats) + 1,
      action: idx % 3 === 0 ? 'call' : idx % 3 === 1 ? 'bet' : 'check',
      amount: idx % 3 === 2 ? 0 : 150,
      stage: idx < 4 ? 'preflop' : 'flop',
      seq: idx + 1,
    })),
  };
}

function buildControllerRecoveryState(tableIndex: number, tick: number): Record<string, unknown> {
  const snapshot = buildSnapshot(tableIndex, tick);
  return {
    ...snapshot,
    handStarted: true,
    deck: Array.from({ length: 34 }, (_, idx) => ({
      rank: ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'][idx % 13],
      suit: ['spades', 'hearts', 'diamonds', 'clubs'][idx % 4],
    })),
    pots: [{ amount: 450, eligibleSeats: [1, 2, 3, 4] }],
  };
}

function makeSubscriber(id: string): HubSubscriber {
  return {
    id,
    readyState: 1,
    bufferedAmount: 0,
    send(_data: string): void {
      // No-op sink for in-process fan-out benchmark.
    },
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mb(bytes: number): number {
  return round2(bytes / (1024 * 1024));
}

function benchTableStateHub(opts: BenchOptions) {
  const watchedCount = Math.max(1, Math.round(opts.tables * opts.watchedRatio));
  const tableIds = Array.from({ length: opts.tables }, (_, i) => makeTableId(i));

  const runMode = (lazy: boolean) => {
    const hub = new TableStateHub();
    for (let i = 0; i < watchedCount; i += 1) {
      hub.subscribe(tableIds[i], makeSubscriber(`sub-${i}`));
    }
    const el = monitorEventLoopDelay({ resolution: 10 });
    el.enable();
    const memBefore = process.memoryUsage();
    const start = performance.now();
    let projected = 0;
    for (let t = 0; t < opts.ticks; t += 1) {
      for (let i = 0; i < opts.tables; i += 1) {
        if (lazy) {
          hub.publishLazy(tableIds[i], () => {
            projected += 1;
            return buildSnapshot(i, t);
          });
        } else {
          projected += 1;
          hub.publish(tableIds[i], buildSnapshot(i, t));
        }
      }
    }
    const elapsedMs = performance.now() - start;
    const memAfter = process.memoryUsage();
    el.disable();
    const totalOps = opts.tables * opts.ticks;
    return {
      totalOps,
      projectedSnapshots: projected,
      elapsedMs: round2(elapsedMs),
      opsPerSec: Math.round((totalOps / Math.max(elapsedMs, 0.001)) * 1000),
      heapDeltaMb: mb(memAfter.heapUsed - memBefore.heapUsed),
      eventLoopMaxMs: round2(el.max / 1e6),
    };
  };

  const eager = runMode(false);
  const lazy = runMode(true);
  return {
    tables: opts.tables,
    watchedTables: watchedCount,
    ticks: opts.ticks,
    eager,
    lazy,
    speedupFactor: round2(eager.elapsedMs / Math.max(lazy.elapsedMs, 0.001)),
  };
}

function benchF06RetainRoundTrip(opts: BenchOptions) {
  const iterations = opts.tables * opts.ticks;
  const states = Array.from({ length: opts.tables }, (_, i) => buildControllerRecoveryState(i, 5));

  const startLegacy = performance.now();
  let legacyChecksum = 0;
  for (let n = 0; n < iterations; n += 1) {
    const state = states[n % states.length];
    const serialized = JSON.stringify(state);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const publicState: Record<string, unknown> = { ...parsed, deck: [] };
    legacyChecksum += (publicState.handStarted === true ? 1 : 0) + serialized.length;
  }
  const legacyMs = performance.now() - startLegacy;

  const startDirect = performance.now();
  let directChecksum = 0;
  for (let n = 0; n < iterations; n += 1) {
    const state = states[n % states.length];
    const serialized = JSON.stringify(state);
    const handStarted = state.handStarted === true;
    const publicState = { ...state, deck: [] };
    directChecksum +=
      (handStarted ? 1 : 0) + serialized.length + (publicState.deck.length === 0 ? 0 : 1);
  }
  const directMs = performance.now() - startDirect;

  if (legacyChecksum !== directChecksum) {
    throw new Error(`F06 checksum mismatch: ${legacyChecksum} vs ${directChecksum}`);
  }

  return {
    iterations,
    legacyStringifyPlusParseMs: round2(legacyMs),
    directPreCapturedMetadataMs: round2(directMs),
    savedMs: round2(legacyMs - directMs),
    speedupFactor: round2(legacyMs / Math.max(directMs, 0.001)),
  };
}

function benchHistoryCacheRetention(opts: BenchOptions) {
  const entries = opts.tables * 9;
  const targetChars = opts.historyEntryKb * 1024;
  const filler = 'x'.repeat(Math.max(64, targetChars - 120));
  const samplePayload = (idx: number) =>
    JSON.stringify({
      seatKey: `seat-${idx}`,
      hands: 64,
      digest: `h${idx.toString(16)}`,
      body: filler,
    });

  const memStartStr = process.memoryUsage();
  const tStr = performance.now();
  const stringStore = new Map<string, string>();
  for (let i = 0; i < entries; i += 1) {
    stringStore.set(`k-${i}`, samplePayload(i));
  }
  const strWriteMs = performance.now() - tStr;
  const memEndStr = process.memoryUsage();
  const strHeapDeltaMb = mb(memEndStr.heapUsed - memStartStr.heapUsed);
  const strExternalDeltaMb = mb(memEndStr.external - memStartStr.external);
  stringStore.clear();

  const memStartBuf = process.memoryUsage();
  const tBuf = performance.now();
  const bufferStore = new Map<string, Buffer>();
  for (let i = 0; i < entries; i += 1) {
    bufferStore.set(`k-${i}`, Buffer.from(samplePayload(i), 'utf8'));
  }
  const bufWriteMs = performance.now() - tBuf;
  const memEndBuf = process.memoryUsage();

  const tRead = performance.now();
  let decodedBytes = 0;
  for (let i = 0; i < Math.min(entries, 400); i += 1) {
    const raw = bufferStore.get(`k-${i}`);
    if (raw) decodedBytes += raw.toString('utf8').length;
  }
  const bufReadMs = performance.now() - tRead;
  bufferStore.clear();

  return {
    entries,
    entryKb: opts.historyEntryKb,
    stringRetention: {
      writeMs: round2(strWriteMs),
      heapDeltaMb: strHeapDeltaMb,
      externalDeltaMb: strExternalDeltaMb,
    },
    bufferRetention: {
      writeMs: round2(bufWriteMs),
      heapDeltaMb: mb(memEndBuf.heapUsed - memStartBuf.heapUsed),
      externalDeltaMb: mb(memEndBuf.external - memStartBuf.external),
      sampleDecode400Ms: round2(bufReadMs),
      sampleDecodedChars: decodedBytes,
    },
  };
}

function benchDecisionKeyHashing(opts: BenchOptions) {
  const inputs: DecisionKeyInput[] = Array.from({ length: opts.tables }, (_, i) => ({
    fence: `${makeTableId(i)}:${2000 + i}:${(i % 9) + 1}:${i + 1}`,
    decisionTimeMs: 1_795_800_000_000 + i * 1000,
    player: {
      seat: (i % 9) + 1,
      user_id: makePlayerId(i, 0),
      username: `horse_${i}_0`,
      stack: 10000,
      bet: 100,
      totalInvested: 150,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'Q', suit: 'hearts' },
      ],
    },
    gameState: {
      players: [],
      communityCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: '7', suit: 'clubs' },
      ],
      pot: 450,
      currentBet: 150,
      minRaise: 300,
      stage: 'flop',
      gameVariant: 'nlh',
      bigBlind: 100,
      dealerSeat: 1,
      actionHistory: [],
    },
  }));

  const rounds = opts.ticks;
  const el = monitorEventLoopDelay({ resolution: 10 });
  el.enable();
  const start = performance.now();
  let lastKey = '';
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < inputs.length; i += 1) {
      lastKey = buildHorseDecisionKey(inputs[i]);
    }
  }
  const elapsedMs = performance.now() - start;
  el.disable();
  const totalHashes = inputs.length * rounds;
  return {
    totalHashes,
    elapsedMs: round2(elapsedMs),
    hashesPerSec: Math.round((totalHashes / Math.max(elapsedMs, 0.001)) * 1000),
    eventLoopMaxMs: round2(el.max / 1e6),
    sampleKeyPrefix: lastKey.slice(0, 24),
  };
}

function main(): void {
  const opts = parseOptions(process.argv.slice(2));
  const report = {
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    options: opts,
    tableStateHub: benchTableStateHub(opts),
    f06RetainRoundTrip: benchF06RetainRoundTrip(opts),
    historyCacheRetention: benchHistoryCacheRetention(opts),
    decisionKeyHashing: benchDecisionKeyHashing(opts),
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  console.log(
    `=== Club Arena Hot-Path Micro-Benchmark (${opts.tables} tables x ${opts.ticks} ticks, Node ${report.nodeVersion}) ===`
  );
  console.log(
    `1. TableStateHub (95% unwatched): eager=${report.tableStateHub.eager.elapsedMs}ms (${report.tableStateHub.eager.projectedSnapshots} projected) vs lazy=${report.tableStateHub.lazy.elapsedMs}ms (${report.tableStateHub.lazy.projectedSnapshots} projected) -> ${report.tableStateHub.speedupFactor}x faster`
  );
  console.log(
    `2. F06 retain (${report.f06RetainRoundTrip.iterations} ops): stringify+parse=${report.f06RetainRoundTrip.legacyStringifyPlusParseMs}ms vs pre-captured=${report.f06RetainRoundTrip.directPreCapturedMetadataMs}ms -> saved ${report.f06RetainRoundTrip.savedMs}ms (${report.f06RetainRoundTrip.speedupFactor}x)`
  );
  console.log(
    `3. HistoryCache (${report.historyCacheRetention.entries} x ${report.historyCacheRetention.entryKb}KB): V8 string heapDelta=${report.historyCacheRetention.stringRetention.heapDeltaMb}MB vs Buffer heapDelta=${report.historyCacheRetention.bufferRetention.heapDeltaMb}MB (externalDelta=${report.historyCacheRetention.bufferRetention.externalDeltaMb}MB, decode400=${report.historyCacheRetention.bufferRetention.sampleDecode400Ms}ms)`
  );
  console.log(
    `4. buildHorseDecisionKey (${report.decisionKeyHashing.totalHashes} hashes): ${report.decisionKeyHashing.elapsedMs}ms (${report.decisionKeyHashing.hashesPerSec}/sec, elMax=${report.decisionKeyHashing.eventLoopMaxMs}ms)`
  );
}

main();
