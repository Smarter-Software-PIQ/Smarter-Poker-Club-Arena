import type { Page } from '@playwright/test';
import { TERMS_REVISION } from '../../../src/components/legal/legalDates';

type TermsGateStatus = 'accepted' | 'not_accepted' | 'unknown';

const DECIDED_TERMS_SELECTOR = '[data-tos-gate-status]:not([data-tos-gate-status="checking"])';

async function waitForTermsDecision(page: Page, timeout = 60_000): Promise<TermsGateStatus> {
  const decision = page.locator(DECIDED_TERMS_SELECTOR);
  await decision.waitFor({ state: 'attached', timeout });
  const status = await decision.getAttribute('data-tos-gate-status');
  if (status === 'accepted' || status === 'not_accepted') return status;
  if (status === 'unknown') {
    throw new Error('The production Terms Of Service query did not answer; acceptance is unknown.');
  }
  throw new Error(`Unexpected production Terms Of Service gate status: ${String(status)}`);
}

/**
 * Bring the isolated authenticated account through the outermost server-backed
 * gate before global setup asks AppLayout about the inner profile gate.
 *
 * The write goes through the same public UI and idempotent endpoint a player
 * uses. A fresh document must read `accepted` from the canonical
 * profile column again; neither a hidden DOM mutation nor a client-only state
 * flip can satisfy this preflight.
 */
export async function ensureAcceptedTerms(page: Page): Promise<boolean> {
  const status = await waitForTermsDecision(page);
  if (status === 'accepted') return false;

  const heading = page.getByRole('heading', { name: 'Terms Of Service', exact: true });
  await heading.waitFor({ state: 'visible', timeout: 30_000 });

  const agreement = page.getByRole('checkbox', {
    name: 'I Have Read And Agree To The Terms Of Service And Privacy Policy',
    exact: true,
  });
  await agreement.check({ timeout: 20_000 });

  const acceptanceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/club-arena/accept-tos',
    { timeout: 30_000 }
  );
  await page.getByRole('button', { name: 'Accept & Continue', exact: true }).click({
    timeout: 20_000,
  });
  const response = await acceptanceResponse;
  if (!response.ok()) {
    throw new Error(`Terms Of Service acceptance failed in production (${response.status()}).`);
  }

  const request = response.request().postDataJSON();
  const receipt = await response.json();
  if (
    request?.termsRevision !== TERMS_REVISION ||
    receipt?.success !== true ||
    receipt.termsRevision !== TERMS_REVISION ||
    typeof receipt.acceptedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.acceptedAt))
  ) {
    throw new Error('Production acceptance did not confirm the exact reviewed Terms revision.');
  }

  await page
    .locator('[data-tos-gate-status="accepted"]')
    .waitFor({ state: 'attached', timeout: 30_000 });
  // The fresh document's server-backed gate is the readiness contract.
  // Keep one fresh document and its accepted decision inside the original budget.
  // The cold WebKit document can fail to commit a same-tab reload just after
  // acceptance. A second page shares this owned auth context, but no React gate
  // state: its marker requires a new canonical read. Keep the caller's page
  // for the remaining profile flow and close the verification page always.
  const deadline = Date.now() + 60_000;
  const remaining = () => {
    const budget = deadline - Date.now();
    if (budget <= 0) throw new Error('Fresh Terms Of Service verification exhausted its deadline.');
    return budget;
  };
  const verification = await page.context().newPage();
  try {
    const canonicalRead = verification.waitForResponse(
      (result) => {
        const url = new URL(result.url());
        const columns = url.searchParams
          .get('select')
          ?.split(',')
          .map((column) => column.trim())
          .sort()
          .join(',');
        return (
          result.request().method() === 'GET' &&
          url.pathname === '/rest/v1/profiles' &&
          columns === 'club_arena_tos_accepted_at,club_arena_tos_revision'
        );
      },
      { timeout: remaining() }
    );
    const [, profileResponse] = await Promise.all([
      verification.goto(page.url(), { waitUntil: 'commit', timeout: remaining() }),
      canonicalRead,
    ]);
    const payload = await profileResponse.json();
    // maybeSingle GET receives JSON arrays and unwraps only in the client.
    const profile = Array.isArray(payload) ? (payload.length === 1 ? payload[0] : null) : payload;
    if (
      !profileResponse.ok() ||
      profile === null ||
      typeof profile !== 'object' ||
      Array.isArray(profile) ||
      profile?.club_arena_tos_revision !== receipt.termsRevision ||
      typeof profile.club_arena_tos_accepted_at !== 'string' ||
      Date.parse(profile.club_arena_tos_accepted_at) !== Date.parse(receipt.acceptedAt)
    ) {
      throw new Error(
        'Fresh canonical Terms read disagrees with the persisted acceptance receipt.'
      );
    }
    const persistedStatus = await waitForTermsDecision(verification, remaining());
    if (persistedStatus !== 'accepted') {
      throw new Error('Terms Of Service acceptance appeared to succeed but did not persist.');
    }
  } finally {
    await verification.close();
  }

  console.log(
    '[global-setup] exact Terms acceptance receipt ' +
      JSON.stringify({
        termsRevision: receipt.termsRevision,
        acceptedAt: receipt.acceptedAt,
        persisted: true,
      })
  );
  return true;
}
