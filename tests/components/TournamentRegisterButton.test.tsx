import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentRegisterButton } from '../../src/components/tournament/TournamentRegisterButton';

afterEach(cleanup);

describe('painted tournament registration control', () => {
  it.each(['Register', 'Late Register (Lv 29)', 'Rebuy (100)', 'Processing...'])(
    'keeps the live accessible label %s',
    (label) => {
      const click = vi.fn();
      render(<TournamentRegisterButton onClick={click}>{label}</TournamentRegisterButton>);
      fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
      expect(click).toHaveBeenCalledTimes(1);
    }
  );
  it('retains native disabled semantics while the original request is pending', () => {
    const click = vi.fn();
    render(
      <TournamentRegisterButton disabled onClick={click}>
        Processing...
      </TournamentRegisterButton>
    );
    const button = screen.getByRole('button', { name: 'Processing...', exact: true });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });
  it('prints late registration on two lines, the countdown smaller and without brackets', () => {
    render(
      <TournamentRegisterButton className="late-reg" subline="2 Levels Remaining">
        Late Register
      </TournamentRegisterButton>
    );
    const button = screen.getByRole('button', {
      name: 'Late Register, 2 Levels Remaining',
      exact: true,
    });
    const line = button.querySelector('.tournament-register-button__line');
    const subline = button.querySelector('.tournament-register-button__subline');
    expect(line?.textContent).toBe('Late Register');
    expect(subline?.textContent).toBe('2 Levels Remaining');
    expect(button.textContent).not.toMatch(/[()"]/);
  });
});
