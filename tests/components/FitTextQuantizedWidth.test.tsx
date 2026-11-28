import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFitText } from '../../src/components/lobby/game-cards/useFitText';

/**
 * A fitted label ends on a ratio that was measured to fit.
 *
 * Measured on the live lobby (post-deploy run 46083886144, 2026-11-27): the
 * "Open Registration" filter label rendered 90px wide at every --fit from 0.70
 * down to 0.6754 and 79px at 0.67, in an 89px face. The old four-pass
 * proportional correction wrote 0.7063, 0.6985, 0.6907, 0.6830 and returned
 * 0.6754 without measuring it, so the label overran its painted face.
 */
let frames: Map<number, FrameRequestCallback>;
let frameId: number;

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function paint() {
  act(() => {
    const ready = [...frames.values()];
    frames.clear();
    for (const callback of ready) callback(0);
  });
}

function Label({ text, minRatio = 0.6 }: { text: string; minRatio?: number }) {
  const ref = useFitText<HTMLSpanElement>(text, 1, minRatio);
  return (
    <div style={{ width: '89px' }}>
      <span ref={ref}>{text}</span>
    </div>
  );
}

/** The live label's widths: a plateau at 90px, then a step down to 79px. */
function steppedWidths(width: (fit: number) => number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 89);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return width(Number(this.style.getPropertyValue('--fit') || 1));
  });
}

const fitOf = (label: HTMLElement) => Number(label.style.getPropertyValue('--fit'));

describe('a fitted label never ends wider than its face', () => {
  it('steps past a width plateau instead of returning an unmeasured ratio', () => {
    const live = (fit: number) => (fit >= 1 ? 126 : fit >= 0.6754 ? 90 : 79);
    steppedWidths(live);
    const view = render(<Label text="Open Registration" />);
    paint();
    const label = view.getByText('Open Registration');
    const fit = fitOf(label);
    expect(live(fit)).toBeLessThanOrEqual(89);
    expect(fit).toBeLessThan(0.6754);
    expect(fit).toBeGreaterThanOrEqual(0.6);
  });

  it('keeps the floor when even the floor is too wide', () => {
    steppedWidths(() => 200);
    const view = render(<Label text="Retry Original Buy-In" />);
    paint();
    expect(fitOf(view.getByText('Retry Original Buy-In'))).toBe(0.6);
  });

  it('leaves a label that fits at full size untouched', () => {
    steppedWidths(() => 60);
    const view = render(<Label text="Running" />);
    paint();
    expect(view.getByText('Running').style.getPropertyValue('--fit')).toBe('1');
  });
});
