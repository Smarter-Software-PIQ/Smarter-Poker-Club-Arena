import ActionPanel from '../../src/components/table/ActionPanel';
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
        <ActionControllerSettings />
        <ReadAtTable />
      </>
    );
    expect(screen.getAllByRole('button')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Black Platinum', exact: true }));
    expect(live().color).toBe('platinum');
    expect(
      screen
        .getByRole('button', { name: 'Black Platinum', exact: true })
        .getAttribute('aria-pressed')
    ).toBe('true');
  });
  it('keeps uncommitted drafts out of the sizing path, reports invalid values and restores defaults', () => {
    render(
      <>
        <ActionControllerSettings />
        <ReadAtTable />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change Default Button Amounts' }));
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

it('edits all eight defaults and uses each saved value through the live controller submission path', () => {
  const onAction = vi.fn();
  function TableController({ isPreflop }: { isPreflop: boolean }) {
    const { settings } = useActionControllerSettings();
    return (
      <ActionPanel
        controllerSettings={settings}
        isPreflop={isPreflop}
        canFold
        canCall
        canRaise
        canAllIn
        canCheck={false}
        isMyTurn
        currentBet={10}
        callAmount={8}
        pot={42}
        minRaise={20}
        maxRaise={500}
        bigBlind={2}
        smallestChip={1}
        onAction={onAction}
      />
    );
  }
  const view = (isPreflop: boolean) => (
    <>
      <ActionControllerSettings />
      <TableController isPreflop={isPreflop} />
    </>
  );
  const { rerender } = render(view(true));
  fireEvent.click(screen.getByRole('button', { name: 'Change Default Button Amounts' }));
  for (const [group, values] of [
    ['Preflop Multipliers', [2.25, 2.8, 3.3, 4.5]],
    ['Postflop Pot Percentages', [25, 33.33, 66.67, 125]],
  ] as const) {
    values.forEach((value, index) =>
      fireEvent.change(screen.getByLabelText(`${group} Option ${index + 1}`), {
        target: { value: String(value) },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: `Apply ${group}` }));
  }
  for (const [preflop, labels, amounts] of [
    [true, ['2.25X', '2.8X', '3.3X', '4.5X'], [22.5, 28, 33, 45]],
    [false, ['25%', '33.33%', '66.67%', '125%'], [23, 27, 44, 73]],
  ] as const) {
    rerender(view(preflop));
    labels.forEach((label, index) => {
      const prior = onAction.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Open Raise Panel' }));
      fireEvent.click(screen.getByRole('button', { name: `${label} - Raise ${amounts[index]}` }));
      expect(onAction).toHaveBeenCalledTimes(prior);
      fireEvent.click(screen.getByRole('button', { name: `Raise ${amounts[index]}`, exact: true }));
      expect(onAction).toHaveBeenCalledTimes(prior + 1);
      expect(onAction).toHaveBeenLastCalledWith('raise', amounts[index]);
    });
  }
});
