import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Locator } from '@playwright/test';
import { ActionControllerSettings } from '../../src/components/table/ActionControllerSettings';
import { useUserStore } from '../../src/stores/useUserStore';
import { expectPublishedControllerSettings } from '../e2e/support/actionControllerSettingsProof';

vi.mock('../../src/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
// Adapt only the browser transport. The proof operates the real controller
// component, including the mutually exclusive accessible tab panels.
vi.mock('@playwright/test', () => ({
  expect: (target: { element: () => HTMLElement }) => ({
    toHaveAttribute: async (name: string, value: string) => {
      expect(target.element().getAttribute(name)).toBe(value);
    },
    toHaveValue: async (value: string) => {
      expect((target.element() as HTMLInputElement).value).toBe(value);
    },
  }),
}));

function renderedLocator(element: () => HTMLElement): Locator {
  return {
    element,
    getByRole: (role: Parameters<typeof screen.getByRole>[0], options: object) =>
      renderedLocator(() => within(element()).getByRole(role, options)),
    getByLabel: (label: string) => renderedLocator(() => within(element()).getByLabelText(label)),
    click: async () => {
      fireEvent.click(element());
    },
  } as unknown as Locator;
}

function savedController() {
  const view = render(<ActionControllerSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Casino Emerald', exact: true }));
  fireEvent.click(screen.getByRole('tab', { name: 'Change Default Button Amounts' }));
  for (const [group, values] of [
    ['Preflop Multipliers', [2.25, 2.8, 3.3, 4.5]],
    ['Postflop Pot Percentages', [25, 33.33, 66.67, 125]],
  ] as const) {
    values.forEach((value, index) =>
      fireEvent.change(screen.getByLabelText(`${group} Option ${index + 1}`), {
        target: { value: String(value) },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: `Apply ${group}` }));
  }
  return renderedLocator(() => view.container);
}

beforeEach(() => {
  localStorage.clear();
  useUserStore.setState({ user: null });
});

it('checks all saved amounts and returns a visible selected palette to its caller', async () => {
  await expectPublishedControllerSettings(savedController());
  expect(
    screen
      .getByRole('tab', { name: 'Action Controller', exact: true })
      .getAttribute('aria-selected')
  ).toBe('true');
  expect(
    screen.getByRole('button', { name: 'Casino Emerald', exact: true }).getAttribute('aria-pressed')
  ).toBe('true');
});

it('still rejects an incorrect displayed amount before returning to the palette', async () => {
  const controller = savedController();
  fireEvent.change(screen.getByLabelText('Postflop Pot Percentages Option 4'), {
    target: { value: '124' },
  });
  await expect(expectPublishedControllerSettings(controller)).rejects.toThrow();
});
