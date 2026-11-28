/**
 * NOT FOUND PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign player pages batch P7, 2026-11-28)
 *
 * The 404 route is moving from a bare EmptyState wrapper onto the arena
 * workspace with ArenaWorkspaceHeader and ArenaEmptyState. The condition: no
 * word, named region, status role or navigation button changes.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';
import NotFoundPage from '../../src/pages/NotFoundPage';

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

function mount(route = '/does-not-exist') {
  return render(
    <MemoryRouter initialEntries={['/clubs', route]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<div data-testid="arena-home">Arena Home</div>} />
        <Route path="/clubs" element={<div data-testid="clubs-route">Clubs</div>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('Not Found Page prints the same words, roles and actions', () => {
  it('renders the 404 surface with both exits', async () => {
    const { container } = mount();
    await screen.findByText('This Arena Door Is Closed');
    await expect(pin(container)).toMatchFileSnapshot('./__pins__/not-found-ready.pin.txt');
  });

  it('wires Return To Club Arena and Go Back', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Return To Club Arena' }));
    await screen.findByTestId('arena-home');

    cleanup();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
    await screen.findByTestId('clubs-route');
  });
});
