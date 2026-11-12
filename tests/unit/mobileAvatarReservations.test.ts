import { describe, expect, it } from 'vitest';
import { heroPrivateReservations } from '../../src/components/table/mobileAvatarReservations';
import {
  dealerReservations,
  hiddenFanReservations,
  hiddenFanStates,
  mobilePositionLabels,
} from '../../src/components/table/mobileAvatarReservations';
import { dealerButtonPositionClearOfSeat } from '../../src/components/table/DealerButton';
import { seatPodPx } from '../../src/components/table/tableGeometry';

const fan = {
  seatLeft: 100,
  seatTop: 200,
  seatWidth: 80,
  avatarSize: 52,
  wrapOverlap: 6,
  scale: 1,
};
describe('static mobile reservations', () => {
  it('reserves position labels reachable on the ring, including a dead button', () => {
    expect(mobilePositionLabels(6).sort()).toEqual(['BB', 'CO', 'MP', 'SB', 'UTG']);
    expect(mobilePositionLabels(9)).toContain('UTG+2');
    expect(mobilePositionLabels(9)).not.toContain('MP+1');
    expect(mobilePositionLabels(6)).not.toContain('BTN');
    expect(mobilePositionLabels(6, 2).sort()).toEqual(['BB', 'SB']);
    expect(mobilePositionLabels(6, 3)).toContain('CO');
  });
  it('reserves only reachable backs for the stable variant', () => {
    for (const count of [2, 4, 5, 6])
      expect(hiddenFanStates(count)).toEqual([{ count, discard: false }]);
    expect(hiddenFanStates(3)).toEqual([
      { count: 3, discard: false },
      { count: 2, discard: true },
      { count: 2, discard: false },
    ]);
    expect(hiddenFanStates(0)).toEqual([]);
  });
  it('reserves absent hero hands, the six-card shift, and outer-card row peek', () => {
    const input = {
      seatLeft: 100,
      seatTop: 600,
      seatWidth: 100,
      seatHeight: 140,
      avatarSize: 80,
      plateMinWidth: 100,
      tableWidth: 480,
      viewportWidth: 600,
      heroClear: 60,
      barInset: 0,
      boardCardWidth: 80,
      scale: 1,
    };
    const { boxes, maxSixShift } = heroPrivateReservations(input);
    expect(boxes).toHaveLength(20);
    expect(maxSixShift).toBe(22);
    const holdem = heroPrivateReservations({ ...input, counts: [2] });
    expect(holdem.maxSixShift).toBe(0);
    expect(holdem.boxes).toHaveLength(2);
    expect(holdem.boxes.every((box) => box.count === 2)).toBe(true);
    expect(holdem.boxes).toEqual(boxes.filter((box) => box.count === 2));
    const discard = heroPrivateReservations({ ...input, counts: [3, 2] });
    expect(discard.maxSixShift).toBe(0);
    expect(discard.boxes).toHaveLength(5);
    const six = boxes.filter((b) => b.count === 6);
    // Private row: left186, width260. Peek origin is row centre316.
    expect(six[0].left).toBeCloseTo(316 + (186 - 316) * 1.03);
    expect(six[5].left + six[5].width).toBeCloseTo(316 + (446 - 316) * 1.03);
    const cy = 665,
      h = 115;
    expect(six[0].top).toBeLessThanOrEqual(cy - (h * 1.03) / 2 - 8);
    expect(six[0].top + six[0].height).toBeGreaterThanOrEqual(cy + h / 2 + 14);
    const scaled = heroPrivateReservations({ ...input, scale: 0.5 });
    boxes.forEach((b, i) => {
      expect(scaled.boxes[i].left).toBeCloseTo(100 + (b.left - 100) / 2);
      expect(scaled.boxes[i].top).toBeCloseTo(600 + (b.top - 600) / 2);
      expect(scaled.boxes[i].width).toBeCloseTo(b.width / 2);
    });
  });
  it('mirrors every individual hidden-card bound and includes the discarded card', () => {
    for (let count = 1; count <= 6; count++) {
      for (const discard of [false, true]) {
        const left = hiddenFanReservations({ ...fan, count, discard, side: 'left' });
        const right = hiddenFanReservations({ ...fan, count, discard, side: 'right' });
        expect(left).toHaveLength(count + Number(discard));
        left.forEach((box, i) => {
          expect(box.left + box.width + right[i].left).toBeCloseTo(280);
          expect(box.top).toBeCloseTo(right[i].top);
          expect(box.height).toBeCloseTo(right[i].height);
        });
      }
    }
  });
  it('anchors one unrotated card exactly one pixel above the plate', () => {
    const [card] = hiddenFanReservations({ ...fan, count: 1, side: 'right' });
    expect(card.top + card.height).toBeCloseTo(245);
    expect(card.height).toBeCloseTo(52 * 0.346);
    expect(card.left).toBeCloseTo(140 + 26 - 0.8 * card.width);
  });
  it('covers natural dealer boxes and every straight glide between owners', () => {
    const canvas = { left: 30, top: 90, width: 480, height: 900 };
    const anchors = [
      { x: 50, y: 105 },
      { x: 8, y: 70 },
      { x: 8, y: 40 },
      { x: 30, y: 8 },
      { x: 70, y: 8 },
      { x: 92, y: 40 },
      { x: 92, y: 70 },
    ];
    const scalerSize = { w: 480, h: 900, railBets: false, portraitTags: true, portraitTaper: 0 };
    const boxes = dealerReservations({
      canvas,
      anchors,
      scale: 1,
      dealerSize: 40,
      viewportWidth: 600,
      scalerSize,
    });
    const centers = anchors.map((p) =>
      dealerButtonPositionClearOfSeat(
        p,
        { w: 480, h: 900, railBets: false, portraitTags: true, portraitTaper: 0 },
        seatPodPx(600, p.y >= 100 && p.x === 50, 480),
        anchors
      )
    );
    const contains = (x: number, y: number) =>
      boxes.some(
        (b) =>
          x >= b.left - 1e-8 &&
          x <= b.left + b.width + 1e-8 &&
          y >= b.top - 1e-8 &&
          y <= b.top + b.height + 1e-8
      );
    for (const a of centers)
      for (const b of centers)
        for (const t of [0, 0.25, 0.5, 0.75, 1])
          for (const dx of [-20, 20])
            for (const dy of [-20, 20])
              expect(
                contains(
                  canvas.left + (a.x + (b.x - a.x) * t) * 4.8 + dx,
                  canvas.top + (a.y + (b.y - a.y) * t) * 9 + dy
                )
              ).toBe(true);
    expect(boxes.length).toBeGreaterThan(1);
    expect(
      dealerReservations({
        canvas,
        anchors,
        scale: 1,
        dealerSize: 40,
        viewportWidth: 480,
        scalerSize,
      })
    ).toEqual([]);
  });
});
