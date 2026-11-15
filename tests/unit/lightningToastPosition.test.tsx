import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../../src/components/common/Toast';
function Trigger() {
  const toast = useToast();
  return <button onClick={() => toast.info('Test Notice')}>Notify</button>;
}
afterEach(() => {
  cleanup();
  document.querySelector('#toast-table-fixture')?.remove();
  vi.restoreAllMocks();
});
it('positions a Lightning notice below the actual messenger and follows resize', () => {
  const table = document.createElement('div');
  table.id = 'toast-table-fixture';
  table.className = 'table-page';
  table.dataset.lightningHud = 'true';
  const messenger = document.createElement('button');
  messenger.className = 'chat-collapsed';
  table.append(messenger);
  document.body.append(table);
  let bottom = 172;
  vi.spyOn(messenger, 'getClientRects').mockImplementation(
    () => [{ bottom }] as unknown as DOMRectList
  );
  vi.spyOn(messenger, 'getBoundingClientRect').mockImplementation(() => ({ bottom }) as DOMRect);
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('Notify'));
  expect(screen.getByRole('region', { name: 'Notifications' }).style.top).toBe('180px');
  bottom = 126;
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('region', { name: 'Notifications' }).style.top).toBe('134px');
});

it('keeps a notification visible when Messenger is at the bottom viewport edge', () => {
  const table = document.createElement('div');
  table.id = 'toast-table-fixture';
  table.className = 'table-page';
  table.dataset.lightningHud = 'true';
  const messenger = document.createElement('button');
  messenger.className = 'chat-collapsed';
  table.append(messenger);
  document.body.append(table);
  vi.spyOn(messenger, 'getClientRects').mockImplementation(() => [{}] as unknown as DOMRectList);
  vi.spyOn(messenger, 'getBoundingClientRect').mockImplementation(
    () => ({ top: window.innerHeight - 44, bottom: window.innerHeight }) as DOMRect
  );
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(64);
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('Notify'));
  const container = screen.getByRole('region', { name: 'Notifications' });
  expect(Number.parseFloat(container.style.top)).toBe(window.innerHeight - 116);
  expect(container.style.maxHeight).toContain('30dvh');
  expect(Number.parseFloat(container.style.top) + 64).toBeLessThan(window.innerHeight - 44);
});
