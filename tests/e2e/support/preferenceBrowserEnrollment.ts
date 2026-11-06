import type { Page } from '@playwright/test';
import { customizationEnrollmentObserved } from './customizationBrowserEnrollment';

/** Wait for the real account gate before touching the welcome dialog beneath it. */
export function preferenceDeviceGateObserved(target: { userId: string; origin: string }) {
  try {
    const session = JSON.parse(localStorage.getItem('smarter-poker-auth') || 'null');
    if (location.origin !== target.origin || session?.user?.id !== target.userId) return null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      uuid.test(localStorage.getItem('ca_device_id') || '') &&
      uuid.test(localStorage.getItem('ca_enrolled_device_id') || '')
    )
      return 'enrolled';
    const choice = Array.from(document.querySelectorAll('[role="alertdialog"] button')).some(
      (button) => button.textContent === 'This Is A New Device'
    );
    return choice ? 'choice' : null;
  } catch {
    return null;
  }
}

/** This journey explicitly logs out before opening its cache-empty replacement.
 * Use the normal new-device choice; no previous browser is available to approve.
 * Auth is still the only state installed by openFreshPreferenceDevice. */
export async function enrollPreferenceBrowser(page: Page, account: { id: string; email: string }) {
  if (
    !/^[0-9a-f-]{36}$/i.test(account.id) ||
    !/^ca-customization-cert-.*@example\.invalid$/.test(account.email)
  )
    throw new Error('Preference enrollment requires an owned disposable account');
  const target = { userId: account.id, origin: new URL(page.url()).origin };
  const ready = await page.waitForFunction(preferenceDeviceGateObserved, target, {
    timeout: 30_000,
  });
  const state = await ready.jsonValue();
  await ready.dispose();
  if (state === 'choice')
    await page.getByRole('button', { name: 'This Is A New Device', exact: true }).click();
  const enrolled = await page.waitForFunction(customizationEnrollmentObserved, target, {
    timeout: 30_000,
  });
  await enrolled.dispose();
}
