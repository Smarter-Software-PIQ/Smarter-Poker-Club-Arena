import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClubDataDayRollover } from '../../src/hooks/useClubDataDayRollover';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Probe({ notify }: { notify: (day: string) => void }) {
  useClubDataDayRollover('accounting', notify);
  return null;
}
describe('The Open Reporting Day', () => {
  it('changes at Pacific midnight rather than waiting for the next poll', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T07:59:59.000Z'));
    const notify = vi.fn();
    render(<Probe notify={notify} />);
    expect(notify).toHaveBeenLastCalledWith('2026-11-15');
    await act(() => vi.advanceTimersByTimeAsync(1002));
    expect(notify).toHaveBeenLastCalledWith('2026-11-16');
  });
  it('refreshes the day when a sleeping tab wakes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T07:59:59.000Z'));
    const notify = vi.fn();
    render(<Probe notify={notify} />);
    vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(notify).toHaveBeenLastCalledWith('2026-11-16');
  });
});
