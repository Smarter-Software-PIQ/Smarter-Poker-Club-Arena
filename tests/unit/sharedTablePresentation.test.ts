import { describe, expect, it } from 'vitest';
import { applyObservedActionTimes } from '@/lib/sharedTableAppearance';
import { readBoardTiming, recordedFrameOffsets } from '@/lib/sharedBoardTiming';
import { readTableGeometry } from '@/lib/sharedTableGeometry';
import { particleRandom, readSharedThrows, throwSeed } from '@/lib/sharedThrows';
import { magicEightBallAnswer } from '@/throwables/identity';
import type { ReplayFrame } from '@/utils/replayFrames';
import type { ShareableHand } from '@/components/table/ShareHand';

describe('the sender’s table presentation', () => {
  it('preserves observed times on both sides of the flop and after the final action', () => {
    const frames = [
      { key: 'deal', board: [] },
      { key: 'row-blind', row: {} },
      { key: 'row-call', row: { atMs: 1000 } },
      { key: 'street-flop', board: [{}, {}, {}] },
      { key: 'row-check', row: { atMs: 7160 } },
      { key: 'showdown', isShowdown: true },
    ] as ReplayFrame[];
    expect(recordedFrameOffsets(frames, { flop: 6700 }, () => 500, 9940)).toEqual([
      0, 500, 1000, 6700, 7160, 9940,
    ]);
    expect(readBoardTiming({ flop: 650, turn: 400 })).toBeUndefined();
  });

  it('matches archived voluntary actions in order even when the archive added blind posts', () => {
    const hand = {
      preflop: [
        { seat: 1, action: 'SB' },
        { seat: 2, action: 'CALL' },
      ],
    } as ShareableHand;
    applyObservedActionTimes(hand, { preflop: [{ seat: 2, action: 'CALL', atMs: 781 }] });
    expect(hand.preflop.map((row) => row.atMs)).toEqual([undefined, 781]);
    delete hand.preflop[1].atMs;
    applyObservedActionTimes(hand, { preflop: [{ seat: 1, action: 'CALL', atMs: 781 }] });
    expect(hand.preflop[1].atMs).toBeUndefined();
  });

  it('validates the viewport and each seat coordinate', () => {
    const geometry = {
      width: 378,
      height: 591,
      seats: [
        [50, 102],
        [50, 8],
      ],
    };
    expect(readTableGeometry(geometry)).toEqual(geometry);
    const layout = { w: 440, h: 620, x: 31, y: 12, feltW: 378, feltH: 591, viewport: 440 };
    expect(readTableGeometry({ ...geometry, layout })?.layout).toEqual(layout);
    expect(readTableGeometry({ ...geometry, layout: { ...layout, w: 0 } })?.layout).toBeUndefined();
    expect(
      readTableGeometry({
        ...geometry,
        seats: [
          [50, null],
          [0, 0],
        ],
      })
    ).toBeUndefined();
  });

  it('reproduces the same throwable particles and eight-ball answer from the recorded seed', () => {
    const id = 'a83e2287-4287-459b-9e28-643712aedda7';
    const seed = throwSeed(id);
    const wire = readSharedThrows([[1234, 1, 9, 'magic_8_ball', seed]])!;
    const a = particleRandom(seed);
    const b = particleRandom(wire[0][4]);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(magicEightBallAnswer('replay', wire[0][4])).toEqual(magicEightBallAnswer(id));
    expect(readSharedThrows([[1234, 0, 9, 'magic_8_ball', seed]])).toBeUndefined();
  });
});

import { captureChip, readSharedChips, replayChip } from '@/lib/sharedChipFlights';
import { encodePresentation, decodePresentation } from '@/lib/sharedPresentationCodec';
import { readSharedDeal } from '@/lib/sharedDeal';
import { readSeatPaints } from '@/lib/sharedSeatPresentation';

it('round trips a nine-seat hand with the dealt paths and the award after settlement inside a short link budget', () => {
  const seatPaints = Array.from({ length: 180 }, (_, i) => [
    i * 417,
    (i % 9) + 1,
    33,
    0,
    1,
    200 - i,
    2,
    0,
    0,
  ]);
  const deal = {
    at: 120,
    flightMs: 400,
    paths: [
      [50, 50, 20, 80, 0],
      [50, 50, 90, 10, 82],
    ],
  };
  const rect = { left: 20, top: 10, width: 400, height: 500 };
  const chip = captureChip(
    80000,
    {
      id: 'private-id',
      recipientId: 'private-user',
      type: 'to-winner',
      amount: 20,
      delay: 220,
      from: { x: 220, y: 260 },
      to: { x: 40, y: 35 },
    },
    rect
  );
  const data = { seatPaints, deal, chips: [chip] };
  const field = encodePresentation(data);
  expect(Math.ceil((field.length * 4) / 3)).toBeLessThan(6000);
  expect(decodePresentation(field)).toEqual(data);
  expect(readSeatPaints(seatPaints)).toHaveLength(180);
  expect(readSharedDeal(deal)).toEqual(deal);
  expect(readSharedChips([chip])).toEqual([chip]);
  expect(replayChip(chip, 'replayed', rect, 1)).toMatchObject({
    id: 'replayed',
    from: { x: 220, y: 260 },
    to: { x: 40, y: 35 },
    amount: 20,
    delay: 220,
  });
  expect(JSON.stringify(decodePresentation(field))).not.toContain('private');
  expect(decodePresentation('a.' + field.split('.')[1])).toBeUndefined();
  expect(readSharedDeal({ ...deal, paths: [[0, 1, 2, 3, -1]] })).toBeUndefined();
  expect(readSharedChips([[...chip.slice(0, 7), 25, ...chip.slice(8)]])).toBeUndefined();
});

it('keeps the live character gesture and card cover through a public recording', async () => {
  const { seatPaint, seatPaintProps } = await import('@/lib/sharedSeatPresentation');
  const state = seatPaint({
    seatNumber: 4,
    player: {
      id: 'local-only',
      name: 'A',
      status: 'active',
      stack: 220,
      isHero: true,
      showCards: false,
    },
    lastAction: 'check',
    isActive: true,
    recordedGesture: 'alert',
    recordedCardsCovered: true,
  } as Parameters<typeof seatPaint>[0])!;
  const recorded = readSeatPaints(
    decodePresentation(encodePresentation({ seats: [[218, 4, ...state]] }))?.seats
  )!;
  expect(seatPaintProps(recorded[0])).toMatchObject({
    gesture: 'alert',
    covered: true,
    stack: 220,
    action: 'check',
  });
  expect(JSON.stringify(recorded)).not.toContain('local-only');
});
