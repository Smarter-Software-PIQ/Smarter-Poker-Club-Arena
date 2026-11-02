import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PotDisplay from '../src/components/table/PotDisplay';
import ActionPanel from '../src/components/table/ActionPanel';
import { mapEngineSnapshot } from '../src/utils/mapEngineSnapshot';
import { displayBigBlind } from '../src/utils/handBlinds';

const action = {
  canFold: true,
  canCheck: false,
  canCall: true,
  canRaise: false,
  canAllIn: true,
  currentBet: 1200,
  callAmount: 1200,
  minRaise: 2400,
  maxRaise: 4800,
  allInTo: 4800,
  pot: 2400,
  bigBlind: 1200,
  isMyTurn: true,
};

describe('missing hand denomination uses one explicit chip display', () => {
  it('labels the pot CHIPS and preserves canonical chip actions while BB is unavailable', () => {
    const preference = true;
    const bb = displayBigBlind(null, 'table-a', 12, true, 1000);
    const effectiveBB = preference && bb > 0;
    const onAction = vi.fn();
    const { container } = render(
      <>
        <PotDisplay
          mainPot={2400}
          displayMode={effectiveBB ? 'bb' : 'chips'}
          bigBlind={bb}
          showChipsFallbackLabel={preference && !effectiveBB}
        />
        <ActionPanel
          {...action}
          showStackInBB={effectiveBB}
          displayBigBlind={bb}
          onAction={onAction}
        />
      </>
    );
    expect(screen.getByText('CHIPS')).toBeTruthy();
    expect(container.querySelector('.pot-display__amount')?.textContent).toBe('2,400');
    expect(container.textContent).not.toMatch(/\d\s*BB/);
    expect(screen.getByLabelText('All In').textContent).toContain('4,800');
    fireEvent.click(screen.getByLabelText('All In'));
    expect(onAction).toHaveBeenCalledWith('allin', 4800);
    expect(preference).toBe(true);
  });
});

describe('legacy tournament stacks can switch to BB', () => {
  it('maps the serving legacy shape and toggles the real pot and action display without changing wagers', () => {
    const mapped = mapEngineSnapshot(
      { table_id: 'legacy', hand_number: 12, players: [], action_history: [], pots: [], pot: 2400 },
      'hero',
      9
    );
    const bb = displayBigBlind(mapped.handBlinds, 'legacy', 12, true, 1200);
    const onAction = vi.fn();
    const view = (enabled: boolean) => (
      <>
        <PotDisplay mainPot={2400} displayMode={enabled && bb > 0 ? 'bb' : 'chips'} bigBlind={bb} />
        <ActionPanel
          {...action}
          showStackInBB={enabled && bb > 0}
          displayBigBlind={bb}
          onAction={onAction}
        />
      </>
    );
    const { container, rerender } = render(view(false));
    expect(container.querySelector('.pot-display__amount')?.textContent).toBe('2,400');
    rerender(view(true));
    expect(container.querySelector('.pot-display__amount')?.textContent).toBe('2 BB');
    expect(screen.getByLabelText('All In').textContent).toContain('4 BB');
    fireEvent.click(screen.getByLabelText('All In'));
    expect(onAction).toHaveBeenCalledWith('allin', 4800);
    rerender(view(false));
    expect(container.querySelector('.pot-display__amount')?.textContent).toBe('2,400');
  });
});
