import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
import {
  PromoPlayThroughFigure,
  PromoPlayThroughInline,
} from '../../src/components/wallet/PromoPlayThroughProgress';
import { parsePromoPlayThrough } from '../../src/services/PromoPlayThroughService';
const summary = parsePromoPlayThrough({
  success: true,
  locked: 50,
  wallet_locked: 50,
  open_grants: 1,
  fee_target: 200,
  fee_progress: 124,
  fee_remaining: 76,
  percent: 62,
  wallet: 80,
  cashable: 30,
  next_expiry_at: null,
});
afterEach(cleanup);
it('opens the same details outside clipping ancestors and closes with Escape or an outside tap', async () => {
  const view = render(
    <div style={{ overflow: 'hidden', height: 24 }}>
      <PromoPlayThroughInline summary={summary} />
    </div>
  );
  const help = screen.getByLabelText('Promo Play Through Details');
  const details = help.closest('details')!;
  const panel = document.getElementById(help.getAttribute('aria-controls')!)!;
  expect(panel.parentElement).toBe(document.body);
  expect(panel.hidden).toBe(true);
  fireEvent.click(help);
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(panel.hidden).toBe(false));
  expect(panel.textContent).toContain('76.00 To Go');
  const parentEscape = vi.fn();
  document.addEventListener('keydown', parentEscape);
  fireEvent.keyDown(document, { key: 'Escape' });
  document.removeEventListener('keydown', parentEscape);
  expect(parentEscape).not.toHaveBeenCalled();
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(help);
  fireEvent.click(help);
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(panel.hidden).toBe(false));
  fireEvent.pointerDown(document.body);
  expect(details.open).toBe(false);
  expect(panel.hidden).toBe(true);
  view.unmount();
  expect(document.getElementById(panel.id)).toBeNull();
});
it('removes the open help when the final restricted chips complete or bust', async () => {
  const view = render(<PromoPlayThroughFigure summary={summary} />);
  const help = screen.getByLabelText('Promo Play Through Details');
  fireEvent.click(help);
  fireEvent(help.closest('details')!, new Event('toggle'));
  await waitFor(() =>
    expect(document.getElementById(help.getAttribute('aria-controls')!)!.hidden).toBe(false)
  );
  view.rerender(
    <PromoPlayThroughFigure
      summary={{
        ...summary,
        locked: 0,
        wallet_locked: 0,
        fee_remaining: 0,
        fee_progress: 200,
        open_grants: 0,
      }}
    />
  );
  expect(screen.queryByLabelText('Promo Play Through Details')).toBeNull();
  expect(screen.queryByText(/Promo Principal Unlocks/)).toBeNull();
});
