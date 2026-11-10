import { test, expect } from '@playwright/test';
import { readEcoIdentity, ECO_CASE } from '../../scripts/verification-harness/cashier-ui-proof.mjs';
import { unionEcoComponents } from '../../src/utils/unionEco';
import { compactChips } from '../../src/utils/format';
import { titleCase } from '../../src/utils/titleCase';

const UNION = 'fade0000-0000-0000-0000-000000000001';
const displayedMoney = (n: number) =>
  n !== 0 && Math.abs(n) < 1 ? (n < 0 ? 'Under 1 Owed' : 'Under 1') : compactChips(n);

test(ECO_CASE, async ({ page }) => {
  test.setTimeout(120000);
  expect(process.env.E2E_ECO_READONLY === '1', 'The closed read-only profile is required').toBe(
    true
  );
  const session = await readEcoIdentity();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript((value) => {
    localStorage.setItem('smarter-poker-auth', JSON.stringify(value));
    // Browser-local presentation flag only; no consent or membership write.
    localStorage.setItem('club_arena_welcome_accepted', 'true');
  }, session);
  let mutationAttempted = false;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const mutating =
      request.method() !== 'GET' &&
      request.method() !== 'OPTIONS' &&
      (/\/api\/club-arena\/(manage-union|settle-period|union-invoice)$/.test(path) ||
        /\/rpc\/(fn_union_patch_settings|fn_union_issue_weekly_invoices|fn_union_record_presettlement|fn_union_settlement_cascade|fn_union_eco_record|fn_union_settle_player_pnl)$/.test(
          path
        ));
    if (mutating) {
      mutationAttempted = true;
      await route.abort();
    } else await route.continue();
  });
  const base = 'https://smarter.poker/hub/club-arena/';
  await page.goto(`${base}unions/${UNION}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const label of ['Cash ECO', 'Tournament ECO']) {
    expect(
      await page.getByLabel(label, { exact: true }).isChecked(),
      'The stored ECO switch must be enabled'
    ).toBe(true);
    expect(
      Number(
        await page.getByRole('spinbutton', { name: `${label} Rate`, exact: true }).inputValue()
      ) === 10,
      'The stored configured rate must be ten percent'
    ).toBe(true);
  }
  await expect(page.getByText(/^ECO Terms Effective From /)).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/^ECO Terms Effective From /)).toBeVisible();
  expect(
    (await page.getByText('ECO Effective Accounting Boundary Unavailable.').count()) === 0,
    'The canonical effective boundary must survive reload'
  ).toBe(true);

  const boardResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/rpc/ca_union_statement_board')
  );
  await page.goto(`${base}unions/${UNION}/statements`, { waitUntil: 'domcontentloaded' });
  const response = await boardResponse;
  expect(response.ok(), 'The authorized statement board must answer').toBe(true);
  const board = await response.json();
  const club = board.clubs?.find(
    (row: Record<string, unknown>) => row.status !== 'missing' && unionEcoComponents(row)
  );
  expect(Boolean(club), 'A persisted two-component invoice is required for live proof').toBe(true);
  const components = unionEcoComponents(club)!;
  expect(
    components.length === 2 && components.every((c) => c.status === 'recorded'),
    'Both lane records must be authoritative'
  ).toBe(true);
  const details = page.getByRole('button', { name: / Statement Details$/ });
  const detailIndex = await details.evaluateAll(
    (elements, label) =>
      elements.findIndex((element) => element.getAttribute('aria-label') === label),
    `${titleCase(String(club.club_name))} Statement Details`
  );
  expect(detailIndex >= 0, 'The persisted invoice must have a visible detail control').toBe(true);
  await details.nth(detailIndex).click();
  for (const component of components) {
    const label = component.activity === 'cash' ? 'Cash ECO' : 'Tournament ECO';
    // Read the exact breakdown line, without printing real financial values.
    const observed = await page.getByText(label, { exact: true }).last().locator('..').innerText();
    expect(
      observed.includes(displayedMoney(component.amount)),
      'The displayed lane must match its recorded amount'
    ).toBe(true);
  }
  await page.evaluate(() => {
    const state = window as unknown as { ecoCsv?: Promise<string> };
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob) state.ecoCsv = blob.text();
      return original(blob);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) click.call(this);
    };
  });
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await page.evaluate(
    async () => await (window as unknown as { ecoCsv?: Promise<string> }).ecoCsv
  );
  expect(
    typeof csv === 'string' &&
      csv.includes('cash_eco_amount') &&
      csv.includes('tournament_eco_amount') &&
      components.every((c) => csv.includes(c.record_id!)),
    'CSV must retain both distinct recorded lane identities'
  ).toBe(true);
  expect(
    mutationAttempted,
    'The case must not attempt a settings, invoice, or financial mutation'
  ).toBe(false);
});
