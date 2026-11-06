import type { Page } from '@playwright/test';

interface OwnedCustomizationAccount {
  id: string;
  email: string;
}
interface EnrollmentTarget {
  userId: string;
  origin: string;
}

/** Read only: a fresh context receives these markers from the real claim RPC. */
export function customizationEnrollmentObserved(target: EnrollmentTarget) {
  try {
    const session = JSON.parse(localStorage.getItem('smarter-poker-auth') || 'null');
    const browser = localStorage.getItem('ca_device_id');
    const device = localStorage.getItem('ca_enrolled_device_id');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return location.origin === target.origin &&
      session?.user?.id === target.userId &&
      browser &&
      device &&
      uuid.test(browser) &&
      uuid.test(device)
      ? { browser, device }
      : null;
  } catch {
    return null;
  }
}

/** Independent browsers on this one test runner pair through the normal UI.
 * A new physical-device claim would revoke the first browser. Never copy a
 * browser token, seed enrollment, or bypass the account's device policy. */
export async function enrollCustomizationBrowser(
  page: Page,
  account: OwnedCustomizationAccount,
  approvingPage?: Page
) {
  if (
    !/^[0-9a-f-]{36}$/i.test(account.id) ||
    !/^ca-customization-cert-[a-z]+(?:-[a-z]+)*-\d+-[0-9a-f-]{36}@example\.invalid$/.test(
      account.email
    )
  )
    throw new Error('Browser pairing requires the owned disposable customization account.');
  const target = { userId: account.id, origin: new URL(page.url()).origin };
  const currentUser = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('smarter-poker-auth') || 'null')?.user?.id;
    } catch {
      return null;
    }
  });
  if (currentUser !== account.id) throw new Error('Customization browser identity does not match.');
  if (approvingPage) {
    const existing = await approvingPage.evaluate(customizationEnrollmentObserved, target);
    if (!existing) throw new Error('The approving browser is not enrolled for this account.');
    const sameDevice = page.getByRole('button', { name: /^Same As / });
    await sameDevice.waitFor({ state: 'visible', timeout: 30_000 });
    await sameDevice.click({ timeout: 20_000 });
    const approval = approvingPage
      .getByRole('alertdialog')
      .filter({ hasText: 'Add A New Browser?' });
    await approval.getByRole('button', { name: 'Approve', exact: true }).click({ timeout: 30_000 });
    const enrolled = await page.waitForFunction(customizationEnrollmentObserved, target, {
      timeout: 30_000,
    });
    const joined = await enrolled.jsonValue();
    await enrolled.dispose();
    const retained = await approvingPage.evaluate(customizationEnrollmentObserved, target);
    if (
      !joined ||
      !retained ||
      joined.device !== existing.device ||
      retained.device !== existing.device ||
      joined.browser === existing.browser
    )
      throw new Error('Independent customization browsers did not pair to the same active device.');
  } else {
    const enrolled = await page.waitForFunction(customizationEnrollmentObserved, target, {
      timeout: 30_000,
    });
    await enrolled.dispose();
  }
}
