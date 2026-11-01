import { describe, expect, it } from 'vitest';
import {
  nearestOpponentShift,
  jointOpponentShifts,
  pushOpponentChain,
} from '../../src/components/table/opponentAvatarLayout';

const bounds = { left: 0, top: 80, width: 400, height: 720 };
describe('only the necessary opponent spacing changes', () => {
  it('retains every already clear opponent position', () => {
    expect(
      nearestOpponentShift([{ left: 20, top: 150, width: 80, height: 120 }], [], bounds, -1)
    ).toEqual([0, 0]);
  });
  it('lowers a newly enlarged crown by exactly its header intrusion', () => {
    expect(
      nearestOpponentShift([{ left: 70, top: 65, width: 80, height: 120 }], [], bounds, -1)
    ).toEqual([0, 15]);
  });
  it('clears a fixed community card without resizing or crossing to another chair', () => {
    const part = { left: 110, top: 300, width: 80, height: 120 };
    const board = { left: 180, top: 300, width: 100, height: 90 };
    expect(nearestOpponentShift([part], [board], bounds, -1)).toEqual([-13, 0]);
    expect(part).toEqual({ left: 110, top: 300, width: 80, height: 120 });
  });
  it('reports unavailable space instead of shrinking an avatar or moving the hero', () => {
    expect(
      nearestOpponentShift(
        [{ left: 10, top: 90, width: 100, height: 110 }],
        [{ left: 0, top: 80, width: 400, height: 720 }],
        bounds,
        -1
      )
    ).toBeNull();
  });
  it('keeps side pods on their original rail instead of moving inward', () => {
    const part = { left: 10, top: 90, width: 80, height: 120 };
    const obstruction = { left: 0, top: 80, width: 25, height: 160 };
    const shift = nearestOpponentShift([part], [obstruction], bounds, -1, true);
    expect(shift).not.toBeNull();
    expect(shift![0]).toBeLessThanOrEqual(0);
  });
  it('permits only the inward amount required to clamp enlarged edge artwork', () => {
    const shift = nearestOpponentShift(
      [{ left: -5, top: 100, width: 80, height: 120 }],
      [],
      bounds,
      -1,
      true
    );
    expect(shift).toEqual([5, 0]);
  });
  it('places neighbouring pods jointly rather than reserving their conflicting natural boxes', () => {
    const shifts = jointOpponentShifts(
      [
        { parts: [{ left: 20, top: 100, width: 80, height: 100 }], side: -1, outwardOnly: true },
        { parts: [{ left: 20, top: 190, width: 80, height: 100 }], side: -1, outwardOnly: true },
      ],
      [],
      bounds
    )!;
    expect(shifts).toHaveLength(2);
    expect(shifts.reduce((sum, [x, y]) => sum + x * x + y * y, 0)).toBe(169);
    expect(Math.abs(100 + shifts[0][1] - (190 + shifts[1][1]))).toBeGreaterThanOrEqual(103);
  });
  it('lets the semantic top-centre chair clear corner chrome on either side', () => {
    expect(
      nearestOpponentShift(
        [{ left: 150, top: 80, width: 80, height: 100 }],
        [{ left: 0, top: 80, width: 200, height: 100 }],
        bounds,
        0
      )
    ).toEqual([53, 0]);
  });
});

// Exact permanent paint/panel/chrome rectangles from the compact nine-seat
// regression. The fixture has four Hero cards and the actual upper chat button.
it('fits all eight compact opponents without changing any footprint or covering chrome', () => {
  const scene = {
    items: [
      {
        parts: [
          {
            left: 5.723346659548273,
            top: 91.84856418126836,
            width: 62.055602189442794,
            height: 85.62102074239576,
          },
          { left: 6.125, top: Number('156.29385375976562'), width: 57.75, height: 15 },
          { left: 2, top: 174.421875, width: 66, height: 35.1875 },
        ],
        side: -1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: 255.72334665954827,
            top: 91.84856418126836,
            width: 62.055602189442766,
            height: 85.62102074239576,
          },
          { left: 256.125, top: Number('156.29385375976562'), width: 57.75, height: 15 },
          { left: 252, top: 174.421875, width: 66, height: 35.1875 },
        ],
        side: 1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: 75.72334665954827,
            top: 96.24816134923711,
            width: 62.055602189442794,
            height: 85.62102074239576,
          },
          { left: 72, top: 162.90065002441406, width: 42, height: 13 },
          { left: 72, top: 178.82147216796875, width: 66, height: 35.1875 },
        ],
        side: -1,
        outwardOnly: false,
      },
      {
        parts: [
          {
            left: 185.70772165954827,
            top: 96.24816134923711,
            width: 62.055602189442794,
            height: 85.62102074239576,
          },
          { left: 205.984375, top: 162.90065002441406, width: 42, height: 13 },
          { left: 181.984375, top: 178.82147216796875, width: 66, height: 35.1875 },
        ],
        side: 1,
        outwardOnly: false,
      },
      {
        parts: [
          {
            left: 5.723346659548273,
            top: 188.23918918126836,
            width: 62.055602189442794,
            height: 85.62102074239576,
          },
          { left: 6.125, top: Number('252.68447875976562'), width: 57.75, height: 15 },
          { left: 2, top: 270.8125, width: 66, height: 35.1875 },
        ],
        side: -1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: 255.72334665954827,
            top: 188.23918918126836,
            width: 62.055602189442766,
            height: 85.62102074239576,
          },
          { left: 256.125, top: Number('252.68447875976562'), width: 57.75, height: 15 },
          { left: 252, top: 270.8125, width: 66, height: 35.1875 },
        ],
        side: 1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: 5.723346659548273,
            top: 284.62981418126833,
            width: 62.055602189442794,
            height: 85.62102074239579,
          },
          { left: 6.125, top: 349.0751037597656, width: 57.75, height: 15 },
          {
            left: 31.473880767822266,
            top: 330.6396179199219,
            width: 23.67538070678711,
            height: 14.498016357421875,
          },
          { left: 2, top: 367.203125, width: 66, height: 35.1875 },
        ],
        side: -1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: 255.72334665954827,
            top: 284.62981418126833,
            width: 62.055602189442766,
            height: 85.62102074239579,
          },
          { left: 256.125, top: 349.0751037597656, width: 57.75, height: 15 },
          { left: 252, top: 367.203125, width: 66, height: 35.1875 },
        ],
        side: 1,
        outwardOnly: true,
      },
    ],
    fixed: [
      { left: 266, top: 98, width: 48, height: 48 },
      { left: 6, top: 44, width: 166.234375, height: 22 },
      { left: 6, top: 66, width: 111.734375, height: 19 },
      { left: 78.890625, top: 220.3125, width: 161.65625, height: 44.15625 },
      { left: 121.890625, top: 436.921875, width: 76.1875, height: 42.0625 },
      { left: 206.078125, top: 396.6875, width: 46.171875, height: 64.640625 },
      { left: 226.859375, top: 396.6875, width: 46.171875, height: 64.640625 },
      { left: 247.640625, top: 396.6875, width: 46.171875, height: 64.640625 },
      { left: 268.421875, top: 396.6875, width: 46.171875, height: 64.640625 },
      { left: 0, top: 515, width: 320, height: 53 },
      {
        left: 131.17846733901172,
        top: 356.60712795798423,
        width: 62.05551020803807,
        height: 85.62089383134366,
      },
    ],
    bounds: { left: 2, top: 44.5, width: 316, height: 520.5 },
  };
  const alphaBands = [
    { left: 0.1729957805907173, top: 0.0, width: 0.620253164556962, height: 0.03058103975535168 },
    {
      left: 0.14345991561181434,
      top: 0.03058103975535168,
      width: 0.6751054852320675,
      height: 0.09174311926605505,
    },
    {
      left: 0.07172995780590717,
      top: 0.12232415902140673,
      width: 0.8270042194092827,
      height: 0.21100917431192662,
    },
    { left: 0.0, top: 0.3333333333333333, width: 1.0, height: 0.3333333333333333 },
    {
      left: 0.008438818565400843,
      top: 0.6666666666666666,
      width: 0.9915611814345991,
      height: 0.3333333333333333,
    },
  ];
  const split = (art: (typeof scene.fixed)[number]) =>
    alphaBands.map((band) => ({
      left: art.left + band.left * art.width,
      top: art.top + band.top * art.height,
      width: band.width * art.width,
      height: band.height * art.height,
    }));
  scene.items.forEach((item) => {
    item.parts = [...split(item.parts[0]), ...item.parts.slice(1)];
  });
  scene.fixed = [...scene.fixed.slice(0, -1), ...split(scene.fixed[scene.fixed.length - 1])];
  const before = JSON.stringify(scene);
  const boardTop = scene.fixed[3].top;
  const shifts = jointOpponentShifts(scene.items, scene.fixed, scene.bounds, 0, true, boardTop);
  expect(shifts).not.toBeNull();
  const overlap = (a: (typeof scene.fixed)[number], b: (typeof scene.fixed)[number]) =>
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top;
  const moved = scene.items.map((item, i) =>
    item.parts.map((p) => ({ ...p, left: p.left + shifts![i][0], top: p.top + shifts![i][1] }))
  );
  moved.forEach((parts, i) => {
    for (const part of parts) {
      expect(part.left).toBeGreaterThanOrEqual(scene.bounds.left);
      expect(part.top).toBeGreaterThanOrEqual(scene.bounds.top);
      expect(part.left + part.width).toBeLessThanOrEqual(scene.bounds.left + scene.bounds.width);
      expect(part.top + part.height).toBeLessThanOrEqual(scene.bounds.top + scene.bounds.height);
      expect(scene.fixed.some((fixed) => overlap(part, fixed))).toBe(false);
      expect(
        moved.some((others, k) => i !== k && others.some((other) => overlap(part, other)))
      ).toBe(false);
    }
    if (scene.items[i].outwardOnly && shifts![i][0] * scene.items[i].side < -0.01)
      expect(Math.max(...parts.map((p) => p.top + p.height))).toBeLessThanOrEqual(boardTop);
    expect(Math.abs(shifts![i][1])).toBeLessThan(50);
  });
  expect(JSON.stringify(scene)).toBe(before);
});

it('pushes only a directly blocking peer by its minimum contact distance', () => {
  const first = { parts: [{ left: 10, top: 100, width: 60, height: 100 }] };
  const second = { parts: [{ left: 10, top: 205, width: 60, height: 100 }] };
  const third = { parts: [{ left: 10, top: 309, width: 60, height: 100 }] };
  const detached = { parts: [{ left: 200, top: 200, width: 60, height: 100 }] };
  const scene = [first, second, third, detached];
  const before = JSON.stringify(scene);
  const shifts = pushOpponentChain(scene, 0, 11, [], bounds)!;
  expect(shifts[0]).toBe(11);
  expect(shifts[1]).toBeCloseTo(6.001, 6);
  expect(shifts[2]).toBeCloseTo(2.002, 6);
  expect(shifts[3]).toBe(0);
  expect(JSON.stringify(scene)).toBe(before);
});
it('refuses a contact cascade that would cover fixed cards or leave its cap lane', () => {
  const scene = [
    { parts: [{ left: 10, top: 100, width: 60, height: 100 }] },
    { parts: [{ left: 10, top: 205, width: 60, height: 100 }] },
  ];
  expect(
    pushOpponentChain(scene, 0, 11, [{ left: 10, top: 307, width: 60, height: 30 }], bounds)
  ).toBeNull();
  expect(
    pushOpponentChain([{ ...scene[0], capBottom: 205 }, scene[1]], 0, 11, [], bounds)
  ).toBeNull();
});
it('supports the same bounded contact cascade upward', () => {
  expect(
    pushOpponentChain(
      [
        { parts: [{ left: 10, top: 220, width: 60, height: 100 }] },
        { parts: [{ left: 10, top: 115, width: 60, height: 100 }] },
      ],
      0,
      -11,
      [],
      bounds
    )
  ).toEqual([-11, -6.001]);
});

it('does not cascade an adjacent flush plate for float32 shared-edge noise', () => {
  const shifted = pushOpponentChain(
    [
      { parts: [{ left: 2, top: 100, width: 66, height: 100 }] },
      { parts: [{ left: 67.99999237060547, top: 100, width: 66, height: 100 }] },
    ],
    0,
    10,
    [{ left: 68, top: 210, width: 66, height: 30 }],
    bounds
  );
  expect(shifted).toEqual([10, 0]);
});

it('still cascades a real hundredth-pixel overlap and refuses a blocked peer', () => {
  const scene = [
    { parts: [{ left: 2, top: 100, width: 66, height: 100 }] },
    { parts: [{ left: 67.99, top: 100, width: 66, height: 100 }] },
  ];
  const shifts = pushOpponentChain(scene, 0, 10, [], bounds)!;
  expect(shifts[0]).toBe(10);
  expect(shifts[1]).toBeCloseTo(110.001, 6);
  expect(
    pushOpponentChain(scene, 0, 10, [{ left: 68, top: 210, width: 66, height: 30 }], bounds)
  ).toBeNull();
});

it('keeps wager nudges local to both the owner and every contacted peer', () => {
  const scene = [
    { parts: [{ left: 10, top: 100, width: 60, height: 100 }] },
    { parts: [{ left: 10, top: 205, width: 60, height: 20 }] },
  ];
  const limits = [50, 10];
  expect(pushOpponentChain(scene, 0, 200, [], bounds, limits)).toBeNull();
  const unbounded = pushOpponentChain(scene, 0, 30, [], bounds)!;
  expect(unbounded[1]).toBeCloseTo(25.001, 6);
  expect(pushOpponentChain(scene, 0, 30, [], bounds, limits)).toBeNull();
  const local = pushOpponentChain(scene, 0, 11, [], bounds, limits)!;
  expect(local[0]).toBe(11);
  expect(local[1]).toBeCloseTo(6.001, 6);
});
