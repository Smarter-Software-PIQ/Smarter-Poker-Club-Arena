import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActionControllerSettings } from '../../src/components/table/ActionControllerSettings';
import { useActionControllerSettings } from '../../src/hooks/useActionControllerSettings';
import { useUserStore } from '../../src/stores/useUserStore';
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

function ReadAtTable() {
  const { settings } = useActionControllerSettings();
  return <output aria-label="Live Controller Settings">{JSON.stringify(settings)}</output>;
}
const live = () => JSON.parse(screen.getByLabelText('Live Controller Settings').textContent!);
beforeEach(() => {
  localStorage.clear();
  useUserStore.setState({ user: null });
});

describe('Action Controller settings gestures', () => {
  it('updates the live table when a Studio color is selected', () => {
    render(
      <>
        <ActionControllerSettings colorsOnly />
        <ReadAtTable />
      </>
    );
    expect(screen.getAllByRole('button')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Ruby', exact: true }));
    expect(live().color).toBe('red');
    expect(
      screen.getByRole('button', { name: 'Ruby', exact: true }).getAttribute('aria-pressed')
    ).toBe('true');
  });
  it('keeps uncommitted drafts out of the sizing path, reports invalid values and restores defaults', () => {
    render(
      <>
        <ActionControllerSettings />
        <ReadAtTable />
      </>
    );
    const input = screen.getByLabelText('Preflop Multipliers Option 1');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Preflop Multipliers' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter Four Values');
    expect(live().preflop).toEqual([2.5, 3, 3.5, 4]);
    fireEvent.change(input, { target: { value: '2.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Preflop Multipliers' }));
    expect(live().preflop).toEqual([2.2, 3, 3.5, 4]);
    fireEvent.change(screen.getByLabelText('Postflop Pot Percentages Option 4'), {
      target: { value: '125' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Postflop Pot Percentages' }));
    expect(live().postflop).toEqual([33, 50, 75, 125]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore Defaults' })[0]);
    expect(live().preflop).toEqual([2.5, 3, 3.5, 4]);
    expect(live().postflop).toEqual([33, 50, 75, 125]);
  });
});
