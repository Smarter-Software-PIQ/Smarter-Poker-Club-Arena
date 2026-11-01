import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeatPlayerName } from '../../src/components/table/SeatPlayerName';

let frames: FrameRequestCallback[];
let resize: ResizeObserverCallback | undefined;
let room: number;

beforeEach(() => {
  frames = [];
  room = 72;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => room);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return (this.textContent?.length ?? 0) * 9 * Number(this.style.getPropertyValue('--fit') || 1);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resize = undefined;
});
function paint() {
  act(() => {
    const ready = frames;
    frames = [];
    ready.forEach((callback) => callback(0));
  });
}

describe('complete table player names fit their existing single-line plates', () => {
  it('fits the reported name and a longer display name, then remeasures narrower phone plates', () => {
    const view = render(<SeatPlayerName name="HotChipProf" />);
    paint();
    const text = view.getByText('HotChipProf');
    expect(text.textContent).toBe('HotChipProf');
    expect(text.scrollWidth).toBeLessThanOrEqual(room);
    expect(Number(text.style.getPropertyValue('--fit'))).toBeLessThan(1);
    expect(text.parentElement?.title).toBe('HotChipProf');
    view.rerender(<SeatPlayerName name="LongestCompletePlayerName" />);
    paint();
    const longer = view.getByText('LongestCompletePlayerName');
    expect(longer.scrollWidth).toBeLessThanOrEqual(room);
    room = 48;
    resize?.([], {} as ResizeObserver);
    paint();
    expect(longer.scrollWidth).toBeLessThanOrEqual(room);
    expect(longer.textContent).toBe('LongestCompletePlayerName');
    view.rerender(<SeatPlayerName name="Dan" />);
    paint();
    expect(view.getByText('Dan').style.getPropertyValue('--fit')).toBe('1');
  });
});
