import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TERMS_REVISION } from '../../src/components/legal/legalDates';
const state = vi.hoisted(() => ({ status: vi.fn(), fetch: vi.fn() }));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'unit-player' }, isHydrating: false }),
}));
vi.mock('../../src/services/ProfileService', () => ({
  profileService: { getTOSStatus: state.status },
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'synthetic-unit-token' } } }),
    },
  },
}));
vi.mock('../../src/lib/promptLane', () => ({ useHoldPromptLane: vi.fn() }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/legal/TOSAcceptanceModal', () => ({
  default: function AcceptancePrompt({ onAccept }: { onAccept: () => Promise<void> }) {
    const [error, setError] = useState('');
    return (
      <div>
        <button
          onClick={() => {
            void onAccept().catch(() => setError('Acceptance Unconfirmed'));
          }}
        >
          Accept Current Terms
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  },
}));
import TOSGuard from '../../src/components/legal/TOSGuard';
beforeEach(() => {
  state.status.mockResolvedValue('not_accepted');
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/wallet']}>
      <TOSGuard>
        <p>Protected Club Content</p>
      </TOSGuard>
    </MemoryRouter>
  );
it.each([
  { success: true, acceptedAt: '2026-11-16T22:00:00.000Z' },
  { success: true, acceptedAt: '2026-11-16T22:00:00.000Z', termsRevision: 'old-terms' },
  { success: true, acceptedAt: 'invalid', termsRevision: TERMS_REVISION },
])('does not treat a legacy or malformed 200 as current acceptance: %j', async (receipt) => {
  state.fetch.mockResolvedValue({ ok: true, json: async () => receipt });
  mount();
  fireEvent.click(await screen.findByText('Accept Current Terms'));
  await screen.findByRole('alert');
  expect(screen.queryByText('Protected Club Content')).toBeNull();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it('sends the rendered revision and accepts only its confirmed durable receipt', async () => {
  state.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      acceptedAt: '2026-11-16T22:00:00.000Z',
      termsRevision: TERMS_REVISION,
    }),
  });
  mount();
  fireEvent.click(await screen.findByText('Accept Current Terms'));
  await screen.findByText('Protected Club Content');
  const request = state.fetch.mock.calls[0][1];
  expect(JSON.parse(request.body)).toEqual({ termsRevision: TERMS_REVISION });
  expect(request.headers['X-Idempotency-Key']).toBeTruthy();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it('preserves an unknown read without manufacturing acceptance', async () => {
  state.status.mockResolvedValue('unknown');
  const view = mount();
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-tos-gate-status]')?.getAttribute('data-tos-gate-status')
    ).toBe('unknown')
  );
  expect(screen.getByText('Protected Club Content')).toBeTruthy();
  expect(state.fetch).not.toHaveBeenCalled();
});

it.each(['network', 'http'])(
  'keeps failed %s acceptance pending without automatically retrying',
  async (failure) => {
    if (failure === 'network') state.fetch.mockRejectedValue(new Error('offline'));
    else
      state.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Not Recorded' }),
      });
    mount();
    fireEvent.click(await screen.findByText('Accept Current Terms'));
    await screen.findByRole('alert');
    expect(screen.queryByText('Protected Club Content')).toBeNull();
    expect(state.fetch).toHaveBeenCalledTimes(1);
  }
);
