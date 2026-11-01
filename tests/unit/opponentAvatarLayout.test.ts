import { describe, expect, it, vi } from 'vitest';
import {
  createOpponentAvatarLayout,
  nearestOpponentShift,
  opponentIdleEnvelope,
  opponentCaptionBounds,
  syncOpponentCaptionBoundary,
  type OpponentAvatarState,
  opponentIdleSpans,
  jointOpponentShifts,
  pushOpponentChain,
  opponentFitsLowerLane,
  opponentShiftTransaction,
  opponentPaintSpansTouch,
  readOpponentAlphaSpans,
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

it('fits broad characters in a bounded below-board lane while preserving every footprint', () => {
  // Exact conservative decoded strips retain every painted pixel; solid hulls
  // would incorrectly block transparent crown corners in this compact lane.
  const scene = {
    items: [
      {
        parts: [
          {
            left: 389.491574117438,
            top: Number('153.50697580388982'),
            width: Number('79.48976268665126'),
            height: Number('4.608102184733411'),
          },
          {
            left: Number('374.51524201705445'),
            top: Number('158.11507798862323'),
            width: Number('110.01843966051007'),
            height: Number('13.824306554200206'),
          },
          {
            left: Number('367.02707596686264'),
            top: Number('171.93938454282343'),
            width: Number('125.57078453398537'),
            height: 31.1046897469505,
          },
          {
            left: Number('361.26694823594585'),
            top: Number('203.04407428977393'),
            width: Number('136.5150272227272'),
            height: Number('49.537098485884144'),
          },
          {
            left: Number('362.9949865552209'),
            top: Number('252.58117277565808'),
            width: Number('133.05895058417713'),
            height: Number('50.11311125897575'),
          },
          {
            left: 390.53125,
            top: Number('277.1431884765625'),
            width: 82.5625,
            height: 20,
          },
          {
            left: 381.8125,
            top: Number('300.1432189941406'),
            width: 96,
            height: 37.1875,
          },
        ],
        side: 1,
        outwardOnly: false,
      },
      {
        parts: [
          {
            left: Number('128.83532411743798'),
            top: Number('156.24782053045232'),
            width: Number('79.48976268665126'),
            height: Number('4.608102184733411'),
          },
          {
            left: Number('113.8589920170544'),
            top: Number('160.85592271518573'),
            width: Number('110.01843966051008'),
            height: Number('13.824306554200206'),
          },
          {
            left: Number('106.37082596686261'),
            top: Number('174.68022926938593'),
            width: Number('125.57078453398535'),
            height: 31.1046897469505,
          },
          {
            left: Number('100.61069823594586'),
            top: Number('205.78491901633643'),
            width: Number('136.5150272227272'),
            height: Number('49.537098485884144'),
          },
          {
            left: Number('102.33873655522089'),
            top: Number('255.32201750222058'),
            width: Number('133.0589505841771'),
            height: Number('50.11311125897575'),
          },
          {
            left: 125.875,
            top: 279.884033203125,
            width: 82.5625,
            height: 20,
          },
          {
            left: 121.15625,
            top: Number('302.8840637207031'),
            width: 96,
            height: 37.1875,
          },
        ],
        side: -1,
        outwardOnly: false,
      },
      {
        parts: [
          {
            left: Number('21.17914173009111'),
            top: Number('175.27809114874574'),
            width: Number('79.48961895568758'),
            height: Number('4.608093852503629'),
          },
          {
            left: Number('6.202836709454324'),
            top: Number('179.88618500124937'),
            width: Number('110.01824072852409'),
            height: Number('13.824281557510886'),
          },
          {
            left: Number('-1.2853158008640726'),
            top: Number('193.71046655876026'),
            width: Number('125.57055748072383'),
            height: Number('31.10463350439946'),
          },
          {
            left: Number('-7.045433116493607'),
            top: Number('224.81510006315972'),
            width: Number('136.51478038041995'),
            height: 49.537008914414,
          },
          {
            left: Number('-5.317397921804746'),
            top: Number('274.3521089775737'),
            width: Number('133.05870999104224'),
            height: Number('50.11302064597692'),
          },
          {
            left: 18.21875,
            top: Number('298.9140930175781'),
            width: 82.5625,
            height: 20,
          },
          {
            left: 5.5,
            top: 321.9140625,
            width: 112,
            height: 37.1875,
          },
        ],
        side: -1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: Number('497.14789173009115'),
            top: Number('175.27809114874574'),
            width: Number('79.48961895568755'),
            height: Number('4.608093852503629'),
          },
          {
            left: Number('482.17158670945435'),
            top: Number('179.88618500124937'),
            width: Number('110.01824072852412'),
            height: Number('13.824281557510886'),
          },
          {
            left: Number('474.68343419913595'),
            top: Number('193.71046655876026'),
            width: Number('125.57055748072389'),
            height: Number('31.10463350439946'),
          },
          {
            left: Number('468.9233168835064'),
            top: Number('224.81510006315972'),
            width: Number('136.51478038041995'),
            height: 49.537008914414,
          },
          {
            left: Number('470.65135207819526'),
            top: Number('274.3521089775737'),
            width: Number('133.05870999104218'),
            height: Number('50.11302064597692'),
          },
          {
            left: 498.1875,
            top: Number('298.9140930175781'),
            width: 82.5625,
            height: 20,
          },
          {
            left: 481.46875,
            top: 321.9140625,
            width: 112,
            height: 37.1875,
          },
        ],
        side: 1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: Number('21.179141730091118'),
            top: Number('442.4187161487458'),
            width: Number('79.48961895568756'),
            height: 4.6080938525036,
          },
          {
            left: Number('6.202836709454335'),
            top: Number('447.0268100012494'),
            width: Number('110.01824072852408'),
            height: Number('13.824281557510915'),
          },
          {
            left: Number('-1.2853158008640602'),
            top: Number('460.8510915587603'),
            width: Number('125.5705574807238'),
            height: Number('31.104633504399487'),
          },
          {
            left: Number('-7.045433116493593'),
            top: Number('491.9557250631598'),
            width: Number('136.51478038041992'),
            height: Number('49.537008914413946'),
          },
          {
            left: Number('-5.317397921804734'),
            top: Number('541.4927339775737'),
            width: Number('133.0587099910422'),
            height: Number('50.11302064597692'),
          },
          {
            left: 18.21875,
            top: 566.0546875,
            width: 82.5625,
            height: 20,
          },
          {
            left: 5.5,
            top: 589.0546875,
            width: 112,
            height: 37.1875,
          },
        ],
        side: -1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: Number('497.14789173009115'),
            top: Number('442.4187161487458'),
            width: Number('79.48961895568755'),
            height: 4.6080938525036,
          },
          {
            left: Number('482.17158670945435'),
            top: Number('447.0268100012494'),
            width: Number('110.01824072852412'),
            height: Number('13.824281557510915'),
          },
          {
            left: Number('474.68343419913595'),
            top: Number('460.8510915587603'),
            width: Number('125.57055748072378'),
            height: Number('31.104633504399487'),
          },
          {
            left: Number('468.9233168835064'),
            top: Number('491.9557250631598'),
            width: Number('136.51478038041995'),
            height: Number('49.537008914413946'),
          },
          {
            left: Number('470.65135207819526'),
            top: Number('541.4927339775737'),
            width: Number('133.05870999104218'),
            height: Number('50.11302064597692'),
          },
          {
            left: 498.1875,
            top: 566.0546875,
            width: 82.5625,
            height: 20,
          },
          {
            left: 481.46875,
            top: 589.0546875,
            width: 112,
            height: 37.1875,
          },
        ],
        side: 1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: Number('35.33539173009112'),
            top: Number('640.7312161487457'),
            width: Number('79.48961895568756'),
            height: Number('4.608093852503657'),
          },
          {
            left: Number('20.359086709454335'),
            top: Number('645.3393100012494'),
            width: Number('110.01824072852408'),
            height: Number('13.824281557510858'),
          },
          {
            left: Number('12.87093419913594'),
            top: Number('659.1635915587602'),
            width: Number('125.5705574807238'),
            height: Number('31.104633504399544'),
          },
          {
            left: Number('7.110816883506407'),
            top: Number('690.2682250631598'),
            width: Number('136.51478038041992'),
            height: Number('49.537008914413946'),
          },
          {
            left: Number('8.838852078195266'),
            top: Number('739.8052339775737'),
            width: Number('133.0587099910422'),
            height: Number('50.11302064597692'),
          },
          {
            left: 32.375,
            top: Number('764.3672485351562'),
            width: 82.5625,
            height: 20,
          },
          {
            left: Number('82.15809631347656'),
            top: Number('733.0078735351562'),
            width: Number('23.506690979003906'),
            height: Number('14.39471435546875'),
          },
          {
            left: 19.65625,
            top: 787.3671875,
            width: 112,
            height: 37.1875,
          },
        ],
        side: -1,
        outwardOnly: true,
      },
      {
        parts: [
          {
            left: Number('482.99164173009115'),
            top: Number('640.7312161487457'),
            width: Number('79.48961895568755'),
            height: Number('4.608093852503657'),
          },
          {
            left: Number('468.01533670945435'),
            top: Number('645.3393100012494'),
            width: Number('110.01824072852412'),
            height: Number('13.824281557510858'),
          },
          {
            left: Number('460.52718419913595'),
            top: Number('659.1635915587602'),
            width: Number('125.57055748072378'),
            height: Number('31.104633504399544'),
          },
          {
            left: Number('454.7670668835064'),
            top: Number('690.2682250631598'),
            width: Number('136.51478038041995'),
            height: Number('49.537008914413946'),
          },
          {
            left: Number('456.49510207819526'),
            top: Number('739.8052339775737'),
            width: Number('133.05870999104218'),
            height: Number('50.11302064597692'),
          },
          {
            left: 484.03125,
            top: Number('764.3672485351562'),
            width: 82.5625,
            height: 20,
          },
          {
            left: 467.3125,
            top: 787.3671875,
            width: 112,
            height: 37.1875,
          },
        ],
        side: 1,
        outwardOnly: true,
      },
    ],
    fixed: [
      {
        left: 553,
        top: 132,
        width: 40,
        height: 40,
      },
      {
        left: 101.8984375,
        top: 407.953125,
        width: 394.015625,
        height: 108.65625,
      },
      {
        left: 242.7890625,
        top: 951.6171875,
        width: 113.390625,
        height: 54.578125,
      },
      {
        left: 375.6953125,
        top: 867.9765625,
        width: 78.75,
        height: 110.265625,
      },
      {
        left: 411.1328125,
        top: 867.9765625,
        width: 78.75,
        height: 110.265625,
      },
      {
        left: 446.5703125,
        top: 867.9765625,
        width: 78.75,
        height: 110.265625,
      },
      {
        left: 482.0078125,
        top: 867.9765625,
        width: 78.75,
        height: 110.265625,
      },
      {
        left: 0,
        top: 1005.46875,
        width: 599,
        height: 59.53125,
      },
      {
        left: Number('259.3365026530004'),
        top: Number('809.2023716435773'),
        width: 79.4896723941228,
        height: Number('4.608096950383924'),
      },
      {
        left: Number('244.36018756425267'),
        top: Number('813.8104685939612'),
        width: Number('110.01831469041633'),
        height: Number('13.824290851151773'),
      },
      {
        left: Number('236.87203001987876'),
        top: 827.634759445113,
        width: Number('125.5706418979621'),
        height: Number('31.104654415091545'),
      },
      {
        left: Number('231.11190883189886'),
        top: Number('858.7394138602045'),
        width: Number('136.51487215512395'),
        height: Number('49.53704221662724'),
      },
      {
        left: Number('232.83994518829283'),
        top: Number('908.2764560768318'),
        width: Number('133.05879944233598'),
        height: Number('50.11305433542532'),
      },
    ],
    bounds: {
      left: 2,
      top: 78.5,
      width: 595,
      height: 983.5,
    },
  };
  scene.fixed.push({ left: 260.1953125, top: 740.7734375, width: 82.5625, height: 20 });
  const before = JSON.stringify(scene);
  const board = scene.fixed[1];
  const lower = {
    top: board.top + board.height + 3 + 1 / 32,
    bottom:
      Math.min(
        ...scene.fixed
          .slice(2)
          .filter((p) => p.top > 600)
          .map((p) => p.top)
      ) -
      3 -
      1 / 32,
  };
  const shifts = jointOpponentShifts(
    scene.items,
    scene.fixed,
    scene.bounds,
    3,
    true,
    board.top,
    lower
  )!;
  expect(shifts).not.toBeNull();
  const overlaps = (a: typeof board, b: typeof board) =>
    a.left < b.left + b.width + 3 - 1e-7 &&
    a.left + a.width + 3 > b.left + 1e-7 &&
    a.top < b.top + b.height + 3 - 1e-7 &&
    a.top + a.height + 3 > b.top + 1e-7;
  const moved = scene.items.map((item, i) =>
    item.parts.map((p) => ({
      ...p,
      left: p.left + shifts[i][0],
      top: p.top + shifts[i][1],
    }))
  );
  let usedLowerLane = false;
  moved.forEach((parts, i) => {
    const item = scene.items[i];
    for (const part of parts) {
      expect(part.left).toBeGreaterThanOrEqual(scene.bounds.left);
      expect(part.top).toBeGreaterThanOrEqual(scene.bounds.top);
      expect(part.left + part.width).toBeLessThanOrEqual(scene.bounds.left + scene.bounds.width);
      expect(part.top + part.height).toBeLessThanOrEqual(scene.bounds.top + scene.bounds.height);
      expect(scene.fixed.some((fixed) => overlaps(part, fixed))).toBe(false);
      expect(moved.some((other, k) => k !== i && other.some((p) => overlaps(part, p)))).toBe(false);
      expect(
        (part.left + part.width / 2 - scene.bounds.left - scene.bounds.width / 2) * item.side
      ).toBeGreaterThanOrEqual(0);
    }
    const natural = {
      left: Math.min(...item.parts.map((p) => p.left)),
      right: Math.max(...item.parts.map((p) => p.left + p.width)),
      top: Math.min(...item.parts.map((p) => p.top)),
      bottom: Math.max(...item.parts.map((p) => p.top + p.height)),
    };
    const clamp =
      item.side < 0
        ? Math.max(0, scene.bounds.left - natural.left)
        : Math.max(0, natural.right - scene.bounds.left - scene.bounds.width);
    const movedTop = Math.min(...parts.map((p) => p.top));
    const movedBottom = Math.max(...parts.map((p) => p.top + p.height));
    if (item.outwardOnly && shifts[i][0] * item.side < -clamp - 0.01 && movedBottom > board.top) {
      usedLowerLane = true;
      expect(movedTop).toBeGreaterThanOrEqual(lower.top);
      expect(movedBottom).toBeLessThanOrEqual(lower.bottom);
    }
    expect(Math.abs(shifts[i][1])).toBeLessThanOrEqual((natural.bottom - natural.top) / 2);
  });
  expect(usedLowerLane).toBe(true);
  expect(JSON.stringify(scene)).toBe(before);
});
it('keeps later wager transactions within their assigned lower lane', () => {
  const pods = [
    { parts: [{ left: 10, top: 210, width: 60, height: 100 }], laneTop: 201, laneBottom: 350 },
  ];
  expect(pushOpponentChain(pods, 0, -11, [], bounds)).toBeNull();
  expect(pushOpponentChain(pods, 0, 45, [], bounds)).toBeNull();
  expect(pushOpponentChain(pods, 0, 5, [], bounds)).toEqual([5]);
});

it('retains a clear lower pod across harmless bounds changes and rejects a real obstruction', () => {
  const parts = [{ left: 10, top: 210, width: 60, height: 100 }];
  expect(opponentFitsLowerLane(parts, { top: 201, bottom: 350 })).toBe(true);
  expect(opponentFitsLowerLane(parts, { top: 205, bottom: 325 })).toBe(true);
  expect(opponentFitsLowerLane(parts, { top: 220, bottom: 350 })).toBe(false);
  expect(opponentFitsLowerLane(parts, { top: 201, bottom: 305 })).toBe(false);
  expect(
    opponentFitsLowerLane(parts, { top: 201, bottom: 350 }, [
      { left: 10, top: 300, width: 60, height: 20 },
    ])
  ).toBe(false);
});

describe('atomic nested opponent wager proposals', () => {
  const setup = () => {
    const a = document.createElement('div'),
      b = document.createElement('div');
    a.style.setProperty('--sp-opponent-y', '10px');
    b.style.setProperty('--sp-opponent-y', '20px');
    const shifts = new WeakMap<HTMLElement, [number, number]>([
      [a, [0, 10]],
      [b, [0, 20]],
    ]);
    return { a, b, seats: [a, b], shifts };
  };
  it('restores an accepted nested peer when the outer proposal rejects or throws', () => {
    for (const throws of [false, true]) {
      const { a, b, seats, shifts } = setup();
      const propose = () =>
        opponentShiftTransaction(seats, shifts, () => {
          a.style.setProperty('--sp-opponent-y', '15px');
          expect(
            opponentShiftTransaction(seats, shifts, () => {
              b.style.setProperty('--sp-opponent-y', '25px');
              return true;
            })
          ).toBe(true);
          if (throws) throw new Error('Rejected Trial');
          return false;
        });
      if (throws) expect(propose).toThrow('Rejected Trial');
      else expect(propose()).toBe(false);
      expect([a, b].map((s) => s.style.getPropertyValue('--sp-opponent-y'))).toEqual([
        '10px',
        '20px',
      ]);
      expect([shifts.get(a), shifts.get(b)]).toEqual([
        [0, 10],
        [0, 20],
      ]);
    }
  });
  it('commits final nested positions without losing the outer displacement', () => {
    const { a, b, seats, shifts } = setup();
    expect(
      opponentShiftTransaction(seats, shifts, () => {
        a.style.setProperty('--sp-opponent-y', '15px');
        return opponentShiftTransaction(seats, shifts, () => {
          a.style.setProperty(
            '--sp-opponent-y',
            `${parseFloat(a.style.getPropertyValue('--sp-opponent-y')) + 2}px`
          );
          b.style.setProperty('--sp-opponent-y', '25px');
          return true;
        });
      })
    ).toBe(true);
    expect([shifts.get(a), shifts.get(b)]).toEqual([
      [0, 17],
      [0, 25],
    ]);
    expect(a.style.getPropertyValue('--sp-opponent-y')).toBe('17px');
  });
});

it('keeps the transparent gap between decoded crown spans clear without discarding either ear', () => {
  const spans = [
    { left: 0, top: 0, right: 0.2, bottom: 0.1 },
    { left: 0.8, top: 0, right: 1, bottom: 0.1 },
  ];
  const content = { left: 100, top: 50, width: 100, height: 100 };
  expect(
    opponentPaintSpansTouch(spans, content, { left: 125, top: 48, width: 50, height: 10 }, 2)
  ).toBe(false);
  expect(opponentPaintSpansTouch(spans, content, { left: 119, top: 50, width: 5, height: 5 })).toBe(
    true
  );
  expect(opponentPaintSpansTouch(spans, content, { left: 176, top: 50, width: 5, height: 5 })).toBe(
    true
  );
  expect(
    opponentPaintSpansTouch(spans, content, { left: 121, top: 50, width: 5, height: 5 }, 2)
  ).toBe(true);
});

it('discards excessive alpha-run precision instead of truncating painted coverage', () => {
  const width = 130,
    height = 130,
    pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if ((x + y) % 2 === 0) pixels[(y * width + x) * 4 + 3] = 255;
  expect(readOpponentAlphaSpans(pixels, width, height)).toBeUndefined();
  const simple = new Uint8ClampedArray(4 * 4);
  simple[3] = 13;
  simple[7] = 12;
  simple[11] = 0;
  simple[15] = 255;
  expect(readOpponentAlphaSpans(simple, 4, 1)).toEqual([
    { left: 0, right: 0.25, top: 0, bottom: 1 },
    { left: 0.75, right: 1, top: 0, bottom: 1 },
  ]);
});

it('reserves complete idle paint only for peer contact, retaining permanent fixed bounds', () => {
  const art = { left: 0, top: 101, width: 10, height: 10 };
  const peerParts = opponentIdleEnvelope([art], [5, 111], 1);
  expect(peerParts[0].top).toBeCloseTo(99.42);
  expect(peerParts[0].left).toBeCloseTo(-0.04);
  const shifts = pushOpponentChain(
    [{ parts: [{ left: 0, top: 90, width: 10, height: 9 }] }, { parts: [art], peerParts }],
    0,
    0.5,
    [],
    { left: 0, top: 90, width: 40, height: 200 }
  );
  expect(shifts).not.toBeNull();
  expect(shifts![0]).toBe(0.5);
  expect(shifts![1]).toBeCloseTo(0.081);
  // Idle paint may extend outside a permanent rail bound; only static art
  // determines that bound. Peer contact still needs the complete envelope.
  expect(peerParts[0].left).toBeLessThan(0);
  expect(art.left).toBe(0);
});

it('keeps transparent ear gaps while reserving actual idle-swept wager paint', () => {
  const content = { left: 10, top: 100, width: 100, height: 100 };
  const spans = [
    { left: 0, right: 0.2, top: 0, bottom: 0.1 },
    { left: 0.8, right: 1, top: 0, bottom: 0.1 },
  ];
  const swept = opponentIdleSpans(spans, content, [60, 200], 1);
  const rise = { left: 15, top: 98, width: 2, height: 1 };
  expect(opponentPaintSpansTouch(spans, content, rise)).toBe(false);
  expect(opponentPaintSpansTouch(swept, content, rise)).toBe(true);
  expect(opponentPaintSpansTouch(swept, content, { left: 50, top: 98, width: 10, height: 8 })).toBe(
    false
  );
  // Every actual intermediate pose lies within its own swept alpha run.
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const factor = 1 + 0.008 * t;
    const left = 60 + (15 - 60) * factor;
    const top = 200 + (100 - 200) * factor - 1.5 * t;
    expect(opponentPaintSpansTouch(swept, content, { left, top, width: 1, height: 1 })).toBe(true);
  }
});

describe('bounded opponent fact positioning', () => {
  it('keeps the exact compact proof inside the real lower third, without changing sizes', () => {
    const info = { left: 200, top: 155.74537658691406, width: 66, height: 35.1875 };
    const art = { left: 204, top: 73.25191289822516, width: 62, height: 85.49343321420204 };
    const bounds = opponentCaptionBounds(info, art);
    expect(bounds.minTop).toBeCloseTo(Number('130.24753504102652'));
    expect(bounds.maxRaise).toBeCloseTo(25.49784154588754);
    expect(info).toEqual({ left: 200, top: 155.74537658691406, width: 66, height: 35.1875 });
    expect(bounds.minTop).toBeGreaterThan(art.top + art.height - info.height);
    const shortInfo = { ...info, height: 12 };
    expect(opponentCaptionBounds(shortInfo, art).minTop).toBeCloseTo(art.top + art.height - 12);
  });
  it('restores every nested INFO and ACTION translation, including throw and priorities', () => {
    for (const throws of [false, true]) {
      const seats = [document.createElement('div'), document.createElement('div')];
      seats.forEach(
        (seat) =>
          (seat.innerHTML = '<div class="seat__info"></div><div class="seat__action"></div>')
      );
      const captions = seats.flatMap((seat) => [...seat.children] as HTMLElement[]);
      captions[0].style.setProperty('translate', '1px 2px', 'important');
      const before = captions.map((c) => [
        c.style.getPropertyValue('translate'),
        c.style.getPropertyPriority('translate'),
      ]);
      const shifts = new WeakMap<HTMLElement, [number, number]>(seats.map((s) => [s, [0, 0]]));
      const trial = () =>
        opponentShiftTransaction(seats, shifts, () => {
          captions[0].style.setProperty('translate', '0px -12px');
          captions[1].style.setProperty('translate', '0px -25px');
          expect(
            opponentShiftTransaction(seats, shifts, () => {
              captions[2].style.setProperty('translate', '0px -17px');
              captions[3].style.setProperty('translate', '0px -19px');
              return true;
            })
          ).toBe(true);
          if (throws) throw new Error('Rejected Caption');
          return false;
        });
      if (throws) expect(trial).toThrow('Rejected Caption');
      else expect(trial()).toBe(false);
      expect(
        captions.map((c) => [
          c.style.getPropertyValue('translate'),
          c.style.getPropertyPriority('translate'),
        ])
      ).toEqual(before);
    }
  });
  it('retains accepted captions across revisions and restores their immutable preimages once per semantic boundary', () => {
    const info = document.createElement('div'),
      action = document.createElement('div');
    info.className = 'seat__info';
    action.className = 'seat__action';
    info.style.setProperty('translate', '1px 2px', 'important');
    const state: OpponentAvatarState = {
      key: 'body-a',
      shifts: new WeakMap(),
      idleReservedKey: 'body-a',
    };
    const captions = [info, action];
    expect(syncOpponentCaptionBoundary(state, captions, 'hand-a:avatar-a:320')).toBe(false);
    const preimages = state.captionPreimages;
    info.style.setProperty('translate', '1px -12px');
    action.style.setProperty('translate', '0px -25px');
    expect(syncOpponentCaptionBoundary(state, captions, 'hand-a:avatar-a:320')).toBe(false);
    expect(info.style.getPropertyValue('translate')).toBe('1px -12px');
    expect(state.key).toBe('body-a');
    expect(syncOpponentCaptionBoundary(state, captions, 'hand-b:avatar-a:320')).toBe(true);
    expect(state.key).toBe('');
    expect(state.idleReservedKey).toBeUndefined();
    expect(info.style.getPropertyValue('translate')).toBe('1px 2px');
    expect(info.style.getPropertyPriority('translate')).toBe('important');
    expect(action.style.getPropertyValue('translate')).toBe('');
    state.key = 'body-b';
    state.idleReservedKey = 'body-b';
    expect(syncOpponentCaptionBoundary(state, captions, 'hand-b:avatar-a:320')).toBe(false);
    expect(state.key).toBe('body-b');
    expect(state.captionPreimages).toBe(preimages);
    info.style.setProperty('translate', '1px -8px');
    expect(syncOpponentCaptionBoundary(state, captions, 'hand-b:avatar-b:375')).toBe(true);
    expect(info.style.getPropertyValue('translate')).toBe('1px 2px');
    expect(state.captionPreimages).toBe(preimages);
  });
  it('does not invalidate body packing after failed trials or ordinary legacy action placement', () => {
    const seat = document.createElement('div');
    seat.innerHTML = '<div class="seat__info"></div><div class="seat__action"></div>';
    const captions = [...seat.children] as HTMLElement[];
    const state: OpponentAvatarState = {
      key: 'body',
      shifts: new WeakMap([[seat, [0, 0]]]),
      idleReservedKey: 'body',
    };
    syncOpponentCaptionBoundary(state, captions, 'hand-a');
    expect(
      opponentShiftTransaction([seat], state.shifts, () => {
        captions[0].style.setProperty('translate', '0px -10px');
        captions[1].style.setProperty('translate', '0px -20px');
        return false;
      })
    ).toBe(false);
    captions[1].style.setProperty('translate', '0px 86px');
    expect(syncOpponentCaptionBoundary(state, captions, 'hand-b')).toBe(false);
    expect(state.key).toBe('body');
    expect(state.idleReservedKey).toBe('body');
    expect(captions[1].style.getPropertyValue('translate')).toBe('0px 86px');
  });
  it('never throws when an opponent seat temporarily has zero measured parts', () => {
    const shifts = jointOpponentShifts(
      [
        { parts: [], side: -1, outwardOnly: true },
        { parts: [{ left: 20, top: 100, width: 80, height: 100 }], side: -1, outwardOnly: true },
      ],
      [],
      bounds,
      0,
      true,
      220
    );
    expect(shifts).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(opponentFitsLowerLane([], [], bounds, 220)).toBe(false);
  });
});

it('retains decoded URL metadata when its original portrait is replaced before CORS completion', async () => {
  const page = document.createElement('div');
  page.className = 'table-page';
  page.innerHTML =
    '<div class="table-scaler"><div class="seat seat--hero"><div class="seat__avatar seat__avatar--bust"><img class="seat__avatar-img" /></div></div></div>';
  document.body.append(page);
  const scaler = page.querySelector<HTMLElement>('.table-scaler')!;
  const original = page.querySelector<HTMLImageElement>('img')!;
  const url = 'https://example.invalid/metadata-replacement-race.webp';
  const loaded = (image: HTMLImageElement) => {
    image.src = url;
    image.style.transform = 'none';
    image.style.objectFit = 'contain';
    image.style.objectPosition = '50% 100%';
    for (const [name, value] of Object.entries({
      complete: true,
      naturalWidth: 1,
      naturalHeight: 1,
      offsetWidth: 100,
      offsetHeight: 100,
    }))
      Object.defineProperty(image, name, { configurable: true, value });
  };
  loaded(original);
  let firstRead = true;
  const context = {
    drawImage: () => {
      if (firstRead) {
        firstRead = false;
        throw new Error('Cross-Origin Portrait');
      }
    },
    getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
  };
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const probes: Array<{
    naturalWidth: number;
    naturalHeight: number;
    onload: null | (() => void);
    onerror: null | (() => void);
    src: string;
    crossOrigin: string;
  }> = [];
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1;
      naturalHeight = 1;
      onload = null;
      onerror = null;
      src = '';
      crossOrigin = '';
      constructor() {
        probes.push(this);
      }
    }
  );
  const schedule = vi.fn();
  const layout = createOpponentAvatarLayout(
    scaler,
    page,
    { key: '', shifts: new WeakMap() },
    schedule
  );
  try {
    expect(layout.prepare()).toBe(false);
    expect(probes).toHaveLength(1);
    const replacement = document.createElement('img');
    replacement.className = original.className;
    loaded(replacement);
    original.replaceWith(replacement);
    probes[0].onload!();
    await Promise.resolve();
    await Promise.resolve();
    expect(layout.awaitingMetadata()).toBe(false);
    expect(schedule).toHaveBeenCalledOnce();
    layout.prepare();
    expect(layout.awaitingMetadata()).toBe(false);
  } finally {
    layout.stop();
    canvas.mockRestore();
    vi.unstubAllGlobals();
    page.remove();
  }
});

it.each([
  { heroActive: true, heroSpot: true, opponentActive: false, opponentSpot: false },
  { heroActive: false, heroSpot: false, opponentActive: true, opponentSpot: true },
  { heroActive: true, heroSpot: false, opponentActive: false, opponentSpot: true },
  { heroActive: false, heroSpot: true, opponentActive: true, opponentSpot: false },
])(
  'matches mixed decoded subjects to the unchanged focused Hero: %j',
  async ({ heroActive, heroSpot, opponentActive, opponentSpot }) => {
    const page = document.createElement('div');
    page.className = 'table-page';
    page.innerHTML = `<div class="table-scaler"><div class="seat-wrapper ${heroSpot ? 'seat-wrapper--spot' : ''}"><div class="seat seat--hero ${heroActive ? 'seat--active' : ''}"><div class="seat__avatar seat__avatar--bust"><img class="seat__avatar-img" /></div></div></div><div class="seat-wrapper ${opponentSpot ? 'seat-wrapper--spot' : ''}"><div class="seat ${opponentActive ? 'seat--active' : ''}"><div class="seat__avatar seat__avatar--bust"><img class="seat__avatar-img" /></div><div class="seat__info" style="width:112px;height:36px"></div><div class="seat__cards" style="width:90px;height:60px"></div></div></div></div>`;
    document.body.append(page);
    const images = [...page.querySelectorAll<HTMLImageElement>('img')];
    images.forEach((image, i) => {
      image.src = `https://example.invalid/focus-${Number(heroActive)}${Number(heroSpot)}${Number(opponentActive)}${Number(opponentSpot)}-${i ? 'opponent' : 'hero'}.webp`;
      image.style.transform = 'none';
      image.style.objectFit = 'contain';
      image.style.objectPosition = '50% 100%';
      for (const [name, value] of Object.entries({
        complete: true,
        naturalWidth: 250,
        naturalHeight: 340,
        offsetWidth: 80,
        offsetHeight: 80,
      }))
        Object.defineProperty(image, name, { configurable: true, value });
    });
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      let source: HTMLImageElement;
      return {
        drawImage: (image: HTMLImageElement) => {
          source = image;
        },
        getImageData: () => {
          const data = new Uint8ClampedArray(250 * 340 * 4);
          const hero = source.src.endsWith('hero.webp');
          for (let y = hero ? 100 : 20; y < (hero ? 300 : 320); y++)
            for (let x = 0; x < 250; x++) data[(y * 250 + x) * 4 + 3] = 255;
          return { data };
        },
      } as unknown as CanvasRenderingContext2D;
    });
    const scaler = page.querySelector<HTMLElement>('.table-scaler')!;
    const before = [...page.querySelectorAll<HTMLElement>('.seat__info,.seat__cards')].map(
      (e) => e.style.cssText
    );
    const layout = createOpponentAvatarLayout(
      scaler,
      page,
      { key: '', shifts: new WeakMap() },
      vi.fn()
    );
    try {
      layout.prepare();
      await Promise.resolve();
      await Promise.resolve();
      layout.prepare();
      const heroFocus = (heroActive ? 1.04 : 1) * (heroSpot ? 1.04 : 1);
      const opponentFocus = (opponentActive ? 1.04 : 1) * (opponentSpot ? 1.04 : 1);
      const gain = Number(
        images[1]
          .closest<HTMLElement>('.seat__avatar')!
          .style.getPropertyValue('--sp-opponent-art-scale')
      );
      // Independent decoded row counts: 200 Hero pixels, 300 opponent pixels.
      expect(gain).toBeCloseTo(((200 / 300) * heroFocus) / opponentFocus, 5);
      expect((300 / 340) * 80 * opponentFocus * gain).toBeCloseTo((200 / 340) * 80 * heroFocus, 4);
      expect(
        images[0]
          .closest<HTMLElement>('.seat__avatar')!
          .style.getPropertyValue('--sp-opponent-art-scale')
      ).toBe('');
      expect(
        [...page.querySelectorAll<HTMLElement>('.seat__info,.seat__cards')].map(
          (e) => e.style.cssText
        )
      ).toEqual(before);
      expect(images.map((image) => [image.offsetWidth, image.offsetHeight])).toEqual([
        [80, 80],
        [80, 80],
      ]);
    } finally {
      layout.stop();
      canvas.mockRestore();
      page.remove();
    }
  }
);

it('switching turn/spotlight focus across seats updates --sp-opponent-art-scale without resetting opponent pod shifts or state.key', async () => {
  const page = document.createElement('div');
  page.className = 'table-page';
  page.innerHTML = `<div class="table-scaler"><div class="seat-wrapper seat-wrapper--spot"><div class="seat seat--hero seat--active" data-player-id="hero"><div class="seat__avatar seat__avatar--bust"><img class="seat__avatar-img" /></div></div></div><div class="seat-wrapper"><div class="seat" data-player-id="villain-1" data-opponent-lane="cap" style="--sp-opponent-x: 4px; --sp-opponent-y: -6px;"><div class="seat__avatar seat__avatar--bust"><img class="seat__avatar-img" /></div><div class="seat__info" style="width:112px;height:36px"></div></div></div></div>`;
  document.body.append(page);
  const images = [...page.querySelectorAll<HTMLImageElement>('img')];
  images.forEach((image, i) => {
    image.src = `https://example.invalid/turn-handoff-${i ? 'opponent' : 'hero'}.webp`;
    image.style.transform = 'none';
    image.style.objectFit = 'contain';
    image.style.objectPosition = '50% 100%';
    for (const [name, value] of Object.entries({
      complete: true,
      naturalWidth: 250,
      naturalHeight: 340,
      offsetWidth: 80,
      offsetHeight: 80,
    }))
      Object.defineProperty(image, name, { configurable: true, value });
  });
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let source: HTMLImageElement;
    return {
      drawImage: (image: HTMLImageElement) => {
        source = image;
      },
      getImageData: () => {
        const data = new Uint8ClampedArray(250 * 340 * 4);
        const hero = source.src.endsWith('hero.webp');
        for (let y = hero ? 100 : 20; y < (hero ? 300 : 320); y++)
          for (let x = 0; x < 250; x++) data[(y * 250 + x) * 4 + 3] = 255;
        return { data };
      },
    } as unknown as CanvasRenderingContext2D;
  });
  const scaler = page.querySelector<HTMLElement>('.table-scaler')!;
  const heroWrapper = page.querySelectorAll<HTMLElement>('.seat-wrapper')[0]!;
  const heroSeat = heroWrapper.querySelector<HTMLElement>('.seat')!;
  const villainWrapper = page.querySelectorAll<HTMLElement>('.seat-wrapper')[1]!;
  const villainSeat = villainWrapper.querySelector<HTMLElement>('.seat')!;
  const villainAvatar = villainSeat.querySelector<HTMLElement>('.seat__avatar')!;
  const state: OpponentAvatarState = { key: '', shifts: new WeakMap() };
  const layout = createOpponentAvatarLayout(scaler, page, state, vi.fn());
  try {
    expect(layout.prepare('hand-1')).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(layout.prepare('hand-1')).toBe(true);
    const initialKey = state.key;
    expect(initialKey).not.toBe('');
    villainSeat.style.setProperty('--sp-opponent-x', '4px');
    villainSeat.style.setProperty('--sp-opponent-y', '-6px');
    villainSeat.dataset.opponentLane = 'cap';
    state.shifts.set(villainSeat, [4, -6]);
    const initialScale = Number(villainAvatar.style.getPropertyValue('--sp-opponent-art-scale'));
    expect(initialScale).toBeCloseTo((200 / 300) * 1.04 * 1.04, 5);

    // Turn moves from Hero to Villain: focus gain changes, but ring key and shifts must stay intact!
    heroWrapper.classList.remove('seat-wrapper--spot');
    heroSeat.classList.remove('seat--active');
    villainWrapper.classList.add('seat-wrapper--spot');
    villainSeat.classList.add('seat--active');

    expect(layout.prepare('hand-1')).toBe(false);
    expect(state.key).toBe(initialKey);
    expect(state.shifts.get(villainSeat)).toEqual([4, -6]);
    expect(villainSeat.style.getPropertyValue('--sp-opponent-x')).toBe('4px');
    expect(villainSeat.style.getPropertyValue('--sp-opponent-y')).toBe('-6px');
    expect(villainSeat.dataset.opponentLane).toBe('cap');
    expect(layout.ready()).toBe(true);
    const nextScale = Number(villainAvatar.style.getPropertyValue('--sp-opponent-art-scale'));
    expect(nextScale).toBeCloseTo(200 / 300 / (1.04 * 1.04), 5);
  } finally {
    layout.stop();
    canvas.mockRestore();
    page.remove();
  }
});
