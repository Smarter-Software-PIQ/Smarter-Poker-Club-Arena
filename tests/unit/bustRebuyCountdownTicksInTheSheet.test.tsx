import React, { Profiler, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecondsUntil } from '../../src/components/table/SecondsUntil';
import { SECONDS_UNTIL_TICK_MS, useSecondsUntil } from '../../src/hooks/useSecondsUntil';

/*
 * The bust rebuy countdown used to tick (every 250 ms) inside LiveTablePage,
 * so each second of a rebuy window re-rendered the whole table, once per open
 * table. The clock now lives in SecondsUntil, rendered around the rebuy sheet
 * by TableModalsLayer; LiveTablePage only hands down the deadline.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the bust rebuy countdown ticks in the sheet, not in the table', () => {
  it('counting down twenty seconds never re-renders the component that owns the deadline', () => {
    let parentRenders = 0;
    let sheetRenders = 0;
    const shown: Array<number | null> = [];
    const deadline = Date.now() + 20_000;

    function Table() {
      parentRenders += 1;
      return (
        <SecondsUntil localDeadlineMs={deadline}>
          {(secondsLeft) => {
            sheetRenders += 1;
            shown.push(secondsLeft);
            return <span data-testid="countdown">{secondsLeft ?? ''}</span>;
          }}
        </SecondsUntil>
      );
    }

    let profiledCommits = 0;
    render(
      <Profiler id="table" onRender={() => (profiledCommits += 1)}>
        <Table />
      </Profiler>
    );
    const parentAfterMount = parentRenders;
    expect(screen.getByTestId('countdown').textContent).toBe('20');

    // One quarter-second tick at a time, so every tick commits on its own.
    for (let elapsed = 0; elapsed < 20_000; elapsed += SECONDS_UNTIL_TICK_MS) {
      act(() => vi.advanceTimersByTime(SECONDS_UNTIL_TICK_MS));
    }

    expect(screen.getByTestId('countdown').textContent).toBe('0');
    // The table rendered once, at mount, and never again for the clock.
    expect(parentRenders).toBe(parentAfterMount);
    expect(parentRenders).toBe(1);
    // The sheet did the counting: every whole second from 20 to 0 was shown.
    expect(sheetRenders).toBeGreaterThanOrEqual(21);
    expect(profiledCommits).toBeGreaterThan(1);
    const distinct = shown.filter((v, i) => i === 0 || v !== shown[i - 1]);
    expect(distinct).toEqual([
      null,
      20,
      19,
      18,
      17,
      16,
      15,
      14,
      13,
      12,
      11,
      10,
      9,
      8,
      7,
      6,
      5,
      4,
      3,
      2,
      1,
      0,
    ]);
  });

  it('shows the value the table used to compute: ceil of the time left, floored at zero', () => {
    const values: Array<number | null> = [];
    function Probe({ localDeadlineMs }: { localDeadlineMs: number | null }) {
      values.push(useSecondsUntil(localDeadlineMs));
      return null;
    }
    const start = Date.now();
    const view = render(<Probe localDeadlineMs={start + 1_500} />);
    expect(values.at(-1)).toBe(2);
    act(() => vi.advanceTimersByTime(SECONDS_UNTIL_TICK_MS * 2));
    expect(values.at(-1)).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(values.at(-1)).toBe(0);
    act(() => vi.advanceTimersByTime(5_000));
    expect(values.at(-1)).toBe(0);
    view.rerender(<Probe localDeadlineMs={null} />);
    expect(values.at(-1)).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a new deadline restarts the count from that deadline', () => {
    function Harness() {
      const [deadline, setDeadline] = useState<number | null>(Date.now() + 5_000);
      return (
        <>
          <button onClick={() => setDeadline(Date.now() + 20_000)}>new</button>
          <SecondsUntil localDeadlineMs={deadline}>
            {(s) => <span data-testid="s">{s ?? 'none'}</span>}
          </SecondsUntil>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId('s').textContent).toBe('5');
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByTestId('s').textContent).toBe('2');
    act(() => screen.getByText('new').click());
    expect(screen.getByTestId('s').textContent).toBe('20');
  });

  it('LiveTablePage hands the sheet a deadline and keeps no quarter-second clock of its own', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    const layer = readFileSync(
      resolve(__dirname, '../../src/components/table/TableModalsLayer.tsx'),
      'utf8'
    );
    expect(page).toContain('bustRebuyDeadlineAt={bustRebuyDeadlineAt}');
    expect(page).not.toMatch(/setBustRebuySecondsLeft|setInterval\(tick,\s*250\)/);
    expect(layer).toContain('<SecondsUntil localDeadlineMs={bustRebuyDeadlineAt}>');
    expect(layer).toContain('countdown={bustRebuySecondsLeft ?? undefined}');
  });
});
