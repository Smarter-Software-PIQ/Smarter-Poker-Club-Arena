import { expect, it } from 'vitest';
import { inspectHorseSeats, seatAuthority, type SeatPaints } from '../e2e/support/horseSeatWitness';
const atSeat = { id: 'horse', seat: 3, badge: 'waiting' as const };
const horse = new Set(['horse']);
const expected = (
  at: number,
  hand: number,
  socket: number,
  badge: 'waiting' | 'sitting-out' | null = 'waiting'
) => ({ at, hand, socket, seats: [{ ...atSeat, badge, playing: badge === null }] });
const paint = (at: number, avatar = true, badge: 'waiting' | 'sitting-out' | null = 'waiting') => ({
  at,
  seats: [{ ...atSeat, badge, avatar }],
});
const inspect = (
  changes: SeatPaints['changes'],
  wire: ReturnType<typeof seatAuthority>,
  exits: Parameters<typeof inspectHorseSeats>[3] = []
) => inspectHorseSeats({ changes, dropped: 0 }, wire, horse, exits, 10000);
it('detects a painted loss of the held chair, avatar or tag under unchanged engine authority', () => {
  for (const broken of [{ at: 3000, seats: [] }, paint(3000, false), paint(3000, true, null)]) {
    expect(inspect([paint(100), broken, paint(3100)], [expected(0, 1, 1)]).violations).not.toEqual(
      []
    );
  }
});
it('distinguishes reconnect, admission and natural departure from loss of the waiting badge', () => {
  const paints = [paint(100), paint(6000, true, null), { at: 8100, seats: [] }];
  const wire = [
    expected(0, 1, 1),
    expected(2000, 2, 1),
    expected(4000, 2, 2),
    expected(6000, 3, 2, null),
    { at: 8000, hand: 3, socket: 2, seats: [] },
  ];
  expect(inspect(paints, wire).status.departure).toBe('UNOBSERVED');
  const result = inspect(paints, wire, [
    { user_id: 'horse', seat_number: 3, occurred_at: new Date(8000).toISOString() },
  ]);
  expect(result.violations).toEqual([]);
  expect(result.status).toMatchObject({
    waiting: 'OBSERVED',
    waitingAcrossHands: 'OBSERVED',
    admission: 'OBSERVED',
    reconnect: 'OBSERVED',
    departure: 'OBSERVED',
    sittingOut: 'UNOBSERVED',
  });
});
it('identifies sitting out across hands and keeps absent natural transitions unknown', () => {
  const result = inspect(
    [paint(100, true, 'sitting-out')],
    [expected(0, 1, 1, 'sitting-out'), expected(2000, 2, 1, 'sitting-out')]
  );
  expect(result.status).toMatchObject({
    sittingOutAcrossHands: 'OBSERVED',
    waiting: 'UNOBSERVED',
    reconnect: 'UNOBSERVED',
    departure: 'UNOBSERVED',
  });
});

it('keeps a durable Horse seat visible even when the roster and screen both lose it between hands', () => {
  const lease = {
    occupancy_id: 'occupancy',
    user_id: 'horse',
    seat_number: 3,
    is_sitting_out: false,
  };
  const result = inspectHorseSeats(
    { changes: [paint(100), { at: 3000, seats: [] }, paint(3100)], dropped: 0 },
    [expected(0, 1, 1), { at: 3000, hand: 2, socket: 1, seats: [] }, expected(3100, 2, 1)],
    horse,
    [],
    10000,
    [lease]
  );
  expect(result.violations).toContain('horse/3: durable avatar missing');
});

it('projects the public seat subset through contiguous deltas and refuses a gap', () => {
  const frame = (at: number, message: Record<string, unknown>) => ({
    at,
    socketId: 1,
    direction: 'received' as const,
    message,
  });
  const first = frame(0, {
    type: 'SNAPSHOT',
    seq: 5,
    state: {
      hand_number: 1,
      waiting_for_bb_user_ids: ['horse'],
      players: [{ seat: 3, user_id: 'horse', is_sitting_out: true, stack: 100 }],
    },
  });
  const later = frame(1, {
    type: 'DELTA',
    seq: 6,
    prev: 5,
    patch: [{ op: 'replace', path: '/waiting_for_bb_user_ids', value: [] }],
  });
  const wire = seatAuthority([first, later]);
  expect(wire.map((r) => r.seats[0].badge)).toEqual(['waiting', 'sitting-out']);
  expect(JSON.stringify(wire)).not.toContain('stack');
  expect(() =>
    seatAuthority([first, { ...later, message: { ...later.message, prev: 2 } }])
  ).toThrow('Discontinuous');
});

it('detects a one-paint badge loss coincident with a new hand', () => {
  const result = inspect(
    [paint(100), paint(2000, true, null), paint(2016)],
    [expected(0, 1, 1), expected(2000, 2, 1)]
  );
  expect(result.violations).toContain('horse/3: badge mismatch');
});
it('never uses a later exit receipt to explain an earlier disappearance', () => {
  const result = inspect(
    [paint(100), { at: 3000, seats: [] }, { at: 8100, seats: [] }],
    [expected(0, 1, 1), { at: 3000, hand: 2, socket: 1, seats: [] }],
    [{ user_id: 'horse', seat_number: 3, occurred_at: new Date(8000).toISOString() }]
  );
  expect(result.status.departure).toBe('UNOBSERVED');
});
it('rejects a stale database sit-out badge on an authoritative playing seat', () => {
  const result = inspectHorseSeats(
    { changes: [paint(100, true, 'sitting-out')], dropped: 0 },
    [expected(0, 1, 1, null)],
    horse,
    [],
    10000,
    [{ user_id: 'horse', seat_number: 3, occupancy_id: 'lease', is_sitting_out: true }]
  );
  expect(result.violations).toContain('horse/3: badge mismatch');
});
