/**
 * A PKO BUST READS ITS EVIDENCE IN TWO TRIPS (2026-11-14, incident b6d94533)
 *
 * The Midnight Free Buy PKO (496 entries) closed rebuys at 01:30 CST and
 * 20-34 players a minute busted. The sweep records PKO busts one at a time in
 * hand order (the PKO watermark requires it), so its throughput is one bust
 * per eliminatePlayer, and every awaited round trip inside that method is paid
 * once per bust in series. Read from engine-01's Prometheus for 01:30-01:50
 * CST: the scheduler queue was empty (no admission wait), eliminatePlayer held
 * 886 ms of every second at a 3.9 s mean, about 13.5 busts a minute, and 110
 * busts waited a median 440 s. Database execution was small (the door 127 ms,
 * the payer 200 ms mean); the rest was sequential trips at about 200 ms each.
 *
 * loadPersistedBountyEvidence made four of those trips in a row: candidate,
 * live seat, atomic receipt, hand. The live seat needs only the user id, and
 * the receipt and the hand need only the candidate's identity, so the law is
 * two trips, with every check still applied in the same order to the same
 * rows. The fixed transport answers each request TRIP_MS after it is sent, so
 * fake time elapsed IS the number of sequential trips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), reportError: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: fixture.from, rpc: fixture.rpc },
  maintenanceSupabase: { from: fixture.from, rpc: fixture.rpc },
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: fixture.reportError,
  reportWarning: vi.fn(),
}));
vi.stubGlobal(
  'fetch',
  vi.fn(() => {
    throw new Error('Network disabled in fixture');
  })
);

const { TournamentManagerEliminations } = await import('./TournamentManagerEliminations.js');

const TRIP_MS = 100;
const tournamentId = '00000000-0000-4000-8000-000000000001';
const bustedId = '00000000-0000-4000-8000-000000000003';
const tableId = '00000000-0000-4000-8000-0000000000aa';
const handId = '00000000-0000-4000-8000-0000000000bb';
const seatId = '00000000-0000-4000-8000-0000000000dd';
const candidateId = '00000000-0000-4000-8000-0000000000ee';
const joinedAt = '2026-11-14T07:00:00.000Z';

interface Request {
  table: string;
  sentAt: number;
}

const validCandidate = {
  id: candidateId,
  table_id: tableId,
  seat_id: seatId,
  seat_joined_at: joinedAt,
  hand_id: handId,
  hand_number: 41,
  stack_before: 3000,
  stack_after: 0,
  state: 'pending',
};

function transport(answers: Record<string, { data?: unknown; error?: unknown }>) {
  const sent: Request[] = [];
  fixture.from.mockImplementation((table: string) => {
    const request: Request = { table, sentAt: -1 };
    const query: any = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'order', 'limit', 'maybeSingle'])
      query[method] = () => query;
    query.then = (resolve: any, reject: any) => {
      request.sentAt = Date.now();
      sent.push(request);
      const response = { data: null, error: null, ...(answers[table] ?? {}) };
      return new Promise((r) => setTimeout(() => r(response), TRIP_MS)).then(resolve, reject);
    };
    return query;
  });
  return sent;
}

function manager() {
  const m = Object.create(TournamentManagerEliminations.prototype) as any;
  Object.assign(m, {
    tournamentId,
    running: true,
    bountyEvidenceDeferred: new Set(),
    requestUrgentEliminationSweepAfter: vi.fn(),
  });
  return m;
}

async function readEvidence(m: any) {
  const startedAt = Date.now();
  const run = m.loadPersistedBountyEvidence(bustedId);
  await vi.runAllTimersAsync();
  const result = await run;
  return { result, elapsed: Date.now() - startedAt };
}

function deferReason(): string {
  const [error] = fixture.reportError.mock.calls.at(-1) ?? [];
  return String((error as Error | undefined)?.message ?? '');
}

describe('a PKO bust reads its evidence in two trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('sends the candidate with the live seat, then the receipt with the hand', async () => {
    const sent = transport({
      tournament_knockout_candidates: { data: validCandidate },
      table_seats: { data: [] },
      hand_atomic_commits: { data: null },
      hand_history: { data: null },
    });
    const { elapsed } = await readEvidence(manager());
    const at = (table: string) => sent.find((r) => r.table === table)!.sentAt;
    expect(sent.map((r) => r.table).sort()).toEqual([
      'hand_atomic_commits',
      'hand_history',
      'table_seats',
      'tournament_knockout_candidates',
    ]);
    expect(at('table_seats')).toBe(at('tournament_knockout_candidates'));
    expect(at('hand_history')).toBe(at('hand_atomic_commits'));
    expect(at('hand_atomic_commits') - at('tournament_knockout_candidates')).toBe(TRIP_MS);
    expect(elapsed).toBeLessThanOrEqual(2 * TRIP_MS);
  });

  it('applies the checks in the same order: a bad candidate defers before any seat verdict', async () => {
    const sent = transport({
      tournament_knockout_candidates: { data: { ...validCandidate, stack_after: 10 } },
      // Two live seats would veto; the candidate's own identity is judged first.
      table_seats: { data: [{ id: 'a' }, { id: 'b' }] },
    });
    const { result } = await readEvidence(manager());
    expect(result).toBeNull();
    expect(deferReason()).toContain('invalid immutable identity');
    expect(sent.some((r) => r.table === 'hand_atomic_commits')).toBe(false);
  });

  it('an unreadable candidate is still UNKNOWN, never "no evidence"', async () => {
    transport({
      tournament_knockout_candidates: { error: { message: 'timeout' } },
      table_seats: { data: [] },
    });
    const m = manager();
    const { result } = await readEvidence(m);
    expect(result).toBeNull();
    expect(deferReason()).toContain('latest knockout candidate is unreadable');
    expect(m.requestUrgentEliminationSweepAfter).toHaveBeenCalled();
  });

  it('a funded live seat of another generation still vetoes the candidate', async () => {
    const sent = transport({
      tournament_knockout_candidates: { data: validCandidate },
      table_seats: { data: [{ id: 'other', table_id: tableId, joined_at: joinedAt, stack: 3000 }] },
    });
    const { result } = await readEvidence(manager());
    expect(result).toBeNull();
    expect(deferReason()).toContain('a different or funded live seat generation vetoes');
    expect(sent.some((r) => r.table === 'hand_atomic_commits')).toBe(false);
  });

  it('an unreadable or mismatched receipt defers before the hand is consulted', async () => {
    transport({
      tournament_knockout_candidates: { data: validCandidate },
      table_seats: { data: [] },
      hand_atomic_commits: { error: { message: 'down' } },
      hand_history: { data: { id: handId } },
    });
    expect((await readEvidence(manager())).result).toBeNull();
    expect(deferReason()).toContain('atomic receipt for hand #41 is unreadable');

    vi.clearAllMocks();
    transport({
      tournament_knockout_candidates: { data: validCandidate },
      table_seats: { data: [] },
      hand_atomic_commits: { data: null },
      hand_history: { error: { message: 'down' } },
    });
    expect((await readEvidence(manager())).result).toBeNull();
    expect(deferReason()).toContain('does not match its candidate');
  });
});
