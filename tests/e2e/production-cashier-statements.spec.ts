/**
 * CASHIER STATEMENTS E2E (Cashier Phase 5) - assertions that cannot pass
 * without the Full Statement.
 *
 * Route `clubs/:clubId/cashier/statements` (src/pages/CashierStatementsPage.tsx)
 * sits behind the same AuthGuard and ClubMemberGuard as the Cashier itself, and
 * what it may show is decided by `fn_cashier_statement_page` on the server: the
 * RPC's `authorized` flag, never the client, says whether the viewer gets a
 * statement or the refusal copy. This suite therefore observes that RPC on the
 * wire and asserts whichever branch the server took - never both.
 *
 * Read-only by construction. The Export word is looked at and never clicked,
 * and the spec fails if any export RPC leaves the page.
 */

import { expect, test } from '@playwright/test';
import { isEngineHealthUnavailableDiagnostic } from './support/engineCutoverConsole';
import { cashierTotalsObservation } from './support/cashierTotalsObservation';
import { cashierStatementRouteMatches } from './support/cashierStatementRouteObservation';
import {
  attachCashierScreenshot,
  expectCashierAxeClean,
  expectExactCashierFigures,
} from './support/cashierProductionCertification';
import { exactChips } from '../../src/utils/format';
import {
  ENTRY_PILL,
  EXACT_FIGURE,
  sameStatementQuery,
  statementTotalsFigures,
} from './support/exact-figure';

const CLUB_ID = process.env.E2E_CLUB_ID || 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
const HAS_AUTH = Boolean(process.env.SP_EMAIL && process.env.SP_PASS);

const PAGE_RPC = '/rest/v1/rpc/fn_cashier_statement_page';
const TOTALS_RPC = '/rest/v1/rpc/fn_cashier_statement_totals';
const EXPORT_RPC = /^\/rest\/v1\/rpc\/fn_cashier_statement_export_(?:start|page|cancel)$/;

/**
 * A figure on the glass, as exactChips() prints it (owner ruling 2026-11-13):
 * en-US separators, cents kept, never K/M/B. The grammar lives in one place and
 * is checked against the formatter by tests/cashier-statements-exact-figure.test.ts.
 */
const FIGURE = EXACT_FIGURE;

test.describe('Cashier Statements - authenticated production route', () => {
  test.describe.configure({ timeout: 90_000 });
  test.skip(
    !HAS_AUTH,
    'SP_EMAIL/SP_PASS are required; a signed-out page is not a Full Statement proof.'
  );

  test('serves the Full Statement console and honors the server authorization verdict', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 393, height: 852 });
    const consoleErrors: Array<{ text: string; url: string }> = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({ text: message.text(), url: message.location().url });
      }
    });
    const exportCalls: string[] = [];
    page.on('request', (request) => {
      if (EXPORT_RPC.test(new URL(request.url()).pathname)) exportCalls.push(request.url());
    });

    // Listen before navigating: the first page RPC leaves as soon as the club
    // id resolves, and a listener attached afterwards can only miss it.
    const pageRpc = page.waitForResponse(
      (response) => new URL(response.url()).pathname === PAGE_RPC,
      { timeout: 60_000 }
    );
    const totalsRpc = page
      .waitForResponse((response) => new URL(response.url()).pathname === TOTALS_RPC, {
        timeout: 60_000,
      })
      .catch(() => null);
    // Every totals answer with the request that asked for it, in the order the
    // answers arrived. The slot is taken when the answer arrives and filled
    // when its body is read, so "newest" is the last answer received, never
    // the last body parsed, and a newest answer still being read is waited for.
    const totalsAnswers: ({ asked: unknown; answer: unknown } | null)[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname !== TOTALS_RPC || response.status() !== 200) return;
      const slot = totalsAnswers.push(null) - 1;
      const asked: unknown = response.request().postDataJSON();
      void response
        .json()
        .then((answer: unknown) => {
          totalsAnswers[slot] = { asked, answer };
        })
        .catch(() => undefined);
    });

    // (a) The signed-in visit lands on the route itself, not on auth.
    const statementURL = new URL(
      `clubs/${CLUB_ID}/cashier/statements`,
      testInfo.project.use.baseURL
    );
    await page.goto(statementURL.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(page).not.toHaveURL(/\/auth(?:\/|\?|$)/, { timeout: 30_000 });
    const response = await pageRpc;
    const rpcClubId: unknown = response.request().postDataJSON()?.p_club_id;
    expect(rpcClubId, 'the native statement request must retain the original club identity').toBe(
      CLUB_ID
    );
    await expect
      .poll(
        () => cashierStatementRouteMatches(new URL(page.url()), statementURL, CLUB_ID, rpcClubId),
        { timeout: 30_000, message: 'Statements did not retain its route and native club identity' }
      )
      .toBe(true);

    // (b) Exactly one SpadeConsole chassis carries the page.
    const surface = page.locator('[data-cashier-surface="statements"]');
    await expect(surface).toBeVisible({ timeout: 60_000 });
    await expect(surface.locator('[data-cashier-layout="directory"]')).toHaveCount(1);
    // 2026-10-17: a page bar with the painted "?" replaced the eyebrow and
    // the giant title (Dan: "PAGES DON'T NEED TITLES LIKE THIS").
    await expect(surface.locator('.ca-page-bar')).toHaveCount(1);
    await expect(surface.getByRole('button', { name: 'Page Help', exact: true })).toBeVisible();
    await expect(surface.getByRole('heading', { name: 'Cashier', exact: true })).toHaveText(
      'Cashier'
    );
    await expect(
      surface.getByRole('button', { name: 'Back To Cashier', exact: true })
    ).toBeVisible();

    // (c) The page RPC answers 200 and its `authorized` flag decides the branch.
    expect(response.status(), `${PAGE_RPC} did not answer 200`).toBe(200);
    const body = (await response.json()) as { authorized?: unknown; scope?: unknown };
    expect(typeof body.authorized, 'fn_cashier_statement_page returned no boolean authorized').toBe(
      'boolean'
    );
    const authorized = body.authorized === true && body.scope !== 'none';
    // The certification run signs in as an administrator of this club, so a
    // refusal there is a defect, and the refusal branch below must not turn
    // the certificate green with no totals compared (overwatch, review of
    // 41b4bda8, B1).
    if (process.env.E2E_REQUIRE_AUTH === '1')
      expect(authorized, 'the certification account was refused its own club statement').toBe(true);
    await testInfo.attach('cashier-statement-page-verdict.json', {
      body: JSON.stringify({
        httpStatus: response.status(),
        authorized,
        scope:
          typeof body.scope === 'string' && ['all', 'downline', 'self', 'none'].includes(body.scope)
            ? body.scope
            : null,
      }),
      contentType: 'application/json',
    });

    const pill = surface.locator('.ca-page-bar__status');
    const totals = surface.locator('[aria-label="Statement Totals"]');
    const exportSection = surface.locator('section[aria-labelledby="statement-export-title"]');
    const exportWord = exportSection.getByRole('button', { name: 'Export CSV', exact: true });

    if (authorized) {
      const access = surface.locator('section[aria-label="What You Can See"]').getByRole('status');
      await expect(access).toHaveText(
        /^(Every Entry In This Club|Your Entries And Your Downline|Your Own Entries)$/,
        { timeout: 30_000 }
      );

      // The entries list settles on rows or on the truthful empty state. An
      // error here would contradict the 200 just observed, so it fails.
      const entries = surface.locator('section[aria-labelledby="statement-entries-title"]');
      await expect(entries.getByRole('heading', { name: 'Entries', exact: true })).toBeVisible();
      const rows = entries.locator('button[aria-expanded]');
      const empty = entries.getByText('No Entries In This Range.', { exact: true });
      await expect
        .poll(async () => (await rows.count()) + (await empty.count()), {
          timeout: 30_000,
          message: 'Entries never reached rows or the empty state',
        })
        .toBeGreaterThan(0);
      await expect(entries.getByRole('alert')).toHaveCount(0);
      await expect(entries.getByText('Loading Statement...', { exact: true })).toHaveCount(0);

      // (d) A production totals certificate requires the actual successful
      // authorized RPC and four figures. The application's truthful Unavailable
      // fallback remains valid UX, but cannot certify the database optimization.
      //
      // Read text CONTENT, not innerText: the console's CSS uppercases the
      // rendering, so innerText returns "UNAVAILABLE FOR THIS RANGE" and the
      // word as written in CashierStatementsPage never matches. That is what
      // the page really said in run 35886655700.
      const totalsResponse = await totalsRpc;
      const totalsBody: unknown = await totalsResponse?.json().catch(() => null);
      const totalsObservation = cashierTotalsObservation(
        totalsResponse?.status() ?? null,
        totalsBody,
        body.scope
      );
      await testInfo.attach('cashier-statement-totals-verdict.json', {
        body: JSON.stringify({ observedAt: new Date().toISOString(), ...totalsObservation }),
        contentType: 'application/json',
      });
      expect(
        totalsObservation,
        'authorized statement totals did not return a usable verdict'
      ).toEqual({
        httpStatus: 200,
        authorized: true,
        scope: body.scope,
        scopeMatchesPage: true,
        validTotals: true,
      });
      const totalsWord = totals.getByRole('status');
      const asText = (value: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
      await expect
        .poll(
          async () => {
            const word =
              (await totalsWord.count()) > 0 ? asText(await totalsWord.textContent()) : '';
            if (word === 'Unavailable For This Range') return 'unavailable';
            if (word === 'Calculating') return 'calculating';
            const figures = (await totals.locator('strong').allTextContents()).map(asText);
            return figures.length === 4 && figures.every((figure) => FIGURE.test(figure))
              ? 'figures'
              : `pending:${figures.join('|')}`;
          },
          { timeout: 30_000, message: 'Statement Totals never reached a terminal state' }
        )
        .toBe('figures');
      await expect(totals).not.toContainText('Calculating');
      // The four figures on the glass are the server's totals, exactly: the
      // newest totals answer, written the way the page writes it. Polled
      // because a live ledger may answer again while this runs.
      await expect
        .poll(
          async () => {
            const figures = (await totals.locator('strong').allTextContents()).map(asText);
            if (totalsAnswers.length === 0) return 'no totals answer';
            const newest = totalsAnswers.at(-1);
            if (!newest) return 'newest totals answer still being read';
            // Same club, period and filters as the entries on the glass: the
            // totals request must carry the page request's own arguments.
            if (!sameStatementQuery(newest.asked, response.request().postDataJSON()))
              return 'totals were asked for a different club, period or filter than the page';
            const served = (newest.answer as { totals?: unknown } | null)?.totals as
              | Parameters<typeof statementTotalsFigures>[0]
              | undefined;
            if (!served) return 'newest totals answer carries no totals';
            const expected = statementTotalsFigures(served, exactChips);
            // The verdict names which figure differs and never prints a club's
            // totals into the run log.
            const differing = ['In', 'Out', 'Managed', 'Entries'].filter(
              (_, index) => figures[index] !== expected[index]
            );
            return figures.length === 4 && differing.length === 0
              ? 'matches the server'
              : `differs: ${differing.join(', ') || 'figure count'}`;
          },
          { timeout: 30_000, message: 'Statement Totals on the glass differ from the server' }
        )
        .toBe('matches the server');
      // The pill zone's textContent ends on a deliberate word-boundary space
      // (SpadeConsole ZoneText, 2026-09-23); a regex toHaveText does not
      // normalise it, so the anchor tolerates trailing whitespace.
      await expect(pill).toHaveText(ENTRY_PILL);

      // (e) The Export word is present. It is enabled exactly when the range
      // holds entries (the page disables it on an empty range), and it is
      // never clicked here: no export RPC may leave this page.
      await expect(
        exportSection.getByRole('heading', { name: 'Export', exact: true })
      ).toBeVisible();
      await expect(exportWord).toBeVisible();
      await expect(exportSection.getByRole('status')).toHaveText(
        /^Exports The Whole Range As A CSV File, Up To [\d,]+ Entries\.$/
      );
      if ((await rows.count()) > 0) {
        await expect(exportWord).toBeEnabled({ timeout: 30_000 });
      } else {
        await expect(exportWord).toBeDisabled();
      }
    } else {
      // The server refused: the page shows only its refusal copy, no statement.
      const refusal = surface.getByRole('alert');
      await expect(refusal).toBeVisible({ timeout: 30_000 });
      await expect(
        refusal.getByRole('heading', { name: 'Statement Unavailable', exact: true })
      ).toBeVisible();
      await expect(
        refusal.getByText('Your Role In This Club Does Not Include This Statement.', {
          exact: true,
        })
      ).toBeVisible();
      await expect(pill).toHaveText('Refused');
      await expect(totals).toHaveCount(0);
      await expect(exportWord).toHaveCount(0);
    }

    expect(exportCalls, 'an export RPC left the page without a click').toEqual([]);

    // (f) No error boundary and no console error of the app's own kind.
    await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0);
    const engineHealthDiagnostics = consoleErrors.filter(isEngineHealthUnavailableDiagnostic);
    await testInfo.attach('cashier-statements-engine-health-diagnostics.json', {
      body: JSON.stringify(engineHealthDiagnostics, null, 2),
      contentType: 'application/json',
    });
    const critical = consoleErrors.filter(
      (entry) =>
        !isEngineHealthUnavailableDiagnostic(entry) &&
        !entry.text.includes('[cashier-telemetry]') &&
        !entry.text.includes('favicon') &&
        !entry.url.includes('favicon')
    );
    expect(critical, critical.map((entry) => `${entry.url}: ${entry.text}`).join('\n')).toEqual([]);
    // Every row amount on the glass (the last span of each entry button) and
    // every total is an exact figure. Reference codes and names are not figures.
    await expectExactCashierFigures(
      surface.locator(
        'section[aria-labelledby="statement-entries-title"] button[aria-expanded] > span:last-child'
      ),
      'Full Statement entries',
      // one amount for every entry row on the glass (none when refused or empty)
      await surface
        .locator('section[aria-labelledby="statement-entries-title"] button[aria-expanded]')
        .count()
    );
    await expectExactCashierFigures(
      surface.locator('[aria-label="Statement Totals"] strong'),
      'Full Statement totals',
      // the four totals, or none when the statement is refused
      [0, 4]
    );
    await expectCashierAxeClean(
      page,
      testInfo,
      '[data-cashier-surface="statements"]',
      'cashier-statements'
    );
    await attachCashierScreenshot(page, testInfo, 'cashier-statements');
  });
});
