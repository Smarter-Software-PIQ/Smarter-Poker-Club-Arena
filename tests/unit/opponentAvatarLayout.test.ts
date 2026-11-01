import { describe, expect, it } from 'vitest';
import { nearestOpponentShift } from '../../src/components/table/opponentAvatarLayout';

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
});
