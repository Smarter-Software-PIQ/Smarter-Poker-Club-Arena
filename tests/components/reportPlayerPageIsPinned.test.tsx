/**
 * REPORT PLAYER IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign player pages batch P7, 2026-11-28)
 *
 * /report/:playerId is moving off the painted SpadeConsole onto the arena
 * workspace. The condition: no word, named region, form field, reason button
 * state or submit/cancel control may change, and filing a report writes the
 * exact same row to user_reports.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const backend = vi.hoisted(() => ({
  insert: vi.fn(),
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'viewer-1' } }),
}));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (...args: unknown[]) => backend.insert(...args),
    }),
  },
}));

import ReportPlayerPage from '../../src/pages/ReportPlayerPage';

function pinFile(name: string) {
  return `./__pins__/report-player-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

function mount(route = '/report/target-1') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/report/:playerId" element={<ReportPlayerPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.insert.mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe('Report Player prints the same words, regions and controls', () => {
  it('initial empty form with Submit Report disabled', async () => {
    const { container } = mount();
    await screen.findByText('Reason For Report');
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('filled form with reason selected, hand ID and chat logs checked', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Collusion' }));
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Soft playing on the bubble.' },
    });
    fireEvent.change(screen.getByLabelText('Hand ID (Optional)'), {
      target: { value: 'HAND-90210' },
    });
    fireEvent.click(screen.getByLabelText('Include Recent Chat Logs With This Player'));
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('ready'));
  });

  it('failed submission displays role=alert error', async () => {
    backend.insert.mockResolvedValue({ error: { message: 'Unable to save report' } });
    const { container } = mount();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Verbal abuse in table chat.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));
    await screen.findByRole('alert');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('submitted confirmation state and payload verification', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cheating' }));
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Suspicious timing patterns.' },
    });
    fireEvent.change(screen.getByLabelText('Hand ID (Optional)'), {
      target: { value: 'H-77' },
    });
    fireEvent.click(screen.getByLabelText('Include Recent Chat Logs With This Player'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));
    await screen.findByRole('button', { name: 'Go Back' });
    await settle();
    expect(backend.insert).toHaveBeenCalledWith({
      reporter_id: 'viewer-1',
      reported_user_id: 'target-1',
      reason: 'cheating',
      details:
        'Suspicious timing patterns.\nHand: H-77\n(reporter requested chat logs be reviewed)',
      status: 'pending',
    });
    await expect(pin(container)).toMatchFileSnapshot(pinFile('submitted'));
  });
});
