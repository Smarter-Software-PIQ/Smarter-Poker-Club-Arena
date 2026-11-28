/**
 * INVITE CODE PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign player pages batch P7, 2026-11-28)
 *
 * /i/:code is moving off InvitePage.css onto the arena workspace (leaving
 * InvitePage.css untouched for InvitePage). The condition: loading, failed
 * resolution, invalid code, redirect forwarding and Browse Clubs action stay
 * unchanged.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const backend = vi.hoisted(() => ({
  rememberInviteCode: vi.fn(),
  resolveInviteCode: vi.fn(),
}));

vi.mock('../../src/services/ClubInviteService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ClubInviteService')>();
  return {
    ...actual,
    rememberInviteCode: (...args: unknown[]) => backend.rememberInviteCode(...args),
    resolveInviteCode: (...args: unknown[]) => backend.resolveInviteCode(...args),
  };
});
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

import InviteCodePage from '../../src/pages/InviteCodePage';

function pinFile(name: string) {
  return `./__pins__/invite-code-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

function mount(route = '/i/KNG2345') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/i/:code" element={<InviteCodePage />} />
        <Route path="/clubs-list" element={<div data-testid="clubs-list">Clubs List</div>} />
        <Route path="/invite/:code" element={<div data-testid="club-join">Club Join</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.resolveInviteCode.mockResolvedValue(null);
});

afterEach(cleanup);

describe('Invite Code Page prints the same words and controls', () => {
  it('while resolving the invite code', async () => {
    backend.resolveInviteCode.mockImplementation(() => new Promise(() => {}));
    const { container } = mount('/i/KNG2345');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loading'));
  });

  it('when the invite code does not resolve', async () => {
    backend.resolveInviteCode.mockResolvedValue(null);
    const { container } = mount('/i/BAD2345');
    await screen.findByText('This Invite Did Not Work');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('when resolution throws an error and Browse Clubs navigates to /clubs-list', async () => {
    backend.resolveInviteCode.mockRejectedValue(new Error('network error'));
    const { container } = mount('/i/ERR2345');
    await screen.findByText('This Invite Did Not Work');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('error'));
    fireEvent.click(screen.getByRole('button', { name: 'Browse Clubs' }));
    await screen.findByTestId('clubs-list');
  });

  it('forwards valid invite codes to the resolved in-app path', async () => {
    backend.resolveInviteCode.mockResolvedValue({ inAppPath: '/invite/KNG2345' });
    mount('/i/KNG2345');
    await screen.findByTestId('club-join');
    expect(backend.rememberInviteCode).toHaveBeenCalledWith('KNG2345');
  });
});
