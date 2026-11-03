import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import LobbyGameSections from '../../src/components/lobby/LobbyGameSections';

describe('lobby category selection', () => {
  it.each(['cash', 'tournaments'] as const)('keeps %s open on a repeated click', (selected) => {
    const choose = vi.fn();
    render(<LobbyGameSections selected={selected} onToggle={choose} />);
    fireEvent.click(
      screen.getByRole('button', { name: selected === 'cash' ? 'Cash Games' : 'Tournaments' })
    );
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: selected === 'cash' ? 'Tournaments' : 'Cash Games' })
    );
    expect(choose).toHaveBeenCalledWith(selected === 'cash' ? 'tournaments' : 'cash');
    cleanup();
  });
});
