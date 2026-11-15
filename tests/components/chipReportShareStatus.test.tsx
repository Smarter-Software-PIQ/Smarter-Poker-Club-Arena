/**
 * The session and result cards paint their share button, so its word is its
 * accessible name, and what a tap just did is a separate status (2026-11-15).
 * A resting "Copy Link" or "Save Image" must never print as a status message.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChipStackReport } from '../../src/components/session/ChipStackReport';

function card(share: { label: string; status?: string | null }) {
  return (
    <ChipStackReport
      name="Table 1"
      headline="Session Profit"
      value="+12"
      stats={[]}
      onClose={vi.fn()}
      onView={vi.fn()}
      share={{ ...share, onClick: vi.fn() }}
      primary={{ label: 'Game Lobby', onClick: vi.fn() }}
    />
  );
}

describe('the painted share button', () => {
  it('is named for what the tap does, and a resting word is not a status', () => {
    render(card({ label: 'Copy Link' }));
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows what the tap just did as a status', () => {
    render(card({ label: 'Copied', status: 'Copied' }));
    expect(screen.getByRole('status').textContent).toBe('Copied');
  });
});
