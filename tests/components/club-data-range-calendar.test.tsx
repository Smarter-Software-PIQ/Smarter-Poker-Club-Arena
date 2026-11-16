import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Calendar from '../../src/components/club/ClubDataRangeCalendar';

afterEach(cleanup);
const base = {
  start: '2026-11-09',
  end: '2026-11-15',
  today: '2026-11-16',
  zoneLabel: 'Pacific Accounting Dates',
};
function mount() {
  const apply = vi.fn();
  const close = vi.fn();
  render(<Calendar {...base} onApply={apply} onClose={close} />);
  return { apply, close };
}
describe('One Inclusive Reporting Calendar', () => {
  it('drops a tomorrow selection when the confirmed Pacific basis changes today', () => {
    const apply = vi.fn();
    const close = vi.fn();
    const view = render(
      <Calendar {...base} start="2026-11-16" end="2026-11-16" onApply={apply} onClose={close} />
    );
    view.rerender(
      <Calendar
        {...base}
        start="2026-11-16"
        end="2026-11-16"
        today="2026-11-15"
        onApply={apply}
        onClose={close}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    expect(apply).toHaveBeenCalledWith('2026-11-15', '2026-11-15');
  });
  it('accepts a single day with one click and Apply', () => {
    const { apply } = mount();
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Nov 10, 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    expect(apply).toHaveBeenCalledWith('2026-11-10', '2026-11-10');
  });
  it('includes both Monday and Sunday in the selected week', () => {
    const { apply } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Nov 9, 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nov 15, 2026' }));
    expect(screen.getAllByRole('gridcell', { selected: true })).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    expect(apply).toHaveBeenCalledWith('2026-11-09', '2026-11-15');
  });
  it('normalizes reverse selection and refuses future days', () => {
    const { apply } = mount();
    expect(screen.getByRole('button', { name: 'Nov 17, 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next Month' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Nov 15, 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nov 9, 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    expect(apply).toHaveBeenCalledWith('2026-11-09', '2026-11-15');
  });
  it('keeps the 93-day limit and dismisses without applying', () => {
    const apply = vi.fn();
    const close = vi.fn();
    render(<Calendar {...base} start="2026-08-01" onApply={apply} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose Up To 93 Days.');
    expect(apply).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

it('preserves the existing two-year custom range ceiling for the Data rake panel', () => {
  const apply = vi.fn();
  render(<Calendar {...base} start="2026-08-01" maxDays={731} onApply={apply} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
  expect(apply).toHaveBeenCalledWith('2026-08-01', '2026-11-15');
});
