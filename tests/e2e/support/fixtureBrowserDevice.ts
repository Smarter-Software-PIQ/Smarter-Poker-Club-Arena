import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

export interface FixtureBrowserDevice {
  userId: string;
  origin: string;
  browserId: string;
}

/** Only the maintained disposable account may reuse this harness identity.
 * No previous auth tokens, cookies or another account's browser state are read. */
export function fixtureBrowserDevice(
  record: unknown,
  user: { id: string; email?: string },
  email: string,
  baseURL: string
): FixtureBrowserDevice {
  const fixture = record as { id?: unknown; email?: unknown; createdAt?: unknown } | null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !fixture ||
    fixture.id !== user.id ||
    fixture.email !== email ||
    user.email !== email ||
    !uuid.test(user.id) ||
    !/^ca-customization-cert-postdeploy-\d+-[0-9a-f-]{36}@example\.invalid$/.test(email) ||
    typeof fixture.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(fixture.createdAt))
  )
    throw new Error('Disposable fixture identity does not match the authenticated account.');
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Disposable fixture browser requires an HTTP app origin.');
  const origin = url.origin;
  // The account creator supplies a fresh random UUID for every owned fixture.
  // Domain separation and origin binding keep other jobs/accounts independent.
  const bytes = createHash('sha256').update(`ca-e2e-browser-v1\0${user.id}\0${origin}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  const browserId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { userId: user.id, origin, browserId };
}

export function fixtureBrowserStorage(device: FixtureBrowserDevice) {
  return {
    cookies: [],
    origins: [
      { origin: device.origin, localStorage: [{ name: 'ca_device_id', value: device.browserId }] },
    ],
  };
}

/** Serialized into the fresh browser. The enrollment marker is never seeded:
 * only the app's normal successful claim response can write it this boot. */
export function fixtureEnrollmentObserved(device: FixtureBrowserDevice): boolean {
  try {
    const session = JSON.parse(localStorage.getItem('smarter-poker-auth') || 'null');
    const enrolled = localStorage.getItem('ca_enrolled_device_id');
    return (
      location.origin === device.origin &&
      session?.user?.id === device.userId &&
      localStorage.getItem('ca_device_id') === device.browserId &&
      typeof enrolled === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(enrolled)
    );
  } catch {
    return false;
  }
}

export async function verifyFixtureEnrollment(page: Page, device: FixtureBrowserDevice) {
  await page.waitForFunction(fixtureEnrollmentObserved, device, { timeout: 30_000 });
}
